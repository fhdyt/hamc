import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronIncident, CronRun, CronRuns } from '@shared/events'
import { askAction, confirmAction, loadRuns, pickRun } from '../../src/renderer/cronActions'
import {
  actionResultText,
  ackBlock,
  askView,
  incidentHeadline,
  outputPair,
  runDuration,
  runNowBlock,
  runStatusLabel,
  scheduleProblem,
  schedulePreview
} from '../../src/renderer/lib/cronControl'
import { useCron } from '../../src/renderer/stores/cron'
import { sampleJob } from '../helpers/samples'

const J = '09358c101c91'
const KEY = `default/${J}`
const ok = <T,>(data: T) => ({ ok: true as const, data })
const run = (id: string, over: Partial<CronRun> = {}): CronRun => ({
  id, status: 'completed', source: 'builtin', trigger: 'scheduled', claimedTs: 1000, startedTs: 1001, finishedTs: 1052, error: null, delivery: null, output: null, ...over
})
const incident = (over: Partial<CronIncident> = {}): CronIncident => ({
  id: '09358c_0a1b2c3d4e5f', state: 'alerted', failureType: 'rate_limit', firstSeenTs: 1, lastSeenTs: 2, ackedTs: null, closedTs: null, error: 'HTTP 429', output: null, ...over
})
const runsOf = (runs: CronRun[]): CronRuns => ({ ledger: 'ok', runs, incidents: [], outputs: [] })

describe('lib/cronControl', () => {
  it('describes each confirm with the exact command', () => {
    const job = sampleJob({ profile: 'scout', name: 'digest' })
    expect(askView('pause', job)).toMatchObject({ title: 'Pause “digest”?', confirm: 'Pause job', command: `$ hermes -p scout cron pause ${J}` })
    const r = askView('run', job)
    expect(r.body).toContain('uses tokens')
    expect(r.body).toContain('regular schedule does not change')
    expect(r.tone).toBe('#FFB86C')
    expect(askView('edit', job, { schedule: '0 9 * * *' }).command).toBe(`$ hermes -p scout cron edit ${J} --schedule '0 9 * * *'`)
    expect(askView('edit', job, { schedule: '' }).command).toBeNull()
    expect(askView('ack', sampleJob(), { incident: incident() }).command).toBe('$ hermes cron incidents ack 09358c_0a1b2c3d4e5f')
  })

  it('blocks Run now while the job runs, and Acknowledge without the command', () => {
    expect(runNowBlock(sampleJob(), false)).toBeNull()
    expect(runNowBlock(sampleJob({ state: 'running' }), false)).toContain('running')
    expect(runNowBlock(sampleJob({ inflight: true }), false)).toContain('running')
    expect(runNowBlock(sampleJob(), true)).toContain('Mission Control')
    expect(ackBlock(false)).toContain('cron incidents')
    expect(ackBlock(undefined)).toBeNull()
  })

  it('checks and previews a schedule', () => {
    expect(scheduleProblem('')).toBe('Enter a schedule.')
    expect(scheduleProblem(' 30m')).toContain('spaces')
    expect(scheduleProblem('a\nb')).toContain('line breaks')
    expect(scheduleProblem('every 2h')).toBeNull()
    const job = sampleJob({ tzOffsetMin: 0 })
    expect(schedulePreview(job, '0 9 * * *', 0)).toEqual([9 * 3600, 33 * 3600, 57 * 3600])
    expect(schedulePreview(job, 'every 2h', 100)).toEqual([100, 7300, 14500])
    expect(schedulePreview(job, 'whenever', 0)).toEqual([])
  })

  it('labels runs and their duration', () => {
    expect(runStatusLabel('completed')).toBe('OK')
    expect(runStatusLabel('claimed')).toBe('RUNNING')
    expect(runStatusLabel('unknown')).toBe('UNKNOWN')
    expect(runDuration(run('a'), 0)).toBe('51s')
    expect(runDuration(run('a', { startedTs: 0, finishedTs: 370 }), 0)).toBe('6m 10s')
    expect(runDuration(run('a', { startedTs: 0, finishedTs: 3720 }), 0)).toBe('1h 02m')
    expect(runDuration(run('a', { status: 'running', startedTs: 100, finishedTs: null }), 130)).toBe('30s')
    expect(runDuration(run('a', { status: 'unknown', finishedTs: null }), 5000)).toBeNull()
    expect(runDuration(run('a', { claimedTs: null, startedTs: null }), 0)).toBeNull()
  })

  it('pairs the picked output with the closest older one', () => {
    const runs = [run('c', { output: 'j/3.md' }), run('b'), run('a', { output: 'j/1.md' })]
    expect(outputPair(runs, 0)).toEqual({ current: 'j/3.md', previous: 'j/1.md' })
    expect(outputPair(runs, 1)).toBeNull()
    expect(outputPair(runs, 2)).toEqual({ current: 'j/1.md', previous: null })
  })

  it('says how long the job has failed and what an action did', () => {
    expect(incidentHeadline(sampleJob({ failureStreak: 4 }), incident())).toBe('Incident open: failed 4 runs in a row')
    expect(incidentHeadline(sampleJob({ failureStreak: 0 }), incident())).toContain('alert')
    expect(actionResultText({ ok: true, output: 'Paused job: x' })).toEqual({ ok: true, title: 'Done', detail: 'Paused job: x' })
    expect(actionResultText({ ok: false, error: 'failed', detail: 'Invalid schedule' })).toEqual({ ok: false, title: 'Hermes refused the command.', detail: 'Invalid schedule' })
  })
})

