/** True for a cron run status that means the run failed. Unknown statuses are not failures. */
export function isFailure(status: string | null): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'error' || s === 'delivery_failed' || s === 'blocked_config' || s.startsWith('error')
}

/** The five cron writes of the app (F-CRON-7..11). Nothing else is ever sent to `hermes cron`. */
export const CRON_ACTIONS = ['pause', 'resume', 'run', 'edit', 'ack'] as const
export type CronAction = (typeof CRON_ACTIONS)[number]

export interface CronActionRequest {
  action: CronAction
  profile: string
  jobId: string
  /** The new schedule (edit only). */
  schedule?: string
  /** The incident to acknowledge (ack only). */
  incidentId?: string
}

export type CronActionError = 'bad-input' | 'not-connected' | 'unknown-job' | 'busy' | 'failed'
export type CronActionResult = { ok: true; output: string } | { ok: false; error: CronActionError; detail?: string }

export const JOB_ID_RE = /^[A-Za-z0-9._-]{1,128}$/
export const INCIDENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/
export const SCHEDULE_MAX = 120

/** A schedule Hermes may judge: 1 to 120 characters, trimmed, no control characters. Hermes checks the meaning. */
export function validSchedule(s: unknown): s is string {
  // eslint-disable-next-line no-control-regex
  return typeof s === 'string' && s.trim() === s && s.length >= 1 && s.length <= SCHEDULE_MAX && !/[\u0000-\u001f\u007f]/.test(s)
}

const okId = (id: unknown, re: RegExp): id is string => typeof id === 'string' && re.test(id) && id !== '.' && id !== '..'

/**
 * The arguments after `hermes` for one action, or null when the request is not acceptable. The renderer shows
 * `hermes <these>` in the confirm; the main process runs `<real hermes path> <these>`. The job is always named by its
 * id, which Hermes never finds ambiguous. Never `--accept-hooks`, never `resume --run-now`.
 */
export function cronActionArgs(r: CronActionRequest): string[] | null {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(r.profile) || r.profile === '.' || r.profile === '..' || !okId(r.jobId, JOB_ID_RE)) return null
  const p = r.profile === 'default' ? [] : ['-p', r.profile]
  switch (r.action) {
    case 'pause':
    case 'resume':
    case 'run':
      return [...p, 'cron', r.action, r.jobId]
    case 'edit':
      return validSchedule(r.schedule) ? [...p, 'cron', 'edit', r.jobId, '--schedule', r.schedule] : null
    case 'ack':
      // Hermes names an incident `<job id[:6]>_<signature>`, so an incident of another job is refused here.
      return okId(r.incidentId, INCIDENT_ID_RE) && r.incidentId.startsWith(r.jobId.slice(0, 6)) ? [...p, 'cron', 'incidents', 'ack', r.incidentId] : null
    default:
      return null
  }
}

/** How an argument looks in the preview: quoted only when the shell would need it. */
export function previewArg(a: string): string {
  return /^[A-Za-z0-9._:/=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`
}

export function cronCommandPreview(r: CronActionRequest): string | null {
  const args = cronActionArgs(r)
  return args ? `$ hermes ${args.map(previewArg).join(' ')}` : null
}
