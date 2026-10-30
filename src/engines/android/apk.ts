import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { emptyAnalysisResult, type AnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { extractPrintableStrings, extractUrls, sha256 } from '../base/extract'
import { findOnPath } from '../base/spawn'
import { listZip, readZipBuffer } from '../base/zip'

function collectManifestHints(strings: string[], result: AnalysisResult): void {
  const permissions = strings.filter(
    (s) =>
      s.startsWith('android.permission.') || (s.startsWith('com.') && s.includes('.permission.'))
  )
  const uniquePerms = [...new Set(permissions)].slice(0, 100)
  for (const perm of uniquePerms) {
    result.components.push({
      id: makeId('cmp'),
      kind: 'permission',
      name: perm,
      detail: 'String recovered from APK/AAB bytes'
    })
  }
  const activities = strings.filter((s) => s.includes('Activity') && !s.includes(' ')).slice(0, 50)
  for (const name of activities) {
    result.components.push({ id: makeId('cmp'), kind: 'activity', name })
  }
  const pkg = strings.find(
    (s) => /^[a-z][a-z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(s) && s.split('.').length >= 2
  )
  if (pkg) {
    result.metadata.packageNameGuess = pkg
  }
}

export const apkEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'android-apk',
    displayName: 'APK and AAB inspection',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['android'],
    supportedInputKinds: ['file'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: [
      'zip inventory',
      'string recovery',
      'permission strings',
      'optional apktool/jadx'
    ]
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path) {
      errors.push('An APK or AAB file is required.')
    } else if (!existsSync(input.path)) {
      errors.push(`File does not exist: ${input.path}`)
    } else if (!/\.(apk|aab|xapk|apks)$/i.test(input.path)) {
      errors.push('Expected an .apk, .aab, .xapk, or .apks file.')
    }
    return { ok: errors.length === 0, errors, warnings: [] }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    if (!input.path) {
      throw new Error('Missing APK path.')
    }
    const buf = readFileSync(input.path)
    result.metadata.fileName = basename(input.path)
    result.metadata.size = String(buf.length)
    result.metadata.sha256 = sha256(buf)
    result.metadata.format = input.path.toLowerCase().endsWith('.aab') ? 'aab' : 'apk'
    ctx.emitLog(`Read ${result.metadata.format} (${buf.length} bytes).`)

    try {
      const entries = await listZip(buf)
      result.metadata.entryCount = String(entries.length)
      for (const entry of entries.slice(0, 2000)) {
        result.files.push({
          path: entry.name,
          size: entry.size,
          kind: entry.dir ? 'dir' : 'zip-entry'
        })
        if (entry.name.startsWith('lib/') && entry.name.endsWith('.so')) {
          result.components.push({
            id: makeId('cmp'),
            kind: 'library',
            name: entry.name,
            path: entry.name
          })
        }
        if (entry.name.startsWith('assets/')) {
          result.components.push({
            id: makeId('cmp'),
            kind: 'resource',
            name: entry.name,
            path: entry.name
          })
        }
        if (/classes\d*\.dex$/.test(entry.name)) {
          result.metadata.hasDex = 'true'
          result.components.push({
            id: makeId('cmp'),
            kind: 'file',
            name: entry.name,
            path: entry.name
          })
        }
        if (entry.name === 'AndroidManifest.xml') {
          result.metadata.hasManifest = 'true'
        }
        if (entry.name.startsWith('META-INF/') && /(\.RSA|\.DSA|\.EC|\.SF)$/.test(entry.name)) {
          result.metadata.hasSigning = 'true'
          result.components.push({
            id: makeId('cmp'),
            kind: 'file',
            name: entry.name,
            detail: 'signing artifact'
          })
        }
      }
      const manifest = await readZipBuffer(buf, 'AndroidManifest.xml')
      if (manifest) {
        const strings = extractPrintableStrings(manifest, 4)
        collectManifestHints(strings, result)
        result.limitations.push(
          'AndroidManifest.xml is binary XML. Values listed here are recovered strings, not a full decoded manifest.'
        )
      }
    } catch (error) {
      result.limitations.push(
        `ZIP parse failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const strings = extractPrintableStrings(buf, 8)
    if (input.profile.api) {
      for (const url of extractUrls(strings.join('\n'))) {
        result.endpoints.push({
          id: makeId('ep'),
          url,
          source: 'package',
          evidence: [
            { id: makeId('ev'), kind: 'binary', snippet: url, note: 'URL string inside package' }
          ]
        })
      }
    }

    const apktool = findOnPath('apktool')
    const jadx = findOnPath('jadx')
    const aapt = findOnPath('aapt') ?? findOnPath('aapt2')
    if (!apktool) {
      result.skipped.push({ check: 'apktool decode', reason: 'apktool is not on PATH.' })
    } else {
      ctx.emitLog('Running apktool decode.')
      const decoded = await ctx.runCommand(
        apktool,
        ['d', '-f', '-o', `${ctx.artifactDir}/apktool`, input.path],
        {
          timeoutMs: 60_000
        }
      )
      result.logs.push(decoded.stdout.slice(0, 4000))
      if (decoded.code !== 0) {
        result.skipped.push({
          check: 'apktool decode',
          reason: decoded.stderr.slice(0, 500) || 'apktool returned non-zero.'
        })
      } else {
        result.metadata.apktool = 'decoded'
      }
    }
    if (!jadx) {
      result.skipped.push({
        check: 'jadx decompile',
        reason: 'jadx is not on PATH. Decompiled output is not claimed to equal original source.'
      })
    }
    if (!aapt) {
      result.skipped.push({ check: 'aapt dump', reason: 'aapt/aapt2 is not on PATH.' })
    } else {
      const dumped = await ctx.runCommand(aapt, ['dump', 'badging', input.path], {
        timeoutMs: 20_000
      })
      if (dumped.code === 0) {
        result.logs.push(dumped.stdout.slice(0, 4000))
        const name = dumped.stdout.match(/package: name='([^']+)'/)
        const version = dumped.stdout.match(/versionName='([^']+)'/)
        if (name) {
          result.metadata.packageName = name[1]
        }
        if (version) {
          result.metadata.versionName = version[1]
        }
      }
    }

    if (
      input.profile.security &&
      result.components.some((c) => c.name.includes('WRITE_EXTERNAL_STORAGE'))
    ) {
      result.findings.push({
        id: makeId('find'),
        title: 'Broad storage permission declared',
        severity: 'low',
        category: 'android-manifest',
        evidence: [
          {
            id: makeId('ev'),
            kind: 'manifest',
            snippet: 'WRITE_EXTERNAL_STORAGE',
            note: 'Recovered permission string'
          }
        ],
        affected: result.metadata.packageName ?? input.path,
        explanation:
          'The package appears to declare WRITE_EXTERNAL_STORAGE. Confirm whether it is required.',
        confidence: 'low',
        remediation: 'Use the scoped storage APIs and drop unused permissions.',
        engineId: 'android-apk',
        falsePositiveNotes: 'String recovery from binary XML can mis-attribute permissions.'
      })
    }
    result.limitations.push('This engine never installs or executes the APK.')
    return result
  }
}
