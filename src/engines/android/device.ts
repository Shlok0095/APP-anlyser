import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { findOnPath } from '../base/spawn'

export interface AdbDevice {
  id: string
  status: string
  extras: string
}

export function parseAdbDevices(output: string): AdbDevice[] {
  const devices: AdbDevice[] = []
  for (const line of output.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const [id, status, ...rest] = trimmed.split(/\s+/)
    if (id && status) {
      devices.push({ id, status, extras: rest.join(' ') })
    }
  }
  return devices
}

export const androidDeviceEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'android-device',
    displayName: 'Installed app inspection via ADB',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['android'],
    supportedInputKinds: ['device-package'],
    requiredUtilities: ['adb'],
    requiredPermissions: ['adb'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: ['device listing', 'package dump', 'authorized apk pull']
  },
  validate(input) {
    const errors: string[] = []
    if (!findOnPath('adb')) {
      errors.push('adb was not found on PATH. Install Android platform-tools to inspect devices.')
    }
    if (!input.packageName) {
      errors.push('Select an installed package name.')
    }
    if (!input.deviceId) {
      errors.push('Select a connected Android device or emulator.')
    }
    return { ok: errors.length === 0, errors, warnings: [] }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    const adb = findOnPath('adb')
    if (!adb || !input.deviceId || !input.packageName) {
      throw new Error('ADB, device id, and package name are required.')
    }
    ctx.emitLog(`Inspecting ${input.packageName} on ${input.deviceId}`)
    const dump = await ctx.runCommand(
      adb,
      ['-s', input.deviceId, 'shell', 'dumpsys', 'package', input.packageName],
      {
        timeoutMs: 20_000
      }
    )
    if (dump.code !== 0) {
      throw new Error(dump.stderr || 'dumpsys package failed.')
    }
    result.logs.push(dump.stdout.slice(0, 8000))
    const versionName = dump.stdout.match(/versionName=(\S+)/)
    const versionCode = dump.stdout.match(/versionCode=(\S+)/)
    if (versionName) {
      result.metadata.versionName = versionName[1]
    }
    if (versionCode) {
      result.metadata.versionCode = versionCode[1]
    }
    result.metadata.packageName = input.packageName
    result.metadata.deviceId = input.deviceId
    const permBlock = dump.stdout.match(
      /requested permissions:([\s\S]*?)(?:install permissions:|runtime permissions:|$)/
    )
    if (permBlock) {
      for (const line of permBlock[1].split(/\r?\n/)) {
        const perm = line.trim()
        if (perm.startsWith('android.permission.') || perm.includes('.permission.')) {
          result.components.push({
            id: makeId('cmp'),
            kind: 'permission',
            name: perm.split(':')[0] ?? perm
          })
        }
      }
    }
    const pathDump = await ctx.runCommand(adb, [
      '-s',
      input.deviceId,
      'shell',
      'pm',
      'path',
      input.packageName
    ])
    result.metadata.apkPath = pathDump.stdout.trim()
    result.limitations.push(
      'Private app data is not read. APK pull is only attempted for paths ADB can access without root.'
    )
    if (pathDump.stdout.includes('package:')) {
      const remote = pathDump.stdout.replace('package:', '').trim().split(/\r?\n/)[0]
      const local = `${ctx.artifactDir}/pulled.apk`
      const pulled = await ctx.runCommand(adb, ['-s', input.deviceId, 'pull', remote, local], {
        timeoutMs: 60_000
      })
      if (pulled.code === 0) {
        result.metadata.pulledApk = local
      } else {
        result.skipped.push({
          check: 'apk pull',
          reason:
            pulled.stderr.slice(0, 400) ||
            'ADB could not pull the package. Split APKs or protected paths may block this.'
        })
      }
    }
    return result
  }
}
