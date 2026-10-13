import { cronActionArgs, type CronActionRequest, type CronActionResult } from '@shared/cron'
import type { Execer } from '../connection/manager'
import type { CronStore } from './store'

export interface CronActionDeps {
  conn: Execer
  hermes: () => { path: string } | null
  isConnected: () => boolean
  store: CronStore
  log?: (m: string) => void
}

/** `hermes cron run` runs the job inside the CLI process, so it may take as long as the job itself. */
export const RUN_TIMEOUT_MS = 45 * 60_000
export const ACTION_TIMEOUT_MS = 60_000
const OUTPUT_MAX = 2000

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g
export const stripAnsi = (s: string): string => s.replace(ANSI, '')

/**
 * The five cron writes, only through the official CLI and only after the user confirmed the exact command. The
 * command comes from `cronActionArgs` (the same builder the confirm shows), the job must be one the collector
 * reported, and one manual run per job at a time.
 */
export class CronActionService {
  private readonly running = new Set<string>()

  constructor(private readonly d: CronActionDeps) {}

  isRunning(profile: string, jobId: string): boolean {
    return this.running.has(`${profile}/${jobId}`)
  }

  async run(req: CronActionRequest): Promise<CronActionResult> {
    const args = cronActionArgs(req)
    if (!args) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    if (!this.d.store.get(req.profile, req.jobId)) return { ok: false, error: 'unknown-job' }
    const key = `${req.profile}/${req.jobId}`
    if (req.action === 'run') {
      if (this.running.has(key)) return { ok: false, error: 'busy' }
      this.running.add(key)
    }
    try {
      const r = await this.d.conn.exec([h.path, ...args], { timeoutMs: req.action === 'run' ? RUN_TIMEOUT_MS : ACTION_TIMEOUT_MS })
      this.d.log?.(`cron ${req.action} ${req.profile} ${req.jobId} exit ${r.code}`)
      const out = stripAnsi(r.stdout).trim()
      if (r.code === 0) return { ok: true, output: out.slice(0, OUTPUT_MAX) }
      return { ok: false, error: 'failed', detail: (stripAnsi(r.stderr).trim() || out || `exit code ${r.code}`).slice(0, OUTPUT_MAX) }
    } catch (e) {
      this.d.log?.(`cron ${req.action} ${req.profile} ${req.jobId} failed`)
      return { ok: false, error: 'failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, OUTPUT_MAX) }
    } finally {
      if (req.action === 'run') this.running.delete(key)
    }
  }

  clear(): void {
    this.running.clear()
  }
}
