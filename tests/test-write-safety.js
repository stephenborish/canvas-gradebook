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
