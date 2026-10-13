import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LOG_LEVELS, LOG_RANGES, LOG_RANGE_SECONDS, type LogFileName, type LogLevel, type LogRange } from '@shared/logs'
import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { componentsOf, filterLines, serverOffset, splitMatches } from '../../lib/logFilter'
import { parseLines, type LogLine } from '../../lib/logParse'
import { maskSecrets } from '../../lib/redact'
import { followTick, loadLogsOlder, openLogs, setLogAgent, setLogFile } from '../../logsActions'
import { sortAgents } from '../../lib/roster'
import { useAgents } from '../../stores/agents'
import { useLogs } from '../../stores/logs'
import { useUi } from '../../stores/ui'

const FOLLOW_MS = 2000
const BOTTOM_SLACK = 40
const RANGE_LABEL: Record<LogRange, string> = { '15m': 'Last 15 minutes', '1h': 'Last hour', '6h': 'Last 6 hours', '24h': 'Last 24 hours' }

const clock = (l: LogLine): string => (l.naive === null ? '' : new Date(l.naive * 1000).toISOString().slice(11, 19))

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}

export function LogsTab() {
  const lines = useLogs((s) => s.lines)
  const profile = useLogs((s) => s.profile)
  const files = useLogs((s) => s.files)
  const file = useLogs((s) => s.file)
  const status = useLogs((s) => s.status)
  const error = useLogs((s) => s.error)
  const more = useLogs((s) => s.more)
  const limit = useLogs((s) => s.limit)
  const mtime = useLogs((s) => s.mtime)
  const following = useLogs((s) => s.following)
  const paused = useLogs((s) => s.paused)
  const newLines = useLogs((s) => s.newLines)
  const notice = useLogs((s) => s.notice)
  const component = useLogs((s) => s.component)
  const query = useLogs((s) => s.query)
  const setComponent = useLogs((s) => s.setComponent)
  const setQuery = useLogs((s) => s.setQuery)
  const setFollowing = useLogs((s) => s.setFollowing)
  const setPaused = useLogs((s) => s.setPaused)
  const levels = useUi((s) => s.settings['logs.levels'])
  const range = useUi((s) => s.settings['logs.range'])
  const wrap = useUi((s) => s.settings['logs.wrap'])
  const agents = useAgents((s) => s.agents)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const parsed = useMemo(() => parseLines(lines), [lines])
  const offset = useMemo(() => serverOffset(parsed, mtime), [parsed, mtime])
  const components = useMemo(() => componentsOf(parsed), [parsed])
  const visible = useMemo(
    () => filterLines(parsed, { levels, component, rangeS: LOG_RANGE_SECONDS[range], query }, Date.now() / 1000, offset),
    [parsed, levels, component, range, query, offset]
  )
  const sorted = useMemo(() => sortAgents(agents), [agents])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 12,
    getItemKey: (i) => visible[i]?.index ?? i
  })

  useEffect(() => {
    void openLogs()
  }, [])
  // Follow: ask again every 2 s while the window is visible; the main collector has no control channel to push lines.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void followTick()
    }, FOLLOW_MS)
    return () => window.clearInterval(t)
  }, [])
  // Following keeps the newest line in view unless the reader moved away.
  useLayoutEffect(() => {
    if (following && !paused && visible.length > 0) virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })
  }, [visible.length, following, paused, virtualizer])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_SLACK
    if (away !== paused) setPaused(away)
  }
  const jump = (): void => {
    setPaused(false)
    if (visible.length > 0) virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })
  }
  const toggleRow = (index: number): void => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
    setPaused(true)
  }
  const toggleLevel = (lv: LogLevel): void => void saveSetting('logs.levels', levels.includes(lv) ? levels.filter((x) => x !== lv) : [...levels, lv])
  const copyVisible = (): void => {
    const text = maskSecrets(visible.map((l) => l.raw).join('\n'))
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  const resetFilters = (): void => {
    void saveSetting('logs.levels', ['INFO', 'WARNING', 'ERROR', 'CRITICAL', 'UNKNOWN'])
    void saveSetting('logs.range', '24h')
    setComponent('all')
    setQuery('')
  }

  const agentName = sorted.find((a) => a.profile === profile)?.displayName ?? profile ?? 'this agent'

  let body
  if (status === 'error' && lines.length === 0) {
    body = <ErrorState title="Can't read the log" why={error ?? undefined} onRetry={() => void openLogs()} />
  } else if ((status === 'loading' || status === 'idle') && lines.length === 0) {
    body = <Skeleton rows={10} />
  } else if (files.length === 0) {
    body = <EmptyState title={`No log files for ${agentName}`} why="Hermes writes agent.log, errors.log, gateway.log and tool_calls.log in the logs folder of the agent once it has something to say." />
  } else if (visible.length === 0) {
    body = (
      <EmptyState title="No lines match the filters" why={lines.length === 0 ? 'This log file is empty.' : `${lines.length} lines are loaded but none passes the levels, component, range and search.`}>
        {lines.length > 0 && (
          <button type="button" className="cb" onClick={resetFilters}>
            Reset filters
          </button>
        )}
      </EmptyState>
    )
  }

  return (
    <>
      <div className="lg-bar" role="search" aria-label="Log filters">
        <label className="vh" htmlFor="lg-agent">
          Agent
        </label>
        <select id="lg-agent" className="fld" value={profile ?? ''} onChange={(e) => void setLogAgent(e.target.value)}>
          {sorted.map((a) => (
            <option key={a.profile} value={a.profile}>
              {a.displayName}
            </option>
          ))}
        </select>
        <label className="vh" htmlFor="lg-file">
          Log file
        </label>
        <select id="lg-file" className="fld" value={file ?? ''} disabled={files.length === 0} onChange={(e) => void setLogFile(e.target.value as LogFileName)}>
          {files.length === 0 && <option value="">no files</option>}
          {files.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <div className="lg-levels" role="group" aria-label="Levels">
          {LOG_LEVELS.map((lv) => (
            <button key={lv} type="button" className="fchip ses-chip" aria-pressed={levels.includes(lv)} onClick={() => toggleLevel(lv)}>
              {lv}
            </button>
          ))}
        </div>
        <label className="vh" htmlFor="lg-comp">
          Component
        </label>
        <select id="lg-comp" className="fld" value={component} onChange={(e) => setComponent(e.target.value)}>
          <option value="all">All components</option>
          {components.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="vh" htmlFor="lg-range">
          Time range
        </label>
        <select id="lg-range" className="fld" value={range} onChange={(e) => void saveSetting('logs.range', e.target.value as LogRange)}>
          {LOG_RANGES.map((r) => (
            <option key={r} value={r}>
              {RANGE_LABEL[r]}
            </option>
          ))}
        </select>
        <label className="vh" htmlFor="lg-q">
          Search the log
        </label>
        <input id="lg-q" type="search" className="fld lg-q" placeholder="Search" autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="cb" aria-pressed={following} onClick={() => setFollowing(!following)}>
          <Icon name="arrow-down" size={12} /> Follow
        </button>
        <button type="button" className="cb" aria-pressed={wrap} onClick={() => void saveSetting('logs.wrap', !wrap)}>
          Wrap
        </button>
        <button type="button" className="cb" onClick={copyVisible} disabled={visible.length === 0}>
          <Icon name="copy" size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {notice && (
        <div className="banner" role="status">
          {notice}
        </div>
      )}
      {status === 'error' && lines.length > 0 && (
        <div className="banner bad" role="alert">
          {error}
        </div>
      )}
      <div className="lg-wrap">
        <div ref={scrollRef} className={`lg-scroll${wrap ? ' wrap' : ''}`} onScroll={onScroll} tabIndex={0} aria-label="Log lines, newest at the bottom">
          {body ?? (
            <>
              {more && (
                <div className="lg-older" role="status">
                  Showing the last {lines.length.toLocaleString('en-US')} lines.{' '}
                  {limit < 2000 && (
                    <button type="button" className="fr-more" onClick={() => void loadLogsOlder()}>
                      Load older
                    </button>
                  )}
                </div>
              )}
              <div role="list" aria-label="Log lines" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((v) => {
                  const l = visible[v.index]!
                  const isOpen = open.has(l.index)
                  const text = maskSecrets(l.message)
                  return (
                    <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} role="listitem" className="lg-item" style={{ transform: `translateY(${v.start}px)` }}>
                      <button type="button" className={`lg-row lv-${l.level}`} aria-expanded={isOpen} onClick={() => toggleRow(l.index)}>
                        <span className="lg-t num">{clock(l)}</span>
                        <span className="lg-lv">{l.level}</span>
                        <span className="lg-c">{l.component ?? ''}</span>
                        <span className="lg-m">
                          <Highlight text={isOpen ? text : text.split('\n')[0]!} query={query} />
                        </span>
                      </button>
                      {isOpen && <pre className="lg-detail">{maskSecrets(l.raw)}</pre>}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        {paused && newLines > 0 && (
          <button type="button" className="fjump" onClick={jump}>
            <Icon name="arrow-down" size={12} /> {newLines} new line{newLines === 1 ? '' : 's'}
          </button>
        )}
      </div>
      <span className="fcount">
        {visible.length.toLocaleString('en-US')} of {parsed.length.toLocaleString('en-US')} lines · oldest first, newest at the bottom
      </span>
    </>
  )
}
