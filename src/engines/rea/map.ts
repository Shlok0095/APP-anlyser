import {
  emptyAnalysisResult,
  type AnalysisResult,
  type ComponentKind,
  type Confidence,
  type EndpointRecord,
  type Evidence
} from '../../shared/types/analysis'
import { makeId } from '../base/ids'
import { REA_PACKAGE } from './cli'
import { inventoryCap } from './followup'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readError(document: unknown): { code?: string; message: string } | null {
  if (!isRecord(document)) {
    return null
  }
  if (document.ok === false && isRecord(document.error)) {
    return {
      code: asString(document.error.code),
      message:
        asString(document.error.message) ??
        asString(document.message) ??
        'REA returned an error envelope.'
    }
  }
  if (typeof document.error === 'string') {
    return {
      code: asString(document.code),
      message: document.error
    }
  }
  if (isRecord(document.error) && asString(document.error.message)) {
    return {
      code: asString(document.error.code) ?? asString(document.code),
      message: asString(document.error.message) ?? 'REA returned an error.'
    }
  }
  return null
}

function componentKind(kind: string): ComponentKind {
  if (kind.includes('activity')) {
    return 'activity'
  }
  if (kind.includes('service')) {
    return 'service'
  }
  if (kind.includes('receiver')) {
    return 'receiver'
  }
  if (kind.includes('provider')) {
    return 'provider'
  }
  if (kind.includes('permission')) {
    return 'permission'
  }
  if (kind === 'package' || kind.includes('library')) {
    return 'library'
  }
  if (kind.includes('page') || kind.includes('window')) {
    return 'page'
  }
  if (kind.includes('route')) {
    return 'route'
  }
  if (kind.includes('form')) {
    return 'form'
  }
  if (kind.includes('asset') || kind === 'artifact' || kind.includes('file')) {
    return 'file'
  }
  if (kind.includes('config')) {
    return 'config'
  }
  if (kind.includes('function')) {
    return 'function'
  }
  if (kind.includes('class')) {
    return 'class'
  }
  return 'module'
}

function confidenceOf(value: unknown): Confidence {
  const text = asString(value)?.toLowerCase()
  if (text === 'exact' || text === 'high') {
    return 'high'
  }
  if (text === 'likely' || text === 'medium') {
    return 'medium'
  }
  return 'low'
}

function locationEvidence(observation: Record<string, unknown>, note: string): Evidence {
  const evidence = isRecord(observation.evidence) ? observation.evidence : {}
  const location = isRecord(evidence.location) ? evidence.location : {}
  const locValue = isRecord(location.value) ? location.value : {}
  const start = isRecord(locValue.start) ? locValue.start : {}
  const path = asString(locValue.source) ?? asString(locValue.path) ?? asString(observation.label)
  const line = asNumber(start.line)
  return {
    id: makeId('ev'),
    kind: path ? 'file' : 'metadata',
    path,
    line,
    snippet: asString(observation.label),
    note
  }
}

function firstObservation(node: Record<string, unknown>): Record<string, unknown> {
  const observations = Array.isArray(node.observations) ? node.observations : []
  const first = observations.find((item) => isRecord(item))
  return isRecord(first) ? first : {}
}

function propertiesOf(observation: Record<string, unknown>): Record<string, unknown> {
  return isRecord(observation.properties) ? observation.properties : {}
}

function pushLimitation(result: AnalysisResult, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    result.limitations.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      pushLimitation(result, item)
    }
  }
}

