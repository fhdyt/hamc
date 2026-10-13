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
import { addToolData, addUsageData, buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}
const script = loadCollectorScript('collector/mc_collector.py')

const BASE = 1_000_000
const STARTS = [BASE, BASE + 82800, BASE + 172800, BASE + 259200]
const END = STARTS[3]! + 86400

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const live: MissionSession[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-usage-'))
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

describe('usage over the session', () => {
  it('summarizes usage by day and reads tool stats through the real collector', async () => {
    addUsageData(fx.root, BASE)
    addToolData(fx.root, BASE)
    const { session } = await setup()
    const s = await session.usageSummary({ profiles: [], dayStarts: STARTS, endTs: END })
    expect(s.ok && s.data.rows.some((r) => r.day === 0 && r.profile === 'default' && r.cost === 3)).toBe(true)
    const t = await session.usageTools({ profiles: [], sinceTs: BASE - 10, endTs: BASE + 1000 })
    expect(t.ok && t.data.tools.map((x) => x.name).sort()).toEqual(['terminal', 'web_search'])
  })

  it('answers a malformed request with bad_args', async () => {
    const { session } = await setup()
    expect(await session.usageSummary({ profiles: [], dayStarts: [], endTs: 5 })).toEqual({ ok: false, error: 'bad_args' })
    expect(await session.usageTools({ profiles: [], sinceTs: 10, endTs: 5 })).toEqual({ ok: false, error: 'bad_args' })
  })

  it('only issues read-only commands and leaves the fixture untouched', async () => {
    addUsageData(fx.root, BASE)
    addToolData(fx.root, BASE)
    const before = snapshotTree(fx.root)
    const { session } = await setup()
    await session.usageSummary({ profiles: [], dayStarts: STARTS, endTs: END })
    await session.usageTools({ profiles: [], sinceTs: BASE, endTs: BASE + 1000 })
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})
