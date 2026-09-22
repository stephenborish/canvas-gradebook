'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function fixture(columns, hooks) {
  const CGP = loadGradebookDom();
  CGP.diag = CGP.diag || { bump: function () {}, warn: function () {}, set: function () {} };
  const doc = domshim.install();
  const root = new domshim.FakeElement('div');
  root.setAttribute('id', 'gradebook_grid');
  doc.body.appendChild(root);
  let model = columns.map((c) => Object.assign({}, c));
  const calls = [];
  const grid = {
    getColumns: function () { calls.push('getColumns'); return model; },
    setColumns: function (next) {
      calls.push('setColumns');
      model = next.map((c) => Object.assign({}, c));
      if (hooks && hooks.setColumns) hooks.setColumns(root, next);
    },
    invalidate: function () { calls.push('invalidate'); },
    render: function () { calls.push('render'); },
    resizeCanvas: function () { calls.push('resizeCanvas'); }
  };
  root.slickGrid = grid;
  const layout = new CGP.CompactLayoutController({
    adapter: { gridRoot: () => root },
    settings: { values: { narrowColumns: true, studentColumnWidth: 180, assignmentColumnWidth: 72 } }
  });
  // The production implementation sends these widths to env-bridge.js. Model
  // that page-world endpoint here so this controller test remains deterministic.
  layout.requestColumnSizing = function (studentWidth, assignmentWidth) {
    const columns = grid.getColumns();
    const next = columns.map(function (column) {
      const copy = Object.assign({}, column);
      const id = String(copy.id || copy.field || '').toLowerCase();
      if (id === 'student' || id === 'student_name' || id === 'name') copy.width = studentWidth;
      else if (/^assignment[_-]/.test(id) || copy.assignment_id != null) copy.width = assignmentWidth;
      return copy;
    });
    try {
      grid.setColumns(next); grid.invalidate(); grid.render(); grid.resizeCanvas();
      return Promise.resolve({ ok: true, changed: next.filter((c, i) => c.width !== columns[i].width).length });
    } catch (e) {
      try { grid.setColumns(columns); grid.invalidate(); grid.render(); grid.resizeCanvas(); } catch (ignored) {}
      return Promise.resolve({ ok: false, reason: 'failed' });
    }
  };
  let geometry = 0;
  layout.applyGeometry = function () { geometry++; };
  return { CGP, doc, root, grid, layout, calls, model: () => model, geometry: () => geometry,
    restore: () => {} };
}

suite('layout.resizeColumns(): atomic SlickGrid sizing', (test) => {
  test('sizes the complete model for a wide course in one transaction', async () => {
    const columns = [{ id: 'student', width: 300 }, { id: 'total_grade', width: 110 }];
    for (let i = 1; i <= 80; i++) columns.push({ id: 'assignment_' + i, width: 140 });
    const f = fixture(columns);
    try {
      a.eq(await f.layout.resizeColumns(), true);
      a.eq(f.calls.filter((x) => x === 'setColumns').length, 1, 'one model transaction');
      a.eq(f.model()[0].width, 180);
      a.eq(f.model()[1].width, 110, 'unrelated columns remain untouched');
      a.ok(f.model().slice(2).every((c) => c.width === 72), 'all 80 virtualised assignments are sized');
      a.deep(f.calls.slice(-4), ['setColumns', 'invalidate', 'render', 'resizeCanvas']);
      a.eq(f.geometry(), 1, 'frozen geometry is requested only after the transaction');
    } finally { f.restore(); }
  });

  test('does not depend on header identity when Canvas replaces a header during sizing', async () => {
    let oldHeader = new domshim.FakeElement('div');
    const f = fixture([{ id: 'student', width: 250 }, { id: 'assignment_7', width: 130 }], {
      setColumns: function (root) {
        if (oldHeader.parentElement) oldHeader.remove();
        const replacement = new domshim.FakeElement('div');
        replacement.classList.add('slick-header-column');
        root.appendChild(replacement);
      }
    });
    f.root.appendChild(oldHeader);
    try {
      a.eq(await f.layout.resizeColumns(), true);
      a.deep(f.model().map((c) => c.width), [180, 72]);
      a.eq(f.calls.filter((x) => x === 'setColumns').length, 1);
    } finally { f.restore(); }
  });

  test('stands down without gestures or model writes when no supported API exists', async () => {
    const f = fixture([{ id: 'assignment_1', width: 140 }]);
    f.layout.requestColumnSizing = function () { return Promise.resolve({ ok: false, reason: 'unavailable' }); };
    let dispatched = 0;
    f.root.dispatchEvent = function () { dispatched++; };
    try {
      a.eq(await f.layout.resizeColumns(), false);
      a.eq(f.calls.filter((x) => x === 'setColumns').length, 0);
      a.eq(dispatched, 0, 'no synthetic mouse gesture was attempted');
      a.ok(f.doc.documentElement.classList.contains('cgp-column-sizing-presentation-only'));
      a.eq(f.geometry(), 0, 'failed sizing cannot trigger frozen geometry');
    } finally { f.restore(); }
  });

  test('a throwing operation restores the entire original snapshot, never partial widths', async () => {
    let first = true;
    const original = [{ id: 'student', width: 260 }, { id: 'assignment_1', width: 140 }, { id: 'assignment_2', width: 150 }];
    const f = fixture(original, {
      setColumns: function () {
        if (first) { first = false; throw new Error('Canvas redraw failed'); }
      }
    });
    try {
      a.eq(await f.layout.resizeColumns(), false);
      a.deep(f.model().map((c) => c.width), [260, 140, 150], 'rollback restores every width');
      a.eq(f.calls.filter((x) => x === 'setColumns').length, 2, 'one transaction and one complete rollback');
      a.eq(f.geometry(), 0, 'no post-transaction geometry on failure');
      a.ok(f.doc.documentElement.classList.contains('cgp-column-sizing-presentation-only'));
    } finally { f.restore(); }
  });
});
