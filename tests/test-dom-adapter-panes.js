/* Bug 1 (frozen Total scrolling away with the rest of the grid) traces back
 * to how this extension identifies the actual pane elements it has to widen
 * (the frozen/left one) and shrink-and-shift (the scrolling/right one, plus
 * both header panes) to keep the grid's total on-screen footprint unchanged.
 * The OLD mechanism was pure class-name matching (`.slick-pane-left`,
 * `.slick-pane-right`, `.slick-header-left`, `.slick-header-right`) with NO
 * fallback at all for the right/header-right side - see gradebook.css's
 * history and dom-adapter.js's own frozenPaneLeft() comment, which already
 * documented this exact lesson for the LEFT pane once before
 * ("Measuring the canvas instead of this element is what made
 * verifyWidened() never see the widen take hold").
 *
 * These tests build a fake grid whose pane elements do NOT carry Canvas's
 * usual `-left`/`-right` class suffixes at all, to prove
 * positionedAncestor()/bodyPanes()/headerPanes() find the right elements by
 * their actual rendered position and CSS `position: absolute`, not by name -
 * the same robustness principle this file's own header comment already
 * commits to for column/row identity. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function buildGrid(CGP, opts) {
  opts = opts || {};
  const doc = domshim.install();
  const body = doc.body;
  const FakeElement = domshim.FakeElement;

  const root = new FakeElement('div');
  root.setAttribute('id', 'gradebook_grid');
  root.setRect({ left: 0, top: 0, width: opts.gridWidth || 1000, height: 400 });
  body.appendChild(root);

  // Header row: one shared, non-absolutely-positioned wrapper (as Canvas's
  // own CSS forces - see gradebook.css's .slick-header { position: relative }
  // comment) holding two ABSOLUTELY POSITIONED header panes, deliberately
  // named with no "-left"/"-right" suffix at all.
  const headerWrap = new FakeElement('div');
  headerWrap.classList.add('slick-header');
  root.appendChild(headerWrap);

  const headerPaneA = new FakeElement('div');
  headerPaneA.classList.add(opts.headerLeftClass || 'zz-header-pane-a');
  headerPaneA.style.position = 'absolute';
  headerPaneA.setRect({ left: 0, top: 0, width: opts.naturalLeft || 190, height: 40 });
  headerWrap.appendChild(headerPaneA);
  const headerColsA = new FakeElement('div');
  headerColsA.classList.add('slick-header-columns');
  headerColsA.setRect({ left: 0, top: 0, width: opts.naturalLeft || 190, height: 40 });
  headerPaneA.appendChild(headerColsA);
  const nameCol = new FakeElement('div');
  nameCol.classList.add('slick-header-column');
  nameCol.setRect({ left: 0, top: 0, width: opts.naturalLeft || 190, height: 40 });
  headerColsA.appendChild(nameCol);

  const headerPaneB = new FakeElement('div');
  headerPaneB.classList.add(opts.headerRightClass || 'zz-header-pane-b');
  headerPaneB.style.position = 'absolute';
  headerPaneB.setRect({ left: opts.naturalLeft || 190, top: 0, width: (opts.gridWidth || 1000) - (opts.naturalLeft || 190), height: 40 });
  headerWrap.appendChild(headerPaneB);
  const headerColsB = new FakeElement('div');
  headerColsB.classList.add('slick-header-columns');
  headerColsB.setRect({ left: opts.naturalLeft || 190, top: 0, width: (opts.gridWidth || 1000) - (opts.naturalLeft || 190), height: 40 });
  headerPaneB.appendChild(headerColsB);

  // Body: two absolutely-positioned panes, same deliberately-unusual naming.
  const bodyPaneA = new FakeElement('div');
  bodyPaneA.classList.add(opts.bodyLeftClass || 'zz-body-pane-a');
  bodyPaneA.style.position = 'absolute';
  bodyPaneA.setRect({ left: 0, top: 40, width: opts.naturalLeft || 190, height: 360 });
  root.appendChild(bodyPaneA);
  const canvasA = new FakeElement('div');
  canvasA.classList.add('grid-canvas');
  canvasA.setRect({ left: 0, top: 40, width: opts.naturalLeft || 190, height: 360 });
  bodyPaneA.appendChild(canvasA);

  const bodyPaneB = new FakeElement('div');
  bodyPaneB.classList.add(opts.bodyRightClass || 'zz-body-pane-b');
  bodyPaneB.style.position = 'absolute';
  bodyPaneB.setRect({ left: opts.naturalLeft || 190, top: 40, width: (opts.gridWidth || 1000) - (opts.naturalLeft || 190), height: 360 });
  root.appendChild(bodyPaneB);
  const canvasB = new FakeElement('div');
  canvasB.classList.add('grid-canvas');
  canvasB.setRect({ left: opts.naturalLeft || 190, top: 40, width: 3000, height: 360 }); // wide content, scrolls
  bodyPaneB.appendChild(canvasB);

  return { doc, root, headerWrap, headerPaneA, headerPaneB, headerColsA, headerColsB, bodyPaneA, bodyPaneB, canvasA, canvasB };
}

suite('dom-adapter: pane identification is class-name-agnostic', (test) => {
  test('canvases() and headerContainers() are ordered left-to-right by position, whatever they are named', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();

    const canvases = adapter.canvases();
    a.eq(canvases.length, 2);
    a.ok(canvases[0] === grid.canvasA, 'the leftmost (frozen) canvas comes first');
    a.ok(canvases[1] === grid.canvasB, 'the scrolling canvas comes second');

    const headers = adapter.headerContainers();
    a.eq(headers.length, 2);
    a.ok(headers[0] === grid.headerColsA);
    a.ok(headers[1] === grid.headerColsB);
  });

  test('positionedAncestor() finds the nearest position:absolute box, not a class name', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();

    a.ok(adapter.positionedAncestor(grid.canvasA) === grid.bodyPaneA);
    a.ok(adapter.positionedAncestor(grid.canvasB) === grid.bodyPaneB);
    a.ok(adapter.positionedAncestor(grid.headerColsA) === grid.headerPaneA);
    a.ok(adapter.positionedAncestor(grid.headerColsB) === grid.headerPaneB);
  });

  test('bodyPanes() and headerPanes() return [left, right] even with no -left/-right class names at all', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP, { bodyLeftClass: 'foo', bodyRightClass: 'bar', headerLeftClass: 'baz', headerRightClass: 'qux' });
    const adapter = new CGP.GradebookDomAdapter();

    const body = adapter.bodyPanes();
    a.deep([body[0] === grid.bodyPaneA, body[1] === grid.bodyPaneB], [true, true]);

    const headers = adapter.headerPanes();
    a.deep([headers[0] === grid.headerPaneA, headers[1] === grid.headerPaneB], [true, true]);
  });

  test('frozenPaneLeft() falls back to positionedAncestor() when the .slick-pane-left / .slick-viewport-left class names are absent', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP, { bodyLeftClass: 'totally-different-name' });
    const adapter = new CGP.GradebookDomAdapter();
    a.ok(adapter.frozenPaneLeft() === grid.bodyPaneA);
  });

  test('frozenPaneLeft() still prefers the real Canvas class name when it IS present', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP, { bodyLeftClass: 'slick-pane-left' });
    const adapter = new CGP.GradebookDomAdapter();
    a.ok(adapter.frozenPaneLeft() === grid.bodyPaneA);
  });
});
