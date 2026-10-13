import { describe, expect, it } from 'vitest'
import type { AgentInfo, GatewayInfo } from '@shared/events'
import { GatewayWatcher } from '../../src/main/gateway/watcher'

const gw = (over: Partial<GatewayInfo> = {}): GatewayInfo => ({ state: 'running', pidAlive: true, updatedAgeS: 5, exitReason: null, restartRequested: false, platforms: [{ name: 'telegram', state: 'connected', errorCode: null }], ...over })
const agent = (profile: string, gateway: GatewayInfo | null): AgentInfo => ({
  profile, displayName: profile, status: 'idle', platforms: [], lastActivityTs: null, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false, gateway
})

describe('GatewayWatcher', () => {
  it('takes the first batch as a baseline and reports nothing, even for a gateway that is already down', () => {
    const w = new GatewayWatcher()
    expect(w.ingest([agent('a', gw({ state: 'stopped' })), agent('b', gw({ platforms: [{ name: 'slack', state: 'fatal', errorCode: null }] }))])).toEqual([])
  })

  it('reports a gateway that stops, once', () => {
    const w = new GatewayWatcher()
    w.ingest([agent('a', gw())])
    const down = [agent('a', gw({ state: 'stopped', exitReason: 'signal 15' }))]
    expect(w.ingest(down)).toEqual([{ profile: 'a', kind: 'gateway', detail: 'stopped (signal 15)' }])
    expect(w.ingest(down)).toEqual([])
  })

  it('reports a platform that fails and tells its error code', () => {
    const w = new GatewayWatcher()
    w.ingest([agent('a', gw())])
    const bad = [agent('a', gw({ platforms: [{ name: 'telegram', state: 'fatal', errorCode: 'auth' }] }))]
    expect(w.ingest(bad)).toEqual([{ profile: 'a', kind: 'platform', platform: 'telegram', detail: 'fatal (auth)' }])
    expect(w.ingest(bad)).toEqual([])
  })

  it('reports again after a recovery', () => {
    const w = new GatewayWatcher()
    w.ingest([agent('a', gw())])
    const down = [agent('a', gw({ pidAlive: false }))]
    expect(w.ingest(down)).toHaveLength(1)
    expect(w.ingest([agent('a', gw())])).toEqual([])
    expect(w.ingest(down)).toHaveLength(1)
  })

  it('does not report an agent that shows up later already down, nor an agent without a gateway', () => {
    const w = new GatewayWatcher()
    w.ingest([agent('a', gw())])
    expect(w.ingest([agent('a', gw()), agent('b', gw({ state: 'stopped' })), agent('c', null)])).toEqual([])
    expect(w.ingest([agent('a', gw()), agent('b', gw({ state: 'stopped' })), agent('c', null)])).toEqual([])
  })

  it('starts over after a reset', () => {
    const w = new GatewayWatcher()
    w.ingest([agent('a', gw())])
    w.reset()
    expect(w.ingest([agent('a', gw({ state: 'stopped' }))])).toEqual([])
  })
})
