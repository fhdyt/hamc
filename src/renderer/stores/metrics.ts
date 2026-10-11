import { create } from 'zustand'
import type { MetricsData } from '@shared/events'
import { pushWindow } from '../lib/window'

interface MetricsState {
  latest: MetricsData | null
  receivedAt: number | null
  cpu: number[]
  rx: number[]
  tx: number[]
  apply(data: MetricsData, now?: number): void
  reset(): void
}

export const useMetrics = create<MetricsState>()((set) => ({
  latest: null,
  receivedAt: null,
  cpu: [],
  rx: [],
  tx: [],
  apply: (data, now = Date.now()) =>
    set((s) => ({
      latest: data,
      receivedAt: now,
      cpu: pushWindow(s.cpu, data.cpu.total),
      rx: pushWindow(s.rx, data.net[0]?.rxBps ?? 0),
      tx: pushWindow(s.tx, data.net[0]?.txBps ?? 0)
    })),
  reset: () => set({ latest: null, receivedAt: null, cpu: [], rx: [], tx: [] })
}))
