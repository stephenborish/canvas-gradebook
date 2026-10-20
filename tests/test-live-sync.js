/* Every view of a grade agrees, without a reload.
 *
 * The gradebook cell, Canvas's own store behind it (which the Grade Detail
 * Tray and Canvas's Total are drawn from) and SpeedGrader in another tab
 * used to drift apart after any change one of them did not make itself.
 * These pin down the three channels that keep them together: the hand-off
 * of each saved submission to Canvas's store (canvas-store.js), the
 * announcement of each change to the other tabs (live-sync.js, relayed by
 * live-relay.js), and the re-reads that follow. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

['src/gradebook/canvas-store.js', 'src/gradebook/live-sync.js', 'src/gradebook/writer.js', 'src/gradebook/cell-actions.js'].forEach((rel) => {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
});

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* A window whose postMessage delivers to its own listeners, like a page. */
function withWindow(fn) {
  const listeners = [];
  const posted = [];
  const win = {
    location: { origin: 'https://canvas.example.edu', search: '', hash: '' },
    addEventListener: (type, l) => { if (type === 'message') listeners.push(l); },
    postMessage: (data) => { posted.push(data); listeners.slice().forEach((l) => l({ source: win, data })); }
  };
  const prior = global.window;
  global.window = win;
  const done = () => { if (prior === undefined) delete global.window; else global.window = prior; };
  return Promise.resolve().then(() => fn(win, posted, listeners)).then((v) => { done(); return v; }, (e) => { done(); throw e; });
}

function model(api) {
  const m = new CGP.GradebookModel(api || {}, '7');
  m.ready = true;
  m.instructorId = '1';
  m.assignments.set('50', { id: '50', name: 'HW', gradingType: 'points' });
  m.students.set('10', { id: '10', name: 'A' });
  m.students.set('11', { id: '11', name: 'B' });
  m.studentOrder.push('10', '11');
  m.queueTotalRefresh = () => {};
  return m;
}

function fakeRuntime() {
  const sent = [];
  const listeners = [];
  return {
    sent, listeners,
    sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); },
    onMessage: { addListener: (l) => listeners.push(l) },
    deliver: (msg) => listeners.forEach((l) => l(msg))
  };
}

suite('Canvas\'s own store gets every saved submission', (test) => {
  test('only grading fields cross into the page, with when the read began', () => withWindow((win, posted) => {
    const store = new CGP.CanvasStore({ model: model() });
    store.push([{ assignment_id: 50, user_id: 10, id: 9, score: 7, late_policy_status: null, assignment_visible: true,
      submission_comments: [{ comment: 'private' }], body: 'essay', user: { name: 'Student' } }], { readStartedAt: 123 });
    const msg = posted.find((m) => m.source === 'cgp-submission-sync');
    a.ok(msg && /^cgp-sync-/.test(msg.id));
    a.eq(msg.readStartedAt, 123);
    a.deep(Object.keys(msg.submissions[0]).sort(), ['assignment_id', 'assignment_visible', 'id', 'late_policy_status', 'score', 'user_id']);
    a.eq(msg.submissions[0].user_id, '10', 'ids as strings, like Canvas\'s own store');
  }));

  test('Canvas confirming it holds the grade drops the overlay drawn over its stale cell', () => withWindow(async (win, posted) => {
    const m = model();
    m.patchCell('50', '10', { override: '7', grade: '7' }, { silent: true });
    m.patchCell('50', '11', { override: '8', grade: '8' }, { silent: true });
    m.markLocalWrite('50', '11');   // a newer write of ours on this one
    let painted = 0;
    const store = new CGP.CanvasStore({ model: m, requestPaint: () => painted++ });
    const pending = store.push([{ assignment_id: '50', user_id: '10' }, { assignment_id: '50', user_id: '11' }]);
    // Answer as the bridge would.
    const sync = posted.find((msg) => msg.source === 'cgp-submission-sync');
    win.postMessage({ source: 'cgp-submission-synced', id: sync.id, results: [
      { assignmentId: '50', userId: '10', via: 'gradebook', stored: true },
      { assignmentId: '50', userId: '11', via: 'gradebook', stored: true }
    ] });
    const results = await pending;
    a.eq(results.length, 2);
    a.eq(m.cell('50', '10').override, null, 'Canvas\'s own cell is the one read again');
    a.eq(m.cell('50', '11').override, '8', 'kept while a newer write is still out');
    a.eq(painted, 1);
  }));

  test('no bridge answering leaves everything as it was', () => withWindow(async () => {
    const m = model();
    m.patchCell('50', '10', { override: '7' }, { silent: true });
    const store = new CGP.CanvasStore({ model: m });
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => realSetTimeout(fn, 0);   // skip the 5s wait
    try {
      const out = await store.push([{ assignment_id: '50', user_id: '10' }]);
      a.eq(out, null);
    } finally { global.setTimeout = realSetTimeout; }
    a.eq(m.cell('50', '10').override, '7');
  }));

});

