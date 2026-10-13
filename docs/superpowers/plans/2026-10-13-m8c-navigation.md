# M8c Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A command palette (Ctrl/Cmd+K and the Search button) over screens, agents, sessions, notes and actions, and a Chat badge for replies that finished out of sight.

**Architecture:** Pure libs (`lib/palette.ts`, `lib/unread.ts`) build and search items and decide what counts as unread; two zustand stores hold palette and unread state; `paletteActions.ts` loads sessions with the existing `sessions_list` query and runs a chosen item; one dialog component and small shell changes wire it in. No new IPC, no VPS writes.

**Tech Stack:** TypeScript, React 19, zustand, Vitest, Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-10-13-m8c-navigation-design.md`

## Global Constraints

- UI strings are English only; replies to the user are Indonesian.
- No new dependency; no new IPC channel; the only server call is the existing `window.mc.sessions.list`.
- Write files containing backslashes with the Write/Edit tools (Bash heredocs collapse a double backslash).
- `npm test` and `npx playwright test` are run one after the other, never at the same time.
- Each task ends with a commit whose message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/lib/palette.ts` (create) | `PaletteItem`, `PaletteTarget`, `buildItems`, `searchItems`, `normalize`, `scoreText` |
| `src/renderer/lib/unread.ts` (create) | `isViewing`, `shouldCount` |
| `src/renderer/stores/palette.ts`, `stores/unread.ts` (create) | state |
| `src/renderer/paletteActions.ts` (create) | `openPalette`, `closePalette`, `togglePalette`, `loadPaletteSessions`, `runItem`, `countIfAway` |
| `src/renderer/components/CommandPalette.tsx` (create) | the dialog |
| `src/renderer/shell/useShortcuts.ts`, `Sidebar.tsx`, `Shell.tsx` (modify), `shell/useUnread.ts` (create) | shortcut, buttons, badge, clearing |
| `src/renderer/App.tsx`, `bootstrap.ts`, `actions.ts`, `stores/usage.ts`, `screens/usage/CostTab.tsx`, `styles/app.css` or `styles/palette.css` (modify/create) | wiring and style |
| `tests/unit/palette*.test.ts`, `tests/unit/unread.test.ts`, `tests/e2e/palette.spec.ts` (create) | tests |

---

### Task 1: Palette items and search (pure)

**Files:** create `src/renderer/lib/palette.ts`, `tests/unit/paletteLib.test.ts`.

**Interfaces:** produces
- `type PaletteGroup = 'screen' | 'action' | 'agent' | 'session' | 'note'`
- `type PaletteTarget = { kind: 'screen'; route: Route } | { kind: 'chat'; profile: string } | { kind: 'agent-settings'; profile: string; tab: AgentTab } | { kind: 'session'; profile: string; id: string } | { kind: 'note'; id: string } | { kind: 'action'; action: 'settings' | 'connection' | 'cron' | 'cost-today' }`
- `interface PaletteItem { id: string; group: PaletteGroup; label: string; hint?: string; keywords?: string; target: PaletteTarget }`
- `buildItems(input: { agents: readonly { profile: string; displayName: string }[]; sessions: readonly SessionRow[]; notes: readonly { id: string; title: string }[]; now: number }): PaletteItem[]` (now in epoch seconds, for the session age hint)
- `normalize(s: string): string` (lowercase, accents removed by NFD and stripping `̀-ͯ`)
- `scoreText(text: string, query: string): number` (0 = no match; exact 100, prefix 80, word prefix 60, substring 40, in-order letters 20)
- `searchItems(items: readonly PaletteItem[], query: string, limit = 40): PaletteItem[]`

