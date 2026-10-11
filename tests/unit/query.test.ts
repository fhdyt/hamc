import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FeedCursors } from '../../src/main/feed/cursors'
import type { ExecOptions, ExecResult, Execer } from '../../src/main/connection/manager'
import { QueryRunner, QUERY_MAX_OUTPUT, QUERY_TIMEOUT_MS } from '../../src/main/query'

const schema = z.object({ text: z.string() })
const target = () => ({ python: '/usr/bin/python3', home: '/home/u/.hermes' })

function runner(reply: (argv: readonly string[], opts: ExecOptions) => Promise<ExecResult>, t = target as () => { python: string; home: string } | null) {
  const calls: { argv: readonly string[]; opts: ExecOptions }[] = []
  const exec: Execer = {
    exec: (argv, opts = {}) => {
      calls.push({ argv, opts })
      return reply(argv, opts)
    }
  }
  return { q: new QueryRunner(exec, 'SCRIPT', t), calls }
}
const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' })

describe('QueryRunner', () => {
  it('sends the script over stdin and each argument separately', async () => {
    const { q, calls } = runner(async () => ok('{"ok":true,"data":{"text":"hi"}}\n'))
    const r = await q.run('message', { profile: 'default', messageId: 3 }, schema)
    expect(r).toEqual({ ok: true, data: { text: 'hi' } })
    expect(calls[0]!.argv).toEqual(['/usr/bin/python3', '-u', '-', '/home/u/.hermes', '--query', 'message', '{"profile":"default","messageId":3}'])
    expect(calls[0]!.opts).toEqual({ stdin: 'SCRIPT', timeoutMs: QUERY_TIMEOUT_MS })
  })

  it('maps the errors the script can report', async () => {
    for (const code of ['bad_args', 'not_found', 'unsupported_schema', 'db_unreadable', 'unknown_command'] as const) {
      const { q } = runner(async () => ok(JSON.stringify({ ok: false, error: code })))
      expect(await q.run('session', {}, schema)).toEqual({ ok: false, error: code })
    }
  })

  it('treats an unknown error code as an invalid response', async () => {
    const { q } = runner(async () => ok('{"ok":false,"error":"rm -rf"}'))
    expect(await q.run('session', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
  })

  it('rejects data that does not match the schema', async () => {
    const { q } = runner(async () => ok('{"ok":true,"data":{"text":42}}'))
    expect(await q.run('message', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
  })

  it('rejects output that is not JSON, empty output and non-zero exits', async () => {
    expect((await runner(async () => ok('Traceback...')).q.run('message', {}, schema)).ok).toBe(false)
    expect(await runner(async () => ok('')).q.run('message', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
    expect(await runner(async () => ({ code: 1, stdout: '', stderr: 'boom' })).q.run('message', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
    expect(await runner(async () => ok('"just a string"')).q.run('message', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
  })

  it('refuses oversized output', async () => {
    const { q } = runner(async () => ok('x'.repeat(QUERY_MAX_OUTPUT + 1)))
    expect(await q.run('message', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
  })

  it('reports a timeout and a lost connection distinctly', async () => {
    expect(await runner(async () => Promise.reject(new Error('timed out after 15000 ms'))).q.run('message', {}, schema)).toEqual({ ok: false, error: 'timeout' })
    expect(await runner(async () => Promise.reject(new Error('not connected'))).q.run('message', {}, schema)).toEqual({ ok: false, error: 'not-connected' })
    expect(await runner(async () => Promise.reject(new Error('weird'))).q.run('message', {}, schema)).toEqual({ ok: false, error: 'invalid-response' })
  })

  it('does nothing when there is no target yet', async () => {
    const { q, calls } = runner(async () => ok('{}'), () => null)
    expect(await q.run('message', {}, schema)).toEqual({ ok: false, error: 'not-connected' })
    expect(calls).toEqual([])
  })

  it('keeps hostile argument text as data, never as a command', async () => {
    const { q, calls } = runner(async () => ok('{"ok":true,"data":{"text":"x"}}'))
    await q.run('session', { sessionId: "'; rm -rf ~; echo '" }, schema)
    expect(calls[0]!.argv).toHaveLength(7)
    expect(calls[0]!.argv[6]).toBe(JSON.stringify({ sessionId: "'; rm -rf ~; echo '" }))
  })
})

describe('FeedCursors', () => {
  it('keeps the highest id per profile and never goes backwards', () => {
    const c = new FeedCursors()
    c.apply({ default: 5, scout: 2 })
    c.apply({ default: 3, scout: 9, atlas: 1 })
    expect(c.snapshot()).toEqual({ default: 5, scout: 9, atlas: 1 })
  })

  it('produces a JSON argument only when there is something to continue from', () => {
    const c = new FeedCursors()
    expect(c.toArg()).toBeNull()
    c.apply({ default: 5 })
    expect(JSON.parse(c.toArg()!)).toEqual({ default: 5 })
    c.clear()
    expect(c.toArg()).toBeNull()
  })
})
