import type { CronJob, CronState } from '@shared/events'
import { isFailure } from '@shared/cron'

export { isFailure }

export type StatusFilter = 'all' | 'ok' | 'error' | 'never' | 'running' | 'paused'

export interface CronFilter {
  agent: string
  status: StatusFilter
  query: string
}

export const DEFAULT_FILTER: CronFilter = { agent: 'all', status: 'all', query: '' }

export const jobKey = (j: Pick<CronJob, 'profile' | 'id'>): string => `${j.profile}/${j.id}`

export function statusLabel(status: string | null): string {
  if (status === null) return 'NEVER RUN'
  if (status === 'ok') return 'OK'
  return status.toUpperCase().replace(/_/g, ' ')
}

export function stateLabel(state: CronState): string {
  return state.toUpperCase()
}

export function counts(jobs: readonly CronJob[]): { total: number; running: number; error: number; paused: number } {
  return {
    total: jobs.length,
    running: jobs.filter((j) => j.state === 'running').length,
    error: jobs.filter((j) => isFailure(j.lastStatus)).length,
    paused: jobs.filter((j) => j.state === 'paused').length
  }
}

export function filterJobs(jobs: readonly CronJob[], f: CronFilter): CronJob[] {
  const q = f.query.trim().toLowerCase()
  return jobs.filter((j) => {
    if (f.agent !== 'all' && j.profile !== f.agent) return false
    if (q && !(j.name.toLowerCase().includes(q) || j.id.toLowerCase().includes(q) || j.profile.toLowerCase().includes(q))) return false
    switch (f.status) {
      case 'all':
        return true
      case 'ok':
        return j.lastStatus === 'ok'
      case 'error':
        return isFailure(j.lastStatus)
      case 'never':
        return j.lastStatus === null && j.lastRunTs === null
      case 'running':
        return j.state === 'running'
      case 'paused':
        return j.state === 'paused'
    }
  })
}

export function sortJobs(jobs: readonly CronJob[]): CronJob[] {
  return [...jobs].sort((a, b) => {
    const ra = a.state === 'running' ? 0 : 1
    const rb = b.state === 'running' ? 0 : 1
    if (ra !== rb) return ra - rb
    const na = a.nextRunTs ?? Number.POSITIVE_INFINITY
    const nb = b.nextRunTs ?? Number.POSITIVE_INFINITY
    if (na !== nb) return na < nb ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function formatCountdown(ts: number | null, nowMs: number): string {
  if (ts === null) return '—'
  const s = Math.ceil(ts - nowMs / 1000)
  if (s <= 0) return 'due'
  if (s < 60) return `in ${s}s`
  if (s < 3600) return `in ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `in ${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

export function formatLocal(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts * 1000).toLocaleString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export function formatOffset(min: number | null): string {
  if (min === null) return 'unknown'
  const sign = min < 0 ? '-' : '+'
  const abs = Math.abs(min)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

export function statusColor(j: Pick<CronJob, 'lastStatus' | 'state'>): string {
  if (j.state === 'running') return '#8BE9FD'
  if (isFailure(j.lastStatus)) return '#FF5555'
  if (j.lastStatus === 'ok') return '#50FA7B'
  return '#8B95BD'
}

export function stateColor(state: CronState): string {
  return state === 'paused' ? '#8B95BD' : state === 'running' ? '#8BE9FD' : '#A9B2D3'
}

/** Agent label for a profile: the display name when the agent list has one. */
export function agentLabel(profile: string, names: Record<string, string>): string {
  return names[profile] ?? profile
}