- [ ] **Step 1: Write the failing tests** (real Vitest `it` blocks, small literal inputs): `normalize('Café  Ünï')` equals `'cafe  uni'`; `scoreText` ordering exact > prefix > word prefix > substring > letters > 0 and a non-match is 0; `buildItems` produces one screen item per `NAV` entry with the shortcut hint (`Ctrl+4`/`Cmd+4` is not decided here: the hint is `Ctrl+<key>`, the palette component swaps the modifier name), a "Coming in a later release" hint for kanban, skills and logs, four settings items and one chat item per agent, session items with title or `Untitled session` and the agent name in the hint, note items, and the four actions; ids are unique; `searchItems(items, '')` returns screens and actions first and at most 5 sessions and 5 notes; `searchItems(items, 'scout')` ranks "Chat with Scout" and Scout settings before a session whose title merely contains letters in order; sessions and notes are each capped at 8 in a result; accents and case are ignored (`'SESION'` finds nothing, `'sesion'`... use `'cafe'` against a note titled `Café`); a query matching only `keywords` still matches; the limit is respected.
- [ ] **Step 2: Run** `npm test -- tests/unit/paletteLib.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `lib/palette.ts` (imports `NAV` from `../shell/nav`, `Route` from `../stores/ui`, `AgentTab` from `../stores/agentCfg`, `FILE_LABEL` from `@shared/agentCfg` for "SOUL.md", `formatAge` from `./format`). Scoring: normalize both; empty query is handled by `searchItems`; `text === q` 100, `startsWith` 80, any word (split on non-alphanumerics) startsWith 60, `includes` 40, in-order subsequence 20 else 0. An item's score is the max over `label` and `keywords`, with `hint` counting at half. Sort by score descending, then group order (`screen`, `action`, `agent`, `session`, `note`), then label.
- [ ] **Step 4: Run** the test and `npm run typecheck`. PASS.
- [ ] **Step 5: Commit** `feat(m8c): palette items, scoring and search`.

### Task 2: Unread logic, stores and actions

**Files:** create `src/renderer/lib/unread.ts`, `stores/palette.ts`, `stores/unread.ts`, `paletteActions.ts`; modify `stores/usage.ts` (add `pinToday: boolean` and `requestPinToday()`/`consumePinToday()` or a reducer `applySummary` that pins the last day when `pinToday`), `actions.ts` (reset both new stores where `useUsage` resets); tests `tests/unit/unread.test.ts`, `tests/unit/paletteStore.test.ts`.

**Interfaces:**
- `isViewing(s: { route: Route; chatCurrent: string | null; agentSelected: string | null; visible: boolean; focused: boolean }, profile: string): boolean`; `shouldCount(ev: { kind: string; exitCode?: number | null; stopped?: boolean }): boolean` (true only for `end` with `exitCode === 0` and not stopped).
- `useUnread`: `{ counts: Record<string, number>; add(p); clear(p); reset(); total(): number }` (total as a selector helper `totalUnread(counts)`).
- `usePalette`: `{ open: boolean; query: string; index: number; sessions: SessionRow[]; loadedAt: number | null; loading: boolean; error: string | null; setOpen(open); setQuery(q) /* resets index to 0 */; setIndex(i); applySessions(rows, now?); setLoading(b); setError(m); reset() }`.
- `paletteActions.ts`: `openPalette()` (sets open, resets query and index, calls `loadPaletteSessions()`), `closePalette()`, `togglePalette()`, `loadPaletteSessions(force = false)` (skips when `loadedAt` is newer than 60 s unless forced; one in flight; sequence number; calls `window.mc.sessions.list({ profiles: [], limit: 100 })`; error text through `describeQueryError`), `runItem(item: PaletteItem)` (closes first, then acts by `target.kind`: screen `navigate`; chat `useAgents.select(profile)`, `useChat.setCurrent(profile)`, `navigate('chat')`; agent-settings `useAgentCfg.selectProfile` + `setTab` + `openSettings('agents')`; session `navigate('sessions')` then `openSession`; note `useBrain.openNote(id)`; actions `settings` -> `openSettings('general')`, `connection` -> `openSettings('connection')`, `cron` -> `navigate('dashboard')` and `useCron.openModal()`, `cost-today` -> `useUsage.getState().setTab('cost')`, `requestPinToday()`, `navigate('usage')`), `countIfAway(profile)` (reads route, chat current, agent selected, `document.visibilityState`, `document.hasFocus()`, applies `isViewing`; adds to `useUnread` when away).

- [ ] **Step 1: Failing tests.** `unread`: `isViewing` true for chat route with that agent, true for dashboard with that agent selected, false for another agent, false for another route, false when not visible or not focused; `shouldCount` true for a clean end, false for stopped, non-zero exit, null exit and other kinds. `paletteStore` (stub `window`/`document` like `usageStore.test.ts`): `setQuery` resets the index; `loadPaletteSessions` calls `sessions.list` with `limit 100` and stores rows; a second call within 60 s does not call again, `force` does; a stale answer is dropped; an error is stored and keeps the old rows; `runItem` for each target kind (stub the stores' actions with `vi.spyOn` or inspect store state: route, `useChat.current`, `useAgents.selected`, `useAgentCfg` profile and tab, `useUi.settingsTab`, `useBrain.noteModal`, `useCron.modalOpen`, `useUsage.pinToday`/tab); `countIfAway` adds only when away (stub `document`); `applySummary` with `pinToday` pins the last day and clears the flag.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the files above following `sessionsActions.ts` and `usageActions.ts` for sequence numbers and error text.
- [ ] **Step 4: Run** tests and `npm run typecheck`. PASS.
- [ ] **Step 5: Commit** `feat(m8c): palette and unread state with the actions that run an item`.

### Task 3: The palette dialog, shortcut and Search button

**Files:** create `src/renderer/components/CommandPalette.tsx`, `src/renderer/styles/palette.css` (import in `styles/index.css`); modify `App.tsx` (render `<CommandPalette />` next to the other global dialogs), `shell/useShortcuts.ts`, `shell/Sidebar.tsx`; test `tests/e2e/palette.spec.ts` (first part).

Behavior as in the spec: `role="dialog"` "Command palette", input `role="combobox"` labelled "Search screens, agents, sessions and notes", listbox with group headings, keyboard (Up/Down wrap, Home/End, Enter, Escape with `stopPropagation`), click runs, backdrop closes, selected row scrolled into view, focus returns to the previously focused element, empty-result text, "Loading sessions…" and error lines, the shortcut hint shows `Cmd` on macOS. Items come from `buildItems` with `useAgents.agents`, the union of `usePalette.sessions` and `useSessions.rows` (deduplicated by `profile:id`), `useBrain.notes` values; `searchItems` over them for the current query, memoized. `useShortcuts`: `Ctrl/Cmd+K` (no Alt, no Shift) calls `togglePalette()` with `preventDefault`, ignored on `connect` and `launch`. The Sidebar Search button becomes a real button (`aria-haspopup="dialog"`, title `Search · Ctrl+K`) that calls `openPalette()`; remove its disabled styling.

- [ ] **Step 1: E2E first part** (same boilerplate as `usage.spec.ts`; plain fixture): Ctrl+K opens the dialog and focuses the input, Escape closes; the Search button opens it; typing `scout` lists "Chat with Scout" and `Scout · Model`; ArrowDown moves `aria-activedescendant`; Enter on "Chat with Scout" lands on Chat with Scout current; typing a session title (`Morning briefing`) lists the session (loaded on open) and Enter lands on Sessions with that transcript open; typing `zzzzqq` shows the empty text; "Scout · Model" opens Settings on the Agents tab with the Model tab selected; the action "Cron jobs" opens the Dashboard with the Cron dialog.
- [ ] **Step 2: Run** `npm run build` then `npx playwright test tests/e2e/palette.spec.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the e2e, `npm run typecheck`, `npm test`. PASS; look at a screenshot of the palette.
- [ ] **Step 5: Commit** `feat(m8c): command palette dialog with Ctrl+K and the Search button`.

