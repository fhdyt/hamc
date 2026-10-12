import { useMemo, useState, type CSSProperties } from 'react'
import { openFeedFor, saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { EmptyState } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, formatCountdown, isFailure, jobKey } from '../../lib/cron'
import { KIND_COLOR, KIND_LABEL, clock } from '../../lib/feed'
import { useAgents } from '../../stores/agents'
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

  const tabBtn = (id: 'activity' | 'alerts', label: string, extra?: React.ReactNode) => (
    <button type="button" role="tab" aria-selected={tab === id} className="d-tab" onClick={() => showTab(id)}>
      {label} {extra}
    </button>
  )
  const head = (
    <div role="tablist" aria-label="Activity" className="d-tabs">
      {tabBtn('activity', 'activity')}
      {tabBtn('alerts', 'alerts', alerts.length > 0 && <span style={{ color: '#FF5555' }}>{alerts.length}</span>)}
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
      alerts.length === 0 ? (
        <EmptyState title="No alerts" why={profile ? `Failed cron runs of ${names[profile] ?? profile} show up here.` : 'Failed cron runs show up here.'} />
      ) : (
        <div role="list" aria-label="Alerts" className="d-scroll">
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
