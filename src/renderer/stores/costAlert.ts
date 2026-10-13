import { create } from 'zustand'
import type { CostAlertState } from '@shared/events'

interface CostAlertStore {
  /** The last state the main process sent; null before the first check. */
  state: CostAlertState | null
  apply(s: CostAlertState): void
  reset(): void
}

export const useCostAlert = create<CostAlertStore>()((set) => ({
  state: null,
  apply: (state) => set({ state }),
  reset: () => set({ state: null })
}))
