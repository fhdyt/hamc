import type { AgentFileKind } from '@shared/agentCfg'
import { FILE_LIMITS } from '@shared/agentCfg'
import type { MemoryAuthor, MemoryVersion } from '@shared/memory'

export const FILES: { id: AgentFileKind; label: string }[] = [
  { id: 'memory', label: 'MEMORY.md' },
  { id: 'user', label: 'USER.md' },
  { id: 'soul', label: 'SOUL.md' }
]

export const fileLabel = (f: AgentFileKind): string => FILES.find((x) => x.id === f)?.label ?? f

/** The character limit Hermes keeps for the file, or null (SOUL has none). */
export const limitOf = (f: AgentFileKind): number | null => (f === 'soul' ? null : (FILE_LIMITS[f] ?? null))

export const versionWhen = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

const dayOf = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

export interface AuthorView {
  label: string
  color: string
  how: string
}

/** How a version is labelled (F-MEMT-3); `agentName` and `agentColor` belong to the profile. */
export function authorView(a: MemoryAuthor, agentName: string, agentColor: string): AuthorView {
  switch (a) {
    case 'agent':
      return { label: `${agentName} (agent)`, color: agentColor, how: 'Probably the agent: its memory tool ran within two minutes of this change.' }
    case 'you':
      return { label: 'you', color: '#50FA7B', how: 'Saved from Mission Control (Settings → Agents).' }
    case 'away':
      return { label: 'while away', color: '#FFB86C', how: 'Changed while Mission Control was not watching; found when it connected.' }
    case 'other':
      return { label: 'not attributed', color: '#A9B2D3', how: 'Changed while connected, with no memory tool call nearby (a terminal edit, another tool, or the agent through a file tool).' }
    case 'first':
      return { label: 'first snapshot', color: '#8B95BD', how: 'The first version Mission Control kept of this file.' }
  }
}

export interface VersionRow {
  v: MemoryVersion
  index: number
  day: string
  newDay: boolean
  time: string
  pct: number | null
}

/** Versions newest first with a day header whenever the day changes (F-MEMT-1). */
export function versionRows(list: readonly MemoryVersion[], file: AgentFileKind): VersionRow[] {
  const limit = limitOf(file)
  let last = ''
  return list.map((v, index) => {
    const day = dayOf(v.takenAt)
    const newDay = day !== last
    last = day
    return { v, index, day, newDay, time: timeOf(v.takenAt), pct: limit ? Math.min(100, Math.round((v.chars / limit) * 100)) : null }
  })
}
