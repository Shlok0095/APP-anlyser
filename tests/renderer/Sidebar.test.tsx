import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PRIMARY_NAV } from '@renderer/app/routes'
import { Sidebar } from '@renderer/layouts/Sidebar'

describe('Sidebar', () => {
  it('renders the four primary destinations', () => {
    render(
      <MemoryRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <Sidebar />
      </MemoryRouter>
    )

    expect(PRIMARY_NAV.map((item) => item.label)).toEqual(['Analyze', 'Jobs', 'Report', 'Settings'])
    for (const item of PRIMARY_NAV) {
      expect(screen.getByRole('link', { name: new RegExp(item.label) })).toBeInTheDocument()
    }
  })
})
