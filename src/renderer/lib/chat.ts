import type { FeedItem } from '@shared/events'
import type { ChatEvent } from '@shared/ipc'
import { compareFeed, mergeFeed } from './feed'

export interface ToolChip {
  id: string
  name: string
  state: 'running' | 'ok' | 'error'
  ms?: number
}

/** One turn of a chat as the main process reports it while it runs. */
export interface Turn {
  id: string
  mode: 'stream-json' | 'plain'
  note?: string
  text: string
  tools: ToolChip[]
  notice?: string
  error?: string
  result?: { exitCode: number | null; durationMs?: number; inputTokens?: number; outputTokens?: number }
  /** True once the process has ended. */
  ended: boolean
  stopped: boolean
  startedAt: number
}

export interface PendingUser {
  text: string
  at: number
  attachments: { name: string; thumb?: string }[]
}

export interface AttachmentRef {
  path: string
  name: string
  info: string
}

export type Conv =
  | { kind: 'user'; id: string; ts: number; text: string; attachments: AttachmentRef[]; pending?: boolean; thumbs?: { name: string; thumb?: string }[] }
  | { kind: 'thinking'; id: string; ts: number; text: string; truncated: boolean }
  | { kind: 'tool'; id: string; ts: number; name: string; call: string; result?: string; resultTruncated?: boolean }
  | { kind: 'reply'; id: string; ts: number; text: string; truncated: boolean; messageId: number; profile: string }
  | { kind: 'stream'; id: string; ts: number; turn: Turn; showChips: boolean }

export const newTurn = (id: string, mode: Turn['mode'], at: number, note?: string): Turn => ({ id, mode, ...(note ? { note } : {}), text: '', tools: [], ended: false, stopped: false, startedAt: at })

/** Folds one chat event into the running turn (null when the event belongs to a turn that is no longer shown). */
export function foldEvent(turn: Turn | null, ev: ChatEvent, now = Date.now()): Turn | null {
  if (ev.kind === 'start') return newTurn(ev.turn, ev.mode, now, ev.note)
  if (!turn || turn.id !== ev.turn) return turn
  switch (ev.kind) {
    case 'text':
      return { ...turn, text: turn.text + ev.text }
    case 'tool': {
      const i = turn.tools.findIndex((t) => t.id === ev.id)
      const chip: ToolChip = { id: ev.id, name: ev.name, state: ev.state, ...(ev.ms !== undefined ? { ms: ev.ms } : {}) }
      const tools = i < 0 ? [...turn.tools, chip] : turn.tools.map((t, k) => (k === i ? { ...t, ...chip } : t))
      return { ...turn, tools }
    }
    case 'result':
      return { ...turn, result: { exitCode: ev.exitCode, ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}), ...(ev.inputTokens !== undefined ? { inputTokens: ev.inputTokens } : {}), ...(ev.outputTokens !== undefined ? { outputTokens: ev.outputTokens } : {}) } }
    case 'notice':
      return { ...turn, notice: ev.message }
    case 'error':
      return { ...turn, error: ev.message }
    case 'end':
      return { ...turn, ended: true, stopped: ev.stopped }
    default:
      return turn
  }
}

const ATTACHED = /^\[Attached: (.+?) · ([^·]+?) · ([^·\]]+?)\]\s*$/

/** Splits the `[Attached: …]` lines the app puts at the top of a message from the text the user wrote. */
export function splitAttachments(text: string): { attachments: AttachmentRef[]; text: string } {
  const lines = text.split('\n')
  const attachments: AttachmentRef[] = []
  let i = 0
  for (; i < lines.length; i++) {
    const m = ATTACHED.exec(lines[i]!)
    if (!m) break
    attachments.push({ path: m[1]!, name: m[1]!.split('/').pop() ?? m[1]!, info: `${m[2]} · ${m[3]}` })
  }
  return { attachments, text: lines.slice(i).join('\n').replace(/^\n+/, '') }
}

