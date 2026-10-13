import json
import sqlite3

import make_fixture as mf
import mc_collector as c


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


def ids(r):
    return [x["id"] for x in r["data"]["rows"]]


def sql(fx, profile, stmt, *params):
    db = fx.home / "state.db" if profile == "default" else fx.home / "profiles" / profile / "state.db"
    con = sqlite3.connect(db)
    con.execute(stmt, params)
    con.commit()
    con.close()


# ---- list -----------------------------------------------------------------

def test_list_merges_profiles_newest_first(fx):
    r = q(fx, "sessions_list", {"profiles": [], "limit": 50})
    assert r["ok"] is True
    assert ids(r) == ["s-scout-child", "s-scout-1", "s-default-1", "s-default-old"]
    first = r["data"]["rows"][2]
    assert first["profile"] == "default"
    assert first["title"] == "Morning briefing"
    assert first["source"] == "telegram"
    assert first["messageCount"] == 4 and first["toolCallCount"] == 1
    assert first["inputTokens"] == 100 and first["outputTokens"] == 50
    assert first["snippet"] is None
    assert r["data"]["fallback"] is None and r["data"]["errors"] == [] and r["data"]["more"] is False


def test_list_pages_without_gaps_or_repeats(fx):
    p1 = q(fx, "sessions_list", {"profiles": [], "limit": 2})
    assert ids(p1) == ["s-scout-child", "s-scout-1"] and p1["data"]["more"] is True
    last = p1["data"]["rows"][-1]
    p2 = q(fx, "sessions_list", {"profiles": [], "limit": 2, "before": {"ts": last["startedAt"], "id": last["id"]}})
    assert ids(p2) == ["s-default-1", "s-default-old"] and p2["data"]["more"] is False


def test_list_filters(fx):
    assert ids(q(fx, "sessions_list", {"profiles": ["scout"], "limit": 50})) == ["s-scout-child", "s-scout-1"]
    assert ids(q(fx, "sessions_list", {"profiles": [], "source": "cron", "limit": 50})) == ["s-scout-1"]
    since = fx.now - 86400
    assert "s-default-old" not in ids(q(fx, "sessions_list", {"profiles": [], "sinceTs": since, "limit": 50}))
    assert q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["sources"] == ["cli", "cron", "subagent", "telegram"]


def test_cost_rules(fx):
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert (rows["s-scout-1"]["cost"], rows["s-scout-1"]["costKind"]) == (0.5, "actual")
    assert (rows["s-default-1"]["cost"], rows["s-default-1"]["costKind"]) == (0.02, "estimated")
    assert rows["s-scout-child"]["cost"] is None
    sql(fx, "default", "UPDATE sessions SET cost_status = 'weird' WHERE id = 's-default-1'")
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert rows["s-default-1"]["cost"] is None and rows["s-default-1"]["costKind"] is None


def test_status_rules(fx):
    sql(fx, "default", "UPDATE sessions SET ended_at = ?, end_reason = 'user_exit' WHERE id = 's-default-1'", fx.now - 3000)
    sql(fx, "default", "UPDATE sessions SET ended_at = ?, end_reason = 'error: timeout' WHERE id = 's-default-old'", fx.now - 3 * 86400)
    sql(fx, "scout", "UPDATE sessions SET ended_at = ?, end_reason = 'compressed' WHERE id = 's-scout-1'", fx.now - 5)
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert rows["s-default-1"]["status"] == "ended"
    assert rows["s-default-old"]["status"] == "failed"
    assert rows["s-scout-1"]["status"] == "compressed" and rows["s-scout-1"]["hasChildren"] is True
    assert rows["s-scout-child"]["status"] == "running"
    assert rows["s-scout-child"]["parentSessionId"] == "s-scout-1"


def test_pinned(fx):
    sql(fx, "default", "UPDATE sessions SET pinned = 1 WHERE id = 's-default-1'")
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert rows["s-default-1"]["pinned"] is True and rows["s-default-old"]["pinned"] is False


def test_missing_optional_columns_become_null(fx):
    db = fx.home / "profiles" / "atlas" / "state.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL)")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
    con.execute("INSERT INTO sessions VALUES ('s-atlas', ?)", (fx.now - 1,))
    con.commit()
    con.close()
    r = q(fx, "sessions_list", {"profiles": ["atlas"], "limit": 10})
    row = r["data"]["rows"][0]
    assert row["id"] == "s-atlas" and row["title"] is None and row["cost"] is None and row["pinned"] is False and row["status"] == "running"


def test_unreadable_profile_is_reported_and_others_answer(fx):
    (fx.home / "profiles" / "atlas" / "state.db").write_bytes(b"not a database at all")
    r = q(fx, "sessions_list", {"profiles": [], "limit": 50})
    assert r["ok"] is True and "s-default-1" in ids(r)
    assert {"profile": "atlas", "code": "db_unreadable"} in r["data"]["errors"]


