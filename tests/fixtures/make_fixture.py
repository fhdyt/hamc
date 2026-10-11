"""Builds a fake Linux /proc, /sys and ~/.hermes tree for tests.

Used by pytest (import) and by the TypeScript integration tests
(`python make_fixture.py init <root>`).
"""
import hashlib
import json
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path

CORES = 4
GATEWAY_PID = 1842
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
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, timestamp REAL, active INTEGER DEFAULT 1)")
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, ended_at REAL)")
    for ts, active in messages:
        con.execute("INSERT INTO messages (role, content, timestamp, active) VALUES ('user', 'x', ?, ?)", (ts, active))
    for i, ended in enumerate(sessions):
        con.execute("INSERT INTO sessions (id, started_at, ended_at) VALUES (?, 0, ?)", (f"s{i}", ended))
    con.commit()
    return con


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

    w(home / "gateway_state.json", json.dumps({"served_profiles": ["default", "scout"], "heartbeat": now, "platforms": {"telegram": {"connected": True}}}))
    w(home / "gateway.pid", str(GATEWAY_PID))
    w(home / "config.yaml", "model:\n  default: x/y\n")
    w(home / "SOUL.md", "soul\n")
    w(home / "memories" / "MEMORY.md", "m\n")
    w(home / "memories" / "USER.md", "u\n")
    w(home / ".env", "SECRET_SENTINEL=do-not-read\n")
    w(home / "auth.json", '{"token": "SECRET_SENTINEL"}\n')
    make_db(home / "state.db", messages=[(now - 3600, 1)]).close()

    scout = add_profile(home, "scout", display_name="Scout", markers=("config.yaml",))
    make_db(scout / "state.db", messages=[(now - 10, 1), (now - 1, 0)]).close()
    add_profile(home, "atlas", markers=("SOUL.md",))
    (home / "profiles" / "empty").mkdir(parents=True, exist_ok=True)
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
    elif cmd == "advance":
        advance(load(Path(sys.argv[2])), int(sys.argv[3]))
    else:
        raise SystemExit(f"unknown command {cmd}")
