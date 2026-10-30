import type { AnalysisInput } from '../types/engine'

export function missingAnalysisTarget(
  input: Pick<AnalysisInput, 'inputKind' | 'path' | 'url' | 'packageName' | 'deviceId'>
): string | null {
  if (input.inputKind === 'file' || input.inputKind === 'folder') {
    if (!input.path?.trim()) {
      return 'Select a file or folder before starting analysis.'
    }
  }
  if (input.inputKind === 'url' && !input.url?.trim()) {
    return 'Enter a URL before starting analysis.'
  }
  if (input.inputKind === 'package-name' && !input.packageName?.trim()) {
    return 'Enter a package name before starting analysis.'
  }
  if (input.inputKind === 'device-package') {
    if (!input.deviceId?.trim() || !input.packageName?.trim()) {
      return 'Enter a device id and package name before starting analysis.'
    }
  }
  return null
}
