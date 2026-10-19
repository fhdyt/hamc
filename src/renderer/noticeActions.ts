import type { NoticeTarget } from '@shared/notify'
import { previewText } from '@shared/notify'
import { openDm, openGroup } from './groupsActions'
import { useAgents } from './stores/agents'
import { useCron } from './stores/cron'
import { useLogs } from './stores/logs'
import { useNotices } from './stores/notices'
import { useUi } from './stores/ui'

/** Opens what a notice is about (a click on a toast, a bell entry or an OS notification). */
export function openNoticeTarget(t: NoticeTarget): void {
  const ui = useUi.getState()
  if (ui.route === 'connect' || ui.route === 'launch') return
  useNotices.getState().setOpen(false)
  switch (t.kind) {
    case 'chat':
      useAgents.getState().select(t.profile)
      openDm(t.profile)
      ui.navigate('chat')
      return
    case 'group':
      openGroup(t.id)
      ui.navigate('chat')
      return
    case 'cron':
      ui.navigate('dashboard')
      useCron.getState().openModal(`${t.profile}/${t.jobId}`)
      return
    case 'logs':
      useLogs.getState().setTab(t.tab)
      ui.navigate('logs')
      return
    case 'usage':
      ui.navigate('usage')
      return
  }
}

/** A finished reply while its agent was not on screen: the bell, and the OS when the window is not in front. */
export function notifyChatReply(profile: string, text: string): void {
  const name = useAgents.getState().agents.find((a) => a.profile === profile)?.displayName ?? profile
  void window.mc.notify.chat(profile, `${name} replied`, previewText(text) || 'New reply')
}
