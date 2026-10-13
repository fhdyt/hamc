import { useMemo } from 'react'
import type { ToolStat } from '@shared/events'
import { EmptyState, ErrorState, Skeleton, StaleBanner } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { clockWithDay } from '../../lib/feed'
import { formatAge } from '../../lib/format'
import { durationLabel, failureRate, shareOf, sortTools, type ToolSort } from '../../lib/tools'
import { loadTools, openToolFailure } from '../../usageActions'
import { useAgents } from '../../stores/agents'
import { useUsage } from '../../stores/usage'

const DASH = '—'
const SORTS: { key: ToolSort; label: string }[] = [
  { key: 'calls', label: 'calls' },
  { key: 'errors', label: 'errors' },
  { key: 'time', label: 'avg time' }
]

const rateColor = (r: number): string => (r >= 0.1 ? '#FF5555' : r >= 0.02 ? '#FFB86C' : '#A9B2D3')
const rateLabel = (r: number): string => `${Math.round(r * 1000) / 10}%`

export function ToolsTab() {
  const data = useUsage((s) => s.tools)
  const status = useUsage((s) => s.toolsStatus)
  const error = useUsage((s) => s.toolsError)
  const receivedAt = useUsage((s) => s.toolsReceivedAt)
  const sort = useUsage((s) => s.toolSort)
  const setSort = useUsage((s) => s.setSort)
  const selected = useUsage((s) => s.selectedTool)
  const select = useUsage((s) => s.selectTool)
  const agents = useAgents((s) => s.agents)
  const now = useNow(30_000)
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const tools = useMemo(() => sortTools(data?.tools ?? [], sort), [data, sort])
  const maxCalls = useMemo(() => (data?.tools ?? []).reduce((m, t) => Math.max(m, t.calls), 0), [data])
  const current: ToolStat | null = tools.find((t) => t.name === selected) ?? null

  if (!data) {
    return status === 'error' ? <ErrorState title="Can't read the tool calls" why={error ?? undefined} onRetry={() => void loadTools()} /> : <Skeleton rows={8} />
  }
  if (data.tools.length === 0) {
    return <EmptyState title="No tool calls in this range" why="Tool results recorded in the sessions of this range show up here." />
  }

  return (
    <>
      {status === 'error' && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label="Could not refresh tool calls" />}
      {data.errors.map((e) => (
        <div key={e.profile} className="banner" role="status">
          {names[e.profile] ?? e.profile}: state.db could not be read.
        </div>
      ))}
      <div className="us-tools">
        <section className="us-card us-tools-main" aria-label="Tools list">
          <div className="us-scroll">
            <table className="us-table" aria-label="Tools">
              <thead>
                <tr>
                  <th scope="col">tool</th>
                  {SORTS.slice(0, 2).map((s) => (
                    <th key={s.key} scope="col" className="num" aria-sort={sort === s.key ? 'descending' : 'none'}>
                      <button type="button" className="us-sort" onClick={() => setSort(s.key)}>
                        {s.label}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="num" aria-sort={sort === 'time' ? 'descending' : 'none'}>
                    <button type="button" className="us-sort" onClick={() => setSort('time')}>
                      avg time
                    </button>
                  </th>
                  <th scope="col" className="num">longest</th>
                  <th scope="col" className="num">last used</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => {
                  const r = failureRate(t)
                  return (
                    <tr key={t.name} className={t.name === selected ? 'us-sel' : undefined} onClick={() => select(t.name)}>
                      <th scope="row">
                        <button type="button" className="us-tool-name" aria-pressed={t.name === selected} onClick={(e) => { e.stopPropagation(); select(t.name) }}>
                          {t.name}
                        </button>
                      </th>
                      <td className="num">
                        <span className="us-calls">
                          <span className="us-bar" aria-hidden="true">
                            <span style={{ width: `${shareOf(t, maxCalls)}%` }} />
                          </span>
                          {t.calls.toLocaleString('en-US')}
                        </span>
                      </td>
                      <td className="num" style={{ color: rateColor(r) }}>
                        {rateLabel(r)}
                      </td>
                      <td className="num">{durationLabel(t.avgMs)}</td>
                      <td className="num">{durationLabel(t.maxMs)}</td>
                      <td className="num">{t.lastTs === null ? DASH : formatAge(Math.max(0, now / 1000 - t.lastTs))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="us-card us-tools-detail" aria-label="Tool detail">
          {current === null ? (
            <p className="us-none">Select a tool to see its calls per agent and its latest failures.</p>
          ) : (
            <>
              <h2 className="us-h">{current.name}</h2>
              <div className="us-sub">calls by agent</div>
              <ul className="us-list">
                {Object.entries(current.byProfile)
                  .sort((a, b) => b[1] - a[1])
                  .map(([p, n]) => (
                    <li key={p}>
                      <span className="dot" style={{ background: agentColor(p) }} aria-hidden="true" /> {names[p] ?? p} <span className="num">{n}</span>
                    </li>
                  ))}
              </ul>
              <div className="us-sub">latest failures</div>
              {current.failures.length === 0 ? (
                <p className="us-none">No failures recorded in this range.</p>
              ) : (
                <ul className="us-list">
                  {current.failures.map((f, i) => (
                    <li key={`${f.sessionId}:${f.ts}:${i}`} className="us-fail">
                      <div className="us-fail-top">
                        <span className="num">{f.ts === null ? DASH : clockWithDay(f.ts)}</span>
                        <span style={{ color: agentColor(f.profile) }}>{names[f.profile] ?? f.profile}</span>
                        <button type="button" className="cb sm" onClick={() => openToolFailure(f.profile, f.sessionId)}>
                          Open session
                        </button>
                      </div>
                      <code className="us-fail-text">{f.text}</code>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
      <p className="us-note">
        Failures and times are guesses from the result text and timestamps. Based on the latest {data.scanned.toLocaleString('en-US')} tool results.
        {data.truncated && ' Older results are not counted.'}
      </p>
    </>
  )
}
