import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { findOnPath } from '../base/spawn'

export const androidRuntimeEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'android-runtime',
    displayName: 'Android live analysis',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['android'],
    supportedInputKinds: ['device-package'],
    requiredUtilities: ['adb'],
    requiredPermissions: ['adb'],
    needsNetwork: false,
    involvesRuntime: true,
    capabilities: ['uiautomator dump', 'screenshot', 'logcat snapshot']
  },
  validate(input) {
    const errors: string[] = []
    if (!input.profile.runtime) {
      errors.push('Runtime analysis is disabled in the selected profile.')
    }
    if (!findOnPath('adb')) {
      errors.push('adb was not found on PATH.')
    }
    if (!input.deviceId) {
      errors.push('A device or emulator id is required.')
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings: ['Live analysis never bypasses DRM, auth, or certificate pinning.']
    }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    const adb = findOnPath('adb')
    if (!adb || !input.deviceId) {
      throw new Error('Missing adb or device.')
    }
    ctx.emitLog('Capturing UI hierarchy via uiautomator dump.')
    await ctx.runCommand(adb, [
      '-s',
      input.deviceId,
      'shell',
      'uiautomator',
      'dump',
      '/sdcard/uaa-window.xml'
    ])
    const localXml = join(ctx.artifactDir, 'window.xml')
    const pulled = await ctx.runCommand(adb, [
      '-s',
      input.deviceId,
      'pull',
      '/sdcard/uaa-window.xml',
      localXml
    ])
    if (pulled.code === 0) {
      result.files.push({ path: 'window.xml', size: 0, kind: 'ui-hierarchy' })
      result.components.push({
        id: makeId('cmp'),
        kind: 'page',
        name: 'UI hierarchy dump',
        path: localXml
      })
    } else {
      result.skipped.push({
        check: 'uiautomator dump',
        reason: pulled.stderr.slice(0, 400) || 'Dump failed.'
      })
    }
    ctx.emitLog('Capturing screenshot.')
    const png = join(ctx.artifactDir, 'screen.png')
    const shot = await ctx.runCommand(adb, ['-s', input.deviceId, 'exec-out', 'screencap', '-p'], {
      timeoutMs: 15_000
    })
    if (shot.code === 0 && shot.stdout.length > 100) {
      writeFileSync(png, Buffer.from(shot.stdout, 'binary'))
      result.screenshotPaths.push(png)
    } else {
      const alt = await ctx.runCommand(adb, [
        '-s',
        input.deviceId,
        'shell',
        'screencap',
        '-p',
        '/sdcard/uaa-screen.png'
      ])
      const pullShot = await ctx.runCommand(adb, [
        '-s',
        input.deviceId,
        'pull',
        '/sdcard/uaa-screen.png',
        png
      ])
      if (pullShot.code === 0) {
        result.screenshotPaths.push(png)
      } else {
        result.skipped.push({
          check: 'screenshot',
          reason: shot.stderr.slice(0, 300) || alt.stderr.slice(0, 300) || 'screencap failed.'
        })
      }
    }
    ctx.emitLog('Taking a logcat snapshot (not a continuous intercept).')
    const logcat = await ctx.runCommand(adb, ['-s', input.deviceId, 'logcat', '-d', '-t', '80'])
    result.runtimeEvents.push(...logcat.stdout.split(/\r?\n/).filter(Boolean).slice(0, 80))
    if (input.packageName) {
      const crashes = result.runtimeEvents.filter(
        (line) => line.toLowerCase().includes('exception') || line.toLowerCase().includes('fatal')
      )
      for (const line of crashes.slice(0, 10)) {
        result.findings.push({
          id: makeId('find'),
          title: 'Runtime exception in logcat snapshot',
          severity: 'medium',
          category: 'runtime',
          evidence: [
            { id: makeId('ev'), kind: 'runtime', snippet: line.slice(0, 240), note: 'logcat -d' }
          ],
          affected: input.packageName,
          explanation:
            'A crash or exception line was present in the log snapshot. This is observation, not an exploit.',
          confidence: 'low',
          remediation: 'Reproduce under a debug build and inspect the stack trace.',
          engineId: 'android-runtime',
          falsePositiveNotes: 'Unrelated system processes can appear in logcat.'
        })
      }
    }
    result.limitations.push(
      'Session is snapshot-based. The app is not automatically logged into accounts or unwrapped.'
    )
    return result
  }
}
