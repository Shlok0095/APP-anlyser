import { extname } from 'node:path'
import type { AnalysisInput } from '../../shared/types/engine'
import type { SkippedCheck } from '../../shared/types/analysis'

export interface ReaInvocation {
  command: string
  positional: string[]
  timeoutMs: number
  filterOutput?: string
  flags?: string[]
  outputName?: string
  label: string
}

export const ANDROID_EXT = /\.(apk|aab|xapk|apks)$/i
export const PE_EXT = /\.(exe|dll|sys|winmd)$/i
export const ARCHIVE_EXT = /\.(zip|ipa|msix|appx|asar)$/i

export function planReaInvocations(input: AnalysisInput): {
  invocations: ReaInvocation[]
  skipped: SkippedCheck[]
} {
  const skipped: SkippedCheck[] = []
  const invocations: ReaInvocation[] = []

  if (input.inputKind === 'url') {
    skipped.push({
      check: 'rea-web-url',
      reason:
        'REA inspect-web-page needs an attached CDP browser target, not a bare URL. Save the site or analyze a local folder/APK/EXE instead.'
    })
    return { invocations, skipped }
  }

  if (input.inputKind === 'package-name') {
    skipped.push({
      check: 'rea-play-listing',
      reason:
        'Play Store HTML listings are not REA artifacts. The Play engine reads public listing pages when network is allowed.'
    })
    return { invocations, skipped }
  }

  if (input.inputKind === 'device-package') {
    if (!input.deviceId || !input.packageName) {
      skipped.push({
        check: 'rea-adb',
        reason: 'Device serial and package name are required for inspect-adb-package.'
      })
      return { invocations, skipped }
    }
    invocations.push({
      command: 'inspect-adb-package',
      positional: [input.deviceId, input.packageName],
      timeoutMs: 60_000,
      label: 'ADB package inspection'
    })
    return { invocations, skipped }
  }

  const path = input.path
  if (!path) {
    skipped.push({ check: 'rea-target', reason: 'No local path was provided for REA.' })
    return { invocations, skipped }
  }

  invocations.push({
    command: 'analyze',
    positional: [path],
    timeoutMs: 600_000,
    label: 'REA analyze — overview Evidence'
  })

  const ext = extname(path)
  if (ANDROID_EXT.test(ext)) {
    invocations.push({
      command: 'inspect-android-package',
      positional: [path],
      timeoutMs: 180_000,
      label: 'Android APK declarations (JADX)'
    })
  }
  if (ANDROID_EXT.test(ext) || ARCHIVE_EXT.test(ext)) {
    invocations.push({
      command: 'inspect-artifact',
      positional: [path],
      timeoutMs: 120_000,
      label: 'Archive / package inventory'
    })
  }

  return { invocations, skipped }
}
