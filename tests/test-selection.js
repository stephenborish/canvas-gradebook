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

  function startWithListeners(CGP, doc, adapter) {
    const handlers = {};
    doc.addEventListener = (event, fn) => { handlers[event] = fn; };
    const ctrl = new CGP.SelectionController({
      adapter, model: {}, settings: { values: { multiCellSelection: true } },
      requestPaint: () => {}, bulkComment: null
    });
    ctrl.start();
    return { ctrl, handlers };
  }
  function gridCell(doc, FakeElement, sid) {
    const el = new FakeElement('div');
    el.classList.add('slick-cell');
    el.setAttribute('data-sid', sid);
    doc.body.appendChild(el);
    return el;
  }
  function evt(target, mods) {
    const e = Object.assign({ button: 0, target, metaKey: false, ctrlKey: false, shiftKey: false,
      defaultPrevented: false, stopped: false }, mods || {});
    e.preventDefault = () => { e.defaultPrevented = true; };
    e.stopPropagation = () => { e.stopped = true; };
    e.stopImmediatePropagation = () => { e.stopped = true; };
    return e;
  }

  test('Ctrl-click also keeps the follow-up click, dblclick and Mac context menu away from Canvas', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const cellA = gridCell(doc, FakeElement, '201');
    const cellB = gridCell(doc, FakeElement, '202');
    const adapter = {
      cellInfo: (el) => el && el.classList.contains('slick-cell')
        ? { el, columnType: 'assignment', assignmentId: '101', studentId: el.getAttribute('data-sid'),
            rowIndex: Number(el.getAttribute('data-sid')) - 201, colIndex: 1 }
        : null,
      activeCellInfo: () => null
    };
    const { ctrl, handlers } = startWithListeners(CGP, doc, adapter);
    a.ok(handlers.click && handlers.dblclick && handlers.contextmenu, 'click/dblclick/contextmenu listeners registered');

    const down = evt(cellA, { ctrlKey: true });
    handlers.mousedown(down);
    a.ok(down.stopped && down.defaultPrevented, 'mousedown taken from Canvas');
    a.eq(ctrl.size(), 1);

    const click = evt(cellA, { ctrlKey: true });
    handlers.click(click);
    a.ok(click.stopped, 'the click that follows never reaches SlickGrid (no editor opens)');
    const ctx = evt(cellA, { ctrlKey: true });
    handlers.contextmenu(ctx);
    a.ok(ctx.defaultPrevented, 'no browser context menu over the selected cell');
    const dbl = evt(cellA, { ctrlKey: true });
    handlers.dblclick(dbl);
    a.ok(dbl.stopped, 'no grade tray from a fast double modifier click');

    // A click on a cell that was not just claimed passes through untouched.
    const other = evt(cellB, {});
    handlers.click(other);
    a.ok(!other.stopped, 'unrelated click left alone');
  });

  test('first Ctrl-click includes the cell Canvas already shows as active', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const cellA = gridCell(doc, FakeElement, '201');
    const cellB = gridCell(doc, FakeElement, '202');
    const info = (el) => ({ el, columnType: 'assignment', assignmentId: '101', studentId: el.getAttribute('data-sid'),
      rowIndex: Number(el.getAttribute('data-sid')) - 201, colIndex: 1 });
    const adapter = {
      cellInfo: (el) => el && el.classList.contains('slick-cell') ? info(el) : null,
      activeCellInfo: () => info(cellA)
    };
    const { ctrl, handlers } = startWithListeners(CGP, doc, adapter);
    handlers.mousedown(evt(cellA, {}));          // plain click: Canvas activates A
    a.eq(ctrl.size(), 0);
    handlers.mousedown(evt(cellB, { metaKey: true }));
    a.eq(ctrl.size(), 2, 'active A plus Cmd-clicked B');
    const ids = ctrl.targets().map((t) => t.userId).sort();
    a.eq(ids.join(','), '201,202');
    // Cmd-clicking B again removes only B.
    handlers.mousedown(evt(cellB, { metaKey: true }));
    a.eq(ctrl.targets().map((t) => t.userId).join(','), '201');
  });

  test('a cell Canvas kept active after Escape is not pulled into a new selection', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const cellA = gridCell(doc, FakeElement, '201');
    const cellB = gridCell(doc, FakeElement, '202');
    const cellC = gridCell(doc, FakeElement, '203');
    const info = (el) => ({ el, columnType: 'assignment', assignmentId: '101', studentId: el.getAttribute('data-sid'),
      rowIndex: Number(el.getAttribute('data-sid')) - 201, colIndex: 1 });
    const adapter = {
      cellInfo: (el) => el && el.classList.contains('slick-cell') ? info(el) : null,
      activeCellInfo: () => info(cellA)
    };
    const { ctrl, handlers } = startWithListeners(CGP, doc, adapter);
    handlers.mousedown(evt(cellA, {}));
    handlers.mousedown(evt(cellB, { ctrlKey: true }));
    a.eq(ctrl.size(), 2);
    ctrl.clear();                                 // Escape: A is still active in Canvas
    handlers.mousedown(evt(cellC, { ctrlKey: true }));
    a.eq(ctrl.targets().map((t) => t.userId).join(','), '203', 'only the Ctrl-clicked cell');
  });

  test('Shift-click extends from where the keyboard moved the active cell', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const cells = ['201', '202', '203', '204'].map((sid) => gridCell(doc, FakeElement, sid));
    const info = (el) => ({ el, columnType: 'assignment', assignmentId: '101', studentId: el.getAttribute('data-sid'),
      rowIndex: Number(el.getAttribute('data-sid')) - 201, colIndex: 1 });
    let active = cells[0];
    const adapter = {
      cellInfo: (el) => el && el.classList.contains('slick-cell') ? info(el) : null,
      activeCellInfo: () => info(active),
      ensureRowsMapped: () => Promise.resolve(true),
      studentAt: (r) => String(201 + r),
      columnAt: () => ({ type: 'assignment', assignmentId: '101' })
    };
    const { ctrl, handlers } = startWithListeners(CGP, doc, adapter);
    handlers.mousedown(evt(cells[0], {}));       // click row 0
    active = cells[2];                            // arrow keys down to row 2
    handlers.mousedown(evt(cells[3], { shiftKey: true }));
    await new Promise((r) => setTimeout(r, 0));
    a.eq(ctrl.targets().map((t) => t.userId).sort().join(','), '203,204', 'range is rows 2-3, not 0-3');
  });

  test('the Test Student is skipped by Ctrl-click, Shift-click ranges and active-cell seeding', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    // Rows 0-3: 201, 202, 999 (Test Student), 204
    const sids = ['201', '202', '999', '204'];
    const cells = sids.map((sid) => gridCell(doc, FakeElement, sid));
    const info = (el) => ({ el, columnType: 'assignment', assignmentId: '101', studentId: el.getAttribute('data-sid'),
      rowIndex: sids.indexOf(el.getAttribute('data-sid')), colIndex: 1 });
    let active = cells[2];
    const adapter = {
      cellInfo: (el) => el && el.classList.contains('slick-cell') ? info(el) : null,
      activeCellInfo: () => info(active),
      ensureRowsMapped: () => Promise.resolve(true),
      studentAt: (r) => sids[r],
      columnAt: () => ({ type: 'assignment', assignmentId: '101' }),
      isTestStudentRowIndex: () => false          // name check unavailable: the id alone must do it
    };
    const handlers = {};
    doc.addEventListener = (event, fn) => { handlers[event] = fn; };
    const ctrl = new CGP.SelectionController({
      adapter, model: {}, settings: { values: { multiCellSelection: true } }, requestPaint: () => {},
      api: { testStudentIds: () => Promise.resolve(['999']) }, courseId: '7'
    });
    ctrl.start();
    await new Promise((r) => setTimeout(r, 0));

    handlers.mousedown(evt(cells[2], { ctrlKey: true }));
    a.eq(ctrl.size(), 0, 'Ctrl-click on the Test Student selects nothing');

    handlers.mousedown(evt(cells[2], {}));        // plain click on Test Student row (active)
    handlers.mousedown(evt(cells[3], { ctrlKey: true }));
    a.eq(ctrl.targets().map((t) => t.userId).join(','), '204', 'active Test Student cell not seeded');

    ctrl.clear();
    active = cells[0];
    handlers.mousedown(evt(cells[0], {}));
    handlers.mousedown(evt(cells[3], { shiftKey: true }));
    await new Promise((r) => setTimeout(r, 0));
    a.eq(ctrl.targets().map((t) => t.userId).sort().join(','), '201,202,204', 'range skips the Test Student row');
  });

  test('the Test Student is also skipped by its row name when its id is unknown', () => {
    const CGP = loadGradebookDom();
    domshim.install();
    const ctrl = new CGP.SelectionController({
      adapter: { isTestStudentRowIndex: (r) => r === 5 }, model: {}, settings: { values: {} }, requestPaint: () => {}
    });
    a.eq(ctrl.add({ columnType: 'assignment', assignmentId: '1', studentId: '50', rowIndex: 5, colIndex: 0 }), false);
    a.eq(ctrl.add({ columnType: 'assignment', assignmentId: '1', studentId: '51', rowIndex: 6, colIndex: 0 }), true);
  });

  test('active-cell ring is not the selection blue', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'gradebook.css'), 'utf8');
    const block = /html\.cgp-on \.slick-cell\.active \{[^}]*\}/.exec(css)[0];
    a.ok(!/var\(--cgp-brand\)|var\(--cgp-sel\)/.test(block), 'active ring uses a different colour');
  });

  test('modifier clicks on our own in-cell controls are not taken over', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const cellA = gridCell(doc, FakeElement, '201');
    const link = new FakeElement('a');
    link.classList.add('cgp-sub');
    link.setAttribute('href', '/x');
    cellA.appendChild(link);
    const adapter = {
      cellInfo: () => ({ el: cellA, columnType: 'assignment', assignmentId: '101', studentId: '201', rowIndex: 0, colIndex: 1 }),
      activeCellInfo: () => null
    };
    const { ctrl, handlers } = startWithListeners(CGP, doc, adapter);
    const down = evt(link, { metaKey: true });
    handlers.mousedown(down);
    a.ok(!down.defaultPrevented && !down.stopped, 'Cmd-click on the submission link still opens it');
    a.eq(ctrl.size(), 0);

    // Cmd-click the cell, then quickly Cmd-click its submission link: the
    // link's click must not be swallowed as the cell gesture's follow-up.
    handlers.mousedown(evt(cellA, { metaKey: true }));
    a.eq(ctrl.size(), 1);
    handlers.mousedown(evt(link, { metaKey: true }));
    const linkClick = evt(link, { metaKey: true });
    handlers.click(linkClick);
    a.ok(!linkClick.defaultPrevented && !linkClick.stopped, 'link click right after a cell claim still goes through');
  });

  test('selection styling beats row hover and the active-cell ring', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'gradebook.css'), 'utf8');
    a.ok(/\.slick-row\.cgp-row-hover > \.slick-cell\.cgp-sel/.test(css), 'hovered row keeps the selection tint');
    a.ok(/outline:\s*2px solid var\(--cgp-sel\) !important/.test(css), 'selection ring is an !important outline');
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
    if (opts.before) fakeModel.cell = () => opts.before;
    if (opts.modelExtras) Object.assign(fakeModel, opts.modelExtras);
    const kb = new CGP.KeyboardGradingController({
      adapter: {
        cellInfo: () => ({ columnType: 'assignment', assignmentId: '101', studentId: '201' }),
        activeCellInfo: () => null
      },
      model: fakeModel,
      writer: {
        api: { updateSubmission: (c, aid, uid, form) => { calls.updates.push(form); return Promise.resolve({}); } },
        apply: (targets) => { calls.applied.push(targets); return Promise.resolve({ ok: 1 }); },
        liftsMissing: () => opts.lift !== false
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
    calls.kb = kb;
    return calls;
  }

  test('typing a grade never sends a second write of our own; an applied Missing goes back to Canvas once it saved', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false });
    a.eq(calls.updates.length, 0, 'no direct PUT from focusout');
    a.not(calls.marked, 'no local-write mark for a write we did not make');
    a.not(calls.patched, 'no optimistic grade patch over Canvas\u2019s own cell');
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.refreshes, 1, 'the submission was re-read after Canvas\u2019s own save');
    a.eq(calls.applied.length, 1, 'one guarded write through GradeWriter');
    a.eq(calls.applied[0][0].parsed.kind, CGP.gradeOps.KIND.LIFT_MISSING, 'the status is handed back - never set to Late');
    a.eq(calls.applied[0][0].userId, '201');
  });

  test('Canvas\u2019s own save of the grade (stamped by the page bridge) does not stop the follow-up', async () => {
    const CGP = loadGradebookDom();
    // noteNativeWrite stamps _writeStartedAt moments AFTER the edit; reading
    // that map is what used to make this follow-up stand down every time.
    const stamped = new Map([['101:201', Date.now() + 500]]);
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3, score: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false },
    { modelExtras: { _writeStartedAt: stamped, key: (x, y) => x + ':' + y, localWriteSince: () => false } });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.applied.length, 1);
    a.eq(calls.applied[0][0].parsed.kind, CGP.gradeOps.KIND.LIFT_MISSING);
  });

  test('Canvas reporting its own save runs the follow-up at once, not on the timer', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3, score: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false });
    a.eq(calls.kb.canvasSaved('101', '201'), true);
    a.eq(calls.kb.canvasSaved('101', '201'), false, 'only once');
    await new Promise((r) => setTimeout(r, 20));
    a.eq(calls.refreshes, 1);
    a.eq(calls.applied.length, 1);
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.applied.length, 1, 'the timer no longer fires as well');
  });

  test('a grade saved in the Grade Detail Tray takes an applied Missing off like a typed one', async () => {
    const CGP = loadGradebookDom();
    // No editor was opened: focusout never sees this edit.
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3, score: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false }, { skipFocusIn: true });
    calls.kb.followNativeSave('101', '201', { grade: '0', enteredScore: 0, gradedAt: 't0', latePolicyStatus: 'missing', at: Date.now() });
    await new Promise((r) => setTimeout(r, 20));
    a.eq(calls.refreshes, 1);
    a.eq(calls.applied.length, 1);
    a.eq(calls.applied[0][0].parsed.kind, CGP.gradeOps.KIND.LIFT_MISSING);
  });

  test('a status-only save in the tray (no new grade) changes nothing and is not retried', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '0', enteredScore: 0, score: 0,
      gradedAt: 't0', latePolicyStatus: 'missing', missing: true, excused: false }, { skipFocusIn: true });
    calls.kb.followNativeSave('101', '201', { grade: '0', enteredScore: 0, gradedAt: 't0', latePolicyStatus: null, at: Date.now() });
    await new Promise((r) => setTimeout(r, 1400));
    a.eq(calls.refreshes, 1, 'one read, no retries');
    a.eq(calls.applied.length, 0);
  });

  test('a grade typed over Canvas\u2019s own computed Missing sends nothing at all - Canvas drops it itself', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3, score: 3,
      gradedAt: 't1', latePolicyStatus: null, missing: false, late: false, excused: false },
    { before: { assignmentId: '101', userId: '201', score: null, grade: null, enteredScore: null, gradedAt: null,
      missing: true, latePolicyStatus: null } });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.refreshes, 1);
    a.eq(calls.applied.length, 0, 'no Late, whatever the submission type');
  });

  test('with the lift setting off, an applied Missing stays exactly as Canvas keeps it', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3, score: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false }, { lift: false });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.applied.length, 0);
  });

  test('a newer write of ours since the edit wins over the follow-up', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '3', enteredScore: 3, score: 3,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false },
    { modelExtras: { localWriteSince: () => true } });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.applied.length, 0);
  });

  test('a zero typed over Missing leaves Missing on', async () => {
    const CGP = loadGradebookDom();
    const calls = focusOutHarness(CGP, { assignmentId: '101', userId: '201', grade: '0', enteredScore: 0, score: 0,
      gradedAt: 't1', latePolicyStatus: 'missing', missing: true, excused: false }, { typed: '' });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(calls.applied.length, 0);
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

  test('manifest description fits the Chrome Web Store limit of 132 characters', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    a.ok(manifest.description.length <= 132, 'description is ' + manifest.description.length + ' characters');
  });
  test('extension version is bumped to 1.32.1 and displayed directly above Save changes button', () => {
    const manifestPath = path.resolve(__dirname, '../manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    a.eq(manifest.version, '1.32.1', 'manifest.json version is 1.32.1');

    const CGP = loadGradebookDom();
    a.eq(CGP.VERSION, '1.32.1', 'CGP.VERSION is 1.32.1');

    const htmlPath = path.resolve(__dirname, '../src/options/options.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Verify sidebar__version appears before button#save in options.html
    const versionIdx = content.indexOf('class="sidebar__version"');
    const saveBtnIdx = content.indexOf('id="save"');
    a.ok(versionIdx > 0, 'sidebar__version element exists');
    a.ok(saveBtnIdx > versionIdx, 'sidebar__version appears directly above save button');
    a.ok(content.includes('id="extensionVersion">1.32.1<'), 'displays 1.32.1 version number');
  });
});
