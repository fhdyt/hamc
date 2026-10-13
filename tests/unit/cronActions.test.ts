import { describe, expect, it } from 'vitest'
import { cronActionArgs, cronCommandPreview, previewArg, validSchedule } from '@shared/cron'
import { CronActionService, RUN_TIMEOUT_MS, ACTION_TIMEOUT_MS, stripAnsi } from '../../src/main/cron/actions'
import { CronStore } from '../../src/main/cron/store'
import type { ExecResult } from '../../src/main/connection/manager'
import { sampleJob } from '../helpers/samples'

const J = '09358c101c91'

describe('cronActionArgs', () => {
  it('builds the five commands with the job id, -p only for a named profile', () => {
    expect(cronActionArgs({ action: 'pause', profile: 'default', jobId: J })).toEqual(['cron', 'pause', J])
    expect(cronActionArgs({ action: 'resume', profile: 'scout', jobId: J })).toEqual(['-p', 'scout', 'cron', 'resume', J])
    expect(cronActionArgs({ action: 'run', profile: 'scout', jobId: J })).toEqual(['-p', 'scout', 'cron', 'run', J])
    expect(cronActionArgs({ action: 'edit', profile: 'default', jobId: J, schedule: '0 9 * * *' })).toEqual(['cron', 'edit', J, '--schedule', '0 9 * * *'])
    expect(cronActionArgs({ action: 'ack', profile: 'default', jobId: J, incidentId: '09358c_0a1b2c3d4e5f' })).toEqual(['cron', 'incidents', 'ack', '09358c_0a1b2c3d4e5f'])
  })

  it('refuses bad profiles, job ids, schedules and incidents of other jobs', () => {
    expect(cronActionArgs({ action: 'pause', profile: '../x', jobId: J })).toBeNull()
    expect(cronActionArgs({ action: 'pause', profile: 'default', jobId: '..' })).toBeNull()
    expect(cronActionArgs({ action: 'pause', profile: 'default', jobId: 'a b' })).toBeNull()
    expect(cronActionArgs({ action: 'edit', profile: 'default', jobId: J })).toBeNull()
    expect(cronActionArgs({ action: 'edit', profile: 'default', jobId: J, schedule: ' every 2h' })).toBeNull()
    expect(cronActionArgs({ action: 'ack', profile: 'default', jobId: J, incidentId: 'ffffff_123' })).toBeNull()
    expect(cronActionArgs({ action: 'ack', profile: 'default', jobId: J })).toBeNull()
    expect(cronActionArgs({ action: 'remove' as never, profile: 'default', jobId: J })).toBeNull()
  })

  it('never adds flags that bypass Hermes', () => {
    for (const action of ['pause', 'resume', 'run'] as const) {
      const a = cronActionArgs({ action, profile: 'default', jobId: J })!
      expect(a).not.toContain('--accept-hooks')
      expect(a).not.toContain('--run-now')
      expect(a).not.toContain('--yolo')
    }
  })
})

describe('validSchedule and the preview', () => {
  it.each([
    ['30m', true],
    ['every 2h', true],
    ['0 9 * * 1-5', true],
    ['', false],
    ['x'.repeat(121), false],
    ['a\nb', false],
    ['tab\there', false],
    [' 30m', false],
    [42, false]
  ])('%j -> %s', (s, ok) => expect(validSchedule(s)).toBe(ok))

  it('quotes only what the shell would need', () => {
    expect(previewArg('09358c101c91')).toBe('09358c101c91')
    expect(previewArg('0 9 * * *')).toBe("'0 9 * * *'")
    expect(previewArg("it's")).toBe("'it'\\''s'")
    expect(cronCommandPreview({ action: 'edit', profile: 'scout', jobId: J, schedule: 'every 2h' })).toBe(`$ hermes -p scout cron edit ${J} --schedule 'every 2h'`)
    expect(cronCommandPreview({ action: 'edit', profile: 'scout', jobId: J, schedule: '' })).toBeNull()
  })
})

