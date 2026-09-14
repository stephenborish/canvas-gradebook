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

    // Never on an anonymous/moderated assignment: writer.js refuses to POST
    // to one (the identity mapping it depends on is deliberately hidden
    // there), and postAssignmentGrades can legitimately refuse a moderated
    // column too (moderation not finished) - a refusal that must surface as
    // an error, not silently widen into the older "unmute the whole column"
    // fallback (see post()). A button that cannot be safely pressed should
    // not be offered in the first place.
    var assignmentMeta = this.model.assignment(id);
    if (assignmentMeta && (assignmentMeta.anonymous || assignmentMeta.moderated)) {
      if (existing) existing.remove();
      headerEl.classList.remove('cgp-has-post');
      return;
    }

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

  /* Re-read the column until Canvas's own view of it catches up.
   *
   * Posting is a background job. Canvas's Progress record flips to
   * "completed" when the job finishes, but the submissions endpoint can
   * still answer from a moment earlier - so the very first re-read after a
   * successful post can legitimately come back with every posted_at still
   * null. That is what produced the "0 of N grades posted" report on a post
   * that had in fact worked: the count was measured against a read that had
   * not caught up, and a page refresh a few seconds later showed the grades
   * posted exactly as they should be.
   *
   * So a re-read showing NOTHING changed is not taken at face value while
   * there are attempts left; it is retried on a short backoff. A read
   * showing partial progress is real (that is what gradedOnly leaves
   * behind) and is returned straight away.
   *
   * Returns { left, known }. known is false when the re-read itself did not
   * land - reloadAssignment resolves either way (see model.js), and
   * pendingPosts answers 0 for a column it no longer considers loaded, so a
   * failed read is otherwise indistinguishable from "nothing left to post".
   * The caller must not read a 0 as success without it. */
  P.settleAfterPost = function (assignmentId, expected) {
    var self = this;
    var id = String(assignmentId);
    var DELAYS = [0, 700, 1500];
    function attempt(n) {
      return self.model.reloadAssignment(id).then(function () {
        if (!self.model.loadedAssignments.has(id)) return { left: expected, known: false };
        var left = self.model.pendingPosts(id).length;
        if (left < expected || n + 1 >= DELAYS.length) return { left: left, known: true };
        CGP.diag.bump('post.reReadLagged');
        return CGP.util.sleep(DELAYS[n + 1]).then(function () { return attempt(n + 1); });
      });
    }
    return attempt(0);
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
    if (assignment && (assignment.anonymous || assignment.moderated)) {
      CGP.ui.error('Post it through Canvas’s own moderation/anonymous-grading workflow instead.');
      return Promise.resolve(null);
    }

    this.busy.add(id);
    this.setBusy(btn, true, 'Checking…');
    CGP.diag.bump('post.started');

    // Re-read the column right before posting rather than trusting the count
    // this button was last painted with: nothing here polls Canvas, so that
    // count can be stale by however long the page has been open (a co-
    // teacher or TA grading in another tab/SpeedGrader session is not an
    // edge case). gradedOnly:true posts whatever Canvas's server currently
    // has graded-and-hidden regardless of what we last saw, so the
    // confirmation afterwards has to be based on this same fresh read, not
    // a page-load-time snapshot - otherwise "Post 3" can silently post far
    // more than 3, and the toast would undercount how many were disclosed.
    return this.model.reloadAssignment(id).then(function () {
      // reloadAssignment()/ensureAssignments() swallow a failed fetch and
      // resolve anyway (see model.js) rather than rejecting - and
      // reloadAssignment already removed this id from loadedAssignments
      // before that fetch even started. So a genuinely failed reload does
      // NOT reach the rejection handler below; it lands right here, and
      // pendingPosts() (which refuses to answer for a column not marked
      // loaded) would silently report 0 pending - indistinguishable from
      // "nothing to post" when the truth is "couldn't check." Both must be
      // told apart before trusting a 0.
      if (!self.model.loadedAssignments.has(id)) {
        self.busy.delete(id);
        self.setBusy(btn, false);
        self.requestPaint();
        CGP.ui.error('Couldn’t confirm this column’s current state. Nothing was changed — try again.');
        return null;
      }
      var pendingIds = self.model.pendingPosts(id);
      var count = pendingIds.length;
      if (!count) {
        self.busy.delete(id);
        self.setBusy(btn, false);
        self.requestPaint();
        return null;
      }
      self.setBusy(btn, true, 'Posting…');
      // Set by the success path below and read after the re-read: whether
      // Canvas itself confirmed the posting finished, as opposed to us
      // merely having stopped waiting for its job. What the column looks
      // like afterwards is only trustworthy evidence when it disagrees with
      // this; see the reporting block.
      var confirmed = false;
      return self.api.postAssignmentGrades(id, { gradedOnly: true })
        .then(function (progress) {
          // No progress id means Canvas did the work synchronously; otherwise
          // the posting happens in a background job and the new posted_at
          // timestamps do not exist until it finishes. A job that reports
          // FAILED throws from here and is reported to the teacher.
          if (!progress || !progress._id) { confirmed = true; return null; }
          return self.api.waitForProgress(progress._id).then(function (result) {
            confirmed = !!(result && result.done);
            return result;
          });
        }, function (err) {
          // Fall back to the older, broader "unmute the whole column" REST
          // endpoint ONLY on a signal that specifically means the mutation
          // itself is unavailable on this Canvas build - a network failure,
          // or an HTTP 404/501 (the endpoint/route genuinely not there).
          // Nothing weaker than that: err.graphql===true is set for EVERY
          // top-level GraphQL error alike, including an authorization or
          // resolver-level refusal, not just an unrecognized mutation - and
          // a 400/403/422 can just as easily mean "understood, refused" as
          // "not implemented". Only a message that itself looks like a
          // schema mismatch (the shape an unrecognized mutation/field
          // actually produces) counts as evidence from that path. Anything
          // else - moderation not finished, nothing left to post, a
          // plain permissions error - must surface as a real error instead:
          // falling back for THAT would silently post grades Canvas just
          // said should stay hidden, through an endpoint with no moderation
          // awareness at all.
          var schemaMismatch = err && err.graphql === true &&
            /cannot query field|unknown (field|argument|operation)|doesn.?t exist on type/i.test(String(err.message || ''));
          var mutationUnavailable = !!(err && (err.network === true || err.status === 404 || err.status === 501 || schemaMismatch));
          if (!mutationUnavailable) throw err;
          return self.postWithoutGraphql(id, err).then(function (r) { confirmed = true; return r; });
        })
        .then(function () {
          return self.settleAfterPost(id, count);
        })
        .then(function (settled) {
          var left = settled.left;
          var name = (assignment && assignment.name) || 'this column';
          if (settled.known && !left) {
            CGP.ui.toast(count + (count === 1 ? ' grade' : ' grades') + ' posted to students');
            CGP.diag.bump('post.completed', count);
            return;
          }
          if (settled.known && left < count) {
            // Canvas posted some but not all - most often ungraded submissions,
            // which "post graded only" deliberately leaves hidden.
            CGP.ui.toast((count - left) + ' of ' + count + ' grades posted in ' + name);
            CGP.diag.bump('post.completed', count - left);
            return;
          }
          // Nothing in the column looks different, even after re-reading it
          // several times. Which of the two things that means depends on
          // whether Canvas said the job had finished - and the old code did
          // not ask: it reported "0 of N grades posted" either way, which on
          // a post that had actually succeeded told the teacher their post
          // had failed when a refresh moments later showed it had not.
          if (confirmed) {
            // Canvas reported the posting job complete, so the grades ARE
            // posted; its submissions endpoint just has not caught up. Say
            // what happened, and mark the cells posted locally so the button
            // clears instead of inviting a pointless second post. The next
            // ordinary re-read of the column replaces this with Canvas's own
            // timestamps.
            self.markPostedLocally(id, pendingIds);
            CGP.ui.toast(count + (count === 1 ? ' grade' : ' grades') + ' posted to students');
            CGP.diag.bump('post.completedUnconfirmedRead', count);
          } else {
            // We stopped waiting before Canvas finished. Nothing here says it
            // failed - only that it is still running - so say exactly that.
            CGP.ui.toast('Canvas is still posting ' + name + '. Refresh in a moment to see it.');
            CGP.diag.bump('post.stillRunning', count);
          }
        }, function (err) {
          CGP.diag.error('post.failed', { assignmentId: id, status: err && err.status, message: String(err && err.message) });
          CGP.ui.error('Canvas would not post these grades' +
            (err && err.status ? ' (Canvas ' + err.status + ')' : (err && err.message ? ': ' + err.message : '')) +
            '. Nothing was changed — you can still post from the column’s own menu.');
        });
    }, function () {
      // The re-read itself failed: refuse rather than posting against a
      // count we can no longer vouch for.
      CGP.ui.error('Couldn’t confirm this column’s current state. Nothing was changed — try again.');
    })
      .then(function () {
        self.busy.delete(id);
        self.setBusy(btn, false);
        self.requestPaint();
      });
  };

  /* Stamp posted_at on the cells Canvas has just told us it posted.
   *
   * Only ever called after Canvas has affirmatively reported the posting job
   * complete, and only for the exact submissions that were counted as
   * pending immediately before the post - never as a guess. It exists so the
   * grid stops claiming those grades are hidden during the window where
   * Canvas's own submissions endpoint has not caught up yet; the next real
   * read of the column overwrites it with Canvas's timestamps either way. */
  P.markPostedLocally = function (assignmentId, userIds) {
    var self = this;
    var when = new Date().toISOString();
    (userIds || []).forEach(function (uid) {
      // Read straight out of the cell map rather than through model.cell(),
      // which answers null for a column not currently marked loaded - which
      // is exactly the case when the re-read after the post failed.
      var rec = self.model.cells.get(self.model.key(assignmentId, uid));
      if (!rec || rec.postedAt) return;
      self.model.patchCell(assignmentId, uid, { postedAt: when, postedAtKnown: true }, { silent: true });
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
