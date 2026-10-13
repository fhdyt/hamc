import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addLogs, buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}
const script = loadCollectorScript('collector/mc_collector.py')

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const live: MissionSession[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-logs-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function setup() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({ manager, store, secrets, collectorScript: script, send: () => {}, backoff: () => 50, latencyIntervalMs: 500 })
  live.push(session)
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  expect((await session.connect(req)).ok).toBe(true)
  return { session }
}

describe('logs over the session', () => {
  it('lists the log files and reads the last lines and then only the new ones', async () => {
    addLogs(fx.root)
    const { session } = await setup()
    const list = await session.logsList({ profiles: [] })
    expect(list.ok && list.data.files.map((f) => `${f.profile}/${f.name}`).sort()).toEqual(['default/agent.log', 'default/errors.log', 'scout/gateway.log'])
    const r = await session.logsRead({ profile: 'default', file: 'agent.log', limit: 100 })
    expect(r.ok && r.data.lines.length).toBe(6)
    expect(r.ok && r.data.lines[0]).toContain('session started')
    const again = await session.logsRead({ profile: 'default', file: 'agent.log', after: r.ok ? r.data.offset : 0, limit: 100 })
    expect(again.ok && again.data.lines).toEqual([])
  })

  it('answers a file that is not there with not_found', async () => {
    const { session } = await setup()
    expect(await session.logsRead({ profile: 'default', file: 'agent.log', limit: 10 })).toEqual({ ok: false, error: 'not_found' })
  })

  it('only issues read-only commands and leaves the fixture untouched', async () => {
    addLogs(fx.root)
    const before = snapshotTree(fx.root)
    const { session } = await setup()
    await session.logsList({ profiles: [] })
    await session.logsRead({ profile: 'default', file: 'errors.log', limit: 50 })
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat', 'tail']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})

describe('gateway actions over the session', () => {
  it('restarts and stops one gateway with each argument separate', async () => {
    const { session } = await setup()
    expect(await session.gatewayAction({ action: 'restart', profile: 'scout' })).toMatchObject({ ok: true })
    expect(await session.gatewayAction({ action: 'stop', profile: 'default' })).toMatchObject({ ok: true })
    expect(srv.hermes.restarts).toEqual(['scout'])
    expect(srv.hermes.stops).toEqual(['default'])
  })

  it('refuses bad input before running anything and reports a failure', async () => {
    const { session } = await setup()
    expect(await session.gatewayAction({ action: 'stop', profile: '../x' })).toMatchObject({ ok: false, error: 'bad-input' })
    expect(await session.gatewayAction({ action: 'start' as never, profile: 'scout' })).toMatchObject({ ok: false, error: 'bad-input' })
    expect(srv.hermes.stops).toEqual([])
    srv.hermes.failOn['gateway'] = 'no gateway is running'
    expect(await session.gatewayAction({ action: 'stop', profile: 'scout' })).toEqual({ ok: false, error: 'failed', detail: 'no gateway is running' })
  })
})

describe('approvals over the session', () => {
  it('returns the raw policy and the suggestions of the two read-only commands', async () => {
    const { session } = await setup()
    const r = await session.approvalsRead('scout')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.parse(r.policy)).toMatchObject({ mode: 'manual', timeout: 60 })
    expect(r.suggest).toContain('terminal')
    expect(r.policyError).toBeNull()
    expect(r.suggestError).toBeNull()
  })

  it('keeps going when one command fails and rejects a bad profile', async () => {
    const { session } = await setup()
    srv.hermes.failOn['approvals'] = 'unknown command'
    const r = await session.approvalsRead('default')
    expect(r.ok && r.policyError).toBeNull()
    expect(r.ok && r.suggestError).toContain('unknown command')
    expect(await session.approvalsRead('../x')).toEqual({ ok: false, error: 'bad-input' })
  })
})
