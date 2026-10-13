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
const live: MissionSession[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-skills-'))
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

const names = async (session: MissionSession) => {
  const r = await session.skillsList({ profiles: ['default'] })
  if (!r.ok) throw new Error('list failed')
  return Object.fromEntries(r.data.skills.map((s) => [s.name, s]))
}

describe('skills over the session', () => {
  it('lists, reads, and reads the ledger and its blobs', async () => {
    const { session } = await connected()
    const by = await names(session)
    expect(by['arxiv-digest']).toMatchObject({ origin: 'agent', state: 'active', useCount: 14 })
    expect(by['notion']).toMatchObject({ origin: 'bundled', envNames: ['NOTION_API_KEY'] })
    const md = await session.skillRead({ profile: 'default', path: 'productivity/notion' })
    expect(md).toMatchObject({ ok: true, data: { truncated: false } })
    const led = await session.skillsLedger({ profile: 'default', limit: 50 })
    if (!led.ok) throw new Error('ledger failed')
    const f = led.data.entries.find((e) => e.action === 'patch')!.files[0]!
    const blobs = await session.skillsBlobs({ profile: 'default', shas: [f.before!, f.after!] })
    expect(blobs.ok && blobs.data.blobs.map((b) => ('text' in b ? b.text.includes('cs.CL') : false))).toEqual([true, true])
  })

  it('pins, archives and restores through the curator, and the list follows', async () => {
    const { session } = await connected()
    expect(await session.skillAction({ action: 'pin', profile: 'default', name: 'arxiv-digest' })).toEqual({ ok: true, output: "Pinned 'arxiv-digest'." })
    expect((await names(session))['arxiv-digest']!.pinned).toBe(true)
    expect(await session.skillAction({ action: 'archive', profile: 'default', name: 'old-scraper' })).toMatchObject({ ok: true })
    expect((await names(session))['old-scraper']).toMatchObject({ state: 'archived', path: '.archive/old-scraper' })
    expect(await session.skillAction({ action: 'restore', profile: 'default', name: 'retired' })).toMatchObject({ ok: true })
    expect((await names(session))['retired']).toMatchObject({ state: 'active', path: 'retired' })
    expect(srv.hermes.skillCalls).toEqual([
      ['curator', 'pin', 'arxiv-digest'],
      ['curator', 'archive', 'old-scraper'],
      ['curator', 'restore', 'retired']
    ])
  })

  it('inspects and installs from the hub with --yes; a blocked scan is reported as Hermes wrote it', async () => {
    const { session } = await connected()
    const ins = await session.skillInspect('default', 'official/web/scraper')
    expect(ins.ok && ins.text).toContain('Identifier: official/web/scraper')
    expect(await session.skillAction({ action: 'install', profile: 'default', id: 'official/web/scraper', category: 'web' })).toMatchObject({ ok: true })
    expect((await names(session))['scraper']).toMatchObject({ origin: 'hub', category: 'web' })
    const bad = await session.skillAction({ action: 'install', profile: 'default', id: 'evil/blocked-skill' })
    expect(bad).toEqual({ ok: false, error: 'failed', detail: "Not installed: the security scan blocked 'blocked-skill' (2 findings)." })
    expect(srv.hermes.skillCalls).toContainEqual(['skills', 'install', 'official/web/scraper', '--category', 'web', '--yes'])
    const st = await session.curatorStatus('default')
    expect(st.ok && st.text).toContain('Curator: enabled')
  })

  it('leaves the fixture untouched while only reading', async () => {
    const { session } = await connected()
    const before = snapshotTree(fx.root)
    await names(session)
    await session.skillRead({ profile: 'default', path: 'research/arxiv-digest' })
    await session.skillsLedger({ profile: 'default', limit: 10 })
    await session.disconnect()
    expect(snapshotTree(fx.root)).toEqual(before)
    expect(srv.hermes.skillCalls).toEqual([])
  })
})
