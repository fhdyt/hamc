import { useEffect, useMemo, useState } from 'react'
import { RANGES, type Range } from '@shared/sessions'
import { agentColor } from '../../lib/agentColor'
import { sortAgents } from '../../lib/roster'
import { setQuery } from '../../sessionsActions'
import { useAgents } from '../../stores/agents'
import { useSessions } from '../../stores/sessions'

const MAX_AGENT_CHIPS = 8
const RANGE_LABEL: Record<Range, string> = { today: 'Today', '7d': 'Last 7 days', '14d': 'Last 14 days', '30d': 'Last 30 days', all: 'All time' }

export function SessionFilters() {
  const query = useSessions((s) => s.query)
  const sources = useSessions((s) => s.sources)
  const agents = useAgents((s) => s.agents)
  const list = useMemo(() => sortAgents(agents), [agents])
  const [text, setText] = useState(query.q)

  // Typing waits 250 ms before it becomes a query; a change from outside (Clear search and filters) shows in the box at once.
  useEffect(() => setText(query.q), [query.q])
  useEffect(() => {
    if (text === useSessions.getState().query.q) return
    const t = window.setTimeout(() => void setQuery({ q: text }), 250)
    return () => window.clearTimeout(t)
  }, [text])

  return (
    <div className="ses-filters" role="search" aria-label="Session filters">
      <div className="ses-searchbox">
        <label className="vh" htmlFor="ses-q">
          Search sessions and messages
        </label>
        <input id="ses-q" type="search" className="fld" autoComplete="off" spellCheck={false} placeholder="Search every message" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="ses-row-filters">
        {list.length > MAX_AGENT_CHIPS ? (
          <>
            <label className="vh" htmlFor="ses-agent">
              Agent
            </label>
            <select id="ses-agent" className="fld" value={query.agent} onChange={(e) => void setQuery({ agent: e.target.value })}>
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
            <button type="button" className="fchip ses-chip" aria-pressed={query.agent === 'all'} onClick={() => void setQuery({ agent: 'all' })}>
              All
            </button>
            {list.map((a) => (
              <button key={a.profile} type="button" className="fchip ses-chip" aria-pressed={query.agent === a.profile} onClick={() => void setQuery({ agent: a.profile })}>
                <span className="dot" style={{ background: agentColor(a.profile) }} aria-hidden="true" />
                {a.displayName}
              </button>
            ))}
          </div>
        )}
        <label className="vh" htmlFor="ses-source">
          Source
        </label>
        <select id="ses-source" className="fld" value={query.source} onChange={(e) => void setQuery({ source: e.target.value })}>
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          {query.source !== 'all' && !sources.includes(query.source) && <option value={query.source}>{query.source}</option>}
        </select>
        <label className="vh" htmlFor="ses-range">
          Time range
        </label>
        <select id="ses-range" className="fld" value={query.range} onChange={(e) => void setQuery({ range: e.target.value as Range })}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {RANGE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
