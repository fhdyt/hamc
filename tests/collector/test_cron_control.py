import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"
JID = "09358c101c91"


def q(home, cmd, args):
    return c.run_query(str(home), cmd, json.dumps(args))


def job(data, jid=JID, profile="default"):
    return next(j for j in data["jobs"] if j["id"] == jid and j["profile"] == profile)


# ---- the cron event: inflight and incident ----------------------------------

def test_cron_event_has_the_open_incident_and_no_inflight(fx):
    data = c.collect_cron(str(fx.home), fx.now)
    j = job(data)
    assert j["inflight"] is False
    inc = j["incident"]
    assert inc["id"] == "09358c_0a1b2c3d4e5f"
    assert inc["state"] == "alerted"
    assert inc["failureType"] == "timeout"
    assert inc["lastSeenTs"] == fx.now - 3590
    assert inc["firstSeenTs"] == fx.now - 86400 * 3
    assert inc["error"].startswith("Agent run failed")
    assert inc["output"] == "2026-10-10_23-00-25.md"
    scout = job(data, "aaaaaaaaaaaa", "scout")
    assert scout["incident"] is None and scout["inflight"] is False


def test_running_attempt_marks_the_job_inflight_until_it_is_silent_too_long(fx):
    con = sqlite3.connect(fx.home / "cron" / "executions.db")
    mf.add_execution(con, "e9", JID, "running", fx.now - 30, fx.now - 29, progress=fx.now - 10)
    con.close()
    assert job(c.collect_cron(str(fx.home), fx.now))["inflight"] is True
    assert job(c.collect_cron(str(fx.home), fx.now + 3 * 3600))["inflight"] is False


def test_ledger_is_read_again_only_when_it_changes(fx, monkeypatch):
    c._LEDGER_CACHE.clear()
    calls = []
    real = c._read_ledger
    monkeypatch.setattr(c, "_read_ledger", lambda p, n: calls.append(p) or real(p, n))
    c.collect_cron(str(fx.home), fx.now)
    c.collect_cron(str(fx.home), fx.now)
    assert len(calls) == 1
    con = sqlite3.connect(fx.home / "cron" / "executions.db")
    mf.add_incident(con, "09358c_123456789abc", JID, "detected", fx.now - 5, fx.now - 1, "new error")
    con.close()
    os.utime(fx.home / "cron" / "executions.db", (fx.now + 50, fx.now + 50))
    assert job(c.collect_cron(str(fx.home), fx.now))["incident"]["id"] == "09358c_123456789abc"
    assert len(calls) == 2


def test_missing_or_broken_ledger_gives_empty_parts(fx):
    (fx.home / "cron" / "executions.db").write_bytes(b"not a database at all, sorry" * 10)
    j = job(c.collect_cron(str(fx.home), fx.now))
    assert j["incident"] is None and j["inflight"] is False
    os.remove(fx.home / "cron" / "executions.db")
    assert job(c.collect_cron(str(fx.home), fx.now))["incident"] is None


def test_ledger_without_incident_table(fx):
    os.remove(fx.home / "cron" / "executions.db")
    con = mf.make_cron_ledger(fx.home / "cron" / "executions.db", with_incidents=False)
    mf.add_execution(con, "e1", JID, "claimed", fx.now - 5)
    con.close()
    j = job(c.collect_cron(str(fx.home), fx.now))
    assert j["inflight"] is True and j["incident"] is None


# ---- cron_jobs ----------------------------------------------------------------

def test_cron_jobs_answers_the_same_snapshot(fx):
    r = q(fx.home, "cron_jobs", {})
    assert r["ok"]
    assert {j["id"] for j in r["data"]["jobs"]} == {JID, "aaaaaaaaaaaa", "bbbbbbbbbbbb"}
    assert job(r["data"])["incident"]["state"] == "alerted"


# ---- cron_runs ----------------------------------------------------------------

def test_runs_newest_first_with_trigger_times_and_paired_outputs(fx):
    r = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID, "limit": 6})
    assert r["ok"]
    d = r["data"]
    assert d["ledger"] == "ok"
    assert [x["id"] for x in d["runs"]] == ["e3", "e2", "e1"]
    e3, e2, e1 = d["runs"]
    assert e3["status"] == "failed" and e3["trigger"] == "scheduled" and e3["source"] == "builtin"
    assert e3["claimedTs"] == fx.now - 3650 and e3["finishedTs"] == fx.now - 3590
    assert e3["error"].startswith("Agent run failed") and e3["delivery"] == "delivered"
    assert e3["output"] == JID + "/2026-10-10_23-00-25.md"
    assert e2["output"] == JID + "/2026-10-09_23-00-45.md"
    assert e1["output"] is None and e1["status"] == "unknown"
    assert [o["name"] for o in d["outputs"]] == [JID + "/2026-10-10_23-00-25.md", JID + "/2026-10-09_23-00-45.md"]
    assert [i["id"] for i in d["incidents"]] == ["09358c_0a1b2c3d4e5f", "09358c_ffeeddccbbaa"]
    assert d["incidents"][1]["state"] == "resolved" and d["incidents"][1]["closedTs"] == fx.now - 86400 * 7


