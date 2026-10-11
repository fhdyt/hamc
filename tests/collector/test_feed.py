import builtins
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def poll(fx, cursors=None):
    state = c.FeedState(cursors)
    items, history, errors = state.poll(str(fx.home))
    return state, items, history, errors


def ids(items, profile=None):
    return [i["id"] for i in items if profile is None or i["profile"] == profile]


# ---- text helpers ---------------------------------------------------------

def test_as_text_handles_odd_types():
    assert c.as_text(None) == ""
    assert c.as_text("abc") == "abc"
    assert c.as_text(b"caf\xc3\xa9") == "caf\xe9"
    assert c.as_text([{"type": "text", "text": "hi"}]) == '[{"type": "text", "text": "hi"}]'
    assert c.as_text(12) == "12"


def test_parse_tool_calls_accepts_the_common_shapes():
    openai = [{"id": "1", "type": "function", "function": {"name": "web_search", "arguments": "{\"q\": \"x\"}"}}]
    assert c.parse_tool_calls(json.dumps(openai)) == [("web_search", '{"q": "x"}')]
    assert c.parse_tool_calls(openai) == [("web_search", '{"q": "x"}')]
    assert c.parse_tool_calls([{"name": "t", "arguments": {"a": 1}}]) == [("t", '{"a":1}')]
    assert c.parse_tool_calls([{"name": "t", "input": {"b": [1, 2]}}]) == [("t", '{"b":[1,2]}')]
    assert c.parse_tool_calls({"name": "solo", "arguments": "x"}) == [("solo", "x")]
    assert c.parse_tool_calls([{"function": {"arguments": "a   b\n c"}}]) == [("tool", "a b c")]
    assert c.parse_tool_calls([{"name": "none"}]) == [("none", "")]


def test_parse_tool_calls_survives_garbage():
    for raw in (None, "", "not json", "42", [1, "x", None], {"function": "bad"}):
        assert isinstance(c.parse_tool_calls(raw), list)


# ---- the first poll -------------------------------------------------------

def test_first_poll_returns_the_history_of_every_profile(fx):
    _, items, history, errors = poll(fx)
    assert history is True
    assert errors == []
    assert ids(items, "default") == ["default:1:0", "default:2:0", "default:3:0", "default:3:1", "default:3:2", "default:4:0", "default:5:1"]
    assert {i["profile"] for i in items} == {"default", "scout"}


def test_an_assistant_row_becomes_thinking_reply_and_tools_in_that_order(fx):
    _, items, _, _ = poll(fx)
    row3 = [i for i in items if i["profile"] == "default" and i["messageId"] == 3]
    assert [i["kind"] for i in row3] == ["thinking", "reply", "tool"]
    assert row3[0]["text"] == "User greets; search first."
    assert row3[1]["text"] == "On it."
    assert row3[2]["text"] == 'web_search {"q": "hermes"}'
    assert row3[2]["toolName"] == "web_search"


def test_tool_results_and_users_and_session_info(fx):
    _, items, _, _ = poll(fx)
    by_id = {i["id"]: i for i in items}
    assert by_id["default:4:0"]["kind"] == "result"
    assert by_id["default:4:0"]["toolName"] == "web_search"
    assert by_id["default:2:0"]["kind"] == "user"
    assert by_id["default:2:0"]["source"] == "telegram"
    assert by_id["default:2:0"]["sessionId"] == "s-default-1"
    assert by_id["default:2:0"]["parentSessionId"] is None
    assert by_id["default:2:0"]["ts"] == fx.now - 3900
    child = next(i for i in items if i["profile"] == "scout" and i["text"] == "child work")
    assert child["source"] == "subagent" and child["parentSessionId"] == "s-scout-1"
    cron = next(i for i in items if i["text"] == "run the digest")
    assert cron["source"] == "cron"


def test_a_message_without_a_session_still_appears(fx):
    _, items, _, _ = poll(fx)
    orphan = next(i for i in items if i["id"] == "default:1:0")
    assert orphan["sessionId"] == "" and orphan["source"] is None


