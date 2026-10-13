import { describe, expect, it } from 'vitest'
import { AgentInfo, GatewayInfo, LogsList, LogsRead } from '@shared/events'
import { HEARTBEAT_STALE_S, gatewayDown, isPlatformProblem, platformIssues } from '@shared/gateway'
import { LOG_FILES, LOG_LEVELS, LOG_RANGE_SECONDS, gatewayCommandPreview } from '@shared/logs'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '@shared/settings'

const gw = (over: Partial<GatewayInfo> = {}): GatewayInfo => ({ state: 'running', pidAlive: true, updatedAgeS: 5, exitReason: null, restartRequested: false, platforms: [], ...over })

describe('platform and gateway health', () => {
  it('flags error codes and failure words, not healthy or neutral states', () => {
    expect(isPlatformProblem({ state: 'connected', errorCode: null })).toBe(false)
    expect(isPlatformProblem({ state: 'running', errorCode: null })).toBe(false)
    expect(isPlatformProblem({ state: 'parked', errorCode: null })).toBe(false)
    expect(isPlatformProblem({ state: 'connecting', errorCode: null })).toBe(false)
    expect(isPlatformProblem({ state: null, errorCode: null })).toBe(false)
    expect(isPlatformProblem({ state: 'fatal', errorCode: null })).toBe(true)
    expect(isPlatformProblem({ state: 'paused-by-breaker', errorCode: null })).toBe(true)
    expect(isPlatformProblem({ state: 'degraded', errorCode: null })).toBe(true)
    expect(isPlatformProblem({ state: 'connected', errorCode: '401' })).toBe(true)
  })
  it('says a gateway is down when it stopped, left an exit reason or its process is gone', () => {
    expect(gatewayDown(gw())).toBe(false)
    expect(gatewayDown(gw({ state: 'stopped' }))).toBe(true)
    expect(gatewayDown(gw({ exitReason: 'signal 15' }))).toBe(true)
    expect(gatewayDown(gw({ pidAlive: false }))).toBe(true)
    expect(gatewayDown(null)).toBe(false)
    expect(gatewayDown(undefined)).toBe(false)
  })
  it('lists the unhealthy platforms of every agent', () => {
    const agents = [
      { profile: 'a', gateway: gw({ platforms: [{ name: 'telegram', state: 'connected', errorCode: null }, { name: 'slack', state: 'fatal', errorCode: 'auth' }] }) },
      { profile: 'b', gateway: null },
      { profile: 'c', gateway: gw({ platforms: [{ name: 'telegram', state: 'degraded', errorCode: null }] }) }
    ]
    expect(platformIssues(agents).map((i) => `${i.profile}/${i.platform}`)).toEqual(['a/slack', 'c/telegram'])
    expect(HEARTBEAT_STALE_S).toBe(120)
  })
})

describe('log constants', () => {
  it('has the four log files, the levels and the ranges', () => {
    expect(LOG_FILES).toEqual(['agent.log', 'errors.log', 'gateway.log', 'tool_calls.log'])
    expect(LOG_LEVELS).toContain('UNKNOWN')
    expect(LOG_RANGE_SECONDS['15m']).toBe(900)
    expect(LOG_RANGE_SECONDS['24h']).toBe(86400)
  })
  it('previews the gateway command for the default profile and others', () => {
    expect(gatewayCommandPreview('restart', 'default')).toBe('$ hermes gateway restart')
    expect(gatewayCommandPreview('stop', 'scout')).toBe('$ hermes -p scout gateway stop')
  })
})

describe('schemas and settings', () => {
  it('parse an agent with the gateway block and the error count, and old agents without them', () => {
    const base = { profile: 'a', displayName: 'A', status: 'idle', platforms: [], lastActivityTs: null, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false }
    expect(AgentInfo.parse({ ...base, gateway: gw(), errors1h: 3 }).errors1h).toBe(3)
    expect(AgentInfo.parse({ ...base, gateway: null, errors1h: null }).gateway).toBeNull()
    expect(AgentInfo.parse(base).gateway).toBeUndefined()
  })
  it('parse the log answers', () => {
    expect(LogsList.parse({ files: [{ profile: 'a', name: 'agent.log', size: 10, mtime: 1 }], errors: [] }).files).toHaveLength(1)
    expect(LogsRead.parse({ lines: ['x'], offset: 2, size: 2, mtime: null, startOffset: 0, more: false, reset: false, skipped: false }).lines).toEqual(['x'])
  })
  it('have the log settings and the gateway alert switch', () => {
    expect(SETTINGS_DEFAULTS['logs.levels']).not.toContain('DEBUG')
    expect(SETTINGS_DEFAULTS['logs.levels']).toContain('ERROR')
    expect(SETTINGS_DEFAULTS['logs.range']).toBe('24h')
    expect(SETTINGS_DEFAULTS['logs.wrap']).toBe(false)
    expect(SETTINGS_DEFAULTS['alerts.gateway.enabled']).toBe(true)
    expect(SETTINGS_SCHEMA['logs.range'].safeParse('2h').success).toBe(false)
    expect(SETTINGS_SCHEMA['logs.levels'].safeParse(['ERROR', 'LOUD']).success).toBe(false)
  })
})
