# M9a · Logs, Gateway and Approvals: design

PRD: 6.16 (F-LOG-1..9), F-SHELL-5 (gateway and agent offline alerts), F-NAV-5 (Logs badge), F-NAV-7 (the palette action "show errors from the last hour"). Mockup: `mockup/src/Logs.dc.html`. The UI is English only; this document is not.

M9 is split in two: **M9a** (this one) and **M9b** (cron control, run history and incidents in the Cron dialog, with its own spec).

## Scope

In: the **Logs** screen with three sub-tabs, **Logs** (tail of `agent.log`, `errors.log`, `gateway.log`, `tool_calls.log`, filters, search, follow, secret masking), **Gateway** (state per agent and platform, **Restart** and **Stop** with a confirm) and **Approvals** (read-only policy, F-LOG-7/8); the **Logs badge** in the sidebar (ERROR lines in the last hour) and the Gateway tab count; the palette action "Show errors from the last hour"; a Settings → Alerts rule and a desktop notification when an agent's gateway stops or a platform fails.

Out: Start of a gateway (F-LOG-6: the user starts it from a terminal or systemd), any change to approval policy, cron control (M9b), the terminal.

## Decisions

| Question | Choice | Why |
|---|---|---|
| How are logs read? | A read-only collector query `logs_read` that opens the file itself from a fixed list of names under `<home>/logs/` or `<home>/profiles/<p>/logs/`; no `tail` command, no path from the renderer | Same safety as the other queries; offsets make Follow cheap. |
| Follow | The renderer asks again every 2 s for the bytes after the last offset while Follow is on, the screen is visible and the window is visible | The main collector has no control channel; a small query per 2 s only while someone is watching. |
| Log format | Unknown. A tolerant parser in the renderer (`lib/logParse.ts`) takes a leading timestamp, a level word and a component when it finds them; every other line keeps `level: unknown` and is shown raw | PRD: the log format is not documented. Nothing is dropped. |
| Gateway data | Added to the existing `agents` event (`AgentInfo.gateway`): state, pid alive, heartbeat age, exit reason and platforms with state and error code, from the profile's own `gateway_state.json` | The shape is known from a real Hermes v0.21.0; live without polling, and the badge and the watcher need it anyway. |
| Logs badge | The collector counts ERROR and CRITICAL lines with a timestamp inside the last hour in each profile's `errors.log`, at most once per 60 s and only when the file changed, and sends `AgentInfo.errors1h` | F-LOG-9 needs a number while the Logs screen is closed; one 64 KB tail per profile per minute is cheap. |
| Level of DEBUG | Off by default (F-LOG-2); levels are shown as text | PRD. |
| Approvals | `hermes -p P config get approvals --json` and `hermes -p P approvals suggest --days 30`, parsed tolerantly, raw text kept; the screen only offers Copy | The output shapes are unverified. |
| Range | Own setting `logs.range` (`15m`, `1h`, `6h`, `24h`); the agent is the shared `filters.agent` | The shared range is in days. |

## Zero-Change rules that shape the design

- Reads only: `logs_read` opens files read-only and never follows symlinks out of the logs folder; the file name must be one of four fixed names; `.env` and `auth.json` are never touched.
- Secrets: Hermes masks secrets in logs; the app additionally masks token-like patterns in everything it shows or copies (`lib/redact.ts`).
- The only writes are **Restart** and **Stop** of one agent's gateway (`hermes [-p P] gateway restart|stop`), each after a confirm that shows the exact command; built in main from `{action, profile}`, logged without output.
- Nothing is installed or created on the VPS.

## Collector (`collector/mc_collector.py`)

### `logs_list`

Args: `profiles[]` (empty = all). For each profile, the files among `agent.log`, `errors.log`, `gateway.log`, `tool_calls.log` that exist in its logs folder, with `size` and `mtime`. Answer: `{ files: [{ profile, name, size, mtime }], errors: [] }`.

### `logs_read`

Args: `profile`, `file` (one of the four names), `after?` (byte offset), `limit` (default 500, at most 2000 lines).

