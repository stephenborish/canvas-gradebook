'use strict';

const fs = require('fs');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

suite('page-context SlickGrid bridge', (test) => {
  test('handles an isolated-world request against the page-owned grid atomically', async () => {
    let model = [{ id: 'student', width: 260 }, { id: 'assignment_7', width: 140 }, { id: 'total_grade', width: 110 }];
    const calls = [];
    const grid = {
      getColumns: function () { calls.push('getColumns'); return model; },
      setColumns: function (columns) { calls.push('setColumns'); model = columns; },
      invalidate: function () { calls.push('invalidate'); },
      render: function () { calls.push('render'); },
      resizeCanvas: function () { calls.push('resizeCanvas'); }
    };
    const listeners = [];
    const responses = [];
    const win = {
      ENV: {},
      location: { origin: 'https://canvas.example.edu' },
      addEventListener: function (type, listener) { if (type === 'message') listeners.push(listener); },
      postMessage: function (message) {
        responses.push(message);
        listeners.slice().forEach(function (listener) { listener({ source: win, data: message }); });
      }
    };
    const context = {
      window: win,
      document: { querySelector: function () { return { slickGrid: grid }; } },
      Promise: Promise,
      Object: Object,
      Array: Array,
      String: String,
      Number: Number,
      Math: Math,
      isFinite: isFinite,
      setTimeout: function (fn) { fn(); }
    };
    vm.runInNewContext(fs.readFileSync('src/page/env-bridge.js', 'utf8'), context);

    win.postMessage({
      source: 'cgp-grid-request', id: 'test-request', studentWidth: 180, assignmentWidth: 72
    }, win.location.origin);
    await Promise.resolve();
    await Promise.resolve();

    const response = responses.find((message) => message.source === 'cgp-grid-response');
    a.ok(response, 'the page world answers the content-script request');
    a.eq(response.id, 'test-request');
    a.deep(response.result, { ok: true, changed: 2 });
    a.deep(model.map((column) => column.width), [180, 72, 110]);
    a.eq(calls.filter((name) => name === 'setColumns').length, 1, 'one complete model write');
    a.deep(calls.slice(-4), ['setColumns', 'invalidate', 'render', 'resizeCanvas']);
  });

  test('filters out total_grade column when hideTotal is true', async () => {
    let model = [{ id: 'student', width: 260 }, { id: 'total_grade', width: 130 }, { id: 'assignment_1', width: 140 }];
    const calls = [];
    const grid = {
      getColumns: function () { calls.push('getColumns'); return model; },
      setColumns: function (columns) { calls.push('setColumns'); model = columns; },
      invalidate: function () { calls.push('invalidate'); },
      render: function () { calls.push('render'); },
      resizeCanvas: function () { calls.push('resizeCanvas'); }
    };
    const listeners = [];
    const responses = [];
    const win = {
      ENV: {},
      location: { origin: 'https://canvas.example.edu' },
      addEventListener: function (type, listener) { if (type === 'message') listeners.push(listener); },
      postMessage: function (message) {
        responses.push(message);
        listeners.slice().forEach(function (listener) { listener({ source: win, data: message }); });
      }
    };
    const context = {
      window: win,
      document: { querySelector: function () { return { slickGrid: grid }; } },
      Promise: Promise,
      Object: Object,
      Array: Array,
      String: String,
      Number: Number,
      Math: Math,
      isFinite: isFinite,
      setTimeout: function (fn) { fn(); }
    };
    vm.runInNewContext(fs.readFileSync('src/page/env-bridge.js', 'utf8'), context);

    win.postMessage({
      source: 'cgp-grid-request', id: 'test-hide-total', studentWidth: 190, assignmentWidth: 124, hideTotal: true
    }, win.location.origin);
    await Promise.resolve();
    await Promise.resolve();

    const response = responses.find((message) => message.source === 'cgp-grid-response' && message.id === 'test-hide-total');
    a.deep(model.map((column) => column.id), ['student', 'total_grade', 'assignment_1'], 'preserves natural column order so headers and body cells remain in sync');
    a.deep(model.map((column) => column.width), [190, 84, 124], 'sizes student, total (84px), and assignments correctly');
  });

  async function moveTotalWith(model, options) {
    const grid = {
      getColumns: function () { return model; },
      getOptions: function () { return options; },
      setColumns: function (columns) { model = columns; },
      invalidate: function () {},
      render: function () {},
      resizeCanvas: function () {}
    };
    const listeners = [];
    const win = {
      ENV: {},
      location: { origin: 'https://canvas.example.edu' },
      addEventListener: function (type, listener) { if (type === 'message') listeners.push(listener); },
      postMessage: function (message) {
        listeners.slice().forEach(function (listener) { listener({ source: win, data: message }); });
      }
    };
    vm.runInNewContext(fs.readFileSync('src/page/env-bridge.js', 'utf8'), {
      window: win,
      document: { querySelector: function () { return { slickGrid: grid }; } },
      Promise, Object, Array, String, Number, Math, isFinite,
      setTimeout: function (fn) { fn(); }
    });
    win.postMessage({
      source: 'cgp-grid-request', id: 'move-total', studentWidth: 190, assignmentWidth: 124, hideTotal: true, moveTotal: true
    }, win.location.origin);
    await Promise.resolve();
    await Promise.resolve();
    return model.map((column) => column.id);
  }

  test('Total moves to the first scrolling column, after every frozen column Canvas has (numberOfColumnsToFreeze)', async () => {
    const ids = await moveTotalWith(
      [{ id: 'student', width: 260 }, { id: 'custom_col_3', width: 120 }, { id: 'assignment_1', width: 140 },
        { id: 'assignment_2', width: 140 }, { id: 'total_grade', width: 130 }],
      { numberOfColumnsToFreeze: 2 });
    a.deep(ids, ['student', 'custom_col_3', 'total_grade', 'assignment_1', 'assignment_2'],
      'the frozen Notes column stays frozen; Total does not land inside the frozen block');
  });

  test('with no frozen-column option at all, Total still goes right after Student', async () => {
    const ids = await moveTotalWith(
      [{ id: 'student', width: 260 }, { id: 'assignment_1', width: 140 }, { id: 'total_grade', width: 130 }], {});
    a.deep(ids, ['student', 'total_grade', 'assignment_1']);
  });

  test('marks submissions posted in Canvas\'s own rows and re-renders just those rows', async () => {
    const rows = [
      { id: '1', assignment_7: { posted_at: null, has_postable_comments: true, score: 4 } },
      { id: '2', assignment_7: { posted_at: null, score: 3 } },
      { id: '3', assignment_7: { postedAt: null, hasPostableComments: true, score: 2 } }
    ];
    const calls = [];
    const grid = {
      getColumns: function () { return []; },
      setColumns: function () {},
      getDataLength: function () { return rows.length; },
      getDataItem: function (i) { return rows[i]; },
      invalidateRows: function (r) { calls.push(['invalidateRows', r]); },
      render: function () { calls.push(['render']); }
    };
    const listeners = [];
    const win = {
      ENV: {},
      location: { origin: 'https://canvas.example.edu' },
      addEventListener: function (type, listener) { if (type === 'message') listeners.push(listener); },
      postMessage: function (message) {
        listeners.slice().forEach(function (listener) { listener({ source: win, data: message }); });
      }
    };
    const context = {
      window: win,
      document: { querySelector: function () { return { slickGrid: grid }; } },
      Promise: Promise, Object: Object, Array: Array, String: String, Number: Number,
      Math: Math, Date: Date, isFinite: isFinite, setTimeout: function (fn) { fn(); }
    };
    vm.runInNewContext(fs.readFileSync('src/page/env-bridge.js', 'utf8'), context);

    win.postMessage({ source: 'cgp-posted', assignmentId: '7', userIds: ['1', '3'], postedAt: '2026-10-18T12:00:00Z' }, win.location.origin);

    a.eq(rows[0].assignment_7.posted_at, '2026-10-18T12:00:00Z');
    a.eq(rows[0].assignment_7.has_postable_comments, false);
    a.eq(rows[1].assignment_7.posted_at, null, 'a student not named is left alone');
    a.eq(rows[2].assignment_7.postedAt, '2026-10-18T12:00:00Z', 'camelCase submissions keep their own spelling');
    a.eq(rows[2].assignment_7.hasPostableComments, false);
    a.ok(!('posted_at' in rows[2].assignment_7));
    a.deep(calls, [['invalidateRows', [0, 2]], ['render']]);
  });

  test('without Canvas\'s Gradebook object, the row\'s own fields are patched, in its own spelling', () => {
    const rows = [
      { id: '1', assignment_7: { latePolicyStatus: 'missing', missing: true, late: false, grade: '0', score: 0, enteredScore: 0, rawGrade: '0' } },
      { id: '2', assignment_7: { late_policy_status: 'missing', missing: true, grade: '0', entered_grade: '0' } }
    ];
    const calls = [];
    const grid = gridOver(rows, calls);
    const { win, replies } = loadBridgeWith({ querySelector: () => ({ slickGrid: grid }) });

    const sub = (uid) => ({ assignment_id: '7', user_id: uid, late_policy_status: null, missing: false, late: false, excused: false,
      grade: '3', score: 3, entered_score: 3, entered_grade: '3', workflow_state: 'graded', submission_comments: [{ comment: 'never crosses' }] });
    win.postMessage({ source: 'cgp-submission-sync', id: 'a', submissions: [sub('1')] }, win.location.origin);
    win.postMessage({ source: 'cgp-submission-sync', id: 'b', submissions: [sub('2')] }, win.location.origin);

    a.eq(rows[0].assignment_7.latePolicyStatus, null);
    a.eq(rows[0].assignment_7.missing, false);
    a.eq(rows[0].assignment_7.grade, '3');
    a.eq(rows[0].assignment_7.rawGrade, '3', 'pass/fail cells draw from the unformatted copy');
    a.ok(!('late_policy_status' in rows[0].assignment_7), 'no snake_case field added');
    a.ok(!('workflowState' in rows[0].assignment_7), 'a field Canvas does not have is never added');
    a.ok(!('submissionComments' in rows[0].assignment_7) && !('submission_comments' in rows[0].assignment_7));
    a.eq(rows[1].assignment_7.late_policy_status, null, 'snake_case submissions keep their own spelling');
    a.eq(rows[1].assignment_7.entered_grade, '3', 'the entered grade the tray shows is carried too');
    a.deep(calls, [['invalidateRows', [0]], ['render'], ['invalidateRows', [1]], ['render']]);
    a.deep(replies().map((r) => [r.id, r.results[0].via, r.results[0].stored]), [['a', 'rows', true], ['b', 'rows', true]]);
  });

  test('a saved submission goes through Canvas\'s own updateSubmissionsFromExternal, and an open tray is redrawn', () => {
    const store = { '10': { assignment_7: { late_policy_status: 'missing', missing: true, score: 0, entered_score: 0 } } };
    const gb = fakeGradebook(store, { open: true, studentId: '10', assignmentId: '7' });
    const { win, replies } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });

    win.postMessage({ source: 'cgp-submission-sync', id: 'x', readStartedAt: 1, submissions: [{
      assignment_id: '7', user_id: '10', id: '99', late_policy_status: null, missing: false, late: false, excused: false,
      score: 8, entered_score: 8, grade: '8', entered_grade: '8', workflow_state: 'graded', assignment_visible: true,
      submission_comments: [{ comment: 'private' }], body: 'essay text'
    }] }, win.location.origin);

    a.eq(gb.calls.external.length, 1, 'one hand-off');
    const handed = gb.calls.external[0][0];
    a.eq(handed.user_id, '10');
    a.eq(handed.assignment_visible, true);
    a.ok(!('submission_comments' in handed) && !('body' in handed), 'only grading fields reach the page');
    a.eq(store['10'].assignment_7.score, 8);
    a.deep(gb.calls.tray, ['10'], 'the open tray on this submission is drawn again');
    a.deep(replies()[0].results.map((r) => [r.assignmentId, r.userId, r.via, r.stored]), [['7', '10', 'gradebook', true]]);
  });

  test('a submission without assignment_visible is never given to Canvas\'s method (it would unassign the student)', () => {
    const store = { '10': { assignment_7: { late_policy_status: 'missing', missing: true } } };
    const gb = fakeGradebook(store, { open: false });
    const rows = [{ id: '10', assignment_7: store['10'].assignment_7 }];
    const grid = gridOver(rows, []);
    gb.gradebookGrid = { grid: grid };
    const { win, replies } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });
    win.postMessage({ source: 'cgp-submission-sync', id: 'v', submissions: [{
      assignment_id: '7', user_id: '10', late_policy_status: 'none', missing: false
    }] }, win.location.origin);
    a.eq(gb.calls.external.length, 0);
    a.eq(store['10'].assignment_7.late_policy_status, 'none', 'patched in place instead');
    a.eq(replies()[0].results[0].via, 'rows');
  });

  test('Canvas\'s own write to the cell, newer than the read, wins: the read is not handed over', () => {
    const store = { '10': { assignment_7: { score: 5 } } };
    const gb = fakeGradebook(store, { open: false });
    const { win, replies } = loadBridgeWith({
      querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null),
      nativeWrites: { '7:10': { pending: 0, lastStartedAt: 2000 } }
    });
    win.postMessage({ source: 'cgp-submission-sync', id: 'n', readStartedAt: 1000, submissions: [{
      assignment_id: '7', user_id: '10', score: 3, assignment_visible: true
    }] }, win.location.origin);
    a.eq(gb.calls.external.length, 0);
    a.eq(store['10'].assignment_7.score, 5);
    a.eq(replies()[0].results[0].skipped, 'canvas-write');
    a.eq(replies()[0].results[0].stored, undefined);
  });

  test('a hand-off waits while Canvas\'s editor is open in that student\'s row (re-rendering it would drop the edit)', () => {
    const store = { '10': { assignment_7: { score: 5 } }, '11': { assignment_7: { score: 5 } } };
    const gb = fakeGradebook(store, { open: false });
    let checks = 0;
    gb.gradebookGrid = { grid: {
      getColumns() { return []; }, setColumns() {},
      // Open for the first two looks, then the teacher finishes the edit.
      getCellEditor: () => (++checks <= 2 ? {} : null),
      getActiveCell: () => ({ row: 0, cell: 3 }),
      getDataItem: (i) => [{ id: '10' }, { id: '11' }][i]
    } };
    const { win, replies } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });
    win.postMessage({ source: 'cgp-submission-sync', id: 'e', readStartedAt: 1, submissions: [{
      assignment_id: '7', user_id: '10', score: 8, assignment_visible: true
    }] }, win.location.origin);
    a.eq(checks, 3, 'held while the editor was open, handed over once it closed');
    a.eq(gb.calls.external.length, 1);
    a.eq(store['10'].assignment_7.score, 8);
    a.eq(replies()[0].results[0].stored, true);
  });

  test('an editor that is merely open (nothing typed) holds nothing back', () => {
    const store = { '10': { assignment_7: { score: 5 } } };
    const gb = fakeGradebook(store, { open: false });
    let checks = 0;
    gb.gradebookGrid = { grid: {
      getColumns() { return []; }, setColumns() {},
      getCellEditor: () => { checks++; return { isValueChanged: () => false }; },
      getActiveCell: () => ({ row: 0, cell: 3 }),
      getDataItem: (i) => [{ id: '10' }][i]
    } };
    const { win, replies } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });
    win.postMessage({ source: 'cgp-submission-sync', id: 'o', readStartedAt: 1, submissions: [{
      assignment_id: '7', user_id: '10', score: 8, assignment_visible: true
    }] }, win.location.origin);
    a.eq(checks, 1, 'looked once, did not wait');
    a.eq(store['10'].assignment_7.score, 8);
    a.eq(replies()[0].results[0].stored, true);
  });

  test('an edit left open is never thrown away for a hand-off: that row is skipped, others go through', () => {
    const store = { '10': { assignment_7: { score: 5 } }, '11': { assignment_7: { score: 5 } } };
    const gb = fakeGradebook(store, { open: false });
    gb.gradebookGrid = { grid: {
      getColumns() { return []; }, setColumns() {},
      getCellEditor: () => ({}),
      getActiveCell: () => ({ row: 0, cell: 3 }),
      getDataItem: (i) => [{ id: '10' }, { id: '11' }][i]
    } };
    const { win, replies } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });
    win.postMessage({ source: 'cgp-submission-sync', id: 's', readStartedAt: 1, submissions: [
      { assignment_id: '7', user_id: '10', score: 8, assignment_visible: true },
      { assignment_id: '7', user_id: '11', score: 9, assignment_visible: true }
    ] }, win.location.origin);
    a.eq(store['10'].assignment_7.score, 5, 'the row being edited is left alone');
    a.eq(store['11'].assignment_7.score, 9);
    const results = replies()[0].results;
    a.deep(results.map((r) => [r.userId, r.skipped || null, !!r.stored]), [['10', 'editing', false], ['11', null, true]]);
  });

  test('opening the tray first saves a grade still typed in the cell, then opens it through Canvas', () => {
    const order = [];
    const gb = fakeGradebook({ '10': { assignment_7: {} } }, { open: false });
    gb.gradebookGrid = { grid: {
      getColumns() { return []; }, setColumns() {},
      getEditorLock: () => ({ isActive: () => true, commitCurrentEdit: () => { order.push('commit'); return true; } })
    } };
    gb.openSubmissionTray = (uid, aid) => order.push('open:' + aid + ':' + uid);
    const { win, posted } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });
    win.postMessage({ source: 'cgp-open-tray', id: 't1', assignmentId: '7', userId: '10' }, win.location.origin);
    a.deep(order, ['commit', 'open:7:10'], 'the typed grade is Canvas\'s own save, before the tray reads the store');
    const res = posted().find((m) => m.source === 'cgp-open-tray-result');
    a.eq(res.id, 't1');
    a.eq(res.ok, true);
    a.eq(res.committed, true);
  });

  test('with no Gradebook object to open it, the tray request says so (the arrow is clicked instead)', () => {
    const { win, posted } = loadBridgeWith({ querySelector: () => null });
    win.postMessage({ source: 'cgp-open-tray', id: 't2', assignmentId: '7', userId: '10' }, win.location.origin);
    a.eq(posted().find((m) => m.source === 'cgp-open-tray-result').ok, false);
  });

  test('a comment saved elsewhere makes an open tray on that submission re-read its thread', () => {
    const gb = fakeGradebook({ '10': { assignment_7: {} } }, { open: true, studentId: '10', assignmentId: '7' });
    const { win } = loadBridgeWith({ querySelector: (sel) => (sel === '#gradebook_app' ? reactMount(gb) : null) });
    win.postMessage({ source: 'cgp-submission-sync', id: 'c', submissions: [], commentsFor: [{ assignmentId: '7', userId: '10' }] }, win.location.origin);
    win.postMessage({ source: 'cgp-submission-sync', id: 'd', submissions: [], commentsFor: [{ assignmentId: '8', userId: '10' }] }, win.location.origin);
    a.deep(gb.calls.comments, [['7', '10']]);
  });
});

