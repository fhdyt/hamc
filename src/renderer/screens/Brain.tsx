import { useRef, useState } from 'react'
import { saveGraphSettings } from '../actions'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { EmptyState, ErrorState, Skeleton } from '../components/States'
import type { GraphEngine } from '../graph/engine'
import { BrainCanvas } from '../graph/BrainCanvas'
import { useBrainGraph } from '../hooks/useBrainGraph'
import { useBrain } from '../stores/brain'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'
import { Controls } from './brain/Controls'
import { NotePreview } from './brain/NotePreview'
import { VaultSetup } from './brain/VaultSetup'

export function Brain() {
  const loaded = useBrain((s) => s.loaded)
  const vault = useBrain((s) => s.vault)
  const phase = useBrain((s) => s.phase)
  const error = useBrain((s) => s.error)
  const noteCount = useBrain((s) => s.notes.size)
  const total = useBrain((s) => s.total)
  const truncated = useBrain((s) => s.truncated)
  const hovered = useBrain((s) => s.hovered)
  const selected = useBrain((s) => s.selected)
  const pulse = useBrain((s) => s.pulse)
  const local = useBrain((s) => s.local)
  const setHover = useBrain((s) => s.setHover)
  const select = useBrain((s) => s.select)
  const setLocal = useBrain((s) => s.setLocal)
  const search = useBrain((s) => s.search)
  const g = useUi((s) => s.settings['brain.graph'])
  const connState = useConn((s) => s.status.state)
  const { graph, style, forces } = useBrainGraph()
  const engine = useRef<GraphEngine | null>(null)
  const [changing, setChanging] = useState(false)

  const head = (
    <div className="bh">
      <h1 className="page-title">Second brain</h1>
      {vault && (
        <>
          <button type="button" className={`ib ${g.controlsOpen ? 'on' : ''}`} aria-pressed={g.controlsOpen} aria-label="Toggle graph controls" title="Graph controls" onClick={() => saveGraphSettings({ controlsOpen: !g.controlsOpen })}>
            <Icon name="panel-left" size={15} />
          </button>
          <button type="button" className="ib sm" aria-label="Change vault" title="Change vault folder" onClick={() => setChanging(true)}>
            <Icon name="folder" size={13} />
          </button>
          <span className="bh-note" title={vault}>
            {noteCount.toLocaleString('en-US')}
            {truncated ? '+' : ''} notes · {graph.edges.length.toLocaleString('en-US')} links
          </span>
          {truncated && <span className="bh-warn">Large vault: only the first {total.toLocaleString('en-US')} notes are shown.</span>}
          <span className="bh-live" style={{ color: phase === 'live' && connState === 'connected' ? '#8BE9FD' : '#8B95BD' }}>
            <span className="dot" style={{ background: phase === 'live' && connState === 'connected' ? '#8BE9FD' : '#8B95BD' }} aria-hidden="true" />
            {phase === 'live' && connState === 'connected' ? 'live' : phase === 'loading' ? 'reading' : 'paused'}
          </span>
          <button type="button" className="ib sm" aria-label="Fit all nodes" title="Fit all nodes" onClick={() => engine.current?.fit()}>
            <Icon name="maximize" size={13} />
          </button>
          <button type="button" className={`ib ${g.previewOpen ? 'on' : ''}`} aria-pressed={g.previewOpen} aria-label="Toggle note preview" title="Note preview" onClick={() => saveGraphSettings({ previewOpen: !g.previewOpen })}>
            <Icon name="panel-right" size={15} />
          </button>
        </>
      )}
    </div>
  )

  let body
  if (!loaded) body = <Skeleton rows={6} />
  else if (!vault) body = connState === 'connected' ? <VaultSetup initial="" onDone={() => {}} /> : <EmptyState title="Not connected" why="Connect to your server to choose a vault folder." />
  else if (phase === 'error') {
    body = (
      <ErrorState title="The vault cannot be read" why={error ?? 'The folder is missing or not readable.'}>
        <button type="button" className="cb" onClick={() => setChanging(true)}>
          Change vault folder
        </button>
      </ErrorState>
    )
  } else if (phase === 'loading' && noteCount === 0) body = <Skeleton rows={6} />
  else if (noteCount === 0) body = <EmptyState title="No notes in this folder" why="The vault has no .md files yet. New notes appear here as soon as they are written." />

  return (
    <div className="page brain-page">
      {head}
      {body ? (
        <div className="bp-state">{body}</div>
      ) : (
        <div className="bp-main">
          {g.controlsOpen && <Controls />}
          <section className="bp-canvas" aria-label="Graph">
            {local && (
              <div className="bp-banner" role="status">
                Local graph of <strong>{useBrain.getState().notes.get(local.id)?.title ?? local.id}</strong> · depth {local.depth}
                <button type="button" className="cb" onClick={() => setLocal(null)}>
                  Show all
                </button>
              </div>
            )}
            <BrainCanvas graph={graph} style={style} forces={forces} hovered={hovered} selected={selected} pulse={pulse} engineRef={engine} onHover={setHover} onSelect={select} />
            {graph.nodes.length === 0 && (
              <div className="bp-empty">
                <EmptyState title="Nothing to show" why={search ? 'No note matches the search.' : 'The current filters hide every note.'} />
              </div>
            )}
          </section>
          {g.previewOpen && <NotePreview />}
        </div>
      )}
      {changing && (
        <Modal title="Vault folder" onClose={() => setChanging(false)} width={620}>
          <VaultSetup initial={vault ?? ''} onDone={() => setChanging(false)} onCancel={() => setChanging(false)} />
        </Modal>
      )}
    </div>
  )
}
