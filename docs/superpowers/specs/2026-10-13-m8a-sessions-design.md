# M8a · Sessions: design

PRD: 6.x Sessions (F-SESS-1..7), F-NAV-8 (shared filters). Mockup: `mockup/src/Sessions.dc.html`. The UI is English only; this document is not.

M8 is split in three, each with its own spec, plan and build: **M8a Sessions** (this one, with the shared agent and range filter), M8b Usage (cost charts, tools tab, daily cost alert) and M8c navigation (badges, command palette). M8b reads the filters made here; M8c indexes the sessions loaded here.

## Scope

In: the **Sessions** screen (replaces `ComingSoon` for the `sessions` route): virtualized session list, search inside messages, transcript panel, parent/child chain, actions Continue in Chat, Pin/Unpin, Rename (through the official CLI, after a confirm) and a local Export (jsonl, markdown, html). Shared filters `filters.agent` and `filters.range` in `app.db`.

Out: Usage, badges, palette, `Ctrl+K` (M8b, M8c); deleting sessions (not offered, PRD); `hermes sessions export` (it writes a file on the VPS); archive and prune.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where does the data come from? | On-demand read-only queries (`--query`), no new stream | Same pattern as `feed.session` and `note`; nothing runs while the screen is closed; F-SESS-7 forbids loading everything. |
| Refresh | The list of the first page is re-read every 10 s while the Sessions screen is shown and the window is visible. Not while a search is active. | Cheap (one indexed query per profile) and keeps "running" and counts fresh. |
| Four commands or three? | **Three**: `sessions_list`, `sessions_search`, `session_transcript`. The chain (parent, children with titles) is part of the transcript answer. | One round trip fewer when a session is opened. |
| Tool chips | Paired in the renderer (`lib/transcript.ts`), not in the collector | `FeedItem` already carries the tool call and the result in order. The collector stays a plain reader. Pairing, duration and failure are best effort and the UI says so. |
| Export | Built in the renderer from the pages already read (all pages, capped), written by the main process through a native save dialog | Nothing is written on the VPS; the renderer never picks a path. |
| Pin, Rename | `hermes [-p P] sessions pin|unpin|rename ...` from the main process after a confirm that shows the exact command | PRD F-SESS-5 and Zero-Change: official CLI, explicit user action. The CLI syntax is unverified: checklist steps. |

## Zero-Change rules that shape the design

- Every query opens `state.db` with `?mode=ro` and `query_only`; only `messages` rows with `active=1` are read; `.env` and `auth.json` are never touched.
- The renderer sends data (profile names, a search string, an id, a cursor), never a path, SQL or command. `ipc.ts` checks everything with zod, the profile and session id with the existing regexes; `q` is at most 200 characters; limits are clamped.
- The search string is never put in SQL text: it is turned into a quoted FTS expression (each word wrapped in double quotes, quotes doubled) and passed as a bound parameter.
- Pin, Unpin and Rename are the only writes. Each is built with `buildCommand` from `{profile, sessionId, action, title?}` (title trimmed, 1 to 80 characters, no control characters). The log keeps the action and id, not the title.

## Collector (`collector/mc_collector.py`)

Three new handlers in `run_query`. Columns are checked with `table_columns`; a missing column becomes `NULL` (the Hermes column list is not guaranteed). A profile whose `state.db` is missing is skipped; one that cannot be read is reported in `errors[]` and the others still answer. A schema without `sessions.id`/`started_at` gives `unsupported_schema`.

### `sessions_list`

Args: `profiles[]` (empty means all), `source?`, `sinceTs?` (epoch seconds), `before?: {ts, id}`, `limit` (1 to 100, default 50).

Per profile: `SELECT ... FROM sessions WHERE (started_at > sinceTs) AND source = ? AND (started_at < ts OR (started_at = ts AND id < ?)) ORDER BY started_at DESC, id DESC LIMIT limit`, then the rows of all profiles are merged, sorted by `(startedAt, id)` descending and cut to `limit`. The cursor for the next page is the last row. Rows whose `started_at` is NULL sort last.

Row: `profile, id, title, source, model, startedAt, endedAt, endReason, messageCount, toolCallCount, inputTokens, outputTokens, cacheReadTokens, cost, costKind ('actual' | 'estimated' | null), parentSessionId, hasChildren, pinned, status`.

