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
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-chat-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function setup(opts: Partial<FakeSshOptions> = {}) {
  srv = await startFakeSsh({ fixture: fx, ...opts })
  const store = new SettingsStore(':memory:')
  const chat: ChatEvent[] = []
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
    chatStopGraceMs: 400
  })
  live.push(session)
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  expect((await session.connect(req)).ok).toBe(true)
  const turns = (): string[] => [...new Set(chat.map((e) => e.turn))]
  const ended = (n = 1): boolean => chat.filter((e) => e.kind === 'end').length >= n
  const text = (): string => chat.flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join('')
  const chatCommands = (): string[][] => srv.execLog.filter((a) => a.includes('chat') && !a.includes('--help'))
  return { session, store, chat, turns, ended, text, chatCommands }
}

describe('a chat turn', () => {
  it('streams the reply, the tool step and the result, and remembers the session', async () => {
    const { session, chat, ended, text, chatCommands } = await setup()
    const r = await session.chatSend({ profile: 'default', text: 'hello agent from the app', attachmentIds: [] })
    expect(r.ok).toBe(true)
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    const kinds = chat.map((e) => e.kind)
    expect(kinds[0]).toBe('start')
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'stream-json' })
    expect(kinds).toContain('session')
    expect(chat.filter((e) => e.kind === 'tool').map((e) => (e.kind === 'tool' ? e.state : ''))).toEqual(['running', 'ok'])
    expect(chat.find((e) => e.kind === 'tool' && e.state === 'ok')).toMatchObject({ name: 'web_search', ms: 1200 })
    expect(text()).toContain('Here is **what I found**')
    expect(text()).toContain("print('hello')")
    expect(chat.find((e) => e.kind === 'result')).toMatchObject({ exitCode: 0, inputTokens: 120, outputTokens: 45 })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', exitCode: 0, stopped: false })
    const sid = chat.find((e) => e.kind === 'session')
    expect(sid && sid.kind === 'session' && session.chatGetSession('default')).toBe(sid && sid.kind === 'session' ? sid.sessionId : null)
    // the command is the PRD one and the message is not part of any argument
    const cmd = chatCommands()[0]!
    expect(cmd.slice(cmd.indexOf('chat'))).toEqual(['chat', '--oneshot', '--query-file', '-', '--format', 'stream-json', '--source', 'mission-control'])
    expect(srv.execLog.flat().some((a) => a.includes('hello agent from the app'))).toBe(false)
    expect(cmd).not.toContain('--yolo')
  })

  it('continues the same session on the next turn and starts a new one after New chat', async () => {
    const { session, chat, ended, chatCommands } = await setup()
    await session.chatSend({ profile: 'default', text: 'one', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    const first = session.chatGetSession('default')!
    await session.chatSend({ profile: 'default', text: 'two', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    const resumed = chatCommands()[1]!
    expect(resumed.slice(resumed.indexOf('--resume'))).toEqual(['--resume', first])
    expect(session.chatGetSession('default')).toBe(first)

    session.chatSetSession('default', null)
    expect(session.chatGetSession('default')).toBeNull()
    await session.chatSend({ profile: 'default', text: 'three', attachmentIds: [] })
    await waitFor(() => ended(3), { label: 'third', timeout: 20_000 })
    expect(chatCommands()[2]).not.toContain('--resume')
    const ids = new Set(chat.flatMap((e) => (e.kind === 'session' ? [e.sessionId] : [])))
    expect(ids.size).toBe(2)
  })

  it('uses -p for other agents and keeps their sessions apart', async () => {
    const { session, ended, chatCommands } = await setup()
    await session.chatSend({ profile: 'scout', text: 'hi scout', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chatCommands()[0]!.slice(chatCommands()[0]!.indexOf('-p'), chatCommands()[0]!.indexOf('-p') + 2)).toEqual(['-p', 'scout'])
    expect(session.chatGetSession('scout')).not.toBeNull()
    expect(session.chatGetSession('default')).toBeNull()
  })

  it('refuses a second turn for the same agent while one runs, and answers other agents', async () => {
    const { session, ended } = await setup()
    const first = await session.chatSend({ profile: 'default', text: 'slow please', attachmentIds: [] })
    expect(first.ok).toBe(true)
    expect(await session.chatSend({ profile: 'default', text: 'again', attachmentIds: [] })).toEqual({ ok: false, error: 'busy' })
    const other = await session.chatSend({ profile: 'scout', text: 'hello', attachmentIds: [] })
    expect(other.ok).toBe(true)
    if (first.ok) session.chatStop(first.turn)
    await waitFor(() => ended(2), { label: 'both ended', timeout: 20_000 })
  })

  it('stops a turn: it ends as stopped without an error, and the agent can be used again', async () => {
    const { session, chat, ended } = await setup({})
    const r = await session.chatSend({ profile: 'default', text: 'this one is slow', attachmentIds: [] })
    if (!r.ok) throw new Error('send failed')
    await waitFor(() => chat.some((e) => e.kind === 'session'), { label: 'running', timeout: 20_000 })
    session.chatStop(r.turn)
    await waitFor(() => ended(), { label: 'stopped', timeout: 15_000 })
    // The interrupt is sent as a signal and, if the process does not end on its own, the channel is closed
    // (this fake server never receives a signal sent after stdin was closed; OpenSSH does).
    expect(chat.at(-1)).toMatchObject({ kind: 'end', stopped: true })
    expect(chat.some((e) => e.kind === 'error')).toBe(false)
    const again = await session.chatSend({ profile: 'default', text: 'ok now', attachmentIds: [] })
    expect(again.ok).toBe(true)
  })

  it('shows the reason when Hermes fails, with its own message', async () => {
    const { session, chat, ended } = await setup()
    await session.chatSend({ profile: 'default', text: 'this will fail', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.find((e) => e.kind === 'error')).toMatchObject({ message: expect.stringContaining('provider authentication failed') })
    expect(chat.at(-1)).toMatchObject({ kind: 'end', exitCode: 2 })
  })

  it('reports a command refused by the approval policy, and never adds --yolo', async () => {
    const { session, chat, ended, chatCommands } = await setup()
    await session.chatSend({ profile: 'default', text: 'please run something blocked', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat.find((e) => e.kind === 'notice')).toMatchObject({ code: 'blocked', message: 'Command blocked by Hermes approval policy' })
    expect(chat.find((e) => e.kind === 'tool' && e.state === 'error')).toBeTruthy()
    expect(chatCommands().flat()).not.toContain('--yolo')
  })

  it('falls back to plain text when Hermes has no stream-json, and says so', async () => {
    const { session, chat, ended, text, chatCommands } = await setup({ chatHelp: 'usage: hermes chat [-q QUERY] [-Q] [--resume ID]\n' })
    await session.chatSend({ profile: 'default', text: 'plain question', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'plain' })
    expect(chat[0]).not.toHaveProperty('note')
    expect(text()).toContain('Here is **what I found**')
    expect(chat.some((e) => e.kind === 'tool')).toBe(false)
    const cmd = chatCommands()[0]!
    expect(cmd.slice(cmd.indexOf('chat'))).toEqual(['chat', '-q', 'plain question', '-Q'])
  })

  it('on a Hermes without --format, sends the message on stdin, hides the -Q session line and continues the session', async () => {
    const help = 'usage: hermes chat [-q QUERY | --query-file PATH] [--oneshot] [-Q] [--resume SESSION_ID] [--source SOURCE]\n'
    const { session, chat, ended, text, chatCommands } = await setup({ chatHelp: help })
    await session.chatSend({ profile: 'default', text: 'what is 1+1', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    expect(chat[0]).toMatchObject({ kind: 'start', mode: 'plain' })
    expect(text()).toContain('what I found')
    expect(text()).not.toContain('session_id')
    const sid = session.chatGetSession('default')!
    expect(sid).toMatch(/^s-mc-/)
    const first = chatCommands()[0]!
    expect(first.slice(first.indexOf('chat'))).toEqual(['chat', '--oneshot', '--query-file', '-', '-Q', '--source', 'mission-control'])
    expect(srv.execLog.flat().some((a) => a.includes('what is 1+1'))).toBe(false)
    await session.chatSend({ profile: 'default', text: 'add 3', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    const second = chatCommands()[1]!
    expect(second.slice(second.indexOf('--resume'))).toEqual(['--resume', sid])
  })

  it('finds the session of a plain turn in state.db and continues it with --resume', async () => {
    const { session, chat, ended, chatCommands } = await setup({ chatHelp: 'usage: hermes chat [-q QUERY] [-Q] [--resume ID]\n' })
    await session.chatSend({ profile: 'default', text: 'first plain nosid', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    await waitFor(() => session.chatGetSession('default') !== null, { label: 'session found', timeout: 15_000 })
    const sid = session.chatGetSession('default')!
    expect(chat.find((e) => e.kind === 'session')).toMatchObject({ kind: 'session', sessionId: sid })
    await session.chatSend({ profile: 'default', text: 'second plain', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    const second = chatCommands()[1]!
    expect(second.slice(second.indexOf('chat'))).toEqual(['chat', '-q', 'second plain', '-Q', '--resume', sid])
    expect(session.chatGetSession('default')).toBe(sid)
  })

  it('rejects bad requests without touching the server', async () => {
    const { session } = await setup()
    const before = srv.execLog.length
    expect(await session.chatSend({ profile: 'default', text: '   ', attachmentIds: [] })).toEqual({ ok: false, error: 'empty' })
    expect(await session.chatSend({ profile: '../x', text: 'hi', attachmentIds: [] })).toEqual({ ok: false, error: 'bad-profile' })
    expect(await session.chatSend({ profile: 'default', text: 'x'.repeat(100_001), attachmentIds: [] })).toEqual({ ok: false, error: 'too-long' })
    expect(await session.chatSend({ profile: 'default', text: 'hi', attachmentIds: ['a1b2c3d4-e5'] })).toMatchObject({ ok: false, error: 'attachment-missing' })
    expect(srv.execLog.length).toBe(before)
  })

  it('does not send while not connected', async () => {
    const { session } = await setup()
    await session.disconnect()
    expect(await session.chatSend({ profile: 'default', text: 'hi', attachmentIds: [] })).toEqual({ ok: false, error: 'not-connected' })
  })
})

describe('chat history and the container warning', () => {
  it('lists the sessions started from the app, newest first, with a preview', async () => {
    const { session, ended } = await setup()
    await session.chatSend({ profile: 'default', text: 'first question about the roadmap', attachmentIds: [] })
    await waitFor(() => ended(1), { label: 'first', timeout: 20_000 })
    session.chatSetSession('default', null)
    await session.chatSend({ profile: 'default', text: 'second question', attachmentIds: [] })
    await waitFor(() => ended(2), { label: 'second', timeout: 20_000 })
    const r = await session.chatSessions('default')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.sessions.map((s) => s.preview)).toEqual(['second question', 'first question about the roadmap'])
      expect(r.data.sessions[0]!.messages).toBeGreaterThanOrEqual(3)
    }
    expect(await session.chatSessions('../x')).toBeTruthy()
  })

  it('reads the terminal backend of an agent', async () => {
    const { session } = await setup({ backend: 'docker' })
    expect(await session.chatBackend('default')).toBe('docker')
    expect(await session.chatBackend('../x')).toBeNull()
  })
})

describe('the chat and the Zero-Change rule', () => {
  it('runs only hermes chat commands and read verbs, stores no message text, and leaves the vault alone', async () => {
    const { session, store, ended } = await setup()
    const before = snapshotTree(join(fx.root, 'home', 'vault'))
    await session.chatSend({ profile: 'default', text: 'a secret message text', attachmentIds: [] })
    await waitFor(() => ended(), { label: 'end', timeout: 20_000 })
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(join(fx.root, 'home', 'vault'))).toEqual(before)
    expect(JSON.stringify(store.allSettings())).not.toContain('a secret message text')
    const id = store.getConnection()!.id
    expect(store.getChatSession(id, 'default')).toMatch(/^s-mc-/)
  })
})
