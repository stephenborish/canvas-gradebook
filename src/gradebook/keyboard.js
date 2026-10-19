/* Canvas Gradebook+ - keyboard grading and spreadsheet navigation.
 *
 * M = Missing, written to Canvas instantly; pressed again it is removed. L =
 * Late, same shape; pressed again it is removed. E = Excused. Missing and
 * Late are independent flags: neither one ever touches the grade. Typing a
 * grade into a cell that reads Missing swaps Missing for Late once Canvas
 * has saved that grade (see scheduleReconcile); typing a grade and then
 * pressing M saves it with Missing off and no status. Typing 0 is still an
 * ordinary zero, and leaves Missing on.
 * Shortcuts only fire when a real editable grade cell is active (or cells are
 * multi-selected); typing anywhere else on Canvas is never intercepted.
 *
 * Navigation deliberately assists rather than replaces Canvas: Enter/Tab are
 * left to Canvas first, and only if the active cell did not move do we move it.
 * Ordinary typed grading stays entirely on Canvas's own commit path - nothing
 * here writes a typed grade - and we just re-read the submission afterwards
 * to keep indicators and Total in sync. */
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
    this.registry = ctx.registry || null;
    this.bulkComment = ctx.bulkComment || null;
    this._editorWatch = new WeakMap();
    this._refreshTimers = new Map();
    // Timestamp of the most recent focusin on ANY text-entry element in the
    // grid (grade cells and non-assignment ones like a Notes column alike),
    // updated unconditionally in onFocusIn below. Compared against
    // this.selection.changedAt by the C shortcut to tell "this editor is
    // genuinely open right now, possibly opened after the selection" from
    // "this is stale focus left over from before the selection was built" -
    // see the C-shortcut branch in onKeyDown for why that distinction matters.
    this._lastTextFocusAt = 0;
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
    if (!isTextEntry(el)) return;
    // Recorded for every text-entry focus, not just assignment grade cells
    // (a Notes/custom column input counts too) - see the C-shortcut branch.
    this._lastTextFocusAt = Date.now();
    if (!el.closest) return;
    var cell = el.closest('.slick-cell');
    if (!cell) return;
    var info = this.adapter.cellInfo(cell);
    if (!info || info.columnType !== 'assignment') return;
    var storeValue = String(el.value === undefined ? '' : el.value);
    var shown = storeValue;
    // A cell this extension wrote to (a bulk entry, a paste, E, a clear)
    // still holds the OLD value in Canvas's own grid, and Canvas opens its
    // editor with that. Show the grade Canvas actually has instead, so the
    // teacher edits what they see - and remember both, because what Canvas
    // itself will (or won't) save is decided against its own stale value.
    var rec = this.model && typeof this.model.cell === 'function' ? this.model.cell(info.assignmentId, info.studentId) : null;
    if (rec && rec.override !== null && rec.override !== undefined && this.adapter.setEditorValue) {
      var truth = rec.override === '\u2013' ? '' : String(rec.override);
      if (truth !== storeValue) {
        this.adapter.setEditorValue(el, truth);
        try { if (typeof el.select === 'function') el.select(); } catch (_) { /* ignore */ }
        shown = truth;
      }
    }
    this._editorWatch.set(el, {
      value: storeValue,      // what Canvas's grid holds (decides whether Canvas saves)
      shown: shown,           // what the teacher saw when the editor opened
      cancelled: false,
      assignmentId: info.assignmentId,
      userId: info.studentId
    });
  };

  /* Same grade, typed two ways ("8" / "8.0", "a-" / "A-")? */
  function sameGrade(a, b) {
    var x = String(a === null || a === undefined ? '' : a).trim().toLowerCase();
    var y = String(b === null || b === undefined ? '' : b).trim().toLowerCase();
    if (x === y) return true;
    if (x === '' || y === '') return false;
    var nx = Number(x), ny = Number(y);
    return isFinite(nx) && isFinite(ny) && nx === ny;
  }

  P.onFocusOut = function (e) {
    var el = e.target;
    var cell = el && el.closest ? el.closest('.slick-cell') : null;
    if (cell && this.registry) this.registry.invalidate(cell);

    // Only an editor we saw open is followed up on. With no record of what
    // it held when it opened there is no telling whether anything changed,
    // and guessing "it was empty" is how an untouched grade used to get
    // written straight back to Canvas.
    var watch = this._editorWatch.get(el);
    if (watch) this._editorWatch.delete(el);
    if (watch && watch.assignmentId && watch.userId &&
      !this._nativeMPending.has(watch.assignmentId + ':' + watch.userId)) {
      var now = String(el.value === undefined ? '' : el.value);
      var baseline = watch.shown === undefined ? watch.value : watch.shown;
      if (!watch.cancelled && now !== baseline) {
        // Canvas commits what was typed through its own editor; nothing is
        // written from here. Writing it ourselves as well (as this used to)
        // put a second, unguarded write in flight for every edit - one that
        // skipped the anonymous/moderated refusal, failed silently, and could
        // even save an edit the teacher had cancelled with Escape. All that
        // is left to do is follow up once Canvas's own save has landed.
        // With no record of the cell before the edit there is nothing to
        // compare against: re-read it, but never act on the comparison.
        var before = this.model.cell(watch.assignmentId, watch.userId);
        if (before && before.override !== null && before.override !== undefined) {
          this.commitOverStaleCell(watch, now, before);
        }
        this.scheduleReconcile(watch.assignmentId, watch.userId, before ? {
          grade: before.grade,
          enteredScore: before.enteredScore,
          gradedAt: before.gradedAt,
          latePolicyStatus: before.latePolicyStatus || null,
          readsMissing: CGP.gradeOps.cellStatus(before) === 'missing',
          at: Date.now()
        } : null);
      }
    }
    if (this.requestPaint) this.requestPaint();
  };

  /* The teacher edited a cell whose grade this extension wrote, so Canvas's
   * own grid still holds the value from BEFORE that write. Canvas saves an
   * edit only when it differs from that stale value - so retyping the old
   * grade (changing a bulk-entered 8 back to the 9 the cell had before) was
   * silently never saved, and the bulk value stayed on the submission. In
   * exactly that case the edit is written here instead, through GradeWriter
   * (guarded, validated, serialized with any other write to the cell). When
   * Canvas WILL save it, it is left to Canvas, so the grade is not written
   * twice. Either way the cell shows the new value straight away. */
  P.commitOverStaleCell = function (watch, typed, before) {
    var self = this;
    var token = String(typed).trim() === '' ? '-' : String(typed).trim();
    var canvasWillSave = !sameGrade(typed, watch.value);
    var display = token === '-' ? '\u2013' : token;
    var previous = before.override;
    if (canvasWillSave) {
      this.model.patchCell(watch.assignmentId, watch.userId, { override: display });
      return;
    }
    if (!this.writer || typeof this.writer.targetsFromTokens !== 'function') return;
    var built = this.writer.targetsFromTokens([{ assignmentId: watch.assignmentId, userId: watch.userId, token: token }]);
    if (!built.targets.length) {
      if (built.invalid.length) CGP.ui.error('"' + typed + '" is not a grade Canvas will accept here. The cell was left as it was.');
      return;
    }
    // Marked as ours so the reconcile that follows (and any focusout from
    // closing the editor) stands down until this write settles.
    var key = watch.assignmentId + ':' + watch.userId;
    this._nativeMPending.add(key);
    this.writer.apply(built.targets).then(function (res) {
      self._nativeMPending.delete(key);
      if (res && (res.failed || res.skipped || res.unloaded || res.notReady)) {
        self.model.patchCell(watch.assignmentId, watch.userId, { override: previous });
      }
      if (self.requestPaint) self.requestPaint();
    });
  };

  /* Canvas committed a grade its own way: re-read the submission so the
   * indicators and Total stay truthful, and - once the read shows Canvas
   * really did save a NEW grade that earns credit - swap the Missing the cell
   * showed for Late. Canvas itself keeps an applied Missing on a graded
   * submission; a typed grade is the teacher saying the work is in, late.
   *
   * Re-read a few times on a backoff: Canvas's own request can take longer
   * than the first look. A read showing nothing new (Canvas refused the
   * value, or the edit was cancelled) changes nothing. */
  var RECONCILE_DELAYS = [1200, 3000, 8000];

  P.scheduleReconcile = function (assignmentId, userId, before, attempt) {
    var self = this;
    var key = assignmentId + ':' + userId;
    attempt = attempt || 0;
    if (this._refreshTimers.has(key)) clearTimeout(this._refreshTimers.get(key));
    this._refreshTimers.set(key, setTimeout(function () {
      self._refreshTimers.delete(key);
      self.model.refreshCell(assignmentId, userId).then(function (rec) {
        self.model.queueTotalRefresh(userId);
        if (self.requestPaint) self.requestPaint();
        if (!rec || !before) return;
        var hasGrade = rec.grade !== null && rec.grade !== undefined && String(rec.grade) !== '';
        var changed = rec.grade !== before.grade || rec.enteredScore !== before.enteredScore ||
          (rec.gradedAt && rec.gradedAt !== before.gradedAt);
        if (!changed || !hasGrade) {
          if (attempt + 1 < RECONCILE_DELAYS.length) self.scheduleReconcile(assignmentId, userId, before, attempt + 1);
          return;
        }
        // Only a Missing that was ALREADY on the cell when the grade was
        // typed is taken off - never one applied since (an M pressed after
        // the edit, while this follow-up was still waiting), which is the
        // teacher's newer decision. Nor while the course is still loading.
        // Canvas's own save of this very grade is not such a decision: it is
        // what this follow-up is here for (see model.localWriteSince).
        if (typeof self.model.localWriteSince === 'function' &&
          self.model.localWriteSince(assignmentId, userId, before.at)) return;
        if (!before.readsMissing && before.latePolicyStatus !== 'missing') return;
        // A zero typed over Missing is how missing work is recorded: it stays.
        if (rec.excused || !CGP.gradeOps.earnedCredit(rec)) return;
        var stillMissing = rec.latePolicyStatus === 'missing';
        // Canvas drops a computed Missing on grading by itself; the work still
        // came in late, so Late goes on - unless some status is already there.
        var computedDropped = !rec.latePolicyStatus && !rec.late;
        if ((stillMissing || computedDropped) && self.writer && self.model.ready !== false) {
          self.writer.apply([{
            assignmentId: assignmentId, userId: userId, fromMissing: true,
            parsed: { kind: CGP.gradeOps.KIND.CLEAR_MISSING, raw: '' }
          }]).then(function () { if (self.requestPaint) self.requestPaint(); });
        }
      });
    }, RECONCILE_DELAYS[attempt]));
  };

  /* ------------------------------------------------------------- keystrokes */

  P.onKeyDown = function (e) {
    // Escape abandons whatever an open editor holds: remember that, so its
    // focusout is never mistaken for a committed edit.
    if (e.key === 'Escape') {
      var escWatch = this._editorWatch.get(e.target);
      if (escWatch) escWatch.cancelled = true;
    }
    // Keys this extension dispatches itself (closing Canvas's editor) are
    // for Canvas, never shortcuts or bulk entry of ours.
    if (e.isTrusted === false) return;
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
      if (token && e.repeat && (inCell || selectionSize > 0)) {
        // A held key auto-repeats: M or L would toggle on, off, on... and a
        // selection would raise one confirmation per repeat. Swallow it.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
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
    // Gated on having a live selection rather than on being inside a grade
    // cell, deliberately: C is a plain letter grade on letter-graded
    // assignments (and an ordinary character in a Notes/custom column), and
    // this must never hijack either. A live selection (built with Cmd/Ctrl-
    // click and Shift-click) is a separate, explicit gesture from having a
    // cell open for editing, so once a selection exists C normally means
    // "comment on what I have selected".
    //
    // "Normally", not "always": requiring plain !isTextEntry(target) here
    // breaks the shortcut almost entirely, because building a selection with
    // Cmd/Ctrl-click deliberately keeps Canvas from moving focus onto the
    // clicked cells (see selection.js) - so whatever text entry the teacher
    // was last editing before starting the selection stays focused, and its
    // element is still e.target when this keydown fires. That stale leftover
    // focus is exactly what must be overridden - that was the reported bug.
    //
    // But a selection can also just sit there, quietly, for a while: nothing
    // clears it except Escape or a later plain click, so a teacher can build
    // one and then keep grading (or typing Notes) elsewhere entirely, via a
    // fresh click or keyboard navigation, with the selection still live in
    // the background. THAT keystroke must reach its own genuinely-focused,
    // freshly-opened field, not be hijacked into commenting on a selection
    // from ten minutes ago. The two situations differ in exactly one way:
    // whether the currently-focused text entry was already open BEFORE the
    // selection was last built (stale - hijack it) or was focused AFTER
    // (fresh - it is what the teacher is looking at right now, leave it
    // alone). _lastTextFocusAt (set in onFocusIn, for every text entry, not
    // just assignment cells) against selection.changedAt is exactly that
    // comparison.
    var isC = key && key.length === 1 && key.toLowerCase() === 'c';
    var cMods = plain || (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey);
    if (this.bulkComment && cMods && isC && selectionSize > 0 && e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (this.bulkComment && cMods && isC && selectionSize > 0) {
      // If multiple cells are selected, pressing C is always intended as bulk comment,
      // even if the last clicked cell in the range selection has an active input.
      // If only 1 cell is selected, only trigger if not actively typing into a fresh editor.
      var freshSingleEdit = (selectionSize === 1) && isTextEntry(target) && this._lastTextFocusAt > this.selection.changedAt;
      if (!freshSingleEdit) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (target && typeof target.blur === 'function') {
          try { target.blur(); } catch (_) {}
        }
        this.bulkComment.open(this.selection.targets());
        return;
      }
      // else: fall through and let Canvas (or the Notes column) handle this
      // literal "c" exactly as if there were no selection at all.
    }

    // ---- multi-cell numeric entry ---------------------------------------
    if (selectionSize > 1 && plain) {
      if (key === 'Enter' && e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
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
        var typedValue = this.selection.pending;
        this.selection.setPending('');
        this.applyToken(typedValue, this.selection.targets(), null);
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
    if (watch) watch.cancelled = true;   // a deliberate no-write close, not an edit
    var original = watch ? watch.value : String(input.value === undefined ? '' : input.value);
    this.adapter.setEditorValue(input, original);   // value unchanged: SlickGrid saves nothing
    this.adapter.sendKey(input, 'Enter', 13);
    return true;
  };

  P.applyToken = function (token, scope, info) {
    var self = this;
    // Canvas's editor can be open in any one of the target cells - with a
    // range, it is the Shift-clicked end, which Canvas activates on click.
    // Left open, it keeps showing (and could later commit) Canvas's own
    // stale value over the grade just written, which is how the last cell
    // of a bulk entry looked like it never received the grade.
    var editorCell = (info && info.el && this.adapter.editorInput(info.el)) ? info.el
      : (typeof this.adapter.activeCellEl === 'function' ? this.adapter.activeCellEl() : null);
    var nativeEditor = editorCell ? this.adapter.editorInput(editorCell) : null;
    var editorInfo = nativeEditor ? ((info && info.el === editorCell) ? info : this.adapter.cellInfo(editorCell)) : null;
    var inScope = !!(editorInfo && (scope || []).some(function (t) {
      return String(t.assignmentId) === String(editorInfo.assignmentId) && String(t.userId) === String(editorInfo.studentId);
    }));
    var pendingKey = (nativeEditor && inScope) ? (editorInfo.assignmentId + ':' + editorInfo.studentId) : null;
    // A grade typed into the open editor and then M on a cell that reads
    // Missing: the teacher is entering the work AND taking Missing off. The
    // typed grade used to be thrown away with the editor while only the
    // status was toggled, so the cell kept its old 0.
    var typedOverMissing = token === 'M' && scope.length === 1 && nativeEditor && inScope
      ? this.typedGradeOverMissing(nativeEditor, editorInfo) : null;
    if (nativeEditor && inScope) {
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
    // A pending follow-up from an earlier typed edit on these cells must
    // not act after this newer command (see scheduleReconcile).
    scope.forEach(function (t) {
      var k = t.assignmentId + ':' + t.userId;
      if (self._refreshTimers.has(k)) { clearTimeout(self._refreshTimers.get(k)); self._refreshTimers.delete(k); }
    });
    var built = this.writer.targetsFromTokens(scope.map(function (t) {
      return { assignmentId: t.assignmentId, userId: t.userId, token: typedOverMissing || token };
    }));
    // One request: the typed grade, with Missing off and no other status.
    if (typedOverMissing) built.targets.forEach(function (t) { t.liftMissingTo = 'none'; });
    if (built.invalid.length && !built.targets.length) {
      if (pendingKey) this._nativeMPending.delete(pendingKey);
      CGP.ui.error('"' + token + '" is not a grade Canvas will accept.');
      return;
    }
    if (built.invalid.length) {
      CGP.ui.error('"' + token + '" doesn\u2019t fit ' + built.invalid.length + ' of the selected cells' +
        ' (their columns grade differently); those were left unchanged.');
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

  /* The grade the teacher typed into this open editor, when the cell reads
   * Missing and what was typed is a grade the column accepts - otherwise
   * null, and M keeps its ordinary meaning. */
  P.typedGradeOverMissing = function (input, info) {
    var watch = this._editorWatch.get(input);
    if (!watch || !info) return null;
    var typed = String(input.value === undefined ? '' : input.value).trim();
    var baseline = watch.shown === undefined ? watch.value : watch.shown;
    if (typed === '' || sameGrade(typed, baseline)) return null;
    var rec = this.model.cell(info.assignmentId, info.studentId);
    if (CGP.gradeOps.cellStatus(rec) !== 'missing') return null;
    var assignment = this.model.assignment(info.assignmentId);
    var parsed = CGP.gradeOps.parseToken(typed, { gradingType: assignment && assignment.gradingType });
    var K = CGP.gradeOps.KIND;
    if ([K.NUMBER, K.PERCENT, K.LETTER].indexOf(parsed.kind) < 0) return null;
    if (!CGP.gradeOps.acceptsToken(parsed, assignment && assignment.gradingType)) return null;
    return typed;
  };

  /* Uses Canvas's own commit (Enter) and then moves where Canvas would not. */
  P.commitAndMove = function (info, editorEl, dRow, dCol) {
    var self = this;
    var row = info.rowIndex, col = info.colIndex;
    var seen = this.alertSnapshot();
    if (editorEl) this.adapter.sendKey(editorEl, 'Enter', 13);
    setTimeout(function () {
      if (self.canvasRefusedGrade(info, row, col, seen)) return;
      self.focusCell(row + dRow, col + dCol, dCol, dRow);
    }, 130);
  };

  /* Canvas rejected what was typed (invalid grade) and left the editor open for
   * the teacher to fix it. Moving on from here would strand the error. The cell
   * is looked up again rather than trusting info.el, which the grid may have
   * recycled in the meantime. */
  P.alertSnapshot = function () {
    return typeof this.adapter.invalidGradeAlerts === 'function' ? this.adapter.invalidGradeAlerts() : null;
  };

  P.canvasRefusedGrade = function (info, row, col, seen) {
    if (typeof this.adapter.holdsInvalidGrade !== 'function') return false;
    var el = (typeof this.adapter.cellElementAt === 'function' && this.adapter.cellElementAt(row, col)) || (info && info.el);
    var refused = this.adapter.holdsInvalidGrade(el, seen);
    if (refused) CGP.diag.bump('keyboard.moveHeldForInvalidGrade');
    return refused;
  };

  /* Let Canvas act first; only step in if the active cell did not move - and
   * never past a grade Canvas refused, which it deliberately leaves in place. */
  P.assistMove = function (info, dRow, dCol) {
    var self = this;
    var fromRow = info.rowIndex, fromCol = info.colIndex;
    var seen = this.alertSnapshot();
    setTimeout(function () {
      var now = self.adapter.activeCellInfo();
      if (now && (now.rowIndex !== fromRow || now.colIndex !== fromCol)) return; // Canvas handled it
      if (self.canvasRefusedGrade(info, fromRow, fromCol, seen)) return;
      self.focusCell(fromRow + dRow, fromCol + dCol, dCol, dRow);
    }, 110);
  };

  P.focusCell = function (rowIndex, colIndex, dCol, dRow) {
    var self = this;
    if (rowIndex === null || colIndex === null || rowIndex < 0 || colIndex < 0) return;
    var column = this.adapter.columnAt(colIndex);
    // Step over non-assignment columns in the direction of travel: moving
    // left must keep going left, not bounce back to where it started.
    if (column && column.type !== 'assignment') {
      var dir = dCol < 0 ? -1 : 1;
      var probe = colIndex;
      for (var i = 0; i < 8; i++) {
        probe += dir;
        if (probe < 0) break;
        var c = this.adapter.columnAt(probe);
        if (c && c.type === 'assignment') { colIndex = probe; break; }
      }
    }
    // Never land on the hidden Test Student row: step past it in the
    // direction of travel, the same way a hidden row in a spreadsheet is.
    if (this.settings.values.hideTestStudent && typeof this.adapter.isTestStudentRowIndex === 'function' &&
      this.adapter.isTestStudentRowIndex(rowIndex)) {
      rowIndex += (dRow < 0 ? -1 : 1);
      if (rowIndex < 0) return;
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
