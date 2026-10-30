type BadgeStatus = 'available' | 'planned' | 'unavailable'

interface StatusBadgeProps {
  status: BadgeStatus
}

const LABELS: Record<StatusBadgeProps['status'], string> = {
  available: 'Available',
  planned: 'Planned',
  unavailable: 'Unavailable'
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const className = status === 'available' ? 'badge badge-available' : 'badge badge-planned'
  return <span className={className}>{LABELS[status]}</span>
}
