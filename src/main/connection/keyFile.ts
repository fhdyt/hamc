import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { utils, type ParsedKey } from 'ssh2'
import type { KeyFacts, KeyFormat, KeyInfo, KeyProblem } from '@shared/ipc'

/** A private key is a few KiB; anything bigger is not one (and is not read into memory). */
export const KEY_FILE_MAX = 64 * 1024

export const PPK3_TEXT = "This key is in PuTTY's newer format. Export it from PuTTYgen as an OpenSSH key (Conversions → Export OpenSSH key)."

export type KeyRead = { ok: true; data: Buffer } | { ok: false; reason: 'unreadable' | 'too-big'; message: string }

/** `unlocked`: ssh2 can sign with the key as given (always true for a key without a passphrase). */
export type KeyCheck = { ok: true; facts: KeyFacts; unlocked: boolean } | { ok: false; problem: KeyProblem; message: string }

const NOT_A_KEY: KeyCheck = { ok: false, problem: 'not-a-key', message: 'This file is not a private key.' }
const PEM_RE = /^-----BEGIN (RSA|DSA|EC) PRIVATE KEY-----/
const OPENSSH_MAGIC = 'openssh-key-v1\0'

/** Reads a key file the user picked. Links are followed, as ssh does; only a regular file of at most 64 KiB is read. */
export function readKeyFile(path: string): KeyRead {
  try {
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, reason: 'unreadable', message: `This is not a file: ${path}` }
    if (st.size > KEY_FILE_MAX) return { ok: false, reason: 'too-big', message: 'This file is too big to be a private key.' }
    return { ok: true, data: readFileSync(path) }
  } catch {
    return { ok: false, reason: 'unreadable', message: `The key file was not found or cannot be read: ${path}` }
  }
}

function formatOf(text: string): KeyFormat | 'ppk3' | null {
  if (text.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) return 'openssh'
  if (PEM_RE.test(text)) return 'pem'
  if (text.startsWith('PuTTY-User-Key-File-2:')) return 'ppk'
  if (/^PuTTY-User-Key-File-\d+:/.test(text)) return 'ppk3'
  return null
}

// ssh2 returns an array for OpenSSH files that hold several keys; the first one is the key
const first = (k: ParsedKey | ParsedKey[] | Error): ParsedKey | Error | undefined => (Array.isArray(k) ? k[0] : k)

export function typeLabel(sshType: string): string {
  if (sshType === 'ssh-ed25519') return 'ED25519'
  if (sshType.startsWith('ecdsa-')) return 'ECDSA'
  if (sshType === 'ssh-rsa') return 'RSA'
  if (sshType === 'ssh-dss') return 'DSA'
  return sshType.toUpperCase()
}

/** Same format as the host key fingerprint: SHA-256 of the public key blob, base64 without padding. */
export function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

function usable(k: ParsedKey | Error | undefined, encrypted: boolean, format: KeyFormat): KeyCheck {
  if (!k || k instanceof Error || !k.isPrivateKey()) return NOT_A_KEY
  return { ok: true, unlocked: true, facts: { type: typeLabel(k.type), fingerprint: fingerprintOf(k.getPublicSSH()), encrypted, format } }
}

/**
 * The public key of an OpenSSH private key file, read from its unencrypted header (magic, cipher, kdf, kdf options,
 * key count, then the public key), so an encrypted key can be shown before its passphrase is typed.
 */
export function openSshPublic(text: string): { type: string; fingerprint: string } | null {
  const body = text.replace(/-----(BEGIN|END) OPENSSH PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const buf = Buffer.from(body, 'base64')
  if (buf.length < OPENSSH_MAGIC.length || buf.toString('latin1', 0, OPENSSH_MAGIC.length) !== OPENSSH_MAGIC) return null
  let at = OPENSSH_MAGIC.length
  const str = (from: Buffer): Buffer | null => {
    if (at + 4 > from.length) return null
    const n = from.readUInt32BE(at)
    at += 4
    if (at + n > from.length) return null
    const s = from.subarray(at, at + n)
    at += n
    return s
  }
  if (!str(buf) || !str(buf) || !str(buf)) return null
  if (at + 4 > buf.length) return null
  at += 4
  const pub = str(buf)
  if (!pub || pub.length === 0) return null
  at = 0
  const type = str(pub)
  if (!type || type.length === 0) return null
  return { type: typeLabel(type.toString('latin1')), fingerprint: fingerprintOf(pub) }
}

/** What a key file is and whether it can be used with this passphrase. Nothing of the key leaves this function but facts. */
export function inspectKey(data: Buffer, passphrase?: string): KeyCheck {
  const text = data.toString('utf8').trim()
  const format = formatOf(text)
  if (format === 'ppk3') return { ok: false, problem: 'ppk3', message: PPK3_TEXT }
  if (format === null) return NOT_A_KEY
  const bare = first(utils.parseKey(text))
  const encrypted = bare instanceof Error && /no passphrase given/.test(bare.message)
  if (!encrypted) return usable(bare, false, format)
  const header = format === 'openssh' ? openSshPublic(text) : null
  const locked: KeyFacts = { type: header?.type ?? 'encrypted', fingerprint: header?.fingerprint ?? null, encrypted: true, format }
  if (!passphrase) return { ok: true, facts: locked, unlocked: false }
  const opened = first(utils.parseKey(text, passphrase))
  if (!opened || opened instanceof Error || !opened.isPrivateKey()) return { ok: false, problem: 'bad-passphrase', message: 'The passphrase is wrong.' }
  return usable(opened, true, format)
}

export function keyInfoOf(path: string, facts: KeyFacts): KeyInfo {
  return { ...facts, path, name: basename(path) }
}
