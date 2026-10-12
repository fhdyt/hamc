import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectRequest } from '@shared/ipc'
import { sha256 } from '../../src/main/agentcfg/files'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
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
let session: MissionSession

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-as-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  session = new MissionSession({ manager, store, secrets, collectorScript: script, send: () => {}, backoff: () => 50, latencyIntervalMs: 500 })
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: false }
  expect((await session.connect(req)).ok).toBe(true)
})
afterEach(async () => {
  await session.disconnect()
  await srv.close()
  removeDir(dir)
})

describe('agent settings through the session', () => {
  it('reads and writes a file; the only change on the server is that file', async () => {
    const before = snapshotTree(fx.home)
    const r = await session.agentReadFile('default', 'memory')
    expect(r.ok && r.file.text).toBe('m\n')
    expect(snapshotTree(fx.home)).toEqual(before) // reading changes nothing

    const w = await session.agentWriteFile('default', 'memory', 'm\n§\nnew\n', sha256('m\n'))
    expect(w.ok).toBe(true)
    const after = snapshotTree(fx.home)
    const changed = Object.keys(after).filter((k) => after[k] !== before[k] && !k.endsWith('state.db'))
    expect(changed).toEqual([join('memories', 'MEMORY.md')])
    expect(readFileSync(join(fx.home, 'memories', 'MEMORY.md'), 'utf8')).toBe('m\n§\nnew\n')
  })

  it('never reads .env or auth.json', async () => {
    const mark = srv.execLog.length // the preflight only checks that .env exists (test -e), it never reads it
    await session.agentReadFile('default', 'soul')
    await session.agentReadModel('default')
    await session.agentWriteFile('default', 'user', 'u2\n', sha256('u\n'))
    const touched = JSON.stringify([srv.execLog.slice(mark), srv.sftpLog])
    expect(touched).not.toContain('.env')
    expect(touched).not.toContain('auth.json')
  })

  it('saves a model with only config set commands and reads it back', async () => {
    const r = await session.agentSaveModel({ profile: 'scout', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-x', writeBaseUrl: false, apiKey: 'sk-ant-secret-12345' })
    expect(r).toMatchObject({ ok: true, state: { provider: 'anthropic', model: 'claude-x' } })
    const hermesCalls = srv.execLog.filter((a) => a[0]?.endsWith('/hermes') && a.includes('set')).map((a) => a.join(' '))
    expect(hermesCalls.length).toBeGreaterThan(0)
    expect(hermesCalls.join('\n')).not.toContain('sk-ant-secret-12345')
    expect(hermesCalls.join('\n')).not.toMatch(/--yolo/)
    expect(srv.hermes.env.get('scout')).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-secret-12345' })
  })

  it('is not-connected after a disconnect', async () => {
    await session.disconnect()
    expect(await session.agentReadFile('default', 'soul')).toEqual({ ok: false, error: 'not-connected' })
    expect(await session.agentReadModel('default')).toEqual({ ok: false, error: 'not-connected' })
  })
})
