/* Tests for core/roster-format.js: the Student Name column's "Copy Roster"
 * panel - name splitting, layouts, and the TSV / CSV / HTML / email list
 * output a teacher pastes or downloads. */
'use strict';

const { suite, assert: a } = require('./harness');

function fmt() { return globalThis.CGP.rosterFormat; }

const USERS = [
  { id: 2, name: 'John (Jack) Burke', sortable_name: 'Burke, John (Jack)', email: 'jburke@school.org' },
  { id: 1, name: 'Jake Bonko', sortable_name: 'Bonko, Jake', email: 'jbonko@school.org' },
  { id: 3, name: 'Omari Sutton', sortable_name: 'Sutton, Omari', login_id: 'osutton@school.org' },
  { id: 4, name: 'Cher', sortable_name: 'Cher' },
  { id: 1, name: 'Jake Bonko', sortable_name: 'Bonko, Jake', email: 'jbonko@school.org' }
];

suite('roster export: formatting', (test) => {
  test('splits names from sortable_name, falls back to the display name', () => {
    a.deep(fmt().splitName({ sortable_name: 'Van Buren, Martin' }), { first: 'Martin', last: 'Van Buren' });
    a.deep(fmt().splitName({ name: 'Ada Lovelace' }), { first: 'Ada', last: 'Lovelace' });
    a.deep(fmt().splitName({ name: 'Cher', sortable_name: 'Cher' }), { first: 'Cher', last: '' });
  });

  test('email falls back to an address-shaped login id only', () => {
    a.eq(fmt().emailOf({ login_id: 'a@b.org' }), 'a@b.org');
    a.eq(fmt().emailOf({ login_id: 'student123' }), '');
  });

  test('normalize drops duplicates and sorts by last or first name', () => {
    const byLast = fmt().normalize(USERS, 'last');
    a.deep(byLast.map((r) => r.id), ['4', '1', '2', '3'], 'last name order (no last name sorts first)');
    const byFirst = fmt().normalize(USERS, 'first');
    a.deep(byFirst.map((r) => r.first), ['Cher', 'Jake', 'John (Jack)', 'Omari']);
  });

  test('every name layout, with and without email', () => {
    const rows = fmt().normalize(USERS.slice(0, 2), 'last');
    let t = fmt().table(rows, { nameFormat: 'first-last', email: true });
    a.deep(t.header, ['Name', 'Email']);
    a.deep(t.body[0], ['Jake Bonko', 'jbonko@school.org']);
    t = fmt().table(rows, { nameFormat: 'last-first', email: false });
    a.deep(t.body[1], ['Burke, John (Jack)']);
    t = fmt().table(rows, { nameFormat: 'split', email: true });
    a.deep(t.header, ['First Name', 'Last Name', 'Email']);
    a.deep(t.body[0], ['Jake', 'Bonko', 'jbonko@school.org']);
    t = fmt().table(rows, { nameFormat: 'none', email: false });
    a.deep(t.header, ['Name'], 'a retired layout (No names, First name only) falls back to First Last');
    a.deep(t.body[0], ['Jake Bonko']);
    a.deep(fmt().NAME_FORMATS, ['first-last', 'last-first', 'split', 'comma-line']);
    t = fmt().table(rows, { nameFormat: 'comma-line', email: true });
    a.deep(t.header, ['First Name, Last Name, Email']);
    a.deep(t.body, [['Jake, Bonko, jbonko@school.org'], ['John (Jack), Burke, jburke@school.org']], 'one cell per student');
    a.eq(fmt().toTsv(t, false), 'Jake, Bonko, jbonko@school.org\nJohn (Jack), Burke, jburke@school.org');
    t = fmt().table(rows, { nameFormat: 'comma-line', email: false });
    a.deep(t.body[0], ['Jake, Bonko'], 'email left off when unchecked');
    t = fmt().table(fmt().normalize([{ id: 9, name: 'Cher', sortable_name: 'Cher' }], 'last'), { nameFormat: 'comma-line', email: true });
    a.deep(t.body[0], ['Cher, , '], 'a missing part keeps its place');
  });

  test('TSV, CSV and HTML outputs', () => {
    const rows = fmt().normalize(USERS.slice(0, 2), 'last');
    const t = fmt().table(rows, { nameFormat: 'last-first', email: true });
    a.eq(fmt().toTsv(t, true), 'Name\tEmail\nBonko, Jake\tjbonko@school.org\nBurke, John (Jack)\tjburke@school.org');
    a.eq(fmt().toTsv(t, false).split('\n').length, 2, 'no header row');
    a.eq(fmt().toCsv(t, true), 'Name,Email\r\n"Bonko, Jake",jbonko@school.org\r\n"Burke, John (Jack)",jburke@school.org\r\n');
    const html = fmt().toHtml(t, true);
    a.ok(/<th[^>]*>Name<\/th>/.test(html) && /<td[^>]*>Bonko, Jake<\/td>/.test(html), 'html table with header');
  });

  test('CSV neutralizes spreadsheet formulas and HTML escapes markup', () => {
    const t = { header: ['Name'], body: [['=HYPERLINK("x")'], ['<b>x</b>']] };
    a.eq(fmt().toCsv(t, false).split('\r\n')[0], '"\'=HYPERLINK(""x"")"');
    a.ok(fmt().toHtml(t, false).indexOf('&lt;b&gt;') >= 0);
  });

  test('email list skips students without an address', () => {
    const rows = fmt().normalize(USERS, 'last');
    a.eq(fmt().emailList(rows, 'comma'), 'jbonko@school.org, jburke@school.org, osutton@school.org');
    a.eq(fmt().emailList(rows, 'semicolon'), 'jbonko@school.org; jburke@school.org; osutton@school.org');
    a.eq(fmt().emailList(rows, 'newline').split('\n').length, 3);
  });
});

