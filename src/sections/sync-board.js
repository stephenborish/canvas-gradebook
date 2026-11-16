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

  /* What a cell is called and how it looks. One vocabulary whichever class
   * an item was first copied from: the teacher sees this class and that
   * class, and either can be brought in line with the other.
   *   pick: can be ticked for the copy dialog
   *   bulk: ticked by "Select all …" (never a version newer there) */
  var KIND = {
    same: { label: 'Same', mark: '✓', tone: 'ok' },
    missing: { label: 'Not there', mark: '+', tone: 'miss', pick: true, bulk: 'missing' },
    deleted: { label: 'Deleted there', mark: '+', tone: 'miss', pick: true },
    // Older, newer or unknown are all "Different" to the teacher; which
    // side is newer is a small note under it.
    older: { label: 'Different', note: 'newer here', mark: '≠', tone: 'edit', pick: true, bulk: 'older' },
    newer: { label: 'Different', note: 'newer there', mark: '≠', tone: 'edit', pick: true },
    differs: { label: 'Different', mark: '≠', tone: 'edit', pick: true },
    own: { label: 'Has its own', mark: '!', tone: 'muted' },
    unknown: { label: 'Couldn’t check', mark: '?', tone: 'muted' }
  };

  /* Kept for callers that name statuses (sync-runner.js scan). */
  var CELL = {
    same: 'same', stale: 'older', 'new': 'missing', restore: 'deleted', edited: 'newer', differs: 'differs', lookalike: 'own', unknown: 'unknown'
  };
  /* An item here that is that class's copy, from the copy's side. */
  var ORIGIN = { same: 'same', stale: 'newer', edited: 'older', differs: 'differs' };

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

  /* Rows to show, after the filters: [{item, key, origin, cells}]. origin:
   * the class this item was copied from, with how the two compare. */
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
        if (d.origins && d.origins[k] && !origin) origin = Object.assign({ courseId: d.courseId }, d.origins[k]);
        cells[d.courseId] = d.error ? null : (d.cells[k] || null);
      });
      return { item: it, key: k, origin: origin, cells: cells };
    });
    return rows.filter(function (r) {
      if (b.type !== 'all' && r.item.type !== b.type) return false;
      if (q && String(r.item.title || '').toLowerCase().indexOf(q) < 0) return false;
      if (b.filter === 'attention') return self.rowNeedsAttention(r);
      return true;
    });
  };

  /* One cell, from this class's side: {kind, ctx (for the side-by-side
   * review), destId, url, details, publishMismatch}. null: not read. */
  P.cellView = function (r, d) {
    var it = r.item;
    if (r.origin && String(r.origin.courseId) === String(d)) {
      var o = r.origin;
      return {
        kind: ORIGIN[o.status] || 'differs', destId: o.srcId, url: o.url, details: o.diffs || [], publishMismatch: false,
        ctx: { origCourse: String(d), origRef: { type: it.type, id: o.srcId }, copyCourse: this.courseId, copyId: it.id }
      };
    }
    var c = r.cells[d];
    if (!c) return null;
    var kind = CELL[c.status] || 'unknown';
    var details = (c.diffs || []).slice();
    if (c.drift && c.drift.missing.length) details.push('Missing there: ' + c.drift.missing.slice(0, 4).join(', ') + (c.drift.missing.length > 4 ? '…' : ''));
    if (c.drift && c.drift.extra.length) details.push('Only there: ' + c.drift.extra.slice(0, 4).join(', ') + (c.drift.extra.length > 4 ? '…' : ''));
    if (c.lookalike) details.push('Its own “' + c.lookalike.title + '”, not a copy of this one. Copying would add a second.');
    if (c.status === 'unknown') details.push(c.unreadable ? 'Canvas didn’t send its text. Check again.' : 'That class has too many of these to read at once.');
    return {
      kind: kind, destId: c.destId, url: c.url || (c.lookalike && c.lookalike.url), details: details, publishMismatch: !!c.publishMismatch,
      ctx: c.destId ? { origCourse: this.courseId, origRef: it, copyCourse: String(d), copyId: c.destId } : null
    };
  };

  P.rowNeedsAttention = function (r) {
    var self = this;
    return Object.keys(r.cells).concat(r.origin ? [String(r.origin.courseId)] : []).some(function (d) {
      var v = self.cellView(r, d);
      return v && ((v.kind !== 'same' && v.kind !== 'unknown') || v.publishMismatch);
    });
  };

  /* Counts by kind over every row (not only the ones shown). */
  P.boardCounts = function () {
    var self = this;
    var b = this.state.board;
    var out = { same: 0, missing: 0, deleted: 0, older: 0, newer: 0, differs: 0, own: 0, unknown: 0, publish: 0 };
    if (!b.scan) return out;
    var saved = { filter: b.filter, type: b.type, q: b.q };
    b.filter = 'all'; b.type = 'all'; b.q = '';
    var rows = this.boardRows();
    b.filter = saved.filter; b.type = saved.type; b.q = saved.q;
    rows.forEach(function (r) {
      b.dests.forEach(function (d) {
        var v = self.cellView(r, String(d));
        if (!v) return;
        out[v.kind]++;
        if (v.publishMismatch) out.publish++;
      });
    });
    return out;
  };

  /* The cells a "Select all" link ticks, among the rows shown. */
  P.cellsOfKind = function (kinds) {
    var self = this;
    var out = [];
    this.boardRows().forEach(function (r) {
      self.state.board.dests.forEach(function (d) {
        var v = self.cellView(r, String(d));
        if (v && kinds.indexOf(v.kind) >= 0) out.push(r.key + '>' + d);
      });
    });
    return out;
  };

  /* By the scan's own statuses (the copy-side view only). */
  P.cellsWith = function (statuses) {
    var out = [];
    this.boardRows().forEach(function (r) {
      Object.keys(r.cells).forEach(function (d) {
        var c = r.cells[d];
        if (!c || (r.origin && String(r.origin.courseId) === d)) return;
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
        if (!c || !c.publishMismatch || !c.destId || (r.origin && String(r.origin.courseId) === d)) return;
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
    this.root.querySelector('#cgp-sections-title').textContent = this.courseName(this.courseId) + ' vs. your other classes';
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
        (p ? 'Reading your classes… ' + p[0] + ' of ' + p[1] + '.' : 'Loading your classes…') + '</p>';
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
    var add = function (n, text, tone) { if (n) bits.push('<span class="cgp-board__count is-' + tone + '">' + n + ' ' + esc(text) + '</span>'); };
    add(c.missing + c.deleted, 'not there', 'miss');
    add(c.older + c.newer + c.differs, 'different', 'edit');
    add(c.publish, 'published differently', 'warn');
    var errs = b.scan.dests.filter(function (d) { return d.error; });
    var allGood = !bits.length && !errs.length;
    return '<section class="cgp-roster__section cgp-board__summary">' +
      (allGood
        ? '<p class="cgp-board__allgood"><span aria-hidden="true">✓</span> Everything here is the same in your other classes.</p>'
        : '<div class="cgp-board__counts">' + bits.join('') + (c.same ? '<span class="cgp-board__count is-ok">' + c.same + ' same</span>' : '') + '</div>') +
      errs.map(function (d) { return '<p class="cgp-sections__err">' + esc(this.courseName(d.courseId)) + ': ' + esc(d.error) + '</p>'; }, this).join('') +
      (b.scan.truncated && Object.keys(b.scan.truncated).length
        ? '<p class="cgp-stats__note">This class has more items than can be read at once; some may be missing from the list.</p>' : '') +
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
      '<option value="attention"' + (b.filter === 'attention' ? ' selected' : '') + '>Only what’s not the same</option>' +
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
        ? 'Everything' + (b.type !== 'all' || b.q ? ' shown' : '') + ' is the same in your other classes.'
        : 'No items match.') + '</p>';
    }
    var head = '<tr><th scope="col" class="cgp-board__itemcol">In ' + esc(this.courseName(this.courseId)) + '</th>' + dests.map(function (d) {
      return '<th scope="col">' + esc(self.courseName(d)) + '</th>';
    }).join('') + '</tr>';
    var body = rows.map(function (r) {
      var it = r.item;
      var t = S().TYPES[it.type];
      var title = '<a href="' + esc(S().itemHtmlPath(self.courseId, it.type, it.id)) + '" target="_blank" rel="noopener">' +
        esc(it.title || '(untitled)') + '</a>';
      var tags = '<span class="cgp-sections__tag">' + esc(t.label) + '</span>' + (it.published ? '' : '<span class="cgp-sections__tag">unpublished</span>');
      return '<tr><th scope="row" class="cgp-board__itemcol"><div class="cgp-board__title">' + title + '</div><div class="cgp-board__tags">' + tags + '</div></th>' +
        dests.map(function (d) { return '<td>' + self.renderBoardCell(r, String(d)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="cgp-board__wrap"><table class="cgp-board__table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  };

  P.renderBoardCell = function (r, d) {
    var b = this.state.board;
    var it = r.item;
    var name = this.courseName(d);
    var v = this.cellView(r, d);
    if (!v) return '<span class="cgp-stats__note">—</span>';
    var spec = KIND[v.kind] || KIND.unknown;
    var k = r.key + '>' + d;
    var hasBody = !!S().TYPES[it.type].body && it.type !== 'module';
    var pub = v.publishMismatch ? '<span class="cgp-board__pub" title="' + esc(it.published ? 'Published here, not there' : 'Not published here, published there') + '">' +
      (it.published ? 'unpublished there' : 'published there') + '</span>' : '';
    var box = spec.pick
      ? '<input type="checkbox" data-board-sel="' + esc(k) + '"' + (b.sel[k] ? ' checked' : '') +
        ' aria-label="' + esc('Copy “' + (it.title || '') + '” to ' + name) + '"> '
      : '';
    var acts = [];
    if (v.url) acts.push('<a class="cgp-board__link" href="' + esc(v.url) + '" target="_blank" rel="noopener">Open</a>');
    if (hasBody && v.ctx && (v.kind === 'older' || v.kind === 'newer' || v.kind === 'differs')) {
      var prefer = v.kind === 'older' ? 'there' : (v.kind === 'newer' ? 'here' : '');
      acts.push('<button type="button" class="cgp-board__link" data-board-act="match" data-prefer="' + prefer + '" data-key="' + esc(r.key) + '" data-dest="' + esc(d) + '">Pick a version…</button>');
    }
    return '<div class="cgp-board__cell is-' + spec.tone + '"><label class="cgp-board__chip">' + box +
      '<span aria-hidden="true">' + spec.mark + '</span> ' + esc(spec.label) + '</label>' +
      (spec.note ? '<span class="cgp-board__note">' + esc(spec.note) + '</span>' : '') + pub +
      (v.details.length ? '<div class="cgp-board__detail">' + esc(v.details.join(' · ')) + '</div>' : '') +
      (acts.length ? '<div class="cgp-board__acts">' + acts.join('') + '</div>' : '') + '</div>';
  };

  P.renderBoardOrphans = function () {
    var self = this;
    var scan = this.state.board.scan;
    var list = [];
    scan.dests.forEach(function (d) { (d.orphans || []).forEach(function (o) { list.push(Object.assign({ courseId: d.courseId }, o)); }); });
    if (!list.length) return '';
    return '<details class="cgp-roster__section cgp-board__orphans"><summary>' + list.length +
      (list.length === 1 ? ' item is' : ' items are') + ' in your other classes but no longer here</summary>' +
      '<p class="cgp-stats__note">Deleted here after copying. Nothing is deleted in your other classes; open each to decide.</p>' +
      '<ul class="cgp-board__orphanlist">' + list.map(function (o) {
        return '<li><span class="cgp-sections__tag">' + esc(S().TYPES[o.type].label) + '</span> ' + esc(o.title || '(untitled)') + ' — ' +
          esc(self.courseName(o.courseId)) + ' <a class="cgp-board__link" href="' + esc(o.url) + '" target="_blank" rel="noopener">Open</a></li>';
      }).join('') + '</ul></details>';
  };

  P.renderBoardActions = function () {
    var b = this.state.board;
    var n = Object.keys(b.sel).filter(function (k) { return b.sel[k]; }).length;
    var missing = this.cellsOfKind(['missing', 'deleted']).length;
    var older = this.cellsOfKind(['older']).length;
    var fixes = this.publishFixes().length;
    var quick = [];
    if (missing) quick.push('<button type="button" class="cgp-board__link" data-board-act="sel-missing">all not there (' + missing + ')</button>');
    if (older) quick.push('<button type="button" class="cgp-board__link" data-board-act="sel-stale">all newer here (' + older + ')</button>');
    if (n) quick.push('<button type="button" class="cgp-board__link" data-board-act="sel-none">none</button>');
    return '<div class="cgp-roster__row cgp-roster__actions cgp-board__go">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-board-act="copy"' + (n && !b.busy ? '' : ' disabled') + '>' +
      (n ? 'Copy ' + n + ' ticked…' : 'Tick what to copy') + '</button>' +
      (quick.length ? '<span class="cgp-board__quick">Select ' + quick.join(' · ') + '</span>' : '') +
      '<span class="cgp-board__spacer"></span>' +
      (fixes ? '<button type="button" class="cgp-roster__btn" data-board-act="publish"' + (b.busy ? ' disabled' : '') +
        ' title="Publish or unpublish those copies so each matches this class">Match publishing (' + fixes + ')</button>' : '') +
      '<button type="button" class="cgp-roster__btn" data-board-act="rescan"' + (b.busy ? ' disabled' : '') + '>Check again</button>' +
      '</div>';
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
      this.cellsOfKind(a === 'sel-missing' ? ['missing', 'deleted'] : ['older']).forEach(function (k) { b.sel[k] = true; });
      this.renderBoard();
      return;
    }
    if (a === 'sel-none') { b.sel = {}; this.renderBoard(); return; }
    if (a === 'copy') return this.copyFromBoard();
    if (a === 'publish') return this.publishFromBoard();
    if (a === 'match') {
      var r = rowOf();
      var v = r && r.cells ? this.cellView(r, act.getAttribute('data-dest')) : null;
      if (v && v.ctx) return this.openMatch(v.ctx, act.getAttribute('data-prefer') || null);
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
    this.open({ items: items, dests: Object.keys(dests), only: only });
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

  CGP.sectionBoard = { KIND: KIND, CELL: CELL, ORIGIN: ORIGIN, needsAttention: needsAttention };
})();
