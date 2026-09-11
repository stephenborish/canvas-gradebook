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

  /* Submission glyphs. One silhouette per kind of thing a student can hand in,
   * drawn on a 16x16 grid as strokes so the same path reads correctly both
   * filled-in (submitted) and outlined (nothing handed in yet). */
  var SUB_GLYPHS = {
    online_upload: '<path d="M4.2 2.2h4.6l3 3v8.6H4.2z"/><path d="M8.6 2.4v3.1h3"/>',
    student_annotation: '<path d="M4.2 2.2h4.6l3 3v8.6H4.2z"/><path d="M8.6 2.4v3.1h3"/>',
    online_text_entry: '<path d="M3.2 3.4h9.6M3.2 6.4h9.6M3.2 9.4h9.6M3.2 12.4h5.6"/>',
    online_url: '<path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-.8.8"/>' +
      '<path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l.8-.8"/>',
    media_recording: '<circle cx="8" cy="8" r="5.6"/><path d="M6.8 5.7l3.8 2.3-3.8 2.3z"/>',
    discussion_topic: '<path d="M2.6 4.2a1.6 1.6 0 0 1 1.6-1.6h7.6a1.6 1.6 0 0 1 1.6 1.6v4.6a1.6 1.6 0 0 1-1.6 1.6H7.4L4.6 13v-2.6a1.6 1.6 0 0 1-2-1.6z"/>',
    online_quiz: '<path d="M3.4 2.8h9.2v10.4H3.4z"/><path d="M5.6 7.4l1.6 1.6 3.2-3.2"/>',
    basic_lti_launch: '<path d="M3.4 2.8h9.2v10.4H3.4z"/><path d="M6.2 8h3.6M8 6.2v3.6"/>'
  };

  var SUB_LABELS = {
    online_upload: 'file upload',
    student_annotation: 'annotated document',
    online_text_entry: 'text entry',
    online_url: 'website URL',
    media_recording: 'media recording',
    discussion_topic: 'discussion post',
    online_quiz: 'quiz',
    basic_lti_launch: 'external tool'
  };

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
    // Whether this column's submissions have arrived is part of what a cell
    // shows, not just of what we know: the submission marker deliberately
    // stays away until they have, so "not loaded" and "loaded, nothing to
    // show" must be two different signatures or the marker would never appear
    // on a cell that had no record at the moment of its first paint.
    var loaded = this.model.loadedAssignments.has(String(info.assignmentId)) ? 'L' : '-';
    if (!rec) return id + '|none|' + loaded;
    
    var c = rec.comments || {};
    return [
      id,
      c.instructorCount || 0,
      c.studentRepliedAfter ? 1 : 0,
      rec.gradeMatchesCurrent === false ? 1 : 0,
      rec.gradedAt ? 1 : 0,
      rec.pending ? 1 : 0,
      rec.override === null || rec.override === undefined ? '' : rec.override,
      loaded,
      rec.submittedAt ? 1 : 0,
      rec.submissionType || '',
      this.settings.values.commentIndicator ? 1 : 0,
      this.settings.values.submissionIndicator ? 1 : 0,
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
    if (cell.classList.contains('cgp-has-sub') &&
      !cell.querySelector(':scope > .cgp-marks > .cgp-sub')) return false;
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

    var sub = s.submissionIndicator ? this.model.submissionState(info.assignmentId, info.studentId) : null;
    var showSub = !!sub;
    if (showSub) parts.push(this.submissionMarkup(sub, info));

    var showResub = !!(s.resubmissionIndicator && rec && rec.gradedAt && rec.gradeMatchesCurrent === false);
    if (showResub) {
      parts.push('<span class="cgp-resub" title="Resubmitted after grading"></span>');
    }

    host.innerHTML = parts.join('');
    cell.classList.toggle('cgp-has-comment', !!showComment);
    cell.classList.toggle('cgp-has-resub', !!showResub);
    cell.classList.toggle('cgp-has-sub', !!showSub);
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

  /* The submission marker: a link straight into SpeedGrader for exactly this
   * student and assignment.
   *
   * It is a real anchor, not a span with a click handler, so it behaves the
   * way a link should - middle-click, cmd-click, "open in new tab", the status
   * bar preview - and so no popup blocker is involved. It opens in a new tab
   * deliberately: a teacher scanning the grid should not lose their scroll
   * position in it just to look at one submission. */
  P.speedGraderHref = function (assignmentId, studentId) {
    return '/courses/' + encodeURIComponent(String(this.model.courseId)) +
      '/gradebook/speed_grader?assignment_id=' + encodeURIComponent(String(assignmentId)) +
      '&student_id=' + encodeURIComponent(String(studentId));
  };

  P.submissionMarkup = function (sub, info) {
    var glyph = SUB_GLYPHS[sub.kind] || SUB_GLYPHS.online_upload;
    var what = SUB_LABELS[sub.kind] || 'submission';
    var tip;
    if (sub.excused) tip = 'Excused. Opens SpeedGrader.';
    else if (sub.submitted) {
      tip = 'Submitted ' + (CGP.util.fmtDateTime(sub.submittedAt) || 'online') + ' \u2014 ' + what +
        (sub.attempt > 1 ? ' (attempt ' + sub.attempt + ')' : '') + '. Opens SpeedGrader.';
    } else {
      tip = 'Nothing submitted yet \u2014 expects a ' + what + '. Opens SpeedGrader.';
    }
    var cls = 'cgp-sub ' + (sub.submitted ? 'cgp-sub--in' : 'cgp-sub--out');
    return '<a class="' + cls + '" href="' + CGP.util.escapeHtml(this.speedGraderHref(info.assignmentId, info.studentId)) +
      '" target="_blank" rel="noopener" title="' + CGP.util.escapeHtml(tip) + '" aria-label="' +
      CGP.util.escapeHtml(tip) + '"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      glyph + '</svg></a>';
  };

  /* Canvas opens its own grade editor on mousedown anywhere in a cell. The
   * marker is inside the cell, so without this the editor would spring open
   * behind the SpeedGrader tab every single time. The click itself is left
   * completely alone - only the gesture Canvas listens for is stopped - so the
   * anchor navigates exactly as a link should, modifier keys included. */
  P.bindSubmissionClicks = function () {
    document.addEventListener('mousedown', function (e) {
      var link = e.target && e.target.closest ? e.target.closest('.cgp-sub') : null;
      if (!link) return;
      e.stopPropagation();
      CGP.diag.bump('paint.submissionOpened');
    }, true);
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
    this.bindSubmissionClicks();
  };

  CGP.IndicatorController = IndicatorController;
})();
