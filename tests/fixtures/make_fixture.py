"""Builds a fake Linux /proc, /sys and ~/.hermes tree for tests.

Used by pytest (import) and by the TypeScript integration tests
(`python make_fixture.py init <root>`).
"""
import datetime
import hashlib
import json
import sqlite3
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

CORES = 4
GATEWAY_PID = 1842
SCOUT_GATEWAY_PID = 2001
MEMINFO = """MemTotal:       16384000 kB
MemFree:         4608000 kB
MemAvailable:   10137600 kB
Buffers:          102400 kB
Cached:          5324800 kB
SReclaimable:     204800 kB
SwapTotal:       2097152 kB
SwapFree:        2000000 kB
"""


@dataclass
class Fixture:
    root: Path
    proc: Path
    sysfs: Path
    home: Path
    now: float

    @property
    def vault(self) -> Path:
        return self.root / "home" / "vault"


def w(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def esc_mount(p: Path) -> str:
    return str(p).replace(" ", "\\040")


def write_cpu(proc: Path, step: int) -> None:
    rows, tu, ti = [], 0, 0
    for i in range(CORES):
        user, idle = 100 + 40 * step, 900 + 60 * step
        rows.append(f"cpu{i} {user} 0 0 {idle} 0 0 0 0 0 0")
        tu += user
        ti += idle
    w(proc / "stat", f"cpu  {tu} 0 0 {ti} 0 0 0 0 0 0\n" + "\n".join(rows) + "\nintr 0\n")


def write_net(proc: Path, step: int) -> None:
    rx, tx = 1_000_000 + 500_000 * step, 200_000 + 100_000 * step
    w(
        proc / "net" / "dev",
        "Inter-|   Receive                                                |  Transmit\n"
        " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n"
        "    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0\n"
        f"  eth0: {rx} 10 0 0 0 0 0 0 {tx} 10 0 0 0 0 0 0\n",
    )


def write_diskstats(proc: Path, step: int) -> None:
    rs, ws = 1000 + 2048 * step, 500 + 1024 * step
    w(
        proc / "diskstats",
        f"   8       0 vda 100 0 {rs} 10 50 0 {ws} 10 0 0 0\n"
        f"   8       1 vda1 100 0 99999 10 50 0 99999 10 0 0 0\n",
    )


def write_proc(proc: Path, pid: int, comm: str, uid: int, ticks: int, rss_pages: int, cmdline: list[str], start: int = 100) -> None:
    base = proc / str(pid)
    w(
        base / "stat",
        f"{pid} ({comm}) S 1 {pid} {pid} 0 -1 4194560 0 0 0 0 {ticks} 0 0 0 20 0 1 0 {start} 1000000 {rss_pages} 0\n",
    )
    w(base / "status", f"Name:\t{comm}\nUid:\t{uid}\t{uid}\t{uid}\t{uid}\n")
    w(base / "cmdline", "\0".join(cmdline) + "\0")


def write_gateway_proc(proc: Path, step: int) -> None:
    write_proc(proc, GATEWAY_PID, "python", 0, 1000 + 25 * step, 25600, ["python", "-m", "hermes_cli.main", "gateway", "run"])


def iso(ts: float, offset_min: int = 420) -> str:
    tz = datetime.timezone(datetime.timedelta(minutes=offset_min))
    return datetime.datetime.fromtimestamp(ts, tz).isoformat()


def write_gateway_state(pdir: Path, pid: int, state: str = "running", updated_at: float | None = None,
                        platforms: dict | None = None, exit_reason=None) -> None:
    """Shape observed on a real Hermes v0.21.0 install: one gateway per profile, no served_profiles/heartbeat."""
    w(
        pdir / "gateway_state.json",
        json.dumps({
            "pid": pid, "kind": "gateway", "argv": ["hermes", "gateway", "run"], "start_time": 1,
            "gateway_state": state, "exit_reason": exit_reason, "restart_requested": False, "active_agents": 1,
            "platforms": platforms if platforms is not None else {"telegram": {"state": "connected", "error_code": None}},
            "updated_at": iso(updated_at if updated_at is not None else time.time()),
            "code_sha": "abc", "code_version": "0.21.0", "session_store": {"status": "ok"},
        }),
    )


def set_updated_at(fx, ts: float) -> None:
    state = json.loads((fx.home / "gateway_state.json").read_text())
    state["updated_at"] = iso(ts)
    w(fx.home / "gateway_state.json", json.dumps(state))


def make_multiplex(fx) -> None:
    """Older layout: one gateway at the home serves several profiles."""
    w(fx.home / "gateway_state.json", json.dumps({"served_profiles": ["default", "atlas"], "heartbeat": fx.now, "platforms": {"telegram": {}}}))
    w(fx.home / "gateway.pid", str(GATEWAY_PID))
    (fx.home / "profiles" / "scout" / "gateway_state.json").unlink(missing_ok=True)


def real_job(**over) -> dict:
    """A job shaped like the ones observed on a real Hermes v0.21.0 install (see the M2 spec, section 3)."""
    job = {
        "id": "09358c101c91", "name": "second-brain-daily-sync", "prompt": "p" * 835, "skills": [], "skill": None,
        "model": "deepseek-v4-flash", "provider": "deepseek", "provider_snapshot": None, "model_snapshot": None,
        "base_url": None, "script": None, "no_agent": False, "monitor_script": None, "monitor_url": None,
        "monitor_state": None, "context_from": None,
        "schedule": {"kind": "cron", "expr": "0 23 * * *", "display": "0 23 * * *"}, "schedule_display": "0 23 * * *",
        "repeat": {"times": None, "completed": 39}, "enabled": True, "state": "scheduled",
        "paused_at": None, "paused_reason": None, "created_at": "2026-09-02T13:56:42.774959+07:00",
        "next_run_at": "2026-10-11T23:00:00+07:00", "last_run_at": "2026-10-10T23:00:25.600238+07:00",
        "last_status": "ok", "last_error": None, "last_delivery_error": None, "failure_streak": 0,
        "deliver": "local", "origin": None, "enabled_toolsets": None, "workdir": None,
        "last_dispatch": {"scheduled_at": "2026-10-10T23:00:00+07:00", "dispatched_at": "2026-10-10T23:00:22.431462+07:00",
                          "lateness_seconds": 22.4, "kind": "on_time"},
        "fire_claim": None,
    }
    job.update(over)
    return job


def add_cron_jobs(pdir: Path, jobs, as_list: bool = False, raw: str | None = None) -> None:
    if raw is not None:
        w(pdir / "cron" / "jobs.json", raw)
        return
    payload = jobs if as_list else {"jobs": jobs, "updated_at": "2026-10-10T23:00:25.600932+07:00"}
    w(pdir / "cron" / "jobs.json", json.dumps(payload))


def add_output(pdir: Path, job_id: str, name: str, text: str = "out\n", loose: bool = False, mtime: float | None = None) -> Path:
    base = pdir / "cron" / "output"
    path = base / name if loose else base / job_id / name
    w(path, text)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def advance(fx: Fixture, step: int) -> None:
    write_cpu(fx.proc, step)
    write_net(fx.proc, step)
    write_diskstats(fx.proc, step)
    write_gateway_proc(fx.proc, step)


def make_db(path: Path, messages=(), sessions=(), wal: bool = False) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    if wal:
        con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_name TEXT, "
        "reasoning TEXT, reasoning_content TEXT, timestamp REAL, active INTEGER DEFAULT 1)"
    )
    con.execute(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, parent_session_id TEXT, model TEXT, title TEXT, started_at REAL, ended_at REAL, "
        "message_count INTEGER, tool_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, "
        "estimated_cost_usd REAL, actual_cost_usd REAL, cache_read_tokens INTEGER, end_reason TEXT, cost_status TEXT, pinned INTEGER DEFAULT 0)"
    )
    for ts, active in messages:
        con.execute("INSERT INTO messages (role, content, timestamp, active) VALUES ('user', 'x', ?, ?)", (ts, active))
    for i, ended in enumerate(sessions):
        con.execute("INSERT INTO sessions (id, started_at, ended_at) VALUES (?, 0, ?)", (f"s{i}", ended))
    con.commit()
    return con


