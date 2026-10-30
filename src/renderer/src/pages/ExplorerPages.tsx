import { PageHeader } from '../layouts/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { latestCompleted, useJobs } from '../hooks/useJobs'
import { getDesktopApi } from '../services/desktop-api'

export function ComponentsPage() {
  const { jobs } = useJobs()
  const job = latestCompleted(jobs)
  const items = job?.result?.components ?? []
  return (
    <>
      <PageHeader
        title="Component Explorer"
        description="Components come from the latest completed job."
      />
      {items.length === 0 ? (
        <EmptyState title="No components" description="Run a source, APK, or web analysis first." />
      ) : (
        <section className="card">
          {items.map((item) => (
            <div className="kv-row" key={item.id}>
              <span>
                <strong>{item.name}</strong>
                <p className="muted">
                  {item.kind}
                  {item.path ? ` · ${item.path}` : ''}
                </p>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

export function ArchitecturePage() {
  const { jobs } = useJobs()
  const graph = latestCompleted(jobs)?.result?.graph
  return (
    <>
      <PageHeader
        title="Architecture Graph"
        description="Edges are imported or declared relationships, not inferred runtime calls."
      />
      {!graph || graph.nodes.length === 0 ? (
        <EmptyState
          title="No graph"
          description="Run an analysis that extracts imports or package relationships."
        />
      ) : (
        <section className="card">
          <p className="muted">
            {graph.nodes.length} nodes, {graph.edges.length} edges
          </p>
          <ul>
            {graph.edges.slice(0, 80).map((edge, index) => (
              <li key={`${edge.from}-${edge.to}-${index}`}>
                {edge.from} —{edge.kind}→ {edge.to}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export function DependenciesPage() {
  const { jobs } = useJobs()
  const deps = latestCompleted(jobs)?.result?.dependencies ?? []
  return (
    <>
      <PageHeader
        title="Dependency Explorer"
        description="Versions are taken from manifests, not guessed."
      />
      {deps.length === 0 ? (
        <EmptyState
          title="No dependencies"
          description="Analyze a project with package.json, requirements, or compose files."
        />
      ) : (
        <section className="card">
          {deps.map((dep) => (
            <div className="kv-row" key={`${dep.source}-${dep.name}`}>
              <span>{dep.name}</span>
              <span className="muted">
                {dep.version || 'unspecified'} · {dep.source}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

export function ApiPage() {
  const { jobs } = useJobs()
  const endpoints = latestCompleted(jobs)?.result?.endpoints ?? []
  return (
    <>
      <PageHeader
        title="API and Network Inspector"
        description="Source, package, and runtime endpoints are labeled separately."
      />
      {endpoints.length === 0 ? (
        <EmptyState
          title="No endpoints"
          description="No URLs or routes were recovered from the latest job."
        />
      ) : (
        <section className="card">
          {endpoints.map((endpoint) => (
            <div className="kv-row" key={endpoint.id}>
              <span>
                {endpoint.method ? `${endpoint.method} ` : ''}
                {endpoint.url}
              </span>
              <span className="muted">{endpoint.source}</span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

export function SecurityPage() {
  const { jobs } = useJobs()
  const findings = latestCompleted(jobs)?.result?.findings ?? []
  return (
    <>
      <PageHeader
        title="Security Findings"
        description="No findings does not mean an application is secure."
      />
      {findings.length === 0 ? (
        <EmptyState
          title="No findings stored"
          description="Either no analysis has run, or the scanners did not match known patterns."
        />
      ) : (
        <section className="card">
          {findings.map((finding) => (
            <article key={finding.id} className="finding">
              <strong>
                {finding.title} · {finding.severity}
              </strong>
              <p>{finding.explanation}</p>
              <p className="muted">
                {finding.engineId} · confidence {finding.confidence} · {finding.affected}
              </p>
            </article>
          ))}
        </section>
      )}
    </>
  )
}

export function RuntimePage() {
  const { jobs } = useJobs()
  const result = latestCompleted(jobs)?.result
  return (
    <>
      <PageHeader
        title="Runtime Sessions"
        description="Runtime data is only shown when a session actually ran."
      />
      {!result || (result.runtimeEvents.length === 0 && result.screenshotPaths.length === 0) ? (
        <EmptyState
          title="No runtime observations"
          description="Enable runtime on the Analyze screen and use an authorized device or local web target."
        />
      ) : (
        <section className="card">
          <ul>
            {result.runtimeEvents.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export function ReportsPage() {
  const { jobs } = useJobs()
  const withReports = jobs.filter((job) => job.reportPaths)
  return (
    <>
      <PageHeader
        title="Reports and Exports"
        description="Each completed job writes one full Markdown file plus HTML/JSON/CSV next to local artifacts."
      />
      {withReports.length === 0 ? (
        <EmptyState
          title="No reports"
          description="Complete an analysis to generate the full Markdown report plus HTML, JSON, and CSV."
        />
      ) : (
        <section className="card">
          {withReports.map((job) => (
            <div key={job.id}>
              <strong>{job.targetLabel}</strong>
              <p className="muted">Process {job.id}</p>
              <p className="muted">{job.reportPaths?.markdown ?? job.reportPaths?.html}</p>
              <div className="theme-row">
                {job.reportPaths?.markdown ? (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => {
                      const file = job.reportPaths?.markdown
                      if (file) {
                        void getDesktopApi()?.openPath(file)
                      }
                    }}
                  >
                    Open full Markdown
                  </button>
                ) : null}
                {job.reportPaths?.workspace ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      const folder = job.reportPaths?.workspace
                      if (folder) {
                        void getDesktopApi()?.openPath(folder)
                      }
                    }}
                  >
                    Open workspace
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

export function EnginesPage() {
  const { dashboard } = useJobs()
  const engines = dashboard?.engines ?? []
  return (
    <>
      <PageHeader
        title="Analysis Engine Manager"
        description="REA is the primary analyzer. Other engines fill gaps when REA cannot inspect a target."
      />
      {engines.length === 0 ? (
        <EmptyState
          title="Engine list loads in the desktop window"
          description="REA (morluto/rea) is registered first, with local fallback engines for source, APK, web, packages, Docker, and archives."
        />
      ) : (
        <section className="card">
          {engines.map((engine) => (
            <div className="engine-row" key={engine.id}>
              <span>{engine.displayName}</span>
              <span className="muted">
                {engine.version} · {engine.status}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
