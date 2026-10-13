import { Panel } from '../components/Panel'
import { UnsupportedState } from '../components/States'
import { NAV } from '../shell/nav'
import type { Route } from '../stores/ui'

const WHAT: Partial<Record<Route, string>> = {
  chat: 'One-on-one chat with each agent.',
  feed: 'Realtime interactions and thinking from every agent.',
  kanban: 'Read-only kanban board of agent tasks.',
  skills: 'Installed skills and the curator.',
  logs: 'Log tail, gateway status and approvals.',
  brain: 'Obsidian-style graph of the second brain.'
}

export function ComingSoon({ route }: { route: Route }) {
  const label = NAV.find((n) => n.id === route)?.label ?? 'This screen'
  return (
    <div className="page">
      <Panel title={label.toLowerCase()} tone="hi">
        <UnsupportedState why={WHAT[route]} />
      </Panel>
    </div>
  )
}