suite('a saved grade reaches the store, the model and the other tabs', (test) => {
  test('the writer hands Canvas\'s answer over and announces every cell it changed', async () => {
    CGP.ui = { toast: () => {}, error: () => {} };
    const m = model();
    m.loadedAssignments.add('50');
    const pushed = [];
    const announced = [];
    const w = new CGP.GradeWriter({
      api: { updateSubmission: () => Promise.resolve({ id: '1', assignment_id: '50', user_id: '10', score: 6, grade: '6', workflow_state: 'graded',
        all_submissions: [{ id: '1', assignment_id: '50', user_id: '10', score: 6 }, { id: '2', assignment_id: '50', user_id: '11', score: 6, grade: '6' }] }) },
      model: m, settings: { values: {} },
      canvasStore: { push: (subs, opts) => { pushed.push({ subs, opts }); return Promise.resolve(null); } },
      liveSync: { announce: (cells) => announced.push(cells) }
    });
    const totals = [];
    m.queueTotalRefresh = (uid) => totals.push(uid);
    const before = Date.now();
    await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('6') }]);
    a.deep(totals.slice().sort(), ['10', '11'], 'every group member\'s Total, not just the written one');
    a.eq(pushed.length, 1);
    a.deep(pushed[0].subs.map((s) => s.user_id), ['10', '11'], 'the written submission and its group member');
    a.ok(pushed[0].opts.readStartedAt >= before, 'stamped with when the write went out');
    a.deep(announced[0], [{ assignmentId: '50', userId: '10' }, { assignmentId: '50', userId: '11' }]);
    a.eq(m.cell('50', '11').grade, '6', 'the group member\'s cell is not left behind');
  });

  test('a group member written since this write began keeps its own newer answer, here and in Canvas\'s store', async () => {
    CGP.ui = { toast: () => {}, error: () => {} };
    const m = model();
    m.loadedAssignments.add('50');
    m.applySubmission({ id: '2', assignment_id: '50', user_id: '11', score: 9, grade: '9' });
    const pushed = [];
    const w = new CGP.GradeWriter({
      api: { updateSubmission: () => {
        // The member's own write (another cell's chain) starts while this one is out.
        m.markLocalWrite('50', '11');
        return Promise.resolve({ id: '1', assignment_id: '50', user_id: '10', score: 6, grade: '6',
          all_submissions: [{ id: '2', assignment_id: '50', user_id: '11', score: 6, grade: '6' }] });
      } },
      model: m, settings: { values: {} },
      canvasStore: { push: (subs) => { pushed.push(subs); return Promise.resolve(null); } }
    });
    await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('6') }]);
    a.eq(m.cell('50', '11').grade, '9', 'the older copy in all_submissions does not overwrite it');
    a.deep(pushed[0].map((s) => s.user_id), ['10'], 'nor is it handed to Canvas\'s store');
  });

  test('a comment\'s answer never overrides a status write of ours that landed while the comment was out', async () => {
    const m = model();
    m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', late_policy_status: null, missing: false });
    const pushed = [];
    let finishComment;
    const w = new CGP.GradeWriter({
      api: { addComment: () => new Promise((r) => { finishComment = r; }) },
      model: m, settings: { values: {} },
      canvasStore: { push: (subs, opts) => { pushed.push({ subs, opts }); return Promise.resolve(null); } }
    });
    const pending = w.addComment('50', '10', 'Nice');
    await tick(2);
    // M lands (and finishes) while the comment is still out.
    m.markLocalWrite('50', '10');
    m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', late_policy_status: 'missing', missing: true });
    m.finishLocalWrite('50', '10');
    // The comment was served before M: its copy of the status is older.
    finishComment({ id: '1', assignment_id: '50', user_id: '10', late_policy_status: null, missing: false,
      submission_comments: [{ id: 'c1', author_id: '1', comment: 'Nice' }] });
    await pending;
    a.eq(m.cell('50', '10').latePolicyStatus, 'missing', 'the newer Missing stays');
    a.eq(m.cell('50', '10').commentList.length, 1, 'the thread is still taken from the answer');
    a.eq(pushed[0].subs.length, 0, 'the older status is not handed to Canvas\'s store');
  });
});

