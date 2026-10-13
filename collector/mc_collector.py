#!/usr/bin/env python3
"""Hermes Agent Mission Control collector.

Read-only, stdlib only, ASCII only. The desktop app streams this file over SSH
stdin (`python -u - <hermes_home>`); nothing is ever written to the VPS.
Emits one JSON object per line on stdout.
"""
import calendar
import datetime
import glob
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path

try:
    import pwd
except ImportError:  # Windows dev/test hosts
    pwd = None

PROC = os.environ.get("MC_PROC_ROOT", "/proc")
SYSFS = os.environ.get("MC_SYS_ROOT", "/sys")

try:
    HZ = os.sysconf("SC_CLK_TCK")
    PAGE = os.sysconf("SC_PAGE_SIZE")
except (AttributeError, ValueError, OSError):
    HZ, PAGE = 100, 4096

REAL_FS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "vfat", "exfat", "ntfs", "ntfs3", "fuseblk"}
WHOLE_DISK = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def parse_cpu_stat(text):
    out = {}
    for line in text.splitlines():
        if not line.startswith("cpu"):
            continue
        parts = line.split()
        nums = [int(x) for x in parts[1:9]]
        nums += [0] * (8 - len(nums))
        out[parts[0]] = (nums[3] + nums[4], sum(nums))
    return out


def cpu_pct(prev, cur):
    dtotal = cur[1] - prev[1]
    if dtotal <= 0:
        return 0.0
    didle = cur[0] - prev[0]
    return round(max(0.0, min(100.0, 100.0 * (1.0 - didle / dtotal))), 1)


def parse_meminfo(text):
    info = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        m = re.match(r"\s*(\d+)", rest)
        if m:
            info[key.strip()] = int(m.group(1)) * 1024
    return info


def summarize_mem(info):
    total = info.get("MemTotal", 0)
    free = info.get("MemFree", 0)
    avail = info.get("MemAvailable", free + info.get("Buffers", 0) + info.get("Cached", 0))
    cached = info.get("Cached", 0) + info.get("Buffers", 0) + info.get("SReclaimable", 0)
    swap_total = info.get("SwapTotal", 0)
    return {
        "total": total,
        "used": max(0, total - avail),
        "cached": cached,
        "available": avail,
        "free": free,
        "swapTotal": swap_total,
        "swapUsed": max(0, swap_total - info.get("SwapFree", 0)),
    }


def parse_loadavg(text):
    try:
        values = [float(x) for x in text.split()[:3]]
    except ValueError:
        return [0.0, 0.0, 0.0]
    return values if len(values) == 3 else [0.0, 0.0, 0.0]


def parse_uptime(text):
    try:
        return float(text.split()[0])
    except (ValueError, IndexError):
        return 0.0


def parse_net_dev(text):
    out = {}
    for line in text.splitlines()[2:]:
        name, _, rest = line.partition(":")
        name = name.strip()
        fields = rest.split()
        if not name or name == "lo" or len(fields) < 9:
            continue
        out[name] = (int(fields[0]), int(fields[8]))
    return out


def parse_diskstats(text):
    rd = wr = 0
    for line in text.splitlines():
        f = line.split()
        if len(f) < 10 or not WHOLE_DISK.match(f[2]):
            continue
        rd += int(f[5]) * 512
        wr += int(f[9]) * 512
    return rd, wr


def unescape_mount(s):
    return re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), s)


def parse_mounts(text):
    seen = {}
    for line in text.splitlines():
        f = line.split()
        if len(f) < 3:
            continue
        dev, mount, fs = f[0], unescape_mount(f[1]), f[2]
        if (dev.startswith("/dev/") and fs in REAL_FS) or (mount == "/" and fs in REAL_FS | {"overlay"}):
            seen[mount] = fs
    return list(seen.items())


def disk_list():
    out = []
    for mount, fs in parse_mounts(read_text(PROC + "/mounts") or ""):
        try:
            u = shutil.disk_usage(mount)
        except OSError:
            continue
        out.append({"mount": mount, "fs": fs, "total": int(u.total), "used": int(u.used)})
    return out[:16]


def read_temp():
    best = None
    for p in glob.glob(os.path.join(SYSFS, "class", "thermal", "thermal_zone*", "temp")):
        text = read_text(p)
        try:
            v = int((text or "").strip()) / 1000.0
        except ValueError:
            continue
        if best is None or v > best:
            best = v
    return round(best, 1) if best is not None else None


_user_cache = {}
_static_cache = {}


def uid_name(uid):
    if uid not in _user_cache:
        name = str(uid)
        if pwd is not None:
            try:
                name = pwd.getpwuid(uid).pw_name
            except KeyError:
                pass
        _user_cache[uid] = name
    return _user_cache[uid]


def scan_procs():
    out = {}
    try:
        names = os.listdir(PROC)
    except OSError:
        return out
    me = os.getpid()
    live = set()
    for name in names:
        if not name.isdigit():
            continue
        base = PROC + "/" + name
        stat = read_text(base + "/stat")
        if not stat:
            continue
        rp = stat.rfind(")")
        if rp < 0:
            continue
        f = stat[rp + 2:].split()
        if len(f) < 22:
            continue
        pid = int(name)
        start = int(f[19])
        key = (pid, start)
        live.add(key)
        if key not in _static_cache:
            comm = stat[stat.find("(") + 1:rp]
            uid = 0
            m = re.search(r"^Uid:\s+(\d+)", read_text(base + "/status") or "", re.M)
            if m:
                uid = int(m.group(1))
            cmd = (read_text(base + "/cmdline") or "").replace("\0", " ").strip() or "[" + comm + "]"
            if pid == me:
                cmd += "  (mission-control collector)"
            _static_cache[key] = (uid_name(uid), cmd[:200], pid == me or "hermes" in cmd.lower())
        user, cmd, hermes = _static_cache[key]
        out[pid] = {"ticks": int(f[11]) + int(f[12]), "start": start, "rss": int(f[21]) * PAGE, "user": user, "cmd": cmd, "hermes": hermes}
    for key in [k for k in _static_cache if k not in live]:
        del _static_cache[key]
    return out


def pick_procs(rows, per_sort=25, cap=80):
    chosen, seen = [], set()
    ranked = sorted(rows, key=lambda r: r["cpu"], reverse=True)[:per_sort]
    ranked += sorted(rows, key=lambda r: r["rss"], reverse=True)[:per_sort]
    ranked += [r for r in rows if r["hermes"]]
    for r in ranked:
        if r["pid"] not in seen:
            seen.add(r["pid"])
            chosen.append(r)
    return chosen[:cap]


class Sampler:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.prev = None

    def sample(self):
        now = self.clock()
        stat = parse_cpu_stat(read_text(PROC + "/stat") or "")
        net = parse_net_dev(read_text(PROC + "/net/dev") or "")
        io = parse_diskstats(read_text(PROC + "/diskstats") or "")
        procs = scan_procs()
        mem = summarize_mem(parse_meminfo(read_text(PROC + "/meminfo") or ""))
        prev, self.prev = self.prev, {"t": now, "stat": stat, "net": net, "io": io, "procs": procs}
        dt = (now - prev["t"]) if prev else 0.0
        have = prev is not None and dt > 0

        def rate(a, b):
            return max(0.0, (b - a) / dt) if have else 0.0

        core_keys = sorted((k for k in stat if k != "cpu"), key=lambda k: int(k[3:]))
        if have and "cpu" in stat:
            total = cpu_pct(prev["stat"].get("cpu", stat["cpu"]), stat["cpu"])
            cores = [cpu_pct(prev["stat"].get(k, stat[k]), stat[k]) for k in core_keys]
        else:
            total, cores = 0.0, [0.0] * len(core_keys)

        ifaces = []
        for name, (rx, tx) in net.items():
            p = prev["net"].get(name) if have else None
            ifaces.append({
                "name": name,
                "rxBps": round(rate(p[0], rx), 1) if p else 0.0,
                "txBps": round(rate(p[1], tx), 1) if p else 0.0,
                "rxTotal": rx,
                "txTotal": tx,
            })
        ifaces.sort(key=lambda i: i["rxTotal"] + i["txTotal"], reverse=True)

        rows = []
        for pid, p in procs.items():
            pp = prev["procs"].get(pid) if have else None
            cpu = 0.0
            if pp and pp["start"] == p["start"]:
                cpu = max(0.0, (p["ticks"] - pp["ticks"]) / HZ / dt * 100.0)
            rows.append({
                "pid": pid,
                "user": p["user"],
                "cpu": round(cpu, 1),
                "mem": round(p["rss"] / mem["total"] * 100.0, 2) if mem["total"] else 0.0,
                "rss": p["rss"],
                "cmd": p["cmd"],
                "hermes": p["hermes"],
            })

        return {
            "cpu": {
                "total": total,
                "cores": cores,
                "load": parse_loadavg(read_text(PROC + "/loadavg") or ""),
                "uptimeS": parse_uptime(read_text(PROC + "/uptime") or ""),
                "tempC": read_temp(),
            },
            "mem": mem,
            "disks": disk_list(),
            "io": {
                "readBps": round(rate(prev["io"][0], io[0]), 1) if have else 0.0,
                "writeBps": round(rate(prev["io"][1], io[1]), 1) if have else 0.0,
            },
            "net": ifaces,
            "procs": pick_procs(rows),
            "tasks": len(procs),
        }


MARKERS = ("config.yaml", ".env", "SOUL.md", "profile.yaml", "state.db")
HB_KEYS = ("heartbeat", "heartbeat_at", "last_heartbeat", "updated_at", "timestamp", "ts")
STALE_HEARTBEAT_S = 120
WORKING_WINDOW_S = 30
CLI_WINDOW_S = 300


