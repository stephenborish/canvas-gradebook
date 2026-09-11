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
    this.assignments = new Map();      // assignmentId -> assignment
    this.assignmentOrder = [];
    this.students = new Map();         // userId -> {id, name, sortableName, currentScore, currentGrade}
    this.studentOrder = [];
    this.cells = new Map();            // "assignmentId:userId" -> record
    this.loadedAssignments = new Set();
    this.pendingAssignments = new Map();
    this.commentVerifiedAssignments = new Set();
    this.ready = false;
    this._listeners = Object.create(null);
    this._totalQueue = new Set();
    this._flushTotals = util.debounce(this._doFlushTotals.bind(this), 900);
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
    return this.api.currentUser().then(function (user) {
      self.instructorId = user ? user.id : null;
      self.instructorNames = user ? [user.name, user.shortName, user.sortableName].filter(Boolean) : [];
      CGP.diag.set('instructorId', self.instructorId);
      CGP.diag.set('instructorNameAliases', self.instructorNames.length);
      return Promise.all([self.api.assignments(self.courseId), self.api.studentEnrollments(self.courseId)]);
    }).then(function (res) {
      var assignments = res[0] || [];
      var enrollments = res[1] || [];

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

      enrollments.forEach(function (e) {
        if (!e || !e.user || e.user.id === undefined) return;
        var uid = String(e.user.id);
        var grades = e.grades || {};
        var score = grades.current_score;
        if (score === undefined || score === null) score = e.computed_current_score;
        var prev = self.students.get(uid);
        var rec = {
          id: uid,
          name: e.user.short_name || e.user.name || '',
          fullName: e.user.name || '',
          sortableName: e.user.sortable_name || '',
          currentScore: score === undefined ? null : score,
          currentGrade: grades.current_grade === undefined ? null : grades.current_grade,
          enrollmentId: e.id === undefined ? null : String(e.id)
        };
        if (!prev) self.studentOrder.push(uid);
        self.students.set(uid, rec);
      });

      self.ready = true;
      CGP.diag.set('courseId', self.courseId);
      CGP.diag.set('assignments', self.assignments.size);
      CGP.diag.set('students', self.students.size);
      self.emit('ready', null);
      self.emit('totals', null);
      return self;
    });
  };

  /* Load submissions (with comments) for assignment columns we do not have yet. */
  GradebookModel.prototype.ensureAssignments = function (ids) {
    var self = this;
    var wanted = (ids || []).map(String).filter(function (id) {
      return id && self.assignments.has(id) && !self.loadedAssignments.has(id) && !self.pendingAssignments.has(id);
    });
    if (!wanted.length) {
      var waits = (ids || []).map(String).map(function (id) { return self.pendingAssignments.get(id); }).filter(Boolean);
      return waits.length ? Promise.all(waits) : Promise.resolve(null);
    }

    var batches = util.chunk(wanted, 8);
    var jobs = batches.map(function (batch) {
      var job = self.api.submissionsForAssignments(self.courseId, batch).then(function (subs) {
        var payloadsWithComments = 0;
        var rawCommentCount = 0;
        (subs || []).forEach(function (s) {
          if (Array.isArray(s && s.submission_comments)) {
            payloadsWithComments++;
            rawCommentCount += s.submission_comments.length;
          }
          self.applySubmission(s, { silent: true });
        });
        batch.forEach(function (id) { self.loadedAssignments.add(id); self.pendingAssignments.delete(id); });
        CGP.diag.set('submissionsLoaded', self.cells.size);
        CGP.diag.set('assignmentsLoaded', self.loadedAssignments.size);
        CGP.diag.set('commentPayloads', payloadsWithComments);
        CGP.diag.set('rawSubmissionComments', rawCommentCount);
        CGP.diag.set('cellsWithInstructorComment', self.stats().cellsWithInstructorComment);
        self.emit('cells', { assignmentIds: batch });
        return batch;
      }, function (err) {
        batch.forEach(function (id) { self.pendingAssignments.delete(id); });
        CGP.diag.error('model.submissions.failed', { assignments: batch.length, status: err && err.status });
        throw err;
      });
      batch.forEach(function (id) { self.pendingAssignments.set(id, job); });
      return job;
    });
    return Promise.all(jobs.map(function (p) { return p.catch(function () { return null; }); }));
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
    return Promise.all(wanted.map(function (id) {
      self.commentVerifiedAssignments.add(id);
      return self.api.submissionsForAssignment(self.courseId, id).then(function (subs) {
        var raw = 0;
        (subs || []).forEach(function (sub) {
          if (Array.isArray(sub && sub.submission_comments)) raw += sub.submission_comments.length;
          self.applySubmission(sub, { silent: true });
        });
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
      self.emit('cells', { assignmentIds: wanted, commentsVerified: true });
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
    var prev = this.cells.get(k) || {};

    var comments = Array.isArray(sub.submission_comments) ? sub.submission_comments
      : (prev.commentList || null);
    var analysis = comments
      ? CGP.commentAnalysis.analyze(comments, { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: userId })
      : (prev.comments || CGP.commentAnalysis.analyze([], { instructorId: this.instructorId, instructorNames: this.instructorNames, studentId: userId }));

    var postedKnown = Object.prototype.hasOwnProperty.call(sub, 'posted_at');

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
      gradedAt: sub.graded_at || null,
      // posted_at is Canvas's record of whether the student can see this
      // grade yet: null means it is still hidden from them. Canvas omits the
      // field on some payloads (and on builds old enough not to have posting
      // policies), so whether we were TOLD is tracked separately - a missing
      // field must never be read as "hidden", or every graded cell would look
      // unposted. See core/post-ops.js.
      postedAt: postedKnown ? (sub.posted_at || null) : (prev.postedAt === undefined ? null : prev.postedAt),
      postedAtKnown: postedKnown || prev.postedAtKnown === true,
      gradeMatchesCurrent: sub.grade_matches_current_submission !== false,
      attempt: sub.attempt === undefined ? null : sub.attempt,
      submissionType: sub.submission_type === undefined ? (prev.submissionType || null) : sub.submission_type,
      redoRequest: !!sub.redo_request,
      comments: analysis,
      commentList: comments ? comments.filter(function (c) { return c && c.draft !== true; }) : (prev.commentList || null),
      pending: false,
      override: null
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
    if (!this.loadedAssignments.has(String(assignmentId))) return null;
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
    return CGP.postOps.pendingFor(this.recordsForAssignment(id));
  };

  /* Re-read one assignment column from Canvas, replacing what we hold.
   * Used after posting grades, where the thing that changed (posted_at on
   * every submission in the column) is not in any response we already have. */
  GradebookModel.prototype.reloadAssignment = function (assignmentId) {
    var id = String(assignmentId);
    if (!this.assignments.has(id)) return Promise.resolve(null);
    this.loadedAssignments.delete(id);
    this.pendingAssignments.delete(id);
    return this.ensureAssignments([id]);
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
    } else {
      var folded = CGP.commentAnalysis.applyNewComment(rec.commentList || [], submissionOrComment, opts);
      next = { comments: folded.analysis, commentList: folded.comments };
    }
    return this.patchCell(assignmentId, userId, next);
  };

  GradebookModel.prototype.queueTotalRefresh = function (userId) {
    if (!userId) return;
    this._totalQueue.add(String(userId));
    this._flushTotals();
  };

  GradebookModel.prototype._doFlushTotals = function () {
    var self = this;
    var ids = Array.from(this._totalQueue);
    this._totalQueue.clear();
    if (!ids.length) return;
    var gate = util.pool(3);
    Promise.all(ids.map(function (uid) {
      return gate(function () { return self.api.enrollmentForUser(self.courseId, uid); }).then(function (e) {
        if (!e) return;
        var student = self.students.get(uid);
        if (!student) return;
        var grades = e.grades || {};
        var score = grades.current_score;
        if (score === undefined || score === null) score = e.computed_current_score;
        student.currentScore = score === undefined ? null : score;
        student.currentGrade = grades.current_grade === undefined ? null : grades.current_grade;
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
