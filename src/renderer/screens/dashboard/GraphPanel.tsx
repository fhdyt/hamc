import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { useUi } from '../../stores/ui'
import { AgentGraph } from './AgentGraph'
import { BrainPanel } from './BrainPanel'

/** The graph panel of the Dashboard: a tab bar over the vault graph and the agent interaction graph (F-AGRAPH-1). */
export function GraphPanel() {
  const tab = useUi((s) => s.settings['dashboard.graphTab'])
  const pick = (t: 'brain' | 'agents'): void => void saveSetting('dashboard.graphTab', t)
  const tabs = (
    <div role="tablist" aria-label="Graph" className="d-gtabs">
      <button type="button" role="tab" aria-selected={tab === 'brain'} className="d-gtab" onClick={() => pick('brain')}>
        <Icon name="share" size={12} /> second brain
      </button>
      <button type="button" role="tab" aria-selected={tab === 'agents'} className="d-gtab" onClick={() => pick('agents')}>
        <Icon name="users" size={12} /> agents
      </button>
    </div>
  )
  return tab === 'agents' ? <AgentGraph tabs={tabs} /> : <BrainPanel tabs={tabs} />
}
