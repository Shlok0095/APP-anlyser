import { Link } from 'react-router-dom'
import { PageHeader } from '../layouts/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { useJobs } from '../hooks/useJobs'
import { getDesktopApi } from '../services/desktop-api'

export function HistoryPage() {
  const { jobs, error } = useJobs()
  return (
    <div className="jobs-page">
      <PageHeader title="Jobs" description="Every analysis on this device." />
      {error ? <p className="muted">{error}</p> : null}
      {jobs.length === 0 ? (
        <EmptyState title="No jobs" description="Run an analysis from Analyze." />
      ) : (
        <section className="card jobs-list">
          {jobs.map((job) => (
            <div className="kv-row" key={job.id}>
              <div>
                <strong>{job.targetLabel}</strong>
                <p className="muted">
                  {job.status} · {job.targetType} · {job.id.slice(0, 8)}
                </p>
              </div>
              <div className="theme-row">
                <Link className="button primary" to={`/report/${job.id}`}>
                  Report
                </Link>
                {job.reportPaths?.markdown ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      const file = job.reportPaths?.markdown
                      if (file) {
                        void getDesktopApi()?.openPath(file)
                      }
                    }}
                  >
                    Open file
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