def read_json(path):
    text = read_text(path)
    if not text:
        return None
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def to_epoch(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f / 1000.0 if f > 1e11 else f
    if isinstance(v, str):
        s = v.strip()
        try:
            return to_epoch(float(s))
        except ValueError:
            pass
        try:
            return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def read_pid(path):
    text = read_text(path)
    if not text:
        return None
    text = text.strip()
    try:
        return int(text)
    except ValueError:
        pass
    try:
        value = json.loads(text)
    except ValueError:
        return None
    pid = value.get("pid") if isinstance(value, dict) else None
    return pid if isinstance(pid, int) else None


def pid_alive(pid):
    return pid is not None and pid > 0 and os.path.isdir(PROC + "/" + str(pid))


def list_profiles(home):
    out = [("default", home)]
    pdir = os.path.join(home, "profiles")
    try:
        names = sorted(os.listdir(pdir))
    except OSError:
        names = []
    for name in names:
        d = os.path.join(pdir, name)
        if os.path.isdir(d) and any(os.path.exists(os.path.join(d, m)) for m in MARKERS):
            out.append((name, d))
    return out


def display_name(pdir, fallback):
    text = read_text(os.path.join(pdir, "profile.yaml"))
    if text:
        m = re.search(r"^display_name:\s*(.+?)\s*$", text, re.M)
        if m:
            value = m.group(1).strip().strip("'\"")
            if value:
                return value[:64]
    return fallback


def extract_platforms(state):
    p = state.get("platforms") if isinstance(state, dict) else None
    names = []
    if isinstance(p, dict):
        names = [str(k) for k in p.keys()]
    elif isinstance(p, list):
        for item in p:
            if isinstance(item, str):
                names.append(item)
            elif isinstance(item, dict) and item.get("name"):
                names.append(str(item["name"]))
    return sorted(set(names))[:12]


def probe_db(path):
    if not os.path.isfile(path):
        return None, False, None
    con = None
    try:
        uri = Path(path).resolve().as_uri() + "?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=1.0)
        con.execute("PRAGMA query_only=1")
        cols = {r[1] for r in con.execute("PRAGMA table_info(messages)")}
        if "timestamp" not in cols:
            return None, False, "unsupported_schema"
        where = " WHERE active=1" if "active" in cols else ""
        row = con.execute("SELECT MAX(timestamp) FROM messages" + where).fetchone()
        last = to_epoch(row[0]) if row and row[0] is not None else None
        scols = {r[1] for r in con.execute("PRAGMA table_info(sessions)")}
        open_session = False
        if "ended_at" in scols:
            open_session = con.execute("SELECT 1 FROM sessions WHERE ended_at IS NULL LIMIT 1").fetchone() is not None
        return last, open_session, None
    except sqlite3.Error:
        return None, False, "db_unreadable"
    finally:
        if con is not None:
            con.close()


STOPPED_STATES = {"stopped", "stopping", "exited", "failed", "crashed", "shutdown"}


def gateway_alive(pdir):
    state = read_json(os.path.join(pdir, "gateway_state.json")) or {}
    pid = state.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool):
        pid = read_pid(os.path.join(pdir, "gateway.pid"))
    if not pid_alive(pid):
        return False
    if str(state.get("gateway_state") or "").lower() in STOPPED_STATES:
        return False
    if state.get("exit_reason"):
        return False
    return True


def collect_agents(home, now):
    errors = []
    state = read_json(os.path.join(home, "gateway_state.json")) or {}
    served_raw = state.get("served_profiles")
    served = [str(x) for x in served_raw if isinstance(x, str)] if isinstance(served_raw, list) else []
    hb = None
    for key in HB_KEYS:
        if key in state:
            hb = to_epoch(state[key])
            if hb is not None:
                break
    age = max(0.0, now - hb) if hb is not None else None
    gateway_up = gateway_alive(home)
    multiplex_up = bool(served) and gateway_up

    agents = []
    for name, pdir in list_profiles(home):
        last_ts, open_session, err = probe_db(os.path.join(pdir, "state.db"))
        if err:
            msg = "state.db schema not recognized" if err == "unsupported_schema" else "state.db could not be read"
            errors.append({"code": err, "message": msg, "profile": name})
        parked = os.path.exists(os.path.join(pdir, "gateway.parked"))
        primary = multiplex_up and name in served
        own = gateway_alive(pdir)
        recent = last_ts is not None and (now - last_ts) <= CLI_WINDOW_S
        active = primary or own or bool(open_session and recent)
        if parked:
            status = "parked"
        elif active:
            status = "working" if (last_ts is not None and now - last_ts <= WORKING_WINDOW_S) else "idle"
        else:
            status = "offline"
        pstate = state if name == "default" else (read_json(os.path.join(pdir, "gateway_state.json")) or state)
        try:
            cfg_mtime = os.stat(os.path.join(pdir, "config.yaml")).st_mtime
        except OSError:
            cfg_mtime = None
        agents.append({
            "profile": name,
            "displayName": display_name(pdir, name),
            "status": status,
            "platforms": extract_platforms(pstate),
            "lastActivityTs": last_ts,
            "configMtime": cfg_mtime,
            "hasSoul": os.path.isfile(os.path.join(pdir, "SOUL.md")),
            "hasMemory": os.path.isfile(os.path.join(pdir, "memories", "MEMORY.md")),
            "hasUser": os.path.isfile(os.path.join(pdir, "memories", "USER.md")),
            "stats": collect_stats(os.path.join(pdir, "state.db"), now),
        })
    data = {
        "agents": agents,
        "gateway": {"up": gateway_up, "heartbeatAgeS": round(age, 1) if age is not None else None, "served": served},
    }
    return data, errors


CRON_MAX_JOBS = 500
CRON_MAX_PER_PROFILE = 200
CRON_REL = re.compile(r"[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?")
ISO_RE = re.compile(r"^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?$")


def iso_to_epoch(v):
    """Returns (epoch_seconds, utc_offset_minutes); (None, None) when unreadable."""
    if v is None or isinstance(v, bool):
        return None, None
    if isinstance(v, (int, float)):
        return to_epoch(v), None
    if not isinstance(v, str):
        return None, None
    m = ISO_RE.match(v.strip())
    if not m:
        return None, None
    y, mo, d, h, mi, s = (int(m.group(i)) for i in range(1, 7))
    if not (1 <= mo <= 12 and 1 <= d <= 31 and h < 24 and mi < 60 and s < 60):
        return None, None
    frac = float(m.group(7)) if m.group(7) else 0.0
    tz = m.group(8)
    off = None
    if tz == "Z":
        off = 0
    elif tz:
        digits = tz[1:].replace(":", "")
        off = (1 if tz[0] == "+" else -1) * (int(digits[:2]) * 60 + int(digits[2:4]))
    try:
        base = calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0))
    except (ValueError, OverflowError):
        return None, None
    return round(base + frac - (off or 0) * 60, 3), off


def _text(v, limit=None):
    if v is None:
        return None
    s = v if isinstance(v, str) else str(v)
    return s[:limit] if limit else s


def _int(v, default=0):
    if isinstance(v, bool):
        return default
    if isinstance(v, int):
        return v
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v.strip())
    return default


def normalize_job(profile, raw):
    if not isinstance(raw, dict):
        return None
    jid = raw.get("id")
    if isinstance(jid, bool) or not isinstance(jid, (str, int)) or str(jid) == "":
        return None
    jid = str(jid)
    sched = raw.get("schedule") if isinstance(raw.get("schedule"), dict) else {}
    expr = _text(sched.get("expr"))
    display = _text(sched.get("display")) or _text(raw.get("schedule_display")) or expr or ""
    rep = raw.get("repeat") if isinstance(raw.get("repeat"), dict) else {}
    times = rep.get("times") if isinstance(rep.get("times"), int) and not isinstance(rep.get("times"), bool) else None
    completed = _int(rep.get("completed"), 0)
    next_ts, off_next = iso_to_epoch(raw.get("next_run_at"))
    last_ts, off_last = iso_to_epoch(raw.get("last_run_at"))
    raw_state = str(raw.get("state") or "").lower()
    if raw_state == "completed" or (times is not None and times > 0 and completed >= times):
        state = "completed"
    elif raw_state == "paused" or raw.get("enabled") is False:
        state = "paused"
    elif raw_state == "running" or raw.get("fire_claim"):
        state = "running"
    else:
        state = "scheduled"
    status = raw.get("last_status")
    skills = []
    raw_skills = raw.get("skills")
    for s in (raw_skills if isinstance(raw_skills, list) else []) + [raw.get("skill")]:
        if isinstance(s, str) and s and s not in skills:
            skills.append(s)
    return {
        "profile": profile,
        "id": jid,
        "name": _text(raw.get("name"), 200) or jid,
        "schedule": {"kind": _text(sched.get("kind")) or "unknown", "expr": expr, "display": display},
        "state": state,
        "enabled": raw.get("enabled") is not False,
        "nextRunTs": next_ts,
        "lastRunTs": last_ts,
        "tzOffsetMin": off_next if off_next is not None else off_last,
        "lastStatus": status.lower() if isinstance(status, str) and status else None,
        "lastError": _text(raw.get("last_error"), 500),
        "lastDeliveryError": _text(raw.get("last_delivery_error"), 500),
        "failureStreak": max(0, _int(raw.get("failure_streak"), 0)),
        "deliver": _text(raw.get("deliver")) or "",
        "model": _text(raw.get("model")) or _text(raw.get("model_snapshot")),
        "provider": _text(raw.get("provider")) or _text(raw.get("provider_snapshot")),
        "skills": skills,
        "repeat": {"times": times, "completed": completed},
        "prompt": _text(raw.get("prompt"), 4000) or "",
        "lastOutput": None,
    }


