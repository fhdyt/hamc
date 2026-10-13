#!/usr/bin/env python3
"""A stand-in for `hermes [-p P] curator pin|unpin|archive|restore|status` and `skills inspect|install` used by the fake
SSH server. It changes the fixture like Hermes would (.usage.json, .archive/, .hub/lock.json, the ledger) and prints
lines shaped like the real CLI. An install id containing "blocked" is refused by the "scan"; an install without --yes
is cancelled, as Hermes does when nobody answers its prompt.
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_fixture as mf  # noqa: E402

HOME = Path(os.environ["MC_FAKE_HOME"])


def out(text):
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def fail(text, code=1):
    out(text)
    sys.exit(code)


def usage(sk):
    p = sk / ".usage.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_usage(sk, data):
    (sk / ".usage.json").write_text(json.dumps(data), encoding="utf-8")


def ledger(sk, actor, action, skill):
    with open(sk / ".curator_ledger.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": "f%011x" % (int(time.time() * 1000) % (16 ** 11)), "ts": mf.iso(time.time(), 0), "actor": actor,
                            "action": action, "skill": skill, "evidence": {}, "before": [], "after": []}) + "\n")


def find_dir(sk, name):
    for md in sk.rglob("SKILL.md"):
        parts = md.relative_to(sk).parts
        if parts[0] in (".archive", ".git", ".hub") or "references" in parts[:-1]:
            continue
        if md.parent.name == name:
            return md.parent
    return None


def curator(sk, argv):
    action = argv[0]
    if action == "status":
        out("Curator: enabled (idle)\nLast run: 2026-10-13T06:00:00+00:00\nManaged skills: 3 active, 1 stale, 1 archived\nPinned: pinned-helper")
        return 0
    name = argv[1]
    data = usage(sk)
    if action in ("pin", "unpin"):
        if find_dir(sk, name) is None:
            fail("Skill '%s' not found." % name)
        rec = data.setdefault(name, {})
        rec["pinned"] = action == "pin"
        save_usage(sk, data)
        out("%s '%s'." % ("Pinned" if action == "pin" else "Unpinned", name))
    elif action == "archive":
        src = find_dir(sk, name)
        if src is None:
            fail("Skill '%s' not found." % name)
        (sk / ".archive").mkdir(exist_ok=True)
        shutil.move(str(src), str(sk / ".archive" / name))
        data.setdefault(name, {}).update(state="archived", archived_at=mf.iso(time.time(), 0))
        save_usage(sk, data)
        ledger(sk, "user", "archive", name)
        out("Archived '%s' to .archive/%s" % (name, name))
    elif action == "restore":
        src = sk / ".archive" / name
        if not src.is_dir():
            fail("No archived skill named '%s'." % name)
        shutil.move(str(src), str(sk / name))
        data.setdefault(name, {}).update(state="active", archived_at=None)
        save_usage(sk, data)
        ledger(sk, "user", "restore", name)
        out("Restored '%s'." % name)
    else:
        fail("unknown curator command")
    return 0


def skills(sk, argv):
    action, ident = argv[0], argv[1]
    short = ident.rstrip("/").split("/")[-1].replace(".md", "") or "skill"
    if action == "inspect":
        if "missing" in ident:
            fail("Could not find '%s' in any source." % ident, 0)
        out("Skill: %s\nName: %s\nDescription: A skill from the hub.\nSource: official\nTrust: official\nIdentifier: %s" % (short, short, ident))
        out("SKILL.md Preview\n---\nname: %s\n---\n# %s" % (short, short))
        return 0
    if action == "install":
        if "--yes" not in argv:
            out("Confirm [y/N]: ")
            return 0
        if "blocked" in ident:
            fail("Not installed: the security scan blocked '%s' (2 findings)." % short)
        cat = argv[argv.index("--category") + 1] if "--category" in argv else "hub"
        mf.w(sk / cat / short / "SKILL.md", mf.skill_md(short, "Installed from the hub by the fake."))
        lock_p = sk / ".hub" / "lock.json"
        lock = json.loads(lock_p.read_text(encoding="utf-8")) if lock_p.exists() else {"installed": {}}
        lock.setdefault("installed", {})[short] = {"source": "official", "install_path": "%s/%s" % (cat, short)}
        mf.w(lock_p, json.dumps(lock))
        out("Installed '%s' into %s/%s" % (short, cat, short))
        return 0
    fail("unknown skills command")
    return 1


def main(argv):
    profile = "default"
    if argv[:1] == ["-p"]:
        profile, argv = argv[1], argv[2:]
    pdir = HOME if profile == "default" else HOME / "profiles" / profile
    sk = pdir / "skills"
    sk.mkdir(parents=True, exist_ok=True)
    return curator(sk, argv[1:]) if argv[0] == "curator" else skills(sk, argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
