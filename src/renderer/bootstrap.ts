import { ensurePins } from './actions'
import { useAgents } from './stores/agents'
import { useConn } from './stores/conn'
import { useMetrics } from './stores/metrics'
import { useUi } from './stores/ui'

export async function bootstrap(): Promise<void> {
  const mc = window.mc
  mc.onEvent((ev) => {
    if (ev.type === 'metrics') useMetrics.getState().apply(ev.data)
    else if (ev.type === 'agents') {
      useAgents.getState().applyAgents(ev.data)
      void ensurePins()
    }
  })
  mc.onStatus((status) => useConn.setState({ status }))
  mc.onStartup((startup) => useConn.setState({ startup }))
  mc.onPreflight((preflight) => useConn.setState({ preflight }))
  mc.onCapabilities((capabilities) => useConn.setState({ capabilities }))
  mc.onModels((models) => useAgents.getState().setModels(models))

  const [settings, saved, secret] = await Promise.all([mc.settings.all(), mc.connection.saved(), mc.connection.secretStatus()])
  useConn.setState({ saved, savedLoaded: true, secret })
  useUi.getState().hydrate(settings)
  useUi.getState().navigate(saved && saved.remember ? 'launch' : 'connect')
}
