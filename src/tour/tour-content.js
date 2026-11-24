/* Canvas Gradebook+ - the tutorials: what each stop says, the small
 * illustration beside it, and which element of the real page it points at.
 * The list of tutorials, their titles and where each runs is in
 * tour-state.js (TourState.SECTIONS); `paths` below gives each one's stops.
 * Each card is labelled with its tutorial's name, so stops carry no label.
 *
 * Writing for these cards:
 *  - Title: plain words for what the card is about, or what to do. No slogans.
 *  - Body: instructions, in the order the teacher does them ("Click X, then
 *    Y"). Name buttons in bold, exactly as they read on screen.
 *  - Leave out what the teacher can already see, reassurance nobody asked
 *    for, and anything that only sounds nice.
 *  - At most two short sentences, or three bullets for parallel items.
 *  - Every claim is checked against the feature's code; change the card
 *    when the feature changes.
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
    sparkle: '<svg viewBox="0 0 20 20"><path d="M10 2.5l1.7 4.6 4.8 1.7-4.8 1.8L10 15.2 8.3 10.6 3.5 8.8l4.8-1.7z"/><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    flag: '<svg viewBox="0 0 20 20"><path d="M5 17.5V3M5 3.5h9.5l-2 3.4 2 3.4H5"/></svg>',
    link: '<svg viewBox="0 0 20 20"><path d="M8.5 11.5a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-1 1"/><path d="M11.5 8.5a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l1-1"/></svg>',
    people: '<svg viewBox="0 0 20 20"><circle cx="7" cy="6.5" r="2.8"/><circle cx="14" cy="7.3" r="2.3"/><path d="M2 16.5c.4-3 2.4-4.7 5-4.7s4.6 1.7 5 4.7M12.2 12.2c.6-.3 1.2-.5 1.9-.5 2.1 0 3.6 1.5 3.9 4.1"/></svg>',
    calendar: '<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="13.5" rx="2"/><path d="M2.5 8.25h15M6.5 2.5v3M13.5 2.5v3M10 10.5v2.5l1.75 1"/></svg>'
  };

  function key(k, tone) { return '<kbd class="kc' + (tone ? ' kc--' + tone : '') + '">' + k + '</kbd>'; }

  function miniCell(value, marks) {
    return '<span class="mc"><span class="mc__v">' + value + '</span>' + (marks || '') + '</span>';
  }
  var BUBBLE = '<span class="mk-cmt"><svg viewBox="0 0 16 16"><path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.9a1.7 1.7 0 0 1-1.7 1.7H7.6l-3 2.6v-2.6h-.4a1.7 1.7 0 0 1-1.7-1.7z"/></svg></span>';

  /* The feedback-bubble legend. Every bubble is the same blue: a student's
   * reply shows in the hover preview, not as a colour. */
  function commentLegend() {
    return '<div class="legend">' +
      '<div class="lg">' + miniCell('92', BUBBLE) + '<span>You left feedback</span></div>' +
      '<div class="lg">' + miniCell('88', BUBBLE.replace('</span>', '<span class="mk-cnt">3</span></span>')) + '<span>3 comments from you</span></div>' +
      '</div>';
  }

  /* ----------------------------------------------------------------- stops */

  var stops = [
    /* ------------------------------------------ Grading basics (gradebook) */
    {
      id: 'comments',
      icon: 'bubble',
      title: 'Blue bubble: you left feedback',
      body: 'A number on the bubble is how many comments you left. Hover over it to read the latest one and see if the student replied.',
      try: 'Click a bubble to open the comments and reply.',
      target: function () { return cellOf(pick('.cgp-cmt')); },
      fallback: assignmentCell,
      fallbackNote: 'No feedback on screen yet. When you comment on a submission, a bubble appears in its cell.',
      tryIt: true,
      art: commentLegend
    },
    {
      id: 'submissions',
      icon: 'check',
      title: 'Green badge: work turned in',
      body: '<b class="c-green">Solid green</b> means submitted; <b class="c-gray">hollow gray</b> means not yet. Hover over a badge to see when it came in.',
      try: 'Click a badge to open that work in SpeedGrader (in a new tab).',
      target: function () { return cellOf(pick('.cgp-sub')); },
      fallback: assignmentCell,
      fallbackNote: 'Badges appear only on assignments submitted online.',
      tryIt: true,
      art: function () {
        return '<div class="legend">' +
          '<div class="lg">' + miniCell('94', '<span class="mk-sub mk-sub--in"></span>') + '<span>Turned in</span></div>' +
          '<div class="lg">' + miniCell('–', '<span class="mk-sub mk-sub--out"></span>') + '<span>Not yet</span></div>' +
          '<div class="lg">' + miniCell('81', '<span class="mk-sub mk-sub--in"></span><span class="mk-resub"></span>') + '<span>Resubmitted after grading</span></div>' +
          '</div>';
      }
    },
    {
      id: 'statuses',
      icon: 'keys',
      title: 'Mark Missing, Late or Excused with one key',
      body: 'Click a grade cell, then press a key. It saves to Canvas right away.',
      bullets: [
        key('M', 'red') + ' Missing &nbsp;' + key('L', 'amber') + ' Late &nbsp;' + key('E', 'green') + ' Excused',
        'Press ' + key('M') + ' or ' + key('L') + ' again to remove it'
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
      title: 'Enter many grades at once',
      bullets: [
        '<b>Paste</b> grades copied from Sheets or Excel. Gradebook+ checks them before saving.',
        'Select several cells with ' + key('Ctrl') + '-click (' + key('⌘') + '-click on a Mac) or ' + key('Shift') + '-click. Type a number and press ' + key('Enter') + ' to give them all that grade.',
        'With cells selected, press ' + key('M') + ', ' + key('L') + ' or ' + key('E') + ' to mark them all, or ' + key('C') + ' to comment on them all.'
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
      title: 'Post hidden grades from the column header',
      body: 'If students can’t see some grades in a column yet, its header shows a <b>Post</b> button with a count. Clicking it releases them to students right away.',
      target: function () { return headerOf('.cgp-post'); },
      fallback: assignmentHeader,
      fallbackNote: 'All grades on screen are already visible to students. When some aren’t, a Post button appears in that column’s header.',
      tryIt: false,
      art: function () {
        return '<div class="post-demo" aria-hidden="true">' +
          '<div class="pd-head"><span>Unit 2 Test</span><span class="pd-btn">Post 12</span></div>' +
          '<div class="pd-cell">88</div><div class="pd-cell">93</div><div class="pd-cell">76</div>' +
          '</div>';
      }
    },

    /* ---------------------------------------- Student overview (gradebook) */
    {
      id: 'student',
      icon: 'person',
      title: 'Open a student’s overview',
      body: 'Click any student’s name, or press <b>Open overview</b> to open this one.',
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
      title: 'Overview: where they stand',
      body: 'Their current grade is at the top. The tiles count missing, late and ungraded work, and compare their average with the class.',
      bullets: ['Click <b>Missing</b>, <b>Late</b> or <b>Needs grading</b> to see those assignments', key('←') + ' ' + key('→') + ' switch to the previous or next student'],
      enter: openTab('overview', '#cgp-si-panel-overview .cgp-si__tiles', 4000),
      target: function () {
        var head = pick('.cgp-si__head');
        var tiles = pick('#cgp-si-panel-overview .cgp-si__tiles, .cgp-si__tiles');
        return head && tiles ? [head, tiles] : (tiles || head);
      },
      leave: closeOverview,
      fallbackArt: true,
      fallbackNote: 'The overview didn’t open here (it may be turned off in settings). This is what it looks like.',
      art: function () {
        return '<div class="si-demo" aria-hidden="true">' +
          '<div class="si-top"><span class="si-av">JP</span><span class="si-nm">Jordan P.<small>Last active today at 7:50 PM</small></span><span class="si-gr">B+<small>87.4%</small></span></div>' +
          '<div class="si-tiles si-tiles--6"><span class="si-t si-t--red"><b>2</b>Missing · 35 pts</span><span class="si-t si-t--amber"><b>1</b>Late</span><span class="si-t si-t--green"><b>91%</b>On time</span>' +
          '<span class="si-t"><b>88%</b>Avg · class 84%</span><span class="si-t"><b>3</b>Needs grading</span><span class="si-t"><b>Today</b>Last active</span></div>' +
          '</div>';
      }
    },
    {
      id: 'si-standout',
      group: 'si',
      icon: 'sparkle',
      title: 'What stands out: things to check',
      body: 'A short list of patterns worth a look, such as missing work piling up, frequent late work, no recent activity in Canvas, or scores going up or down.',
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
      title: 'Assignments: a missing-work list for parents',
      body: 'Click <b>Copy List of Missing/Late Work</b>, then paste it into an email. Each line has the due date, days overdue and points.',
      bullets: ['Filter the table to Missing, Late, Needs grading or Upcoming'],
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
      title: 'Activity: how they use your course',
      body: 'Page views compared with the class, a 16-week activity calendar, which pages they opened, and how much of each Studio video they watched.',
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
        return html + '</div><div class="heat-cap"><span>16 weeks of daily page views</span></div>';
      }
    },
    {
      id: 'si-profile',
      group: 'si',
      icon: 'person',
      title: 'Profile: parent and guardian emails',
      body: '<b>Parents &amp; guardians</b> lists the parents linked to this student in Canvas. Click an email to write to one, or <b>Copy all</b> for every address.',
      bullets: ['Also here: the student’s email, section, and grades in your other classes'],
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
      fallbackArt: true,
      art: function () {
        return '<div class="mail-demo" aria-hidden="true"><div class="md-head"><span>Parents &amp; guardians</span><span class="md-btn">Copy all</span></div>' +
          '<div class="md-row"><b>Dana Parker</b><span>dana.parker@example.com</span></div>' +
          '<div class="md-row"><b>Sam Parker</b><span>sam.parker@example.com</span></div></div>';
      }
    },

    /* ----------------------------------------- Gradebook tools (gradebook) */
    {
      id: 'total',
      icon: 'total',
      title: 'Total stays in view',
      body: 'The Total column stays next to the names while you scroll. Hover over a total to see the letter grade.',
      bullets: ['Low totals get a warning flag. Change the cutoffs in Gradebook+ settings.'],
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
      title: 'Score stats and class lists',
      bullets: [
        '<b>Analyze Scores</b>, in an assignment’s <b>⋮</b> menu: average, median, spread and a histogram',
        '<b>Copy Roster</b>, in the Student Name <b>⋮</b> menu: student or parent emails, or a list of names'
      ],
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
      title: 'Switch courses',
      body: 'Click <b>Switch course</b>, next to the course name, and pick a course. You land on the same page in that course.',
      target: function () { return pick('.cgp-crumb-toggle', function (el) { return !el.classList.contains('cgp-find-student') && !el.classList.contains('cgp-settings-gear'); }); },
      optional: true,
      tryIt: true,
      padding: 6
    },
    {
      id: 'find',
      icon: 'search',
      title: 'Find a student in any course',
      body: 'Click <b>Find student</b> and type part of a name, in any order (“new tom” finds Tommy Newnam). Pick a student to jump to their row.',
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
      title: 'Where Canvas’s toolbar went',
      body: 'Gradebook+ hides Canvas’s toolbar to give the grid more room. This gear opens Canvas’s Gradebook Settings.',
      bullets: ['To show the toolbar, press ' + key('Alt') + key('Shift') + key('H') + ' (' + key('Option') + key('Shift') + key('H') + ' on a Mac)'],
      target: function () { return pick('.cgp-settings-gear'); },
      optional: true,
      tryIt: true,
      padding: 6
    },

    /* ---------------------------------- Copy between classes (course home) */
    {
      id: 'classes-link',
      icon: 'link',
      title: 'First, link your sections',
      body: 'Click <b>Copy to other classes</b> and choose your other sections of this class (each is its own Canvas course). You only do this once.',
      target: function () { return pick('.cgp-copyto--home, .cgp-copyto'); },
      tryIt: true,
      fallbackArt: true,
      fallbackNote: '<b>Copy to other classes</b> is in the course home sidebar and next to <b>+ Module</b> on the Modules page. Don’t see it? Turn it on in Gradebook+ settings.',
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
      kind: 'center',
      icon: 'swap',
      title: 'Copy to your other sections',
      body: 'In <b>Copy to other classes</b>, select the sections you want, review each due date, and click <b>Copy</b>.',
      bullets: [
        'Each section is marked <i>Not there yet</i>, <i>Same</i> or <i>Different</i>',
        'To copy one item, click the copy icon next to <b>Edit</b> on its page',
        'A section’s own edited version is replaced only if you choose to'
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
      kind: 'center',
      icon: 'grid',
      title: 'Compare your sections',
      body: '<b>Compare classes</b> lists every item and which sections have it. For an item marked Different, click <b>Pick a version…</b> to see both and keep one.',
      bullets: ['When editing an assignment, quiz, discussion or page, select sections under <b>Also copy to your linked courses</b> before saving'],
      art: function () {
        var rows = [
          ['Lab 5: Photosynthesis', ['ok', 'ok']],
          ['Unit 3 Quiz', ['ok', 'miss']],
          ['Essay 2 rubric', ['old', 'ok']]
        ];
        var lab = { ok: '✓ Same', miss: '+ Not there yet', old: '≠ Different' };
        var html = '<div class="board-demo" aria-hidden="true"><div class="bd-row bd-head"><span>Item</span><span>Period 4</span><span>Period 6</span></div>';
        rows.forEach(function (r, i) {
          html += '<div class="bd-row" style="--i:' + i + '"><span>' + r[0] + '</span>' +
            r[1].map(function (c) { return '<span class="bd-c bd-c--' + c + '">' + lab[c] + '</span>'; }).join('') + '</div>';
        });
        return html + '</div>';
      }
    }
  ];

  /* Make groups, on the People page. */
  var groupStops = [
    {
      id: 'groups-button',
      icon: 'people',
      title: 'Open Make groups',
      body: 'Click <b>Make groups</b>, next to Canvas’s <b>+ Group Set</b>.',
      target: function () { return pick('.cgp-groups-btn'); },
      tryIt: true,
      padding: 6,
      fallbackArt: true,
      fallbackNote: '<b>Make groups</b> is next to <b>+ Group Set</b> on the People page. Don’t see it? Turn it on in Gradebook+ settings.',
      art: function () {
        return '<div class="board-demo" aria-hidden="true"><div class="bd-row bd-head"><span>Group 1</span><span>Group 2</span><span>Group 3</span></div>' +
          '<div class="bd-row" style="--i:0"><span>Ava</span><span>Ben</span><span>Cleo</span></div>' +
          '<div class="bd-row" style="--i:1"><span>Dev</span><span>Eli</span><span>Fay</span></div></div>';
      }
    },
    {
      id: 'groups-steps',
      kind: 'center',
      icon: 'people',
      title: 'Answer three questions, then click Make',
      steps: [
        { n: '1', t: 'How many', d: 'A number of groups, or a number of students per group.' },
        { n: '2', t: 'Group names', d: 'Numbers, letters, colors, or your own list.' },
        { n: '3', t: 'How students join', d: '<b>Shuffle them in</b>, <b>I’ll choose</b>, or <b>Students sign up</b>.' }
      ],
    },
    {
      id: 'groups-arrange',
      kind: 'center',
      icon: 'swap',
      title: 'Change or copy a group set later',
      bullets: [
        'In <b>Your group sets</b>, click <b>Arrange students</b> and drag students between groups. Click <b>Save changes</b> when done.',
        '<b>Copy to…</b> makes the same groups in another class or section'
      ],
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
      title: 'Insert a saved comment with a shortcut',
      body: 'In a comment box, type <b>/</b> and the snippet’s name, then press ' + key('Tab') + '. For example, /nice turns into the full comment.',
      bullets: ['Works in SpeedGrader, the Grade Detail Tray and gradebook comment boxes'],
      art: function () {
        return '<div class="find-demo" aria-hidden="true"><div class="fd-box"><span class="fd-snip">/nice</span>' + key('Tab') + '</div>' +
          '<div class="fd-hit"><b>Nicely done. Your reasoning here is clear and well supported.</b></div></div>';
      }
    },
    {
      id: 'snip-list',
      icon: 'keys',
      title: 'Add your own snippets',
      body: 'Click <b>+ Add Snippet</b>, type a short name and the comment, then click <b>Save changes</b> in the sidebar. Try it out in the test box at the bottom of this page.',
      target: function () { var m = document.querySelector('.snippets-manager'); return m && onScreen(m) ? m : null; },
      tryIt: true, padding: 8
    },
    {
      id: 'snip-drafts',
      kind: 'center',
      icon: 'check',
      title: 'Unsent SpeedGrader comments are saved',
      body: 'If you move to another student before sending a comment, it’s saved on this computer. Go back to that student and it’s still there.',
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
      title: 'Pick due times from your class schedule',
      body: 'Once your calendar is connected, setting a Due, Available from or Until date in Canvas shows that day’s classes. Click a class to use its start or end time.',
      bullets: ['Works on assignments, quizzes, discussions and modules'],
      art: function () {
        return '<div class="assign-demo" aria-hidden="true">' +
          '<div class="ad-field"><span class="ad-lab">Due date</span><span class="ad-in">Tue, Oct 14</span><span class="ad-in ad-in--time"><span class="ad-t"></span></span></div>' +
          '<div class="ad-pop"><div class="ad-day"><span>‹</span><b>Tuesday, Oct 14</b><span>›</span></div>' +
          '<div class="ad-cls"><b>AP Biology P1</b><span>8:55 – 9:50 AM · Rm 204</span></div>' +
          '<div class="ad-cls ad-cls--pick"><b>Biology P3</b><em>This course</em><span>10:45 – 11:40 AM · Rm 204</span></div>' +
          '<div class="ad-cls"><b>Biology P6</b><span>1:45 – 2:40 PM · Rm 204</span></div>' +
          '</div></div>';
      }
    },
    {
      id: 'opt-copy',
      icon: 'link',
      title: 'Step 1: Click Find my calendar link',
      body: 'Gradebook+ finds your <b>All Classes</b> calendar in Google Calendar and connects it. If Chrome asks for permission, click <b>Allow</b>.',
      bullets: ['First sign in to Google with the school account that has your All Classes calendar'],
      target: function () { return document.getElementById('calendarFind'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-paste',
      icon: 'check',
      title: 'Or paste a calendar link',
      body: 'Open <b>I already have a calendar link</b>, paste the link, and click <b>Connect calendar</b>. Outlook, Apple and other .ics links work too.',
      target: function () { var m = document.getElementById('calendarManual'); return m && m.open ? m : (m && m.querySelector('summary')) || document.querySelector('.schedule-connect'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-check',
      icon: 'sparkle',
      title: 'Step 2: Look for your next class',
      body: 'Once connected, a green card shows your next class. There’s nothing to save.',
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
    schedule: { body: 'In Canvas, click a Due, Available from or Until date to choose a class.' }
  };


  CGP.tourStops = stops.concat(groupStops, snippetStops, scheduleStops);
  CGP.tourPaths = paths;
  CGP.tourFinales = finales;
  CGP.tourScheduleStops = scheduleStops;
  CGP.tourIcons = ICON;
  CGP.tourFind = { onScreen: onScreen, pick: pick };
  CGP.tourWaitFor = waitFor;
})();