function service(opts: { result?: ExecResult; connected?: boolean; hermes?: boolean; delayMs?: number; throws?: boolean } = {}) {
  const calls: { argv: string[]; timeoutMs: number | undefined }[] = []
  const logs: string[] = []
  const store = new CronStore()
  store.apply([sampleJob(), sampleJob({ profile: 'scout', id: 'aaaaaaaaaaaa' })])
  const svc = new CronActionService({
    conn: {
      exec: async (argv: string[], o?: { timeoutMs?: number }) => {
        calls.push({ argv, timeoutMs: o?.timeoutMs })
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        if (opts.throws) throw new Error('channel closed')
        return opts.result ?? { code: 0, stdout: '\u001b[32mPaused job: x (09358c101c91)\u001b[0m\n', stderr: '' }
      }
    } as never,
    hermes: () => (opts.hermes === false ? null : { path: '/usr/bin/hermes' }),
    isConnected: () => opts.connected !== false,
    store,
    log: (m) => logs.push(m)
  })
  return { svc, calls, logs }
}

describe('CronActionService', () => {
  it('runs the shared command with the real path, strips colours and logs without content', async () => {
    const { svc, calls, logs } = service()
    expect(await svc.run({ action: 'pause', profile: 'default', jobId: J })).toEqual({ ok: true, output: 'Paused job: x (09358c101c91)' })
    expect(calls).toEqual([{ argv: ['/usr/bin/hermes', 'cron', 'pause', J], timeoutMs: ACTION_TIMEOUT_MS }])
    await svc.run({ action: 'edit', profile: 'scout', jobId: 'aaaaaaaaaaaa', schedule: 'every 2h' })
    expect(logs).toEqual([`cron pause default ${J} exit 0`, 'cron edit scout aaaaaaaaaaaa exit 0'])
    expect(logs.join(' ')).not.toContain('every 2h')
  })

  it('gives Run now the long limit and refuses a second run of the same job meanwhile', async () => {
    const { svc, calls } = service({ delayMs: 50 })
    const first = svc.run({ action: 'run', profile: 'default', jobId: J })
    expect(svc.isRunning('default', J)).toBe(true)
    expect(await svc.run({ action: 'run', profile: 'default', jobId: J })).toEqual({ ok: false, error: 'busy' })
    expect(await svc.run({ action: 'run', profile: 'scout', jobId: 'aaaaaaaaaaaa' })).toMatchObject({ ok: true })
    await first
    expect(svc.isRunning('default', J)).toBe(false)
    expect(calls[0]!.timeoutMs).toBe(RUN_TIMEOUT_MS)
    expect(calls).toHaveLength(2)
  })

  it('refuses unknown jobs, bad input and a missing connection without running anything', async () => {
    const { svc, calls } = service()
    expect(await svc.run({ action: 'pause', profile: 'default', jobId: 'ffffffffffff' })).toEqual({ ok: false, error: 'unknown-job' })
    expect(await svc.run({ action: 'edit', profile: 'default', jobId: J, schedule: '' })).toEqual({ ok: false, error: 'bad-input' })
    expect(await service({ connected: false }).svc.run({ action: 'pause', profile: 'default', jobId: J })).toEqual({ ok: false, error: 'not-connected' })
    expect(await service({ hermes: false }).svc.run({ action: 'pause', profile: 'default', jobId: J })).toEqual({ ok: false, error: 'not-connected' })
    expect(calls).toEqual([])
  })

  it('reports what Hermes printed on a failure, and a thrown exec', async () => {
    const red = service({ result: { code: 1, stdout: '\u001b[31mFailed to update job: Invalid schedule\u001b[0m\n', stderr: '' } })
    expect(await red.svc.run({ action: 'edit', profile: 'default', jobId: J, schedule: 'nope' })).toEqual({ ok: false, error: 'failed', detail: 'Failed to update job: Invalid schedule' })
    const thrown = service({ throws: true })
    expect(await thrown.svc.run({ action: 'run', profile: 'default', jobId: J })).toEqual({ ok: false, error: 'failed', detail: 'channel closed' })
    expect(thrown.svc.isRunning('default', J)).toBe(false)
  })

  it('stripAnsi leaves plain text alone', () => {
    expect(stripAnsi('plain ✓ text')).toBe('plain ✓ text')
    expect(stripAnsi('\u001b[1;33mwarn\u001b[0m')).toBe('warn')
  })
})