def find_last_output(pdir, job_id):
    if not CRON_REL.fullmatch(job_id) or "/" in job_id:
        return None
    base = os.path.join(pdir, "cron", "output")
    try:
        names = os.listdir(base)
    except OSError:
        return None
    best = None
    candidates = []
    for name in names:
        path = os.path.join(base, name)
        if name == job_id and os.path.isdir(path):
            try:
                inner = os.listdir(path)
            except OSError:
                inner = []
            candidates += [(name + "/" + f, os.path.join(path, f)) for f in inner]
        elif name.startswith(job_id + "_") or name.startswith(job_id + "."):
            candidates.append((name, path))
    for rel, path in candidates:
        if not CRON_REL.fullmatch(rel) or not os.path.isfile(path):
            continue
        try:
            mtime = os.stat(path).st_mtime
        except OSError:
            continue
        if best is None or mtime > best["mtime"]:
            best = {"rel": rel, "mtime": mtime}
    return best


def collect_cron(home):
    jobs, profiles = [], []
    for name, pdir in list_profiles(home):
        path = os.path.join(pdir, "cron", "jobs.json")
        if not os.path.isfile(path):
            profiles.append({"profile": name, "ok": True, "error": None})
            continue
        text = read_text(path)
        if text is None:
            profiles.append({"profile": name, "ok": False, "error": "unreadable"})
            continue
        try:
            doc = json.loads(text)
        except ValueError:
            profiles.append({"profile": name, "ok": False, "error": "invalid_json"})
            continue
        raw_jobs = doc.get("jobs") if isinstance(doc, dict) else doc
        if not isinstance(raw_jobs, list):
            profiles.append({"profile": name, "ok": False, "error": "unexpected_shape"})
            continue
        note = None
        if len(raw_jobs) > CRON_MAX_PER_PROFILE:
            note = "too many jobs (kept %d)" % CRON_MAX_PER_PROFILE
            raw_jobs = raw_jobs[:CRON_MAX_PER_PROFILE]
        for raw in raw_jobs:
            if len(jobs) >= CRON_MAX_JOBS:
                note = note or "too many jobs (kept %d in total)" % CRON_MAX_JOBS
                break
            job = normalize_job(name, raw)
            if job is None:
                continue
            job["lastOutput"] = find_last_output(pdir, job["id"])
            jobs.append(job)
        profiles.append({"profile": name, "ok": True, "error": note})
    return {"jobs": jobs, "profiles": profiles}


def cron_digest(data):
    blob = json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


FEED_MAX_ROWS = 500
FEED_HISTORY_ROWS = 60
FEED_CHUNK = 50
FEED_LIMITS = {"user": 4000, "reply": 4000, "thinking": 4000, "tool": 1500, "result": 1200}
QUERY_MAX_BYTES = 65536
MESSAGE_COLS = ["content", "tool_calls", "tool_name", "reasoning", "reasoning_content", "active"]
ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
PROFILE_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
STAT_COLS = ["message_count", "tool_call_count", "input_tokens", "output_tokens", "reasoning_tokens", "actual_cost_usd", "estimated_cost_usd"]


def open_ro(path):
    uri = Path(path).resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=1.0)
    con.execute("PRAGMA query_only=1")
    return con


def table_columns(con, table):
    return {r[1] for r in con.execute("PRAGMA table_info(%s)" % table)}


def feed_select(con):
    """Returns (select_sql, base_where) for the columns this database has, or None when it is not a Hermes state.db."""
    mcols = table_columns(con, "messages")
    if not {"id", "session_id", "role", "timestamp"} <= mcols:
        return None
    scols = table_columns(con, "sessions")
    sel = ["m.id AS id", "m.session_id AS session_id", "m.role AS role", "m.timestamp AS timestamp"]
    for col in MESSAGE_COLS:
        sel.append(("m.%s AS %s" % (col, col)) if col in mcols else ("NULL AS %s" % col))
    can_join = "id" in scols
    sel.append("s.source AS source" if can_join and "source" in scols else "NULL AS source")
    sel.append("s.parent_session_id AS parent_session_id" if can_join and "parent_session_id" in scols else "NULL AS parent_session_id")
    sql = "SELECT " + ", ".join(sel) + " FROM messages m"
    if can_join:
        sql += " LEFT JOIN sessions s ON s.id = m.session_id"
    where = ["m.role IN ('user','assistant','tool')"]
    if "active" in mcols:
        where.append("m.active = 1")
    return sql, where


def fetch_rows(con, base, where, extra, params, order, limit):
    sql = base + " WHERE " + " AND ".join(list(where) + list(extra)) + " ORDER BY " + order + " LIMIT " + str(int(limit))
    cur = con.execute(sql, params)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def as_text(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    try:
        return json.dumps(v, ensure_ascii=True, default=str)
    except (TypeError, ValueError):
        return str(v)


def parse_tool_calls(raw):
    v = raw
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return []
    if isinstance(v, dict):
        v = [v]
    if not isinstance(v, list):
        return []
    out = []
    for call in v:
        if not isinstance(call, dict):
            continue
        fn = call.get("function") if isinstance(call.get("function"), dict) else call
        name = fn.get("name") or call.get("name") or "tool"
        args = fn.get("arguments", fn.get("input", call.get("arguments", call.get("input"))))
        if isinstance(args, str):
            text = args
        elif args is None:
            text = ""
        else:
            text = json.dumps(args, separators=(",", ":"), ensure_ascii=True, default=str)
        out.append((str(name), re.sub(r"\s+", " ", text).strip()))
    return out


def make_item(profile, row, n, kind, text, tool_name=None):
    limit = FEED_LIMITS[kind]
    ts = to_epoch(row.get("timestamp"))
    mid = row["id"] if isinstance(row["id"], int) else _int(row["id"], 0)
    return {
        "id": "%s:%s:%d" % (profile, mid, n),
        "profile": profile,
        "messageId": mid,
        "sessionId": _text(row.get("session_id")) or "",
        "source": _text(row.get("source")),
        "parentSessionId": _text(row.get("parent_session_id")),
        "ts": ts if ts is not None else 0.0,
        "kind": kind,
        "text": text[:limit],
        "truncated": len(text) > limit,
        "fullLen": len(text),
        "toolName": tool_name,
    }


def row_items(profile, row):
    role = row.get("role")
    items = []
    if role == "user":
        text = as_text(row.get("content"))
        if text.strip():
            items.append(make_item(profile, row, 0, "user", text))
    elif role == "assistant":
        think = as_text(row.get("reasoning_content")).strip() or as_text(row.get("reasoning")).strip()
        if think:
            items.append(make_item(profile, row, 0, "thinking", think))
        text = as_text(row.get("content"))
        if text.strip():
            items.append(make_item(profile, row, 1, "reply", text))
        for i, (name, args) in enumerate(parse_tool_calls(row.get("tool_calls"))):
            items.append(make_item(profile, row, 2 + i, "tool", (name + " " + args).strip(), name))
    elif role == "tool":
        text = as_text(row.get("content"))
        if text.strip():
            items.append(make_item(profile, row, 0, "result", text, _text(row.get("tool_name"))))
    return items


class FeedState:
    def __init__(self, cursors=None):
        self.cursors = {}
        for k, v in (cursors or {}).items():
            if isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool):
                self.cursors[k] = v

    def poll(self, home, history_rows=FEED_HISTORY_ROWS):
        items, errors, history = [], [], False
        for name, pdir in list_profiles(home):
            db = os.path.join(pdir, "state.db")
            if not os.path.isfile(db):
                continue
            con = None
            try:
                con = open_ro(db)
                parts = feed_select(con)
                if parts is None:
                    errors.append({"code": "unsupported_schema", "message": "state.db schema not recognized", "profile": name})
                    continue
                base, where = parts
                cur = self.cursors.get(name)
                if cur is None:
                    rows = fetch_rows(con, base, where, [], [], "m.id DESC", history_rows)
                    rows.reverse()
                    history = True
                else:
                    rows = fetch_rows(con, base, where, ["m.id > ?"], [cur], "m.id ASC", FEED_MAX_ROWS)
                ids = [r["id"] for r in rows if isinstance(r["id"], int)]
                self.cursors[name] = max(ids + [cur or 0])
                for r in rows:
                    items.extend(row_items(name, r))
            except sqlite3.Error:
                errors.append({"code": "db_unreadable", "message": "state.db could not be read", "profile": name})
            finally:
                if con is not None:
                    con.close()
        return items, history, errors


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def local_midnight(now):
    t = time.localtime(now)
    return time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1))


def collect_stats(db_path, now):
    if not os.path.isfile(db_path):
        return None
    con = None
    try:
        con = open_ro(db_path)
        cols = table_columns(con, "sessions")
        if "started_at" not in cols:
            return None
        sel = ["started_at"] + [c if c in cols else "NULL" for c in STAT_COLS]
        rows = con.execute("SELECT %s FROM sessions ORDER BY started_at DESC LIMIT 2000" % ", ".join(sel)).fetchall()
    except sqlite3.Error:
        return None
    finally:
        if con is not None:
            con.close()
    start = local_midnight(now)
    st = {"sessions": 0, "messages": 0, "toolCalls": 0, "inputTokens": 0, "outputTokens": 0, "reasoningTokens": 0, "costUsd": 0.0}
    for r in rows:
        ts = to_epoch(r[0])
        if ts is None or ts < start:
            continue
        st["sessions"] += 1
        st["messages"] += int(_num(r[1]))
        st["toolCalls"] += int(_num(r[2]))
        st["inputTokens"] += int(_num(r[3]))
        st["outputTokens"] += int(_num(r[4]))
        st["reasoningTokens"] += int(_num(r[5]))
        st["costUsd"] += float(_num(r[6] if r[6] is not None else r[7]))
    st["costUsd"] = round(st["costUsd"], 4)
    return st


