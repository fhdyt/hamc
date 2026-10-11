# M4a Second brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** A realtime Obsidian-style graph of a vault on the VPS, with note preview, controls, and a Dashboard panel.

**Architecture:** A dedicated collector stream parses the vault on the VPS and sends per-note records; the renderer builds the graph model, lays it out in a worker with d3-force and draws it with PixiJS v8.

**Tech Stack:** Python stdlib collector, ssh2, zod, Zustand, pixi.js v8 (`pixi.js/unsafe-eval`), d3-force, d3-quadtree, markdown-it, DOMPurify.

**Spec:** `docs/superpowers/specs/2026-10-11-m4a-second-brain-design.md`

## Global Constraints

- Zero-Change: read-only on the VPS; every remote argument individually quoted; note path never accepted from the renderer as an absolute path.
- UI strings English; strict CSP (`script-src 'self'`), so Pixi must use `pixi.js/unsafe-eval`.
- `stores/` and `lib/` compile under the Node tsconfig: no `window`/DOM there (graph engine files that need DOM live in `src/renderer/graph/`).
- Keep the Dracula tokens already in `styles/app.css`; fonts JetBrains Mono.

---

### Task 1: Collector — vault parser, stream, queries

**Files:** modify `collector/mc_collector.py`; modify `tests/fixtures/make_fixture.py` (vault builder + `add-note`, `touch-note`, `rm-note` CLI, `synthetic-vault` generator); create `tests/collector/test_vault.py`, `tests/collector/test_vault_stream.py`.

**Interfaces:** produces `parse_note(text) -> {links, tags, aliases, attachments}`, `scan_vault(root) -> dict[id, raw]`, `resolve(raw_all) -> dict[id, BrainNote]`, class `VaultState(root)` with `snapshot()` → list of chunks and `poll()` → `(upserts, removed)`, `run_vault(root)` stream loop, queries `vault_check`, `browse`, `note` in `run_query`, args `--vault <path>`.

- [ ] Write failing pytest for the parsing rules (wikilink forms, alias, heading and block suffixes, embeds, markdown links vs URLs, tags nested and not in code blocks, frontmatter list forms), resolution (case-insensitive, path suffix, shortest path, alias), hidden-dir skipping and limits.
- [ ] Implement the parser and resolver; run until green.
- [ ] Write failing tests for `VaultState` snapshot chunking and delta (add, edit, remove, ghost resolved by new note, unchanged note not re-emitted) and for the three queries including path escape attempts (`../`, absolute id, symlink out of the vault, non-md).
- [ ] Implement `VaultState`, `run_vault` (3 s poll, `--vault-interval` for tests), the queries and `--vault` dispatch in `main`; run the whole pytest suite.
- [ ] Commit.

### Task 2: Shared schemas, main wiring, IPC

**Files:** modify `src/shared/events.ts` (`BrainNote`, `BrainData`, `brain` event), `src/shared/ipc.ts`, `src/shared/channels.ts`, `src/preload/index.ts`, `src/main/connection/remote.ts`, `src/main/ipc.ts`, `src/main/session.ts`, `src/main/store/settingsStore.ts`; create `src/main/brain/service.ts`; tests `tests/unit/brainEvents.test.ts`, `tests/integration/brain.test.ts`, extend `tests/helpers/samples.ts`, `tests/helpers/fixture.ts`.

**Interfaces:** `MissionApi.brain = { get(): Promise<{vault: string|null}>, setVault(path: string|null): Promise<SetVaultResult>, validate(path): Promise<QueryResult<VaultCheck>>, browse(path): Promise<QueryResult<BrowseResult>>, note(id): Promise<QueryResult<NoteText>> }`.

- [ ] Schema tests first (valid/invalid `brain` events), then schemas.
- [ ] `BrainService`: stream lifecycle (start after connect when a vault is saved, restart on change, stop on disconnect, 3 s restart on crash), `note()` supplies the saved root. `SettingsStore.getVault/setVault(connectionId)`.
- [ ] Integration tests against the fake SSH server: snapshot arrives, delta ≤ 3.5 s after a file is added, change of vault restarts, queries, not-connected, only read verbs, fixture untouched.
- [ ] Typecheck, full vitest, commit.

### Task 3: Renderer model and store

