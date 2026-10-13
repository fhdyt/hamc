import { create } from 'zustand'
import type { UsageSummary, UsageTools } from '@shared/events'
import type { ToolSort } from '../lib/tools'

type Status = 'idle' | 'loading' | 'ok' | 'error'

interface UsageState {
  tab: 'cost' | 'tools'
  /** The local midnights the summary was asked for; row `day` values index into this. */
  dayStarts: number[]
  summary: UsageSummary | null
  tools: UsageTools | null
  status: Status
  toolsStatus: Status
  error: string | null
  toolsError: string | null
  receivedAt: number | null
  toolsReceivedAt: number | null
  pinnedDay: number | null
  /** Set by the palette action "Show today's cost": the last day is pinned as soon as the days are known. */
  pinToday: boolean
  toolSort: ToolSort
  selectedTool: string | null
  setTab(tab: 'cost' | 'tools'): void
  applySummary(data: UsageSummary, dayStarts: number[], now?: number): void
  applyTools(data: UsageTools, now?: number): void
  setStatus(status: 'loading'): void
  setError(message: string): void
  setToolsStatus(status: 'loading'): void
  setToolsError(message: string): void
  pinDay(day: number | null): void
  requestPinToday(): void
  setSort(sort: ToolSort): void
  selectTool(name: string | null): void
  /** A new filter: the old numbers belong to another selection. */
  clearData(): void
  reset(): void
}

const EMPTY = {
  tab: 'cost' as 'cost' | 'tools',
  dayStarts: [] as number[],
  summary: null as UsageSummary | null,
  tools: null as UsageTools | null,
  status: 'idle' as Status,
  toolsStatus: 'idle' as Status,
  error: null as string | null,
  toolsError: null as string | null,
  receivedAt: null as number | null,
  toolsReceivedAt: null as number | null,
  pinnedDay: null as number | null,
  pinToday: false,
  toolSort: 'calls' as ToolSort,
  selectedTool: null as string | null
}

export const useUsage = create<UsageState>()((set) => ({
  ...EMPTY,
  setTab: (tab) => set({ tab }),
  applySummary: (summary, dayStarts, now = Date.now()) =>
    set((s) => ({ summary, dayStarts, status: 'ok', error: null, receivedAt: now, ...(s.pinToday && dayStarts.length > 0 ? { pinnedDay: dayStarts.length - 1, pinToday: false } : {}) })),
  applyTools: (tools, now = Date.now()) => set({ tools, toolsStatus: 'ok', toolsError: null, toolsReceivedAt: now }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ status: 'error', error }),
  setToolsStatus: (toolsStatus) => set({ toolsStatus }),
  setToolsError: (toolsError) => set({ toolsStatus: 'error', toolsError }),
  requestPinToday: () => set((s) => (s.dayStarts.length > 0 ? { pinnedDay: s.dayStarts.length - 1, pinToday: false } : { pinToday: true })),
  pinDay: (day) => set((s) => ({ pinnedDay: day === null || s.pinnedDay === day ? null : day })),
  setSort: (toolSort) => set({ toolSort }),
  selectTool: (selectedTool) => set({ selectedTool }),
  clearData: () => set({ summary: null, tools: null, status: 'idle', toolsStatus: 'idle', error: null, toolsError: null, receivedAt: null, toolsReceivedAt: null, pinnedDay: null }),
  reset: () => set({ ...EMPTY })
}))
