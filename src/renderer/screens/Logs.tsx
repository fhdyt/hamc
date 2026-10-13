import { useMemo } from 'react'
import { gatewayBadge } from '../lib/gatewayView'
import { useAgents } from '../stores/agents'
import { useLogs, type LogsTab as Tab } from '../stores/logs'
import { LogsTab } from './logs/LogsTab'
import { GatewayTab } from './logs/GatewayTab'
import { ApprovalsTab } from './logs/ApprovalsTab'

const TABS: { id: Tab; label: string }[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'approvals', label: 'Approvals' }
]

export function Logs() {
  const tab = useLogs((s) => s.tab)
  const setTab = useLogs((s) => s.setTab)
  const agents = useAgents((s) => s.agents)
  const issues = useMemo(() => gatewayBadge(agents), [agents])

  return (
    <div className="lg">
      <h1 className="page-title">Logs</h1>
      <div role="tablist" aria-label="Logs views" className="us-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`lg-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="lg-panel" className="us-tab" onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'gateway' && issues > 0 && (
              <span className="lg-count" aria-label={`${issues} problem${issues === 1 ? '' : 's'}`}>
                {issues}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="lg-panel" aria-labelledby={`lg-tab-${tab}`} className="lg-panel">
        {tab === 'logs' ? <LogsTab /> : tab === 'gateway' ? <GatewayTab /> : <ApprovalsTab />}
      </div>
    </div>
  )
}
