import { useMemo } from 'react'
import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { EmptyState, Skeleton } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, counts, formatCountdown, jobKey, sortJobs, statusColor, statusLabel } from '../../lib/cron'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useCron } from '../../stores/cron'
import { useUi } from '../../stores/ui'

const MAX_ROWS = 8

export function CronPanel() {
  const jobs = useCron((s) => s.jobs)
  const receivedAt = useCron((s) => s.receivedAt)
  const openModal = useCron((s) => s.openModal)
  const open = useUi((s) => s.settings['dashboard.cronOpen'])
  const connState = useConn((s) => s.status.state)
  const agents = useAgents((s) => s.agents)
  const now = useNow()
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const c = counts(jobs)
  const rows = useMemo(() => sortJobs(jobs).slice(0, MAX_ROWS), [jobs])

  const actions = (
    <>
      <span>{c.total} job{c.total === 1 ? '' : 's'}</span>
      {c.error > 0 && <span style={{ color: '#FF5555', fontWeight: 600 }}>{c.error} error</span>}
      {c.paused > 0 && <span style={{ color: '#8B95BD' }}>{c.paused} paused</span>}
      <button type="button" className="ib sm" onClick={() => openModal()} aria-label="Open cron jobs" title="Open cron jobs">
        <Icon name="maximize" size={13} />
      </button>
      <button
        type="button"
        className="ib sm"
        aria-expanded={open}
        aria-label={open ? 'Collapse cron panel' : 'Expand cron panel'}
        title={open ? 'Collapse' : 'Expand'}
        onClick={() => void saveSetting('dashboard.cronOpen', !open)}
      >
        <Icon name={open ? 'chev-up' : 'chev-down'} size={13} />
      </button>
    </>
  )

  return (
    <Panel variant="card" title="cron" label="Cron jobs" actions={actions}>
      {open &&
        (receivedAt === null ? (
          connState === 'connected' || connState === 'connecting' ? (
            <Skeleton rows={3} />
          ) : (
            <EmptyState title="No cron data yet" why="Jobs appear once Mission Control is connected." />
          )
        ) : jobs.length === 0 ? (
          <EmptyState title="No cron jobs yet" why="Jobs are created from a chat with an agent or from the terminal." />
        ) : (
          <div role="list" aria-label="Cron jobs" style={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, overflowY: 'auto' }}>
            {rows.map((j) => {
              const label = statusLabel(j.lastStatus)
              const countdown = j.state === 'paused' ? 'paused' : formatCountdown(j.nextRunTs, now)
              return (
                <button
                  key={jobKey(j)}
                  type="button"
                  role="listitem"
                  className="cron-row"
                  aria-label={`${j.name}, ${agentLabel(j.profile, names)}, ${label}, next run ${countdown}`}
                  onClick={() => openModal(jobKey(j))}
                >
                  <span className="dot" style={{ background: agentColor(j.profile) }} aria-hidden="true" />
                  <span className="nm">{j.name}</span>
                  <span className="cd num">{countdown}</span>
                  <span className="badge" style={{ color: statusColor(j), borderColor: statusColor(j) }}>{label}</span>
                </button>
              )
            })}
            {jobs.length > MAX_ROWS && (
              <button type="button" className="cron-row more" onClick={() => openModal()}>
                + {jobs.length - MAX_ROWS} more
              </button>
            )}
          </div>
        ))}
    </Panel>
  )
}
