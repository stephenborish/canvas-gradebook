/* The paste's overwrite question is asked from verified ids and the grades
 * Canvas holds now.
 *
 * The bug this pins down: two students each have a 9; the teacher pastes an
 * 8 into both cells. The paste's own column read failed, so the overwrite
 * count read "nothing there" and no question was asked; the writer then read
 * the column itself, succeeded, and replaced both 9s - zero confirmations,
 * two overwrites. Everything here runs the real BulkPasteController,
 * GradeWriter and GradebookModel against a fake Canvas, and counts both the
 * questions asked and the writes sent. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

['src/gradebook/writer.js', 'src/gradebook/bulk-paste.js'].forEach((rel) => {
  if (rel.endsWith('writer.js') && CGP.GradeWriter) return;
  if (rel.endsWith('bulk-paste.js') && CGP.BulkPasteController) return;
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
});

const said = [];
function stubUi() {
  said.length = 0;
  CGP.ui = { toast: (m) => said.push({ level: 'info', text: String(m) }), error: (m) => said.push({ level: 'error', text: String(m) }) };
}
const last = () => said[said.length - 1];

const NINE = (uid, aid = '50') => ({ id: 's' + uid + aid, assignment_id: aid, user_id: uid, grade: '9', score: 9, entered_grade: '9', workflow_state: 'graded' });

/* reads: what each successive column read answers - an array of
 * submissions, or 'fail'. answer: what window.confirm returns. */
function harness({ reads = [], answer = true, students = ['10', '11'], columns = { 3: '50' }, assignments, loaded = [], rowsOk = true, colsOk = true } = {}) {
  stubUi();
  const log = { reads: 0, readIds: [], writes: [], confirms: [] };
  const api = {
    submissionsForAssignments: (course, ids) => {
      log.reads++;
      log.readIds.push(ids.slice());
      const next = reads.length ? reads.shift() : 'fail';
      if (next === 'fail') return Promise.reject(Object.assign(new Error('Canvas 502'), { status: 502 }));
      return Promise.resolve(next.filter((s) => ids.indexOf(String(s.assignment_id)) >= 0));
    },
    updateSubmission: (course, aid, uid, form) => {
      log.writes.push({ assignmentId: aid, userId: uid, grade: form['submission[posted_grade]'] });
      const g = form['submission[posted_grade]'];
      const prior = m.cell(aid, uid) || {};
      const status = Object.prototype.hasOwnProperty.call(form, 'submission[late_policy_status]') ? form['submission[late_policy_status]'] : (prior.latePolicyStatus || null);
      const grade = g === undefined ? (prior.grade === undefined ? null : prior.grade) : g;
      return Promise.resolve({ id: 'w', assignment_id: aid, user_id: uid, grade, score: grade === null ? null : Number(grade), entered_grade: grade,
        late_policy_status: status, missing: status === 'missing', workflow_state: 'graded' });
    }
  };
  const m = new CGP.GradebookModel(api, '7');
  m.ready = true;
  m.instructorId = '1';
  (assignments || [{ id: '50', name: 'Lab 4' }]).forEach((asg) => m.assignments.set(asg.id, Object.assign({ gradingType: 'points' }, asg)));
  ['10', '11', '12'].forEach((u) => { m.students.set(u, { id: u, name: 'Student ' + u }); m.studentOrder.push(u); });
  loaded.forEach(({ id, subs }) => { subs.forEach((s) => m.applySubmission(s)); m.loadedAssignments.add(id); });
  const writer = new CGP.GradeWriter({ api, model: m, settings: { values: {} } });
  const ctrl = new CGP.BulkPasteController({
    adapter: {
      ensureRowsMapped: () => Promise.resolve(rowsOk),
      ensureColumnsMapped: () => Promise.resolve(colsOk),
      studentAt: (r) => (r < students.length ? students[r] : null),
      columnAt: (c) => (columns[c] ? { type: 'assignment', assignmentId: columns[c] } : null),
      isTestStudentIndex: () => false,
      gridRoot: () => null
    },
    model: m, writer,
    selection: { anchor: null },
    settings: { values: { bulkPaste: true, bulkConfirmThreshold: 25 } }
  });
  const paste = async (text, anchor = { rowIndex: 0, colIndex: 3 }) => {
    const prev = globalThis.window;
    globalThis.window = { confirm: (msg) => { log.confirms.push(msg); return answer; } };
    try { await ctrl.run(CGP.clipboardMatrix.parse(text), anchor); } finally { globalThis.window = prev; }
  };
  return { m, writer, ctrl, log, paste };
}

