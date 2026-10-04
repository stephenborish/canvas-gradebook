/* Tests for SelectionController, BulkCommentController, and CommentPopoverController:
 * 1. SelectionController displays a floating action bar (#cgp-selection-bar)
 *    when multiple cells are selected (keys.size > 1) and removes it when cleared.
 * 2. Clicking outside cell area with a plain click clears the multi-cell selection.
 * 3. KeyboardGradingController opens bulk comment on pressing 'C' (or 'Shift+C')
 *    when selectionSize > 1, even if an input element was active from range selection.
 * 4. KeyboardGradingController does NOT intercept 'C' when typing into a single cell editor.
 * 5. BulkCommentController & CommentPopoverController render close buttons (x) in head.
 * 6. options.html contains clean, un-duplicated step instructions for comment snippets.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

suite('SelectionController & multi-cell bulk comment', (test) => {
  test('SelectionController shows and updates floating bar when multi-selected, hides and removes on clear', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();

    let bulkOpened = false;
    let openedTargets = null;
    const fakeBulkComment = {
      open: (targets) => {
        bulkOpened = true;
        openedTargets = targets;
      }
    };

    const ctrl = new CGP.SelectionController({
      adapter: {},
      model: {},
      settings: { values: {} },
      requestPaint: () => {},
      bulkComment: fakeBulkComment
    });

    // Initial state: nothing selected
    a.eq(ctrl.size(), 0);
    a.eq(doc.getElementById('cgp-selection-bar'), null);

    // Single cell selected -> bar should remain hidden
    ctrl.add({ columnType: 'assignment', assignmentId: '101', studentId: '201', rowIndex: 0, colIndex: 2 });
    a.eq(ctrl.size(), 1);
    const barSingle = doc.getElementById('cgp-selection-bar');
    a.ok(!barSingle || barSingle.style.display === 'none', 'bar hidden for single cell');

    // Add a second cell (multi-select)
    ctrl.add({ columnType: 'assignment', assignmentId: '101', studentId: '202', rowIndex: 1, colIndex: 2 });
    a.eq(ctrl.size(), 2);
    const barMulti = doc.getElementById('cgp-selection-bar');
    a.ok(barMulti, 'bar created in document');
    a.eq(barMulti.style.display, 'flex', 'bar is visible');
    a.ok(barMulti.innerHTML.includes('2 cells selected'), 'displays 2 cells selected count');

    // Add a third cell
    ctrl.add({ columnType: 'assignment', assignmentId: '101', studentId: '203', rowIndex: 2, colIndex: 2 });
    a.eq(ctrl.size(), 3);
    a.ok(barMulti.innerHTML.includes('3 cells selected'), 'updates to 3 cells selected count');

    // Clear selection -> bar removed and hidden
    ctrl.clear();
    a.eq(ctrl.size(), 0);
    a.eq(doc.getElementById('cgp-selection-bar'), null, 'bar element removed on clear()');
  });

  test('SelectionController clears selection when plain clicking outside cell area', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    let mousedownHandler = null;
    doc.addEventListener = (event, fn, capture) => {
      if (event === 'mousedown') mousedownHandler = fn;
    };

    const ctrl = new CGP.SelectionController({
      adapter: {
        cellInfo: (el) => {
          if (el && el.classList.contains('slick-cell')) {
            return { columnType: 'assignment', assignmentId: '101', studentId: '201', rowIndex: 0, colIndex: 1 };
          }
          return null;
        }
      },
      model: {},
      settings: { values: { multiCellSelection: true } },
      requestPaint: () => {},
      bulkComment: null
    });

    ctrl.start();
    a.ok(mousedownHandler, 'mousedown capture listener registered');

    // Add 2 cells
    ctrl.add({ columnType: 'assignment', assignmentId: '101', studentId: '201', rowIndex: 0, colIndex: 1 });
    ctrl.add({ columnType: 'assignment', assignmentId: '101', studentId: '202', rowIndex: 1, colIndex: 1 });
    a.eq(ctrl.size(), 2);

    // Simulate clicking on whitespace / header outside any cell
    const headerEl = new FakeElement('div');
    headerEl.classList.add('slick-header-column');
    doc.body.appendChild(headerEl);

    mousedownHandler({
      button: 0,
      target: headerEl,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false
    });

    a.eq(ctrl.size(), 0, 'selection cleared on plain click outside cells');
    a.eq(doc.getElementById('cgp-selection-bar'), null, 'selection bar removed');
  });

  test('KeyboardGradingController opens bulk comment on C when multi-selected, blurring active input', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    let bulkTargets = null;
    const fakeBulkComment = {
      open: (targets) => {
        bulkTargets = targets;
      }
    };

    const targetsList = [
      { assignmentId: '101', userId: '201' },
      { assignmentId: '101', userId: '202' }
    ];

    const fakeSelection = {
      keys: new Map([
        ['101:201', targetsList[0]],
        ['101:202', targetsList[1]]
      ]),
      size: () => 2,
      changedAt: 1000,
      targets: () => targetsList
    };

    const kb = new CGP.KeyboardGradingController({
      adapter: {
        cellInfo: () => ({ columnType: 'assignment', assignmentId: '101', studentId: '202' }),
        activeCellInfo: () => null
      },
      model: {},
      writer: {},
      selection: fakeSelection,
      settings: { values: {} },
      requestPaint: () => {},
      bulkComment: fakeBulkComment
    });

    // Simulate input element inside a .slick-cell from the range selection
    const cellEl = new FakeElement('div');
    cellEl.classList.add('slick-cell');
    doc.body.appendChild(cellEl);

    const inputEl = new FakeElement('input');
    inputEl.setAttribute('type', 'text');
    cellEl.appendChild(inputEl);

    let blurred = false;
    inputEl.blur = () => { blurred = true; };

    // Teacher pressed Shift-Click, focusing input at 1005 (after selection started)
    kb._lastTextFocusAt = 1005;

    let prevented = false;
    let stopped = false;
    const fakeEvent = {
      key: 'c',
      target: inputEl,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: () => { prevented = true; },
      stopImmediatePropagation: () => { stopped = true; }
    };

    kb.onKeyDown(fakeEvent);

    a.ok(prevented, 'event default was prevented');
    a.ok(stopped, 'event propagation stopped');
    a.ok(blurred, 'input element was blurred');
    a.eq(bulkTargets, targetsList, 'bulkComment.open was called with selection targets');
  });

  test('KeyboardGradingController does NOT open bulk comment on C when single cell editor is freshly focused', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    let bulkTargets = null;
    const fakeBulkComment = {
      open: (targets) => {
        bulkTargets = targets;
      }
    };

    const targetsList = [{ assignmentId: '101', userId: '201' }];
    const fakeSelection = {
      keys: new Map([['101:201', targetsList[0]]]),
      size: () => 1,
      changedAt: 1000,
      targets: () => targetsList
    };

    const kb = new CGP.KeyboardGradingController({
      adapter: {
        cellInfo: () => ({ columnType: 'assignment', assignmentId: '101', studentId: '201' }),
        activeCellInfo: () => null
      },
      model: {},
      writer: {},
      selection: fakeSelection,
      settings: { values: {} },
      requestPaint: () => {},
      bulkComment: fakeBulkComment
    });

    const cellEl = new FakeElement('div');
    cellEl.classList.add('slick-cell');
    doc.body.appendChild(cellEl);

    const inputEl = new FakeElement('input');
    inputEl.setAttribute('type', 'text');
    cellEl.appendChild(inputEl);

    // Fresh focus in single cell editor
    kb._lastTextFocusAt = 1050;

    let prevented = false;
    const fakeEvent = {
      key: 'c',
      target: inputEl,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: () => { prevented = true; },
      stopImmediatePropagation: () => {}
    };

    kb.onKeyDown(fakeEvent);

    a.eq(prevented, false, 'normal typing of c is not prevented in single editor');
    a.eq(bulkTargets, null, 'bulkComment.open was NOT called');
  });

  test('BulkCommentController renders close button and closes on close()', () => {
    const CGP = loadGradebookDom();
    domshim.install();

    const ctrl = new CGP.BulkCommentController({
      model: {},
      writer: {},
      settings: { values: {} },
      requestPaint: () => {}
    });

    ctrl.open([{ assignmentId: '101', userId: '201' }]);
    a.ok(ctrl.isOpen(), 'bulk comment dialog is open');
    a.ok(ctrl.el.innerHTML.includes('cgp-pop__close'), 'has close button');

    ctrl.close();
    a.eq(ctrl.isOpen(), false, 'bulk comment dialog closed');
  });

  test('options.html comment snippets instructions have no duplicate step numbers', () => {
    const htmlPath = path.resolve(__dirname, '../src/options/options.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Look for <ol class="snippets-steps">
    const listMatch = content.match(/<ol class="snippets-steps">([\s\S]*?)<\/ol>/);
    a.ok(listMatch, 'snippets-steps list found');

    const listHtml = listMatch[1];
    // None of the <strong> tags should contain leading digits like "1. ", "2. ", etc.
    const dupNumbers = listHtml.match(/<strong>\s*\d+\.\s*/g);
    a.eq(dupNumbers, null, 'no duplicate hardcoded step numbers inside strong tags');
  });
});
