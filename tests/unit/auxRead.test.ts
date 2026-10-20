import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AUX_READ_PY } from '../../src/main/agentcfg/auxService'
import { pythonExe } from '../helpers/fixture'

// The read script runs with Hermes's Python on the VPS; here it runs with the test Python when PyYAML is there.
const hasYaml = (() => {
  try {
    execFileSync(pythonExe, ['-c', 'import yaml'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const dir = mkdtempSync(join(tmpdir(), 'mc-aux-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const read = (path: string): { ok: boolean; slots?: Record<string, { provider: string; model: string; baseUrl: string; hasKey: boolean }>; error?: string } =>
  JSON.parse(execFileSync(pythonExe, ['-c', AUX_READ_PY, path], { encoding: 'utf-8' }).trim())

describe.skipIf(!hasYaml)('AUX_READ_PY (v2)', () => {
  it('prints provider, model, base URL and whether a key is set, never the key', () => {
    const file = join(dir, 'config.yaml')
    writeFileSync(
      file,
      [
        'model:',
        '  provider: openrouter',
        '  api_key: sk-main-SECRET',
        'auxiliary:',
        '  vision:',
        '    provider: openrouter',
        '    model: google/gemini-2.5-flash',
        '    api_key: sk-vision-SECRET',
        '  compression:',
        '    provider: auto',
        "    model: ''",
        '    base_url: http://proxy.local/v1',
        '  web_extract:',
        '    provider: x',
        ''
      ].join('\n')
    )
    const raw = execFileSync(pythonExe, ['-c', AUX_READ_PY, file], { encoding: 'utf-8' })
    expect(raw).not.toContain('SECRET')
    const r = read(file)
    expect(r.ok).toBe(true)
    expect(r.slots!.vision).toEqual({ provider: 'openrouter', model: 'google/gemini-2.5-flash', baseUrl: '', hasKey: true })
    expect(r.slots!.compression).toEqual({ provider: 'auto', model: '', baseUrl: 'http://proxy.local/v1', hasKey: false })
    expect(r.slots!.curator).toEqual({ provider: 'auto', model: '', baseUrl: '', hasKey: false })
    expect(Object.keys(r.slots!)).toHaveLength(18)
    expect(r.slots!['web_extract']).toBeUndefined()
  })

  it('treats a missing config as all auto, and a broken one as failed', () => {
    expect(read(join(dir, 'nope.yaml')).slots!.vision!.provider).toBe('auto')
    const bad = join(dir, 'bad.yaml')
    writeFileSync(bad, 'a: [1,\n')
    expect(read(bad)).toMatchObject({ ok: false, error: 'failed' })
  })
})
