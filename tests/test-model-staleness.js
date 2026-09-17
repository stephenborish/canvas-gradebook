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

  test('reloadAssignment does not un-teach the model a column it already knows', () => {
    // post-grades.js re-reads a column by briefly clearing loadedAssignments
    // to force ensureAssignments to actually re-fetch (possibly more than
    // once per post). Painters must not read that as "never loaded" - the
    // model has perfectly good cached data for every one of its cells the
    // whole time - or every status tint, comment bubble and hidden-grade bar
    // in the column flashes away and back on every single re-read.
    const model = makeModel();
    const api = { submissionsForAssignments: () => Promise.resolve([submission({ grade: '5', score: 5, workflow_state: 'graded' })]) };
    model.api = api;
    model.loadedAssignments.add('50'); // pretend an earlier real load already happened
    model.everLoadedAssignments.add('50');

    model.loadedAssignments.delete('50'); // reloadAssignment()'s own first move
    a.eq(model.loadedAssignments.has('50'), false, 'mid-reload: temporarily not "loaded"');
    a.eq(model.everLoadedAssignments.has('50'), true, 'but never un-taught that this column is real');
  });

  test('everLoadedAssignments is populated the same moment loadedAssignments is, and stays set', () => {
    const model = makeModel();
    const api = { submissionsForAssignments: () => Promise.resolve([submission({ grade: '5', score: 5, workflow_state: 'graded' })]) };
    model.api = api;
    return model.ensureAssignments(['50']).then(() => {
      a.eq(model.loadedAssignments.has('50'), true);
      a.eq(model.everLoadedAssignments.has('50'), true);
      return model.reloadAssignment('50');
    }).then(() => {
      a.eq(model.loadedAssignments.has('50'), true, 'reloaded and loaded again');
      a.eq(model.everLoadedAssignments.has('50'), true, 'never stopped being true');
    });
  });

  test('markLocalWrite returns the prior marker, so a later failed write on the same cell can restore it', () => {
    const model = makeModel();
    // Write A succeeds (its own protection is never cleared on success).
    const priorForA = model.markLocalWrite('50', '10');
    a.eq(priorForA, undefined, 'no earlier write existed before A');
    model.patchCell('50', '10', { grade: 'A-write-result' });

    // Write B starts on the SAME cell (GradeWriter.serialize runs same-cell
    // writes one at a time, but a second, later write is still a normal
    // sequence) and then FAILS.
    const priorForB = model.markLocalWrite('50', '10');
    model.clearLocalWrite('50', '10', priorForB); // B's rollback: restore A's mark, not delete it

    // A fetch dispatched before A started (so before either write) must
    // still be recognised as stale - A's own protection must have survived
    // B's failed attempt and rollback.
    const fetchBeforeA = priorForB /* A's own timestamp */ - 10;
    model.applySubmission(submission({ grade: 'stale-pre-A-data' }),
      { silent: true, staleIfWrittenAfter: fetchBeforeA });
    a.eq(model.cell('50', '10').grade, 'A-write-result',
      'B failing and rolling back must not erase the protection A’s own successful write established');
  });
});