suite('re-reads that report what actually changed', (test) => {
  test('syncCell: applied and changed, applied and unchanged, or lost to a newer write of ours', async () => {
    let answer = { id: '1', assignment_id: '50', user_id: '10', score: 5, grade: '5', workflow_state: 'graded' };
    const m = model({ submission: () => Promise.resolve(Object.assign({}, answer)) });
    let r = await m.syncCell('50', '10');
    a.eq(r.applied, true);
    a.eq(r.changed, true);
    r = await m.syncCell('50', '10');
    a.eq(r.changed, false, 'same grade, nothing to hand on');
    answer = Object.assign({}, answer, { score: 1, grade: '1' });
    m.api.submission = () => { m.markLocalWrite('50', '10'); return Promise.resolve(Object.assign({}, answer)); };
    r = await m.syncCell('50', '10');
    a.eq(r.applied, false, 'a write of ours that started after the read wins');
    a.eq(m.cell('50', '10').score, 5);
  });

  test('resyncAssignments reads only loaded columns, with visibility, and returns just the changes', async () => {
    const asked = [];
    const m = model({ submissionsForAssignments: (c, ids, opts) => {
      asked.push({ ids, opts });
      return Promise.resolve([
        { id: '1', assignment_id: '50', user_id: '10', score: 5, workflow_state: 'graded', assignment_visible: true },
        { id: '2', assignment_id: '50', user_id: '11', score: 9, workflow_state: 'graded', assignment_visible: true }
      ]);
    } });
    m.assignments.set('51', { id: '51', name: 'Never shown' });
    m.everLoadedAssignments.add('50');
    m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', score: 5, workflow_state: 'graded' }, { silent: true });
    m.applySubmission({ id: '2', assignment_id: '50', user_id: '11', score: 3, workflow_state: 'graded' }, { silent: true });
    const r = await m.resyncAssignments(['50', '51']);
    a.deep(asked.map((x) => x.ids), [['50']]);
    a.eq(asked[0].opts.visibility, true);
    a.deep(r.submissions.map((s) => s.user_id), ['11']);
    a.eq(m.cell('50', '11').score, 9);
  });

  test('a column re-read never wipes a verified thread the bulk endpoint answers as empty', async () => {
    const m = model({ submissionsForAssignments: () => Promise.resolve([
      { id: '1', assignment_id: '50', user_id: '10', score: 4, submission_comments: [] }
    ]) });
    m.everLoadedAssignments.add('50');
    m.commentVerifiedAssignments.add('50');
    m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', score: 4,
      submission_comments: [{ id: 'c1', author_id: '1', comment: 'See me' }] }, { silent: true });
    await m.resyncAssignments(['50']);
    a.eq(m.cell('50', '10').commentList.length, 1, 'the comment the column verified is kept');
  });

  test('a truncated column read changes nothing', async () => {
    const list = [{ id: '2', assignment_id: '50', user_id: '11', score: 9 }];
    list.truncated = true;
    const m = model({ submissionsForAssignments: () => Promise.resolve(list) });
    m.everLoadedAssignments.add('50');
    m.applySubmission({ id: '2', assignment_id: '50', user_id: '11', score: 3 }, { silent: true });
    const r = await m.resyncAssignments(['50']);
    a.eq(r.submissions.length, 0);
    a.eq(m.cell('50', '11').score, 3);
  });

  test('every single-submission read and write asks Canvas for assignment_visible', async () => {
    const urls = [];
    const api = new CGP.CanvasApi({ origin: 'https://canvas.example.edu', fetch: (url) => {
      urls.push(url);
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{}') });
    } });
    await api.submission('7', '50', '10');
    await api.updateSubmission('7', '50', '10', { 'submission[posted_grade]': '4' });
    urls.forEach((u) => a.ok(/include%5B%5D=visibility/.test(u), u));
    a.deep(CGP.apiInternals.formToJson({ 'submission[late_policy_status]': null, 'comment[text_comment]': 'x', plain: 1 }),
      { submission: { late_policy_status: null }, comment: { text_comment: 'x' }, plain: 1 });
  });
});

