# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Hermes Agent Mission Control is a cross-platform desktop app (Electron + React/TypeScript) for monitoring a user's Nous Research Hermes Agent install on a Linux VPS over SSH. **M1 (foundation), M2 (cron) and M3 (live feed) are built**; M1 covers: connection with TOFU host key and preflight, the Python collector over stdin, the app shell, the Dashboard (agents roster and server strip) and the Server screen. M2 adds the read-only Cron panel and modal, a `cron` collector event, and failed-run notifications. M3 adds the Live feed screen, the Dashboard activity panel with a feed modal, the session view and per-agent daily stats. M4a adds the Second brain vault graph (parsed on the VPS, drawn with PixiJS) and its Dashboard panel. M4b (agent graph) and M5-M10 are not built; their screens show a "Coming in a later release" state. Specs and plans live in `docs/superpowers/specs` and `docs/superpowers/plans`; the manual real-VPS test is `docs/manual-vps-checklist.md`. Besides the app (`src/`, `collector/`, `tests/`), the repo holds:

- `docs/PRD-mission-control-hermes.md`: the spec (v1.2). It is written in Indonesian, while the app UI is English-only. Requirement IDs (`F-CONN-*`, `F-CHAT-*`, `F-CFG-*`, `F-NAV-*`, `F-SESS-*`, `F-USAGE-*`, `F-SKILL-*`, `F-LOG-*`, `F-MEMT-*`, `F-STATE-*`, `F-R12-*`, `NF-*` …) and milestones M1–M10 are defined there, so cite them when planning or implementing. PRD §13.1 lists the Hermes commands and paths verified against the official docs, and what is **not documented**.
- `mockup/`: interactive HTML mockups of the 12 screens (Cron is a Dashboard modal, Kanban is a screen). They are the visual reference for implementation.
- `PRODUCT.md`: product context for the impeccable design skill (users, principles, constraints). It deliberately holds no visual direction; the Dracula "hacker view" is a binding brand constraint recorded there.

The user talks in Indonesian, so reply in Indonesian. Keep all UI strings in English.

## Commands

```bash
npm install            # postinstall rebuilds better-sqlite3 for the Electron ABI
npm run dev            # electron-vite dev
npm run build          # production build into out/
npm run typecheck      # tsc: main/preload/shared + renderer + e2e
npm test               # Vitest, run under Electron-as-Node so native modules share one ABI
npm run test:py        # pytest for the Python collector (use `python`, not `python3`, on Windows)
npm run test:e2e       # builds, then Playwright for Electron (needs a keychain; Windows DPAPI works)
npm run dev:fake       # fake Hermes VPS over SSH on 127.0.0.1:2222 (prints throwaway test credentials)
npm run icons          # regenerate src/renderer/components/icons.generated.ts from mockup/build.py
```

Where things live:
- `collector/mc_collector.py`: stdlib-only, ASCII-only collector. The main process sends it over SSH stdin to `python -u - <hermes_home>` and closes stdin, so it cannot receive commands. Tests set `MC_PROC_ROOT` / `MC_SYS_ROOT` to point it at a fake `/proc`.
- `src/main/session.ts` orchestrates connect, preflight, collector, reconnect (backoff 1/2/5/10/30 s) and models. `src/main/connection/` holds the ssh2 manager, host key logic, preflight and `buildCommand`, the only way to build a remote command (every argument is single-quoted).
- `src/shared/` is the typed contract (zod event schemas, IPC channel names and `MissionApi`). The preload imports only `src/shared/channels.ts`, never zod, because a sandboxed preload can only `require('electron')`.
- `tests/helpers/fakeSshServer.ts` is an ssh2 server that runs the real collector against `tests/fixtures/make_fixture.py` output. Integration, Zero-Change and E2E tests all use it.
- Toolchain notes: `electron-vite@5` needs `vite@7` and `@vitejs/plugin-react@5`; TypeScript 7 has no `baseUrl`, so path aliases use `./`.


## Mockups

```bash
python mockup/build.py
```

