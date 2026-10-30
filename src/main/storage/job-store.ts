import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DashboardSnapshot, JobRecord } from '../../shared/types/jobs'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { resolveReaLauncher } from '../../engines/rea/cli'

interface StoreFile {
  jobs: JobRecord[]
}

export class JobStore {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true })
    if (!existsSync(filePath)) {
      this.write({ jobs: [] })
    }
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoreFile
      return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] }
    } catch {
      return { jobs: [] }
    }
  }

  private write(data: StoreFile): void {
    writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }

  list(): JobRecord[] {
    return this.read().jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): JobRecord | undefined {
    return this.read().jobs.find((job) => job.id === id)
  }

  upsert(job: JobRecord): JobRecord {
    const data = this.read()
    const index = data.jobs.findIndex((item) => item.id === job.id)
    if (index >= 0) {
      data.jobs[index] = job
    } else {
      data.jobs.push(job)
    }
    this.write(data)
    return job
  }

  clear(): void {
    this.write({ jobs: [] })
  }

  snapshot(
    engines: AnalysisEngineRuntime[],
    devices: DashboardSnapshot['connectedDevices']
  ): DashboardSnapshot {
    const jobs = this.list()
    const findings = jobs.flatMap((job) =>
      (job.result?.findings ?? []).map((finding) => ({
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        engineId: finding.engineId
      }))
    )
    return {
      totalJobs: jobs.length,
      completedJobs: jobs.filter((job) => job.status === 'completed').length,
      failedJobs: jobs.filter((job) => job.status === 'failed').length,
      runningJobs: jobs.filter((job) => job.status === 'running' || job.status === 'queued').length,
      recentJobs: jobs.slice(0, 8).map((job) => ({
        id: job.id,
        targetLabel: job.targetLabel,
        targetType: job.targetType,
        status: job.status,
        createdAt: job.createdAt
      })),
      recentFindings: findings.slice(0, 8),
      engines: engines.map((engine) => ({
        id: engine.descriptor.id,
        displayName: engine.descriptor.displayName,
        status:
          engine.descriptor.id === 'rea-cli'
            ? resolveReaLauncher()
              ? 'available'
              : 'unavailable'
            : 'available',
        version: engine.descriptor.version
      })),
      connectedDevices: devices
    }
  }
}

export function jobStorePath(userData: string): string {
  return join(userData, 'uaa-jobs.json')
}
