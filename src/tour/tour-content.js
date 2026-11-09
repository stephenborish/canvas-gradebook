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
    flag: '<svg viewBox="0 0 20 20"><path d="M5 17.5V3M5 3.5h9.5l-2 3.4 2 3.4H5"/></svg>'
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
      body: 'This short tour runs right here, on your real gradebook. We’ll point at each thing Gradebook+ added so you can see it in place. <strong>Nothing is changed or saved while you look around.</strong>',
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
      meta: ['About 2 minutes', 'Use ← → to move', 'Esc to skip']
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
      body: 'Missing and late work with the points at stake, trends against the class, when they were last active, which Studio videos they watched — plus a ready-to-send list of missing work for parents or counselors.',
      try: 'Click this student’s name to open their overview. ' + key('←') + ' ' + key('→') + ' step through the class.',
      target: studentName,
      tryIt: true,
      art: function () {
        return '<div class="si-demo" aria-hidden="true">' +
          '<div class="si-top"><span class="si-av">JP</span><span class="si-nm">Jordan P.<small>Active today, 7:50 PM</small></span><span class="si-gr">B+<small>87.4%</small></span></div>' +
          '<div class="si-tiles"><span class="si-t si-t--red"><b>2</b>Missing</span><span class="si-t si-t--amber"><b>1</b>Late</span><span class="si-t si-t--green"><b>91%</b>On time</span></div>' +
          '</div>';
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
      id: 'beyond',
      kind: 'center',
      icon: 'sparkle',
      eyebrow: 'Beyond the gradebook',
      title: 'It’s working on your other Canvas pages too',
      tiles: [
        { icon: 'bubble', t: 'SpeedGrader', d: 'Drafts are protected, and <code>/snippet</code> + Tab expands your saved comments.' },
        { icon: 'swap', t: 'Copy to other classes', d: 'Send an assignment or page to your other sections, dates adjusted.' },
        { icon: 'gear', t: 'Class schedule', d: 'Pick due times by class period right in Assign To.' },
        { icon: 'check', t: 'Always in step', d: 'A grade saved anywhere shows everywhere — no reloading.' }
      ],
      action: { label: 'Open Gradebook+ settings', type: 'options' }
    },
    {
      id: 'done',
      kind: 'finale',
      eyebrow: 'You’re all set',
      title: 'Happy grading!',
      body: 'Everything you just saw is already switched on. Each feature can be adjusted or turned off in settings — click the Gradebook+ icon in your Chrome toolbar. You can replay this tour from there any time.'
    }
  ];

  CGP.tourStops = stops;
  CGP.tourIcons = ICON;
  CGP.tourFind = { onScreen: onScreen, pick: pick };
})();