function gridOver(rows, calls) {
  return {
    getColumns: function () { return []; },
    setColumns: function () {},
    getDataLength: function () { return rows.length; },
    getDataItem: function (i) { return rows[i]; },
    invalidateRows: function (r) { calls.push(['invalidateRows', r]); },
    render: function () { calls.push(['render']); }
  };
}

/* A stand-in for Canvas's Gradebook component: the methods the bridge uses,
 * recording calls; updateSubmissionsFromExternal merges like Canvas's own. */
function fakeGradebook(store, tray) {
  const calls = { external: [], tray: [], comments: [] };
  return {
    calls: calls,
    student: function (id) { return store[id] ? Object.assign({ id: id }, store[id]) : undefined; },
    getSubmission: function (uid, aid) { return store[uid] ? store[uid]['assignment_' + aid] : undefined; },
    updateSubmissionsFromExternal: function (subs) {
      calls.external.push(subs);
      subs.forEach(function (s) {
        const row = store[s.user_id] || (store[s.user_id] = {});
        const cell = row['assignment_' + s.assignment_id] || (row['assignment_' + s.assignment_id] = {});
        Object.assign(cell, s, { excused: Boolean(s.excused) });
      });
    },
    getSubmissionTrayState: function () { return tray; },
    renderSubmissionTray: function (student) { calls.tray.push(student && student.id); },
    loadSubmissionComments: function (aid, uid) { calls.comments.push([aid, uid]); }
  };
}

