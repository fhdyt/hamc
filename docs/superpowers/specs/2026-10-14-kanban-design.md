# Kanban: design

PRD: 6.20 F-R12-10 (read-only Kanban screen), F-R12-9 (display names), Q20. Mockup: `mockup/src/Kanban.dc.html`. The UI is English only; this document is not.

## The real schema (seen on the user's VPS, Hermes v0.21)

Two boards exist: the default one at `~/.hermes/kanban.db` (empty) and `~/.hermes/kanban/boards/sim-kanban/kanban.db` (3 done tasks, 12 events, 3 runs, 2 links). `hermes kanban --help` lists commands such as `list`, `show`, `boards`, `runs`, `stats`; the app does not use them (the database is read directly, like the other screens).

| Table | Columns used |
|---|---|
| `tasks` | `id` TEXT, `title`, `body`, `assignee`, `status`, `priority` INTEGER, `created_by`, `created_at`, `started_at`, `completed_at` (INTEGER times), `result`, `last_failure_error`, `consecutive_failures`, `block_kind`, `skills`, `model_override`, `provider_override`, `session_id`, `current_run_id` |
| `task_comments` | `id`, `task_id`, `author`, `body`, `created_at` |
| `task_runs` | `id`, `task_id`, `profile`, `step_key`, `status`, `started_at`, `ended_at`, `outcome`, `summary`, `error` |
| `task_links` | `parent_id`, `child_id` |
| `task_events` | `id`, `task_id`, `run_id`, `kind`, `payload` (text), `created_at` |
| `task_attachments` | `id`, `task_id`, `filename`, `size`, `uploaded_by`, `created_at` (metadata only; files are never fetched) |

Status words seen or named by the CLI: `done` (seen), `triage`, `todo`, `ready`, `running`, `blocked`, `scheduled`, `review`, `archived`. Priority was 0 for every task; which direction means urgent is not known.

## Scope

In: the **Kanban** screen (replaces `ComingSoon` for `kanban`): board picker, columns by status, cards, filter by assignee, search, a detail dialog; palette and sidebar entries lose their "later release" note. Also a fix of the **agent graph** for this schema (task ids are text; the event time is `created_at`).

Out: any write (create, assign, comment, move, archive: PRD says no write actions in v1.2), the `hermes kanban` CLI, live streaming of events (the board refreshes by polling), attachments' content.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Data | Three read-only collector queries `kanban_boards`, `kanban_tasks`, `kanban_task`; refresh of the board every 10 s while the screen is visible | Same pattern as Sessions; nothing runs while the screen is closed. |
| Boards | The home `kanban.db` is the board `default`; every `kanban/boards/<slug>/kanban.db` is the board `<slug>`. The picker lists them with their task counts and remembers the choice (`kanban.board`, empty until the reader picks one, so a fresh start opens the first board with tasks even when `default` is empty). First open: the saved board, else the first board that has tasks, else `default`. | The CLI's "current board" is Hermes's own state and is not read. |
| Columns | `triage`, `todo`, `ready`, `running`, `blocked`, `review`, `done` always; `scheduled` and `other` (any status word not named above) only when they have tasks; `archived` tasks are not shown, only counted ("N archived are hidden") | PRD asks for seven columns that fit 1440 px; nothing may disappear silently. |
| Priority | Shown as a chip `P<n>` only when it is above 0; cards are ordered by priority descending, then newest first | Direction of urgency is unverified (all zero today); showing the raw number states no more than we know. |
| Task ids | Text, shown as written (monospace, truncated by CSS, full in the title and the dialog) | The ids on the server are text. |
| Big boards | The query returns at most 1,000 non-archived tasks (newest first) and says if it cut; the Done column shows 30 and a "Show N more" button | Keeps the answer small and the board readable. |
| Time | `to_epoch` already reads seconds or milliseconds; ages use the local clock | Same helper as everywhere. |

## Zero-Change rules that shape the design

- Reads only: each database is opened `?mode=ro` with `query_only`; the board slug is checked by a regex and only mapped to a known path (never used as a path), the task id by the usual id regex; `.env` and `auth.json` are never touched; attachment files are never opened.
- Text sizes are capped on the VPS (body 64 KB, a comment 16 KB, an event payload 2 KB, a run summary 4 KB).
- Missing tables or columns give empty parts, never an error; an unreadable database is reported by name and the other boards still list.

## Collector (`collector/mc_collector.py`)

### `kanban_boards`

No args. For each known database: `{ slug, path (relative to home), tasks, archived, byStatus: {status: n}, readable: bool }`; `errors[]` for unreadable ones. An absent `kanban.db` is not listed.

### `kanban_tasks`

Args: `board` (slug). Answer: `{ board, tasks: [...], archived, truncated }` where a task is `{ id, title, assignee, createdBy, status, priority, createdAt, startedAt, completedAt, comments, parents, children, blockKind, failures, failed }` (`comments`, `parents`, `children` are counts; `failed` is true when `last_failure_error` is not empty). Counts come from grouped subqueries; a missing table counts as 0.

### `kanban_task`

