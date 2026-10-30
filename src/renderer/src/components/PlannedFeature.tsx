import { StatusBadge } from './StatusBadge'

interface PlannedFeatureProps {
  title: string
  phase: number
  summary: string
  nextWork: string[]
}

export function PlannedFeature({ title, phase, summary, nextWork }: PlannedFeatureProps) {
  return (
    <section className="planned-feature card" role="status">
      <div className="button-row">
        <StatusBadge status="planned" />
        <span className="muted">Phase {phase}</span>
      </div>
      <h2>{title} is not implemented yet</h2>
      <p className="planned-copy">{summary}</p>
      <p className="muted">This screen is a planned destination, not a working analysis tool.</p>
      <ul className="planned-list">
        {nextWork.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
