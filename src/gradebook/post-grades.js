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
 *   - it posts graded submissions and ones holding a hidden instructor comment,
 *     exactly like Canvas's own default, so students who have neither are not
 *     handed an empty grade
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
    // Other tabs of this course (live-sync.js): an open SpeedGrader shows
    // the grades as posted, another gradebook re-reads the column.
    this.liveSync = ctx.liveSync || null;
    this.busy = new Set();          // assignmentIds with a post in flight
    this._rechecking = new Set();   // assignmentIds with a delayed re-read pending
    // Columns Canvas confirmed posting but whose reads have not caught up:
    // the button stays hidden for them until the background recheck settles,
    // so it does not flicker back between re-reads.
    this._awaitingCatchUp = new Set();
    // The base delay recheckLater() backs off from. A constructor option
    // only so tests can shrink minutes of real backoff down to milliseconds;
    // production code never overrides it.
    this._recheckBaseDelayMs = ctx.recheckBaseDelayMs || 6000;
  }

  var P = PostGradesController.prototype;

  /* The Post button only ever posts graded submissions (and ones holding a
   * hidden comment from the teacher), never the whole column. */
  var GRADED_ONLY = true;

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
      title: why + hidden + '. Post them to the students now (every section; submissions with a grade or a comment from you).'
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
    if (this._awaitingCatchUp.has(id)) {
      if (existing) existing.remove();
      headerEl.classList.remove('cgp-has-post');
      return;
    }

    // Never on an anonymous/moderated assignment: writer.js refuses to POST
    // to one (the identity mapping it depends on is deliberately hidden
    // there), and postAssignmentGrades can legitimately refuse a moderated
    // column too (moderation not finished) - a refusal the teacher could
    // only act on in Canvas's own workflow. A button that cannot be safely
    // pressed should not be offered in the first place.
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
    if (text) {
      btn.textContent = text;
    } else if (!busy) {
      var id = btn.dataset && btn.dataset.cgpAssignment;
      if (id) {
        var count = this.model.pendingPosts(id).length;
        if (count > 0) {
          var copy = this.label(count, this.model.assignment(id));
          btn.textContent = copy.text;
          btn.setAttribute('title', copy.title);
          btn.setAttribute('aria-label', copy.title);
        }
      }
    }
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
      return self.model.reloadAssignment(id, { includeComments: false }).then(function () {
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
    return this.model.reloadAssignment(id, { includeComments: false }).then(function () {
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
      // Set when Canvas's answer could not tell us what happened (see
      // CGP.util.isUnconfirmedError, a Progress read that came back
      // unreadable, and a job Canvas reported failed). The
      // column is then re-read before anything is said, and nothing is
      // stamped posted on the strength of the mutation alone.
      var uncertain = null;
      return self.api.postAssignmentGrades(id, { gradedOnly: GRADED_ONLY })
        .then(function (progress) {
          // null is Canvas's mutation payload with no job: it did the work
          // synchronously (canvas-api.js only resolves null for a real
          // payload). Otherwise the posting happens in a background job and
          // the new posted_at timestamps do not exist until it finishes.
          if (!progress) { confirmed = true; return null; }
          return self.api.waitForProgress(progress._id).then(function (result) {
            confirmed = !!(result && result.done);
            if (result && result.unreadable) uncertain = { progressUnreadable: true };
            return result;
          }, function (jobErr) {
            // Canvas reported the job failed. It may have posted part of the
            // column before it did, so "nothing was changed" would be a
            // guess: the column is re-read like any other unclear outcome.
            CGP.diag.warn('post.jobFailed', { assignmentId: id, message: String(jobErr && jobErr.message) });
            uncertain = { jobFailed: true, err: jobErr };
            return null;
          });
        }, function (err) {
          // The mutation may have run, but its answer says nothing usable:
          // only a re-read of the column can say what happened.
          if (CGP.util.isUnconfirmedError(err)) {
            CGP.diag.warn('post.unconfirmedAnswer', {
              assignmentId: id, status: err.status, network: !!err.network, malformed: !!err.malformed
            });
            uncertain = { err: err };
            return null;
          }
          // Is the mutation itself unavailable on this Canvas build? Only an
          // HTTP 404/501 (the route genuinely not there) or a message that
          // looks like a schema mismatch counts. err.graphql===true alone does
          // not: it is set for every top-level GraphQL error, refusals
          // included, and a 400/403/422 can as easily mean "understood,
          // refused". Anything else - moderation not finished, nothing left
          // to post, a permissions error - is reported as Canvas's refusal.
          var schemaMismatch = err && err.graphql === true &&
            /cannot query field|unknown (field|argument|operation)|doesn.?t exist on type/i.test(String(err.message || ''));
          var mutationUnavailable = !!(err && (err.status === 404 || err.status === 501 || schemaMismatch));
          if (!mutationUnavailable) throw err;
          // Canvas's older "unmute" endpoint would post the WHOLE column,
          // ungraded submissions included. This button promises graded only,
          // so it is never used in its place: the teacher is told, and posts
          // from Canvas's own menu.
          CGP.diag.warn('post.gradedOnlyUnavailable', { assignmentId: id, status: err.status });
          throw Object.assign(new Error('graded-only posting unavailable'), { postingUnsupported: true, cause: err });
        })
        .then(function () {
          return self.settleAfterPost(id, count);
        })
        .then(function (settled) {
          var left = settled.left;
          var name = (assignment && assignment.name) || 'this column';
          if (settled.known && !left) {
            self.markPostedLocally(id, pendingIds);
            CGP.ui.toast(count + (count === 1 ? ' grade' : ' grades') + ' posted to students');
            CGP.diag.bump('post.completed', count);
            if (btn && btn.parentElement) {
              btn.parentElement.classList.add('cgp-posted');
              btn.parentElement.classList.remove('cgp-has-post');
            }
            if (btn && btn.isConnected) btn.remove();
            return;
          }
          if (settled.known && left < count) {
            // Canvas posted some but not all - most often ungraded submissions,
            // which "post graded only" deliberately leaves hidden.
            // The re-read that produced this count is the truth about the
            // column; nothing is stamped locally on top of it. (Stamping the
            // first N pending ids used to mark students whose grades were
            // STILL hidden as posted, and hide the button while they were.)
            var postedCount = count - left;
            var stillPending = self.model.pendingPosts(id);
            var nowPosted = pendingIds.filter(function (uid) { return stillPending.indexOf(uid) < 0; });
            self.model.markPostConfirmed(id, nowPosted);
            self.tellCanvasPosted(id, nowPosted);
            self.requestPaint();
            CGP.ui.toast(postedCount + ' of ' + count + ' grades posted in ' + name);
            CGP.diag.bump('post.completed', postedCount);
            var copy = self.label(left, self.model.assignment(id));
            if (btn && btn.isConnected) {
              btn.textContent = copy.text;
              btn.setAttribute('title', copy.title);
              btn.setAttribute('aria-label', copy.title);
            }
            return;
          }
          if (uncertain) {
            // Canvas's answer was unusable and the re-reads show nothing
            // posted (or could not be made). Not "posted", not "nothing was
            // posted": couldn't confirm, with a check that only reads.
            self.reportUnconfirmedPost(id, name, pendingIds, settled, uncertain);
            return;
          }
          // Nothing in the column looks different, even after re-reading it
          // several times. Which of the two things that means depends on
          // whether Canvas said the job had finished - and the old code did
          // not ask: it reported "0 of N grades posted" either way, which on
          // a post that had actually succeeded told the teacher their post
          // had failed when a refresh moments later showed it had not.
          if (confirmed && !settled.known) {
            // Canvas reported the posting job complete and then the re-read
            // failed outright. Record that against the cells we posted, so
            // the grid reflects the confirmed post immediately.
            self.markPostedLocally(id, pendingIds);
            self._awaitingCatchUp.add(id);
            CGP.ui.toast(count + (count === 1 ? ' grade' : ' grades') + ' posted to students');
            CGP.diag.bump('post.completedUnreadableColumn', count);
            if (btn && btn.parentElement) {
              btn.parentElement.classList.add('cgp-posted');
              btn.parentElement.classList.remove('cgp-has-post');
            }
            if (btn && btn.isConnected) btn.remove();
            self.recheckLater(id);
          } else if (confirmed) {
            // Canvas said the job finished, but its submissions endpoint read
            // lags its own job. Mark the grades posted locally immediately so
            // the teacher sees the post button disappear and the column update
            // right away without having to reload the page.
            self.markPostedLocally(id, pendingIds);
            self._awaitingCatchUp.add(id);
            CGP.ui.toast(count + (count === 1 ? ' grade' : ' grades') + ' posted to students');
            CGP.diag.bump('post.completedLaggingRead', count);
            if (btn && btn.parentElement) {
              btn.parentElement.classList.add('cgp-posted');
              btn.parentElement.classList.remove('cgp-has-post');
            }
            if (btn && btn.isConnected) btn.remove();
            self.recheckLater(id);
          } else {
            // We stopped waiting before Canvas finished.
            CGP.ui.toast('Canvas is still posting ' + name + ' in the background — the grid will update on its own.');
            CGP.diag.bump('post.stillRunning', count);
            if (btn && btn.parentElement) {
              btn.parentElement.classList.add('cgp-posted');
              btn.parentElement.classList.remove('cgp-has-post');
            }
            if (btn && btn.isConnected) btn.remove();
            self.recheckLater(id, 0, pendingIds);
          }
        }, function (err) {
          CGP.diag.error('post.failed', { assignmentId: id, status: err && err.status, message: String(err && err.message) });
          // Every error reaching here is a refusal Canvas made before acting
          // (an unusable answer was settled above by re-reading instead).
          if (err && err.postingUnsupported) {
            CGP.ui.error('This Canvas doesn\u2019t offer posting only graded submissions from here, so nothing was posted. ' +
              'Use Post grades in the column\u2019s own menu instead.');
          } else if (CGP.util.isSessionExpiredError(err) || CGP.util.isPermissionDeniedError(err)) {
            CGP.ui.error(CGP.util.describeApiError(err) + ' Nothing was posted.');
          } else {
            CGP.ui.error('Canvas would not post these grades' +
              (err && err.status ? ' (Canvas ' + err.status + ')' : (err && err.message ? ': ' + err.message : '')) +
              '. Nothing was changed — you can still post from the column’s own menu.');
          }
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

  /* After an unusable answer, when the column's re-read did not show the
   * grades posted. Says what is known - what Canvas shows now, if the read
   * landed - and offers Check again, which only reads. The background
   * recheck keeps reading too, so the grid corrects itself if the post did
   * go through. */
  P.reportUnconfirmedPost = function (id, name, pendingIds, settled, uncertain) {
    var self = this;
    var err = uncertain && uncertain.err;
    var hint = err && err.signIn ? ' Canvas answered with its sign-in page: your session may have expired.' : '';
    // Counted over the submissions this post was for, not the whole column:
    // grades hidden since the pre-post read are not part of this answer.
    var stillPending = settled && settled.known ? this.model.pendingPosts(id) : [];
    var hidden = pendingIds.filter(function (uid) { return stillPending.indexOf(uid) >= 0; }).length;
    var now = settled && settled.known
      ? ' Canvas still shows ' + hidden + ' of ' + pendingIds.length + ' hidden from students.'
      : ' The column couldn\u2019t be re-read to check.';
    var lead = uncertain && uncertain.jobFailed
      ? 'Canvas couldn\u2019t finish posting the grades in ' + name + (err && err.message && err.message !== 'Canvas could not finish posting these grades' ? ' (' + err.message + ')' : '') + '.'
      : 'Couldn\u2019t confirm whether the grades in ' + name + ' were posted.';
    CGP.diag.bump('post.unconfirmed', pendingIds.length);
    CGP.ui.error(lead + now + hint, {
      action: { label: 'Check again', run: function () { self.checkPostAgain(id, pendingIds, name); } }
    });
    this.recheckLater(id, 0, pendingIds);
  };

  /* "Check again" after an unconfirmed post: re-read the column, report.
   * Never posts. */
  P.checkPostAgain = function (assignmentId, pendingIds, name) {
    var self = this;
    var id = String(assignmentId);
    var again = { label: 'Check again', run: function () { self.checkPostAgain(id, pendingIds, name); } };
    return this.model.reloadAssignment(id, { includeComments: false }).then(function () {
      self.requestPaint();
      if (!self.model.loadedAssignments.has(id)) {
        CGP.ui.error('Couldn\u2019t confirm whether the grades in ' + name + ' were posted: the column couldn\u2019t be re-read.', { action: again });
        return { known: false };
      }
      var stillPending = self.model.pendingPosts(id);
      var posted = pendingIds.filter(function (uid) { return stillPending.indexOf(uid) < 0; });
      var hidden = pendingIds.length - posted.length;
      if (posted.length) {
        self.model.markPostConfirmed(id, posted);
        self.tellCanvasPosted(id, posted);
      }
      if (!hidden) {
        CGP.ui.toast(posted.length + (posted.length === 1 ? ' grade' : ' grades') + ' posted to students \u2014 confirmed with Canvas');
      } else {
        CGP.ui.error('Canvas shows ' + hidden + ' of ' + pendingIds.length + ' grades in ' + name +
          ' still hidden from students. Press Post again to post them.', { action: again });
      }
      return { known: true, posted: posted.length, hidden: hidden };
    });
  };

  /* One or more re-reads, later, for a column whose post Canvas confirmed (or
   * whose job we simply stopped waiting for) but whose submissions still read
   * as hidden.
   *
   * Detached on purpose: the teacher is not made to wait on it, and it is the
   * only thing that will correct the column short of a page reload - nothing
   * else re-reads a column already marked loaded. This used to try exactly
   * once, 6 seconds later, and if that single read still had not caught up
   * the teacher was left to notice and reload the page themselves - which is
   * exactly what "the grid will update on its own" a moment earlier promised
   * would not be necessary. It now keeps trying on a backoff (6s, ~10s,
   * ~15s, ~25s, 30s - about ninety seconds of total patience) until either
   * the column is confirmed caught up or that patience runs out, so a post
   * that simply takes Canvas longer than usual still self-corrects instead
   * of quietly needing a reload. Whichever way any one attempt lands is the
   * truth for that attempt, so it reports nothing itself and simply repaints;
   * running out of attempts is logged to diagnostics only; a teacher who is
   * still looking at the column can always press Post again. */
  P.recheckLater = function (assignmentId, attempt, userIds) {
    var self = this;
    var id = String(assignmentId);
    attempt = attempt || 0;
    var MAX_ATTEMPTS = 5;
    if (this._rechecking.has(id)) return;
    this._rechecking.add(id);
    var delay = Math.min(this._recheckBaseDelayMs * Math.pow(1.6, attempt), this._recheckBaseDelayMs * 5);
    setTimeout(function () {
      self.model.reloadAssignment(id, { includeComments: false }).then(function () {
        self._rechecking.delete(id);
        self.requestPaint();
        // reloadAssignment() swallows its own fetch failure (see
        // ensureAssignments) and resolves normally either way, leaving the
        // assignment out of loadedAssignments when the read actually failed.
        // pendingPosts() reads that as "column has nothing to post" and
        // answers [] regardless of the real reason, which used to read here
        // as "caught up" and silently end the retry chain on a fetch that
        // never actually landed. Treat "still not loaded" the same as "still
        // has pending posts" so a swallowed failure keeps retrying instead of
        // being mistaken for success.
        var loaded = self.model.loadedAssignments.has(id);
        var stillPending = loaded ? self.model.pendingPosts(id) : null;
        var left = loaded ? stillPending.length : -1;
        // Whichever of the submissions we tried to post this read shows as
        // posted now: Canvas's own grid still thinks they are hidden.
        if (loaded && userIds && userIds.length) {
          var cleared = userIds.filter(function (uid) {
            return stillPending.indexOf(uid) < 0 && !(self.model.isPostConfirmed && self.model.isPostConfirmed(id, uid));
          });
          if (cleared.length) self.markPostedLocally(id, cleared);
        }
        if (!loaded || left > 0) {
          if (attempt + 1 < MAX_ATTEMPTS) {
            self.recheckLater(id, attempt + 1, userIds);
            return;
          }
          CGP.diag.warn('post.recheckExhausted', { assignmentId: id, left: loaded ? left : null });
        }
        // Caught up, or out of patience: either way the column now shows
        // whatever Canvas last said, Post button included.
        self._awaitingCatchUp.delete(id);
        self.requestPaint();
      }, function () {
        self._rechecking.delete(id);
        if (attempt + 1 < MAX_ATTEMPTS) self.recheckLater(id, attempt + 1, userIds);
        else { self._awaitingCatchUp.delete(id); self.requestPaint(); }
      });
    }, delay);
  };

  /* Stamp posted_at on the cells Canvas has just told us it posted.
   *
   * Only ever called after Canvas has affirmatively reported the posting job
   * complete (or a re-read shows these exact submissions posted) - never
   * over a read showing them still hidden - and only for submissions counted
   * as pending immediately before the post. The background recheck's next
   * real read replaces this with Canvas's own timestamps. */
  P.markPostedLocally = function (assignmentId, userIds) {
    var self = this;
    self.model.markPostConfirmed(assignmentId, userIds);
    var when = new Date().toISOString();
    (userIds || []).forEach(function (uid) {
      // Read straight out of the cell map rather than through model.cell(),
      // which answers null for a column not currently marked loaded - which
      // is exactly the case when the re-read after the post failed.
      var rec = self.model.cells.get(self.model.key(assignmentId, uid));
      if (!rec || (rec.postedAt && rec.hasPostableComments !== true)) return;
      self.model.patchCell(assignmentId, uid, { postedAt: rec.postedAt || when, postedAtKnown: true, hasPostableComments: false }, { silent: true });
    });
    if (self.model && typeof self.model.emit === 'function') {
      self.model.emit('cells', { assignmentIds: [String(assignmentId)] });
    }
    self.tellCanvasPosted(assignmentId, userIds, when);
    if (self.liveSync && userIds && userIds.length) self.liveSync.announce([{ assignmentId: String(assignmentId) }]);
  };

  /* Canvas's own grid keeps its own copy of every submission and draws its
   * orange unposted dot from that copy, which a post through the API never
   * updates. The page-world bridge (env-bridge.js) owns that grid: ask it to
   * mark these submissions posted and re-render their rows, so the dot goes
   * the moment the post is confirmed instead of on the next reload. */
  P.tellCanvasPosted = function (assignmentId, userIds, when) {
    if (!userIds || !userIds.length) return;
    try {
      window.postMessage({
        source: 'cgp-posted',
        assignmentId: String(assignmentId),
        userIds: userIds.map(String),
        postedAt: when || new Date().toISOString()
      }, location.origin);
    } catch (e) { /* the CSS fallback in gradebook.css still applies */ }
  };

  CGP.PostGradesController = PostGradesController;
})();
