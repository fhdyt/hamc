import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent, InteractionsData } from '@shared/events'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addInteractions, buildFixture, type FixtureDirs } from '../helpers/fixture'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-inter-'))
  fx = buildFixture(join(dir, 'fx'))
  addInteractions(fx.root)
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

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
    notify: () => undefined,
    backoff: () => 50,
    latencyIntervalMs: 500
  })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const snapshots = (): InteractionsData[] => events.flatMap((e) => (e.type === 'interactions' ? [e.data] : []))
  return { session, req, events, snapshots }
}

const summary = (d: InteractionsData): string[] => d.edges.map((e) => `${e.id}#${e.count}`).sort()

describe('agent interactions over the session', () => {
  it('publishes the edges of every source and answers detail queries', async () => {
    const { session, req, snapshots } = await setup()
    expect((await session.connect(req)).ok).toBe(true)
    const first = await waitFor(() => snapshots().find((s) => s.edges.length > 0), { label: 'interactions event', timeout: 20_000 })
    const ids = first.edges.map((e) => e.id)
    expect(ids).toContain('message:atlas>scout:')
    expect(ids).toContain('kanban:atlas>scout:#41')
    expect(ids).toContain('kanban:scout>default:#42')
    expect(first.rooms.map((r) => r.name)).toEqual(['ops-room'])
    expect(first.subagents.map((s) => s.id)).toContain('sub:atlas:s-atlas-sub')
    expect(first.edges.find((e) => e.id === 'message:atlas>scout:')).toMatchObject({ count: 2, label: 'msg' })
    expect(first.sources.message).toEqual({ state: 'ok', unresolved: 0 })
    // F-AGRAPH-7: @ghost is no profile of this server, so it is a remote peer
    expect(ids).toContain('peer:peer:ghost>scout:chat')
    const remote = await session.interactionDetail({ kind: 'peer', from: 'peer:ghost', to: 'scout' })
    expect(remote).toMatchObject({ ok: true, data: { profile: 'scout', sessionId: 's-bot' } })

    const task = await session.interactionDetail({ kind: 'kanban', id: '42' })
    expect(task).toMatchObject({ ok: true, data: { title: 'Draft the weekly digest' } })
    const msg = await session.interactionDetail({ kind: 'message', from: 'atlas', to: 'scout' })
    expect(msg).toMatchObject({ ok: true, data: { sessionId: 's-bot', profile: 'scout' } })
    expect(await session.interactionDetail({ kind: 'kanban', id: '999' })).toEqual({ ok: false, error: 'not_found' })
    expect(await session.interactionDetail({ kind: 'delegate', id: 'sub:atlas:../x' })).toEqual({ ok: false, error: 'bad_args' })
  })

  it('rebuilds the same snapshot after a reconnect, without duplicates', async () => {
    const { session, req, events, snapshots } = await setup()
    await session.connect(req)
    const first = await waitFor(() => snapshots().find((s) => s.edges.length > 0), { label: 'first snapshot', timeout: 20_000 })
    await session.disconnect()
    events.length = 0
    expect((await session.connect(req)).ok).toBe(true)
    const second = await waitFor(() => snapshots().find((s) => s.edges.length > 0), { label: 'snapshot after reconnect', timeout: 20_000 })
    expect(summary(second)).toEqual(summary(first))
  })
})
