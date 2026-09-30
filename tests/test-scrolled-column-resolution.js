/* Regression test for column/grade misalignment on horizontally scrolled grids:
 * When a gradebook with many columns is scrolled to the right, SlickGrid
 * virtualizes cells horizontally. The row DOM only contains the ~8 visible
 * cells, not all 30+ columns.
 *
 * Previously, when columnIndexFromClassName returned null, resolveColIndexForCell
 * fell back to `siblings.indexOf(cell) + offset`. For visible cells on columns 20..27,
 * `siblings.indexOf(cell)` returned 0..7, mapping future/scrolled assignments to
 * the FIRST assignments of the semester (columns 2..9)!
 *
 * These tests verify:
 * 1. Geometric matching and assignment ID detection correctly identify the scrolled columns.
 * 2. Horizontally virtualized rows never fall back to `offset + siblings.indexOf(cell)`.
 * 3. The wantedGrade overlay in indicators.js never stamps grades onto empty/ungraded Canvas cells.
 */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function buildScrolledGridWithColumns(CGP, columnCount, visibleStart, visibleCount) {
  const doc = domshim.install();
  const body = doc.body;
  const FakeElement = domshim.FakeElement;

  const root = new FakeElement('div');
  root.setAttribute('id', 'gradebook_grid');
  root.setRect({ left: 0, top: 0, width: 1000, height: 400 });
  body.appendChild(root);

  // Headers
  const headerWrap = new FakeElement('div');
  headerWrap.classList.add('slick-header');
  root.appendChild(headerWrap);

  // Left header pane (frozen): 1 column (Student Name, width 150)
  const headerPaneLeft = new FakeElement('div');
  headerPaneLeft.classList.add('slick-pane', 'slick-header-left');
  headerPaneLeft.setRect({ left: 0, top: 0, width: 150, height: 40 });
  headerWrap.appendChild(headerPaneLeft);

  const headerColsLeft = new FakeElement('div');
  headerColsLeft.classList.add('slick-header-columns', 'slick-header-columns-left');
  headerColsLeft.setRect({ left: 0, top: 0, width: 150, height: 40 });
  headerPaneLeft.appendChild(headerColsLeft);

  const colStudent = new FakeElement('div');
  colStudent.classList.add('slick-header-column');
  colStudent.setAttribute('id', 'slickgrid_student_name');
  colStudent.setRect({ left: 0, top: 0, width: 150, height: 40 });
  colStudent.offsetLeft = 0;
  colStudent.offsetWidth = 150;
  headerColsLeft.appendChild(colStudent);

  // Right header pane (scrolling): Total column + assignment columns (width 100 each)
  const headerPaneRight = new FakeElement('div');
  headerPaneRight.classList.add('slick-pane', 'slick-header-right');
  headerPaneRight.setRect({ left: 150, top: 0, width: 850, height: 40 });
  headerWrap.appendChild(headerPaneRight);

  const headerColsRight = new FakeElement('div');
  headerColsRight.classList.add('slick-header-columns', 'slick-header-columns-right');
  headerColsRight.setRect({ left: 150, top: 0, width: (columnCount + 1) * 100, height: 40 });
  headerPaneRight.appendChild(headerColsRight);

  // Column 1: Total column
  const colTotal = new FakeElement('div');
  colTotal.classList.add('slick-header-column');
  colTotal.setAttribute('id', 'slickgrid_total_grade');
  colTotal.setRect({ left: 150, top: 0, width: 100, height: 40 });
  colTotal.offsetLeft = 0;
  colTotal.offsetWidth = 100;
  headerColsRight.appendChild(colTotal);

  // Columns 2..N: Assignments 101..(100 + columnCount)
  const headerElements = [];
  for (let i = 0; i < columnCount; i++) {
    const aid = 101 + i;
    const hCol = new FakeElement('div');
    hCol.classList.add('slick-header-column');
    hCol.setAttribute('id', 'slickgrid_assignment_' + aid);
    const leftOffset = (i + 1) * 100; // offset inside scrolling container
    hCol.offsetLeft = leftOffset;
    hCol.offsetWidth = 100;
    hCol.style.left = leftOffset + 'px';
    hCol.setRect({ left: 150 + leftOffset, top: 0, width: 100, height: 40 });
    headerColsRight.appendChild(hCol);
    headerElements.push(hCol);
  }

  // Viewports & Canvases
  const viewportLeft = new FakeElement('div');
  viewportLeft.classList.add('slick-viewport', 'slick-viewport-left');
  viewportLeft.setRect({ left: 0, top: 40, width: 150, height: 360 });
  root.appendChild(viewportLeft);

  const canvasLeft = new FakeElement('div');
  canvasLeft.classList.add('grid-canvas');
  canvasLeft.setRect({ left: 0, top: 40, width: 150, height: 360 });
  viewportLeft.appendChild(canvasLeft);

  const viewportRight = new FakeElement('div');
  viewportRight.classList.add('slick-viewport', 'slick-viewport-right');
  viewportRight.setRect({ left: 150, top: 40, width: 850, height: 360 });
  root.appendChild(viewportRight);

  const canvasRight = new FakeElement('div');
  canvasRight.classList.add('grid-canvas');
  canvasRight.setRect({ left: 150, top: 40, width: (columnCount + 1) * 100, height: 360 });
  viewportRight.appendChild(canvasRight);

  // Build a virtualized row in the right canvas with only the visible cells
  const row = new FakeElement('div');
  row.classList.add('slick-row');
  row.style.top = '0px';
  row.setRect({ left: 150, top: 40, width: (columnCount + 1) * 100, height: 35 });
  canvasRight.appendChild(row);

  const visibleCells = [];
  for (let v = 0; v < visibleCount; v++) {
    const colIdxInAssignments = visibleStart + v;
    const colLeft = (colIdxInAssignments + 1) * 100;
    const cell = new FakeElement('div');
    cell.classList.add('slick-cell'); // NOTE: Deliberately NO l<n> class to test geometry resolution!
    cell.style.left = colLeft + 'px';
    cell.offsetLeft = colLeft;
    cell.setRect({ left: 150 + colLeft, top: 40, width: 100, height: 35 });
    row.appendChild(cell);
    visibleCells.push(cell);
  }

  return { root, headerColsRight, canvasRight, row, visibleCells, headerElements };
}

