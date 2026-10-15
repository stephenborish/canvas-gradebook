/* Canvas Gradebook+ - add one comment to every selected cell at once.
 *
 * Cmd/Ctrl-click and Shift-click already build a multi-cell selection (see
 * selection.js); pressing C while one or more cells are selected opens this
 * small dialog instead of reaching for the same reply box one submission at a
 * time. One comment, one Save, written through the same Submissions API path
 * (writer.addComment) as every other comment this extension posts - so it
 * shows up for each student exactly as if it had been typed into their own
 * thread individually.
 *
 * Deliberately not a summary/merge of anything: every target gets the exact
 * same text, verbatim, as its own new comment. Failures for individual cells
 * (a submission Canvas rejects, a network blip) are reported by count rather
 * than silently dropped, and never roll back the ones that did save; the
 * dialog then stays open aimed at only the cells that failed, so a retry
 * never posts the comment twice to a cell that already has it. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.BulkCommentController) return;

  /* Canvas/network failures get the shared wording; anything else is a
   * refusal from this extension itself, whose own message is the reason. */
  function failureReason(err) {
    if (err && (err.status || err.network)) {
      return CGP.util.describeApiError(err, { fallback: 'Canvas rejected that comment' });
    }
    return (err && err.message) ? err.message : '';
  }

  function BulkCommentController(ctx) {
    this.model = ctx.model;
    this.writer = ctx.writer;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint;
    this.el = null;
    this.targets = [];
    this._bound = false;
    this.busy = false;
  }

  var P = BulkCommentController.prototype;

  P.ensureEl = function () {
    if (this.el && this.el.isConnected) return this.el;
    var el = document.createElement('div');
    el.className = 'cgp-pop cgp-bulk-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Add a comment to the selected cells');
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
      if (!self.isOpen()) return;
      if (self.el.contains(e.target)) return;
      self.close();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (!self.isOpen()) return;
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
    }, true);
  };

  P.isOpen = function () { return !!(this.el && this.el.classList.contains('cgp-pop--on')); };

  /* Refused while a batch is saving: the batch still owns this dialog (its
   * targets, its text, its Save button), and closing it mid-flight used to
   * leave the next open() fighting a stale batch that later closed or
   * cleared the NEW dialog. The Save button already reads "Saving..." for
   * exactly that stretch, so the dialog just stays put until it finishes. */
  P.close = function () {
    if (this.busy) {
      CGP.diag.bump('bulkComment.closeWhileSaving');
      return false;
    }
    if (this.el) this.el.classList.remove('cgp-pop--on');
    this.targets = [];
    return true;
  };

  /** targets: [{assignmentId, userId}], from selection.targets(). */
  P.open = function (targets) {
    if (this.busy) {
      CGP.ui.toast('Still saving the last comment…');
      return;
    }
    targets = (targets || []).filter(function (t) { return t && t.assignmentId && t.userId; });
    if (!targets.length) {
      CGP.ui.error('Select one or more grade cells first (Cmd/Ctrl-click or Shift-click), then press C.');
      return;
    }
    this.targets = targets;
    var el = this.ensureEl();
    var n = targets.length;
    el.innerHTML =
      '<div class="cgp-pop__head">' +
      '<span class="cgp-pop__who">Comment on ' + n + (n === 1 ? ' cell' : ' cells') + '</span>' +
      '<span class="cgp-pop__what">Posted as your own comment on each of the selected submissions.</span>' +
      '<button type="button" class="cgp-pop__close" title="Close (Esc)" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="cgp-pop__reply">' +
      '<textarea class="cgp-pop__input" rows="3" placeholder="Comment… (/snippet + Tab, Ctrl+Enter to save)"></textarea>' +
      '<div class="cgp-pop__actions cgp-pop__actions--end">' +
      '<button type="button" class="cgp-pop__save">Add to ' + n + (n === 1 ? ' cell' : ' cells') + '</button>' +
      '</div></div>';
    el.classList.add('cgp-pop--on');
    this.position();
    this.wire();
    CGP.diag.bump('bulkComment.opened', n);
  };

  /* Centered rather than anchored to any one cell - a multi-cell selection
   * can span the whole grid, so there is no single obviously-correct anchor
   * point the way there is for the single-cell comment popover. */
  P.position = function () {
    var el = this.el;
    var winW = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024;
    var winH = typeof window !== 'undefined' ? (window.innerHeight || 768) : 768;
    var width = Math.min(340, winW - 24);
    el.style.width = width + 'px';
    el.style.left = Math.round((winW - width) / 2) + 'px';
    el.style.top = Math.round(Math.max(12, winH * 0.2)) + 'px';
  };

  P.wire = function () {
    var self = this;
    var closeBtn = this.el.querySelector('.cgp-pop__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.close();
      });
    }
    var input = this.el.querySelector('.cgp-pop__input');
    var save = this.el.querySelector('.cgp-pop__save');
    if (!input || !save) return;

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Tab' && !e.shiftKey) {
        // Only an actual expansion keeps Tab: "/word" with no matching
        // snippet (a URL, "and/or") must still move focus as usual.
        var snippets = (self.settings && self.settings.values && self.settings.values.snippets) || [];
        var out = CGP.snippets && CGP.snippets.expand(input.value, input.selectionStart, snippets);
        if (out) {
          e.preventDefault();
          input.value = out.text;
          input.setSelectionRange(out.caret, out.caret);
          return;
        }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!e.repeat) submit();
      }
    }, false);
    save.addEventListener('click', submit);

    function cellsLabel(n) { return n + (n === 1 ? ' cell' : ' cells'); }

    function submit() {
      // Focus stays in the textarea while saving, so Ctrl/Cmd+Enter pressed
      // again (a double press, or a held-down key) would otherwise call
      // submit() a second time and post the same comment twice to every
      // selected cell - disabling only the Save button doesn't stop that,
      // since this keyboard path never goes through it.
      if (self.busy) return;
      var text = String(input.value || '').trim();
      if (!text) return;
      var targets = self.targets.slice();
      var threshold = self.settings.values.bulkConfirmThreshold;
      if (targets.length > threshold) {
        if (!window.confirm('Add this comment to ' + targets.length + ' cells?')) return;
      }

      self.busy = true;
      input.readOnly = true;
      save.disabled = true;
      save.textContent = 'Saving…';
      var gate = CGP.util.pool(3);
      var ok = 0;
      var failedTargets = [];
      var firstErr = null;
      // Once Canvas says the session is gone, every remaining write would
      // fail the same way - stop sending rather than burn through them.
      var sessionGone = false;
      Promise.all(targets.map(function (t) {
        return gate(function () {
          if (sessionGone) { failedTargets.push(t); return null; }
          return self.writer.addComment(t.assignmentId, t.userId, text).then(function () {
            ok++;
          }, function (err) {
            failedTargets.push(t);
            if (!firstErr) firstErr = err;
            if (CGP.util.isSessionExpiredError(err)) { sessionGone = true; firstErr = err; }
            CGP.diag.error('bulkComment.cellFailed', {
              assignmentId: t.assignmentId, status: err && err.status
            });
          });
        });
      })).then(function () {
        var failed = failedTargets.length;
        CGP.diag.bump('bulkComment.ok', ok);
        CGP.diag.bump('bulkComment.failed', failed);
        self.busy = false;
        input.readOnly = false;
        if (self.requestPaint) self.requestPaint();
        if (!failed) {
          CGP.ui.toast('Comment added to ' + cellsLabel(ok));
          self.close();
          return;
        }
        // Partial (or total) failure: the dialog stays open with the text,
        // now aimed ONLY at the cells that did not get the comment, so
        // pressing Save again can never duplicate it on the ones that did.
        self.targets = failedTargets.slice();
        save.disabled = false;
        save.textContent = 'Retry ' + failed + ' failed';
        var who = self.el && self.el.querySelector('.cgp-pop__who');
        if (who) who.textContent = 'Comment on ' + cellsLabel(failed) + ' (not yet saved)';
        CGP.ui.error(failed + ' of ' + targets.length + ' comments could not be saved' +
          (ok ? ' (' + ok + ' saved). ' : '. ') + failureReason(firstErr));
      }, function (err) {
        // Every per-target write above already catches its own failure, so
        // this should not fire - but if it ever does, the dialog must not be
        // left permanently unusable because busy never got reset.
        self.busy = false;
        input.readOnly = false;
        save.disabled = false;
        save.textContent = 'Add to ' + cellsLabel(targets.length);
        CGP.diag.error('bulkComment.rejected', { message: String(err && err.message) });
        CGP.ui.error('Something went wrong saving that comment. Nothing more was changed.');
      });
    }
    setTimeout(function () { input.focus(); }, 0);
  };

  CGP.BulkCommentController = BulkCommentController;
})();
