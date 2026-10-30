import { useCallback, useEffect, useState } from 'react'
import type { DashboardSnapshot, JobRecord } from '@shared/types/jobs'
import { getDesktopApi } from '../services/desktop-api'

export function useJobs() {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const api = getDesktopApi()
    if (!api) {
      setError('Desktop API unavailable.')
      return
    }
    const [nextJobs, nextDash] = await Promise.all([api.listJobs(), api.getDashboard()])
    setJobs(nextJobs)
    setDashboard(nextDash)
    setError(null)
  }, [])

  useEffect(() => {
    void refresh()
    const api = getDesktopApi()
    if (!api) {
      return
    }
    return api.onJobEvent(() => {
      void refresh()
    })
  }, [refresh])

  return { jobs, dashboard, error, refresh }
}

export function latestCompleted(jobs: JobRecord[]): JobRecord | undefined {
  return jobs.find((job) => job.status === 'completed' && job.result)
}
