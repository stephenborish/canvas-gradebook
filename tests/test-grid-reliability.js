/* Regression tests for grid reliability fixes:
 *  A. row identity: the off-screen row cache is dropped when the grid's row
 *     count changes, and ensureRowsMapped() only reports success for rows it
 *     actually read live (never stale cache, never past the last row), and
 *     scrolls the pane that really scrolls vertically.
 *  B. the grade overlay is drawn only for this extension's own writes.
 *  C. failing column loads / comment verifications back off and give up.
 *  D. the page bridge leaves the grid alone until asked, only sizes known
 *     column kinds, never pins maxWidth, and re-posts the grading period.
 *  E. Final Grade Override is its own column type; "total" in header text
 *     never makes a column the Total.
 *  F. name-based reconciliation never retypes structurally known columns.
 *  G/H/I/K. frozen Total stand-down, overflow clamp re-apply, header-map
 *     caching, and unresolved cells losing stale marks. */
'use strict';

const fs = require('fs');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

const tick = () => new Promise((r) => setImmediate(r));

/* ------------------------------------------------------------- fixtures */

function makeRow(top, userId) {
  const row = new domshim.FakeElement('div');
  row.classList.add('slick-row');
  row.style.top = top + 'px';
  row.setRect({ left: 0, top: top, width: 190, height: 35 });
  if (userId) {
    const link = new domshim.FakeElement('a');
    link.setAttribute('href', '/courses/1/grades/' + userId);
    row.appendChild(link);
  }
  return row;
}

/* Frozen + scrolling panes inside left/right viewports. `rendered` lists the
 * {index, userId} rows currently in the DOM; `total` sets the canvas height. */
function buildRowGrid(rendered, total) {
  const doc = domshim.install();
  const F = domshim.FakeElement;
  const root = new F('div');
  root.setAttribute('id', 'gradebook_grid');
  doc.body.appendChild(root);
  const left = new F('div');
  left.classList.add('slick-viewport', 'slick-viewport-left');
  root.appendChild(left);
  const right = new F('div');
  right.classList.add('slick-viewport', 'slick-viewport-right');
  root.appendChild(right);
  const frozen = new F('div');
  frozen.classList.add('grid-canvas');
  left.appendChild(frozen);
  const scrolling = new F('div');
  scrolling.classList.add('grid-canvas');
  right.appendChild(scrolling);
  [left, right].forEach((v) => { v.scrollTop = 0; v.clientHeight = 350; v.scrollHeight = total * 35; });
  function setTotal(n) {
    frozen.style.height = (n * 35) + 'px';
    scrolling.style.height = (n * 35) + 'px';
  }
  function render(list) {
    frozen.children.slice().forEach((c) => c.remove());
    scrolling.children.slice().forEach((c) => c.remove());
    list.forEach((r) => {
      frozen.appendChild(makeRow(r.index * 35, r.userId));
      scrolling.appendChild(makeRow(r.index * 35, null));
    });
  }
  setTotal(total);
  render(rendered);
  return { doc, root, left, right, frozen, scrolling, setTotal, render };
}

function rows(from, to, idFor) {
  const out = [];
  for (let i = from; i < to; i++) out.push({ index: i, userId: idFor ? idFor(i) : String(500 + i) });
  return out;
}

/* ------------------------------------------------------------------- A */

