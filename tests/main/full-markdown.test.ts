import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '../../src/shared/types/engine'
import { emptyAnalysisResult } from '../../src/shared/types/analysis'
import type { JobRecord } from '../../src/shared/types/jobs'
import { compileFullAnalysisMarkdown } from '../../src/main/reports/full-markdown'
import { generateReports } from '../../src/main/reports/generate'

function job(): JobRecord {
  const result = emptyAnalysisResult()
  result.metadata.format = 'pe'
  result.components.push({ id: 'c1', kind: 'library', name: 'KERNEL32.dll', detail: 'import' })
  result.endpoints.push({
    id: 'e1',
    url: '/health',
    source: 'source',
    evidence: []
  })
  return {
    id: 'job-process-1',
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:01:00.000Z',
    completedAt: '2026-10-30T10:01:00.000Z',
    status: 'completed',
    targetType: 'windows',
    targetLabel: 'DemoApp.exe',
    input: {
      targetType: 'windows',
      inputKind: 'file',
      label: 'DemoApp.exe',
      path: 'C:\\DemoApp.exe',
      profile: DEFAULT_PROFILE
    },
    profile: DEFAULT_PROFILE,
    engineIds: ['rea-cli'],
    engineVersions: { 'rea-cli': '6.8.0' },
    logs: [{ at: '2026-10-30T10:00:01.000Z', message: 'Queued 1 engine(s).' }],
    processes: [
      {
        processId: 'P01',
        name: 'engine rea-cli',
        startedAt: '2026-10-30T10:00:02.000Z',
        endedAt: '2026-10-30T10:00:50.000Z',
        durationMs: 48000,
        status: 'ok'
      },
      {
        processId: 'P02',
        name: 'rea analyze',
        startedAt: '2026-10-30T10:00:03.000Z',
        endedAt: '2026-10-30T10:00:40.000Z',
        durationMs: 37000,
        status: 'ok',
        detail: 'exit 0'
      }
    ],
    warnings: [],
    errors: [],
    result
  }
}

describe('full Markdown report', () => {
  it('includes process ids, timings, and inventories in one file', () => {
    const markdown = compileFullAnalysisMarkdown(job())
    expect(markdown).toContain('process_id: "job-process-1"')
    expect(markdown).toContain('| P01 | engine rea-cli |')
    expect(markdown).toContain('| P02 | rea analyze |')
    expect(markdown).toContain('48000')
    expect(markdown).toContain('KERNEL32.dll')
    expect(markdown).toContain('/health')
    expect(markdown).toContain('evidence/reconstruction.md')
  })

  it('writes the markdown path from generateReports', () => {
    const dir = join(tmpdir(), `uaa-md-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const paths = generateReports(job(), dir)
    expect(paths.markdown).toMatch(/job-process-1-full-analysis\.md$/)
    expect(paths.reconstruction).toMatch(/evidence[/\\]reconstruction\.md$/)
    expect(readFileSync(paths.markdown, 'utf8')).toContain('P01')
    expect(readFileSync(paths.reconstruction, 'utf8')).toContain('REA reconstruction pack')
  })
})
