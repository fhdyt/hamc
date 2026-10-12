# M6 · Agent Settings: design

PRD: 6.8 (F-CFG-1..18), F-CFG-25/26 by reference. Mockup: `mockup/src/_shared/shared.html` (Settings → Agents). The UI is English only; this document is not.

## Scope

In: Settings → Agents with four tabs: **Model** (F-CFG-1..9), **Soul**, **Memory**, **User profile** (F-CFG-10..18). The agent list sits on the left of the tab, the Dashboard gear opens it.

Out (other milestones): Profile tab with local photo and display name (F-R10-1), `display_name` through the CLI (F-CFG-17, P2), fallback and auxiliary models (F-CFG-19), MCP, toolsets, backup, new profile (M10).

Deviations from the PRD, chosen on purpose:

| PRD | Here | Why |
|---|---|---|
| CodeMirror 6 + merge | Plain `<textarea>` and a small line diff / 3-way merge in `src/shared/textDiff.ts` | The mockup uses a textarea. The files are a few KB. No new dependency, no CSP or bundle cost. |
| F-CFG-16: auto refresh from the collector | The renderer polls the file hash every 5 s over SFTP while an editor is open and clean | The collector has no control channel and must not grow a new event for 3 files. A read of a few KB per 5 s is cheap. |
| F-CFG-8: `chat --oneshot -q ... --format stream-json` | `chat -q "Reply with OK" -Q` | The real `hermes chat` has no `--format` (see commit 3586f3b). Success is exit code 0 and an answer. |

## Zero-Change rules that shape the design

- Nothing is written before the user presses Save; every save shows a diff (files) or the exact command list (model) first.
- `.env`, `auth.json` and key values are never read. The key typed by the user lives in the renderer field until Save, travels once over IPC to the main process, goes to Hermes, and is dropped. It is never logged (argv of key commands is redacted in logs) and never stored in `app.db`.
- Model changes go only through `hermes config set` / `config get`. Files go through SFTP (temp file in the same folder, then rename, original permission bits kept).
- No helper files on the server. The model list is fetched by `python -c <script>` with the key on **stdin** (the script itself is an argument, it holds no secret).
- Remote commands are built with `buildCommand` (every argument single quoted). The renderer sends data (profile, kind, text, provider choice), never a command; the main process builds the commands.

## Architecture

```
renderer  screens/agents/*  stores/agentCfg.ts  lib/agentCfg.ts
   │ window.mc.agentCfg.*  (typed, zod-checked in ipc.ts)
main      agentcfg/files.ts   AgentFileService   SFTP read / hash / atomic write
          agentcfg/model.ts   ModelService       config get/set, status, fetch models, test, restart
          agentcfg/parse.ts   tolerant parsers (config get model, status, models JSON)
shared    agentCfg.ts         kinds, limits, paths, presets, command plan, types
          textDiff.ts         line diff, 3-way merge
```

### Files (Soul, Memory, User)

- Paths: default profile `<home>/SOUL.md`, `<home>/memories/MEMORY.md`, `<home>/memories/USER.md`; other profiles `<home>/profiles/<name>/…`. `<home>` comes from the preflight, the profile name is regex checked (`^[A-Za-z0-9._-]{1,64}$`) and `default` is mapped by the service. The renderer never sends a path.
- `read(profile, kind)` returns `{ exists, text, hash, mtime }`; `hash` is SHA-256 of the bytes. Files over 256 KB are refused.
- `write(profile, kind, text, baseHash)`: limits are enforced again in main (Memory 2,200 and User 1,375 characters, code points; Soul has none besides the 256 KB cap). Then it reads the current hash; if it differs from `baseHash` (`null` means "the file did not exist") the answer is `conflict` with the server's current file and nothing is written. Otherwise: write `.<name>.mc-<random>` next to the file (mode of the original, `0600` for a new file), rename over the target (OpenSSH `posix-rename` when the server has it, else rename and, if the target blocks it, remove the target and rename again), and read back to return the new hash. A failed write removes the temp file. `memories/` is created (0755) when missing.
- The remaining race (the agent writes between the hash check and the rename) is milliseconds wide and the same as any editor; the PRD asks for hash-before-save and that is what this does.

### Editor behaviour (renderer)