# ---- interactions (agent graph) --------------------------------------------

INTER_WINDOW_S = 7 * 86400
INTER_MAX_EDGES = 300
INTER_MAX_SUBS = 40
INTER_MAX_ROOMS = 40
INTER_RUNNING_S = 300
INTER_SCAN_ROWS = 2000
BOT_RE = re.compile(r"^\s*Message from (.{1,80}?) \(@([A-Za-z0-9._-]{1,64})\):")
GROUP_RE = re.compile(r"^Group:\s*(.{1,80}?)(?:\s+[\u00b7|-]\s+(.{0,80}))?\s*$")
ROOM_ID_RE = re.compile(r"^room:[^\x00]{1,80}$")
INTER_KINDS = ("kanban", "message", "room", "delegate")
TASK_COLS = {
    "id": ("id",),
    "title": ("title", "name", "summary"),
    "assignee": ("assignee", "assignee_profile", "assigned_to", "owner"),
    "creator": ("created_by", "creator", "author", "created_by_profile"),
    "status": ("status", "state"),
    "created": ("created_at", "created", "ts", "created_ts"),
}


def match_bot_message(text):
    m = BOT_RE.match(text or "")
    return (m.group(1).strip(), m.group(2)) if m else None


def match_group_title(title):
    m = GROUP_RE.match(title or "")
    if not m:
        return None
    return (m.group(1).strip(), (m.group(2) or "").strip())


def _pick_col(cols, names):
    for n in names:
        if n in cols:
            return n
    return None


def _kanban_paths(home):
    return [os.path.join(home, "kanban.db")] + sorted(glob.glob(os.path.join(home, "kanban", "boards", "*", "kanban.db")))


class InteractionState:
    """Aggregates who talks to whom from state.db and kanban.db files, read-only.

    Message edges accumulate across polls (a cursor per Bot Chat session means only new rows are read);
    every other kind is rebuilt on each poll from small, pre-filtered queries.
    """

    def __init__(self):
        self.msg_cursor = {}
        self.msg_unresolved = 0
        self.edges = {}
        self.rooms = {}
        self.subs = {}
        self.sources = {}

    def _edge_add(self, kind, frm, to, ts, label):
        eid = "%s:%s>%s:" % (kind, frm, to)
        e = self.edges.get(eid)
        if e is None:
            e = self.edges[eid] = {"id": eid, "kind": kind, "from": frm, "to": to, "count": 0, "firstTs": ts, "lastTs": ts, "label": label, "status": None}
        e["count"] += 1
        e["firstTs"] = min(e["firstTs"], ts)
        e["lastTs"] = max(e["lastTs"], ts)

    def _edge_set(self, kind, frm, to, first, last, label=None, status=None, suffix=""):
        eid = "%s:%s>%s:%s" % (kind, frm, to, suffix)
        self.edges[eid] = {"id": eid, "kind": kind, "from": frm, "to": to, "count": 1, "firstTs": first, "lastTs": last, "label": label, "status": status}

    def _src(self, kind, state):
        rank = {"absent": 0, "ok": 1, "unreadable": 2}
        cur = self.sources[kind]
        if rank[state] >= rank[cur["state"]]:
            cur["state"] = state

    def poll(self, home, now):
        since = now - INTER_WINDOW_S
        profiles = list_profiles(home)
        names = {}
        for name, pdir in profiles:
            for key in (name.lower(), display_name(pdir, name).lower()):
                names.setdefault(key, name)
        self.edges = {k: v for k, v in self.edges.items() if v["kind"] == "message"}
        self.sources = {k: {"state": "absent", "unresolved": 0} for k in INTER_KINDS}
        room_members, room_last, subs = {}, {}, {}
        for name, pdir in profiles:
            db = os.path.join(pdir, "state.db")
            if os.path.isfile(db):
                self._scan_profile(db, name, names, since, now, room_members, room_last, subs)
        self.rooms = {}
        for rid, info in room_members.items():
            last = room_last.get(rid, 0.0)
            self.rooms[rid] = {"id": rid, "name": info["name"], "members": sorted(info["members"]), "lastTs": last}
            for m in info["members"]:
                self._edge_set("room", m, rid, last, last)
        self.rooms = dict(sorted(self.rooms.items(), key=lambda kv: -kv[1]["lastTs"])[:INTER_MAX_ROOMS])
        self.subs = {}
        for s in sorted(subs.values(), key=lambda s: -s["lastTs"])[:INTER_MAX_SUBS]:
            self.subs[s["id"]] = s
            self._edge_set("delegate", s["parent"], s["id"], s["lastTs"], s["lastTs"])
        self._kanban(home, names, since)
        self.sources["message"]["unresolved"] = self.msg_unresolved
        return self._payload(since)

    def _scan_profile(self, db, name, names, since, now, room_members, room_last, subs):
        con = None
        try:
            con = open_ro(db)
            scols = table_columns(con, "sessions")
            if "id" not in scols:
                return
            for k in ("message", "room", "delegate"):
                self._src(k, "ok")
            kinds = []
            if "title" in scols:
                kinds += ["title = 'Bot Chat'", "title LIKE 'Group:%'"]
            if "source" in scols:
                kinds.append("source = 'subagent'")
            if "parent_session_id" in scols:
                kinds.append("parent_session_id IS NOT NULL")
            if not kinds:
                return
            where, params = "(" + " OR ".join(kinds) + ")", []
            recent = []
            if "started_at" in scols:
                recent.append("started_at >= ?")
                params.append(since)
            if "ended_at" in scols:
                recent += ["ended_at IS NULL", "ended_at >= ?"]
                params.append(since)
            if recent:
                where += " AND (" + " OR ".join(recent) + ")"
            sel = ["id"] + [col for col in ("source", "parent_session_id", "title", "started_at", "ended_at") if col in scols]
            order = "started_at DESC" if "started_at" in scols else "id DESC"
            rows = con.execute("SELECT %s FROM sessions WHERE %s ORDER BY %s LIMIT %d" % (", ".join(sel), where, order, INTER_SCAN_ROWS), params).fetchall()
            mcols = table_columns(con, "messages")
            can_msg = {"id", "session_id", "role", "content", "timestamp"} <= mcols
            for r in rows:
                s = dict(zip(sel, r))
                sid, title, source = s["id"], _text(s.get("title")) or "", _text(s.get("source")) or ""
                started = to_epoch(s.get("started_at")) or 0.0

                def activity():
                    if can_msg:
                        last = con.execute("SELECT MAX(timestamp) FROM messages WHERE session_id = ?", (sid,)).fetchone()
                        t = to_epoch(last[0]) if last and last[0] is not None else None
                        if t is not None:
                            return t
                    return started

                if source == "subagent" or (s.get("parent_session_id") and source != CHAT_SOURCE and not title.startswith("Group:")):
                    last = activity()
                    if last < since:
                        continue
                    running = s.get("ended_at") is None and now - last <= INTER_RUNNING_S
                    sub_id = "sub:%s:%s" % (name, sid)
                    subs[sub_id] = {"id": sub_id, "parent": name, "status": "running" if running else "done", "lastTs": last, "title": title[:80] or None}
                    continue
                grp = match_group_title(title)
                if grp is not None:
                    last = activity()
                    if last < since:
                        continue
                    rid = "room:" + grp[0]
                    room_members.setdefault(rid, {"name": grp[0], "members": set()})["members"].add(name)
                    room_last[rid] = max(room_last.get(rid, 0.0), last)
                    continue
                if title == "Bot Chat" and can_msg:
                    key = (name, sid)
                    msgs = con.execute(
                        "SELECT id, content, timestamp FROM messages WHERE session_id = ? AND role = 'user' AND id > ? AND timestamp >= ? ORDER BY id ASC LIMIT ?",
                        (sid, self.msg_cursor.get(key, 0), since, INTER_SCAN_ROWS)).fetchall()
                    for mid, content, ts in msgs:
                        self.msg_cursor[key] = max(self.msg_cursor.get(key, 0), mid)
                        hit = match_bot_message(as_text(content))
                        if hit is None:
                            continue
                        sender = names.get(hit[1].lower()) or names.get(hit[0].lower())
                        if sender is None or sender == name:
                            self.msg_unresolved += 1
                            continue
                        self._edge_add("message", sender, name, to_epoch(ts) or 0.0, "msg")
        except sqlite3.Error:
            for k in ("message", "room", "delegate"):
                self._src(k, "unreadable")
        finally:
            if con is not None:
                con.close()

    def _kanban(self, home, names, since):
        for path in _kanban_paths(home):
            if not os.path.isfile(path):
                continue
            con = None
            try:
                con = open_ro(path)
                tcols = table_columns(con, "tasks")
                col = {k: _pick_col(tcols, v) for k, v in TASK_COLS.items()}
                if not (col["id"] and col["assignee"] and col["creator"]):
                    self._src("kanban", "unreadable")
                    continue
                self._src("kanban", "ok")
                ecols = table_columns(con, "task_events")
                last_ev = {}
                if {"task_id", "ts"} <= ecols:
                    for tid, ts in con.execute("SELECT task_id, MAX(ts) FROM task_events GROUP BY task_id"):
                        last_ev[tid] = to_epoch(ts) or 0.0
                sel = ", ".join(("%s AS %s" % (col[k], k)) if col[k] else ("NULL AS %s" % k) for k in TASK_COLS)
                for r in con.execute("SELECT %s FROM tasks ORDER BY %s DESC LIMIT 500" % (sel, col["id"])):
                    t = dict(zip(TASK_COLS, r))
                    created = to_epoch(t["created"]) or 0.0
                    ts = max(created, last_ev.get(t["id"], 0.0))
                    if ts < since:
                        continue
                    frm, to = names.get(str(t["creator"]).lower()), names.get(str(t["assignee"]).lower())
                    if frm is None or to is None or frm == to:
                        self.sources["kanban"]["unresolved"] += 1
                        continue
                    self._edge_set("kanban", frm, to, created, ts, label="#%s" % t["id"], status=_text(t["status"], 40), suffix="#%s" % t["id"])
            except sqlite3.Error:
                self._src("kanban", "unreadable")
            finally:
                if con is not None:
                    con.close()

    def _payload(self, since):
        edges = sorted(self.edges.values(), key=lambda e: (-e["lastTs"], e["id"]))[:INTER_MAX_EDGES]
        self.edges = {e["id"]: e for e in edges}
        return {
            "since": since,
            "edges": edges,
            "rooms": sorted(self.rooms.values(), key=lambda r: (-r["lastTs"], r["id"])),
            "subagents": sorted(self.subs.values(), key=lambda s: (-s["lastTs"], s["id"])),
            "sources": {k: dict(v) for k, v in self.sources.items()},
        }

    @staticmethod
    def digest(data):
        core = [(e["id"], e["count"], e["lastTs"], e["status"]) for e in data["edges"]]
        core += [(r["id"], tuple(r["members"]), r["lastTs"]) for r in data["rooms"]]
        core += [(s["id"], s["status"], s["lastTs"]) for s in data["subagents"]]
        core += sorted((k, v["state"], v["unresolved"]) for k, v in data["sources"].items())
        return hashlib.sha1(json.dumps(core, default=str).encode("ascii", "replace")).hexdigest()


