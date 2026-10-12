import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AgentFileService, sha256 } from '../../src/main/agentcfg/files'
import { ConnectionManager } from '../../src/main/connection/manager'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
let mgr: ConnectionManager
let svc: AgentFileService

const HOME = '/home/hermes/.hermes'
const local = (...p: string[]): string => join(fx.home, ...p)

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mc-af-'))
  fx = buildFixture(join(dir, 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
afterAll(async () => {
  await srv.close()
  removeDir(dir)
})
beforeEach(async () => {
  mgr = new ConnectionManager({ getKnownHost: () => ({ algo: 'ssh-ed25519', fingerprint: srv.fingerprint }) }, 5000)
  await mgr.connect({ host: '127.0.0.1', port: srv.port, username: 'tester', password: 'test-pass-123' })
  svc = new AgentFileService({ conn: mgr, home: () => HOME, random: () => 'abc123' })
  srv.sftpLog.length = 0
  writeFileSync(local('SOUL.md'), 'soul\n')
  writeFileSync(local('memories', 'MEMORY.md'), 'm\n')
})
afterEach(async () => {
  await mgr.disconnect()
})

describe('read', () => {
  it('returns text, hash and mtime of an existing file', async () => {
    const r = await svc.read('default', 'soul')
    expect(r.ok && r.file).toMatchObject({ exists: true, text: 'soul\n', hash: sha256('soul\n') })
    expect(r.ok && r.file.mtime).toBeGreaterThan(0)
  })

  it('reads a profile under profiles/', async () => {
    writeFileSync(local('profiles', 'atlas', 'SOUL.md'), 'I am atlas')
    const r = await svc.read('atlas', 'soul')
    expect(r.ok && r.file.text).toBe('I am atlas')
  })

  it('reports a missing file as not existing', async () => {
    const r = await svc.read('scout', 'user')
    expect(r).toEqual({ ok: true, file: { exists: false, text: '', hash: null, mtime: null } })
  })

  it('refuses a bad profile name and a file that is too large', async () => {
    expect(await svc.read('../etc', 'soul')).toEqual({ ok: false, error: 'bad-profile' })
    writeFileSync(local('SOUL.md'), 'x'.repeat(300 * 1024))
    expect(await svc.read('default', 'soul')).toEqual({ ok: false, error: 'too-large' })
  })

  it('is not-connected without a home', async () => {
    const s = new AgentFileService({ conn: mgr, home: () => null })
    expect(await s.read('default', 'soul')).toEqual({ ok: false, error: 'not-connected' })
  })
})

describe('write', () => {
  it('replaces the file through a temp file in the same folder and leaves nothing behind', async () => {
    const r = await svc.write('default', 'soul', 'new soul\n', sha256('soul\n'))
    expect(r.ok && r.file).toMatchObject({ text: 'new soul\n', hash: sha256('new soul\n') })
    expect(readFileSync(local('SOUL.md'), 'utf8')).toBe('new soul\n')
    expect(readdirSync(local()).filter((n) => n.includes('.mc-'))).toEqual([])
    const ops = srv.sftpLog
    const open = ops.find((o) => o.op === 'open' && o.path.includes('.SOUL.md.mc-abc123'))
    expect(open).toBeTruthy()
    expect(ops.find((o) => o.op === 'rename')).toMatchObject({ path: `${HOME}/.SOUL.md.mc-abc123`, to: `${HOME}/SOUL.md` })
  })

  it('keeps the permission bits of the original', async () => {
    const mode = statSync(local('SOUL.md')).mode & 0o777
    await svc.write('default', 'soul', 'x', sha256('soul\n'))
    expect(srv.sftpLog.find((o) => o.op === 'chmod')?.mode).toBe(mode)
  })

  it('does not write when the file changed since the editor loaded it', async () => {
    writeFileSync(local('memories', 'MEMORY.md'), 'the agent wrote this\n')
    const r = await svc.write('default', 'memory', 'mine\n', sha256('m\n'))
    expect(r.ok).toBe(false)
    if (r.ok || r.error !== 'conflict') throw new Error('expected a conflict')
    expect(r.theirs).toMatchObject({ exists: true, text: 'the agent wrote this\n' })
    expect(readFileSync(local('memories', 'MEMORY.md'), 'utf8')).toBe('the agent wrote this\n')
    expect(srv.sftpLog.some((o) => o.op === 'open' && o.path.includes('.mc-'))).toBe(false)
  })

  it('is a conflict when the file was deleted behind the editor', async () => {
    const r = await svc.write('scout', 'soul', 'x', sha256('gone'))
    expect(r).toMatchObject({ ok: false, error: 'conflict', theirs: { exists: false } })
  })

  it('creates a file that did not exist (base hash null), and the memories folder', async () => {
    const r = await svc.write('atlas', 'memory', 'first memory', null)
    expect(r.ok).toBe(true)
    expect(readFileSync(local('profiles', 'atlas', 'memories', 'MEMORY.md'), 'utf8')).toBe('first memory')
    expect(srv.sftpLog.find((o) => o.op === 'mkdir')?.mode).toBe(0o755)
    expect(srv.sftpLog.find((o) => o.op === 'chmod')?.mode).toBe(0o600)
  })

  it('refuses text over the Hermes limit before touching the server', async () => {
    const r = await svc.write('default', 'memory', 'x'.repeat(2201), sha256('m\n'))
    expect(r).toMatchObject({ ok: false, error: 'too-long' })
    expect(srv.sftpLog).toEqual([])
    expect(readFileSync(local('memories', 'MEMORY.md'), 'utf8')).toBe('m\n')
  })

  it('allows exactly the limit and writes unicode intact', async () => {
    const text = 'é'.repeat(1375)
    const r = await svc.write('default', 'user', text, sha256('u\n'))
    expect(r.ok).toBe(true)
    expect(readFileSync(local('memories', 'USER.md'), 'utf8')).toBe(text)
  })

  it('does nothing when the text is already the file', async () => {
    const r = await svc.write('default', 'soul', 'soul\n', sha256('soul\n'))
    expect(r.ok).toBe(true)
    expect(srv.sftpLog.filter((o) => o.op !== 'open' || o.path.includes('.mc-'))).toEqual([])
  })

  it('fails without a profile folder and cleans up', async () => {
    const r = await svc.write('ghost', 'soul', 'x', null)
    expect(r.ok).toBe(false)
    expect(existsSync(local('profiles', 'ghost'))).toBe(false)
  })
})
