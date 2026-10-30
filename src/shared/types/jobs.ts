import type { AnalysisInput, AnalysisProfile, TargetType } from './engine'
import type { AnalysisResult } from './analysis'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobLogEntry {
  at: string
  message: string
}

export interface AnalysisProcessStep {
  processId: string
  name: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  status: 'running' | 'ok' | 'skipped' | 'failed'
  detail?: string
}

export interface JobRecord {
  id: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  status: JobStatus
  targetType: TargetType
  targetLabel: string
  input: AnalysisInput
  profile: AnalysisProfile
  engineIds: string[]
  engineVersions: Record<string, string>
  progressLabel?: string
  progressPercent?: number
  logs: JobLogEntry[]
  processes: AnalysisProcessStep[]
  warnings: string[]
  errors: string[]
  result?: AnalysisResult
  reportPaths?: {
    json?: string
    html?: string
    csv?: string
    markdown?: string
    evidence?: string
    workspace?: string
    reconstruction?: string
    evidenceFolder?: string
  }
}

export interface DashboardJobSummary {
  id: string
  targetLabel: string
  targetType: string
  status: JobStatus
  createdAt: string
}

export interface DashboardFindingSummary {
  id: string
  title: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  engineId: string
}

export interface DashboardEngineStatus {
  id: string
  displayName: string
  status: 'available' | 'planned' | 'unavailable'
  version?: string
}

export interface DashboardDeviceSummary {
  id: string
  label: string
  status: string
}

export interface DashboardSnapshot {
  totalJobs: number
  completedJobs: number
  failedJobs: number
  runningJobs: number
  recentJobs: DashboardJobSummary[]
  recentFindings: DashboardFindingSummary[]
  engines: DashboardEngineStatus[]
  connectedDevices: DashboardDeviceSummary[]
}

export interface JobEvent {
  jobId: string
  type: 'created' | 'updated' | 'log' | 'progress' | 'completed' | 'failed' | 'cancelled'
  message?: string
  percent?: number
  job?: JobRecord
}
