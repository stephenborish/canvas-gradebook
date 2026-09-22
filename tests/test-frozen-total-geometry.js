/* Bug 1, reproduced structurally: widening the frozen (left) pane by 84px
 * without an EXACTLY compensating change to the scrolling (right) pane grows
 * the grid's total on-screen footprint by that same 84px. If whatever
 * contains both panes was sized to the grid's ORIGINAL (un-widened) total
 * width, that footprint growth is exactly what turns into a horizontal
 * scrollbar on an ancestor that scrolls BOTH absolutely-positioned panes
 * together - the "Student Name and Total scroll away with the assignment
 * columns" report.
 *
 * FrozenTotalController.applyPaneGeometry() is supposed to make that
 * impossible by construction: newLeftWidth + newRightWidth must always equal
 * the grid root's own real (measured) width, no matter what. These tests
 * assert that invariant directly, including on a fake grid whose panes do
 * NOT use Canvas's usual `.slick-pane-left`/`-right` class names at all (see
 * test-dom-adapter-panes.js), and assert the ancestor-overflow safety net
 * clamps every ancestor except the one pane that is actually supposed to
 * keep scrolling. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function buildGrid(CGP, opts) {
  opts = opts || {};
  const doc = domshim.install();
  const body = doc.body;
  const FakeElement = domshim.FakeElement;
  const naturalLeft = opts.naturalLeft || 190;
  const gridWidth = opts.gridWidth || 1000;

  // An extra layer between <body> and the grid root, standing in for
  // whatever real ancestor (#content, #application, a Canvas layout div)
  // sits above #gradebook_grid on the live page - clampAncestorOverflow()
  // has to reach it too, not just the grid root itself.
  const outerWrap = new FakeElement('div');
  outerWrap.setAttribute('id', 'content');
  body.appendChild(outerWrap);

  const root = new FakeElement('div');
  root.setAttribute('id', 'gradebook_grid');
  root.setRect({ left: 0, top: 0, width: gridWidth, height: 400 });
  outerWrap.appendChild(root);

  function pane(parent, cls, left, width, top, height) {
    const el = new FakeElement('div');
    if (cls) el.classList.add(cls);
    el.style.position = 'absolute';
    el.setRect({ left, top, width, height });
    parent.appendChild(el);
    return el;
  }

  const headerWrap = new FakeElement('div');
  headerWrap.classList.add('slick-header');
  root.appendChild(headerWrap);
  const headerLeft = pane(headerWrap, opts.headerLeftClass, 0, naturalLeft, 0, 40);
  const headerCols = new FakeElement('div');
  headerCols.classList.add('slick-header-columns');
  headerCols.setRect({ left: 0, top: 0, width: naturalLeft, height: 40 });
  headerLeft.appendChild(headerCols);
  const nameCol = new FakeElement('div');
  nameCol.classList.add('slick-header-column');
  nameCol.setRect({ left: 0, top: 0, width: naturalLeft, height: 40 });
  headerCols.appendChild(nameCol);
  const headerRight = pane(headerWrap, opts.headerRightClass, naturalLeft, gridWidth - naturalLeft, 0, 40);
  const headerColsRight = new FakeElement('div');
  headerColsRight.classList.add('slick-header-columns');
  headerColsRight.setRect({ left: naturalLeft, top: 0, width: gridWidth - naturalLeft, height: 40 });
  headerRight.appendChild(headerColsRight);

  const bodyLeft = pane(root, opts.bodyLeftClass, 0, naturalLeft, 40, 360);
  const canvasLeft = new FakeElement('div');
  canvasLeft.classList.add('grid-canvas');
  canvasLeft.setRect({ left: 0, top: 40, width: naturalLeft, height: 360 });
  bodyLeft.appendChild(canvasLeft);

  const bodyRight = pane(root, opts.bodyRightClass, naturalLeft, gridWidth - naturalLeft, 40, 360);
  const viewportRight = new FakeElement('div');
  viewportRight.classList.add('slick-viewport-right');
  bodyRight.appendChild(viewportRight);
  const canvasRight = new FakeElement('div');
  canvasRight.classList.add('grid-canvas');
  canvasRight.setRect({ left: naturalLeft, top: 40, width: 3000, height: 360 });
  viewportRight.appendChild(canvasRight);

  return { doc, outerWrap, root, headerLeft, headerRight, bodyLeft, bodyRight, viewportRight, canvasLeft, canvasRight };
}

function makeController(CGP, adapter, extra) {
  return new CGP.FrozenTotalController(Object.assign({
    adapter: adapter,
    model: { students: new Map() },
    settings: { values: { frozenTotal: true } }
  }, extra || {}));
}

suite('frozen-total: pane geometry preserves the grid\'s total footprint', (test) => {
  test('newLeftWidth + newRightWidth always equals the grid root\'s real width, with Canvas\'s usual class names', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);

    ctrl.start();
    a.eq(ctrl.naturalWidth, 190);

    const left = adapter.bodyPanes()[0];
    const right = adapter.bodyPanes()[1];
    const leftWidth = parseFloat(left.style.getPropertyValue('width'));
    const rightWidth = parseFloat(right.style.getPropertyValue('width'));
    const rightLeft = parseFloat(right.style.getPropertyValue('left'));

    a.eq(leftWidth, 190 + 84, 'left pane widened by exactly the Total column\'s width');
    a.eq(rightLeft, 190 + 84, 'right pane starts exactly where the widened left pane ends');
    a.eq(leftWidth + rightWidth, 1000, 'no net width added to the grid\'s total footprint');
  });

  test('the same invariant holds when the panes carry NONE of Canvas\'s usual class names', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP, {
      bodyLeftClass: 'weird-a', bodyRightClass: 'weird-b',
      headerLeftClass: 'weird-c', headerRightClass: 'weird-d',
      gridWidth: 1200, naturalLeft: 220
    });
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);

    ctrl.start();

    const left = adapter.bodyPanes()[0];
    const right = adapter.bodyPanes()[1];
    const leftWidth = parseFloat(left.style.getPropertyValue('width'));
    const rightWidth = parseFloat(right.style.getPropertyValue('width'));
    a.eq(leftWidth, 220 + 84);
    a.eq(leftWidth + rightWidth, 1200, 'invariant holds even with unrecognised pane class names');

    // The header panes must move in lockstep with the body panes, or the
    // assignment headers render offset from the columns they label.
    const headerLeft = adapter.headerPanes()[0];
    const headerRight = adapter.headerPanes()[1];
    a.eq(parseFloat(headerLeft.style.getPropertyValue('width')), 220 + 84);
    a.eq(parseFloat(headerRight.style.getPropertyValue('left')), 220 + 84);
  });

  test('a later grid-root resize (e.g. the compact-layout controller\'s own geometry pass) is picked up on the next measure(), keeping the invariant true', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);
    ctrl.start();

    grid.root.setRect({ left: 0, top: 0, width: 1300, height: 400 });
    ctrl.measure();

    const left = adapter.bodyPanes()[0];
    const right = adapter.bodyPanes()[1];
    const leftWidth = parseFloat(left.style.getPropertyValue('width'));
    const rightWidth = parseFloat(right.style.getPropertyValue('width'));
    a.eq(leftWidth + rightWidth, 1300, 'the invariant is re-derived from the CURRENT grid width, not a stale one');
  });

  test('clampAncestorOverflow() clips every ancestor up to the grid root, but leaves the scrolling viewport itself alone', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);

    ctrl.start();

    a.eq(grid.root.style.getPropertyValue('overflow-x'), 'hidden', 'the grid root itself is clipped');
    a.eq(grid.outerWrap.style.getPropertyValue('overflow-x'), 'hidden', 'an ancestor above the grid root is clipped too');
    a.eq(grid.viewportRight.style.getPropertyValue('overflow-x'), '',
      'the one pane that is SUPPOSED to keep its own horizontal scroll is left untouched');
  });

  test('a frozen pane that only appears after start() retries successfully on the next paint(), instead of staying disabled all page load', () => {
    // Reproduces the exact boot race this test guards against: content.js
    // calls start() exactly once, at the moment adapter.isReady() first
    // passes - which only requires a single header column and a single
    // grid-canvas to exist, not that Canvas has finished splitting into its
    // frozen/scrolling pane pair yet. Before this fix, hasFrozenPane()
    // failing at that one moment latched `enabled = false` forever, with
    // nothing left to ever flip it back - the whole feature silently never
    // ran for the rest of the page's life even though the frozen pane shows
    // up moments later.
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);

    // Simulate "only one pane rendered yet" by removing the right canvas
    // before the first start(), the same shape hasFrozenPane() (canvases()
    // .length > 1) checks against.
    grid.canvasRight.parentElement.removeChild(grid.canvasRight);

    ctrl.start();
    a.eq(ctrl.enabled, false, 'refuses to enable itself with only one pane rendered');

    // Canvas finishes rendering the second pane a beat later. Nothing calls
    // start() again in production - only paint(), on the next render pass.
    grid.viewportRight.appendChild(grid.canvasRight);
    ctrl.paint();

    a.eq(ctrl.enabled, true, 'paint() retries start() and picks up the now-present frozen pane');
    const left = adapter.bodyPanes()[0];
    a.eq(parseFloat(left.style.getPropertyValue('width')), 190 + 84,
      'the widen actually applied once retried, not just the enabled flag');
  });

  test('turning the setting off stops the controller even after a successful start', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const settings = { values: { frozenTotal: true } };
    const ctrl = makeController(CGP, adapter, { settings: settings });
    ctrl.start();
    a.eq(ctrl.enabled, true);

    settings.values.frozenTotal = false;
    ctrl.stop();
    a.eq(ctrl.enabled, false);

    // start() must not re-latch itself back on while the setting is off, even
    // though nothing about the DOM changed.
    ctrl.start();
    a.eq(ctrl.enabled, false, 'start() respects the setting being off');
  });

  test('stop() restores a pane\'s PRIOR inline width/left, not just an empty property (Codex review, PR #19)', () => {
    // Some Canvas builds set these panes' own width/left inline (not just
    // through a stylesheet) as part of SlickGrid's normal layout. Before this
    // fix, restorePaneGeometry() only ever removed the property outright,
    // which is indistinguishable from "restoring" it correctly ONLY when
    // there was nothing there to begin with - on a build that really does set
    // these inline, deleting the property left the pane with no explicit
    // geometry at all until Canvas happened to recompute its own layout on
    // some unrelated trigger, rather than putting back what was actually
    // there before this feature ever touched it.
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);

    const right = adapter.bodyPanes()[1];
    const headerRight = adapter.headerPanes()[1];
    // Stand in for Canvas/SlickGrid's own inline geometry, set before this
    // feature ever runs.
    right.style.setProperty('width', '810px');
    right.style.setProperty('left', '190px');
    headerRight.style.setProperty('width', '810px');
    headerRight.style.setProperty('left', '190px');

    ctrl.start();
    // Confirm the widen actually overwrote those values (otherwise this test
    // would trivially pass without exercising the restore path at all).
    a.eq(right.style.getPropertyValue('width'), (1000 - 190 - 84) + 'px');

    ctrl.stop();

    a.eq(right.style.getPropertyValue('width'), '810px', 'the body pane\'s original width is put back exactly, not deleted');
    a.eq(right.style.getPropertyValue('left'), '190px', 'the body pane\'s original left is put back exactly, not deleted');
    a.eq(headerRight.style.getPropertyValue('width'), '810px', 'the header pane\'s original width is put back too');
    a.eq(headerRight.style.getPropertyValue('left'), '190px', 'the header pane\'s original left is put back too');
  });

  test('a pane with no prior inline width/left still ends up with none after stop(), as before', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);
    ctrl.start();
    ctrl.stop();

    const right = adapter.bodyPanes()[1];
    a.eq(right.style.getPropertyValue('width'), '', 'nothing to restore, so the property is removed as it always was');
    a.eq(right.style.getPropertyValue('left'), '', 'same for left');
  });

  test('paint() does nothing while a column-sizing transaction is reported pending', () => {
    // Reproduces the frozen/resize race directly: if paint() measured the
    // frozen pane while layout.js's setColumns() transaction was still in
    // flight, it could compute pane geometry from a grid whose column widths
    // are momentarily between Canvas's old model and the narrowed one.
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    let pending = true;
    const ctrl = makeController(CGP, adapter, { isSizingPending: () => pending });

    ctrl.paint();
    a.eq(ctrl.enabled, false, 'start() is never even attempted while sizing is pending');
    a.eq(ctrl.layer, null, 'no overlay is built from a grid mid-transaction');

    pending = false;
    ctrl.paint();
    a.eq(ctrl.enabled, true, 'resumes normally once sizing is no longer pending');
  });

  test('stop() undoes both the pane pins and the ancestor overflow clamp', () => {
    const CGP = loadGradebookDom();
    const grid = buildGrid(CGP);
    const adapter = new CGP.GradebookDomAdapter();
    const ctrl = makeController(CGP, adapter);
    ctrl.start();
    ctrl.stop();

    a.eq(grid.root.style.getPropertyValue('overflow-x'), '', 'overflow clamp is removed');
    const right = adapter.bodyPanes()[1];
    a.eq(right.style.getPropertyValue('width'), '', 'the pinned width is removed, restoring Canvas\'s own geometry');
    a.eq(right.style.getPropertyValue('left'), '', 'the pinned left offset is removed');
  });
});
