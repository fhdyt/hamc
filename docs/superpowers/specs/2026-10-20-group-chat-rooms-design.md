# Group chat rooms (v2, F-ROOM-1..8)

## Goal

Let the user talk to several agents in one room (PRD §2 "Chat room multi-agent", v2 candidate in §10). The user and
2 to 6 agents of the connected VPS share one conversation; agents answer in turn, can pull each other in with
`@name` and can ask the user with `@user`. A room never talks by itself: every round starts from the user's Send.

## What Hermes offers (checked against the Hermes source at tag v2026.8.31, the version on the user's VPS)

- **Hosted rooms** (`groups.create|send|log|stop|approve`, tables `hosted_rooms` and `hosted_room_events` in the home
  `state.db`) are driven by a worker that only `hermes serve` / the dashboard starts (`hermes_cli/web_server.py`), and
  `tui_gateway/server.py` does not even register `methods_groups` at this tag. Starting `hermes serve` would start an
  API server, which Zero-Change forbids (PRD §3.2). **Not used.**
- **The client-owned room path** of Hermes Desktop (`apps/desktop/src/plugins/hermes-bots/group-rounds.ts`,
  `group-turns.ts`) runs the rounds in the client. Each member has its own persistent Hermes session titled
  `Group: <roomId>`, created through the TUI gateway with `session.create {profile, title, hidden: true,
  room_plumbing: true, follow_profile_config: true}` and reopened with `session.resume`. `methods_session.py` at the
  tag accepts all of these parameters. **This is what the app does**, with the same rules and the same prompt shape, so
  an agent behaves in a Mission Control room as it does in a Hermes Desktop room.

## Decisions

- Behaviour as in Hermes Desktop: one Send starts at most **3 rounds** and at most **10 member messages**; members
  answer one after another, never in parallel; `(pass)`, an empty reply or a failed turn is silence; a round in which
  every speaker stayed silent ends the run.
- Approach A: the orchestrator lives in the **main process** on top of the existing `TuiGateway`. Rooms need the
  gateway; there is no ACP or one-shot fallback (the one-shot chat cannot title a session).
- The room list, members and room log are stored **locally in `app.db`** (Hermes Desktop also keeps its room log on
  the desktop). On the VPS there are only ordinary Hermes sessions, written when the user presses Send.
- Rooms live in the **Chat screen**: a Rooms section above Direct messages. No new screen, no new sidebar item.
- While a run is going, Send to that room is refused (`busy`); the composer shows Stop.
- Not in scope (YAGNI): attachments in rooms, Hermes Desktop's per-member stop holds and continuations, members on
  other machines, syncing with Hermes Desktop rooms or the hosted-room tables.

## Zero-Change

- Nothing is installed or started on the VPS besides the TUI gateway the chat already uses (started by a Send, ended by
  closing stdin on disconnect).
- Writes on the VPS are Hermes's own session writes caused by an explicit Send. Creating, renaming, editing or deleting
  a room only changes `app.db`. Deleting a room leaves its member sessions on the server (like Clear chat).
- The app never adds `--yolo` and never answers an approval by itself (a stopped or ended turn answers `deny`, as in
  the 1:1 chat).
- `app.log` gets `room <id> run start|end <reason>` and `room <id> turn <profile> reply|pass|failed|stopped`, never
  the text.

## Room rules (`src/shared/groups.ts`, pure)

- `GROUP_ID_RE = /^mc-[a-z0-9]{10}$/`, a name of 1 to 60 characters without control characters (`cleanGroupName`),
  2 to 6 members (`GROUP_MIN_MEMBERS`, `GROUP_MAX_MEMBERS`), profile names checked with the existing profile regex.
- `MAX_ROUNDS = 3`, `MAX_MESSAGES = 10`, `HISTORY_LINES = 24` (the most room lines one prompt carries),
  `LINE_CHARS = 2000` (one room line in a prompt is cut there), `ENTRY_CHARS = 16_000` (a stored reply is cut there).
- `handleOf(profile)`: the profile name. `mentionForms(member)` = the profile name, the local display name slugged
  (`Research Buddy` gives `research-buddy`) and collapsed (`researchbuddy`), and its first word, all lower case.
