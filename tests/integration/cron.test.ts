import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import type { CollectorEvent, CronData } from '@shared/events'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import type { CronAlert } from '../../src/main/cron/watcher'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { waitFor } from '../helpers/wait'

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
  dir = mkdtempSync(join(tmpdir(), 'mc-cron-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
  rmSync(dir, { recursive: true, force: true })
})
afterAll(() => undefined)

async function setup() {
  srv = await startFakeSsh({ fixture: fx })
  const store = new SettingsStore(':memory:')
  const events: CollectorEvent[] = []
  const alerts: CronAlert[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: (channel, payload) => {
      if (channel === IPC.evEvent) events.push(payload as CollectorEvent)
    },
    notify: (a) => alerts.push(a),
    backoff: () => 50,
    latencyIntervalMs: 500
  })
  live.push(session)
  const req: ConnectRequest = { host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123', remember: true }
  store.trustHost('127.0.0.1', srv.port, 'ssh-ed25519', srv.fingerprint)
  const cronEvents = (): CronData[] => events.flatMap((e) => (e.type === 'cron' ? [e.data] : []))
  return { session, req, events, alerts, cronEvents }
}

function failTheDefaultJob(): void {
  const path = join(fx.home, 'cron', 'jobs.json')
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { jobs: Record<string, unknown>[] }
  doc.jobs[0]!['last_run_at'] = new Date().toISOString()
  doc.jobs[0]!['last_status'] = 'error'
  doc.jobs[0]!['last_error'] = 'second failure'
  writeFileSync(path, JSON.stringify(doc))
}

describe('cron over the session', () => {
  it('publishes every job of every profile', async () => {
    const { session, req, cronEvents } = await setup()
    expect((await session.connect(req)).ok).toBe(true)
    const first = await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })
    expect(first.jobs.map((j) => j.name).sort()).toEqual(['Pantau pembaruan', 'never-ran', 'second-brain-daily-sync'])
    expect(first.jobs.find((j) => j.name === 'second-brain-daily-sync')).toMatchObject({ profile: 'default', lastStatus: 'error', failureStreak: 10 })
    expect(first.profiles.map((p) => p.profile).sort()).toEqual(['atlas', 'default', 'scout'])
  })

  it('reads the latest output of a job and nothing it was not told about', async () => {
    const { session, req, cronEvents } = await setup()
    expect(await session.cronOutput('default', '09358c101c91')).toEqual({ ok: false, reason: 'not-connected' })
    await session.connect(req)
    await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })

    const out = await session.cronOutput('default', '09358c101c91')
    expect(out).toMatchObject({ ok: true, text: 'latest run\nline two\n', truncated: false, name: '2026-10-10_23-00-25.md' })
    expect(await session.cronOutput('scout', 'bbbbbbbbbbbb')).toMatchObject({ ok: true, text: 'legacy loose file\n' })
    expect(await session.cronOutput('scout', 'aaaaaaaaaaaa')).toEqual({ ok: false, reason: 'no-output' })
    expect(await session.cronOutput('scout', 'does-not-exist')).toEqual({ ok: false, reason: 'not-found' })
    expect(await session.cronOutput('../x', '09358c101c91')).toEqual({ ok: false, reason: 'not-found' })

    const heads = srv.execLog.filter((a) => a[0] === 'head' && a[1] === '-c')
    expect(heads.map((a) => a[3])).toEqual([
      '/home/hermes/.hermes/cron/output/09358c101c91/2026-10-10_23-00-25.md',
      '/home/hermes/.hermes/profiles/scout/cron/output/bbbbbbbbbbbb_20260920_190257.txt'
    ])
  })

  it('stays quiet about a job that was already failing when the app connected', async () => {
    const { session, req, cronEvents, alerts } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents().length >= 1, { label: 'cron event', timeout: 15_000 })
    await new Promise((r) => setTimeout(r, 2000))
    expect(alerts).toEqual([])
  })

  it('notifies exactly once when a run fails after the baseline', async () => {
    const { session, req, cronEvents, alerts } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents().length >= 1, { label: 'baseline', timeout: 15_000 })
    failTheDefaultJob()
    await waitFor(() => alerts.length >= 1, { label: 'alert', timeout: 15_000 })
    await new Promise((r) => setTimeout(r, 2000))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ profile: 'default', jobId: '09358c101c91', lastStatus: 'error', lastError: 'second failure' })
  })

  it('does not repeat old errors after a reconnect', async () => {
    const { session, req, cronEvents, alerts } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents().length >= 1, { label: 'baseline', timeout: 15_000 })
    const before = cronEvents().length
    srv.dropConnections()
    await waitFor(() => cronEvents().length > before, { label: 'cron event after reconnect', timeout: 20_000 })
    await new Promise((r) => setTimeout(r, 1500))
    expect(alerts).toEqual([])
  })

  it('reports a failure that happened while the connection was down', async () => {
    const { session, req, cronEvents, alerts } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents().length >= 1, { label: 'baseline', timeout: 15_000 })
    const before = cronEvents().length
    failTheDefaultJob()
    srv.dropConnections()
    await waitFor(() => alerts.length >= 1 || cronEvents().length > before + 1, { label: 'alert or event', timeout: 20_000 })
    await waitFor(() => alerts.length >= 1, { label: 'alert after reconnect', timeout: 20_000 })
    expect(alerts).toHaveLength(1)
  })
})

describe('cron and the Zero-Change rule', () => {
  it('only issues read-only commands and leaves the fixture untouched', async () => {
    const { session, req, cronEvents } = await setup()
    const before = snapshotTree(fx.root)
    await session.connect(req)
    await waitFor(() => cronEvents().length >= 1, { label: 'cron event', timeout: 15_000 })
    await session.cronOutput('default', '09358c101c91')
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})
