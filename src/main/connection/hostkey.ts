import { createHash } from 'node:crypto'

export interface KnownKey {
  algo: string
  fingerprint: string
}

export type HostKeyDecision =
  | { kind: 'trusted'; algo: string; fingerprint: string }
  | { kind: 'new'; algo: string; fingerprint: string }
  | { kind: 'changed'; algo: string; fingerprint: string; previous: string }

export function algoOf(blob: Buffer): string {
  const len = blob.readUInt32BE(0)
  return blob.subarray(4, 4 + len).toString('ascii')
}

export function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

export function decideHostKey(known: KnownKey | null, blob: Buffer): HostKeyDecision {
  const algo = algoOf(blob)
  const fingerprint = fingerprintOf(blob)
  if (!known) return { kind: 'new', algo, fingerprint }
  if (known.fingerprint === fingerprint) return { kind: 'trusted', algo, fingerprint }
  return { kind: 'changed', algo, fingerprint, previous: known.fingerprint }
}
