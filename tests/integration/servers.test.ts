import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

// F-CONN-14..17: several saved servers, one connected at a time
const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}

let dir: string
let fx: FixtureDirs
let a: FakeSsh
let b: FakeSsh
const script = loadCollectorScript('collector/mc_collector.py')
const live: MissionSession[] = []
const logs: string[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-servers-'))
  fx = buildFixture(join(dir, 'fx'))
  a = await startFakeSsh({ fixture: fx })
  b = await startFakeSsh({ fixture: fx })
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  logs.length = 0
})
afterAll(async () => {
  await a.close()
  await b.close()
  removeDir(dir)
})

function makeSession(store = new SettingsStore(':memory:')) {
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: () => {},
    log: (m) => logs.push(m),
    backoff: () => 50,
    latencyIntervalMs: 200
  })
  live.push(session)
  return { session, store }
}

const req = (port: number, over: Partial<ConnectRequest> = {}): ConnectRequest => ({
  host: '127.0.0.1',
  port,
  username: 'tester',
  password: 'test-pass-123',
  remember: true,
  ...over
})

/** Trusts the host key of the server on `port`, then connects to it. */
async function connectTo(session: MissionSession, port: number, over: Partial<ConnectRequest> = {}): Promise<void> {
  const first = await session.connect(req(port, over))
  if (!first.ok && first.hostKey) {
    session.trustHostKey(first.hostKey)
    const second = await session.connect(req(port, over))
    expect(second.ok).toBe(true)
  } else expect(first.ok).toBe(true)
}

describe('saved servers', () => {
  it('keeps one row per server and switches back with the saved password', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port)
    const idA = store.getConnection()!.id
    session.chatSetSession('scout', 'sess-a')
    store.setPins(idA, ['scout'])

    await connectTo(session, b.port, { name: 'lab' })
    const idB = store.getConnection()!.id
    expect(idB).not.toBe(idA)
    expect(session.getSaved()).toMatchObject({ id: idB, label: 'lab', name: 'lab' })
    expect(session.chatGetSession('scout')).toBeNull()
    expect(session.listServers().map((s) => s.id).sort()).toEqual([idA, idB].sort())
    expect(store.getConnection(idA)).toMatchObject({ port: a.port, label: '' })

    const back = await session.connect({ host: '127.0.0.1', port: a.port, username: 'tester', remember: true, useSaved: true, connectionId: idA })
    expect(back.ok).toBe(true)
    expect(session.getSaved()!.id).toBe(idA)
    expect(session.chatGetSession('scout')).toBe('sess-a')
    expect(store.getPins(idA)).toEqual(['scout'])
    expect(logs).toContain(`server switch ${idA}`)
  })

  it('uses only the secret of the chosen server', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port)
    const idA = store.getConnection()!.id
    await connectTo(session, b.port, { password: 'test-pass-123' })
    store.upsertConnection({ id: idA, host: '127.0.0.1', port: a.port, username: 'tester', remember: true, secretEnc: null })
    const r = await session.connect({ host: '127.0.0.1', port: a.port, username: 'tester', remember: true, useSaved: true, connectionId: idA })
    expect(r).toMatchObject({ ok: false, kind: 'auth' })
    expect(session.getSaved()!.id).toBe(idA)
  })

  it('refuses an edit to an address another saved server uses, without connecting', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port)
    const idA = store.getConnection()!.id
    await connectTo(session, b.port)
    const r = await session.connect({ ...req(b.port), connectionId: idA })
    expect(r).toMatchObject({ ok: false, kind: 'unknown', message: 'Another saved server already uses this address.' })
    expect(store.getConnection(idA)!.port).toBe(a.port)
  })

  it('edits the address of a saved server and keeps its id', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port, { name: 'prod' })
    const id = store.getConnection()!.id
    await connectTo(session, b.port, { connectionId: id })
    expect(store.listConnections()).toHaveLength(1)
    expect(store.getConnection(id)).toMatchObject({ port: b.port, label: 'prod' })
  })

  it('forgets a server that is not active without disconnecting', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port)
    const idA = store.getConnection()!.id
    await connectTo(session, b.port)
    await session.forget(idA)
    expect(session.getStatus().state).toBe('connected')
    expect(session.listServers().map((s) => s.port)).toEqual([b.port])
    expect(store.getKnownHost('127.0.0.1', a.port)).toBeNull()
    expect(logs).toContain(`server forget ${idA}`)
  })

  it('forgets the active server and disconnects', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port)
    await connectTo(session, b.port)
    const idB = store.getConnection()!.id
    await session.forget(idB)
    expect(session.getStatus().state).toBe('idle')
    expect(session.getSaved()!.port).toBe(a.port)
  })

  it('renames a server and refuses a bad label', async () => {
    const { session, store } = makeSession()
    await connectTo(session, a.port)
    const id = store.getConnection()!.id
    expect(session.renameServer(id, ' prod ')).toEqual({ ok: true })
    expect(store.getConnection(id)!.label).toBe('prod')
    expect(session.renameServer(id, 'x'.repeat(41))).toMatchObject({ ok: false })
    expect(store.getConnection(id)!.label).toBe('prod')
  })
})
