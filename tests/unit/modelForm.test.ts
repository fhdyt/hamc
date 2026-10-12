import { describe, expect, it } from 'vitest'
import { credLabel, fetchErrorText, formDirty, formFromState, previewOf, requestOf, summaryLines, withProvider } from '../../src/renderer/lib/modelForm'

const state = (over = {}) => ({ provider: 'openrouter', model: 'a/b', baseUrl: null, effort: 'high', creds: {}, ...over })

describe('formFromState', () => {
  it('uses the preset url when Hermes has none, and keeps the effort', () => {
    expect(formFromState(state())).toMatchObject({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'a/b', effort: 'high', apiKey: '' })
  })
  it('shows an unknown provider as custom with its name', () => {
    expect(formFromState(state({ provider: 'my-proxy', baseUrl: 'https://x.io/v1' }))).toMatchObject({ provider: 'custom', customName: 'my-proxy', baseUrl: 'https://x.io/v1' })
  })
  it('starts with OpenRouter when Hermes reports nothing', () => {
    expect(formFromState(null)).toMatchObject({ provider: 'openrouter', model: '', effort: null })
  })
})

describe('form changes', () => {
  it('fills the default url on a provider change and clears the key', () => {
    const f = withProvider({ ...formFromState(state()), apiKey: 'sk-x' }, 'ollama')
    expect(f).toMatchObject({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' })
    expect(withProvider(f, 'custom').baseUrl).toBe('')
  })
  it('is dirty after any change or a typed key', () => {
    const base = formFromState(state())
    expect(formDirty(base, base)).toBe(false)
    expect(formDirty({ ...base, model: 'x' }, base)).toBe(true)
    expect(formDirty({ ...base, apiKey: 'k' }, base)).toBe(true)
    expect(formDirty({ ...base, effort: 'low' }, base)).toBe(true)
  })
})

describe('request and preview', () => {
  it('writes the base url only for a proxy, a local provider or a custom one', () => {
    const f = { ...formFromState(state()), model: 'a/b' }
    expect(requestOf('default', f).writeBaseUrl).toBe(false)
    expect(requestOf('default', { ...f, baseUrl: 'https://proxy.example/v1' }).writeBaseUrl).toBe(true)
    expect(requestOf('default', withProvider(f, 'ollama')).writeBaseUrl).toBe(true)
    expect(requestOf('default', { ...withProvider(f, 'custom'), customName: 'x1', baseUrl: 'https://c.io' }).writeBaseUrl).toBe(true)
  })
  it('previews commands with the key masked', () => {
    const p = previewOf('coder', { ...formFromState(state()), apiKey: 'sk-or-secret-0000', effort: 'high' })
    expect(p.commands).toBe(['hermes -p coder config set OPENROUTER_API_KEY ••••', 'hermes -p coder config set model.provider openrouter', 'hermes -p coder config set model.default a/b', 'hermes -p coder config set agent.reasoning_effort high'].join('\n'))
    expect(p.commands).not.toContain('secret')
  })
  it('reports why there is no plan', () => {
    const p = previewOf('default', { ...formFromState(state()), model: '' })
    expect(p.plan.ok).toBe(false)
    expect(p.commands).toBe('')
  })
})

describe('labels', () => {
  it('describes credentials', () => {
    expect(credLabel('openrouter', { openrouter: 'key' })).toEqual({ text: 'key saved ✓', ok: true })
    expect(credLabel('anthropic', { anthropic: 'none' })).toEqual({ text: 'needs key', ok: false })
    expect(credLabel('nous', { nous: 'oauth' })).toEqual({ text: 'oauth ✓', ok: true })
    expect(credLabel('nous', { nous: 'none' }).text).toBe('not signed in')
    expect(credLabel('ollama', {}).ok).toBe(true)
    expect(credLabel('anthropic', {}).text).toBe('no status')
  })
  it('summarises settings', () => {
    expect(summaryLines('p', 'm', null, null)).toBe('provider: p\nmodel: m\nbase url: (default)\nreasoning: (default)')
  })
  it('explains fetch errors', () => {
    expect(fetchErrorText({ ok: false, error: 'http', status: 401 }, false)).toMatch(/needs a key/)
    expect(fetchErrorText({ ok: false, error: 'http', status: 401 }, true)).toMatch(/refused/)
    expect(fetchErrorText({ ok: false, error: 'http', status: 500, detail: 'oops' }, true)).toMatch(/HTTP 500 \(oops\)/)
    expect(fetchErrorText({ ok: false, error: 'network', detail: 'refused' }, false)).toMatch(/could not reach/)
  })
})
