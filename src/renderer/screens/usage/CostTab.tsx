import { useMemo } from 'react'
import { EmptyState, ErrorState, Skeleton, StaleBanner } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { formatTokens } from '../../lib/feed'
import { buildDays, byAgent, byModel, daysOver, moneyLabel, summaryOf, unknownCostSessions } from '../../lib/usage'
import { loadUsage, reviewDayInSessions, setUsageFilter } from '../../usageActions'
import { useAgents } from '../../stores/agents'
import { useUi } from '../../stores/ui'
import { useUsage } from '../../stores/usage'
import { CostChart, dayLabel } from './CostChart'

const DASH = '—'

export function CostTab() {
  const summary = useUsage((s) => s.summary)
  const dayStarts = useUsage((s) => s.dayStarts)
  const status = useUsage((s) => s.status)
  const error = useUsage((s) => s.error)
  const receivedAt = useUsage((s) => s.receivedAt)
  const pinned = useUsage((s) => s.pinnedDay)
  const pinDay = useUsage((s) => s.pinDay)
  const alertOn = useUi((s) => s.settings['alerts.cost.enabled'])
  const alertUsd = useUi((s) => s.settings['alerts.cost.usd'])
  const agents = useAgents((s) => s.agents)
  const now = useNow(30_000)
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const rows = summary?.rows ?? []
  const days = useMemo(() => buildDays(rows, dayStarts), [rows, dayStarts])
  const profiles = useMemo(() => [...new Set(rows.map((r) => r.profile))].sort(), [rows])
  const { total, average, today } = summaryOf(days)
  const threshold = alertOn ? alertUsd : null
  const over = threshold === null ? [] : daysOver(days, threshold)

  if (!summary) {
    return status === 'error' ? <ErrorState title="Can't read the usage" why={error ?? undefined} onRetry={() => void loadUsage()} /> : <Skeleton rows={8} />
  }
  if (rows.length === 0) {
    return (
      <EmptyState title="No usage in this range" why="Sessions that started in this range show up here with their cost.">
        <button type="button" className="cb" onClick={() => void setUsageFilter({ range: '30d' })}>
          Widen range
        </button>
      </EmptyState>
    )
  }

  const heading = pinned !== null && days[pinned] ? dayLabel(days[pinned]!.ts) : `Last ${days.length} days`
  const agentLines = byAgent(rows, pinned)
  const modelLines = byModel(rows, pinned)
  const unknown = unknownCostSessions(rows)

  return (
    <>
      {status === 'error' && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label="Could not refresh usage" />}
      {summary.errors.map((e) => (
        <div key={e.profile} className="banner" role="status">
          {names[e.profile] ?? e.profile}: state.db could not be read.
        </div>
      ))}
      {summary.truncated && (
        <div className="banner" role="status">
          Based on the latest 50,000 sessions.
        </div>
      )}
      <p className="us-summary">
        {moneyLabel(total)} over {days.length} days · {moneyLabel(average)}/day avg · {moneyLabel(today)} today
      </p>
      {threshold !== null && over.length > 0 && (
        <div className="us-over" role="status">
          <span>
            {over.length} day{over.length === 1 ? '' : 's'} over the {moneyLabel(threshold)} alert threshold
          </span>
          <button type="button" className="cb sm" onClick={() => reviewDayInSessions(over[0]!)}>
            Review in Sessions
          </button>
        </div>
      )}
      <section className="us-card" aria-label="Cost per day">
        <CostChart days={days} agents={profiles} names={names} threshold={threshold} pinned={pinned} total={total} onPin={(d) => (d === null ? pinDay(pinned) : pinDay(d))} />
        <div className="us-legend" aria-label="Agents">
          {profiles.map((p) => (
            <span key={p} className="us-legend-item">
              <span className="dot" style={{ background: agentColor(p) }} aria-hidden="true" />
              {names[p] ?? p}
            </span>
          ))}
          <span className="us-hint">click a bar to pin that day</span>
        </div>
      </section>
      <div className="us-tables">
        <section className="us-card" aria-label="by agent">
          <h2 className="us-h">{heading} by agent</h2>
          <div className="us-scroll">
            <table className="us-table">
              <thead>
                <tr>
                  <th scope="col">agent</th>
                  <th scope="col" className="num">sessions</th>
                  <th scope="col" className="num">input</th>
                  <th scope="col" className="num">output</th>
                  <th scope="col" className="num">cache read</th>
                  <th scope="col" className="num">cost</th>
                  <th scope="col" className="num">share</th>
                </tr>
              </thead>
              <tbody>
                {agentLines.map((l) => (
                  <tr key={l.profile}>
                    <th scope="row">
                      <span className="dot" style={{ background: agentColor(l.profile) }} aria-hidden="true" /> {names[l.profile] ?? l.profile}
                    </th>
                    <td className="num">{l.sessions}</td>
                    <td className="num">{formatTokens(l.inputTokens)}</td>
                    <td className="num">{formatTokens(l.outputTokens)}</td>
                    <td className="num">{formatTokens(l.cacheReadTokens)}</td>
                    <td className="num">{moneyLabel(l.cost, l.estimated)}</td>
                    <td className="num">{Math.round(l.share * 100)}%</td>
                  </tr>
                ))}
                {agentLines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="us-none">
                      No sessions on this day.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="us-card" aria-label="by model">
          <h2 className="us-h">{heading} by model</h2>
          <div className="us-scroll">
            <table className="us-table">
              <thead>
                <tr>
                  <th scope="col">provider</th>
                  <th scope="col">model</th>
                  <th scope="col" className="num">API calls</th>
                  <th scope="col" className="num">cost</th>
                </tr>
              </thead>
              <tbody>
                {modelLines.map((l) => (
                  <tr key={`${l.provider}\u0000${l.model}`}>
                    <td>{l.provider ?? DASH}</td>
                    <td>{l.model ?? DASH}</td>
                    <td className="num">{l.apiCalls === null ? DASH : l.apiCalls}</td>
                    <td className="num">{moneyLabel(l.cost, l.estimated)}</td>
                  </tr>
                ))}
                {modelLines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="us-none">
                      No sessions on this day.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <p className="us-note">
        Cost is the provider-reported figure when there is one; rows marked est. use the model's published price per token. Subscription and OAuth providers can show $0.00.
        {unknown > 0 && ` ${unknown} session${unknown === 1 ? ' has' : 's have'} no cost figure and ${unknown === 1 ? 'is' : 'are'} not counted.`}
      </p>
    </>
  )
}
