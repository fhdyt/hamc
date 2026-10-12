import { create } from 'zustand'
import type { AgentInfo, AgentsData } from '@shared/events'
import type { AgentModels } from '@shared/ipc'
import { withBusy } from '../lib/roster'

interface AgentsState {
  /** As the server reported them. */
  raw: AgentInfo[]
  /** Agents that are answering a chat from this app right now. */
  busy: string[]
  /** `raw` with the busy agents shown as working. */
  agents: AgentInfo[]
  gateway: AgentsData['gateway'] | null
  models: AgentModels
  receivedAt: number | null
  pins: string[]
  pinsReady: boolean
  selected: string | null
  query: string
  applyAgents(data: AgentsData, now?: number): void
  setBusy(busy: string[]): void
  setModels(m: AgentModels): void
  setPins(pins: string[]): void
  select(profile: string | null): void
  setQuery(q: string): void
  reset(): void
}

const EMPTY = { raw: [], busy: [], agents: [], gateway: null, models: {}, receivedAt: null, pins: [], pinsReady: false, selected: null, query: '' }

export const useAgents = create<AgentsState>()((set) => ({
  ...EMPTY,
  applyAgents: (data, now = Date.now()) =>
    set((s) => ({
      raw: data.agents,
      agents: withBusy(data.agents, s.busy),
      gateway: data.gateway,
      receivedAt: now,
      selected: s.selected && data.agents.some((a) => a.profile === s.selected) ? s.selected : null
    })),
  setBusy: (busy) => set((s) => (busy.length === s.busy.length && busy.every((p, i) => p === s.busy[i]) ? s : { busy, agents: withBusy(s.raw, busy) })),
  setModels: (models) => set({ models }),
  setPins: (pins) => set({ pins, pinsReady: true }),
  select: (selected) => set({ selected }),
  setQuery: (query) => set({ query }),
  reset: () => set({ ...EMPTY })
}))
