/* Canvas Gradebook+ - multi-cell selection.
 *
 * Cmd/Ctrl-click adds a cell, Shift-click extends a rectangle, Escape clears.
 * Selection lives in identity space (assignment id + student id), so it stays
 * correct while rows and columns virtualize. Selected cells get a restrained
 * outline; there is no selection toolbar, count badge, or summary bar. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.SelectionController) return;

  function SelectionController(ctx) {
    this.adapter = ctx.adapter;
    this.model = ctx.model;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint;
    this.keys = new Map();   // "assignmentId:userId" -> {assignmentId, userId, rowIndex, colIndex}
    this.anchor = null;
    this.pending = '';
    // When the set of selected cells last actually changed (add/toggle/
    // extend) - read by keyboard.js's C shortcut to tell a stale, leftover-
    // focused editor (predates this) from one genuinely focused since (does
    // not: it is what the teacher is looking at right now, selection or not).
    this.changedAt = 0;
  }

  var P = SelectionController.prototype;

  P.size = function () { return this.keys.size; };
  P.isEmpty = function () { return this.keys.size === 0; };

  P.targets = function () {
    return Array.from(this.keys.values()).map(function (t) {
      return { assignmentId: t.assignmentId, userId: t.userId };
    });
  };

  P.clear = function (opts) {
    if (!this.keys.size && !this.pending) return;
    this.keys.clear();
    this.anchor = null;
    this.pending = '';
    this.repaint();
    if (!(opts && opts.silent)) CGP.diag.log('selection.cleared');
  };

  P.add = function (info) {
    if (!info || info.columnType !== 'assignment' || !info.assignmentId || !info.studentId) return false;
    var key = CGP.gridMap.cellKey(info.assignmentId, info.studentId);
    this.keys.set(key, {
      assignmentId: String(info.assignmentId), userId: String(info.studentId),
      rowIndex: info.rowIndex, colIndex: info.colIndex
    });
    this.anchor = { rowIndex: info.rowIndex, colIndex: info.colIndex };
    this.changedAt = Date.now();
    return true;
  };

  P.toggle = function (info) {
    if (!info || info.columnType !== 'assignment' || !info.assignmentId || !info.studentId) return;
    var key = CGP.gridMap.cellKey(info.assignmentId, info.studentId);
    if (this.keys.has(key)) {
      this.keys.delete(key);
      if (this.keys.size === 0) this.anchor = null;
      this.changedAt = Date.now();
    } else {
      this.add(info);
    }
    this.repaint();
  };

  P.extendTo = function (info) {
    var self = this;
    if (!info || info.rowIndex === null || info.colIndex === null) return;
    var anchor = this.anchor || { rowIndex: info.rowIndex, colIndex: info.colIndex };
    var targets = CGP.gridMap.rangeTargets(anchor, { rowIndex: info.rowIndex, colIndex: info.colIndex }, {
      studentAt: function (r) { return self.adapter.studentAt(r); },
      columnAt: function (c) { return self.adapter.columnAt(c); }
    });
    this.keys.clear();
    targets.forEach(function (t) {
      self.keys.set(CGP.gridMap.cellKey(t.assignmentId, t.userId), t);
    });
    this.anchor = anchor;
    this.changedAt = Date.now();
    this.repaint();
    CGP.diag.set('selectionSize', this.keys.size);
  };

  P.setPending = function (text) {
    this.pending = text || '';
    this.repaint();
  };

  /** Applies selection classes to whatever cells are rendered right now. */
  P.paint = function (cells) {
    var self = this;
    (cells || []).forEach(function (info) {
      if (!info.el) return;
      var selected = !!(info.assignmentId && info.studentId &&
        self.keys.has(CGP.gridMap.cellKey(info.assignmentId, info.studentId)));
      if (selected !== info.el.classList.contains('cgp-sel')) info.el.classList.toggle('cgp-sel', selected);
      if (selected && self.pending) {
        if (info.el.getAttribute('data-cgp-pending') !== self.pending) {
          info.el.setAttribute('data-cgp-pending', self.pending);
        }
        info.el.classList.add('cgp-has-pending');
      } else if (info.el.hasAttribute('data-cgp-pending')) {
        info.el.removeAttribute('data-cgp-pending');
        info.el.classList.remove('cgp-has-pending');
      }
    });
  };

  P.repaint = function () {
    if (this.requestPaint) this.requestPaint();
  };

  P.start = function () {
    var self = this;
    document.addEventListener('mousedown', function (e) {
      if (!self.settings.values.multiCellSelection) return;
      if (e.button !== 0) return;
      var modifierAdd = e.metaKey || e.ctrlKey;
      var modifierRange = e.shiftKey;
      var info = self.adapter.cellInfo(e.target);

      if (!info) { return; }
      if (!modifierAdd && !modifierRange) {
        if (self.keys.size) self.clear({ silent: true });
        // A plain click selects nothing of ours - Canvas activates the cell
        // as usual - but it is still the reference point a teacher expects
        // the NEXT Shift-click to extend a range from, the same way a
        // spreadsheet works. Without this, the range's anchor exists only
        // once a cell has been Cmd/Ctrl-clicked first, so a plain click on
        // one row followed by Shift-click on another selected only the
        // second row - a rectangle of one cell - and which row was clicked
        // first (top or bottom) looked like it mattered, when really
        // neither order actually built a range yet.
        if (info.columnType === 'assignment' && info.rowIndex !== null && info.colIndex !== null) {
          self.anchor = { rowIndex: info.rowIndex, colIndex: info.colIndex };
        }
        return;
      }
      if (info.columnType !== 'assignment') return;
      // Take the gesture away from Canvas so it does not open an editor.
      e.preventDefault();
      e.stopPropagation();
      if (modifierRange) self.extendTo(info); else self.toggle(info);
    }, true);
  };

  CGP.SelectionController = SelectionController;
})();
