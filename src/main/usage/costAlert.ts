import type { CostAlertState, UsageSummary } from '@shared/events'
import type { QueryResult } from '@shared/ipc'
import { dayStartsFor, localDayKey, type UsageSummaryArgs } from '@shared/usage'

export function evaluateCost(total: number, enabled: boolean, usd: number, notifiedDay: string | null, day: string): { over: boolean; notify: boolean } {
  const over = enabled && total > usd
  return { over, notify: over && notifiedDay !== day }
}

export interface CostAlertDeps {
  query(args: UsageSummaryArgs): Promise<QueryResult<UsageSummary>>
  settings(): { enabled: boolean; usd: number }
  isConnected(): boolean
  send(s: CostAlertState): void
  notify(s: CostAlertState): void
  /** Epoch milliseconds. */
  now?: () => number
  intervalMs?: number
}

const FIVE_MINUTES = 5 * 60_000

/**
 * Checks today's cost of all agents against the daily threshold while connected. The day is the local day of this
 * computer. A failed check keeps the last state and never notifies; a notification is sent once per local day.
 */
export class CostAlertService {
  private timer: ReturnType<typeof setInterval> | null = null
  private notifiedDay: string | null = null
  private running = false
  private again = false

  constructor(private readonly d: CostAlertDeps) {}

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.recheck(), this.d.intervalMs ?? FIVE_MINUTES)
    void this.recheck()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Forgets the day that was notified (a disconnect by the user). */
  reset(): void {
    this.notifiedDay = null
  }

  /** A check asked for while another is running (the setting just changed) is not lost: it runs right after. */
  async recheck(): Promise<void> {
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      await this.check()
    } finally {
      this.running = false
    }
    if (this.again) {
      this.again = false
      await this.recheck()
    }
  }

  private async check(): Promise<void> {
    const nowMs = (this.d.now ?? Date.now)()
    const day = localDayKey(nowMs / 1000)
    const { enabled, usd } = this.d.settings()
    if (!enabled) {
      this.d.send({ enabled: false, day, total: null, threshold: usd, over: false, checkedAt: nowMs })
      return
    }
    if (!this.d.isConnected()) return
    const { dayStarts, endTs } = dayStartsFor(1, nowMs / 1000)
    const res = await this.d.query({ profiles: [], dayStarts, endTs })
    if (!res.ok) return
    const total = res.data.rows.reduce((sum, r) => sum + r.cost, 0)
    const { over, notify } = evaluateCost(total, enabled, usd, this.notifiedDay, day)
    const state: CostAlertState = { enabled, day, total, threshold: usd, over, checkedAt: nowMs }
    this.d.send(state)
    if (notify) {
      this.notifiedDay = day
      this.d.notify(state)
    }
  }
}
