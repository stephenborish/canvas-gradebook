/* Canvas Gradebook+ - the stops of the welcome tour: what each one says, the
 * small illustration beside it, and which element of the real gradebook it
 * points at.
 *
 * Kept apart from tour.js (which draws and drives the tour) so the words can
 * be read and edited in one place. `target` returns an element on the page or
 * null; a stop with `optional: true` is left out when its element is not on
 * this gradebook (a feature switched off in the options page), and any other
 * stop falls back to `fallback`, and then to the middle of the screen. */
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

  function waitFor(test, ms) {
    return new Promise(function (resolve) {
      var hit = test();
      if (hit) { resolve(true); return; }
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (test()) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(false); }
      }, 120);
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
    if (tour) tour.synthetic = true;
    try { link.click(); } finally { if (tour) tour.synthetic = false; }
    return waitFor(function () { return !!document.querySelector('.cgp-si__panel'); }, 1500).then(function (opened) {
      return opened ? waitFor(loaded, 10000) : false;
    });
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
    sparkle: '<svg viewBox="0 0 20 20"><path d="M10 2.5l1.7 4.6 4.8 1.7-4.8 1.8L10 15.2 8.3 10.6 3.5 8.8l4.8-1.7z"/><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    flag: '<svg viewBox="0 0 20 20"><path d="M5 17.5V3M5 3.5h9.5l-2 3.4 2 3.4H5"/></svg>',
    link: '<svg viewBox="0 0 20 20"><path d="M8.5 11.5a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-1 1"/><path d="M11.5 8.5a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l1-1"/></svg>',
    calendar: '<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="13.5" rx="2"/><path d="M2.5 8.25h15M6.5 2.5v3M13.5 2.5v3M10 10.5v2.5l1.75 1"/></svg>'
  };

  function key(k, tone) { return '<kbd class="kc' + (tone ? ' kc--' + tone : '') + '">' + k + '</kbd>'; }

  function miniCell(value, marks) {
    return '<span class="mc"><span class="mc__v">' + value + '</span>' + (marks || '') + '</span>';
  }
  var BUBBLE = '<span class="mk-cmt"><svg viewBox="0 0 16 16"><path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.9a1.7 1.7 0 0 1-1.7 1.7H7.6l-3 2.6v-2.6h-.4a1.7 1.7 0 0 1-1.7-1.7z"/></svg></span>';

  /* ----------------------------------------------------------------- stops */

  var stops = [
    {
      id: 'welcome',
      kind: 'hero',
      eyebrow: 'Welcome to Canvas Gradebook+',
      title: 'Your gradebook just got a lot faster.',
      body: 'This short tour runs right here, on your real gradebook. We’ll point at each thing Gradebook+ added so you can see it in place \u2014 first your gradebook and student overviews, then your course page, where you link your class periods and connect your class schedule. <strong>Nothing is changed or saved while you look around.</strong>',
      art: function () {
        var rows = [
          ['92', BUBBLE, 'in'], ['88', '', 'in'], ['–', '<span class="mk-m">M</span>', 'out'], ['95', BUBBLE + '<span class="mk-cnt">2</span>', 'in'],
          ['81', '', 'in'], ['74', '<span class="mk-l">L</span>', 'in'], ['90', BUBBLE, 'in'], ['86', '', 'in'],
          ['–', '', 'out'], ['97', BUBBLE, 'in'], ['79', '', 'in'], ['84', '<span class="mk-cmt mk-cmt--reply"><svg viewBox="0 0 16 16"><path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.9a1.7 1.7 0 0 1-1.7 1.7H7.6l-3 2.6v-2.6h-.4a1.7 1.7 0 0 1-1.7-1.7z"/></svg></span>', 'in']
        ];
        var names = ['Avery K.', 'Jordan P.', 'Sam R.'];
        var html = '<div class="hero-grid">';
        html += '<div class="hg-row hg-head"><span class="hg-name">Student</span><span>Lab 3</span><span>Essay</span><span>Quiz 2</span><span>Lab 4</span></div>';
        for (var r = 0; r < 3; r++) {
          html += '<div class="hg-row" style="--r:' + r + '"><span class="hg-name">' + names[r] + '</span>';
          for (var c = 0; c < 4; c++) {
            var d = rows[r * 4 + c];
            html += '<span class="hg-cell" style="--i:' + (r * 4 + c) + '"><span class="mk-sub mk-sub--' + d[2] + '"></span>' + d[0] + d[1] + '</span>';
          }
          html += '</div>';
        }
        return html + '</div>';
      },
      meta: ['2 parts \u00b7 about 3 minutes', 'Use ← → to move', 'Esc to skip']
    },
    {
      id: 'comments',
      icon: 'bubble',
      eyebrow: 'Cell indicators',
      title: 'See your feedback at a glance',
      body: 'A <b class="c-blue">blue bubble</b> means <em>you</em> left a comment on that submission — not a student, not a co-teacher. A small number shows how many. A <b class="c-purple">hollow purple bubble</b> means the student replied after you.',
      try: 'Click a bubble to read the whole thread and reply — without leaving the gradebook.',
      target: function () { return cellOf(pick('.cgp-cmt')); },
      fallback: assignmentCell,
      fallbackNote: 'None of the cells on screen have a comment from you yet. As soon as you leave one, its bubble appears in the cell’s corner.',
      tryIt: true,
      art: function () {
        return '<div class="legend">' +
          '<div class="lg">' + miniCell('92', BUBBLE) + '<span>You left feedback</span></div>' +
          '<div class="lg">' + miniCell('88', BUBBLE + '<span class="mk-cnt">3</span>') + '<span>3 of your comments</span></div>' +
          '<div class="lg">' + miniCell('75', '<span class="mk-cmt mk-cmt--reply"><svg viewBox="0 0 16 16"><path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.9a1.7 1.7 0 0 1-1.7 1.7H7.6l-3 2.6v-2.6h-.4a1.7 1.7 0 0 1-1.7-1.7z"/></svg></span>') + '<span>Student replied since</span></div>' +
          '</div>';
      }
    },
    {
      id: 'submissions',
      icon: 'check',
      eyebrow: 'Cell indicators',
      title: 'Who handed it in?',
      body: 'The badge in a cell’s top corner is <b class="c-green">solid green</b> once the student has submitted, and <b class="c-gray">hollow gray</b> while nothing has come in. Hover it for the time and attempt number.',
      try: 'Click a badge to open that student’s work in SpeedGrader, in a new tab — you keep your place here.',
      target: function () { return cellOf(pick('.cgp-sub')); },
      fallback: assignmentCell,
      fallbackNote: 'Badges show on assignments students submit online. On-paper and no-submission work gets none, on purpose.',
      tryIt: true,
      art: function () {
        return '<div class="legend">' +
          '<div class="lg">' + miniCell('94', '<span class="mk-sub mk-sub--in"></span>') + '<span>Handed in</span></div>' +
          '<div class="lg">' + miniCell('–', '<span class="mk-sub mk-sub--out"></span>') + '<span>Not yet</span></div>' +
          '<div class="lg">' + miniCell('81', '<span class="mk-resub"></span>') + '<span>Resubmitted since you graded</span></div>' +
          '</div>';
      }
    },
    {
      id: 'statuses',
      icon: 'keys',
      eyebrow: 'One-keystroke statuses',
      title: 'Missing, Late, Excused — one key each',
      body: 'Click into any grade cell and press a single key. It’s saved to Canvas right away, so students, SpeedGrader and the Grade Detail Tray all see it.',
      bullets: [
        key('M', 'red') + ' Missing &nbsp;' + key('L', 'amber') + ' Late &nbsp;' + key('E', 'green') + ' Excused',
        key('M') + ' or ' + key('L') + ' again takes it back off',
        key('-') + ' clears the grade and every status',
        'Typing a grade never adds a status by itself'
      ],
      target: assignmentCell,
      art: function () {
        return '<div class="status-demo" aria-hidden="true">' +
          '<span class="sd-cell"><span class="sd-v">–</span><span class="sd-m">M</span><span class="sd-cursor"></span></span>' +
          '<span class="sd-press">' + key('M', 'red') + '</span>' +
          '</div>';
      }
    },
    {
      id: 'spreadsheet',
      icon: 'grid',
      eyebrow: 'Grade like a spreadsheet',
      title: 'Move, paste and fill many cells at once',
      body: 'The grid now behaves the way your hands expect it to.',
      bullets: [
        key('Enter') + ' / ' + key('Tab') + ' move down / right, arrows move anywhere',
        '<b>Paste</b> a block straight from Sheets or Excel — checked before a single grade is written',
        key('⌘') + '/' + key('Ctrl') + '-click or ' + key('Shift') + '-click to select cells, then type a grade, ' + key('M') + key('E') + key('L') + ', or ' + key('C') + ' to comment on all of them',
        '<b>Double-click</b> a cell to open its Grade Detail Tray'
      ],
      target: gridArea,
      fallback: assignmentCell,
      padding: 0,
      art: function () {
        var html = '<div class="sel-demo" aria-hidden="true">';
        var v = ['8', '9', '7', '10', '6', '9', '10', '8', '9', '7', '8', '10'];
        for (var i = 0; i < 12; i++) html += '<span class="sdc" style="--i:' + i + '"><span>' + v[i] + '</span></span>';
        return html + '<span class="sel-rect"></span></div>';
      }
    },
    {
      id: 'post',
      icon: 'eye',
      eyebrow: 'Post grades',
      title: 'Post hidden grades in one click',
      body: 'When a column holds grades students can’t see yet, its header grows a <b class="c-amber">Post</b> button with the count waiting. Press it and they’re released. Each hidden grade also gets an amber bar down its cell’s edge.',
      target: function () { return headerOf('.cgp-post'); },
      fallback: assignmentHeader,
      fallbackNote: 'Every grade on screen is already visible to students, so there’s nothing to post. When there is, the button appears right in this header.',
      tryIt: false,
      art: function () {
        return '<div class="post-demo" aria-hidden="true">' +
          '<div class="pd-head"><span>Unit 2 Test</span><span class="pd-btn">Post 12</span></div>' +
          '<div class="pd-cell pd-cell--hid">88</div><div class="pd-cell pd-cell--hid">93</div><div class="pd-cell">76</div>' +
          '</div>';
      }
    },
    {
      id: 'student',
      icon: 'person',
      eyebrow: 'Student overview',
      title: 'One click on a name tells the whole story',
      body: 'Every student’s name opens a full overview — their grade, missing and late work, how they compare with the class, and how active they’ve been in Canvas. Let’s open one together.',
      try: 'Click this name yourself, or press <b>Open their overview</b> below.',
      target: studentName,
      tryIt: true,
      primary: { label: 'Open their overview', run: function (tour) { tour.next(); } },
      onShow: function (tour, el) { tour.siCell = el; },
      art: function () {
        return '<div class="si-demo" aria-hidden="true">' +
          '<div class="si-top"><span class="si-av">JP</span><span class="si-nm">Jordan P.<small>Active today, 7:50 PM</small></span><span class="si-gr">B+<small>87.4%</small></span></div>' +
          '<div class="si-tiles"><span class="si-t si-t--red"><b>2</b>Missing</span><span class="si-t si-t--amber"><b>1</b>Late</span><span class="si-t si-t--green"><b>91%</b>On time</span></div>' +
          '</div>';
      }
    },
    {
      id: 'si-overview',
      group: 'si',
      icon: 'person',
      eyebrow: 'Student overview · Overview',
      title: 'Their grade and the numbers that matter',
      body: 'The header shows Canvas’s own current grade and when they were last active. The tiles below sum up the term: <b>Missing</b> (with the points at stake), <b>Late</b>, <b>on-time rate</b>, <b>average</b> against the class median, <b>needs grading</b> and <b>last active</b>.',
      bullets: ['Click any tile to jump straight to those assignments', key('←') + ' ' + key('→') + ' move to the previous or next student without closing'],
      enter: openOverview,
      target: function () {
        var head = pick('.cgp-si__head');
        var tiles = pick('#cgp-si-panel-overview .cgp-si__tiles, .cgp-si__tiles');
        return head && tiles ? [head, tiles] : (tiles || head);
      },
      leave: closeOverview,
      fallbackArt: true,
      fallbackNote: 'This student’s overview didn’t open here (it may be switched off in settings), so here’s what it looks like.',
      art: function () {
        return '<div class="si-demo" aria-hidden="true">' +
          '<div class="si-top"><span class="si-av">JP</span><span class="si-nm">Jordan P.<small>Last active today at 7:50 PM · 14h in course</small></span><span class="si-gr">B+<small>87.4%</small></span></div>' +
          '<div class="si-tiles si-tiles--6"><span class="si-t si-t--red"><b>2</b>Missing · 35 pts</span><span class="si-t si-t--amber"><b>1</b>Late · 8%</span><span class="si-t si-t--green"><b>91%</b>On time</span>' +
          '<span class="si-t"><b>88%</b>Avg · class 84%</span><span class="si-t"><b>3</b>Needs grading</span><span class="si-t"><b>Today</b>Last active</span></div>' +
          '</div>';
      }
    },
    {
      id: 'si-standout',
      group: 'si',
      icon: 'sparkle',
      eyebrow: 'Student overview · What stands out',
      title: 'The things worth noticing, ranked for you',
      body: 'Gradebook+ reads the student’s whole record and lists what deserves a second look: several missing assignments, a rising late rate, no Canvas activity for a week, scores trending up or down, an unanswered reply to your feedback, or a habit of submitting in the last two hours.',
      bullets: ['Beside it: the <b>submission record</b> as one bar, and their <b>average by category</b> against the class median'],
      enter: openOverview,
      target: function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll('.cgp-si__card'));
        var hit = cards.filter(function (c) {
          var h = c.querySelector('h3');
          return h && /what stands out/i.test(h.textContent || '') && onScreen(c);
        })[0];
        return hit || null;
      },
      leave: closeOverview,
      fallbackArt: true,
      art: function () {
        return '<div class="standout" aria-hidden="true">' +
          '<div class="so so--red"><b>3 missing assignments</b><span>Lab 4, Essay 2, Quiz 5 · 45 points</span></div>' +
          '<div class="so so--amber"><b>Usually submits in the last 2 hours</b><span>7 of 11 on-time submissions</span></div>' +
          '<div class="so so--green"><b>Scores trending up</b><span>+9 points over the last four</span></div>' +
          '</div>';
      }
    },
    {
      id: 'si-work',
      group: 'si',
      icon: 'check',
      eyebrow: 'Student overview · Assignments',
      title: 'Every assignment, and a list ready for parents',
      body: '<b>Copy List of Missing/Late Work</b> builds a tidy list — due dates, days overdue, points, links — that pastes as a table into Gmail, Outlook or Docs. Perfect for a parent or counselor email.',
      bullets: [
        'Every assignment in one table: due, submitted, score and the class median',
        'Filter to Missing, Late, Needs grading or Upcoming, or search by name, module or date',
        '<b>View work</b> opens their submission — or launches Turnitin, Edpuzzle and other tools on their work'
      ],
      enter: function (tour) {
        return openOverview(tour).then(function (ok) {
          if (!ok) return false;
          var tab = document.querySelector('.cgp-si__tabs [data-si-tab="work"]');
          if (tab) tab.click();
          return waitFor(function () { return pick('#cgp-si-panel-work .cgp-si__share, #cgp-si-panel-work .cgp-si__card'); }, 4000);
        });
      },
      target: function () {
        var share = pick('#cgp-si-panel-work .cgp-si__share');
        if (share) return share.closest('.cgp-si__card') || share;
        return pick('#cgp-si-panel-work .cgp-si__card') || pick('#cgp-si-panel-work');
      },
      leave: closeOverview,
      fallbackArt: true,
      art: function () {
        return '<div class="mail-demo" aria-hidden="true"><div class="md-head"><span>Missing &amp; late work</span><span class="md-btn">Copy</span></div>' +
          '<div class="md-row"><b>Lab 4: Enzymes</b><span>Due Oct 12 · 9 days overdue · 20 pts</span></div>' +
          '<div class="md-row"><b>Essay 2</b><span>Due Oct 18 · 3 days overdue · 15 pts</span></div>' +
          '<div class="md-row md-row--late"><b>Quiz 5</b><span>Turned in Oct 20 · 1 day late</span></div></div>';
      }
    },
    {
      id: 'si-activity',
      group: 'si',
      icon: 'chart',
      eyebrow: 'Student overview · Activity',
      title: 'How they actually engage with your course',
      body: 'From Canvas course analytics: page views and participation with their percentile in the class, a 16-week calendar of daily activity, when in the day they work, and how close to deadlines they submit.',
      bullets: [
        '<b>Studio videos</b>: what share of each video they watched, and where it’s posted',
        '<b>Course content opened</b>: every page and file from their Access Report, by module',
        'One search box finds any video or page by name, type or module'
      ],
      enter: function (tour) {
        return openOverview(tour).then(function (ok) {
          if (!ok) return false;
          var tab = document.querySelector('.cgp-si__tabs [data-si-tab="activity"]');
          if (tab) tab.click();
          return waitFor(function () { return pick('#cgp-si-panel-activity .cgp-si__card'); }, 6000);
        });
      },
      target: function () {
        var heat = pick('#cgp-si-panel-activity .cgp-si__heat-cell');
        if (heat && heat.closest('.cgp-si__card')) return heat.closest('.cgp-si__card');
        return pick('#cgp-si-panel-activity .cgp-si__card') || pick('#cgp-si-panel-activity');
      },
      leave: closeOverview,
      fallbackArt: true,
      art: function () {
        var html = '<div class="heat" aria-hidden="true">';
        var seed = [0, 1, 2, 3, 1, 0, 0, 2, 3, 4, 2, 1, 0, 1, 3, 4, 4, 2, 1, 0, 0, 1, 2, 3, 2, 3, 1, 0, 2, 4, 3, 2, 1, 1, 0, 3, 4, 4, 3, 2, 0, 0, 1, 2, 4, 3, 2, 1, 0];
        for (var i = 0; i < 49; i++) html += '<span class="h' + seed[i] + '" style="--i:' + i + '"></span>';
        return html + '</div><div class="heat-cap"><span>16 weeks of daily page views</span><span>78th percentile</span></div>';
      }
    },
    {
      id: 'total',
      icon: 'total',
      eyebrow: 'Total, always in view',
      title: 'The grade that matters stays put',
      body: 'Canvas’s Total sits right beside the names however far you scroll, rounded to one decimal. Hover it for the letter grade. Totals that need attention get a flag — you choose the cutoffs and icons in settings.',
      target: function () { return headerOf('.cgp-header-total') || headerOf('.slick-header-column[id*="total_grade"]'); },
      optional: true,
      art: function () {
        return '<div class="legend">' +
          '<div class="lg">' + miniCell('93.5%', '') + '<span>On track</span></div>' +
          '<div class="lg">' + miniCell('74.2%', '<span class="mk-flag mk-flag--amber">' + ICON.flag + '</span>') + '<span>Worth a look</span></div>' +
          '<div class="lg">' + miniCell('66.9%', '<span class="mk-flag mk-flag--red">!</span>') + '<span>Needs attention</span></div>' +
          '</div>';
      }
    },
    {
      id: 'menus',
      icon: 'chart',
      eyebrow: 'In every ⋮ menu',
      title: 'Analyze scores, copy the roster',
      body: 'Open an assignment’s <b>⋮</b> menu for <b>Analyze Scores</b>: mean, median, spread, top and bottom five and a histogram by letter grade. The Total has it too. The Student Name menu adds <b>Copy Roster</b> — emails or a tidy table, ready to paste.',
      target: assignmentHeader,
      art: function () {
        var bars = [18, 34, 62, 88, 54, 26];
        var html = '<div class="hist" aria-hidden="true">';
        bars.forEach(function (h, i) { html += '<span style="--h:' + h + '%;--i:' + i + '"></span>'; });
        html += '</div><div class="hist-axis"><span>F</span><span>D</span><span>C</span><span>B</span><span>A</span><span>A+</span></div>';
        return html;
      }
    },
    {
      id: 'switcher',
      icon: 'swap',
      eyebrow: 'Course switcher',
      title: 'Hop between your courses',
      body: 'The course name up here is now a menu of every course you teach. Pick one and you land on the same page there — gradebook to gradebook, assignments to assignments.',
      try: 'Click it to see your courses.',
      target: function () { return pick('.cgp-crumb-toggle', function (el) { return !el.classList.contains('cgp-find-student') && !el.classList.contains('cgp-settings-gear'); }); },
      optional: true,
      tryIt: true,
      padding: 6
    },
    {
      id: 'find',
      icon: 'search',
      eyebrow: 'Find student',
      title: 'Find any student, in any course',
      body: 'Type a few letters of a name — in any order, like “new tom” — and pick them. Their gradebook opens with their row highlighted, even if they’re in another course.',
      try: 'Click Find student and type a name.',
      target: function () { return pick('.cgp-find-student'); },
      optional: true,
      tryIt: true,
      padding: 6,
      art: function () {
        return '<div class="find-demo" aria-hidden="true"><div class="fd-box">' + ICON.search + '<span class="fd-typed"></span></div>' +
          '<div class="fd-hit"><b>Tommy Newnam</b><span>Biology · Period 3</span></div></div>';
      }
    },
    {
      id: 'gear',
      icon: 'gear',
      eyebrow: 'A calmer page',
      title: 'Canvas’s toolbar, tidied away',
      body: 'Filters, Sync, Import and Export are folded away so the grid gets the whole window. This gear opens Canvas’s own Gradebook Settings — sorting, late policies, posting policy.',
      bullets: [key('Alt') + key('Shift') + key('H') + ' brings Canvas’s controls back for this page'],
      target: function () { return pick('.cgp-settings-gear'); },
      optional: true,
      tryIt: true,
      padding: 6
    },
    {
      id: 'bridge',
      kind: 'center',
      icon: 'sparkle',
      eyebrow: 'Part 1 done · Up next',
      title: 'Next: your classes and your calendar',
      body: 'The rest of Gradebook+ lives on your course page. Part 2 takes about a minute.',
      tiles: [
        { icon: 'link', t: 'Link your classes', d: 'Tell Gradebook+ which periods are the same course — once.' },
        { icon: 'swap', t: 'Copy & compare', d: 'Post work to every period with its own dates, and see what’s out of step.' },
        { icon: 'calendar', t: 'Class schedule', d: 'Connect your calendar, then click a class to set a due time.' },
        { icon: 'bubble', t: 'SpeedGrader', d: 'Drafts are protected; <code>/snippet</code> + Tab expands saved comments.' }
      ],
      primary: { label: 'Continue on my course page', run: function (tour) { tour.goChapter('classes'); } },
      secondary: { label: 'Finish for now', run: function (tour) { tour.end('completed'); } }
    },

    /* --------------------------------------------- part 2: the course home */
    {
      id: 'classes-link',
      chapter: 'classes',
      icon: 'link',
      eyebrow: 'Part 2 · Link your classes',
      title: 'Teach the same course to several periods? Link them once.',
      body: 'This button is where it starts. The first time you open it, Gradebook+ asks <b>which of your classes are the same course as this one</b> — your other periods or blocks. Same-named courses in the same term are suggested for you.',
      bullets: [
        'You choose once; the link works from every one of those classes',
        'It follows you to your other computers through Chrome sync',
        'Nothing is copied until you press Copy'
      ],
      try: 'Click <b>Copy to other classes</b> to see step 1 — choosing your classes.',
      target: function () { return pick('.cgp-copyto--home, .cgp-copyto'); },
      tryIt: true,
      fallbackArt: true,
      fallbackNote: '<b>Copy to other classes</b> sits in the course home’s right sidebar, under Import Existing Content (and beside + Module on the Modules page). If it’s missing, it’s switched off in settings.',
      art: function () {
        return '<div class="link-demo" aria-hidden="true">' +
          '<span class="ld-c ld-c--here">Biology<small>Period 2 · this class</small></span>' +
          '<span class="ld-line"></span>' +
          '<div class="ld-list">' +
          '<label class="ld-opt" style="--i:0"><span class="ld-box ld-box--on"></span>Biology · Period 4<em>suggested</em></label>' +
          '<label class="ld-opt" style="--i:1"><span class="ld-box ld-box--on"></span>Biology · Period 6<em>suggested</em></label>' +
          '<label class="ld-opt" style="--i:2"><span class="ld-box"></span>Chemistry · Period 3</label>' +
          '</div></div>';
      }
    },
    {
      id: 'classes-copy',
      chapter: 'classes',
      kind: 'center',
      icon: 'swap',
      eyebrow: 'Part 2 · Copy to other classes',
      title: 'Build it once, post it to every period',
      body: 'Pick assignments, quizzes, discussions, pages or whole modules and copy them to your linked classes in one step — <b>each class with its own due dates</b>. You see what will happen in each class before anything changes.',
      bullets: [
        '<b>Shift</b> a whole class by a few days, or set its <b>due time</b> in one box',
        'Copies land in the matching module and assignment group, not “Imported Assignments”',
        'On an assignment’s own page, the copy icon beside <b>Edit</b> copies just that one'
      ],
      art: function () {
        return '<div class="copy-demo" aria-hidden="true">' +
          '<div class="cd-item">' + ICON.check + '<b>Lab 5: Photosynthesis</b></div>' +
          '<div class="cd-arrow"></div>' +
          '<div class="cd-dests">' +
          '<div class="cd-d" style="--i:0"><b>Period 4</b><span>Due Tue 10/14 · 9:50 AM</span></div>' +
          '<div class="cd-d" style="--i:1"><b>Period 6</b><span>Due Tue 10/14 · 1:45 PM</span></div>' +
          '</div></div>';
      }
    },
    {
      id: 'classes-compare',
      chapter: 'classes',
      kind: 'center',
      icon: 'grid',
      eyebrow: 'Part 2 · Compare classes',
      title: 'See what’s out of step between your periods',
      body: '<b>Compare classes</b> (inside the copy window) lists everything in this class against each linked class: what’s up to date, missing, out of date, or changed there. Tick what to fix and review it in one go.',
      bullets: [
        '<b>Post it while you make it:</b> when you create or edit an assignment, an <b>Also post to your other classes</b> panel sits above Save — tick classes, set their dates, press Save',
        'An edit made in one period’s copy can be reviewed and brought back to the original'
      ],
      art: function () {
        var rows = [
          ['Lab 5: Photosynthesis', ['ok', 'ok']],
          ['Unit 3 Quiz', ['ok', 'miss']],
          ['Essay 2 rubric', ['old', 'ok']],
          ['Week 6 module', ['chg', 'old']]
        ];
        var lab = { ok: '✓ Up to date', miss: '+ Missing', old: '↻ Out of date', chg: '✎ Changed there' };
        var html = '<div class="board-demo" aria-hidden="true"><div class="bd-row bd-head"><span>Item</span><span>Period 4</span><span>Period 6</span></div>';
        rows.forEach(function (r, i) {
          html += '<div class="bd-row" style="--i:' + i + '"><span>' + r[0] + '</span>' +
            r[1].map(function (c) { return '<span class="bd-c bd-c--' + c + '">' + lab[c] + '</span>'; }).join('') + '</div>';
        });
        return html + '</div>';
      }
    },
    {
      id: 'schedule',
      chapter: 'classes',
      kind: 'center',
      icon: 'calendar',
      eyebrow: 'Part 2 · Class schedule',
      title: 'Set due dates by class period, in one click',
      body: 'Connect the calendar that holds your classes, and every <b>Due</b>, <b>Available from</b> and <b>Until</b> box in Canvas’s Assign To shows that day’s schedule beside it. <b>Click a class and its start time goes in</b> (or its end time). The arrows step to another day — “next Tuesday, start of 3rd period” is one click.',
      bullets: ['Your classes for the course you’re editing are marked <b>This course</b>', 'Works on quizzes, discussions, modules and in Also post to your other classes'],
      art: function () {
        return '<div class="assign-demo" aria-hidden="true">' +
          '<div class="ad-field"><span class="ad-lab">Due date</span><span class="ad-in">Tue, Oct 14</span><span class="ad-in ad-in--time"><span class="ad-t"></span></span></div>' +
          '<div class="ad-pop"><div class="ad-day"><span>‹</span><b>Tuesday, Oct 14</b><span>›</span></div>' +
          '<div class="ad-ev ad-ev--all">A Day</div>' +
          '<div class="ad-cls"><b>AP Biology P1</b><span>8:55 – 9:50 AM · Rm 204</span></div>' +
          '<div class="ad-cls ad-cls--pick"><b>Biology P3</b><em>This course</em><span>10:45 – 11:40 AM · Rm 204</span></div>' +
          '<div class="ad-cls"><b>Biology P6</b><span>1:45 – 2:40 PM · Rm 204</span></div>' +
          '</div></div>';
      }
    },
    {
      id: 'schedule-connect',
      chapter: 'classes',
      kind: 'center',
      icon: 'link',
      eyebrow: 'Part 2 · Connect your calendar',
      title: 'Two steps to connect it',
      steps: [
        { n: '1', t: 'Copy your calendar’s link', d: 'In Google Calendar: <b>Settings</b> → click the calendar that holds your classes → <b>Integrate calendar</b> → copy <b>Public URL to this calendar</b>.' },
        { n: '2', t: 'Paste it in Gradebook+', d: 'In settings → <b>Class Schedule</b>, paste the link, click <b>Connect</b>, check the preview shows your classes, then <b>Save changes</b>.' }
      ],
      body: 'Outlook, Apple and school-system <code>.ics</code> links work too. We’ll walk you through it on the settings page.',
      art: function () {
        return '<div class="gcal" aria-hidden="true"><span class="gcal-lab">Public URL to this calendar</span>' +
          '<span class="gcal-url">https://calendar.google.com/calendar/embed?src=c_8f2…</span><span class="gcal-copy">Copied!</span></div>';
      },
      primary: { label: 'Connect my calendar', run: function (tour) { tour.openOptions('schedule-tour'); tour.next(); } },
      secondary: { label: 'Later', run: function (tour) { tour.next(); } }
    },
    {
      id: 'done',
      chapter: 'classes',
      kind: 'finale',
      eyebrow: 'You’re all set',
      title: 'Happy grading!',
      body: 'Everything you just saw is already switched on. Each feature can be adjusted or turned off in settings — click the Gradebook+ icon in your Chrome toolbar. You can replay this tour from there any time.'
    }
  ];

  /* The guided setup on the options page's Class Schedule tab (opened from
   * "Connect my calendar"). The teacher types and clicks here, so the tour
   * never holds keys back and every stop lets clicks through. */
  var scheduleStops = [
    {
      id: 'opt-on',
      icon: 'calendar',
      eyebrow: 'Connect your calendar',
      title: 'Make sure the class schedule is on',
      body: 'This switch shows your schedule beside Canvas’s date and time boxes. It’s on by default.',
      target: function () { var el = document.getElementById('courseScheduleEnabled'); return el ? el.closest('.setting') : null; },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-copy',
      icon: 'link',
      eyebrow: 'Connect your calendar',
      title: 'Copy the link from Google Calendar',
      body: 'Click <b>Open Google Calendar settings</b> (it opens in a new tab), pick the calendar that holds your classes, open <b>Integrate calendar</b>, and copy <b>Public URL to this calendar</b>. Then come back to this tab.',
      target: function () { return document.querySelector('.schedule-steps'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-paste',
      icon: 'check',
      eyebrow: 'Connect your calendar',
      title: 'Paste it here and click Connect',
      body: 'Chrome asks once to let Gradebook+ read <b>calendar.google.com</b> — only to fetch this calendar. A preview then shows the classes it found.',
      bullets: ['Calendar not public? Use its <b>Secret address in iCal format</b> instead — it works without making it public'],
      target: function () { return document.querySelector('.schedule-connect'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-save',
      icon: 'sparkle',
      eyebrow: 'Connect your calendar',
      title: 'Save, and you’re done',
      body: 'Once the preview shows your classes, click <b>Save changes</b>. Then open any assignment’s Assign To in Canvas and click a Due box — your classes are right there.',
      target: function () { return document.getElementById('save'); },
      tryIt: true, padding: 6
    },
    {
      id: 'opt-done',
      kind: 'finale',
      eyebrow: 'Calendar connected',
      title: 'Pick due times by class period',
      body: 'Click any Due, Available from or Until box in Canvas, then click a class. The calendar is re-read every six hours, or with <b>Refresh</b> in the panel.'
    }
  ];

  CGP.tourStops = stops;
  CGP.tourScheduleStops = scheduleStops;
  CGP.tourIcons = ICON;
  CGP.tourFind = { onScreen: onScreen, pick: pick };
})();
