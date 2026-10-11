import builtins
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def jobs_by_name(data):
    return {j["name"]: j for j in data["jobs"]}


# ---- iso_to_epoch ---------------------------------------------------------

def test_iso_with_positive_offset():
    epoch, off = c.iso_to_epoch("2026-10-11T23:00:00+07:00")
    assert off == 420
    assert epoch == 1_791_734_400  # 2026-10-11T16:00:00Z


def test_iso_with_z_and_negative_offsets_and_fraction():
    assert c.iso_to_epoch("1970-01-01T00:00:00Z") == (0, 0)
    e, off = c.iso_to_epoch("1970-01-01T03:30:00.5-03:30")
    assert off == -210 and e == 25200.5
    e2, off2 = c.iso_to_epoch("1970-01-01 07:00:00+0700")
    assert off2 == 420 and e2 == 0


def test_iso_garbage_and_none():
    for v in (None, "", "yesterday", "2026-13-40T99:99:99Z", [], {}, True):
        assert c.iso_to_epoch(v) == (None, None)


def test_numeric_timestamps_pass_through():
    assert c.iso_to_epoch(1_760_000_000) == (1_760_000_000.0, None)
    assert c.iso_to_epoch(1_760_000_000_000)[0] == 1_760_000_000.0


# ---- normalize_job --------------------------------------------------------

def norm(**over):
    return c.normalize_job("scout", mf.real_job(**over))


def test_normalizes_a_real_job():
    j = norm(last_status="error", last_error="boom", failure_streak=10)
    assert j["profile"] == "scout"
    assert j["id"] == "09358c101c91"
    assert j["name"] == "second-brain-daily-sync"
    assert j["schedule"] == {"kind": "cron", "expr": "0 23 * * *", "display": "0 23 * * *"}
    assert j["state"] == "scheduled"
    assert j["enabled"] is True
    assert j["tzOffsetMin"] == 420
    assert j["nextRunTs"] == 1_791_734_400
    assert j["lastStatus"] == "error"
    assert j["lastError"] == "boom"
    assert j["failureStreak"] == 10
    assert j["deliver"] == "local"
    assert j["model"] == "deepseek-v4-flash" and j["provider"] == "deepseek"
    assert j["repeat"] == {"times": None, "completed": 39}
    assert j["lastOutput"] is None
    json.dumps(j, allow_nan=False)


def test_state_mapping():
    assert norm(state="paused")["state"] == "paused"
    assert norm(enabled=False)["state"] == "paused"
    assert norm(state="running")["state"] == "running"
    assert norm(fire_claim={"by": "x"})["state"] == "running"
    assert norm(state="completed")["state"] == "completed"
    assert norm(repeat={"times": 3, "completed": 3})["state"] == "completed"
    assert norm(repeat={"times": 3, "completed": 1})["state"] == "scheduled"
    assert norm(state="something-new")["state"] == "scheduled"


def test_last_status_is_lowercased_and_never_run_is_none():
    assert norm(last_status="DELIVERY_FAILED")["lastStatus"] == "delivery_failed"
    assert norm(last_status=None)["lastStatus"] is None
    assert norm(last_status="")["lastStatus"] is None


def test_model_and_provider_fall_back_to_snapshots():
    j = norm(model=None, provider=None, model_snapshot="m1", provider_snapshot="custom")
    assert j["model"] == "m1" and j["provider"] == "custom"
    j = norm(model=None, provider=None)
    assert j["model"] is None and j["provider"] is None


def test_skills_are_merged_without_duplicates():
    assert norm(skills=["a", "b"], skill="b")["skills"] == ["a", "b"]
    assert norm(skills=[], skill="solo")["skills"] == ["solo"]
    assert norm(skills=None, skill=None)["skills"] == []


def test_long_text_is_truncated():
    j = norm(prompt="p" * 9000, last_error="e" * 900, last_delivery_error="d" * 900)
    assert len(j["prompt"]) == 4000
    assert len(j["lastError"]) == 500
    assert len(j["lastDeliveryError"]) == 500


def test_schedule_display_falls_back():
    assert norm(schedule={"kind": "cron", "expr": "0 5 * * *"}, schedule_display="every day")["schedule"]["display"] == "every day"
    assert norm(schedule={"kind": "cron", "expr": "0 5 * * *"}, schedule_display=None)["schedule"]["display"] == "0 5 * * *"
    assert norm(schedule=None, schedule_display=None)["schedule"] == {"kind": "unknown", "expr": None, "display": ""}


