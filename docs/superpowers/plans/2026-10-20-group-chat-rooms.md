# Group chat rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rooms in the Chat screen where the user and 2 to 6 agents talk, with Hermes Desktop's round rules, run by
the main process over the existing TUI gateway.

**Architecture:** Pure room rules in `src/shared/groups.ts`; `TuiGateway` keeps sessions per slot so a member's room
session (`Group: <groupId>`, hidden) lives beside its 1:1 session; `GroupStore` (app.db migration 6) holds rooms,
members and the log; `GroupService` runs the rounds and streams `GroupEvent`s; the renderer shows rooms in the Chat
screen.

**Tech Stack:** Electron main (TypeScript, better-sqlite3, ssh2), zod IPC, React 19 + Zustand renderer, Vitest,
pytest, Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-10-20-group-chat-rooms-design.md`

## Global Constraints

- Zero-Change (PRD §3.2): no `hermes serve`, no new process on the VPS besides the TUI gateway the chat already
  starts on Send; room create/rename/edit/delete only touch `app.db`; never `--yolo`; `app.log` never gets room text.
- UI strings in English; the user is answered in Indonesian.
- Limits: 2 to 6 members, name 1 to 60 characters, `MAX_ROUNDS = 3`, `MAX_MESSAGES = 10`, `HISTORY_LINES = 24`,
  `LINE_CHARS = 2000`, `ENTRY_CHARS = 16_000`, 2,000 entries per room, group id `/^mc-[a-z0-9]{10}$/`.
- Member session title `Group: <groupId>`, `session.create` params `{ source: 'mission-control', profile?, title,
  hidden: true, room_plumbing: true, follow_profile_config: true }`.
- Every IPC argument is checked with zod in `src/main/ipc.ts`; the preload imports only `src/shared/channels.ts`.
- `src/shared/` files that the preload does not import may use zod; the collector is untouched.
- Dracula tokens; `#6272A4` is decoration only; secondary text `#A9B2D3` / `#8B95BD`.

---

### Task 1: Room rules (`src/shared/groups.ts`)

**Files:**
- Create: `src/shared/groups.ts`
- Test: `tests/unit/groups.test.ts`

**Interfaces:**
- Produces:
  - `GROUP_ID_RE`, `GROUP_MIN_MEMBERS = 2`, `GROUP_MAX_MEMBERS = 6`, `GROUP_NAME_MAX = 60`, `MAX_ROUNDS = 3`,
    `MAX_MESSAGES = 10`, `HISTORY_LINES = 24`, `LINE_CHARS = 2000`, `ENTRY_CHARS = 16_000`, `ENTRIES_PER_GROUP = 2000`
  - `type GroupEntryStatus = 'ok' | 'pass' | 'failed' | 'stopped'`
  - `interface GroupEntry { seq: number; author: string; text: string; status: GroupEntryStatus; ts: number }`
    (`author` is `'user'` or a profile)
  - `interface GroupRoom { id: string; name: string; members: string[]; needsYou: boolean; createdAt: number;
    updatedAt: number; last: { ts: number; author: string; text: string } | null }`
  - `type GroupRunEnd = 'settled' | 'cap' | 'stopped' | 'error'`
  - `interface GroupMember { profile: string; name: string }`
  - `newGroupId(rand?: () => number): string`, `cleanGroupName(s: string): string | null`
  - `mentionForms(m: GroupMember): string[]`
  - `parseMentions(text: string, members: GroupMember[]): { mentioned: string[]; everyone: boolean; user: boolean }`
  - `responders(log: GroupEntry[], members: GroupMember[]): GroupMember[]`
  - `rotate<T>(list: T[], round: number): T[]`
  - `formatLine(e: GroupEntry, viewer: string, names: Record<string, string>): string`
  - `turnPrompt(i: { roomName: string; members: GroupMember[]; viewer: GroupMember; lines: string[] }): string`
  - `isPass(text: string): boolean`, `cutEntry(text: string): string`
  - `groupTitle(id: string): string` (`Group: <id>`), `groupIdOfTitle(title: string): string | null`