def test_inactive_rows_are_ignored(fx):
    _, items, _, _ = poll(fx)
    assert "scout:2:0" not in ids(items)


def test_other_roles_are_skipped(fx):
    mf.add_message(fx.home / "state.db", "s-default-1", "system", "you are a bot", fx.now)
    _, items, _, _ = poll(fx)
    assert not [i for i in items if i["text"] == "you are a bot"]


def test_empty_assistant_content_produces_no_reply_item(fx):
    mid = mf.add_message(fx.home / "state.db", "s-default-1", "assistant", "", fx.now, tool_calls=[{"name": "only_tool", "arguments": {}}])
    _, items, _, _ = poll(fx)
    kinds = [i["kind"] for i in items if i["messageId"] == mid and i["profile"] == "default"]
    assert kinds == ["tool"]


def test_reasoning_column_is_used_when_reasoning_content_is_empty(fx):
    _, items, _, _ = poll(fx)
    think = next(i for i in items if i["profile"] == "scout" and i["kind"] == "thinking")
    assert think["text"] == "plan: summarise"


# ---- limits ---------------------------------------------------------------

def test_long_text_is_cut_and_flagged(fx):
    db = fx.home / "state.db"
    mf.add_message(db, "s-default-1", "user", "u" * 5000, fx.now)
    mf.add_message(db, "s-default-1", "tool", "r" * 3000, fx.now, tool_name="t")
    _, items, _, _ = poll(fx)
    user = next(i for i in items if i["kind"] == "user" and i["fullLen"] == 5000)
    res = next(i for i in items if i["kind"] == "result" and i["fullLen"] == 3000)
    assert len(user["text"]) == 4000 and user["truncated"] is True
    assert len(res["text"]) == 1200 and res["truncated"] is True
    short = next(i for i in items if i["id"] == "default:2:0")
    assert short["truncated"] is False and short["fullLen"] == len(short["text"])


def test_the_first_poll_only_loads_the_latest_rows(fx):
    pdir = mf.add_profile(fx.home, "busy", markers=("config.yaml",))
    con = mf.make_db(pdir / "state.db")
    con.close()
    for i in range(100):
        mf.add_message(pdir / "state.db", None, "user", "m%03d" % i, fx.now + i)
    state, items, history, _ = poll(fx)
    busy = [i for i in items if i["profile"] == "busy"]
    assert len(busy) == 60
    assert busy[0]["text"] == "m040" and busy[-1]["text"] == "m099"
    assert state.cursors["busy"] == 100


def test_a_poll_returns_at_most_500_rows_per_profile_and_continues(fx):
    pdir = mf.add_profile(fx.home, "flood", markers=("config.yaml",))
    mf.make_db(pdir / "state.db").close()
    con = sqlite3.connect(pdir / "state.db")
    con.executemany(
        "INSERT INTO messages (role, content, timestamp, active) VALUES ('user', ?, ?, 1)",
        [("f%d" % i, fx.now + i) for i in range(700)],
    )
    con.commit()
    con.close()
    state = c.FeedState({"flood": 0})
    first, _, _ = state.poll(str(fx.home))
    assert len([i for i in first if i["profile"] == "flood"]) == 500
    second, _, _ = state.poll(str(fx.home))
    assert len([i for i in second if i["profile"] == "flood"]) == 200
    third, _, _ = state.poll(str(fx.home))
    assert [i for i in third if i["profile"] == "flood"] == []


# ---- cursors --------------------------------------------------------------

def test_cursors_report_the_highest_id_per_profile(fx):
    state, _, _, _ = poll(fx)
    assert state.cursors == {"default": 5, "scout": 5}


