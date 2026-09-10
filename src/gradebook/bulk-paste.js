/* Canvas Gradebook+ - bulk grade paste.
 *
 * Copy a column or a rectangular block out of Excel / Google Sheets, click a
 * cell, paste. Newlines walk down students, tabs walk across assignments, and
 * M / E / L / blanks are honoured.
 *
 * Safety, because a bad paste is the most destructive thing here:
 *   1. the whole block is mapped to real ids first (scrolling the grid if the
 *      target rows or columns have not been rendered yet)
 *   2. one unresolved cell or one unparseable token aborts everything
 *   3. overwriting existing grades past the confirmation threshold asks once */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.BulkPasteController) return;

  function BulkPasteController(ctx) {
    this.adapter = ctx.adapter;
    this.model = ctx.model;
    this.writer = ctx.writer;
    this.selection = ctx.selection;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint;
    this.busy = false;
  }

  var P = BulkPasteController.prototype;

  P.start = function () {
    document.addEventListener('paste', this.onPaste.bind(this), true);
  };

  P.anchor = function (eventTarget) {
    var info = eventTarget && eventTarget.closest ? this.adapter.cellInfo(eventTarget) : null;
    if (info && info.columnType === 'assignment') return info;
    var active = this.adapter.activeCellInfo();
    if (active && active.columnType === 'assignment') return active;
    if (this.selection.anchor) {
      var a = this.selection.anchor;
      var column = this.adapter.columnAt(a.colIndex);
      if (column && column.type === 'assignment') {
        return {
          rowIndex: a.rowIndex, colIndex: a.colIndex, column: column,
          columnType: 'assignment', assignmentId: column.assignmentId,
          studentId: this.adapter.studentAt(a.rowIndex)
        };
      }
    }
    return null;
  };

  P.onPaste = function (e) {
    if (!this.settings.values.bulkPaste) return;
    var target = e.target;
    // Pasting inside a real Canvas text field elsewhere must behave normally.
    if (target && target.closest && !target.closest('.slick-cell') &&
      CGP.keyboardInternals.isTextEntry(target)) return;

    var anchor = this.anchor(target);
    if (!anchor || anchor.rowIndex === null || anchor.colIndex === null) return;

    var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text || !String(text).trim()) return;

    var matrix = CGP.clipboardMatrix.parse(text);
    if (!matrix.cellCount) return;

    // A single value with an open editor is ordinary Canvas behaviour.
    if (matrix.rowCount === 1 && matrix.colCount === 1 && this.adapter.editorInput(anchor.el)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (this.busy) { CGP.ui.toast('Still applying the previous paste.'); return; }
    this.busy = true;
    var self = this;
    this.run(matrix, anchor).catch(function (err) {
      CGP.diag.error('paste.failed', { message: String(err && err.message) });
      CGP.ui.error('Paste could not be applied. Nothing was changed.');
    }).then(function () {
      self.busy = false;
      if (self.requestPaint) self.requestPaint();
    });
  };

  P.run = function (matrix, anchor) {
    var self = this;
    var adapter = this.adapter;

    return adapter.ensureRowsMapped(anchor.rowIndex, matrix.rowCount).then(function () {
      return matrix.colCount > 1 ? adapter.ensureColumnsMapped(anchor.colIndex, matrix.colCount) : true;
    }).then(function () {
      var mapped = CGP.gridMap.mapMatrixToTargets(matrix, anchor, {
        studentAt: function (r) { return adapter.studentAt(r); },
        columnAt: function (c) { return adapter.columnAt(c); }
      });

      if (mapped.errors.length) {
        var codes = {};
        mapped.errors.forEach(function (er) { codes[er.code] = (codes[er.code] || 0) + 1; });
        CGP.diag.error('paste.unresolved', codes);
        CGP.ui.error('Paste stopped: ' + mapped.errors.length +
          ' of those cells could not be matched to a student and assignment. Nothing was changed.');
        return null;
      }

      var built = self.writer.targetsFromTokens(mapped.targets);
      if (built.invalid.length) {
        CGP.ui.error('Paste stopped: ' + built.invalid.length + ' value(s) such as "' +
          built.invalid[0].token + '" are not grades Canvas accepts. Nothing was changed.');
        CGP.diag.error('paste.invalidTokens', { count: built.invalid.length });
        return null;
      }
      if (!built.targets.length) return null;

      var overwrites = built.targets.filter(function (t) {
        var rec = self.model.cell(t.assignmentId, t.userId);
        if (!rec) return false;
        var hasGrade = rec.excused || (rec.grade !== null && rec.grade !== undefined && rec.grade !== '');
        if (!hasGrade) return false;
        var incoming = t.parsed.value === undefined ? t.parsed.score : t.parsed.value;
        return String(rec.grade) !== String(incoming);
      }).length;

      var threshold = self.settings.values.bulkConfirmThreshold;
      if (built.targets.length > threshold || overwrites > threshold) {
        var msg = 'Apply ' + built.targets.length + ' grades to this gradebook?' +
          (overwrites ? '\n\n' + overwrites + ' cell(s) already have a different grade and will be replaced.' : '');
        if (!window.confirm(msg)) { CGP.diag.log('paste.cancelled'); return null; }
      }

      CGP.diag.log('paste.applying', {
        cells: built.targets.length, rows: matrix.rowCount, cols: matrix.colCount,
        source: matrix.source, overwrites: overwrites
      });
      return self.writer.apply(built.targets, { announce: true });
    });
  };

  CGP.BulkPasteController = BulkPasteController;
})();
