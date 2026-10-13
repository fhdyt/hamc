import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, pythonExe, snapshotTree, type FixtureDirs } from '../helpers/fixture'
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
  dir = mkdtempSync(join(tmpdir(), 'mc-ops-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  removeDir(dir)
})
afterAll(() => undefined)

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
    saveDialog: async () => ({ canceled: false, filePath: join(dir, 'backup.zip') }),
    latencyIntervalMs: 500
  })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  return { session, req, events }
}



async function connected() {
  const s = await setup()
  expect((await s.session.connect(s.req)).ok).toBe(true)
  return s
}

describe('agent management over the session', () => {
  it('reads MCP servers, fallback chain and toolsets, and leaves the fixture untouched', async () => {
    const { session } = await connected()
    const before = snapshotTree(fx.root)
    const mcp = await session.mcpList('default')
    expect(mcp.ok && mcp.text).toContain('github')
    expect(mcp.ok && mcp.text).not.toContain('\u001b[')
    const fb = await session.fallbackList('scout')
    expect(fb.ok && fb.text).toContain('Fallback chain (2 entries)')
    const tools = await session.toolsList('default', ['cli', 'telegram'])
    expect(tools['cli']!.ok && tools['cli']!.text).toContain('✓ enabled  web')
    expect(snapshotTree(fx.root)).toEqual(before)
    expect(srv.hermes.opsCalls).toEqual(
      expect.arrayContaining([['mcp', 'list'], ['-p', 'scout', 'fallback', 'list'], ['tools', 'list', '--platform', 'cli'], ['tools', 'list', '--platform', 'telegram']])
    )
  })

  it('tests one MCP server and applies toolset changes command by command', async () => {
    const { session } = await connected()
    expect(await session.mcpTest('default', 'github')).toMatchObject({ ok: true })
    expect(await session.mcpTest('default', 'broken')).toMatchObject({ ok: false, error: 'failed' })
    const res = await session.toolsApply('default', [
      { toolset: 'browser', platform: 'cli', enable: true },
      { toolset: 'memory', platform: 'telegram', enable: false }
    ])
    expect(res).toEqual({
      ok: true,
      results: [
        { command: '$ hermes tools disable memory --platform telegram', ok: true, output: '✓ Disabled: memory' },
        { command: '$ hermes tools enable browser --platform cli', ok: true, output: '✓ Enabled: browser' }
      ]
    })
    const after = await session.toolsList('default', ['cli'])
    expect(after['cli']!.ok && after['cli']!.text).toContain('✓ enabled  browser')
  })

  it('creates a profile without a wrapper script, and the collector reports the new agent', async () => {
    const { session, events } = await connected()
    const r = await session.profileCreate({ name: 'research-bot', description: 'Reads papers', noSkills: true, alias: false })
    expect(r).toMatchObject({ ok: true })
    expect(srv.hermes.opsCalls).toContainEqual(['profile', 'create', 'research-bot', '--description=Reads papers', '--no-skills', '--no-alias'])
    expect(await session.profileCreate({ name: 'taken', noSkills: false, alias: false })).toMatchObject({ ok: false, error: 'failed' })
    await waitFor(
      () => events.some((e) => e.type === 'agents' && e.data.agents.some((a) => a.profile === 'research-bot')),
      { label: 'new agent', timeout: 20_000 }
    )
  })

  it('backs a profile up into a local zip without .env, auth.json or raw secrets', async () => {
    const { session } = await connected()
    const r = await session.agentBackup({ profile: 'default', includeStateDb: false }, null)
    if (!('saved' in r)) throw new Error(JSON.stringify(r))
    const py = spawnSync(pythonExe, ['-c', 'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); print(json.dumps({n: z.read(n).decode("utf-8", "replace") for n in z.namelist()}))', r.saved], { encoding: 'utf8' })
    const zip = JSON.parse(py.stdout) as Record<string, string>
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['README.txt', 'SOUL.md', 'config.yaml', 'memories/MEMORY.md', 'memories/USER.md', 'cron/jobs.json', 'skills/research/arxiv-digest/SKILL.md']))
    expect(Object.keys(zip).some((n) => n.endsWith('.env') || n.endsWith('auth.json') || n === 'state.db')).toBe(false)
    expect(JSON.stringify(zip)).not.toContain('SECRET_SENTINEL')
  })
})