suite('dom-adapter: resolveColIndexForCell on virtualized scrolled grids', (test) => {
  test('resolves column index accurately by horizontal geometry on a scrolled virtualized row', () => {
    const CGP = loadGradebookDom();
    // 25 assignment columns (global indices 2..26).
    // Scrolled to show assignments 15..18 (global indices 16..19).
    const grid = buildScrolledGridWithColumns(CGP, 25, 15, 4);
    const adapter = new CGP.GradebookDomAdapter();

    // Verify pane offsets: left pane has 1 column, right pane starts at offset 1
    adapter.refreshColumns();
    a.eq(adapter.paneOffsets[0], 0);
    a.eq(adapter.paneOffsets[1], 1);

    // Visible cells correspond to assignments 15, 16, 17, 18
    // Global column indices: column 0 is student, column 1 is total, assignment 15 is index 16.
    const cell0 = grid.visibleCells[0];
    const cell1 = grid.visibleCells[1];
    const cell2 = grid.visibleCells[2];
    const cell3 = grid.visibleCells[3];

    const idx0 = adapter.resolveColIndexForCell(cell0, grid.row);
    const idx1 = adapter.resolveColIndexForCell(cell1, grid.row);
    const idx2 = adapter.resolveColIndexForCell(cell2, grid.row);
    const idx3 = adapter.resolveColIndexForCell(cell3, grid.row);

    // Old bug would have returned 1, 2, 3, 4 (the first columns!)
    // New resolution correctly matches columns 17, 18, 19, 20
    a.eq(idx0, 17, 'first visible cell matches scrolled column 17 (assignment 116)');
    a.eq(idx1, 18, 'second visible cell matches scrolled column 18 (assignment 117)');
    a.eq(idx2, 19, 'third visible cell matches scrolled column 19 (assignment 118)');
    a.eq(idx3, 20, 'fourth visible cell matches scrolled column 20 (assignment 119)');

    const col0 = adapter.columnAt(idx0);
    a.eq(col0.assignmentId, '116', 'resolves to the correct assignment ID');
  });

  test('resolves column index via assignment ID from cell DOM (e.g. Grade Detail Tray button)', () => {
    const CGP = loadGradebookDom();
    const grid = buildScrolledGridWithColumns(CGP, 10, 5, 2);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshColumns();

    const cell = grid.visibleCells[0];
    // Add inner button with aria-controls referencing assignment 108
    const FakeElement = domshim.FakeElement;
    const btn = new FakeElement('button');
    btn.setAttribute('aria-controls', 'assignment_108');
    cell.appendChild(btn);

    const resolved = adapter.resolveColIndexForCell(cell, grid.row);
    const col = adapter.columnAt(resolved);
    a.eq(col.assignmentId, '108', 'resolved by inner button aria-controls');
  });

  test('returns null for an unmapped cell on a virtualized row instead of guessing', () => {
    const CGP = loadGradebookDom();
    const grid = buildScrolledGridWithColumns(CGP, 20, 10, 3);
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshColumns();

    const FakeElement = domshim.FakeElement;
    const orphanCell = new FakeElement('div');
    orphanCell.classList.add('slick-cell');
    orphanCell.style.left = '';
    orphanCell.offsetLeft = NaN;
    orphanCell.setRect({ left: 0, top: 0, width: 0, height: 0 });
    grid.row.appendChild(orphanCell);

    const resolved = adapter.resolveColIndexForCell(orphanCell, grid.row);
    a.eq(resolved, null, 'unmapped cell on virtualized row returns null, never guesses');
  });
});

