import { useEffect } from 'react'
import { ComingSoon } from './screens/ComingSoon'
import { Connect } from './screens/Connect'
import { Dashboard } from './screens/Dashboard'
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
      <Shell>{route === 'dashboard' ? <Dashboard /> : route === 'server' ? <Server /> : <ComingSoon route={route} />}</Shell>
      <SettingsModal />
    </>
  )
}
