import { describe, expect, it } from 'vitest'
import { getEmptyDashboardSnapshot } from '@renderer/services/dashboard'

describe('dashboard snapshot', () => {
  it('starts empty rather than using sample data', () => {
    const snapshot = getEmptyDashboardSnapshot()
    expect(snapshot.totalJobs).toBe(0)
    expect(snapshot.recentJobs).toEqual([])
    expect(snapshot.recentFindings).toEqual([])
    expect(snapshot.connectedDevices).toEqual([])
  })
})
