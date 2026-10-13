import { describe, expect, it } from 'vitest'
import { DEFAULT_SNIPPETS, TERM_WRITE_MAX, clampHeight, fillText, initialHeight } from '@shared/terminal'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '@shared/settings'
import { addSnippet, afterClose, chunks, escapeCloses, exitLine, looksLikePrompt, nextTabNumber, plainTail, removeSnippet, routeKey, snippetProblem, tabName, tabPlace, type KeyInfo, type TermTab } from '../../src/renderer/lib/terminal'

const tab = (key: string, n: number): TermTab => ({ key, n, shellId: null, state: 'live', message: null, kind: 'local', via: null, label: null })
const key = (p: Partial<KeyInfo>): KeyInfo => ({ key: 'a', code: 'KeyA', ctrl: false, meta: false, shift: false, alt: false, hasSelection: false, mac: false, ...p })

describe('fillText (F-CFG-26)', () => {
  it('keeps one line without control characters, so it never runs by itself', () => {
    expect(fillText('hermes mcp add x\r')).toBe('hermes mcp add x')
    expect(fillText('echo a\nrm -rf /tmp/x')).toBe('echo a rm -rf /tmp/x')
    expect(fillText('ls\u0003\u001b[A')).toBe('ls[A')
    expect(fillText(' \r\n ')).toBeNull()
    expect(fillText('x'.repeat(900))).toHaveLength(500)
  })
})

describe('heights', () => {
  it('starts near 17 % of the window, 140 to 200 px (F-DASH-7)', () => {
    expect(initialHeight(600)).toBe(140)
    expect(initialHeight(1000)).toBe(170)
    expect(initialHeight(2000)).toBe(200)
  })
  it('clamps a drag to 140..520 (F-TERM-3)', () => {
    expect(clampHeight(10)).toBe(140)
    expect(clampHeight(999)).toBe(520)
    expect(clampHeight(300.4)).toBe(300)
  })
  it('accepts 0 (never dragged) and 140..520 as the saved height', () => {
    const s = SETTINGS_SCHEMA['terminal.height']
    expect(s.safeParse(0).success).toBe(true)
    expect(s.safeParse(300).success).toBe(true)
    expect(s.safeParse(100).success).toBe(false)
    expect(s.safeParse(600).success).toBe(false)
  })
  it('defaults: closed, not dragged, read-only Hermes snippets', () => {
    expect(SETTINGS_DEFAULTS['terminal.open']).toBe(false)
    expect(SETTINGS_DEFAULTS['terminal.height']).toBe(0)
    expect(SETTINGS_SCHEMA['terminal.snippets'].safeParse(DEFAULT_SNIPPETS).success).toBe(true)
    expect(DEFAULT_SNIPPETS.every((s) => s.command.startsWith('hermes '))).toBe(true)
  })
})

describe('tabs', () => {
  it('reuses the lowest free number', () => {
    expect(nextTabNumber([])).toBe(1)
    expect(nextTabNumber([tab('a', 1), tab('c', 3)])).toBe(2)
    expect(nextTabNumber([tab('a', 1), tab('b', 2)])).toBe(3)
  })
  it('shows the right neighbour after closing the active tab, else the left one', () => {
    const tabs = [tab('a', 1), tab('b', 2), tab('c', 3)]
    expect(afterClose(tabs, 'b', 'b')).toBe('c')
    expect(afterClose(tabs, 'c', 'c')).toBe('b')
    expect(afterClose(tabs, 'a', 'c')).toBe('c')
    expect(afterClose([tab('a', 1)], 'a', 'a')).toBeNull()
  })
  it('cuts big pastes into pieces the IPC accepts', () => {
    expect(chunks('')).toEqual([])
    expect(chunks('abc')).toEqual(['abc'])
    const parts = chunks('x'.repeat(TERM_WRITE_MAX * 2 + 5))
    expect(parts.map((p) => p.length)).toEqual([TERM_WRITE_MAX, TERM_WRITE_MAX, 5])
  })
  it('says why a shell ended', () => {
    expect(exitLine('disconnected', null)).toContain('Connection lost')
    expect(exitLine('exited', 0)).toBe('[Shell ended.]')
    expect(exitLine('exited', 130)).toBe('[Shell ended with code 130.]')
  })
})

describe('Esc (F-R12-2)', () => {
  const base = { defaultPrevented: false, layerOpen: false, inShell: false, inField: false }
  it('closes the panel only when nothing else claims the key', () => {
    expect(escapeCloses(base)).toBe(true)
    expect(escapeCloses({ ...base, inShell: true })).toBe(false)
    expect(escapeCloses({ ...base, layerOpen: true })).toBe(false)
    expect(escapeCloses({ ...base, inField: true })).toBe(false)
    expect(escapeCloses({ ...base, defaultPrevented: true })).toBe(false)
  })
})

