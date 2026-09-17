/* The frozen Total must never disagree with Canvas's own Total column.
 *
 * Canvas scopes its OWN Total to whatever grading period is active - a URL
 * parameter, or its own server-side default when the URL says nothing - and
 * the enrollments endpoint has to be asked for that same period, or the
 * frozen Total keeps showing the whole-course score while Canvas's own
 * column (and the student's own gradebook) shows one grading period. That
 * mismatch is exactly the "two columns that both look like Total but show
 * different values" report. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

function enrollment(userId, score, overrides) {
  return Object.assign({
    id: 'e' + userId,
    user: { id: userId, name: 'Student ' + userId, short_name: 'S' + userId, sortable_name: userId },
    grades: { current_score: score, current_grade: null }
  }, overrides || {});
}

function fakeApi() {
  const calls = [];
  return {
    calls,
    studentEnrollments(courseId, gradingPeriodId) {
      calls.push({ courseId, gradingPeriodId });
      // Different scores per period, so a test can tell which one landed.
      const score = gradingPeriodId ? 50 : 90;
      return Promise.resolve([enrollment('10', score)]);
    }
  };
}

suite('grading-period-scoped Total', (test) => {
  test('the enrollments call omits grading_period_id by default (the whole course)', () => {
    const api = fakeApi();
    const model = new CGP.GradebookModel(api, '999');
    model.ready = true;
    model.students.set('10', { id: '10', currentScore: null, currentGrade: null });
    return model.reloadTotals().then(() => {
      a.eq(api.calls.length, 1);
      a.eq(api.calls[0].gradingPeriodId, null);
      a.eq(model.students.get('10').currentScore, 90);
    });
  });

  test('setGradingPeriod re-reads every student scoped to that period', () => {
    const api = fakeApi();
    const model = new CGP.GradebookModel(api, '999');
    model.ready = true;
    model.students.set('10', { id: '10', currentScore: 90, currentGrade: null });
    let totalsEmitted = 0;
    model.on('totals', () => totalsEmitted++);
    return model.setGradingPeriod('7').then(() => {
      a.eq(api.calls.length, 1, 'exactly one re-read, not one per student');
      a.eq(api.calls[0].gradingPeriodId, '7');
      a.eq(model.students.get('10').currentScore, 50, 'the period-scoped score, not the whole-course one');
      a.eq(totalsEmitted, 1, 'listeners are told to repaint');
    });
  });

  test('setGradingPeriod is a no-op when the period has not actually changed', () => {
    const api = fakeApi();
    const model = new CGP.GradebookModel(api, '999');
    model.ready = true;
    return model.setGradingPeriod(null).then(() => {
      a.eq(api.calls.length, 0, 'the model already assumed the whole course - nothing to re-read');
    });
  });

  test('learning the period before the model is ready sets it without fetching twice', () => {
    const api = fakeApi();
    const model = new CGP.GradebookModel(api, '999');
    model.ready = false; // env-bridge can win the race and arrive before init() resolves
    model.setGradingPeriod('7');
    a.eq(model.gradingPeriodId, '7', 'recorded immediately');
    a.eq(api.calls.length, 0, 'not ready yet - init() itself will use gradingPeriodId on its own first read');
  });

  test('a period learned before ready is not lost when init() already had its own read in flight', () => {
    // The race the previous test does not cover: init()'s own whole-roster
    // read started (scoped to the default period, null) BEFORE env-bridge's
    // message set the real period, and has not resolved yet when it does.
    // That in-flight read still lands with the wrong scope; the corrective
    // reload must happen once the model goes ready, not be silently dropped.
    const api = fakeApi();
    const model = new CGP.GradebookModel(api, '999');
    model.ready = false;
    model.students.set('10', { id: '10', currentScore: 90, currentGrade: null });
    model.setGradingPeriod('7');
    a.eq(api.calls.length, 0, 'queued, not fetched yet - the model is not ready');
    // init()'s own in-flight read (scoped to null, the period this model held
    // before setGradingPeriod ran) lands and flips the model ready.
    model.gradingPeriodId = '7'; // already set by setGradingPeriod above
    model._applyEnrollment(enrollment('10', 90));
    model.ready = true;
    model.emit('ready', null);
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      a.eq(api.calls.length, 1, 'the corrective reload actually ran once ready fired');
      a.eq(api.calls[0].gradingPeriodId, '7');
      a.eq(model.students.get('10').currentScore, 50, 'the period-scoped score wins, not the whole-course one');
    });
  });

  test('a single grade write refreshes one student scoped to the same period', () => {
    const api = fakeApi();
    api.enrollmentForUser = function (courseId, userId, gradingPeriodId) {
      this.calls.push({ courseId, userId, gradingPeriodId });
      return Promise.resolve(enrollment(userId, 50));
    };
    const model = new CGP.GradebookModel(api, '999');
    model.ready = true;
    model.gradingPeriodId = '7';
    model.students.set('10', { id: '10', currentScore: 90, currentGrade: null });
    model.queueTotalRefresh('10');
    return new Promise((resolve) => setTimeout(resolve, 950)).then(() => {
      const call = api.calls.find((c) => c.userId === '10');
      a.ok(call, 'enrollmentForUser was called for the written-to student');
      a.eq(call.gradingPeriodId, '7');
      a.eq(model.students.get('10').currentScore, 50);
    });
  });
});

suite('CanvasApi grading_period_id parameter', (test) => {
  function fetchStub(calls) {
    return function (url) {
      calls.push(String(url));
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('[]') });
    };
  }

  test('omitted entirely when no grading period is given', () => {
    const calls = [];
    const api = new CGP.CanvasApi({ origin: 'https://canvas.example.com', fetch: fetchStub(calls) });
    return api.studentEnrollments('5', null).then(() => {
      a.ok(!/grading_period_id/.test(calls[0]), 'no grading_period_id in ' + calls[0]);
    });
  });

  test('included when a grading period id is given', () => {
    const calls = [];
    const api = new CGP.CanvasApi({ origin: 'https://canvas.example.com', fetch: fetchStub(calls) });
    return api.studentEnrollments('5', '42').then(() => {
      a.ok(/grading_period_id=42/.test(calls[0]), 'expected grading_period_id=42 in ' + calls[0]);
    });
  });
});
