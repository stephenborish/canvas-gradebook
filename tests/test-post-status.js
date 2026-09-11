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

  test('the second M reads as Late the instant it is applied', () => {
    const patch = CGP.gradeOps.operationFor(CGP.gradeOps.parseToken('M'), { wasExplicitMissing: true }).patch;
    a.eq(status(patch), 'late');
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
    score: 9, grade: '9', gradedAt: '2026-02-02T00:00:00Z'
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

  test('summary counts in plain words', () => {
    a.eq(ops().summary(1), '1 grade is hidden from its student');
    a.eq(ops().summary(4), '4 grades are hidden from their students');
  });
});