- Without `after`: the last `limit` lines, read backwards in 64 KB chunks, at most 1 MiB; answer `{ lines, offset (end of file), size, mtime, startOffset (where the first returned line begins), more: bool (older lines exist) }`.
- With `after`: the bytes from `after` to the end, at most 256 KiB, split into whole lines (a partial last line stays for the next read); `reset: true` and the last lines when `after` is larger than the size (rotated); `skipped: true` when more than 256 KiB were new (the newest part is returned).
- Each line is cut at 4,000 characters, invalid UTF-8 is replaced. Rotated files (`agent.log.1`) are not read.

### Gateway details and the error count in the `agents` event

`AgentInfo.gateway: { state: string | null, pidAlive: boolean | null, updatedAgeS: number | null, exitReason: string | null, restartRequested: boolean, platforms: [{ name, state: string | null, errorCode: string | null }] } | null` from the profile's own `gateway_state.json` (older multiplex layout: the home file). Unknown fields are ignored; a missing file gives `null`. `AgentInfo.errors1h: number | null`: the ERROR/CRITICAL count described above (null when `errors.log` is missing or has no parseable timestamps).

## Main process

- `QueryCommand` gets `logs_list` and `logs_read` (zod in `ipc.ts`: profile regex, file enum, `after` integer at least 0, `limit` 1 to 2000), `MissionSession.logsList/logsRead`, channels `mc:logs:list`, `mc:logs:read`.
- `src/main/gateway/service.ts` `GatewayService.run(action: 'restart' | 'stop', profile)` builds `hermes [-p P] gateway <action>` (60 s timeout, output trimmed to 400 characters); channel `mc:gateway:action`. The Settings restart keeps working as it is.
- `src/main/approvals/service.ts` `ApprovalsService.read(profile)` runs the two read-only commands and returns `{ policy: Record<string, unknown> | null, policyRaw: string, suggest: string, errors }` (parsing in `lib/approvals.ts` of the renderer; main only returns text); channel `mc:approvals:read`.
- `src/main/gateway/watcher.ts` `GatewayWatcher.ingest(agents)`: the first batch is a baseline; later it reports an agent whose gateway went from running to a stopped or failed state, or whose platform went to a failed state (`fatal`, `error`, `failed`, or an `errorCode`), once per change. The notification only rings when the window is not in front (like cron). Settings `alerts.gateway.enabled` (default true) turns it off.

## Renderer

```
screens/Logs.tsx                   tabs Logs, Gateway, Approvals, states
screens/logs/LogsTab.tsx           toolbar, virtualized list, follow, detail
screens/logs/GatewayTab.tsx        table, Restart and Stop dialog
screens/logs/ApprovalsTab.tsx      policy, suggestions, the notes of F-LOG-8
lib/logParse.ts                    parseLine, parseLines (timestamp, level, component), LEVELS
lib/logFilter.ts                   filterLines (levels, component, range, search), highlight split, componentsOf
lib/redact.ts                      maskSecrets(text)
lib/gateway.ts                     view model of AgentInfo.gateway, problem platforms, badge count, stale rule
lib/approvals.ts                   parsePolicy (tolerant), suggestions lines
stores/logs.ts, logsActions.ts     state and IO (open file, follow timer, stale answers dropped)
```

