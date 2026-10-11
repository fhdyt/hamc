import { describe, expect, it } from 'vitest'
import type { Execer } from '../../src/main/connection/manager'
import { CronStore } from '../../src/main/cron/store'
import { isSafeProfile, isSafeRel, outputPath, readCronOutput } from '../../src/main/cron/output'
import { sampleJob } from '../helpers/samples'

describe('isSafeRel', () => {
  it.each([
    ['09358c101c91/2026-10-10_23-00-25.md', true],
    ['09358c101c91_20260920_190257.txt', true],
    ['file.md', true],
    ['../etc/passwd', false],
    ['a/../b', false],
    ['..', false],
    ['/abs/path', false],
    ['a/b/c', false],
    ['has space.md', false],
    ['semi;colon', false],
    ['a\nb', false],
    ['a\0b', false],
    ['', false],
    ['x'.repeat(301), false]
  ])('%j -> %s', (rel, expected) => {
    expect(isSafeRel(rel)).toBe(expected)
  })

  it('rejects non-strings', () => {
    expect(isSafeRel(undefined)).toBe(false)
    expect(isSafeRel(42)).toBe(false)
  })
})

describe('isSafeProfile', () => {
  it.each([
    ['default', true],
    ['scout', true],
    ['team-a_1.x', true],
    ['..', false],
    ['.', false],
    ['a/b', false],
    ['', false],
    ['x'.repeat(65), false],
    ['bad name', false]
  ])('%j -> %s', (p, expected) => {
    expect(isSafeProfile(p)).toBe(expected)
  })
})

describe('outputPath', () => {
  it('uses the home for the default profile', () => {
    expect(outputPath('/home/u/.hermes', 'default', 'j/a.md')).toBe('/home/u/.hermes/cron/output/j/a.md')
  })
  it('uses profiles/<name> for other profiles and ignores a trailing slash', () => {
    expect(outputPath('/home/u/.hermes/', 'scout', 'j/a.md')).toBe('/home/u/.hermes/profiles/scout/cron/output/j/a.md')
  })
})

describe('readCronOutput', () => {
  const store = new CronStore()
  store.apply([
    sampleJob(),
    sampleJob({ profile: 'scout', id: 'noout', lastOutput: null }),
    sampleJob({ profile: 'scout', id: 'evil', lastOutput: { rel: '../../../etc/passwd', mtime: 1 } })
  ])
  const calls: string[][] = []
  const exec = (code = 0, stdout = 'hello'): Execer => ({
    exec: async (argv) => {
      calls.push([...argv])
      return { code, stdout, stderr: '' }
    }
  })

  it('reads the file with head and the built path', async () => {
    calls.length = 0
    const r = await readCronOutput(exec(0, 'line one\nline two\n'), '/home/u/.hermes', store, 'default', '09358c101c91')
    expect(r).toEqual({ ok: true, text: 'line one\nline two\n', truncated: false, name: '2026-10-10_23-00-25.md', mtime: 1_791_648_025 })
    expect(calls).toEqual([['head', '-c', '65536', '/home/u/.hermes/cron/output/09358c101c91/2026-10-10_23-00-25.md']])
  })

  it('reports a job that is not in the store', async () => {
    calls.length = 0
    expect(await readCronOutput(exec(), '/h', store, 'default', 'unknown')).toEqual({ ok: false, reason: 'not-found' })
    expect(calls).toEqual([])
  })

  it('rejects an unsafe profile name without running anything', async () => {
    calls.length = 0
    expect(await readCronOutput(exec(), '/h', store, '../x', '09358c101c91')).toEqual({ ok: false, reason: 'not-found' })
    expect(calls).toEqual([])
  })

  it('reports a job without output', async () => {
    expect(await readCronOutput(exec(), '/h', store, 'scout', 'noout')).toEqual({ ok: false, reason: 'no-output' })
  })

  it('never runs a command for an unsafe relative path reported by the collector', async () => {
    calls.length = 0
    expect(await readCronOutput(exec(), '/h', store, 'scout', 'evil')).toEqual({ ok: false, reason: 'no-output' })
    expect(calls).toEqual([])
  })

  it('reports an unreadable file', async () => {
    expect(await readCronOutput(exec(1, ''), '/h', store, 'default', '09358c101c91')).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('flags output that hit the size limit', async () => {
    const r = await readCronOutput(exec(0, 'x'.repeat(65536)), '/h', store, 'default', '09358c101c91')
    expect(r.ok && r.truncated).toBe(true)
  })

  it('survives an exec that throws', async () => {
    const boom: Execer = { exec: async () => Promise.reject(new Error('lost')) }
    expect(await readCronOutput(boom, '/h', store, 'default', '09358c101c91')).toEqual({ ok: false, reason: 'unreadable' })
  })
})