suite('grid reliability A: row identity', (test) => {
  test('rowCount() reads the canvas height in rows', () => {
    const CGP = loadGradebookDom();
    buildRowGrid(rows(0, 3), 12);
    const adapter = new CGP.GradebookDomAdapter();
    a.eq(adapter.rowCount(), 12);
  });

  test('the off-screen row cache is dropped when the row count changes, even with the same rendered rows', () => {
    const CGP = loadGradebookDom();
    const g = buildRowGrid(rows(0, 3), 20);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshRows();
    // An off-screen row learned earlier (e.g. by a walk).
    adapter.rowIndexToStudent.set(15, '777');
    adapter.studentToRowIndex.set('777', 15);
    adapter.refreshRows();
    a.eq(adapter.studentAt(15), '777', 'unchanged row count keeps the off-screen cache');

    // A filter removes an off-screen student: visible rows identical.
    g.setTotal(19);
    adapter.refreshRows();
    a.eq(adapter.studentAt(15), null, 'off-screen identity invalidated');
    a.eq(adapter.rowIndexForStudent('777'), null);
    a.eq(adapter.studentAt(1), '501', 'rendered rows are re-learned live in the same pass');
  });

  test('ensureRowsMapped resolves true for rendered rows without scrolling', async () => {
    const CGP = loadGradebookDom();
    const g = buildRowGrid(rows(0, 10), 30);
    const adapter = new CGP.GradebookDomAdapter();
    let wrote = 0;
    [g.left, g.right].forEach((vp) => {
      Object.defineProperty(vp, 'scrollTop', { get() { return 0; }, set() { wrote++; } });
    });
    a.eq(await adapter.ensureRowsMapped(2, 5), true);
    a.eq(wrote, 0, 'no scroll needed');
    a.eq(adapter.studentAt(6), '506');
  });

  test('ensureRowsMapped returns false for indices beyond rowCount()', async () => {
    const CGP = loadGradebookDom();
    buildRowGrid(rows(0, 5), 5);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.rowIndexToStudent.set(5, '999');   // stale: there is no row 5
    a.eq(await adapter.ensureRowsMapped(3, 4), false, 'rows 5 and 6 do not exist');
    a.eq(adapter.studentAt(3), '503', 'confirmed rows stay mapped');
    a.eq(adapter.studentAt(4), '504');
    a.eq(adapter.studentAt(5), null, 'stale entry past the end is dropped');
  });

  test('ensureRowsMapped returns false (and drops the entry) for a stale-only index that cannot be confirmed live', async () => {
    const CGP = loadGradebookDom();
    const g = buildRowGrid(rows(0, 3), 10);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.rowIndexToStudent.set(6, '888');
    adapter.studentToRowIndex.set('888', 6);
    // The walk scrolls, but this fake grid never renders row 6.
    a.eq(await adapter.ensureRowsMapped(5, 2), false);
    a.eq(adapter.studentAt(6), null, 'studentAt() reports null, not the stale id');
    a.eq(adapter.rowIndexForStudent('888'), null);
    a.eq(g.left.scrollTop, 0, 'scroll position restored');
  });

  test('ensureRowsMapped confirms rows rendered during the walk and restores scroll', async () => {
    const CGP = loadGradebookDom();
    const g = buildRowGrid(rows(0, 10), 40);
    const adapter = new CGP.GradebookDomAdapter();
    // Stale ids for rows 20-22 from before a re-sort.
    [20, 21, 22].forEach((i) => adapter.rowIndexToStudent.set(i, 'stale' + i));
    const vp = adapter.verticalScrollViewport();
    let top = 0;
    Object.defineProperty(vp, 'scrollTop', {
      get() { return top; },
      set(v) {
        top = v;
        const first = Math.floor(v / 35);
        g.render(rows(first, first + 10, (i) => String(9000 + i)));
      }
    });
    a.eq(await adapter.ensureRowsMapped(20, 3), true);
    a.eq(adapter.studentAt(21), '9021', 'live id from the walk replaced the stale one');
    a.eq(top, 0, 'restored to the original position');
  });

  test('vertical scrolling targets the pane that is actually scrollable (right/main), not the overflow-hidden left one', () => {
    const CGP = loadGradebookDom();
    const g = buildRowGrid(rows(0, 10), 100);
    const origGCS = global.getComputedStyle;
    global.getComputedStyle = function (el) {
      return {
        position: 'static',
        overflowY: el === g.right ? 'auto' : (el === g.left ? 'hidden' : 'visible')
      };
    };
    try {
      const adapter = new CGP.GradebookDomAdapter();
      a.ok(adapter.verticalScrollViewport() === g.right);
      adapter.scrollRowIntoView(50);
      a.ok(g.right.scrollTop > 0, 'right pane scrolled');
      a.eq(g.left.scrollTop, 0, 'left (follower) pane untouched');
    } finally {
      global.getComputedStyle = origGCS;
    }
  });

  test('cellElementAt finds a rendered cell by row top and b<n> class', () => {
    const CGP = loadGradebookDom();
    const g = buildRowGrid(rows(0, 4), 4);
    const cell = new domshim.FakeElement('div');
    cell.classList.add('slick-cell', 'b3', 'f3');
    g.scrolling.children[2].appendChild(cell);
    const adapter = new CGP.GradebookDomAdapter();
    a.ok(adapter.cellElementAt(2, 3) === cell);
    a.eq(adapter.cellElementAt(1, 3), null);
  });
});

