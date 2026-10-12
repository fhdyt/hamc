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
  dir = mkdtempSync(join(tmpdir(), 'mc-acp-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function setup(opts: Partial<FakeSshOptions> = {}) {
  srv = await startFakeSsh({ fixture: fx, acp: true, ...opts })
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
    chatStopGraceMs: 600
  })
  live.push(session)
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  expect((await session.connect(req)).ok).toBe(true)
  const ended = (n = 1): boolean => chat.filter((e) => e.kind === 'end').length >= n
  const text = (): string => chat.flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join('')
  const approvals = () => chat.flatMap((e) => (e.kind === 'approval' ? [e] : []))
  const acpStarts = (): number => srv.execLog.filter((a) => a.includes('acp') && !a.includes('--check')).length
  return { session, store, chat, logs, ended, text, approvals, acpStarts }
}

describe('chat through hermes acp', () => {
  it('streams the reply and the tool step, and saves the session', async () => {
    const { session, chat, ended, text } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    expect(r.ok).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'acp' })
    expect(chat.find((e) => e.kind === 'session')).toMatchObject({ kind: 'session', sessionId: expect.stringMatching(/^s-acp-/) })
    expect(chat.filter((e) => e.kind === 'tool').map((e) => (e.kind === 'tool' ? `${e.name}:${e.state}` : ''))).toEqual(['web_search:running', 'web_search:ok'])
    expect(text()).toContain('what I found')
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: false })
    expect(session.chatGetSession('default')).toMatch(/^s-acp-/)
  })

  it('keeps one process and one conversation across messages, and starts a new one after New chat', async () => {
    const { session, ended, text, acpStarts } = await setup()
    await session.chatSend({ profile: 'default', text: 'one', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    const first = session.chatGetSession('default')
    await session.chatSend({ profile: 'default', text: 'two', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    expect(text()).toContain('(turn 2)')
    expect(session.chatGetSession('default')).toBe(first)
    expect(acpStarts()).toBe(1)
    session.chatSetSession('default', null)
    await session.chatSend({ profile: 'default', text: 'three', attachmentIds: [] })
    await waitFor(() => ended(3), { label: 'third', timeout: 20_000 })
    expect(session.chatGetSession('default')).not.toBe(first)
    expect(acpStarts()).toBe(1)
  })

  it('asks before a risky action and runs it after Allow once', async () => {
    const { session, chat, ended, text, approvals } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'danger: clean the cache', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => approvals().length === 1, { label: 'approval asked', timeout: 20_000 })
    const ask = approvals()[0]!
    expect(ask).toMatchObject({ title: 'terminal', detail: 'rm -rf ~/tmp/cache' })
    expect(ask.options.map((o) => [o.id, o.kind])).toEqual([['allow_once', 'allow'], ['allow_always', 'allow'], ['reject_once', 'deny']])
    expect(ended()).toBe(false) // the turn waits for the answer
    expect(session.chatApprove({ turn: r.turn, approval: ask.id, option: 'allow_once' })).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.find((e) => e.kind === 'approval-done')).toMatchObject({ id: ask.id, outcome: 'allowed', choice: 'Allow once' })
    expect(text()).toContain('Done, I ran it.')
    expect(session.chatApprove({ turn: r.turn, approval: ask.id, option: 'allow_once' })).toBe(false) // answered once only
  })

  it('tells Hermes when the user denies, and refuses an option that was not offered', async () => {
    const { session, chat, ended, text, approvals } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'danger', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => approvals().length === 1, { label: 'approval asked', timeout: 20_000 })
    const id = approvals()[0]!.id
    expect(session.chatApprove({ turn: r.turn, approval: id, option: 'made_up' })).toBe(false)
    expect(session.chatApprove({ turn: r.turn, approval: id, option: 'reject_once' })).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.find((e) => e.kind === 'approval-done')).toMatchObject({ outcome: 'denied', choice: 'Deny' })
    expect(text()).toContain('not allowed')
  })

  it('Stop while an approval is open cancels it and ends the turn as stopped', async () => {
    const { session, chat, ended, approvals } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'danger', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => approvals().length === 1, { label: 'approval asked', timeout: 20_000 })
    session.chatStop(r.turn)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.find((e) => e.kind === 'approval-done')).toMatchObject({ outcome: 'cancelled' })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: true })
    expect(chat.some((e) => e.kind === 'error')).toBe(false)
  })

  it('stops a long answer, and the agent answers again afterwards', async () => {
    const { session, chat, ended } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'slow please', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => chat.some((e) => e.kind === 'start'), { label: 'started', timeout: 20_000 })
    session.chatStop(r.turn)
    await waitFor(() => ended(), { label: 'stopped', timeout: 20_000 })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: true })
    await session.chatSend({ profile: 'default', text: 'again', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'again', timeout: 20_000 })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: false })
  })

  it('reports a process that dies and recovers on the next message', async () => {
    const { session, chat, ended, acpStarts } = await setup()
    await session.chatSend({ profile: 'default', text: 'crash now', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.some((e) => e.kind === 'error')).toBe(true)
    await session.chatSend({ profile: 'default', text: 'hello again', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'recovered', timeout: 20_000 })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: false })
    expect(acpStarts()).toBe(2)
  })

  it('uses one-shot chat when hermes acp is not installed', async () => {
    const { session, chat, ended } = await setup({ acp: false })
    await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'stream-json' })
  })

  it('uses one-shot chat when the setting is off, and never asks the server about ACP then', async () => {
    const { session, store, chat, ended } = await setup()
    store.setSetting('chat.useAcp', false)
    await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'stream-json' })
    expect(srv.execLog.some((a) => a.includes('acp'))).toBe(false)
  })

  it('never adds --yolo or writes settings', async () => {
    const { session, ended } = await setup()
    await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    const flat = srv.execLog.flat()
    expect(flat).not.toContain('--yolo')
    expect(srv.execLog.some((a) => a.includes('config') && a.includes('set'))).toBe(false)
  })

  it('says so when the agent ends a turn without any reply, and logs what it did send', async () => {
    const { session, chat, logs, ended } = await setup()
    await session.chatSend({ profile: 'default', text: 'silent please', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    const err = chat.find((e) => e.kind === 'error')
    expect(err).toMatchObject({ kind: 'error', message: expect.stringMatching(/without a reply/) })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: false })
    const line = logs.find((l) => l.startsWith('acp: turn ended'))
    expect(line).toMatch(/stopReason=end_turn/)
    expect(line).toMatch(/text=0/)
    expect(line).toMatch(/agent_thought_chunk:1/)
    expect(line).toMatch(/tool_call:1/)
  })

  it('does not report an error for a normal reply, and logs its size', async () => {
    const { session, chat, logs, ended } = await setup()
    await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.some((e) => e.kind === 'error')).toBe(false)
    expect(logs.find((l) => l.startsWith('acp: turn ended'))).toMatch(/text=[1-9]\d*/)
  })

  it('reads text sent as a list of blocks or as a bare object', async () => {
    const { session, ended, text } = await setup()
    await session.chatSend({ profile: 'default', text: 'arrayshape', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    expect(text()).toContain('what I found')
    await session.chatSend({ profile: 'default', text: 'bareshape', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    expect(text().match(/what I found/g)).toHaveLength(2)
  })

  it('starts a new ACP session when the saved one came from the one-shot chat (session/load answers null)', async () => {
    const { session, chat, ended, text } = await setup()
    session.chatSetSession('default', '20261012_125043_47a566') // a session id the one-shot chat saved
    await session.chatSend({ profile: 'default', text: 'hello', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.some((e) => e.kind === 'error')).toBe(false)
    expect(text()).toContain('what I found')
    expect(session.chatGetSession('default')).toMatch(/^s-acp-/)
  })

  it('forgets a conversation Hermes refuses, so the next message starts a new one', async () => {
    const { session, chat, ended, text } = await setup()
    await session.chatSend({ profile: 'default', text: 'one', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    session.chatSetSession('default', 's-acp-ghost-1') // loads, but Hermes refuses to prompt it
    await session.chatSend({ profile: 'default', text: 'two', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    expect(chat.filter((e) => e.kind === 'error')).toHaveLength(1)
    await session.chatSend({ profile: 'default', text: 'three', attachmentIds: [] })
    await waitFor(() => ended(3), { label: 'third', timeout: 20_000 })
    expect(chat.filter((e) => e.kind === 'error')).toHaveLength(1)
    expect(text()).toContain('(turn 1)')
  })
})
