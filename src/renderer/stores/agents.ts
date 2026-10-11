import { create } from 'zustand'
import type { AgentInfo, AgentsData } from '@shared/events'
import type { AgentModels } from '@shared/ipc'

interface AgentsState {
  agents: AgentInfo[]
  gateway: AgentsData['gateway'] | null
  models: AgentModels
  receivedAt: number | null
  pins: string[]
  pinsReady: boolean
  selected: string | null
  query: string
  applyAgents(data: AgentsData, now?: number): void
  setModels(m: AgentModels): void
  setPins(pins: string[]): void
  select(profile: string | null): void
  setQuery(q: string): void
  reset(): void
}

const EMPTY = { agents: [], gateway: null, models: {}, receivedAt: null, pins: [], pinsReady: false, selected: null, query: '' }

export const useAgents = create<AgentsState>()((set) => ({
  ...EMPTY,
  applyAgents: (data, now = Date.now()) =>
    set((s) => ({
      agents: data.agents,
      gateway: data.gateway,
      receivedAt: now,
      selected: s.selected && data.agents.some((a) => a.profile === s.selected) ? s.selected : null
    })),
  setModels: (models) => set({ models }),
  setPins: (pins) => set({ pins, pinsReady: true }),
  select: (selected) => set({ selected }),
  setQuery: (query) => set({ query }),
  reset: () => set({ ...EMPTY })
}))
