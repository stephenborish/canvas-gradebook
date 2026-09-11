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
      return self.gate(function () { return self.writeOne(target, result, opts); });
    })).then(function () {
      if (result.failed) {
        var first = result.errors[0] || {};
        CGP.ui.error(result.failed + (result.failed === 1 ? ' grade' : ' grades') +
          ' could not be saved' + (first.status ? ' (Canvas ' + first.status + ')' : '') +
          '. Those cells were left unchanged.');
      } else if (opts.announce && result.ok > 1) {
        CGP.ui.toast(result.ok + ' grades saved');
      }
      CGP.diag.bump('write.ok', result.ok);
      CGP.diag.bump('write.failed', result.failed);
      return result;
    });
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
    if (assignment.anonymous) {
      result.skipped++;
      CGP.diag.warn('write.anonymousAssignmentSkipped', { assignmentId: assignmentId });
      return Promise.resolve();
    }

    var currentRec = this.model.cell(assignmentId, userId);
    var op = CGP.gradeOps.operationFor(target.parsed, {
      wasMissing: !!(currentRec && currentRec.missing),
      // Only an explicitly applied Late status is a thing the L shortcut can
      // toggle off. Canvas also reports late: true for anything simply handed
      // in after the due date, and "un-late" is not a thing that can mean.
      wasLate: !!(currentRec && currentRec.latePolicyStatus === 'late'),
      missingBecomesLate: this.settings.values.missingBecomesLate !== false
    });
    if (!op) { result.skipped++; return Promise.resolve(); }

    // The op, not just the token, is what identifies this write: pressing L
    // twice on one cell is two DIFFERENT writes (apply Late, then remove it)
    // from one identical token, and keying on the token alone would let the
    // in-flight guard swallow the second one.
    var dupKey = CGP.gradeOps.opKey(target) + ':' + op.summary;
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
        if (op.kind === CGP.gradeOps.KIND.MISSING) self.confirmMissing(assignmentId, userId, rec);
        if (rec && !opts.noOptimistic) {
          var display = rec.excused ? 'EX' : (rec.grade === null || rec.grade === undefined ? null : String(rec.grade));
          self.model.patchCell(assignmentId, userId, { pending: false, override: display });
        } else if (!opts.noOptimistic) {
          self.model.patchCell(assignmentId, userId, { pending: false });
        }
        self.model.queueTotalRefresh(userId);
        result.ok++;
      }, function (err) {
        self.model.restoreCell(assignmentId, userId, snapshot);
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

  P.addComment = function (assignmentId, userId, text) {
    var self = this;
    return this.api.addComment(this.model.courseId, assignmentId, userId, text).then(function (submission) {
      self.model.applyCommentWrite(assignmentId, userId, submission);
      CGP.diag.bump('comment.saved');
      return submission;
    });
  };

  CGP.GradeWriter = GradeWriter;
})();
