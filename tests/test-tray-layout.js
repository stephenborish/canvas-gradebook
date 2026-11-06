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
  if (days) band.appendChild(el('span', { class: 'NumberInput__Container' }, [
    el('span', {}, [el('label', {}, [el('span', { text: 'Days late' })]), el('input', { type: 'text', value: '2' })]),
    el('span', {}, [el('span', { text: 'Days' })])
  ]));
  // Canvas's radio: a click asks for the change and records it (Canvas would
  // then update the submission and re-render; tests do that by hand).
  input.click = function () { if (!this.disabled) this.clicks = (this.clicks || 0) + 1; };
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
  test('status radios: Canvas’s group is tagged and hidden behind our control, placed right after it', () => {
    const t = setup();
    t.ctl.start();
    a.ok(t.doc.documentElement.classList.contains('cgp-tray-tidy'), 'root class on');
    a.ok(has(t.row, 'data-cgp-tray-status'), 'row tagged');
    a.ok(has(t.row, 'data-cgp-tray-proxied'), 'row hidden behind the control');
    const own = t.row.nextSibling;
    a.ok(own && own.className === 'cgp-tstat', 'control sits right after the row');
    a.eq(t.doc.querySelectorAll('.cgp-tstat').length, 1, 'only one');
    t.ctl.scan(); t.ctl.scan();
    a.eq(t.doc.querySelectorAll('.cgp-tstat').length, 1, 're-scans never add another');
    t.ctl.stopPolling();
  });

  test('one button per status, in Canvas’s order, with its label and the current one pressed', () => {
    const t = setup();
    t.ctl.start();
    const btns = t.doc.querySelectorAll('.cgp-tstat__opt');
    a.deep(btns.map((b) => b.getAttribute('data-value')), ['none', 'late', 'missing', 'excused']);
    a.deep(btns.map((b) => b.children[1].textContent), ['None', 'Late', 'Missing', 'Excused']);
    a.deep(btns.map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false']);
    t.ctl.stopPolling();
  });

  test('each button carries an accent darkened from Canvas’s colour; None is the neutral slate', () => {
    const t = setup();
    t.ctl.start();
    const c = (v) => t.doc.querySelector('.cgp-tstat__opt[data-value="' + v + '"]').style.getPropertyValue('--cgp-tstat-c');
    a.eq(c('none'), '#5b6770');
    a.eq(c('late'), 'hsl(203, 79%, 40%)', 'Late: its blue, readable');
    a.eq(c('missing'), 'hsl(7, 100%, 40%)', 'Missing: its red');
    a.ok(/^hsl\(43, \d+%, 32%\)$/.test(c('excused')), 'Excused: its yellow, darker still');
    t.ctl.stopPolling();
  });

  test('pressing a status clicks Canvas’s own radio and shows at once as pending', () => {
    const t = setup();
    t.ctl.start();
    const late = t.doc.querySelector('.cgp-tstat__opt[data-value="late"]');
    late.click();
    const radio = t.doc.querySelector('input[value="late"]');
    a.eq(radio.clicks, 1, 'Canvas radio clicked');
    a.eq(late.getAttribute('aria-pressed'), 'true', 'shown pressed straight away');
    a.ok(has(late, 'data-pending'), 'with the pending spinner');
    // Canvas confirms: the radio is now the checked one.
    t.doc.querySelector('input[value="none"]').removeAttribute('checked');
    radio.setAttribute('checked', '');
    t.ctl.tick();
    a.not(has(late, 'data-pending'), 'settled');
    a.eq(late.getAttribute('aria-pressed'), 'true');
    t.ctl.stopPolling();
  });

  test('pressing the current status again clears it: Canvas’s None radio is clicked', () => {
    const t = setup({ late: true });
    t.ctl.start();
    const late = t.doc.querySelector('.cgp-tstat__opt[data-value="late"]');
    a.eq(late.getAttribute('aria-pressed'), 'true');
    late.click();
    a.eq(t.doc.querySelector('input[value="none"]').clicks, 1, 'None clicked');
    a.not(t.doc.querySelector('input[value="late"]').clicks, 'Late itself not clicked');
    a.eq(t.doc.querySelector('.cgp-tstat__opt[data-value="none"]').getAttribute('aria-pressed'), 'true');
    // None, pressed while it is already current, does nothing.
    const t2 = setup();
    t2.ctl.start();
    t2.doc.querySelector('.cgp-tstat__opt[data-value="none"]').click();
    a.not(t2.doc.querySelector('input[value="none"]').clicks, 'nothing to clear');
    t.ctl.stopPolling(); t2.ctl.stopPolling();
  });

  test('a press Canvas never confirms reverts to what Canvas says', () => {
    const t = setup();
    t.ctl.start();
    const missing = t.doc.querySelector('.cgp-tstat__opt[data-value="missing"]');
    missing.click();
    a.eq(missing.getAttribute('aria-pressed'), 'true');
    t.ctl.status.pending.until = 0;
    t.ctl.tick();
    a.eq(missing.getAttribute('aria-pressed'), 'false');
    a.eq(t.doc.querySelector('.cgp-tstat__opt[data-value="none"]').getAttribute('aria-pressed'), 'true');
    t.ctl.stopPolling();
  });

  test('a disabled Canvas radio disables its button, which then clicks nothing', () => {
    const t = setup();
    t.ctl.start();
    t.doc.querySelectorAll('input[name="SubmissionTrayRadioInput"]').forEach((r) => r.setAttribute('disabled', ''));
    t.ctl.tick();
    const excused = t.doc.querySelector('.cgp-tstat__opt[data-value="excused"]');
    a.ok(has(excused, 'disabled'));
    a.not(t.ctl.status.choose('excused'));
    a.not(t.doc.querySelector('input[value="excused"]').clicks);
    t.ctl.stopPolling();
  });

  test('Late: the days bar shows Canvas’s value and unit, and only while Late is current', () => {
    const t = setup({ late: true });
    t.ctl.start();
    const bar = t.doc.querySelector('.cgp-tstat__late');
    a.not(has(bar, 'hidden'), 'shown');
    a.eq(t.doc.querySelector('.cgp-tstat__days').value, '2');
    a.eq(t.doc.querySelector('.cgp-tstat__unit').textContent, 'days', 'the visible word, not the screen-reader label');
    const t2 = setup();
    t2.ctl.start();
    a.ok(has(t2.doc.querySelector('.cgp-tstat__late'), 'hidden'), 'hidden when not late');
    t.ctl.stopPolling(); t2.ctl.stopPolling();
  });

  test('Late: a typed amount is handed to Canvas’s field and committed with a blur', () => {
    const t = setup({ late: true });
    t.ctl.start();
    const ours = t.doc.querySelector('.cgp-tstat__days');
    const canvas = t.doc.querySelector('.NumberInput__Container input');
    ours.value = '3.5';
    t.ctl.status.daysDirty = true;
    a.ok(t.ctl.status.commitDays(), 'committed');
    a.eq(canvas.value, '3.5');
    a.deep(canvas._dispatched, ['input', 'focusout', 'blur']);
    // Unchanged or nonsense: nothing sent.
    canvas._dispatched = [];
    ours.value = '3.5';
    a.not(t.ctl.status.commitDays(), 'same value');
    ours.value = 'abc';
    a.not(t.ctl.status.commitDays(), 'not a number');
    a.deep(canvas._dispatched, []);
    a.eq(ours.value, '3.5', 'nonsense reverts to the value');
    t.ctl.stopPolling();
  });

  test('setting turned off: the control is removed and Canvas’s group shown again', () => {
    const t = setup();
    t.ctl.start();
    t.settings.values.trayLayout = false;
    t.ctl.apply();
    a.eq(t.doc.querySelectorAll('.cgp-tstat').length, 0);
    a.not(has(t.row, 'data-cgp-tray-proxied'));
  });

  test('the tray closing and a new one opening: the control follows to the new tray', () => {
    const t = setup();
    t.ctl.start();
    t.tray.remove();
    const t2 = buildTray({ late: true });
    t.doc.body.appendChild(t2.tray);
    t.ctl.tick();
    a.ok(t2.row.nextSibling && t2.row.nextSibling.className === 'cgp-tstat', 'moved to the new tray');
    a.eq(t.doc.querySelector('.cgp-tstat__opt[data-value="late"]').getAttribute('aria-pressed'), 'true');
    t.ctl.stopPolling();
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