### Task 4: Chat badge

**Files:** create `src/renderer/shell/useUnread.ts`; modify `bootstrap.ts` (after `applyChat`, `if (shouldCount(ev)) countIfAway(ev.profile)`), `shell/Shell.tsx` (mount `useUnread`), `shell/Sidebar.tsx` (badge on the Chat item), `styles/palette.css` or `app.css` (badge style); extend `tests/e2e/palette.spec.ts`.

`useUnread`: subscribes to the route, `useChat.current`, `useAgents.selected`, `visibilitychange` and `focus` and calls `clear(profile)` for each profile that `isViewing` (only the agent on screen can be viewed). Sidebar: `Chat` shows `<span className="bd">{n}</span>` when the total is above 0 (capped display `9+`), `aria-label` on the button `Chat, N unread replies` (singular for 1), keeps the visible label text; in rail mode the badge is a small dot with the number.

- [ ] **Step 1: E2E:** send `slow please` to the default agent in Chat (see `tests/e2e/chat.spec.ts` for how a message is sent), switch to Usage before it ends, wait for the Chat item to get `aria-label` `Chat, 1 unread reply`, click Chat and see the badge disappear. A turn the user stops does not count (press Stop on a `slow` message and see no badge).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** e2e, typecheck, `npm test`. PASS.
- [ ] **Step 5: Commit** `feat(m8c): chat badge for replies that ended out of sight`.