- `cost`: `actual_cost_usd` when not NULL, else `estimated_cost_usd` (`costKind` says which). When a `cost_status` column exists and holds a value other than `actual` or `estimated` (or NULL), `cost` is null and the UI shows "—" (F-USAGE-4).
- `status`: `running` (no `ended_at` and no `end_reason`), `failed` (`end_reason` contains `error`, `fail` or `crash`, case-insensitive), `compressed` (has children by `parent_session_id`), otherwise `ended`. Failed wins over compressed, running over both.
- `hasChildren` is one query per profile for the ids of the page (`WHERE parent_session_id IN (...)`).
- `pinned`: the `pinned` column when present, else false.
- Also returns `sources[]` (distinct `source` values over the profiles, at most 30) for the dropdown, `errors[]` and `more` (true when the cut dropped rows).

### `sessions_search`

Args: the filters of `sessions_list` (no cursor), `q` (1 to 200 characters), `limit` (1 to 200, default 200).

1. If `messages_fts` exists: `SELECT m.session_id, snippet(messages_fts, -1, X'02', X'03', '…', 14) FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? AND m.active = 1` (plus the filters through a join on `sessions`), ordered by `rank`, `LIMIT limit` hits. Hits are grouped by session (first snippet wins) and the sessions are loaded with the same row shape as the list. The marker bytes 0x02 and 0x03 wrap the matching words; the renderer turns them into `<mark>` without ever using HTML from the server.
2. If there is no FTS table, or the query raises an FTS error, fall back to `sessions.title LIKE ? ESCAPE '\'` and answer `fallback: 'title'` so the UI says "Searching titles only: this database has no message index".

Results are ordered by relevance within the 200 hits, newest first on ties.

### `session_transcript`

Args: `profile`, `sessionId`, `afterId?` (message id), `limit` (default 200, max 200).

