import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JobRecord } from '../../shared/types/jobs'
import { writeEvidencePack } from './evidence-pack'
import { compileFullAnalysisMarkdown } from './full-markdown'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function generateReports(
  job: JobRecord,
  dir: string
): {
  json: string
  html: string
  csv: string
  markdown: string
  evidence?: string
  workspace?: string
  reconstruction?: string
  evidenceFolder?: string
} {
  mkdirSync(dir, { recursive: true })
  const jsonPath = join(dir, `${job.id}.json`)
  const htmlPath = join(dir, `${job.id}.html`)
  const csvPath = join(dir, `${job.id}-findings.csv`)
  const markdownPath = join(dir, `${job.id}-full-analysis.md`)
  const result = job.result
  writeFileSync(jsonPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8')
  const findings = result?.findings ?? []
  const csv = [
    'title,severity,category,affected,engine,confidence',
    ...findings.map((finding) =>
      [
        finding.title,
        finding.severity,
        finding.category,
        finding.affected,
        finding.engineId,
        finding.confidence
      ]
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(',')
    )
  ].join('\n')
  writeFileSync(csvPath, csv, 'utf8')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>UAA Report ${escapeHtml(job.targetLabel)}</title>
<style>body{font-family:Segoe UI,sans-serif;background:#070b16;color:#f4f7ff;padding:24px}code{color:#9aa6c3}a{color:#8b9cff}</style>
</head><body>
<h1>Universal Application Analyzer report</h1>
<p>Target: ${escapeHtml(job.targetLabel)} (${escapeHtml(job.targetType)})</p>
<p>Status: ${escapeHtml(job.status)} | Created: ${escapeHtml(job.createdAt)}</p>
<p>Engines: ${escapeHtml(job.engineIds.join(', ') || 'none')}</p>
<h2>REA workspace</h2>
<p>Evidence JSON: <code>${escapeHtml(result?.metadata.reaEvidencePath ?? result?.metadata.reaJsonPath ?? 'not produced')}</code></p>
<p>Workspace folder: <code>${escapeHtml(result?.metadata.reaWorkspaceDir ?? dir)}</code></p>
<p>Full Markdown: <code>${escapeHtml(join(dir, `${job.id}-full-analysis.md`))}</code></p>
<p>This is the saved REA Evidence record plus projected summary/module views. It is not a security certification. Prefer the Markdown file for reconstruction.</p>
<h2>Inventory</h2>
<ul>
<li>Components: ${result?.components.length ?? 0}</li>
<li>Endpoints: ${result?.endpoints.length ?? 0}</li>
<li>Dependencies: ${result?.dependencies.length ?? 0}</li>
<li>Files: ${result?.files.length ?? 0}</li>
<li>Graph nodes: ${result?.graph.nodes.length ?? 0}</li>
</ul>
<h2>Components</h2>
<ul>${(result?.components ?? [])
    .slice(0, 80)
    .map(
      (item) =>
        `<li>${escapeHtml(item.name)} <code>${escapeHtml(item.kind)}</code>${item.path ? ` — ${escapeHtml(item.path)}` : ''}</li>`
    )
    .join('')}</ul>
<h2>Endpoints</h2>
<ul>${(result?.endpoints ?? [])
    .slice(0, 80)
    .map((item) => `<li><code>${escapeHtml(item.url)}</code></li>`)
    .join('')}</ul>
<h2>Metadata</h2>
<pre>${escapeHtml(JSON.stringify(result?.metadata ?? {}, null, 2))}</pre>
<h2>Findings (${findings.length})</h2>
<ul>${findings
    .map(
      (finding) =>
        `<li><strong>${escapeHtml(finding.title)}</strong> [${escapeHtml(finding.severity)}] ${escapeHtml(finding.explanation)}</li>`
    )
    .join('')}</ul>
<h2>Limitations</h2>
<ul>${(result?.limitations ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
<p>No secrets, tokens, or cookies are intentionally included.</p>
</body></html>`
  writeFileSync(htmlPath, html, 'utf8')
  writeFileSync(markdownPath, compileFullAnalysisMarkdown(job), 'utf8')
  const pack = writeEvidencePack(job, dir)
  return {
    json: jsonPath,
    html: htmlPath,
    csv: csvPath,
    markdown: markdownPath,
    evidence: pack.evidence ?? result?.metadata.reaEvidencePath,
    workspace: result?.metadata.reaWorkspaceDir,
    reconstruction: pack.reconstruction,
    evidenceFolder: pack.evidenceFolder
  }
}