suite('roster export: parents and guardians', (test) => {
  const OBSERVERS = [
    { id: 90, name: 'Pat Bonko', email: 'pat@home.org', enrollments: [{ type: 'ObserverEnrollment', associated_user_id: 1 }] },
    // One parent of two siblings: listed once.
    { id: 91, name: 'Lee Burke', email: 'LEE@home.org', enrollments: [{ associated_user_id: 2 }, { associated_user_id: 1 }] },
    { id: 92, name: 'Sam Burke', email: 'lee@home.org', enrollments: [{ associated_user_id: 2 }] },
    // A course-wide observer (a colleague), linked to no student: left out.
    { id: 93, name: 'Dean', email: 'dean@school.org', enrollments: [{ associated_user_id: null }] },
    // Linked to someone not on this roster: left out.
    { id: 94, name: 'Other', email: 'other@home.org', enrollments: [{ associated_user_id: 77 }] },
    { id: 95, name: 'No Email', enrollments: [{ associated_user_id: 3 }] },
    // Linked only through observed_users, as the student overview also reads.
    { id: 96, name: 'Kim Sutton', email: 'kim@home.org', observed_users: [{ id: 3 }] }
  ];

  test('only observers linked to a student on the roster, each address once', () => {
    const rows = fmt().normalize(USERS, 'last');
    const g = fmt().guardians(OBSERVERS, rows);
    a.deep(g.emails, ['pat@home.org', 'LEE@home.org', 'kim@home.org']);
    a.eq(g.count, 3);
    a.eq(g.uncovered, 1, 'only Cher has no linked address; Omari\'s comes through observed_users');
  });

  test('the email list takes students, guardians or both, without repeats', () => {
    const rows = fmt().normalize(USERS.slice(0, 2), 'last');
    const g = fmt().guardians(OBSERVERS, rows).emails;
    a.eq(fmt().emailList(rows, 'comma'), 'jbonko@school.org, jburke@school.org', 'students by default');
    a.eq(fmt().emailList(rows, 'semicolon', { guardians: g }),
      'jbonko@school.org; jburke@school.org; pat@home.org; LEE@home.org');
    a.eq(fmt().emailList(rows, 'newline', { students: false, guardians: g }), 'pat@home.org\nLEE@home.org');
    a.eq(fmt().emailList(rows, 'comma', { students: false, guardians: ['JBONKO@school.org'] }), 'JBONKO@school.org');
    a.eq(fmt().emailList(rows, 'comma', { guardians: ['JBONKO@school.org'] }), 'jbonko@school.org, jburke@school.org',
      'an address already on the list is not copied twice');
    a.eq(fmt().emailList(rows, 'comma', { students: false }), '', 'nobody chosen');
  });
});