function mapGraph(result: AnalysisResult, graph: Record<string, unknown>, engineId: string): void {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : []
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRecord) : []
  for (const node of nodes) {
    const id = asString(node.node_id) ?? makeId('node')
    const kind = asString(node.kind) ?? 'node'
    const observation = firstObservation(node)
    const props = propertiesOf(observation)
    const label =
      asString(observation.label) ??
      asString(props.module_path) ??
      asString(props.name) ??
      asString(props.value) ??
      kind
    result.graph.nodes.push({ id, label, kind })

    if (kind === 'endpoint') {
      const url = asString(props.value) ?? label
      const endpoint: EndpointRecord = {
        id: makeId('ep'),
        url,
        source: 'source',
        evidence: [locationEvidence(observation, 'REA static endpoint')]
      }
      result.endpoints.push(endpoint)
      continue
    }

    if (kind === 'package') {
      if (asString(props.name)) {
        result.metadata['package.name'] = asString(props.name) ?? ''
      }
      if (asString(props.version)) {
        result.metadata['package.version'] = asString(props.version) ?? ''
      }
      if (asString(props.main)) {
        result.metadata['package.main'] = asString(props.main) ?? ''
      }
      result.components.push({
        id,
        kind: 'library',
        name: asString(props.name) ?? label,
        path: asString(props.path),
        detail: asString(props.version)
      })
      continue
    }

    result.components.push({
      id,
      kind: componentKind(kind),
      name: label,
      path: asString(props.module_path) ?? asString(props.path),
      detail: kind
    })

    if (kind === 'artifact' || kind.includes('asset')) {
      result.files.push({
        path: asString(props.path) ?? asString(props.module_path) ?? label,
        size: asNumber(props.size) ?? 0,
        kind
      })
    }

    const evidenceNote = asString(props.semantic_role)
    if (evidenceNote && /secret|password|token|key/i.test(evidenceNote)) {
      result.findings.push({
        id: makeId('f'),
        title: label,
        severity: 'medium',
        category: 'secrets',
        evidence: [locationEvidence(observation, evidenceNote)],
        affected: asString(props.module_path) ?? label,
        explanation: 'REA reported this observation from static artifact analysis.',
        confidence: confidenceOf(
          isRecord(observation.evidence) ? observation.evidence.confidence : undefined
        ),
        remediation: 'Review the cited location; this is not a confirmed exploit.',
        engineId,
        falsePositiveNotes: ''
      })
    }
  }

  for (const edge of edges) {
    const from = asString(edge.source_node_id)
    const to = asString(edge.target_node_id)
    if (!from || !to) {
      continue
    }
    result.graph.edges.push({
      from,
      to,
      kind: asString(edge.relation) ?? 'related'
    })
  }
}

function mapUnknowns(result: AnalysisResult, value: unknown): void {
  if (!Array.isArray(value)) {
    return
  }
  for (const item of value) {
    if (typeof item === 'string') {
      result.limitations.push(`Unknown: ${item}`)
      continue
    }
    if (!isRecord(item)) {
      continue
    }
    const title = asString(item.title) ?? asString(item.id) ?? 'Unknown'
    const detail = asString(item.detail) ?? asString(item.message) ?? asString(item.reason) ?? title
    result.limitations.push(`${title}: ${detail}`)
  }
}

function mapContradictions(result: AnalysisResult, value: unknown, engineId: string): void {
  if (!Array.isArray(value)) {
    return
  }
  for (const item of value) {
    const text = isRecord(item)
      ? (asString(item.message) ?? asString(item.detail) ?? JSON.stringify(item))
      : String(item)
    result.findings.push({
      id: makeId('f'),
      title: 'Integrity contradiction',
      severity: 'medium',
      category: 'integrity',
      evidence: [
        {
          id: makeId('ev'),
          kind: 'metadata',
          note: text
        }
      ],
      affected: 'artifact',
      explanation: text,
      confidence: 'medium',
      remediation:
        'Compare the cited hashes or paths; do not treat this as a vulnerability by itself.',
      engineId,
      falsePositiveNotes: ''
    })
  }
}

function identityName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (asString(value.name)) {
    return asString(value.name)
  }
  if (value.kind === 'id' && value.id !== undefined) {
    return String(value.id)
  }
  return undefined
}