describe('snippets (F-TERM-7)', () => {
  it('checks the name and a one-line command', () => {
    expect(snippetProblem([], '', 'ls')).toBe('label')
    expect(snippetProblem([], 'List', '')).toBe('command')
    expect(snippetProblem([], 'List', 'ls\nrm x')).toBe('command')
    expect(snippetProblem([], 'List', 'ls -la')).toBeNull()
    const full = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, label: 'x', command: 'y' }))
    expect(snippetProblem(full, 'List', 'ls')).toBe('full')
  })
  it('adds trimmed and removes by id', () => {
    const list = addSnippet(DEFAULT_SNIPPETS, ' Uptime ', ' uptime ', 'up')
    expect(list[list.length - 1]).toEqual({ id: 'up', label: 'Uptime', command: 'uptime' })
    expect(removeSnippet(list, 'up')).toEqual(DEFAULT_SNIPPETS)
  })
})

describe('keys inside the shell', () => {
  it('sends ordinary keys and Ctrl+C without a selection to the shell', () => {
    expect(routeKey(key({ key: 'a' }))).toBe('shell')
    expect(routeKey(key({ key: 'c', ctrl: true }))).toBe('shell')
    expect(routeKey(key({ key: 'k', ctrl: true }))).toBe('shell')
    expect(routeKey(key({ key: 'c', ctrl: true, mac: true }))).toBe('shell')
  })
  it('copies a selection and pastes with Ctrl+V or Ctrl+Shift+V', () => {
    expect(routeKey(key({ key: 'c', ctrl: true, hasSelection: true }))).toBe('copy')
    expect(routeKey(key({ key: 'C', ctrl: true, shift: true, hasSelection: true }))).toBe('copy')
    expect(routeKey(key({ key: 'C', ctrl: true, shift: true }))).toBe('app')
    expect(routeKey(key({ key: 'v', ctrl: true }))).toBe('paste')
    expect(routeKey(key({ key: 'V', ctrl: true, shift: true }))).toBe('paste')
    expect(routeKey(key({ key: 'v', meta: true, mac: true }))).toBe('paste')
    expect(routeKey(key({ key: 'c', meta: true, mac: true, hasSelection: true }))).toBe('copy')
  })
  it('leaves the toggle, screen shortcuts and zoom to the app', () => {
    expect(routeKey(key({ key: '`', code: 'Backquote', ctrl: true }))).toBe('app')
    expect(routeKey(key({ key: '3', code: 'Digit3', ctrl: true }))).toBe('app')
    expect(routeKey(key({ key: '=', ctrl: true }))).toBe('app')
    expect(routeKey(key({ key: '`', code: 'Backquote', ctrl: true, alt: true }))).toBe('shell')
  })
})

describe('local and server tabs', () => {
  it('names a tab after its program and says where it runs', () => {
    expect(tabName({ kind: 'local', label: 'pwsh', n: 2 })).toBe('pwsh 2')
    expect(tabName({ kind: 'local', label: null, n: 1 })).toBe('local 1')
    expect(tabName({ kind: 'server', label: null, n: 3 })).toBe('ssh 3')
    expect(tabPlace({ kind: 'local', via: 'local' }, 'root@vps')).toBe('this computer')
    expect(tabPlace({ kind: 'server', via: 'system-ssh' }, 'root@vps')).toBe('root@vps')
    expect(tabPlace({ kind: 'server', via: 'builtin' }, 'root@vps')).toBe('root@vps (built-in SSH)')
  })
  it('puts a command only on a shell prompt, never on a password or host question (F-CFG-26)', () => {
    expect(looksLikePrompt('Welcome\r\n\x1b[01;32mroot@vps\x1b[00m:~$ ')).toBe(true)
    expect(looksLikePrompt('PS C:\\Users\\me> ')).toBe(true)
    expect(looksLikePrompt('me@mac ~ % ')).toBe(true)
    expect(looksLikePrompt('root@vps:~# ')).toBe(true)
    expect(looksLikePrompt("root@1.2.3.4's password: ")).toBe(false)
    expect(looksLikePrompt('Enter passphrase for key /home/me/.ssh/id_ed25519: ')).toBe(false)
    expect(looksLikePrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe(false)
    expect(looksLikePrompt('Last login: today\r\n')).toBe(false)
    expect(looksLikePrompt('$ ls')).toBe(false)
    expect(plainTail('\x1b]0;title\x07a\x1b[1mb\x1b[0m\r\n')).toBe('ab\n')
  })
  it('opens local tabs by default and keeps system ssh for server tabs', () => {
    expect(SETTINGS_DEFAULTS['terminal.newShell']).toBe('local')
    expect(SETTINGS_DEFAULTS['terminal.serverVia']).toBe('system')
    expect(SETTINGS_SCHEMA['terminal.newShell'].safeParse('server').success).toBe(true)
    expect(SETTINGS_SCHEMA['terminal.serverVia'].safeParse('telnet').success).toBe(false)
  })
})
