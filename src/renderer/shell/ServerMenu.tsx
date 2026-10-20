import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { serverAddress, serverName } from '../lib/servers'
import { switchServer } from '../serverActions'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'

/**
 * F-CONN-15: the connection item of the status bar opens the saved servers. Picking one switches to it; the server on
 * screen and "Manage servers…" open Settings → Servers, "Add server…" opens its empty form.
 */
export function ServerMenu({ button }: { button: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const servers = useConn((s) => s.servers)
  const activeId = useConn((s) => s.saved?.id ?? null)

  const close = (focus = true): void => {
    setOpen(false)
    if (focus) btn.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const onDown = (e: PointerEvent): void => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (e.key === 'Tab') close(false)
  }

  const run = (fn: () => void): void => {
    close(false)
    fn()
  }

  return (
    <span className="sv-menu-wrap">
      {button({ open, toggle: () => setOpen((o) => !o), ref: btn })}
      {open && (
        <div ref={menu} className="sv-menu" role="menu" aria-label="Servers" onKeyDown={onKey}>
          {servers.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === activeId}
              className="sv-mi"
              onClick={() => run(() => switchServer(s.id))}
            >
              <span className="sv-check" aria-hidden="true">{s.id === activeId ? '✓' : ''}</span>
              <span className="sv-mi-text">
                <span className="sv-mi-name">{serverName(s)}</span>
                <span className="sv-mi-sub">{serverAddress(s)}</span>
              </span>
            </button>
          ))}
          {servers.length > 0 && <div className="sv-sep" role="separator" />}
          <button type="button" role="menuitem" className="sv-mi" onClick={() => run(() => useUi.getState().openAddServer())}>
            <span className="sv-check" aria-hidden="true">+</span>
            Add server…
          </button>
          <button type="button" role="menuitem" className="sv-mi" onClick={() => run(() => useUi.getState().openSettings('connection'))}>
            <span className="sv-check" aria-hidden="true" />
            Manage servers…
          </button>
        </div>
      )}
    </span>
  )
}
