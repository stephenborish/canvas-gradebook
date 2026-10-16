/* Canvas Gradebook+ - gradebook data model.
 *
 * Holds everything the enhancements need in memory (never on disk, never off
 * the machine): assignments, students, submission state, comment authorship and
 * Canvas-computed course totals. Submissions load per assignment column in
 * batched requests, so a 200 student x 120 assignment course never turns into
 * one request per cell. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.GradebookModel) return;
  var util = CGP.util;

  function GradebookModel(api, courseId) {
    this.api = api;
    this.courseId = String(courseId);
    this.instructorId = null;
    this.instructorNames = [];
    // Which grading period Canvas's OWN Total column is currently scoped to,
    // if any (null = the whole course). Learned from ENV after boot (see
    // setGradingPeriod / content.js's env-bridge listener) since Canvas
    // decides the default period server-side and does not always reflect it
    // in the URL. Every Total read - the initial fetch and every refresh
    // after a write - is scoped to this so the frozen Total this extension
    // draws never disagrees with the one Canvas itself is showing.
    this.gradingPeriodId = null;
    this.assignments = new Map();      // assignmentId -> assignment
    this.assignmentOrder = [];
    this.students = new Map();         // userId -> {id, name, sortableName, currentScore, currentGrade}
    this.studentOrder = [];
    this.cells = new Map();            // "assignmentId:userId" -> record
    this.loadedAssignments = new Set();
    // Once true for an assignment, stays true for the rest of the page's
    // life - unlike loadedAssignments, which reloadAssignment() deliberately
    // clears for a moment to force a fresh fetch (posting re-reads a column
    // this way, more than once per post). Cells already have good data
    // sitting in `cells` the instant a column first loads, and nothing about
    // a background refresh makes that data any less real - so this is what
    // "have we ever actually seen this column" should mean to a painter,
    // rather than loadedAssignments, whose narrower "not mid-refetch right
    // now" is what ensureAssignments itself needs. Reading loadedAssignments
    // for the former is what used to blank every status tint, comment bubble
    // and hidden-grade bar in a column for the moment its Post button was
    // merely re-checking it, before anything had actually posted.
    this.everLoadedAssignments = new Set();
    this.pendingAssignments = new Map();
    this.commentVerifiedAssignments = new Set();
    // "assignmentId:userId" -> Date.now() when a local write (a keyboard
    // shortcut, bulk paste, or an added comment) most recently started on
    // that cell. See markLocalWrite / applySubmission below.
    this._writeStartedAt = new Map();
    // "assignmentId:userId" -> how many local writes on that cell are still
    // waiting for Canvas's answer. While any is, a column read cannot be
    // trusted for that cell (it may have been served before the write
    // committed); the write's own response is what settles it.
    this._writesInFlight = new Map();
    // assignmentId -> generation, bumped by reloadAssignment(). A column read
    // only applies if its generation is still current, so an older read that
    // happens to land after a newer one can never roll the column back.
    this._fetchGen = new Map();
    this._initPromise = null;
    this._totalsGen = 0;
    this.ready = false;
    this._listeners = Object.create(null);
    this._totalQueue = new Set();
    this._totalRecheckPending = new Set();
    this._flushTotals = util.debounce(this._doFlushTotals.bind(this), 900);
  }

  /** First value that is neither undefined nor null, else null. */
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return null;
  }

  GradebookModel.prototype.on = function (event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
  };

  GradebookModel.prototype.emit = function (event, payload) {
    (this._listeners[event] || []).forEach(function (cb) {
      try { cb(payload); } catch (e) { CGP.diag.error('model.listener.failed', { event: event, message: String(e && e.message) }); }
    });
  };

  GradebookModel.prototype.key = function (assignmentId, userId) {
    return String(assignmentId) + ':' + String(userId);
  };

  GradebookModel.prototype.init = function () {
    var self = this;
    if (this.ready) return Promise.resolve(this);
    // One init at a time: a retry after a failure (see content.js) must not
    // race a still-running first attempt.
    if (this._initPromise) return this._initPromise;
    // currentUser() (who is grading, for the instructor-authored-comment
    // check in comment-analysis.js) does not feed into - and used to sit
    // needlessly in front of - the assignments/enrollments fetch below. That
    // used to be one straight `.then()` chain: assignments and enrollments
    // could not even START until currentUser()'s own round trip had already
    // finished, which pushed model.ready (and therefore content.js's very
    // first ensureAssignments() call for the on-screen columns) back by one
    // whole extra network round trip on every single page load, for no
    // reason the data itself required. That is a real slice of the reported
    // "icons take too long to appear" - not a per-cell painting cost (the
    // paint-signature check in indicators.js already skips unchanged cells
    // correctly) but pure unforced latency sitting in front of the first
    // paint that could show anything at all. All three requests now start
    // at once; instructorId/instructorNames are only ever read once this
    // whole Promise.all has settled, same as before.
    var userPromise = this.api.currentUser();
    var totalsGen = ++this._totalsGen;
    var dataPromise = Promise.all([
      self.api.assignments(self.courseId),
      self.api.studentEnrollments(self.courseId, self.gradingPeriodId)
    ]);
    this._initPromise = Promise.all([userPromise, dataPromise]).then(function (results) {
      var user = results[0];
      var data = results[1];
      self.instructorId = user ? user.id : null;
      self.instructorNames = user ? [user.name, user.shortName, user.sortableName].filter(Boolean) : [];
      CGP.diag.set('instructorId', self.instructorId);
      CGP.diag.set('instructorNameAliases', self.instructorNames.length);
      var assignments = data[0] || [];
      var enrollments = data[1] || [];

      assignments.forEach(function (a) {
        if (!a || a.id === undefined) return;
        var id = String(a.id);
        self.assignments.set(id, {
          id: id,
          name: a.name || '',
          pointsPossible: a.points_possible === undefined ? null : a.points_possible,
          gradingType: a.grading_type || 'points',
          position: a.position || 0,
          published: a.published !== false,
          anonymous: !!a.anonymize_students,
          moderated: !!a.moderated_grading,
          // Manual posting policy: grades stay hidden from students until the
          // teacher posts them. Not load-bearing for the Post button (that is
          // decided per submission, from posted_at), but it is what explains
          // WHY a column has hidden grades, so it rides along in the tooltip.
          postManually: !!a.post_manually,
          omitFromFinal: !!a.omit_from_final_grade,
          dueAt: a.due_at || null,
          hasMultipleDueDates: !!a.has_overrides || !!a.all_dates,
          // What Canvas will accept as a submission for this assignment. Drives
          // the in-cell submission marker: an assignment marked "on paper" or
          // "no submission" has nothing to submit online, so marking it "not
          // submitted" would be a lie rather than information.
          submissionTypes: Array.isArray(a.submission_types) ? a.submission_types.slice()
            : (a.submission_types ? [String(a.submission_types)] : [])
        });
      });
      self.assignmentOrder = Array.from(self.assignments.keys());

      enrollments.forEach(function (e) { self._applyEnrollment(e, { scoresToo: totalsGen === self._totalsGen }); });
      // The grading period changed while this read was out: its roster is
      // fine, its scores are for the wrong period. Re-read just the totals.
      var totalsStale = totalsGen !== self._totalsGen;

      self.ready = true;
      self._initPromise = null;
      CGP.diag.set('courseId', self.courseId);
      CGP.diag.set('assignments', self.assignments.size);
      CGP.diag.set('students', self.students.size);
      self.emit('ready', null);
      self.emit('totals', null);
      if (totalsStale) self.reloadTotals();
      return self;
    }, function (err) {
      self._initPromise = null;
      throw err;
    });
    return this._initPromise;
  };

  /* One enrollment record -> the student's own entry. Shared by init() (the
   * first, whole-roster read) and reloadTotals() (a later one scoped to a
   * grading period learned after boot), so the two can never drift apart in
   * which fields they read off an enrollment. */
  GradebookModel.prototype._applyEnrollment = function (e, opts) {
    if (!e || !e.user || e.user.id === undefined) return;
    var uid = String(e.user.id);
    var grades = e.grades || {};
    var prev = this.students.get(uid);
    // For a teacher, Canvas's own gradebook Total counts every grade entered,
    // including ones still hidden from the student; current_score counts
    // only POSTED grades. Canvas reports the teacher's figure separately as
    // unposted_current_score - prefer it whenever it is there, or the Total
    // here sits still while grades are entered on a manually-posted column.
    var score = pick(grades.unposted_current_score, grades.current_score, e.computed_current_score);
    var letter = pick(grades.unposted_current_grade, grades.current_grade);
    var scoresToo = !(opts && opts.scoresToo === false);
    var rec = {
      id: uid,
      name: e.user.short_name || e.user.name || '',
      fullName: e.user.name || '',
      sortableName: e.user.sortable_name || '',
      currentScore: scoresToo ? score : (prev ? prev.currentScore : null),
      currentGrade: scoresToo ? letter : (prev ? prev.currentGrade : null),
      enrollmentId: e.id === undefined ? null : String(e.id)
    };
    if (!prev) this.studentOrder.push(uid);
    this.students.set(uid, rec);
  };

  /* Canvas decides the grading period its OWN Total column defaults to on the
   * server, and does not always echo that choice into the URL - so it has to
   * be learned from ENV after the page has already booted (see content.js's
   * env-bridge listener) rather than assumed to be "the whole course" just
   * because the URL says nothing. Called once boot learns it; a no-op if it
   * turns out to be the same period the model is already using (the common
   * case: no grading periods, or none of this course's students have one set
   * as "current").
   *
   * The whole-roster Total read is simply repeated with the period now
   * known, rather than trying to patch individual students' scores in place,
   * so this reuses exactly the same request and parsing path init() already
   * uses and cannot drift from it. */
  GradebookModel.prototype.setGradingPeriod = function (id) {
    // Canvas spells "All Grading Periods" as 0, which is not a period the
    // enrollments API will scope to - it means "the whole course".
    var next = (id === null || id === undefined || String(id) === '' || String(id) === '0') ? null : String(id);
    if (next === this.gradingPeriodId) return Promise.resolve(null);
    this.gradingPeriodId = next;
    CGP.diag.set('gradingPeriodId', next);
    if (!this.ready) {
      // init() notices the change itself (its totals generation moved on)
      // and re-reads the totals once it lands; nothing to queue here.
      this._totalsGen++;
      return Promise.resolve(null);
    }
    return this.reloadTotals();
  };

  /* Re-read every student's course total, scoped to whatever grading period
   * (if any) this model currently tracks. Used after learning the grading
   * period from ENV, and safe to call any other time the whole roster's
   * totals should be refreshed from Canvas rather than one student's (see
   * queueTotalRefresh for the single-student, write-triggered path). */
  GradebookModel.prototype.reloadTotals = function () {
    var self = this;
    if (!this.ready) return Promise.resolve(null);
    // Two reloads can overlap (the period changed twice quickly); only the
    // newest may write scores, or an older period's totals could land last.
    var gen = ++this._totalsGen;
    return this.api.studentEnrollments(this.courseId, this.gradingPeriodId).then(function (enrollments) {
      if (gen !== self._totalsGen) return null;
      (enrollments || []).forEach(function (e) { self._applyEnrollment(e); });
      CGP.diag.bump('totals.reloadedForGradingPeriod');
      self.emit('totals', null);
      return null;
    }, function (err) {
      CGP.diag.error('model.reloadTotals.failed', { status: err && err.status });
      return null;
    });
  };

  /* Load submissions (with comments, unless opts.includeComments is false -
   * see CanvasApi.submissionsForAssignments) for assignment columns we do not
   * have yet. */
  /* How many assignment columns one students/submissions request carries.
   * Every column multiplies by the whole roster, so a fixed 8 that is fine
   * for a 30-student class runs a 900-student lecture past any sane page
   * budget. Aim for ~40 pages of 100 per request. */
  GradebookModel.prototype._batchSize = function () {
    var students = Math.max(1, this.students.size);
    return Math.max(1, Math.min(8, Math.floor(4000 / students)));
  };

  GradebookModel.prototype._gen = function (id) {
    return this._fetchGen.get(String(id)) || 0;
  };

  GradebookModel.prototype.ensureAssignments = function (ids, opts) {
    var self = this;
    var requested = (ids || []).map(String);
    var wanted = requested.filter(function (id) {
      return id && self.assignments.has(id) && !self.loadedAssignments.has(id) && !self.pendingAssignments.has(id);
    });
    // Columns another call is already fetching are waited on too, so a
    // caller asking for [a, b] while b is in flight gets both, not just a.
    var waits = requested.map(function (id) { return self.pendingAssignments.get(id); }).filter(Boolean);
    if (!wanted.length) {
      return waits.length ? Promise.all(waits.map(function (p) { return p.catch(function () { return null; }); })) : Promise.resolve(null);
    }

    var batchSize = this._batchSize();
    // Generous on purpose: student_ids[]=all can also return students this
    // roster does not count (concluded or inactive enrollments).
    var maxPages = Math.ceil((batchSize * Math.max(1, this.students.size) * 2) / 100) + 10;
    var batches = util.chunk(wanted, batchSize);
    var jobs = batches.map(function (batch) {
      // Stamped before the request goes out: whatever this fetch returns
      // describes the column no earlier than this moment, so a local write
      // that starts at or after it must win (see applySubmission).
      var fetchStartedAt = Date.now();
      var gens = {};
      batch.forEach(function (id) { gens[id] = self._gen(id); });
      var fetchOpts = Object.assign({}, opts || {}, { maxPages: maxPages });
      function release() {
        batch.forEach(function (id) {
          if (self.pendingAssignments.get(id) === job) self.pendingAssignments.delete(id);
        });
      }
      var job = self.api.submissionsForAssignments(self.courseId, batch, fetchOpts).then(function (subs) {
        // A truncated read is not "the column": cells it never reached would
        // read as status-free and ungraded. Treat it as a failed load - and
        // release the columns here, since a throw from this handler never
        // reaches the error handler beside it.
        if (subs && subs.truncated) {
          release();
          CGP.diag.error('model.submissions.failed', { assignments: batch.length, truncated: true });
          var truncated = new Error('Submissions list was truncated');
          truncated.truncated = true;
          throw truncated;
        }
        var payloadsWithComments = 0;
        var rawCommentCount = 0;
        (subs || []).forEach(function (s) {
          if (!s || gens[String(s.assignment_id)] !== self._gen(s.assignment_id)) return;
          if (Array.isArray(s.submission_comments)) {
            payloadsWithComments++;
            rawCommentCount += s.submission_comments.length;
          }
          self.applySubmission(s, { silent: true, staleIfWrittenAfter: fetchStartedAt });
        });
        var current = batch.filter(function (id) { return gens[id] === self._gen(id); });
        current.forEach(function (id) {
          self.loadedAssignments.add(id);
          self.everLoadedAssignments.add(id);
        });
        release();
        CGP.diag.set('submissionsLoaded', self.cells.size);
        CGP.diag.set('assignmentsLoaded', self.loadedAssignments.size);
        CGP.diag.set('commentPayloads', payloadsWithComments);
        CGP.diag.set('rawSubmissionComments', rawCommentCount);
        CGP.diag.set('cellsWithInstructorComment', self.stats().cellsWithInstructorComment);
        if (current.length) self.emit('cells', { assignmentIds: current });
        return batch;
      }, function (err) {
        release();
        CGP.diag.error('model.submissions.failed', { assignments: batch.length, status: err && err.status });
        throw err;
      });
      batch.forEach(function (id) { self.pendingAssignments.set(id, job); });
      return job;
    });
    return Promise.all(jobs.concat(waits).map(function (p) { return p.catch(function () { return null; }); }));
  };

  /* Verify comments for the assignment columns that are actually visible.
   * The multi-assignment endpoint is fast, but Canvas installations can differ
   * in which associations they serialize there. The assignment-specific list
   * endpoint is the authoritative fallback for submission comments. Each visible
   * assignment is verified once per page visit, so this adds only a handful of
   * requests and never one request per cell. */
  GradebookModel.prototype.verifyVisibleComments = function (ids) {
    var self = this;
    var wanted = (ids || []).map(String).filter(function (id) {
      return self.assignments.has(id) && !self.commentVerifiedAssignments.has(id);
    });
    if (!wanted.length) return Promise.resolve(null);
    var verified = [];
    return Promise.all(wanted.map(function (id) {
      self.commentVerifiedAssignments.add(id);
      var fetchStartedAt = Date.now();
      var gen = self._gen(id);
      return self.api.submissionsForAssignment(self.courseId, id).then(function (subs) {
        if (subs && subs.truncated) {
          // Handled here: a throw from this handler would skip the error
          // handler beside it and leave the column marked verified.
          self.commentVerifiedAssignments.delete(id);
          CGP.diag.warn('comments.verifyFailed', { assignmentId: id, truncated: true });
          return null;
        }
        // A column reload started after this read: its data wins.
        if (gen !== self._gen(id)) { self.commentVerifiedAssignments.delete(id); return null; }
        verified.push(id);
        var raw = 0;
        (subs || []).forEach(function (sub) {
          if (Array.isArray(sub && sub.submission_comments)) raw += sub.submission_comments.length;
          self.applySubmission(sub, { silent: true, staleIfWrittenAfter: fetchStartedAt });
        });
        self.loadedAssignments.add(id);
        self.everLoadedAssignments.add(id);
        CGP.diag.bump('comments.verifiedAssignments');
        CGP.diag.bump('comments.verifiedRaw', raw);
        return id;
      }, function (err) {
        self.commentVerifiedAssignments.delete(id);
        CGP.diag.warn('comments.verifyFailed', { assignmentId: id, status: err && err.status });
        return null;
      });
    })).then(function () {
      CGP.diag.set('cellsWithInstructorComment', self.stats().cellsWithInstructorComment);
      // Nothing landed, nothing to repaint - emitting anyway is what turned
      // a failing read into a paint -> re-request -> fail loop.
      if (verified.length) self.emit('cells', { assignmentIds: verified, commentsVerified: true });
    });
  };

  /** Slowly warm the remaining columns so scrolling never waits on the network. */
  GradebookModel.prototype.prefetchRemaining = function () {
    var self = this;
    var remaining = this.assignmentOrder.filter(function (id) {
      return !self.loadedAssignments.has(id) && !self.pendingAssignments.has(id);
    });
    if (!remaining.length) { CGP.diag.log('model.prefetch.done'); return Promise.resolve(); }
    var slice = remaining.slice(0, 8);
    return this.ensureAssignments(slice).then(function () {
      return util.sleep(450).then(function () { return self.prefetchRemaining(); });
    }, function () { return null; });
  };

  GradebookModel.prototype.applySubmission = function (sub, opts) {
    if (!sub || sub.assignment_id === undefined || sub.user_id === undefined) return null;
    opts = opts || {};
    var assignmentId = String(sub.assignment_id);
    var userId = String(sub.user_id);
    var k = this.key(assignmentId, userId);

    // A column-wide (or comment-verification) fetch can still be in flight
    // when a keyboard shortcut, bulk paste, or comment write lands on one of
    // its cells. If that fetch was already running before the write started,
    // its response reflects the pre-write server state - and applying it here
    // would silently undo a write that already succeeded a moment earlier.
    // That is the "M/E/L (or a comment) do nothing until I refresh" report:
    // the write took, but a slower, already-in-flight read for the same
    // column landed afterwards and quietly reverted it. A manual refresh
    // "fixes" it only because every request it makes starts strictly after
    // the write it follows, so this race never has a chance to occur.
    // Refreshing never had special knowledge the live page lacked - it just
    // couldn't lose this race. Skipping the stale response here means the
    // live page doesn't have to either.
    if (opts.staleIfWrittenAfter !== undefined) {
      var writtenAt = this._writeStartedAt.get(k);
      if ((this._writesInFlight.get(k) || 0) > 0 || (writtenAt && writtenAt >= opts.staleIfWrittenAfter)) {
        CGP.diag.bump('model.staleFetchSkipped');
        return this.cells.get(k) || null;
      }
    }

    var prev = this.cells.get(k) || {};

    var comments;
    if (Array.isArray(sub.submission_comments) && sub.submission_comments.length > 0) {
      comments = sub.submission_comments;
    } else if (prev.commentList && prev.commentList.length > 0 &&
               (!sub.submission_comments || (this.commentVerifiedAssignments && this.commentVerifiedAssignments.has(assignmentId)))) {
      comments = prev.commentList;
    } else if (Array.isArray(sub.submission_comments)) {
      comments = sub.submission_comments;
    } else {
      comments = prev.commentList || null;
    }
    var analysis = comments
      ? CGP.commentAnalysis.analyze(comments, { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: userId })
      : (prev.comments || CGP.commentAnalysis.analyze([], { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: userId }));

    var postedKnown = Object.prototype.hasOwnProperty.call(sub, 'posted_at');
    var postableKnown = Object.prototype.hasOwnProperty.call(sub, 'has_postable_comments');

    // A cell this extension has written to carries an overlay, because
    // Canvas's own grid never hears about our API write and keeps showing
    // the old value until the page reloads. Fresh data must not drop that
    // overlay (or every pasted grade in a column would snap back to Canvas's
    // stale text the moment the column is re-read) - it re-derives it from
    // the submission instead, so it always shows Canvas's current grade.
    var override = null;
    if (prev.override !== null && prev.override !== undefined) {
      if (sub.excused) override = 'EX';
      else if (sub.grade !== null && sub.grade !== undefined && String(sub.grade) !== '') override = String(sub.grade);
      else override = '\u2013';
    }

    var rec = {
      assignmentId: assignmentId,
      userId: userId,
      submissionId: sub.id === undefined ? prev.submissionId || null : String(sub.id),
      score: sub.score === undefined ? null : sub.score,
      enteredScore: sub.entered_score === undefined ? null : sub.entered_score,
      grade: sub.grade === undefined ? null : sub.grade,
      excused: !!sub.excused,
      missing: !!sub.missing,
      late: !!sub.late,
      latePolicyStatus: sub.late_policy_status || null,
      workflowState: sub.workflow_state || null,
      submittedAt: sub.submitted_at || null,
      // Kept so a write that lifts an explicit Missing can tell the work was
      // handed in late (see gradeOps.handedInLate); null when Canvas omits them.
      secondsLate: sub.seconds_late === undefined ? (prev.secondsLate === undefined ? null : prev.secondsLate) : sub.seconds_late,
      cachedDueDate: sub.cached_due_date || (prev.cachedDueDate || null),
      gradedAt: sub.graded_at || null,
      // posted_at is Canvas's record of whether the student can see this
      // grade yet: null means it is still hidden from them. Canvas omits the
      // field on some payloads (and on builds old enough not to have posting
      // policies), so whether we were TOLD is tracked separately - a missing
      // field must never be read as "hidden", or every graded cell would look
      // unposted. See core/post-ops.js.
      postedAt: postedKnown ? (sub.posted_at || null) : (prev.postedAt === undefined ? null : prev.postedAt),
      postedAtKnown: postedKnown || prev.postedAtKnown === true,
      // Canvas's own flag for a comment the student cannot see yet. Tracked as
      // known/unknown for the same reason posted_at is: a payload without it
      // says nothing (see core/post-ops.js).
      hasPostableComments: postableKnown ? !!sub.has_postable_comments : (prev.hasPostableComments === undefined ? null : prev.hasPostableComments),
      hasPostableKnown: postableKnown || prev.hasPostableKnown === true,
      gradeMatchesCurrent: sub.grade_matches_current_submission !== false,
      attempt: sub.attempt === undefined ? null : sub.attempt,
      submissionType: sub.submission_type === undefined ? (prev.submissionType || null) : sub.submission_type,
      redoRequest: !!sub.redo_request,
      comments: analysis,
      commentList: comments ? comments.filter(function (c) { return c && c.draft !== true; }) : (prev.commentList || null),
      pending: false,
      override: override
    };
    this.cells.set(k, rec);
    if (!opts.silent) this.emit('cell', { assignmentId: assignmentId, userId: userId, record: rec });
    return rec;
  };

  /* What the submission marker in a grade cell should say.
   *
   * Returns null when the assignment cannot be submitted online at all - an
   * on-paper test, or an assignment Canvas records with no submission type -
   * because there is no such thing as a missing online submission for those,
   * and a grid full of "not submitted" markers on them would be noise that is
   * also wrong. Returns null too when the column's submissions have not
   * loaded yet, so a cell never claims "nothing submitted" purely because the
   * data has not arrived. */
  var ONLINE_TYPES = [
    'online_upload', 'online_text_entry', 'online_url', 'online_quiz',
    'discussion_topic', 'media_recording', 'student_annotation', 'basic_lti_launch'
  ];

  GradebookModel.prototype.submissionState = function (assignmentId, userId) {
    var a = this.assignment(assignmentId);
    if (!a) return null;
    var types = a.submissionTypes || [];
    var online = types.filter(function (t) { return ONLINE_TYPES.indexOf(t) >= 0; });
    if (!online.length) return null;
    if (!this.everLoadedAssignments.has(String(assignmentId))) return null;
    var rec = this.cell(assignmentId, userId);
    var submittedType = rec && rec.submissionType ? rec.submissionType : null;
    return {
      submitted: !!(rec && rec.submittedAt),
      submittedAt: (rec && rec.submittedAt) || null,
      // What was actually handed in, falling back to what the assignment asks
      // for when nothing has been handed in yet.
      kind: submittedType && ONLINE_TYPES.indexOf(submittedType) >= 0 ? submittedType : online[0],
      attempt: (rec && rec.attempt) || 0,
      excused: !!(rec && rec.excused)
    };
  };

  /* Every submission record this model holds for one assignment column.
   * Only students still in the model are included, so a record left behind by
   * someone who has since been unenrolled cannot keep a Post button alive. */
  GradebookModel.prototype.recordsForAssignment = function (assignmentId) {
    var self = this;
    var out = [];
    this.studentOrder.forEach(function (uid) {
      var rec = self.cells.get(self.key(assignmentId, uid));
      if (rec) out.push(rec);
    });
    return out;
  };

  /* The students in one column whose grades are graded here but still hidden
   * from them. Empty until the column's submissions have actually loaded: a
   * column we know nothing about has nothing to post. */
  GradebookModel.prototype.pendingPosts = function (assignmentId) {
    var id = String(assignmentId);
    if (!this.loadedAssignments.has(id)) return [];
    return CGP.postOps.pendingFor(this.recordsForAssignment(id), this.assignment(id));
  };

  /* Re-read one assignment column from Canvas, replacing what we hold.
   * Used after posting grades, where the thing that changed (posted_at on
   * every submission in the column) is not in any response we already have. */
  GradebookModel.prototype.reloadAssignment = function (assignmentId, opts) {
    var id = String(assignmentId);
    if (!this.assignments.has(id)) return Promise.resolve(null);
    // Any read of this column already in flight is now older than the one
    // about to start; bumping the generation makes it land harmlessly.
    this._fetchGen.set(id, this._gen(id) + 1);
    this.loadedAssignments.delete(id);
    this.pendingAssignments.delete(id);
    this.commentVerifiedAssignments.delete(id);
    return this.ensureAssignments([id], opts);
  };

  /* Record that a local write to this cell is starting right now. Called
   * before every optimistic patch (writer.js), so a background fetch already
   * in flight for this cell's column can recognise, once it lands, that it
   * is now stale. See applySubmission above.
   *
   * Returns whatever this cell's marker held BEFORE this call, so a caller
   * whose write goes on to fail can restore exactly that - see
   * clearLocalWrite. GradeWriter.serialize runs writes to the same cell one
   * at a time, so a SECOND write can start (and fail) after a FIRST one on
   * the same cell already succeeded; that first write's own protection must
   * not be thrown away just because a later, unrelated write attempt on the
   * same cell didn't pan out. */
  GradebookModel.prototype.markLocalWrite = function (assignmentId, userId) {
    var key = this.key(assignmentId, userId);
    var previous = this._writeStartedAt.get(key);
    this._writeStartedAt.set(key, Date.now());
    this._writesInFlight.set(key, (this._writesInFlight.get(key) || 0) + 1);
    return previous;
  };

  /* A local write got Canvas's answer. Re-stamped at completion: a column
   * read dispatched while the write was still out may have been served
   * before it committed, so only reads started from now on are fresh. */
  GradebookModel.prototype.finishLocalWrite = function (assignmentId, userId) {
    var key = this.key(assignmentId, userId);
    this._decInFlight(key);
    this._writeStartedAt.set(key, Date.now());
  };

  GradebookModel.prototype._decInFlight = function (key) {
    var n = (this._writesInFlight.get(key) || 0) - 1;
    if (n > 0) this._writesInFlight.set(key, n); else this._writesInFlight.delete(key);
  };

  /* Undo markLocalWrite once a write is known to have NOT taken (the API
   * request failed and the cell was rolled back to its prior snapshot).
   *
   * restoreTo - what markLocalWrite returned for THIS write attempt, i.e.
   * whatever the marker held immediately before it. Passing it back in
   * (rather than always deleting) matters whenever a write to this same
   * cell had already succeeded earlier: deleting unconditionally would
   * throw away THAT write's protection too, and a column fetch dispatched
   * before it that only lands after this later failure would then be
   * treated as fresh and silently overwrite the correct post-rollback state
   * with older, pre-both-writes data. Omit restoreTo (or pass undefined) for
   * a cell that had no earlier write to protect. */
  GradebookModel.prototype.clearLocalWrite = function (assignmentId, userId, restoreTo) {
    var key = this.key(assignmentId, userId);
    this._decInFlight(key);
    if (restoreTo === undefined) this._writeStartedAt.delete(key);
    else this._writeStartedAt.set(key, restoreTo);
  };

  GradebookModel.prototype.cell = function (assignmentId, userId) {
    return this.cells.get(this.key(assignmentId, userId)) || null;
  };

  GradebookModel.prototype.assignment = function (assignmentId) {
    return this.assignments.get(String(assignmentId)) || null;
  };

  GradebookModel.prototype.student = function (userId) {
    return this.students.get(String(userId)) || null;
  };

  GradebookModel.prototype.patchCell = function (assignmentId, userId, patch, opts) {
    var k = this.key(assignmentId, userId);
    var prev = this.cells.get(k) || { assignmentId: String(assignmentId), userId: String(userId), comments: CGP.commentAnalysis.analyze([], {}) };
    var next = Object.assign({}, prev, patch || {});
    this.cells.set(k, next);
    if (!(opts && opts.silent)) this.emit('cell', { assignmentId: String(assignmentId), userId: String(userId), record: next });
    return next;
  };

  GradebookModel.prototype.snapshotCell = function (assignmentId, userId) {
    var rec = this.cell(assignmentId, userId);
    return rec ? Object.assign({}, rec) : null;
  };

  GradebookModel.prototype.restoreCell = function (assignmentId, userId, snapshot) {
    var k = this.key(assignmentId, userId);
    if (snapshot) this.cells.set(k, snapshot); else this.cells.delete(k);
    this.emit('cell', { assignmentId: String(assignmentId), userId: String(userId), record: snapshot || null });
  };

  GradebookModel.prototype.refreshCell = function (assignmentId, userId) {
    var self = this;
    return this.api.submission(this.courseId, assignmentId, userId).then(function (sub) {
      return self.applySubmission(sub);
    }, function (err) {
      CGP.diag.error('model.refreshCell.failed', { status: err && err.status });
      return null;
    });
  };

  GradebookModel.prototype.applyCommentWrite = function (assignmentId, userId, submissionOrComment) {
    var k = this.key(assignmentId, userId);
    var rec = this.cells.get(k);
    if (!rec) return null;
    var opts = { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: String(userId) };
    var next;
    if (submissionOrComment && Array.isArray(submissionOrComment.submission_comments)) {
      next = {
        comments: CGP.commentAnalysis.analyze(submissionOrComment.submission_comments, opts),
        commentList: submissionOrComment.submission_comments.filter(function (c) { return c && c.draft !== true; })
      };
      if (Object.prototype.hasOwnProperty.call(submissionOrComment, 'has_postable_comments')) {
        next.hasPostableComments = !!submissionOrComment.has_postable_comments;
        next.hasPostableKnown = true;
      }
    } else {
      var folded = CGP.commentAnalysis.applyNewComment(rec.commentList || [], submissionOrComment, opts);
      next = { comments: folded.analysis, commentList: folded.comments };
    }
    return this.patchCell(assignmentId, userId, next);
  };

  /* A comment this teacher just deleted: drop it from the cell's thread and
   * re-derive the indicators (the bubble goes away with the last instructor
   * comment). */
  GradebookModel.prototype.applyCommentDeleted = function (assignmentId, userId, commentId) {
    var rec = this.cells.get(this.key(assignmentId, userId));
    if (!rec) return null;
    var opts = { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: String(userId) };
    var list = (rec.commentList || []).filter(function (c) { return !c || String(c.id) !== String(commentId); });
    var analysis = CGP.commentAnalysis.analyze(list, opts);
    var patch = { comments: analysis, commentList: list };
    if (rec.hasPostableKnown) {
      // Which comment made the submission postable is not known, so once any
      // comment is gone the old flag cannot be trusted: false when no
      // instructor comment remains, otherwise "unknown" (post-ops then infers).
      if (!analysis.hasInstructorComment) patch.hasPostableComments = false;
      else patch.hasPostableKnown = false;
    }
    return this.patchCell(assignmentId, userId, patch);
  };

  /* Put back one comment whose delete Canvas refused, into the thread as it is
   * NOW (other comments may have been added or removed meanwhile). `prior` is
   * the postable state to restore. */
  GradebookModel.prototype.restoreComment = function (assignmentId, userId, comment, prior, index) {
    var rec = this.cells.get(this.key(assignmentId, userId));
    if (!rec || !comment) return null;
    var opts = { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: String(userId) };
    var list = (rec.commentList || []).slice();
    var exists = list.some(function (c) { return c && String(c.id) === String(comment.id); });
    if (!exists) list.splice(Math.min(index >= 0 ? index : list.length, list.length), 0, comment);
    var patch = { comments: CGP.commentAnalysis.analyze(list, opts), commentList: list };
    if (prior) {
      patch.hasPostableComments = prior.hasPostableComments;
      patch.hasPostableKnown = prior.hasPostableKnown;
    }
    return this.patchCell(assignmentId, userId, patch);
  };

  GradebookModel.prototype.queueTotalRefresh = function (userId) {
    if (!userId) return;
    this._totalQueue.add(String(userId));
    this._flushTotals();
    this._scheduleTotalRecheck(String(userId));
  };

  /* Canvas recomputes a student's course total asynchronously - more so with
   * weighted assignment groups - and the single read _doFlushTotals makes
   * 900ms after a write has no guarantee that recomputation has finished by
   * then. Unlike confirmMissing's re-check for the Missing status, nothing
   * here ever verified the Total actually caught up: whatever that one read
   * returned was painted and never looked at again. One extra, later look -
   * the same bounded, self-cancelling shape used elsewhere for a single
   * retry - costs little and catches Canvas simply needing a bit longer. */
  GradebookModel.prototype._scheduleTotalRecheck = function (userId) {
    var self = this;
    if (this._totalRecheckPending.has(userId)) return;
    this._totalRecheckPending.add(userId);
    setTimeout(function () {
      self._totalRecheckPending.delete(userId);
      self._totalQueue.add(userId);
      self._flushTotals();
    }, 2500);
  };

  GradebookModel.prototype._doFlushTotals = function () {
    var self = this;
    var ids = Array.from(this._totalQueue);
    this._totalQueue.clear();
    if (!ids.length) return;
    // A bulk paste or a column-wide M queues hundreds of students; one
    // whole-roster read is far cheaper than hundreds of single ones.
    if (ids.length > 20) { this.reloadTotals(); return; }
    var gate = util.pool(3);
    var gen = this._totalsGen;
    var period = this.gradingPeriodId;
    Promise.all(ids.map(function (uid) {
      return gate(function () { return self.api.enrollmentForUser(self.courseId, uid, period); }).then(function (e) {
        // Scoped to a period the gradebook is no longer showing.
        if (gen !== self._totalsGen || period !== self.gradingPeriodId) return;
        if (!e || !self.students.has(uid)) return;
        self._applyEnrollment(e);
      }, function () { return null; });
    })).then(function () {
      CGP.diag.bump('totals.refreshed', ids.length);
      self.emit('totals', { userIds: ids });
    });
  };

  GradebookModel.prototype.stats = function () {
    var instructorComments = 0, missing = 0, late = 0, excused = 0, resubmitted = 0;
    this.cells.forEach(function (rec) {
      if (rec.comments && rec.comments.hasInstructorComment) instructorComments++;
      if (rec.missing) missing++;
      if (rec.late) late++;
      if (rec.excused) excused++;
      if (rec.gradedAt && rec.gradeMatchesCurrent === false) resubmitted++;
    });
    return {
      courseId: this.courseId,
      instructorId: this.instructorId,
      assignments: this.assignments.size,
      assignmentsLoaded: this.loadedAssignments.size,
      students: this.students.size,
      submissionRecords: this.cells.size,
      cellsWithInstructorComment: instructorComments,
      missing: missing, late: late, excused: excused, resubmitted: resubmitted
    };
  };

  CGP.GradebookModel = GradebookModel;
})();
