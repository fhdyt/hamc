import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { probeCapabilities } from '../../src/main/connection/capabilities'
import { ConnectionManager } from '../../src/main/connection/manager'
import { runPreflight } from '../../src/main/connection/preflight'
import { startFakeSsh, type FakeSsh, type FakeSshOptions } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'

let dir: string
let fx: FixtureDirs
const servers: FakeSsh[] = []
const managers: ConnectionManager[] = []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-pre-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disconnect()))
  await Promise.all(servers.splice(0).map((s) => s.close()))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function connect(over: Partial<FakeSshOptions> = {}): Promise<{ m: ConnectionManager; srv: FakeSsh }> {
  const srv = await startFakeSsh({ fixture: fx, ...over })
  servers.push(srv)
  const m = new ConnectionManager({ getKnownHost: () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint }) }, 5000)
  managers.push(m)
  await m.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
  return { m, srv }
}
const ctx = (srv: FakeSsh) => ({ host: '127.0.0.1', port: srv.port, username: 'tester', latencyMs: 12, fingerprint: srv.fingerprint })
const item = (r: Awaited<ReturnType<typeof runPreflight>>, id: string) => r.items.find((i) => i.id === id)!

describe('runPreflight', () => {
  it('passes on a healthy install and lists items in the mockup order', async () => {
    const { m, srv } = await connect()
    const r = await runPreflight(m, ctx(srv))
    expect(r.items.map((i) => i.id)).toEqual(['ssh', 'hostkey', 'home', 'version', 'profiles', 'statedb', 'cli', 'python', 'zero'])
    expect(r.canStart).toBe(true)
    expect(r.hermesHome).toBe('/home/hermes/.hermes')
    expect(r.hermesPath).toBe('/home/hermes/.local/bin/hermes')
    expect(r.pythonPath).toBe('/usr/bin/python3')
    expect(r.version).toBe('0.21.6')
    expect(r.profileCount).toBe(3)
    expect(item(r, 'version')).toMatchObject({ state: 'ok', result: 'v0.21.6' })
    expect(item(r, 'statedb')).toMatchObject({ state: 'ok', result: 'schema 31 OK' })
    expect(item(r, 'python')).toMatchObject({ state: 'ok', result: '3.11.9' })
    expect(item(r, 'ssh').result).toBe('OK 12ms')
    expect(item(r, 'zero').state).toBe('info')
    expect(r.items.filter((i) => i.state === 'fail')).toEqual([])
  })

  it('warns on a Hermes older than the supported minimum', async () => {
    const { m, srv } = await connect({ version: '0.20.1' })
    const r = await runPreflight(m, ctx(srv))
    expect(item(r, 'version').state).toBe('warn')
    expect(item(r, 'version').hint).toMatch(/0\.21\.0/)
    expect(r.canStart).toBe(true)
  })

  it('keeps running without the hermes CLI but flags it red', async () => {
    const { m, srv } = await connect({ hasHermes: false })
    const r = await runPreflight(m, ctx(srv))
    expect(item(r, 'cli').state).toBe('fail')
    expect(item(r, 'version').state).toBe('fail')
    expect(r.hermesPath).toBeNull()
    expect(r.canStart).toBe(true)
  })

  it('cannot start when the Hermes home is missing', async () => {
    const { m, srv } = await connect({ hasHome: false })
    const r = await runPreflight(m, ctx(srv))
    expect(item(r, 'home')).toMatchObject({ state: 'fail', result: 'NOT FOUND' })
    expect(r.canStart).toBe(false)
  })

  it('never writes anything to the remote side', async () => {
    const { m, srv } = await connect()
    await runPreflight(m, ctx(srv))
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget']) expect(verbs.has(bad)).toBe(false)
  })
})

describe('probeCapabilities', () => {
  it('records which subcommands exist', async () => {
    const { m } = await connect({ capabilities: { 'cron runs': false } })
    const caps = await probeCapabilities(m, '/home/hermes/.local/bin/hermes', '0.21.6')
    expect(caps.version).toBe('0.21.6')
    expect(caps.supported['cron runs']).toBe(false)
    expect(caps.supported['mcp list']).toBe(true)
    expect(Object.keys(caps.supported).sort()).toEqual(
      ['approvals suggest', 'cron incidents', 'cron runs', 'curator status', 'fallback list', 'mcp list', 'sessions list', 'tools --summary'].sort()
    )
  })

  it('marks everything unsupported without a hermes CLI', async () => {
    const { m } = await connect()
    const caps = await probeCapabilities(m, null, null)
    expect(Object.values(caps.supported).every((v) => v === false)).toBe(true)
  })
})
