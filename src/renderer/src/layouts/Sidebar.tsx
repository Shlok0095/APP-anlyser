import { NavLink } from 'react-router-dom'
import appIcon from '../assets/app-icon.png'
import { PRIMARY_NAV } from '../app/routes'

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">
          <img src={appIcon} alt="" width={36} height={36} />
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
