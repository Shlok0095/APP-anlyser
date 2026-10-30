import { writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  emptyAnalysisResult,
  mergeAnalysisResults,
  type AnalysisResult
} from '../../shared/types/analysis'
import type { EngineContext } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { runReaCommand } from './cli'
import { isJavaScriptEvidence } from './followup'
import { mapReaDocument } from './map'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function buildAnalysisViewRequest(
  evidencePath: string,
  view: Record<string, unknown>
): { source: { kind: 'evidence-file'; path: string }; view: Record<string, unknown> } {
  const path = isAbsolute(evidencePath) ? evidencePath : resolve(evidencePath)
  return { source: { kind: 'evidence-file', path }, view }
}

function writeViewRequest(dir: string, name: string, evidencePath: string, view: Record<string, unknown>): string {
  const path = join(dir, `rea-view-${name}-request.json`)
  writeFileSync(path, `${JSON.stringify(buildAnalysisViewRequest(evidencePath, view), null, 2)}\n`, 'utf8')
  return path
}

function flattenStats(
  prefix: string,
  value: unknown,
  into: Record<string, string>,
  depth = 0
): void {
  if (depth > 3) {
    return
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    into[prefix] = String(value)
    return
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'ipc' || key === 'families') {
        continue
      }
      flattenStats(`${prefix}.${key}`, nested, into, depth + 1)
    }
  }
}

function viewRows(document: unknown): unknown[] {
  const normalized =
    isRecord(document) && isRecord(document.normalized_result) ? document.normalized_result : null
  if (!normalized) {
    return []
  }
  if (Array.isArray(normalized.items)) {
    return normalized.items
  }
  if (Array.isArray(normalized.rows)) {
    return normalized.rows
  }
  if (Array.isArray(normalized.routes)) {
    return normalized.routes
  }
  return []
}

function mapSummaryView(document: unknown): AnalysisResult {
  const result = emptyAnalysisResult()
  const mapped = mapReaDocument(document, 'inspect-analysis-view:summary', 'rea-cli')
  Object.assign(result, mapped)
  const normalized =
    isRecord(document) && isRecord(document.normalized_result) ? document.normalized_result : null
  const summary = normalized && isRecord(normalized.summary) ? normalized.summary : null
  if (summary) {
    flattenStats('rea.summary', summary, result.metadata)
    if (isRecord(summary.statistics)) {
      flattenStats('stats', summary.statistics, result.metadata)
    }
  }
  if (normalized && Array.isArray(normalized.unknowns)) {
    for (const unknown of normalized.unknowns) {
      if (typeof unknown === 'string') {
        result.limitations.push(unknown)
      }
    }
  }
  return result
}

function mapModulesPage(document: unknown): AnalysisResult {
  const result = emptyAnalysisResult()
  for (const item of viewRows(document)) {
    if (!isRecord(item)) {
      continue
    }
    const identity = isRecord(item.identity) ? item.identity : null
    const path =
      asString(item.path) ??
      (identity ? asString(identity.path) ?? asString(identity.name) : undefined)
    const kind = asString(item.kind) ?? 'module'
    result.components.push({
      id: asString(item.node_id) ?? makeId('cmp'),
      kind: kind.includes('asset') ? 'file' : 'module',
      name: path ?? kind,
      path,
      detail: kind
    })
    if (path) {
      result.files.push({ path, size: 0, kind })
    }
  }
  result.metadata.reaModuleCount = String(result.components.length)
  return result
}

function mapFactsPage(document: unknown): AnalysisResult {
  const result = emptyAnalysisResult()
  for (const item of viewRows(document)) {
    if (!isRecord(item)) {
      continue
    }
    const identity = isRecord(item.identity) ? item.identity : null
    const name =
      asString(item.path) ??
      (identity ? asString(identity.path) ?? asString(identity.name) : undefined) ??
      asString(item.node_id) ??
      'observation'
    result.components.push({
      id: asString(item.observation_id) ?? asString(item.node_id) ?? makeId('fact'),
      kind: 'module',
      name,
      detail: asString(item.kind) ?? 'javascript-fact'
    })
  }
  result.metadata.reaFactCount = String(result.components.length)
  return result
}

