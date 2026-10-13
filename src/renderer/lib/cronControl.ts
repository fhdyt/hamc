import { cronCommandPreview, validSchedule, type CronAction, type CronActionResult } from '@shared/cron'
import type { CronIncident, CronJob, CronRun } from '@shared/events'
import { nextOccurrences } from './cronExpr'

export interface AskView {
  title: string
  body: string
  confirm: string
  /** Colour of the confirm panel border: orange for Run now (it spends tokens and may send a message). */
  tone: string
  command: string | null
}

/** The confirm panel of one action (F-CRON-7..11): what it does, and the exact command. */
export function askView(action: CronAction, job: CronJob, opts: { schedule?: string; incident?: CronIncident | null } = {}): AskView {
  const req = { action, profile: job.profile, jobId: job.id, schedule: opts.schedule, incidentId: opts.incident?.id }
  const command = cronCommandPreview(req)
  const n = `“${job.name}”`
  switch (action) {
    case 'pause':
      return { title: `Pause ${n}?`, body: 'It stops running until you resume it. A run already in progress finishes normally.', confirm: 'Pause job', tone: '#6272A4', command }
    case 'resume':
      return { title: `Resume ${n}?`, body: 'It goes back on its schedule. A run it missed while paused may fire once, as Hermes decides.', confirm: 'Resume job', tone: '#6272A4', command }
    case 'run':
      return {
        title: `Run ${n} now?`,
        body: 'One extra run with the job’s own prompt, model and delivery target. It uses tokens and may send a message. The regular schedule does not change. The run happens inside this command, so it can take minutes; if the connection drops, the run may stop and the history shows how it ended.',
        confirm: 'Run job',
        tone: '#FFB86C',
        command
      }
    case 'edit':
      return { title: `Change the schedule of ${n}`, body: 'Hermes checks the new schedule. It takes effect at the next scheduler tick, which runs every 60 seconds.', confirm: 'Save schedule', tone: '#6272A4', command }
    case 'ack':
      return {
        title: 'Acknowledge this incident?',
        body: 'Marks it as seen and keeps the same error quiet. It does not fix the cause; a different error opens a new incident.',
        confirm: 'Acknowledge',
        tone: '#6272A4',
        command
      }
  }
}

/** Why the action buttons are off, or null. */
export function actionsBlock(connected: boolean): string | null {
  return connected ? null : 'Reconnect to change jobs.'
}

/** Why Run now is off for this job, or null (F-CRON-14). */
export function runNowBlock(job: CronJob, pending: boolean): string | null {
  if (pending) return 'This job is running now from Mission Control.'
  if (job.state === 'running' || job.inflight) return 'This job is running. Run now is available again when the run ends.'
  return null
}

export function ackBlock(supported: boolean | undefined): string | null {
  return supported === false ? 'This Hermes has no `cron incidents` command.' : null
}

export function scheduleProblem(text: string): string | null {
  if (text.trim() === '') return 'Enter a schedule.'
  if (text !== text.trim()) return 'Remove the spaces at the start or end.'
  return validSchedule(text) ? null : 'Use at most 120 characters and no line breaks.'
}

/** The next three runs of a draft schedule, when the app can work them out (5-field cron or a simple interval). */
export function schedulePreview(job: CronJob, text: string, nowS: number): number[] {
  if (scheduleProblem(text)) return []
  const draft: CronJob = { ...job, nextRunTs: null, schedule: { kind: 'cron', expr: text, display: text } }
  return nextOccurrences(draft, nowS, nowS + 14 * 86400, 3)
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'OK'
    case 'claimed':
    case 'running':
      return 'RUNNING'
    default:
      return status.toUpperCase()
  }
}

export function runStatusColor(status: string): string {
  if (status === 'completed') return '#50FA7B'
  if (status === 'failed') return '#FF5555'
  if (status === 'claimed' || status === 'running') return '#8BE9FD'
  return '#FFB86C'
}

/** `51s`, `6m 10s`, `1h 02m`; null when the run has no start. A running run counts up to now. */
export function runDuration(run: CronRun, nowS: number): string | null {
  const start = run.startedTs ?? run.claimedTs
  if (start === null) return null
  const end = run.finishedTs ?? (run.status === 'running' || run.status === 'claimed' ? nowS : null)
  if (end === null) return null
  const s = Math.max(0, Math.round(end - start))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** When the run happened: its start, else its finish (a run known only from its output file). */
export const runTime = (run: CronRun): number | null => run.claimedTs ?? run.startedTs ?? run.finishedTs

/** `13 Oct, 11:30` in the user's time: the run list is narrow. */
export function formatRunTime(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

export const triggerLabel = (t: CronRun['trigger']): string => t ?? '—'

/**
 * The output of the picked run and of the closest older run that has one, for the diff. Null when the picked run
 * wrote no output.
 */
export function outputPair(runs: readonly CronRun[], picked: number): { current: string; previous: string | null } | null {
  const run = runs[picked]
  if (!run?.output) return null
  const older = runs.slice(picked + 1).find((r) => r.output !== null && r.output !== run.output)
  return { current: run.output, previous: older?.output ?? null }
}

export function incidentTypeLabel(t: string): string {
  return t.replace(/_/g, ' ')
}

/** "Failed N runs in a row" when jobs.json tells the streak, else what the ledger knows. */
export function incidentHeadline(job: CronJob, inc: CronIncident): string {
  if (job.failureStreak >= 2) return `Incident open: failed ${job.failureStreak} runs in a row`
  return inc.state === 'alerted' ? 'Incident open: Hermes sent a failure alert' : 'Incident open: a failure was detected'
}

const ERRORS: Record<Exclude<CronActionResult, { ok: true }>['error'], string> = {
  'bad-input': 'Mission Control refused the request.',
  'not-connected': 'Not connected. Reconnect and try again.',
  'unknown-job': 'The server no longer reports this job.',
  busy: 'This job is already running from Mission Control.',
  failed: 'Hermes refused the command.'
}

export function actionResultText(res: CronActionResult): { ok: boolean; title: string; detail: string | null } {
  if (res.ok) return { ok: true, title: 'Done', detail: res.output || null }
  return { ok: false, title: ERRORS[res.error], detail: res.detail ?? null }
}
