/* Canvas Gradebook+ - comment quick preview.
 *
 * Clicking the in-cell bubble opens a small popover anchored to that cell: the
 * existing thread, instructor comments distinguished from student replies, and
 * a reply box that writes through the Canvas API. No modal, no side panel, no
 * navigation away from the gradebook. It closes on Escape, on an outside click
 * and when the grid scrolls, so it never becomes persistent furniture.
 *
 * Hovering the bubble (without clicking) shows a smaller preview of the most
 * recent comment instead - a fast "what did I say here" glance that never
 * steals focus and never needs a click just to check. That preview is itself a
 * target: the pointer can travel from the bubble into it (it survives a short
 * grace period rather than vanishing the instant the bubble is left), and
 * clicking it opens Canvas's own Grade Detail Tray - the side pane - for that
 * submission, which is where the full thread, the status controls and the
 * rubric live. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CommentPopoverController) return;

  function CommentPopoverController(ctx) {
    this.model = ctx.model;
    this.adapter = ctx.adapter;
    this.writer = ctx.writer;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint;
    // How the preview opens Canvas's side pane. Injected rather than
    // reimplemented: cell-actions.js already knows how to find and press
    // Canvas's own control for one cell, including waiting for it to render
    // and refusing to act on a cell the grid recycled underneath it.
    this.openSidePane = ctx.openSidePane || null;
    this.el = null;
    this.current = null;
    this._bound = false;
    this._previewInfo = null;
    this._previewHideTimer = null;
  }

  var P = CommentPopoverController.prototype;

  P.ensureEl = function () {
    if (this.el && this.el.isConnected) return this.el;
    var el = document.createElement('div');
    el.className = 'cgp-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Submission comments');
    document.body.appendChild(el);
    this.el = el;
    this.bindGlobal();
    return el;
  };

  P.bindGlobal = function () {
    if (this._bound) return;
    this._bound = true;
    var self = this;
    document.addEventListener('mousedown', function (e) {
      if (!self.current) return;
      if (self.el && self.el.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.cgp-cmt')) return;
      self.close();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (!self.current) return;
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
    }, true);
    this.adapter.viewports().forEach(function (vp) {
      vp.addEventListener('scroll', function () { if (self.current) self.close(); self.hidePreview(); }, { passive: true });
    });
    window.addEventListener('resize', function () { if (self.current) self.close(); self.hidePreview(); });
  };

  P.close = function () {
    this.current = null;
    if (this.el) this.el.classList.remove('cgp-pop--on');
  };

  P.open = function (info) {
    if (!this.settings.values.commentPopover) return;
    var rec = this.model.cell(info.assignmentId, info.studentId);
    if (!rec) return;
    this.hidePreview();
    this.current = { assignmentId: info.assignmentId, userId: info.studentId };
    var el = this.ensureEl();
    el.innerHTML = this.render(rec, info);
    el.classList.add('cgp-pop--on');
    this.position(info.el);
    this.wire(rec, info);
    CGP.diag.bump('popover.opened');
  };

  P.render = function (rec, info) {
    var self = this;
    var student = this.model.student(info.studentId);
    var assignment = this.model.assignment(info.assignmentId);
    var list = (rec.commentList || []).slice().sort(function (a, b) {
      return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
    });

    var head = '<div class="cgp-pop__head">' +
      '<span class="cgp-pop__who">' + CGP.util.escapeHtml((student && student.name) || 'Student') + '</span>' +
      '<span class="cgp-pop__what">' + CGP.util.escapeHtml((assignment && assignment.name) || '') + '</span>' +
      '</div>';

    var body;
    if (!list.length) {
      body = '<div class="cgp-pop__empty">No comments on this submission yet.</div>';
    } else {
      body = '<ul class="cgp-pop__list">' + list.map(function (c) {
        var authorId = CGP.commentAnalysis.authorId(c);
        var mine = authorId === String(self.model.instructorId);
        var name = mine ? 'You' : ((c.author_name || (c.author && c.author.display_name)) || 'Student');
        return '<li class="cgp-pop__item' + (mine ? ' cgp-pop__item--mine' : '') + '">' +
          '<div class="cgp-pop__meta"><span class="cgp-pop__author">' + CGP.util.escapeHtml(name) + '</span>' +
          '<span class="cgp-pop__date">' + CGP.util.escapeHtml(CGP.util.fmtDateTime(c.created_at)) + '</span></div>' +
          '<div class="cgp-pop__text">' + CGP.util.escapeHtml(c.comment || '') + '</div></li>';
      }).join('') + '</ul>';
    }

    var reply = '<div class="cgp-pop__reply">' +
      '<textarea class="cgp-pop__input" rows="2" placeholder="Reply\u2026 (/snippet + Tab, Ctrl+Enter to save)"></textarea>' +
      '<div class="cgp-pop__actions">' +
      '<a class="cgp-pop__link" href="/courses/' + encodeURIComponent(this.model.courseId) +
      '/gradebook/speed_grader?assignment_id=' + encodeURIComponent(info.assignmentId) +
      '#%7B%22student_id%22%3A%22' + encodeURIComponent(info.studentId) + '%22%7D" target="_blank" rel="noopener">SpeedGrader</a>' +
      '<button type="button" class="cgp-pop__save">Save comment</button>' +
      '</div></div>';

    return head + body + reply;
  };

  P.wire = function (rec, info) {
    var self = this;
    var input = this.el.querySelector('.cgp-pop__input');
    var save = this.el.querySelector('.cgp-pop__save');
    if (!input || !save) return;

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Tab' && !e.shiftKey) {
        var out = CGP.snippets.expand(input.value, input.selectionStart, self.settings.values.snippets);
        if (out) {
          e.preventDefault();
          input.value = out.text;
          input.setSelectionRange(out.caret, out.caret);
          return;
        }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    }, false);
    save.addEventListener('click', submit);

    function submit() {
      var text = String(input.value || '').trim();
      if (!text) return;
      save.disabled = true;
      save.textContent = 'Saving\u2026';
      self.writer.addComment(info.assignmentId, info.studentId, text).then(function () {
        input.value = '';
        var fresh = self.model.cell(info.assignmentId, info.studentId);
        self.el.innerHTML = self.render(fresh, info);
        self.wire(fresh, info);
        if (self.requestPaint) self.requestPaint();
      }, function (err) {
        save.disabled = false;
        save.textContent = 'Save comment';
        // addComment can now refuse before ever reaching Canvas (an
        // anonymous/moderated assignment) as well as have Canvas itself
        // reject it - err.message carries the real reason either way, so
        // show it instead of always blaming Canvas for a refusal that may
        // have been this extension's own.
        var reason = (err && err.message) ? err.message
          : ('Canvas rejected that comment' + (err && err.status ? ' (' + err.status + ')' : '') + '.');
        CGP.ui.error(reason + ' Your text is still here.');
      });
    }
    setTimeout(function () { input.focus(); }, 0);
  };

  P.position = function (cellEl) {
    var el = this.el;
    var rect = cellEl.getBoundingClientRect();
    var width = 290;
    el.style.width = width + 'px';
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 12);
    var below = rect.bottom + 6;
    var estimated = Math.min(el.scrollHeight || 240, 340);
    var top = (below + estimated > window.innerHeight - 8) ? Math.max(8, rect.top - estimated - 6) : below;
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  };

  /* ------------------------------------------------------- hover preview */

  P.ensurePreviewEl = function () {
    if (this.previewEl && this.previewEl.isConnected) return this.previewEl;
    var self = this;
    var el = document.createElement('div');
    el.className = 'cgp-preview';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Latest submission comment');
    // The pointer is allowed to leave the bubble and land here: while it is
    // over the preview, the pending hide is cancelled, so the preview can be
    // read at leisure and clicked. Leaving it closes it for real.
    el.addEventListener('mouseenter', function () { self.cancelPreviewHide(); });
    el.addEventListener('mouseleave', function () { self.hidePreview(); });
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.openPaneFromPreview();
    });
    document.body.appendChild(el);
    this.previewEl = el;
    return el;
  };

  /* Open Canvas's Grade Detail Tray for the submission the preview is showing.
   *
   * Canvas only renders the control that opens the tray inside the ACTIVE
   * cell, so the cell is activated first and the press is handed to
   * cell-actions, which polls for that control to appear and falls back to
   * SpeedGrader if this Canvas build has no such button. */
  P.openPaneFromPreview = function () {
    var info = this._previewInfo;
    this.hidePreview();
    if (!info || !info.el || !info.el.isConnected) return;
    if (!this.openSidePane) { this.open(info); return; }   // no tray available: the in-place thread instead
    this.adapter.activateCell(info.el);
    this.openSidePane(info);
    CGP.diag.bump('preview.sidePaneOpened');
  };

  P.cancelPreviewHide = function () {
    if (this._previewHideTimer) { clearTimeout(this._previewHideTimer); this._previewHideTimer = null; }
  };

  /* Leaving the bubble does not close the preview immediately: the pointer
   * needs a moment to cross the few pixels between the bubble and the preview
   * without the thing it is travelling towards disappearing on the way. */
  P.hidePreviewSoon = function () {
    var self = this;
    this.cancelPreviewHide();
    this._previewHideTimer = setTimeout(function () {
      self._previewHideTimer = null;
      if (self.previewEl && self.previewEl.matches(':hover')) return;
      self.hidePreview();
    }, 220);
  };

  P.showPreview = function (info) {
    this.cancelPreviewHide();
    if (!this.settings.values.commentIndicator) return;
    if (this.current) return; // the full thread is already open; do not layer a preview on it
    var rec = this.model.cell(info.assignmentId, info.studentId);
    var comments = rec && rec.comments;
    if (!rec || !comments || !comments.hasInstructorComment) return;
    var list = (rec.commentList || []).slice().sort(function (a, b) {
      return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
    });
    var last = list[list.length - 1];
    if (!last) return;

    var authorId = CGP.commentAnalysis.authorId(last);
    var mine = authorId === String(this.model.instructorId);
    var name = mine ? 'You' : ((last.author_name || (last.author && last.author.display_name)) || 'Student');
    var text = String(last.comment || '');
    var snippet = text.length > 180 ? text.slice(0, 177) + '…' : text;

    var el = this.ensurePreviewEl();
    el.innerHTML =
      '<div class="cgp-preview__meta">' +
      '<span class="cgp-preview__author">' + CGP.util.escapeHtml(name) + '</span>' +
      (comments.instructorCount > 1 ? '<span class="cgp-preview__count">' + comments.instructorCount + ' comments</span>' : '') +
      '</div>' +
      '<div class="cgp-preview__text">' + CGP.util.escapeHtml(snippet || '—') + '</div>' +
      '<div class="cgp-preview__hint">Click to open this submission in Canvas\u2019s side pane</div>';
    el.classList.add('cgp-preview--on');
    this._previewInfo = info;
    this.positionPreview(info.el);
  };

  P.hidePreview = function () {
    this.cancelPreviewHide();
    this._previewInfo = null;
    if (this.previewEl) this.previewEl.classList.remove('cgp-preview--on');
  };

  P.positionPreview = function (cellEl) {
    var el = this.previewEl;
    var rect = cellEl.getBoundingClientRect();
    var width = 240;
    el.style.width = width + 'px';
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 12);
    var estimated = Math.min(el.scrollHeight || 90, 200);
    var below = rect.bottom + 6;
    var top = (below + estimated > window.innerHeight - 8) ? Math.max(8, rect.top - estimated - 6) : below;
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  };

  CGP.CommentPopoverController = CommentPopoverController;
})();
