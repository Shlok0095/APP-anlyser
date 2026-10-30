import { NavLink } from 'react-router-dom'
import { PRIMARY_NAV } from '../app/routes'

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="none"
              stroke="#cccccc"
              strokeWidth="1.8"
              d="M5 19 12 5l7 14M8.2 13h7.6"
            />
          </svg>
        </div>
        <div className="brand-copy">
          <strong>Analyzer</strong>
          <span>Local</span>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Primary">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
