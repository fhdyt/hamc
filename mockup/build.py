"""Build the mockups from ./src.

Usage:  python build.py
Output:
  ./<Screen>.html      standalone pages (open directly in a browser; use mc-runtime.js)
  ./index.html         screen index
  ./dist-dc/*.dc.html  expanded .dc.html sources (for the claude.ai canvas)

Source macros expanded at build time:
  /*@shared-css*/  <!--@shared-html-->  /*@shared-js*/   -> src/_shared/*
  <!--@part x-->  /*@part x*/                            -> src/_parts/x.html / x.js
  <i-con name="x" size="14"></i-con>                     -> inline SVG icon
  <agent-avatar of="a" size="24"></agent-avatar>         -> photo or initial badge
  <md-view list="{{x}}"></md-view>                       -> rendered markdown blocks
"""
import re
import shutil
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "src"
SHARED = SRC / "_shared"
PARTS = SRC / "_parts"
DIST = HERE / "dist-dc"
BRAND = HERE.parent / "assets" / "brand"
ASSETS = HERE / "assets"

SCREENS = [
    ("Main", "Dashboard", "Cron, live activity, server, graphs, agents + chat; cron and activity open as modals; menus in the left sidebar"),
    ("Launch", "Launch (auto-connect)", "Every later start: saved connection, no login form"),
    ("Connect", "Connect & preflight", "First-time setup / edit connection, host-key check, preflight"),
    ("LiveFeed", "Live feed", "All agents in real time: user, thinking, tools, replies"),
    ("Chat", "Chat", "1-on-1 chat with an agent, file attachments, stop"),
    ("Sessions", "Sessions", "Browse and search every session; full transcript with thinking and tool calls"),
    ("Kanban", "Kanban", "Tasks and handoffs between agents from kanban.db, with comments"),
    ("Usage", "Usage", "Token and cost analytics, tool-call inspector"),
    ("Server", "Server (btop)", "CPU, memory, network, disks, processes"),
    ("Skills", "Skills", "Skills per agent: browse SKILL.md, see what the agent wrote itself, enable or disable"),
    ("Logs", "Logs, gateway, approvals", "Tail agent logs, per-platform gateway status, approval decisions"),
    ("Brain", "Second brain", "Obsidian-style graph of the vault, plus a memory change timeline"),
]

ICONS = {
    "paperclip": '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    "send": '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    "chev-down": '<path d="M6 9l6 6 6-6"/>',
    "chev-up": '<path d="M18 15l-6-6-6 6"/>',
    "chev-right": '<path d="M9 18l6-6-6-6"/>',
    "chevs-right": '<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>',
    "chevs-left": '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>',
    "bell": '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    "external": '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/>',
    "maximize": '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    "x": '<path d="M18 6L6 18M6 6l12 12"/>',
    "trash": '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    "grip": '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    "server": '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    "terminal": '<path d="M4 17l6-6-6-6M12 19h8"/>',
    "stop": '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    "refresh": '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    "filter": '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    "copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    "camera": '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    "power": '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "play": '<path d="M6 4l14 8-14 8z"/>',
    "save": '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    "undo": '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "message": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "activity": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    "users": '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    "alert": '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    "check": '<path d="M20 6L9 17l-5-5"/>',
    "cpu": '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    "memory": '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11v2M10 11v2M14 11v2M18 11v2"/>',
    "folder": '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    "panel-left": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    "panel-right": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    "code": '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    "layout": '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "share": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>',
    "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    "hdd": '<path d="M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
    "eye": '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    "minus": '<path d="M5 12h14"/>',
    "list": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    "kanban": '<path d="M6 5v11M12 5v6M18 5v14"/>',
    "flag": '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    "chart": '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    "layers": '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
    "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    "pause": '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    "command": '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    "history": '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
    "plug": '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
    "radio": '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
    "tool": '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    "archive": '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    "arrow-up": '<path d="M12 19V5M5 12l7-7 7 7"/>',
    "arrow-down": '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    "git-branch": '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    "lock": '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    "pin": '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
}

