# M4b · Agent interaction graph: design

PRD: 6.6b (F-AGRAPH-1..6). F-AGRAPH-7 (cross-machine) is v2. Mockup: `mockup/src/Main.dc.html` (`agentGraph()`, tab "agents" of the Dashboard graph panel). The UI is English only; this document is not.

## Scope

In: the **agents** tab of the Dashboard graph panel. It shows which agent interacts with which, from four Hermes mechanisms, live (new data within 2 s), with a detail card per edge or node.

Out: cross-machine interactions (F-AGRAPH-7), the Kanban screen, a `hermes kanban ... --json` fallback, reading `shared-state.db`, any write action. The Second brain screen does not change; the agents tab exists only on the Dashboard (PRD).

Deviations from the PRD, chosen on purpose:

| PRD | Here | Why |
|---|---|---|
| `shared-state.db` for rooms | Rooms come from session titles `Group: <room> · <thread>` in each member's `state.db` | The schema of `shared-state.db` is undocumented; titles give membership and last activity, which is all the graph draws. |
| Fallback `hermes kanban list/show --json` | None. An unreadable `kanban.db` marks that source `unreadable` | The collector never runs `hermes`; a fallback would add an exec per tick. It can follow once the real schema is known (checklist). |
| Graph drawn like the vault (Pixi) | SVG in React | At most 40 agents, a few rooms, 40 subagents and 300 edges. SVG gives dashed lines, clickable labels, keyboard focus and aria for free; the Pixi renderer is built for thousands of neurons. |

## Zero-Change rules that shape the design

- Everything is read through `open_ro` (`mode=ro`, `query_only`). The collector writes nothing and runs no `hermes` command.
- The renderer sends only `{kind, id}`; `ipc.ts` checks them with zod and a regex. Paths and commands are built in the collector.
- Message and task text is untrusted. It is shown as plain text (no markdown) and lives only in memory.
- Only two settings are saved: `dashboard.graphTab` and `dashboard.agentGraph` (filters).

## Data: the `interactions` event

A new collector event, sent on the main stream (no new channel, no control channel needed: the filters are applied in the renderer).

```
interactions: {
  since: number                      // epoch seconds, start of the 7 day window
  edges: [{ id, kind: 'kanban'|'message'|'room'|'delegate', from, to,
            count, firstTs, lastTs, label, status? }]
  rooms: [{ id, name, members: [profile], lastTs }]
  subagents: [{ id, parent, status: 'running'|'done', lastTs, title? }]
  sources: { kanban|message|room|delegate: { state: 'ok'|'absent'|'unreadable', unresolved: number } }
}
```

`from`, `to` and `parent` are profile names, room ids (`room:<name>`) or subagent ids (`sub:<profile>:<session>`). Caps: 300 edges, 40 subagents (newest), 40 rooms. Sent only when its digest changes (like `cron`); the first tick always sends.

### Sources (collector, `collect_interactions`)

| Kind | How it is found | Edge |
|---|---|---|
| `kanban` | `<home>/kanban.db` and `<home>/kanban/boards/*/kanban.db`. Tables and columns are found with `PRAGMA table_info`: a tasks table (id, title, assignee, status, creator) and `task_events` (id, task_id, ts). | creator -> assignee, label `#<id>`, one edge per task |
| `message` | `state.db` of the receiving profile, sessions titled "Bot Chat", messages starting `Message from <name> (@handle):`. The sender is matched to a profile by display name or handle. | sender -> receiver, one edge per pair, `count` = messages |
| `room` | Sessions titled `Group: <room> · <thread>` in each member's `state.db`. | member -> `room:<name>`; the room lists its members |
| `delegate` | Sessions with `source='subagent'` or a `parent_session_id`, mapped to the parent's profile. A session without `ended_at` and with activity in the last 5 minutes is `running`. | profile -> `sub:<profile>:<session>` |

A sender, creator or member that cannot be matched to a profile is left out and counted in `sources.<kind>.unresolved` (no `unknown` node). A missing file is `absent`; a database that cannot be opened or has no recognisable tables is `unreadable`. One failing source never stops the others.

### Incremental reads

