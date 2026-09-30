/* Regression test for "scrolling left/right shows another column's grades
 * under this column's header" and "a cell I commented on shows no bubble".
 *
 * Canvas does not run upstream SlickGrid. Its fork (canvas-lms
 * packages/slickgrid/slick.grid.js) renders:
 *   - panes as container_0 / container_1, each holding headers_N,
 *     viewport_N and canvas_N (0 = frozen, 1 = scrolling)
 *   - every body cell as "slick-cell b<n> f<m>", n being the ABSOLUTE column
 *     index - the class its own getCellFromNode() reads
 *   - newly scrolled-in cells APPENDED to the row, so DOM order is not
 *     column order
 * The adapter only knew "l<n>" and "-left"/"-right" pane names, so it never
 * read Canvas's own index and fell back to guessing by pixel position - which
 * drifts once the grid is scrolled, landing each cell on a neighbouring
 * column. These tests build Canvas's real markup and prove every cell maps to
 * the column Canvas says it is in, however far the grid has scrolled and
 * whatever the pixel geometry says. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

const STUDENT_COLS = 1;       // frozen: student name
const COL_W = 100;

/* columnIds: the scrolling pane's column ids, in grid order.
 * scrollLeft: how far viewport_1 is scrolled.
 * rendered: absolute column indexes rendered in the body row, in DOM order.
 * drift: px each successive header sits further right than its cells
 *        (Canvas's header padding/border vs. cell rules, or a width override
 *        applied to one but not the other). */
function buildCanvasGrid(opts) {
  const doc = domshim.install();
  const F = domshim.FakeElement;
  const columnIds = opts.columnIds;
  const scrollLeft = opts.scrollLeft || 0;
  const drift = opts.drift || 0;

  const root = new F('div');
  root.setAttribute('id', 'gradebook_grid');
  doc.body.appendChild(root);

  function pane(n, left, width) {
    const container = new F('div');
    container.classList.add('container_' + n);
    container.setRect({ left, top: 0, width, height: 400 });
    root.appendChild(container);
    const scroller = new F('div');
    scroller.classList.add('headerScroller_' + n, 'slick-header');
    container.appendChild(scroller);
    const headers = new F('div');
    headers.classList.add('headers_' + n, 'slick-header-columns');
    scroller.appendChild(headers);
    const viewport = new F('div');
    viewport.classList.add('viewport_' + n, 'slick-viewport');
    viewport.setRect({ left, top: 40, width, height: 360 });
    container.appendChild(viewport);
    const canvas = new F('div');
    canvas.classList.add('canvas_' + n, 'grid-canvas');
    viewport.appendChild(canvas);
    return { container, headers, viewport, canvas };
  }

  const frozen = pane(0, 0, 150);
  const scrolling = pane(1, 150, 850);
  // Scrolled content: its rect moves left by scrollLeft, past the frozen pane.
  scrolling.headers.setRect({ left: 150 - scrollLeft, top: 0, width: columnIds.length * COL_W, height: 40 });
  scrolling.canvas.setRect({ left: 150 - scrollLeft, top: 40, width: columnIds.length * COL_W, height: 360 });
  frozen.headers.setRect({ left: 0, top: 0, width: 150, height: 40 });
  frozen.canvas.setRect({ left: 0, top: 40, width: 150, height: 360 });

  const student = new F('div');
  student.className = 'ui-state-default slick-header-column';
  student.classList.add('ui-state-default', 'slick-header-column');
  student.setAttribute('id', 'slickgrid_98765student');
  student.offsetLeft = 0;
  frozen.headers.appendChild(student);

  columnIds.forEach(function (id, i) {
    const h = new F('div');
    h.className = 'ui-state-default slick-header-column';
    h.classList.add('ui-state-default', 'slick-header-column');
    h.setAttribute('id', 'slickgrid_98765' + id);
    const left = i * COL_W + i * drift;
    h.offsetLeft = left;
    h.setRect({ left: 150 - scrollLeft + left, top: 0, width: COL_W, height: 40 });
    scrolling.headers.appendChild(h);
  });

  function row(canvas, top) {
    const r = new F('div');
    r.className = 'ui-widget-content slick-row even';
    r.classList.add('ui-widget-content', 'slick-row', 'even');
    r.style.top = top + 'px';
    r.setRect({ left: 0, top: 40 + top, width: 1000, height: 35 });
    canvas.appendChild(r);
    return r;
  }

  const frozenRow = row(frozen.canvas, 0);
  const nameCell = new F('div');
  nameCell.className = 'slick-cell b0 f0';
  nameCell.classList.add('slick-cell', 'b0', 'f0');
  const link = new F('a');
  link.setAttribute('href', '/courses/1/grades/501');
  nameCell.appendChild(link);
  frozenRow.appendChild(nameCell);

  const bodyRow = row(scrolling.canvas, 0);
  const cells = {};
  opts.rendered.forEach(function (abs) {
    const local = abs - STUDENT_COLS;
    const cell = new F('div');
    const cls = 'slick-cell b' + abs + ' f' + abs + ' assignment';
    cell.className = cls;
    cls.split(' ').forEach(function (c) { cell.classList.add(c); });
    // Cells are placed by Canvas's .b<n> CSS rule, not inline style.
    cell.offsetLeft = local * COL_W;
    cell.setRect({ left: 150 - scrollLeft + local * COL_W, top: 40, width: COL_W, height: 35 });
    bodyRow.appendChild(cell);
    cells[abs] = cell;
  });

  return { frozen, scrolling, bodyRow, frozenRow, cells, headers: scrolling.headers };
}

