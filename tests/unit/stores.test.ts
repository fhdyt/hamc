import { beforeEach, describe, expect, it } from 'vitest'
import { useAgents } from '../../src/renderer/stores/agents'
import { useMetrics } from '../../src/renderer/stores/metrics'
import { useUi } from '../../src/renderer/stores/ui'
import { sampleAgents, sampleMetrics } from '../helpers/samples'

beforeEach(() => {
  useMetrics.getState().reset()
  useAgents.getState().reset()
})

describe('metrics store', () => {
  it('keeps the latest sample and a 60 second window', () => {
    for (let i = 0; i < 75; i++) useMetrics.getState().apply(sampleMetrics({ cpu: { ...sampleMetrics().cpu, total: i } }), 1000 + i)
    const s = useMetrics.getState()
    expect(s.cpu).toHaveLength(60)
    expect(s.cpu.at(-1)).toBe(74)
    expect(s.latest?.cpu.total).toBe(74)
    expect(s.receivedAt).toBe(1074)
    expect(s.rx.at(-1)).toBe(1.2e6)
  })
})

describe('agents store', () => {
  it('shows a chatting agent as working, also for agents that arrive later, and releases it afterwards', () => {
    useAgents.getState().applyAgents(sampleAgents(), 1)
    const idle = useAgents.getState().agents.find((a) => a.profile === 'scout')!.status
    useAgents.getState().setBusy(['scout'])
    expect(useAgents.getState().agents.find((a) => a.profile === 'scout')!.status).toBe('working')
    useAgents.getState().applyAgents(sampleAgents(), 2)
    expect(useAgents.getState().agents.find((a) => a.profile === 'scout')!.status).toBe('working')
    useAgents.getState().setBusy([])
    expect(useAgents.getState().agents.find((a) => a.profile === 'scout')!.status).toBe(idle)
  })

  it('stores agents with the receive time', () => {
    useAgents.getState().applyAgents(sampleAgents(), 5000)
    const s = useAgents.getState()
    expect(s.agents.map((a) => a.profile)).toEqual(['default', 'scout'])
    expect(s.receivedAt).toBe(5000)
  })

  it('drops the selection when the agent disappears', () => {
    useAgents.getState().applyAgents(sampleAgents(), 1)
    useAgents.getState().select('scout')
    const next = sampleAgents()
    next.agents = next.agents.filter((a) => a.profile !== 'scout')
    useAgents.getState().applyAgents(next, 2)
    expect(useAgents.getState().selected).toBeNull()
  })

  it('keeps data when only the selection is cleared', () => {
    useAgents.getState().applyAgents(sampleAgents(), 1)
    useAgents.getState().select('default')
    useAgents.getState().select(null)
    expect(useAgents.getState().agents).toHaveLength(2)
  })
})

describe('ui store', () => {
  it('hydrates settings and navigates', () => {
    useUi.getState().hydrate({ ...useUi.getState().settings, 'ui.zoom': 1.2 })
    expect(useUi.getState().settings['ui.zoom']).toBe(1.2)
    expect(useUi.getState().ready).toBe(true)
    useUi.getState().navigate('server')
    expect(useUi.getState().route).toBe('server')
  })
  it('opens and closes the settings modal on a tab', () => {
    useUi.getState().openSettings('connection')
    expect(useUi.getState().settingsTab).toBe('connection')
    useUi.getState().closeSettings()
    expect(useUi.getState().settingsTab).toBeNull()
  })
})
