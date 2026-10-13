#!/usr/bin/env python3
"""Hermes Agent Mission Control collector.

Read-only, stdlib only, ASCII only. The desktop app streams this file over SSH
stdin (`python -u - <hermes_home>`); nothing is ever written to the VPS.
Emits one JSON object per line on stdout.
"""
import bisect
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


GW_PLATFORMS_MAX = 12
ERR_TAIL_BYTES = 64 * 1024
ERR_RECHECK_S = 60
ERR_LINE_RE = re.compile(r"^\[?(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)\S*\s+\[?(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\b")
_ERR_CACHE = {}


def _opt_str(v):
    if v is None or isinstance(v, (dict, list)):
        return None
    s = str(v).strip()
    return s[:120] if s else None


def gateway_platforms(state):
    p = state.get("platforms") if isinstance(state, dict) else None
    out = []
    if isinstance(p, dict):
        for name, v in p.items():
            if isinstance(v, dict):
                out.append({"name": str(name)[:64], "state": _opt_str(v.get("state")), "errorCode": _opt_str(v.get("error_code", v.get("errorCode")))})
            else:
                out.append({"name": str(name)[:64], "state": _opt_str(v), "errorCode": None})
    elif isinstance(p, list):
        for item in p:
            if isinstance(item, str):
                out.append({"name": item[:64], "state": None, "errorCode": None})
            elif isinstance(item, dict) and item.get("name"):
                out.append({"name": str(item["name"])[:64], "state": _opt_str(item.get("state")), "errorCode": _opt_str(item.get("error_code", item.get("errorCode")))})
    return out[:GW_PLATFORMS_MAX]


def gateway_info(state, pdir, now):
    """What the Gateway tab shows, from one gateway_state.json (unknown fields are ignored)."""
    if not isinstance(state, dict) or not state:
        return None
    pid = state.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool):
        pid = read_pid(os.path.join(pdir, "gateway.pid"))
    hb = None
    for key in HB_KEYS:
        if key in state:
            hb = to_epoch(state[key])
            if hb is not None:
                break
    return {
        "state": _opt_str(state.get("gateway_state")),
        "pidAlive": pid_alive(pid) if pid else None,
        "updatedAgeS": round(max(0.0, now - hb), 1) if hb is not None else None,
        "exitReason": _opt_str(state.get("exit_reason")),
        "restartRequested": bool(state.get("restart_requested")),
        "platforms": gateway_platforms(state),
    }


