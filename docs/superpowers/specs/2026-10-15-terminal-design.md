# Terminal panel (F-TERM-1..7, F-R12-2, F-R13-3, F-CFG-26)

## Goal

A full SSH shell inside the app, on every screen, so the user can do what Mission Control deliberately does not
(OAuth logins, `hermes mcp add`, `hermes fallback add`, restores) without leaving it.

## Rules

- It is a shell, not a feature of the app: the app never types into it by itself. The only text the app puts there is a
  command from a "… in the terminal" button or a snippet, as one line without a line end (`fillText`), so it never runs
  until the user presses Enter (F-CFG-26, F-TERM-5).
- Input and output are never logged. `app.log` only gets `terminal opened (n open)` and `terminal closed`.
- No new remote files, ports or processes beyond the login shell the SSH server starts for the channel; it ends with the
  channel.

## Main process

- `ConnectionManager.openShell({cols, rows})`: ssh2 `client.shell({ term: 'xterm-256color', cols, rows })`.
- `TerminalService`: a map of shell id (random UUID) to channel. UTF-8 decoding with `StringDecoder` (a character split
  between chunks stays whole), output batched for about 8 ms or 64 KiB and sent as `mc:ev:term-data {id, data}`.
  `mc:ev:term-exit {id, reason, code}`: `exited` when the channel closed by itself (exit, Close tab), `disconnected` from
  `closeAll`, which the session calls on teardown and on an unexpected close. At most 6 shells.
- IPC `mc:term:open|write|resize|close`; zod checks the id (`TERM_ID_RE`), sizes (cols 2-1000, rows 1-500) and at most
  64 KiB per write (the renderer cuts pastes with `chunks`). Resize is `setWindow(rows, cols, 0, 0)` (window-change).

## Renderer

- `terminalActions.ts` keeps one xterm `Terminal` per tab outside React (fit and search addons, scrollback 5,000,
  Dracula colours, JetBrains Mono). A closed panel stays mounted with `hidden`, so screens and shells live on; a panel
  that mounts again (after the connect screen) re-parents the existing xterm element.
- Keys inside xterm (`routeKey`): Ctrl+` (toggle), Ctrl+digits and zoom go to the app; Ctrl+C with a selection copies,
  without one it is ^C; Ctrl+V and Ctrl+Shift+V paste through the Edit menu; on macOS Cmd+C/V. Ctrl+K stays with the
  shell (readline), the palette has the sidebar Search button.
- Reconnect (F-TERM-6): a tab whose shell ended as `disconnected` gets a new shell when the status becomes connected
  again and prints `[Reconnected.]`. A tab whose shell exited offers **Start a new shell**.
- `fillCommand`: opens the panel, uses the active live tab (or a new one), and writes the text after the shell's first
  output has been quiet for 250 ms so it lands after the prompt.
- Panel (`TerminalPanel`): fixed above the status bar, full width, z-index 30 (the status bar's layer), `Resizer`
  140-520 px saved on release (`terminal.height`; 0 means never dragged, then about 17 % of the window, 140-200 px,
  F-DASH-7), tabs with state dots, **+**, search bar, snippets, Clear, Close. Esc closes it only when focus is outside
  the shell, outside other text fields, and no modal or palette is open.
- Snippets (F-TERM-7): setting `terminal.snippets` (at most 30; name 40, command 500 characters, one line). Defaults
  are read-only Hermes commands. Clicking one fills it, never runs it.
- "… in the terminal" in Settings → Agents (`TerminalCommand`): **Open in the terminal** closes Settings (through
  `requestLeave`, so unsaved agent edits are confirmed) and fills the command; **Copy** stays.
- Palette action "Open or close the terminal"; sidebar Terminal button (`aria-pressed`).

## Not done

- Persisting scrollback across app restarts (the shell itself cannot survive a restart).
- WebGL renderer (the DOM renderer is enough for 6 tabs and keeps the CSP unchanged).

## Tests

- Unit: `tests/unit/terminal.test.ts` (fillText, heights, tabs, chunks, Esc, snippets, keys).
- Integration: `tests/integration/terminal.test.ts` against `tests/helpers/fakeShell.ts` (PTY size, no input on open,
  echo, window-change, six tabs and the seventh refused, exit, close, drop ends shells as disconnected, logs without
  input).
- E2E: `tests/e2e/terminal.spec.ts` (sidebar, Ctrl+`, tabs, search, snippets, height, Esc, Open in the terminal,
  reconnect).
- Manual: checklist steps 132-137.