/** Items of one chat session, from the history that was loaded and from the live feed, oldest first. */
export function sessionItems(history: readonly FeedItem[], live: readonly FeedItem[], profile: string, sessionId: string | null): FeedItem[] {
  if (!sessionId) return []
  const mine = live.filter((i) => i.profile === profile && i.sessionId === sessionId)
  return mergeFeed(history as FeedItem[], mine, Infinity).items.slice().sort((a, b) => compareFeed(b, a))
}

const sameText = (a: string, b: string): boolean => {
  const x = a.trim().replace(/\s+/g, ' ')
  const y = b.trim().replace(/\s+/g, ' ')
  return x === y || (x.length > 0 && y.length > 0 && (x.startsWith(y.slice(0, 200)) || y.startsWith(x.slice(0, 200))))
}

/**
 * What the conversation shows: the saved messages of the session (user, thinking, tool steps, replies), the message
 * that was just sent while the server has not saved it yet, and the reply that is being written.
 */
export function buildConversation(items: readonly FeedItem[], pending: PendingUser | null, turn: Turn | null): Conv[] {
  const out: Conv[] = []
  for (const it of items) {
    if (it.kind === 'user') {
      const s = splitAttachments(it.text)
      out.push({ kind: 'user', id: it.id, ts: it.ts, text: s.text, attachments: s.attachments })
    } else if (it.kind === 'thinking') out.push({ kind: 'thinking', id: it.id, ts: it.ts, text: it.text, truncated: it.truncated })
    else if (it.kind === 'tool') out.push({ kind: 'tool', id: it.id, ts: it.ts, name: it.toolName ?? 'tool', call: it.text })
    else if (it.kind === 'result') {
      // a result belongs to the closest earlier call of the same tool that has none yet
      for (let k = out.length - 1; k >= 0; k--) {
        const c = out[k]!
        if (c.kind === 'tool' && c.result === undefined && c.name === (it.toolName ?? 'tool')) {
          c.result = it.text
          c.resultTruncated = it.truncated
          break
        }
        if (c.kind === 'user' || c.kind === 'reply') break
      }
    } else out.push({ kind: 'reply', id: it.id, ts: it.ts, text: it.text, truncated: it.truncated, messageId: it.messageId, profile: it.profile })
  }
  const startedS = turn ? turn.startedAt / 1000 : 0
  if (pending) {
    const saved = out.some((c) => c.kind === 'user' && c.ts >= pending.at / 1000 - 10 && sameText(c.text, pending.text))
    if (!saved) out.push({ kind: 'user', id: 'pending', ts: pending.at / 1000, text: pending.text, attachments: [], pending: true, thumbs: pending.attachments })
  }
  if (turn) {
    const savedReply = turn.ended && out.some((c) => c.kind === 'reply' && c.ts >= startedS - 2)
    const dbTools = out.some((c) => c.kind === 'tool' && c.ts >= startedS - 2)
    const hasContent = turn.text !== '' || turn.tools.length > 0 || !turn.ended || turn.error !== undefined || turn.notice !== undefined || turn.stopped
    if (!savedReply && hasContent) out.push({ kind: 'stream', id: 'stream', ts: turn.startedAt / 1000, turn, showChips: !dbTools })
  }
  return out
}

/** "web_search ✓ 1.2s" */
export function chipText(t: ToolChip): string {
  const s = t.ms !== undefined ? (t.ms >= 1000 ? `${(t.ms / 1000).toFixed(1)}s` : `${Math.round(t.ms)}ms`) : ''
  return t.state === 'running' ? `${t.name}…` : `${t.name} ${t.state === 'ok' ? '✓' : '✗'}${s ? ` ${s}` : ''}`
}

export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

/** The tool arguments of a call item, e.g. `web_search {"q": "x"}` → `{"q":"x"}`. */
export function callArgs(call: string, name: string): string {
  const rest = call.startsWith(name) ? call.slice(name.length).trim() : call
  try {
    return JSON.stringify(JSON.parse(rest))
  } catch {
    return rest
  }
}