SEGS = ('<sc-for list="{{SRC.segs}}" as="sg"><sc-if value="{{sg.code}}"><code style="padding: 0 4px; border-radius: 3px; background: #191A21; color: #F1FA8C">{{sg.t}}</code></sc-if>'
        '<sc-if value="{{sg.bold}}"><strong style="color: #F8F8F2">{{sg.t}}</strong></sc-if><sc-if value="{{sg.plain}}">{{sg.t}}</sc-if>'
        '<sc-if value="{{sg.wiki}}"><button type="button" class="wl" onClick="{{sg.pick}}">{{sg.t}}</button></sc-if>'
        '<sc-if value="{{sg.wikiOff}}"><span style="color: #BD93F9">{{sg.t}}</span></sc-if></sc-for>')

MD_VIEW = ('<sc-for list="{{LIST}}" as="blk">'
           '<sc-if value="{{blk.isP}}"><p style="margin: 0 0 6px">' + SEGS.replace("SRC", "blk") + '</p></sc-if>'
           '<sc-if value="{{blk.isH}}"><div style="margin: 0 0 4px; font-weight: 700; color: #BD93F9">' + SEGS.replace("SRC", "blk") + '</div></sc-if>'
           '<sc-if value="{{blk.isUl}}"><ul style="margin: 0 0 6px; padding-left: 16px"><sc-for list="{{blk.items}}" as="li"><li>' + SEGS.replace("SRC", "li") + '</li></sc-for></ul></sc-if>'
           '<sc-if value="{{blk.isCode}}"><pre style="margin: 0 0 6px; padding: 6px 8px; border: 1px solid #44475A; border-radius: 6px; background: #191A21; color: #F1FA8C; font: inherit; font-size: 11px; white-space: pre-wrap">{{blk.text}}</pre></sc-if>'
           '</sc-for>')