/* ------------------------------------------------------------------- B */

function overlayController(CGP, rec) {
  return new CGP.IndicatorController({
    model: {
      cell: () => rec,
      everLoadedAssignments: new Set(['101']),
      submissionState: () => null
    },
    adapter: {},
    registry: { needsPaint: () => true, markPainted: () => {} },
    settings: { values: { commentIndicator: false, submissionIndicator: false } }
  });
}

function gradeCell(canvasText) {
  const cell = new domshim.FakeElement('div');
  cell.classList.add('slick-cell');
  cell.textContent = canvasText;   // Canvas's rendered text
  return cell;
}

const INFO = (cell) => ({ el: cell, columnType: 'assignment', assignmentId: '101', studentId: '501' });

suite('grid reliability B: grade overlay only for local writes', (test) => {
  test('late-penalty submission: entered_score differs from Canvas\'s deducted score, no overlay', () => {
    const CGP = loadGradebookDom();
    const cell = gradeCell('8');
    overlayController(CGP, { assignmentId: '101', userId: '501', enteredScore: 10, score: 8, grade: '8', late: true, override: null })
      .paintCell(INFO(cell));
    a.ok(!cell.classList.contains('cgp-override'));
    a.eq(cell.querySelector('.cgp-val'), null, 'Canvas\'s "8" is not covered with the pre-deduction 10');
  });

  test('letter-grade column: "B+" is not replaced by the raw score', () => {
    const CGP = loadGradebookDom();
    const cell = gradeCell('B+');
    overlayController(CGP, { assignmentId: '101', userId: '501', score: 87, enteredScore: 87, grade: 'B+', override: null })
      .paintCell(INFO(cell));
    a.eq(cell.querySelector('.cgp-val'), null);
  });

  test('excused: Canvas\'s "Excused" text is left alone', () => {
    const CGP = loadGradebookDom();
    const cell = gradeCell('Excused');
    overlayController(CGP, { assignmentId: '101', userId: '501', excused: true, score: null, grade: null, override: null })
      .paintCell(INFO(cell));
    a.eq(cell.querySelector('.cgp-val'), null);
  });

  test('a stale overlay is removed once there is no local write', () => {
    const CGP = loadGradebookDom();
    const cell = gradeCell('B+');
    const old = new domshim.FakeElement('span');
    old.classList.add('cgp-val');
    cell.appendChild(old);
    cell.classList.add('cgp-override');
    overlayController(CGP, { assignmentId: '101', userId: '501', score: 87, grade: 'B+', override: null })
      .paintCell(INFO(cell));
    a.eq(cell.querySelector('.cgp-val'), null);
    a.ok(!cell.classList.contains('cgp-override'));
  });

  test('a local write shows rec.override until Canvas shows the same value', () => {
    const CGP = loadGradebookDom();
    const cell = gradeCell('7');
    overlayController(CGP, { assignmentId: '101', userId: '501', score: 9, grade: '9', override: '9', pending: false })
      .paintCell(INFO(cell));
    a.eq(cell.querySelector('.cgp-val').textContent, '9');
    const cell2 = gradeCell('9.0');
    overlayController(CGP, { assignmentId: '101', userId: '501', score: 9, grade: '9', override: '9' })
      .paintCell(INFO(cell2));
    a.eq(cell2.querySelector('.cgp-val'), null, 'numerically equal Canvas text drops the overlay');
  });

  test('a pending write without an override shows rec.grade', () => {
    const CGP = loadGradebookDom();
    const cell = gradeCell('');
    overlayController(CGP, { assignmentId: '101', userId: '501', grade: 'A-', pending: true, override: null })
      .paintCell(INFO(cell));
    a.eq(cell.querySelector('.cgp-val').textContent, 'A-');
  });
});

/* ------------------------------------------------------------------- K */

