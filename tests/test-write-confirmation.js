/* How the extension decides a grade was saved, or a column posted.
 *
 * The bugs this pins down: Canvas (or something in front of it) answered a
 * grade PUT with HTTP 200 and its HTML sign-in page, and the writer counted
 * that as one successful save; a posting mutation whose answer held no
 * postAssignmentGrades payload was read as "posted synchronously". Both
 * now go through the real client and writer against a fake Canvas, and
 * every case also counts the writes that reached Canvas: an answer that
 * can't be read is settled by READING the record again, never by sending
 * the write a second time. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

['src/gradebook/writer.js', 'src/gradebook/post-grades.js'].forEach((rel) => {
  if (rel.endsWith('writer.js') && CGP.GradeWriter) return;
  if (rel.endsWith('post-grades.js') && CGP.PostGradesController) return;
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
});

const said = [];
function stubUi() {
  said.length = 0;
  CGP.ui = {
    toast: (m, o) => said.push({ level: (o && o.level) || 'info', text: String(m), action: (o && o.action) || null }),
    error: (m, o) => said.push({ level: 'error', text: String(m), action: (o && o.action) || null })
  };
}
const last = () => said[said.length - 1];

const SIGN_IN_PAGE = '<!DOCTYPE html><html><head><title>Log In to Canvas</title></head>' +
  '<body><form action="/login/canvas">Log in</form></body></html>';

/* A fake Canvas behind the real CanvasApi. `routes` maps "METHOD /path-regex"
 * to a queue of answers: { status, body, headers, url } or 'network'. Calls
 * to anything else (the Total's enrollment re-reads) answer an empty list. */
function fakeCanvas(routes) {
  const calls = [];
  const queues = Object.keys(routes).map((k) => {
    const [method, rx] = k.split(' ');
    return { method, rx: new RegExp(rx), answers: routes[k].slice() };
  });
  const api = new CGP.CanvasApi({
    origin: 'https://x.instructure.com',
    fetch: (url, init) => {
      const u = new URL(url);
      const route = queues.find((q) => q.method === init.method && q.rx.test(u.pathname));
      if (!route) return Promise.resolve(answer({ status: 200, body: '[]' }, url));
      calls.push({ method: init.method, path: u.pathname, body: init.body });
      const r = route.answers.length > 1 ? route.answers.shift() : route.answers[0];
      if (r === 'network' || r === undefined) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(answer(r, url));
    }
  });
  const count = (method, rx) => calls.filter((c) => c.method === method && rx.test(c.path)).length;
  return { api, calls, count };
}

function answer(r, url) {
  const headers = Object.assign({}, r.headers || {});
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    url: r.url || url,
    redirected: !!r.url,
    text: () => Promise.resolve(r.body === undefined ? '' : r.body),
    headers: { get: (h) => headers[h] || headers[h.toLowerCase()] || null }
  };
}

const json = (status, obj) => ({ status, body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const html = (status, body, extra) => Object.assign({ status, body, headers: { 'Content-Type': 'text/html; charset=utf-8' } }, extra || {});
const sub = (fields) => json(200, Object.assign({ id: '1', assignment_id: '50', user_id: '10', workflow_state: 'graded' }, fields));

const SUB_PATH = '/api/v1/courses/7/assignments/50/submissions/10$';
const PUT = /\/submissions\/10$/;

function setup(routes) {
  stubUi();
  const canvas = fakeCanvas(routes);
  const m = new CGP.GradebookModel(canvas.api, '7');
  m.ready = true;
  m.instructorId = '1';
  m.assignments.set('50', { id: '50', name: 'Lab 4', gradingType: 'points' });
  m.students.set('10', { id: '10', name: 'Ada' });
  m.studentOrder.push('10');
  m.loadedAssignments.add('50');
  m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', grade: '8', score: 8, entered_grade: '8', workflow_state: 'graded' });
  const w = new CGP.GradeWriter({ api: canvas.api, model: m, settings: { values: {} } });
  const write = (token) => w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken(token) }]);
  return Object.assign({ m, w, write }, canvas);
}

