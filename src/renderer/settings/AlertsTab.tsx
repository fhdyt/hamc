import { useEffect, useState } from 'react'
import { COST_MAX, COST_MIN, validCostThreshold } from '@shared/usage'
import { saveSetting } from '../actions'
import { useNow } from '../hooks/useNow'
import { formatAge } from '../lib/format'
import { moneyLabel } from '../lib/usage'
import { recheckAlert } from '../usageActions'
import { useCostAlert } from '../stores/costAlert'
import { useUi } from '../stores/ui'

/** The only rule so far is the daily cost of all agents together (F-SHELL-5). */
export function AlertsTab() {
  const enabled = useUi((s) => s.settings['alerts.cost.enabled'])
  const usd = useUi((s) => s.settings['alerts.cost.usd'])
  const state = useCostAlert((s) => s.state)
  const now = useNow(30_000)
  const [text, setText] = useState(String(usd))
  const [problem, setProblem] = useState(false)

  useEffect(() => setText(String(usd)), [usd])

  const toggle = async (v: boolean): Promise<void> => {
    await saveSetting('alerts.cost.enabled', v)
    void recheckAlert()
  }
  const commit = async (): Promise<void> => {
    const n = Number(text.trim().replace(',', '.'))
    if (!validCostThreshold(n)) {
      setProblem(true)
      return
    }
    setProblem(false)
    if (n !== usd) {
      await saveSetting('alerts.cost.usd', n)
      void recheckAlert()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 13 }}>Alerts</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="sw" role="switch" aria-checked={enabled} aria-label="Alert when the daily cost of all agents passes" onClick={() => void toggle(!enabled)} />
        <span aria-hidden="true">Alert when the daily cost of all agents passes</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor="alert-usd">Threshold (USD per day)</label>
        <input
          id="alert-usd"
          type="text"
          inputMode="decimal"
          className="fld"
          style={{ width: 110 }}
          value={text}
          aria-invalid={problem}
          aria-describedby={problem ? 'alert-usd-err' : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => e.key === 'Enter' && void commit()}
        />
      </div>
      {problem && (
        <div id="alert-usd-err" className="banner bad" role="alert">
          Enter an amount from {moneyLabel(COST_MIN)} to ${COST_MAX.toLocaleString('en-US')}.
        </div>
      )}
      <p style={{ margin: 0, color: '#a9b2d3', fontSize: 12 }}>
        The day is your local day. The check runs every 5 minutes while Mission Control is connected, and a desktop notification appears once per day when the window is not in front.
      </p>
      <p role="status" style={{ margin: 0, fontSize: 12 }}>
        {!enabled
          ? 'The rule is off.'
          : state && state.enabled && state.total !== null
            ? `Today so far: ${moneyLabel(state.total)} (checked ${formatAge(Math.max(0, (now - state.checkedAt) / 1000))})`
            : 'Not checked yet.'}
      </p>
      <p style={{ margin: 0, color: '#8b95bd', fontSize: 11 }}>More alert rules arrive in later releases.</p>
    </div>
  )
}
