import { useEffect, type ReactNode } from 'react'
import { TitleBar } from './shell/TitleBar'
import { Chat } from './screens/Chat'
import { ComingSoon } from './screens/ComingSoon'
import { CommandPalette } from './components/CommandPalette'
import { SwitchConfirm } from './components/SwitchConfirm'
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
import { Kanban } from './screens/Kanban'
import { Logs } from './screens/Logs'
import { Sessions } from './screens/Sessions'
import { Skills } from './screens/Skills'
import { Usage } from './screens/Usage'
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
  if (route === 'connect') return <Framed><Connect /></Framed>
  if (route === 'launch') return <Framed><Launch /></Framed>

  return (
    <Framed>
      <Shell>{route === 'dashboard' ? <Dashboard /> : route === 'server' ? <Server /> : route === 'chat' ? <Chat /> : route === 'feed' ? <Feed /> : route === 'brain' ? <Brain /> : route === 'sessions' ? <Sessions /> : route === 'usage' ? <Usage /> : route === 'logs' ? <Logs /> : route === 'kanban' ? <Kanban /> : route === 'skills' ? <Skills /> : <ComingSoon route={route} />}</Shell>
      <CronModal />
      <FeedModal />
      <SessionModal />
      <NoteModal />
      <SettingsModal />
      <SwitchConfirm />
      <CommandPalette />
    </Framed>
  )
}

/** The window content under the title bar strip (the strip has no height where the OS draws its own bar). */
function Framed({ children }: { children: ReactNode }) {
  return (
    <div className="mc-app">
      <TitleBar />
      <div className="mc-app-main">{children}</div>
    </div>
  )
}
