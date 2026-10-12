import { create } from 'zustand'
import type { AgentFileKind } from '@shared/agentCfg'
import { anyDirty, draftKey, emptyDraft, isDirty, type Draft } from '../lib/agentCfg'

export type AgentTab = 'model' | AgentFileKind

interface AgentCfgState {
  /** The agent whose settings are open. */
  profile: string | null
  tab: AgentTab
  /** Editors by `profile:kind`. They live in memory only. */
  drafts: Record<string, Draft>
  /** Profiles whose Model tab has choices that were not saved. */
  modelDirty: Record<string, boolean>
  /** A leave that waits for the answer to "You have unsaved changes". */
  leave: { message: string; proceed: () => void } | null
  selectProfile(profile: string | null): void
  setTab(tab: AgentTab): void
  patchDraft(profile: string, kind: AgentFileKind, fn: (d: Draft) => Draft): void
  setModelDirty(profile: string, dirty: boolean): void
  /** Forgets the drafts of one agent, or of all. */
  discard(profile?: string): void
  /** Runs `proceed` now when there is nothing unsaved, otherwise after the user chose Discard. */
  requestLeave(message: string, proceed: () => void, profile?: string): void
  answerLeave(discard: boolean): void
}

export const unsavedFor = (s: Pick<AgentCfgState, 'drafts' | 'modelDirty'>, profile?: string): boolean => {
  const drafts = profile ? Object.fromEntries(Object.entries(s.drafts).filter(([, d]) => d.profile === profile)) : s.drafts
  const model = profile ? !!s.modelDirty[profile] : Object.values(s.modelDirty).some(Boolean)
  return anyDirty(drafts) || model
}

export const unsavedKinds = (s: Pick<AgentCfgState, 'drafts' | 'modelDirty'>, profile: string): Set<AgentTab> => {
  const out = new Set<AgentTab>()
  for (const d of Object.values(s.drafts)) if (d.profile === profile && isDirty(d)) out.add(d.kind)
  if (s.modelDirty[profile]) out.add('model')
  return out
}

export const useAgentCfg = create<AgentCfgState>()((set, get) => ({
  profile: null,
  tab: 'model',
  drafts: {},
  modelDirty: {},
  leave: null,
  selectProfile: (profile) => set({ profile }),
  setTab: (tab) => set({ tab }),
  patchDraft: (profile, kind, fn) =>
    set((s) => {
      const key = draftKey(profile, kind)
      return { drafts: { ...s.drafts, [key]: fn(s.drafts[key] ?? emptyDraft(profile, kind)) } }
    }),
  setModelDirty: (profile, dirty) => set((s) => (!!s.modelDirty[profile] === dirty ? s : { modelDirty: { ...s.modelDirty, [profile]: dirty } })),
  discard: (profile) =>
    set((s) => {
      if (!profile) return { drafts: {}, modelDirty: {} }
      return {
        drafts: Object.fromEntries(Object.entries(s.drafts).filter(([, d]) => d.profile !== profile)),
        modelDirty: Object.fromEntries(Object.entries(s.modelDirty).filter(([p]) => p !== profile))
      }
    }),
  requestLeave: (message, proceed, profile) => {
    if (!unsavedFor(get(), profile)) return proceed()
    set({ leave: { message, proceed: () => { get().discard(profile); proceed() } } })
  },
  answerLeave: (discard) => {
    const l = get().leave
    set({ leave: null })
    if (discard) l?.proceed()
  }
}))
