import type { ReactNode } from 'react'
import { TerminalPanel } from '../components/TerminalPanel'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { useClearUnread } from './useClearUnread'

export function Shell({ children }: { children: ReactNode }) {
  useClearUnread()
  return (
    <div className="mc-root">
      <div className="mc-body">
        <Sidebar />
        <div className="mc-col">{children}</div>
      </div>
      <TerminalPanel />
      <StatusBar />
    </div>
  )
}
