# Multi-VPS: saved servers and switching (F-CONN-14..17, v2)

## Goal

Keep several Hermes servers in the app and move between them without retyping anything (PRD §3 scope note, §10 v2
candidate "Multi-VPS"). One server is connected at a time: switching disconnects the current one and connects the
chosen one. Background connections, several windows and cross-server views are out of scope.

## Decisions

- **One active server.** Switching is a disconnect plus a connect; alerts, notifications and badges only follow the
  active server.
- **Switcher:** the connection item in the status bar opens a server menu (servers, the active one checked,
  *Add server…*, *Manage servers…*). Settings → **Servers** (was Connection) lists every server with Connect, Edit and
  Forget. The palette gets *Switch to `<server>`* and *Add server*.
- **Optional label** per server ("prod", "lab"); empty shows `user@host`. 40 characters at most, no control characters.
- **Approach A:** one `MissionSession` that knows the active connection id. The session, its services and every IPC
  handler stay; only the target changes. Rejected: a new `MissionSession` per server (every IPC handler and watcher
  bound to one object would need rewiring, for no user-visible gain) and a JSON server list in `settings` (breaks the
  `connection_id` keys of pins, looks, rooms and memory snapshots).

## Rules

- Zero-Change holds: switching only opens and closes SSH sessions. Nothing is written on any VPS.
- Data of one server never shows on another. Every row keyed by `connection_id` (pins, looks, memory snapshots, rooms,
  `chat.session.<id>.*`, `brain.vault.<id>`, `pins.initialized.<id>`) is read with the **active** id.
- A secret (password or key passphrase) belongs to its own row and is only used for that row's target.
- Labels are local only and never logged with the secret; `app.log` gets `server switch <id>` and `server forget <id>`.

## Data (`app.db` migration 7)

- `CREATE UNIQUE INDEX idx_connections_target ON connections (host, port, username)`.
- `connections.name` becomes the **label**. The migration sets `name = ''` where it still holds the automatic
  `username@host`. Display name: `name || username@host`.
- No new setting for the active server: on launch the app auto-connects to the row with the newest
  `last_connected_at` (ties: lowest id) when its `remember` is on. Reset settings keeps it because it is not a setting.

### `SettingsStore`

- `listConnections(): SavedConnection[]`: newest `last_connected_at` first, never-connected rows last by id.
- `getConnection(id?: number)`: that row, or without an id the newest one (keeps old callers working).
- `getSecretEnc(id: number)`.
- `upsertConnection({ id?, name?, … })`:
  - with `id`: updates that row. If another row already has the new `(host, port, username)` it throws
    `TargetTakenError`, and the session answers *"Another saved server already uses this address."*
  - without `id`: updates the row with the same target, else inserts one.
  - `name` absent keeps the label; `''` clears it.
  - The secret rules stay as they are (same method and key keep the secret; otherwise it is dropped).
- `renameConnection(id, name)`.
- `forgetConnection(id)`: deletes the per-connection data listed under Rules, the room tables (`GroupStore.forget`) and
  the row. The `known_hosts` entry of the row's `host:port` is deleted only when no other row uses that `host:port`.

### `SavedConnection`

- Gains `label: string` (the raw label, may be empty). `name` stays as the display name (`label || user@host`), so
  current UI code keeps working.

## Main process

- `MissionSession.activeId: number | null`.
  - `connect(req)` resolves the row: `req.connectionId`, else the row with the same target, else none (a new server).
    When a row is found, `activeId` is set to it **before** the attempt, so `saved()` and the renderer agree on which
    server is being connected, even if the attempt fails.
  - On success the upsert returns the id (new rows too), and `activeId` takes it.
  - When `activeId` changes, the session resets what belongs to one server: `cronWatcher.reset()`,
    `cronStore.clear()`, `feedCursors.clear()`, `costAlert.reset()`, `gatewayWatcher.reset()`,
    `cronActions.clear()`, and `agentNames = null`. This replaces the `lastTarget` string check, which also covered an
    edited host.
  - Every `d.store.getConnection()?.id` in `session.ts` (chat sessions, vault, room store id, looks, memory snapshots,
    `connectionId` of the services) reads `this.activeId`.
  - `credentials(req)` reads method, key path and secret from the resolved row only.
  - `BrainService` restarts with the vault path of the new server (it already restarts on every connect).
- `ConnectRequestSchema` gains `connectionId: z.number().int().positive().optional()` and
  `name: z.string().max(40).optional()` (control characters refused).
- `forget(id)`: when `id` is the active server it does what `forget()` did (disconnect, reset, delete) and sets
  `activeId = null`; otherwise it only deletes the row's data.
- `saved()` returns the active row, else the newest one.

### IPC

- `mc:connection:list` → `SavedConnection[]` (with `keyInfo` for key rows).
- `mc:connection:rename { id, name }` → `{ ok: true } | { ok: false, message }`.
- `mc:connection:forget { id }`.
- `mc:connection:connect` takes the new optional fields.

## Renderer

### Store and actions

