#!/usr/bin/env python3
"""A stand-in for `hermes kanban [--board B] create|assign|comment|complete|block|unblock|promote|archive` used by the
fake SSH server.

The parser copies the real one (hermes_cli/kanban.py at tag v2026.8.31) for these verbs, so `--board`, `--` and
`--opt=value` behave as argparse does on the VPS. It changes the fixture kanban.db the way Hermes would: status,
assignee, task_comments, task_events, completed_at/result, a new `t_<8 hex>` task. An unknown task id fails with
`no such task: <id>`; a promote while a parent task is open fails; an unknown board fails like Hermes.
"""
import argparse
import json
import os
import secrets
import sqlite3
import sys
import time
from pathlib import Path

HOME = Path(os.environ["MC_FAKE_HOME"])


def db_path(board):
    slug = (board or "default").strip().lower()
    if slug == "default":
        return HOME / "kanban.db"
    path = HOME / "kanban" / "boards" / slug / "kanban.db"
    if not path.is_file():
        print(f"kanban: board {slug!r} does not exist. Create it with `hermes kanban boards create {slug}`.", file=sys.stderr)
        sys.exit(1)
    return path


def parser():
    p = argparse.ArgumentParser(prog="hermes kanban")
    p.add_argument("--board", default=None)
    sub = p.add_subparsers(dest="action")
    c = sub.add_parser("create")
    c.add_argument("title")
    c.add_argument("--body", default=None)
    c.add_argument("--assignee", default=None)
    c.add_argument("--priority", type=int, default=0)
    c.add_argument("--triage", action="store_true")
    c.add_argument("--created-by", default="user")
    c.add_argument("--json", action="store_true")
    a = sub.add_parser("assign")
    a.add_argument("task_id")
    a.add_argument("profile")
    m = sub.add_parser("comment")
    m.add_argument("task_id")
    m.add_argument("text", nargs="+")
    m.add_argument("--author", default=None)
    d = sub.add_parser("complete")
    d.add_argument("task_ids", nargs="+")
    d.add_argument("--result", default=None)
    b = sub.add_parser("block")
    b.add_argument("task_id")
    b.add_argument("reason", nargs="*")
    u = sub.add_parser("unblock")
    u.add_argument("task_ids", nargs="+")
    pr = sub.add_parser("promote")
    pr.add_argument("task_id")
    pr.add_argument("reason", nargs="*")
    ar = sub.add_parser("archive")
    ar.add_argument("task_ids", nargs="*")
    return p


def task(con, tid):
    row = con.execute("SELECT id, status, title, assignee FROM tasks WHERE id = ?", (tid,)).fetchone()
    if not row:
        print(f"no such task: {tid}", file=sys.stderr)
        sys.exit(1)
    return row


def event(con, tid, kind, payload=None):
    con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
                (tid, kind, json.dumps(payload) if payload is not None else None, int(time.time())))


def comment(con, tid, author, body):
    con.execute("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)", (tid, author, body, int(time.time())))


def main(argv):
    args = parser().parse_args(argv)
    con = sqlite3.connect(db_path(args.board))
    now = int(time.time())
    if args.action == "create":
        tid = "t_" + secrets.token_hex(4)
        status = "triage" if args.triage else ("ready" if args.assignee else "todo")
        con.execute("INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (tid, args.title, args.body, args.assignee, status, args.priority, args.created_by, now))
        event(con, tid, "created", {"by": args.created_by})
        con.commit()
        if args.json:
            print(json.dumps({"id": tid, "title": args.title, "status": status, "assignee": args.assignee}, indent=2))
        else:
            print(f"Created {tid}  ({status}, assignee={args.assignee or '-'})")
        return 0
    if args.action == "assign":
        task(con, args.task_id)
        who = None if args.profile == "none" else args.profile
        con.execute("UPDATE tasks SET assignee = ? WHERE id = ?", (who, args.task_id))
        event(con, args.task_id, "assigned", {"assignee": who})
        print(f"Assigned {args.task_id} to {who or '(nobody)'}")
    elif args.action == "comment":
        task(con, args.task_id)
        comment(con, args.task_id, args.author or os.environ.get("HERMES_PROFILE") or "user", " ".join(args.text).strip())
        print(f"Comment added to {args.task_id}")
    elif args.action == "complete":
        for tid in args.task_ids:
            task(con, tid)
            con.execute("UPDATE tasks SET status = 'done', completed_at = ?, result = COALESCE(?, result) WHERE id = ?", (now, args.result, tid))
            event(con, tid, "completed", {"result": args.result})
            print(f"Completed {tid}")
    elif args.action == "block":
        task(con, args.task_id)
        reason = " ".join(args.reason).strip()
        con.execute("UPDATE tasks SET status = 'blocked' WHERE id = ?", (args.task_id,))
        if reason:
            comment(con, args.task_id, "user", reason)
        event(con, args.task_id, "blocked", {"reason": reason or None})
        print(f"Blocked {args.task_id}")
    elif args.action == "unblock":
        for tid in args.task_ids:
            row = task(con, tid)
            if row[1] not in ("blocked", "scheduled"):
                print(f"kanban: {tid} is not blocked", file=sys.stderr)
                return 1
            con.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (tid,))
            event(con, tid, "unblocked")
            print(f"Unblocked {tid}")
    elif args.action == "promote":
        row = task(con, args.task_id)
        open_parents = con.execute(
            "SELECT COUNT(*) FROM task_links l JOIN tasks p ON p.id = l.parent_id WHERE l.child_id = ? AND p.status NOT IN ('done', 'archived')",
            (args.task_id,)).fetchone()[0]
        if open_parents:
            print(f"kanban: {args.task_id} has {open_parents} open parent task(s); use --force to promote anyway", file=sys.stderr)
            return 1
        if row[1] not in ("todo", "blocked"):
            print(f"kanban: {args.task_id} is {row[1]}, not todo/blocked", file=sys.stderr)
            return 1
        con.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (args.task_id,))
        event(con, args.task_id, "promoted")
        print(f"Promoted {args.task_id} to ready")
    elif args.action == "archive":
        for tid in args.task_ids:
            task(con, tid)
            con.execute("UPDATE tasks SET status = 'archived' WHERE id = ?", (tid,))
            event(con, tid, "archived")
            print(f"Archived {tid}")
    else:
        print("kanban: unknown action", file=sys.stderr)
        return 2
    con.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[2:] if sys.argv[1:2] == ["kanban"] else sys.argv[1:]))
