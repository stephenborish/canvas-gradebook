/* Bug 2: Canvas's "Test Student" preview row must stay hidden at every
 * horizontal scroll position, in every pane it appears in (the frozen name
 * cell in the left pane, the grade cells in the right pane, and this
 * extension's own frozen-Total overlay cell). layout.js's
 * hideTestStudentRows() derives who to hide fresh from the FROZEN pane's own
 * rows (the only place the student's name is actually rendered) every single
 * call, and matches every other pane's row to it by rowTop() alone - these
 * tests build exactly that cross-pane structure and check every part of it,
 * including the parts a class-name assumption or a stale reference would get
 * wrong: more than two `.grid-canvas` panes, and a `.cgp-total-cell` that is
 * created (not merely re-used) on the same pass. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function makeRow(FakeElement, top, opts) {
  opts = opts || {};
  const row = new FakeElement('div');
  row.classList.add('slick-row');
  row.style.top = top + 'px';
  row.setRect({ left: 0, top: top, width: 190, height: 35 });
  if (opts.name) {
    const link = new FakeElement('a');
    link.setAttribute('href', '/courses/1/grades/' + (opts.userId || '999'));
    link.textContent = opts.name;
    row.appendChild(link);
  }
  return row;
}

function buildTwoPaneGrid(CGP, rows) {
  // rows: array of {top, name, userId} for the FROZEN pane; a matching
  // (nameless) row is created in the scrolling pane at the same top.
  const doc = domshim.install();
  const FakeElement = domshim.FakeElement;
  const root = new FakeElement('div');
  doc.body.appendChild(root);

  const frozenCanvas = new FakeElement('div');
  frozenCanvas.classList.add('grid-canvas');
  frozenCanvas.setRect({ left: 0, top: 0, width: 190, height: 400 });
  root.appendChild(frozenCanvas);

  const scrollingCanvas = new FakeElement('div');
  scrollingCanvas.classList.add('grid-canvas');
  scrollingCanvas.setRect({ left: 190, top: 0, width: 800, height: 400 });
  root.appendChild(scrollingCanvas);

  const frozenRows = [];
  const scrollingRows = [];
  rows.forEach((spec) => {
    const fr = makeRow(FakeElement, spec.top, { name: spec.name, userId: spec.userId });
    frozenCanvas.appendChild(fr);
    frozenRows.push(fr);
    const sr = makeRow(FakeElement, spec.top, {});
    scrollingCanvas.appendChild(sr);
    scrollingRows.push(sr);
  });

  return { doc, root, frozenCanvas, scrollingCanvas, frozenRows, scrollingRows };
}

function makeLayout(CGP, adapter, want) {
  return new CGP.CompactLayoutController({
    adapter: adapter,
    settings: { values: { hideTestStudent: want } }
  });
}

suite('layout.hideTestStudentRows(): Test Student stays hidden across every pane', (test) => {
  test('the Test Student\'s row is hidden in BOTH panes, and a real student\'s row is left alone', () => {
    const CGP = loadGradebookDom();
    const grid = buildTwoPaneGrid(CGP, [
      { top: 0, name: 'Aaron Adams', userId: '10' },
      { top: 35, name: 'Test Student', userId: '999' },
      { top: 70, name: 'Zoe Zimmer', userId: '11' }
    ]);
    const adapter = new CGP.GradebookDomAdapter();
    const layout = makeLayout(CGP, adapter, true);

    layout.hideTestStudentRows();

    a.not(grid.frozenRows[0].classList.contains('cgp-hidden-row'), 'a real student\'s frozen-pane row stays visible');
    a.ok(grid.frozenRows[1].classList.contains('cgp-hidden-row'), 'the Test Student\'s own name row is hidden');
    a.not(grid.frozenRows[2].classList.contains('cgp-hidden-row'));

    a.not(grid.scrollingRows[0].classList.contains('cgp-hidden-row'));
    a.ok(grid.scrollingRows[1].classList.contains('cgp-hidden-row'), 'the matching grade-cell row in the scrolling pane is hidden too, by shared rowTop()');
    a.not(grid.scrollingRows[2].classList.contains('cgp-hidden-row'));
  });

  test('a .cgp-total-cell at the Test Student\'s row top is hidden even when it is CREATED fresh on this same pass (frozen.paint() runs before hideTestStudentRows in content.js\'s paint order)', () => {
    const CGP = loadGradebookDom();
    const grid = buildTwoPaneGrid(CGP, [
      { top: 0, name: 'Aaron Adams', userId: '10' },
      { top: 35, name: 'Test Student', userId: '999' }
    ]);
    const adapter = new CGP.GradebookDomAdapter();
    const layout = makeLayout(CGP, adapter, true);

    // Simulate frozen-total.js's overlay: a .cgp-total-cell appended into the
    // frozen canvas at the Test Student's own top, exactly as
    // FrozenTotalController.paint() creates one on a rowIndex it has never
    // drawn before - see content.js's paint() ordering comment.
    const totalCell = new (domshim.FakeElement)('div');
    totalCell.classList.add('cgp-total-cell');
    totalCell.style.top = '35px';
    grid.frozenCanvas.appendChild(totalCell);

    layout.hideTestStudentRows();

    a.ok(totalCell.classList.contains('cgp-hidden-row'), 'freshly-created Total overlay cell for the Test Student is hidden on the very same pass');
  });

  test('more than two .grid-canvas panes (e.g. a header canvas Canvas also tags .grid-canvas) does not break the cross-pane match', () => {
    const CGP = loadGradebookDom();
    const grid = buildTwoPaneGrid(CGP, [
      { top: 0, name: 'Test Student', userId: '999' }
    ]);
    // A third canvas at the SAME rowTop, standing in for whatever extra
    // .grid-canvas-shaped element a different Canvas build might render.
    const thirdCanvas = new (domshim.FakeElement)('div');
    thirdCanvas.classList.add('grid-canvas');
    thirdCanvas.setRect({ left: 990, top: 0, width: 100, height: 400 });
    grid.root.appendChild(thirdCanvas);
    const thirdRow = makeRow(domshim.FakeElement, 0, {});
    thirdCanvas.appendChild(thirdRow);

    const adapter = new CGP.GradebookDomAdapter();
    const layout = makeLayout(CGP, adapter, true);
    layout.hideTestStudentRows();

    a.ok(thirdRow.classList.contains('cgp-hidden-row'), 'a third pane\'s row at the same top is hidden too, not just the first two panes');
  });

  test('turning the setting off un-hides every previously-hidden row on the next call', () => {
    const CGP = loadGradebookDom();
    const grid = buildTwoPaneGrid(CGP, [
      { top: 0, name: 'Test Student', userId: '999' }
    ]);
    const adapter = new CGP.GradebookDomAdapter();
    const layout = makeLayout(CGP, adapter, true);
    layout.hideTestStudentRows();
    a.ok(grid.frozenRows[0].classList.contains('cgp-hidden-row'));

    layout.settings.values.hideTestStudent = false;
    layout.hideTestStudentRows();
    a.not(grid.frozenRows[0].classList.contains('cgp-hidden-row'));
    a.not(grid.scrollingRows[0].classList.contains('cgp-hidden-row'));
  });
});
