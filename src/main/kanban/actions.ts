import { kanbanActionArgs, type KanbanActionRequest, type KanbanActionResult } from '@shared/kanban'
import type { Execer } from '../connection/manager'
import { stripAnsi } from '../cron/actions'

export interface KanbanActionDeps {
  conn: Execer
  hermes: () => { path: string } | null
  isConnected: () => boolean
  /** Profiles of the last agents event; null before the first one. */
  profiles: () => string[] | null
  log?: (m: string) => void
}

export const KANBAN_TIMEOUT_MS = 60_000
const OUTPUT_MAX = 2000

/**
 * The eight Kanban writes, only through `hermes kanban` and only after the user confirmed the exact command
 * (`kanbanActionArgs`, the builder the confirm shows). An assignee must be a profile the app has seen. The log line
 * names the action, board and task, never the text.
 */
export class KanbanActionService {
  constructor(private readonly d: KanbanActionDeps) {}

  async run(req: KanbanActionRequest): Promise<KanbanActionResult> {
    const args = kanbanActionArgs(req)
    if (!args) return { ok: false, error: 'bad-input' }
    const h = this.d.hermes()
    if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
    const who = req.action === 'create' || req.action === 'assign' ? req.assignee : undefined
    if (who !== undefined && who !== 'none' && !(this.d.profiles() ?? []).includes(who)) return { ok: false, error: 'unknown-profile' }
    const target = req.action === 'create' ? 'new' : req.id
    try {
      const r = await this.d.conn.exec([h.path, ...args], { timeoutMs: KANBAN_TIMEOUT_MS })
      this.d.log?.(`kanban ${req.action} ${req.board} ${target} exit ${r.code}`)
      const out = stripAnsi(r.stdout).trim()
      if (r.code !== 0) return { ok: false, error: 'failed', detail: (stripAnsi(r.stderr).trim() || out || `exit code ${r.code}`).slice(0, OUTPUT_MAX) }
      if (req.action !== 'create') return { ok: true, output: out.slice(0, OUTPUT_MAX) }
      const id = createdId(out)
      return id ? { ok: true, output: `Created ${id}`, taskId: id } : { ok: true, output: out.slice(0, OUTPUT_MAX) }
    } catch (e) {
      this.d.log?.(`kanban ${req.action} ${req.board} ${target} failed`)
      return { ok: false, error: 'failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, OUTPUT_MAX) }
    }
  }
}

/** The id from `create --json` (a task object); a plain "Created t_x" line as a fallback. */
export function createdId(out: string): string | null {
  try {
    const v = JSON.parse(out.slice(out.indexOf('{'))) as { id?: unknown }
    if (typeof v.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v.id)) return v.id
  } catch {
    // not JSON
  }
  const m = /Created (\S+)/.exec(out)
  return m ? m[1]! : null
}
