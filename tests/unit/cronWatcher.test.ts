import { describe, expect, it } from 'vitest'
import { CronWatcher, isFailure } from '../../src/main/cron/watcher'
import { sampleJob } from '../helpers/samples'

const job = (over = {}) => sampleJob({ lastStatus: 'ok', failureStreak: 0, lastError: null, lastRunTs: 1000, ...over })

describe('isFailure', () => {
  it.each([
    [null, false],
    ['ok', false],
    ['running', false],
    ['error', true],
    ['ERROR', true],
    ['error: timeout', true],
    ['delivery_failed', true],
    ['blocked_config', true]
  ])('%s -> %s', (status, expected) => {
    expect(isFailure(status)).toBe(expected)
  })
})

describe('CronWatcher', () => {
  it('treats the first batch as a baseline even when jobs are already failing', () => {
    const w = new CronWatcher()
    expect(w.ingest([job({ lastStatus: 'error', failureStreak: 10 })])).toEqual([])
  })

  it('alerts once for a new failed run and not again for the same run', () => {
    const w = new CronWatcher()
    w.ingest([job()])
    const failed = job({ lastStatus: 'error', lastError: 'boom', lastRunTs: 2000 })
    const alerts = w.ingest([failed])
    expect(alerts).toEqual([{ profile: 'default', jobId: '09358c101c91', name: 'second-brain-daily-sync', lastStatus: 'error', lastError: 'boom', lastRunTs: 2000 }])
    expect(w.ingest([failed])).toEqual([])
  })

  it('does not alert for a new run that succeeded', () => {
    const w = new CronWatcher()
    w.ingest([job()])
    expect(w.ingest([job({ lastRunTs: 2000, lastStatus: 'ok' })])).toEqual([])
  })

  it('alerts on delivery_failed and blocked_config runs', () => {
    const w = new CronWatcher()
    w.ingest([job({ id: 'a' }), job({ id: 'b' })])
    const alerts = w.ingest([job({ id: 'a', lastRunTs: 2000, lastStatus: 'delivery_failed' }), job({ id: 'b', lastRunTs: 2000, lastStatus: 'blocked_config' })])
    expect(alerts.map((a) => a.jobId)).toEqual(['a', 'b'])
  })

  it('records a job that appears after the baseline without alerting', () => {
    const w = new CronWatcher()
    w.ingest([job({ id: 'a' })])
    expect(w.ingest([job({ id: 'a' }), job({ id: 'new', lastStatus: 'error', lastRunTs: 5000 })])).toEqual([])
    expect(w.ingest([job({ id: 'a' }), job({ id: 'new', lastStatus: 'error', lastRunTs: 6000 })])).toHaveLength(1)
  })

  it('does not double-alert when a job disappears and comes back', () => {
    const w = new CronWatcher()
    w.ingest([job()])
    const failed = job({ lastStatus: 'error', lastRunTs: 2000 })
    expect(w.ingest([failed])).toHaveLength(1)
    w.ingest([])
    expect(w.ingest([failed])).toEqual([])
  })

  it('alerts for a job that had never run once it fails', () => {
    const w = new CronWatcher()
    w.ingest([job({ lastRunTs: null, lastStatus: null })])
    expect(w.ingest([job({ lastRunTs: 3000, lastStatus: 'error' })])).toHaveLength(1)
  })

  it('ignores a job whose last run time went backwards or disappeared', () => {
    const w = new CronWatcher()
    w.ingest([job({ lastRunTs: 5000 })])
    expect(w.ingest([job({ lastRunTs: 4000, lastStatus: 'error' })])).toEqual([])
    expect(w.ingest([job({ lastRunTs: null, lastStatus: 'error' })])).toEqual([])
  })

  it('starts a new baseline after reset', () => {
    const w = new CronWatcher()
    w.ingest([job()])
    w.reset()
    expect(w.ingest([job({ lastStatus: 'error', lastRunTs: 9000 })])).toEqual([])
  })

  it('keeps the same job in two profiles apart', () => {
    const w = new CronWatcher()
    w.ingest([job({ profile: 'a' }), job({ profile: 'b' })])
    const alerts = w.ingest([job({ profile: 'a', lastRunTs: 2000, lastStatus: 'error' }), job({ profile: 'b' })])
    expect(alerts.map((a) => a.profile)).toEqual(['a'])
  })
})
