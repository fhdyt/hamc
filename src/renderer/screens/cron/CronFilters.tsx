import { useMemo } from 'react'
import type { StatusFilter } from '../../lib/cron'
import { agentLabel } from '../../lib/cron'
import { useAgents } from '../../stores/agents'
import { useCron } from '../../stores/cron'

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'ok', label: 'OK' },
  { value: 'error', label: 'Error' },
  { value: 'never', label: 'Never run' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' }
]

export function CronFilters() {
  const jobs = useCron((s) => s.jobs)
  const filter = useCron((s) => s.filter)
  const setFilter = useCron((s) => s.setFilter)
  const agents = useAgents((s) => s.agents)
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const profiles = useMemo(() => [...new Set(jobs.map((j) => j.profile))].sort(), [jobs])

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} role="search" aria-label="Filter cron jobs">
      <label className="vh" htmlFor="cron-agent">Agent</label>
      <select id="cron-agent" className="fld" value={filter.agent} onChange={(e) => setFilter({ agent: e.target.value })}>
        <option value="all">All agents</option>
        {profiles.map((p) => (
          <option key={p} value={p}>{agentLabel(p, names)}</option>
        ))}
      </select>
      <label className="vh" htmlFor="cron-status">Status</label>
      <select id="cron-status" className="fld" value={filter.status} onChange={(e) => setFilter({ status: e.target.value as StatusFilter })}>
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <label className="vh" htmlFor="cron-q">Search jobs</label>
      <input
        id="cron-q"
        className="fld"
        type="search"
        placeholder="Search jobs"
        autoComplete="off"
        value={filter.query}
        onChange={(e) => setFilter({ query: e.target.value })}
        style={{ minWidth: 200 }}
      />
    </div>
  )
}
