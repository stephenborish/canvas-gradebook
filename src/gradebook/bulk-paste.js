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
    // Whether the teacher's last pointer/keyboard interaction was inside the
    // grid. A paste whose target is the bare page body is only taken as a
    // grid paste when it was; otherwise SlickGrid's last active cell - which
    // stays "active" long after the teacher has clicked somewhere else on the
    // page - would silently become the anchor for a write.
    this._gridEngaged = false;
  }

  var P = BulkPasteController.prototype;

  P.start = function () {
    var self = this;
    document.addEventListener('paste', this.onPaste.bind(this), true);
    var track = function (e) { self._gridEngaged = self.inGrid(e.target); };
    document.addEventListener('mousedown', track, true);
    document.addEventListener('focusin', track, true);
  };

  P.inGrid = function (el) {
    if (!el || !el.closest) return false;
    if (el.closest('.slick-cell')) return true;
    var root = this.adapter.gridRoot ? this.adapter.gridRoot() : null;
    return !!(root && root.contains && root.contains(el));
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
    // Pasting while focused somewhere else on the page (a button, a menu,
    // the page itself after clicking away) is not a grid paste.
    var bare = !target || target === document.body || target === document.documentElement;
    if (!this.inGrid(target) && !(bare && this._gridEngaged)) return;

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

    var rowsConfirmed = false;
    return adapter.ensureRowsMapped(anchor.rowIndex, matrix.rowCount).then(function (ok) {
      // ok is true only when every target row was read live just now and
      // lies inside the roster. Anything less means a cached row->student
      // guess, which after a sort or filter can be a different student.
      rowsConfirmed = ok !== false;
      return matrix.colCount > 1 ? adapter.ensureColumnsMapped(anchor.colIndex, matrix.colCount) : true;
    }).then(function () {
      if (!rowsConfirmed) {
        CGP.diag.error('paste.rowsUnconfirmed', { rows: matrix.rowCount });
        CGP.ui.error('Paste stopped: Gradebook+ couldn\u2019t confirm which student every pasted row belongs to ' +
          '(the paste may run past the last student, or the grid is still re-sorting). Nothing was changed.');
        return null;
      }
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

      // The overwrite count below is the confirmation's whole point, and it
      // reads the model: a column not loaded yet would count as "nothing to
      // overwrite" and skip the question entirely.
      var columns = [];
      built.targets.forEach(function (t) { if (columns.indexOf(String(t.assignmentId)) < 0) columns.push(String(t.assignmentId)); });
      return self.model.ensureAssignments(columns).then(function () {
        return self.confirmAndApply(built, matrix);
      });
    });
  };

  /* How many targets would replace a grade that is already there. Status-only
   * tokens (M, L) never touch the grade, so they never count. */
  P.countOverwrites = function (targets) {
    var self = this;
    var KIND = CGP.gradeOps.KIND;
    return targets.filter(function (t) {
      var kind = t.parsed.kind;
      if (kind === KIND.MISSING || kind === KIND.LATE) return false;
      var rec = self.model.cell(t.assignmentId, t.userId);
      if (!rec) return false;
      var hasGrade = rec.excused || (rec.grade !== null && rec.grade !== undefined && rec.grade !== '');
      if (!hasGrade) return false;
      if (kind === KIND.EXCUSED) return !rec.excused;
      if (kind === KIND.CLEAR) return true;
      if (rec.excused) return true;
      var incoming = t.parsed.value;
      if (kind === KIND.NUMBER && rec.score !== null && rec.score !== undefined && Number(rec.score) === Number(incoming)) return false;
      return String(rec.grade).toLowerCase() !== String(incoming).toLowerCase();
    }).length;
  };

  P.confirmAndApply = function (built, matrix) {
    var overwrites = this.countOverwrites(built.targets);
    var threshold = this.settings.values.bulkConfirmThreshold;
    // Large pastes always ask; so does any multi-cell paste that would
    // replace a grade already there, since that is the one a misaligned
    // clipboard silently destroys.
    if (built.targets.length > threshold || (overwrites > 0 && built.targets.length > 1)) {
      var msg = 'Apply ' + built.targets.length + ' grades to this gradebook?' +
        (overwrites ? '\n\n' + overwrites + ' cell(s) already have a different grade and will be replaced.' : '');
      if (!window.confirm(msg)) { CGP.diag.log('paste.cancelled'); return null; }
    }

    CGP.diag.log('paste.applying', {
      cells: built.targets.length, rows: matrix.rowCount, cols: matrix.colCount,
      source: matrix.source, overwrites: overwrites
    });
    return this.writer.apply(built.targets, { announce: true });
  };

  CGP.BulkPasteController = BulkPasteController;
})();
