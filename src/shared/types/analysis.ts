export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'
export type Confidence = 'low' | 'medium' | 'high'
export type EndpointSource = 'source' | 'package' | 'runtime' | 'hypothesis'
export type ComponentKind =
  | 'module'
  | 'class'
  | 'function'
  | 'activity'
  | 'service'
  | 'receiver'
  | 'provider'
  | 'page'
  | 'form'
  | 'resource'
  | 'library'
  | 'file'
  | 'route'
  | 'permission'
  | 'config'

export interface Evidence {
  id: string
  kind: 'file' | 'line' | 'manifest' | 'runtime' | 'network' | 'metadata' | 'binary'
  path?: string
  line?: number
  snippet?: string
  note: string
}

export interface ComponentRecord {
  id: string
  kind: ComponentKind
  name: string
  path?: string
  detail?: string
}

export interface Finding {
  id: string
  title: string
  severity: Severity
  category: string
  evidence: Evidence[]
  affected: string
  explanation: string
  confidence: Confidence
  remediation: string
  engineId: string
  falsePositiveNotes: string
}

export interface EndpointRecord {
  id: string
  method?: string
  url: string
  source: EndpointSource
  evidence: Evidence[]
  statusCode?: number
}

export interface DependencyRecord {
  name: string
  version?: string
  source: string
  license?: string
}

export interface GraphNode {
  id: string
  label: string
  kind: string
}

export interface GraphEdge {
  from: string
  to: string
  kind: string
}

export interface FileRecord {
  path: string
  size: number
  kind: string
}

export interface SkippedCheck {
  check: string
  reason: string
}

export interface AnalysisResult {
  metadata: Record<string, string>
  components: ComponentRecord[]
  findings: Finding[]
  endpoints: EndpointRecord[]
  dependencies: DependencyRecord[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  files: FileRecord[]
  logs: string[]
  skipped: SkippedCheck[]
  limitations: string[]
  runtimeEvents: string[]
  screenshotPaths: string[]
}

export function emptyAnalysisResult(): AnalysisResult {
  return {
    metadata: {},
    components: [],
    findings: [],
    endpoints: [],
    dependencies: [],
    graph: { nodes: [], edges: [] },
    files: [],
    logs: [],
    skipped: [],
    limitations: [],
    runtimeEvents: [],
    screenshotPaths: []
  }
}

export function mergeAnalysisResults(parts: AnalysisResult[]): AnalysisResult {
  const merged = emptyAnalysisResult()
  for (const part of parts) {
    for (const [key, value] of Object.entries(part.metadata)) {
      if (merged.metadata[key] === undefined) {
        merged.metadata[key] = value
      }
    }
    merged.components.push(...part.components)
    merged.findings.push(...part.findings)
    merged.endpoints.push(...part.endpoints)
    merged.dependencies.push(...part.dependencies)
    merged.graph.nodes.push(...part.graph.nodes)
    merged.graph.edges.push(...part.graph.edges)
    merged.files.push(...part.files)
    merged.logs.push(...part.logs)
    merged.skipped.push(...part.skipped)
    merged.limitations.push(...part.limitations)
    merged.runtimeEvents.push(...part.runtimeEvents)
    merged.screenshotPaths.push(...part.screenshotPaths)
  }
  return merged
}