This rebuilds `mockup/<Screen>.html` and `mockup/index.html` from `mockup/src/<Screen>.dc.html`. **Never hand-edit the generated `.html` files.** Edit the `src/*.dc.html` source, then rebuild. To add a screen, add it to the `SCREENS` list in `build.py`.

To preview, use the `mockup` entry in `.claude/launch.json` (it serves `mockup/` on `http://127.0.0.1:5317`). There are no tests or linters.

How a `.dc.html` source works (it is the claude.ai Design-canvas format; the published canvas URL is in PRD §6.9):
- The markup lives inside `<x-dc>`, and `<helmet>` holds the fonts and `<style>`.
- The logic is a `class Component extends DCLogic` in `<script type="text/x-dc">`, with `state`, `setState`, `renderVals()` and `componentDidMount()`.
- The `./support.js` reference only exists on the canvas, and `build.py` strips it. That is why the src files don't render on their own.
- Links between screens are written as `X.dc.html`, and the build rewrites them to `X.html`.

`mockup/mc-runtime.js` is a tiny re-implementation that supports only the subset the mockups use, so stay inside it:
- `{{a.b.c}}` holes are **plain dotted paths only**, with no expressions. Compute any derived value in `renderVals()`.
- Lists and conditionals use `<sc-for list="{{…}}" as="x">` and `<sc-if value="{{…}}">`. `$index` is available inside a loop.
- Event handlers are written as `onClick` / `onChange` / `onInput` / `onPointerDown` / `onKeyDown="{{fn}}"`. On text fields, `input` events go to the `onChange` handler.
- Each `setState` re-renders by diffing into the live DOM, keyed by `data-key`, so focus, scroll position and CSS enter animations survive. Give list items and focusable inputs a stable `data-key` / `id`.
- `<sc-if value>` tests JavaScript truthiness, so the string `'false'` is truthy. Pass a real boolean for `sc-if` and a separate `'true'`/`'false'` string for `aria-*` attributes.
- `<i-con name="x">` is expanded at build time, so the name must be literal (never a `{{hole}}`). Use one `<sc-if>` per icon variant. New icons go in `ICONS` in `build.py`.
- Keep all logic inside the `Component` class (no top-level `var` after it): the claude.ai canvas only understands the class.
- Neither the template nor the logic may contain `</script` (the build will fail).

Navigation lives in a persistent left sidebar (PRD v1.3, F-R13-1) defined once in `mockup/src/_parts/sidebar.html`; it holds the menu, the terminal toggle, the palette button and the collapse toggle (state in `shared.js`). The status bar footer (`shared.html`) holds status only (connection, CPU/memory, notifications, text size, settings), no menu. Every screen except Launch and Connect wraps its content as `<div class="mc-body"><!--@part sidebar--><div class="mc-col">…</div></div>` right after the root div, so the sidebar sits beside the content and the footer spans the full width. Page content uses padding `20px 24px 16px` and 14px gaps (F-UI-9); containers that scroll (`overflow-y:auto`) and hold panels with `top:-10px` titles need ≥12px padding-top or the titles are clipped. Every screen calls `this.navFor('<key>')`; a new screen needs a sidebar `.sn` item in `sidebar.html`, a `navFor` key, an entry in `screens()` (palette + Ctrl+1…0) and a `SCREENS` entry. The terminal, the note-reader modal (`noteVals(g)`, opened by graph node clicks) and agent display names (`displayName(id)`, local only) are shared too.

Reusable fragments live in `mockup/src/_parts/` and are inlined with `<!--@part x-->` (markup) and `/*@part x*/` (methods inside the class): `cron` is the Cron modal on the Dashboard (there is no Cron screen any more) and `feed` is the Live feed list used by both `LiveFeed` and the Dashboard activity modal. Part state and values are prefixed (`cron*`, `feed*`) to avoid clashes. Page-level modals use the shared `modal` state key (Esc closes it; `?modal=cron` opens the Dashboard on the Cron modal). Any screen also takes `?agents=N` (6–40) to simulate a bigger fleet; the Dashboard Agents panel (PRD F-DASH-11..14) is designed for 20+. Shared helpers: `filterLoad/filterSave/agentChips` (agent and range filters shared by Sessions, Usage, Logs, Skills) and `demoState()` (open any new screen with `?state=loading|empty|error`; Second brain also takes `?tab=timeline`).

