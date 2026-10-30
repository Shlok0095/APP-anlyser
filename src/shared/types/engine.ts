export type TargetType =
  | 'android'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'website'
  | 'source'
  | 'package'
  | 'container'
  | 'archive'
  | 'tool'

export type EnginePlatform = 'win32' | 'darwin' | 'linux'
export type InputKind = 'file' | 'folder' | 'url' | 'package-name' | 'device-package'

export interface AnalysisProfile {
  basic: boolean
  architecture: boolean
  dependencies: boolean
  security: boolean
  api: boolean
  runtime: boolean
  ai: boolean
  allowNetwork: boolean
}

export const DEFAULT_PROFILE: AnalysisProfile = {
  basic: true,
  architecture: true,
  dependencies: true,
  security: true,
  api: true,
  runtime: false,
  ai: false,
  allowNetwork: false
}

export interface AnalysisInput {
  targetType: TargetType
  inputKind: InputKind
  label: string
  path?: string
  url?: string
  packageName?: string
  deviceId?: string
  profile: AnalysisProfile
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface CommandOptions {
  timeoutMs?: number
  cwd?: string
  stdoutPath?: string
  maxStdoutBytes?: number
  env?: NodeJS.ProcessEnv
  onStdoutLine?: (line: string) => void
}

export interface EngineContext {
  emitLog(message: string): void
  emitProgress(label: string, percent?: number): void
  isCancelled(): boolean
  artifactDir: string
  runCommand(file: string, args: string[], options?: CommandOptions): Promise<CommandResult>
  fetchText(url: string): Promise<string>
}

export interface AnalysisEngine {
  id: string
  displayName: string
  version: string
  supportedPlatforms: EnginePlatform[]
  supportedTargetTypes: TargetType[]
  supportedInputKinds: InputKind[]
  requiredUtilities: string[]
  requiredPermissions: string[]
  needsNetwork: boolean
  involvesRuntime: boolean
  capabilities: string[]
}

export interface AnalysisEngineRuntime {
  descriptor: AnalysisEngine
  validate(input: AnalysisInput): ValidationResult
  execute(input: AnalysisInput, ctx: EngineContext): Promise<import('./analysis').AnalysisResult>
}
