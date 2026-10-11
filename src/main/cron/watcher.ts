import type { CronJob } from '@shared/events'
import { jobKey } from './store'

export interface CronAlert {
  profile: string
  jobId: string
  name: string
  lastStatus: string | null
  lastError: string | null
  lastRunTs: number
}

export function isFailure(status: string | null): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'error' || s === 'delivery_failed' || s === 'blocked_config' || s.startsWith('error')
}

/**
 * Decides which cron runs deserve a notification. The first batch after a reset is only a baseline, so jobs that
 * were already failing before the app looked at them never ring.
 */
export class CronWatcher {
  private seen = new Map<string, number | null>()
  private baselined = false

  ingest(jobs: readonly CronJob[]): CronAlert[] {
    if (!this.baselined) {
      for (const j of jobs) this.seen.set(jobKey(j.profile, j.id), j.lastRunTs)
      this.baselined = true
      return []
    }
    const alerts: CronAlert[] = []
    for (const j of jobs) {
      const key = jobKey(j.profile, j.id)
      const prev = this.seen.get(key)
      if (prev === undefined) {
        this.seen.set(key, j.lastRunTs)
        continue
      }
      if (j.lastRunTs !== null && (prev === null || j.lastRunTs > prev)) {
        this.seen.set(key, j.lastRunTs)
        if (isFailure(j.lastStatus)) {
          alerts.push({
            profile: j.profile,
            jobId: j.id,
            name: j.name,
            lastStatus: j.lastStatus,
            lastError: j.lastError,
            lastRunTs: j.lastRunTs
          })
        }
      }
    }
    return alerts
  }

  reset(): void {
    this.seen.clear()
    this.baselined = false
  }
}
