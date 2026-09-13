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
 * than silently dropped, and never roll back the ones that did save. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.BulkCommentController) return;

  function BulkCommentController(ctx) {
    this.model = ctx.model;
    this.writer = ctx.writer;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint;
    this.el = null;
    this.targets = [];
    this._bound = false;
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

  P.close = function () {
    if (this.el) this.el.classList.remove('cgp-pop--on');
    this.targets = [];
  };

  /** targets: [{assignmentId, userId}], from selection.targets(). */
  P.open = function (targets) {
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
    var width = Math.min(340, window.innerWidth - 24);
    el.style.width = width + 'px';
    el.style.left = Math.round((window.innerWidth - width) / 2) + 'px';
    el.style.top = Math.round(Math.max(12, window.innerHeight * 0.2)) + 'px';
  };

  P.wire = function () {
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
      var targets = self.targets.slice();
      var threshold = self.settings.values.bulkConfirmThreshold;
      if (targets.length > threshold) {
        if (!window.confirm('Add this comment to ' + targets.length + ' cells?')) return;
      }

      save.disabled = true;
      save.textContent = 'Saving…';
      var gate = CGP.util.pool(3);
      var ok = 0, failed = 0;
      Promise.all(targets.map(function (t) {
        return gate(function () {
          return self.writer.addComment(t.assignmentId, t.userId, text).then(function () {
            ok++;
          }, function (err) {
            failed++;
            CGP.diag.error('bulkComment.cellFailed', {
              assignmentId: t.assignmentId, status: err && err.status
            });
          });
        });
      })).then(function () {
        if (failed) {
          CGP.ui.error(failed + ' of ' + targets.length + ' comments could not be saved' +
            (ok ? ' (' + ok + ' saved).' : '.'));
        } else {
          CGP.ui.toast('Comment added to ' + ok + (ok === 1 ? ' cell' : ' cells'));
        }
        CGP.diag.bump('bulkComment.ok', ok);
        CGP.diag.bump('bulkComment.failed', failed);
        if (self.requestPaint) self.requestPaint();
        self.close();
      });
    }
    setTimeout(function () { input.focus(); }, 0);
  };

  CGP.BulkCommentController = BulkCommentController;
})();
