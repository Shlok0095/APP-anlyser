import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AnalysisInput, EngineContext } from '../../shared/types/engine'
import type { AnalysisProcessStep, JobEvent, JobRecord } from '../../shared/types/jobs'
import { mergeAnalysisResults, type AnalysisResult } from '../../shared/types/analysis'
import { enginesFor, listEngines } from '../../engines/registry'
import { runCommand } from '../../engines/base/spawn'
import { JobStore } from '../storage/job-store'
import { writeEvidencePack } from '../reports/evidence-pack'
import { generateReports } from '../reports/generate'
import { compileFullAnalysisMarkdown } from '../reports/full-markdown'
import { explainWithOptionalRemote } from '../../ai/explainer'
import { structureFullAnalysisMarkdown } from '../../ai/full-report'
import { missingAnalysisTarget } from '../../shared/validation/input'

export type JobListener = (event: JobEvent) => void

export interface JobAiOptions {
  mode: 'off' | 'local' | 'cloud'
  endpoint?: string
  nvidiaApiKey?: string
  nvidiaModel?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
}

function commandProcessName(file: string, args: string[]): string {
  const reaIndex = args.findIndex((item) => /rea(\.mjs)?$/i.test(item) || item.endsWith('rea.mjs'))
  if (reaIndex >= 0) {
    const command = args[reaIndex + 1] ?? 'rea'
    return `rea ${command}`
  }
  return `${basename(file)} ${args.slice(0, 2).join(' ')}`.slice(0, 120)
}

export class JobManager {
  private readonly listeners = new Set<JobListener>()
  private readonly inflight = new Map<string, { cancelled: boolean }>()

  constructor(
    private readonly store: JobStore,
    private readonly artifactRoot: string,
    private readonly reportsRoot: string
  ) {
    mkdirSync(artifactRoot, { recursive: true })
    mkdirSync(reportsRoot, { recursive: true })
  }

  onEvent(listener: JobListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: JobEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  list(): JobRecord[] {
    return this.store.list().map((job) => this.ensureMarkdown(job))
  }

  get(id: string): JobRecord | undefined {
    const job = this.store.get(id)
    return job ? this.ensureMarkdown(job) : undefined
  }

  ensureMarkdown(job: JobRecord): JobRecord {
    if (job.status !== 'completed' || !job.result) {
      return job
    }
    const reportDir = join(this.reportsRoot, job.id)
    const markdownPath = join(reportDir, `${job.id}-full-analysis.md`)
    const reconstructionPath = join(reportDir, 'evidence', 'reconstruction.md')
    let changed = false
    if (!job.reportPaths?.markdown || !existsSync(job.reportPaths.markdown)) {
      if (existsSync(markdownPath)) {
        job.reportPaths = { ...job.reportPaths, markdown: markdownPath }
        changed = true
      } else {
        try {
          job.reportPaths = { ...job.reportPaths, ...generateReports(job, reportDir) }
          changed = true
        } catch {
          /* reconstruction pack may still write */
        }
      }
    }
    if (!job.reportPaths?.reconstruction || !existsSync(job.reportPaths.reconstruction)) {
      if (existsSync(reconstructionPath)) {
        job.reportPaths = {
          ...job.reportPaths,
          reconstruction: reconstructionPath,
          evidenceFolder: join(reportDir, 'evidence')
        }
        changed = true
      } else {
        try {
          const pack = writeEvidencePack(job, reportDir)
          job.reportPaths = { ...job.reportPaths, ...pack }
          changed = true
        } catch {
          /* keep markdown even if pack fails */
        }
      }
    }
    if (changed) {
      this.store.upsert(job)
    }
    return job
  }

  readMarkdown(id: string): { path: string; content: string } | null {
    const job = this.get(id)
    const path = job?.reportPaths?.markdown
    if (!path || !existsSync(path)) {
      return null
    }
    return { path, content: readFileSync(path, 'utf8') }
  }

  readEvidence(id: string): { path: string; content: string; folder: string } | null {
    const job = this.get(id)
    const path = job?.reportPaths?.reconstruction
    const folder = job?.reportPaths?.evidenceFolder
    if (!path || !folder || !existsSync(path)) {
      return null
    }
    return { path, content: readFileSync(path, 'utf8'), folder }
  }

  cancel(id: string): JobRecord | undefined {
    const state = this.inflight.get(id)
    if (state) {
      state.cancelled = true
    }
    const job = this.store.get(id)
    if (!job) {
      return undefined
    }
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'cancelled'
      job.updatedAt = new Date().toISOString()
      job.completedAt = job.updatedAt
      this.store.upsert(job)
      this.emit({ jobId: id, type: 'cancelled', job, message: 'Cancelled by user.' })
    }
    return job
  }

