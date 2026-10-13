import { PROFILE_RE } from '@shared/agentCfg'
import { sessionCommandArgs, validTitle, type SessionAction, type SessionActionResult } from '@shared/sessions'
import type { Execer } from '../connection/manager'

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

export interface SessionActionDeps {
  conn: Execer
  hermes: () => { path: string } | null
  isConnected: () => boolean
  log?: (m: string) => void
}

/**
 * Pin, unpin and rename: the only writes of the Sessions screen, always through the official CLI and only after the
 * user confirmed the exact command. The renderer sends data; the command is built here. The title is not logged.
 */
export class SessionActionService {
  constructor(private readonly d: SessionActionDeps) {}

  async run(action: SessionAction, profile: string, sessionId: string, title?: string): Promise<SessionActionResult> {
    if (!PROFILE_RE.test(profile) || !ID_RE.test(sessionId)) return { ok: false, error: 'bad-input' }
    let clean: string | undefined
    if (action === 'rename') {
      const t = validTitle(title ?? '')
      if (t === null) return { ok: false, error: 'bad-input' }
      clean = t
    }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    try {
      const r = await this.d.conn.exec([h.path, ...sessionCommandArgs(action, profile, sessionId, clean)], { timeoutMs: 20_000 })
      this.d.log?.(`session ${action} ${profile}/${sessionId} exit ${r.code}`)
      if (r.code === 0) return { ok: true }
      return { ok: false, error: 'failed', detail: (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, 600) }
    } catch (e) {
      return { ok: false, error: 'failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, 600) }
    }
  }
}
