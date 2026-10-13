import { PROFILE_RE } from '@shared/agentCfg'
import type { GatewayAction, GatewayActionResult } from '@shared/logs'
import type { Execer } from '../connection/manager'

export interface GatewayServiceDeps {
  conn: Execer
  hermes: () => { path: string } | null
  isConnected: () => boolean
  log?: (m: string) => void
}

const ACTIONS: readonly GatewayAction[] = ['restart', 'stop']

/**
 * Restart and stop of one agent's gateway, only through the official CLI and only after the user confirmed the exact
 * command. There is no start: the user starts a gateway from a terminal or systemd (F-LOG-6).
 */
export class GatewayService {
  constructor(private readonly d: GatewayServiceDeps) {}

  async run(action: GatewayAction, profile: string): Promise<GatewayActionResult> {
    if (!PROFILE_RE.test(profile) || !ACTIONS.includes(action)) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    try {
      const argv = [h.path, ...(profile === 'default' ? [] : ['-p', profile]), 'gateway', action]
      const r = await this.d.conn.exec(argv, { timeoutMs: 60_000 })
      this.d.log?.(`gateway ${action} ${profile} exit ${r.code}`)
      if (r.code === 0) return { ok: true, output: r.stdout.trim().slice(0, 400) }
      return { ok: false, error: 'failed', detail: (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, 600) }
    } catch (e) {
      return { ok: false, error: 'failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, 600) }
    }
  }
}
