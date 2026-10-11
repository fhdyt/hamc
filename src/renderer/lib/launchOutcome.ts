import type { ConnectErrorKind } from '@shared/ipc'

export type Outcome = 'dashboard-offline' | 'connect-edit' | 'connect-hostkey' | 'connect-error'

export function launchOutcome(kind: ConnectErrorKind): Outcome {
  if (kind === 'unreachable' || kind === 'timeout') return 'dashboard-offline'
  if (kind === 'auth') return 'connect-edit'
  if (kind === 'hostkey-changed' || kind === 'hostkey-unverified') return 'connect-hostkey'
  return 'connect-error'
}

export function startupPct(steps: readonly { state: string }[]): number {
  if (steps.length === 0) return 0
  return Math.round((steps.filter((s) => s.state === 'done').length / steps.length) * 100)
}
