import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mc-root">
      <div className="mc-body">
        <Sidebar />
        <div className="mc-col">{children}</div>
      </div>
      <StatusBar />
    </div>
  )
}
