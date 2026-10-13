#!/usr/bin/env python3
"""A stand-in for `hermes [-p P] mcp list|test`, `tools list|enable|disable`, `fallback list` and `profile create`,
shaped after the real CLI output (hermes_cli/mcp_config.py, tools_config_mcp.py, fallback_cmd.py). Toolset state
lives in `<profile>/.fake_tools.json` and is written only by enable/disable. `mcp test broken` fails; a new profile
named `taken` is refused as existing.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_fixture as mf  # noqa: E402

HOME = Path(os.environ["MC_FAKE_HOME"])
TOOLSETS = [("web", "Web search"), ("terminal", "Terminal"), ("memory", "Memory"), ("browser", "Browser"), ("kanban", "Kanban")]
DEFAULTS = {"cli": ["web", "terminal", "memory"], "telegram": ["web", "memory"], "cron": ["terminal"]}
PLATFORMS = {"cli", "telegram", "discord", "slack", "whatsapp", "signal", "email", "matrix", "webhook", "api_server", "cron", "lightclawbot"}


# like Hermes on a Linux server: UTF-8 whatever the console of the machine running the tests uses
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")


def out(s=""):
    sys.stdout.write(s + "\n")


def tools_state(pdir):
    p = pdir / ".fake_tools.json"
    return json.loads(p.read_text()) if p.exists() else {k: list(v) for k, v in DEFAULTS.items()}


def main(argv):
    profile = "default"
    if argv[:1] == ["-p"]:
        profile, argv = argv[1], argv[2:]
    pdir = HOME if profile == "default" else HOME / "profiles" / profile
    cmd, rest = argv[0], argv[1:]
    if cmd == "mcp" and rest[0] in ("list", "ls"):
        out()
        out("  \x1b[36mMCP Servers:\x1b[0m")
        out()
        out(f"  {'Name':<16} {'Transport':<30} {'Tools':<12} {'Status':<10}")
        out(f"  {'─' * 16} {'─' * 30} {'─' * 12} {'─' * 10}")
        out(f"  {'github':<16} {'https://api.githubcopilot.c...':<30} {'all':<12} \x1b[32m✓ enabled\x1b[0m")
        out(f"  {'filesystem':<16} {'npx -y @modelcontext/serv...':<30} {'3 selected':<12} \x1b[2m✗ disabled\x1b[0m")
        out()
        return 0
    if cmd == "mcp" and rest[0] == "test":
        name = rest[1]
        out(f"  Testing '{name}'...")
        if name == "broken":
            out("  ✗ Connection failed (2.0s): connection refused")
            return 1
        out("  Transport: HTTP → https://api.example.com/mcp")
        out("  Auth: none")
        out("  ✓ Connected (412ms)")
        out("  ✓ Tools discovered: 12")
        return 0
    if cmd == "fallback":
        out()
        out("  Primary:   x/y  (via openrouter)")
        out()
        out("  Fallback chain (2 entries):")
        out("    1. anthropic/claude-haiku  (via openrouter)")
        out("    2. deepseek-v4-flash  (via deepseek)  [https://api.deepseek.com]")
        out()
        out("  Tried in order when the primary fails (rate-limit, 5xx, connection errors).")
        return 0
    if cmd == "tools":
        action = rest[0]
        platform = rest[rest.index("--platform") + 1] if "--platform" in rest else "cli"
        if platform not in PLATFORMS:
            out(f"  ✗ Unknown platform '{platform}'.")
            return 0
        state = tools_state(pdir)
        enabled = set(state.get(platform, []))
        if action == "list":
            out(f"Built-in toolsets ({platform}):")
            for key, label in TOOLSETS:
                status = "\x1b[32m✓ enabled\x1b[0m" if key in enabled else "\x1b[31m✗ disabled\x1b[0m"
                out(f"  {status}  {key}  \x1b[2m{label}\x1b[0m")
            return 0
        names = [n for n in rest[1:] if not n.startswith("--") and n != platform]
        bad = [n for n in names if n not in dict(TOOLSETS)]
        for n in bad:
            out(f"  ✗ Unknown toolset '{n}'")
        good = [n for n in names if n not in bad]
        enabled = enabled | set(good) if action == "enable" else enabled - set(good)
        state[platform] = sorted(enabled)
        (pdir / ".fake_tools.json").write_text(json.dumps(state))
        if good:
            out(f"  ✓ {'Enabled' if action == 'enable' else 'Disabled'}: {', '.join(good)}")
        return 0
    if cmd == "profile" and rest[0] == "create":
        name = rest[1]
        target = HOME / "profiles" / name
        if name == "taken" or target.exists():
            out(f"Error: profile '{name}' already exists.")
            return 1
        mf.w(target / "config.yaml", "model:\n  default: x/y\n")
        mf.w(target / "SOUL.md", f"# {name}\n")
        desc = next((a.split("=", 1)[1] for a in rest if a.startswith("--description=")), None)
        if desc:
            mf.w(target / "profile.yaml", f"description: {json.dumps(desc)}\n")
        out(f"Created profile '{name}' at {target}")
        if "--no-alias" not in rest:
            out(f"Wrapper: ~/.local/bin/{name}")
        return 0
    out(f"unknown command {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
