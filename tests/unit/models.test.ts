import { describe, expect, it, vi } from 'vitest'
import { ModelResolver, parseModelJson } from '../../src/main/collector/models'
import type { Execer } from '../../src/main/connection/manager'

describe('parseModelJson', () => {
  it.each([
    ['{"provider":"openrouter","default":"a/b"}', { provider: 'openrouter', model: 'a/b' }],
    ['{"model":{"provider":"p","default":"m"}}', { provider: 'p', model: 'm' }],
    ['{"model":"plain"}', { provider: null, model: 'plain' }],
    ['{"provider":"p"}', { provider: 'p', model: null }],
    ['{}', null],
    ['not json', null],
    ['[1]', null]
  ])('%j', (input, expected) => {
    expect(parseModelJson(input)).toEqual(expected)
  })
})

function execer(counts: Record<string, number>, out = '{"provider":"p","default":"m"}'): Execer {
  return {
    exec: async (argv) => {
      const profile = argv[1] === '-p' ? argv[2]! : 'default'
      counts[profile] = (counts[profile] ?? 0) + 1
      return { code: 0, stdout: out, stderr: '' }
    }
  }
}

describe('ModelResolver', () => {
  it('reads each profile once and again only when config.yaml changes', async () => {
    const counts: Record<string, number> = {}
    const onChange = vi.fn()
    const r = new ModelResolver(execer(counts), '/bin/hermes', onChange)
    await r.update([{ profile: 'default', configMtime: 1 }, { profile: 'scout', configMtime: null }])
    await r.update([{ profile: 'default', configMtime: 1 }, { profile: 'scout', configMtime: null }])
    expect(counts).toEqual({ default: 1, scout: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    await r.update([{ profile: 'default', configMtime: 2 }, { profile: 'scout', configMtime: null }])
    expect(counts).toEqual({ default: 2, scout: 1 })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(r.snapshot()).toEqual({ default: { provider: 'p', model: 'm' }, scout: { provider: 'p', model: 'm' } })
  })

  it('forgets removed profiles', async () => {
    const r = new ModelResolver(execer({}), '/bin/hermes', () => {})
    await r.update([{ profile: 'a', configMtime: 1 }, { profile: 'b', configMtime: 1 }])
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(Object.keys(r.snapshot())).toEqual(['a'])
  })

  it('does nothing without a hermes CLI', async () => {
    const counts: Record<string, number> = {}
    const r = new ModelResolver(execer(counts), null, () => {})
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(counts).toEqual({})
  })

  it('retries a failed lookup only after a cool-down', async () => {
    let t = 0
    let calls = 0
    const failing: Execer = { exec: async () => ((calls++, { code: 1, stdout: '', stderr: 'boom' })) }
    const r = new ModelResolver(failing, '/bin/hermes', () => {}, () => t)
    await r.update([{ profile: 'a', configMtime: 1 }])
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(calls).toBe(1)
    t = 61_000
    await r.update([{ profile: 'a', configMtime: 1 }])
    expect(calls).toBe(2)
    expect(r.snapshot()).toEqual({ a: null })
  })
})