- **Logs tab**: toolbar with agent (shared `filters.agent`, "all" reads each agent's chosen file in turn is out of scope: one agent at a time, the first agent when "all"), file select (only existing files), level chips (DEBUG off by default), component select (from the loaded lines), range select, search with highlight, **Follow** and **Wrap** toggles. Lines are chronological, newest at the bottom. Follow keeps the list at the bottom; scrolling up or opening a line pauses it and a "N new lines" button jumps back. A row shows time, level as text, component and message; opening it shows the full line. **Copy** copies the visible lines after masking. A note says "Showing the last N lines" when older lines exist and a **Load older** button reads further back (`before` is not needed: the next read uses a smaller `startOffset` window of 1 MiB at most).
- **Gateway tab**: one row per agent (state label, heartbeat age with "stale" over 120 s, pid alive, exit reason) and below it its platforms with state labels and error codes; unknown fields are not hidden (a "raw" disclosure shows the platform object keys). **Restart** and **Stop** open a confirm with `$ hermes -p <p> gateway restart|stop`, the note that Stop leaves the agent offline until it is started from a terminal, and the result text. No Start.
- **Approvals tab**: per agent the policy table (`approvals.mode`, `cron_mode`, `single_query_mode`, `unattended_mode`, `timeout`, `deny`, `command_allowlist`; missing keys show "—", unknown keys show as they are), the raw suggestions with a Copy button per line, and the statement that Hermes keeps no log of approve and deny decisions and shows no pending approvals (F-LOG-8).
- **Badges**: the sidebar Logs item shows the sum of `errors1h` (orange); the Gateway tab shows the number of platforms that are not healthy. `lib/gateway.ts` `problemPlatforms` is the one place that decides what is unhealthy. The palette gets "Show errors from the last hour" (opens Logs with levels ERROR and CRITICAL, range `1h`, file `errors.log`) and the Logs screen is no longer "Coming in a later release".
- **Dashboard and Settings**: a GATEWAY row in the Dashboard Alerts tab for each unhealthy gateway or platform, and a switch in Settings → Alerts ("Alert when an agent's gateway stops or a platform fails").

## Errors and edge cases

- A profile without a logs folder or file: the file select is empty and the tab says "No log files for <agent>".
- `logs_read` failing (not found, unreadable) shows the cause with Retry and keeps the lines already shown.
- A log that rotates while following (`reset`) clears the list and says "The log was rotated".
- A line without a timestamp or level is shown raw with level "unknown" and passes the level filter only when "unknown" is on (it is on by default, so nothing disappears).
- Not connected: the screen shows the connection error state; Gateway and Approvals actions are disabled.
- Stopping the gateway of the agent that answers a chat ends that chat turn; the dialog says so.

## Testing

- **pytest** (`tests/collector/test_logs.py`): `logs_list` (existing files only, size, mtime, profile filter, symlink out of the folder ignored), `logs_read` (last N lines, `more`, chunked backwards read over a file larger than 64 KB, `after` offsets, partial last line left for the next read, rotation `reset`, `skipped`, line cut, invalid UTF-8, bad file name, bad profile, bad offset), the gateway block of the `agents` event (running, stopped, fatal platform, missing file, multiplex layout, unknown fields) and `errors1h` (counts only ERROR and CRITICAL inside the hour, no timestamps gives null, cache until the file changes). The fixture gets log files.
- **Vitest**: `logParse` (several timestamp and level shapes, no timestamp, multi-line continuation lines kept with the previous line), `logFilter`, `redact` (tokens, bearer, keys, JWT, long hex, no false positive on ordinary words), `gateway` (problems, stale rule, badge count), `approvals` (tolerant policy parse), `GatewayWatcher` (baseline, one report per change, recovery, disabled), stores and `logsActions` (follow timer, stale answers, reset on rotation, offsets), `GatewayService`/`ApprovalsService` argv.
- **Integration** over the fake SSH server: the two queries through `MissionSession`, `GatewayService` against the fake Hermes (`gateway restart|stop` recorded), `ApprovalsService` against fake output, Zero-Change.
- **E2E** (`tests/e2e/logs.spec.ts`): open Logs from the sidebar, see lines with levels, filter by level and component, search highlights, Follow shows a line appended to the fixture log within a few seconds, Gateway tab shows states, Restart with a confirm records the call (and Cancel does not), Approvals shows the notes, the Logs badge counts, the palette action opens Logs on errors, the gateway alert row and the Settings switch.
- **Manual** (`docs/manual-vps-checklist.md`, steps 95 onward): real log file names and line format, the `gateway_state.json` fields and platform states, `approvals` config keys and `approvals suggest` output, Restart and Stop, the notification on each OS.

## Open risks

| Risk | Handling |
|---|---|
| The log format is different from the guesses | Lines are never dropped; unparsed lines show raw; the parser is one small file; checklist step. |
| `errors.log` lines have no parseable timestamp | `errors1h` is null and the badge is hidden; the Logs tab still works. |
| Platform state words differ | `lib/gateway.ts` holds the list of healthy words (`connected`, `running`, `ok`, `ready`); anything else with an error code or a words like fatal, error, failed counts as a problem. |
| `approvals` config shape or `suggest` output differ | Raw text is always kept and shown; checklist step. |