suite('grade writes: a 2xx is success only when it carries the submission', (test) => {
  test('an HTML sign-in page with HTTP 200 is not a save (the reported bug)', async () => {
    const h = setup({
      ['PUT ' + SUB_PATH]: [html(200, SIGN_IN_PAGE, { url: 'https://x.instructure.com/login/canvas' })],
      ['GET ' + SUB_PATH]: [html(200, SIGN_IN_PAGE, { url: 'https://x.instructure.com/login/canvas' })]
    });
    const res = await h.write('9');
    a.eq(res.ok, 0, 'not counted as saved');
    a.eq(res.failed, 0, 'not counted as refused either');
    a.eq(res.unconfirmed.length, 1);
    a.eq(h.count('PUT', PUT), 1, 'the grade was sent once');
    a.eq(h.count('GET', PUT), 1, 'and the record was re-read to check');
    a.eq(last().level, 'error');
    a.ok(/^Couldn’t confirm this grade/.test(last().text), last().text);
    a.ok(/sign-in page/.test(last().text), 'says what Canvas answered: ' + last().text);
    a.ok(!/unchanged/i.test(last().text), 'never claims the cell was left unchanged');
    a.eq(last().action && last().action.label, 'Check again');
    const cell = h.m.cell('50', '10');
    a.ok(!cell.pending, 'not left spinning');
    a.eq(cell.grade, '8', 'the unconfirmed 9 is not shown as saved');
  });

  test('other malformed success answers are unconfirmed too, each sent once', async () => {
    const bodies = [
      { status: 200, body: '' },
      json(200, {}),
      json(200, { data: null }),
      json(200, []),
      json(200, { id: '2', assignment_id: '50', user_id: '11', grade: '9' }), // someone else's record
      { status: 204, body: '' }
    ];
    for (const b of bodies) {
      const h = setup({ ['PUT ' + SUB_PATH]: [b], ['GET ' + SUB_PATH]: ['network'] });
      const res = await h.write('9');
      a.eq(res.ok, 0, 'not saved: ' + b.body);
      a.eq(res.unconfirmed.length, 1, 'unconfirmed: ' + b.body);
      a.eq(h.count('PUT', PUT), 1, 'one PUT for ' + b.body);
      a.ok(/^Couldn’t confirm this grade/.test(last().text), last().text);
      a.ok(/couldn’t be re-read/.test(last().text), 'says the re-check failed too');
    }
  });

  test('a well-formed answer is still a plain save, with no re-read', async () => {
    const h = setup({ ['PUT ' + SUB_PATH]: [sub({ grade: '9', score: 9, entered_grade: '9' })] });
    const res = await h.write('9');
    a.eq(res.ok, 1);
    a.eq(res.unconfirmed.length, 0);
    a.eq(h.count('GET', PUT), 0);
    a.eq(said.filter((s) => s.level === 'error').length, 0);
    a.eq(h.m.cell('50', '10').grade, '9');
  });
});

