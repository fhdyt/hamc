import type { Route } from '../stores/ui'

export interface NavItem {
  id: Route
  label: string
  icon: string
  key: string
  sepBefore?: boolean
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout', key: '1' },
  { id: 'chat', label: 'Chat', icon: 'message', key: '2' },
  { id: 'feed', label: 'Live feed', icon: 'activity', key: '3' },
  { id: 'sessions', label: 'Sessions', icon: 'history', key: '4', sepBefore: true },
  { id: 'kanban', label: 'Kanban', icon: 'kanban', key: '5' },
  { id: 'usage', label: 'Usage', icon: 'chart', key: '6' },
  { id: 'skills', label: 'Skills', icon: 'layers', key: '7', sepBefore: true },
  { id: 'logs', label: 'Logs', icon: 'file-text', key: '8' },
  { id: 'brain', label: 'Second brain', icon: 'share', key: '9' },
  { id: 'server', label: 'Server', icon: 'server', key: '0' }
]

export function routeForShortcut(digit: string): Route | null {
  return NAV.find((n) => n.key === digit)?.id ?? null
}
