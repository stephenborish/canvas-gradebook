/* Tests for SpeedGrader's tidy comment box (speedgrader/comment-layout.js)
 * and the red annotation default (speedgrader/annotation-color.js). */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const has = (e, attr) => e.getAttribute(attr) !== null;

function loadFile(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
}

/** Classic SpeedGrader's comment area: the RCE (with its status bar) in the
 * mount point, then the row of tools and Submit Comment. */
function buildSpeedGrader() {
  const statusBar = el('div', { 'data-testid': 'RCEStatusBar' }, [
    el('button', { text: 'p' }), el('button', { 'aria-label': 'Keyboard shortcuts' }),
    el('button', { 'aria-label': 'Accessibility checker' }), el('span', { text: '0 words' })
  ]);
  const rce = el('div', { class: 'rce-wrapper' }, [
    el('div', { class: 'tox-tinymce' }, [el('button', { text: 'Paragraph' }), el('iframe')]), statusBar
  ]);
  const mount = el('div', { id: 'speedgrader_comment_textarea_mount_point' }, [rce]);
  const attach = el('button', { id: 'add_attachment', 'aria-label': 'Attach file' });
  const media = el('button', { id: 'media_comment_button', 'aria-label': 'Media comment' });
  const speech = el('button', { id: 'speech_recognition_button', 'aria-label': 'Speech recognition' });
  const submit = el('button', { id: 'comment_submit_button', text: 'Submit Comment' });
  const row = el('div', { class: 'attach_things' }, [attach, media, speech, submit]);
  const form = el('div', { id: 'add_a_comment' }, [mount, row]);
  const comments = el('div', { id: 'comments' }, [el('p', { text: 'Earlier comment' })]);
  return { form, mount, rce, statusBar, row, attach, media, speech, submit, comments };
}

function setupSg(opts) {
  loadGradebookDom();
  const doc = domshim.install();
  loadFile('src/gradebook/tray-layout.js');
  loadFile('src/speedgrader/comment-layout.js');
  const t = buildSpeedGrader();
  doc.body.appendChild(el('div', { id: 'right_side' }, [t.comments, t.form]));
  const settings = { values: { speedgraderTidyComments: !(opts && opts.off) }, onChange() {} };
  const ctl = new globalThis.CGP.SpeedGraderCommentLayout({ settings });
  return Object.assign(t, { doc, ctl, settings });
}

