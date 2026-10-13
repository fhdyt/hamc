import json
import sqlite3

import make_fixture as mf
import mc_collector as c

BASE = 1_000_000.0
STARTS = [BASE, BASE + 82800, BASE + 82800 + 90000, BASE + 82800 + 90000 + 86400]  # 23 h, 25 h and 24 h days
END = STARTS[-1] + 86400


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


def summary(fx, **over):
    args = {"profiles": [], "dayStarts": STARTS, "endTs": END}
    args.update(over)
    return q(fx, "usage_summary", args)


def key(r):
    return (r["day"], r["profile"], r["model"])


# ---- summary ----------------------------------------------------------------

def test_buckets_sessions_by_the_given_day_boundaries(fx):
    mf.add_usage_data(fx, BASE)
    r = summary(fx)
    assert r["ok"] is True
    rows = {key(x): x for x in r["data"]["rows"]}
    assert set(rows) == {(0, "default", "m-a"), (1, "default", "m-b"), (1, "scout", "m-a"), (2, "scout", "m-a")}
    first = rows[(0, "default", "m-a")]
    assert first["sessions"] == 2 and first["inputTokens"] == 300 and first["outputTokens"] == 30 and first["cacheReadTokens"] == 5
    assert first["provider"] == "prov-a" and first["apiCalls"] == 7
    assert r["data"]["truncated"] is False and r["data"]["errors"] == []


def test_cost_prefers_actual_and_marks_estimates(fx):
    mf.add_usage_data(fx, BASE)
    rows = {key(x): x for x in summary(fx)["data"]["rows"]}
    a = rows[(0, "default", "m-a")]
    assert a["cost"] == 3.0 and a["estimatedCost"] == 1.0 and a["unknownCost"] == 0
    b = rows[(1, "default", "m-b")]
    assert b["cost"] == 0.5 and b["estimatedCost"] == 0.5 and b["apiCalls"] is None
    unknown = rows[(2, "scout", "m-a")]
    assert unknown["cost"] == 0.0 and unknown["unknownCost"] == 1


def test_sessions_outside_the_range_are_left_out(fx):
    mf.add_usage_data(fx, BASE)
    r = summary(fx, dayStarts=STARTS[1:], endTs=END)
    found = {key(x) for x in r["data"]["rows"]}
    assert all(x["day"] in (0, 1) for x in r["data"]["rows"])
    assert (0, "default", "m-b") in found
    assert (0, "default", "m-a") not in found


def test_profile_filter(fx):
    mf.add_usage_data(fx, BASE)
    rows = summary(fx, profiles=["scout"])["data"]["rows"]
    assert {x["profile"] for x in rows} == {"scout"}


def test_missing_columns_become_null_and_zero(fx):
    db = fx.home / "profiles" / "atlas" / "state.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL)")
    con.execute("INSERT INTO sessions VALUES ('only', ?)", (BASE + 5,))
    con.commit()
    con.close()
    rows = summary(fx, profiles=["atlas"])["data"]["rows"]
    assert len(rows) == 1
    assert rows[0]["model"] is None and rows[0]["provider"] is None and rows[0]["cost"] == 0.0 and rows[0]["unknownCost"] == 0 and rows[0]["apiCalls"] is None


def test_unreadable_profile_is_reported_and_others_answer(fx):
    mf.add_usage_data(fx, BASE)
    (fx.home / "profiles" / "atlas" / "state.db").write_bytes(b"not a database")
    r = summary(fx)
    assert r["ok"] is True and len(r["data"]["rows"]) > 0
    assert {"profile": "atlas", "code": "db_unreadable"} in r["data"]["errors"]


def test_schema_without_sessions_is_unsupported(fx):
    con = sqlite3.connect(fx.home / "profiles" / "atlas" / "state.db")
    con.execute("CREATE TABLE other (x)")
    con.commit()
    con.close()
    assert summary(fx, profiles=["atlas"]) == {"ok": False, "error": "unsupported_schema"}


def test_summary_bad_args(fx):
    assert summary(fx, dayStarts=[])["error"] == "bad_args"
    assert summary(fx, dayStarts=[5, 3])["error"] == "bad_args"
    assert summary(fx, dayStarts=list(range(0, 32 * 86400, 86400)))["error"] == "bad_args"
    assert summary(fx, dayStarts=["x"])["error"] == "bad_args"
    assert summary(fx, endTs=STARTS[-1])["error"] == "bad_args"
    assert summary(fx, profiles=["../x"])["error"] == "bad_args"


# ---- tools ------------------------------------------------------------------

def tools(fx, **over):
    args = {"profiles": [], "sinceTs": BASE - 10, "endTs": BASE + 1000}
    args.update(over)
    return q(fx, "usage_tools", args)


def by_name(r):
    return {t["name"]: t for t in r["data"]["tools"]}


def test_tools_count_failures_and_time(fx):
    mf.add_tool_data(fx, BASE)
    r = tools(fx)
    assert r["ok"] is True
    t = by_name(r)
    assert set(t) == {"web_search", "terminal"}
    ws = t["web_search"]
    assert ws["calls"] == 2 and ws["errors"] == 1
    assert ws["avgMs"] == 3500 and ws["maxMs"] == 5000 and ws["lastTs"] == BASE + 25
    assert ws["byProfile"] == {"default": 2}
    assert ws["failures"] == [{"profile": "default", "sessionId": "t1", "ts": BASE + 25, "text": "Error: rate limited (429)"}]
    term = t["terminal"]
    assert term["calls"] == 2 and term["errors"] == 1 and term["byProfile"] == {"default": 1, "scout": 1}
    assert r["data"]["scanned"] == 4 and r["data"]["truncated"] is False


def test_tools_respect_range_profiles_and_active(fx):
    mf.add_tool_data(fx, BASE)
    assert "hidden" not in by_name(tools(fx))
    assert by_name(tools(fx, profiles=["scout"]))["terminal"]["calls"] == 1
    assert tools(fx, sinceTs=BASE + 26, endTs=BASE + 1000)["data"]["scanned"] == 2


def test_failure_guess():
    f = c._looks_failed
    for text in ["Traceback (most recent call last)", "Error: ENOENT", "  error: nope", '{"error": "boom"}', "Command failed with exit code 1", "Exception in thread"]:
        assert f(text), text
    for text in ["3 results", "no errors found", "exit code 0", "file saved", "", None]:
        assert not f(text), text


def test_tools_cut_failure_text_and_cap_failures(fx):
    d = fx.home / "state.db"
    mf.add_session(d, "t9", "cli", BASE)
    for i in range(8):
        mf.add_message(d, "t9", "tool", "Error: " + "x" * 400, BASE + 100 + i, tool_name="flaky")
    flaky = by_name(tools(fx))["flaky"]
    assert flaky["errors"] == 8 and len(flaky["failures"]) == 5
    assert all(len(f["text"]) <= 160 for f in flaky["failures"])
    assert flaky["failures"][0]["ts"] == BASE + 107


def test_tools_bad_args(fx):
    assert tools(fx, sinceTs="x")["error"] == "bad_args"
    assert tools(fx, endTs=BASE - 100)["error"] == "bad_args"
    assert tools(fx, profiles=["../x"])["error"] == "bad_args"
