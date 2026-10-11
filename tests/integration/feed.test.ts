import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent, FeedItem } from '@shared/events'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addMessage, buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { waitFor } from '../helpers/wait'

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
  dir = mkdtempSync(join(tmpdir(), 'mc-feed-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  rmSync(dir, { recursive: true, force: true })
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
    backoff: () => 50,
    latencyIntervalMs: 500
  })
  live.push(session)
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  const items = (): FeedItem[] => events.flatMap((e) => (e.type === 'feed' ? e.data.items : []))
  return { session, req, events, items }
}

const defaultDb = (): string => join(fx.home, 'state.db')

describe('the feed over the session', () => {
  it('delivers the history of every profile with all five kinds', async () => {
    const { session, req, items } = await setup()
    expect((await session.connect(req)).ok).toBe(true)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    const all = items()
    expect(new Set(all.map((i) => i.profile))).toEqual(new Set(['default', 'scout']))
    expect(new Set(all.map((i) => i.kind))).toEqual(new Set(['user', 'thinking', 'tool', 'result', 'reply']))
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length)
  })

  it('shows a message written to state.db within three seconds', async () => {
    const { session, req, items } = await setup()
    await session.connect(req)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    const t0 = Date.now()
    addMessage(defaultDb(), 's-default-1', 'user', 'a brand new message', Date.now() / 1000)
    await waitFor(() => items().some((i) => i.text === 'a brand new message'), { label: 'new message', timeout: 6000, interval: 50 })
    expect(Date.now() - t0).toBeLessThan(3500)
  })

  it('continues after a reconnect without duplicates and without gaps', async () => {
    const { session, req, items, events } = await setup()
    await session.connect(req)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    addMessage(defaultDb(), 's-default-1', 'user', 'before the drop', Date.now() / 1000)
    await waitFor(() => items().some((i) => i.text === 'before the drop'), { label: 'before', timeout: 6000 })
    const feedEventsBefore = events.filter((e) => e.type === 'feed').length

    srv.dropConnections()
    addMessage(defaultDb(), 's-default-1', 'user', 'while it was down', Date.now() / 1000)
    await waitFor(() => items().some((i) => i.text === 'while it was down'), { label: 'after reconnect', timeout: 20_000 })

    const all = items()
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length)
    expect(all.filter((i) => i.text === 'before the drop')).toHaveLength(1)
    expect(all.filter((i) => i.text === 'while it was down')).toHaveLength(1)
    const afterDrop = events.slice(0).filter((e) => e.type === 'feed').slice(feedEventsBefore)
    expect(afterDrop.every((e) => e.type === 'feed' && e.data.history === false)).toBe(true)
  })
})

describe('on-demand queries over the session', () => {
  it('reads the full text of a message', async () => {
    const { session, req, items } = await setup()
    await session.connect(req)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    const r = await session.feedMessage({ profile: 'default', messageId: 3, field: 'reasoning' })
    expect(r).toEqual({ ok: true, data: { text: 'User greets; search first.', truncated: false, fullLen: 26 } })
    expect(await session.feedMessage({ profile: 'default', messageId: 9999, field: 'content' })).toEqual({ ok: false, error: 'not_found' })
    expect(await session.feedMessage({ profile: '../x', messageId: 1, field: 'content' })).toEqual({ ok: false, error: 'bad_args' })
  })

  it('pages older history by id', async () => {
    const { session, req, items } = await setup()
    await session.connect(req)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    const r = await session.feedHistory({ before: { default: 5 }, limit: 2 })
    expect(r.ok && r.data.items.map((i) => i.id)).toEqual(['default:4:0', 'default:3:0', 'default:3:1', 'default:3:2'])
    expect(r.ok && r.data.exhausted).toEqual({ default: false })
  })

  it('loads a whole session with its sub-sessions', async () => {
    const { session, req, items } = await setup()
    await session.connect(req)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    const r = await session.feedSession({ profile: 'scout', sessionId: 's-scout-1' })
    expect(r.ok && r.data.session.source).toBe('cron')
    expect(r.ok && r.data.children).toEqual([{ id: 's-scout-child', source: 'subagent' }])
    expect(r.ok && r.data.items.map((i) => i.kind)).toEqual(['user', 'thinking', 'reply'])
  })

  it('reports not-connected before connecting', async () => {
    const { session } = await setup()
    expect(await session.feedSession({ profile: 'scout', sessionId: 's' })).toEqual({ ok: false, error: 'not-connected' })
  })
})

describe('the feed and the Zero-Change rule', () => {
  it('only issues read-only commands and leaves the fixture untouched', async () => {
    const { session, req, items } = await setup()
    const before = snapshotTree(fx.root)
    await session.connect(req)
    await waitFor(() => items().length >= 12, { label: 'history', timeout: 15_000 })
    await session.feedMessage({ profile: 'default', messageId: 3, field: 'content' })
    await session.feedHistory({ before: { default: 5 }, limit: 3 })
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})
