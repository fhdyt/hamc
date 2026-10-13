import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TERM_MAX_H, TERM_MAX_TABS, TERM_MIN_H, initialHeight } from '@shared/terminal'
import { saveSetting } from '../actions'
import { addSnippet, escapeCloses, removeSnippet, snippetProblem, type TermTab } from '../lib/terminal'
import { useConn } from '../stores/conn'
import { useTerminal } from '../stores/terminal'
import { useUi } from '../stores/ui'
import { attachView, clearActive, clearSearch, closeTab, fillCommand, findInActive, fitView, focusTerminal, initTerminal, newTab, restartTab, selectTab } from '../terminalActions'
import { setTerminalOpen } from '../terminalToggle'
import { Icon } from './Icon'
import { Resizer } from './Resizer'

const mod = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl'

/** F-R12-2: the Terminal panel above the status bar, on every screen. Hidden, it stays mounted so its shells live on. */
export function TerminalPanel() {
  const open = useUi((s) => s.settings['terminal.open'])
  const savedH = useUi((s) => s.settings['terminal.height'])
  const [liveH, setLiveH] = useState<number | null>(null)
  const tabs = useTerminal((s) => s.tabs)
  const active = useTerminal((s) => s.active)
  const searchOpen = useTerminal((s) => s.searchOpen)
  const snippetsOpen = useTerminal((s) => s.snippetsOpen)
  const set = useTerminal((s) => s.set)
  const saved = useConn((s) => s.saved)
  const connected = useConn((s) => s.status.state === 'connected')
  const panel = useRef<HTMLElement>(null)
  const height = liveH ?? (savedH || initialHeight(typeof window === 'undefined' ? 800 : window.innerHeight))

  useEffect(() => initTerminal(), [])
  // the panel opened (also from a saved setting at start): start a shell when there is none, then take the focus
  useEffect(() => {
    if (!open) return
    if (useTerminal.getState().tabs.length === 0) newTab()
    const raf = requestAnimationFrame(() => {
      fitView()
      if (!document.querySelector('[aria-modal="true"]')) focusTerminal()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])
  useLayoutEffect(() => {
    if (open) fitView()
  }, [open, height, active, searchOpen])
  useEffect(() => {
    const el = panel.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitView())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Esc closes the panel when nothing else claims it (F-R12-2); inside the shell it belongs to the shell
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const t = e.target instanceof HTMLElement ? e.target : null
      const ctx = {
        defaultPrevented: e.defaultPrevented,
        layerOpen: document.querySelector('[aria-modal="true"]') !== null,
        inShell: t?.closest('.xterm') != null,
        inField: !!t && !t.closest('.term-panel') && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
      }
      if (escapeCloses(ctx)) setTerminalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const who = saved ? `${saved.username}@${saved.host}` : 'not connected'

  return (
    <section ref={panel} className="term-panel" aria-label="Terminal" hidden={!open} style={{ height }}>
      <Resizer
        orientation="horizontal"
        invert
        value={height}
        min={TERM_MIN_H}
        max={TERM_MAX_H}
        label="Resize terminal"
        onChange={setLiveH}
        onCommit={(v) => {
          void saveSetting('terminal.height', v)
          setLiveH(null)
        }}
      />
      <div className="term-head">
        <span className="term-ico" aria-hidden="true">
          <Icon name="terminal" size={13} />
        </span>
        <span className="term-title">Terminal</span>
        <span className="term-who">{who}</span>
        <div className="term-tabs" role="tablist" aria-label="Shells">
          {tabs.map((t) => (
            <TabButton key={t.key} tab={t} on={t.key === active} />
          ))}
          <button type="button" className="ib sm" aria-label="New shell" title={tabs.length >= TERM_MAX_TABS ? `At most ${TERM_MAX_TABS} shells` : 'New shell'} disabled={tabs.length >= TERM_MAX_TABS} onClick={() => newTab()}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        <span className="term-warn" title="Commands typed here run on the server as the SSH user, with that user's full rights. Mission Control never types into it and never logs what you type.">
          <Icon name="alert" size={12} /> Full shell on the server, not read-only
        </span>
        <span className="term-acts">
          <button type="button" className={`ib sm ${searchOpen ? 'on' : ''}`} aria-label="Search the terminal" aria-pressed={searchOpen} title="Search" onClick={() => set({ searchOpen: !searchOpen, snippetsOpen: false })}>
            <Icon name="search" size={13} />
          </button>
          <button type="button" className={`ib sm ${snippetsOpen ? 'on' : ''}`} aria-label="Snippets" aria-expanded={snippetsOpen} title="Snippets" onClick={() => set({ snippetsOpen: !snippetsOpen, searchOpen: false })}>
            <Icon name="code" size={13} />
          </button>
          <button type="button" className="ib sm" aria-label="Clear terminal" title="Clear" onClick={() => { clearActive(); focusTerminal() }}>
            <Icon name="trash" size={13} />
          </button>
          <button type="button" className="ib sm" aria-label="Close terminal" title={`Close (${mod}+\`)`} onClick={() => setTerminalOpen(false)}>
            <Icon name="chev-down" size={14} />
          </button>
        </span>
      </div>
      {searchOpen && <SearchBar />}
      {snippetsOpen && <Snippets />}
      <div className="term-views">
        {tabs.map((t) => (
          <TabView key={t.key} tab={t} on={t.key === active} connected={connected} />
        ))}
        {tabs.length === 0 && (
          <div className="term-empty">
            <button type="button" className="cb sm" onClick={() => newTab()}>
              <Icon name="plus" size={12} />
              New shell
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function TabButton({ tab, on }: { tab: TermTab; on: boolean }) {
  const dot = tab.state === 'live' ? 'live' : tab.state === 'starting' ? 'starting' : 'down'
  return (
    <span className={`term-tab ${on ? 'on' : ''}`}>
      <button type="button" role="tab" aria-selected={on} className="term-tab-btn" onClick={() => selectTab(tab.key)} title={tab.state === 'live' ? 'Shell running' : tab.state === 'starting' ? 'Starting…' : 'Shell ended'}>
        <span className={`term-dot ${dot}`} aria-hidden="true" />
        shell {tab.n}
      </button>
      <button type="button" className="term-tab-x" aria-label={`Close shell ${tab.n}`} title="Close this shell" onClick={() => closeTab(tab.key)}>
        <Icon name="x" size={11} />
      </button>
    </span>
  )
}

function TabView({ tab, on, connected }: { tab: TermTab; on: boolean; connected: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) attachView(tab.key, ref.current)
  }, [tab.key])
  const ended = tab.state === 'exited' || tab.state === 'error' || (tab.state === 'disconnected' && connected)
  return (
    <div className="term-view" role="tabpanel" aria-label={`Shell ${tab.n}`} hidden={!on}>
      <div ref={ref} className="term-xterm" />
      {(ended || tab.state === 'disconnected' || tab.message) && (
        <div className="term-note" role="status">
          {tab.message ?? (tab.state === 'disconnected' && !connected ? 'Not connected. A shell starts when Mission Control connects.' : 'This shell has ended.')}
          {ended && (
            <button type="button" className="cb sm" onClick={() => restartTab(tab.key)}>
              Start a new shell
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SearchBar() {
  const [q, setQ] = useState('')
  const [miss, setMiss] = useState(false)
  const set = useTerminal((s) => s.set)
  const close = (): void => {
    clearSearch()
    set({ searchOpen: false })
    focusTerminal()
  }
  const find = (back: boolean): void => setMiss(q !== '' && !findInActive(q, back))
  const key = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      find(e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  return (
    <div className="term-bar" role="search">
      <input
        className="fld"
        autoFocus
        aria-label="Find in terminal"
        placeholder="Find in the scrollback"
        value={q}
        spellCheck={false}
        aria-invalid={miss}
        onChange={(e) => {
          setQ(e.target.value)
          setMiss(e.target.value !== '' && !findInActive(e.target.value, false))
        }}
        onKeyDown={key}
      />
      {miss && <span className="term-miss">No match</span>}
      <button type="button" className="ib sm" aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => find(true)}>
        <Icon name="arrow-up" size={13} />
      </button>
      <button type="button" className="ib sm" aria-label="Next match" title="Next (Enter)" onClick={() => find(false)}>
        <Icon name="arrow-down" size={13} />
      </button>
      <button type="button" className="ib sm" aria-label="Close search" onClick={close}>
        <Icon name="x" size={13} />
      </button>
    </div>
  )
}

const PROBLEM = { label: 'Give it a name (up to 40 characters).', command: 'Enter one line of command (up to 500 characters).', full: 'There are already 30 snippets.' } as const

function Snippets() {
  const list = useUi((s) => s.settings['terminal.snippets'])
  const set = useTerminal((s) => s.set)
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [tried, setTried] = useState(false)
  const problem = snippetProblem(list, label, command)
  const add = (): void => {
    setTried(true)
    if (problem) return
    void saveSetting('terminal.snippets', addSnippet(list, label, command, `s${Date.now().toString(36)}`))
    setLabel('')
    setCommand('')
    setTried(false)
  }
  return (
    <div className="term-snips" aria-label="Snippets">
      <p className="term-snips-note">A snippet is put on the prompt; you press Enter to run it.</p>
      <ul className="term-snips-list">
        {list.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="term-snip"
              title={s.command}
              onClick={() => {
                set({ snippetsOpen: false })
                fillCommand(s.command)
              }}
            >
              <span className="term-snip-l">{s.label}</span>
              <code>{s.command}</code>
            </button>
            <button type="button" className="ib sm" aria-label={`Remove snippet ${s.label}`} title="Remove" onClick={() => void saveSetting('terminal.snippets', removeSnippet(list, s.id))}>
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="term-snips-empty">No snippets yet.</li>}
      </ul>
      <form
        className="term-snips-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input className="fld" aria-label="Snippet name" placeholder="Name" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        <input className="fld" aria-label="Snippet command" placeholder="Command, e.g. hermes gateway status" spellCheck={false} value={command} maxLength={500} onChange={(e) => setCommand(e.target.value)} />
        <button type="submit" className="cb sm">
          <Icon name="plus" size={12} />
          Add
        </button>
      </form>
      {tried && problem && (
        <span className="term-miss" role="alert">
          {PROBLEM[problem]}
        </span>
      )}
    </div>
  )
}
