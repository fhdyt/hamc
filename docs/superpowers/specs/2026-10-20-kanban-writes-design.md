# Kanban write actions (v2)

## Goal

Let the user act on the Kanban board the agents use: create a task, assign it, comment, and move it through the
states Hermes allows (complete, block, unblock, promote, archive). Until now the screen was read-only (PRD 6.20,
F-R12-10; Q20 left writes to v2).

## What Hermes offers (checked against `hermes_cli/kanban.py` at tag v2026.8.31, the version on the user's VPS)

- `hermes kanban [--board <slug>] <verb> ...`. Without `--board`, Hermes uses the persisted *current* board, so the app
  **always** passes `--board <slug>` (including `default`).
- `create <title> [--body B] [--assignee P] [--priority N] [--triage] [--json]` (`--json` prints the task with its `id`;
  `--created-by` defaults to `user`).
- `assign <id> <profile|none>`; `comment <id> <text...> [--author A]` (author defaults to `$HERMES_PROFILE`, else
  `user`); `complete <id>... [--result R]`; `block <id> [reason...]` (the reason is also added as a comment);
  `unblock <id>...`; `promote <id> [reason...]` (todo or blocked to ready, refused while parents are open unless
  `--force`); `archive <id>...`.
- **`edit` only backfills `--result` of a done task** in this version, although the docs describe title/body/priority
  editing. Editing a task's title, body or priority is therefore **not** offered.

## Decisions (user: "core" scope)

- Actions: **Create**, **Assign**, **Comment**, **Complete**, **Block**, **Unblock**, **Promote**, **Archive**. Not:
  links, schedule, set-model, decompose/specify, `--force`, bulk ids, `archive --rm`.
- Every action follows F-STATE-3: a preview of the exact command, a confirm inside the dialog, a result banner, and a
  local log line without text.
- The app runs `hermes kanban` **without `-p`**: the board is shared by all profiles, and the author/creator is then
  Hermes's own default `user`.

## Rules

- Zero-Change: writes only through the official CLI and only after the user confirmed the shown command. The collector
  stays read-only.
- Arguments are built by one function, `kanbanActionArgs` (`shared/kanban.ts`), which the confirm previews and main
  runs, every argument single-quoted by `buildCommand`. Free text never becomes an option:
  - option values use the `--opt=value` form (argparse then accepts values that start with `-`);
  - positional text follows `--` (`comment <id> -- <text>`, `block <id> -- <reason>`, `create [opts] -- <title>`).
- Limits (checked in the builder, again in main by zod): board Hermes's own slug rule
  `WRITE_BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/` (`default` is valid; a board outside it is read-only), task id `TASK_ID_RE`, assignee a profile
  name (`^[A-Za-z0-9._-]{1,64}$`) or `none`, title 1-200, body ≤ 16,000, comment 1-8,000, reason ≤ 500, result ≤ 2,000
  characters, priority an integer from -1000 to 1000; no NUL in any text. Title, reason and result are one line.
- `app.log`: `kanban <action> <board> <task id> exit <code>` (create logs `new`). Never the text.

## Main

- `src/main/kanban/actions.ts` `KanbanActionService.run(req)`: refuses `bad-input` (builder null), `not-connected`;
  an assignee must be a profile of the last `agents` event or `none` (`unknown-profile`); 60 s timeout; ANSI stripped;
  `create` parses the JSON and answers `{ ok: true, output, taskId }`.
- `MissionSession.kanbanAction(req)`; channel `mc:kanban:action`; zod `KanbanActionRequestSchema` in `ipc.ts`.

## Renderer

- `lib/kanbanControl.ts` (pure): `actionsFor(task)` → which buttons a task gets:
  - Complete: not `done`/`archived`; Block: one of `triage, todo, ready, running, review, scheduled`;
  - Unblock: `blocked` or `scheduled`; Promote: `todo` or `blocked`; Archive: not `archived`.
  - `confirmText(action, task)` (a running task warns that a worker holds it and Hermes decides what happens to it),
    `kanbanCommandPreview(req)`, `newTaskProblem(draft)`.
- `stores/kanban.ts`: `ask` (the pending confirm with its request), `pending`, `note` (result banner), `draft` of the
  new-task form and the comment box.
- `kanbanActions.ts`: `askAction`, `confirmAction` (runs, then refreshes the board and the open task, then shows the
  note; a created task opens in the dialog).
- `screens/kanban/TaskActions.tsx` in `TaskModal`: status buttons, an **Assign** select (profiles + Unassigned), a
  **comment** box; each opens the inline confirm (`role="alertdialog"` region with the command preview, Confirm and
  Cancel).
- `screens/kanban/NewTask.tsx`: **New task** button in the board header → dialog with title, body, assignee,
  priority and *Put in triage*, preview, Create.

## Fake

- `tests/fixtures/fake_hermes_kanban.py`: an argparse copy of the verbs above (same `--board`, `--`, `--opt=value`
  behaviour as the real parser) that changes the fixture `kanban.db` like Hermes: status, assignee, `task_comments`,
  `task_events`, `completed_at`/`result`, a new `t_<8 hex>` task. An unknown task id fails with
  `no such task: <id>`; a promote with open parents fails. `srv.hermes.kanbanCalls` records the argv.

## Testing

- Vitest: `kanbanActionArgs` (every verb, `--board` always, `--opt=` and `--` placement, every limit, a title starting
  with `-`), `actionsFor` per status, preview quoting.
- Integration: `kanbanAction` against the fake: create returns the id and the task is in `kanban_tasks`; comment,
  assign, complete, block, unblock, promote and archive change the task; an unknown profile is refused before any
  command.
- E2E (`kanban.spec.ts`): create a task from the board, comment on it, assign it, block then unblock it, complete it;
  each through the confirm with the command preview.
- Checklist: the same steps on the real VPS, plus `hermes kanban show <id>` agreeing with the app.
