import { useEffect, useRef, useState } from 'react'
import type { AgentInfo, FeedKind } from '@shared/events'
import { Icon } from '../../components/Icon'
import { agentColor } from '../../lib/agentColor'
import { DEFAULT_FILTER, KINDS, KIND_COLOR, KIND_NAME, type FeedFilter } from '../../lib/feed'
import { useFeed } from '../../stores/feed'

const MAX_AGENT_CHIPS = 8

function Chip({ pressed, onClick, children, color }: { pressed: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button type="button" className="fchip" aria-pressed={pressed} onClick={onClick} style={pressed && color ? { borderColor: color, color } : undefined}>
      {children}
    </button>
  )
}

/** A checkbox list in a popover, for filters with too many values to show as chips. */
function FilterMenu({ label, options, hidden, onToggle }: { label: string; options: { id: string; label: string; color?: string }[]; hidden: readonly string[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const shown = options.filter((o) => !hidden.includes(o.id)).length
  return (
    <div className="fmenu" ref={ref}>
      <button type="button" className="fchip" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label} {shown}/{options.length}
        <Icon name={open ? 'chev-up' : 'chev-down'} size={11} />
      </button>
      {open && (
        <div className="fmenu-pop" role="group" aria-label={label}>
          {options.map((o) => (
            <label key={o.id} className="fmenu-row">
              <input type="checkbox" checked={!hidden.includes(o.id)} onChange={() => onToggle(o.id)} />
              {o.color && <span className="dot" style={{ background: o.color }} aria-hidden="true" />}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function FeedFilters({ agents, sources, names }: { agents: readonly AgentInfo[]; sources: readonly string[]; names: Record<string, string> }) {
  const filter = useFeed((s) => s.filter)
  const toggleAgent = useFeed((s) => s.toggleAgent)
  const toggleKind = useFeed((s) => s.toggleKind)
  const toggleSource = useFeed((s) => s.toggleSource)
  const setFilter = useFeed((s) => s.setFilter)
  const resetFilter = useFeed((s) => s.resetFilter)
  const active = filter !== DEFAULT_FILTER && (filter.hiddenAgents.length > 0 || filter.hiddenKinds.length > 0 || filter.hiddenSources.length > 0 || filter.query !== '')
  const agentOptions = agents.map((a) => ({ id: a.profile, label: names[a.profile] ?? a.profile, color: agentColor(a.profile) }))

  return (
    <div className="ffilters" role="search" aria-label="Feed filters">
      {agents.length > MAX_AGENT_CHIPS ? (
        <FilterMenu label="Agents" options={agentOptions} hidden={filter.hiddenAgents} onToggle={toggleAgent} />
      ) : (
        agentOptions.map((o) => (
          <Chip key={o.id} pressed={!filter.hiddenAgents.includes(o.id)} onClick={() => toggleAgent(o.id)} color={o.color}>
            <span className="dot" style={{ background: o.color }} aria-hidden="true" />
            {o.label}
          </Chip>
        ))
      )}
      <span className="fsep" aria-hidden="true" />
      {KINDS.map((k: FeedKind) => (
        <Chip key={k} pressed={!filter.hiddenKinds.includes(k)} onClick={() => toggleKind(k)} color={KIND_COLOR[k]}>
          {KIND_NAME[k]}
        </Chip>
      ))}
      {sources.length > 1 && <FilterMenu label="Sources" options={sources.map((s) => ({ id: s, label: s }))} hidden={filter.hiddenSources} onToggle={toggleSource} />}
      {active && (
        <button type="button" className="fchip reset" onClick={resetFilter}>
          Reset filters
        </button>
      )}
      <label className="vh" htmlFor="feed-search">
        Search the feed
      </label>
      <input
        id="feed-search"
        type="search"
        className="fld fsearch"
        placeholder="Search"
        value={filter.query}
        onChange={(e) => setFilter({ query: e.target.value } satisfies Partial<FeedFilter>)}
      />
    </div>
  )
}
