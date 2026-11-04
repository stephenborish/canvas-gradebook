/* Canvas Gradebook+ - "Class list" on a Studio video's Insights.
 *
 * Studio's Insights tab lists the people who watched a video. Teachers also
 * need the ones who didn't. When Studio's page loads a video's viewers
 * (studio/page-watch.js passes a copy along), this shows a "Class list"
 * button in the corner of Studio; it opens every student in the course,
 * alphabetically, marked Watched / Partly watched / Not watched with how
 * much of the video each one saw, plus the class's "which parts were
 * watched" line when Studio sent one.
 *
 * The roster comes from the Canvas page Studio is open in
 * (studio/canvas-relay.js), read with the teacher's own Canvas session;
 * outside Canvas, only Studio's own viewers can be listed. Everything is
 * held in memory for as long as the page is open. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.studioPanelStarted) return;
  CGP.studioPanelStarted = true;
  var SC = function () { return CGP.studioClass; };

  var WATCH = 'cgp-studio-watch';
  var RELAY = 'cgp-canvas-relay';
  var ASK = 'cgp-studio-ask';
  var ROSTER_WAIT_MS = 12000;

  var state = {
    perspectives: Object.create(null),   // uuid -> {name, courseId}
    users: Object.create(null),          // uuid -> viewers
    overview: Object.create(null),       // uuid -> overview
    current: null,                       // uuid of the embed on screen
    rosters: Object.create(null),        // course name -> {status, students, courseName, error}
    open: false,
    filter: 'all'
  };
  var host = null, shadow = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function canvasOrigin() {
    var a = location.ancestorOrigins;
    if (!a || !a.length) return null;
    var top = a[a.length - 1];
    return /^https:\/\/[^/]+$/.test(top) ? top : null;
  }

  /* ------------------------------------------------- what Studio loaded */

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (e.source === window && d.source === WATCH) { onStudio(d); return; }
    if (d.source === RELAY && e.origin === canvasOrigin()) onRoster(d);
  });

  function onStudio(d) {
    if (!SC()) return;
    if (d.kind === 'perspectives') {
      SC().perspectivesFrom(d.data).forEach(function (p) { state.perspectives[p.uuid] = p; });
    } else if (d.kind === 'users') {
      state.users[d.key] = SC().viewersFrom(d.data);
      state.current = d.key;
    } else if (d.kind === 'overview') {
      state.overview[d.key] = SC().overviewFrom(d.data);
    } else return;
    ensureHost();
    askRoster();
    render();
  }

  /* The course of the embed on screen: from the video's embed list, or what
   * Studio's own "Select Embed" box shows. */
  function courseName() {
    var p = state.current && state.perspectives[state.current];
    if (p && p.name) return p.name;
    var labels = document.querySelectorAll('label, span, div, h2, h3, h4, legend, p');
    for (var i = 0; i < labels.length; i++) {
      var el = labels[i];
      if (el.childElementCount > 1 || !/^\s*select embed\s*$/i.test(el.textContent || '')) continue;
      var box = el;
      for (var up = 0; up < 4 && box; up++) {
        box = box.parentElement;
        if (!box) break;
        var field = box.querySelector('input[value], select, [role="combobox"], button[aria-haspopup]');
        if (field) {
          var v = field.value || field.getAttribute('value') || field.textContent || '';
          v = String(v).replace(/\s+/g, ' ').trim();
          if (v && !/^select embed$/i.test(v)) return v;
        }
      }
    }
    return '';
  }

  function videoTitle() {
    var h = document.querySelector('h1');
    return h ? String(h.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /* -------------------------------------------- the roster, from Canvas */

  var asks = 0;
  function askRoster() {
    var name = courseName();
    var key = name || '?';
    if (state.rosters[key]) return;
    var origin = canvasOrigin();
    if (!origin) { state.rosters[key] = { status: 'none' }; return; }
    var id = 'r' + (++asks) + '-' + Date.now();
    var p = state.current && state.perspectives[state.current];
    state.rosters[key] = { status: 'loading', id: id };
    try {
      window.top.postMessage({ source: ASK, type: 'roster', id: id, courseName: name, courseId: p && p.courseId }, origin);
    } catch (e) { state.rosters[key] = { status: 'none' }; return; }
    setTimeout(function () {
      if (state.rosters[key] && state.rosters[key].id === id && state.rosters[key].status === 'loading') {
        state.rosters[key] = { status: 'none' };
        render();
      }
    }, ROSTER_WAIT_MS);
  }

  function onRoster(d) {
    Object.keys(state.rosters).forEach(function (k) {
      var r = state.rosters[k];
      if (!r || r.id !== d.id) return;
      state.rosters[k] = d.ok
        ? { status: 'ok', id: d.id, students: d.students || [], courseName: d.courseName || '' }
        : { status: 'error', id: d.id, error: d.error || 'Canvas didn’t give the class list' };
    });
    render();
  }

  /* -------------------------------------------------------------- view */

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{font:14px/1.4 "Lato","Helvetica Neue",Helvetica,Arial,sans-serif;color:#273540}',
    '.launch{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:9px 14px;border:0;border-radius:999px;background:#0374B5;color:#fff;font:600 13px/1 inherit;font-family:inherit;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}',
    '.launch:hover{background:#025a8c}.launch:focus-visible{outline:3px solid #9fd0f0;outline-offset:2px}',
    '.launch b{background:rgba(255,255,255,.22);border-radius:999px;padding:3px 7px;font-weight:700}',
    '.back{position:fixed;inset:0;z-index:2147483001;background:rgba(15,25,35,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}',
    '.panel{width:min(760px,100%);background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden}',
    '.head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid #e3e7ea}',
    '.head h2{margin:0;font-size:18px;font-weight:700;color:#1b2730}',
    '.head .sub{margin-top:2px;font-size:12.5px;color:#6b7780}',
    '.x{margin-left:auto;border:0;background:none;font-size:22px;line-height:1;color:#6b7780;cursor:pointer;padding:2px 6px;border-radius:6px}',
    '.x:hover{background:#f1f3f4}',
    '.body{padding:14px 18px 18px}',
    '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px}',
    '.tile{border:1px solid #e3e7ea;border-radius:10px;padding:9px 11px}',
    '.tile .k{font-size:11.5px;color:#6b7780}.tile .v{font-size:22px;font-weight:700;margin-top:2px}',
    '.tile--none .v{color:#c23c2f}.tile--partial .v{color:#b07b00}.tile--watched .v{color:#0b7a3e}',
    '.card{border:1px solid #e3e7ea;border-radius:10px;padding:10px 12px;margin-bottom:12px}',
    '.card h3{margin:0 0 6px;font-size:13px;font-weight:700}',
    '.note{font-size:12px;color:#6b7780;margin:6px 0 0}',
    '.warn{background:#fdf5e1;border:1px solid #f0dca8;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-bottom:12px}',
    '.bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px}',
    '.chip{border:1px solid #c7cdd1;background:#fff;border-radius:999px;padding:5px 11px;font:600 12.5px/1 inherit;font-family:inherit;color:#273540;cursor:pointer}',
    '.chip b{color:#6b7780;margin-left:3px}',
    '.chip[aria-pressed="true"]{background:#0374B5;border-color:#0374B5;color:#fff}.chip[aria-pressed="true"] b{color:rgba(255,255,255,.85)}',
    '.copy{margin-left:auto;border:1px solid #0374B5;background:#fff;color:#0374B5;border-radius:6px;padding:6px 10px;font:600 12.5px/1 inherit;font-family:inherit;cursor:pointer}',
    '.copy:hover{background:#eaf4fb}',
    'table{width:100%;border-collapse:collapse;font-size:13px}',
    'th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#6b7780;font-weight:700;padding:7px 8px;border-bottom:1px solid #e3e7ea;background:#f6f8f9;position:sticky;top:0}',
    'td{padding:7px 8px;border-bottom:1px solid #eef1f2;vertical-align:middle}',
    'tr[hidden]{display:none}',
    '.scroll{max-height:min(60vh,520px);overflow:auto;border:1px solid #e3e7ea;border-radius:10px}',
    '.pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:700;white-space:nowrap}',
    '.pill--none{background:#fbe7e5;color:#a8322a}.pill--partial{background:#fdf1d6;color:#8a6100}.pill--watched{background:#e1f3e8;color:#0b6b37}',
    '.meter{display:flex;align-items:center;gap:8px}',
    '.track{flex:1;min-width:80px;height:8px;border-radius:4px;background:#eef1f2;overflow:hidden}',
    '.fill{height:100%;border-radius:4px;background:#0374B5}',
    '.pct{width:40px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}',
    '.muted{color:#8b969e}',
    'svg{display:block;width:100%;height:auto}',
    '.spin{display:inline-block;width:12px;height:12px;border:2px solid #c7cdd1;border-top-color:#0374B5;border-radius:50%;animation:s .8s linear infinite;vertical-align:-1px;margin-right:6px}',
    '@keyframes s{to{transform:rotate(360deg)}}'
  ].join('\n');

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-cgp-studio', '');
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + CSS + '</style><div class="wrap"></div>';
    (document.body || document.documentElement).appendChild(host);
    shadow.addEventListener('click', onClick);
    // Switching "Select Embed" to another class: a new course, so its roster.
    var lastCourse = courseName();
    setInterval(function () {
      var now = courseName();
      if (now === lastCourse) return;
      lastCourse = now;
      askRoster();
      render();
    }, 1500);
    document.addEventListener('keydown', function (e) {
      if (state.open && e.key === 'Escape') { state.open = false; render(); }
    }, true);
  }

  function current() {
    var viewers = state.current ? state.users[state.current] : null;
    if (!viewers) return null;
    var name = courseName();
    var roster = state.rosters[name || '?'] || { status: 'loading' };
    var list = roster.status === 'ok' && roster.students.length
      ? SC().classList(roster.students, viewers)
      : SC().viewersOnly(viewers);
    return { list: list, roster: roster, course: (roster.courseName || name), overview: state.overview[state.current] || null };
  }

  function render() {
    if (!shadow) return;
    var c = current();
    var wrap = shadow.querySelector('.wrap');
    if (!c) { wrap.innerHTML = ''; return; }
    var n = c.list.counts;
    var watchedish = n.watched + n.partial;
    var launch = '<button type="button" class="launch" data-act="open" title="Every student in the class: who has and hasn’t watched this video">' +
      'Class list <b>' + (c.list.viewersOnly ? watchedish : watchedish + '/' + n.total) + ' watched</b></button>';
    if (!state.open) { wrap.innerHTML = launch; return; }
    var scroll = wrap.querySelector('.scroll');
    var keep = scroll ? scroll.scrollTop : 0;
    wrap.innerHTML = launch + '<div class="back" data-act="backdrop"><div class="panel" role="dialog" aria-modal="true" aria-label="Class list">' + panel(c) + '</div></div>';
    var s2 = wrap.querySelector('.scroll');
    if (s2) s2.scrollTop = keep;
  }

  function pctText(v) { return v === null || v === undefined ? '–' : Math.round(v * 100) + '%'; }

  function panel(c) {
    var L = c.list, n = L.counts;
    var sub = [c.course, videoTitle()].filter(Boolean).join(' · ');
    var head = '<div class="head"><div><h2>Class list</h2><div class="sub">' + esc(sub || 'This video') + '</div></div>' +
      '<button type="button" class="x" data-act="close" aria-label="Close">×</button></div>';
    var warn = '';
    if (c.roster.status === 'loading') warn = '<div class="warn"><span class="spin"></span>Reading the class list from Canvas…</div>';
    else if (L.viewersOnly) {
      warn = '<div class="warn">' + (c.roster.status === 'error' ? esc(c.roster.error) + '. ' : '') +
        'Showing only the students Studio saw watching' +
        (canvasOrigin() ? (c.course ? '' : ' (pick an embed under “Select Embed” so the course is known)') : ' - open Studio from Canvas to see the whole class') + '.</div>';
    }
    var tiles = '<div class="tiles">' +
      (L.viewersOnly ? '' : tileHtml('Not watched', n.none, 'none')) +
      tileHtml('Partly watched', n.partial, 'partial') +
      tileHtml('Watched', n.watched, 'watched') +
      (L.averageCompletion !== null ? tileHtml('Class average', pctText(L.averageCompletion), '') : '') +
      '</div>';
    var chart = timelineCard(c.overview);
    var filter = state.filter;
    var chips = [['all', 'All', n.total], ['none', 'Not watched', n.none], ['partial', 'Partly', n.partial], ['watched', 'Watched', n.watched]]
      .filter(function (ch) { return !(L.viewersOnly && ch[0] === 'none'); })
      .map(function (ch) {
        return '<button type="button" class="chip" data-filter="' + ch[0] + '" aria-pressed="' + (filter === ch[0]) + '">' + ch[1] + ' <b>' + ch[2] + '</b></button>';
      }).join('');
    var copy = L.viewersOnly ? '' : '<button type="button" class="copy" data-act="copy" title="Names of students who haven’t watched, or haven’t finished, one per line">Copy who hasn’t finished</button>';
    var rows = L.rows.map(function (r) {
      var label = r.status === 'none' ? 'Not watched' : r.status === 'partial' ? 'Partly watched' : 'Watched';
      return '<tr data-status="' + r.status + '"' + (filter === 'all' || filter === r.status ? '' : ' hidden') + '>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td><span class="pill pill--' + r.status + '">' + label + '</span></td>' +
        '<td><div class="meter"><div class="track"><div class="fill" style="width:' + Math.round((r.completion || 0) * 100) + '%"></div></div>' +
        '<span class="pct">' + (r.viewer ? pctText(r.completion) : '<span class="muted">0%</span>') + '</span></div></td>' +
        '</tr>';
    }).join('');
    var table = '<div class="scroll"><table><thead><tr><th>Student</th><th>Status</th><th>Share of the video watched</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="muted">No students.</td></tr>') + '</tbody></table></div>';
    var extra = L.extra.length
      ? '<p class="note">Also watched, but not on this course’s roster: ' + L.extra.map(function (v) { return esc(v.name) + ' (' + pctText(v.completion) + ')'; }).join(', ') + '.</p>'
      : '';
    var foot = '<p class="note">“Watched” is at least ' + Math.round(SC().WATCHED_AT * 100) + '% of the video, from Studio’s completion rate for this embed. ' +
      'Students are matched to Studio’s viewers by email.</p>';
    return head + '<div class="body">' + warn + tiles + chart + '<div class="bar">' + chips + copy + '</div>' + table + extra + foot + '</div>';
  }

  function tileHtml(k, v, tone) {
    return '<div class="tile' + (tone ? ' tile--' + tone : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }

  /* The class's "which parts were watched" line, from Studio's overview. */
  function timelineCard(o) {
    if (!o || !o.timeline || o.timeline.length < 3) return '';
    var W = 700, H = 120, padB = 18, padT = 6;
    var max = o.timeline.reduce(function (m, p) { return Math.max(m, p.value); }, 0) || 1;
    var pts = o.timeline.map(function (p) {
      return [Math.max(0, Math.min(1, p.at)) * W, padT + (1 - p.value / max) * (H - padB - padT)];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    var area = line + 'L' + W + ' ' + (H - padB) + 'L0 ' + (H - padB) + 'Z';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Viewers across the video">' +
      '<path d="' + area + '" fill="#0374B5" fill-opacity=".14"/><path d="' + line + '" fill="none" stroke="#0374B5" stroke-width="2"/>' +
      '<line x1="0" x2="' + W + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '" stroke="#c7cdd1"/>' +
      '<text x="0" y="' + (H - 4) + '" font-size="11" fill="#6b7780">Start</text>' +
      '<text x="' + W + '" y="' + (H - 4) + '" font-size="11" fill="#6b7780" text-anchor="end">End</text></svg>';
    var stats = [o.views !== null ? o.views + ' views' : '', o.uniqueViewers !== null ? o.uniqueViewers + ' unique viewers' : ''].filter(Boolean).join(' · ');
    return '<div class="card"><h3>Which parts were watched</h3>' + svg +
      '<p class="note">How many students were watching at each point in the video, highest ' + max + '.' + (stats ? ' ' + esc(stats) + '.' : '') + '</p></div>';
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
    }
    // Studio's frame usually isn't allowed the clipboard API; don't try it then.
    var policy = document.permissionsPolicy || document.featurePolicy;
    var allowed = !policy || !policy.allowsFeature || policy.allowsFeature('clipboard-write');
    if (allowed && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(fallback);
    return fallback();
  }

  function onClick(e) {
    var t = e.target;
    var act = t.closest && t.closest('[data-act]');
    var a = act ? act.getAttribute('data-act') : null;
    if (a === 'backdrop' && t !== act) a = null;   // a click inside the panel
    if (a === 'open') { state.open = true; askRoster(); render(); return; }
    if (a === 'close' || a === 'backdrop') { state.open = false; render(); return; }
    if (a === 'copy') {
      var c = current();
      if (!c) return;
      var rows = c.list.rows.filter(function (r) { return r.status !== 'watched'; });
      copyText(SC().namesText(rows)).then(function () {
        act.textContent = 'Copied ' + rows.length + (rows.length === 1 ? ' name' : ' names');
      }, function () { act.textContent = 'Couldn’t copy'; });
      return;
    }
    var f = t.closest && t.closest('[data-filter]');
    if (f) {
      state.filter = f.getAttribute('data-filter');
      shadow.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === state.filter)); });
      shadow.querySelectorAll('tbody tr[data-status]').forEach(function (tr) {
        tr.hidden = !(state.filter === 'all' || tr.getAttribute('data-status') === state.filter);
      });
    }
  }
})();
