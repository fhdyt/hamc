import { generateKeyPairSync as nodeKeyPair } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils, type ParsedKey } from 'ssh2'
import { afterAll, describe, expect, it } from 'vitest'
import { KEY_FILE_MAX, PPK3_TEXT, fingerprintOf, inspectKey, keyInfoOf, openSshPublic, readKeyFile, typeLabel } from '../../src/main/connection/keyFile'
import { makeClientKey } from '../helpers/fakeSshServer'
import { removeDir } from '../helpers/wait'

const dir = mkdtempSync(join(tmpdir(), 'mc-keyfile-'))
afterAll(() => removeDir(dir))

const fpOfPublic = (pub: string): string => fingerprintOf((utils.parseKey(pub) as ParsedKey).getPublicSSH())

describe('inspectKey', () => {
  it.each([
    ['ed25519', 'ED25519'],
    ['ecdsa', 'ECDSA'],
    ['rsa', 'RSA']
  ] as const)('reads an unencrypted OpenSSH %s key', (kind, label) => {
    const pair = makeClientKey(kind)
    const r = inspectKey(Buffer.from(pair.private))
    expect(r).toEqual({ ok: true, unlocked: true, facts: { type: label, fingerprint: fpOfPublic(pair.public), encrypted: false, format: 'openssh' } })
  })

  it('reads the type and fingerprint of an encrypted OpenSSH key without its passphrase, then unlocks it', () => {
    const pair = makeClientKey('ed25519', 'open sesame')
    const fp = fpOfPublic(pair.public)
    expect(inspectKey(Buffer.from(pair.private))).toEqual({ ok: true, unlocked: false, facts: { type: 'ED25519', fingerprint: fp, encrypted: true, format: 'openssh' } })
    expect(inspectKey(Buffer.from(pair.private), 'open sesame')).toEqual({ ok: true, unlocked: true, facts: { type: 'ED25519', fingerprint: fp, encrypted: true, format: 'openssh' } })
    expect(inspectKey(Buffer.from(pair.private), 'wrong')).toMatchObject({ ok: false, problem: 'bad-passphrase', message: 'The passphrase is wrong.' })
  })

  it('reads PEM RSA keys, encrypted ones only after the passphrase', () => {
    const plain = nodeKeyPair('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } })
    expect(inspectKey(Buffer.from(plain.privateKey))).toMatchObject({ ok: true, unlocked: true, facts: { type: 'RSA', encrypted: false, format: 'pem' } })
    const locked = nodeKeyPair('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-128-cbc', passphrase: 'pem pass' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
    })
    expect(inspectKey(Buffer.from(locked.privateKey))).toEqual({ ok: true, unlocked: false, facts: { type: 'encrypted', fingerprint: null, encrypted: true, format: 'pem' } })
    const opened = inspectKey(Buffer.from(locked.privateKey), 'pem pass')
    expect(opened).toMatchObject({ ok: true, unlocked: true, facts: { type: 'RSA', encrypted: true, format: 'pem' } })
    expect(opened.ok && opened.facts.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
    expect(inspectKey(Buffer.from(locked.privateKey), 'nope')).toMatchObject({ ok: false, problem: 'bad-passphrase' })
  })

  it('refuses what is not a private key', () => {
    const pair = makeClientKey()
    const pkcs8 = nodeKeyPair('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
    for (const text of [pair.public, 'hello world', pkcs8.privateKey, '']) {
      expect(inspectKey(Buffer.from(text))).toMatchObject({ ok: false, problem: 'not-a-key', message: 'This file is not a private key.' })
    }
  })

  it('explains PuTTY keys in the newer format', () => {
    const ppk3 = 'PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: me\nPublic-Lines: 2\nAAAA\nBBBB\n'
    expect(inspectKey(Buffer.from(ppk3))).toEqual({ ok: false, problem: 'ppk3', message: PPK3_TEXT })
  })
})

describe('helpers', () => {
  it('labels key types', () => {
    expect(typeLabel('ssh-ed25519')).toBe('ED25519')
    expect(typeLabel('ecdsa-sha2-nistp384')).toBe('ECDSA')
    expect(typeLabel('ssh-rsa')).toBe('RSA')
    expect(typeLabel('ssh-dss')).toBe('DSA')
  })

  it('reads nothing from a broken OpenSSH header', () => {
    expect(openSshPublic('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----')).toBeNull()
  })

  it('names the key after its file', () => {
    const facts = { type: 'ED25519', fingerprint: 'SHA256:x', encrypted: false, format: 'openssh' as const }
    expect(keyInfoOf(join(dir, 'id_ed25519'), facts)).toEqual({ ...facts, path: join(dir, 'id_ed25519'), name: 'id_ed25519' })
  })
})

describe('readKeyFile', () => {
  it('reads a small file', () => {
    const f = join(dir, 'k')
    writeFileSync(f, 'abc')
    expect(readKeyFile(f)).toEqual({ ok: true, data: Buffer.from('abc') })
  })

  it('refuses a missing path, a folder and a big file', () => {
    expect(readKeyFile(join(dir, 'missing'))).toMatchObject({ ok: false, reason: 'unreadable' })
    const sub = join(dir, 'folder')
    mkdirSync(sub)
    expect(readKeyFile(sub)).toMatchObject({ ok: false, reason: 'unreadable' })
    const big = join(dir, 'big')
    writeFileSync(big, Buffer.alloc(KEY_FILE_MAX + 1, 65))
    expect(readKeyFile(big)).toMatchObject({ ok: false, reason: 'too-big' })
  })
})