suite('tabs tell each other what changed (ids only)', (test) => {
  test('announce sends ids only, once each, and nothing when turned off', () => {
    const rt = fakeRuntime();
    const settings = { values: { liveSync: true } };
    const ls = new CGP.LiveSync({ courseId: '7', settings, runtime: rt, delayMs: 0 });
    ls.announce([{ assignmentId: '50', userId: '10' }, { assignmentId: '50', userId: '10' }, { assignmentId: '51' }, { assignmentId: 'x' }], { commentsOnly: true });
    a.eq(rt.sent.length, 1);
    a.deep(rt.sent[0], { type: 'cgp.live.changed', courseId: '7', cells: [{ assignmentId: '50', userId: '10' }, { assignmentId: '51', userId: null }], commentsOnly: true });
    settings.values.liveSync = false;
    a.eq(ls.announce([{ assignmentId: '50', userId: '10' }]), false);
    a.eq(rt.sent.length, 1);
  });

  test('a burst of saves goes out as one announcement', async () => {
    const rt = fakeRuntime();
    const ls = new CGP.LiveSync({ courseId: '7', settings: { values: {} }, runtime: rt, delayMs: 20 });
    for (let u = 1; u <= 30; u++) ls.announce([{ assignmentId: '50', userId: String(u) }]);
    ls.announce([{ assignmentId: '50', userId: '3' }], { commentsOnly: true });
    a.eq(rt.sent.length, 0, 'held for the batch window');
    await tick(40);
    a.eq(rt.sent.length, 2, 'grades and comments are told apart');
    a.eq(rt.sent[0].cells.length, 30);
    a.eq(rt.sent[1].commentsOnly, true);
  });

  test('only this course\'s well-formed announcements are listened to', () => {
    const rt = fakeRuntime();
    const ls = new CGP.LiveSync({ courseId: '7', settings: { values: {} }, runtime: rt });
    const got = [];
    ls.onChange((m) => got.push(m));
    rt.deliver({ type: 'cgp.live.changed', courseId: '8', cells: [{ assignmentId: '50', userId: '10' }] });
    rt.deliver({ type: 'other', courseId: '7', cells: [{ assignmentId: '50' }] });
    rt.deliver({ type: 'cgp.live.changed', courseId: '7', cells: [{ assignmentId: 'bad' }, { assignmentId: '50', userId: '10' }] });
    a.eq(got.length, 1);
    a.deep(got[0].cells, [{ assignmentId: '50', userId: '10' }]);
  });
});

