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

    var op = CGP.gradeOps.operationFor(target.parsed);
    if (!op) { result.skipped++; return Promise.resolve(); }

    var dupKey = CGP.gradeOps.opKey(target);
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