suite('grade writes: a lost answer is settled by reading, never by resending', (test) => {
  test('connection lost after Canvas applied the grade: confirmed by the re-read, one PUT', async () => {
    const h = setup({
      ['PUT ' + SUB_PATH]: ['network'],
      ['GET ' + SUB_PATH]: [sub({ grade: '9', score: 9, entered_grade: '9' })]
    });
    const res = await h.write('9');
    a.eq(h.count('PUT', PUT), 1, 'never sent a second time');
    a.eq(res.ok, 1, 'saved, because Canvas shows it saved');
    a.eq(res.confirmedOnReread, 1);
    a.eq(said.filter((s) => s.level === 'error').length, 0, 'nothing alarming said');
    a.eq(h.m.cell('50', '10').grade, '9');
    a.eq(h.m.cell('50', '10').override, '9', 'shown over Canvas’s stale grid cell');
  });

  test('a 502 after Canvas applied the grade: same, one PUT', async () => {
    const h = setup({
      ['PUT ' + SUB_PATH]: [html(502, '<html>Bad Gateway</html>')],
      ['GET ' + SUB_PATH]: [sub({ grade: '9', score: 9, entered_grade: '9' })]
    });
    const res = await h.write('9');
    a.eq(h.count('PUT', PUT), 1);
    a.eq(res.ok, 1);
  });

  test('a status write (M) lost and then found applied counts as saved', async () => {
    const h = setup({
      ['PUT ' + SUB_PATH]: ['network'],
      ['GET ' + SUB_PATH]: [sub({ grade: '8', late_policy_status: 'missing', missing: true })]
    });
    const res = await h.write('M');
    a.eq(h.count('PUT', PUT), 1, 'no follow-up Missing write either');
    a.eq(res.ok, 1);
    a.eq(h.m.cell('50', '10').latePolicyStatus, 'missing');
  });

  test('re-read shows the old grade: "Couldn’t confirm", what Canvas shows, and Check again only reads', async () => {
    const h = setup({
      ['PUT ' + SUB_PATH]: ['network'],
      ['GET ' + SUB_PATH]: [sub({ grade: '8', score: 8, entered_grade: '8' }), sub({ grade: '9', score: 9, entered_grade: '9' })]
    });
    const res = await h.write('9');
    a.eq(res.ok, 0);
    a.eq(res.unconfirmed.length, 1);
    a.ok(/^Couldn’t confirm this grade \(Ada, Lab 4\)\. Canvas currently shows “8”/.test(last().text), last().text);
    a.ok(!/unchanged/i.test(last().text), 'a re-read is not proof the write was dropped');
    a.eq(h.m.cell('50', '10').grade, '8', 'the cell shows what Canvas holds');

    // The teacher presses Check again; by now Canvas shows the grade.
    await h.w.checkAgain(res.unconfirmed);
    a.eq(h.count('PUT', PUT), 1, 'Check again never resends the write');
    a.eq(h.count('GET', PUT), 2);
    a.eq(last().level, 'info');
    a.eq(last().text, 'Grade saved — confirmed with Canvas');
    a.eq(h.m.cell('50', '10').grade, '9');
  });

  test('Check again that still can’t confirm offers to check again, still without writing', async () => {
    const h = setup({ ['PUT ' + SUB_PATH]: ['network'], ['GET ' + SUB_PATH]: ['network'] });
    const res = await h.write('9');
    a.eq(res.unconfirmed.length, 1);
    const again = await h.w.checkAgain(res.unconfirmed);
    a.eq(again.unconfirmed.length, 1);
    a.ok(/^Couldn’t confirm this grade/.test(last().text), last().text);
    a.eq(last().action && last().action.label, 'Check again');
    a.eq(h.count('PUT', PUT), 1);
  });
});

suite('grade writes: an explicit refusal is known, and said so', (test) => {
  test('a 403 refusal: not saved, "left unchanged", no re-read, one PUT', async () => {
    const h = setup({
      ['PUT ' + SUB_PATH]: [json(403, { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] })]
    });
    const res = await h.write('9');
    a.eq(res.failed, 1);
    a.eq(res.unconfirmed.length, 0);
    a.eq(h.count('PUT', PUT), 1);
    a.eq(h.count('GET', PUT), 0, 'a refusal needs no re-read');
    a.ok(/could not be saved/.test(last().text) && /left unchanged/.test(last().text), last().text);
    a.eq(last().action, null, 'nothing to check again');
    a.eq(h.m.cell('50', '10').grade, '8');
  });

  test('a 400 with Canvas’s error body: refused, left unchanged', async () => {
    const h = setup({ ['PUT ' + SUB_PATH]: [json(400, { errors: [{ message: 'invalid grade' }] })] });
    const res = await h.write('9');
    a.eq(res.failed, 1);
    a.ok(/left unchanged/.test(last().text));
  });

  test('a 401 sign-in page with an error status is a refusal, not unconfirmed', async () => {
    const h = setup({ ['PUT ' + SUB_PATH]: [html(401, SIGN_IN_PAGE)] });
    const res = await h.write('9');
    a.eq(res.failed, 1);
    a.ok(/session has expired/.test(last().text), last().text);
  });
});

