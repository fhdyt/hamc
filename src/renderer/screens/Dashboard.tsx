import { Panel } from '../components/Panel'
import { UnsupportedState } from '../components/States'
import { useUi } from '../stores/ui'
import { AgentsPanel } from './dashboard/AgentsPanel'
import { ActivityPanel } from './dashboard/ActivityPanel'
import { ServerStrip } from './dashboard/ServerStrip'
import { CronPanel } from './dashboard/CronPanel'
import { StatusBlock } from './dashboard/StatusBlock'

export function Dashboard() {
  const collapsed = useUi((s) => s.settings['agents.panelCollapsed'])
  return (
    <div className={`dash ${collapsed ? 'agents-rail' : ''}`}>
      <div className="col">
        <StatusBlock />
        <CronPanel />
        <ActivityPanel />
      </div>
      <div className="col">
        <ServerStrip />
        <Panel variant="card" title="second brain" className="grow">
          <UnsupportedState why="The vault graph arrives in a later release." />
        </Panel>
      </div>
      <AgentsPanel />
    </div>
  )
}
