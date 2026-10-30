import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import type { JobRecord } from '../../shared/types/jobs'

const TEXT_EXT =
  /\.(js|jsx|ts|tsx|mjs|cjs|json|md|py|html|css|yml|yaml|toml|xml|java|kt|cs|go|rs|rb|php|sql|txt|vue|svelte)$/i
const SKIP_DIR = /^(node_modules|\.git|dist|out|build|coverage|\.rea)$/i
const MAX_SOURCE_FILES = 48
const MAX_SOURCE_CHARS = 4000
const MAX_SOURCE_TOTAL = 120_000

function durationMs(start?: string, end?: string): number | undefined {
  if (!start || !end) {
    return undefined
  }
  const value = Date.parse(end) - Date.parse(start)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function yamlEscape(value: string): string {
  return value.replaceAll('\n', ' ').replaceAll('"', '\\"')
}

function fence(language: string, body: string): string {
  const safe = body.replaceAll('```', '`ˋ`')
  return `\`\`\`${language}\n${safe.trimEnd()}\n\`\`\``
}

export function redactSecrets(text: string): string {
  return text
    .replace(/nvapi-[A-Za-z0-9_-]+/g, 'nvapi-[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[REDACTED]')
}

function collectSourceFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (files.length >= MAX_SOURCE_FILES) {
      return
    }
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_SOURCE_FILES) {
        return
      }
      if (SKIP_DIR.test(entry)) {
        continue
      }
      const full = join(dir, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full)
        continue
      }
      if (stat.isFile() && TEXT_EXT.test(entry) && stat.size < 512_000) {
        files.push(full)
      }
    }
  }
  walk(root)
  return files
}