- `parseMentions(text, members)` finds `@name` and `@"two words"` and returns `{ mentioned: profile[], everyone,
  user }`; `@everyone` and `@all` set `everyone`, `@user` sets `user`. Matching ignores case.
- `responders(log, members)`: the members mentioned in the entries since the last user entry; everyone when nobody is
  mentioned or `everyone` is set. Recomputed every round, so a member pulled in by a reply joins the next round.
- `rotate(members, round)` shifts the order so a different member leads each round.
- `formatLine(entry, viewer, names)`: `<Name> (user): …`, `<Name>: …`, `<Name> (you): …`.
- `turnPrompt({ roomName, members, viewer, lines })` produces the Hermes Desktop prompt:
  `[Group chat: "<room>"] You are @<handle>, one participant in a group chat with <peers> and the user.`, the new lines
  oldest first, then the four room rules (reply only when there is something new, at full length for real results;
  exactly `(pass)` otherwise; `@name` to pull a teammate in, `@user` only for a judgment call; never reveal private 1:1
  chats, no preamble).
- `isPass(text)`: empty after trimming, or `(pass)` / `pass` with optional brackets, dots and case.

## Data (`app.db` migration 6)

```sql
CREATE TABLE group_rooms (
  connection_id INTEGER NOT NULL, group_id TEXT NOT NULL, name TEXT NOT NULL,
  needs_you INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, group_id));
CREATE TABLE group_members (
  connection_id INTEGER NOT NULL, group_id TEXT NOT NULL, profile TEXT NOT NULL, position INTEGER NOT NULL,
  session_id TEXT, seen_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (connection_id, group_id, profile));
CREATE TABLE group_entries (
  connection_id INTEGER NOT NULL, group_id TEXT NOT NULL, seq INTEGER NOT NULL, author TEXT NOT NULL,
  text TEXT NOT NULL, status TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (connection_id, group_id, seq));
```

- `author` is `user` or a profile. `status` is `ok` (a user message or a reply), `pass`, `failed` or `stopped`; only
  `ok` entries go into prompts. Passes are stored so the log can say "X passed".
