import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { ChatEvent, ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh, type FakeSshOptions } from '../helpers/fakeSshServer'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-gw-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function setup(opts: Partial<FakeSshOptions> = {}) {
  srv = await startFakeSsh({ fixture: fx, tuiGateway: true, ...opts })
  const store = new SettingsStore(':memory:')
  const chat: ChatEvent[] = []
  const logs: string[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => {
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
  const of = (p: string) => chat.filter((e) => e.profile === p)
  const ended = (n = 1, p?: string): boolean => (p ? of(p) : chat).filter((e) => e.kind === 'end').length >= n
  const text = (p?: string): string => (p ? of(p) : chat).flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join('')
  const approvals = () => chat.flatMap((e) => (e.kind === 'approval' ? [e] : []))
  const calls = (m: string) => srv.hermes.gatewayCalls.filter((c) => c.method === m)
  return { session, store, chat, logs, ended, text, approvals, calls }
}

describe('chat through the Hermes TUI gateway', () => {
  it('starts one gateway on the first Send, streams the reply and saves the session with the app source', async () => {
    const { session, chat, ended, text, calls } = await setup()
    // nothing runs on the server before the user sends something
    expect(srv.hermes.gatewayLaunches).toHaveLength(0)
    const r = await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    expect(r.ok).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(srv.hermes.gatewayLaunches).toHaveLength(1)
    const launch = srv.hermes.gatewayLaunches[0]!
    expect(launch.slice(0, 3)).toEqual(['env', 'HERMES_HOME=/home/hermes/.hermes', 'HERMES_TUI_SESSION_TTL_S=0'])
    expect(launch.slice(-3)).toEqual(['-P', '-m', 'tui_gateway.entry'])
    expect(launch.join(' ')).not.toMatch(/YOLO|yolo/)
    expect(calls('session.create')[0]!.params).toEqual({ source: 'mission-control' })
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'gateway' })
    expect(chat.find((e) => e.kind === 'session')).toMatchObject({ sessionId: expect.stringMatching(/^s-gw-/) })
    expect(chat.filter((e) => e.kind === 'tool').map((e) => (e.kind === 'tool' ? `${e.name}:${e.state}` : ''))).toEqual(['web_search:running', 'web_search:ok'])
    expect(chat.find((e) => e.kind === 'tool' && e.state === 'ok')).toMatchObject({ ms: 400 })
    expect(text()).toBe('Here is **what I found** (turn 1).')
    expect(chat.find((e) => e.kind === 'result')).toMatchObject({ exitCode: 0, inputTokens: 100, outputTokens: 20 })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', exitCode: 0, stopped: false })
    expect(session.chatGetSession('default')).toMatch(/^s-gw-/)
  })

  it('keeps one process for every agent and every message; a profile is passed by name', async () => {
    const { session, ended, text, calls } = await setup()
    await session.chatSend({ profile: 'default', text: 'one', attachmentIds: [] })
    await waitFor(() => ended(1, 'default'), { label: 'first', timeout: 20_000 })
    const first = session.chatGetSession('default')
    await session.chatSend({ profile: 'default', text: 'two', attachmentIds: [] })
    await session.chatSend({ profile: 'scout', text: 'hi scout', attachmentIds: [] })
    await waitFor(() => ended(2, 'default') && ended(1, 'scout'), { label: 'both', timeout: 20_000 })
    expect(text('default')).toContain('(turn 2)')
    expect(session.chatGetSession('default')).toBe(first)
    expect(srv.hermes.gatewayLaunches).toHaveLength(1)
    expect(calls('session.create').map((c) => c.params)).toEqual([{ source: 'mission-control' }, { source: 'mission-control', profile: 'scout' }])
    expect(session.chatGetSession('scout')).toMatch(/^s-gw-/)
  })

  it('resumes the saved conversation in a new gateway and starts a new one after New chat', async () => {
    const a = await setup()
    await a.session.chatSend({ profile: 'default', text: 'one', attachmentIds: [] })
    await waitFor(() => a.ended(1), { label: 'first', timeout: 20_000 })
    const saved = a.session.chatGetSession('default')!
    // a reconnect ends the gateway; the next message resumes the saved session in a new one
    await a.session.disconnect()
    expect((await a.session.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true })).ok).toBe(true)
    await a.session.chatSend({ profile: 'default', text: 'two', attachmentIds: [] })
    await waitFor(() => a.ended(2), { label: 'second', timeout: 20_000 })
    expect(a.calls('session.resume')[0]!.params).toMatchObject({ session_id: saved })
    expect(a.text()).toContain('(turn 2)')
    expect(a.session.chatGetSession('default')).toBe(saved)
    expect(srv.hermes.gatewayLaunches).toHaveLength(2)
    a.session.chatSetSession('default', null)
    await a.session.chatSend({ profile: 'default', text: 'three', attachmentIds: [] })
    await waitFor(() => a.ended(3), { label: 'third', timeout: 20_000 })
    expect(a.session.chatGetSession('default')).not.toBe(saved)
  })

  it('starts a new conversation when the saved one is unknown to Hermes', async () => {
    const { session, store, ended, text, calls } = await setup()
    store.setChatSession(store.getConnection()!.id, 'default', 'gone-session')
    await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(calls('session.resume')).toHaveLength(1)
    expect(calls('session.create')).toHaveLength(1)
    expect(text()).toContain('(turn 1)')
    expect(session.chatGetSession('default')).toMatch(/^s-gw-/)
  })

  it('asks before a risky action, sends the choice, and treats Cancel as deny', async () => {
    const { session, chat, ended, text, approvals, calls } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'danger: clean the cache', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => approvals().length === 1, { label: 'approval', timeout: 20_000 })
    const ask = approvals()[0]!
    expect(ask).toMatchObject({ title: 'Delete a folder', detail: 'rm -rf ~/tmp/cache' })
    expect(ask.options.map((o) => [o.id, o.name, o.kind])).toEqual([
      ['once', 'Allow once', 'allow'],
      ['session', 'Allow for this session', 'allow'],
      ['always', 'Always allow', 'allow'],
      ['deny', 'Deny', 'deny']
    ])
    expect(session.chatApprove({ turn: r.turn, approval: ask.id, option: 'made_up' })).toBe(false)
    expect(session.chatApprove({ turn: r.turn, approval: ask.id, option: 'once' })).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(calls('approval.respond')[0]!.params).toMatchObject({ choice: 'once', request_id: 'req1' })
    expect(chat.find((e) => e.kind === 'approval-done')).toMatchObject({ outcome: 'allowed', choice: 'Allow once' })
    expect(text()).toContain('Done, I ran it.')

    const r2 = await session.chatSend({ profile: 'default', text: 'danger again', attachmentIds: [] })
    if (!r2.ok) throw new Error('send failed')
    await waitFor(() => approvals().length === 2, { label: 'second approval', timeout: 20_000 })
    expect(session.chatApprove({ turn: r2.turn, approval: approvals()[1]!.id, option: null })).toBe(true)
    await waitFor(() => ended(2), { label: 'end 2', timeout: 20_000 })
    expect(calls('approval.respond')[1]!.params).toMatchObject({ choice: 'deny' })
    expect(text()).toContain('I was not allowed to run that.')
  })

  it('shows a clarify question with choices as a card and sends the picked answer', async () => {
    const { session, ended, text, approvals, calls } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'ask me', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => approvals().length === 1, { label: 'question', timeout: 20_000 })
    const q = approvals()[0]!
    expect(q.title).toBe('Which colour?')
    expect(q.options.map((o) => o.name)).toEqual(['red', 'blue'])
    expect(session.chatApprove({ turn: r.turn, approval: q.id, option: q.options[1]!.id })).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(calls('clarify.respond')[0]!.params).toMatchObject({ request_id: 'q1', answer: 'blue' })
    expect(text()).toContain('You picked blue.')
  })

  it('stops a running turn with session.interrupt and keeps the gateway for the next message', async () => {
    const { session, chat, ended, calls } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'slow work', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => chat.some((e) => e.kind === 'session'), { label: 'started', timeout: 20_000 })
    expect((await session.chatSend({ profile: 'default', text: 'again', attachmentIds: [] })).ok).toBe(false) // busy
    session.chatStop(r.turn)
    await waitFor(() => ended(), { label: 'stopped', timeout: 20_000 })
    expect(calls('session.interrupt')).toHaveLength(1)
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: true })
    await session.chatSend({ profile: 'default', text: 'after', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'after', timeout: 20_000 })
    expect(srv.hermes.gatewayLaunches).toHaveLength(1)
  })

  it('reports a gateway that dies mid-turn and starts it again for the next message', async () => {
    const { session, chat, ended, text } = await setup()
    await session.chatSend({ profile: 'default', text: 'crash now', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'crash', timeout: 20_000 })
    expect(chat.find((e) => e.kind === 'error')).toMatchObject({ message: expect.stringContaining('gateway stopped') })
    await session.chatSend({ profile: 'default', text: 'hello again', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'again', timeout: 20_000 })
    expect(text()).toContain('what I found')
    expect(srv.hermes.gatewayLaunches).toHaveLength(2)
  })

  it('falls back to the one-shot chat when the server has no gateway, or when it is turned off', async () => {
    const a = await setup({ tuiGateway: false })
    await a.session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => a.ended(), { label: 'end', timeout: 20_000 })
    expect(a.chat[0]).toMatchObject({ kind: 'start', mode: 'stream-json' })
    expect(a.logs.some((l) => l.includes('TUI gateway is not available'))).toBe(true)
  })

  it('uses the one-shot chat when the setting is off', async () => {
    const a = await setup()
    a.store.setSetting('chat.useGateway', false)
    await a.session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => a.ended(), { label: 'end', timeout: 20_000 })
    expect(a.chat[0]).toMatchObject({ kind: 'start', mode: 'stream-json' })
    expect(srv.hermes.gatewayLaunches).toHaveLength(0)
  })
})