def count_errors_1h(path, now):
    """ERROR and CRITICAL lines of errors.log with a timestamp in the last hour; None when no line has a readable timestamp.
    The tail is re-read only when the file changed or a minute has passed."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    sig = (st.st_size, st.st_mtime)
    hit = _ERR_CACHE.get(path)
    if hit and hit[0] == sig and now - hit[1] < ERR_RECHECK_S:
        return hit[2]
    try:
        with open(path, "rb") as f:
            start = max(0, st.st_size - ERR_TAIL_BYTES)
            f.seek(start)
            data = f.read()
    except OSError:
        return None
    lines = data.decode("utf-8", "replace").split("\n")
    if start > 0 and lines:
        lines = lines[1:]
    count, seen = 0, False
    for line in lines:
        m = ERR_LINE_RE.match(line)
        if not m:
            continue
        try:
            ts = time.mktime((int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6)), 0, 0, -1))
        except (ValueError, OverflowError):
            continue
        seen = True
        if m.group(7) in ("ERROR", "CRITICAL", "FATAL") and now - 3600 <= ts <= now + 300:
            count += 1
    result = count if seen else None
    _ERR_CACHE[path] = (sig, now, result)
    return result


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
        own_state = state if name == "default" else read_json(os.path.join(pdir, "gateway_state.json"))
        gw_state = own_state if own_state else (state if primary else None)
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
            "gateway": gateway_info(gw_state, pdir if (own_state or name == "default") else home, now),
            "errors1h": count_errors_1h(os.path.join(pdir, "logs", "errors.log"), now),
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
        "inflight": False,
        "incident": None,
    }


def valid_job_id(job_id):
    return isinstance(job_id, str) and JOB_ID_RE.match(job_id) is not None and job_id not in (".", "..")


def output_files(pdir, job_id):
    """Output files of a job: (rel, real path, mtime, size), newest first. `rel` is `<id>/<file>` or a legacy loose
    `<id>_*` / `<id>.*` file; every real path must stay inside cron/output."""
    if not valid_job_id(job_id):
        return []
    base = os.path.join(pdir, "cron", "output")
    try:
        names = os.listdir(base)
        real_base = os.path.realpath(base)
    except OSError:
        return []
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
    out = []
    for rel, path in candidates:
        if not CRON_REL.fullmatch(rel):
            continue
        try:
            real = os.path.realpath(path)
            if not real.startswith(real_base + os.sep) or not os.path.isfile(real):
                continue
            st = os.stat(real)
        except OSError:
            continue
        out.append((rel, real, st.st_mtime, st.st_size))
    out.sort(key=lambda x: (-x[2], x[0]))
    return out


def find_last_output(pdir, job_id):
    files = output_files(pdir, job_id)
    return {"rel": files[0][0], "mtime": files[0][2]} if files else None


# ---- cron ledger (cron/executions.db, read-only; M9b) -----------------------

JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
INCIDENT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
LEDGER_INFLIGHT_SILENCE_S = 7200
_LEDGER_CACHE = {}
EXEC_PAIRS = [("id", "id"), ("job_id", "job_id"), ("source", "source"), ("status", "status"), ("claimed_at", "claimed_at"),
              ("started_at", "started_at"), ("finished_at", "finished_at"), ("error", "error"),
              ("delivery_outcome", "delivery_outcome"), ("scheduled_instant", "scheduled_instant"), ("progress_at", "progress_at")]
INCIDENT_PAIRS = [("id", "id"), ("job_id", "job_id"), ("state", "state"), ("failure_type", "failure_type"),
                  ("first_seen_at", "first_seen_at"), ("last_seen_at", "last_seen_at"), ("acked_at", "acked_at"),
                  ("closed_at", "closed_at"), ("error", "error"), ("output_file", "output_file")]


def _ledger_path(pdir):
    return os.path.join(pdir, "cron", "executions.db")


def _sel(cols, pairs):
    return ", ".join(c if c in cols else ("NULL AS %s" % a) for a, c in pairs)


def _epoch(v):
    return iso_to_epoch(v)[0]


def _incident(r):
    out = r.get("output_file")
    return {
        "id": str(r["id"]), "state": (_text(r.get("state"), 20) or "").lower() or "unknown",
        "failureType": _text(r.get("failure_type"), 40) or "unknown",
        "firstSeenTs": _epoch(r.get("first_seen_at")), "lastSeenTs": _epoch(r.get("last_seen_at")),
        "ackedTs": _epoch(r.get("acked_at")), "closedTs": _epoch(r.get("closed_at")),
        "error": _text(r.get("error"), 500) or "",
        "output": os.path.basename(out)[:200] if isinstance(out, str) and out else None,
    }


def _ledger_key(path):
    parts = []
    for p in (path, path + "-wal"):
        try:
            st = os.stat(p)
            parts.append((st.st_size, st.st_mtime_ns))
        except OSError:
            parts.append(None)
    return tuple(parts)


def _read_ledger(path, now):
    inflight, incidents = set(), {}
    con = open_ro(path)
    try:
        ecols = table_columns(con, "executions")
        if {"job_id", "status"} <= ecols:
            sel = _sel(ecols, [("job_id", "job_id"), ("claimed_at", "claimed_at"), ("progress_at", "progress_at")])
            for job_id, claimed, progress in con.execute("SELECT %s FROM executions WHERE status IN ('claimed','running')" % sel):
                last = _epoch(progress) or _epoch(claimed)
                if last is None or now - last < LEDGER_INFLIGHT_SILENCE_S:
                    inflight.add(str(job_id))
        icols = table_columns(con, "cron_incidents")
        if {"id", "job_id", "state"} <= icols:
            order = " ORDER BY julianday(last_seen_at) DESC, id" if "last_seen_at" in icols else ""
            sql = "SELECT %s FROM cron_incidents WHERE lower(state) IN ('detected','alerted')%s" % (_sel(icols, INCIDENT_PAIRS), order)
            for r in _dict_rows(con.execute(sql)):
                incidents.setdefault(str(r["job_id"]), _incident(r))
    finally:
        con.close()
    return inflight, incidents


def cron_ledger(pdir, now):
    """{inflight: set of job ids with a claimed or running attempt, incidents: {job id: newest open incident}}. Read
    again only when the database or its WAL changed; a missing or unreadable ledger gives empty parts."""
    path = _ledger_path(pdir)
    if not os.path.isfile(path):
        _LEDGER_CACHE.pop(path, None)
        return set(), {}
    key = _ledger_key(path)
    hit = _LEDGER_CACHE.get(path)
    if hit is not None and hit[0] == key and not hit[1][0]:
        return hit[1]
    try:
        value = _read_ledger(path, now)
    except sqlite3.Error:
        value = (set(), {})
    _LEDGER_CACHE[path] = (key, value)
    return value


def collect_cron(home, now=None):
    now = time.time() if now is None else now
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
        inflight, incidents = cron_ledger(pdir, now)
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
            job["inflight"] = job["id"] in inflight
            job["incident"] = incidents.get(job["id"])
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
                tscol = _pick_col(ecols, ("created_at", "ts"))
                if "task_id" in ecols and tscol:
                    for tid, ts in con.execute("SELECT task_id, MAX(%s) FROM task_events GROUP BY task_id" % tscol):
                        last_ev[tid] = to_epoch(ts) or 0.0
                sel = ", ".join(("%s AS %s" % (col[k], k)) if col[k] else ("NULL AS %s" % k) for k in TASK_COLS)
                for r in con.execute("SELECT %s FROM tasks ORDER BY %s DESC LIMIT 500" % (sel, col["created"] or col["id"])):
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


SEARCH_QUERY_MAX = 200


def fts_expression(text):
    """Every word becomes a quoted FTS5 phrase, so user text can never be FTS syntax."""
    words = [w for w in text.split() if w]
    return " ".join('"%s"' % w.replace('"', '""') for w in words[:12])


def _like_pattern(text):
    esc = text.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return "%" + esc + "%"


def _has_table(con, name):
    return con.execute("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table','view')", (name,)).fetchone() is not None


def _search_fts(con, scols, source, since, expr, limit):
    mcols = table_columns(con, "messages")
    where, params = ["messages_fts MATCH ?"], [expr]
    if "active" in mcols:
        where.append("m.active = 1")
    if since is not None:
        where.append("s.started_at >= ?")
        params.append(since)
    if source is not None and "source" in scols:
        where.append("s.source = ?")
        params.append(source)
    sql = ("SELECT m.session_id AS sid, snippet(messages_fts, -1, char(2), char(3), '...', 14) AS snip FROM messages_fts "
           "JOIN messages m ON m.id = messages_fts.rowid JOIN sessions s ON s.id = m.session_id "
           "WHERE %s ORDER BY rank LIMIT ?" % " AND ".join(where))
    return [(r[0], r[1]) for r in con.execute(sql, params + [limit])]


def _search_titles(con, scols, source, since, text, limit):
    if "title" not in scols:
        return []
    where, params = ["s.title LIKE ? ESCAPE '\\'"], [_like_pattern(text)]
    if since is not None:
        where.append("s.started_at >= ?")
        params.append(since)
    if source is not None and "source" in scols:
        where.append("s.source = ?")
        params.append(source)
    sql = "SELECT s.id FROM sessions s WHERE %s ORDER BY s.started_at DESC LIMIT ?" % " AND ".join(where)
    return [(r[0], None) for r in con.execute(sql, params + [limit])]


def q_sessions_search(home, a):
    profiles, source, since = _filters(a)
    text = a.get("q")
    if not isinstance(text, str) or not text.strip() or len(text) > SEARCH_QUERY_MAX:
        raise QueryError("bad_args")
    limit = _limit(a, SESSIONS_SEARCH_MAX, SESSIONS_SEARCH_MAX)
    expr = fts_expression(text)
    rows, errors, sources, readable, fallback = [], [], set(), 0, None
    for name, db in _each_profile(home, profiles):
        con = None
        try:
            con = open_ro(db)
            scols = table_columns(con, "sessions")
            if not _has_sessions(scols):
                errors.append({"profile": name, "code": "unsupported_schema"})
                continue
            hits = None
            if _has_table(con, "messages_fts") and _has_table(con, "messages"):
                try:
                    hits = _search_fts(con, scols, source, since, expr, limit)
                except sqlite3.OperationalError:
                    hits = None
            if hits is None:
                fallback = "title"
                hits = _search_titles(con, scols, source, since, text, limit)
            snippets = {}
            for sid, snip in hits:
                snippets.setdefault(sid, snip)
            sids = list(snippets)
            for i in range(0, len(sids), 200):
                chunk = sids[i:i + 200]
                marks = ",".join("?" * len(chunk))
                got = _dict_rows(con.execute("SELECT %s FROM sessions s WHERE s.id IN (%s)" % (_session_select(scols), marks), chunk))
                kids = _children_of(con, scols, chunk)
                rows.extend(_session_row(name, g, g["id"] in kids, snippets.get(g["id"])) for g in got)
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
    return {"rows": rows[:limit], "sources": sorted(sources)[:SESSIONS_SOURCES_MAX], "errors": errors, "more": len(rows) > limit, "fallback": fallback}


def q_session_transcript(home, a):
    name, sid = a.get("profile"), a.get("sessionId")
    if not valid_profile(name) or not isinstance(sid, str) or not ID_RE.match(sid):
        raise QueryError("bad_args")
    after = a.get("afterId", 0)
    if not valid_int(after, 0):
        raise QueryError("bad_args")
    limit = _limit(a, TRANSCRIPT_PAGE, TRANSCRIPT_PAGE)
    con = open_profile(home, name)
    try:
        parts = feed_select(con)
        scols = table_columns(con, "sessions")
        if parts is None or "id" not in scols:
            raise QueryError("unsupported_schema")
        base, where = parts
        got = _dict_rows(con.execute("SELECT %s FROM sessions s WHERE s.id = ?" % _session_select(scols), (sid,)))
        rows = fetch_rows(con, base, where, ["m.session_id = ?", "m.id > ?"], [sid, after], "m.id ASC", limit)
        if not got and not rows:
            raise QueryError("not_found")
        srow = got[0] if got else {"id": sid}
        kids = _children_of(con, scols, [sid])
        parent = None
        pid = srow.get("parent_session_id")
        if pid:
            prow = con.execute("SELECT title FROM sessions WHERE id = ?", (pid,)).fetchone() if "title" in scols else None
            parent = {"id": pid, "title": _text(prow[0], 200) if prow else None}
        children = []
        if "parent_session_id" in scols:
            tcol = "title" if "title" in scols else "NULL"
            scol = "source" if "source" in scols else "NULL"
            children = [{"id": r[0], "title": _text(r[1], 200), "source": _text(r[2], 64)} for r in
                        con.execute("SELECT id, %s, %s FROM sessions WHERE parent_session_id = ? ORDER BY started_at LIMIT 50" % (tcol, scol), (sid,))]
    finally:
        con.close()
    items = []
    for r in rows:
        items.extend(row_items(name, r))
    row_ids = [r["id"] for r in rows if isinstance(r["id"], int)]
    return {
        "session": _session_row(name, srow, sid in kids),
        "items": items,
        "nextAfter": max(row_ids) if len(rows) >= limit and row_ids else None,
        "chain": {"parent": parent, "children": children},
        "total": _opt_int(srow.get("message_count")),
    }


# ---- usage (M8b) ------------------------------------------------------------

USAGE_COLS = ["model", "billing_provider", "input_tokens", "output_tokens", "cache_read_tokens", "api_call_count",
              "estimated_cost_usd", "actual_cost_usd", "cost_status"]
USAGE_SESSIONS_MAX = 50000
USAGE_ROWS_MAX = 5000
USAGE_DAYS_MAX = 31


def _usage_cost(r):
    """(cost, estimated part, unknown flag) for one session, by the same rules as the session list."""
    if r.get("cost_status") not in (None, "", "actual", "estimated"):
        return 0.0, 0.0, 1
    actual, est = _opt_num(r.get("actual_cost_usd")), _opt_num(r.get("estimated_cost_usd"))
    if actual is not None:
        return actual, 0.0, 0
    if est is not None:
        return est, est, 0
    return 0.0, 0.0, 0


def _day_starts(a):
    starts = a.get("dayStarts")
    if not isinstance(starts, list) or not 1 <= len(starts) <= USAGE_DAYS_MAX:
        raise QueryError("bad_args")
    for v in starts:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise QueryError("bad_args")
    if any(b <= x for x, b in zip(starts, starts[1:])):
        raise QueryError("bad_args")
    end = a.get("endTs")
    if isinstance(end, bool) or not isinstance(end, (int, float)) or end <= starts[-1]:
        raise QueryError("bad_args")
    return starts, end


def _select_cols(scols, wanted):
    return ", ".join(["s.started_at AS started_at"] + [("s.%s AS %s" % (c, c)) if c in scols else ("NULL AS %s" % c) for c in wanted])


def q_usage_summary(home, a):
    profiles = _filters({"profiles": a.get("profiles", [])})[0]
    starts, end = _day_starts(a)
    groups, errors, readable, truncated = {}, [], 0, False
    for name, db in _each_profile(home, profiles):
        con = None
        try:
            con = open_ro(db)
            scols = table_columns(con, "sessions")
            if not _has_sessions(scols):
                errors.append({"profile": name, "code": "unsupported_schema"})
                continue
            sql = "SELECT %s FROM sessions s WHERE s.started_at >= ? AND s.started_at < ? ORDER BY s.started_at DESC LIMIT ?" % _select_cols(scols, USAGE_COLS)
            got = _dict_rows(con.execute(sql, (starts[0], end, USAGE_SESSIONS_MAX + 1)))
            if len(got) > USAGE_SESSIONS_MAX:
                truncated = True
                got = got[:USAGE_SESSIONS_MAX]
            for r in got:
                ts = to_epoch(r.get("started_at"))
                if ts is None:
                    continue
                day = bisect.bisect_right(starts, ts) - 1
                if day < 0:
                    continue
                k = (day, name, _text(r.get("billing_provider"), 64), _text(r.get("model"), 128))
                g = groups.setdefault(k, {"sessions": 0, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "apiCalls": None,
                                          "cost": 0.0, "estimatedCost": 0.0, "unknownCost": 0})
                cost, est, unknown = _usage_cost(r)
                g["sessions"] += 1
                g["inputTokens"] += _opt_int(r.get("input_tokens")) or 0
                g["outputTokens"] += _opt_int(r.get("output_tokens")) or 0
                g["cacheReadTokens"] += _opt_int(r.get("cache_read_tokens")) or 0
                calls = _opt_int(r.get("api_call_count"))
                if calls is not None:
                    g["apiCalls"] = (g["apiCalls"] or 0) + calls
                g["cost"] += cost
                g["estimatedCost"] += est
                g["unknownCost"] += unknown
            readable += 1
        except sqlite3.Error:
            errors.append({"profile": name, "code": "db_unreadable"})
        finally:
            if con is not None:
                con.close()
    if errors and readable == 0:
        raise QueryError(errors[0]["code"])
    rows = []
    for k, g in groups.items():
        row = {"day": k[0], "profile": k[1], "provider": k[2], "model": k[3]}
        row.update({f: (round(v, 6) if isinstance(v, float) else v) for f, v in g.items()})
        rows.append(row)
    rows.sort(key=lambda r: (r["day"], r["profile"], r["model"] or "", r["provider"] or ""))
    if len(rows) > USAGE_ROWS_MAX:
        truncated = True
        rows = rows[:USAGE_ROWS_MAX]
    return {"rows": rows, "truncated": truncated, "errors": errors}


TOOL_ROWS_MAX = 20000
TOOLS_MAX = 200
TOOL_FAILURES_KEPT = 5
_EXIT_RE = re.compile(r"exit code [1-9]")


def _looks_failed(text):
    t = (text or "").strip().lower()
    if not t:
        return False
    for start in ("error", "traceback", "exception", "failed"):
        if t.startswith(start):
            return True
    return '"error":' in t or _EXIT_RE.search(t) is not None


def q_usage_tools(home, a):
    profiles = _filters({"profiles": a.get("profiles", [])})[0]
    since, end = a.get("sinceTs"), a.get("endTs")
    for v in (since, end):
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise QueryError("bad_args")
    if end <= since:
        raise QueryError("bad_args")
    stats, errors, readable, scanned, truncated = {}, [], 0, 0, False
    for name, db in _each_profile(home, profiles):
        con = None
        try:
            con = open_ro(db)
            mcols = table_columns(con, "messages")
            if not {"id", "session_id", "role", "timestamp", "tool_name", "content"} <= mcols:
                errors.append({"profile": name, "code": "unsupported_schema"})
                continue
            active = " AND active = 1" if "active" in mcols else ""
            sql = ("SELECT id, session_id, timestamp, tool_name, substr(content, 1, 400) FROM messages "
                   "WHERE role = 'tool' AND timestamp >= ? AND timestamp < ?%s ORDER BY id DESC LIMIT ?" % active)
            rows = con.execute(sql, (since, end, TOOL_ROWS_MAX + 1)).fetchall()
            if len(rows) > TOOL_ROWS_MAX:
                truncated = True
                rows = rows[:TOOL_ROWS_MAX]
            for mid, sid, ts, tool, text in rows:
                scanned += 1
                prev = con.execute("SELECT timestamp FROM messages WHERE session_id = ? AND id < ?%s ORDER BY id DESC LIMIT 1" % active, (sid, mid)).fetchone()
                t_ts, p_ts = to_epoch(ts), (to_epoch(prev[0]) if prev else None)
                label = _text(tool, 80) or "unknown"
                s = stats.setdefault(label, {"name": label, "calls": 0, "errors": 0, "ms": [], "lastTs": None, "byProfile": {}, "failures": []})
                s["calls"] += 1
                s["byProfile"][name] = s["byProfile"].get(name, 0) + 1
                if t_ts is not None and (s["lastTs"] is None or t_ts > s["lastTs"]):
                    s["lastTs"] = t_ts
                if t_ts is not None and p_ts is not None and t_ts >= p_ts:
                    s["ms"].append(int(round((t_ts - p_ts) * 1000)))
                if _looks_failed(text):
                    s["errors"] += 1
                    s["failures"].append({"profile": name, "sessionId": _text(sid, 128) or "", "ts": t_ts, "text": (_text(text) or "")[:160]})
            readable += 1
        except sqlite3.Error:
            errors.append({"profile": name, "code": "db_unreadable"})
        finally:
            if con is not None:
                con.close()
    if errors and readable == 0:
        raise QueryError(errors[0]["code"])
    tools = []
    for s in stats.values():
        ms = s.pop("ms")
        s["avgMs"] = int(round(sum(ms) / len(ms))) if ms else None
        s["maxMs"] = max(ms) if ms else None
        s["failures"].sort(key=lambda f: -(f["ts"] or 0))
        s["failures"] = s["failures"][:TOOL_FAILURES_KEPT]
        tools.append(s)
    tools.sort(key=lambda s: (-s["calls"], s["name"]))
    return {"tools": tools[:TOOLS_MAX], "scanned": scanned, "truncated": truncated, "errors": errors}


# ---- logs (M9a) -------------------------------------------------------------

LOG_FILES = ("agent.log", "errors.log", "gateway.log", "tool_calls.log")
LOG_LIMIT_MAX = 2000
LOG_CHUNK = 64 * 1024
LOG_TAIL_BYTES_MAX = 1024 * 1024
LOG_AFTER_MAX = 256 * 1024
LOG_LINE_MAX = 4000


def _log_file(home, name, fname):
    """The real path of a log file of this profile, or None when it is missing or its real path leaves the logs folder."""
    pdir = profile_dir(home, name)
    if not pdir:
        return None
    d = os.path.join(pdir, "logs")
    path = os.path.join(d, fname)
    try:
        real_dir, real = os.path.realpath(d), os.path.realpath(path)
    except OSError:
        return None
    if not real.startswith(real_dir + os.sep) or not os.path.isfile(real):
        return None
    return real


def q_logs_list(home, a):
    profiles = a.get("profiles", [])
    if not isinstance(profiles, list) or len(profiles) > 50 or not all(valid_profile(p) for p in profiles):
        raise QueryError("bad_args")
    files = []
    for name, _pdir in list_profiles(home):
        if profiles and name not in profiles:
            continue
        for fname in LOG_FILES:
            real = _log_file(home, name, fname)
            if real is None:
                continue
            try:
                st = os.stat(real)
            except OSError:
                continue
            files.append({"profile": name, "name": fname, "size": st.st_size, "mtime": st.st_mtime})
    return {"files": files, "errors": []}


def _whole_lines(data, base):
    """(complete lines as bytes, offset just after the last newline). A trailing partial line is left for the next read."""
    cut = data.rfind(b"\n")
    if cut < 0:
        return [], base
    return data[:cut + 1].split(b"\n")[:-1], base + cut + 1


def _tail(f, size, limit):
    """The last `limit` whole lines: (lines, start offset of the first one, end offset)."""
    pos, buf = size, b""
    while pos > 0 and buf.count(b"\n") <= limit and len(buf) < LOG_TAIL_BYTES_MAX:
        step = min(LOG_CHUNK, pos)
        pos -= step
        f.seek(pos)
        buf = f.read(step) + buf
    lines, end = _whole_lines(buf, pos)
    start = pos
    if pos > 0 and lines:
        start += len(lines.pop(0)) + 1  # the first line may have begun before what was read
    if len(lines) > limit:
        drop = len(lines) - limit
        start += sum(len(x) + 1 for x in lines[:drop])
        lines = lines[drop:]
    return lines, start, end


def _decode(lines):
    return [x.decode("utf-8", "replace").rstrip("\r")[:LOG_LINE_MAX] for x in lines]


def q_logs_read(home, a):
    name, fname = a.get("profile"), a.get("file")
    if not valid_profile(name) or fname not in LOG_FILES:
        raise QueryError("bad_args")
    limit = _limit(a, 500, LOG_LIMIT_MAX)
    after = a.get("after")
    if after is not None and not valid_int(after, 0):
        raise QueryError("bad_args")
    real = _log_file(home, name, fname)
    if real is None:
        raise QueryError("not_found")
    reset = skipped = False
    with open(real, "rb") as f:
        st = os.fstat(f.fileno())
        size = st.st_size
        if after is None or after > size:
            reset = after is not None
            lines, start, end = _tail(f, size, limit)
        else:
            start = after
            if size - after > LOG_AFTER_MAX:
                skipped = True
                start = size - LOG_AFTER_MAX
            f.seek(start)
            data = f.read(size - start)
            if skipped:
                nl = data.find(b"\n")
                data = data[nl + 1:] if nl >= 0 else b""
                start = size - len(data)
            lines, end = _whole_lines(data, start)
            if len(lines) > limit:
                skipped = True
                drop = len(lines) - limit
                start += sum(len(x) + 1 for x in lines[:drop])
                lines = lines[drop:]
    return {"lines": _decode(lines), "offset": end, "size": size, "mtime": st.st_mtime, "startOffset": start,
            "more": start > 0 and (after is None or reset), "reset": reset, "skipped": skipped}


# ---- kanban (read-only screen) ----------------------------------------------

KANBAN_TASKS_MAX = 1000
KANBAN_BODY_MAX = 65536
KANBAN_COMMENT_MAX = 16384
KANBAN_PAYLOAD_MAX = 2000
KANBAN_SUMMARY_MAX = 4096
KANBAN_COMMENTS_BUDGET = 300000
BOARD_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _kanban_dbs(home):
    """(slug, path) of every kanban.db: the home one is the board `default`, each folder under kanban/boards is its own board."""
    out = []
    home_db = os.path.join(home, "kanban.db")
    if os.path.isfile(home_db):
        out.append(("default", home_db))
    base = os.path.join(home, "kanban", "boards")
    try:
        names = sorted(os.listdir(base))
    except OSError:
        names = []
    for name in names:
        path = os.path.join(base, name, "kanban.db")
        if BOARD_RE.match(name) and name != "default" and os.path.isfile(path):
            out.append((name, path))
    return out


def _kanban_path(home, slug):
    if not isinstance(slug, str) or not BOARD_RE.match(slug):
        raise QueryError("bad_args")
    for s, path in _kanban_dbs(home):
        if s == slug:
            return path
    raise QueryError("not_found")


def _kb_sel(cols, pairs, alias="t"):
    return ", ".join(("%s.%s AS %s" % (alias, c, a)) if c in cols else ("NULL AS %s" % a) for a, c in pairs)


def _kb_int(v, default=0):
    if isinstance(v, bool):
        return default
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    return default


def _kb_card(r):
    status = _text(r.get("status"), 40)
    return {
        "id": str(r["id"]), "title": _text(r.get("title"), 300), "assignee": _text(r.get("assignee"), 64), "createdBy": _text(r.get("created_by"), 64),
        "status": (status or "").strip().lower() or "other", "priority": _kb_int(r.get("priority")),
        "createdAt": to_epoch(r.get("created_at")), "startedAt": to_epoch(r.get("started_at")), "completedAt": to_epoch(r.get("completed_at")),
        "comments": _kb_int(r.get("comments")), "parents": _kb_int(r.get("parents")), "children": _kb_int(r.get("children")),
        "blockKind": _text(r.get("block_kind"), 40), "failures": _kb_int(r.get("consecutive_failures")), "failed": bool(r.get("last_failure_error")),
    }


CARD_PAIRS = [("id", "id"), ("title", "title"), ("assignee", "assignee"), ("created_by", "created_by"), ("status", "status"), ("priority", "priority"),
              ("created_at", "created_at"), ("started_at", "started_at"), ("completed_at", "completed_at"), ("block_kind", "block_kind"),
              ("consecutive_failures", "consecutive_failures"), ("last_failure_error", "last_failure_error")]


def _kb_counts(con):
    """SQL for the three counts of a card; a missing table or column counts as 0."""
    comments = "(SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id)" if {"task_id"} <= table_columns(con, "task_comments") else "0"
    lcols = table_columns(con, "task_links")
    parents = "(SELECT COUNT(*) FROM task_links l WHERE l.child_id = t.id)" if {"parent_id", "child_id"} <= lcols else "0"
    children = "(SELECT COUNT(*) FROM task_links l WHERE l.parent_id = t.id)" if {"parent_id", "child_id"} <= lcols else "0"
    return "%s AS comments, %s AS parents, %s AS children" % (comments, parents, children)


def q_kanban_boards(home, a):
    boards, errors = [], []
    for slug, path in _kanban_dbs(home):
        con = None
        try:
            con = open_ro(path)
            tcols = table_columns(con, "tasks")
            by = {}
            if "status" in tcols and "id" in tcols:
                by = {(str(s or "").strip().lower() or "other"): n for s, n in con.execute("SELECT status, COUNT(*) FROM tasks GROUP BY status")}
            archived = by.get("archived", 0)
            boards.append({"slug": slug, "path": os.path.relpath(path, home).replace(os.sep, "/"), "tasks": sum(by.values()) - archived,
                           "archived": archived, "byStatus": by, "readable": "id" in tcols})
        except sqlite3.Error:
            errors.append({"slug": slug, "code": "db_unreadable"})
        finally:
            if con is not None:
                con.close()
    return {"boards": boards, "errors": errors}


def q_kanban_tasks(home, a):
    path = _kanban_path(home, a.get("board"))
    con = open_ro(path)
    try:
        tcols = table_columns(con, "tasks")
        if "id" not in tcols:
            raise QueryError("unsupported_schema")
        has_status = "status" in tcols
        where = " WHERE (t.status IS NULL OR lower(t.status) != 'archived')" if has_status else ""
        order = "ORDER BY (t.created_at IS NULL), t.created_at DESC, t.id DESC" if "created_at" in tcols else "ORDER BY t.id DESC"
        sql = "SELECT %s, %s FROM tasks t%s %s LIMIT ?" % (_kb_sel(tcols, CARD_PAIRS), _kb_counts(con), where, order)
        rows = _dict_rows(con.execute(sql, (KANBAN_TASKS_MAX + 1,)))
        archived = con.execute("SELECT COUNT(*) FROM tasks WHERE lower(status) = 'archived'").fetchone()[0] if has_status else 0
    except sqlite3.Error:
        raise QueryError("db_unreadable")
    finally:
        con.close()
    return {"board": a["board"], "tasks": [_kb_card(r) for r in rows[:KANBAN_TASKS_MAX]], "archived": archived, "truncated": len(rows) > KANBAN_TASKS_MAX}


def _kb_ref(r):
    return {"id": str(r[0]), "title": _text(r[1], 300), "status": (_text(r[2], 40) or "").strip().lower() or "other"}


def q_kanban_task(home, a):
    path = _kanban_path(home, a.get("board"))
    tid = a.get("id")
    if not isinstance(tid, str) or not ID_RE.match(tid):
        raise QueryError("bad_args")
    con = open_ro(path)
    try:
        tcols = table_columns(con, "tasks")
        if "id" not in tcols:
            raise QueryError("unsupported_schema")
        extra = [("body", "body"), ("result", "result"), ("last_failure_error", "last_failure_error"), ("skills", "skills"),
                 ("model_override", "model_override"), ("provider_override", "provider_override"), ("session_id", "session_id")]
        sql = "SELECT %s, %s, %s FROM tasks t WHERE t.id = ?" % (_kb_sel(tcols, CARD_PAIRS), _kb_sel(tcols, extra), _kb_counts(con))
        rows = _dict_rows(con.execute(sql, (tid,)))
        if not rows:
            raise QueryError("not_found")
        r = rows[0]
        task = _kb_card(r)
        task.update({
            "body": _text(r.get("body"), KANBAN_BODY_MAX), "result": _text(r.get("result"), KANBAN_SUMMARY_MAX),
            "lastFailureError": _text(r.get("last_failure_error"), KANBAN_SUMMARY_MAX), "skills": _text(r.get("skills"), 300),
            "modelOverride": _text(r.get("model_override"), 128), "providerOverride": _text(r.get("provider_override"), 128),
            "sessionId": _text(r.get("session_id"), 128),
        })
        comments, runs, events, attachments, parents, children = [], [], [], [], [], []
        ccols = table_columns(con, "task_comments")
        if {"id", "task_id", "body"} <= ccols:
            sel = _kb_sel(ccols, [("id", "id"), ("author", "author"), ("body", "body"), ("created_at", "created_at")], "c")
            budget = KANBAN_COMMENTS_BUDGET  # the whole answer must fit the 1 MB the app accepts
            for x in _dict_rows(con.execute("SELECT %s FROM task_comments c WHERE c.task_id = ? ORDER BY c.id LIMIT 200" % sel, (tid,))):
                body = _text(x["body"], KANBAN_COMMENT_MAX) or ""
                if budget - len(body) < 0 and comments:
                    break
                budget -= len(body)
                comments.append({"id": _kb_int(x["id"]), "author": _text(x["author"], 64), "body": body, "createdAt": to_epoch(x["created_at"])})
        rcols = table_columns(con, "task_runs")
        if {"id", "task_id"} <= rcols:
            sel = _kb_sel(rcols, [("id", "id"), ("profile", "profile"), ("step_key", "step_key"), ("status", "status"), ("started_at", "started_at"),
                                  ("ended_at", "ended_at"), ("outcome", "outcome"), ("summary", "summary"), ("error", "error")], "r")
            got = _dict_rows(con.execute("SELECT %s FROM task_runs r WHERE r.task_id = ? ORDER BY r.id DESC LIMIT 50" % sel, (tid,)))
            runs = [{"id": _kb_int(x["id"]), "profile": _text(x["profile"], 64), "stepKey": _text(x["step_key"], 80), "status": _text(x["status"], 40),
                     "startedAt": to_epoch(x["started_at"]), "endedAt": to_epoch(x["ended_at"]), "outcome": _text(x["outcome"], 80),
                     "summary": _text(x["summary"], KANBAN_SUMMARY_MAX), "error": _text(x["error"], KANBAN_SUMMARY_MAX)} for x in reversed(got)]
        if {"parent_id", "child_id"} <= table_columns(con, "task_links"):
            parents = [_kb_ref(x) for x in con.execute("SELECT p.id, p.title, p.status FROM task_links l JOIN tasks p ON p.id = l.parent_id WHERE l.child_id = ? LIMIT 50", (tid,))]
            children = [_kb_ref(x) for x in con.execute("SELECT p.id, p.title, p.status FROM task_links l JOIN tasks p ON p.id = l.child_id WHERE l.parent_id = ? LIMIT 50", (tid,))]
        ecols = table_columns(con, "task_events")
        if {"id", "task_id"} <= ecols:
            sel = _kb_sel(ecols, [("id", "id"), ("run_id", "run_id"), ("kind", "kind"), ("payload", "payload"), ("created_at", "created_at")], "e")
            got = _dict_rows(con.execute("SELECT %s FROM task_events e WHERE e.task_id = ? ORDER BY e.id DESC LIMIT 100" % sel, (tid,)))
            events = [{"id": _kb_int(x["id"]), "runId": _kb_int(x["run_id"], None) if x["run_id"] is not None else None, "kind": _text(x["kind"], 80),
                       "payload": _text(x["payload"], KANBAN_PAYLOAD_MAX), "createdAt": to_epoch(x["created_at"])} for x in reversed(got)]
        acols = table_columns(con, "task_attachments")
        if {"id", "task_id"} <= acols:
            sel = _kb_sel(acols, [("id", "id"), ("filename", "filename"), ("size", "size"), ("uploaded_by", "uploaded_by"), ("created_at", "created_at")], "a")
            attachments = [{"id": _kb_int(x["id"]), "filename": _text(x["filename"], 255), "size": _kb_int(x["size"], None) if x["size"] is not None else None,
                            "uploadedBy": _text(x["uploaded_by"], 64), "createdAt": to_epoch(x["created_at"])}
                           for x in _dict_rows(con.execute("SELECT %s FROM task_attachments a WHERE a.task_id = ? ORDER BY a.id LIMIT 50" % sel, (tid,)))]
    except sqlite3.Error:
        raise QueryError("db_unreadable")
    finally:
        con.close()
    return {"task": task, "comments": comments, "runs": runs, "parents": parents, "children": children, "events": events, "attachments": attachments}


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
        if not (valid_int(ident) or (isinstance(ident, str) and ID_RE.match(ident))):
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
                ccols = table_columns(con, "task_comments")
                if {"id", "task_id", "body"} <= ccols:
                    cm = con.execute("SELECT body, %s FROM task_comments WHERE task_id = ? ORDER BY id DESC LIMIT 1" % ("created_at" if "created_at" in ccols else "NULL"), (ident,)).fetchone()
                    if cm and cm[0]:
                        text, ts = as_text(cm[0]), to_epoch(cm[1])
                ecols = table_columns(con, "task_events")
                tscol = _pick_col(ecols, ("created_at", "ts"))
                bcol = _pick_col(ecols, ("body", "text", "comment", "message", "payload", "kind"))
                if not text and {"id", "task_id"} <= ecols and tscol and bcol:
                    ev = con.execute("SELECT %s, %s FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1" % (bcol, tscol), (ident,)).fetchone()
                    if ev:
                        text, ts = as_text(ev[0]), to_epoch(ev[1])
            finally:
                con.close()
            rel = os.path.relpath(path, home).replace(os.sep, "/")
            return _inter_out(text, title=_text(row[0], 200), ts=ts, source="%s - task #%s" % (rel, ident))
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


# ---- memory files (M10b) ----------------------------------------------------

MEMORY_FILES = (("soul", ("SOUL.md",)), ("memory", ("memories", "MEMORY.md")), ("user", ("memories", "USER.md")))
MEMORY_MAX = 262144
MEMORY_AGENT_WINDOW_S = 120


def memory_tool_near(pdir, ts):
    """(timestamp, session id) of the `memory` tool result closest to `ts` within two minutes, from the profile's
    state.db; (None, None) when there is none or the database cannot tell."""
    db = os.path.join(pdir, "state.db")
    if not os.path.isfile(db):
        return None, None
    con = None
    try:
        con = open_ro(db)
        cols = table_columns(con, "messages")
        if not {"role", "timestamp", "tool_name", "session_id"} <= cols:
            return None, None
        row = con.execute(
            "SELECT timestamp, session_id FROM messages WHERE role = 'tool' AND tool_name = 'memory' AND timestamp BETWEEN ? AND ?"
            " ORDER BY abs(timestamp - ?) LIMIT 1", (ts - MEMORY_AGENT_WINDOW_S, ts + MEMORY_AGENT_WINDOW_S, ts)).fetchone()
        return (to_epoch(row[0]), str(row[1])) if row else (None, None)
    except sqlite3.Error:
        return None, None
    finally:
        if con is not None:
            con.close()


class MemoryState:
    """Watches SOUL.md, memories/MEMORY.md and memories/USER.md of every profile. A file is read only when its size or
    mtime changed, and reported only when its content hash differs from the last one sent (the first poll reports
    every file, as a baseline for the app's local snapshots)."""

    def __init__(self):
        self.stat = {}
        self.sent = {}

    def poll(self, home):
        out = []
        for name, pdir in list_profiles(home):
            for kind, parts in MEMORY_FILES:
                path = os.path.join(pdir, *parts)
                key = (name, kind)
                try:
                    st = os.stat(path)
                except OSError:
                    self.stat.pop(key, None)
                    continue
                sig = (st.st_size, st.st_mtime_ns)
                if self.stat.get(key) == sig:
                    continue
                try:
                    with open(path, "rb") as f:
                        data = f.read(MEMORY_MAX + 1)
                except OSError:
                    continue
                self.stat[key] = sig
                digest = hashlib.sha256(data[:MEMORY_MAX]).hexdigest()
                if self.sent.get(key) == digest:
                    continue
                self.sent[key] = digest
                agent_ts, session = memory_tool_near(pdir, st.st_mtime)
                out.append({"profile": name, "file": kind, "hash": digest, "text": data[:MEMORY_MAX].decode("utf-8", "replace"),
                            "truncated": len(data) > MEMORY_MAX, "size": st.st_size, "mtime": st.st_mtime,
                            "agentTs": agent_ts, "agentSession": session})
        return out


# ---- cron control (M9b) -----------------------------------------------------

CRON_RUNS_MAX = 20
CRON_OUTPUTS_MAX = 30
CRON_INCIDENTS_MAX = 10
CRON_OUTPUT_BYTES = 65536


def _cron_job_dir(home, a):
    name, jid = a.get("profile"), a.get("jobId")
    if not valid_profile(name) or not valid_job_id(jid):
        raise QueryError("bad_args")
    pdir = profile_dir(home, name)
    if not pdir:
        raise QueryError("not_found")
    return pdir, jid


def q_cron_jobs(home, a):
    return collect_cron(home)


def _run(r, has_instant):
    instant = r.get("scheduled_instant")
    status = (_text(r.get("status"), 20) or "").lower() or "unknown"
    return {
        "id": str(r["id"]), "status": status, "source": _text(r.get("source"), 40),
        "trigger": ("scheduled" if instant else "manual") if has_instant else None,
        "claimedTs": _epoch(r.get("claimed_at")), "startedTs": _epoch(r.get("started_at")), "finishedTs": _epoch(r.get("finished_at")),
        "error": _text(r.get("error"), 500), "delivery": _text(r.get("delivery_outcome"), 40), "output": None,
    }


def _pair_outputs(runs, files, now):
    """Gives each run the output file written while it ran (claim - 2 s to finish + 5 s), closest to its finish."""
    used = set()
    for run in runs:
        start = run["claimedTs"] if run["claimedTs"] is not None else run["startedTs"]
        if start is None:
            continue
        end = run["finishedTs"] if run["finishedTs"] is not None else now
        best = None
        for rel, _real, mtime, _size in files:
            if rel in used or mtime < start - 2 or mtime > end + 5:
                continue
            if best is None or abs(mtime - end) < abs(best[1] - end):
                best = (rel, mtime)
        if best is not None:
            used.add(best[0])
            run["output"] = best[0]


def q_cron_runs(home, a):
    pdir, jid = _cron_job_dir(home, a)
    limit = _limit(a, 6, CRON_RUNS_MAX)
    files = output_files(pdir, jid)
    path = _ledger_path(pdir)
    ledger, runs, incidents = "absent", [], []
    if os.path.isfile(path):
        try:
            con = open_ro(path)
            try:
                ecols = table_columns(con, "executions")
                if {"id", "job_id", "status"} <= ecols:
                    order = " ORDER BY julianday(claimed_at) DESC, claimed_at DESC, id DESC" if "claimed_at" in ecols else " ORDER BY rowid DESC"
                    sql = "SELECT %s FROM executions WHERE job_id = ?%s LIMIT ?" % (_sel(ecols, EXEC_PAIRS), order)
                    has_instant = "scheduled_instant" in ecols
                    runs = [_run(r, has_instant) for r in _dict_rows(con.execute(sql, (jid, limit)))]
                    ledger = "ok"
                icols = table_columns(con, "cron_incidents")
                if {"id", "job_id", "state"} <= icols:
                    order = " ORDER BY julianday(last_seen_at) DESC, id" if "last_seen_at" in icols else ""
                    sql = "SELECT %s FROM cron_incidents WHERE job_id = ?%s LIMIT ?" % (_sel(icols, INCIDENT_PAIRS), order)
                    incidents = [_incident(r) for r in _dict_rows(con.execute(sql, (jid, CRON_INCIDENTS_MAX)))]
            finally:
                con.close()
        except sqlite3.Error:
            ledger, runs, incidents = "unreadable", [], []
    if ledger == "ok":
        _pair_outputs(runs, files, time.time())
    else:
        # No ledger: the output files are the only trace of the runs (newest first).
        runs = [{"id": "file:" + rel, "status": "unknown", "source": None, "trigger": None, "claimedTs": None, "startedTs": None,
                 "finishedTs": mtime, "error": None, "delivery": None, "output": rel} for rel, _r, mtime, _s in files[:limit]]
    return {"ledger": ledger, "runs": runs, "incidents": incidents,
            "outputs": [{"name": rel, "mtime": mtime, "size": size} for rel, _r, mtime, size in files[:CRON_OUTPUTS_MAX]]}


def q_cron_output(home, a):
    pdir, jid = _cron_job_dir(home, a)
    names = a.get("names")
    if not isinstance(names, list) or not 1 <= len(names) <= 2 or not all(isinstance(n, str) and len(n) <= 300 for n in names):
        raise QueryError("bad_args")
    known = {rel: (real, mtime, size) for rel, real, mtime, size in output_files(pdir, jid)}
    files = []
    for n in names:
        hit = known.get(n)
        if hit is None:
            files.append({"name": n, "error": "not_found"})
            continue
        real, mtime, size = hit
        try:
            with open(real, "rb") as f:
                data = f.read(CRON_OUTPUT_BYTES + 1)
        except OSError:
            files.append({"name": n, "error": "unreadable"})
            continue
        cut = len(data) > CRON_OUTPUT_BYTES
        files.append({"name": n, "text": data[:CRON_OUTPUT_BYTES].decode("utf-8", "replace"), "truncated": cut, "mtime": mtime, "size": size})
    return {"files": files}


# ---- skills (M10a, read-only) -------------------------------------------------

SKILL_EXCLUDED = {".git", ".github", ".hub", ".archive", ".curator_backups", ".locks", ".venv", "venv", "node_modules",
                  "site-packages", "__pycache__", ".tox", ".nox", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
SKILL_SUPPORT = {"references", "templates", "assets", "scripts"}
SKILLS_MAX = 2000
SKILL_HEAD = 8192
SKILL_BODY_MAX = 262144
SKILL_LEDGER_TAIL = 2 * 1024 * 1024
SKILL_BLOB_MAX = 65536
SKILL_PATH_RE = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+){0,9}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
YAML_KEY_RE = re.compile(r"^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*))?$")


def _split_inline(s):
    out, cur, quote = [], "", None
    for ch in s:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur += ch
        elif ch == ",":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return out


def _yaml_scalar(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        return [_yaml_scalar(x) for x in _split_inline(v[1:-1])]
    if " #" in v:
        v = v.split(" #", 1)[0].rstrip()
    return v


def _yaml_node(lines, i, ind):
    if lines[i][1] == "-" or lines[i][1].startswith("- "):
        out = []
        while i < len(lines) and lines[i][0] == ind and (lines[i][1] == "-" or lines[i][1].startswith("- ")):
            item = lines[i][1][1:].strip()
            if item and YAML_KEY_RE.match(item) and not item.startswith(("\"", "'", "[")):
                lines[i] = (ind + 2, item)
                val, i = _yaml_map(lines, i, ind + 2)
                out.append(val)
            elif item:
                out.append(_yaml_scalar(item))
                i += 1
            else:
                i += 1
                if i < len(lines) and lines[i][0] > ind:
                    val, i = _yaml_node(lines, i, lines[i][0])
                    out.append(val)
        return out, i
    return _yaml_map(lines, i, ind)


def _yaml_map(lines, i, ind):
    out = {}
    while i < len(lines) and lines[i][0] == ind and not lines[i][1].startswith("- "):
        m = YAML_KEY_RE.match(lines[i][1])
        i += 1
        if not m:
            continue
        key, rest = m.group(1), (m.group(2) or "").strip()
        if rest in ("|", ">", "|-", ">-", "|+", ">+"):
            parts = []
            while i < len(lines) and lines[i][0] > ind:
                parts.append(lines[i][1])
                i += 1
            out[key] = ("\n" if rest.startswith("|") else " ").join(parts)
        elif rest:
            out[key] = _yaml_scalar(rest)
        elif i < len(lines) and (lines[i][0] > ind or (lines[i][0] == ind and lines[i][1].startswith("- "))):
            out[key], i = _yaml_node(lines, i, lines[i][0])
        else:
            out[key] = None
        while i < len(lines) and lines[i][0] > ind:
            i += 1  # whatever this subset did not understand
    return out, i


def parse_frontmatter(text):
    """(frontmatter dict, body) of a SKILL.md, read with a small YAML subset: scalars, inline and block lists, nested
    maps by indentation and block scalars. Anything else is skipped; a file without frontmatter gives ({}, text)."""
    t = text.lstrip("\ufeff")
    lines = t.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text
    try:
        end = next(k for k in range(1, len(lines)) if lines[k].strip() == "---")
    except StopIteration:
        end = len(lines)
    raw = []
    for ln in lines[1:end]:
        s = ln.rstrip("\r")
        if s.strip() and not s.strip().startswith("#"):
            raw.append((len(s) - len(s.lstrip(" ")), s.strip()))
    body = "\n".join(lines[end + 1:])
    if not raw:
        return {}, body
    try:
        fm, _ = _yaml_map(raw, 0, raw[0][0])
    except (IndexError, ValueError, RecursionError):
        fm = {}
    return fm, body


def _str_list(v, limit=40):
    if isinstance(v, str):
        v = [x.strip() for x in v.split(",")]
    if not isinstance(v, list):
        return []
    return [str(x)[:80] for x in v if isinstance(x, (str, int, float)) and str(x).strip()][:limit]


def _hermes_meta(fm):
    meta = fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {}
    return meta.get("hermes") if isinstance(meta.get("hermes"), dict) else {}


def skill_env_names(fm):
    """Names (never values) of the environment variables a skill asks for, as Hermes merges them."""
    names = []
    for item in fm.get("required_environment_variables") or [] if isinstance(fm.get("required_environment_variables"), list) else []:
        names.append(item if isinstance(item, str) else (item.get("name") or item.get("env_var")) if isinstance(item, dict) else None)
    setup = fm.get("setup") if isinstance(fm.get("setup"), dict) else {}
    for item in setup.get("collect_secrets") or [] if isinstance(setup.get("collect_secrets"), list) else []:
        names.append(item.get("env_var") if isinstance(item, dict) else None)
    pre = fm.get("prerequisites") if isinstance(fm.get("prerequisites"), dict) else {}
    names += _str_list(pre.get("env_vars"))
    out = []
    for n in names:
        if isinstance(n, str) and ENV_NAME_RE.match(n.strip()) and n.strip() not in out:
            out.append(n.strip())
    return out


def _skill_lines(path):
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            return [s.strip() for s in f.read().splitlines() if s.strip()]
    except OSError:
        return []


def _skill_names_from(sk):
    """(bundled names, hub names) by Hermes's own provenance rules."""
    bundled = {ln.split(":", 1)[0].strip() for ln in _skill_lines(os.path.join(sk, ".bundled_manifest"))}
    bundled |= {ln for ln in _skill_lines(os.path.join(sk, ".curator_suppressed")) if not ln.startswith("#")}
    hub = set()
    lock = read_text(os.path.join(sk, ".hub", "lock.json"))
    try:
        installed = (json.loads(lock) or {}).get("installed") if lock else None
    except ValueError:
        installed = None
    if isinstance(installed, dict):
        hub |= {str(k) for k in installed}
        for e in installed.values():
            p = e.get("install_path") if isinstance(e, dict) else None
            if isinstance(p, str) and SKILL_PATH_RE.match(p.strip("/")) and ".." not in p.split("/"):
                fm, _ = parse_frontmatter(_read_head(os.path.join(sk, p.strip("/"), "SKILL.md")) or "")
                if isinstance(fm.get("name"), str) and fm["name"].strip():
                    hub.add(fm["name"].strip())
    return {n for n in bundled if n}, hub


def _read_head(path, n=SKILL_HEAD):
    try:
        with open(path, "rb") as f:
            return f.read(n).decode("utf-8", "replace")
    except OSError:
        return None


def _skill_dirs(sk):
    """Posix paths (relative to skills/) of every skill folder, Hermes's scanner rules: excluded folders are skipped,
    support folders directly inside a skill are not skills, symlinked folders are not followed."""
    found = []
    for dirpath, dirnames, filenames in os.walk(sk):
        dirnames[:] = sorted(d for d in dirnames if d not in SKILL_EXCLUDED)
        if "SKILL.md" in filenames and dirpath != sk:
            dirnames[:] = [d for d in dirnames if d not in SKILL_SUPPORT]
            found.append(os.path.relpath(dirpath, sk).replace(os.sep, "/"))
            if len(found) > SKILLS_MAX:
                break
    arch = os.path.join(sk, ".archive")
    try:
        names = sorted(os.listdir(arch))
    except OSError:
        names = []
    for name in names:
        if os.path.isfile(os.path.join(arch, name, "SKILL.md")) and not os.path.islink(os.path.join(arch, name)):
            found.append(".archive/" + name)
    return found


def _usage_records(sk):
    text = read_text(os.path.join(sk, ".usage.json"))
    try:
        data = json.loads(text) if text else {}
    except ValueError:
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}


def _skill_row(profile, sk, rel, bundled, hub, usage):
    path = os.path.join(sk, *rel.split("/"), "SKILL.md")
    real = os.path.realpath(path)
    if not real.startswith(os.path.realpath(sk) + os.sep):
        return None
    head = _read_head(real)
    if head is None:
        return None
    fm, body = parse_frontmatter(head)
    hm = _hermes_meta(fm)
    parts = rel.split("/")
    archived_dir = parts[0] == ".archive"
    name = fm.get("name").strip() if isinstance(fm.get("name"), str) and fm.get("name").strip() else parts[-1]
    rec = usage.get(name, {})
    state = str(rec.get("state") or "").lower()
    if archived_dir:
        state = "archived"
    elif state not in ("active", "stale", "archived"):
        state = "active"
    category = "/".join(parts[:-1]) if not archived_dir else (str(hm.get("category") or "") if isinstance(hm.get("category"), str) else "")
    try:
        st = os.stat(real)
    except OSError:
        return None
    desc = fm.get("description")
    if not isinstance(desc, str) or not desc.strip():
        desc = next((ln.strip() for ln in body.split("\n") if ln.strip() and not ln.startswith("#")), "")
    return {
        "profile": profile, "path": rel, "category": category[:120], "dir": parts[-1], "name": name[:100],
        "description": desc.strip()[:300], "version": _text(fm.get("version"), 40) if isinstance(fm.get("version"), (str, int, float)) else None,
        "author": _text(fm.get("author"), 80) if isinstance(fm.get("author"), str) else None,
        "tags": _str_list(fm.get("tags") or hm.get("tags")), "platforms": _str_list(fm.get("platforms")),
        "requiresToolsets": _str_list(fm.get("requires_toolsets") or hm.get("requires_toolsets")),
        "envNames": skill_env_names(fm),
        "origin": "hub" if name in hub else "bundled" if name in bundled else "agent",
        "createdBy": _text(rec.get("created_by"), 40) if isinstance(rec.get("created_by"), str) else None,
        "state": state, "pinned": rec.get("pinned") is True,
        "useCount": _kb_int(rec.get("use_count")), "viewCount": _kb_int(rec.get("view_count")), "patchCount": _kb_int(rec.get("patch_count")),
        "createdAt": _epoch(rec.get("created_at")), "lastUsedAt": _epoch(rec.get("last_used_at")), "lastViewedAt": _epoch(rec.get("last_viewed_at")),
        "lastPatchedAt": _epoch(rec.get("last_patched_at")), "archivedAt": _epoch(rec.get("archived_at")),
        "size": st.st_size, "mtime": st.st_mtime,
    }


def _skills_dir_of(home, name):
    pdir = profile_dir(home, name)
    return os.path.join(pdir, "skills") if pdir else None


def q_skills_list(home, a):
    profiles = a.get("profiles", [])
    if not isinstance(profiles, list) or len(profiles) > 50 or not all(valid_profile(p) for p in profiles):
        raise QueryError("bad_args")
    skills, out_profiles = [], []
    for name, pdir in list_profiles(home):
        if profiles and name not in profiles:
            continue
        sk = os.path.join(pdir, "skills")
        if not os.path.isdir(sk):
            out_profiles.append({"profile": name, "ok": True, "error": None, "total": 0, "truncated": False})
            continue
        try:
            dirs = _skill_dirs(sk)
            bundled, hub = _skill_names_from(sk)
            usage = _usage_records(sk)
            rows = [r for r in (_skill_row(name, sk, rel, bundled, hub, usage) for rel in dirs[:SKILLS_MAX]) if r]
        except OSError:
            out_profiles.append({"profile": name, "ok": False, "error": "unreadable", "total": 0, "truncated": False})
            continue
        skills += rows
        out_profiles.append({"profile": name, "ok": True, "error": None, "total": len(rows), "truncated": len(dirs) > SKILLS_MAX})
    return {"skills": skills, "profiles": out_profiles}


def _skill_file(home, a):
    name, rel = a.get("profile"), a.get("path")
    if not valid_profile(name) or not isinstance(rel, str) or not SKILL_PATH_RE.match(rel) or any(p in (".", "..") for p in rel.split("/")):
        raise QueryError("bad_args")
    sk = _skills_dir_of(home, name)
    if not sk:
        raise QueryError("not_found")
    real = os.path.realpath(os.path.join(sk, *rel.split("/"), "SKILL.md"))
    if not real.startswith(os.path.realpath(sk) + os.sep) or not os.path.isfile(real):
        raise QueryError("not_found")
    return real


def q_skill_read(home, a):
    real = _skill_file(home, a)
    with open(real, "rb") as f:
        data = f.read(SKILL_BODY_MAX + 1)
    st = os.stat(real)
    return {"path": a["path"], "text": data[:SKILL_BODY_MAX].decode("utf-8", "replace"), "truncated": len(data) > SKILL_BODY_MAX,
            "size": st.st_size, "mtime": st.st_mtime}


def _ledger_files(items, sk):
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        p, sha = it.get("path"), it.get("sha256")
        if not isinstance(p, str):
            continue
        base = next((b for b in (sk, os.path.realpath(sk)) if p.startswith(b + "/")), None)
        rel = p[len(base) + 1:] if base else p.rsplit("/", 1)[-1]
        out.append((rel[:200], sha if isinstance(sha, str) and SHA_RE.match(sha) else None))
    return out


def _ledger_note(ev):
    if not isinstance(ev, dict):
        return None, None
    note = next((ev[k] for k in ("note", "reason", "summary", "message", "why") if isinstance(ev.get(k), str) and ev[k].strip()), None)
    sid = ev.get("session_id") if isinstance(ev.get("session_id"), str) and ID_RE.match(ev["session_id"]) else None
    return (note.strip()[:300] if note else None), sid


def q_skills_ledger(home, a):
    name = a.get("profile")
    if not valid_profile(name):
        raise QueryError("bad_args")
    limit = _limit(a, 200, 500)
    sk = _skills_dir_of(home, name)
    if not sk:
        raise QueryError("not_found")
    path = os.path.join(sk, ".curator_ledger.jsonl")
    if not os.path.isfile(path):
        return {"profile": name, "entries": [], "exists": False, "truncated": False}
    with open(path, "rb") as f:
        size = os.fstat(f.fileno()).st_size
        start = max(0, size - SKILL_LEDGER_TAIL)
        f.seek(start)
        data = f.read()
    lines = data.split(b"\n")
    if start > 0:
        lines = lines[1:]  # the first line may be cut
    entries = []
    for ln in reversed(lines):
        try:
            e = json.loads(ln.decode("utf-8", "replace")) if ln.strip() else None
        except ValueError:
            e = None
        if not isinstance(e, dict) or not isinstance(e.get("id"), str):
            continue
        before, after = dict(_ledger_files(e.get("before"), sk)), dict(_ledger_files(e.get("after"), sk))
        files = [{"path": p, "before": before.get(p), "after": after.get(p)} for p in sorted(set(before) | set(after))][:20]
        note, sid = _ledger_note(e.get("evidence"))
        entries.append({"id": e["id"][:40], "ts": _epoch(e.get("ts")), "actor": _text(e.get("actor"), 20) or "unknown",
                        "action": _text(e.get("action"), 40) or "unknown", "skill": _text(e.get("skill"), 100) or "?",
                        "note": note, "sessionId": sid, "files": files})
        if len(entries) >= limit:
            break
    return {"profile": name, "entries": entries, "exists": True, "truncated": start > 0 or len(entries) >= limit}


def q_skills_blobs(home, a):
    name, shas = a.get("profile"), a.get("shas")
    if not valid_profile(name) or not isinstance(shas, list) or not 1 <= len(shas) <= 4 or not all(isinstance(s, str) and SHA_RE.match(s) for s in shas):
        raise QueryError("bad_args")
    pdir = profile_dir(home, name)
    if not pdir:
        raise QueryError("not_found")
    base = os.path.join(pdir, ".curator_backups", "blobs")
    out = []
    for sha in shas:
        p = os.path.join(base, sha)
        real = os.path.realpath(p)
        if not real.startswith(os.path.realpath(base) + os.sep) or not os.path.isfile(real):
            out.append({"sha": sha, "error": "not_found"})
            continue
        try:
            with open(real, "rb") as f:
                data = f.read(SKILL_BLOB_MAX + 1)
        except OSError:
            out.append({"sha": sha, "error": "unreadable"})
            continue
        out.append({"sha": sha, "text": data[:SKILL_BLOB_MAX].decode("utf-8", "replace"), "truncated": len(data) > SKILL_BLOB_MAX})
    return {"blobs": out}


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
        "sessions_list": q_sessions_list, "sessions_search": q_sessions_search,
        "session_transcript": q_session_transcript,
        "usage_summary": q_usage_summary, "usage_tools": q_usage_tools,
        "logs_list": q_logs_list, "logs_read": q_logs_read,
        "kanban_boards": q_kanban_boards, "kanban_tasks": q_kanban_tasks, "kanban_task": q_kanban_task,
        "cron_jobs": q_cron_jobs, "cron_runs": q_cron_runs, "cron_output": q_cron_output,
        "skills_list": q_skills_list, "skill_read": q_skill_read, "skills_ledger": q_skills_ledger, "skills_blobs": q_skills_blobs,
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
    args = {"home": None, "ticks": 0, "interval": 1.0, "agents_interval": 10.0, "cursors": {}, "history": FEED_HISTORY_ROWS, "query": None, "vault": None, "vault_interval": VAULT_POLL_S, "inter_interval": 2.0, "memory_interval": 30.0}
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
        elif a == "--memory-interval":
            args["memory_interval"] = float(next(it))
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
    memory = MemoryState()
    next_memory = clock()
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
        if now >= next_memory:
            try:
                for ev in memory.poll(args["home"]):
                    emit("memory", ev, ev["profile"])
            except Exception as ex:  # noqa: BLE001
                emit("error", {"code": "memory_failed", "message": type(ex).__name__})
            next_memory = clock() + args["memory_interval"]
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
        time.sleep(max(0.0, min(next_metrics, next_agents, next_inter, next_memory) - clock()))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
