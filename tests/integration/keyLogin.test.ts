import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils, type ParsedKey } from 'ssh2'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectRequest } from '@shared/ipc'
import { loadCollectorScript } from '../../src/main/collector/channel'
import { ConnectionManager } from '../../src/main/connection/manager'
import { fingerprintOf } from '../../src/main/connection/keyFile'
import { MissionSession } from '../../src/main/session'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { makeClientKey, startFakeSsh, type FakeSsh, type HostKeyPair } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { removeDir } from '../helpers/wait'

const secrets = {
  status: () => ({ available: true, reason: null }),
  encrypt: (s: string) => Buffer.from('enc:' + s),
  decrypt: (b: Buffer) => (b.toString().startsWith('enc:') ? b.toString().slice(4) : null)
}

let dir: string
let fx: FixtureDirs
let srv: FakeSsh
const script = loadCollectorScript('collector/mc_collector.py')
const live: MissionSession[] = []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-keylogin-'))
  fx = buildFixture(join(dir, 'fx'))
})
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.disconnect()))
  await srv?.close()
})
afterAll(() => removeDir(dir))

function keyFile(name: string, pair: HostKeyPair): string {
  const f = join(dir, name)
  writeFileSync(f, pair.private)
  return f
}

const fpOf = (pub: string): string => fingerprintOf((utils.parseKey(pub) as ParsedKey).getPublicSSH())

function makeSession(pick: string | null, store = new SettingsStore(':memory:')) {
  const logs: string[] = []
  const manager = new ConnectionManager({ getKnownHost: (h, p) => store.getKnownHost(h, p) }, 5000)
  const session = new MissionSession({
    manager,
    store,
    secrets,
    collectorScript: script,
    send: () => {},
    log: (m) => logs.push(m),
    backoff: () => 50,
    latencyIntervalMs: 200,
    openKeyDialog: async () => pick
  })
  live.push(session)
  return { session, store, logs }
}

const req = (over: Partial<ConnectRequest> = {}): ConnectRequest => ({ host: '127.0.0.1', port: srv.port, username: 'tester', remember: true, ...over })

async function connectTrusting(session: MissionSession, r: ConnectRequest) {
  const first = await session.connect(r)
  if (first.ok) return first
  if (!first.hostKey) return first
  session.trustHostKey(first.hostKey)
  return session.connect(r)
}

describe('SSH key login', () => {
  it('connects with an unencrypted key picked in the dialog and saves the method and path', async () => {
    const pair = makeClientKey()
    const file = keyFile('id_plain', pair)
    srv = await startFakeSsh({ fixture: fx, publicKey: pair.public })
    const { session, store } = makeSession(file)

    const picked = await session.pickKey()
    expect(picked).toEqual({ ok: true, key: { path: file, name: 'id_plain', type: 'ED25519', fingerprint: fpOf(pair.public), encrypted: false, format: 'openssh' } })

    const res = await connectTrusting(session, req({ auth: 'key', keyPath: file }))
    expect(res.ok).toBe(true)
    expect(store.getConnection()).toMatchObject({ authMethod: 'key', keyPath: file, hasSecret: false })
    expect(session.getSaved()!.keyInfo).toMatchObject({ name: 'id_plain', type: 'ED25519' })
  })

  it('asks for the passphrase of an encrypted key, keeps it in the keychain and reuses it on the next launch', async () => {
    const pair = makeClientKey('ed25519', 'correct horse')
    const file = keyFile('id_locked', pair)
    srv = await startFakeSsh({ fixture: fx, publicKey: pair.public })
    const store = new SettingsStore(':memory:')
    const { session } = makeSession(file, store)
    const picked = await session.pickKey()
    expect(picked.ok && picked.key).toMatchObject({ encrypted: true, fingerprint: fpOf(pair.public) })

    expect(await session.connect(req({ auth: 'key', keyPath: file }))).toMatchObject({ ok: false, kind: 'auth', message: 'This key needs its passphrase.' })
    expect(await session.connect(req({ auth: 'key', keyPath: file, passphrase: 'wrong' }))).toMatchObject({ ok: false, kind: 'auth', message: 'The passphrase is wrong.' })
    expect((await connectTrusting(session, req({ auth: 'key', keyPath: file, passphrase: 'correct horse' }))).ok).toBe(true)
    expect(store.getSecretEnc()!.toString()).toBe('enc:correct horse')
    await session.disconnect()

    // the next launch: no dialog, no passphrase typed, the method comes from the saved connection
    const next = makeSession(null, store)
    expect((await next.session.connect(req({ useSaved: true }))).ok).toBe(true)
  })

  it('says when the server refuses the key', async () => {
    const pair = makeClientKey()
    const other = makeClientKey()
    const file = keyFile('id_refused', pair)
    srv = await startFakeSsh({ fixture: fx, publicKey: other.public })
    const { session } = makeSession(file)
    await session.pickKey()
    const res = await connectTrusting(session, req({ auth: 'key', keyPath: file }))
    expect(res).toMatchObject({ ok: false, kind: 'auth' })
    expect(!res.ok && res.message).toContain('refused this key')
    expect(!res.ok && res.message).toContain('~/.ssh/authorized_keys of tester')
  })

  it('refuses a key path that was neither picked nor saved, before any connection', async () => {
    const pair = makeClientKey()
    const file = keyFile('id_unpicked', pair)
    srv = await startFakeSsh({ fixture: fx, publicKey: pair.public })
    const { session } = makeSession(null)
    expect(await session.connect(req({ auth: 'key', keyPath: file }))).toMatchObject({ ok: false, kind: 'auth', message: 'Choose the key file again.' })
    expect(srv.execLog).toEqual([])
  })

  it('logs the key type and fingerprint, never the key or the passphrase', async () => {
    const pair = makeClientKey('ed25519', 'secret phrase 42')
    const file = keyFile('id_logged', pair)
    srv = await startFakeSsh({ fixture: fx, publicKey: pair.public })
    const { session, logs } = makeSession(file)
    await session.pickKey()
    expect((await connectTrusting(session, req({ auth: 'key', keyPath: file, passphrase: 'secret phrase 42' }))).ok).toBe(true)
    const text = logs.join('\n')
    expect(text).toContain(`auth: key ED25519 ${fpOf(pair.public)}`)
    expect(text).not.toContain('secret phrase 42')
    expect(text).not.toContain('PRIVATE KEY')
  })
})
