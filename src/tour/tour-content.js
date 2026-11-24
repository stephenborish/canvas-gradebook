/* Canvas Gradebook+ - the tutorials: what each stop says, the small
 * illustration beside it, and which element of the real page it points at.
 * The list of tutorials, their titles and where each runs is in
 * tour-state.js (TourState.SECTIONS); `paths` below gives each one's stops.
 * Each card is labelled with its tutorial's name, so stops carry no label.
 *
 * Writing for these cards:
 *  - Write in full, friendly sentences, the way you would explain it to a
 *    colleague sitting next to you. No clipped notes or slogans.
 *  - Say where to look, what it means, then what to do ("At the top of the
 *    column... Click it to...").
 *  - Name buttons in bold, exactly as they read on screen.
 *  - Use one word for one thing. A teacher's "classes" are Period 2,
 *    Period 4..., each its own Canvas course; never "sections" or "courses"
 *    for those.
 *  - At most three sentences, or three bullets for separate tips.
 *  - Every claim is checked against the feature's code; change the card
 *    when the feature changes.
 */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.tourStops) return;

  /* ------------------------------------------------------- finding targets */

  function onScreen(el) {
    if (!el || !el.getBoundingClientRect || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return false;
    var cs = window.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  }

  // The most central of the matches that are on screen: the first match is
  // usually jammed against an edge, where the card has the least room.
  function pick(selector, filter) {
    var all = Array.prototype.slice.call(document.querySelectorAll(selector));
    var vis = all.filter(function (el) { return onScreen(el) && (!filter || filter(el)); });
    if (!vis.length) return null;
    var cx = window.innerWidth * 0.42, cy = window.innerHeight * 0.45;
    vis.sort(function (a, b) {
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var da = Math.hypot(ra.left + ra.width / 2 - cx, ra.top + ra.height / 2 - cy);
      var db = Math.hypot(rb.left + rb.width / 2 - cx, rb.top + rb.height / 2 - cy);
      return da - db;
    });
    return vis[0];
  }

  function headerOf(selector) {
    var el = pick(selector);
    return el ? (el.closest('.slick-header-column') || el) : null;
  }

  function cellOf(el) { return el ? (el.closest('.slick-cell') || el) : null; }

  function assignmentCell() {
    var gb = CGP.gradebook;
    if (gb && gb.adapter && gb.adapter.visibleCells) {
      try {
        var cells = gb.adapter.visibleCells().filter(function (c) {
          return c.columnType === 'assignment' && onScreen(c.el);
        });
        if (cells.length) {
          // A cell a few rows down and one column in: inside the grid, with
          // room around it.
          return cells[Math.min(cells.length - 1, Math.floor(cells.length / 3))].el;
        }
      } catch (e) { /* fall through to the badge-based guess */ }
    }
    return cellOf(pick('.cgp-sub')) || cellOf(pick('.cgp-cmt')) ||
      pick('.grid-canvas .slick-cell', function (el) { return !el.querySelector('a[href*="/users/"], a[href*="/grades/"]'); });
  }

  function gridArea() {
    var root = document.querySelector('#gradebook_grid') ||
      (document.querySelector('.grid-canvas') && document.querySelector('.grid-canvas').closest('.slickgrid, [role="grid"], #gradebook-grid-wrapper'));
    return root && onScreen(root) ? root : null;
  }

  function studentName() {
    var link = pick('.grid-canvas .slick-cell a[href*="/users/"], .grid-canvas .slick-cell a[href*="/grades/"]');
    return link ? (link.closest('.slick-cell') || link) : null;
  }

  function assignmentHeader() {
    return headerOf('.slick-header-column[id*="assignment_"]') ||
      headerOf('.slick-header-column .cgp-header-points') ||
      headerOf('.slick-header-column .cgp-header-title');
  }

  /* Resolves true as soon as test() does, or false after `ms`. The tour's
   * one polling helper: tour.js uses it too (CGP.tourWaitFor). */
  function waitFor(test, ms, every) {
    return new Promise(function (resolve) {
      if (test()) { resolve(true); return; }
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (test()) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(false); }
      }, every || 120);
    });
  }

  /* The student overview, opened for real: the same click a teacher makes on
   * a name (student-insights.js listens for it). Resolves true once its
   * tiles have loaded from Canvas. */
  function openOverview(tour) {
    var loaded = function () { return !!document.querySelector('.cgp-si__panel .cgp-si__tiles'); };
    if (document.querySelector('.cgp-si__panel')) return waitFor(loaded, 10000);
    var cell = (tour && tour.siCell && tour.siCell.isConnected) ? tour.siCell : studentName();
    var link = cell && (cell.matches && cell.matches('a') ? cell : cell.querySelector('a'));
    if (!link) return Promise.resolve(false);
    // If nothing opens the overview for this click (it is off in settings,
    // or this is the test student), the click must not reach Canvas either:
    // no navigation to the grades page, no context tray mid-tour.
    var hold = function (e) { e.preventDefault(); e.stopPropagation(); };
    link.addEventListener('click', hold);
    if (tour) tour.synthetic = true;
    try { link.click(); } finally {
      if (tour) tour.synthetic = false;
      link.removeEventListener('click', hold);
    }
    return waitFor(function () { return !!document.querySelector('.cgp-si__panel'); }, 1500).then(function (opened) {
      return opened ? waitFor(loaded, 10000) : false;
    });
  }

  /* The overview on one of its tabs (Back from a later tab returns here). */
  function openTab(name, ready, ms) {
    return function (tour) {
      return openOverview(tour).then(function (ok) {
        if (!ok) return false;
        var tab = document.querySelector('.cgp-si__tabs [data-si-tab="' + name + '"]');
        if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
        return waitFor(function () { return pick(ready); }, ms);
      });
    };
  }

  function closeOverview() {
    var bd = document.querySelector('.cgp-si__backdrop');
    if (bd) bd.click();
  }

  /* ---------------------------------------------------------- small pieces */

  var ICON = {
    bubble: '<svg viewBox="0 0 20 20"><path d="M3 5.2A2.2 2.2 0 0 1 5.2 3h9.6A2.2 2.2 0 0 1 17 5.2v6.1a2.2 2.2 0 0 1-2.2 2.2H9.4L5.6 16.7v-3.2h-.4A2.2 2.2 0 0 1 3 11.3z"/></svg>',
    check: '<svg viewBox="0 0 20 20"><path d="M4.5 10.5l3.6 3.4 7.4-8"/></svg>',
    keys: '<svg viewBox="0 0 20 20"><rect x="2" y="5" width="16" height="10" rx="2"/><path d="M5.3 8.2h.01M8.4 8.2h.01M11.6 8.2h.01M14.7 8.2h.01M6 11.8h8"/></svg>',
    grid: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M2.5 7.7h15M2.5 12.3h15M7.5 3v14M12.5 3v14"/></svg>',
    eye: '<svg viewBox="0 0 20 20"><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/></svg>',
    person: '<svg viewBox="0 0 20 20"><circle cx="10" cy="6.6" r="3.3"/><path d="M3.6 17c.8-3.5 3.3-5.3 6.4-5.3s5.6 1.8 6.4 5.3"/></svg>',
    total: '<svg viewBox="0 0 20 20"><path d="M14.5 4h-9l5 6-5 6h9"/></svg>',
    chart: '<svg viewBox="0 0 20 20"><path d="M3 17h14"/><rect x="4.5" y="10" width="2.6" height="5" rx=".6"/><rect x="8.7" y="5.5" width="2.6" height="9.5" rx=".6"/><rect x="12.9" y="8" width="2.6" height="7" rx=".6"/></svg>',
    swap: '<svg viewBox="0 0 20 20"><path d="M4 7h11.5M12.5 4l3 3-3 3M16 13H4.5M7.5 10l-3 3 3 3"/></svg>',
    search: '<svg viewBox="0 0 20 20"><circle cx="8.6" cy="8.6" r="5"/><path d="M12.4 12.4 17 17"/></svg>',
    gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/></svg>',
    flag: '<svg viewBox="0 0 20 20"><path d="M5 17.5V3M5 3.5h9.5l-2 3.4 2 3.4H5"/></svg>',
    link: '<svg viewBox="0 0 20 20"><path d="M8.5 11.5a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-1 1"/><path d="M11.5 8.5a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l1-1"/></svg>',
    people: '<svg viewBox="0 0 20 20"><circle cx="7" cy="6.5" r="2.8"/><circle cx="14" cy="7.3" r="2.3"/><path d="M2 16.5c.4-3 2.4-4.7 5-4.7s4.6 1.7 5 4.7M12.2 12.2c.6-.3 1.2-.5 1.9-.5 2.1 0 3.6 1.5 3.9 4.1"/></svg>',
    calendar: '<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="13.5" rx="2"/><path d="M2.5 8.25h15M6.5 2.5v3M13.5 2.5v3M10 10.5v2.5l1.75 1"/></svg>'
  };

  function key(k, tone) { return '<kbd class="kc' + (tone ? ' kc--' + tone : '') + '">' + k + '</kbd>'; }

  /* ---------------------------------------------------------- illustrations
   * Small drawings of the real thing, for when it is not on screen to point
   * at. Each one copies the real component's labels, shapes, colours and
   * layout (the source is named beside it), so what the teacher sees here is
   * what they will find on the page. Change the drawing with the feature. */

  // indicators.js BUBBLE and SUB_GLYPHS; util.js TOTAL_ICONS; student-insights.js ICONS and COPY_ICON.
  var SVG_BUBBLE = '<svg viewBox="0 0 16 16"><path d="M2.2 2.9c0-.9.7-1.6 1.6-1.6h8.4c.9 0 1.6.7 1.6 1.6v5.6c0 .9-.7 1.6-1.6 1.6H7.5L4.3 13v-2.9h-.5c-.9 0-1.6-.7-1.6-1.6V2.9z"/></svg>';
  var SVG_PAGE = '<svg viewBox="0 0 16 16"><path d="M4.2 2.2h4.6l3 3v8.6H4.2z"/><path d="M8.6 2.4v3.1h3"/></svg>';
  var SVG_ALERT = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="currentColor"/><path fill="#fff" d="M8.85 4.6h2.3l-.45 7.1H9.3zM10 13.3a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z"/></svg>';
  var SVG_FLAG = '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M4 1.8a1 1 0 0 1 1 1V3h10.3c.8 0 1.2.9.7 1.5l-2.6 3.3 2.6 3.3c.5.6.1 1.5-.7 1.5H5v5.6a1 1 0 1 1-2 0V2.8a1 1 0 0 1 1-1z"/></svg>';
  var SI_ICON = {
    risk: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.5 19 17.5H1zM9 7v5h2V7zm0 6.5v2h2v-2z"/></svg>',
    warn: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="currentColor"/><path fill="#fff" d="M9 5h2v6H9zm0 7.5h2v2H9z"/></svg>',
    good: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="currentColor"/><path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m6 10.2 2.7 2.7L14.2 7"/></svg>'
  };
  var SVG_COPY = '<svg viewBox="0 0 20 20"><rect x="6.5" y="6.5" width="10" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.5 4.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v9A1.5 1.5 0 0 0 5 14.5h.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  /* One gradebook cell. marks: { cmt, count, sub: 'in'|'out', resub, status: 'M'|'L', sel, active } */
  function cell(value, m) {
    m = m || {};
    var cls = 'xc' + (m.sel ? ' xc--sel' : '') + (m.active ? ' xc--active' : '');
    var h = '<span class="' + cls + '"><span class="xc__v">' + value + '</span>';
    if (m.status) h += '<span class="xc__st xc__st--' + (m.status === 'M' ? 'm' : 'l') + '">' + m.status + '</span>';
    if (m.cmt) h += '<span class="xc__cmt' + (m.sub ? ' xc__cmt--shift' : '') + '">' + SVG_BUBBLE + (m.count ? '<b>' + m.count + '</b>' : '') + '</span>';
    if (m.sub) h += '<span class="xc__sub xc__sub--' + m.sub + '">' + SVG_PAGE + '</span>';
    if (m.resub) h += '<span class="xc__resub"></span>';
    return h + '</span>';
  }
  function legend(rows) {
    return '<div class="xl">' + rows.map(function (r) { return '<div class="xl__row">' + r[0] + '<span>' + r[1] + '</span></div>'; }).join('') + '</div>';
  }

  var ART = {
    comments: function () {
      return legend([[cell('92', { cmt: true }), 'One comment from you'], [cell('88', { cmt: true, count: 3 }), 'Three comments from you']]);
    },
    submissions: function () {
      return legend([[cell('94', { sub: 'in' }), 'Turned in'], [cell('', { sub: 'out' }), 'Not turned in yet'], [cell('81', { sub: 'in', resub: true }), 'Turned in again after you graded it']]);
    },
    statuses: function () {
      return legend([[cell('', { status: 'M', active: true }), 'After pressing ' + key('M')], [cell('8', { status: 'L' }), 'After pressing ' + key('L')]]);
    },
    spreadsheet: function () {
      var rows = [['Ava', '9', '10'], ['Ben', '7', ''], ['Cleo', '8', ''], ['Dev', '10', '']];
      var h = '<div class="xg"><div class="xg__head"><span>Student</span><span>Lab 3</span><span>Lab 4</span></div>';
      rows.forEach(function (r, i) {
        h += '<div class="xg__row"><span class="xg__name">' + r[0] + '</span>' + cell(r[1]) + cell(r[2], { sel: i > 0 }) + '</div>';
      });
      return h + '</div><p class="xcap">Three cells selected. Type a grade and press Enter to fill all three.</p>';
    },
    post: function () {
      return '<div class="xh"><div class="xh__label"><b>Unit 2 Test</b><span class="xh__pts">50 pts</span><span class="xh__due">Due Oct 14</span></div>' +
        '<span class="xh__post">Post 12</span></div>';
    },
    total: function () {
      return legend([
        [cell('93.5%'), 'No flag'],
        [cell('74.2%', {}).replace('<span class="xc__v">', '<span class="xc__flag" style="color:#e0b800">' + SVG_FLAG + '</span><span class="xc__v">'), '77% or below: yellow flag'],
        [cell('66.9%', {}).replace('<span class="xc__v">', '<span class="xc__flag" style="color:#d1453b">' + SVG_ALERT + '</span><span class="xc__v">'), '70% or below: red alert']
      ]);
    },
    menus: function () {
      var bars = [['F', 1], ['D', 1], ['C-', 0], ['C', 2], ['C+', 3], ['B-', 4], ['B', 6], ['B+', 5], ['A-', 4], ['A', 3], ['A+', 1]];
      var max = 6;
      var h = '<div class="xp"><div class="xp__eyebrow">Score analysis</div><div class="xp__title">Lab 4</div>' +
        '<div class="xs">' + [['Mean', '41.2', '82.4%'], ['Median', '42', '84.0%'], ['Std. deviation', '5.1', ''], ['Range', '28–50', 'of 50 pts']].map(function (t) {
          return '<span class="xs__t"><small>' + t[0] + '</small><b>' + t[1] + '</b>' + (t[2] ? '<em>' + t[2] + '</em>' : '') + '</span>';
        }).join('') + '</div><div class="xp__sub">Distribution by letter grade</div><div class="xhist">';
      bars.forEach(function (b) {
        h += '<span class="xhist__col"><i>' + (b[1] || '') + '</i><span class="xhist__bar" style="height:' + Math.round(b[1] / max * 100) + '%"></span><em>' + b[0] + '</em></span>';
      });
      return h + '</div></div>';
    },
    find: function () {
      return '<div class="xm"><div class="xm__input">new tom</div>' +
        '<div class="xm__row is-on"><b>Tommy Newnam</b><span>Biology P3 · 2026–27 · this gradebook</span></div>' +
        '<div class="xm__row"><b>Tomas Newton</b><span>Chemistry P5 · 2026–27</span></div></div>';
    },
    student: function () { return siHead() + siTiles(3); },
    'si-overview': function () { return siHead() + siTiles(6); },
    'si-standout': function () {
      var rows = [
        ['risk', '3 missing assignments on record', '45 points not yet earned'],
        ['warn', 'Turns in 40% of work late', '4 of 10 submissions · typically 1 d 3 h late'],
        ['good', 'Scores trending up 9 points', 'Last 3 graded avg 88% vs 79% before']
      ];
      return '<div class="xcard"><h4>What stands out</h4>' + rows.map(function (r) {
        return '<div class="xso xso--' + r[0] + '"><span class="xso__i">' + SI_ICON[r[0]] + '</span><span><b>' + r[1] + '</b><small>' + r[2] + '</small></span></div>';
      }).join('') + '</div>';
    },
    'si-work': function () {
      return '<div class="xshare"><span class="xshare__i">' + SVG_COPY + '</span><span class="xshare__t"><b>Copy List of Missing/Late Work</b>' +
        '<small>2 missing · 1 late · for a parent, counselor or the student</small></span><span class="xshare__chev">›</span></div>' +
        '<pre class="xpre">Missing (2)\n• Lab 4 — due Mon, Oct 12, 11:59 PM — not turned in · 9 days overdue — worth 20 pts\n• Essay 2 — due Sun, Oct 18, 11:59 PM — not turned in · 3 days overdue — worth 25 pts</pre>';
    },
    'si-activity': function () {
      var seed = '0102310023421013442100123231024321103443200124321001234321012343210012343'.split('');
      var h = '<div class="xcard"><h4>Daily page views</h4><div class="xheat"><span class="xheat__days"><i></i><i>Mon</i><i></i><i>Wed</i><i></i><i>Fri</i><i></i></span><span class="xheat__grid">';
      for (var i = 0; i < 112; i++) h += '<i class="h' + (seed[(i * 7 + (i >> 3)) % seed.length] || 0) + '"></i>';
      return h + '</span></div><div class="xheat__key">Less <i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i> More</div></div>';
    },
    'si-profile': function () {
      var row = function (n, e, login) {
        return '<div class="xpg"><b>' + n + '</b><span>' + e + ' <em class="xpill">Copy</em></span><small>Last Canvas login: ' + login + '</small></div>';
      };
      return '<div class="xcard"><h4>Parents &amp; guardians <em class="xpill">Copy all</em></h4>' +
        row('Dana Parker', 'dana.parker@example.com', 'yesterday at 6:02 PM') + row('Sam Parker', 'sam.parker@example.com', 'Oct 30 at 8:15 AM') + '</div>';
    }
  };

  /* student-insights.js head and tiles, with the tones it gives these values. */
  function siHead() {
    return '<div class="xsi"><span class="xsi__av">JP</span><span class="xsi__nm"><small>Student overview</small><b>Jordan Parker</b>' +
      '<em>Last active today at 7:50 PM · 4.2 h in the course · Student 3 of 24</em></span><span class="xsi__gr"><b>87.3%</b><small>B+</small></span></div>';
  }
  function siTiles(n) {
    var t = [
      ['Missing', '2', '35 pts outstanding', 'warn'],
      ['Late', '1', '10% of submitted work', ''],
      ['On-time rate', '80%', '8 of 10 due so far', ''],
      ['Average score', '84.2%', '+3 vs class median', ''],
      ['Needs grading', '3', 'Submitted, not graded', ''],
      ['Last active', 'Today', 'Nov 20, 7:50 PM', '']
    ].slice(0, n);
    return '<div class="xtiles">' + t.map(function (x) {
      return '<span class="xtile' + (x[3] ? ' xtile--' + x[3] : '') + '"><small>' + x[0] + '</small><b>' + x[1] + '</b><em>' + x[2] + '</em></span>';
    }).join('') + '</div>';
  }

  // sync-dialog.js, sync-board.js, group-builder.js, course-schedule.js.
  var SVG_PEOPLE = '<svg viewBox="0 0 16 16"><circle cx="5.5" cy="5" r="2.3"/><circle cx="11.2" cy="5.6" r="1.9"/><path d="M1.6 13.6c.3-2.4 1.9-3.8 3.9-3.8s3.6 1.4 3.9 3.8M9.6 10.1c.5-.3 1-.4 1.6-.4 1.7 0 3 1.2 3.2 3.3"/></svg>';
  function dlgHead(eyebrow, title) {
    return '<div class="xp__eyebrow">' + eyebrow + '</div><div class="xp__title">' + title + '<span class="xp__x">×</span></div>';
  }
  function pill(kind, text) { return '<span class="xpl xpl--' + kind + '">' + text + '</span>'; }

  ART['classes-link'] = function () {
    var row = function (name, term, on, sug) {
      return '<div class="xlk"><span class="xbox' + (on ? ' is-on' : '') + '"></span><b>' + name + '</b>' + (sug ? '<span class="xsug">suggested</span>' : '') + '<small>' + term + '</small></div>';
    };
    return '<div class="xp">' + dlgHead('Your classes', 'Link your classes') +
      '<div class="xp__sub">Which of your classes are the same course as this one?</div>' +
      row('Biology P4', '2026–27', true, true) + row('Biology P6', '2026–27', true, true) + row('Chemistry P3', '2026–27', false, false) +
      '<div class="xp__foot"><span class="xbtn">Use these 2 classes</span></div></div>';
  };
  ART['classes-copy'] = function () {
    var card = function (name, state, kind, due, on) {
      return '<div class="xdest' + (on ? ' is-on' : '') + '"><div class="xdest__h"><span class="xbox' + (on ? ' is-on' : '') + '"></span><b>' + name + '</b>' + pill(kind, state) + '</div>' +
        (due ? '<label class="xdate"><small>Due</small><span>' + due + '</span></label>' : '') + '</div>';
    };
    return '<div class="xp">' + dlgHead('Copy from Biology P2', 'Lab 5: Photosynthesis') +
      card('Biology P4', 'Not there yet', 'new', '10/14/2026, 09:50 AM', true) + card('Biology P6', 'Same', 'same', '', false) +
      '<div class="xp__foot"><span class="xbtn">Copy to Biology P4</span><span class="xp__cancel">Cancel</span></div></div>';
  };
  ART['classes-compare'] = function () {
    var chip = function (k) {
      return k === 'same' ? pill('same', '✓ Same') : k === 'miss' ? pill('miss', '+ Not there') : pill('diff', '≠ Different') + '<span class="xact">Open · <u>Pick a version…</u></span>';
    };
    var rows = [['Lab 5: Photosynthesis', 'same', 'same'], ['Unit 3 Quiz', 'same', 'miss'], ['Essay 2', 'diff', 'same']];
    return '<div class="xp">' + dlgHead('Compare classes', 'Biology P2 vs. your other classes') +
      '<div class="xtbl"><div class="xtbl__r xtbl__h"><span>In Biology P2</span><span>Biology P4</span><span>Biology P6</span></div>' +
      rows.map(function (r) { return '<div class="xtbl__r"><span><u>' + r[0] + '</u></span><span>' + chip(r[1]) + '</span><span>' + chip(r[2]) + '</span></div>'; }).join('') +
      '</div></div>';
  };
  ART['groups-button'] = function () {
    return '<div class="xbar"><span class="xcopyto">' + SVG_PEOPLE + 'Make groups</span><span class="xcanvasbtn">+ Group Set</span></div>';
  };
  ART.schedule = function () {
    var row = function (t, time, match) {
      return '<div class="xsc__row' + (match ? ' is-match' : '') + '"><span class="xsc__pick"><b>' + t + (match ? ' <span class="xsc__badge">This course</span>' : '') + '</b><small>' + time + '</small></span><span class="xsc__alt">End</span></div>';
    };
    return '<div class="xsc"><div class="xsc__head"><span class="xsc__nav">‹</span><b>Tue, Oct 14</b><span class="xsc__nav">›</span><span class="xsc__today">Today</span><span class="xsc__x">×</span></div>' +
      '<div class="xsc__tags"><span>A Day</span></div>' +
      row('AP Biology P1', '8:55 – 9:50 AM · Room 204') + row('Biology P3', '10:45 – 11:40 AM · Room 204', true) + row('Biology P6', '1:45 – 2:40 PM · Room 204') +
      '<div class="xsc__foot"><span>Click a class to put its start time in “Due”.</span><u>Refresh</u></div></div>';
  };
  ART['snip-what'] = function () {
    return '<div class="xsn"><span class="xsn__box">/nice<i class="xsn__caret"></i></span><span class="xsn__arrow">' + key('Tab') + '</span>' +
      '<span class="xsn__box">Nicely done. Your reasoning here is clear and well supported.</span></div>';
  };

  /* ----------------------------------------------------------------- stops */

  var stops = [
    /* ------------------------------------------ Grading basics (gradebook) */
    {
      id: 'comments',
      icon: 'bubble',
      title: 'Blue bubbles show where you’ve left feedback',
      body: 'When you comment on a student’s work, a small blue speech bubble appears in that grade cell. A number on the bubble tells you how many comments you’ve left. Hover over it to read your latest comment and see whether the student has replied.',
      try: 'Click a bubble to read the whole conversation and reply.',
      fallbackNote: 'There’s no feedback on this screen yet. Once you comment on a student’s work, a bubble will appear in their grade cell.',
      target: function () { return cellOf(pick('.cgp-cmt')); },
      fallback: assignmentCell,
      tryIt: true
    },
    {
      id: 'submissions',
      icon: 'check',
      title: 'Badges show who has turned in work',
      body: 'Look at the right edge of each grade cell. A <b class="c-green">solid green</b> badge means the student has submitted the assignment, and a <b class="c-gray">hollow gray</b> one means they haven’t yet. Hover over a badge to see when it was turned in.',
      try: 'Click a green badge to open that student’s work in SpeedGrader. It opens in a new tab.',
      fallbackNote: 'Badges only appear on assignments that students turn in online.',
      target: function () { return cellOf(pick('.cgp-sub')); },
      fallback: assignmentCell,
      tryIt: true
    },
    {
      id: 'statuses',
      icon: 'keys',
      title: 'Mark work Missing, Late or Excused with one key',
      body: 'Click a student’s grade cell, then press ' + key('M', 'red') + ' for Missing, ' + key('L', 'amber') + ' for Late or ' + key('E', 'green') + ' for Excused. It’s saved in Canvas right away, so students see it too.',
      bullets: ['Pressing ' + key('M') + ' or ' + key('L') + ' again removes the status.'],
      target: assignmentCell
    },
    {
      id: 'spreadsheet',
      icon: 'grid',
      title: 'Enter grades for many students at once',
      bullets: [
        'Copy a column of grades from Google Sheets or Excel, click the first cell, and paste. Gradebook+ checks every grade before it saves.',
        'To give several students the same grade, hold ' + key('Ctrl') + ' (' + key('⌘') + ' on a Mac) and click their cells, or ' + key('Shift') + '-click to select a range. Then type the grade and press ' + key('Enter') + '.',
        'With several cells selected, you can also press ' + key('M') + ', ' + key('L') + ' or ' + key('E') + ' to mark them all, or ' + key('C') + ' to leave the same comment on all of them.'
      ],
      target: gridArea,
      fallback: assignmentCell,
      padding: 0
    },
    {
      id: 'post',
      icon: 'eye',
      title: 'Release hidden grades with the Post button',
      body: 'When some grades in a column are hidden from students, a <b>Post</b> button appears at the top of that column, showing how many are hidden. Clicking it makes those grades visible to students right away.',
      fallbackNote: 'Every grade on this screen is already visible to students. When some are hidden, a Post button will appear at the top of their column.',
      target: function () { return headerOf('.cgp-post'); },
      fallback: assignmentHeader,
      tryIt: false
    },

    /* ---------------------------------------- Student overview (gradebook) */
    {
      id: 'student',
      icon: 'person',
      title: 'Click a student’s name to see their overview',
      body: 'The overview puts everything about one student in one place: their grade, missing work, recent activity and parent contacts. Click <b>Open overview</b> to see this student’s.',
      target: studentName,
      tryIt: true,
      primary: { label: 'Open overview', run: function (tour) { tour.next(); } },
      onShow: function (tour, el) { tour.siCell = el; }
    },
    {
      id: 'si-overview',
      group: 'si',
      icon: 'person',
      title: 'The Overview tab shows how a student is doing',
      body: 'At the top are their current grade and when they were last active in your course. The boxes underneath count their missing, late and ungraded work, and compare their average with the class average.',
      bullets: ['Click the Missing, Late or Needs grading box to see which assignments those are.', 'Press ' + key('←') + ' or ' + key('→') + ' to move to the previous or next student.'],
      fallbackNote: 'The overview couldn’t open here (it may be turned off in Gradebook+ settings), so this is a picture of one.',
      enter: openTab('overview', '#cgp-si-panel-overview .cgp-si__tiles', 4000),
      target: function () {
        var head = pick('.cgp-si__head');
        var tiles = pick('#cgp-si-panel-overview .cgp-si__tiles, .cgp-si__tiles');
        return head && tiles ? [head, tiles] : (tiles || head);
      },
      leave: closeOverview,
      fallbackArt: true
    },
    {
      id: 'si-standout',
      group: 'si',
      icon: 'check',
      title: '“What stands out” points out patterns',
      body: 'Gradebook+ looks through the student’s record and lists anything worth a closer look, such as missing work piling up, a habit of turning work in late, no recent activity in Canvas, or grades going up or down.',
      enter: openTab('overview', '#cgp-si-panel-overview .cgp-si__card', 4000),
      target: function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll('.cgp-si__card'));
        var hit = cards.filter(function (c) {
          var h = c.querySelector('h3');
          return h && /what stands out/i.test(h.textContent || '') && onScreen(c);
        })[0];
        return hit || null;
      },
      leave: closeOverview,
      fallbackArt: true
    },
    {
      id: 'si-work',
      group: 'si',
      icon: 'check',
      title: 'Copy a list of missing work for parents',
      body: 'On the Assignments tab, click <b>Copy List of Missing/Late Work</b>. It copies each missing or late assignment with its due date, how many days overdue it is and its points, ready to paste into an email.',
      bullets: ['Use the filters above the table to show only Missing, Late, Needs grading or Upcoming work.'],
      enter: openTab('work', '#cgp-si-panel-work .cgp-si__share, #cgp-si-panel-work .cgp-si__card', 4000),
      target: function () {
        var share = pick('#cgp-si-panel-work .cgp-si__share');
        if (share) return share.closest('.cgp-si__card') || share;
        return pick('#cgp-si-panel-work .cgp-si__card') || pick('#cgp-si-panel-work');
      },
      leave: closeOverview,
      fallbackArt: true
    },
    {
      id: 'si-activity',
      group: 'si',
      icon: 'chart',
      title: 'See how the student uses your course',
      body: 'The Activity tab compares the student’s page views with the rest of the class and shows a calendar of their activity over the last 16 weeks. It also lists which pages they’ve opened and how much of each Studio video they’ve watched.',
      enter: openTab('activity', '#cgp-si-panel-activity .cgp-si__card', 6000),
      target: function () {
        var heat = pick('#cgp-si-panel-activity .cgp-si__heat-cell');
        if (heat && heat.closest('.cgp-si__card')) return heat.closest('.cgp-si__card');
        return pick('#cgp-si-panel-activity .cgp-si__card') || pick('#cgp-si-panel-activity');
      },
      leave: closeOverview,
      fallbackArt: true
    },
    {
      id: 'si-profile',
      group: 'si',
      icon: 'person',
      title: 'Find parent and guardian emails',
      body: 'The Profile tab lists the parents and guardians connected to this student in Canvas, with their email addresses. Click an address to write to them, or click <b>Copy all</b> to copy every address at once.',
      bullets: ['It also shows the student’s own email, their section, and their grades in your other classes.'],
      enter: openTab('profile', '#cgp-si-panel-profile .cgp-si__card', 6000),
      target: function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll('#cgp-si-panel-profile .cgp-si__card'));
        var hit = cards.filter(function (c) {
          var h = c.querySelector('h3');
          return h && /parents/i.test(h.textContent || '') && onScreen(c);
        })[0];
        return hit || pick('#cgp-si-panel-profile .cgp-si__card') || null;
      },
      leave: closeOverview,
      fallbackArt: true
    },

    /* ----------------------------------------- Gradebook tools (gradebook) */
    {
      id: 'total',
      icon: 'total',
      title: 'The Total column stays in view',
      body: 'The Total column stays next to the student names, so you can see final grades no matter how far you scroll. Hover over a total to see the letter grade.',
      bullets: ['Totals below a cutoff get a warning flag. You can change the cutoffs in Gradebook+ settings.'],
      target: function () { return headerOf('.cgp-header-total') || headerOf('.slick-header-column[id*="total_grade"]'); },
      optional: true
    },
    {
      id: 'menus',
      icon: 'chart',
      title: 'Score statistics and class lists',
      bullets: [
        'Click the <b>⋮</b> at the top of an assignment column and choose <b>Analyze Scores</b> to see the average, median and spread, with a chart of the scores.',
        'Click the <b>⋮</b> at the top of the Student Name column and choose <b>Copy Roster</b> to copy student or parent emails, or a list of names.'
      ],
      target: assignmentHeader
    },
    {
      id: 'switcher',
      icon: 'swap',
      title: 'Switch to another course',
      body: 'Click <b>Switch course</b>, next to the course name at the top of the page, to see every course you teach. Pick one and you’ll land on the same page in that course.',
      target: function () { return pick('.cgp-crumb-toggle', function (el) { return !el.classList.contains('cgp-find-student') && !el.classList.contains('cgp-settings-gear'); }); },
      optional: true,
      tryIt: true,
      padding: 6
    },
    {
      id: 'find',
      icon: 'search',
      title: 'Find a student in any of your courses',
      body: 'Click <b>Find student</b> at the top of the page and start typing a name. The words can be in any order, so “new tom” finds Tommy Newnam. Choose the student to open their gradebook with their row highlighted.',
      target: function () { return pick('.cgp-find-student'); },
      optional: true,
      tryIt: true,
      padding: 6
    },
    {
      id: 'gear',
      icon: 'gear',
      title: 'Canvas’s toolbar is hidden to save space',
      body: 'Gradebook+ hides the row of Canvas buttons above the grid so you can see more grades. This gear opens Canvas’s Gradebook Settings, which used to be in that row.',
      bullets: ['To bring the toolbar back, press ' + key('Alt') + key('Shift') + key('H') + ' (' + key('Option') + key('Shift') + key('H') + ' on a Mac).'],
      target: function () { return pick('.cgp-settings-gear'); },
      optional: true,
      tryIt: true,
      padding: 6
    },

    /* ---------------------------------- Copy between classes (course home) */
    {
      id: 'classes-link',
      icon: 'link',
      title: 'Teach the same course to more than one class?',
      body: 'If you teach this course to several classes, such as Periods 2, 4 and 6, each one is a separate Canvas course. Gradebook+ can copy your work between them. Start by clicking <b>Copy to other classes</b> and choosing your other classes; you only do this once.',
      fallbackNote: 'The <b>Copy to other classes</b> button is in the sidebar on the course home page, and next to <b>+ Module</b> on the Modules page. If you don’t see it, turn it on in Gradebook+ settings.',
      target: function () { return pick('.cgp-copyto--home, .cgp-copyto'); },
      tryIt: true,
      fallbackArt: true
    },
    {
      id: 'classes-copy',
      kind: 'center',
      icon: 'swap',
      title: 'Copy assignments, pages and modules to your other classes',
      body: 'Click <b>Copy to other classes</b> here to pick items from this course, or use the copy button next to <b>Edit</b> on an assignment’s page to copy just that one. Choose the classes, set each class’s due dates, and click <b>Copy</b>.',
      bullets: [
        'Each copy goes into the matching module in that class.',
        'Each class is labeled <i>Not there yet</i>, <i>Same</i> or <i>Different</i>, so you can see whether it already has the item.',
        'If you’ve changed an item in one class, that version is only replaced if you choose to replace it.'
      ]
    },
    {
      id: 'classes-compare',
      kind: 'center',
      icon: 'grid',
      title: 'Check that your classes match',
      body: 'In the <b>Copy to other classes</b> window, <b>Compare classes</b> lists every item in this course and whether your other classes have the same version. If one is marked Different, click <b>Pick a version…</b> to see both side by side and choose which to keep.',
      bullets: ['You can also copy as you work: when you create or edit an assignment, quiz, discussion or page, choose classes under <b>Also copy to your linked courses</b> before you save.']
    }
  ];

  /* Make groups, on the People page. */
  var groupStops = [
    {
      id: 'groups-button',
      icon: 'people',
      title: 'Make a whole group set in one step',
      body: 'Click <b>Make groups</b>, next to Canvas’s <b>+ Group Set</b> button. It creates the group set, names the groups and puts students in them all at once.',
      fallbackNote: '<b>Make groups</b> appears next to <b>+ Group Set</b> on the People page. If you don’t see it, turn it on in Gradebook+ settings.',
      target: function () { return pick('.cgp-groups-btn'); },
      tryIt: true,
      padding: 6,
      fallbackArt: true
    },
    {
      id: 'groups-steps',
      kind: 'center',
      icon: 'people',
      title: 'Answer three questions, then click the Make button',
      steps: [
        { n: '1', t: 'How many groups?', d: 'Choose a number of groups, or how many students should be in each one.' },
        { n: '2', t: 'What should they be called?', d: 'Numbers, letters, colors, or names you type in.' },
        { n: '3', t: 'How do students get in?', d: 'Shuffle them in at random, place them yourself, or let students sign up in Canvas.' }
      ]
    },
    {
      id: 'groups-arrange',
      kind: 'center',
      icon: 'swap',
      title: 'Rearrange or copy groups later',
      bullets: [
        'To move students, open the <b>Your group sets</b> tab, click <b>Arrange students</b>, and drag names between groups. Click <b>Save changes</b> when you’re done.',
        'To make the same groups in another class, click <b>Copy to…</b> next to the group set.'
      ]
    }
  ];

  /* Comment snippets and SpeedGrader drafts, on the options page's Comment
   * Snippets tab (SpeedGrader itself never shows a tutorial: the teacher is
   * in the middle of grading there). */
  var snippetStops = [
    {
      id: 'snip-what',
      kind: 'center',
      icon: 'bubble',
      title: 'Insert a saved comment by typing a short name',
      body: 'A snippet is a comment you’ve saved under a short name. In a comment box, type a slash and the name, like <b>/nice</b>, then press ' + key('Tab') + ' and the full comment appears.',
      bullets: ['Works in SpeedGrader and in the gradebook’s comment boxes.']
    },
    {
      id: 'snip-list',
      icon: 'keys',
      title: 'Create your own snippets',
      body: 'Click <b>+ Add Snippet</b>, type a short name, and write the comment it should insert. When you’re finished, click <b>Save changes</b> in the sidebar on the left.',
      bullets: ['To try a snippet out, type it in the test box at the bottom of this page.'],
      target: function () { var m = document.querySelector('.snippets-manager'); return m && onScreen(m) ? m : null; },
      tryIt: true, padding: 8
    },
    {
      id: 'snip-drafts',
      kind: 'center',
      icon: 'check',
      title: 'SpeedGrader keeps comments you haven’t sent',
      body: 'If you type a comment in SpeedGrader and move to another student before submitting it, Gradebook+ saves it. When you go back to that student, your comment will be waiting.'
    }
  ];

  /* The Class schedule tutorial, on the options page's Class Schedule tab.
   * The teacher types and clicks here, so the tour never holds keys back and
   * every stop lets clicks through. */
  var scheduleStops = [
    {
      id: 'schedule',
      kind: 'center',
      icon: 'calendar',
      title: 'See when your classes meet while you set due dates',
      body: 'Gradebook+ reads your class meetings from your Google Calendar. When you click a Due, Available from or Until box on an assignment, quiz, discussion or module, a panel opens beside it with that day’s classes, their times and rooms.',
      bullets: [
        'Click a class to fill in its start time, or click <b>End</b> beside it for its end time.',
        'The class you’re editing is marked <b>This course</b>. Use the arrows to see other days.'
      ]
    },
    {
      id: 'opt-copy',
      icon: 'link',
      title: 'Step 1: Connect your Google Calendar',
      body: 'Click <b>Find my calendar link</b>. Gradebook+ opens Google Calendar, finds your <b>All Classes</b> calendar (the one with your class meetings) and connects it. If Chrome asks for permission, click <b>Allow</b>.',
      bullets: ['Make sure you’re signed in to Google with your school account first.'],
      target: function () { return document.getElementById('calendarFind'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-paste',
      icon: 'check',
      title: 'Or paste your calendar’s link',
      body: 'If you already have a link to your class calendar, click <b>I already have a calendar link</b>, paste it, and click <b>Connect calendar</b>. Links from Outlook and Apple Calendar work too.',
      target: function () { var m = document.getElementById('calendarManual'); return m && m.open ? m : (m && m.querySelector('summary')) || document.querySelector('.schedule-connect'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-check',
      icon: 'check',
      title: 'Step 2: Check that your classes appear',
      body: 'Once it’s connected, a green box shows your next class with its day and time. If that looks right, you’re done. There’s nothing to save.',
      target: function () { var st = document.getElementById('calendarStatus'); return st && st.textContent ? st : document.querySelector('.schedule-connect'); },
      tryIt: true, padding: 6
    }
  ];

  /* Each tutorial's stops (TourState.SECTIONS lists the tutorials), and the
   * card that ends it. */
  var paths = {
    grading: ['comments', 'submissions', 'statuses', 'spreadsheet', 'post'],
    student: ['student', 'si-overview', 'si-standout', 'si-work', 'si-activity', 'si-profile'],
    tools: ['total', 'menus', 'switcher', 'find', 'gear'],
    snippets: ['snip-what', 'snip-list', 'snip-drafts'],
    classes: ['classes-link', 'classes-copy', 'classes-compare'],
    groups: ['groups-button', 'groups-steps', 'groups-arrange'],
    schedule: ['schedule', 'opt-copy', 'opt-paste', 'opt-check']
  };

  /* The last card of each tutorial: just "Done", unless there is one more
   * thing the teacher has to do. */
  var finales = {
    schedule: { body: 'Try it: open any assignment in Canvas and click its Due date. That day’s classes appear beside it.' }
  };


  CGP.tourStops = stops.concat(groupStops, snippetStops, scheduleStops);
  CGP.tourStops.forEach(function (st) { if (ART[st.id]) st.art = ART[st.id]; });
  CGP.tourPaths = paths;
  CGP.tourFinales = finales;
  CGP.tourScheduleStops = scheduleStops;
  CGP.tourIcons = ICON;
  CGP.tourFind = { onScreen: onScreen, pick: pick };
  CGP.tourWaitFor = waitFor;
})();
