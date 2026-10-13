import type { AgentFileKind } from './agentCfg'
import { lineDiff } from './textDiff'

/** Who probably changed a memory file (F-MEMT-3); always a guess. */
export const MEMORY_AUTHORS = ['agent', 'you', 'away', 'other', 'first'] as const
export type MemoryAuthor = (typeof MEMORY_AUTHORS)[number]

export interface MemoryVersion {
  id: number
  profile: string
  file: AgentFileKind
  takenAt: number
  hash: string
  author: MemoryAuthor
  sessionId: string | null
  mtime: number | null
  chars: number
  /** Entries (MEMORY, USER) or lines (SOUL) added and removed against the version before. */
  added: number
  removed: number
}

export type MemoryVersionText = { ok: true; id: number; text: string } | { ok: false; error: 'not-found' | 'not-connected' }

/** Hermes joins MEMORY.md and USER.md entries with this (tools/memory_tool_store.py ENTRY_DELIMITER). */
export const ENTRY_DELIMITER = '\n§\n'

/** The units a version is compared in: `§` entries for MEMORY and USER, lines for SOUL. */
export function memoryItems(file: AgentFileKind, text: string): string[] {
  if (file === 'soul') {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines
  }
  return text
    .replace(/\r\n/g, '\n')
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter(Boolean)
}

export interface ItemDiff {
  rows: { t: 'add' | 'del'; text: string }[]
  same: string[]
}

/** Entries as a multiset for MEMORY and USER (order is not meaningful), an ordered line diff for SOUL. */
export function diffItems(file: AgentFileKind, prev: string, cur: string): ItemDiff {
  if (file === 'soul') {
    const ops = lineDiff(memoryItems('soul', prev).join('\n'), memoryItems('soul', cur).join('\n'))
    return { rows: ops.filter((o): o is { t: 'add' | 'del'; text: string } => o.t !== 'same'), same: ops.filter((o) => o.t === 'same').map((o) => o.text) }
  }
  const before = memoryItems(file, prev)
  const left = new Map<string, number>()
  for (const e of before) left.set(e, (left.get(e) ?? 0) + 1)
  const rows: ItemDiff['rows'] = []
  const same: string[] = []
  for (const e of memoryItems(file, cur)) {
    const n = left.get(e) ?? 0
    if (n > 0) {
      left.set(e, n - 1)
      same.push(e)
    } else rows.push({ t: 'add', text: e })
  }
  for (const e of before) {
    const n = left.get(e) ?? 0
    if (n > 0) {
      left.set(e, n - 1)
      rows.push({ t: 'del', text: e })
    }
  }
  return { rows, same }
}

export function diffCounts(file: AgentFileKind, prev: string, cur: string): { added: number; removed: number } {
  const d = diffItems(file, prev, cur)
  return { added: d.rows.filter((r) => r.t === 'add').length, removed: d.rows.filter((r) => r.t === 'del').length }
}
