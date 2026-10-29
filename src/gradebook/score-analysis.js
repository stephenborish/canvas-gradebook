/* Canvas Gradebook+ - "Analyze scores" in an assignment column's "..." menu,
 * and the same panel for the course Total.
 *
 * Canvas's column options menu (Sort by, SpeedGrader, Message Students Who,
 * Curve Grades, ...) grows one more item. Choosing it opens a panel with that
 * column's psychometrics: the highest and lowest scoring students, mean,
 * median, standard deviation, range, and a histogram of the scores bucketed by
 * the same letter-grade cutoffs the Total column uses (Options -> grading
 * scale). The numbers come from this extension's model, i.e. straight from
 * Canvas's submissions API (see core/score-stats.js).
 *
 * Canvas renders that menu in a portal, nowhere near the header it belongs
 * to, so the column is remembered from the click that opened it: a press on a
 * control inside an assignment header, immediately followed by a menu that
 * holds Canvas's own assignment-column items. A menu that cannot be tied to a
 * column that way is left exactly as Canvas built it.
 *
 * The Total gets the same panel, read from the course scores the Total column
 * itself shows (Canvas's enrollment scores, already a percentage), through
 * Canvas's own Total column menu. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.ScoreAnalysisController) return;

  // Items only Canvas's assignment-column menu carries.
  var ASSIGNMENT_MENU_ITEMS = /^(curve grades|set default grade|message students who)/i;
  // Items only Canvas's Total column menu carries.
  var TOTAL_MENU_ITEMS = /^(move to (front|end)|display as (points|percentage))/i;
  var OPEN_WINDOW_MS = 4000;
  var ITEM_LABEL = 'Analyze Scores';
  // Canvas's other items are bare text, so this one gets a bar-chart icon, a
  // line saying what it does and a NEW pill (styled in gradebook.css). The
  // icon and pill take currentColor / invert with the row, so they stay
  // legible under Canvas's blue focus highlight.
  var ITEM_HINT = 'Mean, median, histogram';
  var ICON_SVG =
    '<svg class="cgp-analyze-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">' +
      '<rect x="2.5" y="14" width="3.6" height="7" rx=".8"/>' +
      '<rect x="7.3" y="8" width="3.6" height="13" rx=".8"/>' +
      '<rect x="12.1" y="4" width="3.6" height="17" rx=".8"/>' +
      '<rect x="16.9" y="10" width="3.6" height="11" rx=".8"/>' +
    '</svg>';
  var ITEM_HTML = ICON_SVG +
    '<span class="cgp-analyze-text">' +
      '<span class="cgp-analyze-title">' + ITEM_LABEL +
        '<span class="cgp-analyze-pill" aria-hidden="true">NEW</span>' +
      '</span>' +
      '<span class="cgp-analyze-hint">' + ITEM_HINT + '</span>' +
    '</span>';

  function ScoreAnalysisController(ctx) {
    this.model = ctx.model;
    this.adapter = ctx.adapter;
    this.settings = ctx.settings;
    this._lastTrigger = null;   // {kind: 'assignment' | 'total', assignmentId, at}
    this._observer = null;
    this._dialog = null;
  }

  var P = ScoreAnalysisController.prototype;

  P.start = function () {
    var self = this;
    var remember = function (e) { self.rememberTrigger(e.target); };
    document.addEventListener('mousedown', remember, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') remember(e);
    }, true);
    this._observer = new MutationObserver(function (records) {
      if (!self._lastTrigger) return;
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1 || (node.closest && node.closest('.cgp-stats'))) continue;
          var menus = node.matches && node.matches('[role="menu"]') ? [node] : [];
          if (node.querySelectorAll) menus = menus.concat(Array.prototype.slice.call(node.querySelectorAll('[role="menu"]')));
          menus.forEach(function (m) { self.decorateMenu(m); });
        }
      }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });
  };

  /** The assignment (or the Total) a press inside a header column belongs to, if any. */
  P.rememberTrigger = function (target) {
    var header = target && target.closest && target.closest('.slick-header-column');
    if (!header) return;
    if (!target.closest('button, [role="button"], [aria-haspopup]')) return;
    var colId = this.adapter.columnIdForHeader(header);
    var kind = CGP.gridMap.classifyColumnId(colId).type;
    var m = /^assignment_(\d+)$/.exec(colId || '');
    if (m) this._lastTrigger = { kind: 'assignment', assignmentId: m[1], at: Date.now() };
    else if (kind === 'total') this._lastTrigger = { kind: 'total', assignmentId: null, at: Date.now() };
  };

  function itemText(el) {
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* The deepest element holding exactly this text, so the clone's label can be
   * swapped without disturbing the wrappers carrying Canvas's styling. */
  function labelNode(el, text) {
    var best = el;
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (itemText(kids[i]) === text) return labelNode(kids[i], text);
    }
    return best;
  }

  P.decorateMenu = function (menu) {
    var trig = this._lastTrigger;
    if (!trig || Date.now() - trig.at > OPEN_WINDOW_MS) return;
    if (menu.querySelector('.cgp-analyze-item')) return;
    var isTotal = trig.kind === 'total';
    var items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
    var anchor = null;
    items.forEach(function (it) {
      if ((isTotal ? TOTAL_MENU_ITEMS : ASSIGNMENT_MENU_ITEMS).test(itemText(it))) anchor = it;
    });
    if (!anchor) return;
    if (!isTotal) {
      // Never on an anonymous or moderated column: the high/low lists name
      // students, which is exactly what anonymous grading hides from graders.
      var meta = this.model.assignment(trig.assignmentId);
      if (!meta || meta.anonymous || meta.moderated) return;
    }

    // Canvas wraps each item in a role="none" list item in some builds; the
    // clone goes in at the same level so it lines up with its neighbours.
    var unit = anchor;
    if (unit.parentElement && unit.parentElement !== menu &&
        (unit.parentElement.getAttribute('role') === 'none' || unit.parentElement.tagName === 'LI')) {
      unit = unit.parentElement;
    }
    var clone = unit.cloneNode(true);
    var item = clone.getAttribute('role') === 'menuitem' ? clone : clone.querySelector('[role="menuitem"]');
    if (!item) return;
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('[id]'))).forEach(function (n) {
      if (n.removeAttribute) n.removeAttribute('id');
    });
    item.removeAttribute('aria-disabled');
    item.removeAttribute('aria-describedby');
    item.removeAttribute('href');
    item.classList.add('cgp-analyze-item');
    var label = labelNode(item, itemText(anchor));
    label.innerHTML = ITEM_HTML;
    label.classList.add('cgp-analyze-label');
    item.setAttribute('aria-label', ITEM_LABEL);
    item.setAttribute('title', 'Mean, median, standard deviation, high/low students and a letter-grade histogram for ' +
      (isTotal ? 'the course totals' : 'this column'));

    var self = this;
    var assignmentId = trig.assignmentId;
    function choose(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      self.closeMenu(menu);
      if (isTotal) self.openTotals();
      else self.open(assignmentId);
    }
    // Capture, and on the clone itself: the click must never reach Canvas's
    // own handlers, which would act on whichever item this was cloned from.
    item.addEventListener('click', choose, true);
    item.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
    // Canvas highlights whichever of its items has focus, and moves focus on
    // hover only for items it rendered itself. Without taking focus here, the
    // item the pointer just left (Set Default Grade from above, Hide grades
    // from below) stayed highlighted alongside this one.
    if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '-1');
    item.addEventListener('mouseenter', function () {
      if (document.activeElement !== item) {
        try { item.focus({ preventScroll: true }); } catch (e) { item.focus(); }
      }
    });
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') choose(e);
    }, true);
    unit.parentNode.insertBefore(clone, unit.nextSibling);
  };

  P.closeMenu = function (menu) {
    try {
      var opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      menu.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
    } catch (e) { /* the panel opening on top is enough */ }
  };

  /* ---------------------------------------------------------------- data */

  P.entriesFor = function (assignmentId) {
    var self = this;
    var out = [];
    this.model.studentOrder.forEach(function (uid) {
      var student = self.model.students.get(uid);
      if (!student || /^test student$/i.test(student.name || '')) return;
      var rec = self.model.cells.get(self.model.key(assignmentId, uid));
      out.push({
        userId: uid,
        name: student.fullName || student.name || ('Student ' + uid),
        score: rec ? rec.score : null,
        excused: !!(rec && rec.excused)
      });
    });
    return out;
  };

  /* Every student's course total, as the Total column shows it: Canvas's own
   * enrollment score (a percentage, already weighted), never recomputed. A
   * student with no graded work yet has no total and counts as not graded. */
  P.totalEntries = function () {
    var self = this;
    var out = [];
    this.model.studentOrder.forEach(function (uid) {
      var student = self.model.students.get(uid);
      if (!student || /^test student$/i.test(student.name || '')) return;
      out.push({
        userId: uid,
        name: student.fullName || student.name || ('Student ' + uid),
        score: student.currentScore,
        excused: false
      });
    });
    return out;
  };

  P.openTotals = function () {
    var self = this;
    var dialog = this.showDialog('Total', '<p class="cgp-stats__note">Loading totals…</p>');
    var ready = this.model.ready ? Promise.resolve() : this.model.init();
    return ready.then(function () {
      if (self._dialog !== dialog) return null;
      // Totals are percentages, so they sit on the grading scale as they are.
      var stats = CGP.scoreStats.analyze(self.totalEntries(), 100, self.settings.values.gradingScale, 5);
      self.setBody(self.render(stats, { total: true }));
      return stats;
    }, function () {
      if (self._dialog === dialog) {
        self.setBody('<p class="cgp-stats__note">Couldn’t load the course totals from Canvas. Try again in a moment.</p>');
      }
      return null;
    });
  };

  P.open = function (assignmentId) {
    var self = this;
    var id = String(assignmentId);
    var assignment = this.model.assignment(id);
    if (assignment && (assignment.anonymous || assignment.moderated)) return Promise.resolve(null);
    var dialog = this.showDialog(assignment ? assignment.name : 'Assignment', '<p class="cgp-stats__note">Loading scores…</p>');
    return this.model.ensureAssignments([id], { includeComments: false }).then(function () {
      // Closed, or replaced by another column's panel, while loading.
      if (self._dialog !== dialog) return null;
      if (!self.model.loadedAssignments.has(id) && !self.model.everLoadedAssignments.has(id)) {
        self.setBody('<p class="cgp-stats__note">Couldn’t load this column’s scores from Canvas. Try again in a moment.</p>');
        return null;
      }
      var stats = CGP.scoreStats.analyze(self.entriesFor(id), assignment && assignment.pointsPossible,
        self.settings.values.gradingScale, 5);
      self.setBody(self.render(stats));
      return stats;
    });
  };

  /* ----------------------------------------------------------- rendering */

  var esc = function (s) { return CGP.util.escapeHtml(String(s)); };

  function num(v, places) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    var r = CGP.scoreStats.round(v, places === undefined ? 1 : places);
    return String(r);
  }

  /* opts.total: the figures are course totals - percentages already - so
   * they are shown once, as percentages, rather than as points and percent. */
  P.render = function (s, opts) {
    var total = !!(opts && opts.total);
    if (!s.count) {
      if (total) return '<p class="cgp-stats__note">No student has a course total yet.</p>';
      return '<p class="cgp-stats__note">No graded scores in this column yet.' +
        (s.excused ? ' ' + s.excused + ' excused.' : '') + '</p>';
    }
    var hasPts = s.pointsPossible !== null;
    function both(points, percent) {
      if (total) return '<b>' + num(points, 1) + '%</b>';
      return '<b>' + num(points, 2) + '</b>' + (hasPts ? '<span>' + num(percent, 1) + '%</span>' : '');
    }
    var range = total
      ? '<b>' + num(s.min, 1) + '–' + num(s.max, 1) + '%</b>'
      : '<b>' + num(s.min, 2) + '–' + num(s.max, 2) + '</b>' + (hasPts ? '<span>of ' + num(s.pointsPossible, 2) + ' pts</span>' : '');
    var tiles = [
      ['Mean', both(s.mean, s.meanPercent)],
      ['Median', both(s.median, s.medianPercent)],
      ['Std. deviation', both(s.sd, s.sdPercent)],
      ['Range', range]
    ].map(function (t) {
      return '<div class="cgp-stats__tile"><div class="cgp-stats__k">' + t[0] + '</div><div class="cgp-stats__v">' + t[1] + '</div></div>';
    }).join('');

    var counted = total
      ? s.count + (s.count === 1 ? ' student' : ' students') + ' with a total · ' + s.ungraded +
        ' with no graded work yet (left out of every figure)'
      : s.count + ' graded' +
        (s.ungraded ? ' · ' + s.ungraded + ' not graded' : '') +
        (s.excused ? ' · ' + s.excused + ' excused' : '') +
        ' (left out of every figure)';
    var plain = total ? s.count + (s.count === 1 ? ' course total' : ' course totals') : s.count + ' graded scores';
    var scale = this.settings.values.gradingScale;

    function list(title, rows) {
      return '<div class="cgp-stats__list"><h3>' + title + '</h3><ol>' + rows.map(function (g) {
        var letter = total ? CGP.totals.letterFor(g.score, scale) : null;
        var value = total
          ? num(g.score, 1) + '%' + (letter ? ' <i>(' + esc(letter) + ')</i>' : '')
          : num(g.score, 2) + (hasPts ? ' <i>(' + num(g.percent, 1) + '%)</i>' : '');
        return '<li><span>' + esc(g.name) + '</span><b>' + value + '</b></li>';
      }).join('') + '</ol></div>';
    }

    return '<p class="cgp-stats__note">' + (s.ungraded || s.excused ? counted : plain) + '</p>' +
      '<div class="cgp-stats__tiles">' + tiles + '</div>' +
      (s.buckets ? this.histogram(s.buckets, s.count) : '<p class="cgp-stats__note">This assignment has no points possible, so scores can’t be placed on the letter-grade scale.</p>') +
      '<div class="cgp-stats__lists">' + list('Highest', s.highest) + list('Lowest', s.lowest) + '</div>';
  };

  /* Bars low → high, left to right, one per letter on the grading scale. */
  P.histogram = function (buckets, total) {
    var rows = buckets.slice().reverse();
    var maxCount = rows.reduce(function (m, b) { return Math.max(m, b.count); }, 0) || 1;
    var W = 560, H = 190, padL = 28, padB = 34, padT = 18;
    var plotW = W - padL - 6, plotH = H - padB - padT;
    var slot = plotW / rows.length;
    var barW = Math.max(6, slot - 6);
    var step = maxCount <= 5 ? 1 : Math.ceil(maxCount / 4);
    var top = Math.ceil(maxCount / step) * step;
    var svg = '<svg class="cgp-stats__hist" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Distribution of scores by letter grade">';
    for (var g = 0; g <= top; g += step) {
      var gy = padT + plotH - (g / top) * plotH;
      svg += '<line class="cgp-stats__grid" x1="' + padL + '" x2="' + (W - 6) + '" y1="' + gy + '" y2="' + gy + '"/>' +
        '<text class="cgp-stats__axis" x="' + (padL - 6) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + g + '</text>';
    }
    rows.forEach(function (b, i) {
      var h = (b.count / top) * plotH;
      var x = padL + i * slot + (slot - barW) / 2;
      var y = padT + plotH - h;
      var range = b.max === null ? '≥ ' + b.min + '%' : b.min + '–' + b.max + '%';
      var tip = b.letter + ' (' + range + '): ' + b.count + (b.count === 1 ? ' student' : ' students') +
        ' · ' + Math.round((b.count / total) * 100) + '%' +
        (b.students.length ? '\n' + b.students.join(', ') : '');
      svg += '<g class="cgp-stats__bin"><title>' + esc(tip) + '</title>' +
        '<rect class="cgp-stats__hit" x="' + (padL + i * slot) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '"/>';
      if (b.count) {
        // Rounded data-end, square at the baseline.
        var r = Math.min(4, barW / 2, h);
        svg += '<path class="cgp-stats__bar" d="M' + x + ' ' + (y + h) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y +
          'H' + (x + barW - r) + 'Q' + (x + barW) + ' ' + y + ' ' + (x + barW) + ' ' + (y + r) + 'V' + (y + h) + 'Z"/>' +
          '<text class="cgp-stats__count" x="' + (x + barW / 2) + '" y="' + (y - 4) + '" text-anchor="middle">' + b.count + '</text>';
      }
      svg += '<text class="cgp-stats__axis cgp-stats__letter" x="' + (padL + i * slot + slot / 2) + '" y="' + (H - padB + 15) + '" text-anchor="middle">' + esc(b.letter) + '</text>' +
        '<text class="cgp-stats__axis" x="' + (padL + i * slot + slot / 2) + '" y="' + (H - padB + 28) + '" text-anchor="middle">' + b.min + '</text>' +
        '</g>';
    });
    svg += '<line class="cgp-stats__base" x1="' + padL + '" x2="' + (W - 6) + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) + '"/></svg>';

    // The same numbers as a table, for anyone who can't read the chart.
    var table = '<details class="cgp-stats__table"><summary>Show as table</summary><table><thead><tr><th>Letter</th><th>Range</th><th>Students</th><th>%</th></tr></thead><tbody>' +
      buckets.map(function (b) {
        return '<tr><td>' + esc(b.letter) + '</td><td>' + (b.max === null ? '≥ ' + b.min : b.min + '–' + b.max) + '</td><td>' + b.count +
          '</td><td>' + Math.round((b.count / total) * 100) + '%</td></tr>';
      }).join('') + '</tbody></table></details>';

    return '<div class="cgp-stats__chart"><h3>Distribution by letter grade</h3>' + svg +
      '<p class="cgp-stats__note">Cutoffs from your grading scale (lower bound shown under each letter). Hover a bar for its students.</p>' +
      table + '</div>';
  };

  P.showDialog = function (title, bodyHtml) {
    this.close();
    var self = this;
    var root = document.createElement('div');
    root.className = 'cgp-stats';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-stats-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Score analysis</div><h2 id="cgp-stats-title">' + esc(title) + '</h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-stats__body">' + bodyHtml + '</div></div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.close(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.close(); });
    this._onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this._dialog = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    return root;
  };

  P.setBody = function (html) {
    if (!this._dialog || !this._dialog.isConnected) return;
    this._dialog.querySelector('.cgp-stats__body').innerHTML = html;
  };

  P.close = function () {
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    if (this._dialog && this._dialog.parentNode) this._dialog.parentNode.removeChild(this._dialog);
    this._dialog = null;
  };

  ScoreAnalysisController.ICON_SVG = ICON_SVG;
  CGP.ScoreAnalysisController = ScoreAnalysisController;
})();