suite('roster export: Student Name menu', (test) => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { loadGradebookDom, domshim } = require('./domharness');

  function loadRoster() {
    loadGradebookDom();
    vm.runInThisContext(fs.readFileSync(path.resolve(__dirname, '../src/gradebook/roster-export.js'), 'utf8'));
    return globalThis.CGP.RosterExportController;
  }

  function studentMenu(doc, FakeElement) {
    const menu = new FakeElement('div');
    menu.setAttribute('role', 'menu');
    ['Sort by', 'Display as', 'Secondary info', 'Show'].forEach((label) => {
      const it = new FakeElement('div');
      it.setAttribute('role', 'menuitem');
      it.setAttribute('aria-haspopup', 'true');
      it.textContent = label;
      menu.appendChild(it);
    });
    doc.body.appendChild(menu);
    return menu;
  }

  test('only a press in the Student Name header is remembered', () => {
    const C = loadRoster();
    const target = { closest: (sel) => (sel === '.slick-header-column' ? {} : sel.indexOf('button') >= 0 ? {} : null) };
    const ctrl = new C({ api: {}, courseId: '379', adapter: { columnIdForHeader: () => 'assignment_7' } });
    ctrl.rememberTrigger(target);
    a.eq(ctrl._lastTrigger, 0, 'an assignment header is not the Student Name column');
    ctrl.adapter.columnIdForHeader = () => 'student';
    ctrl.rememberTrigger(target);
    a.ok(ctrl._lastTrigger > 0);
  });

  test('Student Name menu grows Copy Roster at the top, once, with no submenu flag', () => {
    const C = loadRoster();
    const doc = domshim.install();
    const menu = studentMenu(doc, domshim.FakeElement);
    const ctrl = new C({ api: {}, courseId: '379', adapter: {} });
    ctrl._lastTrigger = Date.now();
    ctrl.decorateMenu(menu);
    ctrl.decorateMenu(menu);
    const added = menu.querySelectorAll('.cgp-roster-item');
    a.eq(added.length, 1, 'added once');
    a.eq(menu.children.indexOf(added[0]), 0, 'first, above Sort by');
    a.eq(added[0].getAttribute('aria-haspopup'), null, 'opens no submenu');
    a.eq(added[0].getAttribute('aria-label'), 'Copy Roster');
  });

  test('resting on Copy Roster closes a submenu left open, and keeps focus', () => {
    const C = loadRoster();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const menu = studentMenu(doc, FakeElement);
    menu.children[0].setAttribute('aria-expanded', 'true'); // Sort by's flyout is open
    const plain = new FakeElement('div');
    plain.setAttribute('role', 'menuitemcheckbox');
    plain.textContent = 'Inactive enrollments';
    let hovered = 0;
    plain.addEventListener('mouseover', () => {
      hovered++;
      plain.focus(); // what Canvas's own item does on hover
      menu.children.forEach((c) => c.getAttribute('aria-expanded') && c.setAttribute('aria-expanded', 'false'));
    });
    menu.appendChild(plain);
    const hadMouseEvent = 'MouseEvent' in globalThis;
    const saved = globalThis.MouseEvent;
    globalThis.MouseEvent = function (type, init) { return Object.assign({ type }, init); };
    if (!globalThis.window) globalThis.window = globalThis;
    let prevUi;
    try {
      prevUi = globalThis.CGP.ui;
      delete globalThis.CGP.ui;
      vm.runInThisContext(fs.readFileSync(path.resolve(__dirname, '../src/core/ui.js'), 'utf8'));
      const ctrl = new C({ api: {}, courseId: '379', adapter: {} });
      ctrl._lastTrigger = Date.now();
      ctrl.decorateMenu(menu);
      const item = menu.querySelector('.cgp-roster-item');
      item.dispatchEvent({ type: 'mouseenter' });
      a.eq(hovered, 1, 'Canvas\'s own plain item was told about the hover');
      a.eq(doc.activeElement, item, 'focus came back to Copy Roster');
      item.dispatchEvent({ type: 'mouseenter' });
      a.eq(hovered, 1, 'nothing open, nothing to close');
    } finally {
      if (hadMouseEvent) globalThis.MouseEvent = saved; else delete globalThis.MouseEvent;
      if (prevUi) globalThis.CGP.ui = prevUi;
    }
  });

  test('a menu opened from anywhere else is left alone', () => {
    const C = loadRoster();
    const doc = domshim.install();
    const menu = studentMenu(doc, domshim.FakeElement);
    const ctrl = new C({ api: {}, courseId: '379', adapter: {} });
    ctrl.decorateMenu(menu);
    a.eq(menu.querySelector('.cgp-roster-item'), null, 'no recent Student Name press');
  });
});
