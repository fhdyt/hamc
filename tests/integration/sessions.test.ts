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
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-sessions-'))
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

describe('sessions over the session', () => {
  it('lists, searches and reads a transcript through the real collector', async () => {
    const { session } = await setup()
    const list = await session.sessionsList({ profiles: [], limit: 50 })
    expect(list.ok && list.data.rows.map((r) => r.id)).toEqual(['s-scout-child', 's-scout-1', 's-default-1', 's-default-old'])
    const found = await session.sessionsSearch({ profiles: [], q: 'digest', limit: 50 })
    expect(found.ok && found.data.rows[0]?.snippet).toContain('\u0002')
    const t = await session.sessionsTranscript({ profile: 'scout', sessionId: 's-scout-1', limit: 200 })
    expect(t.ok && t.data.chain.children.map((c) => c.id)).toEqual(['s-scout-child'])
  })

  it('answers a missing session with not_found', async () => {
    const { session } = await setup()
    expect(await session.sessionsTranscript({ profile: 'default', sessionId: 'nope', limit: 200 })).toEqual({ ok: false, error: 'not_found' })
  })

  it('only issues read-only commands and leaves the fixture untouched', async () => {
    const { session } = await setup()
    const before = snapshotTree(fx.root)
    await session.sessionsList({ profiles: [], limit: 50 })
    await session.sessionsSearch({ profiles: [], q: 'hello', limit: 50 })
    await session.sessionsTranscript({ profile: 'default', sessionId: 's-default-1', limit: 200 })
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})
