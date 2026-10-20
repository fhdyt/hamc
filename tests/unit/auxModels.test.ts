import { describe, expect, it } from 'vitest'
import { AUTO_SLOT, AUX_TASKS, auxCommandLines, buildAuxPlan, buildAuxSave, resetAllChanges, type AuxSlots } from '@shared/auxModels'

describe('auxiliary models (v2)', () => {
  it('has the 18 slots of the Hermes source, without web_extract', () => {
    expect(AUX_TASKS).toHaveLength(18)
    expect(AUX_TASKS.map((t) => t.key)).not.toContain('web_extract')
  })

  it('sets a model, or goes back to auto with empty model and base URL', () => {
    expect(buildAuxPlan('vision', { kind: 'model', provider: 'openrouter', model: 'google/gemini-2.5-flash' })).toEqual({
      ok: true,
      steps: [['auxiliary.vision.provider', 'openrouter'], ['auxiliary.vision.model', 'google/gemini-2.5-flash'], ['auxiliary.vision.base_url', '']]
    })
    expect(buildAuxPlan('compression', { kind: 'model', provider: 'my-proxy', model: 'x', baseUrl: 'https://p.example/v1' })).toMatchObject({
      ok: true,
      steps: [['auxiliary.compression.provider', 'my-proxy'], ['auxiliary.compression.model', 'x'], ['auxiliary.compression.base_url', 'https://p.example/v1']]
    })
    expect(buildAuxPlan('curator', { kind: 'auto' })).toEqual({ ok: true, steps: [['auxiliary.curator.provider', 'auto'], ['auxiliary.curator.model', ''], ['auxiliary.curator.base_url', '']] })
  })

  it('refuses what Hermes would not take', () => {
    expect(buildAuxPlan('web_extract', { kind: 'auto' }).ok).toBe(false)
    expect(buildAuxPlan('vision', { kind: 'model', provider: 'auto', model: 'x' }).ok).toBe(false)
    expect(buildAuxPlan('vision', { kind: 'model', provider: 'Open Router', model: 'x' }).ok).toBe(false)
    expect(buildAuxPlan('vision', { kind: 'model', provider: '-p', model: 'x' }).ok).toBe(false)
    expect(buildAuxPlan('vision', { kind: 'model', provider: 'openrouter', model: 'has space' }).ok).toBe(false)
    expect(buildAuxPlan('vision', { kind: 'model', provider: 'openrouter', model: 'x', baseUrl: 'ftp://x' }).ok).toBe(false)
    expect(buildAuxSave({ profile: 'default', changes: [] }).ok).toBe(false)
  })

  it('resets only the slots that are not on auto', () => {
    const slots = Object.fromEntries(AUX_TASKS.map((t) => [t.key, AUTO_SLOT])) as AuxSlots
    slots.vision = { provider: 'openrouter', model: 'm', baseUrl: '', hasKey: false }
    slots.mcp = { provider: 'auto', model: '', baseUrl: 'http://x', hasKey: false }
    expect(resetAllChanges(slots)).toEqual([
      { task: 'vision', choice: { kind: 'auto' } },
      { task: 'mcp', choice: { kind: 'auto' } }
    ])
  })

  it('previews the commands', () => {
    expect(auxCommandLines('scout', [['auxiliary.vision.provider', 'auto'], ['auxiliary.vision.model', '']])).toBe(
      "$ hermes -p scout config set auxiliary.vision.provider auto\n$ hermes -p scout config set auxiliary.vision.model ''"
    )
  })
})
