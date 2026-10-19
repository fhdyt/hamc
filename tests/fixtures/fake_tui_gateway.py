#!/usr/bin/env python3
"""A stand-in for `python -m tui_gateway.entry` (Hermes v0.21 TUI gateway over stdio).

JSON-RPC 2.0, one JSON message per line. It sends `gateway.ready` first, then answers session.create, session.resume,
prompt.submit, session.interrupt, approval.respond and clarify.respond, streams `event` notifications like Hermes
(message.start, tool.start, tool.complete, message.delta, approval.request, clarify.request, message.complete) and
writes the conversation into the profile's state.db. One process serves every profile, as the real gateway does; an
unknown profile falls back to the launch profile (default), as Hermes does.

Special words in a prompt: "danger" asks for approval before a tool runs, "ask" sends a clarify question with
choices, "slow" runs until interrupted, "crash" ends the process, "silent" completes without text. The reply names
the turn number of the session, so a test can tell whether a conversation was continued. A room prompt (it starts
with "[Group chat:") gets "<profile>: noted." on the session's first turn, then "(pass)" unless a new room line
mentions "@<profile>" ("<profile>: on it.").
"""
import json
import os
import sqlite3
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_fixture as mf  # noqa: E402

HOME = Path(os.environ["MC_FAKE_HOME"])
lock = threading.Lock()
sessions = {}  # runtime id -> dict(stored, profile, source, turns, usage, interrupted, waiting)
counter = [0]


def send(obj):
    with lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def event(sid, typ, payload=None):
    send({"jsonrpc": "2.0", "method": "event", "params": {"type": typ, "session_id": sid, "payload": payload or {}}})


def respond(msg, result):
    send({"jsonrpc": "2.0", "id": msg["id"], "result": result})


def error(msg, code, text):
    send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": code, "message": text}})


def db_of(profile):
    if profile and profile != "default" and (HOME / "profiles" / profile).is_dir():
        return HOME / "profiles" / profile / "state.db", profile
    return HOME / "state.db", "default"


def stored_exists(db, sid):
    try:
        con = sqlite3.connect(db)
        row = con.execute("select 1 from sessions where id = ?", (sid,)).fetchone()
        con.close()
        return row is not None
    except sqlite3.Error:
        return False


def new_runtime():
    counter[0] += 1
    return "%08x" % (0xA0000000 + counter[0])


def info(s):
    return {"model": "fake-model", "profile_name": s["profile"], "stored_session_id": s["stored"], "lazy": True}


