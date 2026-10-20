# Kanban Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create, assign, comment, complete, block, unblock, promote and archive Kanban tasks through `hermes kanban`, with a previewed confirm.

**Architecture:** One pure builder (`kanbanActionArgs`) shared by the confirm preview and main; `KanbanActionService` runs it over SSH; the renderer adds an action row, an assign select and a comment box to the task dialog and a New task dialog to the board.

**Tech Stack:** TypeScript, zod, React, Zustand, Vitest, Playwright; Python argparse fake.

**Spec:** `docs/superpowers/specs/2026-10-20-kanban-writes-design.md`

## Global Constraints

- Always `--board <slug>`; never `-p`, `--force`, `--rm`, bulk ids.
- Option values as `--opt=value`; positional text after `--`.
- Limits: title 1-200 (one line), body ≤ 16,000, comment 1-8,000, reason ≤ 500 (one line), result ≤ 2,000 (one line), priority -1000..1000, no NUL.
- Log `kanban <action> <board> <id|new> exit <code>`, never text.

---

### Task 1: Builder and rules (`shared/kanban.ts`, `lib/kanbanControl.ts`)

- [ ] Failing Vitest `tests/unit/kanbanWrites.test.ts`: every verb's argv, limits, `-`-leading title, preview quoting, `actionsFor` per status.
- [ ] Implement `KANBAN_ACTIONS`, `KanbanActionRequest`, `KanbanActionResult`, `WRITE_BOARD_RE`, `kanbanActionArgs`, `kanbanCommandPreview` (shared) and `actionsFor`, `confirmText`, `newTaskProblem` (renderer lib).
- [ ] PASS; commit `feat(kanban): one builder for the write actions`.

### Task 2: Fake, service, IPC

- [ ] `tests/fixtures/fake_hermes_kanban.py` (argparse), route `kanban` in `tests/helpers/fakeSshServer.ts`, `kanbanCalls` in `fakeHermes.ts`.
- [ ] Failing integration `tests/integration/kanbanWrites.test.ts` (create → id in `kanban_tasks`, comment, assign, block/unblock, promote, complete, archive, unknown profile refused, no command for bad input).
- [ ] Implement `src/main/kanban/actions.ts`, `MissionSession.kanbanAction`, zod schema + channel + preload + `MissionApi.kanban.action`.
- [ ] PASS; commit `feat(kanban): write actions through hermes kanban`.

### Task 3: Renderer

- [ ] Store fields, `kanbanActions.ts` (`askKanbanAction`, `confirmKanbanAction`), `TaskActions.tsx`, `NewTask.tsx`, CSS.
- [ ] Typecheck + unit tests PASS; commit `feat(kanban): task actions, comments and New task in the app`.

### Task 4: E2E + docs

- [ ] `kanban.spec.ts`: create, comment, assign, block, unblock, complete via confirms.
- [ ] PRD (6.20, Q20), checklist, CLAUDE.md; commit.