Args: `board`, `id`. Answer: `{ task: { ...the fields above plus body, result, lastFailureError, skills, modelOverride, providerOverride, sessionId }, comments: [{ id, author, body, createdAt }] (oldest first, at most 200), runs: [{ id, profile, stepKey, status, startedAt, endedAt, outcome, summary, error }] (at most 50), parents: [{ id, title, status }], children: [{ id, title, status }], events: [{ id, runId, kind, payload, createdAt }] (the latest 100, oldest first), attachments: [{ id, filename, size, uploadedBy, createdAt }] }`. `not_found` when the board or task is missing.

### Graph fix

`InteractionState._kanban` takes event times from `task_events.created_at` (or `ts` when that is the column), and `--query interaction` with `kind: kanban` accepts a text id (`^[A-Za-z0-9._:-]{1,128}$`) and reads the last event's `kind` and `payload` and time. `InteractionArgs` in `ipc.ts` and the renderer types change from integer to string ids; the label of an edge is `#<id>` as before.

## Main process

`QueryCommand` gets `kanban_boards`, `kanban_tasks`, `kanban_task`; zod args in `ipc.ts` (`board` regex `^[A-Za-z0-9._-]{1,64}$`); `MissionSession.kanbanBoards/Tasks/Task`; channels `mc:kanban:*`; `MissionApi.kanban`. Setting `kanban.board` (string, default `default`).

## Renderer

```
screens/Kanban.tsx             header (board, counts), filters, board, states
screens/kanban/Board.tsx       columns and cards
screens/kanban/TaskModal.tsx   detail dialog
lib/kanban.ts                  columns, grouping, filter, ordering, age and priority labels, payload summary
stores/kanban.ts, kanbanActions.ts   state and IO (stale answers dropped, 10 s refresh)
```

- **Header**: board select (`<slug> (N)`), "N tasks · N running · N blocked" (labels, not only colors), an assignee select (all assignees found plus "Unassigned"), a search box (id, title, assignee, creator).
- **Board**: `role="list"` of columns, each a `section` named "<Column>, N tasks" with a list of cards; columns shrink so seven fit 1440 px and the board scrolls sideways below that. A card shows the id, the title (two lines), the priority chip, the assignee (avatar and display name), a comment count, a failure mark when `failed` or `failures > 0`, and the age (since `createdAt`; for a running task since `startedAt`). A running task has the animated dots (off under Reduce motion). A card is a button; Enter or click opens the dialog.
- **Dialog** (`role="dialog"`, "Task <id>"): title; the body as markdown (the existing `Markdown`, sanitized); the comments (author, time, text); a side panel with status, priority, assignee, creator, created, started, completed, block kind, failures and the last failure text, skills, model and provider overrides, the result; **Runs** (profile, status, outcome, started and ended, summary, error); **Links** (parents "waits for", children "unblocks"; each is a button that opens that task); **Activity** (the events, newest at the bottom, kind plus a short summary of the payload); **Attachments** (names and sizes only). **Open session** (when `session_id` and an assignee that is a known agent exist) goes to Sessions with that session open.
- **States**: loading skeleton, empty board ("No tasks on this board"), no database ("Hermes has no Kanban board here yet: no kanban.db was found"), error with Retry (the last board stays under a stale banner), unreadable board notice, "N archived are hidden", "Showing the newest 1,000 tasks".

## Errors and edge cases

- A board that disappears while open: the picker falls back to `default` and says so.
- A task that disappears while its dialog is open: the dialog says "This task is no longer on the board."
- Unknown status words land in the `other` column with their own word on the card.
- Display names come from the agents store; an assignee that is not an agent shows as written.

## Testing

- **pytest** (`tests/collector/test_kanban.py`): boards (home db is `default`, board dirs, counts by status, archived, unreadable file reported, absent db not listed), tasks (the real schema fixture, text ids, counts of comments and links, missing tables, truncation, unknown status, bad board name), task detail (every part, caps, not_found, bad ids), and the graph fix (text ids, `created_at` event time, the detail card query). `make_fixture.py` gets `add_real_kanban`.
- **Vitest**: `lib/kanban` (columns and other, grouping, ordering, filter, ages, payload summary), store, actions (stale answers, refresh, board fallback), settings schema, schemas, `agentGraph` for string ids.
- **Integration** over the fake SSH server: the three queries through `MissionSession`, Zero-Change.
- **E2E** (`tests/e2e/kanban.spec.ts`): open Kanban from the sidebar and the palette, columns and cards, switch board, filter by assignee, search, open a card (body, comments, runs, links, activity), open a linked task, Open session, the empty board and the no-database state, the narrow window, and the agent graph's task card with a text id.
- **Manual** (`docs/manual-vps-checklist.md`, steps 102 onward): board and task against `hermes kanban list --board <slug>`, priority meaning, status words, a long board, the dialog parts with a real task that has comments and runs.

## Open risks

| Risk | Handling |
|---|---|
| Status words other than the ones named | `other` column; nothing is dropped. |
| `priority` direction | Shown raw; checklist step records which number means urgent. |
| `payload` shapes of events | Shown as a cut text with JSON keys when it is JSON; raw otherwise. |
| A very large `task_events` table | The detail reads only the latest 100 events of one task, the list never reads events. |
