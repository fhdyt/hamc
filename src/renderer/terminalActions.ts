import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { TERM_MAX_TABS, TERM_SCROLLBACK, fillText, type TermKind } from '@shared/terminal'
import { saveSetting } from './actions'
import { afterClose, chunks, exitLine, looksLikePrompt, nextTabNumber, routeKey } from './lib/terminal'
import { useUi } from './stores/ui'
import { useConn } from './stores/conn'
import { useTerminal } from './stores/terminal'
import { terminalOpen } from './terminalToggle'

/* The xterm instances of the Terminal panel (F-TERM-1, F-TERM-6). They live outside React so a hidden panel or tab keeps
   its screen and scrollback, and the shell behind it stays alive. Nothing here sends keys to a shell except what the
   user types or pastes into xterm, and `fillCommand`, which writes a command without a line end (F-CFG-26). */

interface View {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  el: HTMLElement | null
  /** A command waiting for the shell's first prompt. */
  fill: string | null
  fillTimer: ReturnType<typeof setTimeout> | null
  /** Output came in since the shell started. */
  started: boolean
  /** The end of the output, to tell a command prompt from a password prompt before a command is put on it. */
  tail: string
}

const views = new Map<string, View>()
const byShell = new Map<string, string>()
const st = useTerminal.getState
const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
let seq = 0
let inited = false

const DRACULA = {
  background: '#191A21',
  foreground: '#F8F8F2',
  cursor: '#F8F8F2',
  cursorAccent: '#191A21',
  selectionBackground: '#44475A',
  black: '#21222C',
  red: '#FF5555',
  green: '#50FA7B',
  yellow: '#F1FA8C',
  blue: '#BD93F9',
  magenta: '#FF79C6',
  cyan: '#8BE9FD',
  white: '#F8F8F2',
  brightBlack: '#6272A4',
  brightRed: '#FF6E6E',
  brightGreen: '#69FF94',
  brightYellow: '#FFFFA5',
  brightBlue: '#D6ACFF',
  brightMagenta: '#FF92DF',
  brightCyan: '#A4FFFF',
  brightWhite: '#FFFFFF'
}

/** Subscribes once to shell output, shell exits and the connection (reopens shells after a reconnect). */
export function initTerminal(): void {
  if (inited) return
  inited = true
  window.mc.onTermData(({ id, data }) => {
    const key = byShell.get(id)
    const v = key ? views.get(key) : undefined
    if (!v) return
    v.term.write(data)
    v.tail = (v.tail + data).slice(-400)
    if (!v.started) {
      v.started = true
      if (key) st().patchTab(key, { state: 'live' })
    }
    if (v.fill !== null && key) armFill(key, v)
  })
  window.mc.onTermExit(({ id, reason, code }) => {
    const key = byShell.get(id)
    byShell.delete(id)
    if (!key) return
    const v = views.get(key)
    v?.term.write(`\r\n\x1b[38;2;139;149;189m${exitLine(reason, code)}\x1b[0m\r\n`)
    st().patchTab(key, { shellId: null, state: reason === 'disconnected' ? 'disconnected' : 'exited', message: null })
  })
  let was = useConn.getState().status.state
  useConn.subscribe((s) => {
    const now = s.status.state
    if (now === 'connected' && was !== 'connected') {
      // F-TERM-6: tabs whose shell ended with the connection get a new shell
      for (const t of st().tabs) if (t.state === 'disconnected' && t.kind === 'server') void startShell(t.key, true)
    }
    was = now
  })
}

