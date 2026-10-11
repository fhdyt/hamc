import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { BrainData, CollectorEvent } from '@shared/events'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addNote, buildFixture, removeNote, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { waitFor, removeDir } from '../helpers/wait'

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
  dir = mkdtempSync(join(tmpdir(), 'mc-brain-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

const vaultDir = (): string => join(fx.root, 'home', 'vault')

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
  const brain = (): BrainData[] => events.flatMap((e) => (e.type === 'brain' ? [e.data] : []))
  const noteIds = (): string[] => brain().flatMap((b) => b.notes.map((n) => n.id))
  return { session, req, events, brain, noteIds, store }
}

describe('the vault stream over the session', () => {
  it('stays silent until a vault path is saved', async () => {
    const { session, req, brain } = await setup()
    expect((await session.connect(req)).ok).toBe(true)
    expect(session.brainGet()).toEqual({ vault: null })
    await new Promise((r) => setTimeout(r, 1200))
    expect(brain()).toEqual([])
  })

  it('sends a snapshot of the vault once the path is saved', async () => {
    const { session, req, brain } = await setup()
    await session.connect(req)
    session.brainSetVault(vaultDir())
    await waitFor(() => brain().some((b) => b.done), { label: 'snapshot', timeout: 15_000 })
    const snap = brain().filter((b) => b.mode === 'snapshot')
    expect(snap[0]).toMatchObject({ first: true, done: true, total: 6, truncated: false })
    expect(snap.flatMap((b) => b.notes.map((n) => n.id)).sort()).toEqual(['Alpha.md', 'Beta.md', 'Index.md', 'Orphan.md', 'folder/Alpha.md', 'folder/Gamma.md'])
    expect(session.brainGet()).toEqual({ vault: vaultDir() })
  })

  it('sends a delta within a poll or two when a note is added, changed and removed', async () => {
    const { session, req, brain } = await setup()
    await session.connect(req)
    session.brainSetVault(vaultDir())
    await waitFor(() => brain().some((b) => b.done), { label: 'snapshot', timeout: 15_000 })

    const t0 = Date.now()
    addNote(vaultDir(), 'Fresh.md', 'new [[Index]]')
    await waitFor(() => brain().some((b) => b.mode === 'delta' && b.notes.some((n) => n.id === 'Fresh.md')), { label: 'added', timeout: 8000, interval: 100 })
    expect(Date.now() - t0).toBeLessThan(5000)

    addNote(vaultDir(), 'Orphan.md', 'now links to [[Fresh]] and is longer')
    await waitFor(() => brain().some((b) => b.mode === 'delta' && b.notes.some((n) => n.id === 'Orphan.md' && n.links.includes('Fresh.md'))), { label: 'changed', timeout: 8000, interval: 100 })

    removeNote(vaultDir(), 'Fresh.md')
    await waitFor(() => brain().some((b) => b.mode === 'delta' && b.removed.includes('Fresh.md')), { label: 'removed', timeout: 8000, interval: 100 })
  })

  it('starts again after a reconnect, and a different path restarts the stream', async () => {
    const { session, req, brain } = await setup()
    await session.connect(req)
    session.brainSetVault(vaultDir())
    await waitFor(() => brain().filter((b) => b.mode === 'snapshot' && b.first).length >= 1, { label: 'first snapshot', timeout: 15_000 })

    await session.disconnect()
    await session.connect({ ...req, password: 'test-pass-123' })
    await waitFor(() => brain().filter((b) => b.mode === 'snapshot' && b.first).length >= 2, { label: 'snapshot after reconnect', timeout: 15_000 })

    addNote(join(fx.root, 'home', 'vault2'), 'Solo.md', 'alone')
    session.brainSetVault(join(fx.root, 'home', 'vault2'))
    await waitFor(() => brain().some((b) => b.mode === 'snapshot' && b.notes.some((n) => n.id === 'Solo.md')), { label: 'second vault', timeout: 15_000 })
  })

  it('stops when the path is cleared', async () => {
    const { session, req, brain, noteIds } = await setup()
    await session.connect(req)
    session.brainSetVault(vaultDir())
    await waitFor(() => brain().some((b) => b.done), { label: 'snapshot', timeout: 15_000 })
    session.brainSetVault(null)
    expect(session.brainGet()).toEqual({ vault: null })
    addNote(vaultDir(), 'AfterStop.md', 'x')
    await new Promise((r) => setTimeout(r, 4500))
    expect(noteIds()).not.toContain('AfterStop.md')
  })

  it('reports a vault that does not exist', async () => {
    const { session, req, events } = await setup()
    await session.connect(req)
    session.brainSetVault(join(fx.root, 'home', 'nowhere'))
    await waitFor(() => events.some((e) => e.type === 'error' && e.data.code === 'vault_unreadable'), { label: 'error', timeout: 15_000 })
  })
})

describe('vault queries over the session', () => {
  it('validates a path and browses folders', async () => {
    const { session, req } = await setup()
    await session.connect(req)
    const ok = await session.brainValidate(vaultDir())
    expect(ok).toEqual({ ok: true, data: { path: vaultDir(), exists: true, readable: true, notes: 6, truncated: false } })
    const missing = await session.brainValidate(join(fx.root, 'nope'))
    expect(missing.ok && missing.data).toMatchObject({ exists: false, notes: 0 })
    const b = await session.brainBrowse(vaultDir())
    expect(b.ok && b.data.dirs).toEqual([{ name: 'folder', notes: 2 }])
    expect(await session.brainBrowse(join(fx.root, 'nope'))).toEqual({ ok: false, error: 'not_found' })
  })

  it('reads a note from the saved vault only', async () => {
    const { session, req } = await setup()
    await session.connect(req)
    expect(await session.brainNote('Index.md')).toEqual({ ok: false, error: 'not_found' })
    session.brainSetVault(vaultDir())
    const r = await session.brainNote('Index.md')
    expect(r.ok && r.data.text).toContain('Start with [[Alpha]]')
    expect(await session.brainNote('../../etc/passwd.md')).toEqual({ ok: false, error: 'bad_args' })
    expect(await session.brainNote('/etc/passwd.md')).toEqual({ ok: false, error: 'bad_args' })
    expect(await session.brainNote('Missing.md')).toEqual({ ok: false, error: 'not_found' })
  })

  it('reports not-connected before connecting', async () => {
    const { session } = await setup()
    expect(await session.brainValidate('/x')).toEqual({ ok: false, error: 'not-connected' })
    expect(await session.brainBrowse('/x')).toEqual({ ok: false, error: 'not-connected' })
  })
})

describe('the vault and the Zero-Change rule', () => {
  it('only issues read-only commands and leaves everything untouched', async () => {
    const { session, req, brain } = await setup()
    const before = snapshotTree(fx.root)
    await session.connect(req)
    session.brainSetVault(vaultDir())
    await waitFor(() => brain().some((b) => b.done), { label: 'snapshot', timeout: 15_000 })
    await session.brainValidate(vaultDir())
    await session.brainBrowse(vaultDir())
    await session.brainNote('Index.md')
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})
