import type { GatewayInfo } from './events'

/** The heartbeat of a gateway is refreshed about every 60 s; older than this it is stale (F-LOG-5). */
export const HEARTBEAT_STALE_S = 120

const DOWN_STATES = new Set(['stopped', 'stopping', 'exited', 'failed', 'crashed', 'shutdown'])
const PROBLEM_WORDS = /fatal|error|fail|degrad|breaker|disconnect|crash/

/** A platform is unhealthy with an error code or a failure word in its state. Unknown neutral words (connecting, parked) are not. */
export function isPlatformProblem(p: { state: string | null; errorCode: string | null }): boolean {
  if (p.errorCode) return true
  return p.state !== null && PROBLEM_WORDS.test(p.state.toLowerCase())
}

/** The gateway stopped, left an exit reason, or its process is gone. */
export function gatewayDown(g: GatewayInfo | null | undefined): boolean {
  if (!g) return false
  return DOWN_STATES.has((g.state ?? '').toLowerCase()) || !!g.exitReason || g.pidAlive === false
}

export interface PlatformIssue {
  profile: string
  platform: string
  state: string | null
  errorCode: string | null
}

export function platformIssues(agents: readonly { profile: string; gateway?: GatewayInfo | null | undefined }[]): PlatformIssue[] {
  const out: PlatformIssue[] = []
  for (const a of agents) {
    for (const p of a.gateway?.platforms ?? []) {
      if (isPlatformProblem(p)) out.push({ profile: a.profile, platform: p.name, state: p.state, errorCode: p.errorCode })
    }
  }
  return out
}

/** Why a gateway counts as down, in a few words. */
export function describeGatewayDown(g: GatewayInfo): string {
  const word = (g.state ?? '').toLowerCase()
  const base = DOWN_STATES.has(word) ? word : g.pidAlive === false ? 'process is gone' : (g.state ?? 'not running')
  return g.exitReason ? `${base} (${g.exitReason})` : base
}

export function describePlatform(p: { state: string | null; errorCode: string | null }): string {
  return `${p.state ?? 'error'}${p.errorCode ? ` (${p.errorCode})` : ''}`
}
