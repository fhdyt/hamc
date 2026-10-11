import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConnectionManager } from '../../src/main/connection/manager'
import { ConnectError, HostKeyError } from '../../src/main/connection/errors'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { waitFor, removeDir } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const managers: ConnectionManager[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-conn-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disconnect()))
})
afterAll(async () => {
  await srv.close()
  removeDir(dir)
})

const creds = (over = {}) => ({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', ...over })
function manager(known: { algo: string; fingerprint: string } | null): ConnectionManager {
  const m = new ConnectionManager({ getKnownHost: () => known }, 5000)
  managers.push(m)
  return m
}
const trusted = () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint })

describe('host key verification', () => {
  it('asks to verify an unknown host and does not log in', async () => {
    const err = await manager(null).connect(creds()).catch((e) => e)
    expect(err).toBeInstanceOf(HostKeyError)
    expect(err.challenge).toMatchObject({ changed: false, algo: 'ssh-ed25519', fingerprint: srv.fingerprint })
    expect(srv.execLog.length).toBe(0)
  })

  it('connects when the stored key matches', async () => {
    const m = manager(trusted())
    const hs = await m.connect(creds())
    expect(hs.fingerprint).toBe(srv.fingerprint)
    expect(m.isConnected()).toBe(true)
  })

  it('blocks when the key changed and reports the previous fingerprint', async () => {
    const err = await manager({ algo: 'ssh-ed25519', fingerprint: 'SHA256:old' }).connect(creds()).catch((e) => e)
    expect(err).toBeInstanceOf(HostKeyError)
    expect(err.challenge).toMatchObject({ changed: true, previous: 'SHA256:old' })
  })
})

describe('connect errors', () => {
  it('reports a rejected password', async () => {
    const err = await manager(trusted()).connect(creds({ password: 'wrong' })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectError)
    expect(err.kind).toBe('auth')
  })

  it('reports an unreachable port', async () => {
    const dead = await startFakeSsh({ fixture: fx })
    const port = dead.port
    await dead.close()
    const err = await manager(trusted()).connect(creds({ port })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectError)
    expect(err.kind).toBe('unreachable')
  })
})

describe('exec', () => {
  it('passes hostile arguments through untouched', async () => {
    const m = manager(trusted())
    await m.connect(creds())
    const argv = ['it\'s "q"', '$(id)', 'a;b', '', 'ünï']
    const r = await m.exec(['__echo__', ...argv])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(argv)
  })

  it('returns the exit code and stderr of a failing command', async () => {
    const m = manager(trusted())
    await m.connect(creds())
    const r = await m.exec(['nope'])
    expect(r.code).toBe(127)
    expect(r.stderr).toContain('not found')
  })

  it('measures latency', async () => {
    const m = manager(trusted())
    await m.connect(creds())
    expect(await m.measureLatency()).toBeGreaterThanOrEqual(0)
  })

  it('rejects exec when not connected', async () => {
    await expect(manager(null).exec(['true'])).rejects.toThrow(/not connected/)
  })
})

describe('close events', () => {
  it('emits close when the server drops the connection', async () => {
    const m = manager(trusted())
    await m.connect(creds())
    let closed = 0
    m.on('close', () => closed++)
    srv.dropConnections()
    await waitFor(() => closed === 1, { label: 'close event' })
    expect(m.isConnected()).toBe(false)
  })

  it('does not emit close after a deliberate disconnect', async () => {
    const m = manager(trusted())
    await m.connect(creds())
    let closed = 0
    m.on('close', () => closed++)
    await m.disconnect()
    await new Promise((r) => setTimeout(r, 150))
    expect(closed).toBe(0)
  })
})
