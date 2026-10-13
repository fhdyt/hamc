import { create } from 'zustand'
import type { SkillAction } from '@shared/skills'
import type { SkillLedgerEntry, SkillsList } from '@shared/events'
import type { SkillKind } from '../lib/skills'

export type SkillsTab = 'library' | 'changes'
export type TextEntry = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; text: string; truncated?: boolean }
export type LedgerEntry = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; entries: SkillLedgerEntry[]; exists: boolean; truncated: boolean }
export interface SkillNote {
  ok: boolean
  title: string
  detail: string | null
}

interface SkillsState {
  tab: SkillsTab
  kind: SkillKind
  q: string
  /** `idle` until the screen is first opened; `error` keeps what was shown before. */
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
  list: SkillsList | null
  receivedAt: number | null
  selected: string | null
  /** SKILL.md texts by skill key. */
  docs: Record<string, TextEntry>
  ask: { key: string; action: Exclude<SkillAction, 'install'> } | null
  pending: string | null
  notes: Record<string, SkillNote>
  install: { open: boolean; id: string; category: string; profile: string; inspect: TextEntry | null; busy: boolean; note: SkillNote | null; confirm: boolean }
  ledgers: Record<string, LedgerEntry>
  curator: Record<string, TextEntry>
  blobs: Record<string, TextEntry>
  openDiff: string | null
  setTab(tab: SkillsTab): void
  setKind(kind: SkillKind): void
  setQ(q: string): void
  setStatus(status: 'loading'): void
  setError(message: string): void
  applyList(list: SkillsList, now?: number): void
  select(key: string | null): void
  setDoc(key: string, entry: TextEntry): void
  openAsk(key: string, action: Exclude<SkillAction, 'install'>): void
  closeAsk(): void
  setPending(key: string | null): void
  setNote(key: string, note: SkillNote | null): void
  patchInstall(patch: Partial<SkillsState['install']>): void
  setLedger(profile: string, entry: LedgerEntry): void
  setCurator(profile: string, entry: TextEntry): void
  setBlob(sha: string, entry: TextEntry): void
  toggleDiff(id: string): void
  reset(): void
}

const INSTALL = { open: false, id: '', category: '', profile: '', inspect: null, busy: false, note: null, confirm: false }
const EMPTY = {
  tab: 'library' as const,
  kind: 'all' as const,
  q: '',
  status: 'idle' as const,
  error: null,
  list: null,
  receivedAt: null,
  selected: null,
  docs: {},
  ask: null,
  pending: null,
  notes: {},
  install: INSTALL,
  ledgers: {},
  curator: {},
  blobs: {},
  openDiff: null
}

export const useSkills = create<SkillsState>()((set) => ({
  ...EMPTY,
  setTab: (tab) => set({ tab }),
  setKind: (kind) => set({ kind }),
  setQ: (q) => set({ q }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ status: 'error', error }),
  applyList: (list, now = Date.now()) =>
    set((s) => {
      const keys = new Set(list.skills.map((k) => `${k.profile}:${k.path}`))
      // a skill that moved (archive, restore) keeps its selection by profile and name
      let selected = s.selected
      if (selected && !keys.has(selected)) {
        const old = s.list?.skills.find((k) => `${k.profile}:${k.path}` === selected)
        const moved = old ? list.skills.find((k) => k.profile === old.profile && k.name === old.name) : undefined
        selected = moved ? `${moved.profile}:${moved.path}` : null
      }
      return { list, status: 'ok', error: null, receivedAt: now, selected }
    }),
  select: (selected) => set({ selected, ask: null }),
  setDoc: (key, entry) => set((s) => ({ docs: { ...s.docs, [key]: entry } })),
  openAsk: (key, action) => set({ ask: { key, action } }),
  closeAsk: () => set({ ask: null }),
  setPending: (pending) => set({ pending }),
  setNote: (key, note) =>
    set((s) => {
      const notes = { ...s.notes }
      if (note) notes[key] = note
      else delete notes[key]
      return { notes }
    }),
  patchInstall: (patch) => set((s) => ({ install: { ...s.install, ...patch } })),
  setLedger: (profile, entry) => set((s) => ({ ledgers: { ...s.ledgers, [profile]: entry } })),
  setCurator: (profile, entry) => set((s) => ({ curator: { ...s.curator, [profile]: entry } })),
  setBlob: (sha, entry) => set((s) => ({ blobs: { ...s.blobs, [sha]: entry } })),
  toggleDiff: (id) => set((s) => ({ openDiff: s.openDiff === id ? null : id })),
  reset: () => set({ ...EMPTY })
}))
