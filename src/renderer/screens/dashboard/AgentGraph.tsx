import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InteractionKind } from '@shared/events'
import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { EmptyState, Skeleton } from '../../components/States'
import { useStalled } from '../../hooks/useStalled'
import { KIND_COLOR, KIND_LABEL, KINDS, RANGE_LABEL, buildGraph, describeNode, filterData, type Range } from '../../lib/agentGraph'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useGroups } from '../../stores/groups'
import { withRoomNames } from '../../lib/groupView'
import { useInteractions } from '../../stores/interactions'
import { useUi } from '../../stores/ui'
import { AgentGraphSvg, type SvgHandle } from './AgentGraphSvg'
import { InteractionCard } from './InteractionCard'

const RANGES: Range[] = ['1h', '24h', '7d']

/** Seconds since the epoch, refreshed every few seconds so that "active" fades out without new data. */
function useNowSeconds(): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 5000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const on = (): void => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/** The "agents" tab of the Dashboard graph panel: who hands tasks to whom, messages whom, shares a room or delegates (F-AGRAPH). */
export function AgentGraph({ tabs }: { tabs: ReactNode }) {
  const data = useInteractions((s) => s.data)
  const selected = useInteractions((s) => s.selected)
  const select = useInteractions((s) => s.select)
  const roster = useAgents((s) => s.agents)
  const cfg = useUi((s) => s.settings['dashboard.agentGraph'])
  const reduce = useUi((s) => s.settings['ui.reduceMotion'])
  const connState = useConn((s) => s.status.state)
  const now = useNowSeconds()
  const visible = useVisible()
  const handle = useRef<SvgHandle | null>(null)
  const connected = connState === 'connected'
  const stalled = useStalled(data === null && (connected || connState === 'connecting'))

  const rooms = useGroups((s) => s.rooms)
  const graph = useMemo(
    () => (data ? buildGraph(roster.map((a) => ({ profile: a.profile, displayName: a.displayName, status: a.status })), filterData(withRoomNames(data, rooms), cfg.kinds, cfg.range, now), now) : null),
    [data, roster, rooms, cfg.kinds, cfg.range, now]
  )
  const edge = graph && selected?.type === 'edge' ? (graph.edges.find((e) => e.id === selected.id) ?? null) : null
  const node = graph && selected?.type === 'node' ? (graph.nodes.find((n) => n.id === selected.id) ?? null) : null
  const labelOf = (id: string): string => graph?.nodes.find((n) => n.id === id)?.label ?? id
  // A selection that the filters or a new snapshot took out of the drawing is dropped, so it cannot come back by itself.
  const missing = graph !== null && selected !== null && !edge && !node
  useEffect(() => {
    if (missing) select(null)
  }, [missing, select])

  const toggle = (k: InteractionKind): void => {
    const kinds = cfg.kinds.includes(k) ? cfg.kinds.filter((x) => x !== k) : KINDS.filter((x) => x === k || cfg.kinds.includes(x))
    void saveSetting('dashboard.agentGraph', { ...cfg, kinds })
  }

  let body: ReactNode = null
  if (!data) {
    body = !connected && connState !== 'connecting' ? <EmptyState title="No data yet" why="Connect to your server to see how your agents work together." /> : stalled ? <EmptyState title="Still waiting for the server" why="The server has not sent interaction data yet. The collector errors, if any, are in the app log." /> : <Skeleton rows={4} />
  } else if (graph && graph.edges.length === 0) {
    const none = data.edges.length === 0
    body = (
      <EmptyState
        title={none ? 'No interactions yet' : 'Nothing in this view'}
        why={none ? 'Agents show up connected here when they hand tasks over on the kanban board, message each other, share a group room or delegate to subagents.' : `No interactions of the chosen kinds in the last ${RANGE_LABEL[cfg.range]}. Widen the time range or turn more kinds on.`}
      >
        {none && (
          <ul className="ag-sources" aria-label="Sources read from the server">
            {KINDS.map((k) => (
              <li key={k}>
                <i style={{ background: KIND_COLOR[k] }} aria-hidden="true" /> {KIND_LABEL[k]}: {data.sources[k].state}
                {data.sources[k].unresolved > 0 ? ` · ${data.sources[k].unresolved} unresolved` : ''}
              </li>
            ))}
          </ul>
        )}
      </EmptyState>
    )
  }
  const broken = data ? KINDS.filter((k) => data.sources[k].state === 'unreadable') : []

  return (
    <section className="d-graph ag" aria-label="Agent interactions">
      <div className="d-graph-bar">
        {tabs}
        <div className="ag-kinds" role="group" aria-label="Kinds of interaction">
          {KINDS.map((k) => (
            <button key={k} type="button" className="ag-kind" aria-pressed={cfg.kinds.includes(k)} onClick={() => toggle(k)}>
              <i style={{ background: KIND_COLOR[k] }} aria-hidden="true" />
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="vh" htmlFor="ag-range">
          Time range
        </label>
        <select id="ag-range" className="ag-range" value={cfg.range} onChange={(e) => void saveSetting('dashboard.agentGraph', { ...cfg, range: e.target.value as Range })}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {RANGE_LABEL[r]}
            </option>
          ))}
        </select>
        {graph && !body && (
          <span className="d-graph-meta">
            {graph.edges.length} interactions · <span style={{ color: connected ? '#8BE9FD' : '#8B95BD' }}>● {connected ? 'live' : 'paused'}</span>
          </span>
        )}
        {broken.length > 0 && <span className="d-graph-meta" style={{ color: '#FFB86C' }}>{broken.join(', ')} unreadable</span>}
        <span className="d-graph-actions">
          {graph && !body && (
            <button type="button" className="ib sm" onClick={() => handle.current?.fit()} aria-label="Fit all nodes" title="Fit all nodes">
              <Icon name="maximize" size={13} />
            </button>
          )}
        </span>
      </div>
      {body ? (
        <div className="d-graph-state">{body}</div>
      ) : (
        graph && (
          <div className="ag-stage">
            <AgentGraphSvg graph={graph} selected={selected} animate={!reduce && visible} onSelect={select} handle={handle} />
          </div>
        )
      )}
      {(edge || node) && graph && <InteractionCard edge={edge} node={node} counts={describeNode((edge ?? node)!.id, graph.edges)} labelOf={labelOf} onClose={() => select(null)} />}
    </section>
  )
}
