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
    args = {"home": None, "ticks": 0, "interval": 1.0, "agents_interval": 10.0}
    it = iter(argv)
    for a in it:
        if a == "--ticks":
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
    sampler = Sampler()
    try:
        sampler.sample()
    except Exception as ex:  # noqa: BLE001 - never crash the stream
        emit("error", {"code": "sample_failed", "message": type(ex).__name__})
    clock = time.monotonic
    next_metrics = clock() + min(args["interval"], 0.5)
    next_agents = clock()
    reported = set()
    last_cron = None
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
        if now >= next_metrics:
            try:
                emit("metrics", sampler.sample())
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "sample_failed", "message": type(ex).__name__})
            next_metrics = clock() + args["interval"]
            done += 1
            if args["ticks"] and done >= args["ticks"]:
                return 0
        time.sleep(max(0.0, min(next_metrics, next_agents) - clock()))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
