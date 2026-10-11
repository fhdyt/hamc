import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import type { AgentModels, Capabilities, ConnStatus, ConnectRequest, PreflightResult, StartupProgress } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { waitFor } from '../helpers/wait'

const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const script = loadCollectorScript('collector/mc_collector.py')
const live: MissionSession[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-sess-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function makeSession(store = new SettingsStore(':memory:')) {
  const sent: { channel: string; payload: unknown }[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => sent.push({ channel, payload }),
    backoff: () => 50,
    latencyIntervalMs: 200
  })
  live.push(session)
  const of = <T>(channel: string): T[] => sent.filter((s) => s.channel === channel).map((s) => s.payload as T)
  return { session, store, sent, of }
}

const req = (over: Partial<ConnectRequest> = {}): ConnectRequest => ({
  host: '127.0.0.1',
  port: srv.port,
  username: 'tester',
  password: 'test-pass-123',
  remember: true,
  ...over
})

async function trusted(session: MissionSession, over: Partial<ConnectRequest> = {}) {
  const first = await session.connect(req(over))
  if (first.ok || !first.hostKey) throw new Error('expected a host key challenge')
  session.trustHostKey(first.hostKey)
  return first.hostKey
}

describe('first connection', () => {
  it('asks to verify the host key, then connects, streams data and reports preflight', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store, of } = makeSession()

    const first = await session.connect(req())
    expect(first).toMatchObject({ ok: false, kind: 'hostkey-unverified' })
    expect(first.ok === false && first.hostKey?.fingerprint).toBe(srv.fingerprint)
    expect(store.getConnection()).toBeNull()

    session.trustHostKey(first.ok === false ? first.hostKey! : (undefined as never))
    const second = await session.connect(req())
    expect(second.ok).toBe(true)
    expect(second.ok && second.preflight.canStart).toBe(true)

    await waitFor(() => of<CollectorEvent>(IPC.evEvent).find((e) => e.type === 'agents'), { label: 'agents event', timeout: 15_000 })
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'metrics').length >= 1, { label: 'metrics event', timeout: 15_000 })

    const statuses = of<ConnStatus>(IPC.evStatus)
    expect(statuses.at(-1)).toMatchObject({ state: 'connected', hermesVersion: '0.21.6' })
    expect(of<PreflightResult>(IPC.evPreflight).at(-1)!.items).toHaveLength(9)
    const startup = of<StartupProgress>(IPC.evStartup).at(-1)!
    expect(startup.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done'])

    const models = await waitFor(() => of<AgentModels>(IPC.evModels).at(-1), { label: 'models', timeout: 15_000 })
    expect(Object.keys(models).sort()).toEqual(['atlas', 'default', 'scout'])
    expect(models['scout']).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet' })

    const caps = await waitFor(() => of<Capabilities>(IPC.evCapabilities).at(-1), { label: 'capabilities' })
    expect(caps.supported['mcp list']).toBe(true)
  })

  it('lets the user trust a new host key without retyping the password', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session } = makeSession()
    const first = await session.connect(req())
    expect(first.ok).toBe(false)
    session.trustHostKey(first.ok === false ? first.hostKey! : (undefined as never))
    const second = await session.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', remember: true })
    expect(second.ok).toBe(true)
  })

  it('stores the connection with an encrypted password and never the plain one', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    await trusted(session)
    expect((await session.connect(req())).ok).toBe(true)
    const saved = store.getConnection()!
    expect(saved).toMatchObject({ host: '127.0.0.1', username: 'tester', remember: true, hasPassword: true })
    expect(store.getPasswordEnc()!.toString()).toBe('enc:test-pass-123')
    expect(saved.lastConnectedAt).not.toBeNull()
  })

  it('does not keep the password when "remember" is off', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    await trusted(session, { remember: false })
    expect((await session.connect(req({ remember: false }))).ok).toBe(true)
    expect(store.getConnection()!.hasPassword).toBe(false)
  })

  it('reports a rejected password without leaking it', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
    const r = await session.connect(req({ password: 'wrong' }))
    expect(r).toMatchObject({ ok: false, kind: 'auth' })
    expect(JSON.stringify(r)).not.toContain('wrong')
  })

  it('fails with hermes-missing when the Hermes home does not exist', async () => {
    srv = await startFakeSsh({ fixture: fx, hasHome: false })
    const { session, store } = makeSession()
    store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
    const r = await session.connect(req())
    expect(r).toMatchObject({ ok: false, kind: 'hermes-missing' })
    expect(r.ok === false && r.preflight?.items.find((i) => i.id === 'home')?.state).toBe('fail')
  })
})

