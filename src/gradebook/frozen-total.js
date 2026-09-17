/* Canvas Gradebook+ - Total frozen next to the student name.
 *
 * Canvas's own Total column lives at the far right and is removed from the DOM
 * while columns virtualize, so position: sticky on it is not an option. Instead
 * the frozen pane is widened and a Total column is drawn into the space that
 * opens up, using each rendered row's own top offset for vertical alignment
 * (no fake header row, no row shifting) and Canvas's own enrollment scores for
 * the values (no independent weighted-grade math). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.FrozenTotalController) return;

  function FrozenTotalController(ctx) {
    this.adapter = ctx.adapter;
    this.model = ctx.model;
    this.settings = ctx.settings;
    this.width = 84;
    this.enabled = false;   // the setting is on and a frozen pane was found at start
    // Verified to actually be showing, not merely attempted - see
    // verifyWidened(). Everything downstream (drawing the Total overlay,
    // hiding Canvas's own native Total column so there is never a confusing
    // duplicate) is gated on this, not on `enabled`, precisely because the
    // CSS trick `enabled` turns on is not guaranteed to have taken hold.
    this.working = false;
    this._failStreak = 0;
    this._notifiedBroken = false;
    this.layer = null;
    this.header = null;
    this.cellPool = new Map(); // rowIndex -> element
    this.naturalWidth = 0;
  }

  var P = FrozenTotalController.prototype;

  P.start = function () {
    if (!this.settings.values.frozenTotal) return;
    if (!this.adapter.hasFrozenPane()) {
      CGP.diag.warn('frozenTotal.noFrozenPane');
      return;
    }
    this.enabled = true;
    document.documentElement.classList.add('cgp-frozen-total');
    document.documentElement.style.setProperty('--cgp-total-w', this.width + 'px');
    this.measure();
  };

  P.stop = function () {
    this.enabled = false;
    document.documentElement.classList.remove('cgp-frozen-total');
    this.teardownDrawn();
  };

  /* Everything that only belongs on screen once the widen is actually
   * confirmed (see paint()). Torn down, not just left stale, the moment that
   * confirmation is lost - a half-correct overlay is worse than none. */
  P.teardownDrawn = function () {
    this.working = false;
    document.documentElement.classList.remove('cgp-frozen-total-active');
    if (this.layer) { this.layer.remove(); this.layer = null; }
    if (this.header) { this.header.remove(); this.header = null; }
    this.cellPool.clear();
  };

  /* Confirm the CSS pane-widening this whole feature depends on actually took
   * hold, rather than assuming it. Canvas's exact SlickGrid pane/viewport
   * class names are not something this extension can verify against a live
   * build (see the class list in gradebook.css), and a silently-failed widen
   * is not cosmetic: the Total this method would otherwise draw is appended
   * into the frozen canvas at a left offset past where a NOT-actually-widened
   * pane really ends, which reads, from the grid, as a Total column that
   * scrolls along with the assignment columns instead of staying put - the
   * exact "it isn't actually frozen" report this guards against.
   *
   * Checked on every paint, not just once at start, because the widen can be
   * lost later just as easily as it can fail to ever take hold (Canvas
   * re-rendering the pane on a sort, a filter change, a column drag). A
   * short streak of failures (not a single one - the frozen pane may simply
   * not have its final layout yet on the very first paint or two) is what
   * actually tears the overlay down; a later paint that measures correctly
   * again brings it right back with no reload needed either way. */
  P.verifyWidened = function () {
    if (!this.naturalWidth) return false;
    var canvas = this.adapter.canvases()[0];
    if (!canvas) return false;
    var have = Math.round(canvas.getBoundingClientRect().width);
    var want = this.naturalWidth + this.width;
    // A little slack for a hairline border, a scrollbar gutter, or ordinary
    // sub-pixel layout rounding on an otherwise-correct widen.
    return Math.abs(have - want) <= 8;
  };

  P.measure = function () {
    var natural = this.adapter.frozenNaturalWidth();
    if (!natural) return;
    if (Math.abs(natural - this.naturalWidth) < 2) return;
    this.naturalWidth = natural;
    var root = document.documentElement;
    root.style.setProperty('--cgp-frozen-natural', natural + 'px');
    root.style.setProperty('--cgp-frozen-w', (natural + this.width) + 'px');
    CGP.diag.set('frozenPaneWidth', natural + this.width);
  };

  P.ensureHeader = function () {
    var headerPane = document.querySelector('.slick-header');
    if (!headerPane) return null;
    if (this.header && this.header.isConnected && this.header.parentElement === headerPane) return this.header;
    var el = headerPane.querySelector(':scope > .cgp-total-header');
    if (!el) {
      el = document.createElement('div');
      el.className = 'cgp-total-header';
      el.setAttribute('role', 'columnheader');
      el.innerHTML = '<span class="cgp-total-header__label">Total</span>';
      headerPane.appendChild(el);
    }
    this.header = el;
    return el;
  };

  P.ensureLayer = function () {
    var canvas = this.adapter.canvases()[0];
    if (!canvas) return null;
    if (this.layer && this.layer.isConnected && this.layer.parentElement === canvas) return this.layer;
    var el = canvas.querySelector(':scope > .cgp-total-layer');
    if (!el) {
      el = document.createElement('div');
      el.className = 'cgp-total-layer';
      el.setAttribute('aria-hidden', 'false');
      canvas.appendChild(el);
    }
    this.layer = el;
    this.cellPool.clear();
    return el;
  };

  P.paint = function () {
    if (!this.enabled) return;
    this.measure();

    if (!this.verifyWidened()) {
      this._failStreak++;
      // Three misses in a row (not one - the very first paint or two can
      // easily land before the frozen pane has its final layout) before
      // standing down: draw nothing, and leave Canvas's own native Total
      // column alone rather than hiding it out from under a Total that turned
      // out not to actually be there.
      if (this._failStreak >= 3 && this.working) {
        this.teardownDrawn();
        if (!this._notifiedBroken) {
          this._notifiedBroken = true;
          CGP.diag.warn('frozenTotal.widenNotConfirmed', { natural: this.naturalWidth, width: this.width });
        }
      }
      return;
    }
    this._failStreak = 0;
    this._notifiedBroken = false;
    if (!this.working) {
      this.working = true;
      document.documentElement.classList.add('cgp-frozen-total-active');
      CGP.diag.bump('frozenTotal.confirmed');
    }

    var layer = this.ensureLayer();
    this.ensureHeader();
    if (!layer) return;

    var geometry = this.adapter.frozenRowGeometry();
    var rows = CGP.totals.buildTotalRows(geometry, this.model.students);
    var seen = new Set();
    var self = this;

    rows.forEach(function (row) {
      if (row.rowIndex === null || row.rowIndex === undefined) return;
      seen.add(row.rowIndex);
      var el = self.cellPool.get(row.rowIndex);
      if (!el || !el.isConnected) {
        el = document.createElement('div');
        el.className = 'cgp-total-cell';
        layer.appendChild(el);
        self.cellPool.set(row.rowIndex, el);
      }
      var top = row.top + 'px';
      var height = row.height + 'px';
      if (el.style.top !== top) el.style.top = top;
      if (el.style.height !== height) el.style.height = height;
      if (el.textContent !== row.text) el.textContent = row.text;
      if (el.title !== row.title) el.title = row.title;
      el.classList.toggle('cgp-total-cell--empty', !row.resolved);
    });

    this.cellPool.forEach(function (el, rowIndex) {
      if (!seen.has(rowIndex)) { el.remove(); self.cellPool.delete(rowIndex); }
    });
  };

  CGP.FrozenTotalController = FrozenTotalController;
})();