suite('SpeedGrader tidy comment box', (test) => {
  test('the editor gets the tray’s look and its status bar (p, keyboard, accessibility, word count) is hidden', () => {
    const t = setupSg();
    t.ctl.start();
    a.ok(t.doc.documentElement.classList.contains('cgp-sg-tidy'), 'root class on');
    a.ok(has(t.rce, 'data-cgp-tray-rce'), 'RCE tagged');
    a.ok(has(t.statusBar, 'data-cgp-tray-hide'), 'status bar hidden');
    a.not(has(t.rce.children[0], 'data-cgp-tray-hide'), 'the editor and its toolbar are kept');
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('attach, media and speech stay as tools; Submit is marked; nothing in the row is hidden', () => {
    const t = setupSg();
    t.ctl.start();
    a.ok(has(t.row, 'data-cgp-sg-actions'), 'row tagged');
    [t.attach, t.media, t.speech].forEach((b) => {
      a.ok(has(b, 'data-cgp-sg-tool'), b.getAttribute('id') + ' is a tool');
      a.not(has(b, 'data-cgp-tray-hide'), b.getAttribute('id') + ' not hidden');
    });
    a.ok(has(t.submit, 'data-cgp-sg-submit'));
    a.not(has(t.submit, 'data-cgp-sg-tool'));
    a.not(has(t.form, 'data-cgp-sg-actions'), 'the form holding the editor is not taken for the row');
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('setting off: no root class, nothing tagged', () => {
    const t = setupSg({ off: true });
    t.ctl.start();
    a.not(t.doc.documentElement.classList.contains('cgp-sg-tidy'));
    a.not(has(t.rce, 'data-cgp-tray-rce'));
    a.not(has(t.row, 'data-cgp-sg-actions'));
  });
});

function setupDocViewer(opts) {
  loadGradebookDom();
  const doc = domshim.install();
  globalThis.__cgpAnnotationTest = true;
  loadFile('src/speedgrader/annotation-color.js');
  const tools = ['Select', 'Point', 'Highlight', 'Text', 'Strikeout', 'Free Draw', 'Area'].map((l) =>
    el('button', { 'aria-label': l, 'aria-pressed': l === (opts.tool || 'Select') ? 'true' : 'false' }));
  const toolbar = el('div', { role: 'toolbar' }, tools);
  const colors = ['Red', 'Orange', 'Yellow', 'Brown', 'Green', 'Blue', 'Light Blue', 'Pink', 'Purple', 'Black'];
  const swatches = colors.map((c) => el('button', { 'aria-label': c, 'aria-checked': c === 'Light Blue' ? 'true' : 'false', role: 'radio' }));
  swatches.forEach((s) => { s.clicks = 0; s.addEventListener('click', () => { s.clicks++; }); });
  const palette = el('div', { role: 'radiogroup' }, swatches);
  doc.body.appendChild(toolbar);
  if (!opts.noPalette) doc.body.appendChild(palette);
  const ctl = new globalThis.CGP.AnnotationColorDefaults({ settings: { values: { annotationDefaultRed: opts.off ? false : true } }, document: doc });
  return { doc, ctl, tools, palette, swatches, red: swatches[0] };
}

suite('DocViewer: red by default for Free Draw and Point', (test) => {
  test('Free Draw active with its palette showing: red is pressed, once per palette', () => {
    const t = setupDocViewer({ tool: 'Free Draw' });
    a.ok(t.ctl.scan());
    a.eq(t.red.clicks, 1);
    a.not(t.ctl.scan(), 'the same palette is not pressed again');
    a.eq(t.red.clicks, 1);
  });

  test('Point active: red is pressed too', () => {
    const t = setupDocViewer({ tool: 'Point' });
    t.ctl.scan();
    a.eq(t.red.clicks, 1);
  });

  test('highlight, strikeout and the other tools are left alone', () => {
    ['Highlight', 'Strikeout', 'Text', 'Area', 'Select'].forEach((tool) => {
      const t = setupDocViewer({ tool });
      a.not(t.ctl.scan(), tool);
      a.eq(t.red.clicks, 0, tool);
    });
  });

  test('red already chosen: nothing is pressed', () => {
    const t = setupDocViewer({ tool: 'Free Draw' });
    t.swatches[6].setAttribute('aria-checked', 'false');
    t.red.setAttribute('aria-checked', 'true');
    t.ctl.scan();
    a.eq(t.red.clicks, 0);
  });

  test('a colour the teacher picks is kept for that tool', () => {
    const t = setupDocViewer({ tool: 'Free Draw', noPalette: true });
    t.doc.body.appendChild(t.palette);
    t.ctl.onClick({ isTrusted: true, target: t.swatches[5] });
    a.not(t.ctl.scan(), 'tool left alone after the teacher’s own choice');
    a.eq(t.red.clicks, 0);
  });

  test('setting off: nothing pressed', () => {
    const t = setupDocViewer({ tool: 'Free Draw', off: true });
    a.not(t.ctl.scan());
    a.eq(t.red.clicks, 0);
  });

  test('a swatch with no label is told red by its colour', () => {
    a.ok(globalThis.CGP.annotationColor.isRed('rgb(229, 30, 37)'));
    a.ok(globalThis.CGP.annotationColor.isRed('#ff0000'));
    a.not(globalThis.CGP.annotationColor.isRed('rgb(255, 140, 0)'), 'orange');
    a.not(globalThis.CGP.annotationColor.isRed('rgb(255, 192, 203)'), 'pink');
    a.not(globalThis.CGP.annotationColor.isRed('rgb(0, 142, 226)'), 'blue');
  });
});
