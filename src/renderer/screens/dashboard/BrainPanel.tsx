import { useRef } from 'react'
import { Icon } from '../../components/Icon'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import type { GraphEngine } from '../../graph/engine'
import { BrainCanvas } from '../../graph/BrainCanvas'
import { useBrainGraph } from '../../hooks/useBrainGraph'
import { useBrain } from '../../stores/brain'
import { useConn } from '../../stores/conn'
import { useUi } from '../../stores/ui'

/** The graph panel of the Dashboard: the vault graph fills the panel, a click on a node reads that note in a dialog. */
export function BrainPanel() {
  const loaded = useBrain((s) => s.loaded)
  const vault = useBrain((s) => s.vault)
  const phase = useBrain((s) => s.phase)
  const error = useBrain((s) => s.error)
  const notes = useBrain((s) => s.notes)
  const hovered = useBrain((s) => s.hovered)
  const pulse = useBrain((s) => s.pulse)
  const setHover = useBrain((s) => s.setHover)
  const openNote = useBrain((s) => s.openNote)
  const navigate = useUi((s) => s.navigate)
  const connState = useConn((s) => s.status.state)
  const { graph, style, forces, legend } = useBrainGraph({ plain: true })
  const engine = useRef<GraphEngine | null>(null)
  const live = phase === 'live' && connState === 'connected'

  let body
  if (!loaded) body = connState === 'connected' || connState === 'connecting' ? <Skeleton rows={4} /> : <EmptyState title="No vault yet" why="Connect to your server to see your notes." />
  else if (!vault)
    body = (
      <EmptyState title="No vault chosen" why="Pick the folder with your Obsidian notes to see them as a graph.">
        <button type="button" className="cb" onClick={() => navigate('brain')}>
          Choose vault
        </button>
      </EmptyState>
    )
  else if (phase === 'error') body = <ErrorState title="The vault cannot be read" why={error ?? undefined} onRetry={() => navigate('brain')} />
  else if (notes.size === 0) body = phase === 'loading' ? <Skeleton rows={4} /> : <EmptyState title="No notes yet" why="The vault folder has no .md files." />

  return (
    <section className="d-graph" aria-label="Second brain">
      {body ? (
        <div className="d-graph-state">{body}</div>
      ) : (
        <BrainCanvas graph={graph} style={style} forces={forces} hovered={hovered} selected={null} pulse={pulse} engineRef={engine} onHover={setHover} onSelect={(id) => id && notes.has(id) && openNote(id)} />
      )}
      {!body && legend.length > 0 && (
        <ul className="bp-legend d-legend" aria-label="Colours">
          {legend.map((l) => (
            <li key={l.label}>
              <i style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div className="d-graph-bar">
        <div role="tablist" aria-label="Graph" className="d-gtabs">
          <button type="button" role="tab" aria-selected="true" className="d-gtab">
            <Icon name="share" size={12} /> second brain
          </button>
          <button type="button" role="tab" aria-selected="false" className="d-gtab" disabled title="The agent interaction graph arrives in a later release">
            <Icon name="users" size={12} /> agents
          </button>
        </div>
        {vault && !body && (
          <span className="d-graph-meta">
            {notes.size.toLocaleString('en-US')} notes · {graph.edges.length.toLocaleString('en-US')} links · <span style={{ color: live ? '#8BE9FD' : '#8B95BD' }}>● {live ? 'live' : 'paused'}</span>
          </span>
        )}
        <span className="d-graph-actions">
          {vault && !body && (
            <button type="button" className="ib sm" onClick={() => engine.current?.fit()} aria-label="Fit all nodes" title="Fit all nodes">
              <Icon name="maximize" size={13} />
            </button>
          )}
          <button type="button" className="ib sm" onClick={() => navigate('brain')} aria-label="Open full view" title="Open full view">
            <Icon name="external" size={13} />
          </button>
        </span>
      </div>
    </section>
  )
}