suite('indicators: wantedGrade safety guard against empty/ungraded Canvas cells', (test) => {
  test('does not inject wantedGrade into a blank Canvas cell with no native icon and no local write', () => {
    const CGP = loadGradebookDom();
    const FakeElement = domshim.FakeElement;

    const cell = new FakeElement('div');
    cell.classList.add('slick-cell');
    const content = new FakeElement('div');
    content.classList.add('Grid__GradeCell__Content');
    content.textContent = '';
    cell.appendChild(content);

    const controller = new CGP.IndicatorController({
      model: {
        cell: () => ({ score: 10, grade: '10', assignmentId: '101', userId: '501' }),
        everLoadedAssignments: new Set(['101']),
        submissionState: () => null
      },
      adapter: new CGP.GradebookDomAdapter(),
      registry: { needsPaint: () => true, markPainted: () => {} },
      settings: { values: { commentIndicator: false, submissionIndicator: false } }
    });

    const info = {
      el: cell,
      columnType: 'assignment',
      assignmentId: '101',
      studentId: '501'
    };

    controller.paintCell(info);
    a.ok(!cell.classList.contains('cgp-override'), 'cgp-override is NOT added to empty cell');
    a.eq(cell.querySelector('.cgp-val'), null, 'no synthetic cgp-val is injected into empty cell');
  });

  test('injects wantedGrade when cell contains Canvas native submission icon (replacing icon with score)', () => {
    const CGP = loadGradebookDom();
    const FakeElement = domshim.FakeElement;

    const cell = new FakeElement('div');
    cell.classList.add('slick-cell');
    const content = new FakeElement('div');
    content.classList.add('Grid__GradeCell__Content');
    const docIcon = new FakeElement('i');
    docIcon.classList.add('icon-document');
    content.appendChild(docIcon);
    cell.appendChild(content);

    const controller = new CGP.IndicatorController({
      model: {
        cell: () => ({ score: 10, grade: '10', assignmentId: '101', userId: '501' }),
        everLoadedAssignments: new Set(['101']),
        submissionState: () => null
      },
      adapter: new CGP.GradebookDomAdapter(),
      registry: { needsPaint: () => true, markPainted: () => {} },
      settings: { values: { commentIndicator: false, submissionIndicator: false } }
    });

    const info = {
      el: cell,
      columnType: 'assignment',
      assignmentId: '101',
      studentId: '501'
    };

    controller.paintCell(info);
    a.ok(cell.classList.contains('cgp-override'), 'cgp-override IS added when native icon is present');
    const val = cell.querySelector('.cgp-val');
    a.ok(val !== null, 'synthetic cgp-val is injected');
    a.eq(val.textContent, '10', 'wantedGrade score is displayed');
  });

  test('injects wantedGrade when cell has an optimistic local write in flight', () => {
    const CGP = loadGradebookDom();
    const FakeElement = domshim.FakeElement;

    const cell = new FakeElement('div');
    cell.classList.add('slick-cell');
    const content = new FakeElement('div');
    content.classList.add('Grid__GradeCell__Content');
    content.textContent = '';
    cell.appendChild(content);

    const controller = new CGP.IndicatorController({
      model: {
        cell: () => ({ override: 95, pending: true, assignmentId: '101', userId: '501' }),
        everLoadedAssignments: new Set(['101']),
        submissionState: () => null
      },
      adapter: new CGP.GradebookDomAdapter(),
      registry: { needsPaint: () => true, markPainted: () => {} },
      settings: { values: { commentIndicator: false, submissionIndicator: false } }
    });

    const info = {
      el: cell,
      columnType: 'assignment',
      assignmentId: '101',
      studentId: '501'
    };

    controller.paintCell(info);
    a.ok(cell.classList.contains('cgp-override'), 'cgp-override IS added for local in-flight write');
    const val = cell.querySelector('.cgp-val');
    a.ok(val !== null, 'synthetic cgp-val is injected for local write');
    a.eq(val.textContent, '95', 'optimistic write value is displayed');
  });
});