suite('paste: the overwrite question comes before the first write', (test) => {
  test('first column read fails, retry finds two 9s: the question shows 2 overwrites; Cancel sends zero writes', async () => {
    const h = harness({ reads: ['fail', [NINE('10'), NINE('11')]], answer: false });
    await h.paste('8\n8\n');
    a.eq(h.log.reads, 2, 'the failed read was retried before deciding');
    a.eq(h.log.confirms.length, 1, 'the teacher was asked');
    a.ok(/2 cell\(s\) already have a different grade and will be replaced/.test(h.log.confirms[0]), h.log.confirms[0]);
    a.eq(h.log.writes.length, 0, 'Cancel sends zero writes');
    a.eq(h.m.cell('50', '10').grade, '9');
    a.eq(h.m.cell('50', '11').grade, '9');
  });

  test('accepting the two-cell overwrite sends exactly two writes, to the intended students', async () => {
    const h = harness({ reads: ['fail', [NINE('10'), NINE('11')]], answer: true });
    await h.paste('8\n8\n');
    a.eq(h.log.confirms.length, 1);
    a.deep(h.log.writes, [
      { assignmentId: '50', userId: '10', grade: '8' },
      { assignmentId: '50', userId: '11', grade: '8' }
    ], 'exactly two writes, one per intended student');
    a.eq(h.log.reads, 2, 'the writer did not need a read of its own');
  });

  test('both reads fail: the paste stops before the question, zero writes, and says what to do', async () => {
    const h = harness({ reads: ['fail', 'fail'] });
    await h.paste('8\n8\n');
    a.eq(h.log.reads, 2);
    a.eq(h.log.confirms.length, 0);
    a.eq(h.log.writes.length, 0);
    a.ok(/^Paste stopped: Canvas didn’t send the current grades for “Lab 4”/.test(last().text), last().text);
    a.ok(/Nothing was changed/.test(last().text) && /paste again/.test(last().text));
  });

  test('a grade that changes after the teacher confirmed is left alone, not replaced unasked', async () => {
    const h = harness({ reads: [[NINE('10'), NINE('11')]], answer: true });
    const prev = globalThis.window;
    // The confirm dialog is up while another tab saves a 7 for student 11.
    globalThis.window = { confirm: () => { h.m.applySubmission(Object.assign(NINE('11'), { grade: '7', score: 7, entered_grade: '7' })); return true; } };
    try { await h.ctrl.run(CGP.clipboardMatrix.parse('8\n8\n'), { rowIndex: 0, colIndex: 3 }); } finally { globalThis.window = prev; }
    a.deep(h.log.writes.map((w) => w.userId), ['10'], 'only the cell the teacher was asked about');
    a.ok(/1 cell was left unchanged because its grade changed in Canvas after you confirmed/.test(last().text), last().text);
  });
});

