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
    this._clampedAncestors = [];
    // pane element -> { width?: originalValue, left?: originalValue }, as it
    // stood before applyPaneGeometry() ever pinned that property. Captured
    // lazily (see _captureOriginal) the first time each property is about to
    // be overwritten, so restorePaneGeometry() can put back what Canvas/
    // SlickGrid actually had there - which is not necessarily nothing: some
    // Canvas builds set these panes' own left/width inline, and simply
    // deleting the property (the old behaviour) left the pane with no
    // explicit geometry at all until Canvas happened to recompute its own
    // layout, rather than restoring it.
    this._paneOriginal = new Map();
  }

  var P = FrozenTotalController.prototype;

  P.start = function () {
    if (this.enabled) return;
    if (!this.settings.values.frozenTotal) return;
    if (!this.adapter.hasFrozenPane()) {
      // Not a permanent verdict - content.js calls start() exactly once, at
      // the moment the grid clears its own minimal readiness bar (a header
      // column plus a grid-canvas exist). Canvas can still be mid-render at
      // that instant and split into its frozen/scrolling pane pair a beat
      // later, especially on a slow course load. Leaving `enabled` false
      // here (rather than latching some "gave up" flag) is what lets paint()
      // below retry this exact check on every subsequent paint pass - cheap,
      // since a real course only fails it for a handful of passes before the
      // second pane exists - instead of the whole feature staying off for
      // the rest of the page's life over a one-time timing race. That silent,
      // permanent disable is exactly the "Total column just isn't frozen
      // this time" report this replaces.
      CGP.diag.warn('frozenTotal.noFrozenPane');
      return;
    }
    this.enabled = true;
    document.documentElement.classList.add('cgp-frozen-total');
    document.documentElement.style.setProperty('--cgp-total-w', this.width + 'px');
    this.clampAncestorOverflow();
    this.measure();
  };

  P.stop = function () {
    this.enabled = false;
    this.restorePaneGeometry();
    document.documentElement.classList.remove('cgp-frozen-total');
    this.restoreAncestorOverflow();
    this.teardownDrawn();
  };

  /* Undo applyPaneGeometry()'s inline `!important` left/width pins so a
   * teacher turning the setting off gets Canvas's own ACTUAL prior pane
   * geometry back, not just an empty property. Restores from _paneOriginal
   * where this feature has a captured value for that element/property (set
   * back to exactly what it was, not merely non-empty); only falls back to
   * removeProperty for a property this feature never touched (or a pane
   * geometry() was never called against), where there is nothing recorded to
   * restore and Canvas's own CSS/JS is free to take over as it would have
   * anyway. The snapshot is cleared after restoring so a later start() in
   * the same page load captures a fresh "before" from whatever is actually
   * on the element at that time, rather than reusing this one indefinitely. */
  P.restorePaneGeometry = function () {
    var self = this;
    ['width', 'left'].forEach(function (prop) {
      [self.adapter.bodyPanes(), self.adapter.headerPanes()].forEach(function (panes) {
        panes.forEach(function (el) {
          if (!el) return;
          var entry = self._paneOriginal.get(el);
          if (entry && Object.prototype.hasOwnProperty.call(entry, prop)) {
            if (entry[prop]) el.style.setProperty(prop, entry[prop]);
            else el.style.removeProperty(prop);
          } else {
            el.style.removeProperty(prop);
          }
        });
      });
    });
    this._paneOriginal.clear();
  };

  /* Belt-and-braces against the exact failure mode reported live: BOTH panes
   * (the frozen student/Total pane and the scrolling assignment pane)
   * sliding sideways together when the teacher scrolls right, with a
   * horizontal scrollbar showing at the bottom of the grid.
   *
   * applyPaneGeometry() below is what actually PREVENTS that, by keeping the
   * grid's total on-screen footprint exactly what it was before the widen
   * (see its own comment) - but that guarantee depends on this extension
   * correctly identifying every pane element on THIS Canvas build. Rather
   * than trust that alone, every ancestor from the grid root up to (not
   * including) <body> is force-clipped so that even a geometry mistake this
   * extension does not know about yet can only ever be invisible/cropped,
   * never a scrollbar that drags the "frozen" pane along with it - a
   * position:absolute pane is not exempt from an ancestor's own scroll
   * unless something stops that ancestor from ever needing one.
   * `.slick-viewport-right` (or whichever pane genuinely owns the
   * assignment columns' horizontal scroll) is explicitly left alone: that is
   * the ONE scrollbar this feature wants to keep working exactly as before. */
  P.clampAncestorOverflow = function () {
    var root = this.adapter.gridRoot();
    if (!root) return;
    var rightViewport = this.adapter.rightViewport();
    var out = [];
    var node = root;
    for (var i = 0; i < 12 && node && node !== document.body && node !== document.documentElement; i++) {
      if (node !== rightViewport && !node.style.getPropertyValue('overflow-x')) {
        node.style.setProperty('overflow-x', 'hidden', 'important');
        out.push(node);
      }
      node = node.parentElement;
    }
    this._clampedAncestors = out;
  };

  P.restoreAncestorOverflow = function () {
    this._clampedAncestors.forEach(function (node) {
      if (node && node.isConnected) node.style.removeProperty('overflow-x');
    });
    this._clampedAncestors = [];
  };

  /* Set every pane's left/width in real measured pixels rather than trusting
   * a CSS `calc(100% - Npx)` to resolve against the containing block this
   * extension assumes it will - the "100%" there is what actually failed
   * live: whatever it was really resolving against was NOT the same box the
   * left pane's own widened width is measured relative to, so the two panes'
   * geometry silently stopped summing to the grid's real, unchanged total
   * width, and something upstream of both (an ancestor sized to that ORIGINAL
   * total) grew a scrollbar that scrolls both absolutely-positioned panes as
   * one unit - exactly the reported bug.
   *
   * The invariant this method enforces instead needs no assumption about any
   * containing block at all: leftWidth(new) + rightWidth(new) is kept
   * IDENTICAL to leftWidth(natural) + rightWidth(natural), which is
   * whatever the grid root's own rendered width already was (untouched by
   * any of this). The right pane simply gives back exactly the `width`
   * pixels the left pane gained, using ONE shared measured number
   * (gridRootWidth) rather than two separately-resolved percentages that
   * could each be wrong in their own way. Applied to both the body panes and
   * the header panes (see dom-adapter's bodyPanes()/headerPanes()) so the
   * header row's columns never drift out of alignment with the body's. */
  P.applyPaneGeometry = function () {
    if (!this.naturalWidth) return;
    var root = this.adapter.gridRoot();
    if (!root) return;
    var gridWidth = Math.round(root.getBoundingClientRect().width);
    if (!gridWidth) return;
    var newLeftWidth = this.naturalWidth + this.width;
    var newRightLeft = newLeftWidth;
    var newRightWidth = Math.max(0, gridWidth - newLeftWidth);

    var self = this;
    function pin(el, prop, px) {
      if (!el) return;
      var value = px + 'px';
      if (el.style.getPropertyValue(prop) === value) return;
      // Capture BEFORE the first overwrite only - once _paneOriginal has an
      // entry for this element/property, every later call here is pinning
      // this feature's OWN previous value, never Canvas's, so it must never
      // clobber the real original captured the first time.
      var entry = self._paneOriginal.get(el);
      if (!entry) { entry = {}; self._paneOriginal.set(el, entry); }
      if (!Object.prototype.hasOwnProperty.call(entry, prop)) {
        entry[prop] = el.style.getPropertyValue(prop) || null;
      }
      el.style.setProperty(prop, value, 'important');
    }

    [this.adapter.bodyPanes(), this.adapter.headerPanes()].forEach(function (panes) {
      var left = panes[0], right = panes[1];
      pin(left, 'width', newLeftWidth);
      // A course with no real frozen pane (bodyPanes()/headerPanes() only
      // found one element) has nothing on the right to reposition - start()
      // already refused to enable the feature at all in that case, but
      // paint()/measure() can still be called defensively.
      if (!right || right === left) return;
      pin(right, 'left', newRightLeft);
      pin(right, 'width', newRightWidth);
    });
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
    // The CSS widen (see `.slick-pane-left` / `.slick-viewport-left` in
    // gradebook.css) resizes the pane itself, not `.grid-canvas` - SlickGrid
    // sets the canvas's own width to the sum of that pane's column widths
    // regardless of the pane's CSS box width, so measuring the canvas here
    // never confirmed a real widen.
    var pane = this.adapter.frozenPaneLeft();
    if (!pane) return false;
    var have = Math.round(pane.getBoundingClientRect().width);
    var want = this.naturalWidth + this.width;
    // A little slack for a hairline border, a scrollbar gutter, or ordinary
    // sub-pixel layout rounding on an otherwise-correct widen.
    return Math.abs(have - want) <= 8;
  };

  P.measure = function () {
    var natural = this.adapter.frozenNaturalWidth();
    if (!natural) return;
    if (Math.abs(natural - this.naturalWidth) < 2) {
      // The natural width itself hasn't moved, but the grid root's overall
      // width can still change on its own (a window resize, the compact-
      // layout controller's own geometry pass) - re-pinning every pane's
      // pixels on every measure() call, not only when naturalWidth changes,
      // is what keeps applyPaneGeometry()'s invariant true after that too.
      this.applyPaneGeometry();
      return;
    }
    this.naturalWidth = natural;
    var root = document.documentElement;
    root.style.setProperty('--cgp-frozen-natural', natural + 'px');
    root.style.setProperty('--cgp-frozen-w', (natural + this.width) + 'px');
    CGP.diag.set('frozenPaneWidth', natural + this.width);
    this.applyPaneGeometry();
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
    if (!this.enabled) {
      // Retry the one-time start() gate on every paint pass rather than only
      // at boot - see start()'s own comment for why a single failed check
      // there must never be the last word on whether this feature ever runs
      // this page load.
      this.start();
      if (!this.enabled) return;
    }
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