describe('saved connection (launch)', () => {
  it('reconnects from the keychain without a typed password', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    expect((await a.session.connect(req())).ok).toBe(true)
    await a.session.disconnect()

    const b = makeSession(a.store)
    const r = await b.session.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', remember: true, useSaved: true })
    expect(r.ok).toBe(true)
    expect(b.of<StartupProgress>(IPC.evStartup)[0]!.steps[0]!.label).toBe('password loaded from OS keychain')
  })

  it('refuses to send the saved password to a different host', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    await a.session.connect(req())
    await a.session.disconnect()
    const b = makeSession(a.store)
    const r = await b.session.connect({ host: 'localhost', port: srv.port, username: 'tester', remember: true })
    expect(r).toMatchObject({ ok: false, kind: 'auth' })
  })

  it('goes offline when the host is unreachable at launch and recovers when it returns', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    await a.session.connect(req())
    await a.session.disconnect()
    const port = srv.port
    const hostKey = srv.hostKey
    await srv.close()

    const b = makeSession(a.store)
    const r = await b.session.connect({ host: '127.0.0.1', port, username: 'tester', remember: true, useSaved: true })
    expect(r).toMatchObject({ ok: false, kind: 'unreachable' })
    await waitFor(() => b.of<ConnStatus>(IPC.evStatus).at(-1)?.state === 'offline', { label: 'offline status' })
    expect(b.of<ConnStatus>(IPC.evStatus).at(-1)!.nextRetryInS).toBeGreaterThanOrEqual(1)

    srv = await startFakeSsh({ fixture: fx, port, hostKey })
    await waitFor(() => b.of<ConnStatus>(IPC.evStatus).at(-1)?.state === 'connected', { label: 'recovered', timeout: 15_000 })
    await waitFor(() => b.of<CollectorEvent>(IPC.evEvent).some((e) => e.type === 'agents'), { label: 'agents after recovery', timeout: 15_000 })
  })
})

describe('host key changes', () => {
  it('blocks the connection and reports the previous fingerprint', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const a = makeSession()
    await trusted(a.session)
    await a.session.connect(req())
    await a.session.disconnect()
    const port = srv.port
    const old = srv.fingerprint
    await srv.close()
    srv = await startFakeSsh({ fixture: fx, port })
    const r = await a.session.connect(req())
    expect(r).toMatchObject({ ok: false, kind: 'hostkey-changed' })
    expect(r.ok === false && r.hostKey).toMatchObject({ changed: true, previous: old, fingerprint: srv.fingerprint })
  })
})

describe('resilience', () => {
  it('reconnects after the connection drops and resumes streaming', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, of } = makeSession()
    await trusted(session)
    expect((await session.connect(req())).ok).toBe(true)
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).some((e) => e.type === 'agents'), { label: 'first agents', timeout: 15_000 })
    const before = of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'agents').length

    srv.dropConnections()
    await waitFor(() => of<ConnStatus>(IPC.evStatus).some((s) => s.state === 'reconnecting'), { label: 'reconnecting' })
    await waitFor(() => of<ConnStatus>(IPC.evStatus).at(-1)?.state === 'connected', { label: 'reconnected', timeout: 15_000 })
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'agents').length > before, {
      label: 'agents after reconnect',
      timeout: 15_000
    })
  })
})

describe('zero-change', () => {
  it('leaves the Hermes fixture byte-for-byte untouched after a full session', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, of } = makeSession()
    await trusted(session)
    const before = snapshotTree(fx.root)
    expect((await session.connect(req())).ok).toBe(true)
    await waitFor(() => of<CollectorEvent>(IPC.evEvent).filter((e) => e.type === 'metrics').length >= 2, { label: 'metrics', timeout: 15_000 })
    await session.disconnect()
    expect(snapshotTree(fx.root)).toEqual(before)
  })

  it('never issues a mutating command', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session } = makeSession()
    await trusted(session)
    await session.connect(req())
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar']) expect(verbs.has(bad)).toBe(false)
  })
})

describe('forget', () => {
  it('removes the connection, host key and pins', async () => {
    srv = await startFakeSsh({ fixture: fx })
    const { session, store } = makeSession()
    await trusted(session)
    await session.connect(req())
    await session.forget()
    expect(store.getConnection()).toBeNull()
    expect(store.getKnownHost('127.0.0.1', srv.port)).toBeNull()
    expect(session.getStatus().state).toBe('idle')
  })
})
