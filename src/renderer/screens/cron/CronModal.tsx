import { useEffect, useMemo } from 'react'
import { Modal } from '../../components/Modal'
import { EmptyState, Skeleton, StaleBanner } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { counts, filterJobs, jobKey, sortJobs } from '../../lib/cron'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useCron } from '../../stores/cron'
import { CronDetail } from './CronDetail'
import { CronFilters } from './CronFilters'
import { CronTable } from './CronTable'
import { CronTimeline } from './CronTimeline'

function CronBody() {
  const jobs = useCron((s) => s.jobs)
  const profiles = useCron((s) => s.profiles)
  const receivedAt = useCron((s) => s.receivedAt)
  const filter = useCron((s) => s.filter)
  const selected = useCron((s) => s.selected)
  const select = useCron((s) => s.select)
  const connState = useConn((s) => s.status.state)
  const agents = useAgents((s) => s.agents)
  const now = useNow()
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const shown = useMemo(() => sortJobs(filterJobs(jobs, filter)), [jobs, filter])
  const c = counts(jobs)
  const detail = jobs.find((j) => jobKey(j) === selected) ?? null
  const notes = profiles.filter((p) => !p.ok || p.error)

  useEffect(() => {
    if (selected === null && shown.length > 0) select(jobKey(shown[0]!))
  }, [selected, shown, select])

  if (receivedAt === null) {
    return connState === 'connected' || connState === 'connecting' ? (
      <Skeleton rows={8} />
    ) : (
      <EmptyState title="No cron data yet" why="Jobs appear once Mission Control is connected to your VPS." />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {connState !== 'connected' && <StaleBanner receivedAt={receivedAt} now={now} label={connState === 'reconnecting' ? 'Reconnecting' : 'Offline'} />}
      <div role="status" aria-label="Job counts" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: '#A9B2D3' }}>
        <span><strong style={{ color: '#F8F8F2' }}>{c.total}</strong> jobs</span>
        <span><strong style={{ color: '#8BE9FD' }}>{c.running}</strong> running</span>
        <span><strong style={{ color: c.error ? '#FF5555' : '#F8F8F2' }}>{c.error}</strong> error</span>
        <span><strong style={{ color: '#F8F8F2' }}>{c.paused}</strong> paused</span>
      </div>
      {notes.map((p) => (
        <div key={p.profile} className="banner bad" role="alert">
          {p.profile}: {p.ok ? p.error : `could not read cron jobs (${p.error})`}
        </div>
      ))}
      {jobs.length === 0 ? (
        <EmptyState title="No cron jobs yet" why="Jobs are created from a chat with an agent or from the terminal." />
      ) : (
        <>
          <CronFilters />
          <CronTimeline jobs={shown} nowMs={now} names={names} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 14px', alignItems: 'flex-start' }}>
            <div style={{ flex: '999 1 560px', minWidth: 0 }}>
              <CronTable jobs={shown} selected={selected} nowMs={now} names={names} onSelect={select} />
            </div>
            <CronDetail job={detail} names={names} />
          </div>
        </>
      )}
    </div>
  )
}

export function CronModal() {
  const open = useCron((s) => s.modalOpen)
  const close = useCron((s) => s.closeModal)
  if (!open) return null
  return (
    <Modal title="Cron jobs" onClose={close} width={1120}>
      <CronBody />
    </Modal>
  )
}
