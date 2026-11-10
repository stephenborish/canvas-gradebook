/* Make groups (People page): names from a format, group counts, random
 * sorting, board changes, copies - and the requests the dialog sends. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { suite, assert: a } = require('./harness');

const GB = () => globalThis.CGP.groupBuilder;

/* A repeatable rng, so a "random" sort can be checked exactly. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

suite('make groups: names, counts and random sorting', test => {
  test('a template numbers, pads and letters the groups', () => {
    a.deep(GB().formatNames('Group {n}', 3), ['Group 1', 'Group 2', 'Group 3']);
    a.deep(GB().formatNames('Lab {nn}', 3), ['Lab 01', 'Lab 02', 'Lab 03']);
    a.eq(GB().formatNames('Lab {nn}', 120).length, 100, 'never more than 100 groups');
    a.eq(GB().formatNames('Lab {nn}', 100)[0], 'Lab 001', 'padded to the widest number');
    a.deep(GB().formatNames('Team {A}', 3), ['Team A', 'Team B', 'Team C']);
    a.eq(GB().formatNames('Team {A}', 28)[26], 'Team AA', 'after Z comes AA');
    a.deep(GB().formatNames('table-{a}', 2), ['table-a', 'table-b']);
    a.deep(GB().formatNames('{set} {n}', 2, { set: 'Lab Groups' }), ['Lab Groups 1', 'Lab Groups 2']);
  });

  test('a list of names is used in order, and starts again with a number when it runs out', () => {
    a.deep(GB().formatNames('Red, Blue, Green', 2), ['Red', 'Blue']);
    a.deep(GB().formatNames('Red, Blue', 5), ['Red', 'Blue', 'Red 2', 'Blue 2', 'Red 3']);
    a.deep(GB().formatNames('Red\nBlue\n\n', 2), ['Red', 'Blue'], 'one per line works too');
  });

  test('a format can never name two groups alike', () => {
    a.deep(GB().formatNames('Squad', 3), ['Squad 1', 'Squad 2', 'Squad 3'], 'plain text gets a number');
    a.deep(GB().formatNames('{set}', 3, { set: 'Lab' }), ['Lab', 'Lab 2', 'Lab 3'], 'a token that does not change still gives different names');
    a.deep(GB().formatNames('', 2), ['Group 1', 'Group 2']);
  });

  test('groups by number or by size, and the size range shown', () => {
    a.eq(GB().groupCount(26, 'count', 6), 6);
    a.eq(GB().groupCount(26, 'size', 4), 7, '26 students in 4s is 7 groups');
    a.eq(GB().groupCount(0, 'size', 4), 1, 'never no groups');
    a.eq(GB().groupCount(26, 'count', 'x'), 1);
    a.deep(GB().sizeRange(26, 6), { min: 4, max: 5 });
    a.deep(GB().sizeRange(24, 6), { min: 4, max: 4 });
  });

  test('a random sort spreads everyone evenly and differs between runs', () => {
    const groups = ['g1', 'g2', 'g3'].map(id => ({ id }));
    const pool = Array.from({ length: 10 }, (_, i) => 'u' + i);
    const r = GB().planRandom({ groups, current: {}, pool, keep: false, rng: seeded(1) });
    a.deep(r.unplaced, []);
    const sizes = { g1: 0, g2: 0, g3: 0 };
    Object.values(r.placement).forEach(g => sizes[g]++);
    a.deep(Object.values(sizes).sort(), [3, 3, 4], 'within one student of each other');
    a.eq(Object.keys(r.placement).length, 10, 'every student placed');
    const r2 = GB().planRandom({ groups, current: {}, pool, keep: false, rng: seeded(99) });
    a.ok(JSON.stringify(r.placement) !== JSON.stringify(r2.placement), 'another shuffle gives other groups');
  });

  test('"sort the rest" keeps students where they are and fills the smallest groups', () => {
    const groups = [{ id: 'g1' }, { id: 'g2' }];
    const current = { a: 'g1', b: 'g1', c: 'g1' };
    const r = GB().planRandom({ groups, current, pool: ['a', 'b', 'c', 'd', 'e'], keep: true, rng: seeded(3) });
    a.eq(r.placement.a, 'g1'); a.eq(r.placement.b, 'g1'); a.eq(r.placement.c, 'g1');
    a.eq(r.placement.d, 'g2'); a.eq(r.placement.e, 'g2');
  });

  test('students outside the pool (another section) are never moved but count towards size', () => {
    const groups = [{ id: 'g1' }, { id: 'g2' }];
    const current = { other1: 'g1', other2: 'g1' };
    const r = GB().planRandom({ groups, current, pool: ['x', 'y'], keep: false, rng: seeded(5) });
    a.eq(r.placement.other1, undefined, 'not in the pool, not in the placement');
    a.eq(r.placement.x, 'g2'); a.eq(r.placement.y, 'g2');
  });

  test('a full group takes nobody more, and who does not fit is reported', () => {
    const r = GB().planRandom({ groups: [{ id: 'g1', max: 2 }], current: {}, pool: ['a', 'b', 'c'], keep: false, rng: seeded(7) });
    a.eq(Object.keys(r.placement).length, 2);
    a.eq(r.unplaced.length, 1);
  });

  test('the board saves only what changed', () => {
    const before = { a: 'g1', b: 'g1', c: null, d: 'g2' };
    const after = { a: 'g1', b: 'g2', c: 'g1', d: null };
    a.deep(GB().moves(before, after), [
      { userId: 'b', from: 'g1', to: 'g2' },
      { userId: 'c', from: null, to: 'g1' },
      { userId: 'd', from: 'g2', to: null }
    ]);
  });

  test('a set name already used gets a number; taken names compare without case', () => {
    a.eq(GB().uniqueSetName('Lab Groups', ['lab groups', 'Lab Groups (2)']), 'Lab Groups (3)');
    a.eq(GB().uniqueSetName('', []), 'Groups');
    a.ok(GB().nameTaken(' lab  groups ', ['Lab Groups']));
  });

  test('a sign-up set sends self_signup and its limit; a teacher-placed set sends neither', () => {
    a.deep(GB().categoryBody('Lab', null, 4), { name: 'Lab' });
    a.deep(GB().categoryBody('Lab', 'enabled', 4), { name: 'Lab', self_signup: 'enabled', group_limit: 4 });
    a.deep(GB().categoryBody('Lab', 'restricted', ''), { name: 'Lab', self_signup: 'restricted' });
  });

  test('a copy keeps names, sizes and sign-up, and refuses a name the class already uses', () => {
    const plan = GB().copyPlan({ name: 'Lab', self_signup: 'enabled', group_limit: 3 },
      [{ name: 'Red', max_membership: 3 }, { name: 'Blue' }], ['Other']);
    a.deep(plan.body, { name: 'Lab', self_signup: 'enabled', group_limit: 3 });
    a.deep(plan.groups, [{ name: 'Red', max: 3 }, { name: 'Blue', max: null }]);
    a.not(plan.conflict);
    a.ok(GB().copyPlan({ name: 'Lab' }, [], ['LAB']).conflict);
    a.eq(GB().copyPlan({ name: 'Lab' }, [], [], 'Lab – Block 2').name, 'Lab – Block 2');
  });

  test('saved formats and choices are cleaned like every other setting', () => {
    const C = globalThis.CGP;
    const v = C.sanitizeSettings({ groupPrefs: { format: '  Lab {A} ', formats: ['A {n}', 'A {n}', '', 7, ...Array(20).fill(0).map((_, i) => 'F' + i + ' {n}')], by: 'weird', count: 500, size: 3, mode: 'nope' } });
    a.eq(v.groupPrefs.format, 'Lab {A}');
    a.eq(v.groupPrefs.formats[0], 'A {n}');
    a.eq(v.groupPrefs.formats[1], '7');
    a.eq(v.groupPrefs.formats.length, 12, 'at most 12 saved formats');
    a.eq(v.groupPrefs.by, 'count');
    a.eq(v.groupPrefs.count, C.DEFAULTS.groupPrefs.count, 'out of range falls back');
    a.eq(v.groupPrefs.size, 3);
    a.eq(v.groupPrefs.mode, 'random');
    a.deep(C.sanitizeSettings({ groupPrefs: 'junk' }).groupPrefs, C.DEFAULTS.groupPrefs);
  });
});

/* ------------------------------------------------- requests and the dialog */

