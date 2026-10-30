import type { AnalysisEngineRuntime, AnalysisInput, TargetType } from '../shared/types/engine'
import { apkEngine } from './android/apk'
import { androidDeviceEngine } from './android/device'
import { playStoreEngine } from './android/play-store'
import { androidRuntimeEngine } from './android/runtime'
import { archiveEngine } from './archives'
import { containerEngine } from './containers'
import { packageEngine } from './packages'
import { reaEngine } from './rea'
import { sourceCodeEngine } from './source-code'
import { unixPackageEngine } from './unix'
import { webEngine } from './web'
import { windowsEngine } from './windows'

export const ALL_ENGINES: AnalysisEngineRuntime[] = [
  reaEngine,
  sourceCodeEngine,
  apkEngine,
  playStoreEngine,
  androidDeviceEngine,
  androidRuntimeEngine,
  webEngine,
  windowsEngine,
  unixPackageEngine,
  packageEngine,
  containerEngine,
  archiveEngine
]

export function listEngines(): AnalysisEngineRuntime[] {
  return ALL_ENGINES
}

export function enginesFor(input: AnalysisInput): AnalysisEngineRuntime[] {
  return ALL_ENGINES.filter((engine) => {
    if (!engine.descriptor.supportedTargetTypes.includes(input.targetType)) {
      return false
    }
    if (!engine.descriptor.supportedInputKinds.includes(input.inputKind)) {
      return false
    }
    if (engine.descriptor.involvesRuntime && !input.profile.runtime) {
      return false
    }
    if (
      engine.descriptor.needsNetwork &&
      !input.profile.allowNetwork &&
      input.inputKind === 'url'
    ) {
      if (engine.descriptor.id === 'android-play') {
        return false
      }
    }
    return true
  })
}

export const TARGET_ENGINE_HINT: Record<TargetType, string[]> = {
  android: ['rea-cli', 'android-apk', 'android-play', 'android-device', 'android-runtime'],
  windows: ['rea-cli', 'windows-package'],
  macos: ['rea-cli', 'unix-package'],
  linux: ['rea-cli', 'unix-package'],
  website: ['rea-cli', 'web-static'],
  source: ['rea-cli', 'source-static'],
  package: ['rea-cli', 'software-package'],
  container: ['rea-cli', 'container'],
  archive: ['rea-cli', 'archive'],
  tool: ['rea-cli', 'source-static', 'windows-package']
}
