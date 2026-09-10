/* Canvas Gradebook+ - comment quick preview.
 *
 * Clicking the in-cell bubble opens a small popover anchored to that cell: the
 * existing thread, instructor comments distinguished from student replies, and
 * a reply box that writes through the Canvas API. No modal, no side panel, no
 * navigation away from the gradebook. It closes on Escape, on an outside click
 * and when the grid scrolls, so it never becomes persistent furniture. */
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
    this.el = null;
    this.current = null;
    this._bound = false;
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
      vp.addEventListener('scroll', function () { if (self.current) self.close(); }, { passive: true });
    });
    window.addEventListener('resize', function () { if (self.current) self.close(); });
  };

  P.close = function () {
    this.current = null;
    if (this.el) this.el.classList.remove('cgp-pop--on');
  };

  P.open = function (info) {
    if (!this.settings.values.commentPopover) return;
    var rec = this.model.cell(info.assignmentId, info.studentId);
    if (!rec) return;
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
        CGP.ui.error('Canvas rejected that comment' + (err && err.status ? ' (' + err.status + ')' : '') + '. Your text is still here.');
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

  CGP.CommentPopoverController = CommentPopoverController;
})();