def test_a_second_poll_is_empty_until_something_is_written(fx):
    state, _, _, _ = poll(fx)
    again, history, errors = state.poll(str(fx.home))
    assert again == [] and history is False and errors == []
    mid = mf.add_message(fx.home / "state.db", "s-default-1", "user", "brand new", fx.now + 5)
    items, history, _ = state.poll(str(fx.home))
    assert history is False
    assert ids(items) == ["default:%d:0" % mid]
    assert state.cursors["default"] == mid


def test_given_cursors_only_newer_rows_are_returned(fx):
    _, items, history, _ = poll(fx, {"default": 3})
    assert ids(items, "default") == ["default:4:0", "default:5:1"]
    assert history is True  # scout had no cursor, so it was loaded as history


def test_a_cursor_for_every_profile_means_no_history_and_nothing_old(fx):
    _, items, history, _ = poll(fx, {"default": 5, "scout": 5})
    assert items == [] and history is False


def test_new_profiles_appear_with_their_history(fx):
    state, _, _, _ = poll(fx)
    pdir = mf.add_profile(fx.home, "nova", markers=("config.yaml",))
    mf.make_db(pdir / "state.db").close()
    mf.add_message(pdir / "state.db", None, "user", "hello nova", fx.now)
    items, history, _ = state.poll(str(fx.home))
    assert [i["text"] for i in items] == ["hello nova"] and history is True


# ---- odd data -------------------------------------------------------------

def test_millisecond_and_iso_timestamps(fx):
    db = fx.home / "state.db"
    a = mf.add_message(db, "s-default-1", "user", "ms stamp", 1_760_000_000_000)
    b = mf.add_message(db, "s-default-1", "user", "iso stamp", "2026-10-10T23:00:00+07:00")
    _, items, _, _ = poll(fx)
    by = {i["id"]: i for i in items}
    assert by["default:%d:0" % a]["ts"] == 1_760_000_000.0
    assert by["default:%d:0" % b]["ts"] == c.iso_to_epoch("2026-10-10T23:00:00+07:00")[0]


def test_a_database_with_only_the_required_columns(fx):
    pdir = mf.add_profile(fx.home, "lean", markers=("config.yaml",))
    con = sqlite3.connect(pdir / "state.db")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, timestamp REAL, content TEXT)")
    con.execute("INSERT INTO messages (session_id, role, timestamp, content) VALUES ('s', 'user', 5, 'lean hello')")
    con.execute("INSERT INTO messages (session_id, role, timestamp, content) VALUES ('s', 'assistant', 6, 'lean reply')")
    con.commit()
    con.close()
    _, items, _, errors = poll(fx)
    lean = [i for i in items if i["profile"] == "lean"]
    assert [i["kind"] for i in lean] == ["user", "reply"]
    assert lean[0]["source"] is None
    assert errors == []


def test_an_unrecognised_schema_is_reported_and_other_profiles_still_work(fx):
    pdir = mf.add_profile(fx.home, "odd", markers=("config.yaml",))
    con = sqlite3.connect(pdir / "state.db")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT)")
    con.commit()
    con.close()
    _, items, _, errors = poll(fx)
    assert errors == [{"code": "unsupported_schema", "message": "state.db schema not recognized", "profile": "odd"}]
    assert {i["profile"] for i in items} == {"default", "scout"}


def test_a_wal_database_can_be_read_while_a_writer_is_open(fx):
    pdir = mf.add_profile(fx.home, "walp", markers=("config.yaml",))
    writer = mf.make_db(pdir / "state.db", wal=True)
    try:
        writer.execute("INSERT INTO messages (role, content, timestamp, active) VALUES ('user', 'in wal', 1, 1)")
        writer.commit()
        _, items, _, _ = poll(fx)
        assert any(i["text"] == "in wal" for i in items)
    finally:
        writer.close()


def test_a_profile_without_state_db_is_skipped_quietly(fx):
    _, items, _, errors = poll(fx)
    assert "atlas" not in {i["profile"] for i in items} and errors == []


