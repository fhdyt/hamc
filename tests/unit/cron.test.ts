import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTER, agentLabel, counts, filterJobs, formatCountdown, formatLocal, formatOffset, jobKey, sortJobs, stateLabel, statusLabel
} from '../../src/renderer/lib/cron'
import { useCron } from '../../src/renderer/stores/cron'
import { sampleCron, sampleJob } from '../helpers/samples'

const ok = (over = {}) => sampleJob({ lastStatus: 'ok', failureStreak: 0, lastError: null, ...over })

describe('labels', () => {
  it('writes statuses as text', () => {
    expect(statusLabel('ok')).toBe('OK')
    expect(statusLabel('error')).toBe('ERROR')
    expect(statusLabel('delivery_failed')).toBe('DELIVERY FAILED')
    expect(statusLabel(null)).toBe('NEVER RUN')
    expect(statusLabel('something_new')).toBe('SOMETHING NEW')
    expect(stateLabel('paused')).toBe('PAUSED')
  })

  it('builds a stable key', () => {
    expect(jobKey({ profile: 'scout', id: 'abc' })).toBe('scout/abc')
  })

  it('prefers a display name for the agent', () => {
    expect(agentLabel('scout', { scout: 'Scout Prime' })).toBe('Scout Prime')
    expect(agentLabel('atlas', {})).toBe('atlas')
  })
})

describe('counts', () => {
  it('counts running, failing and paused jobs', () => {
    const jobs = [ok(), ok({ id: 'b', state: 'running' }), ok({ id: 'c', state: 'paused' }), sampleJob({ id: 'd', lastStatus: 'delivery_failed' }), ok({ id: 'e', lastStatus: null, lastRunTs: null })]
    expect(counts(jobs)).toEqual({ total: 5, running: 1, error: 1, paused: 1 })
  })
})

describe('filterJobs', () => {
  const jobs = [
    ok({ profile: 'default', id: 'a1', name: 'Morning Brief' }),
    sampleJob({ profile: 'scout', id: 'b2', name: 'arxiv-watch', lastStatus: 'error' }),
    ok({ profile: 'scout', id: 'c3', name: 'never-ran', lastStatus: null, lastRunTs: null }),
    ok({ profile: 'zelos', id: 'd4', name: 'nightly', state: 'paused' }),
    ok({ profile: 'zelos', id: 'e5', name: 'live', state: 'running' })
  ]
  const names = (f: Partial<typeof DEFAULT_FILTER>) => filterJobs(jobs, { ...DEFAULT_FILTER, ...f }).map((j) => j.id)

  it('returns everything by default', () => {
    expect(names({})).toEqual(['a1', 'b2', 'c3', 'd4', 'e5'])
  })
  it('filters by agent', () => {
    expect(names({ agent: 'scout' })).toEqual(['b2', 'c3'])
  })
  it('filters by status', () => {
    expect(names({ status: 'ok' })).toEqual(['a1', 'd4', 'e5'])
    expect(names({ status: 'error' })).toEqual(['b2'])
    expect(names({ status: 'never' })).toEqual(['c3'])
    expect(names({ status: 'running' })).toEqual(['e5'])
    expect(names({ status: 'paused' })).toEqual(['d4'])
  })
  it('searches name, id and agent without caring about case or edge spaces', () => {
    expect(names({ query: '  MORNING ' })).toEqual(['a1'])
    expect(names({ query: 'c3' })).toEqual(['c3'])
    expect(names({ query: 'zelos' })).toEqual(['d4', 'e5'])
    expect(names({ query: 'nothing' })).toEqual([])
  })
  it('combines filters', () => {
    expect(names({ agent: 'scout', status: 'error', query: 'arxiv' })).toEqual(['b2'])
    expect(names({ agent: 'default', status: 'error' })).toEqual([])
  })
})

describe('sortJobs', () => {
  it('puts running first, then by next run, with unknown times last, without mutating', () => {
    const jobs = [
      ok({ id: 'late', nextRunTs: 300 }),
      ok({ id: 'none', nextRunTs: null }),
      ok({ id: 'soon', nextRunTs: 100 }),
      ok({ id: 'run', state: 'running', nextRunTs: 900 })
    ]
    const copy = [...jobs]
    expect(sortJobs(jobs).map((j) => j.id)).toEqual(['run', 'soon', 'late', 'none'])
    expect(jobs).toEqual(copy)
  })
  it('breaks ties by name', () => {
    expect(sortJobs([ok({ id: 'b', name: 'b', nextRunTs: 5 }), ok({ id: 'a', name: 'a', nextRunTs: 5 })]).map((j) => j.id)).toEqual(['a', 'b'])
  })
})

describe('formatCountdown', () => {
  const now = 1_000_000 * 1000
  const at = (s: number) => 1_000_000 + s
  it.each([
    [null, '—'],
    [at(-5), 'due'],
    [at(0), 'due'],
    [at(40), 'in 40s'],
    [at(12 * 60 + 40), 'in 12m 40s'],
    [at(3 * 3600 + 12 * 60), 'in 3h 12m'],
    [at(3 * 3600 + 5 * 60), 'in 3h 05m'],
    [at(2 * 86400 + 4 * 3600), 'in 2d 4h']
  ])('%s -> %s', (ts, expected) => {
    expect(formatCountdown(ts, now)).toBe(expected)
  })
})

describe('time zone labels', () => {
  it('formats offsets', () => {
    expect(formatOffset(420)).toBe('+07:00')
    expect(formatOffset(-210)).toBe('-03:30')
    expect(formatOffset(0)).toBe('+00:00')
    expect(formatOffset(null)).toBe('unknown')
  })
  it('formats a local time without throwing', () => {
    expect(formatLocal(null)).toBe('—')
    expect(formatLocal(1_791_734_400)).toMatch(/\d{2}:\d{2}/)
  })
})

describe('cron store', () => {
  beforeEach(() => useCron.getState().reset())

  it('keeps the selection while the job exists and drops it when it disappears', () => {
    const data = sampleCron()
    useCron.getState().applyCron(data, 5)
    useCron.getState().select('scout/aaaaaaaaaaaa')
    useCron.getState().applyCron(data, 6)
    expect(useCron.getState().selected).toBe('scout/aaaaaaaaaaaa')
    useCron.getState().applyCron({ ...data, jobs: data.jobs.filter((j) => j.id !== 'aaaaaaaaaaaa') }, 7)
    expect(useCron.getState().selected).toBeNull()
    expect(useCron.getState().receivedAt).toBe(7)
  })

  it('opens the modal on a given job and closes it', () => {
    useCron.getState().applyCron(sampleCron())
    useCron.getState().openModal('default/09358c101c91')
    expect(useCron.getState()).toMatchObject({ modalOpen: true, selected: 'default/09358c101c91' })
    useCron.getState().closeModal()
    expect(useCron.getState().modalOpen).toBe(false)
  })

  it('merges filter patches', () => {
    useCron.getState().setFilter({ agent: 'scout' })
    useCron.getState().setFilter({ query: 'x' })
    expect(useCron.getState().filter).toEqual({ agent: 'scout', status: 'all', query: 'x' })
  })
})