suite('grid reliability K: unresolved cells lose stale marks', (test) => {
  test('a recycled cell whose student cannot be resolved is cleared', () => {
    const CGP = loadGradebookDom();
    const cell = new domshim.FakeElement('div');
    cell.classList.add('slick-cell', 'cgp-has-comment', 'cgp-status-missing', 'cgp-override');
    const marks = new domshim.FakeElement('span');
    marks.classList.add('cgp-marks');
    cell.appendChild(marks);
    const val = new domshim.FakeElement('span');
    val.classList.add('cgp-val');
    cell.appendChild(val);
    let invalidated = 0;
    const c = new CGP.IndicatorController({
      model: { cell: () => null, everLoadedAssignments: new Set(), submissionState: () => null },
      adapter: {},
      registry: { needsPaint: () => true, markPainted: () => {}, invalidate: () => { invalidated++; } },
      settings: { values: {} }
    });
    c.paintCell({ el: cell, columnType: 'assignment', assignmentId: '101', studentId: null });
    a.eq(cell.querySelector('.cgp-marks'), null);
    a.eq(cell.querySelector('.cgp-val'), null);
    a.ok(!cell.classList.contains('cgp-has-comment'));
    a.ok(!cell.classList.contains('cgp-status-missing'));
    a.ok(!cell.classList.contains('cgp-override'));
    a.eq(invalidated, 1, 'paint signature dropped so a later resolve repaints');
  });
});

/* ------------------------------------------------------------------- C */

function backoffFixture(CGP, opts) {
  const cell = new domshim.FakeElement('div');
  cell.classList.add('slick-cell');
  const calls = { load: 0, verify: 0 };
  const model = {
    ready: true,
    loadedAssignments: new Set(),
    everLoadedAssignments: new Set(),
    commentVerifiedAssignments: new Set(),
    cell: () => null,
    submissionState: () => null,
    stats: () => ({}),
    ensureAssignments: (ids) => {
      calls.load++;
      if (opts.loadOk) ids.forEach((id) => model.loadedAssignments.add(id));
      return Promise.resolve();
    },
    verifyVisibleComments: (ids) => {
      calls.verify++;
      if (opts.verifyOk) ids.forEach((id) => model.commentVerifiedAssignments.add(id));
      return Promise.resolve();
    }
  };
  const c = new CGP.IndicatorController({
    model: model,
    adapter: { visibleCells: () => [{ el: cell, columnType: 'assignment', assignmentId: '101', studentId: '501' }] },
    registry: { sync: (x) => x, needsPaint: () => true, markPainted: () => {} },
    settings: { values: { commentIndicator: true } }
  });
  return { c, calls, model };
}

suite('grid reliability C: failure backoff', (test) => {
  test('a failed load / verify is not re-requested on the next paint, retried after nextAt, abandoned after 6', async () => {
    const CGP = loadGradebookDom();
    const f = backoffFixture(CGP, { loadOk: false, verifyOk: false });
    f.c.paint();
    await tick();
    a.eq(f.calls.load, 1);
    a.eq(f.calls.verify, 1);
    const lf = f.c.loadFailures.get('101');
    a.eq(lf.count, 1);
    a.ok(lf.nextAt - Date.now() > 1500 && lf.nextAt - Date.now() <= 2000, 'first backoff ~2s');

    f.c.paint();
    await tick();
    a.eq(f.calls.load, 1, 'not retried inside the backoff window');
    a.eq(f.calls.verify, 1);

    for (let i = 0; i < 8; i++) {
      f.c.loadFailures.get('101').nextAt = 0;
      f.c.commentFailures.get('101').nextAt = 0;
      f.c.paint();
      await tick();
    }
    a.eq(f.calls.load, 6, 'gives up after 6 consecutive failures');
    a.eq(f.calls.verify, 6);
    a.ok(f.c.commentFailures.get('101').count === 6);
  });

  test('backoff grows exponentially and caps at 60s', async () => {
    const CGP = loadGradebookDom();
    const f = backoffFixture(CGP, { loadOk: false, verifyOk: true });
    const waits = [];
    for (let i = 0; i < 5; i++) {
      const prev = f.c.loadFailures.get('101');
      if (prev) prev.nextAt = 0;
      f.c.paint();
      await tick();
      waits.push(Math.round((f.c.loadFailures.get('101').nextAt - Date.now()) / 1000));
    }
    a.deep(waits, [2, 4, 8, 16, 32]);
    f.c.noteResult(f.c.loadFailures, 'x', false, 't');
    f.c.loadFailures.get('x').count = 7;
    f.c.noteResult(f.c.loadFailures, 'x', false, 't');
    a.ok(f.c.loadFailures.get('x').nextAt - Date.now() <= 60000, 'capped');
  });

  test('a success clears the failure record', async () => {
    const CGP = loadGradebookDom();
    const f = backoffFixture(CGP, { loadOk: false, verifyOk: false });
    f.c.paint();
    await tick();
    a.ok(f.c.loadFailures.has('101'));
    f.model.ensureAssignments = (ids) => { f.calls.load++; ids.forEach((id) => f.model.loadedAssignments.add(id)); return Promise.resolve(); };
    f.model.verifyVisibleComments = (ids) => { f.calls.verify++; ids.forEach((id) => f.model.commentVerifiedAssignments.add(id)); return Promise.resolve(); };
    f.c.loadFailures.get('101').nextAt = 0;
    f.c.commentFailures.get('101').nextAt = 0;
    f.c.paint();
    await tick();
    a.ok(!f.c.loadFailures.has('101'));
    a.ok(!f.c.commentFailures.has('101'));
  });
});

