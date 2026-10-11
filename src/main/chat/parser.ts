/** What the parser turns one line of Hermes output into, before the service adds the turn and profile. */
export type ParsedChat =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'ok' | 'error'; ms?: number }
  | { kind: 'result'; exitCode: number | null; durationMs?: number; inputTokens?: number; outputTokens?: number }
  | { kind: 'notice'; code: 'blocked'; message: string }
  | { kind: 'error'; message: string }

export const BLOCKED_MESSAGE = 'Command blocked by Hermes approval policy'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/
const BLOCKED = /approv|not allowed|blocked|denied by (policy|user)|requires? (confirmation|permission)/i

/** Text can arrive as a string or as a list of blocks that have `text`. */
function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    const parts = v.map((b) => (isObj(b) ? str(b['text']) : typeof b === 'string' ? b : undefined)).filter((x): x is string => x !== undefined)
    return parts.length ? parts.join('') : undefined
  }
  return undefined
}

/**
 * Reads the stream-json output of `hermes chat`. The exact event shapes are not pinned down in the Hermes
 * documentation, so it accepts the usual spellings, ignores what it does not know and never throws.
 */
export class ChatLineParser {
  private sawText = false
  private sessionSent = false
  private started = new Map<string, { name: string; at: number }>()
  /** Lines that were not JSON, kept for error messages. */
  noise: string[] = []

  constructor(private readonly now: () => number = Date.now) {}

  parse(line: string): ParsedChat[] {
    const t = line.trim()
    if (!t) return []
    let raw: unknown
    try {
      raw = JSON.parse(t)
    } catch {
      this.noise.push(t.slice(0, 300))
      if (this.noise.length > 20) this.noise.shift()
      return []
    }
    if (!isObj(raw)) return []
    const type = str(raw['type']) ?? str(raw['event'])
    const out: ParsedChat[] = []
    const sid = str(raw['session_id']) ?? str(raw['sessionId']) ?? (isObj(raw['session']) ? str(raw['session']['id']) : undefined)
    if (sid && SESSION_ID.test(sid) && !this.sessionSent) {
      this.sessionSent = true
      out.push({ kind: 'session', sessionId: sid })
    }
    switch (type) {
      case 'text':
      case 'delta':
      case 'text_delta': {
        const text = textOf(raw['text']) ?? textOf(raw['delta']) ?? textOf(raw['content'])
        if (text) {
          this.sawText = true
          out.push({ kind: 'text', text })
        }
        break
      }
      case 'assistant':
      case 'message': {
        // a whole message instead of deltas: only worth showing when no deltas came
        const msg = isObj(raw['message']) ? raw['message'] : raw
        const text = textOf(msg['content']) ?? textOf(msg['text'])
        if (text && !this.sawText) out.push({ kind: 'text', text })
        break
      }
      case 'tool_use': {
        const name = str(raw['name']) ?? str(raw['tool']) ?? 'tool'
        const id = str(raw['id']) ?? str(raw['tool_use_id']) ?? `${name}-${this.started.size + 1}`
        this.started.set(id, { name, at: this.now() })
        out.push({ kind: 'tool', id, name, state: 'running' })
        break
      }
      case 'tool_result': {
        const id = str(raw['tool_use_id']) ?? str(raw['id'])
        const begun = id ? this.started.get(id) : undefined
        const name = str(raw['name']) ?? begun?.name ?? 'tool'
        const failed = raw['is_error'] === true || raw['error'] !== undefined && raw['error'] !== null && raw['error'] !== false
        const ms = num(raw['duration_ms']) ?? (begun ? this.now() - begun.at : undefined)
        const body = textOf(raw['output']) ?? textOf(raw['content']) ?? textOf(raw['error']) ?? ''
        out.push({ kind: 'tool', id: id ?? `${name}-r`, name, state: failed ? 'error' : 'ok', ...(ms !== undefined ? { ms } : {}) })
        if (failed && BLOCKED.test(body)) out.push({ kind: 'notice', code: 'blocked', message: BLOCKED_MESSAGE })
        break
      }
      case 'result': {
        const usage = isObj(raw['usage']) ? raw['usage'] : isObj(raw['tokens']) ? raw['tokens'] : {}
        const exit = num(raw['exit_code']) ?? num(raw['exitCode']) ?? null
        const ev: ParsedChat = { kind: 'result', exitCode: exit }
        const d = num(raw['duration_ms'])
        const i = num(usage['input_tokens']) ?? num(usage['input'])
        const o = num(usage['output_tokens']) ?? num(usage['output'])
        if (d !== undefined) ev.durationMs = d
        if (i !== undefined) ev.inputTokens = i
        if (o !== undefined) ev.outputTokens = o
        out.push(ev)
        break
      }
      case 'error': {
        const message = str(raw['message']) ?? textOf(raw['error']) ?? 'Hermes reported an error'
        out.push({ kind: 'error', message: message.slice(0, 500) })
        break
      }
      default:
        break
    }
    return out
  }
}
