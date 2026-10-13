import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir, waitFor } from '../helpers/wait'

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
  dir = mkdtempSync(join(tmpdir(), 'mc-memory-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})
afterAll(() => undefined)

async function setup() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const events: CollectorEvent[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => {
      if (channel === IPC.evEvent) events.push(payload as CollectorEvent)
    },
    backoff: () => 50,
    collectorArgs: ['--memory-interval', '0.3'],
    latencyIntervalMs: 500
  })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  return { session, req, events }
}



const authors = (session: MissionSession, file: 'soul' | 'memory' | 'user' = 'memory') => session.memoryVersions('default', file).map((v) => v.author)

describe('memory snapshots over the session', () => {
  it('stores a first version, then a live change, then a save made in Mission Control', async () => {
    const { session, req, events } = await setup()
    expect((await session.connect(req)).ok).toBe(true)
    await waitFor(() => authors(session).length === 1, { label: 'baseline', timeout: 15_000 })
    expect(authors(session)).toEqual(['first'])
    expect(events.some((e) => (e as { type: string }).type === 'memory')).toBe(false)

    const path = join(fx.home, 'memories', 'MEMORY.md')
    writeFileSync(path, 'm\n§\nlikes tea\n')
    utimesSync(path, new Date(), new Date(Date.now() + 2000))
    await waitFor(() => authors(session).length === 2, { label: 'live change', timeout: 15_000 })
    expect(authors(session)).toEqual(['other', 'first'])

    const read = await session.agentReadFile('default', 'memory')
    if (!read.ok) throw new Error('read failed')
    const res = await session.agentWriteFile('default', 'memory', 'm\n§\nlikes coffee\n', read.file.hash)
    expect(res.ok).toBe(true)
    expect(authors(session)).toEqual(['you', 'other', 'first'])
    await new Promise((r) => setTimeout(r, 1200))
    expect(authors(session)).toEqual(['you', 'other', 'first'])
    const newest = session.memoryVersions('default', 'memory')[0]!
    expect(session.memoryVersion(newest.id)).toEqual({ ok: true, id: newest.id, text: 'm\n§\nlikes coffee\n' })
    expect(session.memoryClear()).toBeGreaterThanOrEqual(3)
  })

  it('a change made while disconnected arrives as one while-away version', async () => {
    const { session, req } = await setup()
    await session.connect(req)
    await waitFor(() => authors(session, 'soul').length === 1, { label: 'baseline', timeout: 15_000 })
    await session.disconnect()
    writeFileSync(join(fx.home, 'SOUL.md'), 'a new soul\n')
    await session.connect(req)
    await waitFor(() => authors(session, 'soul').length === 2, { label: 'away version', timeout: 15_000 })
    expect(authors(session, 'soul')).toEqual(['away', 'first'])
  })
})