/* ---------------------------------------------------------------- posting */

/* The column, as the post controller sees it. `reads` is the queue of what
 * each re-read reports: [hidden?, hidden?] per student, or 'fail'. */
function fakeModel(reads) {
  const users = ['1', '2'];
  const state = { hidden: new Map(users.map((u) => [u, true])) };
  return {
    courseId: '7',
    loadedAssignments: new Set(['99']),
    cells: new Map(users.map((u) => [`99:${u}`, { userId: u, postedAt: null, postedAtKnown: true }])),
    reloads: 0,
    key: (aid, uid) => `${aid}:${uid}`,
    assignment: () => ({ name: 'Lab 4' }),
    cell(aid, uid) { return this.loadedAssignments.has(String(aid)) ? this.cells.get(this.key(aid, uid)) : null; },
    patchCell(aid, uid, patch) { Object.assign(this.cells.get(this.key(aid, uid)), patch); },
    markPostConfirmed() {},
    pendingPosts(aid) {
      if (!this.loadedAssignments.has(String(aid))) return [];
      return users.filter((u) => state.hidden.get(u));
    },
    reloadAssignment(aid) {
      this.reloads++;
      const next = reads.length ? reads.shift() : null;
      if (next === 'fail') { this.loadedAssignments.delete(String(aid)); return Promise.resolve(null); }
      this.loadedAssignments.add(String(aid));
      if (Array.isArray(next)) users.forEach((u, i) => state.hidden.set(u, !!next[i]));
      return Promise.resolve(null);
    }
  };
}

const GQL = '/api/graphql$';
const GQLRX = /\/api\/graphql$/;
const UNMUTE = /\/assignments\/99$/;
const gql = (payload) => json(200, { data: { postAssignmentGrades: payload } });

function poster(reads, routes) {
  stubUi();
  const canvas = fakeCanvas(Object.assign({ 'PUT /api/v1/courses/7/assignments/99$': [json(200, { id: '99' })] }, routes));
  const model = fakeModel(reads);
  const ctrl = new CGP.PostGradesController({
    model, api: canvas.api,
    adapter: { colIndexToColumn: new Map() },
    settings: { values: { postGradesButton: true } },
    requestPaint: () => {},
    recheckBaseDelayMs: 1
  });
  const post = () => ctrl.post('99', null);
  const posted = () => ['1', '2'].filter((u) => model.cells.get('99:' + u).postedAt).length;
  return Object.assign({ model, ctrl, post, posted }, canvas);
}

