/* A background column read that was already in flight when a keyboard
 * shortcut (or a comment) writes to one of its cells must not silently
 * revert that write once it lands - see model.markLocalWrite /
 * applySubmission. This is the "M/E/L do nothing until I refresh" bug: the
 * write took, but a slower, already-in-flight read for the same column
 * landed afterwards carrying the pre-write state. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

function makeModel() {
  // No real Canvas API needed for these assertions - nothing here calls it.
  const model = new CGP.GradebookModel({}, '999');
  model.instructorId = '1';
  model.assignments.set('50', { id: '50', name: 'HW 1', gradingType: 'points' });
  model.students.set('10', { id: '10', name: 'A Student' });
  return model;
}

function submission(overrides) {
  return Object.assign({
    id: '1', assignment_id: '50', user_id: '10',
    score: null, grade: null, missing: false, late: false,
    late_policy_status: null, workflow_state: 'unsubmitted'
  }, overrides || {});
}

suite('stale column-fetch protection', (test) => {
  test('a fetch that started before a local write is dropped once it lands', () => {
    const model = makeModel();
    const fetchStartedAt = Date.now();
    model.markLocalWrite('50', '10'); // the write "began" after the fetch went out
    model.patchCell('50', '10', { missing: true, grade: '0', pending: false, override: '0' });

    // The stale response finally arrives, carrying the pre-write state.
    model.applySubmission(submission(), { silent: true, staleIfWrittenAfter: fetchStartedAt });

    const rec = model.cell('50', '10');
    a.eq(rec.missing, true, 'the write must survive a stale, already-in-flight read');
    a.eq(rec.grade, '0');
  });

  test('a fetch that started after the write is applied normally', () => {
    const model = makeModel();
    model.markLocalWrite('50', '10');
    model.patchCell('50', '10', { missing: true, grade: '0' });
    const fetchStartedAt = Date.now() + 5; // definitely after the write above

    model.applySubmission(submission({ missing: true, grade: '0', late_policy_status: 'missing' }),
      { silent: true, staleIfWrittenAfter: fetchStartedAt });

    const rec = model.cell('50', '10');
    a.eq(rec.missing, true);
    a.eq(rec.workflowState, 'unsubmitted', 'a fresher fetch still replaces the record as normal');
  });

  test('a cell with no local write is never treated as stale', () => {
    const model = makeModel();
    model.applySubmission(submission({ grade: '5', score: 5, workflow_state: 'graded' }),
      { silent: true, staleIfWrittenAfter: Date.now() + 1000 });
    const rec = model.cell('50', '10');
    a.eq(rec.grade, '5');
  });

  test('addComment-style local writes are tracked the same way', () => {
    const model = makeModel();
    model.markLocalWrite('50', '10');
    model.patchCell('50', '10', { commentList: [{ id: 'x', author_id: '1', comment: 'good work' }] });
    const staleFetchStartedAt = Date.now() - 50;
    model.applySubmission(submission(), { silent: true, staleIfWrittenAfter: staleFetchStartedAt });
    const rec = model.cell('50', '10');
    a.eq(rec.commentList.length, 1, 'a just-added comment must not be wiped by a stale column read');
  });
});
