/* Canvas Gradebook+ - "Post" button on the columns holding hidden grades.
 *
 * With a manual posting policy (and after hiding grades by hand) Canvas keeps
 * a grade to itself: the teacher sees the score in the grid while the student
 * still sees nothing. Canvas surfaces that only as a small crossed-out-eye in
 * the column header and a "Post grades" item buried in that column's "..."
 * menu, three clicks and a tray away.
 *
 * So: any assignment column that currently holds grades the students cannot
 * see grows a Post button in its header, labelled with how many are waiting.
 * Pressing it posts that whole column immediately - the same action Canvas's
 * own tray performs, through Canvas's own postAssignmentGrades mutation - and
 * the column is re-read afterwards so the button disappears by itself once
 * nothing is hidden any more.
 *
 * Three things this deliberately does NOT do:
 *   - it never appears on a column with nothing to post, so the button is
 *     always a statement of fact about that column, not decoration
 *   - it posts graded submissions only, exactly like Canvas's own default, so
 *     students who have not been graded yet are not handed an empty grade
 *   - it never guesses. A column whose submissions have not loaded, or whose
 *     Canvas build does not tell us whether grades are posted, shows nothing. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.PostGradesController) return;

  function PostGradesController(ctx) {
    this.model = ctx.model;
    this.adapter = ctx.adapter;
    this.api = ctx.api;
    this.settings = ctx.settings;
    this.requestPaint = ctx.requestPaint || function () {};
    this.busy = new Set();          // assignmentIds with a post in flight
  }

  var P = PostGradesController.prototype;

  /* ------------------------------------------------------------- rendering */

  P.buttonFor = function (headerEl) {
    var btn = headerEl.querySelector(':scope > .cgp-post');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cgp-post';
    // Canvas's header reacts to mousedown (sorting, its own menu). The button
    // is inside that header, so the gesture has to stop here or clicking Post
    // would also re-sort the grid underneath it.
    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    headerEl.appendChild(btn);
    return btn;
  };

  P.label = function (count, assignment) {
    var hidden = CGP.postOps.summary(count);
    var why = assignment && assignment.postManually
      ? 'This assignment posts grades manually. '
      : '';
    return {
      text: 'Post ' + count,
      title: why + hidden + '. Post them to the students now.'
    };
  };

  /** One header column: show, update or remove its Post button. */
  P.paintColumn = function (entry) {
    if (!entry || entry.type !== 'assignment' || !entry.assignmentId) return;
    var headerEl = entry.el;
    if (!headerEl || !headerEl.isConnected) return;
    var id = String(entry.assignmentId);
    var existing = headerEl.querySelector(':scope > .cgp-post');

    if (!this.settings.values.postGradesButton) {
      if (existing) existing.remove();
      headerEl.classList.remove('cgp-has-post');
      return;
    }
    if (this.busy.has(id)) return;   // mid-post: the button is saying so already

    var count = this.model.pendingPosts(id).length;
    if (!count) {
      if (existing) existing.remove();
      headerEl.classList.remove('cgp-has-post');
      return;
    }
    // The button occupies a strip along the bottom of the header, and the
    // title/points/due label above it gives that strip up rather than being
    // drawn underneath it.
    headerEl.classList.add('cgp-has-post');
    var btn = existing || this.buttonFor(headerEl);
    if (!btn.dataset.cgpAssignment) {
      var self = this;
      btn.dataset.cgpAssignment = id;
      btn.addEventListener('click', function () { self.post(id, btn); });
    }
    var copy = this.label(count, this.model.assignment(id));
    if (btn.textContent !== copy.text) btn.textContent = copy.text;
    if (btn.getAttribute('title') !== copy.title) {
      btn.setAttribute('title', copy.title);
      btn.setAttribute('aria-label', copy.title);
    }
  };

  P.paint = function () {
    if (!this.model.ready) return;
    var self = this;
    // The column map was refreshed by the header pass earlier in this same
    // paint, so this walks what is already known rather than re-reading the DOM.
    this.adapter.colIndexToColumn.forEach(function (entry) { self.paintColumn(entry); });
  };

  /* -------------------------------------------------------------- the write */

  P.setBusy = function (btn, busy, text) {
    if (!btn || !btn.isConnected) return;
    btn.disabled = !!busy;
    btn.classList.toggle('cgp-post--busy', !!busy);
    if (text) btn.textContent = text;
  };

  /* Post one column.
   *
   * Canvas does the posting as a background job, so the new posted_at
   * timestamps do not exist yet when the mutation returns - the column is
   * re-read only once that job reports done. If the job outlives our patience
   * the column is still re-read: a job we stopped watching is not a job that
   * failed, and whatever Canvas has by then is the truth we should show. */
  P.post = function (assignmentId, btn) {
    var self = this;
    var id = String(assignmentId);
    if (this.busy.has(id)) return Promise.resolve(null);
    var assignment = this.model.assignment(id);
    var count = this.model.pendingPosts(id).length;
    if (!count) { this.requestPaint(); return Promise.resolve(null); }

    this.busy.add(id);
    this.setBusy(btn, true, 'Posting…');
    CGP.diag.bump('post.started');

    return this.api.postAssignmentGrades(id, { gradedOnly: true })
      .then(function (progress) {
        // No progress id means Canvas did the work synchronously; otherwise
        // the posting happens in a background job and the new posted_at
        // timestamps do not exist until it finishes. A job that reports
        // FAILED throws from here and is reported to the teacher.
        if (!progress || !progress._id) return null;
        return self.api.waitForProgress(progress._id);
      }, function (err) {
        return self.postWithoutGraphql(id, err);
      })
      .then(function () {
        return self.model.reloadAssignment(id);
      })
      .then(function () {
        var left = self.model.pendingPosts(id).length;
        var name = (assignment && assignment.name) || 'this column';
        if (left) {
          // Canvas posted some but not all - most often ungraded submissions,
          // which "post graded only" deliberately leaves hidden.
          CGP.ui.toast((count - left) + ' of ' + count + ' grades posted in ' + name);
        } else {
          CGP.ui.toast(count + (count === 1 ? ' grade' : ' grades') + ' posted to students');
        }
        CGP.diag.bump('post.completed', count - left);
      }, function (err) {
        CGP.diag.error('post.failed', { assignmentId: id, status: err && err.status, message: String(err && err.message) });
        CGP.ui.error('Canvas would not post these grades' +
          (err && err.status ? ' (Canvas ' + err.status + ')' : '') +
          '. Nothing was changed — you can still post from the column’s own menu.');
      })
      .then(function () {
        self.busy.delete(id);
        self.setBusy(btn, false);
        self.requestPaint();
      });
  };

  /* Fallback for Canvas builds without the postAssignmentGrades mutation.
   *
   * Before posting policies, "post the grades" was spelled "unmute the
   * assignment", and that REST parameter still posts an assignment's grades on
   * Canvas builds that accept it. It is broader than the mutation above - it
   * posts the column rather than only its graded submissions - so it is used
   * only when the proper path is genuinely unavailable, and the teacher is
   * told which one ran. */
  P.postWithoutGraphql = function (assignmentId, originalError) {
    CGP.diag.warn('post.graphqlUnavailable', {
      assignmentId: String(assignmentId),
      status: originalError && originalError.status,
      message: String(originalError && originalError.message)
    });
    return this.api.request('/api/v1/courses/' + this.model.courseId + '/assignments/' + assignmentId, {
      method: 'PUT',
      form: { 'assignment[muted]': 'false' },
      retries: 1
    }).then(function () {
      CGP.diag.bump('post.viaUnmute');
      CGP.ui.toast('Posted using Canvas’s older posting endpoint');
      return null;
    }, function () {
      throw originalError;   // report what actually went wrong first
    });
  };

  CGP.PostGradesController = PostGradesController;
})();
