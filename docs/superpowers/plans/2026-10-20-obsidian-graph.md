# Obsidian Graph Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Follow `<vault>/.obsidian/graph.json` (colour groups and forces) in the Second brain graph, read-only, with a switch.

**Architecture:** A read-only collector query returns a whitelisted subset of `graph.json`; a pure renderer module maps it onto `BrainGraphSettings`; `useBrainGraph` draws the effective settings; the controls show what is followed.

**Tech Stack:** Python stdlib collector, zod, React, Zustand, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-obsidian-graph-design.md`

## Global Constraints

- Read-only; the vault root always comes from the saved setting.
- `graph.json` cap 256 KiB; at most 64 colour groups; `search` cut at 500 characters.
- Collector stays stdlib-only and ASCII-only.

---

### Task 1: Collector `vault_graph`

**Files:** Modify `collector/mc_collector.py`; Test `tests/collector/test_vault.py`.

- [ ] Failing tests: found (keeps only known keys, drops wrong types, caps groups), missing → `found: false`, list instead of object → `unreadable`, too big → `unreadable`, bad root → `bad_args`, `.obsidian` symlink leaving the vault → `bad_args`.
- [ ] Implement `q_vault_graph(home, a)` next to `q_note`, register `"vault_graph"`.
- [ ] `npm run test:py` → PASS. Commit `feat(brain): read .obsidian/graph.json on the VPS`.

### Task 2: Main + IPC

**Files:** `src/main/query.ts`, `src/shared/events.ts` (`ObsidianGraphResult`), `src/main/session.ts` (`brainObsidian`), `src/main/ipc.ts`, `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `tests/integration/brain.test.ts`.

- [ ] Failing integration test: with a saved vault holding `graph.json`, `session.brainObsidian()` answers `found: true` and the colour group.
- [ ] Implement; `npm run typecheck`; run the test → PASS. Commit `feat(brain): obsidian graph query in main`.

### Task 3: Mapping, store, hook and controls

**Files:** Create `src/renderer/lib/brain/obsidianGraph.ts`, `tests/unit/obsidianGraph.test.ts`; modify `src/shared/settings.ts` (`useObsidian`), `src/renderer/stores/brain.ts`, `src/renderer/actions.ts` (`loadObsidianGraph`), `src/renderer/hooks/useBrainGraph.ts`, `src/renderer/screens/brain/Controls.tsx`, the Brain screen and Dashboard graph panel (load on mount), `src/renderer/styles/app.css`.

- [ ] Failing unit tests for `toGroups`, `toSettings`, `effectiveGraph`.
- [ ] Implement the module, then wire store, action, hook and controls.
- [ ] `npm run typecheck`, unit tests → PASS. Commit `feat(brain): follow the vault's Obsidian graph settings`.

### Task 4: E2E and docs

**Files:** `tests/fixtures/make_fixture.py` (vault `graph.json`), `tests/e2e/brain.spec.ts`, PRD F-BRAIN-10, checklist, CLAUDE.md.

- [ ] E2E: controls say `Following graph.json · 1 group`, a followed slider is disabled, switching off enables it.
- [ ] Run `brain.spec.ts` → PASS. Commit `test(e2e): Obsidian graph settings` and `docs: F-BRAIN-10`.
