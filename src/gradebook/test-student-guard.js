/* Canvas Gradebook+ - keeps the hidden Test Student row out of the grades.
 *
 * Canvas's Student View "Test Student" is a real enrollment with real
 * submissions, and its scores count wherever Canvas averages a column. When
 * this extension hides that row (layout.js hideTestStudentRows), a teacher
 * can no longer see what is in it - so two things must never happen
 * silently:
 *
 *   1. Typing into it. The row is invisible and unclickable, but Canvas's
 *      own Enter / arrow-key navigation still walks into it, and the next
 *      grade typed lands in a cell nobody can see. Any keystroke that would
 *      edit a Test Student cell is stopped, its editor is cancelled without
 *      saving, and the cursor steps on to the next real student in the
 *      direction of travel.
 *
 *   2. Grades piling up in it anyway. Canvas's own missing-submission
 *      policy gives the Test Student automatic zeros as due dates pass, and
 *      older stray entries may already be there. On load, the Test
 *      Student's submissions are read; if any carry a grade, an excusal or a
 *      status, the teacher is told and offered a one-click clear (or, with
 *      testStudentAutoClear on, they are cleared without asking).
 *
 * Only active while hideTestStudent is on: a visible row is the teacher's
 * to type in, and its contents are in plain sight. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.TestStudentGuard) return;

  var NAV_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'PageDown', 'PageUp', 'Home', 'End', 'Escape'];
  var MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];

  function TestStudentGuard(ctx) {
    this.adapter = ctx.adapter;
    this.model = ctx.model;
    this.api = ctx.api;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint || function () {};
    this.direction = 1;       // last vertical direction of travel
    this._checkTimer = null;
    this._stepping = false;
    this.noticeEl = null;
    this.dismissed = false;
  }

  var P = TestStudentGuard.prototype;

  P.active = function () { return !!this.settings.values.hideTestStudent; };

  P.start = function () {
    // Registered before the keyboard controller's own capture listener, so
    // a blocked keystroke never reaches the M/E/L shortcuts or Canvas.
    document.addEventListener('keydown', this.onKeyDown.bind(this), true);
    document.addEventListener('focusin', this.onFocusIn.bind(this), true);
  };

  /* --------------------------------------------------- keyboard protection */

  P.isTestRow = function (info) {
    if (!info || info.top === null || info.top === undefined) return false;
    return !!this.adapter.isTestStudentAtTop(info.top);
  };

  P.currentInfo = function (target) {
    var inCell = target && target.closest && target.closest('.slick-cell');
    return (inCell ? this.adapter.cellInfo(target) : null) || this.adapter.activeCellInfo();
  };

  P.onKeyDown = function (e) {
    if (!this.active() || e.defaultPrevented) return;
    var key = e.key;
    if (!key || MODIFIER_KEYS.indexOf(key) >= 0) return;
    if (key === 'ArrowDown' || key === 'PageDown' || (key === 'Enter' && !e.shiftKey)) this.direction = 1;
    else if (key === 'ArrowUp' || key === 'PageUp' || (key === 'Enter' && e.shiftKey)) this.direction = -1;

    var target = e.target;
    if (target && target.closest && target.closest('[role="dialog"], .ui-dialog, [role="menu"], .cgp-pop, .cgp-notice')) return;
    // Typing in a field outside the grid (a search box, a comment) is never
    // about the grid's active cell, wherever that happens to be.
    var inCell = !!(target && target.closest && target.closest('.slick-cell'));
    var isText = CGP.keyboardInternals && CGP.keyboardInternals.isTextEntry;
    if (!inCell && isText && isText(target)) return;
    var info = this.currentInfo(target);
    var onTestRow = this.isTestRow(info);

    if (NAV_KEYS.indexOf(key) >= 0 && !(onTestRow && this.editorOpen(info))) {
      // Let Canvas move the cursor, then make sure it did not stop on the
      // Test Student row.
      this.scheduleCheck();
      return;
    }
    if (!onTestRow) return;
    // Anything else on the Test Student row would start (or continue) an
    // edit, a shortcut or a paste into an invisible cell.
    e.preventDefault();
    e.stopImmediatePropagation();
    CGP.diag.bump('testStudent.keystrokeBlocked');
    this.stepOff(info);
  };

  P.editorOpen = function (info) {
    return !!(info && info.el && this.adapter.editorInput(info.el));
  };

  /* An editor opening inside the Test Student row by any route (Canvas's
   * own Enter, a programmatic activation) is closed without saving. */
  P.onFocusIn = function (e) {
    if (!this.active()) return;
    var target = e.target;
    if (!target || !target.closest || !target.closest('.slick-cell')) return;
    var info = this.adapter.cellInfo(target);
    if (!this.isTestRow(info)) return;
    CGP.diag.bump('testStudent.editorBlocked');
    this.stepOff(info);
  };

  P.scheduleCheck = function () {
    var self = this;
    if (this._checkTimer) clearTimeout(this._checkTimer);
    this._checkTimer = setTimeout(function () {
      self._checkTimer = null;
      var info = self.adapter.activeCellInfo();
      if (self.isTestRow(info)) self.stepOff(info);
    }, 90);
  };

  /* Close any editor on the Test Student row without saving and move to the
   * next real student in the direction of travel (or back the other way at
   * the end of the roster). */
  P.stepOff = function (info) {
    var self = this;
    if (!info || this._stepping) return;
    this._stepping = true;
    try {
      if (info.el) {
        var input = this.adapter.editorInput(info.el);
        if (input) {
          // Empty the editor first, so even a commit-on-close saves nothing.
          if (this.adapter.setEditorValue) this.adapter.setEditorValue(input, '');
          this.adapter.cancelEditor(info.el);
          try { input.blur(); } catch (_) { /* ignore */ }
        }
      }
    } catch (err) { /* never let the guard break grading */ }
    var row = info.rowIndex;
    var col = info.colIndex;
    if (row === null || row === undefined || col === null || col === undefined) { this._stepping = false; return; }
    var total = typeof this.adapter.rowCount === 'function' ? this.adapter.rowCount() : null;
    var next = row + this.direction;
    if (next < 0 || (total !== null && next >= total)) next = row - this.direction;
    if (next < 0) { this._stepping = false; return; }
    this.adapter.scrollRowIntoView(next);
    setTimeout(function () {
      self._stepping = false;
      var el = self.adapter.cellElementAt(next, col);
      if (el) self.adapter.activateCell(el);
    }, 60);
  };

  /* ------------------------------------------------ grades already there */

  /** Does this Test Student submission carry anything that counts? */
  function holdsData(s) {
    if (!s) return false;
    if (s.excused) return true;
    if (s.score !== null && s.score !== undefined) return true;
    if (s.entered_score !== null && s.entered_score !== undefined) return true;
    if (s.grade !== null && s.grade !== undefined && String(s.grade) !== '') return true;
    var lps = s.late_policy_status;
    return !!(lps && lps !== 'none');
  }

  /* Read the Test Student's submissions and offer to clear any that hold a
   * grade, an excusal or a status. Resolves with the list found. */
  P.scan = function () {
    var self = this;
    if (!this.active() || !this.api || !this.model) return Promise.resolve([]);
    var courseId = this.model.courseId;
    return this.api.testStudentIds(courseId).then(function (ids) {
      if (!ids || !ids.length) return [];
      return Promise.all(ids.map(function (uid) {
        return self.api.submissionsForStudent(courseId, uid).then(function (subs) {
          return (subs || []).filter(holdsData).map(function (s) {
            return { userId: uid, assignmentId: String(s.assignment_id), excused: !!s.excused };
          });
        }, function () { return []; });
      })).then(function (lists) {
        var found = [].concat.apply([], lists).filter(function (f) {
          // Only columns this gradebook has; never anonymous or moderated
          // ones, where a direct API write is refused (see writer.js).
          var a = self.model.assignment(f.assignmentId);
          return a && !a.anonymous && !a.moderated;
        });
        CGP.diag.set('testStudentCellsWithData', found.length);
        if (!found.length) return found;
        if (self.settings.values.testStudentAutoClear) {
          self.clear(found, { quiet: true });
        } else {
          self.showNotice(found);
        }
        return found;
      });
    }, function (err) {
      CGP.diag.warn('testStudent.scanFailed', { status: err && err.status });
      return [];
    });
  };

  /* Empty each listed submission: no grade, not excused, and an explicit
   * "no status", which also stops Canvas's automatic missing policy from
   * putting a zero straight back on it. */
  P.clear = function (found, opts) {
    var self = this;
    opts = opts || {};
    var gate = CGP.util.pool(3);
    var ok = 0;
    var failed = 0;
    var firstError = null;
    return Promise.all(found.map(function (f) {
      var form = { 'submission[posted_grade]': '', 'submission[late_policy_status]': 'none' };
      if (f.excused) form['submission[excuse]'] = 'false';
      return gate(function () {
        return self.api.updateSubmission(self.model.courseId, f.assignmentId, f.userId, form);
      }).then(function () { ok++; }, function (err) {
        failed++;
        if (!firstError) firstError = err;
      });
    })).then(function () {
      CGP.diag.bump('testStudent.cleared', ok);
      if (failed) {
        CGP.ui.error('Cleared ' + ok + ' of ' + found.length + ' Test Student grades; ' + failed +
          ' could not be cleared. ' + CGP.util.describeApiError(firstError, { fallback: 'Canvas refused' }));
      } else if (ok) {
        CGP.ui.toast('Cleared ' + ok + ' hidden Test Student ' +
          (ok === 1 ? 'grade' : 'grades') + ' so ' + (ok === 1 ? 'it no longer counts' : 'they no longer count') +
          ' in column averages. Reload to see Canvas’s averages update.');
      }
      return { ok: ok, failed: failed };
    });
  };

  P.hideNotice = function () {
    if (this.noticeEl && this.noticeEl.parentElement) this.noticeEl.parentElement.removeChild(this.noticeEl);
    this.noticeEl = null;
  };

  P.showNotice = function (found) {
    var self = this;
    if (this.dismissed) return;
    this.hideNotice();
    var columns = [];
    found.forEach(function (f) {
      var a = self.model.assignment(f.assignmentId);
      var name = a && a.name ? a.name : 'an assignment';
      if (columns.indexOf(name) < 0) columns.push(name);
    });
    var n = found.length;
    var el = document.createElement('div');
    el.className = 'cgp-notice';
    el.setAttribute('role', 'alert');
    var text = document.createElement('p');
    text.className = 'cgp-notice__text';
    text.textContent = 'The hidden Test Student has ' + n + (n === 1 ? ' grade or status' : ' grades or statuses') +
      ' (in ' + columns.slice(0, 3).join(', ') + (columns.length > 3 ? ' and ' + (columns.length - 3) + ' more' : '') +
      '). Canvas counts ' + (n === 1 ? 'it' : 'them') + ' in column averages.';
    el.appendChild(text);
    var actions = document.createElement('div');
    actions.className = 'cgp-notice__actions';
    function button(label, cls, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgp-notice__btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(b); });
      actions.appendChild(b);
      return b;
    }
    button('Clear them', 'cgp-notice__btn--primary', function (b) {
      b.disabled = true;
      b.textContent = 'Clearing…';
      self.clear(found).then(function () { self.hideNotice(); });
    });
    button('Always clear automatically', '', function (b) {
      b.disabled = true;
      Promise.resolve(self.settings.save ? self.settings.save({ testStudentAutoClear: true }) : null).catch(function () { return null; })
        .then(function () { return self.clear(found); })
        .then(function () { self.hideNotice(); });
    });
    button('Not now', 'cgp-notice__btn--quiet', function () {
      self.dismissed = true;
      self.hideNotice();
    });
    el.appendChild(actions);
    (document.body || document.documentElement).appendChild(el);
    this.noticeEl = el;
  };

  CGP.TestStudentGuard = TestStudentGuard;
  CGP.testStudentInternals = { holdsData: holdsData };
})();
