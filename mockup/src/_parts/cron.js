  // ---- part: cron jobs (dashboard modal; the Cron menu was folded into it) ----
  cronRunLines(j, k) {
    var movers = ['ACME +6.1%, GLOB −5.4%, ZETA +7.8%', 'ACME +5.3%', 'GLOB −6.2%, NOVA +5.1%', 'none above 5%', 'ZETA +9.4%', 'NOVA −5.6%'];
    if (j.id === 'j1') { return ['Movers noted: ' + movers[k % movers.length], 'Feeds checked: 24, errors: ' + (k === 3 ? 1 : 0), 'Saved to cron/output/market-scan']; }
    if (j.id === 'j4') {
      if (k < 3) { return ['Summary generated (6 threads).', 'delivery_failed: telegram 403 Forbidden, bot was kicked from the group chat']; }
      return ['Archived ' + (31 + k) + ' newsletters.', 'Summary delivered to telegram (' + (4 + k) + ' threads).'];
    }
    if (j.id === 'j2') { return k === 0 ? ['in progress: 2 notes written so far'] : ['Wrote ' + (3 + k) + ' vault notes from cs.CL and cs.LG', 'Linked ' + (2 + k) + ' related notes']; }
    return [j.output, 'Run ' + (k + 1) + ' of the last 6'];
  }
  cronVals() {
    var self = this;
    var st = this.state;
    var pz = st.cronPz || {}, sched = st.cronSched || {}, acked = st.cronAcked || {}, extra = st.cronExtra || {}, runPick = st.cronRunPick || {};
    var colors = { atlas: '#50FA7B', scout: '#FFB86C', scribe: '#8BE9FD', herald: '#FF79C6', ledger: '#8B95BD' };
    var statusColors = { ok: '#50FA7B', error: '#FF5555', delivery_failed: '#FF5555', running: '#8BE9FD' };
    var base = [
      { id: 'j1', agent: 'scout', name: 'market-scan', schedule: 'every 30m', expr: '*/30 * * * *', next: 'in 12m 40s', last: '17m ago', status: 'ok', state: 'scheduled', deliver: 'local', model: 'claude-sonnet-5.5', skills: 'research/market', repeat: '∞ · 1,204 done', prompt: 'Scan the watchlist feeds and note anything that moved more than 5% since the last run.', output: '3 movers noted → cron/output/market-scan/20261010_2025.md', first: 12, every: 30 },
      { id: 'j2', agent: 'scout', name: 'arxiv-watch', schedule: 'every 6h', expr: '0 */6 * * *', next: 'running', last: 'now', status: 'running', state: 'running', deliver: 'origin', model: 'claude-sonnet-5.5', skills: 'research/arxiv, note-taking/obsidian', repeat: '∞ · 88 done', prompt: 'Check new arXiv papers in cs.CL and cs.LG, write a vault note for each relevant one and link related notes.', output: 'In progress: 2 notes written so far.', first: 0, every: 360, running: true },
      { id: 'j3', agent: 'atlas', name: 'morning-briefing', schedule: 'every day at 07:00', expr: '0 7 * * *', next: 'in 10h 18m', last: '13h ago', status: 'ok', state: 'scheduled', deliver: 'telegram:-1001…', model: 'claude-opus-5.5', skills: 'productivity/briefing', repeat: '∞ · 41 done', prompt: 'Send me a short morning briefing: calendar, overnight alerts, and the top 3 things to do today.', output: 'Delivered to telegram at 07:00:04.', first: 618, every: 1440 },
      { id: 'j4', agent: 'herald', name: 'inbox-triage', schedule: 'every 2h', expr: '0 */2 * * *', next: 'in 1h 05m', last: '55m ago', status: 'delivery_failed', state: 'scheduled', deliver: 'telegram:-1002…', model: 'claude-haiku-5.5', skills: 'email/triage', repeat: '∞ · 310 done', prompt: 'Triage the inbox: label, archive newsletters, and summarise anything that needs a reply.', error: 'delivery_failed: telegram 403 Forbidden — bot was kicked from the group chat', output: 'Summary generated (6 threads) but could not be delivered.', first: 65, every: 120 },
      { id: 'j5', agent: 'herald', name: 'uptime-report', schedule: 'every 4h', expr: '0 */4 * * *', next: 'in 1h 18m', last: '2h 42m ago', status: 'ok', state: 'scheduled', deliver: 'telegram:-1002…', model: 'claude-haiku-5.5', skills: 'devops/uptime', repeat: '∞ · 152 done', prompt: 'Check uptime of the monitored endpoints and report only if something is degraded.', output: 'All 12 endpoints healthy; nothing sent.', first: 78, every: 240 },
      { id: 'j6', agent: 'atlas', name: 'vault-gardening', schedule: 'every day at 03:30', expr: '30 3 * * *', next: 'in 6h 48m', last: '17h ago', status: 'ok', state: 'scheduled', deliver: 'local', model: 'claude-opus-5.5', skills: 'note-taking/obsidian', repeat: '∞ · 29 done', prompt: 'Find orphan notes and broken [[links]] in the vault and fix what you can.', output: 'Fixed 4 broken links, linked 2 orphans.', first: 408, every: 1440 },
      { id: 'j7', agent: 'scribe', name: 'draft-newsletter', schedule: 'every day at 12:00', expr: '0 12 * * *', next: 'in 15h 18m', last: '8h ago', status: 'ok', state: 'scheduled', deliver: 'discord:#drafts', model: 'hermes-4-405b', skills: 'writing/newsletter', repeat: '∞ · 18 done', prompt: 'Draft the daily newsletter from yesterday’s vault notes tagged #publish.', output: 'Draft posted to #drafts (742 words).', first: 918, every: 1440 },
      { id: 'j8', agent: 'scribe', name: 'weekly-digest', schedule: 'Mon at 09:00', expr: '0 9 * * 1', next: 'in 2d 12h', last: '4d ago', status: 'ok', state: 'scheduled', deliver: 'discord:#digest', model: 'hermes-4-405b', skills: 'writing/digest', repeat: '∞ · 6 done', prompt: 'Write the weekly digest of agent work across all profiles.', output: 'Posted to #digest.', first: 99999, every: 99999 },
      { id: 'j9', agent: 'ledger', name: 'invoice-check', schedule: 'every day at 18:00', expr: '0 18 * * *', next: '—', last: '3d ago', status: 'ok', state: 'paused', deliver: 'local', model: 'claude-sonnet-5.5', skills: 'finance/invoices', repeat: '∞ · 12 done', prompt: 'Check for unpaid invoices older than 14 days and list them.', output: 'Paused by user.', first: 1278, every: 1440, paused: true }
    ];
    var jobs = base.map(function (j) {
      var o = Object.assign({}, j);
      if (pz[j.id] != null) { o.paused = pz[j.id]; o.state = o.paused ? 'paused' : 'scheduled'; o.next = o.paused ? '—' : (j.next === '—' ? 'in 4h 12m' : j.next); o.output = o.paused ? 'Paused by user.' : j.output; }
      if (sched[j.id]) { o.schedule = sched[j.id]; }
      if (st.cronRunning === j.id) { o.status = 'running'; o.state = 'running'; o.next = 'running'; o.last = 'now'; o.running = true; }
      return o;
    });
    var selId = st.cronSel || 'j4';
    var sel = jobs.filter(function (j) { return j.id === selId; })[0];
    var per = { j1: 30, j2: 360, j3: 1440, j4: 120, j5: 240, j6: 1440, j7: 1440, j8: 10080, j9: 1440 };
    var lastMin = { j1: 17, j2: 0, j3: 780, j4: 55, j5: 162, j6: 1020, j7: 480, j8: 5760, j9: 4320 };
    var ago = function (m) { return m <= 0 ? 'now' : (m < 60 ? m + 'm ago' : (m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago')); };
    var rawRuns = [];
    for (var k = 0; k < 6; k++) {
      rawRuns.push({ k: k, when: ago(lastMin[sel.id] + k * per[sel.id]), status: sel.id === 'j4' && k < 3 ? 'delivery_failed' : (sel.id === 'j2' && k === 0 ? 'running' : 'ok'), dur: sel.id === 'j8' ? '2m 40s' : (sel.id === 'j2' ? '6m 10s' : (40 + k * 7) + 's'), trigger: sel.id === 'j3' && k === 1 ? 'manual' : 'scheduled', lines: this.cronRunLines(sel, k) });
    }
    if (extra[sel.id]) { rawRuns.unshift({ k: -1, when: 'just now', status: 'ok', dur: '51s', trigger: 'manual', lines: this.cronRunLines(sel, 4) }); }
    var pickIdx = Math.min(runPick[sel.id] || 0, rawRuns.length - 1);
    var runSelRaw = rawRuns[pickIdx];
    var prevRaw = rawRuns[pickIdx + 1];
    var outLines = [];
    runSelRaw.lines.forEach(function (l, i) { var isNew = prevRaw && prevRaw.lines.indexOf(l) < 0; outLines.push({ key: 'n' + i, sign: isNew ? '+' : ' ', t: l, bg: isNew ? '#24382d' : 'transparent', fg: isNew ? '#50FA7B' : '#F8F8F2' }); });
    if (prevRaw) { prevRaw.lines.forEach(function (l, i) { if (runSelRaw.lines.indexOf(l) < 0) { outLines.push({ key: 'o' + i, sign: '−', t: l, bg: '#3a2530', fg: '#FF5555' }); } }); }
    var runColor = { ok: '#50FA7B', delivery_failed: '#FF5555', running: '#8BE9FD' };
    var ask = st.cronAsk;
    var ref = 'hermes -p ' + sel.agent + ' cron';
    var A = {
      pause: [sel.paused ? 'Resume “' + sel.name + '”?' : 'Pause “' + sel.name + '”?', sel.paused ? 'It goes back on the schedule and runs at its next due time.' : 'It stops running until you resume it. Runs already in progress finish normally.', ref + (sel.paused ? ' resume ' : ' pause ') + sel.name, sel.paused ? 'Resume job' : 'Pause job', '#6272A4'],
      run: ['Run “' + sel.name + '” now?', 'One extra run with the job’s own prompt, model and delivery target. It uses tokens and may send a message. The regular schedule does not change.', ref + ' run ' + sel.name, 'Run job', '#FFB86C'],
      edit: ['Change the schedule of “' + sel.name + '”', 'Takes effect at the next scheduler tick, which runs every 60 seconds.', ref + ' edit ' + sel.name + ' --schedule "' + (st.cronDraft || sel.schedule) + '"', 'Save schedule', '#6272A4'],
      ack: ['Acknowledge this incident?', 'Marks it as seen. It does not fix the delivery target, and it closes by itself after the next good run.', ref + ' incidents ack ' + sel.id, 'Acknowledge', '#6272A4']
    };
    var av = ask && A[ask] ? A[ask] : ['', '', '', '', '#44475A'];
    var decorate = function (j) {
      return Object.assign({}, j, {
        color: colors[j.agent],
        agentLabel: self.displayName(j.agent),
        statusColor: statusColors[j.status],
        stateColor: j.state === 'paused' ? '#8B95BD' : (j.state === 'running' ? '#8BE9FD' : '#A9B2D3'),
        nextColor: j.next === 'running' ? '#8BE9FD' : (j.next.indexOf('m ') > -1 && j.next.indexOf('h') === -1 ? '#FFB86C' : '#F8F8F2'),
        bg: j.id === selId ? '#44475A' : 'transparent',
        pick: function () { self.setState({ cronSel: j.id, cronAsk: null }); }
      });
    };
    return {
      cronCnt: { total: jobs.length, running: jobs.filter(function (j) { return j.status === 'running'; }).length, err: jobs.filter(function (j) { return j.status !== 'ok' && j.status !== 'running'; }).length, paused: jobs.filter(function (j) { return j.paused; }).length },
      cronLanes: ['atlas', 'scout', 'scribe', 'herald', 'ledger'].map(function (a) {
        var marks = [];
        jobs.filter(function (j) { return j.agent === a; }).forEach(function (j) {
          for (var t = j.first; t <= 1440; t += j.every) {
            marks.push({ left: (t / 1440 * 100).toFixed(2), w: j.running && t === 0 ? 4 : 6, bg: j.paused ? 'transparent' : colors[a], title: j.name });
            if (marks.length > 80) { break; }
          }
        });
        return { agent: a, label: self.displayName(a), color: colors[a], marks: marks };
      }),
      cronJobs: jobs.map(decorate),
      cronJob: Object.assign(decorate(sel), {
        hasError: !!sel.error, isPaused: !!sel.paused, isActive: !sel.paused, pauseLabel: sel.paused ? 'Resume' : 'Pause',
        incident: sel.status === 'delivery_failed' && !acked[sel.id], acked: sel.status === 'delivery_failed' && !!acked[sel.id], streak: 3
      }),
      cronRuns: rawRuns.map(function (r, i) {
        return { key: sel.id + 'r' + r.k, when: r.when, status: r.status, color: runColor[r.status], dur: r.dur, trigger: r.trigger, selected: i === pickIdx ? 'true' : 'false', bg: i === pickIdx ? '#44475A' : 'transparent', pick: function () { var p = Object.assign({}, self.state.cronRunPick); p[sel.id] = i; self.setState({ cronRunPick: p }); } };
      }),
      cronOut: { when: runSelRaw.when, note: prevRaw ? 'changes compared with the run before' : 'oldest run shown', lines: outLines },
      cronAskV: { open: !!ask && !!A[ask], isEdit: ask === 'edit', title: av[0], body: av[1], cmd: av[2], label: av[3], color: av[4] },
      cronDraft: st.cronDraft || sel.schedule,
      cronOnDraft: function (e) { self.setState({ cronDraft: e.target.value }); },
      cronAskPause: function () { self.setState({ cronAsk: 'pause' }); },
      cronAskRun: function () { self.setState({ cronAsk: 'run' }); },
      cronAskEdit: function () { self.setState({ cronAsk: 'edit', cronDraft: sel.schedule }); },
      cronAskAck: function () { self.setState({ cronAsk: 'ack' }); },
      cronCancel: function () { self.setState({ cronAsk: null }); },
      cronConfirm: function () {
        var id = sel.id;
        var s2 = self.state;
        if (ask === 'pause') { var p = Object.assign({}, s2.cronPz); p[id] = !sel.paused; self.setState({ cronPz: p, cronAsk: null }); } else if (ask === 'run') {
          var x = Object.assign({}, s2.cronExtra); x[id] = true;
          self.setState({ cronRunning: id, cronExtra: x, cronAsk: null });
          setTimeout(function () { self.setState({ cronRunning: null }); }, 2200);
        } else if (ask === 'edit') { var sc = Object.assign({}, s2.cronSched); sc[id] = s2.cronDraft || sel.schedule; self.setState({ cronSched: sc, cronAsk: null }); } else if (ask === 'ack') { var a = Object.assign({}, s2.cronAcked); a[id] = true; self.setState({ cronAcked: a, cronAsk: null }); }
        self.notify({ kind: 'ok', title: av[3] + ': done', body: av[2] });
      }
    };
  }
