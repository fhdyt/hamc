import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def by_key(events):
    return {(e["profile"], e["file"]): e for e in events}


def test_first_poll_reports_every_file_as_a_baseline(fx):
    st = c.MemoryState()
    ev = by_key(st.poll(str(fx.home)))
    assert set(ev) == {("default", "soul"), ("default", "memory"), ("default", "user"), ("atlas", "soul")}
    m = ev[("default", "memory")]
    assert m["text"] == "m\n" and m["hash"] == hashlib.sha256(b"m\n").hexdigest() and m["truncated"] is False
    assert m["agentTs"] is None and m["agentSession"] is None
    assert st.poll(str(fx.home)) == []


def test_a_change_is_reported_once_with_the_memory_tool_nearby(fx):
    st = c.MemoryState()
    st.poll(str(fx.home))
    path = fx.home / "memories" / "MEMORY.md"
    path.write_text("m\n§\nprefers short answers\n", encoding="utf-8")
    os.utime(path, (fx.now - 3000, fx.now - 3000))
    mf.add_session(fx.home / "state.db", "s-mem", "telegram", fx.now - 3100)
    mf.add_message(fx.home / "state.db", "s-mem", "tool", '{"success": true}', fx.now - 3030, tool_name="memory")
    ev = st.poll(str(fx.home))
    assert len(ev) == 1
    e = ev[0]
    assert (e["profile"], e["file"]) == ("default", "memory")
    assert e["agentTs"] == fx.now - 3030 and e["agentSession"] == "s-mem"
    assert "prefers short answers" in e["text"]
    assert st.poll(str(fx.home)) == []


def test_touch_without_new_content_is_not_reported_and_far_tool_use_does_not_count(fx):
    st = c.MemoryState()
    st.poll(str(fx.home))
    soul = fx.home / "SOUL.md"
    os.utime(soul, (fx.now + 10, fx.now + 10))
    assert st.poll(str(fx.home)) == []
    soul.write_text("soul v2\n")
    os.utime(soul, (fx.now, fx.now))
    mf.add_message(fx.home / "state.db", "s-default-1", "tool", "ok", fx.now - 600, tool_name="memory")
    e = st.poll(str(fx.home))[0]
    assert e["file"] == "soul" and e["agentTs"] is None


def test_new_profile_files_and_big_files(fx):
    st = c.MemoryState()
    st.poll(str(fx.home))
    mf.w(fx.home / "profiles" / "scout" / "memories" / "USER.md", "x" * 300000)
    e = by_key(st.poll(str(fx.home)))[("scout", "user")]
    assert e["truncated"] is True and len(e["text"]) == 262144 and e["size"] == 300000


def test_stream_emits_memory_events(fx, tmp_path):
    env = {**os.environ, "MC_PROC_ROOT": str(fx.proc), "MC_SYS_ROOT": str(fx.sysfs)}
    out = subprocess.run([sys.executable, "-", str(fx.home), "--ticks", "1", "--interval", "0.05"], input=SCRIPT.read_bytes(),
                         capture_output=True, check=True, env=env, timeout=60)
    kinds = [json.loads(ln) for ln in out.stdout.decode().splitlines() if ln.strip()]
    mem = [k for k in kinds if k["type"] == "memory"]
    assert {(m["profile"], m["data"]["file"]) for m in mem} == {("default", "soul"), ("default", "memory"), ("default", "user"), ("atlas", "soul")}