def test_never_opens_secret_files_while_polling(fx, monkeypatch):
    opened = []
    real_open = builtins.open

    def spy(file, *a, **k):
        opened.append(str(file))
        return real_open(file, *a, **k)

    monkeypatch.setattr(builtins, "open", spy)
    poll(fx)
    assert not [p for p in opened if p.endswith(".env") or p.endswith("auth.json")]


def test_items_are_json_serialisable(fx):
    _, items, _, _ = poll(fx)
    json.dumps(items, allow_nan=False)


# ---- daily stats ----------------------------------------------------------

def test_stats_count_only_todays_sessions(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now)
    default = next(a for a in data["agents"] if a["profile"] == "default")
    assert default["stats"] == {"sessions": 1, "messages": 4, "toolCalls": 1, "inputTokens": 100, "outputTokens": 50,
                                "reasoningTokens": 10, "costUsd": 0.02}


def test_stats_prefer_actual_cost_and_tolerate_missing_numbers(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now)
    scout = next(a for a in data["agents"] if a["profile"] == "scout")
    assert scout["stats"]["sessions"] == 2
    assert scout["stats"]["costUsd"] == 0.5
    assert scout["stats"]["messages"] == 2


def test_stats_are_null_without_a_database_or_sessions_table(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now)
    assert next(a for a in data["agents"] if a["profile"] == "atlas")["stats"] is None
    pdir = mf.add_profile(fx.home, "nosess", markers=("config.yaml",))
    sqlite3.connect(pdir / "state.db").close()
    data, _ = c.collect_agents(str(fx.home), fx.now)
    assert next(a for a in data["agents"] if a["profile"] == "nosess")["stats"] is None


# ---- streaming ------------------------------------------------------------

def env_for(fx):
    return {**os.environ, "MC_PROC_ROOT": str(fx.proc), "MC_SYS_ROOT": str(fx.sysfs)}


def events_of(stdout):
    return [json.loads(line) for line in stdout.decode("ascii").splitlines()]


def test_the_stream_sends_history_once_then_only_new_rows(fx):
    p = subprocess.Popen(
        [sys.executable, "-u", str(SCRIPT), str(fx.home), "--interval", "0.05"],
        env=env_for(fx), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        feeds = []
        wrote = False
        deadline = time.time() + 20
        while time.time() < deadline:
            line = p.stdout.readline()
            if not line:
                break
            ev = json.loads(line)
            if ev["type"] != "feed":
                continue
            feeds.append(ev)
            if not wrote:
                mf.add_message(fx.home / "state.db", "s-default-1", "user", "written while streaming", fx.now + 1)
                wrote = True
            elif any(i["text"] == "written while streaming" for i in ev["data"]["items"]):
                break
        assert feeds[0]["data"]["history"] is True
        assert feeds[0]["data"]["cursors"] == {"default": 5, "scout": 5}
        assert feeds[-1]["data"]["history"] is False
        assert [i["text"] for i in feeds[-1]["data"]["items"]] == ["written while streaming"]
        assert feeds[-1]["data"]["cursors"]["default"] == 6
    finally:
        p.kill()
        p.stdout.close()
        p.stderr.close()


def test_cursors_passed_on_the_command_line_skip_old_rows(fx):
    r = subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "4", "--interval", "0.05", "--cursors", json.dumps({"default": 5, "scout": 5})],
        input=SCRIPT.read_bytes(), env=env_for(fx), capture_output=True, timeout=30,
    )
    assert r.returncode == 0, r.stderr.decode()
    assert [e for e in events_of(r.stdout) if e["type"] == "feed"] == []


def test_a_full_start_sends_one_history_event_and_stays_zero_change(fx):
    before = mf.snapshot(fx.root)
    r = subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "4", "--interval", "0.05"],
        input=SCRIPT.read_bytes(), env=env_for(fx), capture_output=True, timeout=30, check=True,
    )
    feeds = [e for e in events_of(r.stdout) if e["type"] == "feed"]
    assert len(feeds) == 1 and feeds[0]["data"]["history"] is True
    assert mf.snapshot(fx.root) == before
