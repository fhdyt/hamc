import { useMemo } from 'react'
import type { BrainNote } from '@shared/events'
import { Icon } from '../../components/Icon'
import { EmptyState } from '../../components/States'
import { ghostId, tagId } from '../../lib/brain/graphModel'
import { useBrain } from '../../stores/brain'
import { NoteLinks, NoteText, useNoteLinks } from './NoteBody'

const DEPTHS = [1, 2, 3]

function when(mtime: number): string {
  return new Date(mtime * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Right-hand panel of the Second brain screen: the selected node. */
export function NotePreview() {
  const selected = useBrain((s) => s.selected)
  const notes = useBrain((s) => s.notes)
  const select = useBrain((s) => s.select)
  const note = selected ? notes.get(selected) : undefined

  if (!selected) {
    return (
      <aside className="bn-preview" aria-label="Note preview">
        <EmptyState title="No note selected" why="Click a node in the graph to read it here." />
      </aside>
    )
  }
  if (note) return <NoteCard note={note} onOpen={select} />
  return <OtherNode id={selected} onOpen={select} />
}

function NoteCard({ note, onOpen }: { note: BrainNote; onOpen(id: string): void }) {
  const local = useBrain((s) => s.local)
  const setLocal = useBrain((s) => s.setLocal)
  const { outgoing, backlinks } = useNoteLinks(note.id)
  const isLocal = local?.id === note.id
  return (
    <aside className="bn-preview" aria-label="Note preview">
      <header className="bn-head">
        <h2 title={note.id}>{note.title}</h2>
        <span className="bn-path">{note.id}</span>
        <span className="bn-meta">modified {when(note.mtime)}</span>
        {note.tags.length > 0 && (
          <span className="bn-tags">
            {note.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </span>
        )}
      </header>
      <div className="bn-local" role="group" aria-label="Local graph">
        <span>Local graph</span>
        {DEPTHS.map((d) => (
          <button key={d} type="button" className="cb sm" aria-pressed={isLocal && local?.depth === d} onClick={() => setLocal(isLocal && local?.depth === d ? null : { id: note.id, depth: d })}>
            {d}
          </button>
        ))}
        {isLocal && (
          <button type="button" className="ib sm" aria-label="Show the whole graph" title="Show the whole graph" onClick={() => setLocal(null)}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      <div className="bn-body">
        <NoteText id={note.id} onOpen={onOpen} />
      </div>
      <NoteLinks title="Backlinks" notes={backlinks} onOpen={onOpen} />
      <NoteLinks title="Outgoing links" notes={outgoing} onOpen={onOpen} />
    </aside>
  )
}

/** A node that is not a note: a missing note, a tag or an attachment. */
function OtherNode({ id, onOpen }: { id: string; onOpen(id: string): void }) {
  const notes = useBrain((s) => s.notes)
  const rows = useMemo(() => {
    const out: BrainNote[] = []
    for (const n of notes.values()) {
      if (id.startsWith('ghost:') && n.ghosts.some((g) => ghostId(g) === id)) out.push(n)
      else if (id.startsWith('tag:') && n.tags.some((t) => tagId(t) === id)) out.push(n)
      else if (id.startsWith('file:') && n.attachments.some((a) => `file:${a.toLowerCase()}` === id)) out.push(n)
    }
    return out.sort((a, b) => a.title.localeCompare(b.title))
  }, [notes, id])
  const kind = id.startsWith('ghost:') ? 'Missing note' : id.startsWith('tag:') ? 'Tag' : id.startsWith('file:') ? 'Attachment' : 'Node'
  const label = id.replace(/^(ghost|tag|file):/, '')
  const why =
    kind === 'Missing note' ? 'Notes link to it, but no file with this name exists in the vault.' : kind === 'Tag' ? 'Notes that carry this tag.' : kind === 'Attachment' ? 'Embedded by these notes. Mission Control does not open attachments.' : ''
  return (
    <aside className="bn-preview" aria-label="Note preview">
      <header className="bn-head">
        <h2>{label}</h2>
        <span className="bn-meta">{kind}</span>
        {why && <span className="bn-meta">{why}</span>}
      </header>
      <NoteLinks title={kind === 'Tag' ? 'Notes with this tag' : 'Linked from'} notes={rows} onOpen={onOpen} />
    </aside>
  )
}