Kanban (`Kanban.dc.html`) is a read-only screen (PRD 6.20, F-R12-10; Q20 resolved).

Brand: `assets/brand/logo.png` is the master (HMAC block letters). `python assets/brand/make_icons.py` regenerates `logo-mark.png` (transparent, UI), `icon-1024.png` and `icon.ico` (electron-builder sources) and `favicon.png`; `build.py` copies the web ones into `mockup/assets/`. Never edit the derived files by hand.

Styling uses the Dracula tokens from PRD §6.9. `#6272A4` (Comment) is for decoration only. Secondary text uses `#A9B2D3` / `#8B95BD` to keep contrast ≥ 4.5:1. The UI fonts are JetBrains Mono, with VT323 only for the logo and big numbers.

## Target architecture (from PRD §8; read before scaffolding)

Planned stack:
- electron-vite, TypeScript everywhere, React 19, Tailwind, Zustand, TanStack Virtual.
- `ssh2` in the main process, with uPlot for charts.
- PixiJS v8 for the graph, with d3-force layout running in a Web Worker.
- better-sqlite3 (`app.db`) and Electron `safeStorage`.
- markdown-it + DOMPurify, and CodeMirror 6 (+ merge).
- xterm.js and electron-builder.
- Tests: Vitest (unit), Playwright for Electron (E2E), and pytest for the collector against a fake `~/.hermes` fixture.