- At most 2,000 entries per room (older ones are dropped). `seen_seq` is the last seq a member's session was shown.
- `GroupStore` (`src/main/groups/store.ts`) wraps the tables. `forgetConnection` and **Settings → Data → Clear room
  history** (entries only, rooms stay, members' `seen_seq` reset) remove them. Deleting a room removes its rows.

## Main process

- **`chat/gateway.ts`**: sessions are kept per **slot** instead of per profile. `turn()` takes an optional
  `{ slot, create }`: the 1:1 chat keeps `slot = profile`; a room member uses `slot = <profile>#<groupId>` and
  `create = { title: 'Group: <groupId>', hidden: true, room_plumbing: true, follow_profile_config: true }`. A
  member's 1:1 session and room session are different gateway sessions and may run at the same time.
- **`ChatService.groupTurn(profile, slot, message, saved, create, emit)`** uses the same gateway (same probe, start,
  restart limits and `chat.useGateway` setting). When the gateway cannot run, it answers `no-gateway` with the reason.
- **`GroupService`** (`src/main/groups/service.ts`) runs one *run* per room:
  1. Store the user entry, mark the room not needing the user.
  2. For each round (≤ 3): the speakers are `rotate(responders(...), round)`. For each speaker, until 10 member
     messages: build the prompt from the `ok` entries after the member's `seen_seq` (last 24), run the turn, collect
     the text, store an entry (`ok` with the reply, `pass`, `failed` with the error, or `stopped`), and set the
     member's `seen_seq` to the newest seq it was shown (its own entries never go into its prompts: they are in its own session already). A reply mentioning
     `@user` sets `needs_you`.
  3. The run ends with `settled` (a round with no `ok` reply), `cap` (10 messages or 3 rounds), `stopped`, or `error`
     (the gateway died or could not start).
  - A member whose profile is no longer on the server is skipped with a `failed` entry "not on the server".
  - Stop interrupts the running turn (`session.interrupt`, as the 1:1 Stop) and ends the run. A disconnect ends it as
    `stopped`.
  - One approval or clarify card at a time, answered through `groups.approve`. The round waits for it with no timeout,
    as the 1:1 chat does.
- **Events** on `mc:ev:group` (`GroupEvent`, `src/shared/ipc.ts`): `run-start`, `turn-start {profile, turn}`, the chat
  event kinds `text|tool|notice|approval|approval-done|error|result` with `{profile, turn}`, `entry {entry}`,
  `turn-end {profile}`, `run-end {reason}`, `changed` (the room list changed).
- **IPC** `mc:groups:list|create|update|delete|entries|send|stop|approve|clear`. `ipc.ts` checks everything with zod:
  the group id regex, the name, 2 to 6 distinct members matching the profile regex (main checks them again against the
  agents it knows), the text (same limits as chat), the approval id and option.
- **Notifications**: when a run ends while the user is not looking at that room (window hidden or not focused, or
  another screen or room), one notice through `NotificationCenter` (kind `chat`): title `<room>`, body `N new
  replies` or `<agent> needs you`; a click opens the room. The reply sound follows `notify.replySound` once per run.

## Renderer

- `stores/groups.ts`: rooms, the current room, entries per room, the live turn per room (reusing `lib/chat.ts`
  `Turn` and `foldEvent`), run state, unread counts, send error. `groupsActions.ts`: load on connect, create, update,
  delete, send, stop, approve; stale answers dropped with a sequence number.
- `lib/groupView.ts` (pure): the conversation items (user bubbles, member bubbles with name and colour, "X passed"
  folded into one muted line per run, failed and stopped notes, the live bubble), `mentionAt` (the `@` word at the
  cursor) and the member suggestions for it.
- **Chat screen**: the left list gets **Rooms** (title with a `+` New room button) above **Direct messages**. A room
  row shows overlapped avatars, the name and `N agents`, `working…`, `needs you` or an unread count. Choosing a room
  shows `screens/rooms/GroupRoom.tsx`:
  - Header: the name, member avatars, Edit (name and members), Delete (two-step).
  - Conversation: the user on the right, members on the left with avatar and coloured name, the live bubble of the
    member that is speaking (tool chips, approval cards answered with `groups.approve`), "Round settled", "Stopped" or
    the reason after a run.
  - Composer: Enter sends, Shift+Enter breaks the line, typing `@` shows the members (and `everyone`, `user` is not
    offered) to pick with the arrow keys; Stop while running. Member chips under the box insert `@name`.
  - Right column (≥ 1100 px): the members with status and **Open chat** (their 1:1 room).
  - When the gateway is off or missing: a banner that rooms need Hermes's TUI gateway (Settings → Chat), Send
    disabled.
- `GroupDialog.tsx`: New room and Edit room (name, member checkboxes, 2 to 6), `role="dialog"`.
- The command palette lists rooms (`Room: <name>`); the agent graph and the Sessions screen show the local room name
  for `Group: mc-…` titles when the app knows the room.
- Styles `gr-*` in `styles/groups.css`, Dracula tokens, JetBrains Mono.

## Errors

| Case | What the user sees |
|---|---|
| Gateway off, missing or failed to start | Banner in the room, Send disabled or answered `no-gateway` with the reason |
| A member's session cannot be opened | That member's entry `failed` with the reason; the run goes on |
| The gateway dies during a run | The live bubble shows the error, the run ends `error` |
| Disconnect during a run | The run ends `stopped`; entries stay |
| A member no longer on the server | Entry `failed`: "not on the server"; Edit room offers to remove it |
| Send while running | Refused `busy` (the composer is disabled anyway) |

## Testing

- Unit (Vitest): `shared/groups.ts` (mentions, responders, rotate, prompt text, isPass), `GroupStore` (migration 6,
  retention, clear, forget), `GroupService` with a scripted fake turn runner (rounds, mentions, passes, both caps,
  stop, failed member, missing member, `needs_you`, `seen_seq`), gateway slots (`create` params, two slots of one
  profile), `lib/groupView.ts`, the store reducers.
- Integration: `fake_tui_gateway.py` learns rooms: a prompt starting with `[Group chat:` gets `<profile>: noted` the
  first time a session sees it, then `(pass)` unless the new lines mention `@<profile>`; the words `danger` and `slow`
  work as in the 1:1 chat. `srv.hermes.gatewayCalls` shows the `session.create` titles.
- E2E (Playwright): create a room with two agents, send, both reply, the run settles; `@agent` reaches only that
  agent; Stop during a `slow` turn; an approval card in a room; rename and delete.
- Manual VPS checklist steps 155-160.
