  // ---- shared (injected by build.py): settings, agent order, avatars, notifications ----
  // The real app keeps all of this in app.db (SQLite); the mockup uses localStorage.
  sharedState() {
    var load = function (k, d) {
      try { var v = JSON.parse(window.localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; }
    };
    var defaults = {
      autostart: true, startMin: false, tray: true, updates: true, density: 'compact', uiZoom: '1', reduceMotion: false,
      autoConnect: true, reconnect: true,
      nOs: true, nChat: true, nCron: true, nGateway: true, nKanban: false, nSound: false, nPreview: true, dnd: false, dndFrom: '22:00', dndTo: '07:00',
      aCpu: true, aCpuV: 80, aMem: true, aMemV: 90, aDisk: true, aDiskV: 85, aLoad: false, aLoadV: 4, aSustain: 30, aGateway: true, aOffline: false, aCronFail: true, aCost: true, aCostV: 12,
      vault: '/root/vault', uploads: '~/hermes-uploads', maxUpload: 50, hermesHome: '~/.hermes', poll: 1, vaultPoll: 3
    };
    var order = load('mc.agentOrder', null);
    var base = this.agentNames();
    if (!order || order.length !== base.length) { order = base; }
    // Pinned agents stay at the top of the Dashboard roster and in the collapsed rail (F-DASH-11).
    var pins = (load('mc.agentPins', null) || base.slice(0, 5)).filter(function (n) { return base.indexOf(n) !== -1; });
    var term = load('mc.terminal', {});
    return {
      settings: Object.assign({}, defaults, load('mc.settings', {})),
      order: order,
      pins: pins,
      avatars: load('mc.avatars', {}),
      names: load('mc.agentNames', {}),
      setOpen: false, setTab: 'general', notifOpen: false, noteIdx: null,
      // ?modal=cron|feed opens a dashboard modal (the palette links there; the Cron menu became a modal).
      modal: (function () { try { return new URLSearchParams(window.location.search).get('modal') || null; } catch (e) { return null; } })(),
      palOpen: false, palQ: '', palSel: 0,
      mcpTest: {}, tsSet: {}, tsApplied: {}, bkSel: {}, np: { name: '', desc: '', from: 'none', noSkills: false }, vw: window.innerWidth,
      // Terminal (status bar): open state and height persist; scrollback is per session.
      termOpen: !!term.open,
      sideOpen: (load('mc.sidebar', {}) || {}).open !== false,
      termH: term.h || Math.max(160, Math.min(320, Math.round(window.innerHeight * 0.32))),
      termDraft: '',
      termLines: [
        { key: 't1', text: 'Linux vps 6.8.0-45-generic x86_64 · Ubuntu 24.04.1 LTS', color: '#8B95BD' },
        { key: 't2', text: 'root@vps:~# hermes gateway status', color: '#50FA7B' },
        { key: 't3', text: 'gateway: running (multiplex) · pid 1842 · serving 5 profiles · heartbeat 3s ago', color: '#F8F8F2' }
      ],
      toasts: [], notifs: [], unread: 0, dragAgent: null, dragOver: null,
      physTick: 0,
      // Settings → Agents (model, soul, memory, user profile)
      cfgAgent: 'atlas', cfgTab: 'profile', effort: 'high', test: 'idle',
      prov: 'openrouter', base: 'https://openrouter.ai/api/v1', apiKey: '', customName: 'my-gateway', fetch: 'idle', mSel: null, mFilter: '',
      memOrig: this.sampleMemory(), memCur: this.sampleMemory(),
      userOrig: this.sampleUser(), userCur: this.sampleUser(),
      soul: '# atlas\n\nYou are **atlas**, the operator’s chief of staff.\n\n## Style\n- Short, direct answers; bullets over paragraphs.\n- Cite sources with links when you research.\n\n## Boundaries\n- Ask before anything destructive.\n- Never reveal secrets from `.env` or `auth.json`.',
      reviewing: false, saved: false
    };
  }
  sampleMemory() {
    return [
      'User prefers short bullet answers in Telegram; long form only when asked.',
      'VPS: Ubuntu 24.04, 8 vCPU / 16 GB. Hermes runs as root with a multiplex gateway serving 5 profiles.',
      'Vault lives at /root/vault; daily notes in daily/YYYY-MM-DD.md, projects in projects/.',
      'Acme client: weekly sync Thursday 10:00 WIB; uptime report goes to their Telegram group.',
      'Release notes source of truth: GitHub releases page of NousResearch/hermes-agent.'
    ];
  }
  sampleUser() {
    return [
      'Name: [YOUR NAME]. Timezone Asia/Jakarta (WIB).',
      'Writes in Indonesian and English; reply in the language of the question.',
      'Runs several Hermes agents on one VPS and monitors them from Mission Control.'
    ];
  }
  // ---- draggable graph nodes (Obsidian-like: springs, repulsion, weak anchor) ----
  physEnsure(key, nodes, links) {
    this.phys = this.phys || {};
    if (this.phys[key] && this.phys[key].p.length === nodes.length) { return; }
    this.phys[key] = {
      p: nodes.map(function (n) { return { x: n.x, y: n.y, ox: n.x, oy: n.y, vx: 0, vy: 0 }; }),
      links: links.map(function (l) {
        var a = nodes[l[0]], b = nodes[l[1]];
        return { a: l[0], b: l[1], len: Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) };
      }),
      drag: null, until: 0, raf: 0, justDragged: false
    };
  }
  physAt(key, i) {
    return this.phys && this.phys[key] ? this.phys[key].p[i] : null;
  }
  physStep(key) {
    var s = this.phys[key];
    var p = s.p;
    var i, j;
    s.links.forEach(function (l) {
      var a = p[l.a], b = p[l.b];
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var f = (d - l.len) * 0.04 / d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    });
    for (i = 0; i < p.length; i++) {
      for (j = i + 1; j < p.length; j++) {
        var ex = p[j].x - p[i].x, ey = p[j].y - p[i].y;
        var dd = ex * ex + ey * ey;
        if (dd < 3600 && dd > 0.01) {
          var dist = Math.sqrt(dd);
          var rf = (60 - dist) * 0.02 / dist;
          p[i].vx -= ex * rf; p[i].vy -= ey * rf; p[j].vx += ex * rf; p[j].vy += ey * rf;
        }
      }
    }
    var energy = 0;
    p.forEach(function (n, k) {
      if (n.pin || (s.drag && s.drag.i === k)) { n.vx = 0; n.vy = 0; return; }
      n.vx += (n.ox - n.x) * 0.004; n.vy += (n.oy - n.y) * 0.004;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
      energy += Math.abs(n.vx) + Math.abs(n.vy);
    });
    return energy;
  }
  physRun(key) {
    var self = this;
    var s = this.phys[key];
    if (s.raf) { return; }
    var next = function (f) {
      return document.visibilityState === 'visible' && window.requestAnimationFrame ? window.requestAnimationFrame(f) : setTimeout(f, 16);
    };
    var frame = function () {
      var e = self.physStep(key);
      self.setState({ physTick: self.state.physTick + 1 });
      if (s.drag || (Date.now() < s.until && e > 0.05)) { s.raf = next(frame); } else { s.raf = 0; }
    };
    s.raf = next(frame);
  }
  physGrab(key, i, canvasId, W) {
    var self = this;
    return function (e) {
      var s = self.phys[key];
      var canvas = document.getElementById(canvasId);
      if (!s || !canvas) { return; }
      e.preventDefault();
      var start = { x: e.clientX, y: e.clientY };
      s.drag = { i: i, moved: false };
      document.body.style.cursor = 'grabbing';
      var move = function (ev) {
        var r = canvas.getBoundingClientRect();
        var k = r.width / W;
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) { s.drag.moved = true; }
        var n = s.p[i];
        n.x = (ev.clientX - r.left) / k;
        n.y = (ev.clientY - r.top) / k;
        n.ox = n.x; n.oy = n.y;
      };
      var up = function () {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        s.justDragged = s.drag && s.drag.moved;
        if (s.justDragged) { s.p[i].pin = true; }
        s.drag = null;
        s.until = Date.now() + 2500;
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      self.physRun(key);
    };
  }
  // ---- graph camera: wheel zoom toward the cursor, drag empty space to pan, fit ----
  viewGet(key) {
    this.views = this.views || {};
    if (!this.views[key]) { this.views[key] = { k: 1, tx: 0, ty: 0, user: false }; }
    return this.views[key];
  }
  viewBump() {
    this.setState({ viewTick: (this.state.viewTick || 0) + 1 });
  }
  viewFit(key, panelId, W, H, top, force) {
    var el = document.getElementById(panelId);
    var v = this.viewGet(key);
    if (!el || (v.user && !force)) { return; }
    var k = Math.max(0.2, Math.min((el.clientWidth - 24) / W, (el.clientHeight - top - 16) / H, 1.6));
    var tx = (el.clientWidth - W * k) / 2;
    var ty = top + (el.clientHeight - top - H * k) / 2;
    if (force || Math.abs(k - v.k) > 0.005 || Math.abs(tx - v.tx) > 1 || Math.abs(ty - v.ty) > 1) {
      v.k = k; v.tx = tx; v.ty = ty; v.user = false;
      this.viewBump();
    }
  }
  viewTransform(key) {
    var v = this.viewGet(key);
    return 'translate(' + v.tx.toFixed(1) + 'px, ' + v.ty.toFixed(1) + 'px) scale(' + v.k.toFixed(3) + ')';
  }
  viewWheel(key, panelId) {
    var self = this;
    return function (e) {
      var el = document.getElementById(panelId);
      if (!el) { return; }
      if (e.cancelable) { e.preventDefault(); }
      var r = el.getBoundingClientRect();
      var zf = (r.width / el.offsetWidth) || 1;
      var px = (e.clientX - r.left) / zf, py = (e.clientY - r.top) / zf;
      var v = self.viewGet(key);
      var nk = Math.max(0.15, Math.min(4, v.k * Math.exp(-e.deltaY * 0.0015)));
      v.tx = px - (px - v.tx) * (nk / v.k);
      v.ty = py - (py - v.ty) * (nk / v.k);
      v.k = nk;
      v.user = true;
      self.viewBump();
    };
  }
  viewPan(key, panelId) {
    var self = this;
    return function (e) {
      var el = document.getElementById(panelId);
      var zf = el ? ((el.getBoundingClientRect().width / el.offsetWidth) || 1) : 1;
      if (e.button !== 0 || (e.target.closest && e.target.closest('button, a, input, select, [data-graph-ui]'))) { return; }
      e.preventDefault();
      var v = self.viewGet(key);
      var sx = e.clientX, sy = e.clientY, tx0 = v.tx, ty0 = v.ty;
      document.body.style.cursor = 'grabbing';
      var move = function (ev) { v.tx = tx0 + (ev.clientX - sx) / zf; v.ty = ty0 + (ev.clientY - sy) / zf; v.user = true; self.viewBump(); };
      var up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }
  labelAlpha(key, isSat, bright) {
    // Obsidian-style text fade: labels fade out when zoomed out; small notes only show when zoomed in.
    var k = this.viewGet(key).k;
    if (bright) { return 1; }
    if (isSat) { return Math.max(0, Math.min(1, (k - 1.2) / 0.4)); }
    return Math.max(0, Math.min(0.85, (k - 0.45) / 0.3));
  }
  physClickOk(key) {
    var s = this.phys && this.phys[key];
    if (s && s.justDragged) { s.justDragged = false; return false; }
    return true;
  }
  saveKey(k, v) {
    try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
  }
  setSetting(k, v) {
    var s = Object.assign({}, this.state.settings);
    s[k] = v;
    if (k === 'nOs' && v) { this.askOsPermission(); }
    this.setState({ settings: s });
    this.saveKey('mc.settings', s);
  }
  // Display names live only in app.db; the Hermes profile name on the VPS never changes.
  displayName(id) {
    var n = this.state.names && this.state.names[id];
    return n && n.trim() ? n.trim() : id;
  }
  setDisplayName(id, value) {
    var names = Object.assign({}, this.state.names);
    var v = String(value || '').slice(0, 24);
    if (v.trim() && v.trim() !== id) { names[id] = v; } else { delete names[id]; }
    this.setState({ names: names });
    this.saveKey('mc.agentNames', names);
  }
  // ---- terminal (opened from the status bar, sits on the same layer as the bar) ----
  termSave(patch) {
    var s = Object.assign({ open: this.state.termOpen, h: this.state.termH }, patch || {});
    this.saveKey('mc.terminal', s);
  }
  toggleSide() {
    var open = !this.state.sideOpen;
    this.setState({ sideOpen: open });
    this.saveKey('mc.sidebar', { open: open });
  }
  toggleTerm() {
    var open = !this.state.termOpen;
    this.setState({ termOpen: open });
    this.termSave({ open: open });
    if (open) { setTimeout(function () { var el = document.getElementById('term-in'); if (el) { el.focus(); } }, 30); }
  }
  runCommand(cmd) {
    var c = cmd.trim();
    var out = {
      help: ['try: uptime, whoami, df -h, hermes --version, hermes profile list, hermes cron list, clear'],
      uptime: [' 20:44:10 up 12 days,  4:02,  1 user,  load average: 1.42, 0.98, 0.77'],
      whoami: ['root'],
      'df -h': ['Filesystem      Size  Used Avail Use% Mounted on', '/dev/vda1       160G   77G   83G  48% /', '/dev/vdb1       500G  412G   88G  82% /data'],
      'hermes --version': ['hermes v0.21.6'],
      'hermes profile list': ['PROFILE   MODEL                         GATEWAY', 'atlas     anthropic/claude-opus-5.5     running', 'scout     anthropic/claude-sonnet-5.5   running', 'scribe    nousresearch/hermes-4-405b    running', 'herald    anthropic/claude-haiku-5.5    running', 'ledger    anthropic/claude-sonnet-5.5   parked'],
      'hermes cron list': ['scout   market-scan       every 30m   next 12m', 'scout   arxiv-watch       every 6h    running', 'herald  inbox-triage      every 2h    (last: delivery_failed)', 'atlas   morning-briefing  07:00       next 10h18m']
    };
    if (c === 'clear') { this.setState({ termLines: [], termDraft: '' }); return; }
    var k = Date.now();
    var lines = this.state.termLines.concat([{ key: 'c' + k, text: 'root@vps:~# ' + c, color: '#50FA7B' }]);
    if (c) {
      if (out[c]) {
        lines = lines.concat(out[c].map(function (t, i) { return { key: 'o' + k + i, text: t, color: '#F8F8F2' }; }));
      } else {
        lines.push({ key: 'e' + k, text: 'bash: ' + c.split(' ')[0] + ': not simulated in this mockup (try: help)', color: '#FF5555' });
      }
    }
    this.setState({ termLines: lines.slice(-200), termDraft: '' });
  }
  termVals() {
    var self = this;
    var st = this.state;
    var maxH = function () { return Math.max(160, Math.round(window.innerHeight / (parseFloat(self.state.settings.uiZoom) || 1) * 0.8)); };
    return {
      termOpen: st.termOpen, termH: st.termH, termLines: st.termLines, termDraft: st.termDraft,
      sideCls: st.sideOpen ? 'is-open' : 'is-rail', sideExpanded: st.sideOpen ? 'true' : 'false',
      sideToggleTitle: st.sideOpen ? 'Collapse sidebar' : 'Expand sidebar',
      toggleSide: function () { self.toggleSide(); },
      termOn: st.termOpen ? 'on' : '', termPressed: st.termOpen ? 'true' : 'false',
      toggleTerminal: function () { self.toggleTerm(); },
      termClear: function () { self.setState({ termLines: [] }); },
      termInput: function (e) { self.setState({ termDraft: e.target.value }); },
      termKey: function (e) { if (e.key === 'Enter') { e.preventDefault(); self.runCommand(e.target.value); } },
      termGrab: function (e) {
        e.preventDefault();
        var el = document.getElementById('term-resizer');
        var zf = el ? ((el.getBoundingClientRect().width / el.offsetWidth) || 1) : 1;
        var y0 = e.clientY, h0 = self.state.termH;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        var move = function (ev) { self.setState({ termH: Math.max(120, Math.min(maxH(), Math.round(h0 + (y0 - ev.clientY) / zf))) }); };
        var up = function () {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          self.termSave();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      },
      termSepKey: function (e) {
        var step = e.shiftKey ? 64 : 16;
        var h = self.state.termH;
        if (e.key === 'ArrowUp') { e.preventDefault(); h = Math.min(maxH(), h + step); }
        if (e.key === 'ArrowDown') { e.preventDefault(); h = Math.max(120, h - step); }
        if (h !== self.state.termH) { self.setState({ termH: h }); self.termSave({ h: h }); }
      }
    };
  }
  // ---- note reader (opens when a graph node is clicked) ----
  noteVals(g) {
    var self = this;
    var i = this.state.noteIdx;
    if (i == null || !g || !g.nodes[i]) { return { noteOpen: false }; }
    var n = g.nodes[i];
    var nb = [];
    g.links.forEach(function (l) { if (l[0] === i) { nb.push(l[1]); } else if (l[1] === i) { nb.push(l[0]); } });
    var byTitle = {};
    g.nodes.forEach(function (x) { byTitle[x.title] = x.i; });
    var go = function (title) { return byTitle[title] == null ? null : function () { self.setState({ noteIdx: byTitle[title] }); }; };
    var tags = nb.filter(function (k) { return g.nodes[k].tag; }).map(function (k) { return { title: g.nodes[k].title, pick: function () { self.setState({ noteIdx: k }); } }; });
    var linked = nb.filter(function (k) { return !g.nodes[k].tag; }).sort(function (a, b) { return (g.nodes[a].sat ? 1 : 0) - (g.nodes[b].sat ? 1 : 0); }).map(function (k) {
      var x = g.nodes[k];
      return { key: 'nl' + k, title: x.title, unresolved: !!x.unresolved, color: x.unresolved ? '#8B95BD' : '#50FA7B', pick: function () { self.setState({ noteIdx: k }); } };
    });
    var body;
    if (n.tag) {
      body = 'Notes tagged **' + n.title + '** in the vault.';
    } else if (n.unresolved) {
      body = 'This note does not exist yet. ' + linked.length + ' note' + (linked.length === 1 ? ' links' : 's link') + ' to it.';
    } else {
      var extra = {
        projects: '## Status\n- Owner: atlas\n- Last edit 2026-10-10 20:41 by scout\n\n## Next\n- Review on Thursday with [[Team Sync]]\n- Keep [[Zero-Change Principle]] in every design decision',
        research: '## Summary\n- Collected by scout from arxiv-watch and web research\n- Cross-checked against [[Obsidian Graph Internals]]\n\n```\nsource: cron/arxiv-watch · 2026-10-10\n```',
        people: '## Notes\n- Last contact 2026-10-09\n- Action items roll into [[Release Plan]]',
        daily: '## Log\n- 09:00 standup\n- 14:30 reviewed **Hermes v0.21.6** changes\n- 20:41 scout wrote [[Speculative Decoding]]'
      }[n.group] || '';
      body = '# ' + n.title + '\n\n' + n.excerpt + (n.sat ? '' : '\n\n' + extra);
    }
    return {
      noteOpen: true,
      note: {
        key: 'note' + i, title: n.title, path: n.tag ? 'tag' : n.path, color: n.tag ? '#8B95BD' : (n.unresolved ? '#A9B2D3' : '#50FA7B'),
        kind: n.tag ? 'tag' : (n.unresolved ? 'unresolved' : 'note'),
        blocks: this.md(body, go), tags: tags, hasTags: tags.length > 0,
        linked: linked.slice(0, 24), linkCount: linked.length, hasLinks: linked.length > 0,
        linkLabel: n.tag ? 'Notes' : (n.unresolved ? 'Linked from' : 'Links')
      },
      closeNote: function () { self.setState({ noteIdx: null }); }
    };
  }
  // Demo-only: the sample fleet has 10 agents; open any screen with ?agents=N to change it (5-40).
  demoAgentCount() {
    try { var n = parseInt(new URLSearchParams(window.location.search).get('agents'), 10); return n >= 5 ? Math.min(n, 40) : 10; } catch (e) { return 10; }
  }
  agentNames() {
    var extra = ['nova', 'orbit', 'quill', 'pixel', 'sage', 'forge', 'echo', 'relay', 'cipher', 'beacon', 'vega', 'mosaic', 'pylon', 'ember', 'tidal'];
    var names = ['atlas', 'scout', 'scribe', 'herald', 'ledger'];
    for (var i = 0; i < this.demoAgentCount() - 5; i++) { names.push(extra[i] || 'agent-' + (i + 6)); }
    return names;
  }
  togglePin(name) {
    var p = this.state.pins.indexOf(name) === -1 ? this.state.pins.concat([name]) : this.state.pins.filter(function (n) { return n !== name; });
    this.setState({ pins: p });
    this.saveKey('mc.agentPins', p);
  }
  baseAgents() {
    var self = this;
    var palette = ['#50FA7B', '#FFB86C', '#8BE9FD', '#FF79C6', '#BD93F9', '#F1FA8C'];
    var models = [['claude-sonnet-5.5', 'anthropic'], ['claude-haiku-5.5', 'openrouter'], ['hermes-4-405b', 'nous'], ['claude-opus-5.5', 'openrouter']];
    var list = [
      { name: 'atlas', color: '#50FA7B', status: 'WORKING', model: 'claude-opus-5.5', provider: 'openrouter' },
      { name: 'scout', color: '#FFB86C', status: 'WORKING', model: 'claude-sonnet-5.5', provider: 'anthropic' },
      { name: 'scribe', color: '#8BE9FD', status: 'IDLE', model: 'hermes-4-405b', provider: 'nous' },
      { name: 'herald', color: '#FF79C6', status: 'IDLE', model: 'claude-haiku-5.5', provider: 'openrouter' },
      { name: 'ledger', color: '#8B95BD', status: 'PARKED', model: 'claude-sonnet-5.5', provider: 'anthropic' }
    ];
    this.agentNames().slice(5).forEach(function (n, i) {
      var m = models[i % models.length];
      list.push({ name: n, color: palette[i % palette.length], status: i % 4 === 0 ? 'WORKING' : (i % 5 === 3 ? 'PARKED' : 'IDLE'), model: m[0], provider: m[1] });
    });
    return list.map(function (a) {
      a.label = self.displayName(a.name);
      a.statusColor = a.status === 'WORKING' ? '#50FA7B' : (a.status === 'IDLE' ? '#A9B2D3' : '#8B95BD');
      a.dot = a.status === 'WORKING' ? '#50FA7B' : (a.status === 'IDLE' ? '#A9B2D3' : '#6272A4');
      return a;
    });
  }
  orderedAgents(list) {
    var o = this.state.order;
    return list.slice().sort(function (a, b) { return o.indexOf(a.name) - o.indexOf(b.name); });
  }
  agentLook(name, color) {
    var av = this.state.avatars[name];
    return { initial: name.charAt(0).toUpperCase(), color: color, hasAvatar: !!av, noAvatar: !av, avatar: av || '' };
  }
  moveAgent(from, to) {
    if (!from || !to || from === to) { return; }
    var o = this.state.order.filter(function (n) { return n !== from; });
    o.splice(o.indexOf(to) + (this.state.order.indexOf(from) < this.state.order.indexOf(to) ? 1 : 0), 0, from);
    this.setState({ order: o, dragAgent: null, dragOver: null });
    this.saveKey('mc.agentOrder', o);
  }
  dragFor(name) {
    var self = this;
    return {
      dragging: this.state.dragAgent === name,
      over: this.state.dragOver === name && this.state.dragAgent && this.state.dragAgent !== name,
      onDragStart: function (e) {
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name); } catch (err) { /* ignore */ }
        self.setState({ dragAgent: name });
      },
      onDragOver: function (e) {
        e.preventDefault();
        if (self.state.dragOver !== name) { self.setState({ dragOver: name }); }
      },
      onDrop: function (e) { e.preventDefault(); self.moveAgent(self.state.dragAgent, name); },
      onDragEnd: function () { self.setState({ dragAgent: null, dragOver: null }); }
    };
  }
  setAvatar(name, file) {
    var self = this;
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = 96; c.height = 96;
        var s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
        var av = Object.assign({}, self.state.avatars);
        av[name] = c.toDataURL('image/jpeg', 0.85);
        self.setState({ avatars: av });
        self.saveKey('mc.avatars', av);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  notify(n) {
    var self = this;
    var id = 'n' + Date.now() + Math.floor(Math.random() * 1000);
    var item = Object.assign({ id: id, time: new Date().toTimeString().slice(0, 5) }, n);
    this.setState({ toasts: this.state.toasts.concat([item]).slice(-3), notifs: [item].concat(this.state.notifs).slice(0, 20), unread: this.state.unread + 1 });
    setTimeout(function () { self.setState({ toasts: self.state.toasts.filter(function (t) { return t.id !== id; }) }); }, 5200);
    this.osNotify(item);
  }
  // Desktop (OS) notification. The real app uses Electron's Notification from the main process, so it shows over any other
  // app, even when the window is minimized or in the tray. The mockup uses the browser API and only fires while the page is in the background.
  osNotify(item) {
    var s = this.state.settings;
    if (!s.nOs || s.dnd || typeof window.Notification === 'undefined' || window.Notification.permission !== 'granted') { return; }
    if (!item.force && !document.hidden && document.hasFocus()) { return; }
    try {
      var n = new window.Notification(item.title, { body: s.nPreview === false ? '' : (item.body || ''), tag: item.id, silent: !s.nSound });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* notifications blocked */ }
  }
  askOsPermission() {
    if (typeof window.Notification !== 'undefined' && window.Notification.permission === 'default') { try { window.Notification.requestPermission(); } catch (e) { /* ignore */ } }
  }
  segs(text, go) {
    var out = [];
    var re = /(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) { out.push({ t: text.slice(last, m.index), plain: true }); }
      if (m[0].charAt(0) === '`') { out.push({ t: m[0].slice(1, -1), code: true }); } else if (m[0].charAt(0) === '[') {
        var title = m[0].slice(2, -2);
        var pick = go ? go(title) : null;
        out.push({ t: title, wiki: !!pick, wikiOff: !pick, pick: pick });
      } else { out.push({ t: m[0].slice(2, -2), bold: true }); }
      last = re.lastIndex;
    }
    if (last < text.length) { out.push({ t: text.slice(last), plain: true }); }
    return out;
  }
  md(text, go) {
    // Minimal markdown → blocks (headings, paragraphs, bullet lists, code fences, `code`, **bold**, [[wikilinks]]).
    var self = this;
    var blocks = [];
    var lines = String(text || '').split('\n');
    var i = 0;
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) {
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        blocks.push({ isCode: true, text: code.join('\n') });
        i++;
      } else if (/^\s*[-*•]\s+/.test(l)) {
        var items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push({ segs: self.segs(lines[i].replace(/^\s*[-*•]\s+/, ''), go) }); i++; }
        blocks.push({ isUl: true, items: items });
      } else if (/^#{1,6}\s/.test(l)) {
        blocks.push({ isH: true, segs: self.segs(l.replace(/^#{1,6}\s/, ''), go) });
        i++;
      } else if (l.trim()) {
        blocks.push({ isP: true, segs: self.segs(l, go) });
        i++;
      } else {
        i++;
      }
    }
    return blocks;
  }
  sharedMount() {
    var self = this;
    this.onDocKey = function (e) {
      var st = self.state;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (st.palOpen) { self.setState({ palOpen: false }); } else { self.openPalette(); } return; }
      if (e.key === 'Escape') {
        // Close the top-most layer first.
        if (st.palOpen) { self.setState({ palOpen: false }); } else if (st.noteIdx != null) { self.setState({ noteIdx: null }); } else if (st.setOpen || st.notifOpen) { self.setState({ setOpen: false, notifOpen: false }); } else if (st.modal) { self.setState({ modal: null }); } else if (st.termOpen) { self.toggleTerm(); }
      }
      if (e.key === '`' && e.ctrlKey) { e.preventDefault(); self.toggleTerm(); }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[0-9]$/.test(e.key)) {
        var sc = self.screens()[e.key === '0' ? 9 : +e.key - 1];
        if (sc) { e.preventDefault(); window.location.href = sc[1] + '.dc.html'; }
      }
    };
    document.addEventListener('keydown', this.onDocKey);
    var rt = null;
    this.onSharedResize = function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (Math.abs(self.state.vw - window.innerWidth) > 8) { self.setState({ vw: window.innerWidth }); } }, 120);
    };
    window.addEventListener('resize', this.onSharedResize);
  }
  setEntries(key, list) {
    var patch = { reviewing: false, saved: false };
    patch[key === 'user' ? 'userCur' : 'memCur'] = list;
    this.setState(patch);
  }
  agentCfgVals() {
    var self = this;
    var st = this.state;
    var agent = this.baseAgents().filter(function (a) { return a.name === st.cfgAgent; })[0] || this.baseAgents()[0];
    var look = this.agentLook(agent.name, agent.color);
    var isEntries = st.cfgTab === 'memory' || st.cfgTab === 'user';
    var key = st.cfgTab === 'user' ? 'user' : 'memory';
    var cur = key === 'user' ? st.userCur : st.memCur;
    var orig = key === 'user' ? st.userOrig : st.memOrig;
    var limit = key === 'user' ? 1375 : 2200;
    var count = cur.join('\n§\n').length;
    var over = count > limit;
    var pct = Math.min(100, Math.round(count / limit * 100));
    var countColor = over ? '#FF5555' : (pct >= 80 ? '#FFB86C' : '#50FA7B');
    var dirtyOf = function (c, o) { return c.join('\n§\n') !== o.join('\n§\n'); };
    var diff = [];
    orig.forEach(function (t) { if (cur.indexOf(t) === -1) { diff.push({ key: 'd-' + t.slice(0, 24), sign: '−', text: t, bg: '#3a2530', fg: '#FF5555' }); } });
    cur.forEach(function (t) { if (orig.indexOf(t) === -1) { diff.push({ key: 'a-' + t.slice(0, 24), sign: '+', text: t, bg: '#24382d', fg: '#50FA7B' }); } });
    var P = {
      openrouter: { label: 'OpenRouter', sub: 'key saved', base: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY', saved: 'sk-or…7890', needsKey: true, slug: 'openrouter', models: [['anthropic/claude-opus-5.5', '200k'], ['anthropic/claude-sonnet-5.5', '200k'], ['anthropic/claude-haiku-5.5', '200k'], ['nousresearch/hermes-4-405b', '128k'], ['nousresearch/hermes-4-70b', '128k']] },
      anthropic: { label: 'Anthropic', sub: 'key saved', base: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY', saved: 'sk-ant…a1f3', needsKey: true, slug: 'anthropic', models: [['claude-opus-5-5', '200k'], ['claude-sonnet-5-5', '200k'], ['claude-haiku-5-5', '200k']] },
      nous: { label: 'Nous Portal', sub: 'oauth', base: '', oauth: true, slug: 'nous', models: [['Hermes-4-405B', '128k'], ['Hermes-4-70B', '128k']] },
      ollama: { label: 'Ollama', sub: 'local', base: 'http://localhost:11434/v1', needsKey: false, slug: 'ollama', models: [['hermes3:8b', '128k'], ['llama3.1:8b', '128k'], ['qwen2.5:14b', '32k']] },
      custom: { label: 'Custom', sub: 'OpenAI-compatible', base: '', needsKey: true, custom: true, models: [['my-model-large', '—'], ['my-model-small', '—']] }
    };
    var pd = P[st.prov];
    var slug = (st.customName || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
    var env = pd.custom ? slug.toUpperCase().replace(/-/g, '_') + '_API_KEY' : pd.env;
    var cfg = 'hermes -p ' + agent.name + ' config set ';
    var cmds = [];
    if (pd.custom) { cmds.push('$ ' + cfg + 'providers.' + slug + '.api ' + (st.base || '<base-url>')); cmds.push('$ ' + cfg + 'providers.' + slug + '.key_env ' + env); }
    if (pd.needsKey && st.apiKey) { cmds.push('$ ' + cfg + env + ' ••••••••'); }
    cmds.push('$ ' + cfg + 'model.provider ' + (pd.custom ? slug : pd.slug));
    if (!pd.custom && !pd.oauth && st.base !== pd.base) { cmds.push('$ ' + cfg + 'model.base_url ' + st.base); }
    cmds.push('$ ' + cfg + 'model.default ' + (st.mSel || '<pick a model>'));
    cmds.push('$ ' + cfg + 'agent.reasoning_effort ' + st.effort);
    var filt = (st.mFilter || '').toLowerCase();
    var fetchNote = { idle: '', loading: 'GET ' + (st.base || 'endpoint') + '/models via VPS…', done: '200 · ' + pd.models.length + ' models · fetched on the VPS', nobase: 'Enter a base URL first', nokey: 'This endpoint needs an API key' }[st.fetch];
    var testText = { idle: '', running: 'Testing…', ok: (st.mSel || 'model') + ' replied "OK" in 1.9s', nomodel: 'Pick a model first' }[st.test];
    var subTabs = [['profile', 'Profile'], ['model', 'Model'], ['soul', 'Soul'], ['memory', 'Memory'], ['user', 'User profile'], ['mcp', 'MCP'], ['tools', 'Toolsets'], ['fallback', 'Fallback'], ['backup', 'Backup']].map(function (t) {
      var on = st.cfgTab === t[0];
      var dirty = (t[0] === 'memory' && dirtyOf(st.memCur, st.memOrig)) || (t[0] === 'user' && dirtyOf(st.userCur, st.userOrig));
      return { label: t[1], dirty: dirty, selected: on ? 'true' : 'false', fg: on ? '#F8F8F2' : '#A9B2D3', line: on ? '#50FA7B' : 'transparent', pick: function () { self.setState({ cfgTab: t[0], reviewing: false }); } };
    });
    return {
      cfgKey: agent.name + '-' + st.cfgTab,
      cfgA: Object.assign({}, agent, look),
      cfgTabs: subTabs,
      cfgProfile: st.cfgTab === 'profile',
      cfgModel: st.cfgTab === 'model',
      cfgSoul: st.cfgTab === 'soul',
      cfgEntries: isEntries,
      cfgPhotoId: 'cfg-photo-' + agent.name,
      cfgNameId: 'cfg-name-' + agent.name,
      cfgName: (st.names && st.names[agent.name]) || '',
      cfgOnName: function (e) { self.setDisplayName(agent.name, e.target.value); },
      cfgResetName: function () { self.setDisplayName(agent.name, ''); },
      cfgHasName: !!(st.names && st.names[agent.name]),
      cfgOnPhoto: function (e) { self.setAvatar(agent.name, e.target.files && e.target.files[0]); },
      cfgRemovePhoto: function () { var av = Object.assign({}, self.state.avatars); delete av[agent.name]; self.setState({ avatars: av }); self.saveKey('mc.avatars', av); },
      providers: Object.keys(P).map(function (k) {
        var on = k === st.prov;
        return { label: P[k].label, sub: P[k].sub, checked: on ? 'true' : 'false', bg: on ? '#44475A' : 'transparent', border: on ? '#50FA7B' : '#44475A', pick: function () { self.setState({ prov: k, base: P[k].base, apiKey: '', fetch: 'idle', mSel: null, mFilter: '', test: 'idle' }); } };
      }),
      provCustom: !!pd.custom, provOauth: !!pd.oauth, provNeedsKey: !!pd.needsKey, provHasBase: !pd.oauth,
      slug: slug, env: env, customName: st.customName, base: st.base, apiKey: st.apiKey,
      onCustomName: function (e) { self.setState({ customName: e.target.value }); },
      onBase: function (e) { self.setState({ base: e.target.value, fetch: 'idle' }); },
      onKey: function (e) { self.setState({ apiKey: e.target.value }); },
      keyNote: pd.saved ? 'saved as ' + pd.saved + ' · leave empty to keep' : 'required',
      keyPlaceholder: pd.saved ? '•••••••• (unchanged)' : 'Paste API key',
      fetchModels: function () {
        var c = P[self.state.prov];
        if (!c.oauth && !self.state.base) { self.setState({ fetch: 'nobase' }); return; }
        if (c.needsKey && !c.saved && !self.state.apiKey) { self.setState({ fetch: 'nokey' }); return; }
        self.setState({ fetch: 'loading' });
        setTimeout(function () { self.setState({ fetch: 'done' }); }, 700);
      },
      fetchLabel: st.fetch === 'done' ? 'Refresh models' : 'Fetch models',
      fetchNote: fetchNote, fetchColor: st.fetch === 'done' ? '#50FA7B' : (st.fetch === 'loading' ? '#8BE9FD' : '#FF5555'),
      hasModels: st.fetch === 'done', noModels: st.fetch !== 'done',
      models: pd.models.filter(function (m) { return !filt || m[0].toLowerCase().indexOf(filt) > -1; }).map(function (m) {
        var on = st.mSel === m[0];
        return { id: m[0], ctx: m[1], checked: on ? 'true' : 'false', fill: on ? '#50FA7B' : 'transparent', dot: on ? '#50FA7B' : '#6272A4', bg: on ? '#44475A' : 'transparent', pick: function () { self.setState({ mSel: m[0], test: 'idle' }); } };
      }),
      mFilter: st.mFilter, onFilter: function (e) { self.setState({ mFilter: e.target.value }); },
      efforts: ['off', 'minimal', 'low', 'medium', 'high', 'ultra'].map(function (e) {
        var on = st.effort === e;
        return { label: e, pressed: on ? 'true' : 'false', bg: on ? '#BD93F9' : 'transparent', border: on ? '#BD93F9' : '#44475A', fg: on ? '#282A36' : '#A9B2D3', pick: function () { self.setState({ effort: e }); } };
      }),
      cmdPreview: cmds.join('\n'),
      testModel: function () {
        if (!self.state.mSel) { self.setState({ test: 'nomodel' }); return; }
        self.setState({ test: 'running' });
        setTimeout(function () { self.setState({ test: 'ok' }); }, 1100);
      },
      testText: testText, testColor: st.test === 'ok' ? '#50FA7B' : (st.test === 'running' ? '#8BE9FD' : '#FF5555'),
      saveModel: function () { if (self.state.mSel) { self.notify({ kind: 'ok', title: agent.name + ' model saved', body: self.state.mSel + ' · applies to new sessions' }); } },
      modelSaveBg: st.mSel ? '#50FA7B' : '#44475A',
      soul: st.soul, soulLen: st.soul.length, soulBlocks: this.md(st.soul),
      onSoul: function (e) { self.setState({ soul: e.target.value }); },
      entFile: key === 'user' ? 'USER.md' : 'MEMORY.md',
      entDirty: dirtyOf(cur, orig),
      entCount: count.toLocaleString('en-US'), entLimit: limit.toLocaleString('en-US'), entPct: pct, entColor: countColor,
      entries: cur.map(function (text, i) {
        return {
          key: key + i, id: 'ent-' + key + '-' + i, n: i + 1, text: text, border: orig.indexOf(text) === -1 ? '#FFB86C' : '#44475A',
          change: function (e) { var l = cur.slice(); l[i] = e.target.value; self.setEntries(key, l); },
          remove: function () { var l = cur.slice(); l.splice(i, 1); self.setEntries(key, l); }
        };
      }),
      addEntry: function () { self.setEntries(key, cur.concat([''])); },
      revertEntries: function () { self.setEntries(key, orig.slice()); },
      reviewEntries: function () { if (!over && dirtyOf(cur, orig)) { self.setState({ reviewing: true, saved: false }); } },
      entSaveBg: over || !dirtyOf(cur, orig) ? '#44475A' : '#50FA7B',
      reviewing: st.reviewing, saved: st.saved, diff: diff, hasDiff: diff.length > 0,
      writeEntries: function () {
        var patch = { reviewing: false, saved: true };
        patch[key === 'user' ? 'userOrig' : 'memOrig'] = cur.slice();
        self.setState(patch);
        self.notify({ kind: 'ok', title: (key === 'user' ? 'USER.md' : 'MEMORY.md') + ' saved', body: agent.name + ' · applies to new sessions' });
      }
    };
  }
  navFor(active) {
    var keys = ['dash', 'chat', 'feed', 'sess', 'kanban', 'usage', 'skills', 'logs', 'brain', 'server'];
    var nav = {};
    var cur = {};
    keys.forEach(function (k) { nav[k] = k === active ? 'on' : ''; cur[k] = k === active ? 'page' : 'false'; });
    return { nav: nav, navCur: cur };
  }
  // Settings → Agents: MCP, Toolsets, Fallback, Backup and "New profile". Sample data; the real app reads it through the hermes CLI.
  cfgExtraVals() {
    var self = this;
    var st = this.state;
    var agent = this.baseAgents().filter(function (a) { return a.name === st.cfgAgent; })[0] || this.baseAgents()[0];
    var an = agent.name;
    var tab = st.cfgTab;
    var toTerminal = function (cmd) {
      self.setState({ termOpen: true, termDraft: cmd, setOpen: false });
      self.termSave({ open: true });
      setTimeout(function () { var el = document.getElementById('term-in'); if (el) { el.focus(); } }, 80);
    };
    var mk = function (arr, cur) { return arr.map(function (o) { return { v: o[0], label: o[1], sel: o[0] === cur, unsel: o[0] !== cur }; }); };

    // MCP (read-only list; env and header values are never shown)
    var mcpData = {
      atlas: [
        { name: 'filesystem', transport: 'stdio', target: 'npx -y @modelcontextprotocol/server-filesystem ~/vault', status: 'connected', tools: 11, env: 'env: none' },
        { name: 'github', transport: 'http', target: 'https://api.githubcopilot.com/mcp/', status: 'connected', tools: 24, env: 'headers: Authorization (value hidden)' },
        { name: 'postgres', transport: 'stdio', target: 'uvx mcp-server-postgres', status: 'error', tools: 0, env: 'env: DATABASE_URL (value hidden)', note: 'connection refused on the last start; check that the database is reachable from the VPS' }
      ],
      scout: [{ name: 'filesystem', transport: 'stdio', target: 'npx -y @modelcontextprotocol/server-filesystem ~/vault', status: 'connected', tools: 11, env: 'env: none' }, { name: 'web-fetch', transport: 'stdio', target: 'uvx mcp-server-fetch', status: 'disabled', tools: 0, env: 'env: none', note: 'disabled in config.yaml (enabled: false)' }],
      scribe: [{ name: 'filesystem', transport: 'stdio', target: 'npx -y @modelcontextprotocol/server-filesystem ~/vault', status: 'connected', tools: 11, env: 'env: none' }],
      herald: [], ledger: []
    };
    var sColor = { connected: '#50FA7B', error: '#FF5555', disabled: '#8B95BD' };
    var mcpRows = (mcpData[an] || []).map(function (m) {
      var t = st.mcpTest[an + '/' + m.name];
      return {
        name: m.name, transport: m.transport, target: m.target, status: m.status, color: sColor[m.status], tools: m.tools ? m.tools + ' tools' : 'no tools', env: m.env + ' · value hidden',
        hasNote: !!m.note || t === 'ok' || t === 'fail', note: t === 'ok' ? 'Test passed: started, listed ' + m.tools + ' tools, stopped.' : (t === 'fail' ? 'Test failed: ' + (m.note || 'could not start') : m.note), noteColor: t === 'ok' ? '#50FA7B' : (m.status === 'error' || t === 'fail' ? '#FF5555' : '#A9B2D3'),
        testLabel: t === 'running' ? 'Testing…' : 'Test',
        test: function () {
          var k = an + '/' + m.name;
          var o = Object.assign({}, self.state.mcpTest); o[k] = 'running'; self.setState({ mcpTest: o });
          setTimeout(function () { var o2 = Object.assign({}, self.state.mcpTest); o2[k] = m.status === 'connected' ? 'ok' : 'fail'; self.setState({ mcpTest: o2 }); }, 900);
        }
      };
    });
    if (mcpRows.length === 0) { mcpRows = [{ name: 'No MCP servers', transport: '—', target: 'Add one in the terminal and it shows up here.', status: 'none', color: '#8B95BD', tools: '', env: '', hasNote: false, note: '', noteColor: '', testLabel: 'Test', test: function () {} }]; }

    // Toolsets matrix
    var cols = ['cli', 'telegram', 'discord', 'cron'];
    var tsDef = [['web', 'search and fetch pages', [1, 1, 1, 1]], ['file', 'read and write files', [1, 1, 1, 1]], ['terminal', 'run shell commands', [1, 1, 0, 1]], ['browser', 'drive a headless browser', [1, 0, 0, 0]], ['code_execution', 'run Python snippets', [1, 0, 0, 1]], ['delegation', 'spawn subagents', [1, 0, 0, 0]], ['memory', 'save notes to MEMORY.md', [1, 1, 1, 1]], ['cronjob', 'manage scheduled jobs', [1, 1, 0, 0]], ['kanban', 'tasks between agents (off unless enabled)', [0, 0, 0, 0]]];
    var keyOf = function (t, c) { return an + '|' + t + '|' + c; };
    var baseOf = function (t, c, d) { var k = keyOf(t, c); return st.tsApplied[k] != null ? st.tsApplied[k] : !!d[cols.indexOf(c)]; };
    var curOf = function (t, c, d) { var k = keyOf(t, c); return st.tsSet[k] != null ? st.tsSet[k] : baseOf(t, c, d); };
    var changes = [];
    var tsRows = tsDef.map(function (d) {
      return {
        name: d[0], hint: d[1],
        cells: cols.map(function (c) {
          var cur = curOf(d[0], c, d[2]);
          var base = baseOf(d[0], c, d[2]);
          if (cur !== base) { changes.push('hermes -p ' + an + ' tools ' + (cur ? 'enable ' : 'disable ') + d[0] + ' --platform ' + c); }
          return {
            key: d[0] + c, on: cur, checked: cur ? 'true' : 'false', border: cur !== base ? '#FFB86C' : (cur ? '#50FA7B' : '#6272A4'), label: d[0] + ' on ' + c + ': ' + (cur ? 'on' : 'off'),
            toggle: function () { var s = Object.assign({}, self.state.tsSet); var k = keyOf(d[0], c); s[k] = !curOf(d[0], c, d[2]); if (s[k] === baseOf(d[0], c, d[2])) { delete s[k]; } self.setState({ tsSet: s }); }
          };
        })
      };
    });

    // Fallback (read-only list; add and remove happen in the terminal)
    var fbData = { atlas: [['openrouter', 'anthropic/claude-sonnet-4', 'first fallback'], ['nous', 'Hermes-4-405B', 'second fallback']], scout: [['openrouter', 'anthropic/claude-haiku-5.5', 'first fallback']], scribe: [], herald: [['anthropic', 'claude-haiku-5-5', 'first fallback']], ledger: [] };
    var fbRows = (fbData[an] || []).map(function (f, i) { return { key: an + i, n: i + 1, provider: f[0], model: f[1], note: f[2] }; });

    // Backup (SFTP download to this computer)
    var bk = [['SOUL.md', 'who the agent is', 3, true], ['memories/MEMORY.md', 'agent notes', 1.4, true], ['memories/USER.md', 'what it knows about you', 0.9, true], ['profile.yaml', 'display name and description', 0.2, true], ['config.yaml', 'secrets blanked', 4, true], ['cron/jobs.json', 'scheduled jobs', 6, true], ['skills/', '41 skill folders', 380, true], ['state.db', 'every session and message, can be large', 186368, false]];
    var kb = function (v) { return v >= 1024 ? (v / 1024).toFixed(v >= 10240 ? 0 : 1) + ' MB' : (v < 10 ? v.toFixed(1) : Math.round(v)) + ' KB'; };
    var bkSel = bk.map(function (b) { var k = an + '|' + b[0]; return st.bkSel[k] != null ? st.bkSel[k] : b[3]; });
    var bkRows = bk.map(function (b, i) {
      var on = bkSel[i];
      return { key: b[0], label: b[0], hint: b[1], size: kb(b[2]), on: on, checked: on ? 'true' : 'false', toggle: function () { var s = Object.assign({}, self.state.bkSel); s[an + '|' + b[0]] = !on; self.setState({ bkSel: s }); } };
    });
    var bkTotalKb = bk.reduce(function (s, b, i) { return s + (bkSel[i] ? b[2] : 0); }, 0);

    // New profile wizard
    var np = st.np;
    var taken = ['atlas', 'scout', 'scribe', 'herald', 'ledger', 'default'];
    var nameOk = /^[a-z][a-z0-9-]{1,23}$/.test(np.name) && taken.indexOf(np.name) < 0;
    var nameMsg = !np.name ? '' : (taken.indexOf(np.name) > -1 ? 'A profile named ' + np.name + ' already exists.' : (!/^[a-z]/.test(np.name) ? 'Start with a lowercase letter.' : (np.name.length < 2 ? 'Use at least 2 characters.' : 'Use lowercase letters, numbers and hyphens only.')));
    var npCmd = 'hermes profile create ' + (np.name || '<name>') + (np.from !== 'none' ? ' --clone-from ' + np.from : '') + (np.desc ? ' --description "' + np.desc + '"' : '') + (np.noSkills ? ' --no-skills' : '');
    var patchNp = function (p) { self.setState({ np: Object.assign({}, self.state.np, p) }); };

    return {
      cfgMcp: tab === 'mcp', mcpRows: mcpRows,
      mcpAdd: function () { toTerminal('hermes -p ' + an + ' mcp add '); },
      mcpRemove: function () { toTerminal('hermes -p ' + an + ' mcp remove '); },
      cfgTools: tab === 'tools', tsCols: cols.map(function (c) { return { key: c, label: c }; }), tsRows: tsRows,
      tsHasPending: changes.length > 0, tsPendingTitle: changes.length + ' change' + (changes.length > 1 ? 's' : '') + ' to apply for ' + agent.name, tsCommands: changes.map(function (c) { return '$ ' + c; }).join('\n'),
      tsDiscard: function () { self.setState({ tsSet: {} }); },
      tsApply: function () {
        var applied = Object.assign({}, self.state.tsApplied);
        Object.keys(self.state.tsSet).forEach(function (k) { applied[k] = self.state.tsSet[k]; });
        self.setState({ tsApplied: applied, tsSet: {} });
        self.notify({ kind: 'ok', title: changes.length + ' toolset change' + (changes.length > 1 ? 's' : '') + ' applied', body: agent.name + ' · applies to new sessions' });
      },
      cfgFallback: tab === 'fallback', fbRows: fbRows, fbEmpty: fbRows.length === 0,
      fbAdd: function () { toTerminal('hermes -p ' + an + ' fallback add'); },
      fbRemove: function () { toTerminal('hermes -p ' + an + ' fallback remove'); },
      cfgBackup: tab === 'backup', bkRows: bkRows, bkCount: bkSel.filter(Boolean).length, bkTotal: kb(bkTotalKb),
      bkRun: function () { self.notify({ kind: 'ok', title: 'Backup saved', body: an + '-2026-10-11.zip · ' + bkSel.filter(Boolean).length + ' items · ' + kb(bkTotalKb) }); },
      startNewProfile: function () { self.setState({ cfgTab: 'new', reviewing: false }); },
      cfgNew: tab === 'new', npName: np.name, npDesc: np.desc, npNoSkills: np.noSkills ? 'true' : 'false', npNameBad: !!np.name && !nameOk, npNameMsg: nameMsg, npCmd: npCmd,
      onNpName: function (e) { patchNp({ name: e.target.value.toLowerCase().replace(/\s+/g, '-') }); },
      onNpDesc: function (e) { patchNp({ desc: e.target.value }); },
      onNpFrom: function (e) { patchNp({ from: e.target.value }); },
      npFromOpts: mk([['none', 'Empty profile'], ['atlas', 'Copy of atlas'], ['scout', 'Copy of scout'], ['scribe', 'Copy of scribe'], ['herald', 'Copy of herald']], np.from),
      toggleNpSkills: function () { patchNp({ noSkills: !np.noSkills }); },
      npCreate: function () {
        if (!nameOk) { self.notify({ kind: 'alert', title: 'Pick a valid name first', body: nameMsg || 'The profile needs a name.' }); return; }
        self.setState({ np: { name: '', desc: '', from: 'none', noSkills: false }, cfgTab: 'profile' });
        self.notify({ kind: 'ok', title: 'Profile created', body: '$ ' + npCmd });
      },
      npCancel: function () { self.setState({ cfgTab: 'profile' }); }
    };
  }
  // Review aid: open any screen with ?state=loading | empty | error to see that state. Real app: driven by actual data and connection state.
  demoState() {
    try { return new URLSearchParams(window.location.search).get('state') || ''; } catch (e) { return ''; }
  }
  // Agent and time-range filters are shared by Sessions, Usage and Logs (the real app keeps them in app.db).
  filterLoad() {
    try { return Object.assign({ agent: 'all', range: '7d' }, JSON.parse(window.localStorage.getItem('mc.filter') || '{}')); } catch (e) { return { agent: 'all', range: '7d' }; }
  }
  filterSave(patch) {
    var f = Object.assign(this.filterLoad(), patch);
    try { window.localStorage.setItem('mc.filter', JSON.stringify(f)); } catch (e) { /* ignore */ }
  }
  agentChips(selected, onPick) {
    var self = this;
    var list = [{ name: 'all', label: 'All agents', color: '#F8F8F2' }].concat(this.orderedAgents(this.baseAgents()));
    return list.map(function (a) {
      var on = selected === a.name;
      return { key: a.name, label: a.label, color: a.color, pressed: on ? 'true' : 'false', bg: on ? '#44475A' : 'transparent', border: on ? a.color : '#44475A', fg: on ? a.color : '#A9B2D3', pick: function () { onPick(a.name); } };
    });
  }
  openPalette() {
    this.setState({ palOpen: true, palQ: '', palSel: 0, setOpen: false, notifOpen: false });
    setTimeout(function () { var el = document.getElementById('pal-in'); if (el) { el.focus(); } }, 40);
  }
  palList() {
    // Everything the palette can reach. The real app builds this from local indexes (sessions, notes) plus the static screen list.
    var self = this;
    var go = function (href) { return function () { window.location.href = href; }; };
    var items = [];
    this.screens().forEach(function (s) {
      items.push({ key: 'go-' + s[1], kind: 'go to', chip: '#50FA7B', title: s[0], hint: s[2], run: go(s[1] + '.dc.html'), base: true });
    });
    this.baseAgents().forEach(function (a) {
      items.push({ key: 'chat-' + a.name, kind: 'chat', chip: a.color, title: 'Chat with ' + a.label, hint: a.status.toLowerCase(), run: go('Chat.dc.html'), base: true });
      items.push({ key: 'cfg-' + a.name, kind: 'agent', chip: a.color, title: a.label + ' settings: model, soul, memory', hint: a.model, run: function () { self.setState({ palOpen: false, setOpen: true, setTab: 'agents', cfgAgent: a.name, cfgTab: 'model' }); } });
    });
    [['Refactor the morning briefing prompt', 'atlas · 2h ago'], ['Why did inbox-triage fail delivery?', 'herald · 55m ago'], ['arXiv digest for cs.CL, week 41', 'scout · yesterday'], ['Draft: newsletter #18', 'scribe · yesterday']].forEach(function (s, i) {
      items.push({ key: 'sess-' + i, kind: 'session', chip: '#BD93F9', title: s[0], hint: s[1], run: go('Sessions.dc.html') });
    });
    [['Weekly review', 'notes/weekly'], ['Q4 roadmap', 'projects/roadmap'], ['Agent handoff protocol', 'ops/handoff']].forEach(function (s, i) {
      items.push({ key: 'note-' + i, kind: 'note', chip: '#FF79C6', title: s[0], hint: s[1], run: go('Brain.dc.html') });
    });
    items.push({ key: 'act-term', kind: 'action', chip: '#FFB86C', title: 'Toggle terminal', hint: 'Ctrl+`', run: function () { self.setState({ palOpen: false }); self.toggleTerm(); }, base: true });
    items.push({ key: 'act-set', kind: 'action', chip: '#FFB86C', title: 'Open settings', hint: '', run: function () { self.setState({ palOpen: false, setOpen: true }); }, base: true });
    items.push({ key: 'act-cron', kind: 'action', chip: '#FFB86C', title: 'Open cron jobs', hint: 'Dashboard', run: go('Main.dc.html?modal=cron'), base: true });
    items.push({ key: 'act-errors', kind: 'action', chip: '#FFB86C', title: 'Show errors from the last hour', hint: 'Logs', run: go('Logs.dc.html') });
    items.push({ key: 'act-cost', kind: 'action', chip: '#FFB86C', title: 'Show today’s cost by agent', hint: 'Usage', run: go('Usage.dc.html') });
    return items;
  }
  screens() {
    // Same order as the status bar menu; Ctrl+1 … Ctrl+0 follow it.
    return [['Dashboard', 'Main', 'Ctrl+1'], ['Chat', 'Chat', 'Ctrl+2'], ['Live feed', 'LiveFeed', 'Ctrl+3'], ['Sessions', 'Sessions', 'Ctrl+4'], ['Kanban', 'Kanban', 'Ctrl+5'], ['Usage', 'Usage', 'Ctrl+6'], ['Skills', 'Skills', 'Ctrl+7'], ['Logs, gateway, approvals', 'Logs', 'Ctrl+8'], ['Second brain', 'Brain', 'Ctrl+9'], ['Server', 'Server', 'Ctrl+0']];
  }
  palVisible() {
    var q = (this.state.palQ || '').trim().toLowerCase();
    var all = this.palList();
    if (!q) { return all.filter(function (i) { return i.base; }); }
    return all.filter(function (i) { return (i.title + ' ' + i.kind + ' ' + i.hint).toLowerCase().indexOf(q) > -1; });
  }
  sharedVals() {
    var self = this;
    var st = this.state;
    var S = st.settings;
    var row = function (r) {
      r.isToggle = r.type === 'toggle';
      r.isNum = r.type === 'num';
      r.isText = r.type === 'text';
      r.isSecret = r.type === 'secret';
      r.isSel = r.type === 'sel';
      r.isAlert = r.type === 'alert';
      r.isInfo = r.type === 'info';
      r.isActions = r.type === 'actions';
      if (r.key) {
        r.on = !!S[r.key];
        r.checked = S[r.key] ? 'true' : 'false';
        r.value = S[r.key];
        r.toggle = function () { self.setSetting(r.key, !self.state.settings[r.key]); };
        r.onInput = function (e) { self.setSetting(r.key, r.type === 'num' ? Number(e.target.value) : e.target.value); };
      }
      if (r.vkey) {
        r.v = S[r.vkey];
        r.onV = function (e) { self.setSetting(r.vkey, Number(e.target.value)); };
      }
      if (r.options) {
        r.opts = r.options.map(function (o) { return { v: o[0], label: o[1], sel: S[r.key] === o[0], unsel: S[r.key] !== o[0] }; });
        r.onSel = function (e) { self.setSetting(r.key, e.target.value); };
      }
      if (r.actions) {
        r.acts = r.actions.map(function (a) {
          return { label: a[0], primary: a[1] === 'primary', danger: a[1] === 'danger', plain: a[1] === 'plain', run: function () { self.notify({ kind: 'ok', title: a[0], body: a[2], force: !!a[3] }); } };
        });
      }
      r.rowKey = r.key || r.label;
      return r;
    };
    var tabs = {
      general: [
        { type: 'toggle', key: 'autostart', label: 'Start automatically when your computer starts', hint: 'Opens Mission Control when you sign in to Windows, macOS or Linux' },
        { type: 'toggle', key: 'startMin', label: 'Start minimized', hint: 'Open to the tray instead of a window' },
        { type: 'toggle', key: 'tray', label: 'Keep running in the tray when closed', hint: 'Monitoring and notifications continue in the background' },
        { type: 'toggle', key: 'updates', label: 'Check for updates automatically' },
        { type: 'sel', key: 'uiZoom', label: 'Text size', hint: 'Also adjustable with + and − in the status bar', options: [['0.8', '80%'], ['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.2', '120%'], ['1.3', '130%'], ['1.4', '140%']] },
        { type: 'toggle', key: 'reduceMotion', label: 'Reduce motion', hint: 'Turn off animations' }
      ],
      connection: [
        { type: 'info', label: 'SSH', text: 'root@203.0.113.42:22 · password in OS keychain · host key SHA256:Xq3v…9fA' },
        { type: 'toggle', key: 'autoConnect', label: 'Auto-connect when the app opens' },
        { type: 'toggle', key: 'reconnect', label: 'Reconnect automatically if the connection drops' },
        { type: 'num', key: 'poll', label: 'Refresh interval', unit: 's', min: 1, max: 10 },
        { type: 'actions', label: 'Connection', actions: [['Edit connection', 'primary', 'Opens the connection form'], ['Disconnect', 'plain', 'Disconnected from 203.0.113.42'], ['Forget', 'danger', 'Saved connection removed']] }
      ],
      notifications: [
        { type: 'toggle', key: 'nOs', label: 'Show desktop notifications over other apps', hint: 'Appears in the system notification area even when Mission Control is minimized or you are working in another app' },
        { type: 'toggle', key: 'nChat', label: 'Agent replies and new chat messages' },
        { type: 'toggle', key: 'nCron', label: 'Cron job failed or delivery failed' },
        { type: 'toggle', key: 'nGateway', label: 'Gateway stopped or an agent went offline' },
        { type: 'toggle', key: 'nKanban', label: 'Kanban handoffs between agents' },
        { type: 'toggle', key: 'nPreview', label: 'Show message preview in notifications' },
        { type: 'toggle', key: 'nSound', label: 'Play a sound' },
        { type: 'toggle', key: 'dnd', label: 'Do not disturb', hint: 'Silence notifications ' + S.dndFrom + '–' + S.dndTo },
        { type: 'actions', label: 'Test', actions: [['Send a test notification', 'primary', 'Desktop notifications are working', true]] }
      ],
      alerts: [
        { type: 'alert', key: 'aCpu', vkey: 'aCpuV', label: 'CPU usage above', unit: '%' },
        { type: 'alert', key: 'aMem', vkey: 'aMemV', label: 'Memory usage above', unit: '%' },
        { type: 'alert', key: 'aDisk', vkey: 'aDiskV', label: 'Any disk fuller than', unit: '%' },
        { type: 'alert', key: 'aLoad', vkey: 'aLoadV', label: 'Load average (1m) above', unit: '' },
        { type: 'alert', key: 'aCost', vkey: 'aCostV', label: 'Daily cost, all agents, above', unit: 'USD' },
        { type: 'num', key: 'aSustain', label: 'Only alert if it lasts at least', unit: 's', min: 5, max: 600 },
        { type: 'toggle', key: 'aGateway', label: 'Gateway is down' },
        { type: 'toggle', key: 'aOffline', label: 'An agent goes offline' },
        { type: 'toggle', key: 'aCronFail', label: 'A cron job fails' }
      ],
      workspace: [
        { type: 'text', key: 'vault', label: 'Second brain vault path (on the VPS)' },
        { type: 'num', key: 'vaultPoll', label: 'Vault check interval', unit: 's', min: 1, max: 60 },
        { type: 'text', key: 'uploads', label: 'Chat upload folder (on the VPS)' },
        { type: 'num', key: 'maxUpload', label: 'Max upload size', unit: 'MB', min: 1, max: 500 },
        { type: 'text', key: 'hermesHome', label: 'Hermes home' }
      ],
      data: [
        { type: 'actions', label: 'Layout', actions: [['Reset layout', 'plain', 'Panel sizes and order reset']] },
        { type: 'actions', label: 'Settings', actions: [['Export', 'plain', 'Settings exported to settings.json'], ['Import', 'plain', 'Choose a settings.json file']] },
        { type: 'actions', label: 'Local data', actions: [['Clear cache', 'danger', 'Local cache cleared']] }
      ],
      about: [
        { type: 'info', label: 'Hermes Agent Mission Control', text: 'v0.1.0 · Electron · Dracula' },
        { type: 'info', label: 'Hermes on VPS', text: 'v0.21.6 · 5 profiles · multiplex gateway' },
        { type: 'info', label: 'Storage', text: 'Settings, layout, agent order, display names and photos are stored locally in app.db' }
      ]
    };
    var tabDefs = [['general', 'General'], ['connection', 'Connection'], ['notifications', 'Notifications'], ['alerts', 'Alerts'], ['agents', 'Agents'], ['workspace', 'Workspace'], ['data', 'Data'], ['about', 'About']];
    var agents = this.orderedAgents(this.baseAgents()).map(function (a) {
      var look = self.agentLook(a.name, a.color);
      var d = self.dragFor(a.name);
      return Object.assign({}, a, look, d, {
        border: d.over ? '#50FA7B' : (a.name === st.cfgAgent ? '#6272A4' : '#44475A'),
        bg: a.name === st.cfgAgent ? '#44475A' : '#282A36',
        pick: function () { self.setState({ cfgAgent: a.name, reviewing: false }); },
        opacity: d.dragging ? 0.4 : 1,
        inputId: 'av-' + a.name,
        onPhoto: function (e) { self.setAvatar(a.name, e.target.files && e.target.files[0]); },
        removePhoto: function () { var av = Object.assign({}, self.state.avatars); delete av[a.name]; self.setState({ avatars: av }); self.saveKey('mc.avatars', av); }
      });
    });
    var online = this.baseAgents().filter(function (a) { return a.status !== 'PARKED'; }).length;
    var palItems = this.palVisible();
    var palSel = Math.max(0, Math.min(st.palSel, palItems.length - 1));
    return Object.assign({
      openPalette: function () { self.openPalette(); },
      closePalette: function () { self.setState({ palOpen: false }); },
      palOpen: st.palOpen,
      palQ: st.palQ,
      palEmpty: palItems.length === 0,
      palType: function (e) { self.setState({ palQ: e.target.value, palSel: 0 }); },
      palKey: function (e) {
        var n = self.palVisible().length;
        if (e.key === 'ArrowDown') { e.preventDefault(); self.setState({ palSel: n ? (self.state.palSel + 1) % n : 0 }); } else if (e.key === 'ArrowUp') { e.preventDefault(); self.setState({ palSel: n ? (self.state.palSel + n - 1) % n : 0 }); } else if (e.key === 'Enter') {
          var it = self.palVisible()[Math.min(self.state.palSel, n - 1)];
          if (it) { e.preventDefault(); it.run(); }
        }
      },
      palItems: palItems.map(function (it, i) {
        return { key: it.key, kind: it.kind, chipColor: it.chip, title: it.title, hint: it.hint, selected: i === palSel ? 'true' : 'false', run: it.run };
      }),
      termFg: st.termOpen ? '#50FA7B' : '#A9B2D3',
      rootClass: S.reduceMotion ? 'mc-nomotion' : '',
      uiZoom: parseFloat(S.uiZoom) || 1,
      zoomPct: Math.round((parseFloat(S.uiZoom) || 1) * 100) + '%',
      zoomOut: function () { var z = Math.max(0.7, Math.round(((parseFloat(self.state.settings.uiZoom) || 1) - 0.1) * 10) / 10); self.setSetting('uiZoom', String(z)); },
      zoomIn: function () { var z = Math.min(1.5, Math.round(((parseFloat(self.state.settings.uiZoom) || 1) + 0.1) * 10) / 10); self.setSetting('uiZoom', String(z)); },
      zoomReset: function () { self.setSetting('uiZoom', '1'); },
      fs: 12,
      sbOnline: online + '/5',
      sbUnread: st.unread,
      sbHasUnread: st.unread > 0,
      openSettings: function () { self.setState({ setOpen: true, notifOpen: false }); },
      openConnection: function () { self.setState({ setOpen: true, setTab: 'connection', notifOpen: false }); },
      closeSettings: function () { self.setState({ setOpen: false }); },
      stop: function (e) { e.stopPropagation(); },
      toggleNotifs: function () { self.setState({ notifOpen: !self.state.notifOpen, unread: 0 }); },
      clearNotifs: function () { self.setState({ notifs: [], notifOpen: false }); },
      setOpen: st.setOpen,
      notifOpen: st.notifOpen,
      notifs: st.notifs.map(function (n) { return Object.assign({ color: n.kind === 'alert' ? '#FF5555' : (n.kind === 'chat' ? '#8BE9FD' : '#50FA7B') }, n); }),
      noNotifs: st.notifs.length === 0,
      toasts: st.toasts.map(function (t) {
        return Object.assign({
          color: t.kind === 'alert' ? '#FF5555' : (t.kind === 'chat' ? '#8BE9FD' : '#50FA7B'),
          isChat: t.kind === 'chat', isAlert: t.kind === 'alert', isOk: t.kind !== 'chat' && t.kind !== 'alert',
          close: function () { self.setState({ toasts: self.state.toasts.filter(function (x) { return x.id !== t.id; }) }); }
        }, t);
      }),
      setTabs: tabDefs.map(function (t) {
        var on = st.setTab === t[0];
        return { label: t[1], bg: on ? '#44475A' : 'transparent', fg: on ? '#F8F8F2' : '#A9B2D3', current: on ? 'page' : 'false', pick: function () { self.setState({ setTab: t[0] }); } };
      }),
      setTab: st.setTab,
      setTitle: tabDefs.filter(function (t) { return t[0] === st.setTab; })[0][1],
      setIsAgents: st.setTab === 'agents',
      setRows: (tabs[st.setTab] || []).map(row),
      setAgents: agents,
      openAgentSettings: function () { self.setState({ setOpen: true, setTab: 'agents', notifOpen: false }); }
    }, this.agentCfgVals(), this.cfgExtraVals(), this.termVals());
  }
