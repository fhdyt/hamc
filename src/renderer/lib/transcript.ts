import type { FeedItem, FeedKind } from '@shared/events'

export interface Step {
  kind: Exclude<FeedKind, 'result'>
  /** The item itself; for a result with no call in view, the result. */
  item: FeedItem
  result?: FeedItem
  /** Tool steps: name and arguments text. */
  name?: string
  args?: string
  /** Approximate time between the call and its result, in milliseconds. */
  ms?: number
  /** A best guess from the result text. */
  failed?: boolean
}

/** Best effort: results carry no status, so the text is all there is to go on. */
export function looksFailed(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (/^(error|traceback|exception|failed)\b/.test(t)) return true
  return t.includes('"error":') || /exit code [1-9]/.test(t)
}

const argsOf = (item: FeedItem): string => {
  const name = item.toolName ?? ''
  return name && item.text.startsWith(name) ? item.text.slice(name.length).trim() : item.text
}

/** Pairs each tool call with the next unmatched result of the same tool. Every item ends up in exactly one step. */
export function buildSteps(items: readonly FeedItem[]): Step[] {
  const steps: Step[] = []
  const open: Step[] = []
  for (const it of items) {
    if (it.kind === 'tool') {
      const s: Step = { kind: 'tool', item: it, name: it.toolName ?? 'tool', args: argsOf(it) }
      steps.push(s)
      open.push(s)
    } else if (it.kind === 'result') {
      const i = open.findIndex((s) => (s.item.toolName ?? '') === (it.toolName ?? ''))
      if (i >= 0) {
        const s = open.splice(i, 1)[0]!
        s.result = it
        s.ms = Math.max(0, Math.round((it.ts - s.item.ts) * 1000))
        s.failed = looksFailed(it.text)
      } else steps.push({ kind: 'tool', item: it, name: it.toolName ?? 'tool', args: '', failed: looksFailed(it.text) })
    } else steps.push({ kind: it.kind, item: it })
  }
  return steps
}