- [ ] **Step 1: Write the failing tests** covering: ids match the regex and differ; `cleanGroupName` trims, refuses
  empty, > 60 and control characters; `parseMentions` finds `@ada`, `@"Research Buddy"`, `@researchbuddy`,
  `@research-buddy`, `@everyone`, `@all`, `@user`, ignores `email@ada.com` and unknown names, case-insensitive;
  `responders` returns everyone without mentions, only mentioned since the last user entry, a mention by a member
  after the user counts, `@everyone` gives all; `rotate` shifts by round modulo length; `formatLine` gives
  `Ana (user): hi`, `Ada: x`, `Ada (you): x`; `turnPrompt` starts with `[Group chat: "Ops"] You are @ada,` and contains
  each line indented by two spaces and `exactly "(pass)"`; `isPass` accepts `(pass)`, ` PASS `, `pass.`, `[pass]`, ``
  and refuses `I pass this to @bo`; `cutEntry` cuts at 16,000 with `…`; `groupIdOfTitle('Group: mc-abcdefghij')`.
- [ ] **Step 2:** `npx vitest run tests/unit/groups.test.ts` fails (module missing).
- [ ] **Step 3: Implement** the module. Mention forms: the profile lower-cased, the name lower-cased slugged
  (`[\s_]+` to `-`), collapsed (no `[\s_-]`), and the first word of the name. Mentions are found with
  `/(^|[^\w@.])@(?:"([^"]{1,60})"|([\w.-]{1,64}))/g`; a trailing `.` or `-` of a bare handle is dropped.
- [ ] **Step 4:** tests pass.
- [ ] **Step 5:** commit `feat(groups): room rules shared by main and renderer`.

### Task 2: Gateway sessions per slot

**Files:**
- Modify: `src/main/chat/gateway.ts` (`session`, `adopt`, `turn`, `prompt.submit` error path)
- Modify: `tests/fixtures/fake_tui_gateway.py` (keep title, hidden; group replies)
- Test: `tests/integration/chatGateway.test.ts` (existing file; add cases)

**Interfaces:**
- Produces: `TuiGateway.turn(turn, profile, message, saved, emit, begin, opts?: { slot?: string; create?:
  Record<string, unknown> })`. Without `opts` nothing changes. `slot` defaults to `profile`; `create` is spread into
  `session.create` params.
- Fake: `session.create` stores `title` (written as `sessions.title` in state.db) and `hidden`; a prompt starting with
  `[Group chat:` replies `<profile>: noted.` on the session's first turn, `<profile>: on it.` when the prompt mentions
  `@<profile>`, else `(pass)`; `danger`, `slow`, `ask` still work. `gatewayCalls` already records method and params.

- [ ] **Step 1:** add an integration test: two turns for profile `default`, one with `slot: 'default#mc-aaaaaaaaaa'`
  and `create: { title: 'Group: mc-aaaaaaaaaa', hidden: true }`; expect two `session.create` calls, the second with
  the title, and different stored ids reported to `begin`.
- [ ] **Step 2:** run, see it fail.
- [ ] **Step 3:** implement: `sessions` keyed by `slot`; `session(profile, slot, saved, create)`; delete by slot on a
  failed `prompt.submit`. Fake changes as above.
- [ ] **Step 4:** run the gateway tests (`npx vitest run tests/integration/chatGateway.test.ts`) and pytest if the
  fake has tests.
- [ ] **Step 5:** commit `feat(chat): gateway sessions per slot so an agent can be in a room and a DM`.

### Task 3: `GroupStore` and migration 6

**Files:**
- Create: `src/main/groups/store.ts`
- Modify: `src/main/store/settingsStore.ts` (migration 6, `readonly groups`, `forgetConnection`)
- Test: `tests/unit/groupStore.test.ts`

**Interfaces:**
- Produces `class GroupStore(db: Database.Database, connectionId: () => number | null)` with
  `list(): GroupRoom[]`, `get(id): GroupRoom | null`, `create(id, name, members, now?): GroupRoom`,
  `update(id, patch: { name?: string; members?: string[] }, now?): GroupRoom | null`, `remove(id): void`,
  `entries(id, opts?: { before?: number; limit?: number }): GroupEntry[]` (ascending, default limit 300),
  `addEntry(id, author, text, status, ts?): GroupEntry`, `lastSeq(id): number`,
  `members(id): { profile: string; sessionId: string | null; seenSeq: number }[]`,
  `setSession(id, profile, sessionId | null)`, `setSeen(id, profile, seq)`, `setNeedsYou(id, flag)`,
  `clearEntries(): void`, `forget(connectionId: number): void`.
- Tables `group_rooms`, `group_members`, `group_entries` as in the spec.