function mapAddressedInventory(
  result: AnalysisResult,
  items: unknown[],
  command: string
): void {
  const cap = inventoryCap()
  const asFunctions = command.includes('procedure')
  let mapped = 0
  for (const item of items) {
    if (!isRecord(item)) {
      continue
    }
    const address = asString(item.address) ?? ''
    const value = asString(item.value) ?? address
    if (!value) {
      continue
    }
    if (mapped < cap) {
      if (asFunctions) {
        result.components.push({
          id: makeId('fn'),
          kind: 'function',
          name: value,
          detail: address || undefined
        })
        result.graph.nodes.push({
          id: address || value,
          label: value,
          kind: 'function'
        })
      } else {
        const encoding = isRecord(item.string) ? asString(item.string.encoding) : undefined
        result.files.push({
          path: value.slice(0, 240),
          size: isRecord(item.string) ? (asNumber(item.string.byte_length) ?? 0) : 0,
          kind: encoding ?? 'string'
        })
        if (/^https?:\/\//i.test(value)) {
          result.endpoints.push({
            id: makeId('ep'),
            url: value.slice(0, 500),
            source: 'package',
            evidence: [
              {
                id: makeId('ev'),
                kind: 'binary',
                snippet: address,
                note: 'REA defined-string inventory'
              }
            ]
          })
        }
      }
    }
    mapped += 1
  }
  result.metadata[`${command}Count`] = String(items.length)
  if (items.length > cap) {
    result.limitations.push(
      `Mapped the first ${cap} of ${items.length} ${command} hits. Full Evidence JSON is saved on disk.`
    )
  }
}

function mapPeImports(result: AnalysisResult, normalized: Record<string, unknown>): void {
  const tables = [
    { key: 'imports', label: 'import' },
    { key: 'delay_imports', label: 'delay-import' }
  ] as const
  const cap = inventoryCap()
  let mapped = 0
  let dllCount = 0
  let functionCount = 0
  for (const table of tables) {
    const dlls = Array.isArray(normalized[table.key]) ? (normalized[table.key] as unknown[]) : []
    dllCount += dlls.length
    for (const dll of dlls) {
      if (!isRecord(dll)) {
        continue
      }
      const dllName = asString(dll.name) ?? `${table.label}-dll`
      const functions = Array.isArray(dll.functions) ? dll.functions : []
      functionCount += functions.length
      if (mapped < cap) {
        result.components.push({
          id: makeId('dll'),
          kind: 'library',
          name: dllName,
          detail: `${table.label} · ${functions.length} function(s)`
        })
        result.dependencies.push({ name: dllName, source: `rea:${table.label}` })
        mapped += 1
      }
      for (const fn of functions) {
        if (mapped >= cap) {
          break
        }
        if (!isRecord(fn)) {
          continue
        }
        const fnName =
          asString(fn.name) ?? (fn.ordinal !== undefined ? `ordinal ${String(fn.ordinal)}` : undefined)
        if (!fnName) {
          continue
        }
        result.components.push({
          id: makeId('imp'),
          kind: 'function',
          name: `${dllName}!${fnName}`,
          detail: table.label
        })
        mapped += 1
      }
    }
  }
  result.metadata.peImportDllCount = String(dllCount)
  result.metadata.peImportFunctionCount = String(functionCount)
  if (mapped >= cap && dllCount + functionCount > cap) {
    result.limitations.push(
      `Mapped the first ${cap} PE import rows. Full Evidence JSON is saved on disk.`
    )
  }
}

