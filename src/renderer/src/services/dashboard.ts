import type { DashboardSnapshot } from '@shared/types/jobs'

export function getEmptyDashboardSnapshot(): DashboardSnapshot {
  return {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    runningJobs: 0,
    recentJobs: [],
    recentFindings: [],
    engines: [],
    connectedDevices: []
  }
}