suite('posting: the mutation’s answer must be its payload', (test) => {
  test('data:null (no payload) and unchanged re-reads: "Couldn’t confirm", nothing stamped (the reported bug)', async () => {
    const h = poster([[true, true]], { ['POST ' + GQL]: [json(200, { data: null })] });
    await h.post();
    a.eq(h.count('POST', GQLRX), 1, 'the mutation was sent once');
    a.eq(h.count('PUT', UNMUTE), 0, 'the column-wide unmute was never used');
    const err = said.find((s) => s.level === 'error');
    a.ok(err && /^Couldn’t confirm whether the grades in Lab 4 were posted\. Canvas still shows 2 of 2 hidden/.test(err.text), err && err.text);
    a.eq(err.action && err.action.label, 'Check again');
    a.eq(said.filter((s) => /posted to students/.test(s.text)).length, 0, 'never reported as posted');
    a.eq(h.posted(), 0, 'nothing marked posted on a guess');
    a.ok(h.model.reloads >= 2, 'the column was re-read before telling the teacher');
  });

  test('an HTML sign-in page as the mutation answer: same, and says so', async () => {
    const h = poster([[true, true]], { ['POST ' + GQL]: [html(200, SIGN_IN_PAGE)] });
    await h.post();
    const err = said.find((s) => s.level === 'error');
    a.ok(/^Couldn’t confirm/.test(err.text) && /sign-in page/.test(err.text), err.text);
    a.eq(h.count('PUT', UNMUTE), 0);
    a.eq(h.posted(), 0);
  });

  test('a payload without postAssignmentGrades, or a progress with no id, is unconfirmed', async () => {
    for (const body of [json(200, { data: {} }), gql({ progress: { state: 'queued' }, errors: null })]) {
      const h = poster([[true, true]], { ['POST ' + GQL]: [body] });
      await h.post();
      a.ok(said.some((s) => /^Couldn’t confirm whether/.test(s.text)), body.body);
      a.eq(h.posted(), 0);
    }
  });

  test('a missing payload but Canvas DID post: the re-read says so, one mutation', async () => {
    const h = poster([[true, true], [false, false]], { ['POST ' + GQL]: [json(200, { data: null })] });
    await h.post();
    a.eq(h.count('POST', GQLRX), 1);
    a.eq(last().level, 'info');
    a.eq(last().text, '2 grades posted to students');
  });

  test('a lost connection on the mutation is not resent; the re-read decides', async () => {
    const h = poster([[true, true], [false, false]], { ['POST ' + GQL]: ['network'] });
    await h.post();
    a.eq(h.count('POST', GQLRX), 1, 'no second posting request');
    a.eq(h.count('PUT', UNMUTE), 0);
    a.eq(last().text, '2 grades posted to students');
  });

  test('Check again after an unconfirmed post only reads the column', async () => {
    const h = poster([[true, true]], { ['POST ' + GQL]: [json(200, { data: null })] });
    await h.post();
    const err = said.find((s) => s.level === 'error');
    // Let the background recheck finish its own reads first.
    await new Promise((r) => setTimeout(r, 120));
    const reads = h.model.reloads;
    const result = await h.ctrl.checkPostAgain('99', ['1', '2'], 'Lab 4');
    a.eq(h.model.reloads, reads + 1, 'one read');
    a.eq(h.count('POST', GQLRX), 1, 'no second mutation from Check again');
    a.eq(result.hidden, 2);
    a.ok(/still hidden from students/.test(last().text), last().text);
    a.ok(err, 'the first message was the unconfirmed one');
  });

  test('a Progress read that answers with a page: unconfirmed, not "still posting"', async () => {
    const h = poster([[true, true]], {
      ['POST ' + GQL]: [gql({ progress: { _id: 'p1', state: 'queued' }, errors: null })],
      'GET /api/v1/progress/p1$': [html(200, SIGN_IN_PAGE)]
    });
    await h.post();
    a.ok(said.some((s) => /^Couldn’t confirm whether/.test(s.text)), JSON.stringify(said));
    a.eq(said.filter((s) => /still posting/.test(s.text)).length, 0);
    a.eq(h.count('GET', /\/progress\/p1$/), 1, 'did not poll a sign-in page twenty times');
  });
});

