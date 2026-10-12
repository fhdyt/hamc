import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ModelSaveRequest } from '@shared/agentCfg'
import { ModelService } from '../../src/main/agentcfg/model'
import { ConnectionManager } from '../../src/main/connection/manager'
import { CONFIG_SET_HELP_PLAIN } from '../helpers/fakeHermes'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
let mgr: ConnectionManager
let api: Server
let apiUrl: string
const seen: { auth: string | undefined; path: string | undefined }[] = []

const HERMES = '/home/hermes/.local/bin/hermes'
const PYTHON = '/usr/bin/python3'

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-am-'))
  fx = buildFixture(join(dir, 'fx'))
  api = createServer((req, res) => {
    seen.push({ auth: req.headers.authorization, path: req.url })
    if (req.url === '/v1/models') {
      if (req.headers.authorization !== 'Bearer good-key-123') {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'm-big', context_length: 200000 }, { id: 'm-small' }] }))
      return
    }
    if (req.url === '/open/models') {
      res.writeHead(200).end(JSON.stringify(['plain-a', 'plain-b']))
      return
    }
    if (req.url === '/html/models') {
      res.writeHead(200).end('<html>nope</html>')
      return
    }
    res.writeHead(404).end('no')
  })
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r))
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
})
afterAll(async () => {
  api.close()
  removeDir(dir)
})

let svc: ModelService
const logs: string[] = []

async function connect(opts: Parameters<typeof startFakeSsh>[0] extends infer O ? Partial<O> : never = {}) {
  srv = await startFakeSsh({ fixture: fx, ...opts })
  mgr = new ConnectionManager({ getKnownHost: () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint }) }, 5000)
  await mgr.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
  svc = new ModelService({ conn: mgr, hermes: () => ({ path: HERMES, python: PYTHON }), isConnected: () => mgr.isConnected(), log: (m) => logs.push(m) })
}
beforeEach(() => {
  seen.length = 0
  logs.length = 0
})
afterEach(async () => {
  await mgr?.disconnect()
  await srv?.close()
})

const req = (over: Partial<ModelSaveRequest> = {}): ModelSaveRequest => ({
  profile: 'default',
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'anthropic/claude-opus',
  writeBaseUrl: false,
  ...over
})

describe('read', () => {
  it('returns the model, effort and credentials', async () => {
    await connect({ models: { atlas: { provider: 'anthropic', default: 'claude-x' } } })
    const r = await svc.read('atlas')
    expect(r).toMatchObject({ ok: true, state: { provider: 'anthropic', model: 'claude-x', effort: null } })
    expect(r.ok && r.state.creds).toMatchObject({ openrouter: 'key', anthropic: 'none', nous: 'none' })
  })

  it('rejects a bad profile and reports not-connected', async () => {
    await connect()
    expect(await svc.read('a b')).toEqual({ ok: false, error: 'bad-profile' })
    const off = new ModelService({ conn: mgr, hermes: () => null, isConnected: () => true })
    expect(await off.read('default')).toEqual({ ok: false, error: 'not-connected' })
  })
})

describe('save', () => {
  it('sets provider and model, then reads them back', async () => {
    await connect()
    const r = await svc.save(req({ profile: 'atlas', effort: 'high' }))
    expect(r).toMatchObject({ ok: true, warnings: [], state: { provider: 'openrouter', model: 'anthropic/claude-opus', effort: 'high' } })
    expect(srv.hermes.config.get('atlas')).toEqual({ 'model.provider': 'openrouter', 'model.default': 'anthropic/claude-opus', 'agent.reasoning_effort': 'high' })
    const sets = srv.execLog.filter((a) => a.includes('set')).map((a) => a.slice(1).join(' '))
    expect(sets).toContain('-p atlas config set model.default anthropic/claude-opus')
  })

  it('sends the key on stdin when config set offers --stdin, and never in the arguments or logs', async () => {
    await connect()
    const r = await svc.save(req({ apiKey: 'sk-or-very-secret-1' }))
    expect(r.ok).toBe(true)
    expect(srv.hermes.env.get('default')).toEqual({ OPENROUTER_API_KEY: 'sk-or-very-secret-1' })
    expect(srv.hermes.keyVia).toEqual(['stdin'])
    expect(JSON.stringify(srv.execLog)).not.toContain('sk-or-very-secret-1')
    expect(logs.join('\n')).not.toContain('sk-or-very-secret-1')
  })

  it('falls back to an argument when there is no stdin option', async () => {
    await connect({ configSetHelp: CONFIG_SET_HELP_PLAIN })
    expect(await svc.keyTravelsAsArgument()).toBe(true)
    const r = await svc.save(req({ apiKey: 'sk-or-very-secret-1' }))
    expect(r.ok).toBe(true)
    expect(srv.hermes.keyVia).toEqual(['argument'])
    expect(logs.join('\n')).not.toContain('sk-or-very-secret-1')
  })

  it('defines a custom provider with its key variable and base url', async () => {
    await connect()
    const r = await svc.save(req({ provider: 'custom', customName: 'my-proxy', baseUrl: 'https://llm.example.com/v1', model: 'big', apiKey: 'proxy-key-9999' }))
    expect(r).toMatchObject({ ok: true, warnings: [] })
    const c = srv.hermes.config.get('default')!
    expect(c).toMatchObject({
      'providers.my-proxy.api': 'https://llm.example.com/v1',
      'providers.my-proxy.key_env': 'MY_PROXY_API_KEY',
      'model.provider': 'my-proxy',
      'model.default': 'big',
      'model.base_url': 'https://llm.example.com/v1'
    })
    expect(srv.hermes.env.get('default')).toEqual({ MY_PROXY_API_KEY: 'proxy-key-9999' })
    const after = await svc.read('default')
    expect(after.ok && after.state.creds['my-proxy']).toBe('key')
  })

  it('stops at the first failing step, shows Hermes’s message without the key', async () => {
    await connect()
    srv.hermes.failOn['model.default'] = 'invalid value, key was sk-or-very-secret-1'
    const r = await svc.save(req({ apiKey: 'sk-or-very-secret-1' }))
    expect(r).toMatchObject({ ok: false, error: 'failed', step: 2 })
    expect(r.ok === false && r.detail).toBe('invalid value, key was ••••')
    expect(srv.hermes.config.get('default')?.['model.provider']).toBe('openrouter')
  })

  it('refuses an invalid request without running anything', async () => {
    await connect()
    const before = srv.execLog.length
    const r = await svc.save(req({ model: 'bad model' }))
    expect(r).toMatchObject({ ok: false, error: 'bad-request' })
    expect(srv.execLog.length).toBe(before)
  })

  it('warns when Hermes reports something else than what was saved', async () => {
    const stub = {
      async exec(argv: readonly string[]) {
        const get = argv.includes('get') && argv.includes('model')
        return { code: 0, stdout: get ? '{"provider":"anthropic","default":"other"}' : '', stderr: '' }
      }
    }
    const s = new ModelService({ conn: stub, hermes: () => ({ path: HERMES, python: PYTHON }), isConnected: () => true })
    const r = await s.save(req({ model: 'wanted' }))
    expect(r.ok && r.warnings).toEqual(['Hermes reports the model as other, not wanted.', 'Hermes reports the provider as anthropic, not openrouter.'])
  })
})

