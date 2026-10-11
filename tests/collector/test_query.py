import json
import os
import subprocess
import sys
from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


# ---- message --------------------------------------------------------------

def test_message_returns_the_full_content(fx):
    mid = mf.add_message(fx.home / "state.db", "s-default-1", "tool", "x" * 3000, fx.now, tool_name="t")
    r = q(fx, "message", {"profile": "default", "messageId": mid, "field": "content"})
    assert r["ok"] is True
    assert r["data"] == {"text": "x" * 3000, "truncated": False, "fullLen": 3000}


def test_message_returns_reasoning_and_tool_calls(fx):
    r = q(fx, "message", {"profile": "default", "messageId": 3, "field": "reasoning"})
    assert r["data"]["text"] == "User greets; search first."
    r = q(fx, "message", {"profile": "default", "messageId": 3, "field": "tool_calls", "index": 0})
    assert r["data"]["text"] == 'web_search {"q": "hermes"}'
    r = q(fx, "message", {"profile": "scout", "messageId": 4, "field": "reasoning"})
    assert r["data"]["text"] == "plan: summarise"


def test_message_is_cut_at_64_kib(fx):
    mid = mf.add_message(fx.home / "state.db", "s-default-1", "tool", "y" * 70000, fx.now, tool_name="t")
    r = q(fx, "message", {"profile": "default", "messageId": mid, "field": "content"})
    assert r["data"]["truncated"] is True
    assert len(r["data"]["text"].encode("utf-8")) <= 65536
    assert r["data"]["fullLen"] == 70000


def test_message_errors(fx):
    assert q(fx, "message", {"profile": "default", "messageId": 9999, "field": "content"}) == {"ok": False, "error": "not_found"}
    assert q(fx, "message", {"profile": "default", "messageId": 1, "field": "password"})["error"] == "bad_args"
    assert q(fx, "message", {"profile": "../x", "messageId": 1, "field": "content"})["error"] == "bad_args"
    assert q(fx, "message", {"profile": "default", "messageId": "1; drop", "field": "content"})["error"] == "bad_args"
    assert q(fx, "message", {"profile": "ghost", "messageId": 1, "field": "content"})["error"] == "not_found"
    assert q(fx, "message", {"profile": "default", "messageId": 3, "field": "tool_calls", "index": 5})["error"] == "not_found"


# ---- history --------------------------------------------------------------

def test_history_pages_backwards_by_id(fx):
    r = q(fx, "history", {"before": {"default": 5}, "limit": 2})
    assert r["ok"] is True
    data = r["data"]
    assert [i["id"] for i in data["items"]] == ["default:4:0", "default:3:0", "default:3:1", "default:3:2"]
    assert data["oldest"] == {"default": 3}
    assert data["exhausted"] == {"default": False}


def test_history_reports_exhaustion_and_handles_several_profiles(fx):
    r = q(fx, "history", {"before": {"default": 2, "scout": 3, "atlas": 10, "ghost": 5}, "limit": 10})
    data = r["data"]
    assert data["exhausted"] == {"default": True, "scout": True, "atlas": True, "ghost": True}
    assert sorted({i["profile"] for i in data["items"]}) == ["default", "scout"]
    assert data["oldest"]["default"] == 1


def test_history_skips_inactive_rows_and_validates_arguments(fx):
    data = q(fx, "history", {"before": {"scout": 99}, "limit": 50})["data"]
    assert "scout:2:0" not in [i["id"] for i in data["items"]]
    assert q(fx, "history", {"before": {"../x": 1}, "limit": 5})["error"] == "bad_args"
    assert q(fx, "history", {"before": {"default": "a"}, "limit": 5})["error"] == "bad_args"
    assert q(fx, "history", {"before": "nope", "limit": 5})["error"] == "bad_args"
    assert q(fx, "history", {"before": {"default": 5}, "limit": 0})["error"] == "bad_args"


def test_history_limit_is_capped_at_100_rows(fx):
    assert q(fx, "history", {"before": {"default": 99}, "limit": 101})["error"] == "bad_args"
    data = q(fx, "history", {"before": {"default": 99}, "limit": 100})["data"]
    assert len(data["items"]) > 0


# ---- session --------------------------------------------------------------

def test_session_returns_info_children_and_messages(fx):
    r = q(fx, "session", {"profile": "scout", "sessionId": "s-scout-1"})
    assert r["ok"] is True
    d = r["data"]
    assert d["session"]["id"] == "s-scout-1"
    assert d["session"]["source"] == "cron"
    assert d["session"]["model"] == "deepseek-v4-flash"
    assert d["session"]["parentSessionId"] is None
    assert d["session"]["startedAt"] == fx.now - 20
    assert d["children"] == [{"id": "s-scout-child", "source": "subagent"}]
    assert [i["kind"] for i in d["items"]] == ["user", "thinking", "reply"]
    assert d["more"] is False


def test_a_child_session_points_at_its_parent(fx):
    d = q(fx, "session", {"profile": "scout", "sessionId": "s-scout-child"})["data"]
    assert d["session"]["parentSessionId"] == "s-scout-1"
    assert [i["text"] for i in d["items"]] == ["child work"]


def test_session_is_capped_at_500_items(fx):
    db = fx.home / "state.db"
    for i in range(520):
        mf.add_message(db, "s-default-1", "user", "bulk%d" % i, fx.now + i)
    d = q(fx, "session", {"profile": "default", "sessionId": "s-default-1"})["data"]
    assert len(d["items"]) == 500 and d["more"] is True


def test_session_errors(fx):
    assert q(fx, "session", {"profile": "default", "sessionId": "nope"})["error"] == "not_found"
    assert q(fx, "session", {"profile": "default", "sessionId": "bad id!"})["error"] == "bad_args"
    assert q(fx, "session", {"profile": "../x", "sessionId": "s"})["error"] == "bad_args"


# ---- the command line -----------------------------------------------------

def env_for(fx):
    return {**os.environ, "MC_PROC_ROOT": str(fx.proc), "MC_SYS_ROOT": str(fx.sysfs)}


def run_cli(fx, cmd, args):
    return subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--query", cmd, json.dumps(args)],
        input=SCRIPT.read_bytes(), env=env_for(fx), capture_output=True, timeout=30,
    )


def test_cli_prints_exactly_one_json_line_and_nothing_else(fx):
    r = run_cli(fx, "message", {"profile": "default", "messageId": 3, "field": "reasoning"})
    assert r.returncode == 0, r.stderr.decode()
    assert r.stderr == b""
    lines = r.stdout.decode("ascii").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["data"]["text"] == "User greets; search first."


def test_cli_unknown_command_and_bad_json(fx):
    assert json.loads(run_cli(fx, "drop", {}).stdout)["error"] == "unknown_command"
    r = subprocess.run([sys.executable, "-u", "-", str(fx.home), "--query", "message", "{nope"],
                       input=SCRIPT.read_bytes(), env=env_for(fx), capture_output=True, timeout=30)
    assert json.loads(r.stdout)["error"] == "bad_args"


def test_queries_leave_the_fixture_untouched(fx):
    before = mf.snapshot(fx.root)
    run_cli(fx, "session", {"profile": "scout", "sessionId": "s-scout-1"})
    run_cli(fx, "history", {"before": {"default": 5}, "limit": 3})
    run_cli(fx, "message", {"profile": "default", "messageId": 3, "field": "content"})
    assert mf.snapshot(fx.root) == before


def test_query_mode_does_not_start_the_stream(fx):
    r = run_cli(fx, "history", {"before": {"default": 5}, "limit": 1})
    assert b'"type"' not in r.stdout
