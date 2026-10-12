import { describe, expect, it } from 'vitest'
import { FETCH_MODELS_PY } from '../../src/main/agentcfg/fetchScript'
import { parseEffort, parseFetchOutput, parseModelConfig, parseStatus, supportsStdinFlag } from '../../src/main/agentcfg/parse'

describe('parseModelConfig', () => {
  it('reads the model block', () => {
    expect(parseModelConfig('{"provider":"openrouter","default":"anthropic/claude-sonnet","base_url":"https://x.io/v1"}')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet',
      baseUrl: 'https://x.io/v1'
    })
  })
  it('reads a config with a nested model block', () => {
    expect(parseModelConfig('{"model":{"provider":"anthropic","default":"claude-x"},"agent":{}}')).toEqual({ provider: 'anthropic', model: 'claude-x', baseUrl: null })
  })
  it('reads a model name given as a string, in JSON or plain', () => {
    expect(parseModelConfig('"gpt-x"')).toEqual({ provider: null, model: 'gpt-x', baseUrl: null })
    expect(parseModelConfig('gpt-x\n')).toEqual({ provider: null, model: 'gpt-x', baseUrl: null })
    expect(parseModelConfig('{"provider":"p","model":"m"}')).toEqual({ provider: 'p', model: 'm', baseUrl: null })
  })
  it('gives up on nothing useful', () => {
    expect(parseModelConfig('')).toBeNull()
    expect(parseModelConfig('{}')).toBeNull()
    expect(parseModelConfig('[1,2]')).toBeNull()
    expect(parseModelConfig('Error: no such key here')).toBeNull()
  })
})

describe('parseEffort', () => {
  it('accepts a JSON string, plain text and an object', () => {
    expect(parseEffort('"high"')).toBe('high')
    expect(parseEffort('medium\n')).toBe('medium')
    expect(parseEffort('{"value":"low"}')).toBe('low')
    expect(parseEffort('null')).toBeNull()
    expect(parseEffort('')).toBeNull()
  })
})

describe('parseStatus', () => {
  it('finds providers with a credential and without', () => {
    const t = ['Hermes Agent status', 'Providers:', '  openrouter: ✓ configured', '  anthropic: not configured', '  nous: logged in (OAuth)', '  ollama - none'].join('\n')
    const r = parseStatus(t)
    expect(r.openrouter).toBe('key')
    expect(r.anthropic).toBe('none')
    expect(r.nous).toBe('oauth')
    expect(r.ollama).toBe('none')
  })
  it('strips colour codes and bullets', () => {
    expect(parseStatus('\u001b[32m● openrouter  ✓ set\u001b[0m')).toEqual({ openrouter: 'key' })
  })
  it('says nothing about lines it cannot judge', () => {
    expect(parseStatus('openrouter: something odd\nVersion: 0.21')).toEqual({})
  })
})

describe('key delivery', () => {
  it('only trusts an explicit --stdin flag', () => {
    expect(supportsStdinFlag('usage: hermes config set [--stdin] KEY')).toBe(true)
    expect(supportsStdinFlag('usage: hermes config set KEY VALUE')).toBe(false)
    expect(supportsStdinFlag('value may be - to read stdin')).toBe(false)
  })
})

describe('parseFetchOutput', () => {
  it('sorts models and drops junk', () => {
    const r = parseFetchOutput('{"ok":true,"status":200,"models":[{"id":"b","ctx":8192},{"id":"a","ctx":null},{"nope":1},{"id":"c","ctx":-5}]}\n')
    expect(r).toEqual({
      ok: true,
      models: [
        { id: 'a', ctx: null },
        { id: 'b', ctx: 8192 },
        { id: 'c', ctx: null }
      ]
    })
  })
  it('passes an error with status and detail', () => {
    expect(parseFetchOutput('{"ok":false,"error":"http","status":401,"detail":"Unauthorized"}')).toEqual({ ok: false, error: 'http', status: 401, detail: 'Unauthorized' })
  })
  it('flags output that is not the script’s', () => {
    expect(parseFetchOutput('Traceback...')).toEqual({ ok: false, error: 'invalid' })
    expect(parseFetchOutput('')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('fetch script', () => {
  it('is ASCII only and never prints the key', () => {
    expect(/^[\x00-\x7f]*$/.test(FETCH_MODELS_PY)).toBe(true)
    expect(FETCH_MODELS_PY).not.toMatch(/print\(.*key/)
  })
})