function observedSource(path: string | undefined, inputKind: string): string {
  if (!path || (inputKind !== 'folder' && inputKind !== 'file')) {
    return '_No local source tree was provided._\n'
  }
  if (!existsSync(path)) {
    return `_Path not readable: ${path}_\n`
  }
  const rootStat = statSync(path)
  const roots = rootStat.isDirectory() ? [path] : [path]
  const files = roots.flatMap((root) =>
    rootStat.isDirectory() ? collectSourceFiles(root) : TEXT_EXT.test(root) ? [root] : []
  )
  if (files.length === 0) {
    return '_No text source files were included (binary or empty tree)._\n'
  }
  const chunks: string[] = []
  let used = 0
  for (const file of files) {
    if (used >= MAX_SOURCE_TOTAL) {
      chunks.push('\n_Additional source files omitted to keep this report bounded._\n')
      break
    }
    let body = ''
    try {
      body = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const clipped = body.slice(0, MAX_SOURCE_CHARS)
    used += clipped.length
    const rel = rootStat.isDirectory() ? relative(path, file).replaceAll('\\', '/') : file
    chunks.push(`### \`${rel}\`\n\n${fence(extname(file).slice(1) || 'txt', clipped)}\n`)
    if (body.length > MAX_SOURCE_CHARS) {
      chunks.push(`_Truncated ${body.length - MAX_SOURCE_CHARS} remaining characters._\n`)
    }
  }
  return chunks.join('\n')
}

function reaArtifactSummaries(artifactDir: string | undefined): string {
  if (!artifactDir || !existsSync(artifactDir)) {
    return '_No REA artifact folder._\n'
  }
  let names: string[] = []
  try {
    names = readdirSync(artifactDir)
      .filter((name) => name.startsWith('rea-') && name.endsWith('.json'))
      .sort()
  } catch {
    return '_REA artifact folder could not be listed._\n'
  }
  if (names.length === 0) {
    return '_No REA JSON artifacts._\n'
  }
  const lines = ['| file | bytes | operation | notes |', '|---|---:|---|---|']
  for (const name of names) {
    const full = join(artifactDir, name)
    let bytes = 0
    let operation = ''
    let notes = ''
    try {
      bytes = statSync(full).size
      const parsed = JSON.parse(readFileSync(full, 'utf8')) as {
        operation?: string
        normalized_result?: unknown
        error?: unknown
        ok?: boolean
      }
      operation = typeof parsed.operation === 'string' ? parsed.operation : ''
      if (parsed.ok === false || parsed.error) {
        notes = 'error/skip'
      } else if (Array.isArray(parsed.normalized_result)) {
        notes = `${parsed.normalized_result.length} row(s)`
      } else if (parsed.normalized_result && typeof parsed.normalized_result === 'object') {
        notes = Object.keys(parsed.normalized_result).slice(0, 8).join(', ')
      }
    } catch {
      notes = 'unreadable'
    }
    lines.push(`| \`${name}\` | ${bytes} | ${operation || '—'} | ${notes || '—'} |`)
  }
  return `${lines.join('\n')}\n`
}

function capped<T>(items: T[], limit: number | undefined, render: (item: T) => string): string {
  if (items.length === 0) {
    return '_None mapped._\n'
  }
  const slice = limit && items.length > limit ? items.slice(0, limit) : items
  const extra =
    slice.length < items.length
      ? `\n_Showing ${slice.length} of ${items.length}; the appendix has the rest._\n`
      : '\n'
  return slice.map(render).join('\n') + extra
}

export function compileFullAnalysisMarkdown(
  job: JobRecord,
  options?: { inventoryLimit?: number; includeSource?: boolean }
): string {
  const result = job.result
  const ended = job.completedAt ?? job.updatedAt
  const totalMs = durationMs(job.createdAt, ended)
  const processes = job.processes ?? []
  const processRows =
    processes.length === 0
      ? '| — | — | — | — | — | — | — |\n'
      : processes
          .map((step) => {
            const ms = step.durationMs ?? durationMs(step.startedAt, step.endedAt) ?? ''
            return `| ${step.processId} | ${step.name.replaceAll('|', '/')} | ${step.startedAt} | ${step.endedAt ?? ''} | ${ms} | ${step.status} | ${(step.detail ?? '').replaceAll('|', '/')} |`
          })
          .join('\n') + '\n'

  const components = result?.components ?? []
  const endpoints = result?.endpoints ?? []
  const deps = result?.dependencies ?? []
  const files = result?.files ?? []
  const findings = result?.findings ?? []
  const meta = result?.metadata ?? {}

  const lines: string[] = [
    '---',
    `title: "Full analysis reconstruction brief"`,
    `process_id: "${job.id}"`,
    `target: "${yamlEscape(job.targetLabel)}"`,
    `target_type: "${job.targetType}"`,
    `status: "${job.status}"`,
    `started_at: "${job.createdAt}"`,
    `completed_at: "${ended}"`,
    `duration_ms: ${totalMs ?? 'null'}`,
    `engines: "${yamlEscape(job.engineIds.join(', '))}"`,
    `model: "${yamlEscape(meta.reportModel ?? 'deterministic')}"`,
    'generator: universal-application-analyzer',
    '---',
    '',
    `# Full analysis: ${job.targetLabel}`,
    '',
    'This is the process report. The rebuild pack is saved separately in `evidence/reconstruction.md` plus the REA JSON files in that folder. Do not invent files, APIs, or secrets.',
    '',
    '## Process timeline',
    '',
    '| process_id | step | started_at | ended_at | duration_ms | status | detail |',
    '|---|---|---|---|---:|---|---|',
    processRows,
    `Overall process \`${job.id}\` ran from ${job.createdAt} to ${ended}${totalMs !== undefined ? ` (${totalMs} ms)` : ''}.`,
    '',
    '## Identity',
    '',
    `- Label: ${job.targetLabel}`,
    `- Type: ${job.targetType}`,
    `- Input: ${job.input.inputKind}${job.input.path ? ` · \`${job.input.path}\`` : ''}${job.input.url ? ` · ${job.input.url}` : ''}`,
    `- Engines: ${job.engineIds.join(', ') || 'none'}`,
    ...Object.entries(meta)
      .filter(([key]) => !key.toLowerCase().includes('key') && !key.toLowerCase().includes('token'))
      .slice(0, 80)
      .map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Architecture notes (evidence only)',
    '',
    result
      ? [
          meta.format ? `- Format: ${meta.format}` : '',
          meta.architecture ? `- Architecture: ${meta.architecture}` : '',
          meta.managedStatus ? `- Managed/CLI status: ${meta.managedStatus}` : '',
          meta.procedureCount ? `- Procedure count: ${meta.procedureCount}` : '',
          meta.stringCount ? `- String count: ${meta.stringCount}` : '',
          meta.peImportDllCount ? `- PE import DLLs: ${meta.peImportDllCount}` : '',
          meta.peCertificateCount ? `- PE certificate entries: ${meta.peCertificateCount}` : '',
          `- Graph: ${result.graph.nodes.length} node(s), ${result.graph.edges.length} edge(s)`
        ]
          .filter(Boolean)
          .join('\n')
      : '_No analysis result._',
    '',
    '## Components',
    '',
    capped(
      components,
      options?.inventoryLimit,
      (item) =>
        `- **${item.kind}** \`${item.name}\`${item.path ? ` — ${item.path}` : ''}${item.detail ? ` — ${item.detail}` : ''}`
    ),
    '## Endpoints and routes',
    '',
    capped(
      endpoints,
      options?.inventoryLimit,
      (item) => `- ${item.method ?? ''} \`${item.url}\` (${item.source})`
    ),
    '## Dependencies, libraries, and imports',
    '',
    capped(
      deps,
      options?.inventoryLimit,
      (item) => `- \`${item.name}\`${item.version ? `@${item.version}` : ''} (${item.source})`
    ),
    '## Files, strings, and resources',
    '',
    capped(
      files,
      options?.inventoryLimit,
      (item) => `- \`${item.path}\` (${item.kind}${item.size ? `, ${item.size} bytes` : ''})`
    ),
    '## Graph',
    '',
    result && result.graph.nodes.length
      ? [
          '### Nodes',
          ...result.graph.nodes.slice(0, 400).map((node) => `- \`${node.id}\` ${node.label} (${node.kind})`),
          '',
          '### Edges',
          ...result.graph.edges.slice(0, 400).map((edge) => `- ${edge.from} -[${edge.kind}]-> ${edge.to}`)
        ].join('\n') + '\n'
      : '_No graph._\n',
    '## Findings',
    '',
    findings.length === 0
      ? '_No findings recorded._\n'
      : findings
          .map(
            (finding) =>
              `### ${finding.title}\n\n- Severity: ${finding.severity}\n- Category: ${finding.category}\n- Confidence: ${finding.confidence}\n- Affected: ${finding.affected}\n- Engine: ${finding.engineId}\n- ${finding.explanation}\n- Remediation: ${finding.remediation}\n`
          )
          .join('\n'),
    '## Limitations and skipped checks',
    '',
    ...(result?.limitations ?? []).map((item) => `- ${item}`),
    ...(result?.skipped ?? []).map((item) => `- **${item.check}**: ${item.reason}`),
    ...(job.warnings ?? []).map((item) => `- warning: ${item}`),
    ...(job.errors ?? []).map((item) => `- error: ${item}`),
    '',
    '## REA artifacts on disk',
    '',
    reaArtifactSummaries(result?.metadata.reaWorkspaceDir ?? job.reportPaths?.workspace),
    '## Observed source (bounded)',
    '',
    options?.includeSource === false
      ? '_Omitted from the model brief; see the appendix if source was collected._\n'
      : observedSource(job.input.path, job.input.inputKind),
    '## Rebuild guidance',
    '',
    'Use `evidence/reconstruction.md` and the copied REA JSON in `evidence/`. This process report is the timeline and inventory dump.',
    '',
    '## Job logs',
    '',
    ...(job.logs ?? []).map((entry) => `- \`${entry.at}\` ${entry.message}`),
    ''
  ]

  return redactSecrets(lines.filter((line) => line !== undefined).join('\n'))
}

