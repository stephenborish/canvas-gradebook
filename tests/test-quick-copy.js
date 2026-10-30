'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { suite, assert: a } = require('./harness');

suite('saved assignment quick copy', test => {
  function controller(info = {}) {
    if (!CGP.SectionCopyController) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/sections/sync-dialog.js'), 'utf8'));
    const c = Object.create(CGP.SectionCopyController.prototype);
    c.courseId = '1';
    c.courseName = id => 'Block ' + id;
    c.state = {
      quick: true, items: [{ type: 'assignment', id: '8', title: 'Lab', dates: { due_at: '2026-11-05T14:00:00Z', lock_at: '2026-11-06T14:00:00Z' } }],
      dests: ['2', '3'], courses: [], tz: 'UTC', cells: {}, seed: {}, include: {}, replace: {}, notes: {},
      publish: 'match', placeInModules: true,
      survey: { dests: ['2', '3'].map(courseId => ({ courseId, items: { 'assignment:8': Object.assign({ status: 'new' }, info) } })) }
    };
    c.seedCells();
    return c;
  }
  test('opening the compact view does not select every class or create copy tasks', () => {
    const c = controller();
    a.eq(c.buildTasks().tasks.length, 0);
    a.ok(c.renderMain().includes('Choose a destination class.'));
    a.not(c.renderMain().includes('What to copy'));
  });
  test('only the selected destination is copied and availability is retained', () => {
    const c = controller();
    c.state.include['assignment:8>2'] = true;
    const tasks = c.buildTasks().tasks;
    a.eq(tasks.length, 1);
    a.eq(tasks[0].destCourseId, '2');
    a.eq(tasks[0].dates.lock_at, '2026-11-06T14:00:00.000Z');
    a.ok(c.renderMain().includes('Availability dates'));
  });
  test('folded availability still blocks a due date after the closing date', () => {
    const c = controller();
    c.state.include['assignment:8>2'] = true;
    c.state.cells['assignment:8>2|assignment:8'].due_at = '2026-11-07T14:00';
    a.ok(c.buildTasks().errors.length);
    a.ok(c.renderMain().includes('<details open><summary>Availability dates'));
  });
  test('switching to more options preserves the chosen class and dates', () => {
    const c = controller();
    c.state.include['assignment:8>3'] = true;
    c.state.cells['assignment:8>3|assignment:8'].due_at = '2026-11-06T10:00';
    const before = c.buildTasks();
    c.render = () => {};
    c.onClick({ target: { closest: selector => selector === '[data-act]' ? { getAttribute: () => 'advanced-copy' } : null } });
    a.eq(c.state.quick, false);
    a.deep(c.buildTasks(), before);
  });
  test('a changed existing copy retains the normal keep-version protection', () => {
    const c = controller({ status: 'edited', destId: '88', note: 'Keep this note' });
    c.state.include['assignment:8>2'] = true;
    a.eq(c.buildTasks().tasks[0].mode, 'keep');
    a.eq(c.buildTasks().tasks[0].note, 'Keep this note');
    a.ok(c.renderMain().includes('Keep that class'));
  });
});
