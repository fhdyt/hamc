import { Fragment } from 'react'
import logoUrl from '../assets/logo-mark.png'
import { saveSetting } from '../actions'
import { Icon } from '../components/Icon'
import { openPalette } from '../paletteActions'
import { useUi } from '../stores/ui'
import { NAV } from './nav'

const mod = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl'

export function Sidebar() {
  const route = useUi((s) => s.route)
  const collapsed = useUi((s) => s.settings['ui.sidebarCollapsed'])
  const navigate = useUi((s) => s.navigate)

  return (
    <aside className={`mc-side ${collapsed ? 'is-rail' : ''}`} aria-label="Sidebar">
      <div className="mc-side-logo">
        <img className="lg-img" src={logoUrl} width={28} height={28} alt="Hermes Agent Mission Control" />
        <span className="lg-text" aria-hidden="true">
          HERMES AGENT
          <br />
          MISSION CONTROL
        </span>
      </div>
      <nav aria-label="Main" className="mc-side-nav">
        {NAV.map((n) => (
          <Fragment key={n.id}>
            {n.sepBefore && <span className="sn-sep" aria-hidden="true" />}
            <button
              type="button"
              className={`sn ${route === n.id ? 'on' : ''}`}
              aria-current={route === n.id ? 'page' : undefined}
              title={`${n.label} · ${mod}+${n.key}`}
              onClick={() => navigate(n.id)}
            >
              <Icon name={n.icon} size={15} />
              <span className="tl">{n.label}</span>
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="mc-side-foot">
        <button type="button" className="sn" aria-disabled="true" title="Terminal · coming in a later release" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
          <Icon name="terminal" size={15} />
          <span className="tl">Terminal</span>
        </button>
        <button type="button" className="sn" aria-haspopup="dialog" title={`Search · ${mod}+K`} onClick={openPalette}>
          <Icon name="search" size={15} />
          <span className="tl">Search</span>
        </button>
        <button
          type="button"
          className="sn"
          aria-expanded={!collapsed}
          aria-label="Collapse sidebar"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => void saveSetting('ui.sidebarCollapsed', !collapsed)}
        >
          <Icon name="chevs-left" size={15} />
          <span className="tl">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