- `useConn` gains `servers: SavedConnection[]`. It is loaded at start, after every connect result, after rename and
  after forget.
- `resetServerStores()` in `actions.ts` resets every store that holds server data: agents, looks, metrics, cron, feed,
  interactions, chat, groups, sessions, usage, palette, logs, kanban, skills, memory timeline, agent ops, agent config,
  unread, cost alert and brain. `forgetConnection` uses it, and `runConnect` calls it when the connection id differs
  from the one currently shown (today it compares the target).
- `busyWork()` (pure, `lib/servers.ts`) lists what a switch would cut: chat turns streaming or sending, running room
  runs, uploads in flight, and unsaved Settings → Agents drafts. It returns short lines such as `1 chat reply in
  progress`.
- `switchServer(id)`:
  1. If `busyWork()` is not empty, ask with a confirm dialog: *"Switch to prod? This stops: …"* (Switch / Cancel).
  2. Close the server tabs of the Terminal panel. Local tabs stay.
  3. Call `resetServerStores()`, set `saved` to the target row, and go to the **Launch** screen. Launch connects with
     `{ connectionId, useSaved: true }`. The screen already shows the startup steps and handles each outcome.
  4. Launch outcomes are unchanged:
     - connected: open the Dashboard;
     - unreachable: open the Dashboard offline, with backoff retry;
     - auth, missing secret or host key: open the Connect screen for that server, prefilled, with its error.

### Status bar server menu

- The connection item stays a button. It now opens a small menu (`role="menu"`, arrow keys, Esc, focus returns to the
  button):
  - each server: label (or `user@host`), `user@host:port` in secondary text, and `✓` on the active one;
  - a separator, then *Add server…* (opens Settings → Servers on an empty form) and *Manage servers…*;
  - clicking the active server opens *Manage servers…* on it.
- With one saved server, the menu still shows, so *Add server…* is easy to find.

### Settings → Servers

- Replaces the Connection tab. The id `connection` stays, so old `openSettings('connection')` calls still land here.
- The list shows one row per server: label, `user@host:port`, auth method, last connected and an *Active* tag. Each
  row has these buttons:
  - **Connect** (not on the active row): runs `switchServer`.
  - **Edit**: opens the form for that row.
  - **Forget…**: two-step confirm with today's text; forgetting the active server goes to the Connect screen when no
    server is left, else to the next server.
- *Add server* opens an empty form. The form is the current `ConnectionForm`, which now takes a `server` prop instead
  of reading `saved`, and gains a **name** field (optional, placeholder `user@host`). It sends `connectionId` when
  editing. *Test & save* connects to that server, so saving a non-active server switches to it, and the form says so.
- *Edit* on the active server keeps today's host key panel and trusted fingerprint line.

### Other screens

- Launch shows the display name: *auto-connecting to prod · root@1.2.3.4:22*.
- Connect, when used for an existing server (failed switch), is in edit mode for that server. First-time setup is
  unchanged.
- Status bar: the item shows the display name; its tooltip adds `user@host:port`.
- Palette (`lib/palette.ts`): a *Switch to `<display name>`* item for each non-active server and an *Add server*
  action. Both are data targets run by `paletteActions.ts`.
- Terminal: the panel title already reads `saved`; server tabs never reconnect to a different server, because the
  switch closes them first.

## Errors

- Target taken (edit to an address another row has): the form shows the message on the host field and nothing is
  written.
- A switch to a server whose saved key file is gone: Connect screen, *"Choose the key file again."* (existing message).
- Forgetting the last server: back to first-time setup, as today.
- A switch while another switch is connecting: the newer one wins (the session already cancels by `generation`).

## Testing

- Unit:
  - `settingsStore.test.ts`: migration 7 clears auto names and keeps labels; list order; upsert by id, by target and
    insert; `TargetTakenError`; rename; `forget(id)` keeps `known_hosts` shared by another row and deletes the row's
    data only.
  - `lib/servers.ts`: `displayName`, `busyWork` lines, the server menu items.
  - `paletteLib.test.ts`: switch items for non-active servers only.
- Integration (`tests/integration`, fake SSH): two fake servers. Connect A, connect B with a new target (a new row,
  A's row unchanged), switch back to A by `connectionId` using A's saved secret, and check that A's chat session id
  and pins survive B. Forgetting B while A is active leaves A connected.
- E2E (`tests/e2e/servers.spec.ts`): two `startFakeSsh` servers. Add a second server from the status bar menu, check
  the Dashboard shows the second server's agents, switch back from the menu, rename a server in Settings → Servers, and
  forget the non-active one.
- The manual VPS checklist gets steps for a second real VPS: switch both ways, and auto-connect to the last one on
  launch.

## Docs

- PRD: F-CONN-14..17 in the connection table, v1.5 in the change log, §3 and §10 mark Multi-VPS as built. The mockup is
  not changed: the switcher is a menu on an existing status bar item and a list in an existing Settings tab.
- CLAUDE.md: a Multi-VPS paragraph and the state line.
