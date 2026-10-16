/* Regression tests for the write path: what reaches Canvas, for whom, and
 * what the teacher is told when it can't.
 *
 * Each case pins down a way a grade, status or comment used to land on the
 * wrong student, land twice, or be decided from data that was not there. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

['src/gradebook/writer.js', 'src/gradebook/bulk-paste.js'].forEach((rel) => {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
});

const said = [];
function stubUi() {
  said.length = 0;
  CGP.ui = {
    toast: (m) => said.push({ level: 'info', text: String(m) }),
    error: (m) => said.push({ level: 'error', text: String(m) })
  };
}

function model(opts) {
  opts = opts || {};
  const m = new CGP.GradebookModel(opts.api || {}, '7');
  m.ready = opts.ready !== false;
  m.instructorId = '1';
  m.assignments.set('50', { id: '50', name: 'HW', gradingType: opts.gradingType || 'points' });
  m.students.set('10', { id: '10', name: 'A' });
  m.studentOrder.push('10');
  return m;
}

suite('write safety: clipboard alignment', (test) => {
  test('a blank FIRST copied cell keeps every value on its own student', () => {
    const m = CGP.clipboardMatrix.parse('\n85\n90\n');
    a.deep(m.rows, [[''], ['85'], ['90']]);
    const mapped = CGP.gridMap.mapMatrixToTargets(m, { rowIndex: 0, colIndex: 3 }, {
      studentAt: (r) => 's' + r,
      columnAt: () => ({ type: 'assignment', assignmentId: 'a' })
    });
    a.deep(mapped.targets.map((t) => t.userId + '=' + t.token), ['s1=85', 's2=90']);
  });

  test('a blank first TSV row is kept too', () => {
    const m = CGP.clipboardMatrix.parse('\t\n85\t90\r\n');
    a.eq(m.rowCount, 2);
    a.deep(m.rows[1], ['85', '90']);
  });
});

suite('write safety: grade semantics', (test) => {
  const ops = () => CGP.gradeOps;

  test('grading a merely computed-missing submission leaves late_policy_status alone', () => {
    const op = ops().operationFor(ops().parseToken('8'), { wasMissing: true });
    a.lacksKey(op.form, 'submission[late_policy_status]');
  });

  test('clearing an excused submission un-excuses it explicitly', () => {
    const op = ops().operationFor(ops().parseToken('-'), { wasExcused: true });
    a.eq(op.form['submission[excuse]'], 'false');
    const plain = ops().operationFor(ops().parseToken('-'), {});
    a.lacksKey(plain.form, 'submission[excuse]');
  });

  test('a letter is only a grade on letter/GPA columns, pass/complete only on pass_fail', () => {
    const t = ops().parseToken;
    a.eq(ops().acceptsToken(t('B'), 'points'), false);
    a.eq(ops().acceptsToken(t('B+', { gradingType: 'letter_grade' }), 'letter_grade'), true);
    a.eq(ops().acceptsToken(t('complete'), 'pass_fail'), true);
    a.eq(ops().acceptsToken(t('complete'), 'points'), false);
    a.eq(ops().acceptsToken(t('7'), 'pass_fail'), true);
    a.eq(ops().acceptsToken(t('M'), 'percent'), true);
  });

  test('GradeWriter refuses tokens the column cannot take', () => {
    const w = new CGP.GradeWriter({ api: {}, model: model(), settings: { values: {} } });
    const built = w.targetsFromTokens([{ assignmentId: '50', userId: '10', token: 'B' }]);
    a.eq(built.invalid.length, 1);
    a.eq(built.targets.length, 0);
  });
});

suite('write safety: Canvas errors and retries', (test) => {
  test('a 401 "unauthorized" is a permission problem, not an expired session', () => {
    const denied = { status: 401, canvasStatus: 'unauthorized', canvasMessage: 'user not authorized to perform that action' };
    const expired = { status: 401, canvasStatus: 'unauthenticated' };
    a.eq(CGP.util.isSessionExpiredError(denied), false);
    a.eq(CGP.util.isPermissionDeniedError(denied), true);
    a.ok(/permission/i.test(CGP.util.describeApiError(denied)));
    a.eq(CGP.util.isSessionExpiredError(expired), true);
    a.ok(/expired/i.test(CGP.util.describeApiError(expired)));
  });

  function apiWith(responses) {
    const calls = [];
    const api = new CGP.CanvasApi({
      origin: 'https://x.instructure.com',
      fetch: (url, init) => {
        calls.push({ url, init });
        const r = responses.shift();
        if (r === 'network') return Promise.reject(new Error('reset'));
        return Promise.resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          text: () => Promise.resolve(r.body || ''),
          headers: { get: (h) => (r.headers || {})[h] || null }
        });
      }
    });
    return { api, calls };
  }

  test('a comment is never re-sent after a lost response (no duplicate comments)', async () => {
    const { api, calls } = apiWith([{ status: 502 }, { status: 200, body: '{}' }]);
    let failed = false;
    await api.addComment('7', '50', '10', 'Nice').catch(() => { failed = true; });
    a.eq(calls.length, 1, 'one request only');
    a.eq(failed, true);
  });

  test('a throttled comment IS retried - Canvas refused it before acting', async () => {
    const { api, calls } = apiWith([{ status: 403, body: '403 Forbidden (Rate Limit Exceeded)' }, { status: 200, body: '{}' }]);
    await api.addComment('7', '50', '10', 'Nice');
    a.eq(calls.length, 2);
  });

  test('a grade write still retries a lost response once (idempotent)', async () => {
    const { api, calls } = apiWith(['network', { status: 200, body: '{}' }]);
    await api.updateSubmission('7', '50', '10', { 'submission[posted_grade]': '5' });
    a.eq(calls.length, 2);
  });

  test('a plain 403 refusal is not retried', async () => {
    const { api, calls } = apiWith([{ status: 403, body: '{"status":"unauthorized"}' }, { status: 200, body: '{}' }]);
    await api.updateSubmission('7', '50', '10', {}).catch(() => null);
    a.eq(calls.length, 1);
  });

  test('error details from the body are kept on the error', async () => {
    const { api } = apiWith([{ status: 401, body: '{"status":"unauthorized","errors":[{"message":"user not authorized to perform that action"}]}' }]);
    const err = await api.updateSubmission('7', '50', '10', {}).catch((e) => e);
    a.eq(err.canvasStatus, 'unauthorized');
    a.eq(CGP.util.isPermissionDeniedError(err), true);
  });
});

suite('write safety: GradeWriter decides from loaded data', (test) => {
  test('nothing is written while the course model is still loading', async () => {
    stubUi();
    let sent = 0;
    const w = new CGP.GradeWriter({
      api: { updateSubmission: () => { sent++; return Promise.resolve({}); } },
      model: model({ ready: false }), settings: { values: {} }
    });
    const res = await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('M') }]);
    a.eq(sent, 0);
    a.eq(res.notReady, true);
    a.ok(/still loading/i.test(said[said.length - 1].text));
  });

  test('a column that has not loaded is loaded before M decides apply-or-remove', async () => {
    stubUi();
    const forms = [];
    const m = model({
      api: {
        submissionsForAssignments: () => Promise.resolve([{
          id: '1', assignment_id: '50', user_id: '10', missing: true, late_policy_status: 'missing', workflow_state: 'unsubmitted'
        }])
      }
    });
    const w = new CGP.GradeWriter({
      api: {
        updateSubmission: (c, aid, uid, form) => {
          forms.push(form);
          return Promise.resolve({ id: '1', assignment_id: '50', user_id: '10', missing: false, late_policy_status: 'none' });
        }
      },
      model: m, settings: { values: {} }
    });
    await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('M') }]);
    a.eq(m.loadedAssignments.has('50'), true);
    a.eq(forms[0]['submission[late_policy_status]'], 'none', 'the second M removed the explicit status');
  });

  test('CLEAR_MISSING is a no-op once the explicit status is already gone', async () => {
    stubUi();
    let sent = 0;
    const m = model();
    m.loadedAssignments.add('50');
    m.patchCell('50', '10', { latePolicyStatus: null, missing: false }, { silent: true });
    const w = new CGP.GradeWriter({ api: { updateSubmission: () => { sent++; return Promise.resolve({}); } }, model: m, settings: { values: {} } });
    await w.apply([{ assignmentId: '50', userId: '10', parsed: { kind: CGP.gradeOps.KIND.CLEAR_MISSING } }]);
    a.eq(sent, 0);
    a.eq(m._writesInFlight.size, 0, 'no write left marked in flight');
  });

  test('a write that finishes leaves no in-flight mark behind', async () => {
    stubUi();
    const m = model();
    m.loadedAssignments.add('50');
    const w = new CGP.GradeWriter({
      api: { updateSubmission: () => Promise.resolve({ id: '1', assignment_id: '50', user_id: '10', grade: '5', score: 5 }) },
      model: m, settings: { values: {} }
    });
    await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('5') }]);
    a.eq(m._writesInFlight.size, 0);
  });
});

suite('write safety: bulk paste', (test) => {
  function controller(overrides) {
    const m = model();
    m.loadedAssignments.add('50');
    let applied = null;
    const ctrl = new CGP.BulkPasteController(Object.assign({
      adapter: {
        ensureRowsMapped: () => Promise.resolve(true),
        ensureColumnsMapped: () => Promise.resolve(true),
        studentAt: (r) => (r === 0 ? '10' : null),
        columnAt: () => ({ type: 'assignment', assignmentId: '50' }),
        gridRoot: () => null
      },
      model: m,
      writer: {
        targetsFromTokens: (list) => new CGP.GradeWriter({ api: {}, model: m, settings: { values: {} } }).targetsFromTokens(list),
        apply: (targets) => { applied = targets; return Promise.resolve({ ok: targets.length }); }
      },
      selection: { anchor: null },
      settings: { values: { bulkPaste: true, bulkConfirmThreshold: 25 } }
    }, overrides || {}));
    return { ctrl, m, applied: () => applied };
  }

  test('a paste is refused when its rows cannot be confirmed live', async () => {
    stubUi();
    const h = controller();
    h.ctrl.adapter.ensureRowsMapped = () => Promise.resolve(false);
    await h.ctrl.run(CGP.clipboardMatrix.parse('5'), { rowIndex: 0, colIndex: 1 });
    a.eq(h.applied(), null);
    a.ok(/confirm which student/i.test(said[said.length - 1].text));
  });

  test('M never counts as overwriting the grade already in a cell', () => {
    const h = controller();
    h.m.patchCell('50', '10', { grade: '7', score: 7 }, { silent: true });
    const n = h.ctrl.countOverwrites([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('M') }]);
    a.eq(n, 0);
    const n2 = h.ctrl.countOverwrites([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('9') }]);
    a.eq(n2, 1);
    const same = h.ctrl.countOverwrites([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('7.0') }]);
    a.eq(same, 0, '7.0 over 7 is not a change');
  });
});

suite('write safety: keyboard', (test) => {
  const { loadGradebookDom } = require('./domharness');

  function kb(adapterOverrides, extra) {
    const G = loadGradebookDom();
    const applied = [];
    const ctrl = new G.KeyboardGradingController(Object.assign({
      adapter: Object.assign({
        cellInfo: () => ({ columnType: 'assignment', assignmentId: '50', studentId: '10', el: {} }),
        activeCellInfo: () => null,
        isEditableGradeCell: () => true,
        editorInput: () => null
      }, adapterOverrides || {}),
      model: { assignment: () => ({ gradingType: 'points' }) },
      writer: {
        targetsFromTokens: (list) => ({ targets: list.map((t) => Object.assign({ parsed: CGP.gradeOps.parseToken(t.token) }, t)), invalid: [] }),
        apply: (t) => { applied.push(t); return Promise.resolve({}); }
      },
      selection: { size: () => 0, targets: () => [] },
      settings: { values: { enableM: true, enableL: true, enableE: true, bulkConfirmThreshold: 25, spreadsheetNavigation: true } },
      requestPaint: () => {}
    }, extra || {}));
    return { ctrl, applied };
  }

  function keyEvent(key, repeat) {
    const target = { closest: (sel) => (sel === '.slick-cell' ? {} : null), tagName: 'DIV', getAttribute: () => null };
    return {
      key, repeat: !!repeat, target, defaultPrevented: false,
      metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}
    };
  }

  test('a held-down L does not toggle Late on and off repeatedly', () => {
    const { ctrl, applied } = kb();
    ctrl.onKeyDown(keyEvent('l'));
    const repeat = keyEvent('l', true);
    ctrl.onKeyDown(repeat);
    ctrl.onKeyDown(keyEvent('l', true));
    a.eq(applied.length, 1, 'only the first press writes');
    a.eq(repeat.defaultPrevented, true, 'the repeats still never reach Canvas');
  });

  test('moving left onto a non-assignment column keeps going left', async () => {
    const cols = { 3: { type: 'assignment' }, 4: { type: 'group' }, 5: { type: 'assignment' } };
    let activated = null;
    const { ctrl } = kb({
      columnAt: (i) => cols[i] || null,
      scrollRowIntoView: () => {},
      scrollColumnIntoView: () => {},
      cellElementAt: (r, c) => ({ r, c }),
      activateCell: (el) => { activated = el; }
    });
    ctrl.focusCell(2, 4, -1);
    await new Promise((r) => setTimeout(r, 80));
    a.eq(activated && activated.c, 3, 'stepped over the group column to the left');
  });
});

suite('write safety: integration review fixes', (test) => {
  test('a column re-read keeps the overlay on a cell this extension wrote to', () => {
    const m = model();
    m.patchCell('50', '10', { grade: '85', override: '85' }, { silent: true });
    m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', grade: '85', score: 85, late_policy_status: 'late' });
    a.eq(m.cell('50', '10').override, '85', 'Canvas’s grid never saw our write, so the overlay stays');
    m.applySubmission({ id: '1', assignment_id: '50', user_id: '10', excused: true, grade: null });
    a.eq(m.cell('50', '10').override, 'EX', 're-derived from fresh data, not frozen');
    const fresh = model();
    fresh.applySubmission({ id: '2', assignment_id: '50', user_id: '10', grade: '70', score: 70 });
    a.eq(fresh.cell('50', '10').override, null, 'cells we never wrote get no overlay');
  });

  test('a truncated read releases the column so it can be read again', async () => {
    let calls = 0;
    const m = model({
      api: {
        submissionsForAssignments: () => {
          calls++;
          const list = [];
          if (calls === 1) list.truncated = true;
          return Promise.resolve(list);
        },
        submissionsForAssignment: () => { const l = []; l.truncated = true; return Promise.resolve(l); }
      }
    });
    await m.ensureAssignments(['50']);
    a.eq(m.pendingAssignments.has('50'), false, 'not stuck pending');
    await m.ensureAssignments(['50']);
    a.eq(calls, 2, 'a second read actually went out');
    a.eq(m.loadedAssignments.has('50'), true);
    await m.verifyVisibleComments(['50']);
    a.eq(m.commentVerifiedAssignments.has('50'), false, 'a truncated verification is not "verified"');
  });

  test('a write to a column that could not be loaded is refused, not guessed', async () => {
    stubUi();
    let sent = 0;
    const m = model({ api: { submissionsForAssignments: () => Promise.reject(Object.assign(new Error('x'), { status: 500 })) } });
    const w = new CGP.GradeWriter({ api: { updateSubmission: () => { sent++; return Promise.resolve({}); } }, model: m, settings: { values: {} } });
    const res = await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('M') }]);
    a.eq(sent, 0);
    a.eq(res.unloaded, 1);
    a.ok(/did not send that column/i.test(said[said.length - 1].text));
  });

  test('a test-student row inside a paste is named, not reported as unresolved', () => {
    const mapped = CGP.gridMap.mapMatrixToTargets(CGP.clipboardMatrix.parse('5\n6\n7'), { rowIndex: 0, colIndex: 1 }, {
      studentAt: (r) => (r === 1 ? null : 's' + r),
      columnAt: () => ({ type: 'assignment', assignmentId: '50' }),
      isTestStudentRow: (r) => r === 1
    });
    a.eq(mapped.errors.length, 1);
    a.eq(mapped.errors[0].code, 'test-student');
    const range = CGP.gridMap.rangeTargets({ rowIndex: 0, colIndex: 1 }, { rowIndex: 2, colIndex: 1 }, {
      studentAt: (r) => (r === 1 ? null : 's' + r),
      columnAt: () => ({ type: 'assignment', assignmentId: '50' })
    });
    a.deep(range.map((t) => t.userId), ['s0', 's2'], 'a range simply skips it');
  });
});

suite('write safety: typed-grade follow-up never undoes a newer decision', (test) => {
  const { loadGradebookDom, domshim } = require('./domharness');

  function harness(beforeRec, refreshed, opts) {
    const G = loadGradebookDom();
    domshim.install();
    const applied = [];
    const marks = new Map();
    const fakeModel = {
      ready: true,
      key: (a2, u) => a2 + ':' + u,
      _writeStartedAt: marks,
      cell: () => beforeRec,
      queueTotalRefresh: () => {},
      refreshCell: () => Promise.resolve(refreshed)
    };
    const ctrl = new G.KeyboardGradingController({
      adapter: { cellInfo: () => ({ columnType: 'assignment', assignmentId: '50', studentId: '10' }), activeCellInfo: () => null },
      model: fakeModel,
      writer: { apply: (t) => { applied.push(t); return Promise.resolve({}); } },
      selection: { size: () => 0, targets: () => [] },
      settings: { values: {} },
      requestPaint: () => {}
    });
    const F = domshim.FakeElement;
    const cell = new F('div'); cell.classList.add('slick-cell');
    globalThis.document.body.appendChild(cell);
    const input = new F('input'); input.setAttribute('type', 'text'); input.value = '';
    cell.appendChild(input);
    ctrl.onFocusIn({ target: input });
    input.value = '9';
    ctrl.onFocusOut({ target: input });
    if (opts && opts.thenMarkedAt) marks.set('50:10', Date.now() + 10);
    return applied;
  }

  test('an M pressed after the edit is not undone by the follow-up', async () => {
    const applied = harness({ grade: null, enteredScore: null, gradedAt: null, latePolicyStatus: null },
      { grade: '9', enteredScore: 9, gradedAt: 't1', latePolicyStatus: 'missing' }, { thenMarkedAt: true });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(applied.length, 0);
  });

  test('Missing that was not on the cell when the grade was typed is left alone', async () => {
    const applied = harness({ grade: null, enteredScore: null, gradedAt: null, latePolicyStatus: null },
      { grade: '9', enteredScore: 9, gradedAt: 't1', latePolicyStatus: 'missing' });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(applied.length, 0);
  });

  test('a column with no record before the edit is re-read but never acted on', async () => {
    const applied = harness(null, { grade: '9', enteredScore: 9, gradedAt: 't1', latePolicyStatus: 'missing' });
    await new Promise((r) => setTimeout(r, 1300));
    a.eq(applied.length, 0);
  });
});

suite('write safety: selection gestures', (test) => {
  const { loadGradebookDom } = require('./domharness');
  test('a newer click discards a Shift-click range still waiting on its rows', async () => {
    const G = loadGradebookDom();
    let release;
    const sel = new G.SelectionController({
      adapter: {
        ensureRowsMapped: () => new Promise((r) => { release = r; }),
        studentAt: (r) => 's' + r,
        columnAt: () => ({ type: 'assignment', assignmentId: '50' })
      },
      model: {}, settings: { values: { multiCellSelection: true } }, requestPaint: () => {}
    });
    sel.anchor = { rowIndex: 0, colIndex: 1 };
    const pending = sel.extendTo({ rowIndex: 40, colIndex: 1 });
    sel.toggle({ columnType: 'assignment', assignmentId: '50', studentId: 's3', rowIndex: 3, colIndex: 1 });
    release(true);
    const applied = await pending;
    a.eq(applied, false, 'the stale range was dropped');
    a.eq(sel.size(), 1, 'the newer Cmd-click selection stands');
  });
});

suite('write safety: editing after a bulk entry', (test) => {
  const { loadGradebookDom, domshim } = require('./domharness');

  function setup(rec) {
    const G = loadGradebookDom();
    domshim.install();
    stubUi();
    const F = domshim.FakeElement;
    const cell = new F('div'); cell.classList.add('slick-cell');
    globalThis.document.body.appendChild(cell);
    const input = new F('input'); input.setAttribute('type', 'text');
    input.select = () => {};
    cell.appendChild(input);
    const applied = [];
    const patches = [];
    const info = { columnType: 'assignment', assignmentId: '50', studentId: '10', el: cell, rowIndex: 0, colIndex: 1 };
    const kb = new G.KeyboardGradingController({
      adapter: {
        cellInfo: () => info,
        activeCellInfo: () => info,
        activeCellEl: () => cell,
        editorInput: () => input,
        setEditorValue: (el, v) => { el.value = v; },
        sendKey: () => {},
        isEditableGradeCell: () => true
      },
      model: {
        ready: true,
        cell: () => rec,
        assignment: () => ({ gradingType: 'points' }),
        patchCell: (a2, u, p) => { patches.push(p); Object.assign(rec, p); },
        queueTotalRefresh: () => {},
        refreshCell: () => Promise.resolve(null)
      },
      writer: {
        targetsFromTokens: (list) => ({ targets: list.map((t) => Object.assign({ parsed: CGP.gradeOps.parseToken(t.token) }, t)), invalid: [] }),
        apply: (t) => { applied.push(t); return Promise.resolve({ ok: t.length }); }
      },
      selection: { size: () => 0, targets: () => [], pending: '', setPending() {} },
      settings: { values: { bulkConfirmThreshold: 25 } },
      requestPaint: () => {}
    });
    return { kb, input, applied, patches, rec };
  }

  test('the editor opens with the grade Canvas really has, not its stale grid value', () => {
    const h = setup({ grade: '8', override: '8' });
    h.input.value = '9';                    // Canvas's grid still holds the pre-bulk 9
    h.kb.onFocusIn({ target: h.input });
    a.eq(h.input.value, '8', 'shows the bulk-entered 8');
  });

  test('changing a bulk 8 back to the old 9 is saved (Canvas would skip it as "unchanged")', async () => {
    const h = setup({ grade: '8', override: '8' });
    h.input.value = '9';
    h.kb.onFocusIn({ target: h.input });
    h.input.value = '9';
    h.kb.onFocusOut({ target: h.input });
    a.eq(h.applied.length, 1, 'written through GradeWriter');
    a.eq(h.applied[0][0].parsed.value, 9);
  });

  test('a new value Canvas itself will save is left to Canvas, and shown at once', () => {
    const h = setup({ grade: '8', override: '8' });
    h.input.value = '';
    h.kb.onFocusIn({ target: h.input });
    h.input.value = '7';
    h.kb.onFocusOut({ target: h.input });
    a.eq(h.applied.length, 0, 'no second write of the same grade');
    a.eq(h.rec.override, '7', 'the cell shows the new grade immediately');
  });

  test('Escape abandons the edit: nothing is written or shown', () => {
    const h = setup({ grade: '8', override: '8' });
    h.input.value = '9';
    h.kb.onFocusIn({ target: h.input });
    h.input.value = '9';
    h.kb.onKeyDown({ key: 'Escape', target: h.input, isTrusted: true, defaultPrevented: false });
    h.kb.onFocusOut({ target: h.input });
    a.eq(h.applied.length, 0);
    a.eq(h.rec.override, '8');
  });

  test('bulk Enter closes Canvas’s editor on the Shift-clicked end cell and applies once', () => {
    const G = loadGradebookDom();
    const sent = [];
    const applied = [];
    let pending = '85';
    const cell = { id: 'last' };
    const input = { value: '', blur() {} };
    const info = { columnType: 'assignment', assignmentId: '50', studentId: '12', el: cell };
    const kb = new G.KeyboardGradingController({
      adapter: {
        cellInfo: () => info,
        activeCellInfo: () => info,
        activeCellEl: () => cell,
        editorInput: (el) => (el === cell ? input : null),
        setEditorValue: (el, v) => { el.value = v; },
        sendKey: (el, k) => { sent.push(k); kb.onKeyDown({ key: k, target: el, isTrusted: false }); }
      },
      model: { assignment: () => ({ gradingType: 'points' }) },
      writer: {
        targetsFromTokens: (list) => ({ targets: list.map((t) => Object.assign({ parsed: CGP.gradeOps.parseToken(t.token) }, t)), invalid: [] }),
        apply: (t) => { applied.push(t); return Promise.resolve({}); }
      },
      selection: {
        size: () => 3,
        targets: () => [{ assignmentId: '50', userId: '10' }, { assignmentId: '50', userId: '11' }, { assignmentId: '50', userId: '12' }],
        get pending() { return pending; },
        setPending(v) { pending = v; },
        changedAt: 0
      },
      settings: { values: { bulkConfirmThreshold: 25 } },
      requestPaint: () => {}
    });
    const enter = {
      key: 'Enter', target: input, isTrusted: true, defaultPrevented: false,
      metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
      preventDefault() {}, stopImmediatePropagation() {}, closest: () => null
    };
    input.closest = (sel) => (sel === '.slick-cell' ? cell : null);
    kb.onKeyDown(enter);
    a.deep(sent, ['Enter'], 'Canvas’s editor in the end cell was closed without writing');
    a.eq(applied.length, 1, 'applied exactly once (the synthetic Enter is not a second bulk entry)');
    a.eq(applied[0].length, 3, 'all three cells, the last one included');
  });

  test('the saved grade stays visible on Canvas’s active (selected, not editing) cell', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'gradebook.css'), 'utf8');
    a.ok(!/\.slick-cell\.active\s*>\s*\.cgp-val/.test(css), 'no rule hides the overlay just because the cell is active');
  });
});

suite('write safety: PR review round 2', (test) => {
  test('a column whose latest re-read failed is not written from its older record', async () => {
    stubUi();
    let sent = 0;
    const m = model({ api: { submissionsForAssignments: () => Promise.reject(Object.assign(new Error('x'), { status: 500 })) } });
    m.everLoadedAssignments.add('50');           // loaded once, earlier
    m.patchCell('50', '10', { latePolicyStatus: 'missing', missing: true }, { silent: true });
    const w = new CGP.GradeWriter({ api: { updateSubmission: () => { sent++; return Promise.resolve({}); } }, model: m, settings: { values: {} } });
    const res = await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('M') }]);
    a.eq(sent, 0, 'no toggle decided from the stale record');
    a.eq(res.unloaded, 1);
  });

  function throttledApi(retryAfterSecs, sleeps) {
    const calls = [];
    const api = new CGP.CanvasApi({
      origin: 'https://x.instructure.com',
      fetch: () => {
        calls.push(1);
        const first = calls.length === 1;
        return Promise.resolve({
          ok: !first, status: first ? 429 : 200,
          text: () => Promise.resolve(first ? '' : '{}'),
          headers: { get: (h) => (first && h === 'Retry-After' ? String(retryAfterSecs) : null) }
        });
      }
    });
    return { api, calls };
  }

  test('Retry-After longer than 10s is honoured in full, not cut short', async () => {
    const sleeps = [];
    const real = CGP.util.sleep;
    CGP.util.sleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };
    try {
      const { api, calls } = throttledApi(20, sleeps);
      await api.updateSubmission('7', '50', '10', {});
      a.eq(calls.length, 2);
      a.eq(sleeps[0], 20000, 'waited the full 20 seconds Canvas asked for');
    } finally { CGP.util.sleep = real; }
  });

  test('a Retry-After too long to wait out fails at once and says how long to wait', async () => {
    const sleeps = [];
    const real = CGP.util.sleep;
    CGP.util.sleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };
    try {
      const { api, calls } = throttledApi(90, sleeps);
      const err = await api.updateSubmission('7', '50', '10', {}).catch((e) => e);
      a.eq(calls.length, 1, 'no early retry that would only be throttled again');
      a.eq(sleeps.length, 0);
      a.ok(/about 90 seconds/.test(CGP.util.describeApiError(err)), CGP.util.describeApiError(err));
    } finally { CGP.util.sleep = real; }
  });
});

suite('write safety: lifting an explicit Missing keeps work that came in late', (test) => {
  const ops = () => CGP.gradeOps;
  const due = '2026-10-08T12:55:00Z';
  const lateRec = (over) => Object.assign({ submittedAt: '2026-10-13T20:39:00Z', latePolicyStatus: 'missing', missing: true, late: false }, over || {});

  test('handedInLate judges from submission time, not from the Missing-overridden flags', () => {
    a.eq(ops().handedInLate(lateRec(), { dueAt: due }), true, 'submitted five days after the due date');
    a.eq(ops().handedInLate(lateRec({ submittedAt: '2026-10-08T08:00:00Z' }), { dueAt: due }), false, 'on time');
    a.eq(ops().handedInLate(lateRec({ submittedAt: null }), { dueAt: due }), false, 'nothing handed in is never late');
    a.eq(ops().handedInLate(lateRec(), { dueAt: null }), false, 'no due date, nothing to be late against');
    a.eq(ops().handedInLate(null, { dueAt: due }), false);
  });

  test('with per-student due dates only the submission\'s own due date counts', () => {
    const multi = { dueAt: due, hasMultipleDueDates: true };
    a.eq(ops().handedInLate(lateRec(), multi), false, 'the assignment-level date proves nothing here');
    a.eq(ops().handedInLate(lateRec({ cachedDueDate: '2026-10-20T00:00:00Z' }), multi), false, 'on time for their own date');
    a.eq(ops().handedInLate(lateRec({ cachedDueDate: due }), multi), true, 'late for their own date');
    a.eq(ops().handedInLate(lateRec({ secondsLate: 3600 }), multi), true, 'Canvas says so directly');
  });

  test('grading a Missing cell that was handed in late keeps Late; otherwise still clears to none', () => {
    const late = ops().operationFor(ops().parseToken('7'), { wasExplicitMissing: true, handedInLate: true });
    a.eq(late.form['submission[late_policy_status]'], 'late');
    a.eq(late.patch.latePolicyStatus, 'late');
    const notLate = ops().operationFor(ops().parseToken('7'), { wasExplicitMissing: true, handedInLate: false });
    a.eq(notLate.form['submission[late_policy_status]'], 'none');
    const pct = ops().operationFor(ops().parseToken('80%'), { wasExplicitMissing: true, handedInLate: true });
    a.eq(pct.form['submission[late_policy_status]'], 'late');
  });

  test('CLEAR_MISSING after Canvas saves a grade restores Late for late work, and only then', () => {
    const KIND = ops().KIND;
    const late = ops().operationFor({ kind: KIND.CLEAR_MISSING }, { handedInLate: true });
    a.eq(late.form['submission[late_policy_status]'], 'late');
    a.eq(late.patch.late, true);
    a.eq(late.patch.missing, false);
    const plain = ops().operationFor({ kind: KIND.CLEAR_MISSING }, {});
    a.eq(plain.form['submission[late_policy_status]'], 'none');
    a.eq(plain.patch.latePolicyStatus, null);
  });

  test('end to end: the writer sends Late for a late submission whose Missing is lifted after grading', async () => {
    stubUi();
    const forms = [];
    const m = model();
    m.assignments.set('50', { id: '50', name: 'HW', gradingType: 'points', dueAt: due });
    m.loadedAssignments.add('50');
    m.patchCell('50', '10', { latePolicyStatus: 'missing', missing: true, submittedAt: '2026-10-13T20:39:00Z', score: 3, grade: '3' }, { silent: true });
    const w = new CGP.GradeWriter({
      api: { updateSubmission: (c, aid, uid, form) => { forms.push(form); return Promise.resolve({ id: '1', assignment_id: '50', user_id: '10', late_policy_status: 'late', submitted_at: '2026-10-13T20:39:00Z', score: 3, grade: '3' }); } },
      model: m, settings: { values: {} }
    });
    await w.apply([{ assignmentId: '50', userId: '10', parsed: { kind: CGP.gradeOps.KIND.CLEAR_MISSING } }]);
    a.eq(forms.length, 1);
    a.eq(forms[0]['submission[late_policy_status]'], 'late');
  });

  test('end to end: typing a grade through the writer on that cell also keeps Late', async () => {
    stubUi();
    const forms = [];
    const m = model();
    m.assignments.set('50', { id: '50', name: 'HW', gradingType: 'points', dueAt: due });
    m.loadedAssignments.add('50');
    m.patchCell('50', '10', { latePolicyStatus: 'missing', missing: true, submittedAt: '2026-10-13T20:39:00Z' }, { silent: true });
    const w = new CGP.GradeWriter({
      api: { updateSubmission: (c, aid, uid, form) => { forms.push(form); return Promise.resolve({ id: '1', assignment_id: '50', user_id: '10', late_policy_status: 'late', submitted_at: '2026-10-13T20:39:00Z', score: 3, grade: '3' }); } },
      model: m, settings: { values: {} }
    });
    await w.apply([{ assignmentId: '50', userId: '10', parsed: CGP.gradeOps.parseToken('3') }]);
    a.eq(forms[0]['submission[late_policy_status]'], 'late');
    a.eq(forms[0]['submission[posted_grade]'], '3');
  });
});
