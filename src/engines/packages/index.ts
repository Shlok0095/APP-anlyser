import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { listZip, readZipText } from '../base/zip'

function parseRequirements(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export const packageEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'software-package',
    displayName: 'Python and software package analysis',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['package'],
    supportedInputKinds: ['file', 'folder'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: ['requirements', 'pyproject', 'wheel metadata', 'package.json']
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path || !existsSync(input.path)) {
      errors.push('Select a package manifest, wheel, or folder.')
    }
    return { ok: errors.length === 0, errors, warnings: [] }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    if (!input.path) {
      throw new Error('Missing path.')
    }
    const stat = statSync(input.path)
    const target = stat.isDirectory() ? input.path : input.path
    ctx.emitLog(`Inspecting package artifact ${basename(target)}`)
    if (stat.isDirectory()) {
      const req = join(target, 'requirements.txt')
      const pkg = join(target, 'package.json')
      const py = join(target, 'pyproject.toml')
      if (existsSync(req)) {
        for (const line of parseRequirements(readFileSync(req, 'utf8'))) {
          result.dependencies.push({
            name: line.split(/[=<>~[]/)[0] ?? line,
            version: line,
            source: 'requirements.txt'
          })
        }
      }
      if (existsSync(pkg)) {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as {
          name?: string
          version?: string
          dependencies?: Record<string, string>
        }
        result.metadata.name = json.name ?? ''
        result.metadata.version = json.version ?? ''
        for (const [name, version] of Object.entries(json.dependencies ?? {})) {
          result.dependencies.push({ name, version, source: 'package.json' })
        }
      }
      if (existsSync(py)) {
        result.metadata.pyproject = 'present'
      }
    } else if (target.toLowerCase().endsWith('.whl') || target.toLowerCase().endsWith('.zip')) {
      const buf = readFileSync(target)
      const entries = await listZip(buf)
      for (const entry of entries) {
        result.files.push({ path: entry.name, size: entry.size, kind: 'wheel' })
        if (entry.name.endsWith('METADATA')) {
          const text = await readZipText(buf, entry.name)
          if (text) {
            const name = text.match(/^Name:\s*(.+)$/m)
            const version = text.match(/^Version:\s*(.+)$/m)
            if (name) {
              result.metadata.name = name[1].trim()
            }
            if (version) {
              result.metadata.version = version[1].trim()
            }
            for (const line of text.split(/\r?\n/)) {
              if (line.startsWith('Requires-Dist:')) {
                result.dependencies.push({
                  name: line.replace('Requires-Dist:', '').trim(),
                  source: 'wheel METADATA'
                })
              }
            }
          }
        }
      }
    } else if (basename(target) === 'requirements.txt' || basename(target) === 'package.json') {
      const text = readFileSync(target, 'utf8')
      if (target.endsWith('.json')) {
        const json = JSON.parse(text) as { dependencies?: Record<string, string>; name?: string }
        result.metadata.name = json.name ?? ''
        for (const [name, version] of Object.entries(json.dependencies ?? {})) {
          result.dependencies.push({ name, version, source: 'package.json' })
        }
      } else {
        for (const line of parseRequirements(text)) {
          result.dependencies.push({ name: line, source: 'requirements.txt' })
        }
      }
    }
    result.components.push({
      id: makeId('cmp'),
      kind: 'module',
      name: result.metadata.name || basename(target)
    })
    result.limitations.push('Packages are not installed or executed.')
    return result
  }
}
