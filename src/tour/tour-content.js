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
      title: 'Blue bubbles show where you’ve left feedback',
      body: 'When you comment on a student’s work, a small blue speech bubble appears in that grade cell. A number on the bubble tells you how many comments you’ve left. Hover over it to read your latest comment and see whether the student has replied.',
      try: 'Click a bubble to read the whole conversation and reply.',
      fallbackNote: 'There’s no feedback on this screen yet. Once you comment on a student’s work, a bubble will appear in their grade cell.',
      target: function () { return cellOf(pick('.cgp-cmt')); },
      fallback: assignmentCell,
      tryIt: true,
      art: commentLegend
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
      title: 'Mark work Missing, Late or Excused with one key',
      body: 'Click a student’s grade cell, then press ' + key('M', 'red') + ' for Missing, ' + key('L', 'amber') + ' for Late or ' + key('E', 'green') + ' for Excused. It’s saved in Canvas right away, so students see it too.',
      bullets: ['Pressing ' + key('M') + ' or ' + key('L') + ' again removes the status.'],
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
      title: 'Enter grades for many students at once',
      bullets: [
        'Copy a column of grades from Google Sheets or Excel, click the first cell, and paste. Gradebook+ checks every grade before it saves.',
        'To give several students the same grade, hold ' + key('Ctrl') + ' (' + key('⌘') + ' on a Mac) and click their cells, or ' + key('Shift') + '-click to select a range. Then type the grade and press ' + key('Enter') + '.',
        'With several cells selected, you can also press ' + key('M') + ', ' + key('L') + ' or ' + key('E') + ' to mark them all, or ' + key('C') + ' to leave the same comment on all of them.'
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
      title: 'Release hidden grades with the Post button',
      body: 'When some grades in a column are hidden from students, a <b>Post</b> button appears at the top of that column, showing how many are hidden. Clicking it makes those grades visible to students right away.',
      fallbackNote: 'Every grade on this screen is already visible to students. When some are hidden, a Post button will appear at the top of their column.',
      target: function () { return headerOf('.cgp-post'); },
      fallback: assignmentHeader,
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
      title: 'Click a student’s name to see their overview',
      body: 'The overview puts everything about one student in one place: their grade, missing work, recent activity and parent contacts. Click <b>Open overview</b> to see this student’s.',
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
      fallbackArt: true,
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
      title: 'See how the student uses your course',
      body: 'The Activity tab compares the student’s page views with the rest of the class and shows a calendar of their activity over the last 16 weeks. It also lists which pages they’ve opened and how much of each Studio video they’ve watched.',
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
      title: 'The Total column stays in view',
      body: 'The Total column stays next to the student names, so you can see final grades no matter how far you scroll. Hover over a total to see the letter grade.',
      bullets: ['Totals below a cutoff get a warning flag. You can change the cutoffs in Gradebook+ settings.'],
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
      title: 'Score statistics and class lists',
      bullets: [
        'Click the <b>⋮</b> at the top of an assignment column and choose <b>Analyze Scores</b> to see the average, median and spread, with a chart of the scores.',
        'Click the <b>⋮</b> at the top of the Student Name column and choose <b>Copy Roster</b> to copy student or parent emails, or a list of names.'
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
      padding: 6,
      art: function () {
        return '<div class="find-demo" aria-hidden="true"><div class="fd-box">' + ICON.search + '<span class="fd-typed"></span></div>' +
          '<div class="fd-hit"><b>Tommy Newnam</b><span>Biology · Period 3</span></div></div>';
      }
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
      title: 'Link the classes that share this course',
      body: 'If you teach this course to more than one class, such as Periods 2, 4 and 6, each class has its own Canvas course. Click <b>Copy to other classes</b> and choose your other classes. You only need to do this once.',
      fallbackNote: 'The <b>Copy to other classes</b> button is in the sidebar on the course home page, and next to <b>+ Module</b> on the Modules page. If you don’t see it, turn it on in Gradebook+ settings.',
      target: function () { return pick('.cgp-copyto--home, .cgp-copyto'); },
      tryIt: true,
      fallbackArt: true,
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
      title: 'Copy work to your other classes',
      body: 'In <b>Copy to other classes</b>, choose which classes should get it, make sure each due date is right, and click <b>Copy</b>.',
      bullets: [
        'Each class is labeled <i>Not there yet</i>, <i>Same</i> or <i>Different</i>, so you can see what it already has.',
        'To copy a single assignment or page, open it and click the copy icon next to <b>Edit</b>.',
        'If you’ve changed an item in one class, that version is only replaced if you choose to replace it.'
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
      title: 'Check that your classes match',
      body: '<b>Compare classes</b> lists every item in this course and shows whether each of your other classes has it. If an item is marked Different, click <b>Pick a version…</b> to see both versions side by side and choose one.',
      bullets: ['You can also copy as you work: when you create or edit an assignment, quiz, discussion or page, choose classes under <b>Also copy to your linked courses</b> before you save.'],
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
      title: 'Make a whole group set in one step',
      body: 'Click <b>Make groups</b>, next to Canvas’s <b>+ Group Set</b> button. It creates the group set, names the groups and puts students in them all at once.',
      fallbackNote: '<b>Make groups</b> appears next to <b>+ Group Set</b> on the People page. If you don’t see it, turn it on in Gradebook+ settings.',
      target: function () { return pick('.cgp-groups-btn'); },
      tryIt: true,
      padding: 6,
      fallbackArt: true,
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
        { n: '1', t: 'How many groups?', d: 'Choose a number of groups, or how many students should be in each one.' },
        { n: '2', t: 'What should they be called?', d: 'Numbers, letters, colors, or names you type in.' },
        { n: '3', t: 'How do students get in?', d: 'Shuffle them in at random, place them yourself, or let students sign up in Canvas.' }
      ],
    },
    {
      id: 'groups-arrange',
      kind: 'center',
      icon: 'swap',
      title: 'Rearrange or copy groups later',
      bullets: [
        'To move students, open the <b>Your group sets</b> tab, click <b>Arrange students</b>, and drag names between groups. Click <b>Save changes</b> when you’re done.',
        'To make the same groups in another class, click <b>Copy to…</b>.'
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
      title: 'Insert a saved comment by typing a short name',
      body: 'A snippet is a comment you’ve saved under a short name. In a comment box, type a slash and the name, like <b>/nice</b>, then press ' + key('Tab') + ' and the full comment appears.',
      bullets: ['Works in SpeedGrader and in the gradebook’s comment boxes.'],
      art: function () {
        return '<div class="find-demo" aria-hidden="true"><div class="fd-box"><span class="fd-snip">/nice</span>' + key('Tab') + '</div>' +
          '<div class="fd-hit"><b>Nicely done. Your reasoning here is clear and well supported.</b></div></div>';
      }
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
      body: 'If you type a comment in SpeedGrader and move to another student before submitting it, Gradebook+ saves it. When you go back to that student, your comment will be waiting.',
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
      title: 'Set due times by class period',
      body: 'Once your class calendar is connected, clicking a Due, Available from or Until date in Canvas shows that day’s classes. Click one of your classes, and its start time is filled in for you.',
      bullets: ['Works for assignments, quizzes, discussions and modules.'],
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
      title: 'Step 1: Connect your calendar',
      body: 'Click <b>Find my calendar link</b>. Gradebook+ opens Google Calendar, finds your All Classes calendar, and connects it for you. If Chrome asks for permission, click <b>Allow</b>.',
      bullets: ['Make sure you’re signed in to Google with your school account first.'],
      target: function () { return document.getElementById('calendarFind'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-paste',
      icon: 'check',
      title: 'Or paste a calendar link yourself',
      body: 'If you already have a link to your class calendar, click <b>I already have a calendar link</b>, paste it in, and click <b>Connect calendar</b>. Links from Outlook, Apple Calendar and other calendar apps work too.',
      target: function () { var m = document.getElementById('calendarManual'); return m && m.open ? m : (m && m.querySelector('summary')) || document.querySelector('.schedule-connect'); },
      tryIt: true, padding: 8
    },
    {
      id: 'opt-check',
      icon: 'sparkle',
      title: 'Step 2: Make sure it worked',
      body: 'When the connection works, a green box appears showing your next class. You don’t need to save anything.',
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
    schedule: { body: 'Next time you set a due date in Canvas, click the date and choose a class.' }
  };


  CGP.tourStops = stops.concat(groupStops, snippetStops, scheduleStops);
  CGP.tourPaths = paths;
  CGP.tourFinales = finales;
  CGP.tourScheduleStops = scheduleStops;
  CGP.tourIcons = ICON;
  CGP.tourFind = { onScreen: onScreen, pick: pick };
  CGP.tourWaitFor = waitFor;
})();
