/* Tests for TrayLayoutController (src/gradebook/tray-layout.js):
 * which parts of Canvas's Grade Detail Tray get tagged for the horizontal
 * Status row, the comment toolbar and the hidden word count - and, just as
 * important, which do not - plus the observer filter that keeps grid
 * scrolling from ever scheduling a scan. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

function el(tag, attrs, kids) {
  const e = new domshim.FakeElement(tag);
  Object.keys(attrs || {}).forEach((k) => {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else e.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach((k) => e.appendChild(k));
  return e;
}

function radioOpt(label, checked) {
  const input = el('input', { type: 'radio', name: 'SubmissionTrayRadioInput' });
  if (checked) input.setAttribute('checked', '');
  return el('span', { class: 'col' }, [
    el('div', { class: 'SubmissionTray__RadioInput' }, [
      el('div', {}, [input, el('label', {}, [el('span', { 'aria-hidden': 'true' }), el('span', { text: label })])])
    ])
  ]);
}

/** A tray shaped like Canvas's: status fieldset, earlier comments, then the
 * comment form (RCE + status bar, then Cancel / Submit). */
function buildTray(opts) {
  const o = opts || {};
  const row = el('span', { class: 'row' }, ['None', 'Late', 'Missing', 'Excused'].map((l, i) => radioOpt(l, i === 0)));
  const statusBar = el('div', { class: 'status' }, [
    el('button', { text: 'p' }),
    el('span', o.liveBeforeCount ? { 'aria-live': 'polite' } : { class: 'sep' }),
    el('span', {}, [el('span', { text: '2 words' })])
  ]);
  const rce = el('div', { class: 'rce-wrapper' }, [
    el('div', { class: 'tox-tinymce' }, [el('button', { text: 'Paragraph' }), el('iframe')]),
    statusBar
  ]);
  const cancel = el('button', { text: 'Cancel' });
  const submit = el('button', { text: 'Submit' });
  const actions = el('div', { class: 'btns' }, [cancel, submit]);
  const form = el('div', { class: 'form' }, o.noButtons ? [rce] : [rce, actions]);
  const comments = el('div', { id: 'comments' }, [el('p', {}, [el('button', { text: 'Delete' })]), form]);
  const content = el('div', {}, [el('fieldset', {}, [el('legend', { text: 'Status' }), row]), comments]);
  if (o.footer) content.appendChild(el('div', { class: 'footer' }, [el('button', { text: 'Close' })]));
  const tray = el('span', o.noDialog ? {} : { role: 'dialog', 'aria-label': 'Submission tray' }, [content]);
  return { tray, row, rce, statusBar, form, actions, cancel, submit, comments, content };
}

function setup(opts) {
  const CGP = loadGradebookDom();
  const doc = domshim.install();
  const t = buildTray(opts);
  doc.body.appendChild(t.tray);
  const settings = { values: { trayLayout: opts && opts.off ? false : true }, onChange() {} };
  const ctl = new CGP.TrayLayoutController({ settings });
  return Object.assign(t, { doc, ctl, settings });
}

const has = (e, attr) => e.getAttribute(attr) !== null;

