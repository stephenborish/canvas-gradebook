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
 *   3. the overwrite question is decided from verified ids and the grades
 *      Canvas holds NOW: every target column is read (and read again once if
 *      the first read fails) before the question, and a paste whose students,
 *      assignments or current grades can't be verified stops - it never
 *      falls through to a write that would find the grades too late
 *   4. overwriting existing grades past the confirmation threshold asks once,
 *      and the writer skips any cell whose grade changed after that answer */
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
    }).then(function (colsOk) {
      if (!rowsConfirmed) {
        CGP.diag.error('paste.rowsUnconfirmed', { rows: matrix.rowCount });
        CGP.ui.error('Paste stopped: Gradebook+ couldn\u2019t confirm which student every pasted row belongs to ' +
          '(the paste may run past the last student, or the grid is still re-sorting). Nothing was changed.');
        return null;
      }
      if (colsOk === false) {
        CGP.diag.error('paste.columnsUnconfirmed', { cols: matrix.colCount });
        CGP.ui.error('Paste stopped: Gradebook+ couldn\u2019t confirm which assignment every pasted column belongs to ' +
          '(the paste may run past the last column, or the grid is still loading). Nothing was changed. ' +
          'Scroll so the target columns are on screen and paste again.');
        return null;
      }
      var mapped = CGP.gridMap.mapMatrixToTargets(matrix, anchor, {
        studentAt: function (r) { return adapter.studentAt(r); },
        columnAt: function (c) { return adapter.columnAt(c); },
        isTestStudentRow: function (r) { return !!(adapter.isTestStudentIndex && adapter.isTestStudentIndex(r)); }
      });

      if (mapped.errors.length) {
        var codes = {};
        mapped.errors.forEach(function (er) { codes[er.code] = (codes[er.code] || 0) + 1; });
        CGP.diag.error('paste.unresolved', codes);
        if (codes['test-student']) {
          CGP.ui.error('Paste stopped: a pasted value would land on the hidden Test Student row, so the ' +
            'clipboard does not line up with the students shown. Leave that row blank in your copy, or paste ' +
            'in two parts. Nothing was changed.');
          return null;
        }
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

      // Every target must be a student and an assignment this course
      // actually has, not just whatever the grid's DOM said. (Hidden Test
      // Student rows were already refused above, by mapMatrixToTargets.)
      var model = self.model;
      var unknown = built.targets.filter(function (t) {
        return !model.student(t.userId) || !model.assignment(t.assignmentId);
      });
      if (unknown.length) {
        CGP.diag.error('paste.unverifiedTargets', { count: unknown.length });
        CGP.ui.error('Paste stopped: ' + unknown.length + (unknown.length === 1 ? ' cell' : ' cells') +
          ' could not be matched to a student and assignment in this course. Nothing was changed. ' +
          'Reload the page if the roster or assignments changed, then paste again.');
        return null;
      }

      // The overwrite count below is the confirmation's whole point, and it
      // reads the model: a column not loaded would count as "nothing to
      // overwrite" and skip the question entirely - and the writer would
      // then load it itself and replace the grades it found, unasked. So
      // every column that will be written is read now (and once more if
      // that read fails); one that still can't be read stops the paste.
      // Protected (anonymous/moderated) columns are never written - the
      // writer skips and reports them - so they need no read.
      var columns = [];
      built.targets.forEach(function (t) {
        var id = String(t.assignmentId);
        if (columns.indexOf(id) < 0 && !self.isProtected(id)) columns.push(id);
      });
      return model.ensureAssignmentsLoaded(columns).then(function (state) {
        if (state.missing.length) {
          var names = state.missing.map(function (id) {
            var asg = model.assignment(id);
            return '\u201c' + ((asg && asg.name) || 'an assignment') + '\u201d';
          });
          CGP.diag.error('paste.columnsUnverified', { count: state.missing.length });
          CGP.ui.error('Paste stopped: Canvas didn\u2019t send the current grades for ' + names.join(', ') +
            ', so Gradebook+ can\u2019t tell which cells the paste would overwrite. Nothing was changed. ' +
            'Wait a moment and paste again; if this keeps happening, reload the page.');
          return null;
        }
        return self.confirmAndApply(built, matrix);
      });
    });
  };

  /** Anonymous/moderated: the writer refuses these cells (see writer.js). */
  P.isProtected = function (assignmentId) {
    var asg = this.model.assignment(assignmentId);
    return !!(asg && (asg.anonymous || asg.moderated));
  };

  /* Will this target replace the grade the cell holds? Status-only tokens
   * (M, L) never touch the grade, and protected columns are never written. */
  P.overwrites = function (t) {
    var KIND = CGP.gradeOps.KIND;
    var kind = t.parsed.kind;
    if (kind === KIND.MISSING || kind === KIND.LATE) return false;
    if (this.isProtected(t.assignmentId)) return false;
    var rec = this.model.cell(t.assignmentId, t.userId);
    if (!rec) return false;
    var hasGrade = rec.excused || (rec.grade !== null && rec.grade !== undefined && rec.grade !== '');
    if (!hasGrade) return false;
    if (kind === KIND.EXCUSED) return !rec.excused;
    if (kind === KIND.CLEAR) return true;
    if (rec.excused) return true;
    var incoming = t.parsed.value;
    if (kind === KIND.NUMBER && rec.score !== null && rec.score !== undefined && Number(rec.score) === Number(incoming)) return false;
    return String(rec.grade).toLowerCase() !== String(incoming).toLowerCase();
  };

  /* How many targets would replace a grade that is already there. Status-only
   * tokens (M, L) never touch the grade, so they never count. */
  P.countOverwrites = function (targets) {
    var self = this;
    return targets.filter(function (t) { return self.overwrites(t); }).length;
  };

  P.confirmAndApply = function (built, matrix) {
    var self = this;
    var overwrites = this.countOverwrites(built.targets);
    // What each grade-changing cell holds as the question is decided -
    // captured before asking, while nothing can have changed underneath. The
    // writer skips any whose grade is different by the time it gets there
    // (another tab, SpeedGrader, a co-teacher), rather than replace a grade
    // nobody was asked about.
    var KIND = CGP.gradeOps.KIND;
    var expected = {};
    built.targets.forEach(function (t) {
      if (t.parsed.kind === KIND.MISSING || t.parsed.kind === KIND.LATE) return;
      expected[String(t.assignmentId) + ':' + String(t.userId)] =
        CGP.gradeOps.gradeSignature(self.model.cell(t.assignmentId, t.userId));
    });

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
    return this.writer.apply(built.targets, { announce: true, expectedGrades: expected });
  };

  CGP.BulkPasteController = BulkPasteController;
})();