class QueryError(Exception):
    pass


def valid_profile(p):
    return isinstance(p, str) and PROFILE_RE.match(p) is not None and p not in (".", "..")


def valid_int(v, low=0):
    return isinstance(v, int) and not isinstance(v, bool) and v >= low


def profile_dir(home, name):
    if name == "default":
        return home
    d = os.path.join(home, "profiles", name)
    return d if os.path.isdir(d) else None


def open_profile(home, name):
    pdir = profile_dir(home, name)
    db = os.path.join(pdir, "state.db") if pdir else None
    if not db or not os.path.isfile(db):
        raise QueryError("not_found")
    return open_ro(db)


def cap_text(text):
    raw = text.encode("utf-8", "replace")
    if len(raw) <= QUERY_MAX_BYTES:
        return {"text": text, "truncated": False, "fullLen": len(text)}
    return {"text": raw[:QUERY_MAX_BYTES].decode("utf-8", "ignore"), "truncated": True, "fullLen": len(text)}


def q_message(home, a):
    name, mid, field, idx = a.get("profile"), a.get("messageId"), a.get("field"), a.get("index", 0)
    if not valid_profile(name) or not valid_int(mid) or field not in ("content", "reasoning", "tool_calls") or not valid_int(idx):
        raise QueryError("bad_args")
    con = open_profile(home, name)
    try:
        parts = feed_select(con)
        if parts is None:
            raise QueryError("unsupported_schema")
        base, where = parts
        rows = fetch_rows(con, base, where[:1], ["m.id = ?"], [mid], "m.id", 1)
    finally:
        con.close()
    if not rows:
        raise QueryError("not_found")
    row = rows[0]
    if field == "content":
        text = as_text(row.get("content"))
    elif field == "reasoning":
        text = as_text(row.get("reasoning_content")) or as_text(row.get("reasoning"))
    else:
        calls = parse_tool_calls(row.get("tool_calls"))
        if idx >= len(calls):
            raise QueryError("not_found")
        text = (calls[idx][0] + " " + calls[idx][1]).strip()
    return cap_text(text)


def q_history(home, a):
    before, limit = a.get("before"), a.get("limit")
    if not isinstance(before, dict) or not before or len(before) > 50 or not valid_int(limit, 1) or limit > 100:
        raise QueryError("bad_args")
    for name, bid in before.items():
        if not valid_profile(name) or not valid_int(bid):
            raise QueryError("bad_args")
    items, oldest, exhausted = [], {}, {}
    for name, bid in before.items():
        try:
            con = open_profile(home, name)
        except QueryError:
            oldest[name], exhausted[name] = None, True
            continue
        try:
            parts = feed_select(con)
            if parts is None:
                oldest[name], exhausted[name] = None, True
                continue
            base, where = parts
            rows = fetch_rows(con, base, where, ["m.id < ?"], [bid], "m.id DESC", limit)
        finally:
            con.close()
        exhausted[name] = len(rows) < limit
        oldest[name] = min([r["id"] for r in rows if isinstance(r["id"], int)] or [None]) if rows else None
        for r in rows:
            items.extend(row_items(name, r))
    return {"items": items, "oldest": oldest, "exhausted": exhausted}


def q_session(home, a):
    name, sid = a.get("profile"), a.get("sessionId")
    if not valid_profile(name) or not isinstance(sid, str) or not ID_RE.match(sid):
        raise QueryError("bad_args")
    con = open_profile(home, name)
    try:
        parts = feed_select(con)
        if parts is None:
            raise QueryError("unsupported_schema")
        base, where = parts
        scols = table_columns(con, "sessions")
        wanted = [c for c in ("source", "model", "parent_session_id", "started_at", "ended_at", "title") if c in scols]
        srow = None
        children = []
        if "id" in scols:
            srow = con.execute("SELECT %s FROM sessions WHERE id = ?" % ", ".join(["id"] + wanted), (sid,)).fetchone()
            if "parent_session_id" in scols:
                children = [{"id": r[0], "source": r[1]} for r in con.execute(
                    "SELECT id, %s FROM sessions WHERE parent_session_id = ? LIMIT 50" % ("source" if "source" in scols else "NULL"), (sid,))]
        rows = fetch_rows(con, base, where, ["m.session_id = ?"], [sid], "m.id ASC", 501)
    finally:
        con.close()
    if srow is None and not rows:
        raise QueryError("not_found")
    info = dict(zip(["id"] + wanted, srow)) if srow else {"id": sid}
    items = []
    for r in rows:
        items.extend(row_items(name, r))
    more = len(rows) > 500 or len(items) > 500
    items = items[:500]
    return {
        "session": {
            "id": sid,
            "source": _text(info.get("source")),
            "model": _text(info.get("model")),
            "parentSessionId": _text(info.get("parent_session_id")),
            "startedAt": to_epoch(info.get("started_at")),
            "endedAt": to_epoch(info.get("ended_at")),
            "title": _text(info.get("title"), 200),
        },
        "children": children,
        "items": items,
        "more": more,
    }


# ---- sessions (M8a) --------------------------------------------------------

SESSION_COLS = ["title", "source", "model", "started_at", "ended_at", "end_reason", "message_count", "tool_call_count",
                "input_tokens", "output_tokens", "cache_read_tokens", "estimated_cost_usd", "actual_cost_usd", "cost_status",
                "parent_session_id", "pinned"]
SESSIONS_LIST_MAX = 100
SESSIONS_SEARCH_MAX = 200
SESSIONS_SOURCES_MAX = 30
TRANSCRIPT_PAGE = 200


def _dict_rows(cur):
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def _limit(a, default, high):
    v = a.get("limit", default)
    if not valid_int(v, 1):
        raise QueryError("bad_args")
    return min(v, high)


def _filters(a):
    profiles = a.get("profiles", [])
    if not isinstance(profiles, list) or len(profiles) > 50 or not all(valid_profile(p) for p in profiles):
        raise QueryError("bad_args")
    source = a.get("source")
    if source is not None and (not isinstance(source, str) or not source or len(source) > 64):
        raise QueryError("bad_args")
    since = a.get("sinceTs")
    if since is not None and (isinstance(since, bool) or not isinstance(since, (int, float))):
        raise QueryError("bad_args")
    return profiles, source, since


def _session_select(scols):
    return ", ".join(["s.id AS id"] + [("s.%s AS %s" % (c, c)) if c in scols else ("NULL AS %s" % c) for c in SESSION_COLS])


def _opt_int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    return int(v) if isinstance(v, float) else None


def _opt_num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _cost(r):
    if r.get("cost_status") not in (None, "", "actual", "estimated"):
        return None, None
    actual, est = _opt_num(r.get("actual_cost_usd")), _opt_num(r.get("estimated_cost_usd"))
    if actual is not None:
        return actual, "actual"
    if est is not None:
        return est, "estimated"
    return None, None


def _status(r, has_children):
    reason = _text(r.get("end_reason")) or ""
    if r.get("ended_at") is None and not reason:
        return "running"
    low = reason.lower()
    if "error" in low or "fail" in low or "crash" in low:
        return "failed"
    return "compressed" if has_children else "ended"


def _session_row(profile, r, has_children, snippet=None):
    cost, kind = _cost(r)
    return {
        "profile": profile, "id": r["id"], "title": _text(r.get("title"), 200), "source": _text(r.get("source"), 64),
        "model": _text(r.get("model"), 128), "startedAt": to_epoch(r.get("started_at")), "endedAt": to_epoch(r.get("ended_at")),
        "endReason": _text(r.get("end_reason"), 64), "messageCount": _opt_int(r.get("message_count")),
        "toolCallCount": _opt_int(r.get("tool_call_count")), "inputTokens": _opt_int(r.get("input_tokens")),
        "outputTokens": _opt_int(r.get("output_tokens")), "cacheReadTokens": _opt_int(r.get("cache_read_tokens")),
        "cost": cost, "costKind": kind, "parentSessionId": _text(r.get("parent_session_id"), 128),
        "hasChildren": has_children, "pinned": bool(r.get("pinned")), "status": _status(r, has_children), "snippet": snippet,
    }


