import type { ConnectErrorKind, HostKeyChallenge } from '@shared/ipc'

export class ConnectError extends Error {
  constructor(
    readonly kind: ConnectErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'ConnectError'
  }
}

export class HostKeyError extends Error {
  constructor(readonly challenge: HostKeyChallenge) {
    super(challenge.changed ? 'The host key has changed.' : 'The host key must be verified.')
    this.name = 'HostKeyError'
  }
}

const UNREACHABLE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN'])

export function classifyConnectError(err: { code?: string; level?: string }): ConnectErrorKind {
  if (err.level === 'client-authentication') return 'auth'
  if (err.level === 'client-timeout' || err.code === 'ETIMEDOUT') return 'timeout'
  if (err.code && UNREACHABLE.has(err.code)) return 'unreachable'
  return 'unknown'
}

export function friendlyMessage(kind: ConnectErrorKind, host: string, port: number, raw: string, who?: { key: boolean; username: string }): string {
  switch (kind) {
    case 'unreachable':
      return `Cannot reach ${host}:${port}. Check the address, the port and your network.`
    case 'timeout':
      return `Timed out connecting to ${host}:${port}.`
    case 'auth':
      return who?.key
        ? `The server refused this key. Check that its public key is in ~/.ssh/authorized_keys of ${who.username}.`
        : 'The server rejected the username or password.'
    default:
      return raw
  }
}
