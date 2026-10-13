/* The Terminal panel (PRD 6.9b F-TERM-1..7, F-R12-2, F-CFG-26). A tab is a shell on this computer (the system shell, as
   in the VS Code terminal) or a shell on the server: the system `ssh` started in a local terminal, or the built-in SSH
   shell on the app's own connection. The app never types into a shell by itself (not even the password), and what
   goes in or comes out is never logged. */

/** Shells open at the same time (F-TERM-6). */
export const TERM_MAX_TABS = 6
/** The panel height the user can drag to (F-TERM-3). */
export const TERM_MIN_H = 140
export const TERM_MAX_H = 520
/** Lines kept above the screen (F-TERM-6). */
export const TERM_SCROLLBACK = 5000
/** One write from the renderer (a paste is cut into pieces of this size). */
export const TERM_WRITE_MAX = 64 * 1024
export const TERM_ID_RE = /^[A-Za-z0-9-]{8,64}$/
export const TERM_COLS = { min: 2, max: 1000 }
export const TERM_ROWS = { min: 1, max: 500 }

export interface TermSize {
  cols: number
  rows: number
}

/** What a tab runs: the system shell of this computer, or a shell on the server. */
export type TermKind = 'local' | 'server'
/** How a server tab reaches the server: the system `ssh` in a local terminal, or the app's own SSH connection. */
export type TermServerVia = 'system' | 'builtin'

export interface TermOpenRequest extends TermSize {
  kind: TermKind
}

/** `via` says what actually runs; `label` names it on the tab (`pwsh`, `zsh`, `ssh`…). */
export type TermOpenResult =
  | { ok: true; id: string; via: 'local' | 'system-ssh' | 'builtin'; label: string }
  | { ok: false; error: 'not-connected' | 'too-many' | 'failed' | 'unavailable'; detail?: string }

/** What the Settings → Terminal tab shows about this computer. */
export interface TermInfo {
  /** The shell a local tab starts, or null when local terminals cannot run here. */
  localShell: string | null
  /** The system ssh client, or null when there is none (server tabs then use the built-in SSH shell). */
  ssh: string | null
  /** Why local terminals cannot run (the native module did not load). */
  problem: string | null
}

export interface TermData {
  id: string
  data: string
}

/** A shell ended: the user typed `exit` (`exited`), or the app's own connection dropped or was closed (`disconnected`,
 *  only for built-in server shells). */
export interface TermExit {
  id: string
  reason: 'exited' | 'disconnected'
  code: number | null
}

export interface Snippet {
  id: string
  label: string
  command: string
}

export const SNIPPET_MAX = 30
export const SNIPPET_LABEL_MAX = 40
export const SNIPPET_COMMAND_MAX = 500

/** Starting snippets (F-TERM-7); all read-only Hermes commands. Inserting one never presses Enter. */
export const DEFAULT_SNIPPETS: Snippet[] = [
  { id: 'gateway-status', label: 'Gateway status', command: 'hermes gateway status' },
  { id: 'status', label: 'Hermes status', command: 'hermes status' },
  { id: 'cron-list', label: 'Cron jobs', command: 'hermes cron list' },
  { id: 'profiles', label: 'Profiles', command: 'hermes profile list' },
  { id: 'doctor', label: 'Doctor', command: 'hermes doctor' }
]

/**
 * The text a "… in the terminal" button or a snippet puts on the prompt: one line, no line breaks or control
 * characters, so it can never run by itself (F-CFG-26). Null when nothing is left.
 */
export function fillText(command: string): string | null {
  const one = command.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return one ? one.slice(0, SNIPPET_COMMAND_MAX) : null
}

/** The first height of the panel when the user never dragged it: about 17 % of the window, 140 to 200 px (F-DASH-7). */
export function initialHeight(windowH: number): number {
  return Math.round(Math.min(200, Math.max(TERM_MIN_H, windowH * 0.17)))
}

export const clampHeight = (h: number): number => Math.round(Math.min(TERM_MAX_H, Math.max(TERM_MIN_H, h)))
