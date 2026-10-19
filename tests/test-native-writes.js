/* A grade, status or comment saved through Canvas's own Grade Detail Tray
 * (or in SpeedGrader) never reached the model, so the cell kept its old
 * record - no comment bubble, no M badge, and Canvas's own fresh "missing"
 * class was stripped as stale. The page-world watcher (write-watch.js) now
 * reports Canvas's successful submission writes (ids only) so the content
 * script can re-read that one cell, or tell the other tabs. */
'use strict';

const fs = require('fs');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

function loadBridge(where) {
  where = where || {};
  const posted = [];
  const xhrs = [];
  function FakeXHR() { this.listeners = {}; this.status = 0; xhrs.push(this); }
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.send = function () {};
  FakeXHR.prototype.addEventListener = function (type, fn) { this.listeners[type] = fn; };
  FakeXHR.prototype.finish = function (status) { this.status = status; if (this.listeners.loadend) this.listeners.loadend.call(this); };
  const fetchResults = [];
  const pathname = where.pathname || '/courses/379/gradebook';
  const search = where.search || '';
  const win = {
    ENV: {},
    location: { origin: 'https://canvas.example.edu', href: 'https://canvas.example.edu' + pathname + search, pathname: pathname, search: search, hash: where.hash || '' },
    addEventListener: function () {},
    postMessage: function (message) { posted.push(message); },
    XMLHttpRequest: FakeXHR,
    fetch: function () { const p = Promise.resolve(fetchResults.shift() || { ok: true }); return p; }
  };
  const context = {
    window: win, document: { querySelector: function () { return null; }, addEventListener: function () {} },
    Promise, Object, Array, String, Number, Math, JSON, URL, URLSearchParams, isFinite, Date,
    atob: (v) => Buffer.from(String(v), 'base64').toString('binary'),
    setTimeout: function () {}, setInterval: function () { return 1; }, clearInterval: function () {}
  };
  vm.runInNewContext(fs.readFileSync('src/page/write-watch.js', 'utf8'), context);
  const writes = () => posted.filter((m) => m.source === 'cgp-native-write');
  return { win, writes, xhrs, fetchResults };
}