def _children_of(con, scols, ids):
    if not ids or "parent_session_id" not in scols:
        return set()
    marks = ",".join("?" * len(ids))
    return {r[0] for r in con.execute("SELECT DISTINCT parent_session_id FROM sessions WHERE parent_session_id IN (%s)" % marks, ids)}


def _sort_rows(rows):
    rows.sort(key=lambda r: r["id"], reverse=True)
    rows.sort(key=lambda r: (r["startedAt"] is None, -(r["startedAt"] or 0)))


def _each_profile(home, wanted):
    for name, pdir in list_profiles(home):
        if wanted and name not in wanted:
            continue
        db = os.path.join(pdir, "state.db")
        if os.path.isfile(db):
            yield name, db


def _has_sessions(scols):
    return {"id", "started_at"} <= scols


def _source_list(con, scols):
    if "source" not in scols:
        return []
    return [r[0] for r in con.execute("SELECT DISTINCT source FROM sessions WHERE source IS NOT NULL ORDER BY source LIMIT ?", (SESSIONS_SOURCES_MAX,))]


def q_sessions_list(home, a):
    profiles, source, since = _filters(a)
    limit = _limit(a, 50, SESSIONS_LIST_MAX)
    before = a.get("before")
    bts = None
    if before is not None:
        if not isinstance(before, dict) or not isinstance(before.get("id"), str) or not ID_RE.match(before["id"]):
            raise QueryError("bad_args")
        bts = before.get("ts")
        if bts is not None and (isinstance(bts, bool) or not isinstance(bts, (int, float))):
            raise QueryError("bad_args")
    rows, errors, sources, readable = [], [], set(), 0
    for name, db in _each_profile(home, profiles):
        con = None
        try:
            con = open_ro(db)
            scols = table_columns(con, "sessions")
            if not _has_sessions(scols):
                errors.append({"profile": name, "code": "unsupported_schema"})
                continue
            where, params = [], []
            if since is not None:
                where.append("s.started_at >= ?")
                params.append(since)
            if source is not None and "source" in scols:
                where.append("s.source = ?")
                params.append(source)
            if before is not None:
                if bts is None:
                    where.append("(s.started_at IS NULL AND s.id < ?)")
                    params.append(before["id"])
                else:
                    where.append("(s.started_at < ? OR (s.started_at = ? AND s.id < ?) OR s.started_at IS NULL)")
                    params.extend([bts, bts, before["id"]])
            sql = "SELECT %s FROM sessions s%s ORDER BY (s.started_at IS NULL), s.started_at DESC, s.id DESC LIMIT ?" % (
                _session_select(scols), (" WHERE " + " AND ".join(where)) if where else "")
            got = _dict_rows(con.execute(sql, params + [limit + 1]))
            kids = _children_of(con, scols, [g["id"] for g in got])
            rows.extend(_session_row(name, g, g["id"] in kids) for g in got)
            sources.update(_source_list(con, scols))
            readable += 1
        except sqlite3.Error:
            errors.append({"profile": name, "code": "db_unreadable"})
        finally:
            if con is not None:
                con.close()
    if errors and readable == 0:
        raise QueryError(errors[0]["code"])
    _sort_rows(rows)
    return {"rows": rows[:limit], "sources": sorted(sources)[:SESSIONS_SOURCES_MAX], "errors": errors, "more": len(rows) > limit, "fallback": None}


# ---- chat ----------------------------------------------------------------

CHAT_SOURCE = "mission-control"
CHAT_SESSIONS_MAX = 30
UPLOADS_MAX = 500


