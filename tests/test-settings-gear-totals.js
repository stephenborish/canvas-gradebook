/* The breadcrumb gear that stands in for Canvas's hidden gradebook-settings
 * gear (the way in to Arrange By), and score analysis for the course Total. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function makeLayout(CGP, controlsHidden) {
  const layout = new CGP.CompactLayoutController({
    adapter: new CGP.GradebookDomAdapter(),
    settings: { values: { hideCanvasUtilityControls: true } }
  });
  layout.controlsHidden = !!controlsHidden;
  layout.applyGeometry = () => {};
  return layout;
}

function breadcrumbs(doc, FakeElement) {
  const crumbs = new FakeElement('nav');
  crumbs.id = 'breadcrumbs';
  const li = new FakeElement('li');
  const find = new FakeElement('button');
  find.classList.add('cgp-crumb-toggle');
  find.classList.add('cgp-find-student');
  li.appendChild(find);
  crumbs.appendChild(li);
  doc.body.appendChild(crumbs);
  return { crumbs, li, find };
}

function canvasGear(doc, FakeElement) {
  const actions = new FakeElement('div');
  actions.id = 'gradebook-actions';
  const gear = new FakeElement('button');
  gear.setAttribute('data-testid', 'gradebook-settings-button');
  gear.classList.add('cgp-hidden');
  actions.appendChild(gear);
  doc.body.appendChild(actions);
  return gear;
}

suite('settings gear: Canvas\'s gradebook settings while the utility strip is collapsed', (test) => {
  test('the gear seats itself right after Find student, once', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const { li, find } = breadcrumbs(doc, domshim.FakeElement);
    const layout = makeLayout(CGP, true);
    const btn = layout.mountSettingsGear();
    a.ok(btn && btn.classList.contains('cgp-settings-gear'), 'gear mounted');
    a.eq(li.children.indexOf(btn), li.children.indexOf(find) + 1, 'directly after Find student');
    a.eq(layout.mountSettingsGear(), btn, 'a second call reuses it');
    a.eq(doc.querySelectorAll('.cgp-settings-gear').length, 1);
  });

  test('with no breadcrumb controls of our own, it goes in the last crumb', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const crumbs = new FakeElement('nav');
    crumbs.id = 'breadcrumbs';
    const first = new FakeElement('li');
    const last = new FakeElement('li');
    crumbs.appendChild(first);
    crumbs.appendChild(last);
    doc.body.appendChild(crumbs);
    const btn = makeLayout(CGP, true).mountSettingsGear();
    a.eq(btn.parentElement, last);
  });

  test('Canvas\'s own gear is found, never the breadcrumb stand-in that shares its label', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    breadcrumbs(doc, domshim.FakeElement);
    const layout = makeLayout(CGP, true);
    const ours = layout.mountSettingsGear();
    a.ok(/gradebook settings/i.test(ours.getAttribute('aria-label')));
    a.eq(layout.findSettingsButton(), null, 'ours alone is not Canvas\'s gear');
    const gear = canvasGear(doc, domshim.FakeElement);
    // A second selector Canvas's gear would also match, placed after ours.
    gear.setAttribute('aria-label', 'Gradebook Settings');
    a.eq(layout.findSettingsButton(), gear);
  });

  test('clicking it presses Canvas\'s hidden gear, opening Canvas\'s dialog as-is, and leaves the strip collapsed', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    breadcrumbs(doc, domshim.FakeElement);
    const gear = canvasGear(doc, domshim.FakeElement);
    let clicks = 0;
    gear.click = () => { clicks++; };
    const layout = makeLayout(CGP, true);
    let restored = 0;
    layout.restoreControls = () => { restored++; };
    let tabbed = 0;
    layout.selectViewOptionsTab = () => { tabbed++; return Promise.resolve(true); };
    a.eq(await layout.openCanvasSettings(), true);
    a.eq(clicks, 1, 'Canvas\'s gear clicked');
    a.eq(tabbed, 0, 'Canvas picks the tab, not us');
    a.eq(restored, 0, 'utility strip not brought back');
    a.ok(layout.controlsHidden);
  });

  test('if Canvas\'s gear cannot be found, Canvas\'s controls come back and the teacher is told', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    breadcrumbs(doc, domshim.FakeElement);
    const layout = makeLayout(CGP, true);
    let restored = 0;
    layout.restoreControls = function () { restored++; this.controlsHidden = false; };
    const errors = [];
    const origUi = CGP.ui;
    CGP.ui = { error: (m) => errors.push(m), toast: () => {} };
    try {
      a.eq(await layout.openCanvasSettings(), false);
    } finally {
      CGP.ui = origUi;
    }
    a.eq(restored, 1);
    a.eq(errors.length, 1);
    a.ok(/Arrange By/.test(errors[0]));
  });
});

function loadAnalysis() {
  vm.runInThisContext(fs.readFileSync(path.resolve(__dirname, '../src/gradebook/score-analysis.js'), 'utf8'));
  return globalThis.CGP.ScoreAnalysisController;
}

const SCALE = [
  { letter: 'A', min: 89.5 }, { letter: 'B', min: 79.5 }, { letter: 'C', min: 69.5 },
  { letter: 'D', min: 59.5 }, { letter: 'F', min: 0 }
];

function totalsModel(students) {
  const map = new Map();
  students.forEach((s) => map.set(s.id, s));
  return { ready: true, studentOrder: students.map((s) => s.id), students: map };
}

suite('score analysis: course totals', (test) => {
  test('totals come from each student\'s course score; no total is "not graded", Test Student is left out', async () => {
    const C = loadAnalysis();
    const model = totalsModel([
      { id: '1', name: 'Ann', fullName: 'Ann Lee', currentScore: 95 },
      { id: '2', name: 'Bo', fullName: 'Bo Kim', currentScore: 82.5 },
      { id: '3', name: 'Cy', fullName: 'Cy Fox', currentScore: null },
      { id: '4', name: 'Test Student', fullName: 'Test Student', currentScore: 0 }
    ]);
    const ctrl = new C({ model, adapter: {}, settings: { values: { gradingScale: SCALE } } });
    const bodies = [];
    ctrl.showDialog = function (title) { this.title = title; this._dialog = {}; return this._dialog; };
    ctrl.setBody = (html) => bodies.push(html);
    const s = await ctrl.openTotals();
    a.eq(ctrl.title, 'Total');
    a.eq(s.count, 2);
    a.eq(s.ungraded, 1);
    a.eq(s.mean, 88.75);
    a.eq(s.meanPercent, 88.75, 'a total is already a percentage');
    const html = bodies[bodies.length - 1];
    a.ok(/88\.8%/.test(html), 'mean shown as a percentage');
    a.ok(/1 with no graded work yet/.test(html));
    a.ok(/95%.*\(A\)/.test(html), 'each listed total carries its letter');
    a.ok(html.indexOf('Test Student') < 0);
    a.ok(html.indexOf(' pts') < 0, 'no points figures for totals');
  });

  test('no totals yet says so', () => {
    const C = loadAnalysis();
    const ctrl = new C({ model: {}, adapter: {}, settings: { values: {} } });
    const html = ctrl.render(globalThis.CGP.scoreStats.analyze([], 100, SCALE), { total: true });
    a.ok(/No student has a course total yet/.test(html));
  });

  test('a press on the Total column\'s menu button is remembered as the Total', () => {
    const C = loadAnalysis();
    const header = { tag: 'header' };
    const target = {
      closest: (sel) => (sel === '.slick-header-column' ? header : sel.indexOf('button') >= 0 ? {} : null)
    };
    const ctrl = new C({ model: {}, adapter: { columnIdForHeader: () => 'total_grade' }, settings: { values: {} } });
    ctrl.rememberTrigger(target);
    a.eq(ctrl._lastTrigger && ctrl._lastTrigger.kind, 'total');
    ctrl._lastTrigger = null;
    ctrl.adapter.columnIdForHeader = () => 'total_grade_override';
    ctrl.rememberTrigger(target);
    a.eq(ctrl._lastTrigger, null, 'Final Grade Override is not the Total');
    ctrl.adapter.columnIdForHeader = () => 'assignment_7';
    ctrl.rememberTrigger(target);
    a.deep([ctrl._lastTrigger.kind, ctrl._lastTrigger.assignmentId], ['assignment', '7']);
  });

  test('Canvas\'s Total menu grows Analyze Scores after "Move to End"', () => {
    loadGradebookDom();
    const C = loadAnalysis();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const menu = new FakeElement('div');
    menu.setAttribute('role', 'menu');
    ['Grade - Low to High', 'Display as Points', 'Move to End'].forEach((label) => {
      const it = new FakeElement('div');
      it.setAttribute('role', 'menuitem');
      it.textContent = label;
      menu.appendChild(it);
    });
    doc.body.appendChild(menu);
    const ctrl = new C({ model: { assignment: () => null }, adapter: {}, settings: { values: {} } });
    ctrl._lastTrigger = { kind: 'total', assignmentId: null, at: Date.now() };
    ctrl.decorateMenu(menu);
    const added = menu.querySelector('.cgp-analyze-item');
    a.ok(added, 'item added even though the Total has no assignment record');
    a.eq(menu.children.indexOf(added), 3, 'after Move to End');
  });
});
