import type { ZodType } from 'zod'
import type { QueryError, QueryResult } from '@shared/ipc'
import type { Execer } from './connection/manager'
import { queryCmd } from './connection/remote'

export const QUERY_TIMEOUT_MS = 15_000
export const QUERY_MAX_OUTPUT = 1024 * 1024

const KNOWN_ERRORS: ReadonlySet<string> = new Set<QueryError>(['bad_args', 'not_found', 'unsupported_schema', 'db_unreadable', 'unreadable', 'unknown_command'])

export type QueryCommand = 'message' | 'history' | 'session' | 'vault_check' | 'browse' | 'note'

/**
 * Runs the read-only query mode of the collector script: the script goes over stdin, the command and its JSON
 * arguments are separate quoted arguments, one answer line comes back. Nothing is written on the server.
 */
export class QueryRunner {
  constructor(
    private readonly conn: Execer,
    private readonly script: string,
    private readonly target: () => { python: string; home: string } | null
  ) {}

  async run<T>(command: QueryCommand, args: object, schema: ZodType<T>): Promise<QueryResult<T>> {
    const t = this.target()
    if (!t) return { ok: false, error: 'not-connected' }
    let stdout: string
    try {
      const r = await this.conn.exec(queryCmd(t.python, t.home, command, JSON.stringify(args)), { stdin: this.script, timeoutMs: QUERY_TIMEOUT_MS })
      if (r.code !== 0) return { ok: false, error: 'invalid-response' }
      stdout = r.stdout
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: /timed out/i.test(msg) ? 'timeout' : /not connected/i.test(msg) ? 'not-connected' : 'invalid-response' }
    }
    if (stdout.length > QUERY_MAX_OUTPUT) return { ok: false, error: 'invalid-response' }
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '')
    } catch {
      return { ok: false, error: 'invalid-response' }
    }
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid-response' }
    const env = parsed as { ok?: unknown; data?: unknown; error?: unknown }
    if (env.ok === true) {
      const data = schema.safeParse(env.data)
      return data.success ? { ok: true, data: data.data } : { ok: false, error: 'invalid-response' }
    }
    if (env.ok === false && typeof env.error === 'string' && KNOWN_ERRORS.has(env.error)) return { ok: false, error: env.error as QueryError }
    return { ok: false, error: 'invalid-response' }
  }
}