def _last_text(con, sid):
    row = con.execute("SELECT content, timestamp FROM messages WHERE session_id = ? AND role IN ('user','assistant') AND content IS NOT NULL "
                      "ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    return (as_text(row[0]), to_epoch(row[1])) if row else ("", None)


def _inter_out(text, **meta):
    out = cap_text(text)
    out.update({"title": None, "ts": None, "source": "", "sessionId": None, "profile": None})
    out.update(meta)
    return out


def q_interaction(home, a):
    """The latest text behind one edge or node of the agent graph (a message, a task, a room line, a subagent's last turn)."""
    kind = a.get("kind")
    if kind not in INTER_KINDS:
        raise QueryError("bad_args")
    if kind == "message":
        frm, to = a.get("from"), a.get("to")
        if not valid_profile(frm) or not valid_profile(to):
            raise QueryError("bad_args")
        con = open_profile(home, to)
        try:
            fdir = profile_dir(home, frm)
            who = {frm.lower(), (display_name(fdir, frm) if fdir else frm).lower()}
            best = None
            for (sid,) in con.execute("SELECT id FROM sessions WHERE title = 'Bot Chat' ORDER BY id").fetchall():
                for mid, content, ts in con.execute("SELECT id, content, timestamp FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 200", (sid,)):
                    hit = match_bot_message(as_text(content))
                    if hit and (hit[1].lower() in who or hit[0].lower() in who):
                        if best is None or (to_epoch(ts) or 0) > (best[2] or 0):
                            best = (as_text(content), sid, to_epoch(ts))
                        break
        finally:
            con.close()
        if best is None:
            raise QueryError("not_found")
        return _inter_out(best[0], ts=best[2], source="%s/state.db - session \"Bot Chat\"" % to, sessionId=best[1], profile=to)
    ident = a.get("id")
    if kind == "kanban":
        if not valid_int(ident):
            raise QueryError("bad_args")
        for path in _kanban_paths(home):
            if not os.path.isfile(path):
                continue
            con = open_ro(path)
            try:
                tcols = table_columns(con, "tasks")
                icol, tcol = _pick_col(tcols, TASK_COLS["id"]), _pick_col(tcols, TASK_COLS["title"])
                if not icol:
                    continue
                row = con.execute("SELECT %s FROM tasks WHERE %s = ?" % (tcol or "NULL", icol), (ident,)).fetchone()
                if row is None:
                    continue
                text, ts = "", None
                ecols = table_columns(con, "task_events")
                bcol = _pick_col(ecols, ("body", "text", "comment", "message", "kind"))
                if {"id", "task_id", "ts"} <= ecols and bcol:
                    ev = con.execute("SELECT %s, ts FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1" % bcol, (ident,)).fetchone()
                    if ev:
                        text, ts = as_text(ev[0]), to_epoch(ev[1])
            finally:
                con.close()
            rel = os.path.relpath(path, home).replace(os.sep, "/")
            return _inter_out(text, title=_text(row[0], 200), ts=ts, source="%s - task #%d" % (rel, ident))
        raise QueryError("not_found")
    if kind == "delegate":
        parts = ident.split(":", 2) if isinstance(ident, str) else []
        if len(parts) != 3 or parts[0] != "sub" or not valid_profile(parts[1]) or not ID_RE.match(parts[2]):
            raise QueryError("bad_args")
        con = open_profile(home, parts[1])
        try:
            row = con.execute("SELECT title FROM sessions WHERE id = ?", (parts[2],)).fetchone()
            if row is None:
                raise QueryError("not_found")
            text, ts = _last_text(con, parts[2])
        finally:
            con.close()
        return _inter_out(text, title=_text(row[0], 200), ts=ts, source="%s/state.db - source=subagent" % parts[1], sessionId=parts[2], profile=parts[1])
    if not isinstance(ident, str) or not ROOM_ID_RE.match(ident):
        raise QueryError("bad_args")
    room, best = ident[5:], None
    for name, pdir in list_profiles(home):
        db = os.path.join(pdir, "state.db")
        if not os.path.isfile(db):
            continue
        con = open_ro(db)
        try:
            for sid, title in con.execute("SELECT id, title FROM sessions WHERE title LIKE 'Group:%' LIMIT 200").fetchall():
                grp = match_group_title(title or "")
                if not grp or grp[0] != room:
                    continue
                text, ts = _last_text(con, sid)
                if text and (best is None or (ts or 0) > (best[1] or 0)):
                    best = (text, ts, name, sid, title)
        finally:
            con.close()
    if best is None:
        raise QueryError("not_found")
    return _inter_out(best[0], title=room, ts=best[1], source="%s/state.db - session \"%s\"" % (best[2], best[4]), sessionId=best[3], profile=best[2])


def q_chat_sessions(home, a):
    """Sessions started from this app (source = mission-control), newest first, with a short preview."""
    name = a.get("profile")
    if not valid_profile(name):
        raise QueryError("bad_args")
    con = open_profile(home, name)
    try:
        scols = table_columns(con, "sessions")
        if "id" not in scols or "source" not in scols:
            return {"sessions": []}
        order = "started_at DESC" if "started_at" in scols else "id DESC"
        cols = ["id"] + [c for c in ("started_at", "title") if c in scols]
        # "any" is for a Hermes whose chat has no --source flag: its sessions then carry another source
        where, params = ("", ()) if a.get("any") is True else (" WHERE source = ?", (CHAT_SOURCE,))
        rows = con.execute(
            "SELECT %s FROM sessions%s ORDER BY %s LIMIT %d" % (", ".join(cols), where, order, CHAT_SESSIONS_MAX),
            params,
        ).fetchall()
        mcols = table_columns(con, "messages")
        out = []
        for r in rows:
            info = dict(zip(cols, r))
            preview = None
            count = 0
            if "session_id" in mcols and "content" in mcols and "role" in mcols:
                act = " AND active = 1" if "active" in mcols else ""
                first = con.execute(
                    "SELECT content FROM messages WHERE session_id = ? AND role = 'user'%s ORDER BY id LIMIT 1" % act, (info["id"],)
                ).fetchone()
                preview = _text(as_text(first[0]), 80) if first else None
                count = con.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?%s" % act, (info["id"],)).fetchone()[0]
            out.append({
                "id": info["id"],
                "startedAt": to_epoch(info.get("started_at")),
                "title": _text(info.get("title"), 120),
                "preview": preview,
                "messages": count,
            })
    finally:
        con.close()
    return {"sessions": out}


def q_uploads_list(home, a):
    """Files below <dir>/<agent>/<date>/, as written by the app's uploads. Read only, never follows links."""
    root = expand_path(a.get("dir"))
    files = []
    truncated = False
    if os.path.isdir(root):
        try:
            agents = sorted(e.name for e in os.scandir(root) if e.is_dir(follow_symlinks=False) and not e.name.startswith("."))
        except OSError:
            raise QueryError("unreadable")
        for agent in agents:
            adir = os.path.join(root, agent)
            try:
                dates = sorted(e.name for e in os.scandir(adir) if e.is_dir(follow_symlinks=False))
            except OSError:
                continue
            for date in dates:
                ddir = os.path.join(adir, date)
                try:
                    entries = sorted((e for e in os.scandir(ddir) if e.is_file(follow_symlinks=False)), key=lambda e: e.name)
                except OSError:
                    continue
                for e in entries:
                    if len(files) >= UPLOADS_MAX:
                        truncated = True
                        break
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    files.append({"agent": agent, "date": date, "name": e.name, "size": st.st_size, "mtime": int(st.st_mtime), "path": e.path})
                if truncated:
                    break
            if truncated:
                break
    return {"dir": root, "exists": os.path.isdir(root), "files": files, "truncated": truncated}


# ---- second brain (vault) -------------------------------------------------

VAULT_MAX_NOTES = 20000
VAULT_CHUNK = 300
VAULT_CHUNK_BYTES = 400000
VAULT_MAX_LINKS = 2000
VAULT_PARSE_BYTES = 524288
VAULT_BIG_FILE = 2097152
VAULT_POLL_S = 3.0
NOTE_QUERY_BYTES = 262144
BROWSE_MAX = 500
ATTACH_EXT = {
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif", "pdf", "mp3", "wav", "ogg", "m4a", "flac",
    "mp4", "webm", "mov", "mkv", "zip", "csv", "json", "txt", "docx", "xlsx", "pptx", "canvas",
}

FENCE_RE = re.compile(r"^(```|~~~).*?^\1[^\n]*$", re.S | re.M)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
WIKI_RE = re.compile(r"!?\[\[([^\[\]\n]+?)\]\]")
MDLINK_RE = re.compile(r"!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^()\s]+)(?:\s+\"[^\"\n]*\")?\s*\)")
TAG_RE = re.compile(r"(?:^|[\s(])#([\w/-]+)")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


def strip_code(text):
    return INLINE_CODE_RE.sub(" ", FENCE_RE.sub(" ", text))


def split_frontmatter(text):
    """Return (frontmatter block or '', body)."""
    if not text.startswith("---"):
        return "", text
    first = text.split("\n", 1)
    if first[0].rstrip() != "---" or len(first) < 2:
        return "", text
    rest = first[1]
    m = re.search(r"^(---|\.\.\.)[ \t]*$", rest, re.M)
    if not m:
        return "", text
    return rest[:m.start()], rest[m.end():]


def _fm_clean(v):
    v = v.strip().strip("'\"").strip()
    return v[1:] if v.startswith("#") else v


def fm_list(block, keys):
    """Values of the first matching key: inline list, comma or space separated text, or a block list."""
    lines = block.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^([A-Za-z_]+)\s*:\s*(.*)$", line)
        if not m or m.group(1).lower() not in keys:
            continue
        val = m.group(2).strip()
        if val.startswith("["):
            inner = val[1:val.rfind("]")] if "]" in val else val[1:]
            return [x for x in (_fm_clean(p) for p in inner.split(",")) if x]
        if val:
            sep = "," if "," in val else r"\s+"
            return [x for x in (_fm_clean(p) for p in re.split(sep, val)) if x]
        out = []
        for nxt in lines[i + 1:]:
            b = re.match(r"^\s*-\s*(.+?)\s*$", nxt)
            if b:
                out.append(_fm_clean(b.group(1)))
            elif nxt.strip() and not nxt.startswith((" ", "\t")):
                break
        return [x for x in out if x]
    return []


def clean_target(raw, markdown=False):
    t = raw.strip()
    if markdown:
        if t.startswith("<") and t.endswith(">"):
            t = t[1:-1]
        if SCHEME_RE.match(t) or t.startswith(("#", "//")):
            return None
        t = t.replace("%20", " ")
    t = t.split("|", 1)[0]
    t = re.split(r"[#^]", t, maxsplit=1)[0].strip().replace("\\", "/")
    if t.lower().endswith(".md"):
        t = t[:-3]
    t = t.lstrip("/")
    return t or None


def parse_note(text):
    fm, body = split_frontmatter(text)
    tags = []
    seen = set()

    def add_tag(t):
        t = t.strip("/")
        if t and not t.isdigit() and t.lower() not in seen:
            seen.add(t.lower())
            tags.append(t)

    for t in fm_list(fm, ("tags", "tag")):
        add_tag(t)
    plain = strip_code(body)
    for m in TAG_RE.finditer(plain):
        add_tag(m.group(1))
    links = []
    for m in WIKI_RE.finditer(plain):
        t = clean_target(m.group(1))
        if t:
            links.append(t)
    for m in MDLINK_RE.finditer(plain):
        t = clean_target(m.group(1), True)
        if t:
            links.append(t)
    aliases = fm_list(fm, ("aliases", "alias"))
    return {"links": links, "tags": tags, "aliases": aliases}


def parse_file(path, size):
    if size > VAULT_BIG_FILE:
        return {"links": [], "tags": [], "aliases": []}
    try:
        with open(path, "rb") as f:
            text = f.read(VAULT_PARSE_BYTES).decode("utf-8", "replace")
    except OSError:
        return {"links": [], "tags": [], "aliases": []}
    return parse_note(text)


def walk_vault(root, limit=VAULT_MAX_NOTES):
    """Return ([(id, abs path, mtime, size)], truncated). Skips dot folders and symlinks."""
    out = []
    stack = [root]
    truncated = False
    while stack and not truncated:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except OSError:
            continue
        with it:
            for e in it:
                name = e.name
                if name.startswith("."):
                    continue
                try:
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
                    elif name.lower().endswith(".md") and e.is_file(follow_symlinks=False):
                        if len(out) >= limit:
                            truncated = True
                            break
                        st = e.stat(follow_symlinks=False)
                        rel = os.path.relpath(e.path, root).replace(os.sep, "/")
                        out.append((rel, e.path, int(st.st_mtime), st.st_size))
                except OSError:
                    continue
    return out, truncated


def build_records(raw):
    """Resolve every note's links the way Obsidian does and return {id: record}."""
    by_base, by_path, by_alias = {}, {}, {}
    for nid, r in raw.items():
        low = nid[:-3].lower()
        by_path[low] = nid
        by_base.setdefault(low.rsplit("/", 1)[-1], []).append(nid)
        for a in r["parsed"]["aliases"]:
            by_alias.setdefault(a.lower(), []).append(nid)

    def pick(ids):
        return sorted(ids, key=lambda x: (len(x), x))[0]

    def resolve(target):
        low = target.lower()
        if "/" in low:
            if low in by_path:
                return by_path[low]
            hits = [i for i in by_base.get(low.rsplit("/", 1)[-1], []) if i[:-3].lower().endswith("/" + low)]
            return pick(hits) if hits else None
        if low in by_base:
            return pick(by_base[low])
        if low in by_alias:
            return pick(by_alias[low])
        return None

    out = {}
    for nid, r in raw.items():
        p = r["parsed"]
        linked, ghosts, attach = set(), {}, {}
        for t in p["links"]:
            hit = resolve(t)
            if hit is not None:
                if hit != nid:
                    linked.add(hit)
                continue
            ext = t.rsplit(".", 1)[-1].lower() if "." in t else ""
            base = t.rsplit("/", 1)[-1]
            if ext in ATTACH_EXT:
                attach.setdefault(base.lower(), base)
            else:
                ghosts.setdefault(t.lower(), t)
        out[nid] = {
            "id": nid,
            "title": nid[:-3].rsplit("/", 1)[-1],
            "mtime": r["mtime"],
            "size": r["size"],
            "tags": p["tags"][:200],
            "aliases": p["aliases"][:50],
            "links": sorted(linked)[:VAULT_MAX_LINKS],
            "ghosts": sorted(ghosts.values(), key=str.lower)[:500],
            "attachments": sorted(attach.values(), key=str.lower)[:200],
        }
    return out


def record_digest(rec):
    return hashlib.md5(json.dumps(rec, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


class VaultState:
    def __init__(self, root, limit=VAULT_MAX_NOTES):
        self.root = root
        self.limit = limit
        self.raw = {}
        self.emitted = {}
        self.truncated = False

    def scan(self):
        files, self.truncated = walk_vault(self.root, self.limit)
        seen = set()
        for nid, path, mtime, size in files:
            seen.add(nid)
            cur = self.raw.get(nid)
            if cur is not None and cur["mtime"] == mtime and cur["size"] == size:
                continue
            self.raw[nid] = {"mtime": mtime, "size": size, "parsed": parse_file(path, size)}
        for nid in [k for k in self.raw if k not in seen]:
            del self.raw[nid]

    def snapshot(self):
        self.scan()
        recs = build_records(self.raw)
        self.emitted = {k: record_digest(v) for k, v in recs.items()}
        return [recs[k] for k in sorted(recs)]

    def poll(self):
        self.scan()
        recs = build_records(self.raw)
        digests = {k: record_digest(v) for k, v in recs.items()}
        upserts = [recs[k] for k in sorted(recs) if self.emitted.get(k) != digests[k]]
        removed = sorted(k for k in self.emitted if k not in recs)
        self.emitted = digests
        return upserts, removed


def vault_chunks(notes, mode, removed, total, truncated):
    """Split notes into events of at most VAULT_CHUNK notes and about VAULT_CHUNK_BYTES of JSON each."""
    groups, cur, size = [], [], 0
    for note in notes:
        n = len(json.dumps(note, separators=(",", ":")))
        if cur and (len(cur) >= VAULT_CHUNK or size + n > VAULT_CHUNK_BYTES):
            groups.append(cur)
            cur, size = [], 0
        cur.append(note)
        size += n
    groups.append(cur)
    for i, group in enumerate(groups):
        yield {
            "mode": mode,
            "first": i == 0,
            "done": i == len(groups) - 1,
            "total": total,
            "truncated": truncated,
            "notes": group,
            "removed": removed if i == 0 else [],
        }


def expand_path(p):
    if not isinstance(p, str) or not p or len(p) > 4096 or "\0" in p:
        raise QueryError("bad_args")
    return os.path.abspath(os.path.expanduser(p))


def run_vault(root, interval, ticks=0):
    root = expand_path(root)
    state = VaultState(root)
    started = False
    reported = False
    done = 0
    while True:
        try:
            if not os.path.isdir(root) or not os.access(root, os.R_OK | os.X_OK):
                if not reported:
                    emit("error", {"code": "vault_unreadable", "message": "vault folder not found or not readable"})
                    reported = True
            else:
                reported = False
                if not started:
                    notes = state.snapshot()
                    for chunk in vault_chunks(notes, "snapshot", [], len(notes), state.truncated):
                        emit("brain", chunk)
                    started = True
                else:
                    upserts, removed = state.poll()
                    if upserts or removed:
                        for chunk in vault_chunks(upserts, "delta", removed, len(state.emitted), state.truncated):
                            emit("brain", chunk)
        except Exception as ex:  # noqa: BLE001 - never crash the stream
            emit("error", {"code": "vault_failed", "message": type(ex).__name__})
        done += 1
        if ticks and done >= ticks:
            return 0
        time.sleep(interval)


def q_vault_check(home, a):
    root = expand_path(a.get("path"))
    exists = os.path.isdir(root)
    readable = exists and os.access(root, os.R_OK | os.X_OK)
    notes, truncated = (0, False)
    if readable:
        files, truncated = walk_vault(root)
        notes = len(files)
    return {"path": root, "exists": exists, "readable": bool(readable), "notes": notes, "truncated": truncated}


def q_browse(home, a):
    raw = a.get("path")
    root = expand_path(raw if raw else "~")
    if not os.path.isdir(root):
        raise QueryError("not_found")
    dirs = []
    try:
        with os.scandir(root) as it:
            names = sorted((e.name for e in it if not e.name.startswith(".") and e.is_dir(follow_symlinks=False)), key=str.lower)
    except OSError:
        raise QueryError("unreadable")
    for name in names[:BROWSE_MAX]:
        count = 0
        try:
            with os.scandir(os.path.join(root, name)) as it:
                count = sum(1 for e in it if e.name.lower().endswith(".md") and not e.name.startswith("."))
        except OSError:
            pass
        dirs.append({"name": name, "notes": count})
    parent = os.path.dirname(root)
    return {"path": root, "parent": parent if parent != root else None, "dirs": dirs, "truncated": len(names) > BROWSE_MAX}


def q_note(home, a):
    root = expand_path(a.get("root"))
    nid = a.get("id")
    if not isinstance(nid, str) or not nid.lower().endswith(".md") or "\0" in nid or len(nid) > 4096 or nid.startswith(("/", "\\")):
        raise QueryError("bad_args")
    parts = nid.replace("\\", "/").split("/")
    if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        raise QueryError("bad_args")
    real_root = os.path.realpath(root)
    path = os.path.realpath(os.path.join(real_root, *parts))
    if os.path.commonpath([real_root, path]) != real_root:
        raise QueryError("bad_args")
    if not os.path.isfile(path):
        raise QueryError("not_found")
    with open(path, "rb") as f:
        raw = f.read(NOTE_QUERY_BYTES + 1)
    return {
        "id": nid,
        "text": raw[:NOTE_QUERY_BYTES].decode("utf-8", "replace"),
        "truncated": len(raw) > NOTE_QUERY_BYTES,
        "mtime": int(os.path.getmtime(path)),
    }


def run_query(home, cmd, raw):
    try:
        args = json.loads(raw)
    except ValueError:
        return {"ok": False, "error": "bad_args"}
    if not isinstance(args, dict):
        return {"ok": False, "error": "bad_args"}
    handler = {
        "message": q_message, "history": q_history, "session": q_session,
        "vault_check": q_vault_check, "browse": q_browse, "note": q_note,
        "chat_sessions": q_chat_sessions, "uploads_list": q_uploads_list, "interaction": q_interaction,
        "sessions_list": q_sessions_list,
    }.get(cmd)
    if handler is None:
        return {"ok": False, "error": "unknown_command"}
    try:
        return {"ok": True, "data": handler(home, args)}
    except QueryError as e:
        return {"ok": False, "error": str(e)}
    except sqlite3.Error:
        return {"ok": False, "error": "db_unreadable"}
    except OSError:
        return {"ok": False, "error": "unreadable"}


def emit(kind, data, profile=None):
    line = json.dumps(
        {"type": kind, "ts": round(time.time(), 3), "profile": profile, "data": data},
        separators=(",", ":"),
        allow_nan=False,
    )
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except (BrokenPipeError, OSError, ValueError):
        os._exit(0)


def parse_args(argv):
    args = {"home": None, "ticks": 0, "interval": 1.0, "agents_interval": 10.0, "cursors": {}, "history": FEED_HISTORY_ROWS, "query": None, "vault": None, "vault_interval": VAULT_POLL_S, "inter_interval": 2.0}
    it = iter(argv)
    for a in it:
        if a == "--cursors":
            try:
                parsed = json.loads(next(it))
                args["cursors"] = parsed if isinstance(parsed, dict) else {}
            except ValueError:
                args["cursors"] = {}
        elif a == "--history":
            args["history"] = int(next(it))
        elif a == "--query":
            args["query"] = (next(it), next(it))
        elif a == "--vault":
            args["vault"] = next(it)
        elif a == "--vault-interval":
            args["vault_interval"] = float(next(it))
        elif a == "--interactions-interval":
            args["inter_interval"] = float(next(it))
        elif a == "--ticks":
            args["ticks"] = int(next(it))
        elif a == "--interval":
            args["interval"] = float(next(it))
        elif a == "--agents-interval":
            args["agents_interval"] = float(next(it))
        elif args["home"] is None:
            args["home"] = a
    if not args["home"]:
        args["home"] = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    return args


def main(argv):
    args = parse_args(argv)
    if args["query"] is not None:
        sys.stdout.write(json.dumps(run_query(args["home"], args["query"][0], args["query"][1]), separators=(",", ":"), allow_nan=False) + "\n")
        sys.stdout.flush()
        return 0
    if args["vault"] is not None:
        return run_vault(args["vault"], args["vault_interval"], args["ticks"])
    sampler = Sampler()
    feed = FeedState(args["cursors"])
    feed_reported = set()
    feed_started = False
    try:
        sampler.sample()
    except Exception as ex:  # noqa: BLE001 - never crash the stream
        emit("error", {"code": "sample_failed", "message": type(ex).__name__})
    clock = time.monotonic
    next_metrics = clock() + min(args["interval"], 0.5)
    next_agents = clock()
    reported = set()
    last_cron = None
    inter = InteractionState()
    next_inter = clock()
    last_inter = None
    done = 0
    while True:
        now = clock()
        if now >= next_agents:
            try:
                data, errors = collect_agents(args["home"], time.time())
                emit("agents", data)
                current = set()
                for e in errors:
                    key = (e["code"], e.get("profile"))
                    current.add(key)
                    if key not in reported:
                        emit("error", e, e.get("profile"))
                reported = current
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "agents_failed", "message": type(ex).__name__})
            try:
                cron = collect_cron(args["home"])
                digest = cron_digest(cron)
                if digest != last_cron:
                    emit("cron", cron)
                    last_cron = digest
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "cron_failed", "message": type(ex).__name__})
            next_agents = clock() + args["agents_interval"]
        if now >= next_inter:
            try:
                data = inter.poll(args["home"], time.time())
                digest = inter.digest(data)
                if digest != last_inter:
                    emit("interactions", data)
                    last_inter = digest
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "interactions_failed", "message": type(ex).__name__})
            next_inter = clock() + args["inter_interval"]
        if now >= next_metrics:
            try:
                emit("metrics", sampler.sample())
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "sample_failed", "message": type(ex).__name__})
            try:
                items, history, errs = feed.poll(args["home"], args["history"])
                for i in range(0, len(items), FEED_CHUNK):
                    emit("feed", {"items": items[i:i + FEED_CHUNK], "cursors": dict(feed.cursors), "history": history})
                if not feed_started:
                    # Say so once even when there is nothing to show, so the screen can stop waiting.
                    if not items:
                        emit("feed", {"items": [], "cursors": dict(feed.cursors), "history": not args["cursors"]})
                    feed_started = True
                current = set()
                for e in errs:
                    key = (e["code"], e["profile"])
                    current.add(key)
                    if key not in feed_reported:
                        emit("error", e, e["profile"])
                feed_reported = current
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "feed_failed", "message": type(ex).__name__})
            next_metrics = clock() + args["interval"]
            done += 1
            if args["ticks"] and done >= args["ticks"]:
                return 0
        time.sleep(max(0.0, min(next_metrics, next_agents, next_inter) - clock()))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
