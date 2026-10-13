import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addRealKanban, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

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
  dir = mkdtempSync(join(tmpdir(), 'mc-kanban-'))
  fx = buildFixture(join(dir, 'fx'))
  addRealKanban(fx.root)
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function setup() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel) => void (channel === IPC.evEvent),
    notify: () => undefined,
    backoff: () => 50,
    latencyIntervalMs: 500
  })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  return { session, req }
}

describe('kanban over the session', () => {
  it('lists boards, the tasks of a board and one task, and writes nothing on the server', async () => {
    const { session, req } = await setup()
    expect((await session.connect(req)).ok).toBe(true)

    const boards = await session.kanbanBoards()
    expect(boards).toMatchObject({ ok: true })
    if (!boards.ok) return
    expect(boards.data.boards.map((b) => b.slug)).toEqual(['default', 'sim-kanban'])

    const tasks = await session.kanbanTasks({ board: 'sim-kanban' })
    expect(tasks.ok && tasks.data.tasks.length).toBe(8)
    expect(tasks.ok && tasks.data.archived).toBe(1)

    const one = await session.kanbanTask({ board: 'sim-kanban', id: 't_run1' })
    expect(one).toMatchObject({ ok: true, data: { task: { sessionId: 's-scout-1' } } })
    expect(one.ok && one.data.comments.map((c) => c.body)).toEqual(['Please keep it under 120 words.', 'On it.'])

    expect(await session.kanbanTask({ board: 'sim-kanban', id: 'nope' })).toEqual({ ok: false, error: 'not_found' })
    expect(await session.kanbanTasks({ board: 'ghost' })).toEqual({ ok: false, error: 'not_found' })

    // Zero-Change: kanban reads never run a write tool or a state-changing hermes verb
    const writes = ['sudo', 'rm', 'mv', 'cp', 'touch', 'tee', 'chmod', 'set', 'restart', 'pin', 'unpin', 'rename', 'create', 'complete', 'block']
    expect(srv.execLog.filter((argv) => argv.some((x) => writes.includes(x)))).toEqual([])
  })
})
