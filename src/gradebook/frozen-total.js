/* Canvas Gradebook+ - Total frozen next to the student name.
 *
 * Canvas's own Total column, frozen by Canvas itself: the page bridge
 * (env-bridge.js, freezeCanvasTotal) runs Canvas's freezeTotalGradeColumn(),
 * the same thing its Total menu's "Move to Front" item does. Nothing here
 * draws, copies or recalculates a Total, so the Total a teacher sees is
 * always the one Canvas calculates live in the gradebook.
 *
 * Canvas saves the freeze as the teacher's column-order preference, so this
 * only ever has to happen once per course. It is asked for once per page
 * load; a teacher who then chooses "Move to End" is not overruled until the
 * next load with the setting still on. Turning the setting off leaves
 * Canvas's saved preference alone, since it may be the teacher's own. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.FrozenTotalController) return;

  var RESPONSE_TIMEOUT_MS = 5000;
  var MAX_DELAY_MS = 30000;
  // Canvas builds the grid in stages; until it has, the bridge answers
  // 'unavailable' or 'notShown'. Retried with backoff, then given up on.
  var MAX_ATTEMPTS = 8;

  function FrozenTotalController(ctx) {
    this.settings = ctx.settings;
    this.enabled = false;   // the setting is on and this page load is handled
    this.done = false;      // Canvas confirmed its Total frozen, or retries ran out
    this._pending = false;
    this._attempts = 0;
    this._nextAt = 0;
  }

  var P = FrozenTotalController.prototype;

  P.start = function () {
    if (!this.settings.values.frozenTotal) return;
    this.enabled = true;
    this.paint();
  };

  P.stop = function () {
    this.enabled = false;
  };

  /* Called on every paint pass; cheap once done. */
  P.paint = function () {
    if (!this.settings.values.frozenTotal) { this.enabled = false; return; }
    this.enabled = true;
    if (this.done || this._pending || Date.now() < this._nextAt) return;
    var self = this;
    this._pending = true;
    this.request().then(function (result) {
      self._pending = false;
      if (result && result.ok && result.frozen) {
        self.done = true;
        CGP.diag.bump(result.changed ? 'frozenTotal.frozeCanvasTotal' : 'frozenTotal.alreadyFrozen');
        return;
      }
      self._attempts++;
      if (self._attempts >= MAX_ATTEMPTS) {
        self.done = true;
        CGP.diag.warn('frozenTotal.notFrozen', { reason: result && result.reason });
        return;
      }
      var delay = Math.min(MAX_DELAY_MS, 1000 * Math.pow(2, self._attempts - 1));
      self._nextAt = Date.now() + delay;
      // An idle grid may not repaint on its own, so the retry is not left
      // waiting for one. The timer clears the wait itself, so firing a
      // millisecond early cannot skip the retry.
      self._schedule(function () { self._nextAt = 0; self.paint(); }, delay);
    });
  };

  P._schedule = function (fn, ms) {
    return setTimeout(fn, ms);
  };

  P.request = function () {
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
      window.postMessage({ source: 'cgp-total-request', id: id }, window.location.origin);
    });
  };

  CGP.FrozenTotalController = FrozenTotalController;
})();
