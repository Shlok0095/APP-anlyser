import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { JobRecord } from '@shared/types/jobs'
import { PageHeader } from '../layouts/PageHeader'
import { getDesktopApi } from '../services/desktop-api'

export function JobDetailPage() {
  const { jobId } = useParams()
  const [job, setJob] = useState<JobRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = getDesktopApi()
    if (!api || !jobId) {
      setError('Job is unavailable outside the desktop shell.')
      return
    }
    void api
      .getJob(jobId)
      .then((next) => setJob(next))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [jobId])

  if (error) {
    return <p className="muted">{error}</p>
  }
  if (!job) {
    return <p className="muted">Loading job…</p>
  }
  const result = job.result
  return (
    <div className="job-detail-page">
      <PageHeader
        title={job.targetLabel}
        description={`${job.status} · engines: ${job.engineIds.join(', ') || 'none'}`}
        actions={
          <Link className="button primary" to={`/report/${job.id}`}>
            Open report
          </Link>
        }
      />
      <section className="card">
        <h2>Process {job.id}</h2>
        <p className="muted">
          {job.createdAt} → {job.completedAt ?? 'running'}
          {job.completedAt
            ? ` · ${Math.max(0, Date.parse(job.completedAt) - Date.parse(job.createdAt))} ms`
            : ''}
        </p>
        <ul className="log-list">
          {(job.processes ?? []).map((step) => (
            <li key={step.processId}>
              {step.processId} · {step.name} · {step.status}
              {step.durationMs !== undefined ? ` · ${step.durationMs}ms` : ''}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Metadata</h2>
        <pre className="code-block">{JSON.stringify(result?.metadata ?? {}, null, 2)}</pre>
      </section>
      <section className="card">
        <h2>Logs</h2>
        <ul className="log-list">
          {job.logs.map((entry) => (
            <li key={`${entry.at}-${entry.message}`}>{entry.message}</li>
          ))}
        </ul>
      </section>
      {job.reportPaths ? (
        <section className="card">
          <h2>Reports and REA workspace</h2>
          {job.reportPaths.markdown ? (
            <p>
              <strong>Full Markdown:</strong> {job.reportPaths.markdown}
            </p>
          ) : null}
          <p className="muted">JSON: {job.reportPaths.json}</p>
          <p className="muted">HTML: {job.reportPaths.html}</p>
          <p className="muted">CSV: {job.reportPaths.csv}</p>
          {job.reportPaths.evidence ? (
            <p className="muted">REA Evidence: {job.reportPaths.evidence}</p>
          ) : null}
          {job.reportPaths.workspace ? (
            <p className="muted">Workspace: {job.reportPaths.workspace}</p>
          ) : null}
          {job.reportPaths.reconstruction ? (
            <p className="muted">Reconstruction: {job.reportPaths.reconstruction}</p>
          ) : null}
          {job.reportPaths.evidenceFolder ? (
            <p className="muted">Evidence folder: {job.reportPaths.evidenceFolder}</p>
          ) : null}
          <div className="theme-row">
            {job.reportPaths.evidenceFolder ? (
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  const folder = job.reportPaths?.evidenceFolder
                  if (folder) {
                    void getDesktopApi()?.openPath(folder)
                  }
                }}
              >
                Open evidence
              </button>
            ) : null}
            {job.reportPaths.markdown ? (
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
                Open process report
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="card">
        <h2>Components ({result?.components.length ?? 0})</h2>
        <ul className="log-list">
          {(result?.components ?? []).slice(0, 80).map((item) => (
            <li key={item.id}>
              {item.name} · {item.kind}
              {item.path ? ` · ${item.path}` : ''}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Endpoints ({result?.endpoints.length ?? 0})</h2>
        <ul className="log-list">
          {(result?.endpoints ?? []).slice(0, 80).map((item) => (
            <li key={item.id}>{item.url}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
