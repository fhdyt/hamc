import { describe, expect, it } from 'vitest'
import type { AgentInfo, GatewayInfo } from '@shared/events'
import { parsePolicy, suggestionLines } from '../../src/renderer/lib/approvals'
import { buildGatewayRows, errorsTotal, gatewayBadge } from '../../src/renderer/lib/gatewayView'

const gw = (over: Partial<GatewayInfo> = {}): GatewayInfo => ({ state: 'running', pidAlive: true, updatedAgeS: 20, exitReason: null, restartRequested: false, platforms: [{ name: 'telegram', state: 'connected', errorCode: null }], ...over })
const agent = (profile: string, gateway: GatewayInfo | null | undefined, errors1h?: number | null): AgentInfo => ({
  profile, displayName: profile.toUpperCase(), status: 'idle', platforms: [], lastActivityTs: null, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false, gateway, errors1h
})

describe('buildGatewayRows', () => {
  it('describes a healthy gateway with its platforms', () => {
    const [r] = buildGatewayRows([agent('a', gw())])
    expect(r).toMatchObject({ profile: 'a', name: 'A', state: 'running', tone: 'ok', stale: false, pid: 'alive', problem: false })
    expect(r!.platforms).toEqual([{ name: 'telegram', label: 'connected', problem: false }])
  })
  it('marks a stale heartbeat, a stopped gateway, a gone process and a failed platform', () => {
    const rows = buildGatewayRows([
      agent('stale', gw({ updatedAgeS: 130 })),
      agent('down', gw({ state: 'stopped', exitReason: 'signal 15' })),
      agent('gone', gw({ pidAlive: false })),
      agent('plat', gw({ platforms: [{ name: 'slack', state: 'fatal', errorCode: 'auth' }] }))
    ])
    const by = Object.fromEntries(rows.map((r) => [r.profile, r]))
    expect(by['stale']).toMatchObject({ stale: true, tone: 'warn' })
    expect(by['down']).toMatchObject({ tone: 'bad', problem: true, exitReason: 'signal 15' })
    expect(by['gone']).toMatchObject({ tone: 'bad', pid: 'gone', problem: true })
    expect(by['plat']).toMatchObject({ problem: true })
    expect(by['plat']!.platforms[0]).toEqual({ name: 'slack', label: 'fatal (auth)', problem: true })
  })
  it('lists an agent without gateway data as unknown', () => {
    expect(buildGatewayRows([agent('x', null)])[0]).toMatchObject({ tone: 'off', state: 'no gateway data', problem: false })
  })
})

describe('badges', () => {
  it('counts the failed platforms and the stopped gateways, and sums the hourly errors', () => {
    const agents = [agent('a', gw({ platforms: [{ name: 'slack', state: 'fatal', errorCode: null }] }), 3), agent('b', gw({ state: 'stopped' }), 2), agent('c', gw(), null), agent('d', null)]
    expect(gatewayBadge(agents)).toBe(2)
    expect(errorsTotal(agents)).toBe(5)
    expect(errorsTotal([agent('c', gw())])).toBe(0)
  })
})

describe('parsePolicy', () => {
  it('reads JSON and lists the known keys first, with a dash for missing ones, then the unknown keys', () => {
    const p = parsePolicy(JSON.stringify({ mode: 'manual', timeout: 60, deny: ['rm -rf /'], extra: true }))
    expect(p.entries.slice(0, 7).map((e) => e.key)).toEqual(['mode', 'cron_mode', 'single_query_mode', 'unattended_mode', 'timeout', 'deny', 'command_allowlist'])
    expect(p.entries[0]).toEqual({ key: 'mode', value: 'manual', known: true })
    expect(p.entries[1]).toEqual({ key: 'cron_mode', value: '—', known: true })
    expect(p.entries[4]!.value).toBe('60')
    expect(p.entries[5]!.value).toBe('rm -rf /')
    expect(p.entries.at(-1)).toEqual({ key: 'extra', value: 'true', known: false })
  })
  it('reads a policy nested under an approvals key and key: value text', () => {
    expect(parsePolicy(JSON.stringify({ approvals: { mode: 'smart' } })).entries[0]!.value).toBe('smart')
    const t = parsePolicy('mode: off\ntimeout = 30\n# comment')
    expect(t.entries[0]!.value).toBe('off')
    expect(t.entries.find((e) => e.key === 'timeout')!.value).toBe('30')
  })
  it('keeps the raw text and does not fail on nonsense or empty text', () => {
    expect(parsePolicy('???').raw).toBe('???')
    expect(parsePolicy('').entries.every((e) => e.value === '—')).toBe(true)
  })
})

describe('suggestionLines', () => {
  it('returns the non-empty trimmed lines', () => {
    expect(suggestionLines('  a  \n\n b\n')).toEqual(['a', 'b'])
    expect(suggestionLines('')).toEqual([])
  })
})
