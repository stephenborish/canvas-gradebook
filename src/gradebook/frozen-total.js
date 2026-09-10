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
    this.enabled = false;
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
    if (this.layer) { this.layer.remove(); this.layer = null; }
    if (this.header) { this.header.remove(); this.header = null; }
    this.cellPool.clear();
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