export function compileReconstructionMarkdown(
  job: JobRecord,
  evidenceDir?: string
): string {
  const result = job.result
  const components = result?.components ?? []
  const endpoints = result?.endpoints ?? []
  const deps = result?.dependencies ?? []
  const files = result?.files ?? []
  const meta = result?.metadata ?? {}
  const lines: string[] = [
    '---',
    'title: "REA reconstruction pack"',
    `process_id: "${job.id}"`,
    `target: "${yamlEscape(job.targetLabel)}"`,
    `target_type: "${job.targetType}"`,
    `evidence_folder: "${yamlEscape(evidenceDir ?? '')}"`,
    '---',
    '',
    `# Reconstruction: ${job.targetLabel}`,
    '',
    'Give this file and every `rea-*.json` in this folder to Cursor or Claude Code to build a **similar** app from observed evidence.',
    '',
    'Rules: use listed modules, routes, imports, and files only. Anything missing is unknown. Do not invent APIs, files, or secrets. Do not execute the original binary.',
    '',
    '## Identity',
    '',
    `- Target: ${job.targetLabel}`,
    `- Type: ${job.targetType}`,
    `- Input: ${job.input.inputKind}${job.input.path ? ` · \`${job.input.path}\`` : ''}`,
    `- Engines: ${job.engineIds.join(', ') || 'none'}`,
    ...Object.entries(meta)
      .filter(
        ([key]) =>
          !key.toLowerCase().includes('key') &&
          !key.toLowerCase().includes('token') &&
          (key.startsWith('rea') ||
            key.startsWith('stats') ||
            ['format', 'architecture', 'managedStatus', 'procedureCount', 'stringCount'].includes(key))
      )
      .slice(0, 60)
      .map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Modules and components',
    '',
    capped(components, 2000, (item) =>
      `- **${item.kind}** \`${item.name}\`${item.path ? ` — ${item.path}` : ''}${item.detail ? ` — ${item.detail}` : ''}`
    ),
    '## Routes and endpoints',
    '',
    capped(endpoints, 2000, (item) => `- ${item.method ?? ''} \`${item.url}\` (${item.source})`),
    '## Imports and dependencies',
    '',
    capped(deps, 2000, (item) => `- \`${item.name}\`${item.version ? `@${item.version}` : ''} (${item.source})`),
    '## Files and resources',
    '',
    capped(
      files,
      2000,
      (item) => `- \`${item.path}\` (${item.kind}${item.size ? `, ${item.size} bytes` : ''})`
    ),
    '## Graph',
    '',
    result && result.graph.nodes.length
      ? [
          '### Nodes',
          ...result.graph.nodes.slice(0, 2000).map((node) => `- \`${node.id}\` ${node.label} (${node.kind})`),
          '',
          '### Edges',
          ...result.graph.edges.slice(0, 2000).map((edge) => `- ${edge.from} -[${edge.kind}]-> ${edge.to}`)
        ].join('\n') + '\n'
      : '_No graph._\n',
    '## Unknowns and skipped REA checks',
    '',
    ...(result?.limitations ?? []).map((item) => `- ${item}`),
    ...(result?.skipped ?? []).map((item) => `- **${item.check}**: ${item.reason}`),
    '',
    '## REA Evidence JSON in this folder',
    '',
    reaArtifactSummaries(evidenceDir ?? result?.metadata.reaWorkspaceDir),
    '## Observed source (bounded)',
    '',
    observedSource(job.input.path, job.input.inputKind)
  ]
  return redactSecrets(lines.filter((line) => line !== undefined).join('\n'))
}

export function mergeStructuredMarkdown(deterministic: string, structured: string): string {
  const body = structured.trim()
  if (!body) {
    return deterministic
  }
  return `${body}\n\n---\n\n# Appendix: complete evidence dump\n\nThe appendix is the full local analysis with process IDs and timings. Prefer facts here if the reconstruction brief omitted an item.\n\n${deterministic}\n`
}
