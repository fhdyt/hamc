import { ensurePins, refreshVault } from './actions'
import { shouldCount } from './lib/unread'
import { countIfAway } from './paletteActions'
import { useAgents } from './stores/agents'
import { useBrain } from './stores/brain'
import { useChat } from './stores/chat'
import { useConn } from './stores/conn'
import { useCostAlert } from './stores/costAlert'
import { useCron } from './stores/cron'
import { useFeed } from './stores/feed'
import { useInteractions } from './stores/interactions'
import { useMetrics } from './stores/metrics'
import { useUi } from './stores/ui'
import { useMemoryTimeline } from './stores/memoryTimeline'
import { memoryChanged } from './memoryActions'
import { notifyChatReply, openNoticeTarget } from './noticeActions'
import { playReplySound } from './soundActions'
import { useNotices } from './stores/notices'
import { sortAgents } from './lib/roster'

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
    else if (ev.type === 'interactions') useInteractions.getState().apply(ev.data)
    else if (ev.type === 'error' && ev.data.code.startsWith('vault_')) useBrain.getState().setError(ev.data.message)
    else if (ev.type === 'error' && ['unsupported_schema', 'db_unreadable', 'feed_failed'].includes(ev.data.code)) useFeed.getState().setError(`${ev.data.message}${ev.data.profile ? ` (${ev.data.profile})` : ''}`)
  })
  mc.onChat((ev) => {
    useChat.getState().applyChat(ev)
    // a reply that finished while the user was looking elsewhere gets a badge
    if (shouldCount(ev)) {
      const away = countIfAway(ev.profile)
      if (away) notifyChatReply(ev.profile, useChat.getState().rooms[ev.profile]?.turn?.text ?? '')
      playReplySound(away)
    }
  })
  // an agent that is answering a chat from this app shows as working, whatever state.db says yet
  useChat.subscribe((s) => {
    const busy = Object.entries(s.rooms)
      .filter(([, r]) => r.sending || (r.turn !== null && !r.turn.ended))
      .map(([p]) => p)
      .sort()
    useAgents.getState().setBusy(busy)
  })
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
  mc.onCostAlert((state) => useCostAlert.getState().apply(state))
  mc.onMemory(({ profile, file }) => {
    const st = useMemoryTimeline.getState()
    memoryChanged(profile, file, st.profile ?? sortAgents(useAgents.getState().agents)[0]?.profile ?? null)
  })
  mc.onNotice((n) => {
    // in front of the user a toast is enough; otherwise the OS showed it and the bell keeps it
    const front = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
    useNotices.getState().add(n, front)
  })
  mc.onNoticeOpen((t) => openNoticeTarget(t))

  const [settings, saved, secret] = await Promise.all([mc.settings.all(), mc.connection.saved(), mc.connection.secretStatus()])
  useConn.setState({ saved, savedLoaded: true, secret })
  useUi.getState().hydrate(settings)
  useUi.getState().navigate(saved && saved.remember ? 'launch' : 'connect')
}
