#!/usr/bin/env python3
"""A stand-in for `hermes ... chat` used by the fake SSH server.

Reads the message from stdin (or -q), prints stream-json lines, and writes the same conversation into the
profile's state.db the way Hermes does (a session with source mission-control, the user message, an assistant
step with reasoning and a tool call, the tool result, the reply).

Special messages: one containing "slow" takes long (to test Stop), "fail" exits with an error,
"blocked" makes the tool result a refusal by the approval policy, "plain" is not special here.
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_fixture as mf  # noqa: E402

HOME = Path(os.environ["MC_FAKE_HOME"])
DELAY = float(os.environ.get("MC_FAKE_DELAY", "0.06"))


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main(argv):
    profile, resume, message, plain = "default", None, None, "--format" not in argv
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "-p":
            profile = argv[i + 1]
            i += 1
        elif a == "--resume":
            resume = argv[i + 1]
            i += 1
        elif a == "-q":
            message = argv[i + 1]
            plain = True
            i += 1
        elif a in ("--source", "--format", "--query-file"):
            i += 1
        i += 1
    if message is None:
        message = sys.stdin.read()
    db = HOME / "state.db" if profile == "default" else HOME / "profiles" / profile / "state.db"
    now = time.time()
    sid = resume or "s-mc-%d" % int(now * 1000)
    if not resume:
        mf.add_session(db, sid, "mission-control", now)
    if "fail" in message:
        sys.stderr.write("Error: provider authentication failed\n")
        return 2
    mf.add_message(db, sid, "user", message, now)
    if not plain:
        emit({"type": "system", "session_id": sid, "model": "fake-model"})
    if "slow" in message:
        for _ in range(100):
            time.sleep(0.1)
    time.sleep(DELAY)
    call = [{"id": "call_1", "type": "function", "function": {"name": "web_search", "arguments": json.dumps({"q": "hermes"})}}]
    mf.add_message(db, sid, "assistant", "Let me look that up.", time.time(), tool_calls=call, reasoning_content="The user wants current information; search first.")
    if not plain:
        emit({"type": "tool_use", "id": "call_1", "name": "web_search", "input": {"q": "hermes"}})
    time.sleep(DELAY)
    blocked = "blocked" in message
    result = "Command blocked by approval policy: denied" if blocked else "3 results"
    mf.add_message(db, sid, "tool", result, time.time(), tool_name="web_search")
    if not plain:
        emit({"type": "tool_result", "id": "call_1", "name": "web_search", "output": result, "is_error": blocked, "duration_ms": 1200})
    time.sleep(DELAY)
    reply = "Here is **what I found**:\n\n- item one\n- item two\n\n```python\nprint('hello')\n```\n"
    for part in (reply[:12], reply[12:40], reply[40:]):
        if plain:
            sys.stdout.write(part)
            sys.stdout.flush()
        else:
            emit({"type": "text", "text": part})
        time.sleep(DELAY)
    mf.add_message(db, sid, "assistant", reply, time.time())
    if plain and "-Q" in argv and "nosid" not in message:
        sys.stdout.write("\nsession_id: %s\n" % sid)
        sys.stdout.flush()
    if not plain:
        emit({"type": "result", "exit_code": 0, "duration_ms": 1500, "usage": {"input_tokens": 120, "output_tokens": 45}})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
