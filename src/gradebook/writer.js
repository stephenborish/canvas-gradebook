/* Canvas Gradebook+ - the single path for every grade/status write.
 *
 * All writes go to Canvas's Submissions API with the instructor's session, not
 * through simulated typing. Safeguards required of a high-risk action:
 *   - refuse anything whose student id / assignment id is not confidently known
 *   - suppress duplicate in-flight writes for the same cell + value
 *   - optimistic patch, then reconcile with Canvas's response
 *   - on failure, restore the previous record and say so out loud */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.GradeWriter) return;

  function GradeWriter(ctx) {
    this.api = ctx.api;
    this.model = ctx.model;
    this.settings = ctx.settings;
    this.inflight = new Set();
    this.gate = CGP.util.pool(3);
    // One chain per cell, so two writes for the SAME submission never overlap
    // (see serialize below). Different cells still run concurrently, bounded
    // by the pool.
    this.chains = new Map();
  }

  var P = GradeWriter.prototype;

  /** targets: [{assignmentId, userId, parsed}] */
  P.apply = function (targets, opts) {
    var self = this;
    opts = opts || {};
    var deduped = CGP.gradeOps.dedupe(targets);
    var ops = deduped.ops;
    if (deduped.duplicates) CGP.diag.bump('write.duplicatesCollapsed', deduped.duplicates);
    if (!ops.length) return Promise.resolve({ ok: 0, failed: 0, skipped: 0, errors: [] });

    var result = { ok: 0, failed: 0, skipped: 0, errors: [] };

    return Promise.all(ops.map(function (target) {
      return self.serialize(target.assignmentId, target.userId, function () {
        return self.gate(function () { return self.writeOne(target, result, opts); });
      });
    })).then(function () {
      // Both are reported, not just whichever happened first: a paste that
      // spans one ordinary column and one anonymous/moderated one silently
      // wrote the ordinary cells and dropped the rest before this - the
      // success toast for the ones that DID save looked identical to a fully
      // successful paste, with nothing telling the teacher part of what they
      // pasted never went anywhere.
      var messages = [];
      if (result.failed) {
        var first = result.errors[0] || {};
        messages.push(result.failed + (result.failed === 1 ? ' grade' : ' grades') +
          ' could not be saved' + (first.status ? ' (Canvas ' + first.status + ')' : '') +
          '. Those cells were left unchanged.');
      }
      if (result.skipped) {
        messages.push(result.skipped + (result.skipped === 1 ? ' cell was' : ' cells were') +
          ' skipped (an anonymous or moderated assignment, or an unresolved student/assignment) ' +
          'and left unchanged.');
      }
      if (messages.length) {
        CGP.ui.error(messages.join(' '));
      } else if (opts.announce && result.ok > 1) {
        CGP.ui.toast(result.ok + ' grades saved');
      }
      CGP.diag.bump('write.ok', result.ok);
      CGP.diag.bump('write.failed', result.failed);
      return result;
    }, function (err) {
      // writeOne is written to always resolve (its own network failures are
      // caught and folded into result.failed), so this should not fire - but
      // if some future change ever lets one throw, the caller (a keyboard
      // shortcut, a paste) must still get its promise back and still get its
      // repaint, rather than silently never hearing from apply() again. That
      // silence is indistinguishable from "the shortcut did nothing until I
      // refreshed the page".
      CGP.diag.error('write.applyRejected', { message: String(err && err.message) });
      CGP.ui.error('Something went wrong applying that. Nothing more was changed.');
      return result;
    });
  };

  /* Run one cell's writes strictly in order.
   *
   * Two writes for one submission must never be in flight together, because
   * each one decides WHAT to write from the submission's current status. The
   * L toggle is the sharp case: press L twice quickly and the second press has
   * to see the state the first one produced, or it computes the same operation
   * again - the same form, the same duplicate key - and is suppressed as a
   * repeat, leaving the submission toggled once instead of back where it
   * started. Queueing behind the first write means the second one reads the
   * status Canvas actually returned and correctly does the inverse.
   *
   * The chain is dropped once it drains so this map cannot grow with every
   * cell ever written to in a long session. */
  P.serialize = function (assignmentId, userId, task) {
    var self = this;
    var key = String(assignmentId) + ':' + String(userId);
    var prior = this.chains.get(key) || Promise.resolve();
    var next = prior.then(task, task);
    this.chains.set(key, next.then(function () { }, function () { }));
    var mine = this.chains.get(key);
    mine.then(function () { if (self.chains.get(key) === mine) self.chains.delete(key); });
    return next;
  };

  P.writeOne = function (target, result, opts) {
    opts = opts || {};
    var self = this;
    var assignmentId = target.assignmentId;
    var userId = target.userId;

    if (!assignmentId || !userId) {
      result.skipped++;
      CGP.diag.error('write.unresolvedTarget', { hasAssignment: !!assignmentId, hasStudent: !!userId });
      return Promise.resolve();
    }
    var assignment = this.model.assignment(assignmentId);
    if (!assignment) {
      result.skipped++;
      CGP.diag.error('write.unknownAssignment', { assignmentId: assignmentId });
      return Promise.resolve();
    }
    if (!this.model.student(userId)) {
      result.skipped++;
      CGP.diag.error('write.unknownStudent', { assignmentId: assignmentId });
      return Promise.resolve();
    }
    if (assignment.anonymous || assignment.moderated) {
      result.skipped++;
      CGP.diag.warn('write.anonymousAssignmentSkipped', { assignmentId: assignmentId, moderated: !!assignment.moderated });
      return Promise.resolve();
    }

    // Stamped before anything else: a column-wide fetch already in flight
    // for this cell must be recognised as stale once it lands, or its
    // pre-write response can silently overwrite what this write is about to
    // record. See model.markLocalWrite / applySubmission. Whatever this
    // returns is what a failure below must restore, not just delete - see
    // model.clearLocalWrite.
    var priorWriteMark = this.model.markLocalWrite(assignmentId, userId);

    var currentRec = this.model.cell(assignmentId, userId);
    var op = CGP.gradeOps.operationFor(target.parsed, {
      wasMissing: !!(currentRec && currentRec.missing),
      // Only an explicitly applied Late status is a thing the L shortcut can
      // toggle off. Canvas also reports late: true for anything simply handed
      // in after the due date, and "un-late" is not a thing that can mean.
      wasLate: !!(currentRec && currentRec.latePolicyStatus === 'late'),
      // Same distinction for the M toggle: only a status somebody actually
      // applied can be toggled off. Canvas reports missing: true for anything
      // merely past due and unsubmitted, and a first M on such a cell must
      // still APPLY the status rather than flip it to Late.
      wasExplicitMissing: !!(currentRec && currentRec.latePolicyStatus === 'missing'),
      // What the toggle is allowed to erase. A submission can reach us already
      // flagged Missing AND holding a real grade (marked Missing in the Grade
      // Detail Tray, graded afterwards - Canvas leaves both standing), and
      // that grade is not M's to delete. enteredScore is what the teacher
      // actually typed; score can already have a late-policy deduction in it.
      currentScore: currentRec
        ? (currentRec.enteredScore === null || currentRec.enteredScore === undefined
          ? currentRec.score : currentRec.enteredScore)
        : null,
      missingBecomesLate: this.settings.values.missingBecomesLate !== false
    });
    if (!op) { result.skipped++; return Promise.resolve(); }

    // The op, not just the token, is what identifies this write: pressing L
    // twice on one cell is two DIFFERENT writes (apply Late, then remove it)
    // from one identical token, and keying on the token alone would let the
    // in-flight guard swallow the second one.
    var dupKey = CGP.gradeOps.opKey(target) + ':' + op.summary;
    // Writes that hand Canvas an empty posted_grade are removing the score,
    // not leaving it alone; what the cell should read afterwards differs.
    var clearsGrade = op.form['submission[posted_grade]'] === '';
    if (this.inflight.has(dupKey)) {
      CGP.diag.bump('write.inflightSuppressed');
      return Promise.resolve();
    }
    this.inflight.add(dupKey);

    var snapshot = this.model.snapshotCell(assignmentId, userId);
    if (!opts.noOptimistic) {
      var optimistic = Object.assign({}, op.patch, { pending: true });
      if (op.display !== null && op.display !== undefined) optimistic.override = op.display;
      this.model.patchCell(assignmentId, userId, optimistic);
    }

    return this.api.updateSubmission(this.model.courseId, assignmentId, userId, op.form)
      .then(function (submission) {
        var rec = self.model.applySubmission(submission);
        // Awaited, not fired and forgotten: the write is not finished until
        // the status it promised is actually on the record. Letting it run
        // loose also let it escape the request pool and the in-flight guard,
        // so during a bulk M it could race a later edit to the same cell.
        // Only the M that APPLIES Missing is worth verifying; the second M
        // is a toggle whose whole point is that the status goes away.
        var verified = (op.kind === CGP.gradeOps.KIND.MISSING && !op.toggledOff)
          ? self.confirmMissing(assignmentId, userId, rec)
          : Promise.resolve(rec);
        return verified.then(function (finalRec) {
          var shown = finalRec || rec;
          if (shown && !opts.noOptimistic) {
            var display;
            if (shown.excused) display = 'EX';
            // Canvas spells "no grade" as null on some submissions and as an
            // empty string on others; both mean the cell has nothing to show.
            else if (shown.grade !== null && shown.grade !== undefined && String(shown.grade) !== '') display = String(shown.grade);
            // No grade left, because this write deliberately took one away
            // (a clear, or the second M turning Missing into Late). Dropping
            // the overlay here would uncover the grade Canvas still has
            // painted in the cell, so the score would appear to come back.
            else display = clearsGrade ? '\u2013' : null;
            self.model.patchCell(assignmentId, userId, { pending: false, override: display });
          } else if (!opts.noOptimistic) {
            self.model.patchCell(assignmentId, userId, { pending: false });
          }
          self.model.queueTotalRefresh(userId);
          result.ok++;
        });
      }, function (err) {
        self.model.restoreCell(assignmentId, userId, snapshot);
        // This write never actually happened - restore whatever protection
        // existed before IT started (an earlier write to this same cell may
        // have already succeeded and still needs it), rather than deleting
        // the marker outright. See model.clearLocalWrite.
        self.model.clearLocalWrite(assignmentId, userId, priorWriteMark);
        result.failed++;
        result.errors.push({ assignmentId: assignmentId, status: err && err.status });
        CGP.diag.error('write.rejected', {
          assignmentId: assignmentId, status: err && err.status, kind: target.parsed && target.parsed.kind
        });
      }).then(function () {
        self.inflight.delete(dupKey);
      });
  };

  /* Did Missing actually take?
   *
   * M is a promise about the Canvas record, not about how the cell looks here:
   * the submission has to read as Missing in the Grade Detail Tray, in
   * SpeedGrader and on the student's own grades page. Canvas normally applies
   * the status from the same request that carries the grade, but a late policy
   * or another write finishing after ours can leave the score behind without
   * it - which looks, from the gradebook, exactly like "M only typed a zero".
   *
   * So the response is checked rather than assumed. If the submission came
   * back without the status, it is asked for once more on its own, and if
   * Canvas still refuses, the teacher is told plainly instead of being left
   * with a silent 0. */
  P.confirmMissing = function (assignmentId, userId, rec) {
    var self = this;
    if (self.isMissing(rec)) return Promise.resolve(rec);
    CGP.diag.warn('write.missingNotAppliedFirstTry', { assignmentId: assignmentId });
    return this.api.updateSubmission(this.model.courseId, assignmentId, userId,
      { 'submission[late_policy_status]': 'missing' })
      .then(function (submission) {
        var fresh = self.model.applySubmission(submission);
        if (self.isMissing(fresh)) {
          CGP.diag.bump('write.missingAppliedOnRetry');
          return fresh;
        }
        CGP.diag.error('write.missingRefused', { assignmentId: assignmentId });
        CGP.ui.error('Canvas saved the grade but would not mark this submission Missing. ' +
          'Its own late policy may be overriding the status.');
        return fresh;
      }, function (err) {
        CGP.diag.error('write.missingRetryFailed', { assignmentId: assignmentId, status: err && err.status });
        CGP.ui.error('Canvas saved the grade but rejected the Missing status' +
          (err && err.status ? ' (' + err.status + ')' : '') + '.');
        return rec;
      });
  };

  /** Canvas reports the status both ways; either one means Missing stuck. */
  P.isMissing = function (rec) {
    return !!(rec && (rec.missing || rec.latePolicyStatus === 'missing'));
  };

  /** Build write targets from raw tokens, honouring per-assignment grading type. */
  P.targetsFromTokens = function (list) {
    var self = this;
    var out = [];
    var invalid = [];
    (list || []).forEach(function (item) {
      var assignment = self.model.assignment(item.assignmentId);
      var parsed = CGP.gradeOps.parseToken(item.token, {
        gradingType: assignment ? assignment.gradingType : 'points'
      });
      if (parsed.kind === CGP.gradeOps.KIND.INVALID) { invalid.push(item); return; }
      if (parsed.kind === CGP.gradeOps.KIND.SKIP) return;
      out.push({ assignmentId: item.assignmentId, userId: item.userId, parsed: parsed, token: item.token });
    });
    return { targets: out, invalid: invalid };
  };

  /** Canvas leaves a manually-applied Missing status in place even once a real
   * grade exists on the submission (it only clears it when the status is
   * explicitly reset). Called after any grade committed through Canvas's own
   * editor is re-read from the API: if it turns out to still carry both a
   * real grade and Missing, that combination is exactly the "stuck" state
   * teachers hit, so this resolves the status once, with no optimistic flash
   * and no toast - it is bookkeeping, not something the teacher asked for.
   *
   * It resolves to Late rather than to no status at all: work that was
   * Missing and has now been graded arrived after its due date, and that is
   * what Late records. (Set "Grading a Missing submission marks it Late" off
   * in the options page to merely clear the status instead.) This is the same
   * rule grade-ops applies to grades written through this extension; it is
   * repeated here for grades the teacher committed through Canvas's own
   * editor, which never pass through gradeOps at all. */
  P.resolveStaleMissing = function (assignmentId, userId) {
    var self = this;
    var rec = this.model.cell(assignmentId, userId);
    if (!rec || !rec.missing || rec.excused || !rec.gradedAt) return Promise.resolve(null);
    var toLate = this.settings.values.missingBecomesLate !== false;
    var dupKey = String(assignmentId) + ':' + String(userId) + ':unstick-missing';
    if (this.inflight.has(dupKey)) return Promise.resolve(null);
    this.inflight.add(dupKey);
    return this.api.updateSubmission(this.model.courseId, assignmentId, userId,
      { 'submission[late_policy_status]': toLate ? 'late' : 'none' })
      .then(function (submission) {
        self.model.applySubmission(submission);
        CGP.diag.bump(toLate ? 'write.missingBecameLate' : 'write.missingAutoCleared');
      }, function (err) {
        CGP.diag.warn('write.missingAutoClearFailed', { assignmentId: assignmentId, status: err && err.status });
      }).then(function () {
        self.inflight.delete(dupKey);
      });
  };

  /* Same identity safeguards writeOne enforces for every grade/status write -
   * previously missing here entirely. A comment typed on an anonymous or
   * moderated assignment was written straight to whatever userId the model
   * happened to associate with that cell, with none of the refusal a grade
   * write on the same assignment already gets - exactly the identity mapping
   * this extension otherwise treats as deliberately hidden there, so a
   * comment meant for one student could land on a different student's
   * thread. Both call sites (comment-popover.js, bulk-comment.js) already
   * handle a rejected addComment() by showing an error and keeping the
   * teacher's typed text, so refusing here is safe to add. */
  P.addComment = function (assignmentId, userId, text) {
    var self = this;
    if (!assignmentId || !userId) {
      return Promise.reject(new Error('Comment could not be matched to a student and assignment.'));
    }
    var assignment = this.model.assignment(assignmentId);
    if (!assignment) return Promise.reject(new Error('Unknown assignment.'));
    if (!this.model.student(userId)) return Promise.reject(new Error('Unknown student.'));
    if (assignment.anonymous || assignment.moderated) {
      CGP.diag.warn('comment.anonymousOrModeratedSkipped', { assignmentId: assignmentId, moderated: !!assignment.moderated });
      return Promise.reject(new Error(
        'Comments cannot be added here on an anonymous or moderated assignment - use SpeedGrader instead.'));
    }
    this.model.markLocalWrite(assignmentId, userId);
    return this.api.addComment(this.model.courseId, assignmentId, userId, text).then(function (submission) {
      self.model.applyCommentWrite(assignmentId, userId, submission);
      CGP.diag.bump('comment.saved');
      return submission;
    });
  };

  CGP.GradeWriter = GradeWriter;
})();
