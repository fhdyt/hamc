import type { CronJob } from '@shared/events'
import { Icon } from '../../components/Icon'
import { useCronOutput } from '../../hooks/useCronOutput'
import { agentColor } from '../../lib/agentColor'
import { agentLabel, formatLocal, formatOffset, stateColor, stateLabel, statusColor, statusLabel } from '../../lib/cron'

const OUTPUT_MESSAGES = {
  'no-output': 'This job has not produced any output yet.',
  'not-found': 'This job is no longer reported by the server.',
  unreadable: 'The output file could not be read.',
  'not-connected': 'Reconnect to read the output.'
} as const

export function CronDetail({ job, names }: { job: CronJob | null; names: Record<string, string> }) {
  const output = useCronOutput(job)
  if (!job) {
    return (
      <aside className="cron-card" aria-label="Job detail" style={{ flex: '1 1 300px', minWidth: 0 }}>
        <div style={{ color: '#8B95BD' }}>Select a job to see its details.</div>
      </aside>
    )
  }
  const tone = statusColor(job)
  const streak = job.failureStreak >= 2
  const rows: [string, string][] = [
    ['id', job.id],
    ['schedule', job.schedule.expr ?? job.schedule.display],
    ['model', [job.provider, job.model].filter(Boolean).join(' · ') || '—'],
    ['skills', job.skills.length ? job.skills.join(', ') : '—'],
    ['repeat', `${job.repeat.times === null ? '∞' : job.repeat.times} · ${job.repeat.completed} done`],
    ['deliver', job.deliver || '—']
  ]

  return (
    <aside className="cron-card mc-fade" aria-label="Job detail" style={{ flex: '1 1 320px', minWidth: 0, borderColor: tone, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
      <span style={{ color: '#F8F8F2', fontWeight: 700, overflowWrap: 'anywhere' }}>
        <span style={{ color: agentColor(job.profile) }}>{agentLabel(job.profile, names)}</span> / {job.name}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span className="badge" style={{ color: tone, borderColor: tone }}>{statusLabel(job.lastStatus)}</span>
        <span className="badge" style={{ color: stateColor(job.state), borderColor: '#44475A' }}>{stateLabel(job.state)}</span>
      </div>
      <dl className="kv" style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <dt>next run</dt>
        <dd>{job.state === 'paused' ? 'paused' : formatLocal(job.nextRunTs)}</dd>
        <dt>last run</dt>
        <dd>{formatLocal(job.lastRunTs)}</dd>
        <dt>server time</dt>
        <dd>UTC{formatOffset(job.tzOffsetMin)}</dd>
      </dl>

      {streak && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid #FF5555', borderRadius: 6, background: '#282A36' }}>
          <span style={{ color: '#FF5555', display: 'flex' }}><Icon name="alert" size={14} /></span>
          <span>Failed {job.failureStreak} runs in a row</span>
        </div>
      )}

      <span style={{ color: '#A9B2D3' }}>Prompt</span>
      <pre className="cron-pre" style={{ color: '#F1FA8C' }}>{job.prompt || '(empty)'}</pre>

      {job.lastError && (
        <>
          <span style={{ color: '#FF5555' }}>Last error</span>
          <pre className="cron-pre" style={{ color: '#FF5555', borderStyle: 'dashed', borderColor: '#FF5555' }}>{job.lastError}</pre>
        </>
      )}
      {job.lastDeliveryError && (
        <>
          <span style={{ color: '#FFB86C' }}>Last delivery error</span>
          <pre className="cron-pre" style={{ color: '#FFB86C' }}>{job.lastDeliveryError}</pre>
        </>
      )}

      <span style={{ color: '#A9B2D3' }}>
        Last output{job.lastOutput ? ` · ${job.lastOutput.rel.split('/').pop()}` : ''}
      </span>
      {output.status === 'loading' && <div role="status" style={{ color: '#8B95BD' }}>Loading output…</div>}
      {output.status === 'idle' && <div style={{ color: '#8B95BD' }}>{OUTPUT_MESSAGES['no-output']}</div>}
      {output.status === 'done' && !output.result.ok && <div role="status" style={{ color: '#FFB86C' }}>{OUTPUT_MESSAGES[output.result.reason]}</div>}
      {output.status === 'done' && output.result.ok && (
        <>
          <pre className="cron-pre cron-out" aria-label="Last output">{output.result.text || '(empty file)'}</pre>
          {output.result.truncated && <span style={{ color: '#8B95BD' }}>Output truncated to the first 64 KiB.</span>}
        </>
      )}
    </aside>
  )
}