  private mutate(id: string, update: (job: JobRecord) => void, message?: string, type: JobEvent['type'] = 'updated'): JobRecord | undefined {
    const job = this.store.get(id)
    if (!job) {
      return undefined
    }
    if (!job.processes) {
      job.processes = []
    }
    update(job)
    job.updatedAt = new Date().toISOString()
    this.store.upsert(job)
    this.emit({ jobId: id, type, job, message })
    return job
  }

  private beginProcess(id: string, name: string): string {
    let processId = 'P01'
    this.mutate(id, (job) => {
      const seq = job.processes.length + 1
      processId = `P${String(seq).padStart(2, '0')}`
      const step: AnalysisProcessStep = {
        processId,
        name,
        startedAt: new Date().toISOString(),
        status: 'running'
      }
      job.processes.push(step)
      job.logs.push({ at: step.startedAt, message: `[${processId}] ${name} started` })
      if (job.logs.length > 400) {
        job.logs = job.logs.slice(-300)
      }
    }, `${name} started`, 'log')
    return processId
  }

  private endProcess(
    id: string,
    processId: string,
    status: AnalysisProcessStep['status'],
    detail?: string
  ): void {
    this.mutate(id, (job) => {
      const step = [...job.processes].reverse().find((item) => item.processId === processId)
      if (!step) {
        return
      }
      step.endedAt = new Date().toISOString()
      step.status = status
      step.detail = detail
      const started = Date.parse(step.startedAt)
      const ended = Date.parse(step.endedAt)
      if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
        step.durationMs = ended - started
      }
      job.logs.push({
        at: step.endedAt,
        message: `[${processId}] ${step.name} ${status}${step.durationMs !== undefined ? ` (${step.durationMs}ms)` : ''}`
      })
      if (job.logs.length > 400) {
        job.logs = job.logs.slice(-300)
      }
    }, `${processId} ${status}`, 'log')
  }

  async create(
    input: AnalysisInput,
    ai: JobAiOptions
  ): Promise<JobRecord> {
    const engines = enginesFor(input)
    const now = new Date().toISOString()
    const job: JobRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      targetType: input.targetType,
      targetLabel: input.label,
      input,
      profile: input.profile,
      engineIds: engines.map((engine) => engine.descriptor.id),
      engineVersions: Object.fromEntries(
        engines.map((engine) => [engine.descriptor.id, engine.descriptor.version])
      ),
      logs: [
        {
          at: now,
          message: `Queued ${engines.length} engine(s). Full Markdown report uses process id of this job.`
        }
      ],
      processes: [],
      warnings: [],
      errors: []
    }
    const missing = missingAnalysisTarget(input)
    if (missing) {
      job.status = 'failed'
      job.errors.push(missing)
      job.completedAt = now
      this.store.upsert(job)
      this.emit({ jobId: job.id, type: 'failed', job, message: missing })
      return job
    }
    if (engines.length === 0) {
      job.status = 'failed'
      job.errors.push('No analysis engine supports this target and input combination.')
      job.completedAt = now
      this.store.upsert(job)
      this.emit({ jobId: job.id, type: 'failed', job, message: job.errors[0] })
      return job
    }
    this.store.upsert(job)
    this.emit({ jobId: job.id, type: 'created', job })
    void this.run(job.id, ai)
    return job
  }

  private async run(id: string, ai: JobAiOptions): Promise<void> {
    const job = this.store.get(id)
    if (!job) {
      return
    }
    const token = { cancelled: false }
    this.inflight.set(id, token)
    job.status = 'running'
    job.updatedAt = new Date().toISOString()
    this.store.upsert(job)
    this.emit({ jobId: id, type: 'updated', job, message: 'Running' })
    const artifactDir = join(this.artifactRoot, id)
    mkdirSync(artifactDir, { recursive: true })
    const ctx: EngineContext = {
      artifactDir,
      isCancelled: () => token.cancelled,
      emitLog: (message) => {
        const current = this.store.get(id)
        if (!current) {
          return
        }
        current.logs.push({ at: new Date().toISOString(), message })
        if (current.logs.length > 300) {
          current.logs = current.logs.slice(-250)
        }
        current.updatedAt = new Date().toISOString()
        this.store.upsert(current)
        this.emit({ jobId: id, type: 'log', message, job: current })
      },
      emitProgress: (label, percent) => {
        const current = this.store.get(id)
        if (!current) {
          return
        }
        current.progressLabel = label
        current.progressPercent = percent
        this.store.upsert(current)
        this.emit({ jobId: id, type: 'progress', message: label, percent, job: current })
      },
      runCommand: async (file, args, options) => {
        const processId = this.beginProcess(id, commandProcessName(file, args))
        try {
          const result = await runCommand(file, args, {
            ...options,
            onStdoutLine: (line) => {
              options?.onStdoutLine?.(line)
              if (!line.startsWith('{') || !line.includes('rea_progress')) {
                return
              }
              try {
                const parsed = JSON.parse(line) as {
                  rea_progress?: {
                    message?: string
                    completed?: number
                    total?: number
                    phase?: string
                  }
                }
                const progress = parsed.rea_progress
                if (!progress) {
                  return
                }
                const label = progress.message || progress.phase || 'REA running'
                const percent =
                  typeof progress.completed === 'number' &&
                  typeof progress.total === 'number' &&
                  progress.total > 0
                    ? Math.min(99, Math.round((progress.completed / progress.total) * 90) + 5)
                    : undefined
                ctx.emitProgress(label, percent)
                ctx.emitLog(label)
              } catch {
                // progress lines are best-effort
              }
            }
          })
          this.endProcess(
            id,
            processId,
            result.timedOut || (result.code !== 0 && result.code !== null) ? 'failed' : 'ok',
            result.timedOut ? 'timed out' : `exit ${result.code ?? 'null'}`
          )
          return result
        } catch (error) {
          this.endProcess(
            id,
            processId,
            'failed',
            error instanceof Error ? error.message : String(error)
          )
          throw error
        }
      },
      fetchText: async (url) => {
        if (url.startsWith('file:')) {
          const { readFileSync } = await import('node:fs')
          const { fileURLToPath } = await import('node:url')
          return readFileSync(fileURLToPath(url), 'utf8')
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) {
          throw new Error(`Fetch failed (${response.status}) for ${url}`)
        }
        return await response.text()
      }
    }

    try {
      ctx.emitProgress('Starting analysis engines', 2)
      const selected = enginesFor(job.input)
      const parts: AnalysisResult[] = []
      for (const engine of selected) {
        if (token.cancelled) {
          throw new Error('Cancelled')
        }
        const validation = engine.validate(job.input)
        job.warnings.push(...validation.warnings)
        if (!validation.ok) {
          job.warnings.push(
            `Engine ${engine.descriptor.id} skipped: ${validation.errors.join(' ')}`
          )
          continue
        }
        const engineProcess = this.beginProcess(id, `engine ${engine.descriptor.id}`)
        try {
          ctx.emitLog(`Engine ${engine.descriptor.displayName} started.`)
          parts.push(await engine.execute(job.input, ctx))
          this.endProcess(id, engineProcess, 'ok')
        } catch (error) {
          this.endProcess(
            id,
            engineProcess,
            'failed',
            error instanceof Error ? error.message : String(error)
          )
          throw error
        }
      }
      if (parts.length === 0) {
        throw new Error(
          `No engine produced results. ${job.warnings.slice(-3).join(' ') || 'Check the selected app type and file.'}`
        )
      }
      const merged = mergeAnalysisResults(parts)
      if (job.profile.ai) {
        const explained = await explainWithOptionalRemote(merged, ai)
        if (explained.skipped) {
          merged.skipped.push({ check: 'ai', reason: explained.skipped })
        }
        if (explained.explanations.length > 0) {
          merged.metadata.aiExplanations = String(explained.explanations.length)
          merged.logs.push(...explained.explanations.map((item) => item.text))
        }
      }
      const current = this.store.get(id)
      if (!current) {
        return
      }
      current.result = merged
      current.status = token.cancelled ? 'cancelled' : 'completed'
      current.completedAt = new Date().toISOString()
      current.updatedAt = current.completedAt
      this.store.upsert(current)
      const reportProcess = this.beginProcess(id, 'Full Markdown report')
      let structuredMarkdown: string | undefined
      try {
        if ((ai.nvidiaApiKey?.trim() || ai.openaiApiKey?.trim()) && !token.cancelled) {
          ctx.emitProgress('Structuring full Markdown report', 97)
          const snapshot = this.store.get(id) ?? current
          const compiled = compileFullAnalysisMarkdown(snapshot)
          const brief = compileFullAnalysisMarkdown(snapshot, {
            inventoryLimit: 40,
            includeSource: false
          })
          const structured = await Promise.race([
            structureFullAnalysisMarkdown(brief, {
              nvidiaApiKey: ai.nvidiaApiKey,
              nvidiaModel: ai.nvidiaModel,
              openaiApiKey: ai.openaiApiKey,
              openaiBaseUrl: ai.openaiBaseUrl,
              openaiModel: ai.openaiModel,
              appendix: compiled
            }),
            new Promise<{ markdown: string; model: string; skipped: string }>((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    markdown: compiled,
                    model: 'deterministic',
                    skipped: 'Report structuring exceeded 100s; kept the complete local Markdown.'
                  }),
                100_000
              )
            })
          ])
          structuredMarkdown = structured.markdown
          current.result.metadata.reportModel = structured.model
          if (structured.skipped) {
            current.warnings.push(structured.skipped)
          }
        }
        this.endProcess(id, reportProcess, 'ok', structuredMarkdown ? 'AI structured' : 'local evidence dump')
      } catch (error) {
        this.endProcess(
          id,
          reportProcess,
          'failed',
          error instanceof Error ? error.message : String(error)
        )
      }
      const fresh = this.store.get(id) ?? current
      fresh.result = current.result
      fresh.warnings = current.warnings
      fresh.status = current.status
      fresh.completedAt = current.completedAt
      fresh.reportPaths = generateReports(fresh, join(this.reportsRoot, id))
      if (fresh.result?.metadata.reaWorkspaceDir) {
        fresh.reportPaths.workspace = fresh.result.metadata.reaWorkspaceDir
      }
      if (structuredMarkdown && fresh.reportPaths.markdown) {
        writeFileSync(fresh.reportPaths.markdown, structuredMarkdown, 'utf8')
      }
      this.store.upsert(fresh)
      Object.assign(current, fresh)
      this.emit({
        jobId: id,
        type: token.cancelled ? 'cancelled' : 'completed',
        job: current,
        message: token.cancelled ? 'Cancelled' : 'Completed'
      })
    } catch (error) {
      const current = this.store.get(id)
      if (!current) {
        return
      }
      current.status = token.cancelled ? 'cancelled' : 'failed'
      current.errors.push(error instanceof Error ? error.message : String(error))
      current.completedAt = new Date().toISOString()
      current.updatedAt = current.completedAt
      this.store.upsert(current)
      this.emit({
        jobId: id,
        type: current.status === 'cancelled' ? 'cancelled' : 'failed',
        job: current
      })
    } finally {
      this.inflight.delete(id)
    }
  }
}

export function describeEngines() {
  return listEngines().map((engine) => engine.descriptor)
}
