import { ensurePins, refreshVault } from './actions'
import { useAgents } from './stores/agents'
import { useBrain } from './stores/brain'
import { useChat } from './stores/chat'
import { useConn } from './stores/conn'
import { useCron } from './stores/cron'
import { useFeed } from './stores/feed'
import { useMetrics } from './stores/metrics'
import { useUi } from './stores/ui'

export async function bootstrap(): Promise<void> {
  const mc = window.mc
  mc.onEvent((ev) => {
    if (ev.type === 'metrics') useMetrics.getState().apply(ev.data)
    else if (ev.type === 'agents') {
      useAgents.getState().applyAgents(ev.data)
      void ensurePins()
    } else if (ev.type === 'cron') useCron.getState().applyCron(ev.data)
    else if (ev.type === 'feed') useFeed.getState().applyFeed(ev.data)
    else if (ev.type === 'brain') useBrain.getState().applyBrain(ev.data)
    else if (ev.type === 'error' && ev.data.code.startsWith('vault_')) useBrain.getState().setError(ev.data.message)
    else if (ev.type === 'error' && ['unsupported_schema', 'db_unreadable', 'feed_failed'].includes(ev.data.code)) useFeed.getState().setError(`${ev.data.message}${ev.data.profile ? ` (${ev.data.profile})` : ''}`)
  })
  mc.onChat((ev) => useChat.getState().applyChat(ev))
  mc.onUpload((p) => useChat.getState().applyUpload(p))
  mc.onStatus((status) => {
    const was = useConn.getState().status.state
    useConn.setState({ status })
    if (status.state === 'connected' && was !== 'connected') void refreshVault()
  })
  mc.onStartup((startup) => useConn.setState({ startup }))
  mc.onPreflight((preflight) => useConn.setState({ preflight }))
  mc.onCapabilities((capabilities) => useConn.setState({ capabilities }))
  mc.onModels((models) => useAgents.getState().setModels(models))
  mc.onOpenCron(({ profile, jobId }) => {
    const route = useUi.getState().route
    if (route !== 'connect' && route !== 'launch') {
      useUi.getState().navigate('dashboard')
      useCron.getState().openModal(`${profile}/${jobId}`)
    }
  })

  const [settings, saved, secret] = await Promise.all([mc.settings.all(), mc.connection.saved(), mc.connection.secretStatus()])
  useConn.setState({ saved, savedLoaded: true, secret })
  useUi.getState().hydrate(settings)
  useUi.getState().navigate(saved && saved.remember ? 'launch' : 'connect')
}
