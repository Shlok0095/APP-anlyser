import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { sha256 } from '../base/extract'
import { listZip } from '../base/zip'

export const archiveEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'archive',
    displayName: 'Archive inspection',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['archive'],
    supportedInputKinds: ['file'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: ['zip listing', 'path-traversal rejection']
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path || !existsSync(input.path)) {
      errors.push('Select a ZIP or similar archive.')
    } else if (!/\.(zip|whl|nupkg|apk|aab|jar)$/i.test(input.path)) {
      errors.push(
        'This engine lists ZIP-compatible archives. TAR/GZIP listing requires additional platform tools.'
      )
    }
    return { ok: errors.length === 0, errors, warnings: [] }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    if (!input.path) {
      throw new Error('Missing path.')
    }
    const buf = readFileSync(input.path)
    result.metadata.fileName = basename(input.path)
    result.metadata.sha256 = sha256(buf)
    ctx.emitLog('Listing archive entries with path traversal guards.')
    const entries = await listZip(buf)
    for (const entry of entries) {
      if (entry.name.includes('..') || entry.name.startsWith('/')) {
        result.findings.push({
          id: makeId('find'),
          title: 'Archive path traversal entry',
          severity: 'high',
          category: 'archive',
          evidence: [
            { id: makeId('ev'), kind: 'file', snippet: entry.name, note: 'unsafe zip path' }
          ],
          affected: entry.name,
          explanation:
            'An archive member uses a parent or absolute path. Extraction would be refused.',
          confidence: 'high',
          remediation: 'Reject the archive or rebuild it without .. paths.',
          engineId: 'archive',
          falsePositiveNotes:
            'Some legacy tools encoded odd paths that are still unsafe to extract.'
        })
      }
      result.files.push({ path: entry.name, size: entry.size, kind: 'zip-entry' })
    }
    if (entries.some((e) => e.name.endsWith('AndroidManifest.xml'))) {
      result.metadata.looksLike = 'android-package'
    }
    if (entries.some((e) => e.name.endsWith('package.json'))) {
      result.metadata.looksLike = 'source-zip'
    }
    result.components.push({
      id: makeId('cmp'),
      kind: 'file',
      name: result.metadata.fileName,
      detail: `${entries.length} entries`
    })
    return result
  }
}
