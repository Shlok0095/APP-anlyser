import { Link } from 'react-router-dom'
import { PageHeader } from '../layouts/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { StatusBadge } from '../components/StatusBadge'
import { useJobs } from '../hooks/useJobs'

export function DashboardPage() {
  const { dashboard } = useJobs()
  const snapshot = dashboard ?? {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    runningJobs: 0,
    recentJobs: [],
    recentFindings: [],
    engines: [],
    connectedDevices: []
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Counts come from stored analysis jobs on this device."
        actions={
          <Link className="button primary" to="/">
            Analyze
          </Link>
        }
      />
      <section className="metrics-grid" aria-label="Job counts">
        <article className="metric-card">
          <span>Total jobs</span>
          <strong>{snapshot.totalJobs}</strong>
        </article>
        <article className="metric-card">
          <span>Completed</span>
          <strong>{snapshot.completedJobs}</strong>
        </article>
        <article className="metric-card">
          <span>Failed</span>
          <strong>{snapshot.failedJobs}</strong>
        </article>
        <article className="metric-card">
          <span>Running</span>
          <strong>{snapshot.runningJobs}</strong>
        </article>
      </section>
      <div className="card-grid">
        {snapshot.recentJobs.length === 0 ? (
          <EmptyState
            title="No analyses yet"
            description="Use Analyze to inspect an authorized target."
          />
        ) : (
          <section className="card">
            <h2>Recently analyzed applications</h2>
            {snapshot.recentJobs.map((job) => (
              <div className="kv-row" key={job.id}>
                <span>{job.targetLabel}</span>
                <span className="muted">{job.status}</span>
              </div>
            ))}
          </section>
        )}
        <section className="card">
          <h2>Supported analysis engines</h2>
          {snapshot.engines.map((engine) => (
            <div className="engine-row" key={engine.id}>
              <span>{engine.displayName}</span>
              <StatusBadge status={engine.status === 'available' ? 'available' : 'unavailable'} />
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
