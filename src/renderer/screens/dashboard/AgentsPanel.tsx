import { useEffect, useMemo, useState } from 'react'
import { reorderAgentPin, saveSetting, toggleAgentPin } from '../../actions'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { Resizer } from '../../components/Resizer'
import { useLiveSetting } from '../../hooks/useLiveSetting'
import { EmptyState, Skeleton } from '../../components/States'
import { activeCount, buildRoster, railAgents } from '../../lib/roster'
import { useAgents } from '../../stores/agents'
import { useChat } from '../../stores/chat'
import { useConn } from '../../stores/conn'
import { useAgentCfg } from '../../stores/agentCfg'
import { useUi } from '../../stores/ui'
import { ChatRoom } from '../chat/ChatRoom'
import { AgentDetail, STATUS_COLOR, STATUS_LABEL } from './AgentDetail'

export function AgentsPanel({ width }: { width: number }) {
  const roster = useLiveSetting('dashboard.rosterH')
  const openSettings = useUi((s) => s.openSettings)
  const agents = useAgents((s) => s.agents)
  const pins = useAgents((s) => s.pins)
  const selected = useAgents((s) => s.selected)
  const query = useAgents((s) => s.query)
  const select = useAgents((s) => s.select)
  const setQuery = useAgents((s) => s.setQuery)
  const collapsed = useUi((s) => s.settings['agents.panelCollapsed'])
  const connState = useConn((s) => s.status.state)
  const navigate = useUi((s) => s.navigate)
  const setCurrent = useChat((s) => s.setCurrent)
  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  useEffect(() => setDetails(false), [selected])
  const { rows, showSearch } = useMemo(() => buildRoster(agents, pins, query), [agents, pins, query])
  const online = activeCount(agents)

  if (collapsed) {
    const { shown, more } = railAgents(agents, pins, selected)
    return (
      <section aria-label="Agents (collapsed)" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, overflowY: 'auto', paddingTop: 4 }}>
        <button type="button" className="ib" onClick={() => void saveSetting('agents.panelCollapsed', false)} aria-label="Expand agents panel" title="Expand">
          <Icon name="chevs-left" size={14} />
        </button>
        {shown.map((a) => (
          <button
            key={a.profile}
            type="button"
            className="ib"
            style={{ width: 36, height: 36, position: 'relative' }}
            aria-label={`${a.displayName}, ${STATUS_LABEL[a.status].toLowerCase()}`}
            title={`${a.displayName} · ${STATUS_LABEL[a.status]}`}
            onClick={() => {
              select(a.profile)
              void saveSetting('agents.panelCollapsed', false)
            }}
          >
            <Avatar name={a.displayName} profile={a.profile} size={26} />
            <span className="dot" style={{ position: 'absolute', right: 2, bottom: 2, background: STATUS_COLOR[a.status] }} />
          </button>
        ))}
        {more > 0 && (
          <button type="button" className="ib" style={{ width: 36 }} onClick={() => void saveSetting('agents.panelCollapsed', false)} aria-label={`${more} more agents`} title="Show all agents">
            +{more}
          </button>
        )}
      </section>
    )
  }

  return (
    <section className="card d-agents" aria-label="Agents" style={{ flex: `0 0 ${width}px`, minHeight: 0, overflow: 'hidden' }}>
      <div className="ph">
        <h2>agents</h2>
        <span style={{ color: '#50FA7B', fontSize: 10 }}>{agents.length ? `${online}/${agents.length} online` : ''}</span>
        <span className="ph-actions">
          <button type="button" className="ib sm" onClick={() => {
              useAgentCfg.getState().selectProfile(selected)
              openSettings('agents')
            }} aria-label="Agent settings" title="Agent settings">
            <Icon name="settings" size={13} />
          </button>
          <button type="button" className="ib sm" onClick={() => void saveSetting('agents.panelCollapsed', true)} aria-label="Collapse agents panel" title="Collapse">
            <Icon name="chevs-right" size={14} />
          </button>
        </span>
      </div>

      {showSearch && (
        <div className="ag-search" style={{ flex: 'none' }}>
          <Icon name="search" size={13} />
          <label htmlFor="agent-q" className="vh">Search agents</label>
          <input
            id="agent-q"
            type="text"
            autoComplete="off"
            placeholder="Search agents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter') {
                const first = rows.find((r) => r.kind === 'agent')
                if (first && first.kind === 'agent') select(first.agent.profile)
              }
            }}
          />
          {query && (
            <button type="button" className="ib sm" onClick={() => setQuery('')} aria-label="Clear search" title="Clear (Esc)">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      )}

      <div role="list" aria-label="Agent list" style={{ flex: selected ? `0 0 ${roster.value}px` : '0 1 auto', maxHeight: selected ? undefined : '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {agents.length === 0 ? (
          connState === 'connected' ? <Skeleton rows={4} /> : <EmptyState title="No agents yet" why="Agents appear after the first successful connection." />
        ) : (
          rows.map((r) => {
            if (r.kind === 'head') return <div key={r.key} className="ag-sec" role="presentation">{r.title}</div>
            if (r.kind === 'empty') return <div key={r.key} role="status" style={{ padding: '10px 8px', color: '#A9B2D3', fontSize: 11 }}>{r.title}</div>
            const a = r.agent
            return (
              <div
                key={r.key}
                role="listitem"
                className="ag-row"
                draggable={r.draggable}
                style={{ opacity: dragFrom === a.profile ? 0.5 : 1 }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', a.profile)
                  setDragFrom(a.profile)
                }}
                onDragOver={(e) => {
                  if (dragFrom && r.draggable) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom && dragFrom !== a.profile) void reorderAgentPin(dragFrom, a.profile)
                  setDragFrom(null)
                }}
                onDragEnd={() => setDragFrom(null)}
              >
                <span className="ag-grip" title={r.draggable ? 'Drag to reorder' : undefined} style={{ visibility: r.draggable ? 'visible' : 'hidden' }}>
                  <Icon name="grip" size={13} />
                </span>
                <button type="button" className="ag-pick" aria-pressed={selected === a.profile} aria-label={`${a.displayName}, ${STATUS_LABEL[a.status].toLowerCase()}. Show details`} onClick={() => select(selected === a.profile ? null : a.profile)}>
                  <Avatar name={a.displayName} profile={a.profile} size={20} />
                  <span className="nm">{a.displayName}</span>
                  <span className="st" style={{ color: STATUS_COLOR[a.status] }}>
                    <span className="dot" style={{ background: STATUS_COLOR[a.status] }} />
                    {STATUS_LABEL[a.status]}
                  </span>
                </button>
                <button type="button" className={`ib sm ag-pin ${r.pinned ? 'on' : ''}`} aria-pressed={r.pinned} aria-label={r.pinned ? `Unpin ${a.displayName}` : `Pin ${a.displayName}`} title={r.pinned ? 'Unpin' : 'Pin'} onClick={() => void toggleAgentPin(a.profile)}>
                  <Icon name="pin" size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>

      {selected && (
        <Resizer orientation="horizontal" value={roster.value} min={60} max={480} label="Resize agent list and chat" onChange={roster.onChange} onCommit={roster.onCommit} />
      )}
      {selected && !details ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ChatRoom
            key={selected}
            profile={selected}
            compact
            extra={
              <>
                <button type="button" className="ib sm" onClick={() => setDetails(true)} aria-label="Show agent details" title="Details">
                  <Icon name="info" size={14} />
                </button>
                <button
                  type="button"
                  className="ib sm"
                  onClick={() => {
                    setCurrent(selected)
                    navigate('chat')
                  }}
                  aria-label="Open full chat"
                  title="Open full chat"
                >
                  <Icon name="maximize" size={13} />
                </button>
              </>
            }
          />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <AgentDetail />
          {selected && (
            <button type="button" className="cb" style={{ margin: '0 8px 8px' }} onClick={() => setDetails(false)}>
              <Icon name="message" size={12} /> Back to chat
            </button>
          )}
        </div>
      )}
    </section>
  )
}
