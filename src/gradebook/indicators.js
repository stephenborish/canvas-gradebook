/* Canvas Gradebook+ - in-cell indicators.
 *
 * Highest priority feature: a small speech bubble in every grade cell where
 * *this instructor* has written a student-facing comment, plus a resubmission
 * corner and the value overlay used after an API write so the cell shows the
 * truth without a page reload.
 *
 * The bubble lives in the cell's bottom-LEFT corner deliberately: Canvas's
 * own grade cell already claims both top corners for itself - its status
 * icon (late/missing/excused) at the leading edge and its "open in
 * SpeedGrader / Grade Detail Tray" arrow at the trailing edge - and a marker
 * sharing either one was both visually clipping that control and, worse,
 * sometimes intercepting its click. The resubmission wedge below claims
 * bottom-right, so the two markers this extension draws never collide either.
 *
 * Painting rules that keep Canvas intact:
 *   - markers are absolutely positioned inside the cell, never resize anything
 *   - a paint signature means unchanged cells are not touched on rerender
 *   - the signature always includes which submission the cell represents, so
 *     a DOM node Canvas recycles for a different student/assignment while
 *     scrolling is never mistaken for "unchanged" and skipped
 *   - our own nodes are ignored by the MutationObserver, so no render loops */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.IndicatorController) return;

  var BUBBLE = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<path d="M2.2 2.9c0-.9.7-1.6 1.6-1.6h8.4c.9 0 1.6.7 1.6 1.6v5.6c0 .9-.7 1.6-1.6 1.6H7.5L4.3 13v-2.9h-.5c-.9 0-1.6-.7-1.6-1.6V2.9z"/></svg>';

  function IndicatorController(ctx) {
    this.model = ctx.model;
    this.adapter = ctx.adapter;
    this.registry = ctx.registry;
    this.settings = ctx.settings;
    this.onCommentClick = ctx.onCommentClick || function () {};
    this.onCommentHover = ctx.onCommentHover || function () {};
    this.onCommentLeave = ctx.onCommentLeave || function () {};
    this.requested = new Set();
    this._hoverIcon = null;
  }

  var P = IndicatorController.prototype;

  P.signatureFor = function (info, rec) {
    // Identity comes first: SlickGrid recycles cell elements for a different
    // student/assignment as rows and columns virtualize, and every other
    // field here can coincidentally match the previous occupant (e.g. two
    // ungraded, comment-free cells). Without the identity, a repaint would be
    // skipped as "unchanged" and the wrong cell would keep showing stale
    // marks - or a real comment bubble would silently fail to appear - until
    // the whole page was reloaded.
    var id = (info.assignmentId || '') + ':' + (info.studentId || '');
    if (!rec) return id + '|none';
    var c = rec.comments || {};
    return [
      id,
      c.instructorCount || 0,
      c.studentRepliedAfter ? 1 : 0,
      rec.gradeMatchesCurrent === false ? 1 : 0,
      rec.gradedAt ? 1 : 0,
      rec.pending ? 1 : 0,
      rec.override === null || rec.override === undefined ? '' : rec.override,
      this.settings.values.commentIndicator ? 1 : 0,
      this.settings.values.showCommentCount ? 1 : 0,
      this.settings.values.resubmissionIndicator ? 1 : 0
    ].join('|');
  };

  P.marksHost = function (cellEl) {
    var host = cellEl.querySelector(':scope > .cgp-marks');
    if (!host) {
      host = document.createElement('span');
      host.className = 'cgp-marks';
      cellEl.appendChild(host);
    }
    return host;
  };

  /* Is what we last painted into this cell still actually there?
   *
   * The paint signature alone is not enough. Canvas owns the inside of every
   * cell, and it rewrites that HTML wholesale in two very ordinary situations:
   * opening its grade editor (SlickGrid empties the active cell node before
   * mounting the editor) and closing it again (the cell is re-rendered from
   * Canvas's own formatter). Both wipe out the .cgp-marks host - and therefore
   * the comment bubble - while leaving the cell ELEMENT, and so its recorded
   * signature, untouched. The next paint pass would then see "signature
   * unchanged" and skip the cell, so a bubble destroyed by clicking into the
   * cell stayed gone until something unrelated happened to change that cell's
   * data. That is exactly the reported "click a cell with a comment icon, move
   * away, the icon is gone forever" behaviour.
   *
   * Canvas rewrites the cell's contents but never its class list, so the
   * classes we set alongside the markup are a reliable record of what SHOULD
   * be inside. Where they disagree with what is, the cell is repainted. */
  P.marksIntact = function (cell) {
    if (cell.classList.contains('cgp-has-comment') &&
      !cell.querySelector(':scope > .cgp-marks > .cgp-cmt')) return false;
    if (cell.classList.contains('cgp-has-resub') &&
      !cell.querySelector(':scope > .cgp-marks > .cgp-resub')) return false;
    if (cell.classList.contains('cgp-override') &&
      !cell.querySelector(':scope > .cgp-val')) return false;
    return true;
  };

  P.paintCell = function (info) {
    var s = this.settings.values;
    var cell = info.el;

    // Tag every cell with its column type so CSS can align without guessing.
    if (info.columnType && cell.getAttribute('data-cgp-col') !== info.columnType) {
      cell.setAttribute('data-cgp-col', info.columnType);
    }

    if (info.columnType === 'student') {
      var link = cell.querySelector('a, .student-name');
      if (link && !link.title) {
        var st = info.studentId ? this.model.student(info.studentId) : null;
        if (st && st.fullName) link.title = st.fullName;
      }
      return;
    }
    if (info.columnType !== 'assignment' || !info.assignmentId || !info.studentId) return;

    var rec = this.model.cell(info.assignmentId, info.studentId);
    var sig = this.signatureFor(info, rec);
    if (!this.registry.needsPaint(cell, sig) && this.marksIntact(cell)) return;
    this.registry.markPainted(cell, sig);

    var host = this.marksHost(cell);
    var parts = [];

    var comments = (rec && rec.comments) || null;
    var showComment = s.commentIndicator && comments && comments.hasInstructorComment;
    if (showComment) {
      var tip = CGP.commentAnalysis.tooltip(comments);
      var cls = 'cgp-cmt' + (comments.studentRepliedAfter ? ' cgp-cmt--reply' : '');
      parts.push('<span class="' + cls + '" role="button" tabindex="-1" aria-label="' +
        CGP.util.escapeHtml(tip) + '">' + BUBBLE + '</span>');
      if (s.showCommentCount && comments.instructorCount > 1) {
        parts.push('<span class="cgp-cmt-count" aria-hidden="true">' + comments.instructorCount + '</span>');
      }
    }

    var showResub = !!(s.resubmissionIndicator && rec && rec.gradedAt && rec.gradeMatchesCurrent === false);
    if (showResub) {
      parts.push('<span class="cgp-resub" title="Resubmitted after grading"></span>');
    }

    host.innerHTML = parts.join('');
    cell.classList.toggle('cgp-has-comment', !!showComment);
    cell.classList.toggle('cgp-has-resub', !!showResub);
    cell.classList.toggle('cgp-pending-write', !!(rec && rec.pending));

    // Value overlay: only used when we wrote through the API and Canvas's own
    // rendering has not caught up. Cleared as soon as Canvas agrees.
    var override = rec && rec.override !== null && rec.override !== undefined ? String(rec.override) : null;
    if (override !== null) {
      var canvasText = this.canvasCellText(cell);
      if (canvasText === override) {
        cell.classList.remove('cgp-override');
        var stale = cell.querySelector(':scope > .cgp-val');
        if (stale) stale.remove();
      } else {
        var val = cell.querySelector(':scope > .cgp-val');
        if (!val) {
          val = document.createElement('span');
          val.className = 'cgp-val';
          cell.appendChild(val);
        }
        val.textContent = override;
        cell.classList.add('cgp-override');
      }
    } else {
      cell.classList.remove('cgp-override');
      var old = cell.querySelector(':scope > .cgp-val');
      if (old) old.remove();
    }

    if (comments && comments.hasInstructorComment) CGP.diag.bump('paint.commentIcons');
  };

  P.canvasCellText = function (cell) {
    var clone = cell.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('.cgp-marks, .cgp-val')).forEach(function (n) { n.remove(); });
    return (clone.textContent || '').trim();
  };

  P.paint = function () {
    // A repaint can replace the exact bubble element the pointer is sitting
    // over (its parent cell's marks host is rebuilt from scratch), which
    // never fires mouseout. Left alone, the hover preview would be stuck open
    // pointing at a comment that is no longer under the cursor.
    if (this._hoverIcon && !this._hoverIcon.isConnected) {
      this._hoverIcon = null;
      this.onCommentLeave();
    }
    if (!this.model.ready) {
      // Still tag columns so alignment/centering works before data arrives.
      var early = this.adapter.visibleCells();
      this.registry.sync(early);
      var self0 = this;
      early.forEach(function (info) {
        if (info.columnType && info.el.getAttribute('data-cgp-col') !== info.columnType) {
          info.el.setAttribute('data-cgp-col', info.columnType);
        }
        void self0;
      });
      return;
    }
    var cells = this.registry.sync(this.adapter.visibleCells());
    var self = this;
    var neededAssignments = [];
    cells.forEach(function (info) {
      if (info.columnType === 'assignment' && info.assignmentId &&
        !self.model.loadedAssignments.has(String(info.assignmentId)) &&
        !self.requested.has(String(info.assignmentId))) {
        self.requested.add(String(info.assignmentId));
        neededAssignments.push(String(info.assignmentId));
      }
      self.paintCell(info);
    });
    if (neededAssignments.length) {
      this.model.ensureAssignments(neededAssignments).then(function () {
        neededAssignments.forEach(function (id) { self.requested.delete(String(id)); });
        var st = self.model.stats();
        CGP.diag.set('cellsWithInstructorComment', st.cellsWithInstructorComment || 0);
        CGP.diag.set('submissionsLoaded', st.cells || 0);
      }, function () {
        // A transient Canvas/API failure must not permanently suppress retries.
        neededAssignments.forEach(function (id) { self.requested.delete(String(id)); });
      });
    }
    CGP.diag.bump('paint.passes');
  };

  P.bindCommentClicks = function () {
    var self = this;
    document.addEventListener('mousedown', function (e) {
      var icon = e.target && e.target.closest ? e.target.closest('.cgp-cmt') : null;
      if (!icon) return;
      // Keep Canvas from entering cell-edit mode behind the popover.
      e.preventDefault();
      e.stopPropagation();
      self.onCommentLeave(); // the click-through popover replaces any preview
      var info = self.adapter.cellInfo(icon);
      if (info && info.assignmentId && info.studentId) self.onCommentClick(info);
    }, true);
  };

  /* A quick, read-only preview on hover - separate from the click-to-reply
   * popover - so seeing what was said does not require opening anything.
   * mouseover/mouseout (not mouseenter/mouseleave) bubble, so one delegated
   * listener covers every bubble the grid ever paints, including ones added
   * after this binds. */
  P.bindCommentHover = function () {
    var self = this;
    document.addEventListener('mouseover', function (e) {
      var icon = e.target && e.target.closest ? e.target.closest('.cgp-cmt') : null;
      if (!icon || icon === self._hoverIcon) return;
      self._hoverIcon = icon;
      var info = self.adapter.cellInfo(icon);
      if (info && info.assignmentId && info.studentId) self.onCommentHover(info);
    }, false);
    document.addEventListener('mouseout', function (e) {
      var icon = e.target && e.target.closest ? e.target.closest('.cgp-cmt') : null;
      if (!icon || icon !== self._hoverIcon) return;
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.cgp-cmt') === icon) return;
      self._hoverIcon = null;
      self.onCommentLeave();
    }, false);
    // A bubble that scrolls out from under the pointer (or disappears on
    // repaint) never fires mouseout - close on any scroll instead of trusting it.
    this.adapter.viewports().forEach(function (vp) {
      vp.addEventListener('scroll', function () { self._hoverIcon = null; self.onCommentLeave(); }, { passive: true });
    });
  };

  P.start = function () {
    this.bindCommentClicks();
    this.bindCommentHover();
  };

  CGP.IndicatorController = IndicatorController;
})();
