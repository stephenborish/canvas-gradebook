/* Canvas Gradebook+ - "Compare classes": every item in this class against
 * its copy in each of the teacher's other classes, on one screen.
 *
 * The copy dialog (sync-dialog.js) answers "what happens if I copy THIS
 * item". Keeping several classes in step needs the other question too:
 * "what in this class is not the same in my other classes?". This board
 * answers it for the whole course at once:
 *
 *   rows     every assignment, quiz, discussion, page and module here
 *   columns  each linked class
 *   cells    Up to date / Missing / Out of date / Changed there /
 *            Different / Deleted there / Has its own, plus a published-
 *            state mismatch
 *
 * It is read with a handful of list calls per class (sync-runner.js scan),
 * never one call per item. Nothing is written from here except publishing
 * (the "Match publishing" button, after a confirmation): copying goes
 * through the copy dialog, pre-set with exactly the cells ticked here, so
 * every safety check of that dialog (a copy changed there kept by default,
 * each class's own dates, a same-titled item never duplicated) still holds.
 *
 * Items here that are another class's copies are listed apart: Canvas's copy
 * only goes one way, so they are brought up to date FROM that class, or
 * their changes brought back to it (the review in sync-dialog.js). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (!CGP.SectionCopyController || CGP.SectionCopyController.prototype.openBoard) return;

  var P = CGP.SectionCopyController.prototype;
  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  function S() { return CGP.sectionSync; }

  var TYPE_ORDER = ['assignment', 'quiz', 'discussion', 'page', 'module'];

  /* What each status is called, how it looks, and whether it can be
   * ticked for copying. */
  var CELL = {
    same: { label: 'Up to date', mark: '✓', tone: 'ok', pick: false },
    stale: { label: 'Out of date', mark: '↻', tone: 'warn', pick: true, auto: true },
    'new': { label: 'Missing', mark: '+', tone: 'miss', pick: true, auto: true },
    restore: { label: 'Deleted there', mark: '⟲', tone: 'miss', pick: true },
    edited: { label: 'Changed there', mark: '✎', tone: 'edit', pick: true },
    differs: { label: 'Different', mark: '≠', tone: 'edit', pick: true },
    lookalike: { label: 'Has its own', mark: '!', tone: 'muted', pick: false },
    unknown: { label: 'Not known', mark: '?', tone: 'muted', pick: false }
  };

  var ORIGIN = {
    same: { label: 'Original there · same', mark: '✓', tone: 'ok' },
    stale: { label: 'Newer there', mark: '↻', tone: 'warn' },
    edited: { label: 'Changed here', mark: '✎', tone: 'edit' },
    differs: { label: 'Different from original', mark: '≠', tone: 'edit' }
  };

  /** The statuses that need the teacher's attention. */
  function needsAttention(status) {
    return status !== 'same' && status !== 'unknown';
  }

  function itemKey(it) { return it.type + ':' + it.id; }

  /* ---------------------------------------------------------- the dialog */

  P.openBoard = function () {
    var self = this;
    var sibs = this.siblings();
    if (!sibs.length) return this.open({ pick: true });
    this.close();
    var st = this.state = {
      view: 'board', courses: null,
      board: {
        scan: null, error: null, progress: null, filter: 'attention', type: 'all', q: '', sel: {},
        busy: false, dests: sibs
      }
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections cgp-board';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Compare classes</div><h2 id="cgp-sections-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-sections__body"></div></div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.requestClose(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.requestClose(); });
    root.addEventListener('click', function (e) { self.onBoardClick(e); });
    root.addEventListener('change', function (e) { self.onBoardChange(e); });
    root.addEventListener('input', function (e) { self.onBoardInput(e); });
    this._onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); self.requestClose(); } };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    this.renderBoard();
    CGP.teachingCourseList(this.api).catch(function () { return []; }).then(function (courses) {
      if (self.state !== st) return;
      st.courses = courses || [];
      self.scanBoard();
    });
  };

  P.scanBoard = function () {
    var self = this;
    var st = this.state;
    var b = st.board;
    b.scan = null;
    b.error = null;
    b.progress = [0, b.dests.length];
    b.sel = {};
    this.renderBoard();
    var token = b.token = {};
    this.copier.scan(this.courseId, b.dests, {
      onProgress: function (done, total) {
        if (self.state !== st || b.token !== token) return;
        b.progress = [done, total];
        self.renderBoard();
      }
    }).then(function (scan) {
      if (self.state !== st || b.token !== token) return;
      b.scan = scan;
      b.progress = null;
      self.renderBoard();
    }, function (err) {
      if (self.state !== st || b.token !== token) return;
      b.progress = null;
      b.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read this class from Canvas' });
      self.renderBoard();
    });
  };

  /* ------------------------------------------------------------- model */

  /* Rows to show, after the filters: [{item, origin, cells}]. origin: the
   * class this item was copied from, with how the two compare. */
  P.boardRows = function () {
    var b = this.state.board;
    var scan = b.scan;
    if (!scan) return [];
    var q = String(b.q || '').trim().toLowerCase();
    var self = this;
    var rows = scan.items.map(function (it) {
      var k = itemKey(it);
      var origin = null;
      var cells = {};
      scan.dests.forEach(function (d) {
        if (d.origins && d.origins[k] && !origin) origin = d.origins[k];
        cells[d.courseId] = d.error ? null : (d.cells[k] || null);
      });
      return { item: it, key: k, origin: origin, cells: cells };
    });
    rows = rows.filter(function (r) {
      if (b.type !== 'all' && r.item.type !== b.type) return false;
      if (q && String(r.item.title || '').toLowerCase().indexOf(q) < 0) return false;
      if (b.filter === 'attention') return self.rowNeedsAttention(r);
      return true;
    });
    return rows;
  };

  P.rowNeedsAttention = function (r) {
    if (r.origin && r.origin.status !== 'same') return true;
    return Object.keys(r.cells).some(function (d) {
      var c = r.cells[d];
      if (!c || (r.origin && r.origin.courseId === d)) return false;
      return needsAttention(c.status) || c.publishMismatch;
    });
  };

  /* Counts over every row (not only the ones shown). */
  P.boardCounts = function () {
    var scan = this.state.board.scan;
    var out = { same: 0, stale: 0, 'new': 0, restore: 0, edited: 0, differs: 0, lookalike: 0, unknown: 0, publish: 0, origin: 0 };
    if (!scan) return out;
    scan.items.forEach(function (it) {
      var k = itemKey(it);
      scan.dests.forEach(function (d) {
        if (d.error) return;
        if (d.origins && d.origins[k]) { if (d.origins[k].status !== 'same') out.origin++; return; }
        var c = d.cells[k];
        if (!c) return;
        out[c.status] = (out[c.status] || 0) + 1;
        if (c.publishMismatch) out.publish++;
      });
    });
    return out;
  };

  /* The cells a quick-select button ticks. */
  P.cellsWith = function (statuses) {
    var out = [];
    this.boardRows().forEach(function (r) {
      Object.keys(r.cells).forEach(function (d) {
        var c = r.cells[d];
        if (!c || (r.origin && r.origin.courseId === d)) return;
        if (statuses.indexOf(c.status) >= 0) out.push(r.key + '>' + d);
      });
    });
    return out;
  };

  P.publishFixes = function () {
    var out = [];
    var scan = this.state.board.scan;
    if (!scan) return out;
    var self = this;
    this.boardRows().forEach(function (r) {
      Object.keys(r.cells).forEach(function (d) {
        var c = r.cells[d];
        if (!c || !c.publishMismatch || !c.destId || (r.origin && r.origin.courseId === d)) return;
        if (r.item.type === 'announcement') return;
        out.push({ courseId: d, type: r.item.type, destId: c.destId, want: !!r.item.published, title: r.item.title, name: self.courseName(d) });
      });
    });
    return out;
  };

  /* ------------------------------------------------------------ render */

  P.renderBoard = function () {
    if (!this.root || !this.state || this.state.view !== 'board') return;
    var st = this.state;
    var b = st.board;
    this.root.querySelector('#cgp-sections-title').textContent = this.courseName(this.courseId) + ' and your other classes';
    var body = this.root.querySelector('.cgp-sections__body');
    var panel = this.root.querySelector('.cgp-stats__panel');
    var wrap = body.querySelector('.cgp-board__wrap');
    var keep = { panel: panel ? panel.scrollTop : 0, wrapTop: wrap ? wrap.scrollTop : 0, wrapLeft: wrap ? wrap.scrollLeft : 0 };
    var focusSel = null;
    var active = document.activeElement;
    if (active && body.contains(active)) {
      ['data-board-sel', 'data-board-act', 'data-board-role', 'data-board-type'].some(function (a) {
        if (!active.hasAttribute(a)) return false;
        focusSel = '[' + a + '="' + String(active.getAttribute(a)).replace(/["\\]/g, '\\$&') + '"]';
        return true;
      });
    }
    if (!st.courses || b.progress) {
      var p = b.progress;
      body.innerHTML = '<p class="cgp-stats__note" role="status">' +
        (p ? 'Reading your classes from Canvas… ' + p[0] + ' of ' + p[1] + ' done.' : 'Loading your classes…') + '</p>';
      return;
    }
    if (b.error) {
      body.innerHTML = '<p class="cgp-sections__err">' + esc(b.error) + '</p>' +
        '<div class="cgp-roster__row"><button type="button" class="cgp-roster__btn" data-board-act="rescan">Try again</button></div>';
      return;
    }
    if (!b.scan) { body.innerHTML = ''; return; }
    body.innerHTML = this.renderBoardSummary() + this.renderBoardControls() + this.renderBoardTable() +
      this.renderBoardOrphans() + this.renderBoardActions();
    var w2 = body.querySelector('.cgp-board__wrap');
    if (w2) { w2.scrollTop = keep.wrapTop; w2.scrollLeft = keep.wrapLeft; }
    if (panel) panel.scrollTop = keep.panel;
    if (focusSel) {
      var el = null;
      try { el = body.querySelector(focusSel); } catch (e) { el = null; }
      if (el) { try { el.focus({ preventScroll: true }); } catch (e2) { el.focus(); } }
    }
  };

  P.renderBoardSummary = function () {
    var c = this.boardCounts();
    var b = this.state.board;
    var bits = [];
    var add = function (n, text, tone) {
      if (!n) return;
      bits.push('<span class="cgp-board__count is-' + tone + '">' + n + ' ' + esc(typeof text === 'string' ? text : text[n === 1 ? 0 : 1]) + '</span>');
    };
    add(c['new'], 'missing', 'miss');
    add(c.stale, 'out of date', 'warn');
    add(c.edited + c.differs, 'changed there', 'edit');
    add(c.restore, 'deleted there', 'miss');
    add(c.publish, 'published differently', 'warn');
    add(c.origin, ['differs from the class it came from', 'differ from the class they came from'], 'edit');
    add(c.lookalike, ['class has its own same-titled item', 'classes have their own same-titled item'], 'muted');
    var errs = b.scan.dests.filter(function (d) { return d.error; });
    var allGood = !bits.length && !errs.length;
    return '<section class="cgp-roster__section cgp-board__summary">' +
      (allGood
        ? '<p class="cgp-board__allgood"><span aria-hidden="true">✓</span> Every item here is the same in your other classes (' + c.same + ' copies checked).</p>'
        : '<div class="cgp-board__counts">' + bits.join('') + (c.same ? '<span class="cgp-board__count is-ok">' + c.same + ' up to date</span>' : '') + '</div>') +
      errs.map(function (d) { return '<p class="cgp-sections__err">' + esc(this.courseName(d.courseId)) + ': ' + esc(d.error) + '</p>'; }, this).join('') +
      (b.scan.truncated && Object.keys(b.scan.truncated).length
        ? '<p class="cgp-stats__note">This class has more items than Gradebook+ reads at once; some may not be listed.</p>' : '') +
      '</section>';
  };

  P.renderBoardControls = function () {
    var b = this.state.board;
    var tabs = [['all', 'All']].concat(TYPE_ORDER.map(function (t) { return [t, S().TYPES[t].plural]; })).map(function (t) {
      return '<button type="button" class="cgp-sections__tab' + (b.type === t[0] ? ' is-on' : '') + '" data-board-type="' + t[0] + '" aria-pressed="' + (b.type === t[0]) + '">' + esc(t[1]) + '</button>';
    }).join('');
    return '<div class="cgp-board__controls">' +
      '<div class="cgp-sections__tabs" role="group" aria-label="Kind of item">' + tabs + '</div>' +
      '<label class="cgp-roster__field">Show <select data-board-role="filter">' +
      '<option value="attention"' + (b.filter === 'attention' ? ' selected' : '') + '>What needs attention</option>' +
      '<option value="all"' + (b.filter === 'all' ? ' selected' : '') + '>Everything</option></select></label>' +
      '<input type="search" class="cgp-sections__filter cgp-board__q" data-board-role="q" placeholder="Filter by title…" value="' + esc(b.q || '') + '" aria-label="Filter by title">' +
      '</div>';
  };

  P.renderBoardTable = function () {
    var self = this;
    var b = this.state.board;
    var rows = this.boardRows();
    var dests = b.dests;
    if (!rows.length) {
      return '<p class="cgp-stats__note cgp-board__empty">' + (b.filter === 'attention'
        ? 'Nothing here needs attention' + (b.type !== 'all' || b.q ? ' with these filters' : '') + '.'
        : 'No items match.') + '</p>';
    }
    var head = '<tr><th scope="col" class="cgp-board__itemcol">Item</th>' + dests.map(function (d) {
      return '<th scope="col">' + esc(self.courseName(d)) + '</th>';
    }).join('') + '</tr>';
    var body = rows.map(function (r) {
      var it = r.item;
      var t = S().TYPES[it.type];
      var title = '<a href="' + esc(S().itemHtmlPath(self.courseId, it.type, it.id)) + '" target="_blank" rel="noopener">' +
        esc(it.title || '(untitled)') + '</a>';
      var tags = '<span class="cgp-sections__tag">' + esc(t.label) + '</span>' + (it.published ? '' : '<span class="cgp-sections__tag">unpublished</span>');
      if (r.origin) tags += '<span class="cgp-sections__tag cgp-sections__tag--hint" title="Copied here from ' + esc(self.courseName(r.origin.courseId)) + '">from ' + esc(self.courseName(r.origin.courseId)) + '</span>';
      return '<tr><th scope="row" class="cgp-board__itemcol"><div class="cgp-board__title">' + title + '</div><div class="cgp-board__tags">' + tags + '</div></th>' +
        dests.map(function (d) { return '<td>' + self.renderBoardCell(r, d) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="cgp-board__wrap"><table class="cgp-board__table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  };

  P.renderBoardCell = function (r, d) {
    var self = this;
    var b = this.state.board;
    var it = r.item;
    var name = this.courseName(d);
    if (r.origin && r.origin.courseId === d) {
      var o = ORIGIN[r.origin.status] || ORIGIN.differs;
      var acts = [];
      if (r.origin.status === 'stale' || r.origin.status === 'differs') {
        acts.push('<button type="button" class="cgp-board__link" data-board-act="pull" data-key="' + esc(r.key) + '" data-dest="' + esc(d) + '">Update this class from it…</button>');
      }
      if ((r.origin.status === 'edited' || r.origin.status === 'differs') && S().TYPES[it.type].body) {
        acts.push('<button type="button" class="cgp-board__link" data-board-act="push-back" data-key="' + esc(r.key) + '" data-dest="' + esc(d) + '">Review and update ' + esc(name) + '…</button>');
      }
      return '<div class="cgp-board__cell is-' + o.tone + '"><span class="cgp-board__chip"><span aria-hidden="true">' + o.mark + '</span> ' + esc(o.label) + '</span>' +
        (r.origin.diffs && r.origin.diffs.length ? '<div class="cgp-board__detail">' + esc(r.origin.diffs.join('; ')) + '</div>' : '') +
        '<div class="cgp-board__acts"><a class="cgp-board__link" href="' + esc(r.origin.url) + '" target="_blank" rel="noopener">Open</a>' + acts.join('') + '</div></div>';
    }
    var c = r.cells[d];
    if (!c) return '<span class="cgp-stats__note">—</span>';
    var spec = CELL[c.status] || CELL.unknown;
    var k = r.key + '>' + d;
    var details = [];
    if (c.diffs && c.diffs.length) details.push(c.diffs.join('; '));
    if (c.drift && c.drift.missing.length) details.push('Missing there: ' + c.drift.missing.slice(0, 4).join(', ') + (c.drift.missing.length > 4 ? '…' : ''));
    if (c.drift && c.drift.extra.length) details.push('Only there: ' + c.drift.extra.slice(0, 4).join(', ') + (c.drift.extra.length > 4 ? '…' : ''));
    if (c.lookalike) details.push('“' + c.lookalike.title + '” there was not copied from here; copying would add a second one.');
    if (c.status === 'unknown') details.push(c.unreadable ? 'Canvas did not send this page’s text, so it was not compared. Check again.' : 'That class has too many of these to read at once.');
    var pub = c.publishMismatch ? '<span class="cgp-board__pub" title="' + esc(it.published ? 'Published here, not there' : 'Not published here, published there') + '">' +
      (it.published ? 'unpublished there' : 'published there') + '</span>' : '';
    var box = spec.pick
      ? '<input type="checkbox" data-board-sel="' + esc(k) + '"' + (b.sel[k] ? ' checked' : '') +
        ' aria-label="' + esc('Copy “' + (it.title || '') + '” to ' + name) + '"> '
      : '';
    var acts = [];
    var link = c.url || (c.lookalike && c.lookalike.url);
    if (link) acts.push('<a class="cgp-board__link" href="' + esc(link) + '" target="_blank" rel="noopener">Open</a>');
    if ((c.status === 'edited' || c.status === 'differs') && S().TYPES[it.type].body && c.destId) {
      acts.push('<button type="button" class="cgp-board__link" data-board-act="review" data-key="' + esc(r.key) + '" data-dest="' + esc(d) + '">Review</button>');
    }
    return '<div class="cgp-board__cell is-' + spec.tone + '"><label class="cgp-board__chip">' + box +
      '<span aria-hidden="true">' + spec.mark + '</span> ' + esc(spec.label) + '</label>' + pub +
      (details.length ? '<div class="cgp-board__detail">' + esc(details.join(' · ')) + '</div>' : '') +
      (acts.length ? '<div class="cgp-board__acts">' + acts.join('') + '</div>' : '') + '</div>';
  };

  P.renderBoardOrphans = function () {
    var self = this;
    var scan = this.state.board.scan;
    var list = [];
    scan.dests.forEach(function (d) { (d.orphans || []).forEach(function (o) { list.push(Object.assign({ courseId: d.courseId }, o)); }); });
    if (!list.length) return '';
    return '<details class="cgp-roster__section cgp-board__orphans"><summary>' + list.length +
      (list.length === 1 ? ' copy is' : ' copies are') + ' in your other classes, but the original is no longer here</summary>' +
      '<p class="cgp-stats__note">Deleted here after it was copied. Gradebook+ never deletes anything in your other classes; open each to decide.</p>' +
      '<ul class="cgp-board__orphanlist">' + list.map(function (o) {
        return '<li><span class="cgp-sections__tag">' + esc(S().TYPES[o.type].label) + '</span> ' + esc(o.title || '(untitled)') + ' — ' +
          esc(self.courseName(o.courseId)) + ' <a class="cgp-board__link" href="' + esc(o.url) + '" target="_blank" rel="noopener">Open</a></li>';
      }).join('') + '</ul></details>';
  };

  P.renderBoardActions = function () {
    var b = this.state.board;
    var n = Object.keys(b.sel).filter(function (k) { return b.sel[k]; }).length;
    var missing = this.cellsWith(['new']).length;
    var stale = this.cellsWith(['stale']).length;
    var fixes = this.publishFixes().length;
    return '<div class="cgp-roster__row cgp-roster__actions cgp-board__go">' +
      '<span class="cgp-board__quick">Tick: ' +
      '<button type="button" class="cgp-board__link" data-board-act="sel-missing"' + (missing ? '' : ' disabled') + '>all missing (' + missing + ')</button> · ' +
      '<button type="button" class="cgp-board__link" data-board-act="sel-stale"' + (stale ? '' : ' disabled') + '>all out of date (' + stale + ')</button> · ' +
      '<button type="button" class="cgp-board__link" data-board-act="sel-none"' + (n ? '' : ' disabled') + '>none</button></span>' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-board-act="copy"' + (n && !b.busy ? '' : ' disabled') + '>' +
      (n ? 'Review and copy ' + n + (n === 1 ? ' item…' : ' items…') : 'Tick what to copy') + '</button>' +
      (fixes ? '<button type="button" class="cgp-roster__btn" data-board-act="publish"' + (b.busy ? ' disabled' : '') +
        ' title="Publish or unpublish the copies shown so each matches this class">Match publishing (' + fixes + ')</button>' : '') +
      '<button type="button" class="cgp-roster__btn" data-board-act="rescan"' + (b.busy ? ' disabled' : '') + '>Check again</button>' +
      '</div><p class="cgp-stats__note">Copy shows each class’s dates and what will happen there before anything is written. ' +
      'Copies changed in their own class are kept unless you choose to replace them.</p>';
  };

  /* ------------------------------------------------------------ events */

  P.onBoardClick = function (e) {
    var st = this.state;
    if (!st || st.view !== 'board') return;
    var b = st.board;
    var t = e.target;
    var typeBtn = t.closest && t.closest('[data-board-type]');
    if (typeBtn) { b.type = typeBtn.getAttribute('data-board-type'); this.renderBoard(); return; }
    var act = t.closest && t.closest('[data-board-act]');
    if (!act || act.disabled) return;
    var a = act.getAttribute('data-board-act');
    var self = this;
    var rowOf = function () {
      var key = act.getAttribute('data-key');
      return self.boardRows().filter(function (r) { return r.key === key; })[0] ||
        (b.scan ? b.scan.items.filter(function (it) { return itemKey(it) === key; }).map(function (it) { return { item: it, key: key }; })[0] : null);
    };
    if (a === 'rescan') return this.scanBoard();
    if (a === 'sel-missing' || a === 'sel-stale') {
      this.cellsWith(a === 'sel-missing' ? ['new'] : ['stale']).forEach(function (k) { b.sel[k] = true; });
      this.renderBoard();
      return;
    }
    if (a === 'sel-none') { b.sel = {}; this.renderBoard(); return; }
    if (a === 'copy') return this.copyFromBoard();
    if (a === 'publish') return this.publishFromBoard();
    if (a === 'review') {
      var r = rowOf();
      var cell = r && b.scan.dests.filter(function (x) { return x.courseId === act.getAttribute('data-dest'); })[0];
      cell = cell && cell.cells[r.key];
      if (r && cell && cell.destId) return this.openBack({ origCourse: this.courseId, origRef: r.item, copyCourse: act.getAttribute('data-dest'), copyId: cell.destId });
      return;
    }
    if (a === 'push-back' || a === 'pull') {
      var row = rowOf();
      var d = act.getAttribute('data-dest');
      var dest = b.scan.dests.filter(function (x) { return x.courseId === d; })[0];
      var origin = dest && dest.origins && dest.origins[row && row.key];
      if (!row || !origin) return;
      if (a === 'push-back') {
        return this.openBack({ origCourse: d, origRef: { type: row.item.type, id: origin.srcId }, copyCourse: this.courseId, copyId: row.item.id });
      }
      var ctl = new CGP.SectionCopyController({ api: this.api, courseId: d, settings: this.settings });
      var src = Object.assign({}, origin.item, { htmlLoaded: true });
      this.close();
      var only = {};
      only[itemKey(src) + '>' + this.courseId] = true;
      return ctl.open({ items: [src], dests: [this.courseId], only: only, full: true });
    }
  };

  P.onBoardChange = function (e) {
    var st = this.state;
    if (!st || st.view !== 'board') return;
    var t = e.target;
    if (t.hasAttribute('data-board-sel')) {
      st.board.sel[t.getAttribute('data-board-sel')] = !!t.checked;
      this.renderBoard();
      return;
    }
    if (t.getAttribute('data-board-role') === 'filter') { st.board.filter = t.value; this.renderBoard(); }
  };

  P.onBoardInput = function (e) {
    var st = this.state;
    if (!st || st.view !== 'board') return;
    var t = e.target;
    if (t.getAttribute('data-board-role') !== 'q') return;
    st.board.q = t.value;
    var pos = t.selectionStart;
    this.renderBoard();
    var again = this.root && this.root.querySelector('[data-board-role="q"]');
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } }
  };

  /* The ticked cells, into the copy dialog: exactly those (item, class)
   * pairs ticked there, everything else unticked, with the full survey and
   * date checks run again on what is there now. */
  P.copyFromBoard = function () {
    var b = this.state.board;
    var keys = Object.keys(b.sel).filter(function (k) { return b.sel[k]; });
    if (!keys.length) return;
    var wanted = {};
    keys.forEach(function (k) { wanted[k.split('>')[0]] = true; });
    var items = b.scan.items.filter(function (it) { return wanted[itemKey(it)]; }).map(function (it) {
      return Object.assign({}, it, { children: undefined });
    });
    var dests = {};
    keys.forEach(function (k) { dests[k.split('>')[1]] = true; });
    var only = {};
    keys.forEach(function (k) { only[k] = true; });
    this.open({ items: items, dests: Object.keys(dests), only: only, full: true });
  };

  P.publishFromBoard = function () {
    var self = this;
    var st = this.state;
    var b = st.board;
    var fixes = this.publishFixes();
    if (!fixes.length) return;
    var on = fixes.filter(function (f) { return f.want; }).length;
    var off = fixes.length - on;
    var parts = [];
    if (on) parts.push('publish ' + on + (on === 1 ? ' copy' : ' copies'));
    if (off) parts.push('unpublish ' + off + (off === 1 ? ' copy' : ' copies'));
    var msg = 'Match this class’s publishing: ' + parts.join(' and ') + ' in your other classes?' +
      (fixes.some(function (f) { return f.type === 'module'; })
        ? '\n\nA module is published or unpublished with everything in it, as on the Modules page.' : '') +
      (off ? '\n\nCanvas keeps work that students have already submitted published.' : '');
    if (!window.confirm(msg)) return;
    b.busy = true;
    this.renderBoard();
    this.copier.setPublishing(fixes).then(function (res) {
      if (self.state !== st) return;
      b.busy = false;
      var bad = res.map(function (r, i) { return r.ok ? null : fixes[i]; }).filter(Boolean);
      if (bad.length) {
        CGP.ui.error((res.length - bad.length) + ' of ' + res.length + ' changed. Not changed: ' + bad.slice(0, 3).map(function (f) {
          return '“' + f.title + '” in ' + f.name + ' (' + res[fixes.indexOf(f)].error + ')';
        }).join('; ') + (bad.length > 3 ? '…' : ''));
      } else CGP.ui.toast('Publishing matches this class now (' + res.length + ').');
      self.scanBoard();
    });
  };

  CGP.sectionBoard = { CELL: CELL, ORIGIN: ORIGIN, needsAttention: needsAttention };
})();
