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

  function focusOutHarness(CGP, refreshed, opts) {
    opts = opts || {};
    domshim.install();
    const doc = globalThis.document;
    const FakeElement = domshim.FakeElement;
    const calls = { updates: [], applied: [], refreshes: 0 };
    const fakeModel = {
      courseId: '42',
      cell: () => ({ assignmentId: '101', userId: '201', score: 0, grade: '0', enteredScore: 0,
        gradedAt: 't0', missing: true, latePolicyStatus: 'missing' }),
      patchCell: () => { calls.patched = true; },
      markLocalWrite: () => { calls.marked = true; },
      queueTotalRefresh: () => {},
      refreshCell: () => { calls.refreshes++; return Promise.resolve(refreshed); }
    };
    const kb = new CGP.KeyboardGradingController({
      adapter: {
        cellInfo: () => ({ columnType: 'assignment', assignmentId: '101', studentId: '201' }),
        activeCellInfo: () => null
      },
      model: fakeModel,
      writer: {
        api: { updateSubmission: (c, aid, uid, form) => { calls.updates.push(form); return Promise.resolve({}); } },
        apply: (targets) => { calls.applied.push(targets); return Promise.resolve({ ok: 1 }); }
      },
      selection: { size: () => 1, targets: () => [] },
      settings: { values: {} },
      requestPaint: () => {},
      registry: { invalidate: () => {} }
    });
    const cellEl = new FakeElement('div');
    cellEl.classList.add('slick-cell');
    doc.body.appendChild(cellEl);
    const inputEl = new FakeElement('input');
    inputEl.setAttribute('type', 'text');
    inputEl.value = '0';
    cellEl.appendChild(inputEl);
    if (!opts.skipFocusIn) kb.onFocusIn({ target: inputEl });
    inputEl.value = opts.typed === undefined ? '3' : opts.typed;
    kb.onFocusOut({ target: inputEl });
    return calls;
  }

  test('typing a grade never sends a second write of our own; Missing comes off once Canvas saved it', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false });
    a.eq(calls.updates.length, 0, 'no direct PUT from focusout');
    a.not(calls.marked, 'no local-write mark for a write we did not make');
    a.not(calls.patched, 'no optimistic grade patch over Canvas\u2019s own cell');
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.refreshes, 1, 'the submission was re-read after Canvas\u2019s own save');
    a.eq(calls.applied.length, 1, 'one guarded write through GradeWriter');
    a.eq(calls.applied[0][0].parsed.kind, CGP.gradeOps.KIND.CLEAR_MISSING);
    a.eq(calls.applied[0][0].userId, '201');
  });

  test('an edit Canvas did not save (cancelled, refused) never clears Missing', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '0', enteredScore: 0,
      gradedAt: 't0', latePolicyStatus: 'missing', missing: true });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.applied.length, 0);
    a.eq(calls.updates.length, 0);
  });

  test('a focusout with no recorded focusin is never treated as an edit', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, null, { skipFocusIn: true });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.refreshes, 0);
    a.eq(calls.updates.length, 0);
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

  test('extension version is bumped to 1.14.1 and displayed directly above Save changes button', () => {
    const manifestPath = path.resolve(__dirname, '../manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    a.eq(manifest.version, '1.14.1', 'manifest.json version is 1.14.1');

    const CGP = loadGradebookDom();
    a.eq(CGP.VERSION, '1.14.1', 'CGP.VERSION is 1.14.1');

    const htmlPath = path.resolve(__dirname, '../src/options/options.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Verify sidebar__version appears before button#save in options.html
    const versionIdx = content.indexOf('class="sidebar__version"');
    const saveBtnIdx = content.indexOf('id="save"');
    a.ok(versionIdx > 0, 'sidebar__version element exists');
    a.ok(saveBtnIdx > versionIdx, 'sidebar__version appears directly above save button');
    a.ok(content.includes('id="extensionVersion">1.14.1<'), 'displays 1.14.1 version number');
  });
});
