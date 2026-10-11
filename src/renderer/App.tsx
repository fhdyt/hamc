import { useEffect } from 'react'
import { Chat } from './screens/Chat'
import { ComingSoon } from './screens/ComingSoon'
import { CronModal } from './screens/cron/CronModal'
import { Brain } from './screens/Brain'
import { Connect } from './screens/Connect'
import { Dashboard } from './screens/Dashboard'
import { Feed } from './screens/Feed'
import { FeedModal } from './screens/feed/FeedModal'
import { NoteModal } from './screens/brain/NoteModal'
import { SessionModal } from './screens/feed/SessionModal'
import { Launch } from './screens/Launch'
import { Server } from './screens/Server'
import { SettingsModal } from './settings/SettingsModal'
import { Shell } from './shell/Shell'
import { useShortcuts } from './shell/useShortcuts'
import { useUi } from './stores/ui'

export function App() {
  const route = useUi((s) => s.route)
  const ready = useUi((s) => s.ready)
  const density = useUi((s) => s.settings['ui.density'])
  const reduce = useUi((s) => s.settings['ui.reduceMotion'])
  useShortcuts()

  useEffect(() => {
    document.documentElement.dataset['density'] = density
    document.documentElement.classList.toggle('mc-nomotion', reduce)
  }, [density, reduce])

  if (!ready) return null
  if (route === 'connect') return <Connect />
  if (route === 'launch') return <Launch />

  return (
    <>
      <Shell>{route === 'dashboard' ? <Dashboard /> : route === 'server' ? <Server /> : route === 'chat' ? <Chat /> : route === 'feed' ? <Feed /> : route === 'brain' ? <Brain /> : <ComingSoon route={route} />}</Shell>
      <CronModal />
      <FeedModal />
      <SessionModal />
      <NoteModal />
      <SettingsModal />
    </>
  )
}
