/* Regression test for a real bug a Codex review caught in PR #18: canvases()
 * and headerContainers() used to order the frozen/scrolling pane pair by the
 * CURRENT getBoundingClientRect().left of their contents (see dom-adapter.js
 * history). That is only a safe proxy for "which one is the frozen pane"
 * while the scrolling (right) pane sits at its own scroll-left of 0.
 *
 * The scrolling pane's `.grid-canvas`/`.slick-header-columns` is the WIDE
 * content living inside an `overflow-x: auto` `.slick-viewport-right` - not
 * the viewport box itself. Scrolling that viewport moves its content left
 * relative to the page, so once scrolled far enough right the content's own
 * rect.left drops below the stationary frozen pane's rect.left (which never
 * moves - the frozen pane has nothing to scroll). A plain ascending sort by
 * that rect.left then reports the SCROLLING pane as pane[0] ("the frozen
 * one"), which is exactly backwards - and every caller of canvases()/
 * headerContainers() (frozenRowGeometry, frozenNaturalWidth, bodyPanes,
 * headerPanes, hideTestStudentRows, ensureLayer, ...) trusts pane[0] to mean
 * "frozen".
 *
 * The fix (orderPaneElements()) instead asks which VIEWPORT box - the
 * clipping element, whose own rect.left is untouched by ITS OWN scroll -
 * each candidate element lives inside, and orders by that. This test
 * reproduces the flip scenario directly: a canvas whose rect.left has gone
 * negative from a large horizontal scroll, nested inside viewport boxes
 * whose own rects stay put, and asserts the frozen pane is still pane[0]. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function buildScrolledGrid(CGP, scrollLeft) {
  const doc = domshim.install();
  const body = doc.body;
  const FakeElement = domshim.FakeElement;

  const root = new FakeElement('div');
  root.setAttribute('id', 'gradebook_grid');
  root.setRect({ left: 0, top: 0, width: 1000, height: 400 });
  body.appendChild(root);

  // Frozen (left) viewport: a clipping box that never scrolls - its own rect
  // stays at left:0 no matter what the right pane does.
  const viewportLeft = new FakeElement('div');
  // Real Canvas markup carries BOTH the base `slick-viewport` class
  // viewports()/leftViewport()/rightViewport() query for and the `-left`/
  // `-right` variant that identifies which side it is - see dom-adapter.js's
  // leftViewport()/rightViewport(), which query `.slick-viewport` first and
  // only then filter by the `-left`/`-right` suffix.
  viewportLeft.classList.add('slick-viewport', 'slick-viewport-left');
  viewportLeft.setRect({ left: 0, top: 40, width: 190, height: 360 });
  root.appendChild(viewportLeft);
  const canvasA = new FakeElement('div');
  canvasA.classList.add('grid-canvas');
  canvasA.setRect({ left: 0, top: 40, width: 190, height: 360 });
  viewportLeft.appendChild(canvasA);

  // Scrolling (right) viewport: ITS box also never moves (it is the fixed
  // clipping element a teacher's mouse wheel scrolls WITHIN), but its wide
  // content canvas's rect.left goes negative as `scrollLeft` grows - exactly
  // what a real overflow:auto viewport does to its scrolled child.
  const viewportRight = new FakeElement('div');
  viewportRight.classList.add('slick-viewport', 'slick-viewport-right');
  viewportRight.setRect({ left: 190, top: 40, width: 810, height: 360 });
  root.appendChild(viewportRight);
  const canvasB = new FakeElement('div');
  canvasB.classList.add('grid-canvas');
  canvasB.setRect({ left: 190 - scrollLeft, top: 40, width: 3000, height: 360 });
  viewportRight.appendChild(canvasB);

  return { canvasA, canvasB, viewportLeft, viewportRight };
}

suite('dom-adapter: pane order survives a horizontal scroll', (test) => {
  test('canvases() still returns the frozen pane first at scroll-left 0', () => {
    const CGP = loadGradebookDom();
    const grid = buildScrolledGrid(CGP, 0);
    const adapter = new CGP.GradebookDomAdapter();
    const canvases = adapter.canvases();
    a.ok(canvases[0] === grid.canvasA, 'frozen canvas is pane[0]');
    a.ok(canvases[1] === grid.canvasB, 'scrolling canvas is pane[1]');
  });

  test('canvases() still returns the frozen pane first after scrolling far enough right to push the scrolling canvas\'s rect left of the frozen one', () => {
    const CGP = loadGradebookDom();
    // A scroll of 400px pushes canvasB's rect.left to 190 - 400 = -210,
    // well below canvasA's stationary rect.left of 0 - the exact inversion
    // the old plain rect-sort got backwards.
    const grid = buildScrolledGrid(CGP, 400);
    a.ok(grid.canvasB.getBoundingClientRect().left < grid.canvasA.getBoundingClientRect().left,
      'test setup sanity check: the scrolling canvas really is rendered to the left of the frozen one now');

    const adapter = new CGP.GradebookDomAdapter();
    const canvases = adapter.canvases();
    a.ok(canvases[0] === grid.canvasA, 'frozen canvas is STILL pane[0] despite its now-larger rect.left');
    a.ok(canvases[1] === grid.canvasB, 'scrolling canvas is still pane[1]');
  });

  test('headerContainers() is likewise scroll-safe (the header row mirrors the body pane split)', () => {
    const CGP = loadGradebookDom();
    const FakeElement = domshim.FakeElement;
    const grid = buildScrolledGrid(CGP, 500);
    const headerColsA = new FakeElement('div');
    headerColsA.classList.add('slick-header-columns');
    headerColsA.setRect({ left: 0, top: 0, width: 190, height: 40 });
    grid.viewportLeft.appendChild(headerColsA);
    const headerColsB = new FakeElement('div');
    headerColsB.classList.add('slick-header-columns');
    headerColsB.setRect({ left: 190 - 500, top: 0, width: 3000, height: 40 });
    grid.viewportRight.appendChild(headerColsB);

    const adapter = new CGP.GradebookDomAdapter();
    const headers = adapter.headerContainers();
    a.ok(headers[0] === headerColsA, 'frozen header pane is still first');
    a.ok(headers[1] === headerColsB, 'scrolling header pane is still second');
  });
});
