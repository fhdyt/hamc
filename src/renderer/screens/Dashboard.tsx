import { Panel } from '../components/Panel'
import { UnsupportedState } from '../components/States'
import { useUi } from '../stores/ui'
import { AgentsPanel } from './dashboard/AgentsPanel'
import { ServerStrip } from './dashboard/ServerStrip'
import { StatusBlock } from './dashboard/StatusBlock'

export function Dashboard() {
  const collapsed = useUi((s) => s.settings['agents.panelCollapsed'])
  return (
    <div className={`dash ${collapsed ? 'agents-rail' : ''}`}>
      <div className="col">
        <StatusBlock />
        <Panel variant="card" title="cron jobs">
          <UnsupportedState why="Schedules and run history arrive in a later release." />
        </Panel>
        <Panel variant="card" title="activity" className="grow">
          <UnsupportedState why="The live feed of agent interactions arrives in a later release." />
        </Panel>
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
