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
});