suite('posting: valid answers are still trusted', (test) => {
  test('a legitimate synchronous post (payload, progress null) reports posted', async () => {
    const h = poster([[true, true], [false, false]], { ['POST ' + GQL]: [gql({ progress: null, errors: null })] });
    await h.post();
    a.eq(last().text, '2 grades posted to students');
    a.eq(h.count('GET', /\/progress\//), 0, 'no job to wait for');
  });

  test('a synchronous post whose re-read lags is still confirmed by Canvas’s payload', async () => {
    const h = poster([[true, true], [true, true], [true, true], [true, true]], { ['POST ' + GQL]: [gql({ progress: null, errors: null })] });
    await h.post();
    a.eq(last().text, '2 grades posted to students');
    a.eq(h.posted(), 2);
  });

  test('a background posting job is waited for, then reported', async () => {
    const h = poster([[true, true], [false, false]], {
      ['POST ' + GQL]: [gql({ progress: { _id: 'p1', state: 'queued' }, errors: null })],
      'GET /api/v1/progress/p1$': [json(200, { id: 'p1', workflow_state: 'completed', completion: 100 })]
    });
    await h.post();
    a.eq(h.count('GET', /\/progress\/p1$/), 1);
    a.eq(last().text, '2 grades posted to students');
    // gradedOnly really went to Canvas.
    const sent = JSON.parse(h.calls.find((c) => GQLRX.test(c.path)).body);
    a.eq(sent.variables.gradedOnly, true);
  });
});

suite('posting: refusals never widen into the whole-column fallback', (test) => {
  test('the payload’s own errors: refused, nothing posted, no fallback', async () => {
    const h = poster([[true, true]], {
      ['POST ' + GQL]: [gql({ progress: null, errors: [{ attribute: 'assignment', message: 'moderation is not complete' }] })]
    });
    await h.post();
    a.eq(h.count('PUT', UNMUTE), 0);
    a.ok(/^Canvas would not post these grades/.test(last().text) && /Nothing was changed/.test(last().text), last().text);
    a.eq(h.posted(), 0);
  });

  test('a top-level GraphQL refusal: no fallback', async () => {
    const h = poster([[true, true]], { ['POST ' + GQL]: [json(200, { data: null, errors: [{ message: 'not authorized' }] })] });
    await h.post();
    a.eq(h.count('PUT', UNMUTE), 0);
    a.eq(last().level, 'error');
    a.ok(!/^Couldn’t confirm/.test(last().text), 'an explicit refusal is not "unconfirmed"');
  });

  test('mutation unavailable (404): a graded-only post does NOT fall back to unmuting the column', async () => {
    const h = poster([[true, true]], { ['POST ' + GQL]: [html(404, '<html>Not Found</html>')] });
    await h.post();
    a.eq(h.count('PUT', UNMUTE), 0, 'the broader legacy endpoint was never called');
    a.ok(/doesn’t offer posting only graded submissions/.test(last().text) && /nothing was posted/.test(last().text), last().text);
  });

  test('schema mismatch: no fallback either', async () => {
    const h = poster([[true, true]], {
      ['POST ' + GQL]: [json(200, { errors: [{ message: "Field 'postAssignmentGrades' doesn't exist on type 'Mutation'" }] })]
    });
    await h.post();
    a.eq(h.count('PUT', UNMUTE), 0);
    a.ok(/only graded/.test(last().text), last().text);
  });

  test('postWithoutGraphql refuses a graded-only request outright', async () => {
    const h = poster([], {});
    const original = new Error('x');
    const err = await h.ctrl.postWithoutGraphql('99', original).catch((e) => e);
    a.eq(err, original);
    a.eq(h.count('PUT', UNMUTE), 0);
  });
});

suite('grade-ops: does a record hold what a write asked for', (test) => {
  const settled = CGP.gradeOps.formSettledIn;
  test('grades compare as Canvas spells them', () => {
    a.eq(settled({ 'submission[posted_grade]': '9.0' }, { grade: '9', entered_grade: '9' }), true);
    a.eq(settled({ 'submission[posted_grade]': '90%' }, { grade: '90%' }), true);
    a.eq(settled({ 'submission[posted_grade]': 'B+' }, { grade: 'b+' }), true);
    a.eq(settled({ 'submission[posted_grade]': '9' }, { grade: '7.2', entered_grade: '9' }), true, 'a late deduction keeps entered_grade');
    a.eq(settled({ 'submission[posted_grade]': '9' }, { grade: '8' }), false);
    a.eq(settled({ 'submission[posted_grade]': '9' }, { grade: '9', excused: true }), false);
  });
  test('statuses, clears and excuses', () => {
    a.eq(settled({ 'submission[late_policy_status]': 'missing' }, { late_policy_status: 'missing' }), true);
    a.eq(settled({ 'submission[late_policy_status]': 'missing' }, { late_policy_status: null, missing: true }), false);
    a.eq(settled({ 'submission[late_policy_status]': null }, { late_policy_status: null }), true);
    a.eq(settled({ 'submission[posted_grade]': '', 'submission[late_policy_status]': 'none' }, { grade: null, late_policy_status: 'none' }), true);
    a.eq(settled({ 'submission[excuse]': 'true' }, { excused: true }), true);
    a.eq(settled({ 'comment[text_comment]': 'hi' }, { grade: '9' }), false, 'a comment cannot be confirmed this way');
  });
});
