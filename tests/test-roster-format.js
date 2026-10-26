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
    t = fmt().table(rows, { nameFormat: 'none', email: true });
    a.deep(t.header, ['Email']);
    t = fmt().table(rows, { nameFormat: 'none', email: false });
    a.eq(t.header.length, 0, 'nothing chosen, nothing to copy');
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

  test('Student Name menu grows Copy Roster after "Secondary info", once, with no submenu flag', () => {
    const C = loadRoster();
    const doc = domshim.install();
    const menu = studentMenu(doc, domshim.FakeElement);
    const ctrl = new C({ api: {}, courseId: '379', adapter: {} });
    ctrl._lastTrigger = Date.now();
    ctrl.decorateMenu(menu);
    ctrl.decorateMenu(menu);
    const added = menu.querySelectorAll('.cgp-roster-item');
    a.eq(added.length, 1, 'added once');
    a.eq(menu.children.indexOf(added[0]), 3, 'after Secondary info');
    a.eq(added[0].getAttribute('aria-haspopup'), null, 'opens no submenu');
    a.eq(added[0].getAttribute('aria-label'), 'Copy Roster');
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
