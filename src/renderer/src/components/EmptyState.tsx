import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  children?: ReactNode
}

export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <section className="empty-state card" role="status">
      <h2>{title}</h2>
      <p className="empty-copy">{description}</p>
      {children}
    </section>
  )
}