def add_session(db: Path, sid: str, source: str = "telegram", started_at: float = 0.0, parent: str | None = None,
                model: str = "deepseek-v4-flash", ended_at: float | None = None, **cols) -> None:
    con = sqlite3.connect(db)
    con.execute(
        "INSERT INTO sessions (id, source, parent_session_id, model, started_at, ended_at) VALUES (?,?,?,?,?,?)",
        (sid, source, parent, model, started_at, ended_at),
    )
    for k, v in cols.items():
        con.execute("UPDATE sessions SET %s = ? WHERE id = ?" % k, (v, sid))
    con.commit()
    con.close()


def add_fts(db: Path) -> None:
    """The message index Hermes keeps: an FTS5 table over messages.content, keyed by messages.id."""
    con = sqlite3.connect(db)
    con.execute("CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='id')")
    con.execute("INSERT INTO messages_fts(rowid, content) SELECT id, content FROM messages WHERE content IS NOT NULL")
    con.commit()
    con.close()


def add_message(db: Path, sid: str | None, role: str, content=None, ts: float = 0.0, tool_calls=None, tool_name=None,
                reasoning=None, reasoning_content=None, active: int = 1) -> int:
    con = sqlite3.connect(db)
    tc = tool_calls if (tool_calls is None or isinstance(tool_calls, str)) else json.dumps(tool_calls)
    cur = con.execute(
        "INSERT INTO messages (session_id, role, content, tool_calls, tool_name, reasoning, reasoning_content, timestamp, active) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (sid, role, content, tc, tool_name, reasoning, reasoning_content, ts, active),
    )
    con.commit()
    mid = cur.lastrowid
    con.close()
    return mid


