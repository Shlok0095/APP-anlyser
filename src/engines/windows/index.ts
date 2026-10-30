import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { extractPrintableStrings, extractUrls, sha256 } from '../base/extract'

function parsePe(buf: Buffer) {
  const info: Record<string, string> = {}
  if (buf.length < 64 || buf.toString('ascii', 0, 2) !== 'MZ') {
    info.pe = 'not-mz'
    return info
  }
  const peOffset = buf.readUInt32LE(0x3c)
  if (peOffset + 6 > buf.length || buf.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    info.pe = 'mz-only'
    return info
  }
  const machine = buf.readUInt16LE(peOffset + 4)
  info.pe = 'valid'
  info.machine =
    machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : `0x${machine.toString(16)}`
  return info
}

export const windowsEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'windows-package',
    displayName: 'Windows package inspection',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['windows', 'tool'],
    supportedInputKinds: ['file', 'folder'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: ['PE header parse', 'string recovery', 'Electron asar detection']
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path || !existsSync(input.path)) {
      errors.push('Select an EXE, MSI, or application directory.')
    }
    return { ok: errors.length === 0, errors, warnings: ['The file is not executed.'] }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    if (!input.path) {
      throw new Error('Missing path.')
    }
    const stat = statSync(input.path)
    result.metadata.fileName = basename(input.path)
    if (stat.isDirectory()) {
      result.metadata.kind = 'directory'
      const asar = `${input.path.replace(/\\/g, '/')}/resources/app.asar`
      const pkg = `${input.path.replace(/\\/g, '/')}/resources/app/package.json`
      if (existsSync(asar) || existsSync(pkg)) {
        result.metadata.electron = 'true'
        result.components.push({
          id: makeId('cmp'),
          kind: 'module',
          name: 'Electron application layout'
        })
      }
      result.limitations.push('Directory inspection does not run the app.')
      return result
    }
    const buf = readFileSync(input.path)
    result.metadata.size = String(buf.length)
    result.metadata.sha256 = sha256(buf)
    Object.assign(result.metadata, parsePe(buf))
    ctx.emitLog(`Parsed file header for ${result.metadata.fileName}`)
    const strings = extractPrintableStrings(buf, 8)
    for (const url of extractUrls(strings.join('\n'))) {
      result.endpoints.push({
        id: makeId('ep'),
        url,
        source: 'package',
        evidence: [{ id: makeId('ev'), kind: 'binary', snippet: url, note: 'PE/string table' }]
      })
    }
    if (input.path.toLowerCase().endsWith('.msi')) {
      result.metadata.kind = 'msi'
      result.limitations.push(
        'MSI tables are not fully decoded without msiextract. The installer is not executed.'
      )
    }
    if (strings.some((s) => s.includes('ELECTRON_RUN_AS_NODE') || s.includes('app.asar'))) {
      result.metadata.electron = 'true'
      result.components.push({
        id: makeId('cmp'),
        kind: 'module',
        name: 'Electron runtime strings'
      })
    }
    result.components.push({
      id: makeId('cmp'),
      kind: 'file',
      name: result.metadata.fileName,
      detail: result.metadata.pe ?? 'blob'
    })
    return result
  }
}
