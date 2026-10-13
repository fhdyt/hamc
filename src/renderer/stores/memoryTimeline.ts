import { create } from 'zustand'
import type { AgentFileKind } from '@shared/agentCfg'
import type { MemoryVersion } from '@shared/memory'

export type BrainTab = 'graph' | 'timeline'
export type VersionsEntry = { key: string; status: 'loading' } | { key: string; status: 'ok'; list: MemoryVersion[] }
export type VersionText = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; text: string }

interface MemoryTimelineState {
  tab: BrainTab
  /** The agent and file on screen; the agent defaults to the first one when null. */
  profile: string | null
  file: AgentFileKind
  versions: VersionsEntry | null
  /** Index of the picked version in `versions` (0 is the newest). */
  picked: number
  texts: Record<number, VersionText>
  sameOpen: boolean
  note: string | null
  setTab(tab: BrainTab): void
  choose(patch: { profile?: string; file?: AgentFileKind }): void
  setVersions(entry: VersionsEntry): void
  pick(i: number): void
  setText(id: number, t: VersionText): void
  toggleSame(): void
  setNote(note: string | null): void
  reset(): void
}

const EMPTY = { tab: 'graph' as const, profile: null, file: 'memory' as const, versions: null, picked: 0, texts: {}, sameOpen: false, note: null }

export const useMemoryTimeline = create<MemoryTimelineState>()((set) => ({
  ...EMPTY,
  setTab: (tab) => set({ tab }),
  choose: (patch) => set((s) => ({ ...patch, versions: null, picked: 0, sameOpen: false, note: null, texts: patch.profile && patch.profile !== s.profile ? {} : s.texts })),
  setVersions: (versions) =>
    set((s) => {
      if (versions.status !== 'ok' || s.versions?.status !== 'ok') return { versions }
      // keep the picked version when newer ones arrive
      const id = s.versions.list[s.picked]?.id
      const at = s.picked === 0 ? 0 : Math.max(0, versions.list.findIndex((v) => v.id === id))
      return { versions, picked: at }
    }),
  pick: (picked) => set({ picked, sameOpen: false, note: null }),
  setText: (id, t) => set((s) => ({ texts: { ...s.texts, [id]: t } })),
  toggleSame: () => set((s) => ({ sameOpen: !s.sameOpen })),
  setNote: (note) => set({ note }),
  reset: () => set({ ...EMPTY })
}))