def test_runs_limit_and_manual_trigger(fx):
    con = sqlite3.connect(fx.home / "cron" / "executions.db")
    mf.add_execution(con, "e4", JID, "completed", fx.now - 60, fx.now - 59, fx.now - 40, source="direct", scheduled=False)
    con.close()
    d = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID, "limit": 2})["data"]
    assert [x["id"] for x in d["runs"]] == ["e4", "e3"]
    assert d["runs"][0]["trigger"] == "manual"


def test_runs_without_ledger_come_from_output_files(fx):
    os.remove(fx.home / "cron" / "executions.db")
    d = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID})["data"]
    assert d["ledger"] == "absent"
    assert [x["output"] for x in d["runs"]] == [JID + "/2026-10-10_23-00-25.md", JID + "/2026-10-09_23-00-45.md"]
    assert d["runs"][0]["status"] == "unknown" and d["runs"][0]["trigger"] is None
    assert d["runs"][0]["finishedTs"] == fx.now - 3600
    assert d["incidents"] == []


def test_runs_with_an_unreadable_ledger(fx):
    (fx.home / "cron" / "executions.db").write_bytes(b"garbage" * 100)
    d = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID})["data"]
    assert d["ledger"] == "unreadable"
    assert len(d["runs"]) == 2


def test_runs_tolerate_an_old_ledger_without_newer_columns(fx):
    os.remove(fx.home / "cron" / "executions.db")
    con = sqlite3.connect(fx.home / "cron" / "executions.db")
    con.execute("CREATE TABLE executions (id TEXT, job_id TEXT, source TEXT, status TEXT, claimed_at TEXT, started_at TEXT, finished_at TEXT, error TEXT)")
    con.execute("INSERT INTO executions VALUES ('x1', ?, 'builtin', 'completed', ?, ?, ?, NULL)", (JID, mf.iso(fx.now - 3610), mf.iso(fx.now - 3609), mf.iso(fx.now - 3598)))
    con.commit()
    con.close()
    d = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID})["data"]
    run = d["runs"][0]
    assert run["trigger"] is None and run["delivery"] is None
    assert run["output"] == JID + "/2026-10-10_23-00-25.md"


def test_legacy_loose_output_files_are_listed(fx):
    d = q(fx.home, "cron_runs", {"profile": "scout", "jobId": "bbbbbbbbbbbb"})["data"]
    assert d["ledger"] == "absent"
    assert [o["name"] for o in d["outputs"]] == ["bbbbbbbbbbbb_20260920_190257.txt"]


def test_runs_bad_args(fx):
    for args in ({"profile": "../x", "jobId": JID}, {"profile": "default", "jobId": "../etc"}, {"profile": "default", "jobId": ".."},
                 {"profile": "default", "jobId": JID, "limit": 0}, {"profile": "default"}):
        assert q(fx.home, "cron_runs", args) == {"ok": False, "error": "bad_args"}
    assert q(fx.home, "cron_runs", {"profile": "nobody", "jobId": JID}) == {"ok": False, "error": "not_found"}
    big = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID, "limit": 999})
    assert big["ok"] and len(big["data"]["runs"]) == 3


# ---- cron_output --------------------------------------------------------------

def test_output_reads_listed_files_only(fx):
    names = [JID + "/2026-10-10_23-00-25.md", JID + "/2026-10-09_23-00-45.md"]
    d = q(fx.home, "cron_output", {"profile": "default", "jobId": JID, "names": names})["data"]
    assert d["files"][0]["text"] == "latest run\nline two\n" and d["files"][0]["truncated"] is False
    assert d["files"][1]["text"] == "older run\n"
    d = q(fx.home, "cron_output", {"profile": "default", "jobId": JID, "names": ["../../.env"]})["data"]
    assert d["files"] == [{"name": "../../.env", "error": "not_found"}]
    d = q(fx.home, "cron_output", {"profile": "default", "jobId": JID, "names": ["aaaaaaaaaaaa/x.md"]})["data"]
    assert d["files"][0]["error"] == "not_found"


def test_output_is_cut_at_64_kib(fx):
    mf.add_output(fx.home, JID, "2026-10-11_23-00-00.md", "y" * 70000)
    d = q(fx.home, "cron_output", {"profile": "default", "jobId": JID, "names": [JID + "/2026-10-11_23-00-00.md"]})["data"]
    assert len(d["files"][0]["text"]) == 65536 and d["files"][0]["truncated"] is True


def test_output_ignores_a_symlink_out_of_the_folder(fx):
    target = fx.home / ".env"
    link = fx.home / "cron" / "output" / JID / "evil.md"
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError):
        return
    d = q(fx.home, "cron_output", {"profile": "default", "jobId": JID, "names": [JID + "/evil.md"]})["data"]
    assert d["files"][0]["error"] == "not_found"
    runs = q(fx.home, "cron_runs", {"profile": "default", "jobId": JID})["data"]
    assert JID + "/evil.md" not in [o["name"] for o in runs["outputs"]]


def test_output_bad_args(fx):
    for names in ([], ["a", "b", "c"], [1], "x"):
        assert q(fx.home, "cron_output", {"profile": "default", "jobId": JID, "names": names}) == {"ok": False, "error": "bad_args"}


def test_queries_run_through_the_script(fx):
    out = subprocess.run([sys.executable, "-", str(fx.home), "--query", "cron_runs", json.dumps({"profile": "default", "jobId": JID})],
                         input=SCRIPT.read_bytes(), capture_output=True, check=True)
    r = json.loads(out.stdout)
    assert r["ok"] and r["data"]["ledger"] == "ok"
