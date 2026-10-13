export const TITLE_MAX = 80

/** The title as it will be sent, or null when it is empty, too long or holds control characters. */
export function validTitle(t: string): string | null {
  const s = t.trim()
  // eslint-disable-next-line no-control-regex
  if (s.length < 1 || s.length > TITLE_MAX || /[\u0000-\u001f\u007f]/.test(s)) return null
  return s
}

export type SessionAction = 'pin' | 'unpin' | 'rename'

/** The arguments after `hermes`. The main process builds the command from these; the renderer only shows the preview. */
export function sessionCommandArgs(action: SessionAction, profile: string, id: string, title?: string): string[] {
  const p = profile === 'default' ? [] : ['-p', profile]
  return [...p, 'sessions', action, id, ...(action === 'rename' && title !== undefined ? [title] : [])]
}

export function sessionCommandPreview(action: SessionAction, profile: string, id: string, title?: string): string {
  const parts = sessionCommandArgs(action, profile, id, title)
  const shown = parts.map((x, i) => (action === 'rename' && i === parts.length - 1 ? `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : x))
  return `$ hermes ${shown.join(' ')}`
}

export const RANGES = ['today', '7d', '14d', '30d', 'all'] as const
export type Range = (typeof RANGES)[number]

/** Start of the range in epoch seconds, or undefined for "all". */
export function sinceFor(range: Range, now: number): number | undefined {
  if (range === 'all') return undefined
  if (range === '7d') return now - 7 * 86400
  if (range === '14d') return now - 14 * 86400
  if (range === '30d') return now - 30 * 86400
  const d = new Date(now * 1000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000
}

export interface SessionFilterArgs {
  /** Empty means every profile. */
  profiles: string[]
  source?: string
  sinceTs?: number
}
export interface SessionsListArgs extends SessionFilterArgs {
  before?: { ts: number | null; id: string }
  limit: number
}
export interface SessionsSearchArgs extends SessionFilterArgs {
  q: string
  limit: number
}
export interface TranscriptArgs {
  profile: string
  sessionId: string
  afterId?: number
  limit: number
}

export type SessionActionResult = { ok: true } | { ok: false; error: 'not-connected' | 'bad-input' | 'failed'; detail?: string }

export type ExportExt = 'jsonl' | 'md' | 'html'
export type ExportResult = { saved: string } | { canceled: true } | { failed: string }
