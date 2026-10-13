import type { AgentFileKind } from './agentCfg'

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
}

export type MemoryVersionText = { ok: true; id: number; text: string } | { ok: false; error: 'not-found' | 'not-connected' }
