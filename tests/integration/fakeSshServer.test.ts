import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildCommand } from '../../src/main/connection/quote'
import { parseEventLine } from '@shared/events'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-fake-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
afterAll(async () => {
  await srv.close()
  removeDir(dir)
})

function run(argv: string[], stdin?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const c = new Client()
    c.on('ready', () => {
      c.exec(buildCommand(argv), (e, stream) => {
        if (e) return reject(e)
        let out = ''
        let err = ''
        stream.on('data', (d: Buffer) => (out += d))
        stream.stderr.on('data', (d: Buffer) => (err += d))
        stream.on('close', (code: number) => {
          c.end()
          resolve({ code, out, err })
        })
        stream.end(stdin ?? '')
      })
    })
    c.on('error', reject)
    c.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
  })
}

describe('fake ssh server', () => {
  it('rejects a wrong password', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const c = new Client()
        c.on('ready', () => resolve('ready'))
        c.on('error', reject)
        c.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'nope' })
      })
    ).rejects.toThrow(/authentication/i)
  })

  it('exposes a sha256 fingerprint of its host key', () => {
    expect(srv.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it('echoes hostile argv through the quoting round trip', async () => {
    const argv = ['__echo__', "it's", '$(id)', 'a b']
    const r = await run(argv)
    expect(JSON.parse(r.out)).toEqual(argv.slice(1))
  })

  it('answers the preflight probes', async () => {
    expect((await run(['sh', '-c', 'printf %s "${HERMES_HOME:-$HOME/.hermes}"'])).out).toBe('/home/hermes/.hermes')
    expect((await run(['/home/hermes/.local/bin/hermes', '--version'])).out).toContain('0.21.6')
    expect((await run(['/home/hermes/.local/bin/hermes', 'cron', 'runs', '--help'])).code).toBe(0)
    expect((await run(['nonexistent'])).code).toBe(127)
  })

  it('runs the real collector from stdin against the fixture', async () => {
    const script = readFileSync('collector/mc_collector.py', 'utf8')
    const r = await run(['/usr/bin/python3', '-u', '-', '/home/hermes/.hermes', '--ticks', '2', '--interval', '0.05'], script)
    expect(r.code).toBe(0)
    const events = r.out.trim().split('\n').map((l) => parseEventLine(l))
    expect(events.every((e) => e.ok)).toBe(true)
    expect(events.map((e) => (e.ok ? e.event.type : ''))[0]).toBe('agents')
  })
})
