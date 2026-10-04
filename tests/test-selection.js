/* Tests for SelectionController and KeyboardGradingController multi-cell commenting:
 * 1. SelectionController displays a floating action bar (#cgp-selection-bar)
 *    when multiple cells are selected (keys.size > 1) and hides it when keys.size <= 1.
 * 2. KeyboardGradingController opens bulk comment on pressing 'C' (or 'Shift+C')
 *    when selectionSize > 1, even if an input element was active from range selection.
 * 3. KeyboardGradingController does NOT intercept 'C' when typing into a single cell editor.
 * 4. options.html contains clean, un-duplicated step instructions for comment snippets.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

suite('SelectionController & multi-cell bulk comment', (test) => {
  test('SelectionController shows and updates floating bar when multi-selected, hides on single or clear', () => {
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

    // Clear selection -> bar hides
    ctrl.clear();
    a.eq(ctrl.size(), 0);
    a.eq(barMulti.style.display, 'none', 'bar hides on clear()');
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
