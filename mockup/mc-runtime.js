/*
 * mc-runtime.js — tiny renderer so the mockup screens run as plain HTML files.
 * Understands the subset of the .dc.html format the mockups use:
 * {{path}} holes, <sc-for list as>, <sc-if value>, on<Event>="{{fn}}",
 * and `class Component extends DCLogic` with state / setState / renderVals.
 * Renders by diffing into the live DOM (keyed by data-key), so CSS enter
 * animations, focus and scroll positions survive re-renders.
 */
(function () {
  'use strict';

  var comp = null;
  var tpl = '';
  var root = null;
  var handlers = [];
  var pending = false;
  var mounted = false;

  function DCLogic(props) {
    this.props = props || {};
    this.state = this.state || {};
  }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, next);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function schedule() {
    if (pending) { return; }
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lookup(path, scope) {
    if (path == null) { return undefined; }
    path = path.trim();
    if (path === 'true') { return true; }
    if (path === 'false') { return false; }
    if (/^-?\d+(\.\d+)?$/.test(path)) { return Number(path); }
    var parts = path.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) { return undefined; }
      v = v[parts[i]];
    }
    return v;
  }

  function attr(s, name) {
    var m = new RegExp('\\b' + name + '="([^"]*)"').exec(s);
    return m ? m[1] : null;
  }

  function holePath(v) {
    var m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(v || '');
    return m ? m[1] : null;
  }

  function fill(chunk, scope) {
    chunk = chunk.replace(/\s(on[A-Z][A-Za-z]*)="\{\{\s*([^}]+?)\s*\}\}"/g, function (m, ev, path) {
      var fn = lookup(path, scope);
      if (typeof fn !== 'function') { return ''; }
      handlers.push(fn);
      return ' data-mc-' + ev.slice(2).toLowerCase() + '="' + (handlers.length - 1) + '"';
    });
    chunk = chunk.replace(/\shint-[a-z-]+="[^"]*"/g, '');
    return chunk.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (m, path) {
      var v = lookup(path, scope);
      return v == null ? '' : esc(v);
    });
  }

  function findClose(t, tag, from) {
    var depth = 1;
    var re = new RegExp('<sc-' + tag + '\\b[^>]*>|</sc-' + tag + '>', 'g');
    re.lastIndex = from;
    var m;
    while ((m = re.exec(t))) {
      if (m[0].charAt(1) === '/') {
        depth--;
        if (!depth) { return { start: m.index, end: re.lastIndex }; }
      } else {
        depth++;
      }
    }
    throw new Error('unclosed <sc-' + tag + '>');
  }

  function renderStr(t, scope) {
    var out = '';
    var pos = 0;
    var re = /<sc-(for|if)\b([^>]*)>/g;
    var m;
    while ((m = re.exec(t))) {
      out += fill(t.slice(pos, m.index), scope);
      var tag = m[1];
      var close = findClose(t, tag, re.lastIndex);
      var inner = t.slice(re.lastIndex, close.start);
      if (tag === 'if') {
        if (lookup(holePath(attr(m[2], 'value')), scope)) { out += renderStr(inner, scope); }
      } else {
        var list = lookup(holePath(attr(m[2], 'list')), scope) || [];
        var as = attr(m[2], 'as') || 'item';
        for (var i = 0; i < list.length; i++) {
          var s = Object.create(scope);
          s[as] = list[i];
          s.$index = i;
          out += renderStr(inner, s);
        }
      }
      pos = close.end;
      re.lastIndex = close.end;
    }
    return out + fill(t.slice(pos), scope);
  }

  // ---- DOM diffing -------------------------------------------------------
  function keyOf(n) { return n.nodeType === 1 ? n.getAttribute('data-key') : null; }

  function sameType(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
  }

  function syncAttrs(f, t) {
    var i, a;
    for (i = f.attributes.length - 1; i >= 0; i--) {
      a = f.attributes[i].name;
      if (!t.hasAttribute(a)) { f.removeAttribute(a); }
    }
    for (i = 0; i < t.attributes.length; i++) {
      a = t.attributes[i];
      if (f.getAttribute(a.name) !== a.value) { f.setAttribute(a.name, a.value); }
    }
    if ((f.tagName === 'TEXTAREA' || f.tagName === 'INPUT') && f.type !== 'file') {
      if (f.type === 'checkbox' || f.type === 'radio') {
        var c = t.hasAttribute('checked');
        if (f.checked !== c) { f.checked = c; }
      } else if (t.hasAttribute('value') && f !== document.activeElement && f.value !== t.getAttribute('value')) {
        f.value = t.getAttribute('value');
      }
    }
  }

  function patch(f, t) {
    if (f.nodeType !== 1) {
      if (f.nodeValue !== t.nodeValue) { f.nodeValue = t.nodeValue; }
      return;
    }
    syncAttrs(f, t);
    morphChildren(f, t);
  }

  function morphChildren(from, to) {
    var tKids = Array.prototype.slice.call(to.childNodes);
    var keyed = {};
    Array.prototype.forEach.call(from.childNodes, function (n) {
      var k = keyOf(n);
      if (k) { keyed[k] = n; }
    });
    var cursor = from.firstChild;
    for (var i = 0; i < tKids.length; i++) {
      var t = tKids[i];
      var tk = keyOf(t);
      var match = null;
      if (tk) {
        if (keyed[tk] && sameType(keyed[tk], t)) { match = keyed[tk]; delete keyed[tk]; }
      } else if (cursor && !keyOf(cursor) && sameType(cursor, t)) {
        match = cursor;
      }
      if (match) {
        if (match === cursor) { cursor = cursor.nextSibling; } else { from.insertBefore(match, cursor); }
        patch(match, t);
      } else {
        from.insertBefore(t.cloneNode(true), cursor);
      }
    }
    while (cursor) {
      var nx = cursor.nextSibling;
      from.removeChild(cursor);
      cursor = nx;
    }
    Object.keys(keyed).forEach(function (k) {
      if (keyed[k].parentNode === from) { from.removeChild(keyed[k]); }
    });
  }

  function render() {
    handlers = [];
    var holder = document.createElement('div');
    holder.innerHTML = renderStr(tpl, comp.renderVals());
    morphChildren(root, holder);
    Array.prototype.forEach.call(root.querySelectorAll('textarea[value]'), function (el) {
      if (el !== document.activeElement && el.value !== el.getAttribute('value')) { el.value = el.getAttribute('value'); }
    });
    if (mounted && typeof comp.componentDidUpdate === 'function') { comp.componentDidUpdate(); }
  }

  function isTextField(el) {
    return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['file', 'checkbox', 'radio', 'range'].indexOf(el.type) === -1);
  }

  ['click', 'change', 'input', 'pointerdown', 'keydown', 'dragstart', 'dragover', 'drop', 'dragend', 'wheel', 'mouseover', 'mouseout'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var key = type === 'input' ? 'change' : type;
      var el = e.target.closest && e.target.closest('[data-mc-' + key + ']');
      if (!el) { return; }
      if (type === 'change' && (isTextField(el) || el.type === 'range')) { return; }
      if (type === 'input' && !isTextField(el) && el.type !== 'range') { return; }
      var fn = handlers[+el.getAttribute('data-mc-' + key)];
      if (fn) { fn(e); }
    }, type === 'wheel' ? { passive: false } : false);
  });

  document.addEventListener('DOMContentLoaded', function () {
    root = document.getElementById('mc-root');
    tpl = document.getElementById('mc-template').textContent;
    var code = document.getElementById('mc-logic').textContent;
    var Component = new Function('DCLogic', code + '\n;return Component;')(DCLogic);
    comp = new Component({});
    if (!comp.state) { comp.state = {}; }
    render();
    mounted = true;
    if (typeof comp.componentDidMount === 'function') { comp.componentDidMount(); }
  });
})();
