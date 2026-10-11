import { activeCount } from '../../lib/roster'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'

/** The one-line summary above the Cron panel: how many agents are online and how many are working. */
export function AgentCount() {
  const agents = useAgents((s) => s.agents)
  const live = useConn((s) => s.status.state) === 'connected'
  const online = activeCount(agents)
  const working = agents.filter((a) => a.status === 'working').length
  const text = agents.length === 0 ? (live ? 'Looking for agents…' : 'No agent data yet') : `${online}/${agents.length} agents online${working > 0 ? ` · ${working} working` : ''}`
  return (
    <div className="d-count" role="status" aria-live="polite">
      <span className="dot" style={{ background: online > 0 ? '#50FA7B' : '#8B95BD' }} aria-hidden="true" />
      {text}
    </div>
  )
}
