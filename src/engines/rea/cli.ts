import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { CommandResult, EngineContext } from '../../shared/types/engine'
import { findOnPath } from '../base/spawn'

export const REA_PACKAGE = 'rea-agents@6.8.0'
export const REA_MIN_VERSION = '6.8.0'

function parseVersion(value: string): number[] {
  return value.split('.').map((part) => Number.parseInt(part.replace(/\D/g, ''), 10) || 0)
}

function versionAtLeast(actual: string, required: string): boolean {
  const left = parseVersion(actual)
  const right = parseVersion(required)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a > b) {
      return true
    }
    if (a < b) {
      return false
    }
  }
  return true
}

function installedReaVersion(reaMjs: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(reaMjs), '..', 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

export interface ReaLauncher {
  file: string
  prefix: string[]
  display: string
}

function isWindowsShim(path: string): boolean {
  const base = basename(path).toLowerCase()
  if (base.endsWith('.cmd') || base.endsWith('.bat') || base.endsWith('.ps1')) {
    return true
  }
  if (process.platform !== 'win32') {
    return false
  }
  if (base.endsWith('.exe') || base.endsWith('.mjs') || base.endsWith('.js')) {
    return false
  }
  try {
    const head = readFileSync(path, { encoding: 'utf8' }).slice(0, 64)
    return head.startsWith('#!') && (head.includes('/bin/sh') || head.includes('node'))
  } catch {
    return true
  }
}

function isUsableExecutable(path: string | null): path is string {
  return Boolean(path && existsSync(path) && !isWindowsShim(path))
}

export function resolveNodeExecutable(): string | null {
  if (process.env.UAA_NODE_BIN && existsSync(process.env.UAA_NODE_BIN)) {
    return process.env.UAA_NODE_BIN
  }
  const fromPath = findOnPath('node')
  if (isUsableExecutable(fromPath)) {
    return fromPath
  }
  const self = process.execPath
  if (/node(\.exe)?$/i.test(basename(self))) {
    return self
  }
  return null
}

function npxCliPath(node: string): string | null {
  const candidates = [
    join(dirname(node), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function findInstalledReaMjs(): string | null {
  const searchDirs: string[] = []
  const reaHit = findOnPath('rea')
  if (reaHit) {
    searchDirs.push(dirname(reaHit))
  }
  const npmHit = findOnPath('npm')
  if (npmHit) {
    searchDirs.push(dirname(npmHit))
  }
  if (process.env.APPDATA) {
    searchDirs.push(join(process.env.APPDATA, 'npm'))
  }
  const unique = [...new Set(searchDirs)]
  for (const dir of unique) {
    const candidate = join(dir, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs')
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export function resolveReaLauncher(): ReaLauncher | null {
  if (process.env.UAA_DISABLE_REA === '1') {
    return null
  }
  if (process.env.UAA_REA_BIN && existsSync(process.env.UAA_REA_BIN)) {
    const override = process.env.UAA_REA_BIN
    if (override.toLowerCase().endsWith('.mjs') || override.toLowerCase().endsWith('.js')) {
      const node = resolveNodeExecutable()
      if (!node) {
        return null
      }
      return { file: node, prefix: [override], display: override }
    }
    if (!isWindowsShim(override)) {
      return { file: override, prefix: [], display: override }
    }
  }
  const node = resolveNodeExecutable()
  if (!node) {
    return null
  }
  const installed = findInstalledReaMjs()
  if (installed) {
    const version = installedReaVersion(installed)
    if (version && versionAtLeast(version, REA_MIN_VERSION)) {
      return { file: node, prefix: [installed], display: `rea ${version} (${installed})` }
    }
  }
  const npxCli = npxCliPath(node)
  if (npxCli) {
    return {
      file: node,
      prefix: [npxCli, '-y', REA_PACKAGE],
      display: `npx -y ${REA_PACKAGE}`
    }
  }
  return null
}

export function parseJsonDocument(text: string): unknown {
  const start = text.search(/[{[]/)
  if (start < 0) {
    throw new Error('REA produced no JSON document.')
  }
  return JSON.parse(text.slice(start)) as unknown
}

function isProgressDocument(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'rea_progress' in (value as Record<string, unknown>)
  )
}

export function extractReaJson(text: string): unknown | null {
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{') && !line.startsWith('[')) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isProgressDocument(parsed)) {
        return parsed
      }
    } catch {
      continue
    }
  }
  try {
    const parsed = parseJsonDocument(text)
    return isProgressDocument(parsed) ? null : parsed
  } catch {
    return null
  }
}

export async function runReaCommand(
  ctx: EngineContext,
  command: string,
  positional: string[],
  options?: {
    timeoutMs?: number
    filterOutput?: string
    flags?: string[]
    outputName?: string
  }
): Promise<{ result: CommandResult; document: unknown | null; jsonPath: string }> {
  const launcher = resolveReaLauncher()
  if (!launcher) {
    throw new Error('REA CLI is not available.')
  }
  const jsonPath = join(ctx.artifactDir, `rea-${options?.outputName ?? command}.json`)
  const args = [
    ...launcher.prefix,
    command,
    ...positional,
    ...(options?.flags ?? []),
    '--format',
    'json',
    ...(options?.filterOutput ? ['--filter-output', options.filterOutput] : [])
  ]
  ctx.emitLog(`REA ${launcher.display} ${command} ${positional.join(' ')}`.trim())
  const result = await ctx.runCommand(launcher.file, args, {
    timeoutMs: options?.timeoutMs ?? 180_000,
    stdoutPath: jsonPath,
    env: {
      ...process.env,
      npm_config_yes: 'true',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false'
    }
  })
  const raw = [result.stdout, existsSync(jsonPath) ? readFileSync(jsonPath, 'utf8') : '']
    .filter((chunk) => chunk.trim())
    .join('\n')
  const document = raw.trim() ? extractReaJson(raw) : null
  if (document) {
    writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  }
  return { result, document, jsonPath }
}
