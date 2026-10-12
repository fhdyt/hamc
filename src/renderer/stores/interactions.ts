import { create } from 'zustand'
import type { InteractionsData } from '@shared/events'

export type Selection = { type: 'edge' | 'node'; id: string }

interface InteractionsState {
  /** The last snapshot from the server (7 days; kinds and range are applied when drawing). */
  data: InteractionsData | null
  receivedAt: number | null
  selected: Selection | null
  apply(data: InteractionsData, now?: number): void
  select(sel: Selection | null): void
  reset(): void
}

const EMPTY = { data: null, receivedAt: null, selected: null }

/** A selection survives only while what it points at is still in the snapshot; agents are always kept. */
function stillThere(sel: Selection, data: InteractionsData): boolean {
  if (sel.type === 'edge') return data.edges.some((e) => e.id === sel.id)
  if (sel.id.startsWith('room:')) return data.rooms.some((r) => r.id === sel.id)
  if (sel.id.startsWith('sub:')) return data.subagents.some((s) => s.id === sel.id)
  return true
}

export const useInteractions = create<InteractionsState>()((set) => ({
  ...EMPTY,
  apply: (data, now = Date.now()) => set((s) => ({ data, receivedAt: now, selected: s.selected && stillThere(s.selected, data) ? s.selected : null })),
  select: (selected) => set({ selected }),
  reset: () => set({ ...EMPTY })
}))
