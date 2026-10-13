#!/usr/bin/env python3
"""A stand-in for `hermes [-p P] cron pause|resume|run|edit|incidents ack` used by the fake SSH server.

It changes the fixture the way Hermes would: jobs.json for pause, resume and edit; for run a ledger row in
cron/executions.db, an output file and last_run_at/last_status; for ack the incident state. Output lines copy the
real CLI (hermes_cli/cron.py), with ANSI colours like a terminal would get. A schedule containing "bad" is refused,
an unknown job is refused, and MC_FAKE_CRON_RUN_S sets how long a run takes (default 0.5 s).
"""
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_fixture as mf  # noqa: E402

HOME = Path(os.environ["MC_FAKE_HOME"])
GREEN, RED, YELLOW, RESET = "\x1b[32m", "\x1b[31m", "\x1b[33m", "\x1b[0m"


def out(text, colour=GREEN):
    sys.stdout.write(colour + text + RESET + "\n")
    sys.stdout.flush()


def fail(text):
    out(text, RED)
    sys.exit(1)


def load(pdir):
    path = pdir / "cron" / "jobs.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    return path, doc, doc["jobs"] if isinstance(doc, dict) else doc


def save(path, doc):
    path.write_text(json.dumps(doc), encoding="utf-8")


def find(jobs, ref):
    hits = [j for j in jobs if j.get("id") == ref] or [j for j in jobs if str(j.get("name", "")).lower() == ref.lower()]
    if len(hits) > 1:
        fail("Ambiguous job reference: %s" % ref)
    return hits[0] if hits else None


def main(argv):
    profile = "default"
    if argv[:1] == ["-p"]:
        profile, argv = argv[1], argv[2:]
    pdir = HOME if profile == "default" else HOME / "profiles" / profile
    assert argv[0] == "cron"
    action, rest = argv[1], argv[2:]
    if action == "incidents":
        if rest[:1] != ["ack"] or len(rest) < 2:
            fail("Incident ID required: hermes cron incidents ack <incident_id>")
        con = sqlite3.connect(pdir / "cron" / "executions.db")
        cur = con.execute("UPDATE cron_incidents SET state='closed', closed_at=?, acked_at=? WHERE id=? AND state != 'closed'",
                          (mf.iso(time.time()), mf.iso(time.time()), rest[1]))
        con.commit()
        con.close()
        if cur.rowcount:
            out("✓ Incident %s acknowledged (closed)." % rest[1])
        else:
            out("Incident %s not found or already closed." % rest[1], YELLOW)
        return 0
    path, doc, jobs = load(pdir)
    job = find(jobs, rest[0])
    if job is None:
        fail("Failed to %s job: Job not found: %s" % (action, rest[0]))
    if action == "pause":
        job.update(enabled=False, state="paused", paused_at=mf.iso(time.time()))
        save(path, doc)
        out("Paused job: %s (%s)" % (job["name"], job["id"]))
    elif action == "resume":
        job.update(enabled=True, state="scheduled", paused_at=None)
        save(path, doc)
        out("Resumed job: %s (%s)" % (job["name"], job["id"]))
        sys.stdout.write("  Next run: %s\n" % job.get("next_run_at"))
    elif action == "edit":
        sched = rest[rest.index("--schedule") + 1]
        if "bad" in sched:
            fail("Failed to update job: Invalid schedule '%s'" % sched)
        job["schedule"] = {"kind": "cron", "expr": sched, "display": sched}
        job["schedule_display"] = sched
        save(path, doc)
        out("Updated job: %s" % job["id"])
        sys.stdout.write("  Name: %s\n  Schedule: %s\n" % (job["name"], sched))
    elif action == "run":
        start = time.time()
        con = mf.make_cron_ledger(pdir / "cron" / "executions.db")
        eid = "m%d" % int(start * 1000)
        mf.add_execution(con, eid, job["id"], "running", start, start, source="direct", scheduled=False)
        job["fire_claim"] = {"at": mf.iso(start), "by": "fake"}
        save(path, doc)
        time.sleep(float(os.environ.get("MC_FAKE_CRON_RUN_S", "0.5")))
        end = time.time()
        name = time.strftime("%Y-%m-%d_%H-%M-%S", time.localtime(end)) + ".md"
        mf.add_output(pdir, job["id"], name, "manual run\nline two\nfresh line %d\n" % int(end))
        con.execute("UPDATE executions SET status='completed', finished_at=? WHERE id=?", (mf.iso(end), eid))
        if "cron_incidents" in {r[0] for r in con.execute("SELECT name FROM sqlite_master")}:
            con.execute("UPDATE cron_incidents SET state='resolved', closed_at=? WHERE job_id=? AND state IN ('detected','alerted')",
                        (mf.iso(end), job["id"]))
        con.commit()
        con.close()
        path, doc, jobs = load(pdir)
        job = find(jobs, rest[0])
        job.update(fire_claim=None, last_run_at=mf.iso(end), last_status="ok", last_error=None, failure_streak=0)
        save(path, doc)
        out("Triggered job: %s (%s)" % (job["name"], job["id"]))
        sys.stdout.write("  Next run: %s\n  Ran now: succeeded.\n" % job.get("next_run_at"))
    else:
        fail("Unknown cron command: %s" % action)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
