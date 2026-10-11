# M5 — Chat (and file uploads): design

PRD refs: F-CHAT-1..9, 11..14 (F-CHAT-10 `hermes acp` is P2 and stays out). User chose to build chat and uploads together. Two new capabilities touch the VPS: running `hermes chat` (a normal Hermes action that creates a session in `state.db`) and SFTP uploads (a write, only after the user presses Send).

## Unverified CLI (the M5 spike)

The PRD flags `--query-file -` with `--format stream-json` and `--resume` as not shown together in the Hermes docs. This repo cannot run Hermes, so the spike is built into the app:

- Before the first turn the app runs `hermes chat --help` (read only) and records which of `--oneshot`, `--query-file`, `--format`/`stream-json`, `--resume`, `--source` exist.
- Full flags → the PRD command. Without `stream-json` or `--query-file` → a degraded **plain** mode: `hermes [-p profile] chat -q <message> -Q` (the message is one individually quoted argument), output streamed as text, no tool chips and no session resume. The chat shows "Limited mode" with the reason.
- Event parsing is tolerant: unknown event types are ignored, text may arrive as `text`, `delta` or `content`, session id as `session_id` or `sessionId`. Anything that fails shows Hermes' own stderr.
- The user runs `hermes chat --help` once on the real server and sends the output; the parser is then pinned to the real shape.

## Design

**Main** (`src/main/chat/`): `ChatService` runs one exec per turn through `openStream` (message on stdin, never in a shell string), keeps one active turn per profile, parses stdout lines into `ChatEvent`s (`session`, `text`, `tool`, `result`, `notice`, `error`, `end`), forwards them to the renderer, and stops a turn by sending `INT` on the channel and closing it after 3 s. A tool result that looks like an approval refusal becomes the notice "Command blocked by Hermes approval policy" (F-CHAT-7; no `--yolo`, ever). The agent → session mapping lives in `app.db` (`chat.session.<connection>.<profile>`); message text is never stored. Opening a conversation loads the session from `state.db` (`feed.session`), and new items arrive through the feed, so **thinking blocks and tool steps come from the database** (F-CHAT-4) while the streaming bubble shows the reply as it is written (F-CHAT-3). A new query `chat_sessions {profile}` lists sessions with `source = 'mission-control'` (F-CHAT-6).

**Uploads** (`UploadService`): files are registered in the main process from a native picker (`dialog.showOpenDialog`) or from dropped `File`s resolved by `webUtils.getPathForFile` in the preload, so the renderer can never name an arbitrary local path. On Send they go over SFTP to `<home>/hermes-uploads/<profile>/<YYYYMMDD>/<name>` (directories created with mode 0700, file 0600): sanitized names (no separators, no leading dots), collisions get `-1`, `-2`, 50 MB per file by default (`chat.maxUploadMb`), progress events, cancel removes the partial file. The message then starts with `[Attached: <abs path> · <size> · <mime>]` per file (F-CHAT-12). Image attachments show a thumbnail made by the main process. If `terminal.backend` of the agent (`hermes -p <p> config get terminal.backend`) is a container backend, a warning explains that the files may not be visible inside the sandbox (F-CHAT-14). Settings → Uploads lists the uploaded files per agent (read only query `uploads_list`) and deletes one only after confirmation (F-CHAT-13).

**Renderer**: `stores/chat.ts` (per profile: session id, running turn, pending user bubble, history items, draft, attachments), a `Conversation` that merges database items with the live turn, `Composer` (Enter sends, Shift+Enter newline, attach, drag and drop, Stop), markdown with copy buttons on code (`components/Markdown.tsx`, same DOMPurify rules as notes), the Chat screen (agent list left, conversation right, History and New chat), and the Dashboard chat room inside the agents panel (the selected agent's room replaces its detail card; a toggle shows the details).

## Testing

pytest: `chat_sessions`, `uploads_list`, read-only. Vitest: stream parser (tolerant cases, hostile text), `ChatService` against the fake SSH server with a fake `hermes` that also writes `state.db` rows, busy/stop/error paths, only `hermes` and read verbs plus the one chat command, no message text in `app.db`; `UploadService` against a fake SFTP (name sanitizing, collisions, size limit, progress, cancel, 0700/0600); conversation merge; markdown. Playwright: send and stream, tool chip, thinking block from the database, Stop, New chat and History, markdown copy, attach and upload, Dashboard room, uploads list and delete.
