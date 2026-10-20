import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addRealKanban, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir, waitFor } from '../helpers/wait'

// v2 Kanban writes: every write is one `hermes kanban --board <slug> ...` built by kanbanActionArgs
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
const logs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-kanban-w-'))
  fx = buildFixture(join(dir, 'fx'))
  addRealKanban(fx.root)
  logs.length = 0
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function connected() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({ manager, store, secrets, collectorScript: script, send: () => {}, log: (m) => logs.push(m), backoff: () => 50, latencyIntervalMs: 500 })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  expect((await session.connect(req)).ok).toBe(true)
  // the assignee check needs the profiles of the first agents event
  await waitFor(async () => (await session.kanbanAction({ action: 'assign', board: 'sim-kanban', id: 't_todo1', assignee: 'scout' })).ok, { label: 'agents known', timeout: 15_000 })
  return session
}

const task = async (session: MissionSession, id: string) => {
  const r = await session.kanbanTask({ board: 'sim-kanban', id })
  if (!r.ok) throw new Error(r.error)
  return r.data
}

describe('kanban writes', () => {
  it('creates a task and answers its id; the board lists it', async () => {
    const session = await connected()
    const r = await session.kanbanAction({ action: 'create', board: 'sim-kanban', title: '-Write the digest', body: 'From --three notes', assignee: 'scout', priority: 3 })
    expect(r).toMatchObject({ ok: true, taskId: expect.stringMatching(/^t_[0-9a-f]{8}$/) })
    const id = r.ok ? r.taskId! : ''
    const d = await task(session, id)
    expect(d.task).toMatchObject({ title: '-Write the digest', body: 'From --three notes', assignee: 'scout', priority: 3, status: 'ready', createdBy: 'user' })
    expect(srv.hermes.kanbanCalls.at(-1)).toEqual(['kanban', '--board', 'sim-kanban', 'create', '--json', '--body=From --three notes', '--assignee=scout', '--priority=3', '--', '-Write the digest'])
    expect(logs).toContain('kanban create sim-kanban new exit 0')
  })

  it('assigns, comments, blocks, unblocks, promotes, completes and archives', async () => {
    const session = await connected()
    expect((await task(session, 't_todo1')).task.assignee).toBe('scout')
    expect(await session.kanbanAction({ action: 'assign', board: 'sim-kanban', id: 't_todo1', assignee: 'none' })).toMatchObject({ ok: true })
    expect((await task(session, 't_todo1')).task.assignee).toBeNull()

    expect(await session.kanbanAction({ action: 'comment', board: 'sim-kanban', id: 't_todo1', text: '--please check\nthe numbers' })).toMatchObject({ ok: true })
    expect((await task(session, 't_todo1')).comments.at(-1)).toMatchObject({ author: 'user', body: '--please check\nthe numbers' })

    expect(await session.kanbanAction({ action: 'block', board: 'sim-kanban', id: 't_todo1', reason: 'need the invoice list' })).toMatchObject({ ok: true })
    expect((await task(session, 't_todo1')).task.status).toBe('blocked')
    expect(await session.kanbanAction({ action: 'unblock', board: 'sim-kanban', id: 't_todo1' })).toMatchObject({ ok: true })
    expect((await task(session, 't_todo1')).task.status).toBe('ready')

    expect(await session.kanbanAction({ action: 'complete', board: 'sim-kanban', id: 't_todo1', result: 'Published' })).toMatchObject({ ok: true })
    expect((await task(session, 't_todo1')).task).toMatchObject({ status: 'done', result: 'Published' })
    expect(await session.kanbanAction({ action: 'archive', board: 'sim-kanban', id: 't_todo1' })).toMatchObject({ ok: true })
    expect((await task(session, 't_todo1')).task.status).toBe('archived')
    expect(logs.filter((l) => l.startsWith('kanban ')).every((l) => !l.includes('invoice') && !l.includes('numbers'))).toBe(true)
  })

  it('reports what Hermes refuses: a promote with an open parent', async () => {
    const session = await connected()
    const r = await session.kanbanAction({ action: 'promote', board: 'sim-kanban', id: 't_blk1' })
    expect(r).toMatchObject({ ok: false, error: 'failed', detail: expect.stringMatching(/open parent/) })
  })

  it('refuses an unknown profile and a bad request without running anything', async () => {
    const session = await connected()
    const before = srv.hermes.kanbanCalls.length
    expect(await session.kanbanAction({ action: 'assign', board: 'sim-kanban', id: 't_todo1', assignee: 'ghost' })).toEqual({ ok: false, error: 'unknown-profile' })
    expect(await session.kanbanAction({ action: 'create', board: 'sim-kanban', title: 'x', assignee: 'ghost' })).toEqual({ ok: false, error: 'unknown-profile' })
    expect(await session.kanbanAction({ action: 'archive', board: 'Bad Board', id: 't_todo1' })).toEqual({ ok: false, error: 'bad-input' })
    expect(srv.hermes.kanbanCalls.length).toBe(before)
  })
})
