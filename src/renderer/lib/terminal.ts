import { SNIPPET_COMMAND_MAX, SNIPPET_LABEL_MAX, SNIPPET_MAX, TERM_WRITE_MAX, type Snippet } from '@shared/terminal'

/* Pure helpers of the Terminal panel; the xterm instances live in terminalActions.ts. */

export type TabState = 'starting' | 'live' | 'exited' | 'disconnected' | 'error'

export interface TermTab {
  /** Stable key of the tab; the shell id changes when the shell starts again after a reconnect. */
  key: string
  shellId: string | null
  n: number
  state: TabState
  message: string | null
}

/** The next free tab number, so closing tab 2 of 3 makes the new one "2" again. */
export function nextTabNumber(tabs: readonly TermTab[]): number {
  const used = new Set(tabs.map((t) => t.n))
  let n = 1
  while (used.has(n)) n++
  return n
}

/** Input goes to main in pieces the IPC accepts. */
export function chunks(data: string, size = TERM_WRITE_MAX): string[] {
  if (data.length <= size) return data ? [data] : []
  const out: string[] = []
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size))
  return out
}

/** The tab to show after one closes: the one to its right, else to its left. */
export function afterClose(tabs: readonly TermTab[], key: string, active: string | null): string | null {
  if (active !== key) return active
  const i = tabs.findIndex((t) => t.key === key)
  const rest = tabs.filter((t) => t.key !== key)
  if (rest.length === 0) return null
  return (rest[i] ?? rest[i - 1] ?? rest[0]!).key
}

/** The line a tab shows when its shell ends. */
export function exitLine(reason: 'exited' | 'disconnected', code: number | null): string {
  if (reason === 'disconnected') return '[Connection lost. A new shell starts when Mission Control reconnects.]'
  return code === null || code === 0 ? '[Shell ended.]' : `[Shell ended with code ${code}.]`
}

export interface EscapeContext {
  defaultPrevented: boolean
  /** A modal dialog or the palette is open. */
  layerOpen: boolean
  /** Focus is inside the xterm itself (Esc belongs to the shell there, vim needs it). */
  inShell: boolean
  /** Focus is in a text field elsewhere (its own Esc wins). */
  inField: boolean
}

/** F-R12-2: Esc closes the panel when no other layer is open, but never while the shell has the focus. */
export const escapeCloses = (c: EscapeContext): boolean => !c.defaultPrevented && !c.layerOpen && !c.inShell && !c.inField

export type SnippetProblem = 'label' | 'command' | 'full' | null

export function snippetProblem(list: readonly Snippet[], label: string, command: string): SnippetProblem {
  if (list.length >= SNIPPET_MAX) return 'full'
  if (!label.trim() || label.trim().length > SNIPPET_LABEL_MAX) return 'label'
  if (!command.trim() || command.trim().length > SNIPPET_COMMAND_MAX || /[\r\n]/.test(command)) return 'command'
  return null
}

export function addSnippet(list: readonly Snippet[], label: string, command: string, id: string): Snippet[] {
  return [...list, { id, label: label.trim(), command: command.trim() }]
}

export const removeSnippet = (list: readonly Snippet[], id: string): Snippet[] => list.filter((s) => s.id !== id)

/** Keys the panel takes from xterm (or gives back to the app) instead of sending them to the shell. */
export type KeyRoute = 'shell' | 'app' | 'copy' | 'paste'

export interface KeyInfo {
  key: string
  code: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  hasSelection: boolean
  mac: boolean
}

export function routeKey(k: KeyInfo): KeyRoute {
  const mod = k.mac ? k.meta : k.ctrl
  if (!mod || k.alt) return 'shell'
  // the toggle, screen shortcuts and zoom keep working while the shell has the focus
  if (k.code === 'Backquote' || k.key === '`') return 'app'
  if (/^[0-9]$/.test(k.key) || k.key === '+' || k.key === '=' || k.key === '-' || k.key === '_') return 'app'
  const lower = k.key.toLowerCase()
  // with a selection Ctrl+C copies (as in Windows Terminal); without one it stays ^C, and Ctrl+Shift+C does nothing
  if (lower === 'c') return k.hasSelection ? 'copy' : k.mac || k.shift ? 'app' : 'shell'
  // Ctrl+V and Ctrl+Shift+V paste (the Edit menu does it), as in most terminals on Windows and Linux
  if (lower === 'v') return 'paste'
  return 'shell'
}
