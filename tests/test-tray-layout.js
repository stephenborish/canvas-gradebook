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

function radioOpt(label, checked, color, days) {
  const input = el('input', { type: 'radio', name: 'SubmissionTrayRadioInput', value: label.toLowerCase() });
  if (checked) input.setAttribute('checked', '');
  const band = el('div', { class: 'SubmissionTray__RadioInput' }, [
    el('div', {}, [input, el('label', {}, [el('span', { 'aria-hidden': 'true' }), el('span', { text: label })])])
  ]);
  if (color) band.style.backgroundColor = color;
  if (days) band.appendChild(el('div', { class: 'NumberInput__Container' }, [el('span', {}, [el('input', { type: 'text', value: '2' })]), el('span', { text: 'Days' })]));
  return el('span', { class: 'col' }, [band]);
}

/** A tray shaped like Canvas's: status fieldset, earlier comments, then the
 * comment form (RCE + status bar, then Cancel / Submit). */
function buildTray(opts) {
  const o = opts || {};
  const colors = { Late: 'rgb(229, 243, 252)', Missing: 'rgb(255, 232, 229)', Excused: 'rgb(254, 247, 229)' };
  const row = el('span', { class: 'row' }, ['None', 'Late', 'Missing', 'Excused'].map((l, i) =>
    radioOpt(l, o.late ? l === 'Late' : i === 0, colors[l], o.late && l === 'Late')));
  const statusBar = el('div', { class: 'status' }, [
    el('button', { text: 'p' }),
    el('span', o.liveBeforeCount ? { 'aria-live': 'polite' } : { class: 'sep' }),
    el('span', {}, [el('span', { text: '2 words' })])
  ]);
  const tox = el('div', { class: 'tox-tinymce' }, [el('button', { text: 'Paragraph' }), el('iframe')]);
  // flatBar: the status bar's parts loose in the wrapper, so it can't be
  // told apart as one block (the word-count fallback).
  const rce = el('div', { class: 'rce-wrapper' }, o.flatBar ? [tox].concat(statusBar.children.slice()) : [tox, statusBar]);
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

  test('the RCE is tagged and its whole status bar (path, word count, accessibility button) is hidden', () => {
    const t = setup();
    t.ctl.start();
    a.ok(has(t.rce, 'data-cgp-tray-rce'), 'RCE tagged');
    a.ok(has(t.statusBar, 'data-cgp-tray-hide'), 'status bar hidden');
    a.not(has(t.rce.children[0], 'data-cgp-tray-hide'), 'the editor itself is kept');
  });

  test('status bar not told apart: the word count and the bare divider before it are hidden; the path button is not', () => {
    const t = setup({ flatBar: true });
    t.ctl.start();
    const [, path, sep, count] = t.rce.children;
    a.ok(has(count, 'data-cgp-tray-hide'), 'word count hidden');
    a.ok(has(sep, 'data-cgp-tray-hide'), 'divider hidden');
    a.not(has(path, 'data-cgp-tray-hide'), 'path kept');
  });

  test('status bar not told apart: an empty aria-live region before the word count is left alone', () => {
    const t = setup({ liveBeforeCount: true, flatBar: true });
    t.ctl.start();
    const [, , live, count] = t.rce.children;
    a.ok(has(count, 'data-cgp-tray-hide'));
    a.not(has(live, 'data-cgp-tray-hide'), 'live region not hidden');
  });

  test('each status pill carries its value and an accent darkened from Canvas’s colour', () => {
    const t = setup();
    t.ctl.start();
    const pills = t.row.children.map((c) => c.children[0]);
    a.deep(pills.map((p) => p.getAttribute('data-cgp-tray-value')), ['none', 'late', 'missing', 'excused']);
    a.eq(pills[0].style.getPropertyValue('--cgp-tray-accent') || '', '', 'None: no colour, the neutral grey');
    a.eq(pills[1].style.getPropertyValue('--cgp-tray-accent'), 'hsl(203, 79%, 40%)', 'Late: its blue, readable');
    a.eq(pills[2].style.getPropertyValue('--cgp-tray-accent'), 'hsl(7, 100%, 40%)', 'Missing: its red');
    a.ok(/^hsl\(43, \d+%, 32%\)$/.test(pills[3].style.getPropertyValue('--cgp-tray-accent')), 'Excused: its yellow, darker still');
  });

  test('Late’s days box is tagged to sit under the row; the radio part is not', () => {
    const t = setup({ late: true });
    t.ctl.start();
    const band = t.row.children[1].children[0];
    a.ok(has(band.children[1], 'data-cgp-tray-days'), 'days box tagged');
    a.not(has(band.children[0], 'data-cgp-tray-days'), 'radio part not');
    a.eq(t.doc.querySelectorAll('[data-cgp-tray-days]').length, 1, 'only Late’s');
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
