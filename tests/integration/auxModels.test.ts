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
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

// v2 auxiliary models and the model catalog over a real session against the fake server
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
  dir = mkdtempSync(join(tmpdir(), 'mc-aux-'))
  fx = buildFixture(join(dir, 'fx'))
  logs.length = 0
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})

async function connected(fetchUrl?: () => Promise<string>) {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({ manager, store, secrets, collectorScript: script, send: () => {}, log: (m) => logs.push(m), backoff: () => 50, latencyIntervalMs: 500, ...(fetchUrl ? { fetchUrl } : {}) })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  expect((await session.connect(req)).ok).toBe(true)
  return session
}

describe('auxiliary models', () => {
  it('reads every slot as auto, saves one through config set and reads it back', async () => {
    const session = await connected()
    const first = await session.agentAuxRead('scout')
    expect(first.ok && first.slots.vision).toEqual({ provider: 'auto', model: '', baseUrl: '', hasKey: false })
    const r = await session.agentAuxSave({ profile: 'scout', changes: [{ task: 'vision', choice: { kind: 'model', provider: 'openrouter', model: 'google/gemini-2.5-flash' } }] })
    expect(r).toMatchObject({ ok: true, slots: { vision: { provider: 'openrouter', model: 'google/gemini-2.5-flash', baseUrl: '' } } })
    expect(srv.hermes.config.get('scout')).toMatchObject({ 'auxiliary.vision.provider': 'openrouter', 'auxiliary.vision.model': 'google/gemini-2.5-flash', 'auxiliary.vision.base_url': '' })
    expect(logs).toContain('aux: config set auxiliary.vision.provider openrouter')
    const back = await session.agentAuxSave({ profile: 'scout', changes: [{ task: 'vision', choice: { kind: 'auto' } }] })
    expect(back.ok && back.slots?.vision).toEqual({ provider: 'auto', model: '', baseUrl: '', hasKey: false })
  })

  it('refuses a bad provider before running anything', async () => {
    const session = await connected()
    const r = await session.agentAuxSave({ profile: 'default', changes: [{ task: 'vision', choice: { kind: 'model', provider: '-x', model: 'm' } }] })
    expect(r).toMatchObject({ ok: false, error: 'bad-request' })
    expect(srv.hermes.config.get('default')?.['auxiliary.vision.provider']).toBeUndefined()
  })
})

describe('model catalog', () => {
  it('falls back to the public manifest when the server has no cache', async () => {
    const session = await connected(async () => JSON.stringify({ version: 1, providers: { openrouter: { models: [{ id: 'z/m', default: true }] } } }))
    expect(await session.agentCatalog('default')).toEqual({ ok: true, source: 'public', updatedAt: null, providers: { openrouter: { models: [{ id: 'z/m', description: '', default: true }] } } })
  })
})
