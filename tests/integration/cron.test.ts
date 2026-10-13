import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import { waitFor, removeDir } from '../helpers/wait'

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
  removeDir(dir)
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

  it('reads the run history and outputs of a job from the ledger, and nothing it was not told about', async () => {
    const { session, req, cronEvents } = await setup()
    expect(await session.cronRuns({ profile: 'default', jobId: '09358c101c91', limit: 6 })).toMatchObject({ ok: false })
    await session.connect(req)
    const first = await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })
    expect(first.jobs.find((j) => j.id === '09358c101c91')?.incident).toMatchObject({ id: '09358c_0a1b2c3d4e5f', state: 'alerted' })

    const runs = await session.cronRuns({ profile: 'default', jobId: '09358c101c91', limit: 6 })
    if (!runs.ok) throw new Error('runs failed')
    expect(runs.data.ledger).toBe('ok')
    expect(runs.data.runs.map((r) => [r.id, r.status, r.output])).toEqual([
      ['e3', 'failed', '09358c101c91/2026-10-10_23-00-25.md'],
      ['e2', 'completed', '09358c101c91/2026-10-09_23-00-45.md'],
      ['e1', 'unknown', null]
    ])
    const out = await session.cronRunOutput({ profile: 'default', jobId: '09358c101c91', names: ['09358c101c91/2026-10-10_23-00-25.md', '../../.env'] })
    expect(out).toMatchObject({ ok: true, data: { files: [{ text: 'latest run\nline two\n', truncated: false }, { name: '../../.env', error: 'not_found' }] } })
    const legacy = await session.cronRunOutput({ profile: 'scout', jobId: 'bbbbbbbbbbbb', names: ['bbbbbbbbbbbb_20260920_190257.txt'] })
    expect(legacy).toMatchObject({ ok: true, data: { files: [{ text: 'legacy loose file\n' }] } })
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
    await session.cronRuns({ profile: 'default', jobId: '09358c101c91', limit: 6 })
    await session.cronRunOutput({ profile: 'default', jobId: '09358c101c91', names: ['09358c101c91/2026-10-10_23-00-25.md'] })
    await session.disconnect()
    const verbs = new Set(srv.execLog.map((a) => a[0]))
    for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
    expect(snapshotTree(fx.root)).toEqual(before)
  })
})

describe('cron actions over the fake hermes', () => {
  const job = (data: CronData | undefined, id = '09358c101c91') => data?.jobs.find((j) => j.id === id)

  it('pauses and resumes a job and sends a fresh snapshot at once', async () => {
    const { session, req, cronEvents } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })
    const before = cronEvents().length
    const res = await session.cronAction({ action: 'pause', profile: 'default', jobId: '09358c101c91' })
    expect(res).toEqual({ ok: true, output: 'Paused job: second-brain-daily-sync (09358c101c91)' })
    expect(cronEvents().length).toBeGreaterThan(before)
    expect(job(cronEvents().at(-1))?.state).toBe('paused')
    expect(await session.cronAction({ action: 'resume', profile: 'default', jobId: '09358c101c91' })).toMatchObject({ ok: true })
    expect(job(cronEvents().at(-1))?.state).toBe('scheduled')
    expect(srv.hermes.cronCalls).toEqual([
      ['cron', 'pause', '09358c101c91'],
      ['cron', 'resume', '09358c101c91']
    ])
  })

  it('runs a job now: a manual run with its output appears and the incident resolves', async () => {
    const { session, req, cronEvents } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })
    const run = session.cronAction({ action: 'run', profile: 'default', jobId: '09358c101c91' })
    await new Promise((r) => setTimeout(r, 100))
    expect(await session.cronAction({ action: 'run', profile: 'default', jobId: '09358c101c91' })).toEqual({ ok: false, error: 'busy' })
    const res = await run
    expect(res).toMatchObject({ ok: true })
    if (res.ok) expect(res.output).toContain('Ran now: succeeded.')
    expect(job(cronEvents().at(-1))).toMatchObject({ lastStatus: 'ok', incident: null, inflight: false })
    const runs = await session.cronRuns({ profile: 'default', jobId: '09358c101c91', limit: 6 })
    if (!runs.ok) throw new Error('runs failed')
    expect(runs.data.runs[0]).toMatchObject({ status: 'completed', trigger: 'manual', source: 'direct' })
    expect(runs.data.runs[0]!.output).toMatch(/^09358c101c91\/.+\.md$/)
  })

  it('edits the schedule, shows a refusal as Hermes wrote it, and acknowledges an incident', async () => {
    const { session, req, cronEvents } = await setup()
    await session.connect(req)
    await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })
    expect(await session.cronAction({ action: 'edit', profile: 'scout', jobId: 'aaaaaaaaaaaa', schedule: 'every 2h' })).toMatchObject({ ok: true })
    expect(job(cronEvents().at(-1), 'aaaaaaaaaaaa')?.schedule.display).toBe('every 2h')
    const bad = await session.cronAction({ action: 'edit', profile: 'scout', jobId: 'aaaaaaaaaaaa', schedule: 'bad schedule' })
    expect(bad).toEqual({ ok: false, error: 'failed', detail: "Failed to update job: Invalid schedule 'bad schedule'" })
    const ack = await session.cronAction({ action: 'ack', profile: 'default', jobId: '09358c101c91', incidentId: '09358c_0a1b2c3d4e5f' })
    expect(ack).toEqual({ ok: true, output: '✓ Incident 09358c_0a1b2c3d4e5f acknowledged (closed).' })
    expect(job(cronEvents().at(-1))?.incident).toBeNull()
    expect(srv.hermes.cronCalls).toContainEqual(['-p', 'scout', 'cron', 'edit', 'aaaaaaaaaaaa', '--schedule', 'every 2h'])
  })

  it('refuses what it cannot vouch for without running anything', async () => {
    const { session, req, cronEvents } = await setup()
    expect(await session.cronAction({ action: 'pause', profile: 'default', jobId: '09358c101c91' })).toEqual({ ok: false, error: 'not-connected' })
    await session.connect(req)
    await waitFor(() => cronEvents()[0], { label: 'cron event', timeout: 15_000 })
    expect(await session.cronAction({ action: 'pause', profile: 'default', jobId: 'ffffffffffff' })).toEqual({ ok: false, error: 'unknown-job' })
    expect(await session.cronAction({ action: 'ack', profile: 'default', jobId: '09358c101c91', incidentId: 'aaaaaa_123' })).toEqual({ ok: false, error: 'bad-input' })
    expect(await session.cronAction({ action: 'edit', profile: 'default', jobId: '09358c101c91', schedule: 'a\nb' })).toEqual({ ok: false, error: 'bad-input' })
    expect(srv.hermes.cronCalls).toEqual([])
  })
})
