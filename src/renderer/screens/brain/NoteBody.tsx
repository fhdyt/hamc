import { useEffect, useMemo, useState } from 'react'
import type { BrainNote } from '@shared/events'
import { ErrorState, Skeleton } from '../../components/States'
import { backlinksOf, resolveNoteId } from '../../lib/brain/graphModel'
import { renderNote } from '../../lib/brain/markdown'
import { describeQueryError } from '../../lib/queryError'
import { useBrain } from '../../stores/brain'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; html: string; truncated: boolean }


/** The rendered text of a note with its links; `onOpen` is called with the id of a note that a link points to. */
export function NoteText({ id, onOpen }: { id: string; onOpen(id: string): void }) {
  const mtime = useBrain((s) => s.notes.get(id)?.mtime ?? 0)
  const notes = useBrain((s) => s.notes)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setLoad({ status: 'loading' })
    void window.mc.brain.note(id).then((res) => {
      if (!live) return
      setLoad(res.ok ? { status: 'ok', html: renderNote(res.data.text), truncated: res.data.truncated } : { status: 'error', message: describeQueryError(res.error, res.detail) })
    })
    return () => {
      live = false
    }
  }, [id, mtime, attempt])

  const click = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const target = a.getAttribute('data-note')
    if (!target) return
    const hit = resolveNoteId(notes.values(), target)
    if (hit) onOpen(hit)
  }

  if (load.status === 'loading') return <Skeleton rows={5} />
  if (load.status === 'error') return <ErrorState title="Could not open the note" why={load.message} onRetry={() => setAttempt(attempt + 1)} />
  return (
    <>
      <div className="md-note" onClick={click} dangerouslySetInnerHTML={{ __html: load.html }} />
      {load.truncated && <span className="fcount">Showing the first 256 KiB of a long note.</span>}
    </>
  )
}

export function NoteLinks({ title, notes, onOpen }: { title: string; notes: readonly BrainNote[]; onOpen(id: string): void }) {
  if (notes.length === 0) return null
  const titles = new Map<string, number>()
  for (const n of notes) titles.set(n.title, (titles.get(n.title) ?? 0) + 1)
  return (
    <section aria-label={title} className="bn-links">
      <h3>
        {title} <span className="num">{notes.length}</span>
      </h3>
      <div role="list">
        {notes.map((n) => (
          <div key={n.id} role="listitem">
            <button type="button" className="bn-link" title={n.id} onClick={() => onOpen(n.id)}>
              {(titles.get(n.title) ?? 0) > 1 ? n.id.replace(/\.md$/, '') : n.title}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Notes this note links to, and notes that link to it. */
export function useNoteLinks(id: string): { outgoing: BrainNote[]; backlinks: BrainNote[] } {
  const notes = useBrain((s) => s.notes)
  return useMemo(() => {
    const me = notes.get(id)
    const outgoing = (me?.links ?? []).map((l) => notes.get(l)).filter((n): n is BrainNote => n !== undefined).sort((a, b) => a.title.localeCompare(b.title))
    return { outgoing, backlinks: backlinksOf(notes.values(), id) }
  }, [notes, id])
}