function fakeCanvas() {
  const calls = [];
  let nextId = 500;
  const store = { categories: { 1: [{ id: '70', name: 'Existing' }], 2: [{ id: '80', name: 'Lab Groups' }], 3: [] } };
  const students = {
    1: ['11', '12', '13', '14', '15', '16', '17'].map(id => ({ id, name: 'S' + id, sortable_name: 'S' + id, enrollments: [{ type: 'StudentEnrollment', course_section_id: Number(id) % 2 ? '901' : '902' }] })),
    3: ['31', '32', '33', '34'].map(id => ({ id, name: 'S' + id }))
  };
  const fetch = (url, init) => {
    const u = new URL(url);
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, query: u.search, body });
    let m, data = null;
    if (method === 'GET' && (m = /\/courses\/(\d+)\/group_categories$/.exec(u.pathname))) data = store.categories[m[1]] || [];
    else if (method === 'POST' && (m = /\/courses\/(\d+)\/group_categories$/.exec(u.pathname))) {
      data = Object.assign({ id: String(nextId++) }, body);
      (store.categories[m[1]] = store.categories[m[1]] || []).push(data);
    } else if (method === 'POST' && /\/group_categories\/\d+\/groups$/.test(u.pathname)) data = Object.assign({ id: String(nextId++) }, body);
    else if (method === 'GET' && (m = /\/courses\/(\d+)\/users$/.exec(u.pathname))) data = students[m[1]] || [];
    else if (method === 'POST' && /\/groups\/\d+\/memberships$/.test(u.pathname)) data = { id: String(nextId++), user_id: body.user_id };
    else if (method === 'DELETE') data = {};
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(data)), headers: { get: () => null } });
  };
  const api = new globalThis.CGP.CanvasApi({ origin: 'https://school.instructure.com', fetch });
  api.csrfToken = () => 'tok';
  return { api, calls, store };
}

