import type { ZodType } from 'zod'
import type { QueryError, QueryResult } from '@shared/ipc'
import type { Execer } from './connection/manager'
import { queryCmd } from './connection/remote'

export const QUERY_TIMEOUT_MS = 15_000
export const QUERY_MAX_OUTPUT = 1024 * 1024

const KNOWN_ERRORS: ReadonlySet<string> = new Set<QueryError>(['bad_args', 'not_found', 'unsupported_schema', 'db_unreadable', 'unreadable', 'unknown_command'])

export type QueryCommand = 'message' | 'history' | 'session' | 'vault_check' | 'browse' | 'note' | 'chat_sessions' | 'uploads_list' | 'interaction' | 'sessions_list' | 'sessions_search' | 'session_transcript' | 'usage_summary' | 'usage_tools' | 'logs_list' | 'logs_read' | 'kanban_boards' | 'kanban_tasks' | 'kanban_task'

const short = (s: string, n = 160): string => s.replace(/\s+/g, ' ').trim().slice(-n)

/**
 * Runs the read-only query mode of the collector script: the script goes over stdin, the command and its JSON
 * arguments are separate quoted arguments, one answer line comes back. Nothing is written on the server.
 * A failure that is not one of the script's own error codes carries a short `detail` (exit code and the end of
 * stderr) and is written to the app log, so a problem on a real server can be diagnosed.
 */
export class QueryRunner {
  constructor(
    private readonly conn: Execer,
    private readonly script: string,
    private readonly target: () => { python: string; home: string } | null,
    private readonly log: (msg: string) => void = () => {}
  ) {}

  private fail(command: string, error: QueryError, detail?: string): QueryResult<never> {
    if (error === 'invalid-response') this.log(`query ${command} failed: ${error}${detail ? ` (${detail})` : ''}`)
    return detail ? { ok: false, error, detail } : { ok: false, error }
  }

  async run<T>(command: QueryCommand, args: object, schema: ZodType<T>): Promise<QueryResult<T>> {
    const t = this.target()
    if (!t) return { ok: false, error: 'not-connected' }
    let stdout: string
    try {
      const r = await this.conn.exec(queryCmd(t.python, t.home, command, JSON.stringify(args)), { stdin: this.script, timeoutMs: QUERY_TIMEOUT_MS })
      if (r.code !== 0) return this.fail(command, 'invalid-response', `exit ${r.code} running ${t.python}${r.stderr ? `: ${short(r.stderr)}` : ''}`)
      stdout = r.stdout
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/timed out/i.test(msg)) return { ok: false, error: 'timeout' }
      if (/not connected/i.test(msg)) return { ok: false, error: 'not-connected' }
      return this.fail(command, 'invalid-response', short(msg))
    }
    if (stdout.length > QUERY_MAX_OUTPUT) return this.fail(command, 'invalid-response', 'answer larger than 1 MiB')
    let parsed: unknown
    const last = stdout.trim().split('\n').pop() ?? ''
    try {
      parsed = JSON.parse(last)
    } catch {
      return this.fail(command, 'invalid-response', last ? `not JSON: ${short(last, 100)}` : 'empty answer')
    }
    if (!parsed || typeof parsed !== 'object') return this.fail(command, 'invalid-response', 'answer is not an object')
    const env = parsed as { ok?: unknown; data?: unknown; error?: unknown }
    if (env.ok === true) {
      const data = schema.safeParse(env.data)
      return data.success ? { ok: true, data: data.data } : this.fail(command, 'invalid-response', `unexpected shape: ${short(data.error.message, 120)}`)
    }
    if (env.ok === false && typeof env.error === 'string' && KNOWN_ERRORS.has(env.error)) return { ok: false, error: env.error as QueryError }
    return this.fail(command, 'invalid-response', 'unknown error code')
  }
}
