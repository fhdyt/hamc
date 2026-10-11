import { useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FeedItem } from '@shared/events'
import { loadOlderFeed } from '../../actions'
import { Icon } from '../../components/Icon'
import { EmptyState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { FEED_CAP, filterFeed, sourcesOf } from '../../lib/feed'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useFeed } from '../../stores/feed'
import { useUi } from '../../stores/ui'
import { FeedFilters } from './FeedFilters'
import { FeedRow } from './FeedRow'

/** Scroll offset below which the reader counts as being at the newest items. */
const TOP_SLACK = 24
const LOAD_AHEAD = 6

export function FeedView() {
  const items = useFeed((s) => s.items)
  const filter = useFeed((s) => s.filter)
  const receivedAt = useFeed((s) => s.receivedAt)
  const unseen = useFeed((s) => s.unseen)
  const exhausted = useFeed((s) => s.exhausted)
  const loadingOlder = useFeed((s) => s.loadingOlder)
  const olderError = useFeed((s) => s.olderError)
  const setAtTop = useFeed((s) => s.setAtTop)
  const resetFilter = useFeed((s) => s.resetFilter)
  const openSession = useFeed((s) => s.openSession)
  const agents = useAgents((s) => s.agents)
  const connState = useConn((s) => s.status.state)
  const reduceMotion = useUi((s) => s.settings['ui.reduceMotion'])

  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const profiles = useMemo(() => agents.map((a) => a.profile), [agents])
  const sources = useMemo(() => sourcesOf(items), [items])
  const visible = useMemo(() => filterFeed(items, filter), [items, filter])
  const working = agents.filter((a) => a.status === 'working')

  const scrollRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ id: string; delta: number } | null>(null)

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (i) => visible[i]?.id ?? i
  })
  const virtualItems = virtualizer.getVirtualItems()

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const atTop = el.scrollTop < TOP_SLACK
    setAtTop(atTop)
    const first = virtualizer.getVirtualItems()[0]
    anchor.current = atTop || !first ? null : { id: String(first.key), delta: first.start - el.scrollTop }
  }

  // New items arrive above the reader; keep the item they are looking at where it was.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = anchor.current
    if (!el || !a || el.scrollTop < TOP_SLACK) return
    const idx = visible.findIndex((i) => i.id === a.id)
    const start = idx >= 0 ? virtualizer.getOffsetForIndex(idx, 'start')?.[0] : undefined
    if (start !== undefined) el.scrollTop = start - a.delta
  }, [visible, virtualizer])

  // A different filter is a different list: start from the newest.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    anchor.current = null
    setAtTop(true)
  }, [filter, setAtTop])

  const last = virtualItems[virtualItems.length - 1]
  const nearEnd = last !== undefined && last.index >= visible.length - LOAD_AHEAD
  const allDone = profiles.length > 0 && profiles.every((p) => exhausted[p])
  useLayoutEffect(() => {
    if (receivedAt !== null && nearEnd && !loadingOlder && !olderError && !allDone && items.length > 0 && items.length < FEED_CAP) void loadOlderFeed(profiles)
  }, [receivedAt, nearEnd, loadingOlder, olderError, allDone, items.length, profiles])

  const jump = (): void => scrollRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })

  const filtered = visible.length !== items.length
  let body
  if (receivedAt === null) {
    body = connState === 'connected' || connState === 'connecting' ? <Skeleton rows={6} /> : <EmptyState title="No feed yet" why="Items appear once Mission Control is connected." />
  } else if (items.length === 0) {
    body = <EmptyState title="No activity yet" why="When an agent talks, thinks or runs a tool, it shows up here." />
  } else if (visible.length === 0) {
    body = (
      <EmptyState title="Nothing matches" why="No item passes the current filters.">
        <button type="button" className="cb" onClick={resetFilter}>
          Reset filters
        </button>
      </EmptyState>
    )
  }

  return (
    <div className="fview">
      <FeedFilters agents={agents} sources={sources} names={names} />
      <section className="fscroll-wrap" aria-label="Feed">
        {working.length > 0 && (
          <div className="ftyping" role="status">
            <span className="mc-dots" style={{ color: '#50FA7B' }} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              {working.map((a, i) => (
                <span key={a.profile}>
                  {i > 0 && ', '}
                  <span style={{ color: agentColor(a.profile) }}>{a.displayName}</span>
                </span>
              ))}{' '}
              {working.length === 1 ? 'is' : 'are'} working
            </span>
          </div>
        )}
        <div ref={scrollRef} className="fscroll" onScroll={onScroll} tabIndex={0} aria-label="Feed items, newest first">
          {body ?? (
            <>
              <div role="list" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualItems.map((v) => {
                  const it = visible[v.index] as FeedItem
                  return (
                    <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} role="listitem" className="frow-wrap" style={{ transform: `translateY(${v.start}px)` }}>
                      <FeedRow item={it} name={names[it.profile] ?? it.profile} onOpenSession={(x) => openSession(x.profile, x.sessionId)} />
                    </div>
                  )
                })}
              </div>
              <div className="ffoot" role="status">
                {loadingOlder ? (
                  'Loading older items…'
                ) : olderError ? (
                  <>
                    Could not load older items ({olderError}).{' '}
                    <button type="button" className="fr-more" onClick={() => { useFeed.getState().setLoadingOlder(false); void loadOlderFeed(profiles) }}>
                      Retry
                    </button>
                  </>
                ) : allDone ? (
                  'Start of history'
                ) : items.length >= FEED_CAP ? (
                  <button type="button" className="cb" onClick={() => void loadOlderFeed(profiles)}>
                    Load older items
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
        {unseen > 0 && (
          <button type="button" className="fjump" onClick={jump}>
            <Icon name="arrow-up" size={12} /> {unseen} new · Jump to latest
          </button>
        )}
      </section>
      <span className="fcount">
        {filtered ? `${visible.length} of ${items.length}` : items.length} item{items.length === 1 ? '' : 's'} loaded · newest first
      </span>
    </div>
  )
}