Messages with `active=1` and `id > afterId`, ordered by `id`, converted with the existing `row_items` (kinds user, thinking, reply, tool, result). Answer: `session` (the same row shape as the list, for the header), `items`, `nextAfter` (the last message id when the page was full, else null), `chain: {parent: {id, title} | null, children: [{id, title, source}]}` (children at most 50) and `total` (the session's `message_count`, may be null).

`q_session` of the Feed stays as it is; the Live feed modal keeps using it.

## Main process

- `QueryCommand` gets `sessions_list`, `sessions_search` and `session_transcript`; `ipc.ts` has zod schemas for them; `MissionSession` exposes `sessionsList/Search/Transcript`; channels `mc:sessions:*`; `MissionApi.sessions` is added (typed, with the zod types in `shared/events.ts`).
- `src/main/sessions/actions.ts`, `SessionActionService`: `pin(profile, id)`, `unpin`, `rename(profile, id, title)`. Same shape as `ModelService`: `ready()` check, `run` that never throws, output trimmed to 600 characters, an answer `{ok:true}` or `{ok:false, error, detail}`. `shared/sessions.ts` has `sessionCommandPreview(action, profile, id, title?)` (the text shown in the confirm) and the title rules; main rebuilds the argv itself.
- `src/main/sessions/export.ts`: `saveExport({name, ext, content})` opens `dialog.showSaveDialog` with `<name>.<ext>`, ext one of `jsonl|md|html`, content at most 50 MB, and writes UTF-8 to the chosen path. Returns `{saved: path}` or `{canceled: true}`.
- Settings: `filters.agent: string` (`all` or a profile name, max 64) and `filters.range: '24h' | '7d' | '30d' | 'all'` in `shared/settings.ts` with schema and defaults. Defaults: agent `all`, range `7d`. Reset settings (F-APP-5) resets them like every key.

## Renderer

```
screens/Sessions.tsx            layout: list column + detail column (below 900 px the detail replaces the list)
screens/sessions/SessionList.tsx    virtualized rows (TanStack Virtual), load-more row, states
screens/sessions/SessionFilters.tsx agent chips (menu over 8 agents), source select, range select, search box
screens/sessions/Transcript.tsx     header, chain links, actions, message list, tool chips
screens/sessions/ActionDialogs.tsx  rename and pin confirm with the command preview
stores/sessions.ts              list, query, selection, transcript pages, action state
sessionsActions.ts              IO: loadList, refreshList, search, openSession, loadMore, pin/rename, exportSession, continueInChat
lib/sessions.ts                 pure: filter -> query args, mergeFirstPage, statusLabel, costLabel, highlight split
lib/transcript.ts               pure: pair tool calls with results, duration, failed guess
lib/sessionExport.ts            pure: jsonl, markdown, html (escaped) builders
```

- **List (F-SESS-1)**: newest first; title (or "Untitled session" plus the id), agent color dot and name, `source` chip, message and tool-call counts, cost with "est." when `costKind` is estimated, relative time, a flag for pinned, a status chip (running, ended, failed, compressed). Row height is fixed so the virtualizer stays simple. The last row is "Load more" (cursor) until `more` is false.
- **Filters (F-SESS-2, F-NAV-8)**: agent chips and range select write to settings (`filters.*`) through `ui.patchSettings` plus `settings.set`; source and search text are local. A saved agent that no longer exists is treated as `all` without overwriting the setting. Changing a filter re-runs the query; the search box has a 250 ms debounce. An empty search box runs `sessions_list`; a non-empty one runs `sessions_search`, rows show the snippet with the matches in `<mark>`.
- **Transcript (F-SESS-3, 4, 7)**: header with title, ids, model, duration, tokens, cost; chain links ("continues ...", "continued in ...") that open the other session; messages rendered with the existing `Markdown` component (DOMPurify) for replies, a collapsed "Thinking" block, and tool chips: name, argument summary (`toolPreview`), approximate duration (result time minus call time) and a red "failed?" label when the result text looks like an error. Opening a chip shows the arguments and the output. The first page is the oldest 200 messages; "Load next 200" appends. Never more than 200 messages per request.
- **Actions (F-SESS-5)**: *Continue in Chat* selects the agent, calls the existing `resumeSession(profile, id)` and navigates to Chat (every profile has a chat room, so it is always offered). *Pin/Unpin* and *Rename* open a small confirm showing `sessionCommandPreview`; on success the list row is patched and the first page re-read. *Export* reads all pages (at most 50 pages, 10,000 messages, then says "Exported the first 10,000 messages"), builds the file and calls the save dialog; the toast says "Saved to <path>. Built on this computer, nothing was written on the server."
- **States (F-SESS-6)**: loading (skeleton rows), empty ("No sessions yet" and "No results", the second with a Clear search and filters button), error (cause, Retry; the last list stays visible under a `StaleBanner` with its age), `unsupported_schema` ("This Hermes version stores sessions in a layout this app does not know").
- Keyboard: arrow keys move through the list, Enter opens, the search box has a label; the list is `role="listbox"` with `aria-selected`, status chips have text, not only color.

## Errors and edge cases

- A profile that fails inside a multi-profile query is listed in `errors` and shown as a one line notice ("scout: state.db could not be read"); the other profiles' rows still appear.
- Disconnect during a query: `not-connected` is shown as an error with Retry; reconnect does not auto-reload (the 10 s refresh picks it up).
- Pin or Rename failing returns the CLI's trimmed message in the dialog; nothing is patched locally.
- A selected session that disappears from a refreshed first page stays open (it may simply have scrolled to a later page).
- Sessions with a NULL `started_at` are shown last and as "unknown time".

## Testing

- **pytest** (`tests/collector/test_sessions.py`): list fields, pagination across two profiles without gaps or repeats, filters (profiles, source, since), cost rules, status rules, `hasChildren`, missing columns, schema without sessions, FTS search with snippet markers, fallback without FTS, quoting of hostile search text, transcript paging by `afterId`, chain, bad args. `make_fixture.py` gets `add_fts(db)` and extra session columns (`end_reason`, `pinned`, `cost_status`, `cache_read_tokens`, `title`).
- **Vitest**: `lib/sessions`, `lib/transcript`, `lib/sessionExport` (HTML is escaped), `shared/sessions` (command preview, title rules), settings schema, store reducers.
- **Integration** over the fake SSH server: the three queries through `QueryRunner`, and `SessionActionService` against the fake Hermes (`sessions pin|unpin|rename` added to `tests/helpers/fakeHermes.ts`); the ipc arg schemas reject bad profile, id, long `q`, control characters in a title.
- **E2E** (`tests/e2e/sessions.spec.ts`): open Sessions, see rows, search, open a transcript, follow the chain, pin, rename with the confirm, export (save dialog stubbed), continue in Chat lands on the Chat screen with that session. Zero-Change test: the fixture snapshot is unchanged after browsing.
- **Manual** (`docs/manual-vps-checklist.md`, steps 78 onwards): real `messages_fts` shape and the `rowid` join, `cost_status` values, `end_reason` values, `sessions pin|unpin|rename` syntax and exit codes, search speed on a large `state.db`.

## Open risks

| Risk | Handling |
|---|---|
| `messages_fts` is not keyed by `messages.id`, or has another shape | The join error is caught and the title fallback is used with a visible note; checklist step. |
| `sessions pin|unpin|rename` differ on the real Hermes | The failure text is shown; the preview is the only place the syntax lives (`shared/sessions.ts`). |
| A very large `state.db` makes FTS slow | `LIMIT 200`, 15 s timeout, debounce, query cancelled by ignoring stale answers (sequence number); measured in the checklist. |
