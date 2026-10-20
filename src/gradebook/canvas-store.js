/* Canvas Gradebook+ - hand saved submissions to Canvas's own gradebook store.
 *
 * Canvas draws every grade cell, its status colours, its Total column and the
 * Grade Detail Tray from an in-page store that a write to the Submissions API
 * never reaches. Left alone, that store kept showing the old grade or status
 * after any change this extension made (or learned of from SpeedGrader) -
 * the tray disagreed with the cell, and Canvas's own editor even skipped
 * saving a retyped grade it believed "unchanged" - until the page was
 * reloaded.
 *
 * push() sends Canvas's answer for each saved submission to the page bridge
 * (env-bridge.js), which hands it to Canvas through Canvas's own
 * updateSubmissionsFromExternal. The bridge answers per cell; once Canvas's
 * store confirms it holds what was sent, the grade overlay this extension
 * draws over a stale Canvas cell (rec.override) has nothing left to cover,
 * and is dropped so Canvas's own cell is the one being read again.
 *
 * Only grading fields cross into the page - never comments, names or
 * submission bodies. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CanvasStore) return;

  // Mirrors env-bridge.js STORE_FIELDS (Canvas's own gradebook field list).
  var FIELDS = [
    'id', 'user_id', 'assignment_id', 'attempt', 'cached_due_date', 'custom_grade_status_id',
    'entered_grade', 'entered_score', 'excused', 'grade', 'grade_matches_current_submission',
    'grading_period_id', 'late', 'late_policy_status', 'missing', 'points_deducted', 'posted_at',
    'proxy_submitter_id', 'redo_request', 'score', 'seconds_late', 'sticker', 'submission_type',
    'submitted_at', 'workflow_state', 'assignment_visible', 'has_postable_comments'
  ];

  // Longer than env-bridge.js holds a hand-off for a row with an unsaved edit.
  var REPLY_TIMEOUT_MS = 35000;

  function pickFields(sub) {
    if (!sub || typeof sub !== 'object' || sub.assignment_id === undefined || sub.user_id === undefined) return null;
    var out = {};
    FIELDS.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(sub, k)) return;
      var v = sub[k];
      var t = typeof v;
      if (v === null || t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
    });
    out.assignment_id = String(sub.assignment_id);
    out.user_id = String(sub.user_id);
    return out;
  }

  function CanvasStore(ctx) {
    this.model = ctx.model;
    this.requestPaint = ctx.requestPaint || null;
    this._seq = 0;
    this._pending = new Map();
    this._listening = false;
  }

  var P = CanvasStore.prototype;

  P.listen = function () {
    if (this._listening || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._listening = true;
    var self = this;
    window.addEventListener('message', function (e) {
      if (e.source !== window || !e.data || e.data.source !== 'cgp-submission-synced') return;
      self.onReply(e.data);
    });
  };

  /* submissions - raw Canvas submission JSON (a write's answer, or a read).
   * opts.readStartedAt - when the request that produced them was sent; a
   *   Canvas write to the same cell sent after that is newer, and wins.
   * opts.commentsFor - [{assignmentId, userId}] whose comments changed, so an
   *   open Grade Detail Tray on one of them re-reads its thread.
   * Resolves with the bridge's per-cell results, or null when no bridge
   * answered (the overlay then simply stays, as before). */
  P.push = function (submissions, opts) {
    opts = opts || {};
    var list = (submissions || []).map(pickFields).filter(Boolean);
    var commentsFor = (opts.commentsFor || []).filter(function (c) { return c && c.assignmentId && c.userId; })
      .map(function (c) { return { assignmentId: String(c.assignmentId), userId: String(c.userId) }; });
    if ((!list.length && !commentsFor.length) || typeof window === 'undefined' || typeof window.postMessage !== 'function') {
      return Promise.resolve(null);
    }
    this.listen();
    var self = this;
    var id = 'cgp-sync-' + (++this._seq) + '-' + Date.now();
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        self._pending.delete(id);
        CGP.diag.bump('canvasStore.noAnswer');
        resolve(null);
      }, REPLY_TIMEOUT_MS);
      self._pending.set(id, { resolve: resolve, timer: timer });
      try {
        window.postMessage({
          source: 'cgp-submission-sync',
          id: id,
          submissions: list,
          commentsFor: commentsFor,
          readStartedAt: opts.readStartedAt || 0
        }, window.location.origin);
      } catch (e) {
        clearTimeout(timer);
        self._pending.delete(id);
        resolve(null);
      }
    });
  };

  P.onReply = function (data) {
    var waiting = this._pending.get(data.id);
    if (!waiting) return;
    this._pending.delete(data.id);
    clearTimeout(waiting.timer);
    var results = Array.isArray(data.results) ? data.results : [];
    var model = this.model;
    var cleared = 0;
    results.forEach(function (r) {
      if (!r || !r.stored) {
        if (r && r.skipped) CGP.diag.bump(r.skipped === 'editing' ? 'canvasStore.skippedForOpenEditor' : 'canvasStore.skippedForCanvasWrite');
        return;
      }
      CGP.diag.bump('canvasStore.stored.' + (r.via || 'unknown'));
      if (!model || typeof model.cell !== 'function') return;
      var rec = model.cell(r.assignmentId, r.userId);
      // A newer write of ours still out will hand over its own answer.
      var inFlight = typeof model.writeInFlight === 'function' && model.writeInFlight(r.assignmentId, r.userId);
      if (!rec || inFlight || rec.override === null || rec.override === undefined) return;
      model.patchCell(r.assignmentId, r.userId, { override: null }, { silent: true });
      cleared++;
    });
    if (cleared && this.requestPaint) this.requestPaint();
    waiting.resolve(results);
  };

  CGP.CanvasStore = CanvasStore;
  CGP.canvasStoreInternals = { pickFields: pickFields, FIELDS: FIELDS };
})();
