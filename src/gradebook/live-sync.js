/* Canvas Gradebook+ - keep open gradebook and SpeedGrader tabs in step.
 *
 * A grade, status or comment saved in SpeedGrader never reached a gradebook
 * already open in another tab, and one saved in the gradebook never reached
 * an open SpeedGrader: each kept showing what it loaded until the teacher
 * reloaded it. Canvas itself has no channel between the two.
 *
 * Every tab of a course announces each submission it saves - its own writes,
 * and Canvas's (write-watch.js) - as ids only: {courseId, cells:
 * [{assignmentId, userId}]}. The background worker relays the announcement
 * to the other tabs of the same Canvas site and course (background.js);
 * nothing is stored, and no grades, names or comments travel.
 *
 *  - A gradebook re-reads exactly those cells (a whole column when the
 *    announcement names no student, or many), updates its own indicators
 *    and hands what changed to Canvas's own store (canvas-store.js), so the
 *    grid, the Total and the Grade Detail Tray all show it. It also re-reads
 *    its visible columns when its tab or window comes back into view, which
 *    covers changes made where nothing could announce them (another
 *    teacher, a student submitting).
 *  - SpeedGrader, when the change is to the submission it is showing, asks
 *    Canvas's platform SpeedGrader to refetch it - the same message
 *    Canvas's own code sends it - or, in classic SpeedGrader, which has no
 *    such hook, says so with a one-click reload (unsent comments are kept
 *    by the draft protection). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.LiveSync) return;

  var MESSAGE_TYPE = 'cgp.live.changed';
  var MAX_CELLS = 200;
  // Announcements are gathered this long before going out, so a paste that
  // saves a hundred cells is a few messages - and the other tab one column
  // read - rather than a hundred single re-reads.
  var BATCH_MS = 300;

  function isId(v) { return /^\d+$/.test(String(v === undefined || v === null ? '' : v)); }

  /* ------------------------------------------------------------- transport */

  function LiveSync(ctx) {
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings || null;
    this.runtime = ctx.runtime !== undefined ? ctx.runtime
      : (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null);
    this._listeners = [];
    this._bound = false;
    this._delayMs = ctx.delayMs === undefined ? BATCH_MS : ctx.delayMs;
    // commentsOnly -> {cells, seen}, sent together after _delayMs.
    this._buffer = { 'true': null, 'false': null };
    this._timer = null;
  }

  var L = LiveSync.prototype;

  L.enabled = function () {
    var v = this.settings && this.settings.values;
    return !(v && v.liveSync === false);
  };

  /* cells: [{assignmentId, userId?}]. A cell without a student means "this
   * whole column may have changed". */
  L.announce = function (cells, opts) {
    if (!this.enabled() || !this.runtime || typeof this.runtime.sendMessage !== 'function') return false;
    var key = String(!!(opts && opts.commentsOnly));
    var batch = this._buffer[key] || (this._buffer[key] = { cells: [], seen: Object.create(null) });
    var added = 0;
    (cells || []).forEach(function (c) {
      if (!c || !isId(c.assignmentId)) return;
      var uid = isId(c.userId) ? String(c.userId) : null;
      var k = c.assignmentId + ':' + (uid || '*');
      if (batch.seen[k]) return;
      batch.seen[k] = true;
      batch.cells.push({ assignmentId: String(c.assignmentId), userId: uid });
      added++;
    });
    if (!added) return false;
    var self = this;
    if (this._delayMs <= 0) this.flush();
    else if (!this._timer) this._timer = setTimeout(function () { self._timer = null; self.flush(); }, this._delayMs);
    return true;
  };

  L.flush = function () {
    var self = this;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    ['false', 'true'].forEach(function (key) {
      var batch = self._buffer[key];
      self._buffer[key] = null;
      if (!batch || !batch.cells.length) return;
      for (var i = 0; i < batch.cells.length; i += MAX_CELLS) {
        self._send(batch.cells.slice(i, i + MAX_CELLS), key === 'true');
      }
    });
  };

  L._send = function (cells, commentsOnly) {
    try {
      var sent = this.runtime.sendMessage({
        type: MESSAGE_TYPE,
        courseId: this.courseId,
        cells: cells,
        commentsOnly: commentsOnly
      });
      // No other tab listening (or the worker restarting) is not an error.
      if (sent && typeof sent.catch === 'function') sent.catch(function () { });
      CGP.diag.bump('liveSync.announced', cells.length);
    } catch (e) {
      // "Extension context invalidated" after an update: this tab is orphaned.
    }
  };

  L.onChange = function (fn) {
    this._listeners.push(fn);
    if (this._bound || !this.runtime || !this.runtime.onMessage) return;
    this._bound = true;
    var self = this;
    this.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== MESSAGE_TYPE || String(msg.courseId) !== self.courseId) return;
      if (!self.enabled() || !Array.isArray(msg.cells)) return;
      var cells = msg.cells.filter(function (c) { return c && isId(c.assignmentId); }).slice(0, MAX_CELLS)
        .map(function (c) { return { assignmentId: String(c.assignmentId), userId: isId(c.userId) ? String(c.userId) : null }; });
      if (!cells.length) return;
      CGP.diag.bump('liveSync.received', cells.length);
      self._listeners.forEach(function (cb) {
        try { cb({ cells: cells, commentsOnly: !!msg.commentsOnly }); } catch (e) {
          CGP.diag.error('liveSync.listener.failed', { message: String(e && e.message) });
        }
      });
    });
  };

  /* ------------------------------------------------------- gradebook side */

  var CELL_LIMIT = 12;          // more than this in one column: read the column
  var FLUSH_MS = 250;
  var REFOCUS_EVERY_MS = 15000;

  function GradebookFollower(ctx) {
    this.model = ctx.model;
    this.canvasStore = ctx.canvasStore || null;
    this.liveSync = ctx.liveSync;
    this.adapter = ctx.adapter || null;
    this.requestPaint = ctx.requestPaint || null;
    this._queue = new Map();      // assignmentId -> {users: Set, whole: bool, comments: Set}
    this._timer = null;
    this._lastRefocusAt = 0;
    this._gate = CGP.util.pool(3);
  }

  var G = GradebookFollower.prototype;

  G.start = function () {
    var self = this;
    if (this.liveSync) this.liveSync.onChange(function (msg) { self.receive(msg); });
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) self.refreshVisible('visible');
      });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', function () { self.refreshVisible('focus'); });
    }
  };

  G.receive = function (msg) {
    var self = this;
    (msg.cells || []).forEach(function (c) {
      var entry = self._queue.get(c.assignmentId) || { users: new Set(), whole: false, comments: new Set() };
      if (c.userId) {
        entry.users.add(c.userId);
        if (msg.commentsOnly) entry.comments.add(c.userId);
      } else {
        entry.whole = true;
      }
      self._queue.set(c.assignmentId, entry);
    });
    if (!this._timer) this._timer = setTimeout(function () { self._timer = null; self.flush(); }, FLUSH_MS);
  };

  /* Hands what changed to Canvas's store, and refreshes the Totals that
   * might have moved. */
  G.deliver = function (submissions, readStartedAt, commentCells) {
    var self = this;
    var subs = (submissions || []).filter(Boolean);
    if (this.canvasStore && (subs.length || (commentCells && commentCells.length))) {
      this.canvasStore.push(subs, { readStartedAt: readStartedAt, commentsFor: commentCells || [] });
    }
    subs.forEach(function (s) { self.model.queueTotalRefresh(String(s.user_id)); });
    if (this.requestPaint) this.requestPaint();
  };

  G.flush = function () {
    var self = this;
    var model = this.model;
    if (!model || !model.ready) { this._queue.clear(); return Promise.resolve(null); }
    var columns = [];
    var cells = [];
    this._queue.forEach(function (entry, aid) {
      if (!model.assignment(aid)) return;
      if (entry.whole || entry.users.size > CELL_LIMIT) {
        columns.push(aid);
        return;
      }
      entry.users.forEach(function (uid) {
        if (model.student(uid)) cells.push({ assignmentId: aid, userId: uid, comments: entry.comments.has(uid) });
      });
    });
    this._queue.clear();
    var jobs = [];
    if (columns.length) {
      jobs.push(model.resyncAssignments(columns).then(function (r) {
        if (r) self.deliver(r.submissions, r.readStartedAt, []);
      }));
    }
    cells.forEach(function (c) {
      jobs.push(self._gate(function () { return model.syncCell(c.assignmentId, c.userId); }).then(function (r) {
        if (!r || !r.applied) return;
        var commentCells = (r.commentsChanged || c.comments) ? [{ assignmentId: c.assignmentId, userId: c.userId }] : [];
        self.deliver(r.changed ? [r.submission] : [], r.readStartedAt, commentCells);
      }));
    });
    return Promise.all(jobs.map(function (j) { return j.catch(function () { return null; }); }));
  };

  /* Back in view: whatever changed while nobody was looking, in the columns
   * on screen. At most every REFOCUS_EVERY_MS, however often focus moves. */
  G.refreshVisible = function (reason) {
    var self = this;
    var model = this.model;
    if (!model || !model.ready || !this.liveSync || !this.liveSync.enabled() || !this.adapter) return Promise.resolve(null);
    var now = Date.now();
    if (now - this._lastRefocusAt < REFOCUS_EVERY_MS) return Promise.resolve(null);
    this._lastRefocusAt = now;
    var ids = [];
    try {
      this.adapter.visibleCells().forEach(function (c) {
        if (c.columnType === 'assignment' && c.assignmentId && ids.indexOf(String(c.assignmentId)) < 0) ids.push(String(c.assignmentId));
      });
    } catch (e) { return Promise.resolve(null); }
    if (!ids.length) return Promise.resolve(null);
    CGP.diag.bump('liveSync.refocus.' + (reason || 'other'));
    return model.resyncAssignments(ids).then(function (r) {
      if (r && r.submissions.length) self.deliver(r.submissions, r.readStartedAt, []);
      return r;
    });
  };

  /* ----------------------------------------------------- SpeedGrader side */

  function speedGraderIds(loc) {
    loc = loc || (typeof location !== 'undefined' ? location : null);
    var out = { assignmentId: null, userId: null };
    if (!loc) return out;
    var q = /[?&]assignment_id=(\d+)/.exec(loc.search || '');
    if (q) out.assignmentId = q[1];
    var s = /[?&]student_id=(\d+)/.exec(loc.search || '');
    if (s) out.userId = s[1];
    if (!out.userId) {
      try {
        var m = /"student_id"\s*:\s*"?(\d+)"?/.exec(decodeURIComponent(String(loc.hash || '').replace(/^#/, '')));
        if (m) out.userId = m[1];
      } catch (e) { /* unreadable hash */ }
    }
    return out;
  }

  function SpeedGraderFollower(ctx) {
    this.liveSync = ctx.liveSync;
    this.doc = ctx.document || (typeof document !== 'undefined' ? document : null);
    this.win = ctx.window || (typeof window !== 'undefined' ? window : null);
    this.location = ctx.location || null;
    this._refreshTimer = null;
    this._notice = null;
  }

  var S = SpeedGraderFollower.prototype;

  S.ids = function () { return speedGraderIds(this.location || (this.win && this.win.location)); };

  S.isClassic = function () {
    return !!(this.doc && this.doc.querySelector && this.doc.querySelector('#classic_speedgrader_container'));
  };

  S.start = function () {
    var self = this;
    // SpeedGrader's own saves (write-watch.js) go out to the gradebook.
    if (this.win && typeof this.win.addEventListener === 'function') {
      this.win.addEventListener('message', function (e) {
        if (e.source !== self.win || !e.data || e.data.source !== 'cgp-native-write') return;
        self.announceWrite(e.data);
      });
    }
    if (this.liveSync) this.liveSync.onChange(function (msg) { self.receive(msg); });
  };

  S.announceWrite = function (d) {
    var here = this.ids();
    var cell;
    if (isId(d.assignmentId)) cell = { assignmentId: String(d.assignmentId), userId: isId(d.userId) ? String(d.userId) : null };
    // A comment edited or deleted by its own id: the submission on screen.
    else if (d.commentId && here.assignmentId) cell = { assignmentId: here.assignmentId, userId: here.userId };
    if (!cell) return false;
    return this.liveSync.announce([cell], { commentsOnly: !!(d.commentOnly || d.commentId) });
  };

  /* Does a change elsewhere touch the submission on screen? */
  S.concerns = function (msg) {
    var here = this.ids();
    if (!here.assignmentId) return false;
    return (msg.cells || []).some(function (c) {
      return c.assignmentId === here.assignmentId && (!c.userId || !here.userId || c.userId === here.userId);
    });
  };

  S.receive = function (msg) {
    var self = this;
    if (!this.concerns(msg)) return false;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(function () { self._refreshTimer = null; self.refresh(); }, 300);
    return true;
  };

  S.refresh = function () {
    if (this.isClassic()) { this.showNotice(); return 'notice'; }
    // Canvas's own code asks the platform SpeedGrader to re-read the
    // submission it is showing with exactly this message.
    try { this.win.postMessage({ subject: 'canvas.refetchSubmission' }, '*'); } catch (e) { return null; }
    CGP.diag.bump('liveSync.speedGraderRefetch');
    return 'refetch';
  };

  S.showNotice = function () {
    var doc = this.doc;
    if (!doc || !doc.body) return;
    if (this._notice && this._notice.isConnected) return;
    var bar = doc.createElement('div');
    bar.className = 'cgp-sg-stale';
    bar.setAttribute('role', 'status');
    var text = doc.createElement('span');
    text.textContent = 'This submission was just changed in another tab (the Gradebook). ' +
      'Reload SpeedGrader to see its current grade and status.';
    var reload = doc.createElement('button');
    reload.type = 'button';
    reload.className = 'cgp-sg-stale__reload';
    reload.textContent = 'Reload';
    reload.addEventListener('click', function () { try { location.reload(); } catch (e) { /* ignore */ } });
    var dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'cgp-sg-stale__dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(text);
    bar.appendChild(reload);
    bar.appendChild(dismiss);
    doc.body.appendChild(bar);
    this._notice = bar;
    CGP.diag.bump('liveSync.speedGraderNotice');
  };

  CGP.LiveSync = LiveSync;
  CGP.LiveGradebookFollower = GradebookFollower;
  CGP.LiveSpeedGraderFollower = SpeedGraderFollower;
  CGP.liveSyncInternals = { speedGraderIds: speedGraderIds, MESSAGE_TYPE: MESSAGE_TYPE };
})();
