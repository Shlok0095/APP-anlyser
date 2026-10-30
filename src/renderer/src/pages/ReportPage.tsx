import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../layouts/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { MarkdownView } from '../components/MarkdownView'
import { getDesktopApi } from '../services/desktop-api'
import { latestCompleted, useJobs } from '../hooks/useJobs'
import { useJobReport } from '../hooks/useJobReport'

export function ReportPage() {
  const { jobId } = useParams()
  const { jobs, error } = useJobs()
  const job = useMemo(() => {
    if (jobId) {
      return jobs.find((item) => item.id === jobId)
    }
    return latestCompleted(jobs) ?? jobs[0]
  }, [jobs, jobId])
  const { report, evidence, error: reportError, loading } = useJobReport(
    job?.id,
    job?.updatedAt
  )
  const [tab, setTab] = useState<'evidence' | 'report'>('evidence')

  if (error) {
    return <p className="muted">{error}</p>
  }
  if (!job) {
    return (
      <EmptyState
        title="No report yet"
        description="Run an analysis from Analyze. Evidence and the process report open here when it finishes."
      />
    )
  }

  const active = tab === 'evidence' ? evidence : report
  const openPath = tab === 'evidence' ? evidence?.folder ?? evidence?.path : report?.path

  return (
    <div className="report-page">
      <PageHeader
        title={job.targetLabel}
        description={`${job.status} · process ${job.id}`}
        actions={
          <div className="theme-row">
            {openPath ? (
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  void getDesktopApi()?.openPath(openPath)
                }}
              >
                {tab === 'evidence' ? 'Open evidence folder' : 'Open file'}
              </button>
            ) : null}
            <Link className="button" to={`/jobs/${job.id}`}>
              Details
            </Link>
          </div>
        }
      />
      <div className="report-tabs">
        <button
          type="button"
          className={tab === 'evidence' ? 'chip selected' : 'chip'}
          onClick={() => setTab('evidence')}
        >
          Evidence
        </button>
        <button
          type="button"
          className={tab === 'report' ? 'chip selected' : 'chip'}
          onClick={() => setTab('report')}
        >
          Process report
        </button>
      </div>
      {reportError && !active ? <p className="status-error">{reportError}</p> : null}
      {active ? (
        <MarkdownView text={active.content} />
      ) : (
        <p className="muted">
          {loading
            ? 'Loading…'
            : tab === 'evidence'
              ? 'No reconstruction pack yet.'
              : 'No Markdown yet.'}
        </p>
      )}
    </div>
  )
}
