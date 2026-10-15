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
    // init()'s own whole-roster read starts scoped to the default period
    // (null), then env-bridge's message sets the real period before that
    // read lands. The roster it brings is fine; its scores are for the wrong
    // period, so a corrective totals read must follow once ready.
    const api = fakeApi();
    let releaseFirst;
    const firstRead = new Promise((r) => { releaseFirst = r; });
    let first = true;
    api.studentEnrollments = function (courseId, gradingPeriodId) {
      this.calls.push({ courseId, gradingPeriodId });
      if (first) { first = false; return firstRead; }
      return Promise.resolve([enrollment('10', gradingPeriodId ? 50 : 90)]);
    };
    api.currentUser = () => Promise.resolve({ id: '1', name: 'T' });
    api.assignments = () => Promise.resolve([]);
    const model = new CGP.GradebookModel(api, '999');
    const done = model.init();
    model.setGradingPeriod('7');
    releaseFirst([enrollment('10', 90)]);
    return done.then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(() => {
      a.eq(api.calls.length, 2, 'the corrective reload ran once ready');
      a.eq(api.calls[0].gradingPeriodId, null, 'init read with the period it knew at the time');
      a.eq(api.calls[1].gradingPeriodId, '7');
      a.eq(model.students.get('10').currentScore, 50, 'the period-scoped score wins, not the whole-course one');
    });
  });

  test('"All Grading Periods" (0) means the whole course, not a period id', () => {
    const api = fakeApi();
    const model = new CGP.GradebookModel(api, '999');
    model.ready = true;
    model.gradingPeriodId = '7';
    model.students.set('10', { id: '10', currentScore: 50, currentGrade: null });
    return model.setGradingPeriod('0').then(() => {
      a.eq(model.gradingPeriodId, null);
      a.eq(api.calls[0].gradingPeriodId, null);
    });
  });

  test('an older totals read that lands last never overwrites a newer one', () => {
    const api = fakeApi();
    const releases = [];
    api.studentEnrollments = function (courseId, gradingPeriodId) {
      this.calls.push({ courseId, gradingPeriodId });
      return new Promise((r) => releases.push(() => r([enrollment('10', gradingPeriodId === '7' ? 70 : 80)])));
    };
    const model = new CGP.GradebookModel(api, '999');
    model.ready = true;
    model.students.set('10', { id: '10', currentScore: null, currentGrade: null });
    const p1 = model.setGradingPeriod('7');
    const p2 = model.setGradingPeriod('8');
    releases[1]();
    releases[0]();
    return Promise.all([p1, p2]).then(() => {
      a.eq(model.students.get('10').currentScore, 80, 'period 8 (the newest) wins');
    });
  });

  test('the Total prefers the teacher-facing unposted score when Canvas sends it', () => {
    const model = new CGP.GradebookModel(fakeApi(), '999');
    model._applyEnrollment(enrollment('10', 60, {
      grades: { current_score: 60, current_grade: 'D', unposted_current_score: 88, unposted_current_grade: 'B+' }
    }));
    a.eq(model.students.get('10').currentScore, 88);
    a.eq(model.students.get('10').currentGrade, 'B+');
    model._applyEnrollment(enrollment('11', 75));
    a.eq(model.students.get('11').currentScore, 75, 'falls back to current_score');
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
