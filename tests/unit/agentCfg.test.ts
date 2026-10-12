import { describe, expect, it } from 'vitest'
import {
  buildModelPlan,
  charCount,
  customEnvVar,
  filePath,
  isHttpUrl,
  joinEntries,
  MASK,
  overLimit,
  redact,
  splitEntries,
  stepPreview,
  type ModelSaveRequest
} from '@shared/agentCfg'

describe('paths', () => {
  it('maps the default profile to the home itself and others under profiles/', () => {
    expect(filePath('/home/u/.hermes/', 'default', 'soul')).toBe('/home/u/.hermes/SOUL.md')
    expect(filePath('/home/u/.hermes', 'coder', 'memory')).toBe('/home/u/.hermes/profiles/coder/memories/MEMORY.md')
    expect(filePath('/h', 'x', 'user')).toBe('/h/profiles/x/memories/USER.md')
  })
})

describe('entries', () => {
  it('splits on lines with only a section sign', () => {
    expect(splitEntries('first\nentry\n§\nsecond\n§\nthird')).toEqual(['first\nentry', 'second', 'third'])
  })
  it('drops empty entries and a leading sign', () => {
    expect(splitEntries('§\none\n§\n\n§\ntwo')).toEqual(['one', 'two'])
    expect(splitEntries('  \n')).toEqual([])
  })
  it('keeps a § inside a line', () => {
    expect(splitEntries('price § 5')).toEqual(['price § 5'])
  })
  it('joins with sign lines and round-trips', () => {
    const t = joinEntries(['a', ' b ', '', 'c'])
    expect(t).toBe('a\n§\nb\n§\nc')
    expect(splitEntries(t)).toEqual(['a', 'b', 'c'])
  })
})

describe('limits', () => {
  it('counts code points', () => {
    expect(charCount('a😀b')).toBe(3)
  })
  it('knows the Hermes limits', () => {
    expect(overLimit('memory', 'x'.repeat(2200))).toBe(false)
    expect(overLimit('memory', 'x'.repeat(2201))).toBe(true)
    expect(overLimit('user', 'x'.repeat(1376))).toBe(true)
    expect(overLimit('soul', 'x'.repeat(100_000))).toBe(false)
  })
})

describe('buildModelPlan', () => {
  const base: ModelSaveRequest = { profile: 'default', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet', writeBaseUrl: false }

  it('sets provider and model for a preset', () => {
    const p = buildModelPlan(base)
    expect(p).toMatchObject({ ok: true, slug: 'openrouter', envVar: 'OPENROUTER_API_KEY' })
    expect(p.ok && p.steps.map((s) => s.args)).toEqual([
      ['model.provider', 'openrouter'],
      ['model.default', 'anthropic/claude-sonnet']
    ])
  })

  it('writes the key first, marks it secret and adds base url and effort when asked', () => {
    const p = buildModelPlan({ ...base, apiKey: ' sk-secret-1234 ', writeBaseUrl: true, effort: 'high' })
    expect(p.ok && p.steps.map((s) => s.args)).toEqual([
      ['OPENROUTER_API_KEY', 'sk-secret-1234'],
      ['model.provider', 'openrouter'],
      ['model.default', 'anthropic/claude-sonnet'],
      ['model.base_url', 'https://openrouter.ai/api/v1'],
      ['agent.reasoning_effort', 'high']
    ])
    expect(p.ok && p.steps[0]!.secretAt).toBe(1)
  })

  it('defines a custom provider before using it', () => {
    const p = buildModelPlan({ ...base, provider: 'custom', customName: 'my-proxy', baseUrl: 'https://llm.example.com/v1', apiKey: 'k-12345678' })
    expect(p.ok && p.steps.map((s) => s.args)).toEqual([
      ['providers.my-proxy.api', 'https://llm.example.com/v1'],
      ['providers.my-proxy.key_env', 'MY_PROXY_API_KEY'],
      ['MY_PROXY_API_KEY', 'k-12345678'],
      ['model.provider', 'my-proxy'],
      ['model.default', 'anthropic/claude-sonnet'],
      ['model.base_url', 'https://llm.example.com/v1']
    ])
  })

  it('rejects bad input', () => {
    expect(buildModelPlan({ ...base, provider: 'nope' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, model: 'has space' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, model: '' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, provider: 'custom', customName: 'Bad Name', baseUrl: 'https://x.io' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, provider: 'custom', customName: 'okname', baseUrl: 'ftp://x.io' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, writeBaseUrl: true, baseUrl: 'javascript:alert(1)' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, apiKey: 'a\nb' }).ok).toBe(false)
    expect(buildModelPlan({ ...base, provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'x' }).ok).toBe(false)
  })
})

describe('masking', () => {
  it('shows the key as dots in the preview', () => {
    const p = buildModelPlan({ profile: 'coder', provider: 'anthropic', baseUrl: '', model: 'm', writeBaseUrl: false, apiKey: 'sk-ant-abcdef' })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(stepPreview(p.steps[0]!, 'coder')).toBe(`hermes -p coder config set ANTHROPIC_API_KEY ${MASK}`)
    expect(stepPreview(p.steps[1]!, 'default')).toBe('hermes config set model.provider anthropic')
  })
  it('redacts a key from text', () => {
    expect(redact('bad key sk-ant-abcdef here sk-ant-abcdef', 'sk-ant-abcdef')).toBe(`bad key ${MASK} here ${MASK}`)
    expect(redact('abc', 'abc')).toBe('abc') // too short to be a key: left alone
    expect(redact('x', undefined)).toBe('x')
  })
  it('names env vars and checks urls', () => {
    expect(customEnvVar('my-proxy')).toBe('MY_PROXY_API_KEY')
    expect(isHttpUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })
})
