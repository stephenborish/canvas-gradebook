/* GradebookModel.init() used to read currentUser() before even STARTING the
 * assignments/enrollments fetch (one straight .then() chain), which put a
 * whole extra network round trip in front of model.ready - and therefore in
 * front of content.js's very first ensureAssignments() call for the columns
 * on screen - for no reason the data itself required. That is a real slice
 * of the "icons/status colors take too long to appear" report: not a
 * per-cell painting cost, but unforced serial latency before the first paint
 * that could show anything at all.
 *
 * These tests assert the FIX at the level that actually matters: every
 * request init() needs is issued before any of them has to resolve, and
 * init() still produces a fully correct, ready model no matter which of the
 * three responses happens to land last. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

function enrollment(userId, score) {
  return {
    id: 'e' + userId,
    user: { id: userId, name: 'Student ' + userId, short_name: 'S' + userId, sortable_name: userId },
    grades: { current_score: score, current_grade: null }
  };
}

/* Every endpoint hands back a promise this test controls the settling of, so
 * the assertions can check "has everything been REQUESTED yet" independently
 * of "has everything RESOLVED yet" - the only way to actually prove the three
 * calls run concurrently rather than one waiting on another. */
function deferredApi() {
  const calls = [];
  const pending = {};
  function makeDeferred(name) {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    pending[name] = resolve;
    return function (...args) {
      calls.push({ name, args });
      return promise;
    };
  }
  return {
    calls,
    resolve(name, value) { pending[name](value); },
    currentUser: makeDeferred('currentUser'),
    assignments: makeDeferred('assignments'),
    studentEnrollments: makeDeferred('studentEnrollments')
  };
}

suite('model.init() issues its requests in parallel, not one after another', (test) => {
  test('assignments() and studentEnrollments() are called without waiting for currentUser() to resolve', () => {
    const api = deferredApi();
    const model = new CGP.GradebookModel(api, '999');
    model.init(); // deliberately not awaited: nothing has resolved yet

    // If currentUser() were still chained in front of the rest (the old,
    // sequential version of init()), assignments()/studentEnrollments()
    // would not have been called yet at all - they'd be waiting on a
    // .then() that cannot run until this deferred currentUser() promise
    // settles, which this test never does before checking.
    const names = api.calls.map((c) => c.name).sort();
    a.deep(names, ['assignments', 'currentUser', 'studentEnrollments'],
      'all three requests must already be in flight before any of them resolves');
  });

  test('a slow currentUser() does not block assignments/enrollments from being requested, and init() still resolves correctly once everything lands', () => {
    const api = deferredApi();
    const model = new CGP.GradebookModel(api, '999');
    const initPromise = model.init();

    // Resolve the data endpoints FIRST, currentUser() LAST - the reverse of
    // the old code's required order - to prove init() does not assume any
    // particular arrival order among the three.
    api.resolve('assignments', [{ id: '50', name: 'HW 1', points_possible: 10 }]);
    api.resolve('studentEnrollments', [enrollment('10', 90)]);

    return Promise.resolve().then(() => {
      // Not ready yet: currentUser() has still not resolved, and init()'s
      // own Promise.all must wait for every one of the three, not just two.
      a.not(model.ready, 'model must not be ready until every request has landed');
      // Model.init() reads currentUser()'s ALREADY-TRANSFORMED shape (see
      // CanvasApi.currentUser() in canvas-api.js), not raw Canvas JSON -
      // camelCase, matching what the real api object hands back.
      api.resolve('currentUser', { id: '7', name: 'Teacher', shortName: 'T', sortableName: 'Teacher Sortable' });
      return initPromise;
    }).then(() => {
      a.ok(model.ready, 'ready once everything has actually arrived');
      a.eq(model.instructorId, '7');
      a.deep(model.instructorNames, ['Teacher', 'T', 'Teacher Sortable']);
      a.eq(model.assignments.get('50').name, 'HW 1');
      a.eq(model.students.get('10').currentScore, 90);
    });
  });

  test('a slow assignments()/enrollments() pair does not block on a fast currentUser(), and the model still ends up fully populated', () => {
    const api = deferredApi();
    const model = new CGP.GradebookModel(api, '999');
    const initPromise = model.init();

    api.resolve('currentUser', { id: '3', name: 'Fast Teacher', short_name: 'FT', sortable_name: 'Fast Teacher' });

    return Promise.resolve().then(() => {
      a.not(model.ready, 'the data itself has not arrived yet, regardless of currentUser() landing first');
      api.resolve('assignments', [{ id: '60', name: 'Quiz 1', points_possible: 20 }]);
      api.resolve('studentEnrollments', [enrollment('20', 75)]);
      return initPromise;
    }).then(() => {
      a.ok(model.ready);
      a.eq(model.instructorId, '3');
      a.eq(model.assignments.get('60').name, 'Quiz 1');
      a.eq(model.students.get('20').currentScore, 75);
    });
  });
});
