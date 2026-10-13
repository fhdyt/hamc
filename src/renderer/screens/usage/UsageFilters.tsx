import { useMemo } from 'react'
import type { Range } from '@shared/sessions'
import { usageDays } from '@shared/usage'
import { agentColor } from '../../lib/agentColor'
import { sortAgents } from '../../lib/roster'
import { setUsageFilter } from '../../usageActions'
import { useAgents } from '../../stores/agents'
import { useUi } from '../../stores/ui'

const MAX_AGENT_CHIPS = 8
const WINDOWS: { value: '7d' | '14d' | '30d'; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' }
]
const VALUE: Record<7 | 14 | 30, '7d' | '14d' | '30d'> = { 7: '7d', 14: '14d', 30: '30d' }

/** The agent and range are the ones every screen shares (F-NAV-8). Usage shows 7, 14 or 30 days. */
export function UsageFilters() {
  const agent = useUi((s) => s.settings['filters.agent'])
  const range = useUi((s) => s.settings['filters.range'])
  const agents = useAgents((s) => s.agents)
  const list = useMemo(() => sortAgents(agents), [agents])
  const current = agent !== 'all' && !list.some((a) => a.profile === agent) ? 'all' : agent

  return (
    <div className="us-filters" role="search" aria-label="Usage filters">
      {list.length > MAX_AGENT_CHIPS ? (
        <>
          <label className="vh" htmlFor="us-agent">
            Agent
          </label>
          <select id="us-agent" className="fld" value={current} onChange={(e) => void setUsageFilter({ agent: e.target.value })}>
            <option value="all">All agents</option>
            {list.map((a) => (
              <option key={a.profile} value={a.profile}>
                {a.displayName}
              </option>
            ))}
          </select>
        </>
      ) : (
        <div className="ses-chips" role="group" aria-label="Agent">
          <button type="button" className="fchip ses-chip" aria-pressed={current === 'all'} onClick={() => void setUsageFilter({ agent: 'all' })}>
            All
          </button>
          {list.map((a) => (
            <button key={a.profile} type="button" className="fchip ses-chip" aria-pressed={current === a.profile} onClick={() => void setUsageFilter({ agent: a.profile })}>
              <span className="dot" style={{ background: agentColor(a.profile) }} aria-hidden="true" />
              {a.displayName}
            </button>
          ))}
        </div>
      )}
      <label className="vh" htmlFor="us-range">
        Time range
      </label>
      <select id="us-range" className="fld" value={VALUE[usageDays(range)]} onChange={(e) => void setUsageFilter({ range: e.target.value as Range })}>
        {WINDOWS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
    </div>
  )
}