function makeView(key: string): View {
  const term = new Terminal({
    scrollback: TERM_SCROLLBACK,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 12,
    lineHeight: 1.15,
    cursorBlink: true,
    allowProposedApi: true,
    theme: DRACULA
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.attachCustomKeyEventHandler((e) => {
    const route = routeKey({ key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, hasSelection: term.hasSelection(), mac })
    if (route === 'shell') return true
    if (route === 'copy' && e.type === 'keydown') {
      e.preventDefault()
      void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined)
      term.clearSelection()
    }
    // `app` keys bubble to the window shortcuts, `paste` goes to the Edit menu, which pastes into xterm
    return false
  })
  term.onData((data) => {
    const shell = st().tabs.find((t) => t.key === key)?.shellId
    if (!shell) return
    for (const part of chunks(data)) void window.mc.terminal.write(shell, part)
  })
  term.onResize(({ cols, rows }) => {
    const shell = st().tabs.find((t) => t.key === key)?.shellId
    if (shell) void window.mc.terminal.resize(shell, { cols, rows })
  })
  return { term, fit, search, el: null, fill: null, fillTimer: null, started: false, tail: '' }
}

/** Gives a tab its element once React rendered it; xterm opens into it the first time. */
export function attachView(key: string, el: HTMLElement): void {
  const v = views.get(key)
  if (!v || v.el === el) return
  v.el = el
  // a panel that mounts again (after the connect screen) takes the existing screen over, scrollback and all
  if (v.term.element) el.appendChild(v.term.element)
  else v.term.open(el)
  fitView(key)
  const tab = st().tabs.find((t) => t.key === key)
  if (tab && tab.state === 'starting' && tab.shellId === null) void startShell(key, false)
}

/** Fits the active tab to its box (only a visible box has a size). */
export function fitView(key: string | null = st().active): void {
  const v = key ? views.get(key) : undefined
  if (!v?.el || v.el.offsetParent === null || v.el.clientHeight === 0) return
  try {
    v.fit.fit()
  } catch {
    /* not rendered yet */
  }
}

async function startShell(key: string, again: boolean): Promise<void> {
  const v = views.get(key)
  const tab = st().tabs.find((t) => t.key === key)
  if (!v || !tab) return
  st().patchTab(key, { state: 'starting', message: null })
  v.started = false
  v.tail = ''
  // after a reconnect a built-in shell stays built-in, even if Settings now says the system ssh (no password prompt out of the blue)
  const keep = again && tab.via === 'builtin' ? { via: 'builtin' as const } : {}
  const r = await window.mc.terminal.open({ cols: Math.max(2, v.term.cols), rows: Math.max(1, v.term.rows), kind: tab.kind, ...keep })
  if (!views.has(key)) {
    if (r.ok) void window.mc.terminal.close(r.id)
    return
  }
  if (!r.ok) {
    const message =
      r.error === 'too-many'
        ? `At most ${TERM_MAX_TABS} shells can be open.`
        : r.error === 'not-connected'
          ? null
          : r.error === 'unavailable'
            ? `Terminals of this computer cannot run here${r.detail ? `: ${r.detail}` : '.'}`
            : `The shell could not start${r.detail ? `: ${r.detail}` : '.'}`
    st().patchTab(key, { state: r.error === 'not-connected' ? 'disconnected' : 'error', message })
    return
  }
  byShell.set(r.id, key)
  st().patchTab(key, { shellId: r.id, via: r.via, label: r.label })
  if (again) v.term.write('\x1b[38;2;139;149;189m[Reconnected.]\x1b[0m\r\n')
}

/** Opens a new tab (and the panel): a shell of this computer or of the server, by default what Settings → Terminal says. */
export function newTab(kind: TermKind = useUi.getState().settings['terminal.newShell']): string | null {
  const s = st()
  if (s.tabs.length >= TERM_MAX_TABS) return null
  const key = `t${++seq}`
  views.set(key, makeView(key))
  s.set({ tabs: [...s.tabs, { key, shellId: null, n: nextTabNumber(s.tabs), state: 'starting', message: null, kind, via: null, label: null }], active: key })
  if (!terminalOpen()) void saveSetting('terminal.open', true)
  // the new shell takes the keys at once, as in the VS Code terminal (not the + button that opened it)
  else
    requestAnimationFrame(() => {
      if (st().active !== key || document.querySelector('[aria-modal="true"]')) return
      fitView(key)
      views.get(key)?.term.focus()
    })
  return key
}

export function selectTab(key: string): void {
  st().set({ active: key })
  requestAnimationFrame(() => {
    fitView(key)
    views.get(key)?.term.focus()
  })
}

export function closeTab(key: string): void {
  const s = st()
  const tab = s.tabs.find((t) => t.key === key)
  if (!tab) return
  if (tab.shellId) {
    byShell.delete(tab.shellId)
    void window.mc.terminal.close(tab.shellId)
  }
  const v = views.get(key)
  if (v?.fillTimer) clearTimeout(v.fillTimer)
  v?.term.dispose()
  views.delete(key)
  const active = afterClose(s.tabs, key, s.active)
  s.set({ tabs: s.tabs.filter((t) => t.key !== key), active })
  if (active) selectTab(active)
}

/** A tab whose shell ended starts a new one. */
export function restartTab(key: string): void {
  views.get(key)?.term.reset()
  void startShell(key, false)
}

export function focusTerminal(): void {
  const a = st().active
  if (a) views.get(a)?.term.focus()
}

export function clearActive(): void {
  const a = st().active
  if (a) views.get(a)?.term.clear()
}

export function findInActive(text: string, back: boolean): boolean {
  const a = st().active
  const v = a ? views.get(a) : undefined
  if (!v || !text) return false
  const opts = { decorations: { matchOverviewRuler: '#F1FA8C', activeMatchColorOverviewRuler: '#FFB86C', matchBackground: '#44475A', activeMatchBackground: '#6272A4' } }
  return back ? v.search.findPrevious(text, opts) : v.search.findNext(text, opts)
}

export function clearSearch(): void {
  const a = st().active
  if (a) views.get(a)?.search.clearDecorations()
}

function armFill(key: string, v: View): void {
  // wait until the shell has been quiet for a moment, so the command lands after the prompt, not before it
  if (v.fillTimer) clearTimeout(v.fillTimer)
  v.fillTimer = setTimeout(() => {
    v.fillTimer = null
    const shell = st().tabs.find((t) => t.key === key)?.shellId
    // a login (the ssh password, a host question) comes first: the command waits for the shell prompt behind it
    if (v.fill === null || !shell || !looksLikePrompt(v.tail)) return
    const text = v.fill
    v.fill = null
    void window.mc.terminal.write(shell, text)
    v.term.focus()
  }, 250)
}

/**
 * F-CFG-26: opens the panel and puts a command on a shell prompt. Hermes commands (`where: 'server'`) go to a server tab:
 * the active one, else another live one, else a new one; a snippet goes to the active tab. It never adds a line end:
 * the user reads it and presses Enter. A login in progress (an ssh password) is never typed into: the command waits
 * for the shell prompt. False when it cannot be placed.
 */
export function fillCommand(command: string, where: 'server' | 'active' = 'server'): boolean {
  const text = fillText(command)
  if (text === null) return false
  if (!terminalOpen()) void saveSetting('terminal.open', true)
  const s = st()
  const alive = (t: { state: string }): boolean => t.state === 'live' || t.state === 'starting'
  const fits = (t: { kind: TermKind; state: string }): boolean => alive(t) && (where === 'active' || t.kind === 'server')
  let key: string | null = s.active
  const tab = s.tabs.find((t) => t.key === key)
  if (!tab || !fits(tab)) {
    key = s.tabs.find(fits)?.key ?? newTab(where === 'server' ? 'server' : undefined)
    if (key) st().set({ active: key })
  }
  if (!key) return false
  const v = views.get(key)!
  v.fill = text
  const current = st().tabs.find((t) => t.key === key)
  if (current?.shellId && v.started) {
    if (looksLikePrompt(v.tail)) {
      v.fill = null
      void window.mc.terminal.write(current.shellId, text)
    } else armFill(key, v)
  }
  requestAnimationFrame(() => {
    fitView(key)
    v.term.focus()
  })
  return true
}
