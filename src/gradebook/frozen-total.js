/* Canvas Gradebook+ - Total frozen next to the student name.
 *
 * Canvas's own Total column, moved by Canvas itself: the page bridge
 * (env-bridge.js, placeCanvasTotal) runs Canvas's own Total-menu actions.
 * Nothing here draws, copies or recalculates a Total, so the Total a teacher
 * sees is always the one Canvas calculates live in the gradebook.
 *
 * The setting decides where Total sits, checked on every paint:
 *  - on (the default): frozen immediately after the student name, wherever
 *    it was before - including after a "Move to End" from Canvas's menu;
 *  - off: back at the far right, where Canvas puts it by default.
 * Canvas saves each move as the teacher's column-order preference for the
 * course, so once it is in place nothing further is asked of Canvas. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.FrozenTotalController) return;

  var RESPONSE_TIMEOUT_MS = 5000;
  var MAX_DELAY_MS = 30000;
  // After a move, the time Canvas gets to redraw before the on-page check
  // may ask again.
  var SETTLE_MS = 1000;

  function FrozenTotalController(ctx) {
    this.adapter = ctx.adapter;
    this.settings = ctx.settings;
    this._want = null;      // the position last asked for: true = frozen front
    this._pending = false;
    this._attempts = 0;     // requests since Total was last seen where wanted
    this._nextAt = 0;
    this._timer = null;
  }

  var P = FrozenTotalController.prototype;

  P.start = function () {
    this.paint();
  };

  P._cancelRetry = function () {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  };

  /* Called on every paint pass; one cheap header check once Total is in place. */
  P.paint = function () {
    var want = !!this.settings.values.frozenTotal;
    if (want !== this._want) {
      // Setting changed: act on it now, not after an old backoff.
      this._want = want;
      this._attempts = 0;
      this._nextAt = 0;
      this._cancelRetry();
    }
    var frozen = this.adapter.totalInFrozenPane();
    if (frozen === null) return;   // the grid hasn't split into its panes yet
    if (frozen === want) {
      this._attempts = 0;
      this._cancelRetry();
      return;
    }
    if (this._pending || Date.now() < this._nextAt) return;
    // A render pass got here first: the timed retry is no longer needed, and
    // left running it would wipe the NEXT backoff when it fired.
    this._cancelRetry();
    var self = this;
    this._pending = true;
    this.request(want).then(function (result) {
      self._pending = false;
      // The setting changed while the request was out: its answer is stale.
      if (want !== !!self.settings.values.frozenTotal) return;
      if (result && result.ok && result.placed && result.changed) {
        self._attempts = 0;
        self._nextAt = Date.now() + SETTLE_MS;
        CGP.diag.bump(want ? 'frozenTotal.movedToFront' : 'frozenTotal.movedToEnd');
      } else {
        // Not moved: Canvas's grid still building, no Total showing, or
        // Canvas already has it where wanted and only the page lags. Try
        // again with backoff, on a timer, since an idle grid may not repaint.
        self._attempts++;
        if (self._attempts === 1 || self._attempts % 8 === 0) {
          CGP.diag.warn('frozenTotal.notPlaced', { reason: result && result.reason });
        }
        var delay = Math.min(MAX_DELAY_MS, 1000 * Math.pow(2, self._attempts - 1));
        self._nextAt = Date.now() + delay;
      }
      // The timer clears the wait itself, so firing a millisecond early
      // cannot skip the retry.
      self._timer = self._schedule(function () { self._timer = null; self._nextAt = 0; self.paint(); },
        Math.max(0, self._nextAt - Date.now()));
    });
  };

  P._schedule = function (fn, ms) {
    return setTimeout(fn, ms);
  };

  P.request = function (front) {
    return new Promise(function (resolve) {
      var id = 'cgp-total-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      var timer;
      function finish(result) {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(result || { ok: false, reason: 'unavailable' });
      }
      function onMessage(event) {
        var message = event.data;
        if (event.source !== window || !message || message.source !== 'cgp-total-response' || message.id !== id) return;
        finish(message.result);
      }
      window.addEventListener('message', onMessage);
      timer = setTimeout(function () { finish({ ok: false, reason: 'timeout' }); }, RESPONSE_TIMEOUT_MS);
      window.postMessage({ source: 'cgp-total-request', id: id, front: !!front }, window.location.origin);
    });
  };

  CGP.FrozenTotalController = FrozenTotalController;
})();