suite('the gradebook follows changes made elsewhere', (test) => {
  function follower(m, extra) {
    const pushed = [];
    const f = new CGP.LiveGradebookFollower(Object.assign({
      model: m,
      canvasStore: { push: (subs, opts) => { pushed.push({ subs, opts }); return Promise.resolve(null); } },
      liveSync: { enabled: () => true, onChange: () => {} },
      requestPaint: () => {}
    }, extra || {}));
    return { f, pushed };
  }

  test('a grade saved in SpeedGrader is re-read and handed to Canvas\'s store; an unchanged one is not', async () => {
    const m = model({ submission: (c, aid, uid) => Promise.resolve({ id: uid, assignment_id: aid, user_id: uid, score: uid === '10' ? 8 : 2, workflow_state: 'graded', assignment_visible: true }) });
    m.applySubmission({ id: '11', assignment_id: '50', user_id: '11', score: 2, workflow_state: 'graded' }, { silent: true });
    const { f, pushed } = follower(m);
    f.receive({ cells: [{ assignmentId: '50', userId: '10' }, { assignmentId: '50', userId: '11' }] });
    await f.flush();
    await tick();
    a.eq(m.cell('50', '10').score, 8);
    a.eq(pushed.length, 1, 'only the cell that changed');
    a.eq(pushed[0].subs[0].user_id, '10');
  });

  test('a column-wide change (a post, a bulk dialog) re-reads the column', async () => {
    let columnReads = 0;
    const m = model({
      submissionsForAssignments: () => { columnReads++; return Promise.resolve([{ id: '1', assignment_id: '50', user_id: '10', score: 4, posted_at: 'p', workflow_state: 'graded' }]); },
      submission: () => { throw new Error('no single reads for a column'); }
    });
    m.everLoadedAssignments.add('50');
    const { f, pushed } = follower(m);
    f.receive({ cells: [{ assignmentId: '50', userId: null }] });
    await f.flush();
    a.eq(columnReads, 1);
    a.eq(pushed[0].subs.length, 1);
  });

  test('a column Canvas saved itself (Set Default Grade, Curve) re-reads it and refreshes the moved Totals', async () => {
    const m = model({ submissionsForAssignments: () => Promise.resolve([
      { id: '1', assignment_id: '50', user_id: '10', score: 9, workflow_state: 'graded' },
      { id: '2', assignment_id: '50', user_id: '11', score: 4, workflow_state: 'graded' }
    ]) });
    m.everLoadedAssignments.add('50');
    m.applySubmission({ id: '2', assignment_id: '50', user_id: '11', score: 4, workflow_state: 'graded' }, { silent: true });
    const totals = [];
    m.queueTotalRefresh = (uid) => totals.push(uid);
    const { f, pushed } = follower(m, { catchUpDelays: [0] });
    f.catchUpColumn('50');
    await tick(20);
    a.deep(totals, ['10'], 'only the student whose grade moved');
    a.eq(pushed.length, 0, 'Canvas\'s store already has its own save');
    a.eq(m.cell('50', '10').score, 9);
  });

  test('nothing is read before the course has loaded', async () => {
    let reads = 0;
    const m = model({ submission: () => { reads++; return Promise.resolve(null); } });
    m.ready = false;
    const { f } = follower(m);
    f.receive({ cells: [{ assignmentId: '50', userId: '10' }] });
    await f.flush();
    await tick();
    a.eq(reads, 0);
    a.eq(f._queue.size, 0, 'and nothing is left queued for later');
  });

  test('coming back to the tab re-reads the visible columns - at most every 15 seconds', async () => {
    let reads = 0;
    const m = model({ submissionsForAssignments: () => { reads++; return Promise.resolve([]); } });
    m.everLoadedAssignments.add('50');
    const { f } = follower(m, { adapter: { visibleCells: () => [{ columnType: 'assignment', assignmentId: '50' }, { columnType: 'student' }] } });
    await f.refreshVisible('visible');
    await f.refreshVisible('focus');
    a.eq(reads, 1);
    f._lastRefocusAt = Date.now() - 16000;
    await f.refreshVisible('focus');
    a.eq(reads, 2);
  });
});

suite('SpeedGrader follows changes made in the gradebook', (test) => {
  function sg(search, opts) {
    opts = opts || {};
    const announced = [];
    const posted = [];
    const appended = [];
    const doc = {
      querySelector: (sel) => (sel === '#classic_speedgrader_container' && opts.classic ? {} : null),
      createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, isConnected: true }),
      body: { appendChild: (el) => appended.push(el) }
    };
    const win = { location: { search: search, hash: opts.hash || '' }, postMessage: (m, t) => posted.push([m, t]), addEventListener() {} };
    const f = new CGP.LiveSpeedGraderFollower({
      liveSync: { announce: (cells, o) => { announced.push({ cells, o }); return true; }, onChange() {} },
      document: doc, window: win
    });
    return { f, announced, posted, appended };
  }

  test('SpeedGrader\'s own saves are announced, a comment edit as the submission on screen', () => {
    const { f, announced } = sg('?assignment_id=50&student_id=10');
    f.announceWrite({ source: 'cgp-native-write', courseId: '7', assignmentId: '50', userId: '10' });
    f.announceWrite({ source: 'cgp-native-write', commentId: '77' });
    a.deep(announced.map((x) => [x.cells, x.o.commentsOnly]), [
      [[{ assignmentId: '50', userId: '10' }], false],
      [[{ assignmentId: '50', userId: '10' }], true]
    ]);
  });

  test('a change to the submission on screen asks platform SpeedGrader to refetch it', async () => {
    const { f, posted } = sg('?assignment_id=50&student_id=10');
    a.eq(f.receive({ cells: [{ assignmentId: '50', userId: '11' }] }), false, 'another student');
    a.eq(f.receive({ cells: [{ assignmentId: '51', userId: '10' }] }), false, 'another assignment');
    a.eq(f.receive({ cells: [{ assignmentId: '50', userId: '10' }] }), true);
    await tick(350);
    a.deep(posted, [[{ subject: 'canvas.refetchSubmission' }, '*']]);
  });

  test('classic SpeedGrader, which cannot refetch, shows a reload notice instead', async () => {
    const { f, posted, appended } = sg('?assignment_id=50', { classic: true, hash: '#%7B%22student_id%22%3A%2210%22%7D' });
    a.eq(f.ids().userId, '10', 'the student comes from classic SpeedGrader\'s hash');
    f.receive({ cells: [{ assignmentId: '50', userId: '10' }] });
    await tick(350);
    a.eq(posted.length, 0);
    a.eq(appended.length, 1);
    a.eq(appended[0].className, 'cgp-sg-stale');
  });
});

