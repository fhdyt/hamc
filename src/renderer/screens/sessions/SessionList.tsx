import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SessionRow } from '@shared/events'
import { Icon } from '../../components/Icon'
import { EmptyState, ErrorState, Skeleton, StaleBanner } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { formatAge } from '../../lib/format'
import { costLabel, rowKey, splitHighlight, statusLabel } from '../../lib/sessions'
import { loadList, loadMore, openSession, setQuery } from '../../sessionsActions'
import { useAgents } from '../../stores/agents'
import { useSessions } from '../../stores/sessions'
import { useGroups } from '../../stores/groups'
import { sessionTitle } from '../../lib/groupView'

const ROW_H = 72

function Highlight({ snippet }: { snippet: string }) {
  return (
    <>
      {splitHighlight(snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}

function Row({ row, name, selected, now, top }: { row: SessionRow; name: string; selected: boolean; now: number; top: number }) {
  const rooms = useGroups((s) => s.rooms)
  const age = row.startedAt === null ? 'unknown time' : formatAge(Math.max(0, now / 1000 - row.startedAt))
  return (
    <div
      id={`ses-opt-${rowKey(row)}`}
      role="option"
      aria-selected={selected}
      className="ses-row"
      style={{ transform: `translateY(${top}px)` }}
      onClick={() => void openSession(row.profile, row.id)}
    >
      <span className="ses-title">{sessionTitle(row.title, rooms) ?? `Untitled session`}</span>
      <span className="ses-cost num">{costLabel(row)}</span>
      <span className="ses-meta">
        <span className="dot" style={{ background: agentColor(row.profile) }} aria-hidden="true" />
        <span>{name}</span>
        {row.source && <span className="tag">{row.source}</span>}
        <span className="ses-status" data-status={row.status}>
          {statusLabel(row.status)}
        </span>
      </span>
      <span className="ses-age">
        {row.pinned && (
          <span title="Pinned" aria-label="Pinned" className="ses-pin">
            <Icon name="pin" size={11} />
          </span>
        )}
        {age}
      </span>
      <span className="ses-snip">
        {row.snippet ? <Highlight snippet={row.snippet} /> : `${row.messageCount ?? '?'} messages · ${row.toolCallCount ?? '?'} tool calls`}
      </span>
    </div>
  )
}

export function SessionList() {
  const rows = useSessions((s) => s.rows)
  const status = useSessions((s) => s.status)
  const error = useSessions((s) => s.error)
  const more = useSessions((s) => s.more)
  const loadingMore = useSessions((s) => s.loadingMore)
  const fallback = useSessions((s) => s.fallback)
  const errors = useSessions((s) => s.errors)
  const query = useSessions((s) => s.query)
  const selected = useSessions((s) => s.selected)
  const receivedAt = useSessions((s) => s.receivedAt)
  const agents = useAgents((s) => s.agents)
  const now = useNow(30_000)
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
    getItemKey: (i) => (rows[i] ? rowKey(rows[i]) : i)
  })

  const selectedIndex = selected ? rows.findIndex((r) => r.profile === selected.profile && r.id === selected.id) : -1

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex])

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0) return
    let next = -1
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, selectedIndex + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, selectedIndex < 0 ? 0 : selectedIndex - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = rows.length - 1
    else if (e.key === 'Enter' && selectedIndex < 0) next = 0
    if (next < 0) return
    e.preventDefault()
    const r = rows[next]!
    if (next !== selectedIndex) void openSession(r.profile, r.id)
  }

  const filtered = query.agent !== 'all' || query.source !== 'all' || query.range !== 'all'
  const searching = query.q.trim() !== ''
  const clear = (): void => void setQuery({ q: '', agent: 'all', source: 'all', range: 'all' })

  let body
  if (status === 'error' && rows.length === 0) {
    body = <ErrorState title="Can't read the session history" why={error ?? undefined} onRetry={() => void loadList()} />
  } else if ((status === 'loading' || status === 'idle') && rows.length === 0) {
    body = <Skeleton rows={8} />
  } else if (rows.length === 0) {
    body = searching ? (
      <EmptyState title={`No sessions match “${query.q.trim()}”`} why="Search covers titles and every stored message for the selected agent and range. Try fewer words or widen the range.">
        <button type="button" className="cb" onClick={clear}>
          Clear search and filters
        </button>
      </EmptyState>
    ) : filtered ? (
      <EmptyState title="No sessions in this range" why="Widen the time range or pick another agent.">
        <button type="button" className="cb" onClick={clear}>
          Clear search and filters
        </button>
      </EmptyState>
    ) : (
      <EmptyState title="No sessions yet" why="Sessions appear here as soon as an agent runs. Start one from Chat." />
    )
  }

  return (
    <>
      {status === 'error' && rows.length > 0 && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label="Could not refresh sessions" />}
      {fallback === 'title' && (
        <div className="banner" role="status">
          <Icon name="info" size={12} /> Searching titles only: this database has no message index.
        </div>
      )}
      {errors.map((e) => (
        <div key={e.profile} className="banner" role="status">
          <Icon name="alert" size={12} /> {names[e.profile] ?? e.profile}: state.db could not be read.
        </div>
      ))}
      <div
        ref={scrollRef}
        className="ses-scroll"
        role="listbox"
        aria-label="Sessions"
        tabIndex={0}
        aria-activedescendant={selected && selectedIndex >= 0 ? `ses-opt-${selected.profile}:${selected.id}` : undefined}
        onKeyDown={onKey}
      >
        {body ?? (
          <>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const r = rows[v.index]!
                return <Row key={v.key} row={r} name={names[r.profile] ?? r.profile} selected={v.index === selectedIndex} now={now} top={v.start} />
              })}
            </div>
            <div className="ses-foot" role="status">
              {more && !searching ? (
                <button type="button" className="cb" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              ) : searching && more ? (
                'Showing the best 200 matches'
              ) : (
                `${rows.length} session${rows.length === 1 ? '' : 's'}`
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
