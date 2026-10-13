/* Notifications (PRD F-SHELL-4, F-R13-4): one place decides what is recorded in the bell, shown as a toast inside the
   window, or shown by the OS over other apps. Pure helpers here; the main process delivers. */

export type NoticeKind = 'chat' | 'cron' | 'gateway' | 'cost' | 'test'

export type NoticeTarget =
  | { kind: 'chat'; profile: string }
  | { kind: 'cron'; profile: string; jobId: string }
  | { kind: 'logs'; tab: 'logs' | 'gateway' | 'approvals' }
  | { kind: 'usage' }
  | { kind: 'none' }

export interface Notice {
  id: string
  kind: NoticeKind
  /** Epoch milliseconds. */
  at: number
  title: string
  body: string
  target: NoticeTarget
}

export interface NotifyKinds {
  chat: boolean
  cron: boolean
  gateway: boolean
  cost: boolean
}

export interface QuietHours {
  enabled: boolean
  /** `HH:MM`, local time of this computer. */
  from: string
  to: string
}

export interface NotifySettings {
  desktop: boolean
  kinds: NotifyKinds
  preview: boolean
  sound: boolean
  quiet: QuietHours
}

export const NOTIFY_KINDS_DEFAULT: NotifyKinds = { chat: true, cron: true, gateway: true, cost: true }
export const QUIET_DEFAULT: QuietHours = { enabled: false, from: '22:00', to: '07:00' }
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const NOTICE_TITLE_MAX = 120
export const NOTICE_BODY_MAX = 300
/** Entries the bell keeps. */
export const NOTICE_HISTORY = 100

export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** True when `minutes` (since local midnight) falls in the quiet hours; a range like 22:00-07:00 crosses midnight. */
export function inQuietHours(q: QuietHours, minutes: number): boolean {
  if (!q.enabled || !HHMM_RE.test(q.from) || !HHMM_RE.test(q.to)) return false
  const a = minutesOf(q.from)
  const b = minutesOf(q.to)
  if (a === b) return true
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b
}

export interface Delivery {
  /** Recorded in the bell (and a toast when the window is in front). */
  record: boolean
  /** Shown by the OS over other apps. */
  desktop: boolean
  /** The OS may play its sound. */
  sound: boolean
}

/**
 * What happens to one notice. A kind that is turned off is dropped. The OS notification only appears when the window
 * is not in front (in front, the toast is enough) and outside the quiet hours; a test always shows when allowed.
 */
export function deliver(kind: NoticeKind, s: NotifySettings, ctx: { inFront: boolean; minutes: number }): Delivery {
  const on = kind === 'test' ? true : s.kinds[kind]
  if (!on) return { record: false, desktop: false, sound: false }
  const quiet = inQuietHours(s.quiet, ctx.minutes)
  const desktop = s.desktop && !quiet && (kind === 'test' || !ctx.inFront)
  return { record: kind !== 'test', desktop, sound: desktop && s.sound }
}

/** The body the OS shows: the text, or only who it is from when previews are off. */
export function desktopBody(n: Pick<Notice, 'kind' | 'body' | 'target'>, preview: boolean): string {
  if (preview || n.kind !== 'chat') return n.body
  return 'New reply. Open Mission Control to read it.'
}

/** One line of a reply for a notice: no markdown marks, no line breaks, cut with an ellipsis. */
export function previewText(text: string, max = 140): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