suite('the background relays between tabs of one course', (test) => {
  const MODULE = pathToFileURL(path.join(__dirname, '..', 'src', 'live-relay.js')).href;

  test('only to the other tabs of the same Canvas site and course, top frame only', async () => {
    const { createLiveRelay } = await import(MODULE);
    const sent = [];
    const chrome = {
      runtime: { id: 'ext' },
      tabs: {
        query: async () => [
          { id: 1, url: 'https://canvas.example.edu/courses/7/gradebook' },
          { id: 2, url: 'https://canvas.example.edu/courses/7/gradebook/speed_grader?assignment_id=50' },
          { id: 3, url: 'https://canvas.example.edu/courses/8/gradebook' },
          { id: 4, url: 'https://other.example.edu/courses/7/gradebook' },
          { id: 5 }
        ],
        sendMessage: (id, msg, opts) => { sent.push({ id, msg, opts }); return Promise.resolve(); }
      }
    };
    const relay = createLiveRelay(chrome);
    const sender = { id: 'ext', url: 'https://canvas.example.edu/courses/7/gradebook', tab: { id: 1 } };
    const n = await relay.relay({ type: 'cgp.live.changed', courseId: '7', cells: [{ assignmentId: '50', userId: '10', name: 'x' }] }, sender);
    a.eq(n, 1);
    a.deep(sent.map((s) => [s.id, s.opts.frameId]), [[2, 0]]);
    a.deep(sent[0].msg, { type: 'cgp.live.changed', courseId: '7', cells: [{ assignmentId: '50', userId: '10' }], commentsOnly: false });
    a.eq(await relay.relay({ type: 'cgp.live.changed', courseId: '7', cells: [{ assignmentId: '50' }] }, Object.assign({}, sender, { id: 'someone-else' })), 0);
  });
});

suite('double-clicking a cell opens the tray on the grade just typed', (test) => {
  function controller(clicked) {
    const cell = {
      isConnected: true,
      querySelector: () => ({ closest: () => null, click: () => clicked.push('arrow') })
    };
    const info = { assignmentId: '50', studentId: '10', columnType: 'assignment' };
    const ctrl = new CGP.CellActionsController({
      adapter: { cellInfo: () => info }, settings: { values: {} }, courseId: '7', bridgeWaitMs: 30
    });
    return { ctrl, cell, info };
  }

  test('Canvas\'s Gradebook opens it (after saving the edit): the arrow is never clicked', () => withWindow(async (win) => {
    win.removeEventListener = () => {};
    win.addEventListener('message', (e) => {
      if (e.data.source === 'cgp-open-tray') win.postMessage({ source: 'cgp-open-tray-result', id: e.data.id, ok: true });
    });
    const clicked = [];
    const { ctrl, cell, info } = controller(clicked);
    a.eq(await ctrl.open(cell, info), true);
    a.deep(clicked, []);
  }));

  test('no bridge answer: Canvas\'s own arrow is clicked, as before', () => withWindow(async (win) => {
    win.removeEventListener = () => {};
    const clicked = [];
    const { ctrl, cell, info } = controller(clicked);
    a.eq(await ctrl.open(cell, info), false);
    a.deep(clicked, ['arrow']);
  }));
});
