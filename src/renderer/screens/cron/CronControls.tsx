import type { CronJob } from '@shared/events'
import { Icon } from '../../components/Icon'
import { askAction, confirmAction } from '../../cronActions'
import { jobKey, formatLocal } from '../../lib/cron'
import { actionsBlock, askView, runNowBlock, scheduleProblem, schedulePreview } from '../../lib/cronControl'
import { useConn } from '../../stores/conn'
import { useCron } from '../../stores/cron'

/** Pause/Resume, Run now and Edit schedule, the confirm panel with the exact command, and the last result (F-CRON-7..9, 14). */
export function CronControls({ job }: { job: CronJob }) {
  const key = jobKey(job)
  const ask = useCron((s) => (s.ask?.key === key ? s.ask : null))
  const draft = useCron((s) => s.draft)
  const setDraft = useCron((s) => s.setDraft)
  const closeAsk = useCron((s) => s.closeAsk)
  const pending = useCron((s) => s.pending[key] ?? null)
  const note = useCron((s) => s.notes[key] ?? null)
  const setNote = useCron((s) => s.setNote)
  const connected = useConn((s) => s.status.state === 'connected')

  const off = actionsBlock(connected)
  const runOff = off ?? runNowBlock(job, pending === 'run')
  const paused = job.state === 'paused'
  const completed = job.state === 'completed'
  const busy = pending !== null
  const view = ask ? askView(ask.action, job, { schedule: draft, incident: job.incident }) : null
  const problem = ask?.action === 'edit' ? scheduleProblem(draft) : null
  const preview = ask?.action === 'edit' && !problem ? schedulePreview(job, draft, Date.now() / 1000) : []

  return (
    <div className="cc-wrap">
      <div className="cc-bar" role="group" aria-label="Job actions">
        <button type="button" className="cb sm" disabled={off !== null || busy || completed} title={off ?? undefined} onClick={() => askAction(paused ? 'resume' : 'pause')}>
          <Icon name={paused ? 'play' : 'pause'} size={12} />
          {pending === 'pause' ? 'Pausing…' : pending === 'resume' ? 'Resuming…' : paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="cb sm" disabled={runOff !== null || busy} title={runOff ?? undefined} aria-describedby={runOff ? `cc-run-why-${key}` : undefined} onClick={() => askAction('run')}>
          <Icon name="play" size={12} />
          {pending === 'run' ? 'Running…' : 'Run now'}
        </button>
        <button type="button" className="cb sm" disabled={off !== null || busy} title={off ?? undefined} onClick={() => askAction('edit')}>
          <Icon name="edit" size={12} />
          {pending === 'edit' ? 'Saving…' : 'Edit schedule'}
        </button>
      </div>
      {(off ?? runOff) && (
        <span id={`cc-run-why-${key}`} className="cc-why">
          {off ?? runOff}
        </span>
      )}

      {ask && view && (
        <div className="cc-ask mc-down" role="group" aria-label={view.title} style={{ borderColor: view.tone }}>
          <span className="cc-ask-title">{view.title}</span>
          <span className="cc-ask-body">{view.body}</span>
          {ask.action === 'edit' && (
            <>
              <label htmlFor={`cc-sched-${key}`} className="cc-ask-body">
                New schedule
              </label>
              <input
                id={`cc-sched-${key}`}
                type="text"
                className="fld"
                value={draft}
                maxLength={200}
                autoFocus
                spellCheck={false}
                placeholder="every 3h, 0 */3 * * *, or 30m"
                aria-invalid={problem !== null}
                aria-describedby={`cc-sched-help-${key}`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !problem && draft !== (job.schedule.expr ?? job.schedule.display)) void confirmAction()
                }}
              />
              <span id={`cc-sched-help-${key}`} className="cc-why" role={problem ? 'alert' : undefined}>
                {problem ??
                  (preview.length > 0
                    ? `Next runs, your time: ${preview.map((t) => formatLocal(t)).join(' · ')}`
                    : 'Mission Control cannot preview this form; Hermes checks it when you save.')}
              </span>
            </>
          )}
          <span className="cc-ask-body">This runs on the server:</span>
          <pre className="cc-cmd">{view.command ?? '—'}</pre>
          <span className="cc-ask-actions">
            <button type="button" className="cb sm" onClick={closeAsk}>
              Cancel
            </button>
            <button
              type="button"
              className={`cb sm ${ask.action === 'run' ? 'warn' : 'pri'}`}
              disabled={view.command === null || (ask.action === 'edit' && draft === (job.schedule.expr ?? job.schedule.display))}
              onClick={() => void confirmAction()}
            >
              {view.confirm}
            </button>
          </span>
        </div>
      )}

      {note && (
        <div className={`banner ${note.ok ? 'ok' : 'bad'}`} role={note.ok ? 'status' : 'alert'}>
          <span className="cc-note-title">{note.title}</span>
          {note.detail && <pre className="cc-note-text">{note.detail}</pre>}
          <button type="button" className="ib sm cc-note-x" aria-label="Dismiss" onClick={() => setNote(key, null)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