function mapPeCertificates(result: AnalysisResult, normalized: Record<string, unknown>): void {
  const entries = Array.isArray(normalized.entries) ? normalized.entries : []
  result.metadata.peCertificateCount = String(entries.length)
  if (entries.length === 0) {
    result.limitations.push('PE Authenticode table is empty or not present.')
    return
  }
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue
    }
    const typeName = asString(entry.certificate_type_name) ?? 'certificate'
    const pkcs7 = isRecord(entry.pkcs7) ? entry.pkcs7 : null
    const certs = pkcs7 && Array.isArray(pkcs7.certificates) ? pkcs7.certificates : []
    if (certs.length === 0) {
      result.components.push({
        id: makeId('cert'),
        kind: 'config',
        name: `Authenticode ${typeName}`,
        detail: `index ${String(asNumber(entry.index) ?? 0)}`
      })
      continue
    }
    for (const cert of certs) {
      if (!isRecord(cert)) {
        continue
      }
      const subject = isRecord(cert.subject) ? asString(cert.subject.text) : undefined
      const issuer = isRecord(cert.issuer) ? asString(cert.issuer.text) : undefined
      result.components.push({
        id: makeId('cert'),
        kind: 'config',
        name: subject ?? `Authenticode ${typeName}`,
        detail: [typeName, issuer ? `issuer ${issuer}` : undefined, asString(cert.not_after)]
          .filter(Boolean)
          .join(' · ')
      })
    }
  }
}

function mapManagedMembers(result: AnalysisResult, normalized: Record<string, unknown>): void {
  const cap = inventoryCap()
  const types = Array.isArray(normalized.types) ? normalized.types : []
  const methods = Array.isArray(normalized.methods) ? normalized.methods : []
  let mapped = 0
  for (const type of types) {
    if (!isRecord(type) || mapped >= cap) {
      continue
    }
    const name = asString(type.full_name) ?? asString(type.name)
    if (!name) {
      continue
    }
    result.components.push({
      id: makeId('type'),
      kind: 'class',
      name,
      detail: asString(type.namespace)
    })
    mapped += 1
  }
  for (const method of methods) {
    if (!isRecord(method) || mapped >= cap) {
      continue
    }
    const name = asString(method.full_name) ?? asString(method.name)
    if (!name) {
      continue
    }
    result.components.push({
      id: makeId('mm'),
      kind: 'function',
      name,
      detail: asString(method.declaring_type) ?? asString(method.signature)
    })
    mapped += 1
  }
  result.metadata.managedTypeCount = String(types.length)
  result.metadata.managedMethodCount = String(methods.length)
}

function mapAndroidClasses(result: AnalysisResult, normalized: Record<string, unknown>): void {
  const matches = Array.isArray(normalized.matches) ? normalized.matches : []
  const cap = inventoryCap()
  let mapped = 0
  for (const item of matches) {
    const name = typeof item === 'string' ? item : isRecord(item) ? asString(item.name) : undefined
    if (!name) {
      continue
    }
    if (mapped < cap) {
      result.components.push({
        id: makeId('cls'),
        kind: 'class',
        name
      })
    }
    mapped += 1
  }
  result.metadata.androidClassCount = String(
    asNumber(normalized.total_classes) ?? matches.length
  )
  if (matches.length > cap) {
    result.limitations.push(
      `Mapped the first ${cap} of ${matches.length} Android classes. Full Evidence JSON is saved on disk.`
    )
  }
}

function mapPeResources(result: AnalysisResult, normalized: Record<string, unknown>): void {
  if (asString(normalized.format)) {
    result.metadata.peFormat = asString(normalized.format) ?? ''
  }
  const resources = Array.isArray(normalized.resources) ? normalized.resources : []
  const cap = inventoryCap()
  let mapped = 0
  for (const resource of resources) {
    if (!isRecord(resource)) {
      continue
    }
    const typeName = identityName(resource.type) ?? 'resource'
    const name = identityName(resource.name) ?? `#${String(asNumber(resource.index) ?? mapped)}`
    if (mapped < cap) {
      result.components.push({
        id: makeId('rsrc'),
        kind: 'resource',
        name: `${typeName}/${name}`,
        detail: `lang ${identityName(resource.language) ?? 'default'}`
      })
    }
    mapped += 1
  }
  result.metadata.peResourceCount = String(resources.length)
  if (resources.length > cap) {
    result.limitations.push(
      `Mapped the first ${cap} of ${resources.length} PE resources. Full Evidence JSON is saved on disk.`
    )
  }
}

