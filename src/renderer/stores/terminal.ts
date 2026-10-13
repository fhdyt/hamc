import { create } from 'zustand'
import type { TermTab } from '../lib/terminal'

interface TerminalState {
  tabs: TermTab[]
  active: string | null
  searchOpen: boolean
  snippetsOpen: boolean
  set(patch: Partial<Omit<TerminalState, 'set' | 'patchTab'>>): void
  patchTab(key: string, patch: Partial<TermTab>): void
}

export const useTerminal = create<TerminalState>()((set) => ({
  tabs: [],
  active: null,
  searchOpen: false,
  snippetsOpen: false,
  set: (patch) => set(patch),
  patchTab: (key, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) }))
}))
