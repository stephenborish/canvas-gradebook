'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { suite, assert: a } = require('./harness');

suite('copy dialog: one row per class', test => {
  function controller(info = {}, extra = {}) {
    if (!CGP.SectionCopyController) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/sections/sync-dialog.js'), 'utf8'));
    const c = Object.create(CGP.SectionCopyController.prototype);
    c.courseId = '1';
    c.courseName = id => 'Block ' + id;
    c.state = Object.assign({
      view: 'main', items: [{ type: 'assignment', id: '8', title: 'Lab', dates: { due_at: '2026-11-05T14:00:00Z', lock_at: '2026-11-06T14:00:00Z' } }],
      dests: ['2', '3'], courses: [], tz: 'UTC', cells: {}, seed: {}, include: {}, replace: {}, notes: {}, adjust: {},
      publish: 'match', placeInModules: true,
      survey: { dests: ['2', '3'].map(courseId => ({ courseId, items: { 'assignment:8': Object.assign({ status: 'new' }, info) } })) }
    }, extra);
    c.seedCells();
    c.render = () => {};
    return c;
  }
  function tick(c, d, on = true) {
    c.onChange({ target: { checked: on, hasAttribute: n => n === 'data-class', getAttribute: n => (n === 'data-class' ? d : null) } });
  }

  test('no class starts ticked, so nothing is copied until one is picked', () => {
    const c = controller();
    a.eq(c.buildTasks().tasks.length, 0);
    const html = c.renderMain();
    a.ok(html.includes('Choose a class'));
    a.ok(html.includes('Block 2') && html.includes('Not there yet'));
    a.not(html.includes('What to copy'));
  });

  test('ticking a class copies to that class only, with its dates (the other dates folded away)', () => {
    const c = controller();
    tick(c, '2');
    const tasks = c.buildTasks().tasks;
    a.eq(tasks.length, 1);
    a.eq(tasks[0].destCourseId, '2');
    a.eq(tasks[0].dates.lock_at, '2026-11-06T14:00:00.000Z');
    const html = c.renderMain();
    a.ok(html.includes('Copy to Block 2'));
    a.ok(html.includes('Adds it to Block 2.'));
    a.ok(html.includes('More dates'));
  });

  test('a due date after the closing date blocks the copy and opens the folded dates', () => {
    const c = controller();
    tick(c, '2');
    c.state.cells['assignment:8>2|assignment:8'].due_at = '2026-11-07T14:00';
    a.ok(c.buildTasks().errors.length);
    a.ok(c.renderMain().includes('<details class="cgp-sections__more" open>'));
  });

  test('opened for particular classes, those start ticked', () => {
    const c = controller({}, { tickDests: ['3'] });
    a.deep(c.buildTasks().tasks.map(t => t.destCourseId), ['3']);
  });

  test('a version edited there is kept by default (dates only), and the teacher can choose to replace it', () => {
    const c = controller({ status: 'edited', destId: '88', note: 'Keep this note', diffs: ['Points: 6 here, none there'] });
    tick(c, '2');
    a.eq(c.buildTasks().tasks[0].mode, 'keep');
    a.eq(c.buildTasks().tasks[0].note, 'Keep this note');
    let html = c.renderMain();
    a.ok(html.includes('Already there · edited there'));
    a.ok(html.includes('Keep theirs, change only the dates'));
    a.ok(html.includes('Points: 6 here, none there'));
    a.ok(html.includes('Update dates in Block 2'));
    c.state.replace['assignment:8>2'] = true;
    a.eq(c.buildTasks().tasks[0].mode, 'copy');
    html = c.renderMain();
    a.ok(html.includes('Replaces Block 2’s version.'));
  });

  test('a class whose item this one was copied from is updated in place, never copied back', () => {
    const c = controller({ status: 'stale', destId: '70', origin: { srcId: '70' } });
    tick(c, '2');
    const t = c.buildTasks().tasks[0];
    a.eq(t.origin, true);
    a.eq(t.mode, 'copy');
    a.eq(t.destId, '70');
    const html = c.renderMain();
    a.ok(html.includes('Already there · older version'));
    a.ok(html.includes('Updates its title, instructions and settings.'));
  });

  test('a class with its own same-titled item is not ticked along with the others', () => {
    const c = controller({}, {});
    c.state.items.push({ type: 'page', id: '9', title: 'Intro', dates: {} });
    c.state.survey.dests[0].items['page:9'] = { status: 'new', lookalike: { id: '5', title: 'Intro' } };
    c.state.survey.dests[1].items['page:9'] = { status: 'new' };
    c.seedCells();
    tick(c, '2');
    a.deep(c.buildTasks().tasks.map(t => t.item.id + '>' + t.destCourseId), ['8>2']);
    a.ok(c.renderMain().includes('Has its own “Intro”'));
  });
});
