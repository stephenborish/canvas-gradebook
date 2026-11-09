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
      eyebrow: 'Welcome to Gradebook+',
      title: 'Grading in Canvas just got faster.',
      body: 'Take a quick look around your own gradebook. We’ll point out what’s new, then show you how to link your classes and connect your schedule. <strong>Nothing changes while you look.</strong>',
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
      meta: ['2 parts · about 4 minutes', '← → to move', 'Esc to skip']
    },
    {
      id: 'comments',
      icon: 'bubble',
      eyebrow: 'Feedback bubbles',
      title: 'See where you’ve left feedback',
      body: 'A <b class="c-blue">blue bubble</b> means <em>you</em> commented on that submission, and the number counts your comments. A <b class="c-purple">hollow purple bubble</b> means the student has replied since.',
      try: 'Click a bubble to read the thread and reply right here.',
      target: function () { return cellOf(pick('.cgp-cmt')); },
      fallback: assignmentCell,
      fallbackNote: 'No comments from you on screen yet. Leave one and its bubble appears in that cell.',
      tryIt: true,
      art: function () {
        return '<div class="legend">' +
          '<div class="lg">' + miniCell('92', BUBBLE) + '<span>You left feedback</span></div>' +
          '<div class="lg">' + miniCell('88', BUBBLE + '<span class="mk-cnt">3</span>') + '<span>3 comments from you</span></div>' +
          '<div class="lg">' + miniCell('75', '<span class="mk-cmt mk-cmt--reply"><svg viewBox="0 0 16 16"><path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.9a1.7 1.7 0 0 1-1.7 1.7H7.6l-3 2.6v-2.6h-.4a1.7 1.7 0 0 1-1.7-1.7z"/></svg></span>') + '<span>Student replied</span></div>' +
          '</div>';
      }
    },
    {
      id: 'submissions',
      icon: 'check',
      eyebrow: 'Submission badges',
      title: 'Spot who’s turned it in',
      body: 'The dot in each cell’s corner is <b class="c-green">solid green</b> once work is submitted and <b class="c-gray">hollow gray</b> until then. Hover it for the time and attempt.',
      try: 'Click a badge to open that student’s work in SpeedGrader, in a new tab.',
      target: function () { return cellOf(pick('.cgp-sub')); },
      fallback: assignmentCell,
      fallbackNote: 'Badges only appear on assignments submitted online, so paper work stays clean.',
      tryIt: true,
      art: function () {
        return '<div class="legend">' +
          '<div class="lg">' + miniCell('94', '<span class="mk-sub mk-sub--in"></span>') + '<span>Turned in</span></div>' +
          '<div class="lg">' + miniCell('–', '<span class="mk-sub mk-sub--out"></span>') + '<span>Not yet</span></div>' +
          '<div class="lg">' + miniCell('81', '<span class="mk-resub"></span>') + '<span>Resubmitted after grading</span></div>' +
          '</div>';
      }
    },
    {
      id: 'statuses',
      icon: 'keys',
      eyebrow: 'Status keys',
      title: 'Missing, Late, Excused: one key each',
      body: 'Click a grade cell and press a key. It saves to Canvas instantly, so students and SpeedGrader see it too.',
      bullets: [
        key('M', 'red') + ' Missing &nbsp;' + key('L', 'amber') + ' Late &nbsp;' + key('E', 'green') + ' Excused',
        'Press ' + key('M') + ' or ' + key('L') + ' again to undo it',
        key('-') + ' clears the grade and every status',
        'Typing a grade never adds a status'
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
      eyebrow: 'Spreadsheet grading',
      title: 'Grade like it’s a spreadsheet',
      body: 'Move, paste and fill many cells at once.',
      bullets: [
        key('Enter') + ' and ' + key('Tab') + ' move down and right; arrows go anywhere',
        '<b>Paste</b> a block from Sheets or Excel. It’s checked before anything saves.',
        key('⌘') + '/' + key('Ctrl') + '-click or ' + key('Shift') + '-click cells, then type a grade, ' + key('M') + key('E') + key('L') + ', or ' + key('C') + ' to comment on them all',
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
      title: 'Release hidden grades in one click',
      body: 'When students can’t see a column’s grades yet, its header shows a <b class="c-amber">Post</b> button with the count. Each hidden grade gets an amber bar on its cell.',
      target: function () { return headerOf('.cgp-post'); },
      fallback: assignmentHeader,
      fallbackNote: 'Every grade on screen is already visible to students. When one isn’t, the Post button appears in this header.',
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
      title: 'Click a name, see the whole picture',
      body: 'Each name opens an overview: grade, missing and late work, how they compare with the class, and their Canvas activity. Let’s open one.',
      try: 'Click the name, or press <b>Open overview</b>.',
      target: studentName,
      tryIt: true,
      primary: { label: 'Open overview', run: function (tour) { tour.next(); } },
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
      eyebrow: 'Overview tab',
      title: 'Their standing at a glance',
      body: 'Canvas’s current grade and last activity sit up top. The tiles sum up the term: missing work (with points at stake), late work, on-time rate, average vs. the class, and what needs grading.',
      bullets: ['Click a tile to see those assignments', key('←') + ' ' + key('→') + ' move to the previous or next student'],
      enter: openTab('overview', '#cgp-si-panel-overview .cgp-si__tiles', 4000),
      target: function () {
        var head = pick('.cgp-si__head');
        var tiles = pick('#cgp-si-panel-overview .cgp-si__tiles, .cgp-si__tiles');
        return head && tiles ? [head, tiles] : (tiles || head);
      },
      leave: closeOverview,
      fallbackArt: true,
      fallbackNote: 'The overview didn’t open here (it may be off in settings), so here’s what it looks like.',
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
      eyebrow: 'What stands out',
      title: 'What’s worth a closer look',
      body: 'Gradebook+ scans their record and ranks what needs attention: a pile of missing work, a rising late rate, a quiet week in Canvas, a trend up or down, or an unanswered reply to your feedback.',
      bullets: ['Beside it: their submission record and average by category vs. the class'],
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
      eyebrow: 'Assignments tab',
      title: 'A missing-work list, ready for parents',
      body: '<b>Copy List of Missing/Late Work</b> builds a clean list with due dates, days overdue, points and links. Paste it straight into an email to a parent or counselor.',
      bullets: [
        'Every assignment in one table, with the class median',
        'Filter to Missing, Late, Needs grading or Upcoming',
        '<b>View work</b> opens their submission, even in Turnitin or Edpuzzle'
      ],
      enter: openTab('work', '#cgp-si-panel-work .cgp-si__share, #cgp-si-panel-work .cgp-si__card', 4000),
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
      eyebrow: 'Activity tab',
      title: 'See how they engage with your course',
      body: 'Page views and participation against the class, a 16-week activity calendar, and when they tend to work and submit.',
      bullets: [
        '<b>Studio videos:</b> how much of each video they watched',
        '<b>Course content:</b> every page and file they’ve opened',
        'One search box finds any video or page by name or module'
      ],
      enter: openTab('activity', '#cgp-si-panel-activity .cgp-si__card', 6000),
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
      eyebrow: 'Total column',
      title: 'The final grade, always in view',
      body: 'Total stays beside the names however far you scroll, rounded to one decimal. Hover it for the letter grade. Low totals get a flag; set the cutoffs in settings.',
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
      eyebrow: 'Column menus',
      title: 'Analyze scores, copy the roster',
      body: 'An assignment’s <b>⋮</b> menu has <b>Analyze Scores</b>: mean, median, spread, top and bottom five, and a grade histogram. Total has it too. The Student Name menu has <b>Copy Roster</b>, for emails or a table.',
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
      title: 'Jump between your courses',
      body: 'The course name is now a menu of everything you teach. Pick a course and land on the same page there.',
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
      title: 'Find any student in any course',
      body: 'Type part of a name, in any order (“new tom” works). Pick them and their gradebook opens with their row highlighted.',
      try: 'Click <b>Find student</b> and type a name.',
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
      eyebrow: 'Gradebook settings',
      title: 'More room for your grades',
      body: 'Canvas’s toolbar is tucked away so the grid fills the window. This gear opens Canvas’s Gradebook Settings: sorting, late policy and posting.',
      bullets: [key('Alt') + key('Shift') + key('H') + ' brings Canvas’s toolbar back for this page'],
      target: function () { return pick('.cgp-settings-gear'); },
      optional: true,
      tryIt: true,
      padding: 6
    },
    {
      id: 'bridge',
      kind: 'center',
      icon: 'sparkle',
      eyebrow: 'Part 1 complete',
      title: 'Next: your classes and calendar',
      body: 'Part 2 runs on your course page and takes about a minute.',
      tiles: [
        { icon: 'link', t: 'Link your classes', d: 'Tell Gradebook+ which classes are the same course. Once.' },
        { icon: 'swap', t: 'Copy and compare', d: 'Post work to every class, each with its own dates.' },
        { icon: 'calendar', t: 'Class schedule', d: 'Click a class period to set a due time.' },
        { icon: 'bubble', t: 'SpeedGrader', d: 'Drafts are protected; <code>/snippet</code> + Tab adds a saved comment.' }
      ],
      primary: { label: 'Continue to part 2', run: function (tour) { tour.goChapter('classes'); } },
      secondary: { label: 'Finish for now', run: function (tour) { tour.end('completed'); } }
    },

    /* --------------------------------------------- part 2: the course home */
    {
      id: 'classes-link',
      chapter: 'classes',
      icon: 'link',
      eyebrow: 'Part 2 · Link your classes',
      title: 'Same course, several classes? Link them.',
      body: 'Start here. The first time you open <b>Copy to other classes</b>, it asks which of your classes (periods, blocks or sections) are the same course. Likely matches are suggested.',
      bullets: [
        'Choose once; it works from every linked class',
        'Your links follow you to other computers',
        'Nothing is copied until you press Copy'
      ],
      try: 'Click <b>Copy to other classes</b> to pick your classes.',
      target: function () { return pick('.cgp-copyto--home, .cgp-copyto'); },
      tryIt: true,
      fallbackArt: true,
      fallbackNote: '<b>Copy to other classes</b> is in the course home sidebar and next to <b>+ Module</b> on the Modules page. Don’t see it? It’s off in settings.',
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
      title: 'Build it once, post it everywhere',
      body: 'Copy assignments, quizzes, discussions, pages or whole modules to your linked classes, <b>each with its own due dates</b>. You preview every class before anything changes.',
      bullets: [
        '<b>Shift</b> a class by a few days, or give it one due time',
        'Copies land in the matching module and assignment group',
        'On an item’s page, the copy icon next to <b>Edit</b> copies just that item'
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
      title: 'Keep every class in step',
      body: '<b>Compare classes</b>, inside the copy window, checks every item against your other classes: up to date, missing, out of date or changed there. Tick what to fix and review it all at once.',
      bullets: [
        '<b>Post as you create:</b> the assignment editor has an <b>Also post to your other classes</b> panel above Save',
        'Fixed something in one class’s copy? Send it back to the original'
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
      title: 'Set due times by class period',
      body: 'Connect your class calendar and Canvas’s Due, Available from and Until boxes show that day’s classes. <b>Click a class to use its start time</b>, or its end time. Arrows step to other days.',
      bullets: ['Classes in the course you’re editing are marked <b>This course</b>', 'Works on assignments, quizzes, discussions and modules'],
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
      title: 'Connect it in two steps',
      steps: [
        { n: '1', t: 'Copy your calendar link', d: 'In Google Calendar, open <b>Settings</b>, click your class calendar, choose <b>Integrate calendar</b> and copy <b>Public URL to this calendar</b>.' },
        { n: '2', t: 'Paste it into Gradebook+', d: 'In <b>Class Schedule</b> settings, paste it, click <b>Connect</b>, check the preview, then click <b>Save changes</b>.' }
      ],
      body: 'Outlook, Apple and other <code>.ics</code> links work too. We’ll guide you on the settings page.',
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
      eyebrow: 'Tour complete',
      title: 'Happy grading!',
      body: 'Everything you saw is already on. To adjust or turn off a feature, click the Gradebook+ icon in your Chrome toolbar. You can replay this tour there too.'
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
      title: 'Turn on the class schedule',
      body: 'This shows your classes next to Canvas’s date and time boxes. It’s on by default.',
      target: function () { var el = document.getElementById('courseScheduleEnabled'); return el ? el.closest('.setting') : null; },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-copy',
      icon: 'link',
      eyebrow: 'Connect your calendar',
      title: 'Copy your link from Google Calendar',
      body: 'Click <b>Open Google Calendar settings</b>, choose your class calendar, open <b>Integrate calendar</b> and copy <b>Public URL to this calendar</b>. Then come back to this tab.',
      target: function () { return document.querySelector('.schedule-steps'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-paste',
      icon: 'check',
      eyebrow: 'Connect your calendar',
      title: 'Paste the link and click Connect',
      body: 'Chrome asks once for permission to read calendar.google.com, only for this calendar. A preview then shows your classes.',
      bullets: ['Not a public calendar? Paste its <b>Secret address in iCal format</b> instead'],
      target: function () { return document.querySelector('.schedule-connect'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-save',
      icon: 'sparkle',
      eyebrow: 'Connect your calendar',
      title: 'Save your changes',
      body: 'When the preview shows your classes, click <b>Save changes</b>. Then click any Due box in Canvas to see them.',
      target: function () { return document.getElementById('save'); },
      tryIt: true, padding: 6
    },
    {
      id: 'opt-done',
      kind: 'finale',
      eyebrow: 'Connect your calendar',
      title: 'That’s it',
      body: 'Once it’s saved, click any Due, Available from or Until box in Canvas, then click a class. Your calendar refreshes every six hours, or click <b>Refresh</b> in the panel.'
    }
  ];

  CGP.tourStops = stops;
  CGP.tourScheduleStops = scheduleStops;
  CGP.tourIcons = ICON;
  CGP.tourFind = { onScreen: onScreen, pick: pick };
})();
