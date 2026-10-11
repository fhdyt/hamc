import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { algoOf, decideHostKey, fingerprintOf } from '../../src/main/connection/hostkey'

function blob(algo: string, key: Buffer): Buffer {
  const a = Buffer.from(algo, 'ascii')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(a.length)
  const klen = Buffer.alloc(4)
  klen.writeUInt32BE(key.length)
  return Buffer.concat([head, a, klen, key])
}

const b = blob('ssh-ed25519', Buffer.alloc(32, 7))
const expected = 'SHA256:' + createHash('sha256').update(b).digest('base64').replace(/=+$/, '')

describe('host key helpers', () => {
  it('reads the algorithm from the key blob', () => {
    expect(algoOf(b)).toBe('ssh-ed25519')
  })

  it('fingerprints like ssh-keygen (sha256, unpadded base64)', () => {
    expect(fingerprintOf(b)).toBe(expected)
    expect(fingerprintOf(b)).not.toMatch(/=/)
  })

  it('trusts a matching known key', () => {
    expect(decideHostKey({ algo: 'ssh-ed25519', fingerprint: expected }, b)).toEqual({
      kind: 'trusted',
      algo: 'ssh-ed25519',
      fingerprint: expected
    })
  })

  it('reports a new host', () => {
    expect(decideHostKey(null, b)).toEqual({ kind: 'new', algo: 'ssh-ed25519', fingerprint: expected })
  })

  it('reports a changed key with the previous fingerprint', () => {
    expect(decideHostKey({ algo: 'ssh-ed25519', fingerprint: 'SHA256:old' }, b)).toEqual({
      kind: 'changed',
      algo: 'ssh-ed25519',
      fingerprint: expected,
      previous: 'SHA256:old'
    })
  })
})