suite('Canvas-native writes reach the model', (test) => {
  test('a tray status/comment PUT is reported once it succeeds', () => {
    const { win, writes } = loadBridge();
    const xhr = new win.XMLHttpRequest();
    xhr.open('PUT', '/api/v1/courses/379/assignments/50/submissions/10');
    xhr.send('{"submission":{"late_policy_status":"missing"}}');
    a.eq(writes().length, 0, 'nothing before Canvas answers');
    xhr.finish(200);
    a.deep(writes().map((m) => [m.courseId, m.assignmentId, m.userId]), [['379', '50', '10']]);
    a.eq(Object.keys(writes()[0]).sort().join(','), 'assignmentId,courseId,source,userId', 'ids only');
  });

  test('a comment-only write is flagged so it can never take Missing off', () => {
    const { win, writes } = loadBridge();
    const comment = new win.XMLHttpRequest();
    comment.open('PUT', '/api/v1/courses/379/assignments/50/submissions/10');
    comment.send('{"comment":{"text_comment":"see me"}}');
    comment.finish(200);
    const status = new win.XMLHttpRequest();
    status.open('PUT', '/api/v1/courses/379/assignments/50/submissions/10');
    status.send('comment%5Btext_comment%5D=hi&submission%5Bposted_grade%5D=3');
    status.finish(200);
    a.eq(writes()[0].commentOnly, true);
    a.eq(writes()[1].commentOnly, undefined, 'a grade sent with a comment is not comment-only');
  });

  test('classic SpeedGrader\'s comment save (the plain, non-API route) is reported as comment-only', () => {
    const { win, writes } = loadBridge({ pathname: '/courses/379/gradebook/speed_grader', search: '?assignment_id=50' });
    const xhr = new win.XMLHttpRequest();
    xhr.open('PUT', '/courses/379/assignments/50/submissions/10');
    xhr.send('submission%5Bassignment_id%5D=50&submission%5Bgroup_comment%5D=0&submission%5Bcomment%5D=nice&submission%5Buser_id%5D=10');
    xhr.finish(200);
    const graded = new win.XMLHttpRequest();
    graded.open('PUT', '/courses/379/assignments/50/submissions/10');
    graded.send('submission%5Bcomment%5D=nice&submission%5Bgrade%5D=4');
    graded.finish(200);
    a.deep(writes().map((m) => [m.assignmentId, m.userId, m.commentOnly]), [['50', '10', true], ['50', '10', undefined]]);
  });

  test('a reused XHR reports only the request it is finishing', () => {
    const { win, writes } = loadBridge();
    const xhr = new win.XMLHttpRequest();
    xhr.open('PUT', '/api/v1/courses/379/assignments/50/submissions/10');
    xhr.send(null);
    xhr.finish(200);
    xhr.open('GET', '/api/v1/courses/379/assignments/50/submissions/10');
    xhr.send(null);
    xhr.finish(200);
    a.eq(writes().length, 1);
  });

  test('failed writes, reads and other origins are not reported', () => {
    const { win, writes } = loadBridge();
    const failed = new win.XMLHttpRequest();
    failed.open('PUT', '/api/v1/courses/379/assignments/50/submissions/10');
    failed.send(null);
    failed.finish(422);
    const read = new win.XMLHttpRequest();
    read.open('GET', '/api/v1/courses/379/assignments/50/submissions/10');
    read.send(null);
    read.finish(200);
    const other = new win.XMLHttpRequest();
    other.open('PUT', 'https://elsewhere.example.com/api/v1/courses/379/assignments/50/submissions/10');
    other.send(null);
    other.finish(200);
    a.eq(writes().length, 0);
  });

  test('legacy update_submission and comment edits are reported', async () => {
    const { win, writes } = loadBridge();
    const legacy = new win.XMLHttpRequest();
    legacy.open('POST', '/courses/379/gradebook/update_submission');
    legacy.send('submission%5Bassignment_id%5D=50&submission%5Buser_id%5D=10&submission%5Bgrade%5D=5');
    legacy.finish(200);
    await win.fetch('/submission_comments/77', { method: 'DELETE' });
    await Promise.resolve();
    a.deep(writes().map((m) => m.commentId || (m.assignmentId + ':' + m.userId)), ['50:10', '77']);
  });

  test('SpeedGrader 2 saves through GraphQL: the student comes from its URL', async () => {
    const { win, writes } = loadBridge({ pathname: '/courses/379/gradebook/speed_grader', search: '?assignment_id=50&student_id=10' });
    await win.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({
      operationName: 'UpdateSubmissionGrade', query: 'mutation UpdateSubmissionGrade($submissionId: ID!) { x }', variables: { submissionId: 'U3VibWlzc2lvbi05' }
    }) });
    await Promise.resolve();
    a.deep(writes().map((m) => [m.courseId, m.assignmentId, m.userId, m.graphql]), [['379', '50', '10', true]]);
  });

  test('a posting mutation names its column (relay id decoded); a query is not a write', async () => {
    const { win, writes } = loadBridge();
    await win.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({
      query: 'query Grades { assignment(id: 1) { name } }'
    }) });
    await win.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({
      query: 'mutation PostAssignmentGrades($assignmentId: ID!) { postAssignmentGrades(input: {assignmentId: $assignmentId}) { progress { _id } } }',
      variables: { assignmentId: Buffer.from('Assignment-50').toString('base64') }
    }) });
    await win.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({
      query: 'mutation SaveSettings { updateSpeedGraderSettings(input: {}) { x } }', variables: {}
    }) });
    await Promise.resolve();
    a.deep(writes().map((m) => [m.assignmentId, m.userId, m.graphql]), [['50', undefined, true]],
      'one write for the column, none for the read or an unrelated mutation');
  });

  test('Canvas\'s bulk dialogs report their column', () => {
    const { win, writes } = loadBridge();
    const bulk = new win.XMLHttpRequest();
    bulk.open('POST', '/courses/379/gradebook/update_submission');
    bulk.send('submissions%5B0%5D%5Bassignment_id%5D=50&submissions%5B0%5D%5Buser_id%5D=10&submissions%5B0%5D%5Bgrade%5D=5');
    bulk.finish(200);
    a.deep(writes().map((m) => [m.assignmentId, m.userId, m.bulk]), [['50', undefined, true]]);
  });

  test('a Canvas write still out (or begun after a read) is visible to the store hand-off', async () => {
    const { win } = loadBridge();
    const before = Date.now();
    const xhr = new win.XMLHttpRequest();
    xhr.open('PUT', '/api/v1/courses/379/assignments/50/submissions/10');
    xhr.send('submission%5Bposted_grade%5D=4');
    const out = win.__cgpNativeWrites.state('50', '10');
    a.eq(out.pending, 1);
    a.ok(out.lastStartedAt >= before);
    xhr.finish(200);
    a.eq(win.__cgpNativeWrites.state('50', '10').pending, 0);
    a.eq(win.__cgpNativeWrites.state('51', '10'), null);
  });

  test('a refresh with an empty comment list clears the bubble', () => {
    const model = new CGP.GradebookModel({}, '379');
    model.instructorId = '1';
    model.commentVerifiedAssignments.add('50');
    const base = { id: '9', assignment_id: '50', user_id: '10', workflow_state: 'unsubmitted' };
    model.applySubmission(Object.assign({}, base, { submission_comments: [{ id: '77', author_id: '1', comment: 'hi' }] }));
    a.eq(model.cell('50', '10').comments.hasInstructorComment, true);
    a.deep(model.cellForComment('77'), { assignmentId: '50', userId: '10' });
    model.applySubmission(Object.assign({}, base, { submission_comments: [] }), { commentsAuthoritative: true });
    a.eq(model.cell('50', '10').comments.hasInstructorComment, false);
    a.eq(model.cellForComment('77'), null);
  });

  test('a refresh carries a status set in the tray', async () => {
    const api = { submission: () => Promise.resolve({ id: '9', assignment_id: '50', user_id: '10', missing: true, late_policy_status: 'missing', submission_comments: [{ id: '78', author_id: '1', comment: 'checking in' }] }) };
    const model = new CGP.GradebookModel(api, '379');
    model.instructorId = '1';
    model.applySubmission({ id: '9', assignment_id: '50', user_id: '10', workflow_state: 'unsubmitted' });
    await model.refreshCell('50', '10', { commentsAuthoritative: true, staleIfWrittenAfter: Date.now() });
    const rec = model.cell('50', '10');
    a.eq(CGP.gradeOps.cellStatus(rec), 'missing');
    a.eq(rec.comments.hasInstructorComment, true);
  });
});