describe('fetch models', () => {
  it('lists models from the server with the key on stdin', async () => {
    await connect()
    const r = await svc.fetchModels({ baseUrl: `${apiUrl}/v1`, apiKey: 'good-key-123' })
    expect(r).toEqual({
      ok: true,
      models: [
        { id: 'm-big', ctx: 200000 },
        { id: 'm-small', ctx: null }
      ]
    })
    expect(seen[0]).toEqual({ auth: 'Bearer good-key-123', path: '/v1/models' })
    expect(JSON.stringify(srv.execLog)).not.toContain('good-key-123')
  })

  it('reports the status when the key is wrong, without the key', async () => {
    await connect()
    const r = await svc.fetchModels({ baseUrl: `${apiUrl}/v1`, apiKey: 'bad-key-0000' })
    expect(r).toMatchObject({ ok: false, error: 'http', status: 401 })
  })

  it('works without a key and with a bare list', async () => {
    await connect()
    const r = await svc.fetchModels({ baseUrl: `${apiUrl}/open` })
    expect(r.ok && r.models.map((m) => m.id)).toEqual(['plain-a', 'plain-b'])
    expect(seen[0]!.auth).toBeUndefined()
  })

  it('handles an answer that is not JSON and an unreachable server', async () => {
    await connect()
    expect(await svc.fetchModels({ baseUrl: `${apiUrl}/html` })).toMatchObject({ ok: false, error: 'invalid' })
    expect(await svc.fetchModels({ baseUrl: 'http://127.0.0.1:1/v1' })).toMatchObject({ ok: false, error: 'network' })
  })

  it('refuses a url that is not http(s) before running anything', async () => {
    await connect()
    const before = srv.execLog.length
    expect(await svc.fetchModels({ baseUrl: 'file:///etc/passwd' })).toMatchObject({ ok: false, error: 'bad-request' })
    expect(srv.execLog.length).toBe(before)
  })
})

describe('test and restart', () => {
  it('tests the saved model with a one-line chat and reports the latency', async () => {
    await connect()
    const r = await svc.test('default')
    expect(r.ok).toBe(true)
    expect(r.ms).toBeGreaterThan(0)
    const cmd = srv.execLog.find((a) => a.includes('chat'))!
    expect(cmd).toEqual(expect.arrayContaining(['chat', '-q', 'Reply with OK', '-Q']))
  })

  it('reports a failed test with Hermes’s message', async () => {
    const stub = { async exec() { return { code: 2, stdout: '', stderr: 'Error: provider authentication failed' + String.fromCharCode(10) } } }
    const s = new ModelService({ conn: stub, hermes: () => ({ path: HERMES, python: PYTHON }), isConnected: () => true })
    expect(await s.test('default')).toMatchObject({ ok: false, detail: 'Error: provider authentication failed' })
    const quiet = { async exec() { return { code: 0, stdout: '   ', stderr: '' } } }
    const q = new ModelService({ conn: quiet, hermes: () => ({ path: HERMES, python: PYTHON }), isConnected: () => true })
    expect(await q.test('default')).toMatchObject({ ok: false, detail: 'The model gave no answer.' })
  })

  it('restarts only the gateway of that profile', async () => {
    await connect()
    expect(await svc.restartGateway('atlas')).toMatchObject({ ok: true })
    expect(srv.hermes.restarts).toEqual(['atlas'])
    expect(srv.execLog.at(-1)).toEqual([HERMES, '-p', 'atlas', 'gateway', 'restart'])
    expect(await svc.restartGateway('a;b')).toMatchObject({ ok: false })
  })
})