function mapPackageList(
  result: AnalysisResult,
  items: unknown[],
  source: string
): void {
  for (const item of items) {
    if (!isRecord(item)) {
      continue
    }
    const name = asString(item.path) ?? asString(item.name) ?? asString(item.module)
    if (!name) {
      continue
    }
    result.dependencies.push({
      name,
      version: asString(item.version) ?? asString(item.mod_version),
      source
    })
  }
}

export function mapReaDocument(
  document: unknown,
  command: string,
  engineId: string
): AnalysisResult {
  const result = emptyAnalysisResult()
  result.metadata.reaCommand = command
  result.metadata.reaBackend = REA_PACKAGE

  const error = readError(document)
  if (error) {
    result.skipped.push({
      check: `rea:${command}`,
      reason: error.code ? `${error.code}: ${error.message}` : error.message
    })
    result.logs.push(`REA ${command} failed: ${error.message}`)
    return result
  }

  if (!isRecord(document)) {
    result.skipped.push({ check: `rea:${command}`, reason: 'REA output was not a JSON object.' })
    return result
  }

  const rawNormalized = document.normalized_result ?? document.result
  if (Array.isArray(rawNormalized)) {
    const subject = isRecord(document.subject) ? document.subject : null
    if (subject && asString(subject.name)) {
      result.metadata['package.name'] = asString(subject.name) ?? ''
    }
    if (subject && asString(subject.format)) {
      result.metadata.format = asString(subject.format) ?? ''
    }
    mapAddressedInventory(result, rawNormalized, command)
    result.logs.push(
      `REA ${command} mapped ${result.components.length} component(s), ${result.endpoints.length} endpoint(s), ${result.files.length} string(s).`
    )
    return result
  }

  const normalized = isRecord(rawNormalized) ? rawNormalized : document

  if (asString(normalized.input_path)) {
    result.metadata.inputPath = asString(normalized.input_path) ?? ''
  }
  if (asString(normalized.format)) {
    result.metadata.format = asString(normalized.format) ?? ''
  }
  if (asString(normalized.root_artifact_sha256)) {
    result.metadata.sha256 = asString(normalized.root_artifact_sha256) ?? ''
  }

  pushLimitation(result, document.limitations)
  pushLimitation(result, normalized.limitations)
  mapUnknowns(result, document.unknowns)
  mapUnknowns(result, normalized.unknowns)
  mapContradictions(result, normalized.integrity_contradictions, engineId)

  if (isRecord(normalized.statistics)) {
    for (const [key, value] of Object.entries(normalized.statistics)) {
      if (typeof value === 'number' || typeof value === 'string') {
        result.metadata[`stats.${key}`] = String(value)
      }
    }
  }

  if (isRecord(normalized.summary)) {
    for (const [key, value] of Object.entries(normalized.summary)) {
      if (typeof value === 'number' || typeof value === 'string') {
        result.metadata[`summary.${key}`] = String(value)
      }
    }
  }

  if (isRecord(normalized.graph)) {
    mapGraph(result, normalized.graph, engineId)
  }

  const subject = isRecord(document.subject) ? document.subject : null
  if (subject) {
    if (asString(subject.name)) {
      result.metadata['package.name'] = asString(subject.name) ?? ''
    }
    if (asString(subject.format)) {
      result.metadata.format = asString(subject.format) ?? result.metadata.format
    }
    if (asString(subject.architecture)) {
      result.metadata.architecture = asString(subject.architecture) ?? ''
    }
    if (isRecord(subject.digest) && asString(subject.digest.sha256)) {
      result.metadata.sha256 = asString(subject.digest.sha256) ?? result.metadata.sha256
    }
    if (asString(subject.local_path)) {
      result.metadata.inputPath = asString(subject.local_path) ?? result.metadata.inputPath
    }
  }
  if (asString(document.operation)) {
    result.metadata.reaOperation = asString(document.operation) ?? ''
  }
  if (asNumber(normalized.procedure_count) !== undefined) {
    result.metadata.procedureCount = String(normalized.procedure_count)
  }
  if (asNumber(normalized.string_count) !== undefined) {
    result.metadata.stringCount = String(normalized.string_count)
  }
  if (asNumber(normalized.segment_count) !== undefined) {
    result.metadata.segmentCount = String(normalized.segment_count)
  }
  if (asString(normalized.image_base)) {
    result.metadata.imageBase = asString(normalized.image_base) ?? ''
  }
  if (asString(normalized.document)) {
    result.metadata.document = asString(normalized.document) ?? ''
  }
  if (Array.isArray(normalized.segments)) {
    for (const segment of normalized.segments) {
      if (!isRecord(segment)) {
        continue
      }
      const name = asString(segment.name) ?? 'segment'
      result.components.push({
        id: makeId('seg'),
        kind: 'resource',
        name,
        detail: `${asString(segment.start) ?? ''}–${asString(segment.end) ?? ''} (${String(asNumber(segment.length) ?? 0)} bytes)`
      })
      result.files.push({
        path: name,
        size: asNumber(segment.length) ?? 0,
        kind: 'segment'
      })
    }
  }

  if (asString(normalized.package_name)) {
    result.metadata.packageName = asString(normalized.package_name) ?? ''
  }
  if (asString(normalized.version_name) || asString(normalized.version)) {
    result.metadata.version =
      asString(normalized.version_name) ?? asString(normalized.version) ?? ''
  }

  if (Array.isArray(normalized.resources) || command.includes('pe-resources')) {
    mapPeResources(result, normalized)
  }
  if (
    command.includes('pe-imports') ||
    Array.isArray(normalized.imports) ||
    Array.isArray(normalized.delay_imports)
  ) {
    mapPeImports(result, normalized)
  }
  if (
    command.includes('pe-certificates') ||
    (Array.isArray(normalized.entries) &&
      isRecord(normalized.entries[0]) &&
      'certificate_type' in normalized.entries[0])
  ) {
    mapPeCertificates(result, normalized)
  }
  if (
    command.includes('managed-members') ||
    (Array.isArray(normalized.types) && Array.isArray(normalized.methods))
  ) {
    mapManagedMembers(result, normalized)
  }
  if (
    command.includes('android-classes') ||
    (Array.isArray(normalized.matches) && asNumber(normalized.total_classes) !== undefined)
  ) {
    mapAndroidClasses(result, normalized)
  }

  if (Array.isArray(normalized.packages)) {
    mapPackageList(result, normalized.packages, command)
  }
  if (Array.isArray(normalized.modules)) {
    mapPackageList(result, normalized.modules, command)
  }
  if (isRecord(normalized.classification) && asString(normalized.classification.status)) {
    result.metadata.managedStatus = asString(normalized.classification.status) ?? ''
  }
  if (isRecord(normalized.pe) && normalized.pe.cli === null) {
    result.limitations.push('The PE has no CLI data directory; managed metadata and CIL are unavailable.')
  }
  if (isRecord(normalized.fuses) || Array.isArray(normalized.fuses)) {
    const fuses = isRecord(normalized.fuses) ? Object.entries(normalized.fuses) : []
    for (const [name, state] of fuses) {
      result.components.push({
        id: makeId('fuse'),
        kind: 'config',
        name,
        detail: String(state)
      })
    }
  }

  result.logs.push(
    `REA ${command} mapped ${result.components.length} component(s), ${result.endpoints.length} endpoint(s).`
  )
  return result
}