type Fn = ReturnType<typeof vi.fn>
function stub(over: { runs?: Fn; output?: Fn; action?: Fn } = {}) {
  const mc = {
    cron: {
      runs: over.runs ?? vi.fn(async () => ok(runsOf([run('e3', { output: `${J}/b.md` }), run('e2', { output: `${J}/a.md` })]))),
      output: over.output ?? vi.fn(async (a: { names: string[] }) => ok({ files: a.names.map((name) => ({ name, text: `text of ${name}`, truncated: false, mtime: 1, size: 3 })) })),
      action: over.action ?? vi.fn(async () => ({ ok: true, output: 'done' }))
    }
  }
  vi.stubGlobal('window', { mc })
  return mc
}

beforeEach(() => {
  useCron.getState().reset()
  useCron.getState().applyCron({ jobs: [sampleJob(), sampleJob({ profile: 'scout', id: 'aaaaaaaaaaaa', name: 'other' })], profiles: [] })
  useCron.getState().select(KEY)
})
afterEach(() => vi.unstubAllGlobals())

describe('cron store and actions', () => {
  it('loads the runs and the two outputs of the diff once', async () => {
    const mc = stub()
    await loadRuns()
    const s = useCron.getState()
    expect(s.runs).toMatchObject({ key: KEY, status: 'ok' })
    expect(mc.cron.output).toHaveBeenCalledWith({ profile: 'default', jobId: J, names: [`${J}/b.md`, `${J}/a.md`] })
    expect(s.outputs[`${J}/b.md`]).toEqual({ status: 'ok', text: `text of ${J}/b.md`, truncated: false })
    await pickRun(1)
    expect(mc.cron.output).toHaveBeenCalledTimes(1)
    expect(useCron.getState().picked).toBe(1)
  })

  it('keeps the picked run across a refresh and drops answers for another job', async () => {
    let resolve: (v: unknown) => void = () => {}
    const slow = vi.fn(() => new Promise((r) => (resolve = r)))
    stub()
    await loadRuns()
    await pickRun(1)
    await loadRuns(true)
    expect(useCron.getState().picked).toBe(1)
    stub({ runs: slow })
    const pending = loadRuns(true)
    useCron.getState().select('scout/aaaaaaaaaaaa')
    resolve(ok(runsOf([run('zz')])))
    await pending
    expect(useCron.getState().runs).toBeNull()
  })

  it('keeps the last good history on a failed quiet refresh', async () => {
    stub()
    await loadRuns()
    stub({ runs: vi.fn(async () => ({ ok: false, error: 'timeout' })) })
    await loadRuns(true)
    const r = useCron.getState().runs
    expect(r?.status).toBe('error')
    if (r?.status === 'error') expect(r.data?.runs).toHaveLength(2)
  })

  it('confirms an edit with the draft, marks it pending, keeps the result and reads the runs again', async () => {
    let finish: (v: unknown) => void = () => {}
    const action = vi.fn(() => new Promise((r) => (finish = r)))
    const mc = stub({ action })
    askAction('edit')
    expect(useCron.getState().ask).toEqual({ key: KEY, action: 'edit' })
    expect(useCron.getState().draft).toBe('0 23 * * *')
    useCron.getState().setDraft('every 2h')
    const p = confirmAction()
    expect(useCron.getState().ask).toBeNull()
    expect(useCron.getState().pending[KEY]).toBe('edit')
    finish({ ok: false, error: 'failed', detail: 'Invalid schedule' })
    await p
    expect(action).toHaveBeenCalledWith({ action: 'edit', profile: 'default', jobId: J, schedule: 'every 2h' })
    expect(useCron.getState().pending[KEY]).toBeUndefined()
    expect(useCron.getState().notes[KEY]).toEqual({ action: 'edit', ok: false, title: 'Hermes refused the command.', detail: 'Invalid schedule' })
    expect(mc.cron.runs).toHaveBeenCalled()
  })

  it('acknowledges the incident of the job', async () => {
    useCron.getState().applyCron({ jobs: [sampleJob({ incident: incident() })], profiles: [] })
    const mc = stub()
    askAction('ack')
    await confirmAction()
    expect(mc.cron.action).toHaveBeenCalledWith({ action: 'ack', profile: 'default', jobId: J, incidentId: '09358c_0a1b2c3d4e5f' })
  })

  it('forgets history, outputs and the confirm when another job is picked', async () => {
    stub()
    await loadRuns()
    askAction('pause')
    useCron.getState().select('scout/aaaaaaaaaaaa')
    expect(useCron.getState()).toMatchObject({ runs: null, picked: 0, outputs: {}, ask: null })
  })
})

describe('the picked run', () => {
  it('follows the newest run, keeps an older pick, and jumps to the newest after Run now', async () => {
    const two = [run('e3', { output: `${J}/b.md` }), run('e2', { output: `${J}/a.md` })]
    const three = [run('m1', { output: `${J}/c.md` }), ...two]
    let list = two
    stub({ runs: vi.fn(async () => ok(runsOf(list))) })
    await loadRuns()
    list = three
    await loadRuns(true)
    expect(useCron.getState().picked).toBe(0)
    await pickRun(2)
    list = [run('m2'), ...three]
    await loadRuns(true)
    expect(useCron.getState().picked).toBe(3)
    askAction('run')
    await confirmAction()
    expect(useCron.getState().picked).toBe(0)
  })
})
