import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { GroupEvent } from '@shared/groups'
import type { ChatEvent, ConnectRequest } from '@shared/ipc'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-groups-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function setup(tuiGateway = true) {
  srv = await startFakeSsh({ fixture: fx, tuiGateway })
  const store = new SettingsStore(':memory:')
  const groups: GroupEvent[] = []
  const chat: ChatEvent[] = []
  const logs: string[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => {
      if (channel === IPC.evGroup) groups.push(payload as GroupEvent)
      if (channel === IPC.evChat) chat.push(payload as ChatEvent)
    },
    backoff: () => 50,
    latencyIntervalMs: 500,
    log: (m) => logs.push(m),
    chatStopGraceMs: 3000,
    gatewayReadyMs: 15_000
  })
  live.push(session)
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  expect((await session.connect(req)).ok).toBe(true)
  const runEnds = () => groups.filter((e): e is Extract<GroupEvent, { kind: 'run-end' }> => e.kind === 'run-end')
  const calls = (m: string) => srv.hermes.gatewayCalls.filter((c) => c.method === m)
  return { session, store, groups, chat, logs, runEnds, calls }
}

describe('group chat rooms over the TUI gateway', () => {
  it('runs a room: every member answers in its own hidden room session, then the room settles', async () => {
    const t = await setup()
    const room = t.session.groupsCreate({ name: 'Ops', members: ['default', 'scout'] })
    if ('error' in room) throw new Error(room.error)
    expect(await t.session.groupsSend({ id: room.id, text: 'hello room' })).toEqual({ ok: true })
    await waitFor(() => t.runEnds().length === 1, { label: 'run end', timeout: 30_000 })
    expect(t.runEnds()[0]).toMatchObject({ reason: 'settled', replies: 2 })
    const log = t.session.groupsEntries({ id: room.id })
    expect(log.map((e) => `${e.author}:${e.status}:${e.text}`)).toEqual(['user:ok:hello room', 'default:ok:default: noted.', 'scout:ok:scout: noted.', 'default:pass:(pass)'])
    expect(t.calls('session.create').map((c) => c.params)).toEqual([
      { source: 'mission-control', title: `Group: ${room.id}`, hidden: true, room_plumbing: true, follow_profile_config: true },
      { source: 'mission-control', profile: 'scout', title: `Group: ${room.id}`, hidden: true, room_plumbing: true, follow_profile_config: true }
    ])
    expect(t.calls('prompt.submit')[0]!.params).toMatchObject({ text: expect.stringContaining('[Group chat: "Ops"] You are @default') })
    // the turn events reach the renderer as room events, never as 1:1 chat events
    expect(t.groups.some((e) => e.kind === 'turn' && e.event.kind === 'text')).toBe(true)
    expect(t.chat).toEqual([])
    expect(t.logs.join('\n')).not.toContain('hello room')

    // a mention reaches only that member, in the same room session
    await t.session.groupsSend({ id: room.id, text: '@scout status?' })
    await waitFor(() => t.runEnds().length === 2, { label: 'second run', timeout: 30_000 })
    expect(t.session.groupsEntries({ id: room.id }).slice(4).map((e) => `${e.author}:${e.text}`)).toEqual(['user:@scout status?', 'scout:scout: on it.'])
    expect(t.calls('session.create')).toHaveLength(2)
    const seats = t.store.groups.members(room.id)
    expect(seats.every((m) => /^s-gw-/.test(m.sessionId ?? ''))).toBe(true)

    // the 1:1 chat of a member is still its own session
    await t.session.chatSend({ profile: 'default', text: 'just us', attachmentIds: [] })
    await waitFor(() => t.chat.some((e) => e.kind === 'end'), { label: 'dm end', timeout: 20_000 })
    expect(t.session.chatGetSession('default')).not.toBe(seats[0]!.sessionId)
  })

  it('stops a slow member turn', async () => {
    const t = await setup()
    const room = t.session.groupsCreate({ name: 'Ops', members: ['default', 'scout'] })
    if ('error' in room) throw new Error(room.error)
    await t.session.groupsSend({ id: room.id, text: 'slow please' })
    await waitFor(() => t.groups.some((e) => e.kind === 'turn-start'), { label: 'turn start', timeout: 30_000 })
    expect(await t.session.groupsSend({ id: room.id, text: 'again' })).toEqual({ ok: false, error: 'busy' })
    t.session.groupsStop(room.id)
    await waitFor(() => t.runEnds().length === 1, { label: 'run end', timeout: 30_000 })
    expect(t.runEnds()[0]).toMatchObject({ reason: 'stopped' })
    expect(t.calls('session.interrupt')).toHaveLength(1)
  })

  it('says rooms need the gateway when the server has none', async () => {
    const t = await setup(false)
    const room = t.session.groupsCreate({ name: 'Ops', members: ['default', 'scout'] })
    if ('error' in room) throw new Error(room.error)
    expect(await t.session.groupsSend({ id: room.id, text: 'hi' })).toEqual({ ok: true })
    await waitFor(() => t.runEnds().length === 1, { label: 'run end', timeout: 30_000 })
    expect(t.session.groupsEntries({ id: room.id }).map((e) => e.status)).toEqual(['ok', 'failed', 'failed'])
    expect(t.session.groupsList().gateway.ok).toBe(false)
    expect(await t.session.groupsSend({ id: room.id, text: 'hi again' })).toMatchObject({ ok: false, error: 'no-gateway' })
  })
})
