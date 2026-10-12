#!/usr/bin/env python3
"""A stand-in for `hermes [-p profile] acp`: JSON-RPC 2.0 over stdio, one JSON message per line.

Handles initialize, session/new, session/load, session/prompt and session/cancel, and writes the conversation into
the profile's state.db like Hermes does. Special words in a prompt: "danger" asks for permission before a tool runs,
"slow" runs until it is cancelled, "crash" ends the process. The reply names the turn number of the session, so a test
can tell whether the conversation was continued.
"""
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_fixture as mf  # noqa: E402

HOME = Path(os.environ["MC_FAKE_HOME"])
argv = sys.argv[1:]
profile = argv[argv.index("-p") + 1] if "-p" in argv else "default"
DB = HOME / "state.db" if profile == "default" else HOME / "profiles" / profile / "state.db"

inbox = queue.Queue()
turns = {}
known = set()


def reader():
    for line in sys.stdin:
        line = line.strip()
        if line:
            try:
                inbox.put(json.loads(line))
            except ValueError:
                pass
    inbox.put(None)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def update(sid, u):
    send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": sid, "update": u}})


def respond(msg, result):
    send({"jsonrpc": "2.0", "id": msg["id"], "result": result})


def cancelled_now():
    """True when a cancel arrived; other messages stay in order for the caller."""
    keep = []
    hit = False
    while True:
        try:
            m = inbox.get_nowait()
        except queue.Empty:
            break
        if m is not None and m.get("method") == "session/cancel":
            hit = True
        else:
            keep.append(m)
    for m in keep:
        inbox.put(m)
    return hit


def wait_response(req_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        try:
            m = inbox.get(timeout=0.2)
        except queue.Empty:
            continue
        if m is None:
            return None
        if m.get("method") == "session/cancel":
            return "cancel"
        if m.get("id") == req_id and "method" not in m:
            return m
    return None


def prompt(msg):
    p = msg["params"]
    sid = p["sessionId"]
    if sid not in known:
        return respond(msg, {"stopReason": "refusal"})
    text = " ".join(b.get("text", "") for b in p.get("prompt", []))
    turns[sid] = turns.get(sid, 0) + 1
    mf.add_message(DB, sid, "user", text, time.time())
    if "crash" in text:
        sys.exit(3)
    if "slow" in text:
        for _ in range(100):
            time.sleep(0.1)
            if cancelled_now():
                return respond(msg, {"stopReason": "cancelled"})
    update(sid, {"sessionUpdate": "tool_call", "toolCallId": "c1", "title": "web_search", "kind": "search", "status": "pending"})
    time.sleep(0.05)
    update(sid, {"sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "completed"})
    if "danger" in text:
        send({
            "jsonrpc": "2.0", "id": 900, "method": "session/request_permission",
            "params": {
                "sessionId": sid,
                "toolCall": {"toolCallId": "c2", "title": "terminal", "kind": "execute", "rawInput": {"command": "rm -rf ~/tmp/cache"}},
                "options": [
                    {"optionId": "allow_once", "name": "Allow once", "kind": "allow_once"},
                    {"optionId": "allow_always", "name": "Always allow", "kind": "allow_always"},
                    {"optionId": "reject_once", "name": "Deny", "kind": "reject_once"},
                ],
            },
        })
        ans = wait_response(900)
        if ans == "cancel":
            return respond(msg, {"stopReason": "cancelled"})
        out = (ans or {}).get("result", {}).get("outcome", {})
        allowed = out.get("outcome") == "selected" and out.get("optionId", "").startswith("allow")
        reply = "Done, I ran it." if allowed else "I was not allowed to run that."
    else:
        reply = "Here is **what I found** (turn %d)." % turns[sid]
    if "silent" in text:
        # the agent thinks and then ends the turn without a message (what a mismatch of formats looks like)
        update(sid, {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "hmm"}})
        return respond(msg, {"stopReason": "end_turn"})
    for part in (reply[:10], reply[10:]):
        if "arrayshape" in text:
            update(sid, {"sessionUpdate": "agent_message_chunk", "content": [{"type": "text", "text": part}]})
        elif "bareshape" in text:
            update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"text": part}})
        else:
            update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": part}})
        time.sleep(0.03)
    mf.add_message(DB, sid, "assistant", reply, time.time())
    respond(msg, {"stopReason": "end_turn"})


def main():
    threading.Thread(target=reader, daemon=True).start()
    while True:
        msg = inbox.get()
        if msg is None:
            return
        method = msg.get("method")
        if method == "initialize":
            respond(msg, {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}, "authMethods": []})
        elif method == "session/new":
            sid = "s-acp-%d" % int(time.time() * 1000)
            mf.add_session(DB, sid, "acp", time.time())
            known.add(sid)
            respond(msg, {"sessionId": sid})
        elif method == "session/load":
            # like Hermes: only a session that ACP made can be loaded; any other id answers null, and a prompt on it is a refusal
            sid = (msg.get("params") or {}).get("sessionId", "")
            if sid.startswith("s-acp-"):
                if not sid.startswith("s-acp-ghost"):  # a ghost loads fine but cannot be prompted (its agent cannot be rebuilt)
                    known.add(sid)
                respond(msg, {})
            else:
                respond(msg, None)
        elif method == "session/prompt":
            prompt(msg)
        elif "id" in msg and method:
            send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Method not found"}})


if __name__ == "__main__":
    main()