/* #gradebook_app as React leaves it after a legacy render: a root whose
 * current fiber tree holds the Gradebook instance a level or two down. */
function reactMount(gb) {
  const gradebookFiber = { stateNode: gb, child: null, sibling: null };
  const dataFiber = { stateNode: null, child: gradebookFiber, sibling: null };
  const hostRoot = { stateNode: null, child: dataFiber, sibling: null };
  return { _reactRootContainer: { _internalRoot: { current: hostRoot } } };
}

function loadBridgeWith(opts) {
  const listeners = [];
  const posted = [];
  const win = {
    ENV: {},
    location: { origin: 'https://canvas.example.edu', pathname: '/courses/1/gradebook', search: '' },
    addEventListener: function (type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage: function (message) {
      posted.push(message);
      listeners.slice().forEach(function (listener) { listener({ source: win, data: message }); });
    }
  };
  if (opts.nativeWrites) {
    win.__cgpNativeWrites = { state: function (aid, uid) { return opts.nativeWrites[aid + ':' + uid] || null; } };
  }
  const context = {
    window: win,
    document: { querySelector: opts.querySelector },
    Promise: Promise, Object: Object, Array: Array, String: String, Number: Number, Set: Set,
    Math: Math, Date: Date, isFinite: isFinite, setTimeout: function (fn) { fn(); }
  };
  vm.runInNewContext(fs.readFileSync('src/page/env-bridge.js', 'utf8'), context);
  return {
    win: win,
    posted: function () { return posted; },
    replies: function () { return posted.filter(function (m) { return m.source === 'cgp-submission-synced'; }); }
  };
}
