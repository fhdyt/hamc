import { useMemo } from 'react'
import type { CronJob } from '@shared/events'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, formatLocal } from '../../lib/cron'
import { nextOccurrences } from '../../lib/cronExpr'

const HOURS = ['now', '+3h', '+6h', '+9h', '+12h', '+15h', '+18h', '+21h', '+24h']
const DAY = 86400

interface Props {
  jobs: readonly CronJob[]
  nowMs: number
  names: Record<string, string>
}

export function CronTimeline({ jobs, nowMs, names }: Props) {
  // Recomputed once a minute; the countdowns elsewhere tick every second.
  const from = Math.floor(nowMs / 60000) * 60
  const lanes = useMemo(() => {
    const byProfile = new Map<string, { job: CronJob; times: number[] }[]>()
    for (const job of jobs) {
      const list = byProfile.get(job.profile) ?? []
      list.push({ job, times: nextOccurrences(job, from, from + DAY, 60) })
      byProfile.set(job.profile, list)
    }
    return [...byProfile.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [jobs, from])
  const total = lanes.reduce((n, [, items]) => n + items.reduce((m, i) => m + i.times.length, 0), 0)

  return (
    <section className="cron-card" aria-label="Next 24 hours">
      <h3 className="cron-card-title">next 24h</h3>
      <div style={{ overflowX: 'auto' }}>
        <div role="img" aria-label={`${total} scheduled runs in the next 24 hours across ${lanes.length} agents`} style={{ minWidth: 720, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ width: 90 }} />
            <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', color: '#8B95BD', fontSize: 10 }}>
              {HOURS.map((h) => <span key={h}>{h}</span>)}
            </div>
          </div>
          {lanes.length === 0 && <div style={{ color: '#8B95BD', paddingLeft: 100 }}>No jobs match the filters.</div>}
          {lanes.map(([profile, items]) => (
            <div key={profile} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span title={agentLabel(profile, names)} style={{ width: 90, color: agentColor(profile), fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agentLabel(profile, names)}
              </span>
              <div className="tl-track">
                {items.flatMap(({ job, times }) =>
                  times.map((t) => (
                    <span
                      key={`${job.id}-${t}`}
                      className={`tl-mark ${job.state === 'paused' ? 'off' : ''}`}
                      title={`${job.name} · ${formatLocal(t)}${job.state === 'paused' ? ' (paused)' : ''}`}
                      style={{ left: `${(((t - from) / DAY) * 100).toFixed(2)}%`, borderColor: agentColor(profile), background: job.state === 'paused' ? 'transparent' : agentColor(profile) }}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', paddingLeft: 100, color: '#8B95BD', fontSize: 10 }}>
            <span>filled: scheduled run</span>
            <span>outline: paused</span>
          </div>
        </div>
      </div>
    </section>
  )
}
