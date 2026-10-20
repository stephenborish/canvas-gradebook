/* Cell status designation, and which grades are still hidden from students. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

suite('cell status (what M and L must show immediately)', (test) => {
  const status = (rec) => CGP.gradeOps.cellStatus(rec);

  test('nothing known about a cell is not the same as "no status"', () => {
    a.eq(status(null), null);
    a.eq(status(undefined), null);
  });

  test('a plain graded submission has no status', () => {
    a.eq(status({ score: 8, grade: '8', missing: false, late: false }), 'none');
  });

  test('the optimistic patch M writes reads as Missing right away', () => {
    const patch = CGP.gradeOps.operationFor(CGP.gradeOps.parseToken('M')).patch;
    a.eq(status(patch), 'missing');
  });

  test('the second M reads as no status at all, the instant it is applied', () => {
    const patch = CGP.gradeOps.operationFor(CGP.gradeOps.parseToken('M'), { wasExplicitMissing: true }).patch;
    a.eq(status(patch), 'none');
  });

  test('L applies Late and L again leaves no status', () => {
    const on = CGP.gradeOps.operationFor(CGP.gradeOps.parseToken('L')).patch;
    a.eq(status(on), 'late');
    const off = CGP.gradeOps.operationFor(CGP.gradeOps.parseToken('L'), { wasLate: true }).patch;
    a.eq(status(off), 'none');
  });

  test('Excused wins over a late submission', () => {
    a.eq(status({ excused: true, late: true, latePolicyStatus: 'late' }), 'excused');
  });

  test('Canvas’s derived booleans count, not just an explicit status', () => {
    a.eq(status({ late: true, latePolicyStatus: null }), 'late', 'handed in after the due date');
    a.eq(status({ missing: true, latePolicyStatus: null }), 'missing', 'past due, nothing handed in');
  });

  test('Canvas\'s own missing flag is shown as it is - the grade is never used to second-guess it', () => {
    // The tray, SpeedGrader and the student all show Canvas's missing; a cell
    // that decided otherwise from its grade (as this once did) disagreed.
    // A graded cell Canvas still calls missing is a policy-applied score or
    // an applied status, and it IS missing everywhere else.
    a.eq(status({ score: 3, grade: '3', missing: true, latePolicyStatus: null }), 'missing', 'missing-policy score');
    a.eq(status({ score: 0, grade: '0', missing: true, latePolicyStatus: null }), 'missing', 'zero');
    a.eq(status({ score: 0, grade: '0', missing: false, latePolicyStatus: null }), 'none', 'a zero alone is never missing');
    a.eq(status({ score: 5, grade: '5', missing: false, late: true, latePolicyStatus: null }), 'late', 'submitted late');
    a.eq(status({ missing: true, latePolicyStatus: 'none' }), 'none', 'explicit none status clears missing');
    a.eq(status({ score: 0, missing: true, latePolicyStatus: 'missing' }), 'missing', 'explicit missing remains missing');
    a.eq(status({ score: 9, missing: false, latePolicyStatus: 'missing' }), 'missing', 'an applied status wins over the flag');
  });

  test('a custom grade status is Canvas\'s, never painted over as missing or late', () => {
    a.eq(status({ customStatusId: '4', missing: true, late: true }), 'custom');
    a.eq(CGP.gradeOps.PAINTED_STATUSES.indexOf('custom'), -1);
  });

  test('resubmitted means a real student submission after grading, as in Canvas', () => {
    const r = CGP.gradeOps.resubmitted;
    a.eq(r({ submissionType: 'online_upload', workflowState: 'submitted', gradeMatchesCurrent: false }), true);
    a.eq(r({ submissionType: 'online_upload', workflowState: 'graded', gradeMatchesCurrent: true }), false);
    a.eq(r({ submissionType: null, workflowState: 'graded', gradeMatchesCurrent: false }), false, 'paper / no submission: nothing was handed in');
    a.eq(r({ submissionType: 'online_upload', workflowState: 'submitted', gradeMatchesCurrent: false, excused: true }), false);
    a.eq(r({ submissionType: 'online_upload', workflowState: 'unsubmitted', gradeMatchesCurrent: false }), false);
  });

  test('a status Canvas owns and we do not is reported as-is, never as "none"', () => {
    a.eq(status({ latePolicyStatus: 'extended' }), 'extended');
    a.eq(CGP.gradeOps.PAINTED_STATUSES.indexOf('extended'), -1, 'and it is not one we paint');
  });

  test('clearing a cell clears its status too', () => {
    const patch = CGP.gradeOps.operationFor(CGP.gradeOps.parseToken('-')).patch;
    a.eq(status(patch), 'none');
  });
});

suite('grades waiting to be posted', (test) => {
  const ops = () => CGP.postOps;
  const rec = (over) => Object.assign({
    userId: '1', postedAtKnown: true, postedAt: null,
    score: 9, grade: '9', gradedAt: '2026-02-02T00:00:00Z', workflowState: 'graded'
  }, over || {});

  test('a graded, unposted submission is waiting', () => {
    a.eq(ops().needsPost(rec()), true);
  });

  test('an already posted grade is not', () => {
    a.eq(ops().needsPost(rec({ postedAt: '2026-02-03T00:00:00Z' })), false);
  });

  test('an ungraded submission is not - there is nothing to show a student', () => {
    a.eq(ops().needsPost(rec({ score: null, grade: null, gradedAt: null })), false);
  });

  test('excused counts as something to post', () => {
    a.eq(ops().needsPost(rec({ score: null, grade: null, gradedAt: null, excused: true })), true);
  });

  test('a zero is a grade', () => {
    a.eq(ops().needsPost(rec({ score: 0, grade: '0' })), true);
  });

  test('a quiz question still pending review is not - Canvas will not post it either', () => {
    // The gradebook can show a partial auto-graded score while a submission
    // still needs a manual look (a quiz's essay question, most commonly).
    // Canvas's own postAssignmentGrades(gradedOnly: true) only posts
    // workflow_state "graded", so counting this one would inflate the
    // button's number and then post nothing for it.
    a.eq(ops().needsPost(rec({ workflowState: 'pending_review' })), false);
  });

  test('a Canvas build that never told us stays silent rather than guessing', () => {
    a.eq(ops().needsPost(rec({ postedAtKnown: false })), false);
  });

  test('a cell with our own write still in flight is left out', () => {
    a.eq(ops().needsPost(rec({ pending: true })), false);
  });

  test('pendingFor lists exactly the hidden ones, in order', () => {
    const ids = ops().pendingFor([
      rec({ userId: '10' }),
      rec({ userId: '11', postedAt: '2026-02-03T00:00:00Z' }),
      rec({ userId: '12', score: null, grade: null, gradedAt: null }),
      rec({ userId: '13' })
    ]);
    a.deep(ids, ['10', '13']);
  });

  const ungraded = { score: null, grade: null, gradedAt: null, workflowState: 'unsubmitted' };
  const withComment = { comments: { hasInstructorComment: true } };
  const manual = { postManually: true };

  test('an instructor comment on an ungraded, unposted submission is waiting (manual policy)', () => {
    a.eq(ops().needsPost(rec(Object.assign({}, ungraded, withComment)), manual), true);
  });

  test('a comment-only cell is not waiting under an automatic policy', () => {
    a.eq(ops().needsPost(rec(Object.assign({}, ungraded, withComment)), { postManually: false }), false);
    a.eq(ops().needsPost(rec(Object.assign({}, ungraded, withComment))), false);
  });

  test('an already posted comment-only cell is not waiting', () => {
    a.eq(ops().needsPost(rec(Object.assign({ postedAt: '2026-02-03T00:00:00Z' }, ungraded, withComment)), manual), false);
  });

  test('no instructor comment and no grade is still nothing to post', () => {
    a.eq(ops().needsPost(rec(Object.assign({ comments: { hasInstructorComment: false } }, ungraded)), manual), false);
  });

  test('pendingFor counts comment-only cells when given the assignment', () => {
    const ids = ops().pendingFor([
      rec({ userId: '20' }),
      rec(Object.assign({ userId: '21' }, ungraded, withComment)),
      rec(Object.assign({ userId: '22' }, ungraded))
    ], manual);
    a.deep(ids, ['20', '21']);
  });

  test('Canvas\'s has_postable_comments wins over inference, both ways', () => {
    const asked = Object.assign({}, ungraded, withComment, { hasPostableKnown: true });
    a.eq(ops().needsPost(rec(Object.assign({}, asked, { hasPostableComments: true })), manual), true, 'Canvas says a comment is hidden');
    a.eq(ops().needsPost(rec(Object.assign({}, asked, { hasPostableComments: true, postedAt: '2026-02-03T00:00:00Z' })), manual), true, 'even with a posted_at');
    a.eq(ops().needsPost(rec(Object.assign({}, asked, { hasPostableComments: false })), manual), false,
      'a comment written before the policy went manual is visible: Canvas says nothing is postable');
    a.eq(ops().needsPost(rec(Object.assign({}, asked, { hasPostableComments: true, pending: true })), manual), false, 'our own write in flight');
    a.eq(ops().needsPost(rec(Object.assign({ hasPostableKnown: true, hasPostableComments: false })), manual), true, 'a graded, unposted submission is still waiting');
  });

  test('summary counts in plain words', () => {
    a.eq(ops().summary(1), '1 grade or comment is hidden from its student');
    a.eq(ops().summary(4), '4 grades or comments are hidden from their students');
  });
});