def add_kanban_db(path: Path, tasks, events=(), variant: str = "a") -> None:
    """tasks: (id, title, assignee, creator, status, created_at); events: (id, task_id, ts, kind, body)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    if variant == "a":
        con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, assignee TEXT, created_by TEXT, status TEXT, created_at REAL)")
    else:  # other column names a different Hermes version might use
        con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, assignee_profile TEXT, creator TEXT, state TEXT, created REAL)")
    con.execute("CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id INTEGER, ts REAL, kind TEXT, body TEXT)")
    for t in tasks:
        con.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?)", t)
    for e in events:
        con.execute("INSERT INTO task_events VALUES (?,?,?,?,?)", e)
    con.commit()
    con.close()


def add_interactions(fx: Fixture) -> None:
    """Interactions between default, scout and atlas, on top of make_fixture (never part of its defaults)."""
    now, home = fx.now, fx.home
    atlas, scout = home / "profiles" / "atlas", home / "profiles" / "scout"
    ad, sd, dd = atlas / "state.db", scout / "state.db", home / "state.db"
    make_db(ad).close()
    w(atlas / "profile.yaml", 'display_name: "Atlas"\n')
    # message_agent: atlas -> scout twice, plus one from a handle that is no profile
    add_session(sd, "s-bot", "bot", now - 3000, title="Bot Chat")
    add_message(sd, "s-bot", "user", "Message from Atlas (@atlas): ping me when the digest is ready", now - 2000)
    add_message(sd, "s-bot", "user", "Message from Atlas (@atlas): still waiting", now - 100)
    add_message(sd, "s-bot", "user", "Message from nobody (@ghost): who am i", now - 90)
    # a group room with all three agents
    for db, sid in ((ad, "s-room-a"), (sd, "s-room-s"), (dd, "s-room-d")):
        add_session(db, sid, "group", now - 5000, title="Group: ops-room · main")
    add_message(sd, "s-room-s", "assistant", "disk alert cleared", now - 40)
    add_message(dd, "s-room-d", "user", "thanks", now - 4000)
    # delegate_task: scout already has s-scout-child (parent s-scout-1); atlas gets a running subagent
    add_session(ad, "s-atlas-1", "cli", now - 600)
    add_session(ad, "s-atlas-sub", "subagent", now - 30, parent="s-atlas-1", title="research")
    add_message(ad, "s-atlas-sub", "assistant", "reading", now - 20)
    # kanban: atlas -> scout #41 (done), scout -> default #42 (running), #43 created by an unknown name
    add_kanban_db(
        home / "kanban.db",
        tasks=[(41, "Find sources for the changelog", "scout", "atlas", "done", now - 7000),
               (42, "Draft the weekly digest", "default", "scout", "running", now - 500),
               (43, "Orphan task", "scout", "ghost", "todo", now - 400)],
        events=[(1, 41, now - 6000, "completed", "sources attached"), (2, 42, now - 60, "comment", "notes ready")],
    )


def add_profile(home: Path, name: str, display_name: str | None = None, markers=("SOUL.md",)) -> Path:
    pdir = home / "profiles" / name
    pdir.mkdir(parents=True, exist_ok=True)
    for m in markers:
        w(pdir / m, "x\n")
    if display_name:
        w(pdir / "profile.yaml", f'display_name: "{display_name}"\n')
    return pdir


def set_heartbeat(fx: Fixture, ts: float) -> None:
    state = json.loads((fx.home / "gateway_state.json").read_text())
    state["heartbeat"] = ts
    w(fx.home / "gateway_state.json", json.dumps(state))


VAULT_NOTES = {
    "Index.md": "---\ntags: [home, hub]\n---\n# Index\nStart with [[Alpha]] and [[Beta|the beta note]].\nSee [[folder/Gamma#Heading]] and ![[diagram.png]].\nTodo: [[Missing Note]] #project/x #idea\n",
    "Alpha.md": "---\naliases:\n  - A\n  - First\ntags:\n  - alpha\n  - work\n---\nBack to [[Index]]. Also [Beta](Beta.md) and [site](https://example.com/x.md).\n",
    "Beta.md": "Beta links to [[a]] (an alias) and [[ALPHA]] and [[Orphan]]. Not a tag: # heading and issue #123.\n",
    "folder/Gamma.md": "Gamma goes [[Index]].\n```\n#notatag [[InCode]]\n```\nInline `[[AlsoCode]]` here. #nested/tag\n",
    "folder/Alpha.md": "A second Alpha in a folder, links [[Index]].\n",
    "Orphan.md": "Nobody links here.\n",
    ".obsidian/app.json": "{}\n",
    ".git/ignored.md": "[[Index]]\n",
    ".trash/old.md": "[[Index]]\n",
}


def make_vault(fx: Fixture, notes: dict[str, str] | None = None) -> Path:
    for rel, text in (VAULT_NOTES if notes is None else notes).items():
        w(fx.vault / rel, text)
    return fx.vault


def make_synthetic_vault(root: Path, n: int, links_per_note: int = 4, seed: int = 7) -> int:
    """n notes in about sqrt(n) folders, each linking to a few others (power-law-ish), plus some tags."""
    import random

    rnd = random.Random(seed)
    communities = max(4, n // 120)  # notes link mostly inside their own community (= folder), with a few links across
    names = [f"area-{i % communities}/Note {i}" for i in range(n)]
    linked = n - n // 8  # the last eighth are orphans: they link nowhere and nothing links to them
    members = [[i for i in range(linked) if i % communities == c] for c in range(communities)]
    for i, name in enumerate(names):
        out = []
        for _ in range(links_per_note if i < linked else 0):
            if rnd.random() < 0.97:
                pool = members[i % communities]
                j = pool[int(len(pool) * rnd.random() ** 2)]  # a few hubs per community
            else:
                j = int(linked * rnd.random())
            if j != i:
                out.append(f"[[{names[j].split('/')[1]}]]")
        w(Path(root) / f"{name}.md", f"#t{i % 40} " + " ".join(out) + "\n")
    return n


def make_fixture(root: Path, now: float | None = None) -> Fixture:
    now = time.time() if now is None else now
    root = Path(root)
    proc, sysfs, home = root / "proc", root / "sys", root / "home" / ".hermes"
    fx = Fixture(root, proc, sysfs, home, now)
    (root / "disk").mkdir(parents=True, exist_ok=True)
    (root / "data").mkdir(parents=True, exist_ok=True)

    w(proc / "meminfo", MEMINFO)
    w(proc / "loadavg", "1.42 0.98 0.77 2/214 30000\n")
    w(proc / "uptime", "1038240.55 4000000.00\n")
    w(
        proc / "mounts",
        "proc /proc proc rw 0 0\n"
        f"/dev/vda1 {esc_mount(root / 'disk')} ext4 rw 0 0\n"
        f"/dev/vda2 {esc_mount(root / 'data')} ext4 rw 0 0\n"
        "tmpfs /run tmpfs rw 0 0\n",
    )
    w(sysfs / "class" / "thermal" / "thermal_zone0" / "temp", "52000\n")
    advance(fx, 0)
    write_proc(proc, 1, "systemd", 0, 500, 2000, ["/sbin/init"])
    write_proc(proc, 912, "node", 1000, 800, 40000, ["node", "/srv/app/server.js"])

    write_gateway_state(home, GATEWAY_PID, updated_at=now, platforms={"telegram": {"state": "connected"}, "lightclawbot": {"state": "connected"}})
    write_proc(proc, SCOUT_GATEWAY_PID, "python", 0, 300, 20000, ["python", "-m", "hermes_cli.main", "gateway", "run"])
    w(home / "config.yaml", "model:\n  default: x/y\n")
    w(home / "SOUL.md", "soul\n")
    w(home / "memories" / "MEMORY.md", "m\n")
    w(home / "memories" / "USER.md", "u\n")
    w(home / ".env", "SECRET_SENTINEL=do-not-read\n")
    w(home / "auth.json", '{"token": "SECRET_SENTINEL"}\n')
    make_db(home / "state.db", messages=[(now - 3600, 1)]).close()

    scout = add_profile(home, "scout", display_name="Scout", markers=("config.yaml",))
    write_gateway_state(scout, SCOUT_GATEWAY_PID, updated_at=now, platforms={"telegram": {"state": "connected"}})
    make_db(scout / "state.db", messages=[(now - 10, 1), (now - 1, 0)]).close()
    add_cron_jobs(home, [real_job(last_status="error", last_error="x" * 95, failure_streak=10)])
    add_output(home, "09358c101c91", "2026-10-09_23-00-45.md", "older run\n", mtime=now - 90000)
    add_output(home, "09358c101c91", "2026-10-10_23-00-25.md", "latest run\nline two\n", mtime=now - 3600)
    add_cron_jobs(scout, [
        real_job(id="aaaaaaaaaaaa", name="never-ran", last_status=None, last_run_at=None, failure_streak=0,
                 repeat={"times": None, "completed": 0}),
        real_job(id="bbbbbbbbbbbb", name="Pantau pembaruan", deliver="telegram:744164478",
                 monitor_script="watch.py", monitor_state={"last_output_hash": "43e7d505d58f", "last_changed_at": "2026-10-10T21:03:30+07:00"}),
    ])
    add_output(scout, "bbbbbbbbbbbb", "bbbbbbbbbbbb_20260920_190257.txt", "legacy loose file\n", loose=True, mtime=now - 5000)
    add_profile(home, "atlas", markers=("SOUL.md",))
    (home / "profiles" / "empty").mkdir(parents=True, exist_ok=True)

    d = home / "state.db"
    add_session(d, "s-default-1", "telegram", now - 4000, message_count=4, tool_call_count=1, input_tokens=100, output_tokens=50,
                reasoning_tokens=10, estimated_cost_usd=0.02, title="Morning briefing")
    add_session(d, "s-default-old", "cli", now - 3 * 86400, message_count=9, tool_call_count=9, input_tokens=900, output_tokens=900,
                reasoning_tokens=900, estimated_cost_usd=9.0)
    add_message(d, "s-default-1", "user", "hello agent", now - 3900)
    add_message(d, "s-default-1", "assistant", "On it.", now - 3890, reasoning_content="User greets; search first.",
                tool_calls=[{"id": "c1", "type": "function", "function": {"name": "web_search", "arguments": "{\"q\": \"hermes\"}"}}])
    add_message(d, "s-default-1", "tool", "3 results", now - 3889, tool_name="web_search")
    add_message(d, "s-default-1", "assistant", "Here is what I found.", now - 3888)
    sd = scout / "state.db"
    add_session(sd, "s-scout-1", "cron", now - 20, message_count=2, tool_call_count=0, input_tokens=10, output_tokens=5,
                reasoning_tokens=0, actual_cost_usd=0.5, estimated_cost_usd=0.4, title="Digest run")
    add_session(sd, "s-scout-child", "subagent", now - 15, parent="s-scout-1")
    add_message(sd, "s-scout-1", "user", "run the digest", now - 12)
    add_message(sd, "s-scout-1", "assistant", "digest done", now - 11, reasoning="plan: summarise")
    add_message(sd, "s-scout-child", "assistant", "child work", now - 11)
    add_fts(d)
    add_fts(sd)
    make_vault(fx)
    return fx


def load(root: Path) -> Fixture:
    root = Path(root)
    return Fixture(root, root / "proc", root / "sys", root / "home" / ".hermes", time.time())


def snapshot(root: Path) -> dict[str, tuple[int, int, str]]:
    out = {}
    for p in sorted(Path(root).rglob("*")):
        if p.is_file():
            st = p.stat()
            out[str(p.relative_to(root))] = (st.st_size, st.st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "init":
        f = make_fixture(Path(sys.argv[2]))
        print(json.dumps({"root": str(f.root), "proc": str(f.proc), "sysfs": str(f.sysfs), "home": str(f.home)}))
    elif cmd == "add-profile":
        add_profile(Path(sys.argv[2]), sys.argv[3])
    elif cmd == "add-message":
        print(add_message(Path(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6])))
    elif cmd == "add-note":
        w(Path(sys.argv[2]) / sys.argv[3], sys.argv[4])
    elif cmd == "rm-note":
        (Path(sys.argv[2]) / sys.argv[3]).unlink()
    elif cmd == "synthetic-vault":
        print(make_synthetic_vault(Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 4))
    elif cmd == "add-interactions":
        add_interactions(load(Path(sys.argv[2])))
    elif cmd == "advance":
        advance(load(Path(sys.argv[2])), int(sys.argv[3]))
    else:
        raise SystemExit(f"unknown command {cmd}")
