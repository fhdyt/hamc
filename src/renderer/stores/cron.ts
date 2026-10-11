import { create } from 'zustand'
import type { CronData, CronJob } from '@shared/events'
import { DEFAULT_FILTER, jobKey, type CronFilter } from '../lib/cron'

interface CronState {
  jobs: CronJob[]
  profiles: CronData['profiles']
  receivedAt: number | null
  selected: string | null
  filter: CronFilter
  modalOpen: boolean
  applyCron(data: CronData, now?: number): void
  select(key: string | null): void
  setFilter(patch: Partial<CronFilter>): void
  openModal(key?: string): void
  closeModal(): void
  reset(): void
}

const EMPTY = { jobs: [], profiles: [], receivedAt: null, selected: null, filter: DEFAULT_FILTER, modalOpen: false }

export const useCron = create<CronState>()((set) => ({
  ...EMPTY,
  applyCron: (data, now = Date.now()) =>
    set((s) => ({
      jobs: data.jobs,
      profiles: data.profiles,
      receivedAt: now,
      selected: s.selected && data.jobs.some((j) => jobKey(j) === s.selected) ? s.selected : null
    })),
  select: (selected) => set({ selected }),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  openModal: (key) => set((s) => ({ modalOpen: true, selected: key ?? s.selected })),
  closeModal: () => set({ modalOpen: false }),
  reset: () => set({ ...EMPTY })
}))