def test_schema_without_sessions_is_unsupported(fx):
    db = fx.home / "profiles" / "atlas" / "state.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE other (x)")
    con.commit()
    con.close()
    assert q(fx, "sessions_list", {"profiles": ["atlas"], "limit": 10}) == {"ok": False, "error": "unsupported_schema"}


def test_list_bad_args(fx):
    assert q(fx, "sessions_list", {"profiles": ["../x"], "limit": 5})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": "default", "limit": 5})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": [], "limit": 0})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": [], "limit": 5, "sinceTs": "x"})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": [], "limit": 5, "before": {"ts": 1, "id": "a b"}})["error"] == "bad_args"


# ---- search ---------------------------------------------------------------

def test_search_finds_sessions_by_message_text_with_marked_snippet(fx):
    r = q(fx, "sessions_search", {"profiles": [], "q": "digest"})
    assert r["ok"] is True and ids(r) == ["s-scout-1"]
    assert "\x02digest\x03" in r["data"]["rows"][0]["snippet"].lower()
    assert r["data"]["fallback"] is None


def test_search_respects_filters(fx):
    assert ids(q(fx, "sessions_search", {"profiles": ["default"], "q": "digest"})) == []
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "hello", "source": "telegram"})) == ["s-default-1"]
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "hello", "sinceTs": fx.now - 100})) == []


def test_search_ignores_inactive_messages(fx):
    mf.add_message(fx.home / "state.db", "s-default-1", "assistant", "zebra stripes", fx.now - 1, active=0)
    sql(fx, "default", "INSERT INTO messages_fts(rowid, content) SELECT id, content FROM messages WHERE content = 'zebra stripes'")
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "zebra"})) == []


def test_search_text_is_never_sql_or_fts_syntax(fx):
    for hostile in ['" OR 1=1 --', "digest AND (", "NEAR(", "*", "a'b", "\\"]:
        r = q(fx, "sessions_search", {"profiles": [], "q": hostile})
        assert r["ok"] is True, hostile


def test_search_falls_back_to_titles_without_the_index(fx):
    sql(fx, "default", "DROP TABLE messages_fts")
    sql(fx, "scout", "DROP TABLE messages_fts")
    r = q(fx, "sessions_search", {"profiles": [], "q": "briefing"})
    assert ids(r) == ["s-default-1"] and r["data"]["fallback"] == "title"
    assert r["data"]["rows"][0]["snippet"] is None
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "100%"})) == []


def test_search_bad_args(fx):
    assert q(fx, "sessions_search", {"profiles": [], "q": ""})["error"] == "bad_args"
    assert q(fx, "sessions_search", {"profiles": [], "q": "x" * 201})["error"] == "bad_args"
    assert q(fx, "sessions_search", {"profiles": [], "q": 5})["error"] == "bad_args"


# ---- transcript -----------------------------------------------------------

def test_transcript_returns_items_session_and_chain(fx):
    r = q(fx, "session_transcript", {"profile": "scout", "sessionId": "s-scout-1"})
    assert r["ok"] is True
    d = r["data"]
    assert d["session"]["id"] == "s-scout-1" and d["session"]["title"] == "Digest run"
    assert [i["kind"] for i in d["items"]] == ["user", "thinking", "reply"]
    assert d["nextAfter"] is None and d["total"] == 2
    assert d["chain"]["parent"] is None
    assert [c["id"] for c in d["chain"]["children"]] == ["s-scout-child"]


def test_transcript_child_points_to_parent(fx):
    d = q(fx, "session_transcript", {"profile": "scout", "sessionId": "s-scout-child"})["data"]
    assert d["chain"]["parent"] == {"id": "s-scout-1", "title": "Digest run"}


def test_transcript_pages_by_message_id(fx):
    full = q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1"})["data"]
    assert [i["kind"] for i in full["items"]] == ["user", "thinking", "reply", "tool", "result", "reply"]
    first = q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1", "limit": 2})["data"]
    assert {i["messageId"] for i in first["items"]} == {first["nextAfter"] - 1, first["nextAfter"]}
    assert first["nextAfter"] is not None
    rest = q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1", "afterId": first["nextAfter"]})["data"]
    assert [i["id"] for i in first["items"] + rest["items"]] == [i["id"] for i in full["items"]]
    assert rest["nextAfter"] is None


def test_transcript_skips_inactive_messages(fx):
    mf.add_message(fx.home / "state.db", "s-default-1", "assistant", "hidden", fx.now, active=0)
    texts = [i["text"] for i in q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1"})["data"]["items"]]
    assert "hidden" not in texts


def test_transcript_errors(fx):
    assert q(fx, "session_transcript", {"profile": "default", "sessionId": "nope"})["error"] == "not_found"
    assert q(fx, "session_transcript", {"profile": "ghost", "sessionId": "x"})["error"] == "not_found"
    assert q(fx, "session_transcript", {"profile": "../x", "sessionId": "x"})["error"] == "bad_args"
    assert q(fx, "session_transcript", {"profile": "default", "sessionId": "a b"})["error"] == "bad_args"
    assert q(fx, "session_transcript", {"profile": "default", "sessionId": "x", "afterId": -1})["error"] == "bad_args"
