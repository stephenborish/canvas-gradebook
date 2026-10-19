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

  test('a submission saved through the API is handed to Canvas\'s own row, in its own spelling', () => {
    const rows = [
      { id: '1', assignment_7: { latePolicyStatus: 'missing', missing: true, late: false, grade: '0', score: 0, enteredScore: 0 } },
      { id: '2', assignment_7: { late_policy_status: 'missing', missing: true, grade: '0' } }
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

    const fields = { latePolicyStatus: 'late', missing: false, late: true, excused: false, grade: '3', score: 3, enteredScore: 3, workflowState: 'graded' };
    win.postMessage({ source: 'cgp-submission-sync', assignmentId: '7', userId: '1', fields: fields }, win.location.origin);
    win.postMessage({ source: 'cgp-submission-sync', assignmentId: '7', userId: '2', fields: fields }, win.location.origin);

    a.eq(rows[0].assignment_7.latePolicyStatus, 'late');
    a.eq(rows[0].assignment_7.missing, false);
    a.eq(rows[0].assignment_7.late, true);
    a.eq(rows[0].assignment_7.grade, '3');
    a.ok(!('late_policy_status' in rows[0].assignment_7), 'no snake_case field added');
    a.ok(!('workflowState' in rows[0].assignment_7), 'a field Canvas does not have is never added');
    a.eq(rows[1].assignment_7.late_policy_status, 'late', 'snake_case submissions keep their own spelling');
    a.eq(rows[1].assignment_7.missing, false);
    a.deep(calls, [['invalidateRows', [0]], ['render'], ['invalidateRows', [1]], ['render']]);
  });
});
