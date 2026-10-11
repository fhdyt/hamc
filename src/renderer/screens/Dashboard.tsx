import { Resizer } from '../components/Resizer'
import { useLiveSetting } from '../hooks/useLiveSetting'
import { useUi } from '../stores/ui'
import { ActivityPanel } from './dashboard/ActivityPanel'
import { AgentCount } from './dashboard/AgentCount'
import { AgentsPanel } from './dashboard/AgentsPanel'
import { BrainPanel } from './dashboard/BrainPanel'
import { CronPanel } from './dashboard/CronPanel'
import { ServerPanel } from './dashboard/ServerPanel'

/** The Dashboard as drawn in the mockup: Cron and Activity on the left, Server and the graph in the middle, Agents on the right. */
export function Dashboard() {
  const collapsed = useUi((s) => s.settings['agents.panelCollapsed'])
  const cronOpen = useUi((s) => s.settings['dashboard.cronOpen'])
  const actOpen = useUi((s) => s.settings['dashboard.activityOpen'])
  const chat = useLiveSetting('dashboard.chatW')
  const cron = useLiveSetting('dashboard.cronH')
  const both = cronOpen && actOpen

  return (
    <div className="dash2">
      <div className="d-left">
        <AgentCount />
        <CronPanel style={{ flex: both ? `0 0 ${cron.value}px` : cronOpen ? '1 1 0' : 'none' }} />
        {both && <Resizer orientation="horizontal" value={cron.value} min={90} max={560} label="Resize cron and activity" onChange={cron.onChange} onCommit={cron.onCommit} />}
        <ActivityPanel style={{ flex: actOpen ? '1 1 0' : 'none' }} />
      </div>
      <div className="d-mid">
        <ServerPanel />
        <BrainPanel />
      </div>
      {!collapsed && <Resizer orientation="vertical" invert value={chat.value} min={260} max={640} label="Resize chat panel" onChange={chat.onChange} onCommit={chat.onCommit} />}
      <AgentsPanel width={chat.value} />
    </div>
  )
}
