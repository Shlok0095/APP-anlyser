import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { extractPrintableStrings, sha256 } from '../base/extract'
import { findOnPath } from '../base/spawn'
import { listZip } from '../base/zip'

export const unixPackageEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'unix-package',
    displayName: 'macOS and Linux package inspection',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['macos', 'linux'],
    supportedInputKinds: ['file'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: ['archive listing where possible', 'platform tool dump']
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path || !existsSync(input.path)) {
      errors.push('Select a DMG, PKG, AppImage, DEB, or RPM file.')
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
    result.metadata.size = String(statSync(input.path).size)
    result.metadata.sha256 = sha256(buf)
    const lower = input.path.toLowerCase()
    if (lower.endsWith('.zip') || lower.endsWith('.nupkg')) {
      const entries = await listZip(buf)
      for (const entry of entries.slice(0, 500)) {
        result.files.push({ path: entry.name, size: entry.size, kind: 'zip-entry' })
      }
    } else {
      const strings = extractPrintableStrings(buf, 8).slice(0, 80)
      result.logs.push(...strings)
    }
    const platformTools: Array<[string, string, TargetHint]> = [
      ['dpkg-deb', '--info', 'linux'],
      ['rpm', '-qip', 'linux'],
      ['file', '-b', 'any']
    ]
    for (const [tool] of platformTools) {
      const resolved = findOnPath(tool)
      if (!resolved) {
        result.skipped.push({
          check: tool,
          reason: `${tool} is unavailable on ${process.platform}.`
        })
      } else if (tool === 'file') {
        const dumped = await ctx.runCommand(resolved, ['-b', input.path])
        result.metadata.fileType = dumped.stdout.trim()
      }
    }
    result.components.push({ id: makeId('cmp'), kind: 'file', name: result.metadata.fileName })
    result.limitations.push(
      'Packages are not installed. Platform-specific unpackers are used only when present.'
    )
    return result
  }
}

type TargetHint = 'linux' | 'macos' | 'any'
