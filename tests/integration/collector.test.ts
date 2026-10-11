import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CollectorEvent } from '@shared/events'
import { CollectorChannel, loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { waitFor, removeDir } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
let m: ConnectionManager

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-col-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
  m = new ConnectionManager({ getKnownHost: () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint }) }, 5000)
  await m.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
})
afterAll(async () => {
  await m.disconnect()
  await srv.close()
  removeDir(dir)
})

describe('CollectorChannel', () => {
  it('streams agents then metrics from the real collector', async () => {
    const script = loadCollectorScript('collector/mc_collector.py')
    expect(script).not.toContain('\r')
    const ch = new CollectorChannel(m, { python: '/usr/bin/python3', home: '/home/hermes/.hermes', script })
    const events: CollectorEvent[] = []
    ch.on('event', (e: CollectorEvent) => events.push(e))
    await ch.start()
    await waitFor(() => events.some((e) => e.type === 'agents') && events.filter((e) => e.type === 'metrics').length >= 2, {
      label: 'agents + 2 metrics',
      timeout: 15_000
    })
    const agents = events.find((e) => e.type === 'agents')!
    expect(agents.type === 'agents' && agents.data.agents.map((a) => a.profile).sort()).toEqual(['atlas', 'default', 'scout'])
    ch.stop()
  })

  it('emits closed when the stream ends', async () => {
    const ch = new CollectorChannel(m, { python: '/usr/bin/python3', home: '/home/hermes/.hermes', script: loadCollectorScript('collector/mc_collector.py') })
    let closed = false
    ch.on('closed', () => (closed = true))
    await ch.start()
    ch.stop()
    await waitFor(() => closed, { label: 'closed' })
  })
})