suite('Grade Detail Tray layout', (test) => {
  test('status radios: their shared row, each column and each coloured band are tagged', () => {
    const t = setup();
    t.ctl.start();
    a.ok(t.doc.documentElement.classList.contains('cgp-tray-tidy'), 'root class on');
    a.ok(has(t.row, 'data-cgp-tray-status'), 'row tagged');
    t.row.children.forEach((col) => {
      a.ok(has(col, 'data-cgp-tray-opt'), 'column tagged');
      a.ok(has(col.children[0], 'data-cgp-tray-pill'), 'band tagged');
    });
  });

  test('comment form: Cancel / Submit become the toolbar, Submit primary', () => {
    const t = setup();
    t.ctl.start();
    a.ok(has(t.form, 'data-cgp-tray-comment'), 'form tagged');
    a.ok(has(t.rce, 'data-cgp-tray-comment-editor'), 'whole RCE is the editor');
    a.ok(has(t.actions, 'data-cgp-tray-comment-actions'), 'button bar tagged');
    a.eq(t.cancel.getAttribute('data-cgp-tray-btn'), 'secondary');
    a.eq(t.submit.getAttribute('data-cgp-tray-btn'), 'primary');
    a.not(has(t.statusBar, 'data-cgp-tray-comment-actions'), 'RCE status bar is not the toolbar');
  });

  test('word count and the bare divider before it are hidden; the path button is not', () => {
    const t = setup();
    t.ctl.start();
    const [path, sep, count] = t.statusBar.children;
    a.ok(has(count, 'data-cgp-tray-hide'), 'word count hidden');
    a.ok(has(sep, 'data-cgp-tray-hide'), 'divider hidden');
    a.not(has(path, 'data-cgp-tray-hide'), 'path kept');
  });

  test('an empty aria-live region before the word count is left alone', () => {
    const t = setup({ liveBeforeCount: true });
    t.ctl.start();
    const [, live, count] = t.statusBar.children;
    a.ok(has(count, 'data-cgp-tray-hide'));
    a.not(has(live, 'data-cgp-tray-hide'), 'live region not hidden');
  });

  test('no buttons beside the editor: an unrelated button group further up is never claimed', () => {
    const t = setup({ noButtons: true, footer: true });
    t.ctl.start();
    a.eq(t.doc.querySelectorAll('[data-cgp-tray-comment]').length, 0);
    a.eq(t.doc.querySelectorAll('[data-cgp-tray-btn]').length, 0);
  });

  test('radios outside a dialog: statuses are tagged, comment forms are not', () => {
    const t = setup({ noDialog: true });
    t.ctl.start();
    a.ok(has(t.row, 'data-cgp-tray-status'));
    a.eq(t.doc.querySelectorAll('[data-cgp-tray-comment]').length, 0);
  });

  test('a plain textarea comment box gets the same toolbar', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const ta = el('textarea');
    const submit = el('button', { text: 'Submit' });
    const form = el('div', {}, [el('div', {}, [ta]), el('div', {}, [el('button', { text: 'Cancel' }), submit])]);
    const row = el('span', {}, [radioOpt('None', true), radioOpt('Late')]);
    doc.body.appendChild(el('div', { role: 'dialog' }, [row, form]));
    new CGP.TrayLayoutController({ settings: { values: { trayLayout: true } } }).start();
    a.ok(has(form, 'data-cgp-tray-comment'));
    a.eq(submit.getAttribute('data-cgp-tray-btn'), 'primary');
  });

  test('setting off: root class removed, nothing tagged', () => {
    const t = setup({ off: true });
    t.ctl.start();
    a.not(t.doc.documentElement.classList.contains('cgp-tray-tidy'));
    a.not(has(t.row, 'data-cgp-tray-status'));
  });

  test('observer filter: grid rows never schedule a scan; the tray mounting does', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const ctl = new CGP.TrayLayoutController({ settings: { values: { trayLayout: true } } });
    let scans = 0;
    ctl.scheduleScan = () => { scans++; };

    const canvas = el('div', { class: 'grid-canvas' });
    doc.body.appendChild(el('div', { class: 'slick-viewport' }, [canvas]));
    const gridRow = el('div', { class: 'slick-row' }, [el('div', { class: 'slick-cell' })]);
    canvas.appendChild(gridRow);
    a.not(ctl.onMutations([{ target: canvas, addedNodes: [gridRow] }]), 'grid row ignored');
    a.eq(scans, 0);

    const t = buildTray();
    doc.body.appendChild(t.tray);
    a.ok(ctl.onMutations([{ target: doc.body, addedNodes: [t.tray] }]), 'tray mount noticed');
    a.eq(scans, 1);
  });

  test('observer filter: with a tray open, only mutations inside it count', () => {
    const t = setup();
    t.ctl.start();
    a.ok(t.ctl.tray === t.tray, 'tray remembered');
    let scans = 0;
    t.ctl.scheduleScan = () => { scans++; };

    const outside = el('div');
    t.doc.body.appendChild(outside);
    a.not(t.ctl.onMutations([{ target: outside, addedNodes: [el('span')] }]), 'outside ignored');
    a.ok(t.ctl.onMutations([{ target: t.comments, addedNodes: [el('p')] }]), 'inside counts');
    a.eq(scans, 1);

    // Closed: forgotten, and the next tray is found by its radios again.
    t.tray.remove();
    a.not(t.ctl.onMutations([{ target: outside, addedNodes: [el('span')] }]));
    a.ok(t.ctl.tray === null, 'closed tray forgotten');
  });

  test('a re-scan with the tray open looks only inside it', () => {
    const t = setup();
    t.ctl.start();
    // A second radio group elsewhere on the page must not be touched.
    const stray = el('span', {}, [radioOpt('A'), radioOpt('B')]);
    t.doc.body.appendChild(stray);
    t.ctl.scan();
    a.not(has(stray, 'data-cgp-tray-status'));
  });
});
