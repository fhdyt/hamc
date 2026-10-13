import { curatorStatusArgs, skillActionArgs, skillInspectArgs, type SkillActionRequest, type SkillActionResult, type SkillTextResult } from '@shared/skills'
import type { Execer, ExecResult } from '../connection/manager'
import { stripAnsi } from '../cron/actions'

export interface SkillActionDeps {
  conn: Execer
  hermes: () => { path: string } | null
  isConnected: () => boolean
  log?: (m: string) => void
}

const OUTPUT_MAX = 4000
const TEXT_MAX = 40_000
/** An install fetches from a registry and runs Hermes's scan, so it gets more time than a curator command. */
export const INSTALL_TIMEOUT_MS = 5 * 60_000
export const ACTION_TIMEOUT_MS = 60_000

const failure = (r: ExecResult): string => (stripAnsi(r.stderr).trim() || stripAnsi(r.stdout).trim() || `exit code ${r.code}`).slice(0, OUTPUT_MAX)

/**
 * The skill writes (curator pin, unpin, archive, restore; skills install) and two read-only commands (skills inspect,
 * curator status), only through the official CLI. Every command comes from the shared builders; logs never carry
 * the skill text.
 */
export class SkillActionService {
  constructor(private readonly d: SkillActionDeps) {}

  private async exec(argv: string[], timeoutMs: number): Promise<ExecResult> {
    try {
      return await this.d.conn.exec(argv, { timeoutMs })
    } catch (e) {
      return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
    }
  }

  async run(req: SkillActionRequest): Promise<SkillActionResult> {
    const args = skillActionArgs(req)
    if (!args) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const r = await this.exec([h.path, ...args], req.action === 'install' ? INSTALL_TIMEOUT_MS : ACTION_TIMEOUT_MS)
    this.d.log?.(`skills ${req.action} ${req.profile} exit ${r.code}`)
    if (r.code === 0) return { ok: true, output: stripAnsi(r.stdout).trim().slice(0, OUTPUT_MAX) }
    return { ok: false, error: 'failed', detail: failure(r) }
  }

  private async text(args: string[] | null, timeoutMs: number): Promise<SkillTextResult> {
    if (!args) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const r = await this.exec([h.path, ...args], timeoutMs)
    if (r.code === 0) return { ok: true, text: stripAnsi(r.stdout).slice(0, TEXT_MAX) }
    return { ok: false, error: 'failed', detail: failure(r) }
  }

  inspect(profile: string, id: string): Promise<SkillTextResult> {
    return this.text(skillInspectArgs(profile, id), 90_000)
  }

  curatorStatus(profile: string): Promise<SkillTextResult> {
    return this.text(curatorStatusArgs(profile), 30_000)
  }
}
