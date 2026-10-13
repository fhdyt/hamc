import { useEffect } from 'react'
import { loadTools, loadUsage, refreshUsage } from '../usageActions'
import { useUsage } from '../stores/usage'
import { CostTab } from './usage/CostTab'
import { ToolsTab } from './usage/ToolsTab'
import { UsageFilters } from './usage/UsageFilters'

const REFRESH_MS = 60_000
const TABS: { id: 'cost' | 'tools'; label: string }[] = [
  { id: 'cost', label: 'Cost' },
  { id: 'tools', label: 'Tools' }
]

export function Usage() {
  const tab = useUsage((s) => s.tab)
  const setTab = useUsage((s) => s.setTab)

  useEffect(() => {
    void loadUsage()
    // Usage changes slowly: the visible tab is re-read once a minute while the window is visible.
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUsage()
    }, REFRESH_MS)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const st = useUsage.getState()
    if (tab === 'tools' && st.tools === null && st.toolsStatus !== 'loading') void loadTools()
  }, [tab])

  return (
    <div className="us">
      <h1 className="page-title">Usage</h1>
      <UsageFilters />
      <div role="tablist" aria-label="Usage views" className="us-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`us-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="us-panel" className="us-tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="us-panel" aria-labelledby={`us-tab-${tab}`} className="us-panel">
        {tab === 'cost' ? <CostTab /> : <ToolsTab />}
      </div>
    </div>
  )
}
