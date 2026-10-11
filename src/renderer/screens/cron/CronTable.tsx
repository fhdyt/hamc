import type { CronJob } from '@shared/events'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, formatCountdown, formatLocal, jobKey, stateColor, stateLabel, statusColor, statusLabel } from '../../lib/cron'
import { formatAge } from '../../lib/format'

interface Props {
  jobs: readonly CronJob[]
  selected: string | null
  nowMs: number
  names: Record<string, string>
  onSelect: (key: string) => void
}

export function CronTable({ jobs, selected, nowMs, names, onSelect }: Props) {
  return (
    <section className="cron-card" aria-label="Jobs" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl cron-table" style={{ fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#282A36' }}>
              {['Agent', 'Name', 'Schedule', 'Next run', 'Last run', 'Status', 'State', 'Deliver'].map((h) => (
                <th key={h} scope="col" style={{ padding: '7px 8px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 16, color: '#8B95BD', textAlign: 'center' }}>No jobs match the filters.</td>
              </tr>
            )}
            {jobs.map((j) => {
              const key = jobKey(j)
              const sel = key === selected
              return (
                <tr key={key} className={sel ? 'sel' : ''} aria-selected={sel} onClick={() => onSelect(key)} style={{ cursor: 'pointer', borderTop: '1px solid #343746' }}>
                  <td style={{ color: agentColor(j.profile), fontWeight: 600 }}>{agentLabel(j.profile, names)}</td>
                  <td>
                    <button type="button" className="cron-name" aria-pressed={sel} onClick={(e) => { e.stopPropagation(); onSelect(key) }}>{j.name}</button>
                  </td>
                  <td style={{ color: '#A9B2D3' }} title={j.schedule.expr ?? undefined}>{j.schedule.display || '—'}</td>
                  <td className="num" title={formatLocal(j.nextRunTs)} style={{ color: j.state === 'running' ? '#8BE9FD' : '#F8F8F2' }}>
                    {j.state === 'paused' ? '—' : j.state === 'running' ? 'running' : formatCountdown(j.nextRunTs, nowMs)}
                  </td>
                  <td style={{ color: '#A9B2D3' }} title={formatLocal(j.lastRunTs)}>{j.lastRunTs === null ? 'never' : formatAge(Math.max(0, nowMs / 1000 - j.lastRunTs))}</td>
                  <td><span className="badge" style={{ color: statusColor(j), borderColor: statusColor(j) }}>{statusLabel(j.lastStatus)}</span></td>
                  <td style={{ color: stateColor(j.state) }}>{stateLabel(j.state)}</td>
                  <td style={{ color: '#A9B2D3' }}>{j.deliver || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