function assignmentIds(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('assignment_' + (1001 + i));
  return out;
}

suite('grid-map: Canvas SlickGrid cell classes', (test) => {
  test('reads the absolute column index from Canvas\'s "b<n> f<m>" classes', () => {
    const CGP = loadGradebookDom();
    a.eq(CGP.gridMap.canvasColumnIndexFromClassName('slick-cell b17 f17 assignment'), 17);
    a.eq(CGP.gridMap.columnIndexFromClassName('slick-cell b17 f17 assignment'), 17);
    a.eq(CGP.gridMap.columnIndexFromClassName('slick-cell b0 f0 active'), 0);
    // A spanned cell: b is where it starts, f where it ends.
    a.eq(CGP.gridMap.columnIndexFromClassName('slick-cell b4 f6'), 4);
    // Unrelated class names containing digits are never read as an index.
    a.eq(CGP.gridMap.canvasColumnIndexFromClassName('slick-cell grade-b12x'), null);
    a.eq(CGP.gridMap.canvasColumnIndexFromClassName('slick-cell l7 r7'), null);
  });
});

suite('dom-adapter: Canvas markup, scrolled horizontally', (test) => {
  test('every rendered cell maps to the column Canvas placed it in, even with drifting geometry', () => {
    const CGP = loadGradebookDom();
    const ids = assignmentIds(40);
    // Scrolled to about column 25, with cells appended out of order the way
    // cleanUpAndRenderCells does it, and headers drifting 12px per column.
    const rendered = [30, 31, 32, 25, 26, 27, 28, 29, 33];
    const g = buildCanvasGrid({ columnIds: ids, scrollLeft: 2400, drift: 12, rendered });
    const adapter = new CGP.GradebookDomAdapter();

    const cells = adapter.visibleCells().filter((c) => c.row === g.bodyRow);
    a.eq(cells.length, rendered.length);
    cells.forEach((info) => {
      const abs = Number(/b(\d+)/.exec(info.el.className)[1]);
      a.eq(info.colIndex, abs, 'cell b' + abs + ' resolves to column ' + abs);
      a.eq(info.assignmentId, String(1001 + abs - STUDENT_COLS),
        'cell b' + abs + ' shows its own assignment, not a neighbour\'s');
      a.eq(info.studentId, '501');
    });
  });

  test('the frozen and scrolling panes keep their order when scrolled past the frozen pane', () => {
    const CGP = loadGradebookDom();
    const g = buildCanvasGrid({ columnIds: assignmentIds(40), scrollLeft: 3200, rendered: [35] });
    const adapter = new CGP.GradebookDomAdapter();
    const canvases = adapter.canvases();
    a.ok(canvases[0] === g.frozen.canvas, 'canvas_0 is the frozen pane');
    a.ok(canvases[1] === g.scrolling.canvas, 'canvas_1 is the scrolling pane');
    const headers = adapter.headerContainers();
    a.ok(headers[0] === g.frozen.headers, 'headers_0 is the frozen header');
    a.ok(headers[1] === g.scrolling.headers, 'headers_1 is the scrolling header');
    a.ok(adapter.leftViewport() === g.frozen.viewport);
    a.ok(adapter.rightViewport() === g.scrolling.viewport);
    adapter.refreshColumns();
    a.eq(adapter.paneOffsets[1], STUDENT_COLS, 'scrolling pane starts right after the frozen columns');
  });

  test('a column hidden or moved leaves no stale entry behind at its old index', () => {
    const CGP = loadGradebookDom();
    const ids = assignmentIds(10);
    const g = buildCanvasGrid({ columnIds: ids, rendered: [3] });
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshColumns();
    a.eq(adapter.columnAt(3).assignmentId, '1003');

    // Teacher hides assignment 1003: Canvas rebuilds the headers without it,
    // so absolute index 3 is now assignment 1004 and index 10 no longer exists.
    const doomed = g.headers.children[2];
    g.headers.removeChild(doomed);
    adapter.refreshColumns();
    a.eq(adapter.columnAt(3).assignmentId, '1004', 'index 3 now means the column that moved into it');
    a.eq(adapter.columnAt(10), null, 'the old last index is gone, not left pointing at a stale column');
    a.eq(adapter.columnIdToIndex.has('assignment_1003'), false, 'the hidden assignment is forgotten');
  });

  test('a Canvas index outside the cell\'s own pane is left unresolved, never guessed', () => {
    const CGP = loadGradebookDom();
    const g = buildCanvasGrid({ columnIds: assignmentIds(10), rendered: [4] });
    const adapter = new CGP.GradebookDomAdapter();
    adapter.refreshColumns();
    // A cell in the scrolling pane claiming the frozen pane's column 0 means
    // our pane bookkeeping disagrees with Canvas - paint nothing rather than
    // the wrong column's data.
    const cell = g.cells[4];
    cell.className = 'slick-cell b0 f0';
    a.eq(adapter.resolveColIndexForCell(cell, g.bodyRow), null);
    // And one beyond the known columns is unresolved too.
    cell.className = 'slick-cell b99 f99';
    a.eq(adapter.resolveColIndexForCell(cell, g.bodyRow), null);
  });
});
