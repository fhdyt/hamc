  // ---- part: live feed (Live feed screen + dashboard activity modal) ----
  feedVals() {
    var self = this;
    var st = this.state;
    var agentsOff = st.feedAgentsOff || {};
    var typesOff = st.feedTypesOff || {};
    var q = (st.feedQuery || '').toLowerCase();
    var colors = { atlas: '#50FA7B', scout: '#FFB86C', scribe: '#8BE9FD', herald: '#FF79C6' };
    var kinds = {
      user: { label: 'USER', labelColor: '#F8F8F2', textColor: '#F8F8F2' },
      think: { label: 'THINK', labelColor: '#8BE9FD' },
      tool: { label: 'TOOL', labelColor: '#FFB86C' },
      result: { label: 'RESULT', labelColor: '#A9B2D3', textColor: '#A9B2D3' },
      blocked: { label: 'BLOCKED', labelColor: '#FF5555', textColor: '#FF5555' },
      reply: { label: 'REPLY', labelColor: '#50FA7B', textColor: '#F8F8F2' }
    };
    var raw = [
      ['20:40:58', 'atlas', 'telegram', 'user', 'what changed in hermes this week? short list pls'],
      ['20:41:01', 'atlas', 'telegram', 'think', 'User wants a short changelog. Latest tag should be v0.21.6 (Oct 8). Check the releases page instead of relying on memory, then summarise in five bullets or fewer.'],
      ['20:41:02', 'atlas', 'telegram', 'tool', 'web_search {"q": "NousResearch hermes-agent releases"}'],
      ['20:41:02', 'scout', 'cron', 'think', 'Abstract 2 overlaps with last week’s note on speculative decoding; link it instead of writing a duplicate.'],
      ['20:41:04', 'atlas', 'telegram', 'result', '1.8s · 4,120 chars — "Release v0.21.6 · NousResearch/hermes-agent · Oct 8 …"'],
      ['20:41:05', 'atlas', 'telegram', 'think', 'Notes mention multiplex fixes and a cron fire-claim fix. Fetch the release page for specifics.'],
      ['20:41:06', 'atlas', 'telegram', 'tool', 'web_extract {"url": "github.com/NousResearch/hermes-agent/releases/tag/v0.21.6"}'],
      ['20:41:07', 'scout', 'cron', 'tool', 'write_file {"path": "~/vault/research/Speculative Decoding.md"}'],
      ['20:41:07', 'scout', 'cron', 'result', '0.1s · ok, 2,310 bytes'],
      ['20:41:09', 'herald', 'cron', 'tool', 'terminal {"cmd": "rm -rf ~/tmp/mail-cache"}'],
      ['20:41:09', 'herald', 'cron', 'blocked', 'approvals.single_query_mode = deny; the agent will try another path'],
      ['20:41:12', 'atlas', 'telegram', 'reply', 'Hermes v0.21.6 (Oct 8):\n• multiplex gateway fixes\n• cron fire-claim race fixed\n• dashboard opens state.db read-only first']
    ];
    var typeKey = { user: 'user', think: 'thinking', tool: 'tools', result: 'results', blocked: 'tools', reply: 'replies' };
    var items = raw.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
      var r = x.r;
      return !agentsOff[r[1]] && !typesOff[typeKey[r[3]]] && (!q || r[4].toLowerCase().indexOf(q) > -1 || r[1].indexOf(q) > -1);
    }).sort(function (a, b) { return a.r[0] < b.r[0] ? 1 : (a.r[0] > b.r[0] ? -1 : b.i - a.i); }).map(function (x) {
      var r = x.r;
      var k = kinds[r[3]];
      var isThink = r[3] === 'think';
      var isCode = r[3] === 'tool';
      return { key: 'fd' + x.i, t: r[0], agentLabel: self.displayName(r[1]), color: colors[r[1]], src: r[2], label: k.label, labelColor: k.labelColor, textColor: k.textColor || '#F8F8F2', text: r[4], isThink: isThink, isCode: isCode, isPlain: !isThink && !isCode };
    });
    return {
      feedItems: items,
      feedCount: items.length,
      feedTyping: self.displayName('atlas'),
      feedQuery: st.feedQuery || '',
      feedSearch: function (e) { self.setState({ feedQuery: e.target.value }); },
      feedAgentChips: ['atlas', 'scout', 'scribe', 'herald'].map(function (a) {
        var off = !!agentsOff[a];
        return { label: self.displayName(a), pressed: off ? 'false' : 'true', dot: off ? '#6272A4' : colors[a], border: off ? '#44475A' : colors[a], borderStyle: off ? 'dashed' : 'solid', fg: off ? '#8B95BD' : colors[a], deco: off ? 'line-through' : 'none', toggle: function () { var m = Object.assign({}, self.state.feedAgentsOff || {}); m[a] = !off; self.setState({ feedAgentsOff: m }); } };
      }),
      feedTypeChips: ['user', 'thinking', 'tools', 'results', 'replies'].map(function (t) {
        var off = !!typesOff[t];
        return { name: t, pressed: off ? 'false' : 'true', bg: off ? 'transparent' : '#44475A', border: off ? '#44475A' : '#6272A4', borderStyle: off ? 'dashed' : 'solid', fg: off ? '#8B95BD' : '#F8F8F2', toggle: function () { var m = Object.assign({}, self.state.feedTypesOff || {}); m[t] = !off; self.setState({ feedTypesOff: m }); } };
      })
    };
  }
