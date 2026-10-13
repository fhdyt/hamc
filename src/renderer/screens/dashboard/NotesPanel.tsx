import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { Panel } from '../../components/Panel'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { buildHeatmap, dayKey, dayLabel, noteCount, weeksThatFit, type DaySource, type Heatmap } from '../../lib/brain/heatmap'
import { useBrain } from '../../stores/brain'
import { useConn } from '../../stores/conn'
import { useUi } from '../../stores/ui'

const SOURCE_TEXT: Record<DaySource, string> = {
  frontmatter: 'the created or date field',
  name: 'a date in the file name',
  created: 'the file creation time',
  modified: 'the last change (the server keeps no creation time)'
}

/** Dashboard panel under Cron: a GitHub-style calendar of the days the vault notes were written. */
export function NotesPanel({ style }: { style?: CSSProperties }) {
  const open = useUi((s) => s.settings['dashboard.notesOpen'])
  const navigate = useUi((s) => s.navigate)
  const loaded = useBrain((s) => s.loaded)
  const vault = useBrain((s) => s.vault)
  const phase = useBrain((s) => s.phase)
  const error = useBrain((s) => s.error)
  const notes = useBrain((s) => s.notes)
  const connState = useConn((s) => s.status.state)
  const [full, setFull] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(220)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [open, notes.size > 0])

  const today = dayKey(new Date())
  const weeks = weeksThatFit(width)
  const map = useMemo(() => buildHeatmap(notes.values(), new Date(), weeks), [notes, weeks, today])

  let body
  if (!loaded) body = connState === 'connected' || connState === 'connecting' ? <Skeleton rows={2} /> : <EmptyState title="No vault yet" why="Connect to your server to see your notes." />
  else if (!vault)
    body = (
      <EmptyState title="No vault chosen" why="Pick the folder with your Obsidian notes.">
        <button type="button" className="cb" onClick={() => navigate('brain')}>
          Choose vault
        </button>
      </EmptyState>
    )
  else if (phase === 'error') body = <ErrorState title="The vault cannot be read" why={error ?? undefined} onRetry={() => navigate('brain')} />
  else if (notes.size === 0) body = phase === 'loading' ? <Skeleton rows={2} /> : <EmptyState title="No notes yet" why="The vault folder has no .md files." />

  const meta = notes.size > 0 ? <span title={`${noteCount(map.total)} written in the last ${weeks} weeks`}>{`${map.total} in ${weeks} wk`}</span> : null
  const actions = (
    <>
      <button type="button" className="ib sm" onClick={() => setFull(true)} disabled={notes.size === 0} aria-label="Open the notes calendar for the year" title="The whole year">
        <Icon name="maximize" size={13} />
      </button>
      <button type="button" className="ib sm" aria-expanded={open} aria-label={open ? 'Hide notes calendar' : 'Show notes calendar'} title={open ? 'Hide' : 'Show'} onClick={() => void saveSetting('dashboard.notesOpen', !open)}>
        <Icon name={open ? 'chev-up' : 'chev-down'} size={14} />
      </button>
    </>
  )

  return (
    <Panel variant="card" title="notes" label="Notes calendar" meta={meta} actions={actions} style={style} className="d-panel">
      {open && (body ?? <div ref={box} className="hm-box"><NoteCalendar map={map} /></div>)}
      {full && (
        <Modal title="Notes written per day" onClose={() => setFull(false)} width={780}>
          <YearCalendar onOpenNote={() => setFull(false)} />
        </Modal>
      )}
    </Panel>
  )
}

function YearCalendar({ onOpenNote }: { onOpenNote(): void }) {
  const notes = useBrain((s) => s.notes)
  const map = useMemo(() => buildHeatmap(notes.values(), new Date(), 53), [notes])
  const sources = (Object.keys(map.sources) as DaySource[]).filter((k) => map.sources[k] > 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="hm-sum">
        {noteCount(map.total)} in the last year · {map.activeDays} day{map.activeDays === 1 ? '' : 's'} with new notes · busiest day {noteCount(map.max)}
      </p>
      <NoteCalendar map={map} onOpenNote={onOpenNote} />
      <p className="hm-src">
        Days come from {sources.map((k) => `${SOURCE_TEXT[k]} (${map.sources[k]})`).join(', ')}.
      </p>
    </div>
  )
}

/** The grid (weeks as columns, Sunday on top), the legend and the notes of the picked day. */
function NoteCalendar({ map, onOpenNote }: { map: Heatmap; onOpenNote?(): void }) {
  const openNote = useBrain((s) => s.openNote)
  const days = useMemo(() => map.weeks.flat().filter((c) => !c.future), [map])
  const [picked, setPicked] = useState<string | null>(null)
  const [focus, setFocus] = useState<string>(() => days[days.length - 1]?.day ?? '')
  const grid = useRef<HTMLDivElement>(null)
  const current = days.some((d) => d.day === focus) ? focus : (days[days.length - 1]?.day ?? '')
  const list = picked ? (map.byDay.get(picked) ?? []) : []
  const twins = new Set(list.filter((n, i) => list.findIndex((m) => m.title === n.title) !== i).map((n) => n.title))

  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -days.length, End: days.length }[e.key]
    if (step === undefined) return
    e.preventDefault()
    const i = days.findIndex((d) => d.day === current)
    const next = days[Math.max(0, Math.min(days.length - 1, i + step))]
    if (!next) return
    setFocus(next.day)
    grid.current?.querySelector<HTMLElement>(`[data-day="${next.day}"]`)?.focus()
  }

  return (
    <div className="hm">
      <div className="hm-grid" role="group" aria-label="Notes written per day" ref={grid} onKeyDown={move}>
        <div className="hm-labels" aria-hidden="true">
          <span />
          <span />
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
        </div>
        {map.weeks.map((col, w) => (
          <div key={col[0]!.day} className="hm-col">
            <span className="hm-month" aria-hidden="true">
              {map.months[w]}
            </span>
            {col.map((c) =>
              c.future ? (
                <span key={c.day} className="hm-cell future" aria-hidden="true" />
              ) : (
                <button
                  key={c.day}
                  type="button"
                  data-day={c.day}
                  className={`hm-cell l${c.level}`}
                  tabIndex={c.day === current ? 0 : -1}
                  aria-pressed={picked === c.day}
                  aria-label={`${dayLabel(c.day)}: ${c.count === 0 ? 'no notes' : noteCount(c.count)}`}
                  title={`${c.count === 0 ? 'No notes' : noteCount(c.count)} on ${dayLabel(c.day)}`}
                  onFocus={() => setFocus(c.day)}
                  onClick={() => setPicked(picked === c.day ? null : c.day)}
                />
              )
            )}
          </div>
        ))}
      </div>
      <div className="hm-legend" aria-hidden="true">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`hm-cell l${l}`} />
        ))}
        More
      </div>
      {picked && (
        <section className="hm-day" aria-label={`Notes of ${dayLabel(picked)}`}>
          <h3>
            {dayLabel(picked)} · {list.length === 0 ? 'no notes' : noteCount(list.length)}
          </h3>
          {list.length > 0 && (
            <div role="list">
              {list.map((n) => (
                <div key={n.id} role="listitem">
                  <button
                    type="button"
                    className="bn-link"
                    title={n.id}
                    onClick={() => {
                      onOpenNote?.()
                      openNote(n.id)
                    }}
                  >
                    {twins.has(n.title) ? n.id.replace(/\.md$/, '') : n.title}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
