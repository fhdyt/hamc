import json
import os
import subprocess
import sys
from pathlib import Path

import make_fixture as mf

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def env_for(fx):
    return {**os.environ, "MC_PROC_ROOT": str(fx.proc), "MC_SYS_ROOT": str(fx.sysfs)}


def test_streams_over_stdin_like_the_app_does(fx):
    r = subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "3", "--interval", "0.05"],
        input=SCRIPT.read_bytes(),
        env=env_for(fx),
        capture_output=True,
        timeout=30,
    )
    assert r.returncode == 0, r.stderr.decode()
    assert r.stderr == b""
    events = [json.loads(line) for line in r.stdout.decode("ascii").splitlines()]
    kinds = [e["type"] for e in events]
    assert kinds[0] == "agents"
    assert kinds.count("metrics") == 3
    assert set(kinds) <= {"agents", "metrics", "error"}
    assert all(e["profile"] is None and isinstance(e["ts"], float) for e in events)


def test_exits_quietly_when_the_reader_goes_away(fx):
    p = subprocess.Popen(
        [sys.executable, str(SCRIPT), str(fx.home), "--interval", "0.05"],
        env=env_for(fx),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert p.stdout.readline()
    p.stdout.close()
    assert p.wait(timeout=15) == 0
    assert p.stderr.read() == b""


def test_zero_change_after_a_session(fx):
    before = mf.snapshot(fx.root)
    subprocess.run(
        [sys.executable, "-u", "-", str(fx.home), "--ticks", "2", "--interval", "0.05"],
        input=SCRIPT.read_bytes(),
        env=env_for(fx),
        capture_output=True,
        timeout=30,
        check=True,
    )
    assert mf.snapshot(fx.root) == before


def test_defaults_to_hermes_home_env_when_no_argument(fx):
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--ticks", "1", "--interval", "0.05"],
        env={**env_for(fx), "HERMES_HOME": str(fx.home)},
        capture_output=True,
        timeout=30,
    )
    first = json.loads(r.stdout.decode().splitlines()[0])
    assert first["type"] == "agents"
    assert {a["profile"] for a in first["data"]["agents"]} == {"default", "scout", "atlas"}
