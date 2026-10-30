import { useEffect, useState } from 'react'
import { getDesktopApi } from '../services/desktop-api'

export function useJobReport(jobId: string | undefined, revision?: string) {
  const [report, setReport] = useState<{ path: string; content: string } | null>(null)
  const [evidence, setEvidence] = useState<{ path: string; content: string; folder: string } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const api = getDesktopApi()
    if (!api || !jobId) {
      setReport(null)
      setEvidence(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([api.readJobReport(jobId), api.readJobEvidence(jobId)])
      .then(([nextReport, nextEvidence]) => {
        if (!cancelled) {
          setReport(nextReport)
          setEvidence(nextEvidence)
          setError(nextReport || nextEvidence ? null : 'No Markdown report yet.')
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [jobId, revision])

  return { report, evidence, error, loading }
}
