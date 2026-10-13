import { useMemo, useState, type CSSProperties } from 'react'
import { openFeedFor, saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { EmptyState } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, formatCountdown, isFailure, jobKey } from '../../lib/cron'
import { KIND_COLOR, KIND_LABEL, clock } from '../../lib/feed'
import { moneyLabel } from '../../lib/usage'
import { useAgents } from '../../stores/agents'
import { useCostAlert } from '../../stores/costAlert'
import { useLogs } from '../../stores/logs'
import { buildGatewayRows } from '../../lib/gatewayView'
import { useCron } from '../../stores/cron'
import { useFeed } from '../../stores/feed'
import { useUi } from '../../stores/ui'
import { FeedWaiting } from '../feed/FeedWaiting'

const MAX_ROWS = 14

/**
 * Latest feed items and alerts at a glance; a click opens the full Live feed in a dialog. With `profile` it shows only
 * that agent (the Chat screen), keeps its own tab, and cannot be collapsed.
 */
export function ActivityPanel({ style, profile }: { style?: CSSProperties; profile?: string }) {
  const items = useFeed((s) => s.items)
  const receivedAt = useFeed((s) => s.receivedAt)
  const openModal = useFeed((s) => s.openModal)
  const jobs = useCron((s) => s.jobs)
  const openCron = useCron((s) => s.openModal)
  const cost = useCostAlert((s) => s.state)
  const navigate = useUi((s) => s.navigate)
  const costOver = !profile && cost !== null && cost.enabled && cost.over
  const costRule = useUi((s) => s.settings['alerts.cost.enabled'])
  const sharedTab = useUi((s) => s.settings['dashboard.activityTab'])
  const sharedOpen = useUi((s) => s.settings['dashboard.activityOpen'])
  const [ownTab, setOwnTab] = useState<'activity' | 'alerts'>('activity')
  const tab = profile ? ownTab : sharedTab
  const open = profile ? true : sharedOpen
  const showTab = (t: 'activity' | 'alerts'): void => (profile ? setOwnTab(t) : void saveSetting('dashboard.activityTab', t))
  const openFeed = profile ? () => openFeedFor(profile) : openModal
  const agents = useAgents((s) => s.agents)
  const now = useNow()
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const rows = useMemo(() => items.filter((i) => i.kind !== 'result' && (!profile || i.profile === profile)).slice(0, MAX_ROWS), [items, profile])
  const alerts = useMemo(() => jobs.filter((j) => isFailure(j.lastStatus) && (!profile || j.profile === profile)), [jobs, profile])
  const gatewayOn = useUi((s) => s.settings['alerts.gateway.enabled'])
  const gatewayProblems = useMemo(
    () => (gatewayOn ? buildGatewayRows(agents.filter((a) => !profile || a.profile === profile)).filter((r) => r.problem) : []),
    [agents, profile, gatewayOn]
  )
  const openGateway = (): void => {
    useLogs.getState().setTab('gateway')
    navigate('logs')
  }

  const tabBtn = (id: 'activity' | 'alerts', label: string, extra?: React.ReactNode) => (
    <button type="button" role="tab" aria-selected={tab === id} className="d-tab" onClick={() => showTab(id)}>
      {label} {extra}
    </button>
  )
  const head = (
    <div role="tablist" aria-label="Activity" className="d-tabs">
      {tabBtn('activity', 'activity')}
      {tabBtn('alerts', 'alerts', alerts.length + gatewayProblems.length + (costOver ? 1 : 0) > 0 && <span style={{ color: '#FF5555' }}>{alerts.length + gatewayProblems.length + (costOver ? 1 : 0)}</span>)}
    </div>
  )
  const actions = (
    <>
      <button type="button" className="ib sm" onClick={openFeed} aria-label="Open the live feed" title="Open the live feed">
        <Icon name="maximize" size={13} />
      </button>
      {!profile && <button type="button" className="ib sm" aria-expanded={open} aria-label={open ? 'Hide activity' : 'Show activity'} title={open ? 'Hide' : 'Show'} onClick={() => void saveSetting('dashboard.activityOpen', !open)}>
        <Icon name={open ? 'chev-up' : 'chev-down'} size={14} />
      </button>}
    </>
  )

  let body
  if (tab === 'alerts') {
    body =
      alerts.length === 0 && gatewayProblems.length === 0 && !costOver ? (
        <EmptyState title="No alerts" why={profile ? `Failed cron runs of ${names[profile] ?? profile} show up here.` : costRule ? 'Failed cron runs and cost alerts show up here.' : 'Failed cron runs show up here.'} />
      ) : (
        <div role="list" aria-label="Alerts" className="d-scroll">
          {gatewayProblems.map((r) => {
            const detail = r.platforms.filter((p) => p.problem).map((p) => `${p.name} ${p.label}`).join(', ')
            const what = r.tone === 'bad' ? `gateway ${r.state}${r.exitReason ? ` (${r.exitReason})` : r.pid === 'gone' ? ' (process is gone)' : ''}` : detail
            return (
              <button key={`gw:${r.profile}`} type="button" role="listitem" className="dash-row" aria-label={`GATEWAY: ${r.name}, ${what}`} onClick={openGateway}>
                <span className="dr-top">
                  <span style={{ color: agentColor(r.profile), fontWeight: 600 }}>{agentLabel(r.profile, names)}</span>
                  <span className="dr-kind" style={{ color: '#FF5555' }}>
                    GATEWAY
                  </span>
                </span>
                <span className="dr-text">{what}</span>
              </button>
            )
          })}
          {costOver && cost && (
            <button
              type="button"
              role="listitem"
              className="dash-row"
              aria-label={`COST: daily cost ${moneyLabel(cost.total ?? 0)} is over ${moneyLabel(cost.threshold)}`}
              onClick={() => navigate('usage')}
            >
              <span className="dr-top">
                <span className="dr-time num">{clock(cost.checkedAt / 1000)}</span>
                <span className="dr-kind" style={{ color: '#FFB86C' }}>
                  COST
                </span>
              </span>
              <span className="dr-text">
                Daily cost {moneyLabel(cost.total ?? 0)} is over {moneyLabel(cost.threshold)}
              </span>
            </button>
          )}
          {alerts.map((j) => (
            <button key={jobKey(j)} type="button" role="listitem" className="dash-row" onClick={() => openCron(jobKey(j))}>
              <span className="dr-top">
                <span className="dr-time num">{j.lastRunTs ? clock(j.lastRunTs) : ''}</span>
                <span style={{ color: agentColor(j.profile), fontWeight: 600 }}>{agentLabel(j.profile, names)}</span>
                <span className="dr-kind" style={{ color: '#FF5555' }}>
                  CRON ERROR
                </span>
              </span>
              <span className="dr-text">
                {j.name}: {j.lastError ?? j.lastStatus ?? 'failed'}
                {j.failureStreak > 1 ? ` (${j.failureStreak} in a row)` : ''} · next {formatCountdown(j.nextRunTs, now)}
              </span>
            </button>
          ))}
        </div>
      )
  } else if (receivedAt === null) {
    body = <FeedWaiting />
  } else if (rows.length === 0) {
    body = <EmptyState title="No activity yet" why={profile ? `When ${names[profile] ?? profile} talks, thinks or runs a tool, it shows up here.` : 'When an agent talks, thinks or runs a tool, it shows up here.'} />
  } else {
    body = (
      <div role="list" aria-label="Latest activity" className="d-scroll">
        {rows.map((it) => (
          <button key={it.id} type="button" role="listitem" className="dash-row" onClick={openFeed} aria-label={`${names[it.profile] ?? it.profile}, ${KIND_LABEL[it.kind]}: ${it.text.slice(0, 80)}`}>
            <span className="dr-top">
              <span className="dr-time num">{clock(it.ts)}</span>
              <span style={{ color: agentColor(it.profile), fontWeight: 600 }}>{names[it.profile] ?? it.profile}</span>
              <span className="dr-kind" style={{ color: KIND_COLOR[it.kind] }}>
                {KIND_LABEL[it.kind]}
              </span>
            </span>
            <span className="dr-text" style={it.kind === 'thinking' ? { color: '#8BE9FD', fontStyle: 'italic' } : undefined}>
              {it.text.replace(/\s+/g, ' ')}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <Panel variant="card" title="activity" label="Activity" head={head} actions={actions} style={style} className="d-panel">
      {open && body}
    </Panel>
  )
}
