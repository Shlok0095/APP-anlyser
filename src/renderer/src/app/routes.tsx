import { FileText, History, ScanSearch, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Analyze', icon: ScanSearch },
  { to: '/jobs', label: 'Jobs', icon: History },
  { to: '/report', label: 'Report', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export const NAV_ITEMS: NavItem[] = PRIMARY_NAV
