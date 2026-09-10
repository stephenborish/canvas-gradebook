/* Canvas Gradebook+ - in-cell indicators.
 *
 * Highest priority feature: a small speech bubble in every grade cell where
 * *this instructor* has written a student-facing comment. Also paints subtle
 * status dots (missing / late / excused / needs grading) and a resubmission
 * corner, plus the value overlay used after an API write so the cell shows the
 * truth without a page reload.
 *
 * Painting rules that keep Canvas intact:
 *   - markers are absolutely positioned inside the cell, never resize anything
 *   - a paint signature means unchanged cells are not touched on rerender
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
    this.requested = new Set();
  }

  var P = IndicatorController.prototype;

  P.signatureFor = function (info, rec) {
    if (!rec) return 'none';
    var c = rec.comments || {};
    return [
      c.instructorCount || 0,
      c.studentRepliedAfter ? 1 : 0,
      rec.missing ? 1 : 0,
      rec.late ? 1 : 0,
      rec.excused ? 1 : 0,
      rec.workflowState || '',
      rec.gradeMatchesCurrent === false ? 1 : 0,
      rec.pending ? 1 : 0,
      rec.override === null || rec.override === undefined ? '' : rec.override,
      this.settings.values.commentIndicator ? 1 : 0,
      this.settings.values.showCommentCount ? 1 : 0,
      this.settings.values.statusIndicators ? 1 : 0
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
    if (!this.registry.needsPaint(cell, sig)) return;
    this.registry.markPainted(cell, sig);

    var host = this.marksHost(cell);
    var parts = [];

    var comments = (rec && rec.comments) || null;
    var showComment = s.commentIndicator && comments && comments.hasInstructorComment;
    if (showComment) {
      var tip = CGP.commentAnalysis.tooltip(comments);
      var cls = 'cgp-cmt' + (comments.studentRepliedAfter ? ' cgp-cmt--reply' : '');
      parts.push('<span class="' + cls + '" role="button" tabindex="-1" aria-label="' +
        CGP.util.escapeHtml(tip) + '" title="' + CGP.util.escapeHtml(tip) + '">' + BUBBLE + '</span>');
      if (s.showCommentCount && comments.instructorCount > 1) {
        parts.push('<span class="cgp-cmt-count" aria-hidden="true">' + comments.instructorCount + '</span>');
      }
    }

    if (s.statusIndicators && rec) {
      var status = null;
      if (rec.excused) status = 'excused';
      else if (rec.missing) status = 'missing';
      else if (rec.late) status = 'late';
      else if (rec.workflowState === 'submitted' || (rec.submittedAt && !rec.gradedAt)) status = 'ungraded';
      if (status) {
        parts.push('<span class="cgp-dot cgp-dot--' + status + '" title="' +
          status.charAt(0).toUpperCase() + status.slice(1) + '"></span>');
      }
    }

    if (s.resubmissionIndicator && rec && rec.gradedAt && rec.gradeMatchesCurrent === false) {
      parts.push('<span class="cgp-resub" title="Resubmitted after grading"></span>');
    }

    host.innerHTML = parts.join('');
    cell.classList.toggle('cgp-has-comment', !!showComment);
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
      var info = self.adapter.cellInfo(icon);
      if (info && info.assignmentId && info.studentId) self.onCommentClick(info);
    }, true);
  };

  P.start = function () {
    this.bindCommentClicks();
  };

  CGP.IndicatorController = IndicatorController;
})();
