const DASH = '—'

/** The keys of the approval policy the tab always shows (F-LOG-7), in this order. */
export const POLICY_KEYS = ['mode', 'cron_mode', 'single_query_mode', 'unattended_mode', 'timeout', 'deny', 'command_allowlist'] as const

export interface PolicyEntry {
  key: string
  value: string
  known: boolean
}

export interface Policy {
  entries: PolicyEntry[]
  /** The text exactly as Hermes printed it. */
  raw: string
}

function show(v: unknown): string {
  if (v === null || v === undefined) return DASH
  if (Array.isArray(v)) return v.length === 0 ? '(none)' : v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  return s === '' ? DASH : s
}

function toMap(text: string): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      const inner = obj['approvals']
      const src = inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : obj
      for (const [k, v] of Object.entries(src)) map.set(k, show(v))
      return map
    }
  } catch {
    /* not JSON: read "key: value" lines */
  }
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue
    const m = /^\s*([A-Za-z_][\w.]*)\s*[:=]\s*(.*?)\s*$/.exec(line)
    if (m) map.set(m[1]!, m[2] === '' ? DASH : m[2]!)
  }
  return map
}

/**
 * The approval policy of an agent from the text of `hermes config get approvals`. The shape is not documented, so
 * JSON and `key: value` text both work, missing keys show a dash and unknown keys are shown as they are.
 */
export function parsePolicy(text: string): Policy {
  const map = toMap(text)
  const known: PolicyEntry[] = POLICY_KEYS.map((key) => ({ key, value: map.get(key) ?? DASH, known: true }))
  const extra: PolicyEntry[] = [...map.entries()].filter(([k]) => !(POLICY_KEYS as readonly string[]).includes(k)).map(([key, value]) => ({ key, value, known: false }))
  return { entries: [...known, ...extra], raw: text }
}

/** The lines of `hermes approvals suggest`, for the Copy buttons. */
export function suggestionLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
}