suite('paste: an unverified target range sends nothing', (test) => {
  test('an unresolved row sends zero writes', async () => {
    const h = harness({ reads: [[NINE('10'), NINE('11')]], students: ['10'] });
    await h.paste('8\n8\n');
    a.eq(h.log.writes.length, 0);
    a.eq(h.log.confirms.length, 0);
    a.ok(/could not be matched to a student and assignment/.test(last().text), last().text);
  });

  test('an unresolved column sends zero writes', async () => {
    const h = harness({ reads: [[NINE('10'), NINE('11')]], columns: { 3: '50' } });
    await h.paste('8\t8\n8\t8\n');
    a.eq(h.log.writes.length, 0);
    a.eq(h.log.confirms.length, 0);
  });

  test('columns the grid could not map stop the paste with a next step, zero writes', async () => {
    const h = harness({ columns: { 3: '50', 4: '50' }, colsOk: false });
    await h.paste('8\t8\n');
    a.eq(h.log.writes.length, 0);
    a.ok(/couldn’t confirm which assignment every pasted column belongs to/.test(last().text) && /paste again/.test(last().text), last().text);
  });

  test('rows the grid could not confirm stop the paste, zero writes', async () => {
    const h = harness({ rowsOk: false });
    await h.paste('8\n8\n');
    a.eq(h.log.writes.length, 0);
    a.eq(h.log.reads, 0, 'stopped before any read');
  });

  test('a row id the course does not have (a stale DOM row) sends zero writes', async () => {
    const h = harness({ students: ['10', '99'] });
    await h.paste('8\n8\n');
    a.eq(h.log.writes.length, 0);
    a.ok(/could not be matched to a student and assignment in this course/.test(last().text), last().text);
  });
});

suite('paste: ordinary behaviour is kept', (test) => {
  test('a single cell into a loaded column: no read, no question, one write', async () => {
    const h = harness({ loaded: [{ id: '50', subs: [NINE('10')] }] });
    await h.paste('8');
    a.eq(h.log.reads, 0, 'stays fast: nothing re-read');
    a.eq(h.log.confirms.length, 0);
    a.deep(h.log.writes, [{ assignmentId: '50', userId: '10', grade: '8' }]);
  });

  test('blanks are skipped and M never counts as an overwrite', async () => {
    const h = harness({ loaded: [{ id: '50', subs: [NINE('10'), NINE('11'), NINE('12')] }], students: ['10', '11', '12'] });
    await h.paste('\nM\n9\n');
    a.eq(h.log.confirms.length, 0, '9 over 9 and M replace no grade');
    a.eq(h.log.writes.length, 2, 'the M and the 9 - the blank sends nothing');
    a.deep(h.log.writes.map((w) => w.userId), ['11', '12']);
  });

  test('a protected (moderated) column is not waited on for the question, never written, and reported as skipped', async () => {
    const h = harness({
      assignments: [{ id: '50', name: 'Lab 4' }, { id: '60', name: 'Essay', moderated: true }],
      columns: { 3: '50', 4: '60' },
      // The paste's read of Lab 4, then the writer's own (unchanged) read of
      // the moderated column before it skips those cells.
      reads: [[NINE('10'), NINE('11')], []]
    });
    await h.paste('8\t8\n8\t8\n');
    a.deep(h.log.readIds[0], ['50'], 'the paste read only the writable column before asking');
    a.eq(h.log.confirms.length, 1);
    a.ok(/2 cell\(s\)/.test(h.log.confirms[0]), 'the protected cells are not counted as overwrites: ' + h.log.confirms[0]);
    a.deep(h.log.writes.map((w) => w.assignmentId + ':' + w.userId), ['50:10', '50:11']);
    a.ok(/2 cells were skipped \(an anonymous or moderated assignment/.test(last().text), last().text);
  });
});

suite('model: ensureAssignmentsLoaded', (test) => {
  test('names what is loaded and missing, and reads loaded columns not at all', async () => {
    const h = harness({ reads: ['fail', 'fail'] });
    const none = await h.m.ensureAssignmentsLoaded(['50']);
    a.deep(none, { loaded: [], missing: ['50'] });
    a.eq(h.log.reads, 2, 'one read and one retry');
    h.m.loadedAssignments.add('50');
    const done = await h.m.ensureAssignmentsLoaded(['50', '50']);
    a.deep(done, { loaded: ['50'], missing: [] });
    a.eq(h.log.reads, 2, 'no request for a column already loaded');
  });
});