- One draft per `(profile, kind)` in memory only (F-CFG-18): `base` (text and hash as opened), `text` (editor). Dirty = `text !== base.text`. Tab labels carry ● when dirty. Nothing goes to disk.
- Soul: textarea + side preview (markdown-it + DOMPurify, the existing `Markdown` component), "Create SOUL.md" when missing.
- Memory / User: cards per `§` entry (edit, delete, add, move up/down), and a Raw mode on the same text. Entries are joined by `\n§\n`. A counter shows `used / limit`; red and Save disabled over the limit.
- Save opens a confirm dialog with the line diff (before → after) and the note "Changes apply to new sessions" with a **Restart this agent's gateway** link (F-CFG-14). On success the previous text goes to an in-memory undo stack (**Revert last save**, F-CFG-15; it is also a normal write with the hash check and the same confirm).
- Conflict (F-CFG-13): a dialog shows base→theirs and base→mine diffs with **Keep mine** (overwrite using the new hash, after a second confirm), **Take theirs** (draft becomes theirs) and **Merge** (3-way merge into the editor; overlapping edits get `<<<<<<<` markers and Save stays disabled while markers remain).
- Auto refresh (F-CFG-16): while the tab is open and the draft is clean, the file is re-read every 5 s; a changed hash replaces the text and shows "Updated from the server". A dirty draft is never replaced; a "Changed on the server" notice appears instead, and the conflict flow handles it on Save.
- Leaving (F-CFG-18): switching agent, closing the modal or Settings tab, or a lost connection with unsaved drafts asks "You have unsaved changes" (Discard / Keep editing). The window closes with the Electron `beforeunload` guard: main shows a dialog.

### Model

State shown (F-CFG-1): provider, model, base URL, reasoning effort from `config get model --json` and `config get agent.reasoning_effort --json`; credential status per provider from `hermes status`. The "model used in the last session" of F-CFG-1 (`sessions.model`) is not shown: the feed items do not carry it and a new collector query for one line is left for later.

Flow (F-CFG-2..5): provider choice (OpenRouter, Anthropic, Nous Portal (OAuth, info only), Ollama (no key, `http://localhost:11434/v1`), Custom) → Base URL (preset default, editable; Custom requires name and URL) → API key (password field; hidden when saved key exists unless the user wants to replace it; absent for Ollama and OAuth) → **Fetch models** → filter and pick (or type an ID) → reasoning effort → **Test** → **Save**.

- Command plan (`buildModelPlan`, pure, shared): for Custom `providers.<name>.api <url>` and `providers.<name>.key_env <NAME>_API_KEY`; the key `config set <ENV> <key>`; then `model.provider <slug>`, `model.default <id>`, `model.base_url <url>` (only when the user changed it or Custom), `agent.reasoning_effort <e>` when changed. The renderer shows the plan with the key as `••••`; the main process rebuilds the same plan from the request and runs it step by step, stopping at the first failure and returning Hermes's stderr as is. The key is replaced by `••••` in any text that comes back.
- Key delivery: `ModelService.keyMode()` probes `hermes config set --help` once per connection. If it mentions a stdin option (`--stdin`, or `-` as value) the key goes over stdin; otherwise it is an argument and the UI shows the PRD warning (visible in `ps` for under a second on a shared server) before Save. This is the unverified part (see the spike).
- After the last step, `config get model --json` is read again and compared with what was asked; a mismatch is shown as a warning, not hidden.
- Fetch models (F-CFG-4): `python -c <script> <base_url>` with the key on stdin. The script (ASCII only, stdlib) does `GET <base>/models` with `Authorization: Bearer` when a key was given, 15 s timeout, and prints one JSON line `{ok, status, models:[{id, ctx}], error}`. Accepts `{data:[…]}` or a bare list, `context_length` or `context_window`. Only `http`/`https` URLs are allowed. When the key field is empty because a key is already saved, the request goes without a key (the app does not read the saved one); a 401 is explained as "enter the key to list models, or type the model ID".
- Test (F-CFG-8): `hermes [-p P] chat -q "Reply with OK" -Q` with a 90 s timeout; ✓/✗ plus latency. Uses the saved config, so the UI says "tests the saved model".
- Restart gateway (F-CFG-9): confirm dialog, then `hermes [-p P] gateway restart`.
- Parsers are tolerant and unit tested with several shapes: `config get model --json` may be an object (`default`/`model`, `provider`, `base_url`) or a JSON string; `status` is free text: a provider line counts as having a key/OAuth when it carries a positive marker (✓, "configured", "logged in", "set") and no negative one. Unknown formats give "unknown", never a wrong ✓.

## Data flow and errors

`window.mc.agentCfg.files.read/write`, `.model.read/fetch/save/test`, `.gateway.restart`. Results are discriminated unions (`ok`/`error`) like `QueryResult`; no thrown errors cross IPC except for bad arguments. Errors: `not-connected`, `conflict`, `too-long`, `too-large`, `bad-profile`, `failed` (with detail from Hermes or SFTP). Everything is disabled with an explanation while disconnected.

## Testing

- Unit: `textDiff` (diff, merge3), entries split/join, limits, `buildModelPlan`, env var naming, parsers.
- Integration (fake SSH + real files in the fixture): read/write/atomic/mode kept/no temp left/conflict/too-long/new file; model read/save/verify/stop on failure/redaction/stdin vs argument key mode; fetch models against a local HTTP server through the real script; test; restart; Zero-Change snapshot (only the files and `config set` effects changed).
- Renderer: store tests (dirty, undo, conflict state, guards).
- E2E: edit Memory with a conflict, save Soul; change model with fetched list; unsaved warning.
- The real Hermes formats are unverified: manual checklist steps 58+ and `docs/spike-m6-hermes-cli.md`.
