import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { BrainCanvas } from '../../graph/BrainCanvas'
import { useBrainGraph } from '../../hooks/useBrainGraph'
import { useBrain } from '../../stores/brain'
import { useConn } from '../../stores/conn'
import { useUi } from '../../stores/ui'

/** A compact, read-only copy of the vault graph. A click on a node reads that note in a dialog. */
export function BrainPanel() {
  const loaded = useBrain((s) => s.loaded)
  const vault = useBrain((s) => s.vault)
  const phase = useBrain((s) => s.phase)
  const error = useBrain((s) => s.error)
  const noteCount = useBrain((s) => s.notes.size)
  const hovered = useBrain((s) => s.hovered)
  const pulse = useBrain((s) => s.pulse)
  const setHover = useBrain((s) => s.setHover)
  const openNote = useBrain((s) => s.openNote)
  const notes = useBrain((s) => s.notes)
  const navigate = useUi((s) => s.navigate)
  const connState = useConn((s) => s.status.state)
  const { graph, style, forces } = useBrainGraph({ plain: true })

  const actions = (
    <button type="button" className="ib sm" onClick={() => navigate('brain')} aria-label="Open the second brain" title="Open the second brain">
      <Icon name="maximize" size={13} />
    </button>
  )

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
  else if (noteCount === 0) body = phase === 'loading' ? <Skeleton rows={4} /> : <EmptyState title="No notes yet" why="The vault folder has no .md files." />

  return (
    <Panel variant="card" title="second brain" label="Second brain" className="grow" actions={actions}>
      {body ?? (
        <div className="bp-mini">
          <BrainCanvas
            graph={graph}
            style={style}
            forces={forces}
            hovered={hovered}
            selected={null}
            pulse={pulse}
            mini
            onHover={setHover}
            onSelect={(id) => id && notes.has(id) && openNote(id)}
          />
        </div>
      )}
    </Panel>
  )
}
