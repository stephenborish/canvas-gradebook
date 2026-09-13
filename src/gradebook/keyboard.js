/* Canvas Gradebook+ - keyboard grading and spreadsheet navigation.
 *
 * M = grade 0 + Missing status, in one keystroke, written to Canvas; pressed
 * again on the same cell it switches Missing to Late and takes the 0 back out.
 * E = Excused. L = Late, and L again removes it. Typing 0 is still an
 * ordinary zero.
 * Shortcuts only fire when a real editable grade cell is active (or cells are
 * multi-selected); typing anywhere else on Canvas is never intercepted.
 *
 * Navigation deliberately assists rather than replaces Canvas: Enter/Tab are
 * left to Canvas first, and only if the active cell did not move do we move it.
 * Ordinary numeric grading also stays on Canvas's own commit path, and we just
 * re-read the submission afterwards to keep indicators and Total in sync. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.KeyboardGradingController) return;

  var LETTERISH = /^(letter_grade|gpa_scale)$/;

  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (el.isContentEditable) return true;
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'number', 'email', 'tel', 'url', 'password'].indexOf(type) >= 0;
  }

  function KeyboardGradingController(ctx) {
    this.adapter = ctx.adapter;
    this.model = ctx.model;
    this.writer = ctx.writer;
    this.selection = ctx.selection;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint;
    this.bulkComment = ctx.bulkComment || null;
    this._editorWatch = new WeakMap();
    this._refreshTimers = new Map();
    // "assignmentId:userId" cells where the M shortcut's own native-commit-then-
    // API-write sequence is in flight. Their focusout must NOT trigger the
    // ordinary reconcile-from-Canvas path below: that path re-reads whatever
    // Canvas has and, seeing a graded submission still flagged Missing,
    // deliberately clears the status - which is exactly the status M just
    // asked for. The M flow already keeps the model truthful on its own.
    this._nativeMPending = new Set();
  }

  var P = KeyboardGradingController.prototype;

  P.start = function () {
    document.addEventListener('keydown', this.onKeyDown.bind(this), true);
    document.addEventListener('focusin', this.onFocusIn.bind(this), true);
    document.addEventListener('focusout', this.onFocusOut.bind(this), true);
  };

  /* ------------------------------------------------------- editor bookkeeping */

  P.onFocusIn = function (e) {
    var el = e.target;
    if (!isTextEntry(el) || !el.closest) return;
    var cell = el.closest('.slick-cell');
    if (!cell) return;
    var info = this.adapter.cellInfo(cell);
    if (!info || info.columnType !== 'assignment') return;
    this._editorWatch.set(el, {
      value: String(el.value === undefined ? '' : el.value),
      assignmentId: info.assignmentId,
      userId: info.studentId
    });
  };

  P.onFocusOut = function (e) {
    var el = e.target;
    var watch = this._editorWatch.get(el);
    if (!watch) return;
    this._editorWatch.delete(el);
    var now = String(el.value === undefined ? '' : el.value);
    if (now === watch.value) return;
    if (!watch.assignmentId || !watch.userId) return;
    if (this._nativeMPending.has(watch.assignmentId + ':' + watch.userId)) return;
    this.scheduleReconcile(watch.assignmentId, watch.userId);
  };

  /** Canvas committed a grade its own way: re-read it so we stay truthful. */
  P.scheduleReconcile = function (assignmentId, userId) {
    var self = this;
    var key = assignmentId + ':' + userId;
    if (this._refreshTimers.has(key)) clearTimeout(this._refreshTimers.get(key));
    this._refreshTimers.set(key, setTimeout(function () {
      self._refreshTimers.delete(key);
      self.model.patchCell(assignmentId, userId, { override: null }, { silent: true });
      self.model.refreshCell(assignmentId, userId).then(function () {
        self.model.queueTotalRefresh(userId);
        if (self.requestPaint) self.requestPaint();
        // Canvas just committed a grade through its own editor. If that left
        // the submission both graded and still flagged Missing, a teacher who
        // just typed a real grade does not mean to keep that status - the work
        // came in, late. Hand it to the writer, which switches Missing to Late
        // (or merely clears it, per the setting).
        return self.writer.resolveStaleMissing(assignmentId, userId);
      }).then(function () {
        if (self.requestPaint) self.requestPaint();
      });
    }, 1200));
  };

  /* ------------------------------------------------------------- keystrokes */

  P.onKeyDown = function (e) {
    if (e.defaultPrevented) return;
    var key = e.key;
    if (!key) return;

    var target = e.target;
    var inCell = !!(target && target.closest && target.closest('.slick-cell'));
    if (isTextEntry(target) && !inCell) return;      // never hijack typing elsewhere
    if (target && target.closest && target.closest('[role="dialog"], .ui-dialog, [role="menu"]')) return;

    var info = (inCell ? this.adapter.cellInfo(target) : null) || this.adapter.activeCellInfo();
    var selectionSize = this.selection.size();

    if (key === 'Escape') {
      if (selectionSize) { this.selection.clear(); }
      return;                                         // Canvas keeps its own Escape behaviour
    }

    var plain = !e.metaKey && !e.ctrlKey && !e.altKey;

    // ---- M / E / L -------------------------------------------------------
    // Once we decide a keystroke IS one of these shortcuts, it must never be
    // allowed to reach Canvas's own single-key quick-edit - even if we then
    // fail to resolve exactly which cell this is. Letting an "m" or "e" leak
    // through is what used to show Canvas's own "invalid grade" toast.
    if (plain && key.length === 1) {
      var token = CGP.gradeOps.shortcutToken(key, this.settings.values);
      if (token) {
        // Only a real assignment cell (or an unresolved one - better to try
        // and fail loudly than to silently hand the keystroke to Canvas) is a
        // candidate. Columns we positively know are not assignments (student
        // name, Total, group, custom) are always left alone.
        var candidateCell = inCell && (!info || !info.columnType || info.columnType === 'assignment');
        if (candidateCell) {
          // Canvas often opens its grade editor already containing the current
          // grade (or a placeholder). M/E/L are replacement commands, so they
          // must still work in that state. The previous implementation returned
          // whenever the editor was non-empty, which let the literal "m" reach
          // Canvas and produced Canvas's invalid-grade error.
          e.preventDefault();
          e.stopImmediatePropagation();
          var scope = this.shortcutScope(info, selectionSize);
          if (!scope || !scope.length) {
            if (info) this.adapter.cancelEditor(info.el);
            CGP.diag.warn('keyboard.shortcutUnresolved', {
              columnType: info && info.columnType,
              hasAssignmentId: !!(info && info.assignmentId),
              hasStudentId: !!(info && info.studentId)
            });
            CGP.ui.error('Gradebook+ couldn\u2019t identify this cell for the ' + token + ' shortcut. ' +
              'Turn on Diagnostics in the options page if this keeps happening.');
            return;
          }
          this.applyToken(token, scope, info);
          return;
        }
        if (selectionSize > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var selScope = this.shortcutScope(info, selectionSize);
          if (selScope && selScope.length) { this.applyToken(token, selScope, info); return; }
          CGP.ui.error('"' + token + '" doesn\u2019t apply to the selected cells.');
          return;
        }
        return;
      }
    }

    // ---- C: bulk comment on the current selection -------------------------
    // Gated on "not currently typing anywhere" rather than on being inside a
    // grade cell, deliberately: C is a plain letter grade on letter-graded
    // assignments, and this must never hijack that. A live selection (built
    // with Cmd/Ctrl-click and Shift-click) is a separate, explicit gesture
    // from having a cell open for editing, so there is no real ambiguity
    // between "type a C into this open editor" and "comment on what I have
    // selected".
    if (this.bulkComment && plain && key.length === 1 && key.toLowerCase() === 'c' &&
      !isTextEntry(target) && selectionSize > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.bulkComment.open(this.selection.targets());
      return;
    }

    // ---- multi-cell numeric entry ---------------------------------------
    if (selectionSize > 1 && plain) {
      if (/^[0-9]$/.test(key) || key === '.' || key === '-' || key === '%') {
        e.preventDefault(); e.stopImmediatePropagation();
        this.selection.setPending(this.selection.pending + key);
        return;
      }
      if (key === 'Backspace' && this.selection.pending) {
        e.preventDefault(); e.stopImmediatePropagation();
        this.selection.setPending(this.selection.pending.slice(0, -1));
        return;
      }
      if (key === 'Enter' && this.selection.pending) {
        e.preventDefault(); e.stopImmediatePropagation();
        this.applyToken(this.selection.pending, this.selection.targets(), null);
        this.selection.setPending('');
        return;
      }
    }

    if (!this.settings.values.spreadsheetNavigation) return;
    if (!info || info.columnType !== 'assignment') return;

    // ---- navigation ------------------------------------------------------
    var editorEl = this.adapter.editorInput(info.el);
    var caretBusy = false;
    if (editorEl && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      var v = String(editorEl.value === undefined ? '' : editorEl.value);
      caretBusy = v.length > 0;
    }

    if (key === 'Enter' && e.shiftKey && plain === false) return;

    if (key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.commitAndMove(info, editorEl, -1, 0);
      return;
    }
    if (key === 'Enter' && plain) { this.assistMove(info, 1, 0); return; }
    if (key === 'Tab' && !e.shiftKey && plain) { this.assistMove(info, 0, 1); return; }
    if (key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { this.assistMove(info, 0, -1); return; }
    if (plain && !caretBusy) {
      if (key === 'ArrowDown') { this.assistMove(info, 1, 0); return; }
      if (key === 'ArrowUp') { this.assistMove(info, -1, 0); return; }
      if (key === 'ArrowRight') { this.assistMove(info, 0, 1); return; }
      if (key === 'ArrowLeft') { this.assistMove(info, 0, -1); return; }
    }
  };

  P.shortcutScope = function (info, selectionSize) {
    if (selectionSize > 0) {
      var targets = this.selection.targets();
      var self = this;
      return targets.filter(function (t) {
        var a = self.model.assignment(t.assignmentId);
        return a && !LETTERISH.test(a.gradingType || '');
      });
    }
    if (!info || !this.adapter.isEditableGradeCell(info)) return null;
    var assignment = this.model.assignment(info.assignmentId);
    if (!assignment) return null;
    if (LETTERISH.test(assignment.gradingType || '')) return null; // letters are grades here
    return [{ assignmentId: info.assignmentId, userId: info.studentId }];
  };

  /* Close Canvas's open editor without letting it write anything.
   *
   * SlickGrid only saves on Enter when the editor's value actually CHANGED, so
   * committing the value the editor already holds closes it through Canvas's
   * own lifecycle and sends no grade of its own. Escape would also close it,
   * but on this Canvas build Escape tears down pane geometry and makes the
   * whole grid jump, which is why it is not used.
   *
   * This matters for correctness, not just tidiness. M is one write - grade 0
   * AND status Missing, in a single API request. Letting Canvas commit its own
   * "0" first put two writes for the same submission in flight at once, and
   * whichever Canvas's server finished last won: when its plain grade write
   * landed after ours, it left the submission graded 0 with the Missing status
   * gone again. That is the "M just enters a zero, Canvas never shows Missing"
   * report. Now nothing but our own request ever writes the cell. */
  P.closeEditorWithoutWriting = function (input) {
    if (!input) return false;
    // Whatever the editor held when it opened is the value that commits to
    // nothing. That is usually what is in it now, but not if the teacher typed
    // a digit or two before pressing the shortcut - and committing THOSE would
    // write a grade nobody asked for. The focusin watcher already recorded the
    // opening value for exactly this kind of question.
    var watch = this._editorWatch.get(input);
    var original = watch ? watch.value : String(input.value === undefined ? '' : input.value);
    this.adapter.setEditorValue(input, original);   // value unchanged: SlickGrid saves nothing
    this.adapter.sendKey(input, 'Enter', 13);
    return true;
  };

  P.applyToken = function (token, scope, info) {
    var self = this;
    var nativeEditor = info ? this.adapter.editorInput(info.el) : null;
    var singleCell = scope && scope.length === 1;
    var pendingKey = (nativeEditor && singleCell) ? (scope[0].assignmentId + ':' + scope[0].userId) : null;
    if (nativeEditor && singleCell) {
      // Closing the editor fires a focusout that the reconcile-from-Canvas path
      // in onFocusOut would otherwise act on - and seeing a graded submission
      // flagged Missing, it would "helpfully" resolve that status, which is
      // exactly the status M just asked for. Mark this cell as ours until our
      // own write below settles (cleared in every exit path), so reconciliation
      // stands down for it and never fights the shortcut that caused it.
      this._nativeMPending.add(pendingKey);
      this.closeEditorWithoutWriting(nativeEditor);
      CGP.diag.bump('keyboard.editorClosedForShortcut');
    }
    var built = this.writer.targetsFromTokens(scope.map(function (t) {
      return { assignmentId: t.assignmentId, userId: t.userId, token: token };
    }));
    if (built.invalid.length && !built.targets.length) {
      if (pendingKey) this._nativeMPending.delete(pendingKey);
      CGP.ui.error('"' + token + '" is not a grade Canvas will accept.');
      return;
    }
    var count = built.targets.length;
    var threshold = this.settings.values.bulkConfirmThreshold;
    if (count > threshold) {
      var label = CGP.gradeOps.describe(built.targets[0].parsed.kind);
      var ok = window.confirm('Apply ' + label + ' to ' + count + ' cells in this course?');
      if (!ok) {
        if (pendingKey) this._nativeMPending.delete(pendingKey);
        return;
      }
    }
    self.writer.apply(built.targets, { announce: count > 1 }).then(function () {
      if (pendingKey) self._nativeMPending.delete(pendingKey);
      if (self.requestPaint) self.requestPaint();
    });
  };

  /* Uses Canvas's own commit (Enter) and then moves where Canvas would not. */
  P.commitAndMove = function (info, editorEl, dRow, dCol) {
    var self = this;
    var row = info.rowIndex, col = info.colIndex;
    if (editorEl) this.adapter.sendKey(editorEl, 'Enter', 13);
    setTimeout(function () { self.focusCell(row + dRow, col + dCol); }, 130);
  };

  /* Let Canvas act first; only step in if the active cell did not move. */
  P.assistMove = function (info, dRow, dCol) {
    var self = this;
    var fromRow = info.rowIndex, fromCol = info.colIndex;
    setTimeout(function () {
      var now = self.adapter.activeCellInfo();
      if (now && (now.rowIndex !== fromRow || now.colIndex !== fromCol)) return; // Canvas handled it
      self.focusCell(fromRow + dRow, fromCol + dCol);
    }, 110);
  };

  P.focusCell = function (rowIndex, colIndex) {
    var self = this;
    if (rowIndex === null || colIndex === null || rowIndex < 0) return;
    var column = this.adapter.columnAt(colIndex);
    // Step over non-assignment columns when moving sideways.
    if (column && column.type !== 'assignment') {
      var dir = colIndex > (this.adapter.columnIdToIndex.get('student') || 0) ? 1 : 1;
      var probe = colIndex;
      for (var i = 0; i < 8; i++) {
        probe += dir;
        var c = this.adapter.columnAt(probe);
        if (c && c.type === 'assignment') { colIndex = probe; break; }
      }
    }
    this.adapter.scrollRowIntoView(rowIndex);
    this.adapter.scrollColumnIntoView(colIndex);
    setTimeout(function () {
      var el = self.adapter.cellElementAt(rowIndex, colIndex);
      if (!el) { CGP.diag.warn('nav.cellNotRendered', { rowIndex: rowIndex, colIndex: colIndex }); return; }
      self.adapter.activateCell(el);
    }, 60);
  };

  CGP.KeyboardGradingController = KeyboardGradingController;
  CGP.keyboardInternals = { isTextEntry: isTextEntry };
})();