`InteractionState` in the collector keeps, per profile, the last `messages.id` seen in message and room sessions, the last session scan time, and per kanban database the last `task_events.id`. The first tick builds the map from the last 7 days; later ticks read only newer rows and update `edges` (count, lastTs, status). The digest covers every edge's `lastTs`, `count` and `status`. A new collector process (after a reconnect) rebuilds from the 7 days, so the renderer needs no cursors and cannot see duplicates or gaps.

Tick interval: 2 s (own timer in the main loop, same loop as `agents` and `cron`).

### On-demand detail

`--query interaction <json>` with `{kind, id, from?, to?}` returns the latest message text or the task title with its last comment, the time, the source description (for example `herald/state.db . session "Bot Chat"`) and the session id when there is one. The same validation as other queries applies (`valid_profile`, `valid_int`, ids by regex). Text is capped like `cap_text`.

## Renderer

```
shared/events.ts           InteractionsData (zod), added to the event union
stores/interactions.ts     snapshot, sources, selection, kinds filter, range
lib/agentGraph.ts          pure: filterEdges, isActive, layout, describe, buildNodes
screens/dashboard/AgentGraph.tsx      SVG, pan/zoom, Fit
screens/dashboard/InteractionCard.tsx detail card (query on open)
screens/dashboard/GraphPanel.tsx      tabs; renders BrainPanel or AgentGraph
```

- **Tabs.** `GraphPanel` owns the tab bar (second brain | agents). `BrainPanel` loses its disabled tab and renders only its content. The chosen tab is `dashboard.graphTab` in settings (F-AGRAPH-1).
- **Nodes.** Agents on an outer circle in roster order (colour and status from the roster; no interactions in the window = dim). Rooms (squares) on an inner ring near their members. Subagents (small dashed circles) next to their parent. `layout` is deterministic, so nodes never jump when data arrives.
- **Edges.** Colours from the Dracula tokens: kanban orange, message pink, room purple, delegate cyan dashed. Arrowhead shows direction. The middle label (`#42`, `msg`) is a button.
- **Live.** An edge with `lastTs` within 60 s is active: a dot travels along it (`animateMotion`). Reduce motion and a hidden window pause the animation; data keeps arriving.
- **Filters (F-AGRAPH-6).** Kinds (four toggles) and range 1 h / 24 h / 7 d, saved in `dashboard.agentGraph`. `filterEdges` also drops rooms and subagents without edges in range.
- **Selection (F-AGRAPH-5).** Click an edge label or a node opens `InteractionCard` (kind, sender -> receiver, title or last message, time, source, **Open session** that opens the existing `SessionModal`). A node click highlights its edges and shows counts per kind. If the selected edge leaves the window, the card closes.
- **States.** Waiting for the first event: `FeedWaiting`-style skeleton, then an explanation. No interactions: `EmptyState` with the PRD limits and the status of each source. A source `unreadable` shows a small note in the bar, not a full error.

## Tests

- `collector` pytest with new fixtures in `tests/fixtures/make_fixture.py` (kanban.db in two column variants, "Bot Chat", `Group:` and subagent sessions): each source, unresolved senders, `absent`/`unreadable`, incremental ticks, digest-only emission, caps and window, `--query interaction` validation, ASCII output.
- Vitest: `filterEdges`, `isActive` (the 60 s edge), `layout` (deterministic, no overlap), `describe`, store, zod schema.
- Integration with `startFakeSsh` (real collector against the fixture): the event reaches the store; a reconnect rebuilds without duplicates.
- Playwright: open Dashboard, pick the agents tab, click an edge label, card shows, **Open session** opens the modal, the tab survives a restart. Contrast of secondary text >= 4.5:1.

## Docs

`docs/manual-vps-checklist.md` gets steps to verify the `kanban.db` schema, the "Bot Chat" format and `Group:` titles on a real Hermes (all marked unverified). `CLAUDE.md` gets an M4b paragraph and the "built" list is updated.

## Risks

| Risk | Handling |
|---|---|
| `kanban.db` schema differs from the guess | Tolerant column lookup; `unreadable` state; checklist step. |
| "Bot Chat" / `Group:` title or prefix format differs | Isolated in small matchers (`match_bot_message`, `match_group_title`) with tests; the graph is simply empty for that kind. |
| Reading 7 days on a big `state.db` at start | Only titled sessions and `subagent` sessions are read, with `LIMIT` and an index-friendly `WHERE`; the main loop is not blocked past one tick budget (the first build is capped per profile). |