- [ ] **Step 1:** tests with a temp db file: create/list order (newest activity first), update keeps the session and
  `seen_seq` of kept members, removes dropped ones, adds new ones at seen 0; entries get seq 1..n; retention keeps the
  newest 2,000; `clearEntries` empties entries and resets seen; `forget` drops only that connection; `forgetConnection`
  of SettingsStore drops them; nothing works without a connection (list `[]`, create throws).
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run tests/unit/groupStore.test.ts`).
- [ ] **Step 5:** commit `feat(store): rooms, members and room log (migration 6)`.

### Task 4: `GroupService` (rounds)

**Files:**
- Create: `src/main/groups/service.ts`
- Modify: `src/shared/ipc.ts` (`GroupEvent`, `GroupSendResult`, `GroupList`, `MissionApi.groups`)
- Test: `tests/unit/groupService.test.ts`

**Interfaces:**
- Consumes: `GroupStore`, Task 1 rules.
- Produces:
  ```ts
  export type MemberTurnStart =
    | { ok: true; cancel(): void; approve(approval: string, option: string | null): boolean; done: Promise<void> }
    | { ok: false; error: 'no-gateway' | 'failed-to-start'; detail?: string }
  export interface MemberTurnReq { groupId: string; profile: string; turn: string; message: string;
    saved: string | null; title: string; emit: (e: ChatEvent) => void; onSession: (id: string) => void }
  export interface GroupDeps { store: GroupStore; runTurn(r: MemberTurnReq): Promise<MemberTurnStart>;
    available(): { ok: boolean; reason?: string }; isConnected(): boolean; profiles(): string[] | null;
    names(): Record<string, string>; emit(e: GroupEvent): void; log?(m: string): void }
  export class GroupService { list(): GroupList; create(name, members): GroupRoom | { error: string };
    update(id, patch); remove(id); entries(id, before?); send(id, text): Promise<GroupSendResult>;
    stop(id): void; approve(turn, approval, option): boolean; clear(): void; dispose(): void; running(id): boolean }
  ```
  `GroupEvent = { groupId: string } & ({ kind: 'run-start' } | { kind: 'turn-start'; profile: string; turn: string }
  | { kind: 'turn'; event: ChatEvent } | { kind: 'entry'; entry: GroupEntry } | { kind: 'turn-end'; profile: string;
  turn: string } | { kind: 'run-end'; reason: GroupRunEnd; replies: number; needsYou: string | null; error?: string }
  | { kind: 'changed' })`. `GroupSendResult = { ok: true } | { ok: false; error: 'not-connected' | 'busy' | 'empty' |
  'too-long' | 'not-found' | 'no-gateway'; detail?: string }`. `GroupList = { rooms: GroupRoom[]; running: string[];
  gateway: { ok: boolean; reason?: string } }`.

- [ ] **Step 1:** tests with a scripted `runTurn` (per profile a queue of replies or `'fail'`, `'slow'`): two members,
  both reply then both pass → `settled`, 2 replies, prompts contain only the other's and the user's lines; a mention of
  `@bo` in the user text → only bo speaks; a reply `@ada` pulls ada into round 2; replies that never pass → `cap` at
  10 messages (6 members) or 3 rounds; `(pass)` stored as `pass`; a failed start stored as `failed`, run goes on; a
  missing profile → `failed` "not on the server"; `@user` sets `needsYou` and run-end `needsYou`; Stop during a slow
  turn → `stopped`; a second send while running → `busy`; `no-gateway` when `available()` is false; session ids
  stored via `onSession`; `seen_seq` advances; dispose ends a run as `stopped`.
- [ ] **Step 2-4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat(groups): run rounds of member turns over the gateway`.

### Task 5: Wiring (ChatService, session, IPC, preload, notifications)

**Files:**
- Modify: `src/main/chat/service.ts` (`groupTurn`, `groupsAvailable`)
- Modify: `src/main/session.ts` (construct `GroupService`, known profiles and names, teardown, methods)
- Modify: `src/shared/channels.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/shared/notify.ts`,
  `src/main/index.ts` (notice target `group`), `src/renderer/noticeActions.ts`
- Test: `tests/integration/groups.test.ts` (fake SSH with `tuiGateway: true`: create a room of default + one profile,
  send, two replies, settled; titles of `session.create` are `Group: <id>`)

