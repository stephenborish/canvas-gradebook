/* Canvas Gradebook+ - what "waiting to be posted" means.
 *
 * Canvas can hold a grade back from the student: with a manual posting policy
 * (and for anything hidden by hand) the teacher sees the score in the grid
 * while the student's own grades page still shows nothing. The submission
 * carries that fact as posted_at - null while the grade is hidden, a timestamp
 * once students can see it.
 *
 * This file is the single source of truth for reading that state. No DOM, no
 * network: it is unit tested directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.postOps) return;

  /* Is there anything on this submission a student could be shown?
   *
   * This has to match Canvas's own "postable" scope exactly - score present
   * AND workflow_state "graded" (or excused) - not just "does the gradebook
   * currently display a score". A quiz with a manually-graded question is the
   * common case that splits those two: while a question still needs review
   * the submission carries a partial auto-graded score in the gradebook, but
   * its workflow_state is "pending_review", and Canvas's own
   * postAssignmentGrades(gradedOnly: true) skips it outright. Counting it
   * here anyway is exactly what used to inflate the button's number and then
   * post nothing for it - "0 of N grades posted" when a whole column was
   * sitting in that state. */
  function hasGrade(rec) {
    if (!rec) return false;
    if (rec.excused) return true;
    if (rec.workflowState !== 'graded') return false;
    if (rec.score !== null && rec.score !== undefined) return true;
    return rec.grade !== null && rec.grade !== undefined && String(rec.grade) !== '';
  }

  /* One submission that is graded here and still hidden from the student.
   *
   * postedAtKnown is what keeps this honest. A Canvas build that does not
   * serialize posted_at at all would otherwise make EVERY graded submission
   * look unposted, and the column button would offer to post grades that are
   * already posted. When Canvas has not told us, we do not guess.
   *
   * A cell with one of our own optimistic writes still in flight is skipped
   * for the same reason: its posted_at is whatever the record held before the
   * write, which says nothing about the grade being written right now. */
  function needsPost(rec, assignment) {
    if (!rec || rec.pending) return false;
    // Canvas's own answer to "does this submission hold a comment the student
    // cannot see yet" (has_postable_comments) wins whenever it was given: it
    // is exactly the state Canvas's own post action acts on, so counting it
    // can never offer a button that then posts nothing.
    if (rec.hasPostableKnown && rec.hasPostableComments === true) return true;
    if (!rec.postedAtKnown) return false;
    if (rec.postedAt) return false;
    return hasGrade(rec) || hasHiddenComment(rec, assignment);
  }

  /* A comment the instructor wrote that the student cannot read yet.
   *
   * When Canvas reported has_postable_comments for this submission, that is
   * the whole answer (and needsPost has already used it), so this says no.
   * Only on a Canvas that does not report it is the state inferred: under a
   * manual posting policy Canvas hides every comment on an unposted
   * submission, graded or not, so an instructor comment on one is taken to be
   * hidden. That is a guess - it cannot tell a comment written before the
   * assignment was switched to manual posting, which stays visible - which is
   * why Canvas's own flag is preferred. Drafts never reach rec.comments. */
  function hasHiddenComment(rec, assignment) {
    if (rec && rec.hasPostableKnown) return false;
    if (!assignment || assignment.postManually !== true) return false;
    return !!(rec && rec.comments && rec.comments.hasInstructorComment);
  }

  /** The student ids in one column with something hidden, in the order given. */
  function pendingFor(records, assignment) {
    var out = [];
    (records || []).forEach(function (rec) {
      if (needsPost(rec, assignment) && rec && rec.userId) out.push(String(rec.userId));
    });
    return out;
  }

  /** Button label / tooltip for a column with `count` submissions still hidden. */
  function summary(count) {
    var n = Number(count) || 0;
    return n + (n === 1 ? ' grade or comment is hidden from its student' : ' grades or comments are hidden from their students');
  }

  CGP.postOps = {
    hasGrade: hasGrade,
    hasHiddenComment: hasHiddenComment,
    needsPost: needsPost,
    pendingFor: pendingFor,
    summary: summary
  };
})();