/* ------------------------------------------------------------------- D */

function loadBridge(opts) {
  opts = opts || {};
  const doc = domshim.install();
  const F = domshim.FakeElement;
  const root = new F('div');
  root.setAttribute('id', 'gradebook_grid');
  doc.body.appendChild(root);
  const elsewhere = new F('div');
  doc.body.appendChild(elsewhere);

  let model = (opts.columns || []).map((c) => Object.assign({}, c));
  const calls = [];
  const grid = {
    getContainerNode: () => root,
    getColumns: () => model,
    setColumns: function (columns) { calls.push('setColumns'); model = columns; },
    autosizeColumns: function () { calls.push('autosize'); },
    invalidate: () => {}, render: () => {}, resizeCanvas: () => {}
  };
  root.slickGrid = grid;

  const listeners = [];
  const posted = [];
  const intervals = [];
  const win = {
    ENV: opts.ENV || {},
    location: { origin: 'https://canvas.example.edu', pathname: '/courses/1/gradebook', search: opts.search || '' },
    addEventListener: function (type, fn) { if (type === 'message') listeners.push(fn); },
    postMessage: function (message) {
      posted.push(message);
      listeners.slice().forEach((fn) => fn({ source: win, data: message }));
    }
  };
  const context = {
    window: win, document: doc, Promise, Object, Array, String, Number, Math, isFinite, Set, Date,
    setTimeout: (fn) => fn(),
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: (id) => { intervals[id - 1] = null; },
    decodeURIComponent
  };
  const code = fs.readFileSync('src/page/env-bridge.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(code, context);
  return {
    win, grid, root, elsewhere, posted, intervals, listeners, model: () => model, calls, code, context,
    request: async (msg) => {
      win.postMessage(Object.assign({ source: 'cgp-grid-request', id: 'r' + posted.length }, msg));
      for (let i = 0; i < 4; i++) await Promise.resolve();
      return posted.filter((m) => m.source === 'cgp-grid-response').pop();
    },
    runIntervals: () => intervals.forEach((fn) => fn && fn())
  };
}

const COLS = [
  { id: 'student', width: 260 },
  { id: 'custom_col_3', width: 100 },
  { id: 'assignment_7', width: 140, minWidth: 90 },
  { id: 'assignment_group_2', width: 90 },
  { id: 'total_grade', width: 110 },
  { id: 'total_grade_override', width: 110 },
  { id: 'student_lastname', width: 120 }
];

suite('grid reliability D: page bridge', (test) => {
  test('double execution is a no-op', () => {
    const b = loadBridge({ columns: COLS });
    const before = b.listeners.length;
    vm.runInContext(b.code, b.context);
    a.eq(b.listeners.length, before, 'second copy registered nothing');
  });

  test('the grid is patched but left completely alone until a request arrives', () => {
    const b = loadBridge({ columns: COLS });
    b.runIntervals();   // background search finds and patches the grid
    a.ok(b.grid.__cgpPatchedSetColumns, 'patched');
    const next = COLS.map((c) => Object.assign({}, c));
    b.grid.setColumns(next);
    a.deep(b.model().map((c) => c.width), COLS.map((c) => c.width), 'setColumns passes widths through untouched');
    b.grid.autosizeColumns();
    a.eq(b.calls.filter((x) => x === 'autosize').length, 1, 'autosize goes to Canvas\'s own implementation');
  });

  test('narrow: sizes only student / assignment_<id>, never pins maxWidth', async () => {
    const b = loadBridge({ columns: COLS });
    const res = await b.request({ studentWidth: 180, assignmentWidth: 72, narrow: true });
    a.deep(res.result, { ok: true, changed: 2 });
    const m = b.model();
    a.deep(m.map((c) => c.width), [180, 100, 72, 90, 110, 110, 120],
      'custom, group, total, override and split-name columns untouched');
    a.ok(m.every((c) => c.maxWidth === undefined), 'maxWidth never set, so drag-resize still works');
    a.eq(m[2].minWidth, 24, 'minWidth only lowered to a small floor');
    // Canvas re-sets columns later: the patch re-applies the same widths.
    b.grid.setColumns(COLS.map((c) => Object.assign({}, c)));
    a.deep(b.model().map((c) => c.width), [180, 100, 72, 90, 110, 110, 120]);
  });

  test('a SlickGrid outside #gradebook_grid is never patched', () => {
    const b = loadBridge({ columns: COLS });
    function OtherGrid(container) {
      this.getContainerNode = () => container;
      this.getColumns = () => [];
      this.setColumns = () => {};
    }
    b.win.Slick = { Grid: OtherGrid };
    const other = new b.win.Slick.Grid(b.elsewhere);
    a.ok(!other.__cgpPatchedSetColumns, 'unrelated grid untouched');
    const ours = new b.win.Slick.Grid(b.root);
    a.ok(ours.__cgpPatchedSetColumns, 'the gradebook grid is patched');
  });

  test('the background search stops once the grid is found', () => {
    const b = loadBridge({ columns: COLS });
    a.eq(b.intervals.filter(Boolean).length, 2, 'search + env poll');
    b.runIntervals();
    a.eq(b.intervals.filter(Boolean).length, 1, 'only the cheap env/liveness poll remains');
  });

  test('a grading period change in-page is re-posted as cgp-env', () => {
    const b = loadBridge({ columns: COLS, ENV: { GRADEBOOK_OPTIONS: { current_grading_period_id: '5' } } });
    const env = () => b.posted.filter((m) => m.source === 'cgp-env');
    a.eq(env()[0].env.currentGradingPeriodId, '5', 'initial post');
    for (let i = 0; i < 35; i++) b.runIntervals();   // past the repeat window
    const n = env().length;
    b.runIntervals();
    a.eq(env().length, n, 'nothing posted while unchanged');
    b.win.location.search = '?grading_period_id=7';
    b.runIntervals();
    a.eq(env().length, n + 1);
    a.eq(env().pop().env.currentGradingPeriodId, '7');
  });
});

/* ------------------------------------------------------------------- E/F */

function headerGrid(leftHeaders, rightHeaders) {
  const doc = domshim.install();
  const F = domshim.FakeElement;
  const root = new F('div');
  root.setAttribute('id', 'gradebook_grid');
  doc.body.appendChild(root);
  const make = (side, specs) => {
    const pane = new F('div');
    pane.classList.add('slick-pane', 'slick-pane-' + side);
    root.appendChild(pane);
    const cols = new F('div');
    cols.classList.add('slick-header-columns');
    pane.appendChild(cols);
    const els = specs.map((s) => {
      const h = new F('div');
      if (s.text) h.textContent = s.text;
      h.classList.add('slick-header-column');
      if (s.id) h.setAttribute('id', 'slickgrid_1_' + s.id);
      h.setRect({ left: 0, top: 0, width: 100, height: 40 });
      cols.appendChild(h);
      return h;
    });
    return { cols, els };
  };
  return { left: make('left', leftHeaders), right: make('right', rightHeaders) };
}

suite('grid reliability E: Final Grade Override and "total" text', (test) => {
  test('total_grade_override classifies as override, not total', () => {
    const CGP = loadGradebookDom();
    a.eq(CGP.gridMap.classifyColumnId('total_grade_override').type, 'override');
    a.eq(CGP.gridMap.classifyColumnId('total_grade').type, 'total');
    const g = headerGrid([{ id: 'student' }], [{ id: 'assignment_1' }, { id: 'total_grade' }, { id: 'total_grade_override' }]);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshColumns();
    a.eq(adapter.columnAt(3).type, 'override');
    a.eq(adapter._totalColIndex, 2, 'only the real Total is the Total');
    void g;
  });

  test('a header is never classified as Total by text containing "total"', () => {
    const CGP = loadGradebookDom();
    headerGrid([{ id: 'student' }], []);
    const adapter = new CGP.GradebookDomAdapter();
    const h = new domshim.FakeElement('div');
    h.textContent = 'Total Points Earned';
    h.setAttribute('title', 'Total Points Earned');
    a.eq(adapter.columnIdForHeader(h), null);
  });

  test('columnIdForHeader ignores this extension\'s own .cgp-header-title link', () => {
    const CGP = loadGradebookDom();
    headerGrid([{ id: 'student' }], []);
    const adapter = new CGP.GradebookDomAdapter();
    const h = new domshim.FakeElement('div');
    const label = new domshim.FakeElement('div');
    label.classList.add('cgp-header-label');
    const link = new domshim.FakeElement('a');
    link.classList.add('cgp-header-title');
    link.setAttribute('href', '/courses/1/assignments/55');
    label.appendChild(link);
    h.appendChild(label);
    a.eq(adapter.columnIdForHeader(h), null, 'own link is not evidence of identity');
    const native = new domshim.FakeElement('a');
    native.setAttribute('href', '/courses/1/assignments/66');
    h.appendChild(native);
    a.eq(adapter.columnIdForHeader(h), 'assignment_66');
  });

});

function nameModel() {
  return {
    ready: true,
    assignmentOrder: ['55'],
    assignments: new Map([['55', { id: '55', name: 'Quiz 1', pointsPossible: 10 }]])
  };
}

suite('grid reliability F: name reconciliation only for unidentified columns', (test) => {
  test('custom / group / override columns titled like an assignment keep their type', () => {
    const CGP = loadGradebookDom();
    headerGrid([{ id: 'student' }], [
      { id: 'custom_col_3', text: 'Quiz 1' },
      { id: 'assignment_group_2', text: 'Quiz 1' },
      { id: 'total_grade_override', text: 'Quiz 1' },
      { text: 'Quiz 1' }
    ]);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshColumns();
    a.eq(adapter.reconcileColumnsWithModel(nameModel()), 1, 'only the unidentified header is matched');
    a.eq(adapter.columnAt(1).type, 'custom');
    a.eq(adapter.columnAt(2).type, 'group');
    a.eq(adapter.columnAt(3).type, 'override');
    a.eq(adapter.columnAt(4).type, 'assignment');
    a.eq(adapter.columnAt(4).assignmentId, '55');

    // Fast path on the next refresh: still only the unidentified header.
    adapter.refreshColumns(true);
    a.eq(adapter.columnAt(1).type, 'custom');
    a.eq(adapter.columnAt(2).type, 'group');
    a.eq(adapter.columnAt(4).assignmentId, '55');
  });
});

/* ------------------------------------------------------------------- I */

suite('grid reliability I: header map reuse', (test) => {
  test('refreshColumns() reuses the map within a pass until the header shape changes', async () => {
    const CGP = loadGradebookDom();
    const g = headerGrid([{ id: 'student' }], [{ id: 'assignment_1' }]);
    const adapter = new CGP.GradebookDomAdapter();
    const first = adapter.refreshColumns();
    a.ok(adapter.refreshColumns() === first, 'second call in the same pass is a no-op');
    const h = new domshim.FakeElement('div');
    h.classList.add('slick-header-column');
    h.setAttribute('id', 'slickgrid_1_assignment_2');
    g.right.cols.appendChild(h);
    const second = adapter.refreshColumns();
    a.ok(second !== first, 'a header added changes the shape');
    a.eq(adapter.columnAt(2).assignmentId, '2');
    adapter.invalidateColumns();
    a.ok(adapter.refreshColumns() !== second, 'invalidateColumns() forces a rebuild');
    await tick();
    const third = adapter.refreshColumns();
    a.ok(adapter.refreshColumns() === third);
  });
});

suite('grid reliability D: settings turned off restore Canvas widths', (test) => {
  test('turning narrowing off puts Canvas\'s own widths back', async () => {
    const b = loadBridge({ columns: COLS });
    await b.request({ studentWidth: 180, assignmentWidth: 72, narrow: true });
    a.deep(b.model().map((c) => c.width), [180, 100, 72, 90, 110, 110, 120]);
    const res = await b.request({ studentWidth: null, assignmentWidth: null, narrow: false });
    a.eq(res.result.ok, true);
    a.deep(b.model().map((c) => c.width), COLS.map((c) => c.width), 'every resized column restored');
    a.eq(b.model()[2].minWidth, 90, 'minWidth restored too');
  });
});

suite('grid reliability: PR review follow-ups', (test) => {
  test('clearing a recycled cell also restores native icons a badge had hidden', () => {
    const CGP = loadGradebookDom();
    const cell = new domshim.FakeElement('div');
    cell.classList.add('slick-cell', 'cgp-status-missing');
    const icon = new domshim.FakeElement('span');
    icon.setAttribute('data-cgp-hid', '1');
    icon.style.setProperty('display', 'none', 'important');
    cell.appendChild(icon);
    const c = new CGP.IndicatorController({
      model: { cell: () => null, everLoadedAssignments: new Set(), submissionState: () => null },
      adapter: {},
      registry: { needsPaint: () => true, markPainted: () => {}, invalidate: () => {} },
      settings: { values: {} }
    });
    c.clearCell(cell);
    a.eq(icon.getAttribute('data-cgp-hid'), null, 'tag removed');
    a.ok(!icon.style.getPropertyValue || !icon.style.getPropertyValue('display'), 'inline hiding removed');
  });

  test('a failed column load asks for a repaint once its backoff runs out', async () => {
    const CGP = loadGradebookDom();
    let painted = 0;
    const c = new CGP.IndicatorController({
      model: {}, adapter: {}, registry: {}, settings: { values: {} },
      requestPaint: () => { painted++; }
    });
    const realSetTimeout = global.setTimeout;
    const scheduled = [];
    global.setTimeout = (fn, ms) => { scheduled.push(ms); return realSetTimeout(fn, 0); };
    try {
      c.noteResult(c.loadFailures, '7', false, 'test');
    } finally {
      global.setTimeout = realSetTimeout;
    }
    await new Promise((r) => realSetTimeout(r, 5));
    a.eq(scheduled[0], 2050, 'scheduled just after the 2s backoff');
    a.eq(painted, 1);
  });
});

/* ------------------------------------------------------------- post-clear */

suite('grid reliability: Canvas\'s unposted dot follows our confirmed posts', (test) => {
  const base = { assignmentId: '101', userId: '501', override: null, workflowState: 'graded', score: 3, grade: '3' };
  const paint = (CGP, rec, confirmed) => {
    const cell = gradeCell('3');
    const c = overlayController(CGP, rec);
    c.model.isPostConfirmed = () => confirmed;
    c.paintCell(INFO(cell));
    return cell;
  };
  const posted = { postedAt: '2026-10-16T12:00:00Z', postedAtKnown: true };
  test('a cell still waiting to be posted is not flagged', () => {
    const cell = paint(loadGradebookDom(), Object.assign({}, base, { postedAt: null, postedAtKnown: true }), true);
    a.ok(!cell.classList.contains('cgp-post-clear'));
  });
  test('posted through the extension: flagged so Canvas\'s stale dot is hidden', () => {
    a.ok(paint(loadGradebookDom(), Object.assign({}, base, posted), true).classList.contains('cgp-post-clear'));
  });
  test('posted but not by this extension: Canvas\'s own dot is left alone', () => {
    a.ok(!paint(loadGradebookDom(), Object.assign({}, base, posted), false).classList.contains('cgp-post-clear'));
  });
  test('has_postable_comments without posted_at is not enough', () => {
    const rec = Object.assign({}, base, { postedAt: null, postedAtKnown: false, hasPostableKnown: true, hasPostableComments: false });
    a.ok(!paint(loadGradebookDom(), rec, true).classList.contains('cgp-post-clear'));
  });
});