**Interfaces:**
- Channels: `groupsList 'mc:groups:list'`, `groupsCreate`, `groupsUpdate`, `groupsDelete`, `groupsEntries`,
  `groupsSend`, `groupsStop`, `groupsApprove`, `groupsClear`, `notifyGroup 'mc:notify:group'`, `evGroup 'mc:ev:group'`.
- `MissionApi.groups: { list(): Promise<GroupList>; create(a: { name: string; members: string[] }): Promise<GroupRoom
  | { error: string }>; update(a: { id: string; name?: string; members?: string[] }): Promise<GroupRoom | { error:
  string }>; remove(id: string): Promise<void>; entries(a: { id: string; before?: number }): Promise<GroupEntry[]>;
  send(a: { id: string; text: string }): Promise<GroupSendResult>; stop(id: string): Promise<void>; approve(a: { turn:
  string; approval: string; option: string | null }): Promise<boolean>; clear(): Promise<void>; notify(a: { id:
  string; replies: number; needsYou: string | null }): Promise<void> }`, `onGroup(cb)`.
- `NoticeTarget` gets `{ kind: 'group'; id: string }`.

- [ ] Steps: failing integration test, implement, pass, typecheck, commit
  `feat(groups): rooms over IPC with notifications`.

### Task 6: Renderer state

**Files:**
- Create: `src/renderer/stores/groups.ts`, `src/renderer/groupsActions.ts`, `src/renderer/lib/groupView.ts`
- Modify: `src/renderer/bootstrap.ts` (subscribe `onGroup`, load on connect, unread and notify)
- Test: `tests/unit/groupView.test.ts`, `tests/unit/groupsStore.test.ts`

**Interfaces:**
- `useGroups`: `{ rooms: GroupRoom[]; running: Record<string, boolean>; gateway: { ok: boolean; reason?: string };
  current: string | null; entries: Record<string, GroupEntry[]>; live: Record<string, { profile: string; turn: Turn }
  | null>; ended: Record<string, { reason: GroupRunEnd; error?: string } | undefined>; unread: Record<string,
  number>; drafts: Record<string, string>; sendError: Record<string, string | null>; setList, setCurrent, apply(ev),
  setEntries, setDraft, reset }`.
- `groupView.ts`: `buildGroupConv(entries, live, ended): GroupConv[]` with kinds `user`, `member`, `passed` (names of
  the members that passed in a row), `failed`, `stopped`, `live`, `end`; `mentionAt(text, caret)` →
  `{ start, query } | null`; `suggest(query, members, names)` → profiles; `roomSub(room, running, unread)`.

- [ ] Steps: tests first, implement, pass, commit `feat(groups): renderer state for rooms`.

### Task 7: Chat screen UI

**Files:**
- Modify: `src/renderer/screens/Chat.tsx`, `src/renderer/screens/chat/Conversation.tsx` (export `StreamBubble` with an
  `onApprove` prop)
- Create: `src/renderer/screens/rooms/GroupRoom.tsx`, `GroupConversation.tsx`, `GroupComposer.tsx`,
  `GroupDialog.tsx`, `src/renderer/styles/groups.css`
- Modify: `src/renderer/lib/palette.ts` + `paletteActions.ts` (room items), `src/renderer/settings/DataTab.tsx`
  (Clear room history), agent graph and Sessions labels for `Group: mc-…`

- [ ] Steps: build the components, `npm run typecheck`, run the app against `npm run dev:fake` is covered by the E2E
  in Task 8; commit `feat(groups): rooms in the Chat screen`.

### Task 8: E2E, docs and mockup

**Files:**
- Create: `tests/e2e/groups.spec.ts`
- Modify: `docs/PRD-mission-control-hermes.md` (§6.21 F-ROOM-1..8, §10 v2 row, §2), `docs/manual-vps-checklist.md`
  (steps 155-160), `CLAUDE.md`, `mockup/src/Chat.dc.html` (Rooms section and a room), rebuild mockups

- [ ] Steps: E2E (create a room with two agents, send, both reply, settled; `@` mention reaches one; Stop on `slow`;
  rename; delete), docs, `python mockup/build.py`, commit `test(e2e): rooms` and `docs: group chat rooms`.

### Task 9: Verify and release

- [ ] `npm run typecheck`, `npm test`, `npm run test:py`, `npm run test:e2e`.
- [ ] Bump the version (minor) in `package.json`, commit `chore(release): v0.4.0`, tag `v0.4.0`, push `master` and
  the tag; CI makes a draft release; publish it after the installers are attached (`docs/release.md`).
