import type { AgentInfo } from '@shared/events'
import { HEARTBEAT_STALE_S, describePlatform, gatewayDown, isPlatformProblem, platformIssues } from '@shared/gateway'

export interface PlatformRow {
  name: string
  label: string
  problem: boolean
}

export interface GatewayRow {
  profile: string
  name: string
  /** The state word Hermes wrote, or why there is none. */
  state: string
  tone: 'ok' | 'warn' | 'bad' | 'off'
  /** The heartbeat is older than two minutes. */
  stale: boolean
  pid: 'alive' | 'gone' | 'unknown'
  ageS: number | null
  exitReason: string | null
  /** The gateway is down or a platform failed. */
  problem: boolean
  platforms: PlatformRow[]
}

export function buildGatewayRows(agents: readonly AgentInfo[]): GatewayRow[] {
  return agents.map((a) => {
    const g = a.gateway
    if (!g) return { profile: a.profile, name: a.displayName, state: 'no gateway data', tone: 'off', stale: false, pid: 'unknown', ageS: null, exitReason: null, problem: false, platforms: [] }
    const platforms = g.platforms.map((p) => ({ name: p.name, label: describePlatform({ state: p.state ?? 'unknown', errorCode: p.errorCode }), problem: isPlatformProblem(p) }))
    const down = gatewayDown(g)
    const stale = g.updatedAgeS !== null && g.updatedAgeS > HEARTBEAT_STALE_S
    const badPlatform = platforms.some((p) => p.problem)
    return {
      profile: a.profile,
      name: a.displayName,
      state: g.state ?? 'unknown',
      tone: down ? 'bad' : stale || badPlatform ? 'warn' : 'ok',
      stale,
      pid: g.pidAlive === null ? 'unknown' : g.pidAlive ? 'alive' : 'gone',
      ageS: g.updatedAgeS,
      exitReason: g.exitReason,
      problem: down || badPlatform,
      platforms
    }
  })
}

/** The number on the Gateway tab: failed platforms plus gateways that are down. */
export function gatewayBadge(agents: readonly AgentInfo[]): number {
  return platformIssues(agents).length + agents.filter((a) => gatewayDown(a.gateway)).length
}

/** The number on the Logs item of the sidebar: ERROR and CRITICAL lines of the last hour over all agents. */
export function errorsTotal(agents: readonly AgentInfo[]): number {
  return agents.reduce((sum, a) => sum + (a.errors1h ?? 0), 0)
}
