import { PROFILE_RE } from '@shared/agentCfg'
import type { ApprovalsResult } from '@shared/logs'
import type { Execer, ExecResult } from '../connection/manager'

export interface ApprovalsServiceDeps {
  conn: Execer
  hermes: () => { path: string } | null
  isConnected: () => boolean
}

const POLICY_MAX = 8000
const SUGGEST_MAX = 20000

async function run(conn: Execer, argv: string[]): Promise<ExecResult> {
  try {
    return await conn.exec(argv, { timeoutMs: 20_000 })
  } catch (e) {
    return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
  }
}

const failure = (r: ExecResult): string => (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, 400)

/**
 * The two read-only commands behind the Approvals tab. The raw text goes back unchanged (cut at a limit); the renderer
 * parses it tolerantly because the real output shapes are not documented. Nothing is ever changed here.
 */
export class ApprovalsService {
  constructor(private readonly d: ApprovalsServiceDeps) {}

  async read(profile: string): Promise<ApprovalsResult> {
    if (!PROFILE_RE.test(profile)) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const pa = profile === 'default' ? [] : ['-p', profile]
    const [policy, suggest] = await Promise.all([run(this.d.conn, [h.path, ...pa, 'config', 'get', 'approvals', '--json']), run(this.d.conn, [h.path, ...pa, 'approvals', 'suggest', '--days', '30'])])
    return {
      ok: true,
      policy: policy.code === 0 ? policy.stdout.trim().slice(0, POLICY_MAX) : '',
      policyError: policy.code === 0 ? null : failure(policy),
      suggest: suggest.code === 0 ? suggest.stdout.trim().slice(0, SUGGEST_MAX) : '',
      suggestError: suggest.code === 0 ? null : failure(suggest)
    }
  }
}
