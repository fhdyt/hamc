import { useMemo, type CSSProperties } from 'react'
import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { EmptyState, Skeleton } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, counts, formatCountdown, isFailure, jobKey, sortJobs, statusColor, statusLabel } from '../../lib/cron'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useCron } from '../../stores/cron'
import { useUi } from '../../stores/ui'

export function CronPanel({ style }: { style?: CSSProperties }) {
  const jobs = useCron((s) => s.jobs)
  const receivedAt = useCron((s) => s.receivedAt)
  const openModal = useCron((s) => s.openModal)
  const open = useUi((s) => s.settings['dashboard.cronOpen'])
  const connState = useConn((s) => s.status.state)
  const agents = useAgents((s) => s.agents)
  const now = useNow()
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const c = counts(jobs)
  const rows = useMemo(() => sortJobs(jobs), [jobs])

  const meta = (
    <>
      {c.total} job{c.total === 1 ? '' : 's'}
      {c.error > 0 && (
        <>
          {' · '}
          <span style={{ color: '#FF5555' }}>{c.error} err</span>
        </>
      )}
      {c.paused > 0 && ` · ${c.paused} paused`}
    </>
  )
  const actions = (
    <>
      <button type="button" className="ib sm" onClick={() => openModal()} aria-label="Open cron jobs" title="Open cron jobs">
        <Icon name="maximize" size={13} />
      </button>
      <button type="button" className="ib sm" aria-expanded={open} aria-label={open ? 'Hide cron' : 'Show cron'} title={open ? 'Hide' : 'Show'} onClick={() => void saveSetting('dashboard.cronOpen', !open)}>
        <Icon name={open ? 'chev-up' : 'chev-down'} size={14} />
      </button>
    </>
  )

  return (
    <Panel variant="card" title="cron" label="Cron jobs" meta={meta} actions={actions} style={style} className="d-panel">
      {open &&
        (receivedAt === null ? (
          connState === 'connected' || connState === 'connecting' ? <Skeleton rows={3} /> : <EmptyState title="No cron data yet" why="Jobs appear once Mission Control is connected." />
        ) : jobs.length === 0 ? (
          <EmptyState title="No cron jobs yet" why="Jobs are created from a chat with an agent or from the terminal." />
        ) : (
          <div role="list" aria-label="Cron jobs" className="d-scroll">
            {rows.map((j) => {
              const running = j.state === 'running'
              const eta = running ? 'running' : j.state === 'paused' ? 'paused' : formatCountdown(j.nextRunTs, now)
              const etaColor = running ? '#50FA7B' : isFailure(j.lastStatus) ? '#FF5555' : '#A9B2D3'
              return (
                <button
                  key={jobKey(j)}
                  type="button"
                  role="listitem"
                  className="dash-row"
                  aria-label={`${j.name}, ${agentLabel(j.profile, names)}, ${statusLabel(j.lastStatus)}, next run ${eta}`}
                  onClick={() => openModal(jobKey(j))}
                >
                  <span className="dr-top">
                    <span className="dot" style={{ background: statusColor(j) }} aria-hidden="true" />
                    <span className="dr-name">{j.name}</span>
                    <span className="num dr-eta" style={{ color: etaColor }}>
                      {eta}
                    </span>
                  </span>
                  <span className="dr-sub">
                    <span style={{ color: agentColor(j.profile) }}>{agentLabel(j.profile, names)}</span> · {j.schedule.display}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
    </Panel>
  )
}