function mapRoutesPage(document: unknown): AnalysisResult {
  const result = emptyAnalysisResult()
  for (const item of viewRows(document)) {
    if (!isRecord(item)) {
      continue
    }
    const url =
      asString(item.path) ?? asString(item.pattern) ?? asString(item.url) ?? asString(item.route)
    if (!url) {
      continue
    }
    result.endpoints.push({
      id: asString(item.id) ?? makeId('ep'),
      url,
      method: asString(item.method),
      source: 'source',
      evidence: [
        {
          id: makeId('ev'),
          kind: 'file',
          note: asString(item.classification) ?? 'REA javascript-routes view'
        }
      ]
    })
    result.components.push({
      id: asString(item.id) ?? makeId('route'),
      kind: 'route',
      name: url,
      detail: asString(item.classification) ?? asString(item.mechanism)
    })
  }
  result.metadata.reaRouteCount = String(result.endpoints.length)
  return result
}

export async function projectReaWorkspace(
  ctx: EngineContext,
  evidence: unknown,
  evidencePath: string
): Promise<AnalysisResult> {
  const result = emptyAnalysisResult()
  result.metadata.reaEvidencePath = evidencePath
  result.metadata.reaWorkspaceDir = ctx.artifactDir
  writeFileSync(
    join(ctx.artifactDir, 'REA-WORKSPACE.txt'),
    [
      'Universal Application Analyzer — REA workspace',
      `Evidence: ${evidencePath}`,
      'This folder holds the complete REA Evidence JSON and projected views.',
      'Views are requested with source.kind=evidence-file so the capture is not inlined.',
      'Do not treat this as a security certification.'
    ].join('\n'),
    'utf8'
  )

  if (!isRecord(evidence) || typeof evidence.evidence_id !== 'string') {
    result.logs.push('REA Evidence was saved. View projection needs a complete Evidence envelope.')
    return result
  }

  if (!isJavaScriptEvidence(evidence)) {
    const operation = typeof evidence.operation === 'string' ? evidence.operation : 'REA'
    result.logs.push(
      `Saved ${operation} Evidence. Summary/module views apply to JavaScript application Evidence, not this operation.`
    )
    return result
  }

  const parts: AnalysisResult[] = [result]
  const pushView = async (
    name: string,
    view: Record<string, unknown>,
    map: (doc: unknown) => AnalysisResult
  ): Promise<unknown> => {
    if (ctx.isCancelled()) {
      throw new Error('Cancelled')
    }
    const requestPath = writeViewRequest(ctx.artifactDir, name, evidencePath, view)
    ctx.emitProgress(`REA view: ${name}`, 92)
    const ran = await runReaCommand(ctx, 'inspect-analysis-view', [requestPath], {
      timeoutMs: 120_000,
      outputName: `view-${name}`
    })
    if (!ran.document || (isRecord(ran.document) && ran.document.error)) {
      const reason =
        isRecord(ran.document) && isRecord(ran.document.error)
          ? String(ran.document.message ?? ran.document.error)
          : ran.result.stderr.slice(0, 300)
      result.skipped.push({
        check: `rea-view:${name}`,
        reason: reason || `View ${name} produced no JSON.`
      })
      return null
    }
    const mapped = map(ran.document)
    mapped.metadata[`reaView.${name}`] = ran.jsonPath
    parts.push(mapped)
    ctx.emitLog(`Saved REA ${name} view.`)
    return ran.document
  }

  const pageUntilExhausted = async (
    prefix: string,
    viewFor: (offset: number) => Record<string, unknown>,
    map: (doc: unknown) => AnalysisResult
  ): Promise<void> => {
    const maxPages = 8
    let offset = 0
    for (let page = 0; page < maxPages; page += 1) {
      const document = await pushView(`${prefix}-${offset}`, viewFor(offset), map)
      if (!document || !isRecord(document) || !isRecord(document.normalized_result)) {
        break
      }
      const coverage = isRecord(document.normalized_result.coverage)
        ? document.normalized_result.coverage
        : {}
      const next = typeof coverage.next_offset === 'number' ? coverage.next_offset : null
      if (next === null || next === offset) {
        break
      }
      offset = next
    }
  }

  await pushView('summary', { kind: 'summary' }, mapSummaryView)
  await pageUntilExhausted(
    'facts',
    (offset) => ({
      kind: 'javascript-facts',
      property_keys: [],
      include_available_property_keys: true,
      offset,
      limit: 64
    }),
    mapFactsPage
  )
  await pageUntilExhausted(
    'modules',
    (offset) => ({
      kind: 'javascript',
      collection: 'modules',
      projection: 'references',
      offset,
      limit: 64
    }),
    mapModulesPage
  )
  await pageUntilExhausted(
    'routes',
    (offset) => ({
      kind: 'javascript-routes',
      collection: 'routes',
      offset,
      limit: 64
    }),
    mapRoutesPage
  )
  return mergeAnalysisResults(parts)
}
