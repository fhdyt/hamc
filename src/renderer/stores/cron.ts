import { create } from 'zustand'
import type { CronAction } from '@shared/cron'
import type { CronData, CronJob, CronRuns } from '@shared/events'
import { DEFAULT_FILTER, jobKey, type CronFilter } from '../lib/cron'

export type RunsEntry = { key: string; status: 'loading' } | { key: string; status: 'error'; message: string; data: CronRuns | null } | { key: string; status: 'ok'; data: CronRuns }
export type OutputEntry = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; text: string; truncated: boolean }
export interface ActionNote {
  action: CronAction
  ok: boolean
  title: string
  detail: string | null
}

interface CronState {
  jobs: CronJob[]
  profiles: CronData['profiles']
  receivedAt: number | null
  selected: string | null
  filter: CronFilter
  modalOpen: boolean
  /** Run history of the selected job (M9b). */
  runs: RunsEntry | null
  /** Index of the picked run in `runs`. */
  picked: number
  /** Output texts of the selected job by file name. */
  outputs: Record<string, OutputEntry>
  /** The confirm panel that is open, and the schedule being typed. */
  ask: { key: string; action: CronAction } | null
  draft: string
  /** Actions in flight per job key. */
  pending: Record<string, CronAction>
  /** The last action result per job key, shown in the job detail. */
  notes: Record<string, ActionNote>
  applyCron(data: CronData, now?: number): void
  select(key: string | null): void
  setFilter(patch: Partial<CronFilter>): void
  openModal(key?: string): void
  closeModal(): void
  setRuns(entry: RunsEntry): void
  pick(i: number): void
  setOutput(name: string, entry: OutputEntry): void
  openAsk(key: string, action: CronAction, draft?: string): void
  setDraft(draft: string): void
  closeAsk(): void
  setPending(key: string, action: CronAction | null): void
  setNote(key: string, note: ActionNote | null): void
  reset(): void
}

const EMPTY = {
  jobs: [],
  profiles: [],
  receivedAt: null,
  selected: null,
  filter: DEFAULT_FILTER,
  modalOpen: false,
  runs: null,
  picked: 0,
  outputs: {},
  ask: null,
  draft: '',
  pending: {},
  notes: {}
}

/** What changes when another job is picked: its history, outputs and confirm panel belong to the old one. */
const forJob = (s: CronState, selected: string | null): Partial<CronState> =>
  selected === s.selected ? { selected } : { selected, runs: null, picked: 0, outputs: {}, ask: null, draft: '' }

export const useCron = create<CronState>()((set) => ({
  ...EMPTY,
  applyCron: (data, now = Date.now()) =>
    set((s) => {
      const keep = s.selected && data.jobs.some((j) => jobKey(j) === s.selected) ? s.selected : null
      return { jobs: data.jobs, profiles: data.profiles, receivedAt: now, ...forJob(s, keep) }
    }),
  select: (selected) => set((s) => forJob(s, selected)),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  openModal: (key) => set((s) => ({ modalOpen: true, ...forJob(s, key ?? s.selected) })),
  closeModal: () => set({ modalOpen: false, ask: null }),
  setRuns: (runs) =>
    set((s) => {
      if (runs.key !== s.selected) return {}
      const prev = s.runs?.status === 'ok' && s.picked > 0 ? s.runs.data.runs[s.picked]?.id : undefined
      const list = runs.status === 'ok' ? runs.data.runs : []
      // the newest run stays picked as new runs arrive; an older picked run is kept while it is still listed
      const picked = prev === undefined ? 0 : Math.max(0, list.findIndex((r) => r.id === prev))
      return { runs, picked: runs.status === 'ok' ? picked : s.picked }
    }),
  pick: (picked) => set({ picked }),
  setOutput: (name, entry) => set((s) => ({ outputs: { ...s.outputs, [name]: entry } })),
  openAsk: (key, action, draft) => set((s) => ({ ask: { key, action }, draft: draft ?? s.draft })),
  setDraft: (draft) => set({ draft }),
  closeAsk: () => set({ ask: null }),
  setPending: (key, action) =>
    set((s) => {
      const pending = { ...s.pending }
      if (action) pending[key] = action
      else delete pending[key]
      return { pending }
    }),
  setNote: (key, note) =>
    set((s) => {
      const notes = { ...s.notes }
      if (note) notes[key] = note
      else delete notes[key]
      return { notes }
    }),
  reset: () => set({ ...EMPTY })
}))