def test_missing_id_drops_the_job_and_name_falls_back_to_id():
    assert c.normalize_job("p", {"name": "no id"}) is None
    assert c.normalize_job("p", "not a dict") is None
    assert norm(name=None)["name"] == "09358c101c91"


def test_wrong_types_do_not_crash():
    j = norm(repeat="x", failure_streak="3", skills="abc", schedule="nope", next_run_at=12345, last_run_at=[])
    assert j["repeat"] == {"times": None, "completed": 0}
    assert j["failureStreak"] == 3
    assert j["skills"] == []
    assert j["nextRunTs"] == 12345.0
    assert j["lastRunTs"] is None


# ---- find_last_output -----------------------------------------------------

def test_finds_the_newest_file_in_the_job_folder(fx):
    out = c.find_last_output(str(fx.home), "09358c101c91")
    assert out["rel"] == "09358c101c91/2026-10-10_23-00-25.md"
    assert out["mtime"] == fx.now - 3600


def test_finds_a_loose_legacy_file(fx):
    scout = fx.home / "profiles" / "scout"
    out = c.find_last_output(str(scout), "bbbbbbbbbbbb")
    assert out["rel"] == "bbbbbbbbbbbb_20260920_190257.txt"


def test_the_newest_of_folder_and_loose_files_wins(fx):
    scout = fx.home / "profiles" / "scout"
    mf.add_output(scout, "bbbbbbbbbbbb", "2026-10-10_21-00-00.md", "newer", mtime=fx.now - 10)
    assert c.find_last_output(str(scout), "bbbbbbbbbbbb")["rel"] == "bbbbbbbbbbbb/2026-10-10_21-00-00.md"


def test_no_output_directory_or_no_matching_files(fx):
    assert c.find_last_output(str(fx.home / "profiles" / "atlas"), "x") is None
    assert c.find_last_output(str(fx.home), "does-not-exist") is None


def test_unsafe_names_are_rejected(fx):
    mf.add_output(fx.home, "09358c101c91", "bad name.md", "x", mtime=fx.now)
    # the newer file with a space in its name is skipped, so the previous valid one still wins
    assert c.find_last_output(str(fx.home), "09358c101c91")["rel"] == "09358c101c91/2026-10-10_23-00-25.md"
    assert c.find_last_output(str(fx.home), "../etc") is None
    assert c.find_last_output(str(fx.home), "a/b") is None


def test_a_loose_file_where_a_directory_is_expected_does_not_crash(fx):
    scout = fx.home / "profiles" / "scout"
    (scout / "cron" / "output" / "cccccccccccc").write_text("i am a file, not a dir")
    assert c.find_last_output(str(scout), "cccccccccccc") is None


# ---- collect_cron ---------------------------------------------------------

def test_collects_jobs_from_every_profile(fx):
    data = c.collect_cron(str(fx.home))
    names = jobs_by_name(data)
    assert set(names) == {"second-brain-daily-sync", "never-ran", "Pantau pembaruan"}
    assert names["second-brain-daily-sync"]["profile"] == "default"
    assert names["second-brain-daily-sync"]["lastOutput"]["rel"] == "09358c101c91/2026-10-10_23-00-25.md"
    assert names["never-ran"]["lastStatus"] is None and names["never-ran"]["lastRunTs"] is None
    assert names["Pantau pembaruan"]["deliver"] == "telegram:744164478"
    assert names["Pantau pembaruan"]["lastOutput"]["rel"] == "bbbbbbbbbbbb_20260920_190257.txt"
    assert {p["profile"]: p["ok"] for p in data["profiles"]} == {"default": True, "scout": True, "atlas": True}


def test_a_broken_jobs_file_is_reported_and_other_profiles_still_work(fx):
    mf.add_cron_jobs(fx.home / "profiles" / "atlas", [], raw="{not json")
    data = c.collect_cron(str(fx.home))
    atlas = next(p for p in data["profiles"] if p["profile"] == "atlas")
    assert atlas["ok"] is False and atlas["error"] == "invalid_json"
    assert len(data["jobs"]) == 3


