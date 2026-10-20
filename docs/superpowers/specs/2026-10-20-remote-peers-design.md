# Remote peers in the agent graph (F-AGRAPH-7, v2)

## Goal

Show the agents on **other machines** that the agents on this server talk to, in the **agents** tab of the Dashboard
graph (PRD F-AGRAPH-7: "Interaksi lintas mesin (A2A plugin, `hermes peer`)"). Read-only, like the rest of the graph.

## What Hermes leaves on the server (checked against the source at tag v2026.8.31)

- **`hermes peer`** (`hermes_cli/subcommands/peer.py`): bot-to-bot DMs across machines. `hermes peer dm|run
  <peer>[/<profile>] <message>` runs a turn in the remote agent's canonical **Bot Chat** session, with the Bot Mode
  prefix `Message from <name> (@<handle>): …`. An agent here calls it with its terminal tool, so the call is in its own
  `state.db` (`messages.tool_calls`). A remote agent that DMs an agent here lands in that agent's Bot Chat with the same
  prefix and a sender that is **no profile of this server** (today those lines only raise
  `sources.message.unresolved`).
- **A2A** (`plugins/platforms/a2a`): every exchange appends `{"ts", "direction": "inbound"|"outbound"|"push", "peer",
  "task_id", "summary"}` to `<profile home>/a2a_audit.jsonl`. `inbound` is a peer's task to this agent; the server's
  reply is an `outbound` with the same `task_id`; an `outbound` with no such `inbound` is this agent calling a peer
  (`a2a_call`).

## Decisions

- One new edge kind **`peer`** (colour `#F1FA8C`, filter label *remote*). Its other end is an **external node**
  `peer:<name>` (a `hermes peer` target such as `spark` or `spark/researcher`, a Bot Mode handle, or an A2A peer name).
- Edge labels tell the channel: `bot chat` (inbound DM), `peer dm` (outbound `hermes peer dm|run`), `a2a`.
- Bot Chat senders that match no profile become `peer` edges and no longer count as `message` unresolved.
- Read-only and small: the window and caps of the other kinds (7 days, 300 edges); at most 40 external nodes.

## Collector (`InteractionState`, `mc_collector.py`)

- `INTER_KINDS` gains `peer`; `sources.peer` is `ok` once a `state.db` or an `a2a_audit.jsonl` was read.
- Bot Chat: an unresolved sender `hit` becomes `_edge_add("peer", "peer:" + slug(handle or name), profile, ts,
  "bot chat")` (accumulated with the message cursor, like `message` edges; ids end in `:chat`).
- Outbound DMs, per profile, rebuilt each poll: `SELECT id, tool_calls, timestamp FROM messages WHERE tool_calls LIKE
  '%peer %' AND timestamp >= since ORDER BY id DESC LIMIT 500`; the regex
  `hermes(?:\s+-p\s+\S+)?\s+peer\s+(?:dm|run)\s+([a-z0-9][a-z0-9_-]{0,63}(?:/[A-Za-z0-9][A-Za-z0-9_-]{0,63})?)` on the
  text gives the target → edge `profile → peer:<target>` labelled `peer dm`, counted per call.
- A2A, per profile, rebuilt each poll: the last 256 KiB of `<profile home>/a2a_audit.jsonl`; only `ts`, `direction`,
  `peer` and `task_id` are used (the `summary` is not read here); `inbound` → `peer:<peer> → profile`, an `outbound`
  without an `inbound` of the same `task_id` → `profile → peer:<peer>`; label `a2a`.
- Peer names: at most 64 characters, control characters removed; `slug` lowercases a Bot Mode handle.
- `--query interaction` with `kind: "peer"` and `{from, to}` (one end `peer:<name>`, the other a profile) returns the
  newest text of that link: the Bot Chat line, the `hermes peer` command of the tool call, or the A2A `summary` (cut to
  the usual cap), with its time and source.

## Main and shared

- `InteractionKind` gains `peer`; `InteractionsData.sources.peer` (optional, so an older snapshot still parses);
  `InteractionArgs` accepts `{ kind: 'peer', from, to }` with `peer:` + `^[A-Za-z0-9._/@:-]{1,64}$` on the remote end.
- The `dashboard.agentGraph.kinds` setting accepts five kinds.

## Renderer

- `lib/agentGraph.ts`: `KINDS`, `KIND_COLOR`, `KIND_LABEL` gain `peer`; `buildGraph` adds a node kind `peer` for every
  `peer:` endpoint, placed on an outer ring just outside the agent it talks to most (several peers of one agent fan out),
  radius 13; `describeNode` counts `peer`.
- `AgentGraphSvg.tsx`: a peer node is a dashed diamond with its name and a small *remote* tag; edges as usual.
- `InteractionCard.tsx`: a peer edge or node shows the channel, the remote name and the text from the query; *Open
  session* only when the query names a session.

## Testing

- pytest (`test_interactions.py`): an unknown Bot Chat sender becomes a `peer` edge and is not unresolved; a
  `hermes peer dm spark/researcher` tool call makes an outbound edge; A2A inbound/reply pairs and a lone outbound;
  `summary` never in the snapshot; the interaction query for each channel.
- Vitest: `buildGraph` places peer nodes outside their agent; filters by kind.
- E2E (`agentGraph.spec.ts`): the fixture's remote DM shows a *remote* node; clicking its edge shows the text.
- Checklist: on a real VPS with `hermes peer` or A2A configured, the remote node appears.
