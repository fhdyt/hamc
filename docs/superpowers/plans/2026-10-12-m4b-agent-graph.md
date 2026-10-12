# M4b Agent Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the disabled "agents" tab of the Dashboard graph panel into a live graph of which agent interacts with which (kanban, message_agent, rooms, delegate_task).

**Architecture:** The main collector keeps an in-memory map of interactions (read-only, incremental) and emits an aggregated `interactions` snapshot when its digest changes. The renderer filters it (kinds, range), lays it out deterministically and draws it as SVG; the detail card asks `--query interaction`.

**Tech Stack:** Python stdlib collector, zod, zustand, React 19, SVG, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-m4b-agent-graph-design.md`

## Global Constraints

- Collector: stdlib only, ASCII only output, read-only (`open_ro`), never runs `hermes`, never writes.
- Every remote command is built with `buildCommand`/`queryCmd`; the renderer sends data, never paths or commands.
- UI strings are English. Reply to the user in Indonesian.
- Message and task text is untrusted: plain text only, in memory only.
- Settings saved: `dashboard.graphTab` and `dashboard.agentGraph` only.
- Windows dev host: use `python` (not `python3`); in Bash heredocs a double backslash collapses, so write files with the Write/Edit tools.
- Run the suites with `npm test`, `npm run test:py`, `npm run typecheck`.

## File Structure

| File | Responsibility |
|---|---|
| `collector/mc_collector.py` | `InteractionState`, matchers, `collect_interactions`, `q_interaction`, main-loop timer |
| `tests/fixtures/make_fixture.py` | `add_interactions(fx)` + `add-interactions` CLI command |
| `tests/collector/test_interactions.py` | collector tests |
| `src/shared/events.ts` | `InteractionsData`, `InteractionDetail`, event union entry |
| `src/shared/settings.ts` | `dashboard.graphTab`, `dashboard.agentGraph` |
| `src/shared/channels.ts`, `ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/session.ts`, `src/main/query.ts` | `interaction` query plumbing |
| `src/renderer/lib/agentGraph.ts` | pure: `filterEdges`, `isActive`, `buildGraph`, `layout`, `describeNode`, `KIND_COLOR` |
| `src/renderer/stores/interactions.ts` | snapshot, selection, filters |
| `src/renderer/bootstrap.ts` | route the event to the store |
| `src/renderer/screens/dashboard/GraphPanel.tsx` | tab bar, renders `BrainPanel` or `AgentGraph` |
| `src/renderer/screens/dashboard/AgentGraph.tsx` | SVG graph, pan/zoom, filters, states |
| `src/renderer/screens/dashboard/InteractionCard.tsx` | detail card |
| `src/renderer/styles/app.css` | `.ag-*` styles |
| `tests/unit/agentGraph.test.ts`, `interactionsStore.test.ts` | unit tests |
| `tests/integration/interactions.test.ts` | fake SSH integration |
| `tests/e2e/agentGraph.spec.ts` | Playwright |
| `docs/manual-vps-checklist.md`, `CLAUDE.md` | docs |

---

### Task 1: Collector: interaction sources

**Files:**
- Modify: `collector/mc_collector.py` (add after `collect_stats`, before `class QueryError`)
- Modify: `tests/fixtures/make_fixture.py`
- Create: `tests/collector/test_interactions.py`

**Interfaces:**
- Produces: `INTER_WINDOW_S = 7 * 86400`, `INTER_MAX_EDGES = 300`, `INTER_MAX_SUBS = 40`, `INTER_MAX_ROOMS = 40`, `match_bot_message(text) -> (name, handle) | None`, `match_group_title(title) -> (room, thread) | None`, `class InteractionState` with `poll(home, now) -> dict` returning the `interactions` payload (keys `since`, `edges`, `rooms`, `subagents`, `sources`) and `digest(data) -> str`, plus fixture helper `mf.add_interactions(fx)`.

Payload shape (all strings ASCII-safe through `json.dumps`):

```
edge: {id, kind, from, to, count, firstTs, lastTs, label, status}   # status: str|None
room: {id: "room:<name>", name, members: [profile], lastTs}
subagent: {id: "sub:<profile>:<session>", parent, status: "running"|"done", lastTs, title}
sources: {kanban|message|room|delegate: {state: "ok"|"absent"|"unreadable", unresolved: int}}
```

- [ ] **Step 1: Fixture helper.** In `tests/fixtures/make_fixture.py` add (after `add_message`):

```python
def add_kanban_db(path: Path, tasks, events=(), variant: str = "a") -> None:
    """tasks: (id, title, assignee, creator, status, created_at); events: (id, task_id, ts, kind, text)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    if variant == "a":
        con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, assignee TEXT, created_by TEXT, status TEXT, created_at REAL)")
    else:  # other column names a future Hermes might use
        con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, assignee_profile TEXT, creator TEXT, state TEXT, created REAL)")
    con.execute("CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id INTEGER, ts REAL, kind TEXT, body TEXT)")
    for t in tasks:
        con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?)", t)
    for e in events:
        con.execute("INSERT INTO task_events VALUES (?,?,?,?,?)", e)
    con.commit()
    con.close()


def add_interactions(fx: "Fixture") -> None:
    """Interactions between default, scout and atlas, on top of make_fixture (never part of its defaults)."""
    now, home = fx.now, fx.home
    atlas = home / "profiles" / "atlas"
    make_db(atlas / "state.db").close()
    w(atlas / "profile.yaml", 'display_name: "Atlas"\n')
    scout, sd = home / "profiles" / "scout", home / "profiles" / "scout" / "state.db"
    d = home / "state.db"
    # message_agent: atlas -> scout (twice), default -> scout (once, by handle)
    add_session(sd, "s-bot", "bot", now - 3000, title="Bot Chat")
    add_message(sd, "s-bot", "user", "Message from Atlas (@atlas): ping me when the digest is ready", now - 2000)
    add_message(sd, "s-bot", "user", "Message from Atlas (@atlas): still waiting", now - 100)
    add_message(sd, "s-bot", "user", "Message from nobody (@ghost): who am i", now - 90)
    # a group room: atlas, scout and default
    for pdir_db, sid in ((atlas / "state.db", "s-room-a"), (sd, "s-room-s"), (d, "s-room-d")):
        add_session(pdir_db, sid, "group", now - 5000, title="Group: ops-room · main")
    add_message(sd, "s-room-s", "assistant", "disk alert cleared", now - 40)
    add_message(d, "s-room-d", "user", "thanks", now - 4000)
    # delegate_task: scout already has s-scout-child (parent s-scout-1); atlas gets one running subagent
    add_session(atlas / "state.db", "s-atlas-1", "cli", now - 600)
    add_session(atlas / "state.db", "s-atlas-sub", "subagent", now - 30, parent="s-atlas-1", title="research")
    add_message(atlas / "state.db", "s-atlas-sub", "assistant", "reading", now - 20)
    # kanban: atlas -> scout #41 (done), scout -> default #42 (running)
    add_kanban_db(
        home / "kanban.db",
        tasks=[(41, "Find sources for the changelog", "scout", "atlas", "done", now - 7000),
               (42, "Draft the weekly digest", "default", "scout", "running", now - 500),
               (43, "Orphan task", "scout", "ghost", "todo", now - 400)],
        events=[(1, 41, now - 6000, "completed", "sources attached"), (2, 42, now - 60, "comment", "notes ready")],
    )
```

Add `"add-interactions"` to the CLI at the bottom of the file (`elif cmd == "add-interactions": add_interactions(load(Path(sys.argv[2])))`).

- [ ] **Step 2: Write the failing tests** in `tests/collector/test_interactions.py`:

```python
import json

import make_fixture as mf
import mc_collector as c


def poll(fx, state=None):
    st = state or c.InteractionState()
    return st, st.poll(str(fx.home), fx.now)


def edge(data, kind, frm, to):
    hits = [e for e in data["edges"] if e["kind"] == kind and e["from"] == frm and e["to"] == to]
    assert len(hits) == 1, (kind, frm, to, data["edges"])
    return hits[0]


def test_matchers():
    assert c.match_bot_message("Message from Atlas (@atlas): hi") == ("Atlas", "atlas")
    assert c.match_bot_message("hello") is None
    assert c.match_group_title("Group: ops-room · main") == ("ops-room", "main")
    assert c.match_group_title("Group: solo") == ("solo", "")
    assert c.match_group_title("Bot Chat") is None


def test_messages_become_one_edge_per_pair(fx):
    mf.add_interactions(fx)
    _, data = poll(fx)
    e = edge(data, "message", "atlas", "scout")
    assert e["count"] == 2 and e["label"] == "msg" and e["lastTs"] == fx.now - 100
    assert data["sources"]["message"] == {"state": "ok", "unresolved": 1}  # @ghost matches no profile


def test_room_members_and_edges(fx):
    mf.add_interactions(fx)
    _, data = poll(fx)
    room = [r for r in data["rooms"] if r["name"] == "ops-room"][0]
    assert room["id"] == "room:ops-room" and sorted(room["members"]) == ["atlas", "default", "scout"]
    assert room["lastTs"] == fx.now - 40
    assert edge(data, "room", "scout", "room:ops-room")["count"] >= 1


def test_delegate_subagents(fx):
    mf.add_interactions(fx)
    _, data = poll(fx)
    subs = {s["id"]: s for s in data["subagents"]}
    assert subs["sub:atlas:s-atlas-sub"]["parent"] == "atlas" and subs["sub:atlas:s-atlas-sub"]["status"] == "running"
    assert subs["sub:atlas:s-atlas-sub"]["title"] == "research"
    assert subs["sub:scout:s-scout-child"]["parent"] == "scout"
    assert edge(data, "delegate", "atlas", "sub:atlas:s-atlas-sub")["count"] == 1


def test_kanban_tasks_and_unresolved(fx):
    mf.add_interactions(fx)
    _, data = poll(fx)
    e = edge(data, "kanban", "atlas", "scout")
    assert e["label"] == "#41" and e["status"] == "done"
    assert edge(data, "kanban", "scout", "default")["label"] == "#42"
    assert data["sources"]["kanban"] == {"state": "ok", "unresolved": 1}  # task 43 was created by "ghost"


def test_kanban_other_column_names(fx):
    mf.add_interactions(fx)
    (fx.home / "kanban.db").unlink()
    mf.add_kanban_db(fx.home / "kanban.db", tasks=[(7, "T", "scout", "atlas", "done", fx.now - 10)], variant="b")
    _, data = poll(fx)
    assert edge(data, "kanban", "atlas", "scout")["label"] == "#7"


def test_missing_and_unreadable_sources(fx):
    _, data = poll(fx)
    assert data["sources"]["kanban"]["state"] == "absent"
    (fx.home / "kanban.db").write_text("not a database")
    _, data = poll(fx)
    assert data["sources"]["kanban"]["state"] == "unreadable"
    assert data["sources"]["delegate"]["state"] == "ok"  # the other sources still work


def test_window_and_caps(fx):
    mf.add_interactions(fx)
    sd = fx.home / "profiles" / "scout" / "state.db"
    mf.add_session(sd, "s-old", "bot", fx.now - 9 * 86400, title="Bot Chat")
    mf.add_message(sd, "s-old", "user", "Message from Atlas (@atlas): ancient", fx.now - 9 * 86400)
    _, data = poll(fx)
    assert edge(data, "message", "atlas", "scout")["count"] == 2  # the old message is outside 7 days
    assert data["since"] == fx.now - c.INTER_WINDOW_S
    for i in range(c.INTER_MAX_SUBS + 10):
        mf.add_session(sd, "x%d" % i, "subagent", fx.now - 100 - i, parent="s-scout-1")
    _, data = poll(fx)
    assert len([s for s in data["subagents"] if s["parent"] == "scout"]) <= c.INTER_MAX_SUBS


def test_incremental_ticks_and_digest(fx):
    mf.add_interactions(fx)
    st, first = poll(fx)
    d1 = st.digest(first)
    again = st.poll(str(fx.home), fx.now)
    assert st.digest(again) == d1
    sd = fx.home / "profiles" / "scout" / "state.db"
    mf.add_message(sd, "s-bot", "user", "Message from Atlas (@atlas): one more", fx.now - 5)
    later = st.poll(str(fx.home), fx.now)
    assert edge(later, "message", "atlas", "scout")["count"] == 3
    assert st.digest(later) != d1


def test_output_is_ascii_json(fx):
    mf.add_interactions(fx)
    _, data = poll(fx)
    json.dumps(data, ensure_ascii=True).encode("ascii")
```

- [ ] **Step 3: Run to verify failure.** `python -m pytest tests/collector/test_interactions.py -q` → FAIL (`InteractionState` not defined).

- [ ] **Step 4: Implement** in `collector/mc_collector.py`:

```python
# ---- interactions (agent graph) --------------------------------------------

INTER_WINDOW_S = 7 * 86400
INTER_MAX_EDGES = 300
INTER_MAX_SUBS = 40
INTER_MAX_ROOMS = 40
INTER_RUNNING_S = 300
INTER_SCAN_ROWS = 2000
BOT_RE = re.compile(r"^\s*Message from (.{1,80}?) \(@([A-Za-z0-9._-]{1,64})\):")
GROUP_RE = re.compile(r"^Group:\s*(.{1,80}?)(?:\s+[·|-]\s+(.{0,80}))?\s*$")
INTER_KINDS = ("kanban", "message", "room", "delegate")
TASK_COLS = {
    "id": ("id",), "title": ("title", "name", "summary"), "assignee": ("assignee", "assignee_profile", "assigned_to", "owner"),
    "creator": ("created_by", "creator", "author", "created_by_profile"), "status": ("status", "state"),
    "created": ("created_at", "created", "ts", "created_ts"),
}


def match_bot_message(text):
    m = BOT_RE.match(text or "")
    return (m.group(1).strip(), m.group(2)) if m else None


def match_group_title(title):
    m = GROUP_RE.match(title or "")
    if not m:
        return None
    return (m.group(1).strip(), (m.group(2) or "").strip())


def _pick_col(cols, names):
    for n in names:
        if n in cols:
            return n
    return None


class InteractionState:
    """Aggregates who talks to whom from state.db and kanban.db files, read-only, advancing cursors between polls."""

    def __init__(self):
        self.msg_cursor = {}   # (profile, session id) -> last message id seen
        self.edges = {}
        self.rooms = {}
        self.subs = {}
        self.sources = {}

    # -- helpers
    def _edge(self, kind, frm, to, ts, label, status=None, count=1):
        eid = "%s:%s>%s:%s" % (kind, frm, to, label if kind == "kanban" else "")
        e = self.edges.get(eid)
        if e is None:
            e = self.edges[eid] = {"id": eid, "kind": kind, "from": frm, "to": to, "count": 0, "firstTs": ts, "lastTs": ts, "label": label, "status": status}
        e["count"] += count
        e["firstTs"] = min(e["firstTs"], ts)
        e["lastTs"] = max(e["lastTs"], ts)
        if status is not None:
            e["status"] = status

    def _src(self, kind, state, unresolved=0):
        cur = self.sources.get(kind, {"state": "absent", "unresolved": 0})
        rank = {"absent": 0, "ok": 1, "unreadable": 2}
        if rank[state] >= rank[cur["state"]]:
            cur["state"] = state
        cur["unresolved"] += unresolved
        self.sources[kind] = cur

    def poll(self, home, now):
        since = now - INTER_WINDOW_S
        profiles = list_profiles(home)
        names = {}
        for name, pdir in profiles:
            for key in (name.lower(), display_name(pdir, name).lower()):
                names.setdefault(key, name)
        # rebuilt each time from small tables; the message cursor makes the scan of message rows incremental
        self.sources = {k: {"state": "absent", "unresolved": 0} for k in INTER_KINDS}
        unresolved = {k: 0 for k in INTER_KINDS}
        room_members, room_last, subs = {}, {}, {}
        for name, pdir in profiles:
            db = os.path.join(pdir, "state.db")
            if not os.path.isfile(db):
                continue
            con = None
            try:
                con = open_ro(db)
                scols = table_columns(con, "sessions")
                if "id" not in scols:
                    continue
                for k in ("message", "room", "delegate"):
                    self._src(k, "ok")
                has = lambda c: c in scols  # noqa: E731
                sel = ["id"] + [c for c in ("source", "parent_session_id", "title", "started_at", "ended_at") if has(c)]
                rows = con.execute("SELECT %s FROM sessions WHERE COALESCE(%s, 0) >= ? ORDER BY %s DESC LIMIT ?" % (
                    ", ".join(sel), "started_at" if has("started_at") else "0", "started_at" if has("started_at") else "id"), (since, INTER_SCAN_ROWS)).fetchall()
                mcols = table_columns(con, "messages")
                can_msg = {"id", "session_id", "role", "content", "timestamp"} <= mcols
                for r in rows:
                    s = dict(zip(sel, r))
                    sid, title, source = s["id"], _text(s.get("title")) or "", _text(s.get("source")) or ""
                    last_ts = None
                    if can_msg:
                        last = con.execute("SELECT MAX(timestamp) FROM messages WHERE session_id = ?", (sid,)).fetchone()
                        last_ts = to_epoch(last[0]) if last else None
                    started = to_epoch(s.get("started_at")) or 0.0
                    activity = last_ts if last_ts is not None else started
                    if source == "subagent" or (s.get("parent_session_id") and source != "mission-control"):
                        ended = s.get("ended_at")
                        running = ended is None and now - activity <= INTER_RUNNING_S
                        subs[("sub:%s:%s" % (name, sid))] = {"id": "sub:%s:%s" % (name, sid), "parent": name, "status": "running" if running else "done",
                                                              "lastTs": activity, "title": title[:80] or None}
                        continue
                    grp = match_group_title(title)
                    if grp is not None:
                        rid = "room:" + grp[0]
                        room_members.setdefault(rid, {"name": grp[0], "members": set()})["members"].add(name)
                        room_last[rid] = max(room_last.get(rid, 0.0), activity)
                        continue
                    if title == "Bot Chat" and can_msg:
                        cur_key = (name, sid)
                        after = self.msg_cursor.get(cur_key, 0)
                        msgs = con.execute(
                            "SELECT id, content, timestamp FROM messages WHERE session_id = ? AND role = 'user' AND id > ? AND timestamp >= ? ORDER BY id ASC LIMIT ?",
                            (sid, after, since, INTER_SCAN_ROWS)).fetchall()
                        for mid, content, ts in msgs:
                            self.msg_cursor[cur_key] = max(self.msg_cursor.get(cur_key, 0), mid)
                            hit = match_bot_message(as_text(content))
                            if hit is None:
                                continue
                            sender = names.get(hit[1].lower()) or names.get(hit[0].lower())
                            if sender is None or sender == name:
                                unresolved["message"] += 1
                                continue
                            self._edge("message", sender, name, to_epoch(ts) or 0.0, "msg")
            except sqlite3.Error:
                for k in ("message", "room", "delegate"):
                    self._src(k, "unreadable")
            finally:
                if con is not None:
                    con.close()
        self.rooms = {}
        for rid, info in room_members.items():
            self.rooms[rid] = {"id": rid, "name": info["name"], "members": sorted(info["members"]), "lastTs": room_last.get(rid, 0.0)}
            for m in info["members"]:
                self._edge_replace("room", m, rid, room_last.get(rid, 0.0))
        self.subs = {}
        ordered = sorted(subs.values(), key=lambda s: -s["lastTs"])[:INTER_MAX_SUBS]
        for s in ordered:
            self.subs[s["id"]] = s
            self._edge_replace("delegate", s["parent"], s["id"], s["lastTs"])
        self._kanban(home, names, since, unresolved)
        for k in INTER_KINDS:
            self.sources[k]["unresolved"] = unresolved[k]
        return self._payload(since)

    def _edge_replace(self, kind, frm, to, ts):
        eid = "%s:%s>%s:" % (kind, frm, to)
        self.edges[eid] = {"id": eid, "kind": kind, "from": frm, "to": to, "count": 1, "firstTs": ts, "lastTs": ts, "label": None, "status": None}

    def _kanban(self, home, names, since, unresolved):
        paths = [os.path.join(home, "kanban.db")] + sorted(glob.glob(os.path.join(home, "kanban", "boards", "*", "kanban.db")))
        for path in paths:
            if not os.path.isfile(path):
                continue
            con = None
            try:
                con = open_ro(path)
                tcols = table_columns(con, "tasks")
                col = {k: _pick_col(tcols, v) for k, v in TASK_COLS.items()}
                if not (col["id"] and col["assignee"] and col["creator"]):
                    self._src("kanban", "unreadable")
                    continue
                self._src("kanban", "ok")
                ecols = table_columns(con, "task_events")
                last_ev = {}
                if {"task_id", "ts"} <= ecols:
                    for tid, ts in con.execute("SELECT task_id, MAX(ts) FROM task_events GROUP BY task_id"):
                        last_ev[tid] = to_epoch(ts)
                sel = ", ".join("%s AS %s" % (col[k], k) if col[k] else "NULL AS %s" % k for k in TASK_COLS)
                for r in con.execute("SELECT %s FROM tasks ORDER BY %s DESC LIMIT 500" % (sel, col["id"])):
                    t = dict(zip(TASK_COLS, r))
                    created = to_epoch(t["created"]) or 0.0
                    ts = max(created, last_ev.get(t["id"]) or 0.0)
                    if ts < since:
                        continue
                    frm, to = names.get(str(t["creator"]).lower()), names.get(str(t["assignee"]).lower())
                    if frm is None or to is None or frm == to:
                        unresolved["kanban"] += 1
                        continue
                    eid = "kanban:%s>%s:#%s" % (frm, to, t["id"])
                    self.edges[eid] = {"id": eid, "kind": "kanban", "from": frm, "to": to, "count": 1, "firstTs": created, "lastTs": ts,
                                       "label": "#%s" % t["id"], "status": _text(t["status"], 40)}
            except sqlite3.Error:
                self._src("kanban", "unreadable")
            finally:
                if con is not None:
                    con.close()

    def _payload(self, since):
        edges = sorted(self.edges.values(), key=lambda e: -e["lastTs"])[:INTER_MAX_EDGES]
        keep = {e["id"] for e in edges}
        self.edges = {k: v for k, v in self.edges.items() if k in keep}
        rooms = sorted(self.rooms.values(), key=lambda r: -r["lastTs"])[:INTER_MAX_ROOMS]
        return {"since": since, "edges": edges, "rooms": rooms, "subagents": sorted(self.subs.values(), key=lambda s: -s["lastTs"]),
                "sources": {k: dict(v) for k, v in self.sources.items()}}

    @staticmethod
    def digest(data):
        core = [(e["id"], e["count"], e["lastTs"], e["status"]) for e in data["edges"]]
        core += [(r["id"], tuple(r["members"]), r["lastTs"]) for r in data["rooms"]]
        core += [(s["id"], s["status"], s["lastTs"]) for s in data["subagents"]]
        core += sorted((k, v["state"], v["unresolved"]) for k, v in data["sources"].items())
        return hashlib.sha1(json.dumps(core, sort_keys=True, default=str).encode("ascii", "replace")).hexdigest()
```

Notes for the implementer: `since` is passed to `poll` through `now`, so tests control time with `fx.now`. Edges for `message` accumulate across polls (cursor), edges for `room`/`delegate`/`kanban` are rebuilt each poll. If the `message` edges would be double counted after the window slides (rare), that is acceptable: the cursor only moves forward, and a reconnect rebuilds from scratch. In `_edge`, kanban ids contain the label so each task is one edge; for message the id has no label so pairs aggregate.

- [ ] **Step 5: Run tests.** `python -m pytest tests/collector/test_interactions.py -q` → PASS. Fix until green; the matcher regexes use a `·` escape, which is ASCII in source (keep the file ASCII: write it as `"·"` inside a normal string, not the literal character).

- [ ] **Step 6: Commit.**

```bash
git add collector/mc_collector.py tests/fixtures/make_fixture.py tests/collector/test_interactions.py
git commit -m "feat(m4b): collector reads kanban, message, room and delegate interactions"
```

---

### Task 2: Collector: emit loop and `--query interaction`

**Files:**
- Modify: `collector/mc_collector.py` (`q_interaction`, `run_query` table, `parse_args`, `main`)
- Modify: `tests/collector/test_interactions.py`, `tests/collector/test_cli.py` (only if its arg list is asserted)

**Interfaces:**
- Consumes: Task 1 `InteractionState`.
- Produces: event `{"type":"interactions", data}` on the main stream every `--interactions-interval` seconds (default 2.0) when the digest changed or on the first tick; query `interaction` with args `{kind, id, from, to}` returning `{text, truncated, fullLen, title, ts, source, sessionId, profile}` where `title`, `ts`, `sessionId`, `profile` may be `null`.

- [ ] **Step 1: Failing tests** (append):

```python
def test_query_interaction_message(fx):
    mf.add_interactions(fx)
    r = c.run_query(str(fx.home), "interaction", json.dumps({"kind": "message", "from": "atlas", "to": "scout"}))
    assert r["ok"] is True
    d = r["data"]
    assert d["text"].startswith("Message from Atlas") and "still waiting" in d["text"]
    assert d["sessionId"] == "s-bot" and d["profile"] == "scout" and "Bot Chat" in d["source"]


def test_query_interaction_kanban(fx):
    mf.add_interactions(fx)
    r = c.run_query(str(fx.home), "interaction", json.dumps({"kind": "kanban", "id": 42}))
    assert r["ok"] and r["data"]["title"] == "Draft the weekly digest" and "notes ready" in r["data"]["text"]
    assert "kanban.db" in r["data"]["source"]


def test_query_interaction_room_and_delegate(fx):
    mf.add_interactions(fx)
    r = c.run_query(str(fx.home), "interaction", json.dumps({"kind": "room", "id": "room:ops-room"}))
    assert r["ok"] and "disk alert cleared" in r["data"]["text"]
    r = c.run_query(str(fx.home), "interaction", json.dumps({"kind": "delegate", "id": "sub:atlas:s-atlas-sub"}))
    assert r["ok"] and r["data"]["sessionId"] == "s-atlas-sub" and r["data"]["profile"] == "atlas"


def test_query_interaction_errors(fx):
    mf.add_interactions(fx)
    run = lambda a: c.run_query(str(fx.home), "interaction", json.dumps(a))  # noqa: E731
    assert run({"kind": "nope"})["error"] == "bad_args"
    assert run({"kind": "message", "from": "../x", "to": "scout"})["error"] == "bad_args"
    assert run({"kind": "kanban", "id": "1; drop"})["error"] == "bad_args"
    assert run({"kind": "kanban", "id": 999})["error"] == "not_found"
    assert run({"kind": "delegate", "id": "sub:atlas:" + "x" * 300})["error"] == "bad_args"


def test_stream_emits_interactions_once_until_changed(fx):
    import subprocess, sys
    mf.add_interactions(fx)
    env = dict(os.environ, MC_PROC_ROOT=str(fx.proc), MC_SYS_ROOT=str(fx.sysfs))
    out = subprocess.run([sys.executable, str(SCRIPT), str(fx.home), "--ticks", "3", "--interval", "0.05", "--interactions-interval", "0.05"],
                         capture_output=True, text=True, env=env, timeout=30).stdout
    events = [json.loads(l) for l in out.splitlines() if l.strip()]
    inter = [e for e in events if e["type"] == "interactions"]
    assert len(inter) == 1 and inter[0]["data"]["edges"]
```

Add at top of the file `import os` and `from pathlib import Path`, `SCRIPT = Path(__file__).resolve().parents[2] / "collector" / "mc_collector.py"`.

- [ ] **Step 2: Run, expect FAIL** (`unknown_command`).

- [ ] **Step 3: Implement.** Add `q_interaction` after `q_session`:

```python
def _find_profile_db(home, name):
    pdir = profile_dir(home, name)
    db = os.path.join(pdir, "state.db") if pdir else None
    return db if db and os.path.isfile(db) else None


def _last_text(con, sid, like=None):
    sql = "SELECT content, timestamp FROM messages WHERE session_id = ? AND role IN ('user','assistant')"
    params = [sid]
    if like:
        sql += " AND content LIKE ?"
        params.append(like)
    row = con.execute(sql + " ORDER BY id DESC LIMIT 1", params).fetchone()
    return (as_text(row[0]), to_epoch(row[1])) if row else ("", None)


def q_interaction(home, a):
    kind = a.get("kind")
    if kind not in INTER_KINDS:
        raise QueryError("bad_args")
    base = {"title": None, "ts": None, "source": "", "sessionId": None, "profile": None}
    if kind == "message":
        frm, to = a.get("from"), a.get("to")
        if not valid_profile(frm) or not valid_profile(to):
            raise QueryError("bad_args")
        db = _find_profile_db(home, to)
        if db is None:
            raise QueryError("not_found")
        con = open_ro(db)
        try:
            handle_names = {frm.lower(), display_name(profile_dir(home, frm) or "", frm).lower()}
            row = con.execute("SELECT id FROM sessions WHERE title = 'Bot Chat' ORDER BY started_at DESC").fetchall()
            best = None
            for (sid,) in row:
                for mid, content, ts in con.execute("SELECT id, content, timestamp FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 200", (sid,)):
                    hit = match_bot_message(as_text(content))
                    if hit and (hit[1].lower() in handle_names or hit[0].lower() in handle_names):
                        if best is None or mid > best[0]:
                            best = (mid, as_text(content), ts, sid)
                        break
            if best is None:
                raise QueryError("not_found")
        finally:
            con.close()
        out = cap_text(best[1])
        out.update(base, ts=to_epoch(best[2]), source="%s/state.db - session \"Bot Chat\"" % to, sessionId=best[3], profile=to)
        return out
    ident = a.get("id")
    if kind == "kanban":
        if not valid_int(ident):
            raise QueryError("bad_args")
        paths = [os.path.join(home, "kanban.db")] + sorted(glob.glob(os.path.join(home, "kanban", "boards", "*", "kanban.db")))
        for path in paths:
            if not os.path.isfile(path):
                continue
            con = open_ro(path)
            try:
                tcols = table_columns(con, "tasks")
                tcol = _pick_col(tcols, TASK_COLS["title"])
                icol = _pick_col(tcols, TASK_COLS["id"])
                if not icol:
                    continue
                row = con.execute("SELECT %s FROM tasks WHERE %s = ?" % (tcol or "NULL", icol), (ident,)).fetchone()
                if row is None:
                    continue
                text, ts = "", None
                ecols = table_columns(con, "task_events")
                bcol = _pick_col(ecols, ("body", "text", "comment", "message", "kind"))
                if {"task_id", "ts"} <= ecols and bcol:
                    ev = con.execute("SELECT %s, ts FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1" % bcol, (ident,)).fetchone()
                    if ev:
                        text, ts = as_text(ev[0]), to_epoch(ev[1])
            finally:
                con.close()
            out = cap_text(text)
            out.update(base, title=_text(row[0], 200), ts=ts, source="%s - task #%d" % (os.path.relpath(path, home).replace(os.sep, "/"), ident))
            return out
        raise QueryError("not_found")
    if not isinstance(ident, str) or not ID_RE.match(ident):
        raise QueryError("bad_args")
    if kind == "delegate":
        parts = ident.split(":", 2)
        if len(parts) != 3 or parts[0] != "sub" or not valid_profile(parts[1]) or not ID_RE.match(parts[2]):
            raise QueryError("bad_args")
        con = open_profile(home, parts[1])
        try:
            row = con.execute("SELECT title FROM sessions WHERE id = ?", (parts[2],)).fetchone()
            if row is None:
                raise QueryError("not_found")
            text, ts = _last_text(con, parts[2])
        finally:
            con.close()
        out = cap_text(text)
        out.update(base, title=_text(row[0], 200), ts=ts, source="%s/state.db - source=subagent" % parts[1], sessionId=parts[2], profile=parts[1])
        return out
    # room
    if not ident.startswith("room:"):
        raise QueryError("bad_args")
    room = ident[5:]
    best = None
    for name, pdir in list_profiles(home):
        db = os.path.join(pdir, "state.db")
        if not os.path.isfile(db):
            continue
        con = open_ro(db)
        try:
            for sid, title in con.execute("SELECT id, title FROM sessions WHERE title LIKE 'Group:%' LIMIT 200"):
                grp = match_group_title(title or "")
                if not grp or grp[0] != room:
                    continue
                text, ts = _last_text(con, sid)
                if text and (best is None or (ts or 0) > (best[1] or 0)):
                    best = (text, ts, name, sid, title)
        finally:
            con.close()
    if best is None:
        raise QueryError("not_found")
    out = cap_text(best[0])
    out.update(base, title=room, ts=best[1], source="%s/state.db - session \"%s\"" % (best[2], best[4]), sessionId=best[3], profile=best[2])
    return out
```

Register in `run_query`: `"interaction": q_interaction`. In `parse_args` defaults add `"inter_interval": 2.0` and option `elif a == "--interactions-interval": args["inter_interval"] = float(next(it))`. In `main` before the `while True:` add `inter = InteractionState(); next_inter = clock(); last_inter = None`, and inside the loop, after the `agents` block:

```python
        if now >= next_inter:
            try:
                data = inter.poll(args["home"], time.time())
                digest = inter.digest(data)
                if digest != last_inter:
                    emit("interactions", data)
                    last_inter = digest
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "interactions_failed", "message": type(ex).__name__})
            next_inter = clock() + args["inter_interval"]
```

and include `next_inter` in the final `time.sleep(max(0.0, min(next_metrics, next_agents, next_inter) - clock()))`.

- [ ] **Step 4: Run** `python -m pytest tests/collector -q` → all PASS (existing tests must stay green; if an existing stream test asserts the exact set of event types, allow `interactions`).

- [ ] **Step 5: Commit** `git commit -am "feat(m4b): interactions event and --query interaction"` (add new test file changes too).

---

### Task 3: Shared contract, main plumbing and settings

**Files:**
- Modify: `src/shared/events.ts`, `src/shared/settings.ts`, `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/session.ts`, `src/main/query.ts`
- Test: `tests/unit/interactionsSchema.test.ts`

**Interfaces:**
- Produces: `InteractionKind`, `InteractionEdge`, `InteractionRoom`, `InteractionSub`, `InteractionsData`, `InteractionDetail` (zod + types) in `shared/events.ts`; `window.mc.interactions.detail(args: InteractionDetailArgs): Promise<QueryResult<InteractionDetail>>`; settings `'dashboard.graphTab': 'brain' | 'agents'`, `'dashboard.agentGraph': { kinds: InteractionKind[]; range: '1h' | '24h' | '7d' }`.

- [ ] **Step 1: Failing test** `tests/unit/interactionsSchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CollectorEvent, InteractionDetail, parseEventLine } from '../../src/shared/events'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '../../src/shared/settings'

const data = {
  since: 1,
  edges: [{ id: 'message:a>b:', kind: 'message', from: 'a', to: 'b', count: 2, firstTs: 1, lastTs: 2, label: 'msg', status: null }],
  rooms: [{ id: 'room:ops', name: 'ops', members: ['a'], lastTs: 2 }],
  subagents: [{ id: 'sub:a:s1', parent: 'a', status: 'running', lastTs: 2, title: null }],
  sources: { kanban: { state: 'absent', unresolved: 0 }, message: { state: 'ok', unresolved: 1 }, room: { state: 'ok', unresolved: 0 }, delegate: { state: 'ok', unresolved: 0 } }
}

describe('interactions contract', () => {
  it('parses an interactions event line', () => {
    const r = parseEventLine(JSON.stringify({ type: 'interactions', ts: 1, profile: null, data }))
    expect(r.ok).toBe(true)
    expect(CollectorEvent.safeParse({ type: 'interactions', ts: 1, profile: null, data: { ...data, edges: [{ ...data.edges[0], kind: 'bogus' }] } }).success).toBe(false)
  })
  it('parses a detail', () => {
    expect(InteractionDetail.safeParse({ text: 'x', truncated: false, fullLen: 1, title: null, ts: null, source: 's', sessionId: null, profile: null }).success).toBe(true)
  })
  it('has defaults for the saved graph settings', () => {
    expect(SETTINGS_DEFAULTS['dashboard.graphTab']).toBe('brain')
    expect(SETTINGS_SCHEMA['dashboard.agentGraph'].safeParse(SETTINGS_DEFAULTS['dashboard.agentGraph']).success).toBe(true)
    expect(SETTINGS_SCHEMA['dashboard.agentGraph'].safeParse({ kinds: ['x'], range: '1h' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run** `npm test -- tests/unit/interactionsSchema.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

`shared/events.ts` (before `const envelope`):

```ts
export const InteractionKind = z.enum(['kanban', 'message', 'room', 'delegate'])
export type InteractionKind = z.infer<typeof InteractionKind>
export const InteractionEdge = z.object({
  id: z.string(),
  kind: InteractionKind,
  from: z.string(),
  to: z.string(),
  count: z.number().int().nonnegative(),
  firstTs: z.number(),
  lastTs: z.number(),
  label: z.string().nullable(),
  status: z.string().nullable()
})
export type InteractionEdge = z.infer<typeof InteractionEdge>
export const InteractionRoom = z.object({ id: z.string(), name: z.string(), members: z.array(z.string()), lastTs: z.number() })
export type InteractionRoom = z.infer<typeof InteractionRoom>
export const InteractionSub = z.object({ id: z.string(), parent: z.string(), status: z.enum(['running', 'done']), lastTs: z.number(), title: z.string().nullable() })
export type InteractionSub = z.infer<typeof InteractionSub>
export const InteractionSource = z.object({ state: z.enum(['ok', 'absent', 'unreadable']), unresolved: z.number().int().nonnegative() })
export const InteractionsData = z.object({
  since: z.number(),
  edges: z.array(InteractionEdge),
  rooms: z.array(InteractionRoom),
  subagents: z.array(InteractionSub),
  sources: z.object({ kanban: InteractionSource, message: InteractionSource, room: InteractionSource, delegate: InteractionSource })
})
export type InteractionsData = z.infer<typeof InteractionsData>
export const InteractionDetail = z.object({
  text: z.string(),
  truncated: z.boolean(),
  fullLen: z.number().int().nonnegative(),
  title: z.string().nullable(),
  ts: z.number().nullable(),
  source: z.string(),
  sessionId: z.string().nullable(),
  profile: z.string().nullable()
})
export type InteractionDetail = z.infer<typeof InteractionDetail>
```

and add `z.object({ type: z.literal('interactions'), ...envelope, data: InteractionsData }),` to `CollectorEvent`.

`shared/settings.ts`: add to `SettingsMap` `'dashboard.graphTab': 'brain' | 'agents'` and `'dashboard.agentGraph': { kinds: InteractionKind[]; range: '1h' | '24h' | '7d' }` (import the type from `./events`), defaults `'brain'` and `{ kinds: ['kanban','message','room','delegate'], range: '24h' }`, schema `z.enum(['brain','agents'])` and `z.object({ kinds: z.array(InteractionKind).max(4), range: z.enum(['1h','24h','7d']) })` (import `InteractionKind` value).

`shared/channels.ts`: `interactionDetail: 'mc:interactions:detail',`.

`shared/ipc.ts`: export `InteractionDetailArgs = { kind: InteractionKind; id?: string | number; from?: string; to?: string }`, import `InteractionDetail` type, and in `MissionApi` add `interactions: { detail(args: InteractionDetailArgs): Promise<QueryResult<InteractionDetail>> }`.

`preload/index.ts`: `interactions: { detail: (args) => ipcRenderer.invoke(IPC.interactionDetail, args) },`.

`main/query.ts`: add `'interaction'` to `QueryCommand`.

`main/session.ts`: import `InteractionDetail`; add

```ts
  interactionDetail(args: object): Promise<QueryResult<InteractionDetail>> {
    return this.queries.run('interaction', args, InteractionDetail)
  }
```

`main/ipc.ts`:

```ts
const InteractionArgs = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), from: ProfileName, to: ProfileName }),
  z.object({ kind: z.literal('kanban'), id: z.number().int().min(0) }),
  z.object({ kind: z.literal('room'), id: z.string().regex(/^room:[^\u0000]{1,80}$/) }),
  z.object({ kind: z.literal('delegate'), id: z.string().regex(/^sub:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9._:-]{1,128}$/) })
])
...
  handle(IPC.interactionDetail, (a) => d.session.interactionDetail(InteractionArgs.parse(a)))
```

Note: the collector's `ID_RE` does not allow spaces or non-ASCII in room ids. Room names can contain spaces; relax: in the collector's room branch, validate `ident` with `re.compile(r"^room:[^\x00]{1,80}$")` instead of `ID_RE` (do this in Task 2's `q_interaction`: move the `ID_RE` check into the `delegate` branch and use `ROOM_ID_RE` for rooms). Add `ROOM_ID_RE` constant in Task 2 accordingly; a test `run({"kind":"room","id":"room:ops room"})` must not be `bad_args`.

- [ ] **Step 4: Run** `npm test -- tests/unit/interactionsSchema.test.ts && npm run typecheck` → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(m4b): interactions contract, query plumbing and settings"`.

---

### Task 4: Renderer logic: `lib/agentGraph.ts` and the store

**Files:**
- Create: `src/renderer/lib/agentGraph.ts`, `src/renderer/stores/interactions.ts`
- Modify: `src/renderer/bootstrap.ts`
- Test: `tests/unit/agentGraph.test.ts`, `tests/unit/interactionsStore.test.ts`

**Interfaces:**
- Produces (lib):
  - `KIND_COLOR: Record<InteractionKind, string>` = kanban `#FFB86C`, message `#FF79C6`, room `#BD93F9`, delegate `#8BE9FD`.
  - `RANGE_S: Record<'1h'|'24h'|'7d', number>`.
  - `ACTIVE_S = 60`; `isActive(lastTs: number, now: number): boolean` (now - lastTs <= 60).
  - `filterData(data: InteractionsData, kinds: InteractionKind[], range: Range, now: number): InteractionsData` (drops edges outside kinds or older than range, then rooms and subagents that have no edge left).
  - `type GNode = { id: string; kind: 'agent' | 'room' | 'sub'; label: string; sub?: string; x: number; y: number; r: number; dim: boolean; parent?: string; running?: boolean }`
  - `buildGraph(agents: { profile: string; displayName: string; status: string }[], data: InteractionsData): { nodes: GNode[]; edges: (InteractionEdge & { active: boolean })[] }` with deterministic positions in a 760 x 600 box: agents on a circle (center 380,300, radius 230) in the given order (start at the top); rooms on an inner circle radius 90 at the angle of the mean of their members; subagents at 70 from the parent, pushed outward from the center, angle offset by index.
  - `describeNode(id: string, edges: InteractionEdge[]): { kanban: number; message: number; room: number; delegate: number }` counting edges that touch `id`.
- Produces (store): `useInteractions` with `data: InteractionsData | null`, `receivedAt`, `selected: { type: 'edge' | 'node'; id: string } | null`, `apply(data)`, `select(sel)`, `reset()`. When `apply` removes the selected edge/node, selection is cleared.

- [ ] **Step 1: Failing tests** `tests/unit/agentGraph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { InteractionsData } from '../../src/shared/events'
import { ACTIVE_S, buildGraph, describeNode, filterData, isActive } from '../../src/renderer/lib/agentGraph'

const src = { state: 'ok', unresolved: 0 } as const
const sources = { kanban: src, message: src, room: src, delegate: src }
const NOW = 1_000_000
const data: InteractionsData = {
  since: NOW - 7 * 86400,
  edges: [
    { id: 'm', kind: 'message', from: 'a', to: 'b', count: 2, firstTs: NOW - 5000, lastTs: NOW - 30, label: 'msg', status: null },
    { id: 'k', kind: 'kanban', from: 'b', to: 'c', count: 1, firstTs: NOW - 90000, lastTs: NOW - 90000, label: '#4', status: 'done' },
    { id: 'r', kind: 'room', from: 'a', to: 'room:ops', count: 1, firstTs: 0, lastTs: NOW - 200000, label: null, status: null },
    { id: 'd', kind: 'delegate', from: 'a', to: 'sub:a:s1', count: 1, firstTs: 0, lastTs: NOW - 10, label: null, status: null }
  ],
  rooms: [{ id: 'room:ops', name: 'ops', members: ['a'], lastTs: NOW - 200000 }],
  subagents: [{ id: 'sub:a:s1', parent: 'a', status: 'running', lastTs: NOW - 10, title: 'research' }],
  sources
}
const agents = ['a', 'b', 'c', 'z'].map((p) => ({ profile: p, displayName: p.toUpperCase(), status: 'idle' }))

describe('agentGraph', () => {
  it('marks an edge active within 60 seconds, not after', () => {
    expect(ACTIVE_S).toBe(60)
    expect(isActive(NOW - 60, NOW)).toBe(true)
    expect(isActive(NOW - 61, NOW)).toBe(false)
  })

  it('filters by kinds and range and drops orphaned rooms and subagents', () => {
    const f = filterData(data, ['message', 'kanban', 'room'], '24h', NOW)
    expect(f.edges.map((e) => e.id)).toEqual(['m'])
    expect(f.rooms).toEqual([])
    expect(f.subagents).toEqual([])
    expect(filterData(data, ['kanban', 'message', 'room', 'delegate'], '7d', NOW).edges).toHaveLength(4)
    expect(filterData(data, ['message', 'kanban', 'room', 'delegate'], '1h', NOW).edges.map((e) => e.id)).toEqual(['m', 'd'])
  })

  it('builds a deterministic layout: agents, one room, one subagent, quiet agents dim', () => {
    const g1 = buildGraph(agents, filterData(data, ['kanban', 'message', 'room', 'delegate'], '7d', NOW), NOW)
    const g2 = buildGraph(agents, filterData(data, ['kanban', 'message', 'room', 'delegate'], '7d', NOW), NOW)
    expect(g1).toEqual(g2)
    expect(g1.nodes.filter((n) => n.kind === 'agent')).toHaveLength(4)
    expect(g1.nodes.find((n) => n.id === 'z')!.dim).toBe(true)
    expect(g1.nodes.find((n) => n.id === 'a')!.dim).toBe(false)
    const sub = g1.nodes.find((n) => n.id === 'sub:a:s1')!
    expect(sub.running).toBe(true)
    expect(g1.edges.find((e) => e.id === 'm')!.active).toBe(true)
    expect(g1.edges.find((e) => e.id === 'k')!.active).toBe(false)
  })

  it('keeps nodes apart', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ profile: `p${i}`, displayName: `P${i}`, status: 'idle' }))
    const g = buildGraph(many, { ...data, edges: [], rooms: [], subagents: [] }, NOW)
    for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i]!, b = g.nodes[j]!
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan((a.r + b.r) * 0.9)
    }
  })

  it('counts a node by kind', () => {
    expect(describeNode('a', data.edges)).toEqual({ kanban: 0, message: 1, room: 1, delegate: 1 })
  })
})
```

`tests/unit/interactionsStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useInteractions } from '../../src/renderer/stores/interactions'

const src = { state: 'ok', unresolved: 0 } as const
const mk = (ids: string[]) => ({
  since: 0,
  edges: ids.map((id) => ({ id, kind: 'message' as const, from: 'a', to: 'b', count: 1, firstTs: 1, lastTs: 2, label: 'msg', status: null })),
  rooms: [],
  subagents: [],
  sources: { kanban: src, message: src, room: src, delegate: src }
})
beforeEach(() => useInteractions.getState().reset())

describe('useInteractions', () => {
  it('starts empty and stores a snapshot', () => {
    expect(useInteractions.getState().data).toBeNull()
    useInteractions.getState().apply(mk(['e1']))
    expect(useInteractions.getState().data?.edges).toHaveLength(1)
    expect(useInteractions.getState().receivedAt).not.toBeNull()
  })
  it('clears the selection when the selected edge disappears', () => {
    const s = useInteractions.getState()
    s.apply(mk(['e1', 'e2']))
    s.select({ type: 'edge', id: 'e2' })
    s.apply(mk(['e1']))
    expect(useInteractions.getState().selected).toBeNull()
    s.select({ type: 'edge', id: 'e1' })
    s.apply(mk(['e1']))
    expect(useInteractions.getState().selected).toEqual({ type: 'edge', id: 'e1' })
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (modules missing).

- [ ] **Step 3: Implement** `lib/agentGraph.ts` (use the signatures above; angle for agent i of n: `-PI/2 + 2*PI*i/n`; agent radius `r = n > 20 ? 18 : 26`; room `r = 20`; sub `r = 11`; room angle = mean of member agent angles via `atan2(sum sin, sum cos)`, falling back to `-PI/2` when it has no member among the shown agents, inner radius 90 plus 28 per room that landed within 0.4 rad of an earlier one; sub position = parent position moved 70 + 26*k outward from the center (k = index among that parent's subagents) at an angle offset `((k % 5) - 2) * 0.35` from the parent's radial angle; `dim` for an agent = no edge in the filtered data touches it. Edges: map each filtered edge to `{...e, active: isActive(e.lastTs, now)}` and keep only those whose both ends exist in `nodes`). In `buildGraph` the agents list is the roster; an edge endpoint that is a profile missing from the roster is dropped (it is not drawn).
  `stores/interactions.ts` with zustand: `apply` sets `{ data, receivedAt: Date.now() }` and clears `selected` if its id is not among `edges`, `rooms` or `subagents` ids or agent profiles referenced by edges. In `bootstrap.ts` add `else if (ev.type === 'interactions') useInteractions.getState().apply(ev.data)` (import the store), and reset the store wherever `useFeed`/`useBrain` are reset on disconnect (search `reset()` calls in `src/renderer/actions.ts` and mirror them).

- [ ] **Step 4: Run** `npm test -- tests/unit/agentGraph.test.ts tests/unit/interactionsStore.test.ts` → PASS; then `npm run typecheck`.

- [ ] **Step 5: Commit** `git commit -am "feat(m4b): graph model, layout and interactions store"`.

---

### Task 5: Renderer UI: panel tabs, SVG graph and detail card

**Files:**
- Create: `src/renderer/screens/dashboard/GraphPanel.tsx`, `AgentGraph.tsx`, `InteractionCard.tsx`
- Modify: `src/renderer/screens/dashboard/BrainPanel.tsx` (remove tab bar, accept `bar` slot), `src/renderer/screens/Dashboard.tsx` (use `GraphPanel`), `src/renderer/styles/app.css`
- Test: `tests/unit/agentGraphView.test.tsx` only if the repo already has component tests (check `tests/unit` for `*.test.tsx`; if none, cover with the E2E in Task 7 and the pure-function tests above).

**Interfaces:**
- Consumes: Task 3 `window.mc.interactions.detail`, settings keys; Task 4 lib and store; existing `useFeed.getState().openSession(profile, sessionId)`, `useAgents`, `useUi` (`settings`, `saveSetting` from `../actions`), `Icon`, `EmptyState`, `Skeleton`, `FeedWaiting`.
- Produces: `<GraphPanel />` default Dashboard graph panel; `BrainPanel` takes a prop `tabs: ReactNode` rendered in the bar.

- [ ] **Step 1: `GraphPanel.tsx`**

```tsx
import { Icon } from '../../components/Icon'
import { saveSetting } from '../../actions'
import { useUi } from '../../stores/ui'
import { AgentGraph } from './AgentGraph'
import { BrainPanel } from './BrainPanel'

/** The graph panel of the Dashboard: a tab bar over the vault graph and the agent interaction graph. */
export function GraphPanel() {
  const tab = useUi((s) => s.settings['dashboard.graphTab'])
  const pick = (t: 'brain' | 'agents') => void saveSetting('dashboard.graphTab', t)
  const tabs = (
    <div role="tablist" aria-label="Graph" className="d-gtabs">
      <button type="button" role="tab" aria-selected={tab === 'brain'} className="d-gtab" onClick={() => pick('brain')}>
        <Icon name="share" size={12} /> second brain
      </button>
      <button type="button" role="tab" aria-selected={tab === 'agents'} className="d-gtab" onClick={() => pick('agents')}>
        <Icon name="users" size={12} /> agents
      </button>
    </div>
  )
  return tab === 'agents' ? <AgentGraph tabs={tabs} /> : <BrainPanel tabs={tabs} />
}
```

In `BrainPanel.tsx` change the signature to `BrainPanel({ tabs }: { tabs: ReactNode })`, delete the inline `<div role="tablist" ...>` block and render `{tabs}` in its place (import `ReactNode` from 'react'; `Icon` stays imported for the other buttons). In `Dashboard.tsx` replace the `BrainPanel` import and use with `GraphPanel`.

- [ ] **Step 2: `AgentGraph.tsx`.** A `<section className="d-graph ag" aria-label="Agent interactions">` that contains: the `tabs` slot in `.d-graph-bar`, four kind toggle buttons (`aria-pressed`, colored dot from `KIND_COLOR`), a range `<select>` (1 h, 24 h, 7 d), and the action buttons (Fit, Open full view not needed here). Body logic:
  - `data === null` → `connected ? <FeedWaiting ...> : <EmptyState title="No data yet" why="Connect to your server to see how agents work together." />` (read `FeedWaiting.tsx` for its props and use it the same way as `ActivityPanel`).
  - `graph.edges.length === 0` → `EmptyState` titled "No interactions yet" with `why` "Agents appear connected here when they hand tasks over on the kanban board, message each other, share a group room or delegate to subagents." and a `<ul>` of the four sources showing `state` (`ok`/`absent`/`unreadable`) and, when `unresolved > 0`, "N unresolved".
  - else an `<svg viewBox="0 0 760 600" role="img" aria-label=...>` inside a `<g transform={`translate(${tx} ${ty}) scale(${k})`}>`; wheel zooms (clamp 0.4–3) and pointer drag pans (pointer capture on the svg background); `Fit` resets to `(0,0,1)`.
  - Edges: `<line>`/`<path>` with `stroke=KIND_COLOR[kind]`, `strokeDasharray` `"5 4"` for delegate, opacity 0.35 when something is selected and the edge is not part of it, `markerEnd` arrowhead (one `<marker>` per kind). Active edges render `<circle r="3"><animateMotion dur="2.4s" repeatCount="indefinite" path={d}/></circle>` unless `useUi` setting `ui.reduceMotion` is true or `document.hidden`.
  - Edge labels (`#42`, `msg`, hidden for room and delegate): a `<g role="button" tabIndex={0} aria-label="{kind}, {from} to {to}">` with a rounded rect and text at the edge midpoint; click/Enter/Space → `select({type:'edge',id})`.
  - Nodes: agents as circles with the agent colour (`agentColor(profile)`) with initials (`initials(displayName)`), opacity 0.45 when dim, white ring when selected; rooms as rounded squares; subagents as small dashed circles (dashed stroke, fill transparent; solid fill when `running`). Each node is `role="button" tabIndex={0}` with the label below. Click → `select({type:'node',id})`.
  - Selected edge or node → `<InteractionCard />` docked at the bottom of the panel (absolute, `.ag-card`).
  - Bar note when some `sources[k].state === 'unreadable'`: `<span className="d-graph-meta">kanban unreadable</span>` per source.
  - Filters persist: `saveSetting('dashboard.agentGraph', {...})`.
  - `now` comes from a `useNow(1000)` tick (a local `useEffect` interval that sets `Date.now()` each second) so that "active" fades without new data.
  Keep the file under ~300 lines by moving the SVG drawing into small inner components (`EdgeView`, `NodeView`) in the same file or a sibling `agentGraphParts.tsx`.

- [ ] **Step 3: `InteractionCard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { InteractionDetail } from '@shared/events'
import { KIND_COLOR, type GNode } from '../../lib/agentGraph'
import { clockWithDay } from '../../lib/feed'
import { useFeed } from '../../stores/feed'
import { useInteractions } from '../../stores/interactions'
```

Props: `{ edge?: InteractionEdge & {active: boolean}; node?: GNode; counts?: ReturnType<typeof describeNode>; names: Record<string, string>; onClose(): void }`. For an **edge** selection it calls `window.mc.interactions.detail(args)` in an effect (args by kind: message → `{kind, from, to}`, kanban → `{kind, id: Number(label.slice(1))}`, room/delegate → `{kind, id: edge.to}`), shows loading, an error line (`not_found` → "The source of this interaction is no longer on the server."), or the card: title line `kind · from → to`, then `detail.title ?? ''`, the text as `<p className="ag-text">` (plain text, `white-space: pre-wrap`, max-height with scroll), meta line `clockWithDay(ts)` and `detail.source`, and, when `detail.sessionId && detail.profile`, a button **Open session** calling `useFeed.getState().openSession(detail.profile, detail.sessionId)`. For a **node** selection: agent → title name + status, line "kanban N · messages N · rooms N · subagents N" from `counts`; room → members list; sub → parent and title (detail query `{kind:'delegate', id: node.id}` for the text and Open session). A close button (`aria-label="Close details"`) and Esc call `onClose`. Use `let live = true` cleanup like `SessionModal`.

- [ ] **Step 4: CSS** in `app.css` (after the `.d-graph-meta` line): `.ag svg {position:absolute; inset:0; width:100%; height:100%; touch-action:none; cursor:grab}`, `.ag-kinds {display:flex; gap:4px}`, `.ag-kind {display:flex; align-items:center; gap:5px; min-height:24px; padding:0 8px; border:1px solid #44475a; border-radius:6px; background:#282a36; color:#a9b2d3; font:inherit; font-size:10px; cursor:pointer}`, `.ag-kind[aria-pressed='false'] {opacity:.5}`, `.ag-kind i {width:8px; height:8px; border-radius:50%}`, `.ag-range {min-height:24px; ...select style like existing .cb inputs}`, `.ag-card {position:absolute; z-index:3; left:10px; right:10px; bottom:10px; max-height:46%; overflow:auto; padding:10px 12px; border:1px solid #44475a; border-radius:10px; background:#21222c; font-size:11px; color:#f8f8f2}`, `.ag-text {white-space:pre-wrap; color:#a9b2d3; margin:6px 0}`, `.ag-label rect {fill:#282a36}`, `.ag-label text {fill:#f8f8f2; font-size:10px}`, `.ag-label:focus-visible {outline:2px solid #f8f8f2}`. Secondary text colours must stay `#A9B2D3`/`#8B95BD`.

- [ ] **Step 5: Verify.** `npm run typecheck && npm test`; then run the dev app against the fake VPS (`npm run dev:fake`, see Task 7) and take a screenshot of the agents tab with `preview`/Playwright to check the drawing.

- [ ] **Step 6: Commit** `git commit -am "feat(m4b): agents tab with SVG interaction graph and detail card"`.

---

### Task 6: Integration test (fake SSH)

**Files:**
- Create: `tests/integration/interactions.test.ts`
- Modify: `tests/helpers/fixture.ts` (add `addInteractions(dir)` calling the `add-interactions` fixture command)

**Interfaces:**
- Consumes: Task 1/2 collector, Task 3 `session.interactionDetail`.

- [ ] **Step 1:** Add to `tests/helpers/fixture.ts`:

```ts
/** Adds Bot Chat, group room, subagent and kanban data between the fixture's profiles. */
export function addInteractions(dir: string): void {
  execFileSync(pythonExe, [script, 'add-interactions', dir])
}
```

(`add-interactions` takes the fixture **root** dir because `load(root)`.)

- [ ] **Step 2:** Test (mirror `tests/integration/cron.test.ts` for `setup()`; copy its harness lines rather than importing): after `addInteractions(fx.root)` and connecting, `await waitFor(() => events.some((e) => e.type === 'interactions'))`; assert the first `interactions` event has edge `message:atlas>scout:` with `count: 2`, a `kanban` edge labelled `#41`, `rooms[0].name === 'ops-room'`; then `await session.interactionDetail({ kind: 'kanban', id: 42 })` is `{ ok: true }` with `data.title === 'Draft the weekly digest'`; and `interactionDetail({ kind: 'delegate', id: 'sub:atlas:../x' })` returns `{ ok: false }` (collector `bad_args`). Add a second test: `await session.disconnect()` then connect again with the same fixture and assert that the new `interactions` event has the same edge ids with the same counts (no duplicates).

- [ ] **Step 3:** Run `npm test -- tests/integration/interactions.test.ts` → PASS. Run the full `npm test` and `npm run test:py` to make sure nothing else regressed.

- [ ] **Step 4: Commit** `git commit -am "test(m4b): interactions integration over the fake SSH server"`.

---

### Task 7: E2E, docs and wrap-up

**Files:**
- Create: `tests/e2e/agentGraph.spec.ts`
- Modify: `docs/manual-vps-checklist.md`, `CLAUDE.md`

- [ ] **Step 1: E2E.** Follow `tests/e2e/dashboard.spec.ts` / `helpers.ts` for launching Electron against the fake SSH server with the fixture (call `addInteractions` before connecting). Steps: open Dashboard → click tab `agents` (`getByRole('tab', { name: 'agents' })`) → expect a label button named `/message, .* to /` → click it → expect the card text `still waiting` and a button `Open session` → click it → expect the session modal (`getByRole('dialog')`) → press Escape → relaunch the app and expect the `agents` tab to still be selected (`aria-selected=true`).

- [ ] **Step 2: Run** `npm run test:e2e -- agentGraph.spec.ts` (needs a keychain; Windows DPAPI works). If it cannot run in this environment, say so explicitly in the final report instead of claiming it passed.

- [ ] **Step 3: Docs.** `docs/manual-vps-checklist.md`: append steps (continue numbering after the last one): verify `kanban.db` tables/columns (`sqlite3 ~/.hermes/kanban.db .schema`); a `message_agent` between two profiles shows a pink edge and its text matches `Message from <name> (@handle):`; a group room shows the title `Group: <room> · <thread>` in members' `state.db`; a `delegate_task` shows a cyan dashed edge; mark all as unverified like step 57. `CLAUDE.md`: change the project-state sentence to say M4b is built (agent graph) and remove M4b from the "not built" list, and add an "Agent graph (M4b)" paragraph next to "Second brain (M4a)" summarising: `InteractionState` in the collector (sources, cursors, 7-day window, caps, digest), event `interactions`, `--query interaction`, renderer files (`lib/agentGraph.ts`, `stores/interactions.ts`, `screens/dashboard/GraphPanel|AgentGraph|InteractionCard`), SVG instead of Pixi, settings `dashboard.graphTab` and `dashboard.agentGraph`, and the unverified formats (checklist).

- [ ] **Step 4: Final verification:** `npm run typecheck`, `npm test`, `npm run test:py`, `npm run build`. Report real outputs.

- [ ] **Step 5: Commit** `git commit -am "docs(m4b): checklist steps and CLAUDE.md; e2e for the agents tab"`.

---

## Self-Review

- Spec coverage: F-AGRAPH-1 (tab + saved: Task 3 settings, Task 5 `GraphPanel`); -2 (nodes: Task 4 `buildGraph`, Task 5 drawing); -3 (edges, colours, labels: Task 5); -4 (live ≤ 2 s, active dots: Task 2 interval, Task 5 animation); -5 (card, Open session, node summary: Task 5 + `q_interaction`); -6 (filters: Task 4 `filterData`, Task 5 controls). Sources and `unresolved`/states: Task 1. Zero-Change/security: Task 3 zod and regex. Docs: Task 7.
- Type consistency: `InteractionsData`, `InteractionEdge`, `filterData`, `buildGraph`, `describeNode`, `useInteractions.select({type,id})`, `window.mc.interactions.detail` are used with the same names in Tasks 3–6.
- Known soft spot: edge ids for `message` have the form `message:<from>><to>:` (empty label) and kanban `kanban:<from>><to>:#<id>`; the renderer treats ids as opaque.