**Files:** create `src/renderer/lib/brain/graphModel.ts`, `src/renderer/stores/brain.ts`, `tests/unit/graphModel.test.ts`, `tests/unit/brainStore.test.ts`; modify `src/shared/settings.ts` (`brain.graph`), `src/renderer/bootstrap.ts`, `src/renderer/actions.ts`.

**Interfaces:** `buildGraph(notes, opts) -> {nodes: GNode[], edges: GEdge[]}` where `opts = {search, showTags, showAttachments, existingOnly, showOrphans, groups, local: {id, depth} | null}`; `GNode = {id, label, kind: 'note'|'tag'|'ghost'|'attachment', degree, group: number, mtime}`; `GEdge = {s: number, t: number}` (indices); `parseGroupQuery`, `groupOf(note, groups)`; store actions `applyBrain(data)`, `select`, `setHover`, `setLocal`, `setGraphSettings`, `reset`.

- [ ] Tests first for filters, tags, ghosts, orphans, groups (`path:`, `tag:`), local graph depth 1–3, and the store (snapshot reset on `first`, delta merge, removed ids, pulse list, phase).
- [ ] Implement; wire `brain` events and `reset` on forget/other server; commit.

### Task 4: Graph engine and perf spike

**Files:** create `src/renderer/graph/layout.worker.ts`, `src/renderer/graph/layoutClient.ts`, `src/renderer/graph/renderer.ts`, `src/renderer/graph/BrainCanvas.tsx`, `tests/e2e/brainPerf.spec.ts`; modify `package.json` (pixi.js, d3-force, d3-quadtree).

**Interfaces:** `LayoutClient.init(nodes, edges, positions?)`, `.update(nodes, edges)` (keeps positions of known ids, seeds new ones near a neighbour), `.setForces(f)`, `.drag(i, x, y)`, `.release(i)`, `.onTick(cb: (positions: Float32Array) => void)`; `GraphRenderer` with `setGraph`, `setPositions`, `setStyle`, `highlight(i|null)`, `pulse(ids)`, `fit()`, events `hover`, `select`, `drag`; `<BrainCanvas graph selection hover pulses style onHover onSelect />`.

- [ ] Worker with d3-force (link, many-body with theta 0.9, center, collide off), tick throttled to ~30 Hz, transferable positions, alpha cools then sleeps, wakes on change.
- [ ] Renderer: Mesh edges rebuilt on each position frame and on zoom, sprite nodes (size from degree), label pool with fade by zoom and always for hovered and its neighbours, pan, wheel zoom around the cursor, node drag, quadtree hit test, hover dimming, pulse ring animation, `fit()`.
- [ ] Perf spike: a hidden `?brain-bench=N` mode generates N synthetic notes and about 4N links in the renderer and reports fps and settle time; the Playwright test reads them and asserts a floor suited to software rendering. Record numbers in the spec.
- [ ] Commit.

### Task 5: Second brain screen

**Files:** create `src/renderer/screens/Brain.tsx`, `src/renderer/screens/brain/{VaultSetup,BrowseDialog,Controls,NotePreview,NoteModal}.tsx`, `src/renderer/lib/brain/markdown.ts`, tests `tests/unit/markdown.test.ts`; modify `src/renderer/App.tsx`, `src/renderer/styles/app.css`, `package.json` (markdown-it, dompurify).

- [ ] Markdown renderer test first (script tags, `javascript:` links, images, wikilinks to in-app links, embeds shown as a label).
- [ ] Setup, validation, Browse dialog, controls panel (Filters, Groups, Display, Forces, persisted), preview with backlinks, outgoing and local graph depth, change vault, fit, live dot.
- [ ] Commit.

### Task 6: Dashboard panel, E2E, docs, merge

**Files:** create `src/renderer/screens/dashboard/BrainPanel.tsx`, `tests/e2e/brain.spec.ts`; modify `src/renderer/screens/Dashboard.tsx`, `docs/manual-vps-checklist.md`, `CLAUDE.md`.

- [ ] Compact graph panel with expand button and note-reader modal on node click.
- [ ] E2E: set up with Browse, graph and count, hover highlight state, click opens the preview with backlinks, a note added on disk shows within seconds, controls persist across restart, Dashboard panel.
- [ ] Manual checklist steps 30–38, CLAUDE.md, memory file.
- [ ] Full verification (typecheck, vitest, pytest, E2E, build) and merge into master.
