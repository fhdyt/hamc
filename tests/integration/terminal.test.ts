import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { ConnectRequest } from '@shared/ipc'
import type { TermData, TermExit } from '@shared/terminal'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-term-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function connected() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const out: Record<string, string> = {}
  const exits: TermExit[] = []
  const logs: string[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => {
      if (channel === IPC.evTermData) {
        const d = payload as TermData
        out[d.id] = (out[d.id] ?? '') + d.data
      }
      if (channel === IPC.evTermExit) exits.push(payload as TermExit)
    },
    log: (m) => logs.push(m),
    backoff: () => 50,
    latencyIntervalMs: 500
  })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  expect((await session.connect(req)).ok).toBe(true)
  return { session, out, exits, logs, manager }
}

describe('terminal', () => {
  it('opens a PTY shell with the asked size and types nothing into it', async () => {
    const { session, out } = await connected()
    const r = await session.termOpen({ cols: 100, rows: 30 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await waitFor(() => (out[r.id] ?? '').includes('tester@fake:~$ '))
    expect(srv.shells.ptys).toEqual([{ term: 'xterm-256color', cols: 100, rows: 30 }])
    // F-TERM-5: opening a shell sends no input at all
    expect(srv.shells.input).toEqual([])
  })

  it('carries keys in and output out, and resizes with window-change', async () => {
    const { session, out } = await connected()
    const r = await session.termOpen({ cols: 80, rows: 24 })
    if (!r.ok) throw new Error('open failed')
    await waitFor(() => (out[r.id] ?? '').includes('$ '))
    expect(session.termWrite(r.id, 'echo hello-term\r')).toBe(true)
    await waitFor(() => (out[r.id] ?? '').includes('hello-term\r\n'))
    session.termResize(r.id, { cols: 132, rows: 40 })
    await waitFor(() => srv.shells.resizes.length === 1)
    expect(srv.shells.resizes[0]).toEqual({ cols: 132, rows: 40 })
    session.termWrite(r.id, 'stty size\r')
    await waitFor(() => (out[r.id] ?? '').includes('40 132'))
  })

  it('keeps several tabs apart and refuses a seventh', async () => {
    const { session, out } = await connected()
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = await session.termOpen({ cols: 80, rows: 24 })
      if (!r.ok) throw new Error('open failed')
      ids.push(r.id)
    }
    expect(await session.termOpen({ cols: 80, rows: 24 })).toEqual({ ok: false, error: 'too-many' })
    session.termWrite(ids[2]!, 'echo third\r')
    await waitFor(() => (out[ids[2]!] ?? '').includes('third\r\n'))
    expect(out[ids[0]!] ?? '').not.toContain('third')
  })

  it('reports exit when the user types exit, and never logs what was typed or printed', async () => {
    const { session, out, exits, logs } = await connected()
    const r = await session.termOpen({ cols: 80, rows: 24 })
    if (!r.ok) throw new Error('open failed')
    session.termWrite(r.id, 'echo secret-words\r')
    await waitFor(() => (out[r.id] ?? '').includes('secret-words\r\n'))
    session.termWrite(r.id, 'exit\r')
    await waitFor(() => exits.length === 1)
    expect(exits[0]).toEqual({ id: r.id, reason: 'exited', code: 0 })
    expect(session.termWrite(r.id, 'x')).toBe(false)
    expect(logs.join('\n')).not.toContain('secret-words')
    expect(logs.some((l) => l.startsWith('terminal opened'))).toBe(true)
  })

  it('closes a tab on request', async () => {
    const { session, exits } = await connected()
    const r = await session.termOpen({ cols: 80, rows: 24 })
    if (!r.ok) throw new Error('open failed')
    session.termClose(r.id)
    await waitFor(() => exits.length === 1)
    expect(exits[0]!.id).toBe(r.id)
    await waitFor(() => srv.shells.running === 0)
  })

  it('ends every shell as disconnected when the connection drops, and refuses to open while offline', async () => {
    const { session, exits } = await connected()
    const a = await session.termOpen({ cols: 80, rows: 24 })
    const b = await session.termOpen({ cols: 80, rows: 24 })
    if (!a.ok || !b.ok) throw new Error('open failed')
    srv.dropConnections()
    await waitFor(() => exits.length === 2)
    expect(exits.map((e) => e.reason)).toEqual(['disconnected', 'disconnected'])
    expect(exits.filter((e) => e.id === a.id)).toHaveLength(1)
    await session.disconnect()
    expect(await session.termOpen({ cols: 80, rows: 24 })).toEqual({ ok: false, error: 'not-connected' })
  })
})
