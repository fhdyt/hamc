# Chat through the Hermes TUI gateway

## Why

Measured on the user's VPS (6 agents, Hermes 0.21.0, 2 GB RAM), 13 Oct 2026: a trivial reply through the app took
12.2-13.0 s every time, against 7-13 s on Telegram. Every message started a new `hermes chat --oneshot` process
(about 4.75 s of agent start before any model call, 240 MB RSS), and `-Q` showed nothing until the turn ended.
`hermes acp` (persistent) was not used because `hermes acp --check` fails on installs without the optional `acp` extra
(`agent-client-protocol`), which stock installs often lack.

The agent on the VPS suggested `hermes serve` on a port. That breaks the Zero-Change rule (PRD §3.2: no server, no open
port, no `.env` edits), so the user chose the same backend without a port: Hermes's own TUI gateway over the SSH
channel's stdio, which is what the Ink TUI does.

## Protocol (verified against tag v2026.8.31 = 0.21.0)

- Launch: `env HERMES_HOME=<home> HERMES_TUI_SESSION_TTL_S=0 <hermes python> -P -m tui_gateway.entry` (one SSH exec,
  stdin kept open). `-P` keeps the login folder off `sys.path` (Hermes needs Python 3.11+). TTL 0 turns off the
  startup sweep that would end idle `tui`/`desktop`/`subagent` session rows of other front ends.
- Probe once per connection: `<python> -P -c "find_spec('tui_gateway.entry') and find_spec('hermes_bootstrap')"`.
- Framing: one JSON-RPC 2.0 message per line; logs go to stderr; the first frame is the event `gateway.ready`.
- `session.create {source: 'mission-control', profile?}` → `{session_id (runtime), stored_session_id (state.db), info:
  {profile_name}}`. One process serves every profile. Hermes silently falls back to the launch profile for an unknown
  one, so `info.profile_name` is checked and a mismatch refuses that agent (it falls back to ACP or the one-shot chat).
- `session.resume {session_id: <stored id>, profile?, omit_messages: true}`; error 4007 for an unknown id → a new
  session.
- `prompt.submit {session_id, text}` answers `{status: 'streaming'}` at once; the turn streams as
  `{method: 'event', params: {type, session_id, payload}}`: `message.delta {text}`, `tool.start {tool_id, name}`,
  `tool.complete {tool_id, name, duration_s, result}`, `approval.request {command, description, request_id, choices}`,
  `clarify.request {question, choices, request_id}`, `message.complete {text, status, usage}` (usage is the session's
  running total; the turn's tokens are the difference), `session.info {stored_session_id}` (the id rotates after a
  compression), `error {message}`.
- `session.interrupt {session_id}` (SIGINT is ignored by the gateway), `approval.respond {session_id, choice,
  request_id}` (`once|session|always|deny`), `clarify.respond {request_id, answer}`.
- stdin EOF: Hermes saves its sessions and exits.

## Behaviour

- Order per message: gateway (setting `chat.useGateway`, default on) → ACP (`chat.useAcp`) → one-shot. A failed probe or
  start turns the gateway off for the connection; a gateway that dies is started again, at most twice.
- The gateway starts on the first Send (an explicit action), never on connect, and ends with the connection (stdin
  closed, channel closed 2 s later).
- Approvals: every Hermes approval becomes the existing approval card; Cancel and a turn that ends or is stopped answer
  `deny`. The app never sets `HERMES_YOLO_MODE`, never calls `config.set`. Clarify questions with choices use the same
  card; free-text questions, `secret.request` and `sudo.request` show a notice (no secret goes through the app).
- Stop: `session.interrupt`; the turn ends when Hermes answers `message.complete` (interrupted), or after the grace
  period anyway. The process stays for the other agents.

## What it writes on the VPS

All of it is Hermes's own bookkeeping of a front end the user drives, as when they run `hermes` in a terminal: session
rows and messages (as with every chat), `gateway_heartbeats` rows in the home `state.db` while it runs (removed on
exit), `logs/tui_gateway_crash.log` lines on start and exit, `desktop/interrupted_turns.json` per prompt, and the 6-hourly
`.update_check` (a `git fetch` of the Hermes checkout). Nothing is installed, no port is opened, `.env` is never read
by the app.

## Tests

`tests/fixtures/fake_tui_gateway.py`, `startFakeSsh({ tuiGateway: true })` (`srv.hermes.gatewayLaunches`,
`gatewayCalls`), `tests/integration/gateway.test.ts`, `tests/unit/gateway.test.ts`. Manual: checklist steps 138-142.