### Task 5: Today's cost action, docs and final verification

**Files:** modify `screens/usage/CostTab.tsx` (consume `pinToday`: when the summary and day starts exist and `pinToday` is set, `pinDay(last)` once and clear the flag; if `applySummary` already does it, nothing here), `tests/e2e/palette.spec.ts`, `docs/manual-vps-checklist.md`, `CLAUDE.md`.

- [ ] **Step 1: E2E:** the action "Show today's cost" lands on Usage and the last day button has `aria-pressed="true"` once the chart is there.
- [ ] **Step 2:** implement whatever is missing; run the e2e.
- [ ] **Step 3: Checklist** "Tambahan M8c: palette dan badge" before "Melaporkan hasil", steps 91 to 94 (Indonesian): (91) Ctrl+K (Cmd+K di macOS) membuka palette dari tiap layar setelah login; sesi di palette cocok dengan layar Sessions dan catatan vault terbuka; (92) membuka chat dan pengaturan agent lewat palette; aksi Settings, Cron dan biaya hari ini; (93) badge Chat: kirim pesan yang lama, pindah layar, badge muncul saat balasan selesai dan hilang saat chat dibuka; tidak ada badge untuk giliran yang dihentikan atau gagal; (94) Zero-Change: membuka palette tidak membuat berkas di VPS dan hanya satu kueri `sessions_list` per pembukaan.
- [ ] **Step 4: CLAUDE.md:** project-state sentence (M8c built; M9 and M10 not; Logs badge and terminal items wait for their screens) and an "Navigation (M8c)" paragraph: files, how items are built, the sessions load on open (100, 60 s), the unread rule, the deferred items.
- [ ] **Step 5: Final verification:** `npm run typecheck`, `npm test`, `npm run test:py`, `npm run build`, `npx playwright test` (one after the other). Report real numbers.
- [ ] **Step 6: Commit** `docs(m8c): checklist steps 91-94, CLAUDE.md paragraph and the cost action`.

## Self-Review

**Spec coverage:** items and scorer (T1), unread rule and stores and the runner (T2), dialog, shortcut, Search button (T3), badge and clearing (T4), cost action and docs (T5). Deferred on purpose: Logs badge, terminal items, F-NAV-4 overflow.

**Type consistency:** `PaletteItem`/`PaletteTarget` (T1) are what `runItem` (T2) switches over and what the dialog (T3) renders; `isViewing`/`shouldCount` (T2) are used by `countIfAway` (T2) and `useUnread` (T4).