def icon(m: re.Match) -> str:
    name, size = m.group(1), m.group(2) or "14"
    if name not in ICONS:
        raise ValueError(f"unknown icon {name}")
    return (f'<svg class="ic" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def avatar(m: re.Match) -> str:
    v, size = m.group(1), int(m.group(2) or 24)
    fs = max(9, round(size * 0.42))
    return (f'<sc-if value="{{{{{v}.hasAvatar}}}}"><img src="{{{{{v}.avatar}}}}" alt="" style="width: {size}px; height: {size}px; flex: none; '
            f'border-radius: 50%; object-fit: cover; border: 1px solid {{{{{v}.color}}}}"></sc-if>'
            f'<sc-if value="{{{{{v}.noAvatar}}}}"><span aria-hidden="true" style="width: {size}px; height: {size}px; flex: none; box-sizing: border-box; '
            f'display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid {{{{{v}.color}}}}; '
            f'background: #282A36; color: {{{{{v}.color}}}}; font-size: {fs}px; font-weight: 700">{{{{{v}.initial}}}}</span></sc-if>')


def expand(text: str) -> str:
    text = text.replace("/*@shared-css*/", (SHARED / "shared.css").read_text(encoding="utf-8"))
    text = text.replace("<!--@shared-html-->", (SHARED / "shared.html").read_text(encoding="utf-8"))
    text = text.replace("/*@shared-js*/", (SHARED / "shared.js").read_text(encoding="utf-8"))
    text = re.sub(r"<!--@part ([\w-]+)-->", lambda m: (PARTS / f"{m.group(1)}.html").read_text(encoding="utf-8"), text)
    text = re.sub(r"/\*@part ([\w-]+)\*/", lambda m: (PARTS / f"{m.group(1)}.js").read_text(encoding="utf-8"), text)
    text = re.sub(r'<md-view list="\{\{([^}]+)\}\}"></md-view>', lambda m: MD_VIEW.replace("LIST", m.group(1)), text)
    text = re.sub(r'<agent-avatar of="([\w.]+)"(?: size="(\d+)")?></agent-avatar>', avatar, text)
    text = re.sub(r'<i-con name="([\w-]+)"(?: size="(\d+)")?></i-con>', icon, text)
    return text


def between(text: str, start: str, end: str) -> str:
    m = re.search(re.escape(start) + r"(.*?)" + re.escape(end), text, re.S)
    if not m:
        raise ValueError(f"missing {start}...{end}")
    return m.group(1)


def build_page(name: str, expanded: str) -> str:
    text = expanded.replace(".dc.html", ".html")
    title = between(text, "<title>", "</title>")
    body = between(text, "<x-dc>", "</x-dc>")
    helmet = between(body, "<helmet>", "</helmet>")
    template = body.replace(f"<helmet>{helmet}</helmet>", "").strip()
    logic_m = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', text, re.S)
    if not logic_m:
        raise ValueError(f"{name}: missing logic script")
    for part_name, part in (("template", template), ("logic", logic_m.group(1))):
        if "</script" in part.lower():
            raise ValueError(f"{name}: {part_name} contains </script>")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="assets/favicon.png">
<title>{title}</title>
{helmet.strip()}
<script src="mc-runtime.js" defer></script>
</head>
<body>
<div id="mc-root"></div>
<script type="text/x-dc-template" id="mc-template">
{template}
</script>
<script type="text/x-dc" id="mc-logic">{logic_m.group(1)}</script>
</body>
</html>
"""


def build_index() -> str:
    cards = "\n".join(
        f'      <a class="card" href="{name}.html"><span class="n">{i:02d}</span>'
        f'<span class="t">{label}</span><span class="d">{desc}</span></a>'
        for i, (name, label, desc) in enumerate(SCREENS)
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="assets/favicon.png">
<title>Hermes Agent Mission Control — Mockups</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&amp;family=VT323&amp;display=swap">
<style>
body {{ margin:0; background:#191A21; color:#F8F8F2; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:12px; }}
main {{ max-width:1100px; margin:0 auto; padding:48px 16px; display:flex; flex-direction:column; gap:24px; }}
h1 {{ margin:0; display:flex; align-items:center; gap:16px; font-family:'VT323', monospace; font-weight:400; font-size:44px; line-height:.9; color:#50FA7B; }}
h1 img {{ width:64px; height:64px; }}
p {{ margin:0; color:#A9B2D3; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px; }}
.card {{ display:flex; flex-direction:column; gap:6px; padding:14px; border:1px solid #44475A; border-radius:12px; background:#21222C; color:#F8F8F2; text-decoration:none; transition:border-color .15s, transform .15s; }}
.card:hover {{ border-color:#50FA7B; transform:translateY(-2px); }}
.n {{ color:#BD93F9; font-size:11px; }} .t {{ font-weight:700; color:#50FA7B; }} .d {{ color:#8B95BD; font-size:11px; }}
</style>
</head>
<body>
<main>
  <h1><img src="assets/logo-mark.png" alt="">Hermes Agent Mission Control</h1>
  <p>UI mockups · Dracula palette · sample data. Start with the dashboard.</p>
  <nav class="grid" aria-label="Screens">
{cards}
  </nav>
</main>
</body>
</html>
"""


def main() -> None:
    DIST.mkdir(exist_ok=True)
    # Brand files live in ../assets/brand (app icon source); the mockups only need the web-sized ones.
    ASSETS.mkdir(exist_ok=True)
    for f in ("logo-mark.png", "favicon.png"):
        shutil.copyfile(BRAND / f, ASSETS / f)
    for name, _, _ in SCREENS:
        expanded = expand((SRC / f"{name}.dc.html").read_text(encoding="utf-8"))
        leftover = re.findall(r"<i-con|<agent-avatar|<md-view|@shared-|@part |@header", expanded)
        if leftover:
            raise ValueError(f"{name}: unexpanded macros {set(leftover)}")
        (DIST / f"{name}.dc.html").write_text(expanded, encoding="utf-8", newline="\n")
        (HERE / f"{name}.html").write_text(build_page(name, expanded), encoding="utf-8", newline="\n")
        print(f"built {name}")
    (HERE / "index.html").write_text(build_index(), encoding="utf-8", newline="\n")
    print("built index.html")


if __name__ == "__main__":
    main()