How data flows:
- **Main process** owns everything privileged: ConnectionManager (ssh2), CollectorChannel → EventRouter, ChatService, AgentConfigService, SettingsStore (`app.db`) and SecretStore (`safeStorage`).
- **Renderer** is sandboxed (`contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, navigation and `window.open` blocked). It reaches the main process only through a narrow typed preload API (`mc.connect()`, `mc.onEvent()`, `mc.chat.send()`, `mc.settings.get/set()`). Agent and vault markdown is untrusted, so sanitize it with DOMPurify.
- **Collector**: on connect, the main process runs `<hermes-python> -u -` over one SSH channel and pipes a bundled, **stdlib-only Python** script into stdin. The script streams JSON lines (`{"type": "metrics|agents|cron|message|session|brain_snapshot|brain_delta|error", "ts", "profile", "data"}`) and covers:
  - `/proc` metrics, read every 1 s;
  - `state.db`, opened `?mode=ro` and read by `id > last_id`, using only `active=1` rows;
  - `cron/jobs.json`, gateway state and profiles;
  - Obsidian vault parsing, sent as a snapshot first and then as deltas.

  Find the Python interpreter from the shebang of the `hermes` executable. To find `hermes` itself, try `command -v hermes`, then `~/.local/bin/hermes`, then the venv.
- **Chat**: run one SSH exec per turn: `hermes -p <profile> chat --oneshot --query-file - --format stream-json --source mission-control [--resume <session_id>]`. Send the message on stdin, never inside a shell string.
- **Agent settings**: change the model only through `hermes -p <p> config get/set`. Write `SOUL.md`, `memories/MEMORY.md` (≤ 2,200 chars) and `memories/USER.md` (≤ 1,375 chars) over SFTP atomically (temp file + rename, keeping the file's permissions), and check the hash first to detect conflicts.

## Zero-Change constraint (non-negotiable; PRD §3.2)

The app must work on any stock Hermes install with **no prerequisites and no silent changes** to the VPS:
- Never install anything, write helper files or scripts to the VPS, open ports, use `sudo`, change Hermes source, plugins or hooks, or start an API server or dashboard.
- Never **read** `.env`, `auth.json` or API key values. Writing a key through `hermes config set <ENV_VAR>` is allowed, but the app must never read it back.
- Never add `--yolo` or bypass Hermes approval policy.
- Writes happen only on an explicit user action (Save/Send/Restart/Upload, or something the user types into the terminal). Before saving, show a confirmation with a diff, prefer the official `hermes` CLI, and log the action locally without its contents.
- Build every remote command from individually quoted arguments, never by concatenating strings.

Rejected alternatives and the reasons for them are listed in PRD §8.1. Don't reintroduce those approaches.
- Cron (M2): `collect_cron` in the collector emits a `cron` event only when its digest changes. `src/main/cron/` holds `CronStore`, `CronWatcher` (first batch after a reset is a baseline, then one alert per new failed run) and the output reader, which builds the `head -c 65536` path itself and never accepts a path from the renderer. Renderer helpers: `lib/cron.ts`, `lib/cronExpr.ts` (5-field cron and simple intervals evaluated in the job's UTC offset).
- Feed (M3): the collector polls `state.db` each tick and emits `feed` events (items chunked at 50, ids `profile:messageId:n`, one cursor per profile). History is sent first (`history: true`); after a reconnect `--cursors` makes it continue without duplicates or gaps. On-demand reads (`feed.message`, `feed.history`, `feed.session`) run `--query <cmd> <json>` in the same script over a separate exec, validated by `QueryRunner` in `src/main/query.ts` (profile and session names are regex-checked in `ipc.ts`). Conversation text lives only in memory. Renderer: `lib/feed.ts` (merge, filter, sort), `stores/feed.ts`, `screens/feed/` (virtualized `FeedView` with scroll anchoring, `SessionModal`, `FeedModal`), and `loadOlderFeed`/`loadFullText` in `actions.ts` (not in the store, which also compiles for Node tests).
- Second brain (M4a): the vault runs in its own stream (`python -u - <home> --vault <path>`, started by `BrainService` in `src/main/brain/service.ts` after connect and restarted when the saved path changes), because the main collector has no control channel. The collector parses the vault (Obsidian link rules, tags, aliases) and sends `brain` events: chunked snapshot, then deltas every 3 s with only changed notes. Vault path lives in `app.db` per connection; note bodies are fetched on click with `--query note` and the vault root always comes from the saved setting. Renderer: `lib/brain/graphModel.ts` (filters, groups, local graph), `stores/brain.ts`, `graph/` (d3-force worker, Pixi renderer with an edge mesh, `BrainCanvas`), `lib/brain/markdown.ts` (markdown-it + DOMPurify, wikilinks become in-app links, other links inert). Pixi must be imported through `pixi.js/unsafe-eval` because of the strict CSP. The graph is drawn as neurons after `prototypes/neuron-graph/index.html` (mode 4): glowing soma, a dendrite tree per note (built lazily for at most 260 notes that are zoomed in enough), curved links in a few colour-bucket meshes with synapse dots, signals that travel along links when a neuron fires (click, the Fire signal button, a changed note, and idle firing unless Reduce motion is on), and colours by top-level folder (`colorByFolder`, user groups win). The layout puts each folder on its own spot of a circle (`anchorsOf`) and keeps nodes apart by their dendrite reach (`collideRadius`). Benchmark: `MC_PERF=1 npx playwright test tests/e2e/brainPerf.spec.ts` (results in the M4a spec).
- Dashboard (mockup parity): `screens/Dashboard.tsx` follows `mockup/src/Main.dc.html` (left: agent count, Cron, Activity with an alerts tab; middle: Server and the graph; right: Agents). Panel sizes are draggable dividers (`components/Resizer.tsx`: pointer and arrow keys, `role=separator`) whose values live in settings (`dashboard.chatW` 260-640, `dashboard.cronH` 90-560, `dashboard.rosterH` 60-480) and follow the drag live through `hooks/useLiveSetting.ts`, which saves on release. The chat room of the mockup is M5; until then the selected agent's detail card sits where it will go. Panels that wait for the first collector event use `FeedWaiting` (spinner for 10 s, then an explanation or the error), and the collector announces an empty feed once so nothing waits forever.
- Agent status follows each profile's own `gateway_state.json` (`pid` alive and `gateway_state` not a stopped state), because Hermes v0.21.0 runs one gateway per profile; the older multiplex layout (`served_profiles`) is still supported.
- Shell gotcha on this machine: in Bash heredocs a double backslash collapses to one. Write files containing escapes with the Write/Edit tools, not `python - <<EOF` replacements.