function builder(canvas) {
  const C = globalThis.CGP;
  if (!C.GroupBuilder) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/groups/group-builder.js'), 'utf8'));
  if (!C.ui) C.ui = { toast() {}, error() {} };
  const b = Object.create(C.GroupBuilder.prototype);
  b.api = canvas.api;
  b.courseId = '1';
  b.origin = 'https://school.instructure.com';
  b.root = null;   // render() draws nothing without a dialog
  const saved = [];
  b.settings = { values: C.sanitizeSettings({}), save(patch) { saved.push(patch); Object.assign(this.values, C.sanitizeSettings(Object.assign({}, this.values, patch))); return Promise.resolve(this.values); } };
  b.saved = saved;
  b.state = {
    view: 'new', roster: [], byId: {}, sections: [], sets: [{ id: '70', name: 'Existing' }], courses: [], changed: false,
    form: { name: 'Lab Groups', by: 'count', count: 3, size: 4, format: 'Team {A}', mode: 'random', limit: '', restrict: false, section: '', busy: false },
    board: null, copy: null
  };
  b.setRoster(canvas.students || [], []);
  return b;
}

async function settle() { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); }

suite('make groups: what is sent to Canvas', test => {
  test('the Groups API requests: create a set and a group without retrying, move and remove a member', async () => {
    const { api, calls } = fakeCanvas();
    await api.createGroupCategory('1', { name: 'Lab' });
    await api.createGroup('500', { name: 'Red' });
    await api.addGroupMember('501', '11');
    await api.removeGroupMember('501', '11');
    a.deep(calls.map(c => c.method + ' ' + c.path), [
      'POST /api/v1/courses/1/group_categories',
      'POST /api/v1/group_categories/500/groups',
      'POST /api/v1/groups/501/memberships',
      'DELETE /api/v1/groups/501/users/11'
    ]);
    a.deep(calls[2].body, { user_id: '11' });
  });

  test('Canvas’s own Student Groups set (it has a role) is not listed', async () => {
    const { api, store } = fakeCanvas();
    store.categories[1].push({ id: '71', name: 'Student Groups', role: 'student_organized' });
    const list = await api.groupCategories('1');
    a.deep(list.map(c => c.name), ['Existing']);
  });

  test('Make groups with a random sort: one set, groups named in order, every student placed once, evenly', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.setRoster(await canvas.api.studentsWithSections('1'), [{ id: '901', name: 'Block 1' }, { id: '902', name: 'Block 2' }]);
    canvas.calls.length = 0;
    b.create();
    await settle();
    const sets = canvas.calls.filter(c => c.method === 'POST' && /group_categories$/.test(c.path));
    a.eq(sets.length, 1);
    a.deep(sets[0].body, { name: 'Lab Groups' });
    const groups = canvas.calls.filter(c => c.method === 'POST' && /\/groups$/.test(c.path));
    a.deep(groups.map(c => c.body.name), ['Team A', 'Team B', 'Team C']);
    const joins = canvas.calls.filter(c => /memberships$/.test(c.path));
    a.deep(joins.map(c => c.body.user_id).sort(), ['11', '12', '13', '14', '15', '16', '17']);
    const per = {};
    joins.forEach(c => { per[c.path] = (per[c.path] || 0) + 1; });
    a.deep(Object.values(per).sort(), [2, 2, 3]);
    a.eq(b.state.view, 'board', 'the groups open, ready to adjust');
    a.ok(b.state.changed);
    a.eq(b.saved[0].groupPrefs.format, 'Team {A}', 'the choices are remembered');
  });

  test('random sort for one section puts only that section’s students in', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.setRoster(await canvas.api.studentsWithSections('1'), [{ id: '901', name: 'Block 1' }, { id: '902', name: 'Block 2' }]);
    b.state.form.section = '902';
    canvas.calls.length = 0;
    b.create();
    await settle();
    const joined = canvas.calls.filter(c => /memberships$/.test(c.path)).map(c => c.body.user_id).sort();
    a.deep(joined, ['12', '14', '16']);
  });

  test('a sign-up set is made with self_signup, and nobody is placed', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    Object.assign(b.state.form, { mode: 'signup', limit: '4', restrict: true });
    b.create();
    await settle();
    const set = canvas.calls.find(c => c.method === 'POST' && /group_categories$/.test(c.path));
    a.deep(set.body, { name: 'Lab Groups', self_signup: 'restricted', group_limit: 4 });
    a.eq(canvas.calls.filter(c => /memberships$/.test(c.path)).length, 0);
  });

  test('a name the class already uses is refused before anything is sent', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.state.form.name = 'existing';
    b.create();
    await settle();
    a.eq(canvas.calls.length, 0);
    a.ok(/already has a group set/.test(b.state.form.error));
  });

  test('saving the board sends one request per moved student, and a removal for "Not in a group"', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.state.board = { set: { id: '70', name: 'Existing' }, groups: [{ id: 'g1' }, { id: 'g2' }], before: { a: 'g1', b: 'g1', c: null }, after: { a: 'g1', b: 'g2', c: 'g1' }, extra: {}, failed: {}, saving: false };
    b.state.board.after.a = null;
    b.saveBoard();
    await settle();
    a.deep(canvas.calls.map(c => c.method + ' ' + c.path).sort(), [
      'DELETE /api/v1/groups/g1/users/a',
      'POST /api/v1/groups/g1/memberships',
      'POST /api/v1/groups/g2/memberships'
    ]);
    a.deep(b.state.board.before, b.state.board.after, 'saved: nothing left to save');
  });

  test('copying to other classes: same names and limits, skips a class that already has the name', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.state.copy = {
      set: { id: '70', name: 'Lab Groups', self_signup: null }, groups: [{ name: 'Red', max_membership: 3 }, { name: 'Blue' }],
      dests: { 'c:2': true, 'c:3': true }, name: 'Lab Groups', random: true, running: false, results: null, showAll: false
    };
    canvas.calls.length = 0;
    b.runCopy();
    await settle();
    const r = b.state.copy.results;
    a.eq(r.length, 2);
    a.eq(r[0].status, 'skip', 'class 2 already has a set called Lab Groups');
    a.eq(r[1].status, 'ok');
    a.ok(/sorted 4 students/.test(r[1].text), r[1].text);
    a.not(canvas.calls.some(c => c.method === 'POST' && c.path === '/api/v1/courses/2/group_categories'), 'nothing made in the class that has it');
    const made = canvas.calls.filter(c => c.method === 'POST' && /\/groups$/.test(c.path)).map(c => c.body);
    a.deep(made, [{ name: 'Red', max_membership: 3 }, { name: 'Blue' }]);
    a.eq(canvas.calls.filter(c => /memberships$/.test(c.path)).length, 4, 'class 3’s own students, not this class’s');
  });

  test('copying to another section of this class names it after the section and sorts only that section', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.setRoster(await canvas.api.studentsWithSections('1'), [{ id: '901', name: 'Block 1' }, { id: '902', name: 'Block 2' }]);
    b.state.copy = {
      set: { id: '70', name: 'Lab', self_signup: null }, groups: [{ name: 'Red' }, { name: 'Blue' }],
      dests: { 's:901': true }, name: 'Lab', random: true, running: false, results: null, showAll: false
    };
    canvas.calls.length = 0;
    b.runCopy();
    await settle();
    const set = canvas.calls.find(c => c.method === 'POST' && /group_categories$/.test(c.path));
    a.eq(set.path, '/api/v1/courses/1/group_categories');
    a.eq(set.body.name, 'Lab – Block 1');
    a.deep(canvas.calls.filter(c => /memberships$/.test(c.path)).map(c => c.body.user_id).sort(), ['11', '13', '15', '17']);
    a.eq(b.state.copy.results[0].status, 'ok');
  });

  test('a sign-up set is copied as a sign-up set, with nobody placed', async () => {
    const canvas = fakeCanvas();
    const b = builder(canvas);
    b.state.copy = {
      set: { id: '70', name: 'Pick a team', self_signup: 'enabled', group_limit: 4 }, groups: [{ name: 'A' }],
      dests: { 'c:3': true }, name: 'Pick a team', random: true, running: false, results: null, showAll: false
    };
    b.runCopy();
    await settle();
    const set = canvas.calls.find(c => c.method === 'POST' && /group_categories$/.test(c.path));
    a.deep(set.body, { name: 'Pick a team', self_signup: 'enabled', group_limit: 4 });
    a.eq(canvas.calls.filter(c => /memberships$/.test(c.path)).length, 0);
  });
});