def wait_for(s, key, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        if s.get("interrupted"):
            return None
        v = s.get(key)
        if v is not None:
            s[key] = None
            return v
        time.sleep(0.02)
    return None


def run_turn(rid, text):
    try:
        turn(rid, text)
    except Exception as e:  # like Hermes: a failed turn still ends with message.complete
        event(rid, "error", {"message": "turn failed: %s" % e})
        event(rid, "message.complete", {"text": "", "status": "error", "error": str(e), "usage": sessions[rid]["usage"]})


def turn(rid, text):
    s = sessions[rid]
    db = s["db"]
    if not stored_exists(db, s["stored"]):
        cols = {"title": s["title"]} if s.get("title") else {}
        mf.add_session(db, s["stored"], s["source"], time.time(), **cols)
    s["turns"] += 1
    mf.add_message(db, s["stored"], "user", text, time.time())
    # in a room prompt only the room lines count for the special words (the room rules contain "ask")
    probe = " | ".join(room_lines(text)) if text.startswith("[Group chat:") else text
    event(rid, "message.start")
    if "crash" in probe:
        os._exit(3)
    if "slow" in probe:
        for _ in range(300):
            time.sleep(0.05)
            if s.get("interrupted"):
                s["interrupted"] = False
                event(rid, "message.complete", {"text": "", "status": "interrupted", "usage": s["usage"]})
                return
    event(rid, "tool.start", {"tool_id": "call_1", "name": "web_search", "context": "hermes", "args": {"q": "hermes"}})
    time.sleep(0.05)
    event(rid, "tool.complete", {"tool_id": "call_1", "name": "web_search", "result": {"ok": True}, "duration_s": 0.4, "summary": "1 result"})
    reply = "Here is **what I found** (turn %d)." % s["turns"]
    if text.startswith("[Group chat:"):
        reply = group_reply(s, text)
    if "danger" in probe:
        event(rid, "approval.request", {"command": "rm -rf ~/tmp/cache", "description": "Delete a folder", "pattern_keys": ["rm"], "request_id": "req1", "choices": ["once", "session", "always", "deny"]})
        choice = wait_for(s, "approval")
        if choice is None:
            s["interrupted"] = False
            event(rid, "message.complete", {"text": "", "status": "interrupted", "usage": s["usage"]})
            return
        reply = "Done, I ran it." if choice != "deny" else "I was not allowed to run that."
    if "ask" in probe:
        event(rid, "clarify.request", {"question": "Which colour?", "choices": ["red", "blue"], "request_id": "q1"})
        answer = wait_for(s, "clarify")
        reply = "You picked %s." % (answer or "nothing")
    s["usage"] = {"input": s["usage"]["input"] + 100, "output": s["usage"]["output"] + 20, "total": s["usage"]["total"] + 120}
    if "silent" in probe:
        event(rid, "message.complete", {"text": "", "status": "complete", "usage": s["usage"]})
        return
    for part in (reply[:10], reply[10:]):
        event(rid, "message.delta", {"text": part})
        time.sleep(0.03)
    mf.add_message(db, s["stored"], "assistant", reply, time.time())
    event(rid, "message.complete", {"text": reply, "status": "complete", "usage": s["usage"]})


def room_lines(text):
    lines, inside = [], False
    for line in text.splitlines():
        if line.startswith("New messages in the room"):
            inside = True
        elif line.startswith("Rules for this room"):
            inside = False
        elif inside and line.startswith("  "):
            lines.append(line.strip())
    return lines


def group_reply(s, text):
    """A room member: says something the first time, then passes unless a new room line mentions it."""
    lines = room_lines(text)
    me = s["profile"]
    if s["turns"] == 1:
        return "%s: noted." % me
    if any(("@" + me) in l.lower() for l in lines):
        return "%s: on it." % me
    return "(pass)"


def handle(msg):
    method = msg.get("method")
    p = msg.get("params") or {}
    if method == "session.create":
        db, prof = db_of(p.get("profile"))
        rid = new_runtime()
        sessions[rid] = {"stored": "s-gw-%d-%d" % (int(time.time() * 1000), counter[0]), "profile": prof, "db": db, "source": p.get("source") or "tui", "turns": 0, "usage": {"input": 0, "output": 0, "total": 0}, "title": str(p.get("title") or ""), "hidden": bool(p.get("hidden"))}
        return respond(msg, {"session_id": rid, "stored_session_id": sessions[rid]["stored"], "message_count": 0, "messages": [], "info": info(sessions[rid])})
    if method == "session.resume":
        db, prof = db_of(p.get("profile"))
        sid = p.get("session_id", "")
        if not stored_exists(db, sid):
            return error(msg, 4007, "session not found")
        rid = new_runtime()
        con = sqlite3.connect(db)
        n = con.execute("select count(*) from messages where session_id = ? and role = 'user'", (sid,)).fetchone()[0]
        con.close()
        sessions[rid] = {"stored": sid, "profile": prof, "db": db, "source": "tui", "turns": n, "usage": {"input": 500, "output": 50, "total": 550}}
        return respond(msg, {"session_id": rid, "resumed": sid, "message_count": n, "messages": [], "info": info(sessions[rid]), "running": False, "status": "idle"})
    if method == "prompt.submit":
        rid = p.get("session_id")
        if rid not in sessions:
            return error(msg, 4001, "session not found")
        respond(msg, {"status": "streaming"})
        threading.Thread(target=run_turn, args=(rid, p.get("text", "")), daemon=True).start()
        return None
    if method == "session.interrupt":
        s = sessions.get(p.get("session_id"))
        if s:
            s["interrupted"] = True
        return respond(msg, {"status": "interrupted"})
    if method == "approval.respond":
        s = sessions.get(p.get("session_id"))
        if s:
            s["approval"] = p.get("choice", "deny")
        return respond(msg, {"resolved": 1 if s else 0})
    if method == "clarify.respond":
        for s in sessions.values():
            s["clarify"] = p.get("answer", "")
        return respond(msg, {"status": "ok"})
    if "id" in msg and method:
        return error(msg, -32601, "unknown method: %s" % method)
    return None


def main():
    # like Hermes: logs go to stderr, frames to stdout, gateway.ready first
    sys.stderr.write("tui_gateway: starting (fake)\n")
    send({"jsonrpc": "2.0", "method": "event", "params": {"type": "gateway.ready", "payload": {"change_events": True}}})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        threading.Thread(target=handle, args=(msg,), daemon=True).start()
    sys.stderr.write("[gateway-exit] stdin EOF\n")


if __name__ == "__main__":
    main()
