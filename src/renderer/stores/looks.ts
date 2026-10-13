import { create } from 'zustand'
import type { AgentLook, AgentLooks } from '@shared/looks'
import { useAgents } from './agents'

/* Local display names and photos of the agents (F-SHELL-6). They live in app.db on this computer only. */

interface LooksState {
  looks: AgentLooks
  setLooks(looks: AgentLooks): void
  setLook(profile: string, look: AgentLook | null): void
  reset(): void
}

const namesOf = (looks: AgentLooks): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [p, l] of Object.entries(looks)) if (l.name) out[p] = l.name
  return out
}

export const useLooks = create<LooksState>()((set) => ({
  looks: {},
  setLooks: (looks) => {
    set({ looks })
    useAgents.getState().setNames(namesOf(looks))
  },
  setLook: (profile, look) =>
    set((s) => {
      const looks = { ...s.looks }
      if (look && (look.name || look.photo)) looks[profile] = look
      else delete looks[profile]
      useAgents.getState().setNames(namesOf(looks))
      return { looks }
    }),
  reset: () => {
    set({ looks: {} })
    useAgents.getState().setNames({})
  }
}))
