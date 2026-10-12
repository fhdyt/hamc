import json
import os
import subprocess
import sys
from pathlib import Path

import make_fixture as mf
import mc_collector as c

SCRIPT = Path(__file__).resolve().parents[2] / "collector" / "mc_collector.py"


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
    assert len(data["subagents"]) <= c.INTER_MAX_SUBS


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


def test_a_subagent_that_drops_out_leaves_no_edge(fx):
    mf.add_interactions(fx)
    st, first = poll(fx)
    assert any(e["kind"] == "delegate" for e in first["edges"])
    later = st.poll(str(fx.home), fx.now + 8 * 86400)  # everything is now outside the window
    assert later["subagents"] == [] and not [e for e in later["edges"] if e["kind"] == "delegate"]


def test_output_is_ascii_json(fx):
    mf.add_interactions(fx)
    _, data = poll(fx)
    json.dumps(data, ensure_ascii=True).encode("ascii")
