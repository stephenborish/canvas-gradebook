/* The hidden Test Student row must never collect grades unnoticed.
 *
 * With the row hidden, a teacher cannot see what is typed into it - yet
 * Canvas counts its scores in column averages. These cases pin down the
 * guard (src/gradebook/test-student-guard.js): keystrokes that would edit a
 * Test Student cell are stopped, navigation steps past the row, and grades
 * already sitting there are found and offered for clearing. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function loadGuard() {
  const CGP = loadGradebookDom();
  if (!CGP.TestStudentGuard) {
    ['src/gradebook/test-student-guard.js', 'src/gradebook/writer.js'].forEach((rel) => {
      vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
    });
  }
  return CGP;
}

const said = [];
function stubUi(CGP) {
  said.length = 0;
  CGP.ui = {
    toast: (m) => said.push({ level: 'info', text: String(m) }),
    error: (m) => said.push({ level: 'error', text: String(m) })
  };
}

const TEST_TOP = 70;   // the Test Student's row in these fixtures

function adapterStub(overrides) {
  const calls = { cancelled: 0, activated: [], scrolled: [] };
  const adapter = Object.assign({
    cellInfo: (el) => el && el.__info ? el.__info : null,
    activeCellInfo: () => null,
    isTestStudentAtTop: (top) => top === TEST_TOP,
    editorInput: (el) => (el && el.__input) || null,
    setEditorValue: (input, v) => { input.value = v; },
    cancelEditor: () => { calls.cancelled++; return true; },
    rowCount: () => 10,
    scrollRowIntoView: (r) => calls.scrolled.push(r),
    cellElementAt: (r, c) => ({ r, c }),
    activateCell: (el) => calls.activated.push(el)
  }, overrides || {});
  return { adapter, calls };
}

function key(k, target, extra) {
  return Object.assign({
    key: k, target, defaultPrevented: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  }, extra || {});
}

function cellTarget(info, input) {
  return { __info: info, __input: input || null, closest: (sel) => (sel === '.slick-cell' ? {} : null), tagName: 'DIV', getAttribute: () => null };
}

suite('Test Student guard: nothing is typed into the hidden row', (test) => {
  const settings = (on) => ({ values: { hideTestStudent: on !== false, testStudentAutoClear: false } });

  test('a grade keystroke on the hidden Test Student row is stopped and the cursor moves on', async () => {
    const CGP = loadGuard();
    const { adapter, calls } = adapterStub();
    const g = new CGP.TestStudentGuard({ adapter, settings: settings() });
    const input = { value: '8', blur() {} };
    const info = { top: TEST_TOP, rowIndex: 1, colIndex: 4 };
    info.el = { __input: input };
    const e = key('8', cellTarget(info, input));
    g.onKeyDown(e);
    a.eq(e.defaultPrevented, true, 'never reaches Canvas');
    a.eq(e.stopped, true, 'never reaches the M/E/L shortcuts');
    a.eq(input.value, '', 'the editor is emptied before it closes');
    a.eq(calls.cancelled, 1, 'and closed without saving');
    await new Promise((r) => setTimeout(r, 80));
    a.eq(calls.activated[0].r, 2, 'cursor stepped down to the next real student');
  });

  test('M on the hidden row is stopped too', () => {
    const CGP = loadGuard();
    const { adapter } = adapterStub();
    const g = new CGP.TestStudentGuard({ adapter, settings: settings() });
    const e = key('m', cellTarget({ top: TEST_TOP, rowIndex: 1, colIndex: 4, el: {} }));
    g.onKeyDown(e);
    a.eq(e.defaultPrevented, true);
  });

  test('arrow navigation that lands on the hidden row steps past it in the same direction', async () => {
    const CGP = loadGuard();
    let active = { top: 35, rowIndex: 0, colIndex: 4, el: {} };
    const { adapter, calls } = adapterStub({ activeCellInfo: () => active });
    const g = new CGP.TestStudentGuard({ adapter, settings: settings() });
    const e = key('ArrowDown', cellTarget(active));
    g.onKeyDown(e);
    a.eq(e.defaultPrevented, false, 'Canvas still moves the cursor itself');
    active = { top: TEST_TOP, rowIndex: 1, colIndex: 4, el: {} };   // where Canvas put it
    await new Promise((r) => setTimeout(r, 200));
    a.eq(calls.activated.length, 1);
    a.eq(calls.activated[0].r, 2, 'stepped on down past the hidden row');
  });

  test('moving up past the hidden row keeps going up', async () => {
    const CGP = loadGuard();
    let active = { top: 105, rowIndex: 2, colIndex: 4, el: {} };
    const { adapter, calls } = adapterStub({ activeCellInfo: () => active });
    const g = new CGP.TestStudentGuard({ adapter, settings: settings() });
    g.onKeyDown(key('ArrowUp', cellTarget(active)));
    active = { top: TEST_TOP, rowIndex: 1, colIndex: 4, el: {} };
    await new Promise((r) => setTimeout(r, 200));
    a.eq(calls.activated[0].r, 0);
  });

  test('an editor that opens on the hidden row by any route is closed without saving', () => {
    const CGP = loadGuard();
    const { adapter, calls } = adapterStub();
    const g = new CGP.TestStudentGuard({ adapter, settings: settings() });
    const input = { value: '', blur() {} };
    const info = { top: TEST_TOP, rowIndex: 1, colIndex: 4, el: { __input: input } };
    g.onFocusIn({ target: cellTarget(info, input) });
    a.eq(calls.cancelled, 1);
  });

  test('ordinary rows, text fields elsewhere, and a visible Test Student row are left alone', () => {
    const CGP = loadGuard();
    const { adapter } = adapterStub({ activeCellInfo: () => ({ top: TEST_TOP, rowIndex: 1, colIndex: 4, el: {} }) });
    const g = new CGP.TestStudentGuard({ adapter, settings: settings() });
    const normal = key('8', cellTarget({ top: 35, rowIndex: 0, colIndex: 4, el: {} }));
    g.onKeyDown(normal);
    a.eq(normal.defaultPrevented, false, 'a real student’s cell');
    const search = key('a', { closest: () => null, tagName: 'INPUT', getAttribute: () => 'text' });
    g.onKeyDown(search);
    a.eq(search.defaultPrevented, false, 'typing in a search box is never about the grid');
    const off = new CGP.TestStudentGuard({ adapter, settings: settings(false) });
    const visible = key('8', cellTarget({ top: TEST_TOP, rowIndex: 1, colIndex: 4, el: {} }));
    off.onKeyDown(visible);
    a.eq(visible.defaultPrevented, false, 'with the row shown, it is the teacher’s to edit');
  });

  test('the extension’s own spreadsheet navigation steps over the hidden row', async () => {
    const CGP = loadGuard();
    domshim.install();
    let activated = null;
    const kb = new CGP.KeyboardGradingController({
      adapter: {
        columnAt: () => ({ type: 'assignment' }),
        isTestStudentRowIndex: (r) => r === 1,
        scrollRowIntoView: () => {}, scrollColumnIntoView: () => {},
        cellElementAt: (r, c) => ({ r, c }),
        activateCell: (el) => { activated = el; }
      },
      model: {}, writer: {}, selection: { size: () => 0 },
      settings: { values: { hideTestStudent: true } }
    });
    kb.focusCell(1, 4, 0, 1);
    await new Promise((r) => setTimeout(r, 80));
    a.eq(activated.r, 2);
  });

  test('GradeWriter never writes to a student outside the roster (the Test Student is not in it)', async () => {
    const CGP = loadGuard();
    stubUi(CGP);
    let sent = 0;
    const m = new CGP.GradebookModel({}, '7');
    m.ready = true;
    m.assignments.set('50', { id: '50', name: 'HW', gradingType: 'points' });
    m.loadedAssignments.add('50');
    const w = new CGP.GradeWriter({ api: { updateSubmission: () => { sent++; return Promise.resolve({}); } }, model: m, settings: { values: {} } });
    const res = await w.apply([{ assignmentId: '50', userId: '999', parsed: CGP.gradeOps.parseToken('M') }]);
    a.eq(sent, 0);
    a.eq(res.skipped, 1);
  });
});

suite('Test Student guard: grades already in the hidden row', (test) => {
  function setup(subs, opts) {
    const CGP = loadGuard();
    domshim.install();
    stubUi(CGP);
    const writes = [];
    const model = new CGP.GradebookModel({}, '7');
    model.assignments.set('50', { id: '50', name: 'Lab 1' });
    model.assignments.set('51', { id: '51', name: 'Quiz 2' });
    model.assignments.set('52', { id: '52', name: 'Blind essay', anonymous: true });
    const saved = [];
    const settingsObj = {
      values: { hideTestStudent: true, testStudentAutoClear: !!(opts && opts.auto) },
      save: (patch) => { saved.push(patch); return Promise.resolve(); }
    };
    const api = {
      testStudentIds: () => Promise.resolve(['999']),
      submissionsForStudent: () => Promise.resolve(subs),
      updateSubmission: (c, aid, uid, form) => { writes.push({ aid, uid, form }); return Promise.resolve({}); }
    };
    const g = new CGP.TestStudentGuard({ adapter: {}, model, api, settings: settingsObj });
    return { CGP, g, writes, saved };
  }

  const SUBS = [
    { assignment_id: 50, user_id: 999, score: 0, grade: '0', late_policy_status: 'missing' },   // missing policy zero
    { assignment_id: 51, user_id: 999, excused: true },
    { assignment_id: 52, user_id: 999, score: 5, grade: '5' },                                   // anonymous: never touched
    { assignment_id: 53, user_id: 999, score: null, grade: null, late_policy_status: null }      // nothing in it
  ];

  test('what counts as "holding data"', () => {
    const CGP = loadGuard();
    const has = CGP.testStudentInternals.holdsData;
    a.eq(has({ score: 0 }), true, 'an automatic missing-policy zero counts');
    a.eq(has({ excused: true }), true);
    a.eq(has({ late_policy_status: 'missing' }), true);
    a.eq(has({ late_policy_status: 'none', score: null, grade: '' }), false);
    a.eq(has({}), false);
  });

  test('found grades are cleared automatically, with no notice', async () => {
    const { g, writes } = setup(SUBS);
    const found = await g.scan();
    a.eq(found.length, 2, 'Lab 1 and Quiz 2; never the anonymous column, never the empty one');
    await new Promise((r) => setTimeout(r, 0));
    a.eq(writes.length, 2);
    a.ok(!g.noticeEl, 'no notice is shown');
  });

  test('clearing empties the grade, un-excuses, and pins "no status" so the missing policy cannot refill it', async () => {
    const { g, writes } = setup(SUBS);
    await g.scan();
    await new Promise((r) => setTimeout(r, 0));
    a.eq(writes.length, 2);
    const lab = writes.find((w) => w.aid === '50');
    a.eq(lab.uid, '999');
    a.eq(lab.form['submission[posted_grade]'], '');
    a.eq(lab.form['submission[late_policy_status]'], 'none');
    const quiz = writes.find((w) => w.aid === '51');
    a.eq(quiz.form['submission[excuse]'], 'false');
  });

  test('nothing is read at all while the row is shown', async () => {
    const { g, writes } = setup(SUBS);
    g.settings.values.hideTestStudent = false;
    const found = await g.scan();
    a.eq(found.length, 0);
    a.eq(writes.length, 0);
  });
});
