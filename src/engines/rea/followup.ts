import { basename, extname } from 'node:path'
import { ANDROID_EXT, PE_EXT, type ReaInvocation } from './plan'

const JS_OPERATIONS = new Set(['analyze_javascript_application', 'javascript_application'])
const NATIVE_OVERVIEW = new Set(['binary_overview'])
const INVENTORY_CAP = 400
const PE_MAX_BYTES = '268435456'

const ELF_EXT = /\.(elf|so|o|ko)$/i
const MACHO_EXT = /\.(dylib|bundle)$/i
const WASM_EXT = /\.wasm$/i
const SQLITE_EXT = /\.(sqlite|sqlite3|db)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function push(
  invocations: ReaInvocation[],
  command: string,
  path: string,
  label: string,
  extra?: Partial<ReaInvocation>
): void {
  invocations.push({
    command,
    positional: extra?.positional ?? [path],
    timeoutMs: extra?.timeoutMs ?? 60_000,
    flags: extra?.flags,
    outputName: extra?.outputName ?? command,
    label,
    filterOutput: extra?.filterOutput
  })
}

export function reaOperation(document: unknown): string {
  return isRecord(document) ? (asString(document.operation) ?? '') : ''
}

export function isJavaScriptEvidence(document: unknown): boolean {
  const operation = reaOperation(document)
  if (JS_OPERATIONS.has(operation)) {
    return true
  }
  if (!isRecord(document)) {
    return false
  }
  const normalized = isRecord(document.normalized_result) ? document.normalized_result : null
  const graph = normalized && isRecord(normalized.graph) ? normalized.graph : null
  return asString(graph?.schema) === 'JavaScriptApplicationGraph'
}

export function isNativeOverview(document: unknown): boolean {
  return NATIVE_OVERVIEW.has(reaOperation(document))
}

export function inventoryCap(): number {
  return INVENTORY_CAP
}

export function isManagedPe(document: unknown): boolean {
  if (!isRecord(document)) {
    return false
  }
  if (document.ok === false) {
    return false
  }
  const normalized = isRecord(document.normalized_result)
    ? document.normalized_result
    : isRecord(document.result)
      ? document.result
      : document
  const classification = isRecord(normalized.classification) ? normalized.classification : null
  const status = classification ? asString(classification.status) : undefined
  if (!status) {
    return false
  }
  return status !== 'not-managed'
}

export function planManagedMembersFollowup(path: string): ReaInvocation {
  return {
    command: 'inspect-managed-members',
    positional: [path],
    timeoutMs: 180_000,
    outputName: 'inspect-managed-members',
    label: 'Managed PE/CLI members'
  }
}

export function planReaFollowups(path: string, evidence: unknown): ReaInvocation[] {
  const invocations: ReaInvocation[] = []
  const ext = extname(path)
  const base = basename(path)
  const format =
    isRecord(evidence) && isRecord(evidence.subject) ? asString(evidence.subject.format) : undefined
  const pe = PE_EXT.test(ext) || format === 'pe'
  const elf = ELF_EXT.test(ext) || format === 'elf'
  const macho = MACHO_EXT.test(ext) || base.toLowerCase().endsWith('.app') || format === 'macho'
  const android = ANDROID_EXT.test(ext)
  const native = pe || elf || macho || isNativeOverview(evidence)
  const js = isJavaScriptEvidence(evidence)

  if (pe) {
    push(invocations, 'inspect-pe-resources', path, 'PE resource tree', {
      flags: ['--max-file-bytes', PE_MAX_BYTES]
    })
    push(invocations, 'inspect-pe-imports', path, 'PE import and delay-load tables', {
      flags: ['--max-file-bytes', PE_MAX_BYTES]
    })
    push(invocations, 'inspect-pe-certificates', path, 'PE Authenticode certificate table', {
      flags: ['--max-file-bytes', PE_MAX_BYTES]
    })
    push(invocations, 'inspect-managed-artifact', path, 'Managed PE/CLI identity')
    push(invocations, 'inspect-electron-fuses', path, 'Electron fuse flags', { timeoutMs: 30_000 })
  }

  if (pe || elf || macho || native) {
    push(invocations, 'inspect-go-binary', path, 'Embedded Go build info', { timeoutMs: 30_000 })
    push(invocations, 'inspect-rust-binary', path, 'Embedded Rust crate list', { timeoutMs: 30_000 })
  }

  if (elf) {
    push(invocations, 'inspect-elf-notes', path, 'ELF note tables', {
      flags: ['--max-file-bytes', PE_MAX_BYTES]
    })
    push(invocations, 'inspect-binary-layout', path, 'ELF file/linked layout', { timeoutMs: 120_000 })
  }

  if (macho) {
    push(invocations, 'inspect-macho', path, 'Mach-O layout', { timeoutMs: 120_000 })
    push(invocations, 'inspect-plist', path, 'Info.plist metadata', { timeoutMs: 60_000 })
  }

  if (android) {
    push(invocations, 'identify-flutter-build', path, 'Flutter/Dart snapshot identity', {
      timeoutMs: 60_000
    })
    push(invocations, 'search-android-classes', path, 'Android class inventory (JADX)', {
      positional: [path, ''],
      timeoutMs: 180_000
    })
  }

  if (WASM_EXT.test(ext)) {
    push(invocations, 'inspect-wasm-artifact', path, 'WebAssembly artifact', { timeoutMs: 120_000 })
  }

  if (SQLITE_EXT.test(ext)) {
    push(invocations, 'inspect-sqlite-database', path, 'SQLite schema inventory', {
      timeoutMs: 60_000
    })
  }

  if (/global-metadata\.dat$/i.test(base)) {
    push(invocations, 'inspect-il2cpp-metadata', path, 'IL2CPP metadata names', {
      timeoutMs: 180_000
    })
  }

  if (native && !js) {
    push(invocations, 'search', path, 'List every analyzed procedure', {
      positional: [path, '.*'],
      flags: ['--kind', 'procedures', '--mode', 'regex'],
      timeoutMs: 600_000,
      outputName: 'search-procedures'
    })
    push(invocations, 'search', path, 'List every defined string', {
      positional: [path, '.*'],
      flags: ['--kind', 'strings', '--mode', 'regex'],
      timeoutMs: 600_000,
      outputName: 'search-strings'
    })
  }

  return invocations
}