def test_a_bare_list_and_an_unexpected_shape(fx):
    atlas = fx.home / "profiles" / "atlas"
    mf.add_cron_jobs(atlas, [mf.real_job(id="dddddddddddd", name="from-list")], as_list=True)
    assert "from-list" in jobs_by_name(c.collect_cron(str(fx.home)))
    mf.add_cron_jobs(atlas, [], raw='"just a string"')
    data = c.collect_cron(str(fx.home))
    assert next(p for p in data["profiles"] if p["profile"] == "atlas")["error"] == "unexpected_shape"


def test_job_count_limits(fx):
    many = [mf.real_job(id="%012d" % i, name="job%d" % i) for i in range(250)]
    mf.add_cron_jobs(fx.home / "profiles" / "atlas", many)
    data = c.collect_cron(str(fx.home))
    atlas_jobs = [j for j in data["jobs"] if j["profile"] == "atlas"]
    assert len(atlas_jobs) == 200
    atlas = next(p for p in data["profiles"] if p["profile"] == "atlas")
    assert "200" in atlas["error"]


def test_total_job_limit(monkeypatch, fx):
    monkeypatch.setattr(c, "CRON_MAX_JOBS", 3)
    data = c.collect_cron(str(fx.home))
    assert len(data["jobs"]) == 3


def test_digest_is_stable_and_changes_with_content(fx):
    a = c.cron_digest(c.collect_cron(str(fx.home)))
    assert a == c.cron_digest(c.collect_cron(str(fx.home)))
    mf.add_cron_jobs(fx.home, [mf.real_job(last_status="ok")])
    assert c.cron_digest(c.collect_cron(str(fx.home))) != a


def test_never_opens_secret_files_while_collecting_cron(fx, monkeypatch):
    opened = []
    real_open = builtins.open

    def spy(file, *a, **k):
        opened.append(str(file))
        return real_open(file, *a, **k)

    monkeypatch.setattr(builtins, "open", spy)
    c.collect_cron(str(fx.home))
    assert any(p.endswith("jobs.json") for p in opened)
    assert not [p for p in opened if p.endswith(".env") or p.endswith("auth.json")]
    assert not [p for p in opened if "output" in p], "run output must not be read by the collector"


def test_collector_source_has_no_non_ascii():
    (ROOT / "collector" / "mc_collector.py").read_bytes().decode("ascii")


# ---- streaming ------------------------------------------------------------

def env_for(fx):
    return {**os.environ, "MC_PROC_ROOT": str(fx.proc), "MC_SYS_ROOT": str(fx.sysfs)}


def test_cron_event_is_sent_once_and_again_after_a_change(fx):
    p = subprocess.Popen(
        [sys.executable, "-u", str(SCRIPT), str(fx.home), "--interval", "0.05", "--agents-interval", "0.2"],
        env=env_for(fx), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        seen = []
        deadline = time.time() + 20
        while time.time() < deadline:
            line = p.stdout.readline()
            if not line:
                break
            ev = json.loads(line)
            if ev["type"] == "cron":
                seen.append(ev)
                if len(seen) == 1:
                    mf.add_cron_jobs(fx.home, [mf.real_job(last_status="ok", failure_streak=0)])
                elif len(seen) == 2:
                    break
        assert len(seen) == 2
        assert seen[0]["profile"] is None
        assert seen[0]["data"]["jobs"][0]["lastStatus"] == "error"
        assert seen[1]["data"]["jobs"][0]["lastStatus"] == "ok"
    finally:
        p.kill()
        p.stdout.close()
        p.stderr.close()


def test_unchanged_cron_is_not_resent(fx):
    r = subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "12", "--interval", "0.05", "--agents-interval", "0.1"],
        input=SCRIPT.read_bytes(), env=env_for(fx), capture_output=True, timeout=30,
    )
    kinds = [json.loads(line)["type"] for line in r.stdout.decode("ascii").splitlines()]
    assert kinds.count("agents") >= 2
    assert kinds.count("cron") == 1


def test_zero_change_with_cron(fx):
    before = mf.snapshot(fx.root)
    subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "3", "--interval", "0.05", "--agents-interval", "0.1"],
        input=SCRIPT.read_bytes(), env=env_for(fx), capture_output=True, timeout=30, check=True,
    )
    assert mf.snapshot(fx.root) == before
