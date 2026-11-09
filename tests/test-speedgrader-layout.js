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

  test('one footer bar under the editor: the three tools and Submit, each pressing Canvas’s own', () => {
    const t = setupSg();
    t.ctl.start();
    const bars = t.doc.querySelectorAll('.cgp-sgbar');
    a.eq(bars.length, 1, 'one bar');
    const bar = bars[0];
    a.ok(t.mount.nextSibling === bar, 'right after the editor’s mount point');
    a.ok(has(t.mount, 'data-cgp-sg-composer'), 'mount joined to the bar');
    a.ok(has(t.row, 'data-cgp-sg-proxied'), 'Canvas’s row hidden: it holds only what the bar stands in for');
    const tools = bar.querySelectorAll('.cgp-sgbar__tool');
    a.deep(tools.map((b) => b.getAttribute('data-kind')), ['attach', 'media', 'speech']);
    const counts = { attach: 0, media: 0, speech: 0, submit: 0 };
    t.attach.addEventListener('click', () => { counts.attach++; });
    t.media.addEventListener('click', () => { counts.media++; });
    t.speech.addEventListener('click', () => { counts.speech++; });
    t.submit.addEventListener('click', () => { counts.submit++; });
    tools.forEach((b) => b.click());
    bar.querySelector('.cgp-sgbar__submit').click();
    a.deep(counts, { attach: 1, media: 1, speech: 1, submit: 1 });
    a.eq(bar.querySelector('.cgp-sgbar__submit').textContent, 'Submit Comment');
    t.ctl.scan();
    a.eq(t.doc.querySelectorAll('.cgp-sgbar').length, 1, 're-scans never add another');
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
    a.eq(t.doc.querySelectorAll('.cgp-sgbar').length, 0, 'setting off removes the bar');
    a.not(has(t.row, 'data-cgp-sg-proxied'), 'and shows Canvas’s row again');
  });

  test('each tool gets its own icon: "upload" in the media label never makes it a second paperclip', () => {
    const t = setupSg();
    // Canvas's real markup: icon-font classes, titles, screen-reader text.
    [[t.attach, 'icon-paperclip', 'File Attachment'], [t.media, 'icon-media', 'Record/Upload Media Comment'],
      [t.speech, 'icon-audio', 'Speech Recognition']].forEach(([b, icon, title]) => {
      b.removeAttribute('aria-label');
      b.setAttribute('title', title);
      b.appendChild(el('i', { class: icon }));
      b.appendChild(el('span', { class: 'screenreader-only', text: title }));
    });
    t.ctl.start();
    const kinds = t.doc.querySelectorAll('.cgp-sgbar__tool').map((b) => b.getAttribute('data-kind'));
    a.deep(kinds, ['attach', 'media', 'speech']);
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('no id or icon to go by and labels that all say "upload": no two tools share an icon', () => {
    const t = setupSg();
    [t.attach, t.media, t.speech].forEach((b, i) => {
      b.removeAttribute('id');
      b.setAttribute('aria-label', 'Upload ' + i);
      b.appendChild(el('svg', { class: 'own-' + i }));
    });
    t.ctl.start();
    const tools = t.doc.querySelectorAll('.cgp-sgbar__tool');
    a.eq(tools.length, 3);
    a.eq(tools.filter((b) => b.getAttribute('data-kind') === 'attach').length, 1, 'one paperclip');
    a.ok(tools[1].querySelector('.own-1') && tools[2].querySelector('.own-2'), 'the others keep Canvas’s own icons');
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('posted comments keep Canvas’s Edit and Delete: never tagged, proxied or hidden', () => {
    const t = setupSg();
    const edit = el('a', { class: 'edit_comment_link icon-edit', href: 'javascript:void 0;' }, [el('span', { class: 'screenreader-only', text: 'Edit comment' })]);
    const del = el('a', { class: 'delete_comment_link icon-x', href: 'javascript:void 0;' }, [el('span', { class: 'screenreader-only', text: 'Delete comment' })]);
    const publish = el('button', { class: 'submit_comment_button' }, [el('span', { text: 'Submit' })]);
    t.comments.appendChild(el('div', { class: 'comment' }, [
      el('div', { class: 'comment_flex' }, [el('span', { class: 'comment', text: 'Nice work' }), edit, publish, del])]));
    t.ctl.start();
    t.ctl.scan();
    [edit, del, publish].forEach((n) => {
      ['data-cgp-sg-tool', 'data-cgp-sg-proxied', 'data-cgp-sg-submit', 'data-cgp-tray-hide'].forEach((attr) =>
        a.not(has(n, attr), n.className + ' has no ' + attr));
    });
    let clicks = 0;
    t.submit.addEventListener('click', () => { clicks++; });
    t.doc.querySelector('.cgp-sgbar__submit').click();
    a.eq(clicks, 1, 'the bar’s Submit still posts through Canvas’s, not a comment’s Submit');
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('Canvas swaps in new, identical tool nodes: the bar presses the new ones', () => {
    const t = setupSg();
    t.ctl.start();
    const fresh = el('button', { id: 'add_attachment', 'aria-label': 'Attach file' });
    let clicks = 0;
    fresh.addEventListener('click', () => { clicks++; });
    t.row.insertBefore(fresh, t.attach);
    t.attach.remove();
    t.ctl.scan();
    t.doc.querySelector('.cgp-sgbar__tool[data-kind="attach"]').click();
    a.eq(clicks, 1);
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('found by its text: our own Submit is never taken for Canvas’s', () => {
    const t = setupSg();
    t.submit.removeAttribute('id');
    t.ctl.start();
    t.ctl.scan(); t.ctl.scan();
    const bar = t.doc.querySelector('.cgp-sgbar');
    a.not(has(bar, 'data-cgp-sg-proxied'), 'the bar is not hidden');
    a.not(has(bar, 'data-cgp-sg-actions'), 'the bar is not taken for Canvas’s row');
    a.ok(has(t.row, 'data-cgp-sg-proxied'), 'Canvas’s row still the one hidden');
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('a tool Canvas hides is left out; a disabled Submit is disabled on the bar too', () => {
    const t = setupSg();
    t.speech.style.display = 'none';
    t.submit.setAttribute('disabled', '');
    t.ctl.start();
    const bar = t.doc.querySelector('.cgp-sgbar');
    a.eq(bar.querySelectorAll('.cgp-sgbar__tool').length, 2);
    a.ok(has(bar.querySelector('.cgp-sgbar__submit'), 'disabled'));
    t.ctl.apply.call(Object.assign(t.ctl, { settings: { values: {} } }));
  });

  test('a row holding more than the tools (a file field): only the controls are hidden', () => {
    const t = setupSg();
    t.row.appendChild(el('input', { type: 'file' }));
    t.ctl.start();
    a.not(has(t.row, 'data-cgp-sg-proxied'));
    [t.attach, t.media, t.speech, t.submit].forEach((b) => a.ok(has(b, 'data-cgp-sg-proxied')));
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

  function withTrigger(t, opts) {
    t.ctl.schedule = () => {};
    const trigger = el('button', { 'aria-label': (opts && opts.label) || 'Color', 'aria-haspopup': 'true' });
    trigger.clicks = 0;
    trigger.addEventListener('click', () => {
      trigger.clicks++;
      if (t.palette.parentElement) t.palette.remove(); else t.doc.body.appendChild(t.palette);
    });
    t.tools[0].parentElement.appendChild(trigger);
    return trigger;
  }

  test('Free Draw chosen with the palette closed: it is opened, red pressed, and closed again', () => {
    const t = setupDocViewer({ tool: 'Free Draw', noPalette: true });
    const trigger = withTrigger(t);
    t.ctl.scan();
    a.eq(trigger.clicks, 1, 'colour button pressed to open the palette');
    a.ok(t.palette.parentElement, 'palette open');
    t.ctl.scan();
    a.eq(t.red.clicks, 1, 'red pressed');
    for (let i = 0; i < 4; i++) t.ctl.scan();
    a.not(t.palette.parentElement, 'palette closed again');
    a.eq(t.red.clicks, 1, 'red pressed only once');
    t.ctl.scan();
    a.eq(trigger.clicks, 2, 'nothing more once done');
  });

  test('palette that closes itself on a pick: not toggled open again', () => {
    const t = setupDocViewer({ tool: 'Point', noPalette: true });
    const trigger = withTrigger(t);
    t.red.addEventListener('click', () => t.palette.remove());
    t.ctl.scan();
    t.ctl.scan();
    a.eq(t.red.clicks, 1);
    t.ctl.scan(); t.ctl.scan();
    a.eq(trigger.clicks, 1, 'opened once, never re-opened');
    a.not(t.palette.parentElement);
  });

  test('colour button already red: nothing opened', () => {
    const t = setupDocViewer({ tool: 'Free Draw', noPalette: true });
    const trigger = withTrigger(t, { label: 'Color: Red' });
    t.ctl.scan();
    a.eq(trigger.clicks, 0);
  });

  test('switching back to Free Draw later sets red again on its activation', () => {
    const t = setupDocViewer({ tool: 'Free Draw', noPalette: true });
    const trigger = withTrigger(t);
    t.ctl.scan(); t.ctl.scan();
    for (let i = 0; i < 4; i++) t.ctl.scan();
    t.tools[5].setAttribute('aria-pressed', 'false');
    t.tools[2].setAttribute('aria-pressed', 'true');   // Highlight
    t.ctl.scan();
    a.eq(trigger.clicks, 2, 'highlight left alone');
    t.tools[2].setAttribute('aria-pressed', 'false');
    t.tools[5].setAttribute('aria-pressed', 'true');
    t.ctl.scan();
    a.eq(trigger.clicks, 3, 'Free Draw again: palette opened again');
  });

  /* DocViewer's real swatches: <button class="ColorButton" aria-label=
   * "Annotation markup color Red" title="Red"><div class="ColorButton-inner">
   * <svg><circle fill="#EE0612"/></svg></div></button>, each in a box. */
  function colorButton(name, fill) {
    const b = el('button', { class: 'ColorButton', 'aria-label': 'Annotation markup color ' + name, title: name }, [
      el('div', { class: 'ColorButton-inner' }, [el('svg', {}, [el('circle', { class: 'ColorButton-main-circle', fill })])])
    ]);
    b.clicks = 0;
    b.addEventListener('click', () => { b.clicks++; });
    return b;
  }
  const DV_COLORS = [['Red', '#EE0612'], ['Orange', '#FC5E13'], ['Yellow', '#FCB900'], ['Green', '#00AC18'],
    ['Blue', '#008EE2'], ['Purple', '#8D3AB3'], ['Pink', '#FF0080'], ['Black', '#000000']];

  test('DocViewer ColorButtons ("Annotation markup color Red"), each in its own box: red is pressed', () => {
    const t = setupDocViewer({ tool: 'Free Draw', noPalette: true });
    const swatches = DV_COLORS.map(([n, f]) => colorButton(n, f));
    t.doc.body.appendChild(el('div', { class: 'ColorPalette' }, swatches.map((s) => el('div', { class: 'cell' }, [s]))));
    const p = globalThis.CGP.annotationColor.findPalette(t.doc);
    a.ok(p, 'palette found');
    a.eq(p.swatches.length, 8);
    a.ok(p.red === swatches[0], 'red is the Red ColorButton');
    t.ctl.scan();
    a.eq(swatches[0].clicks, 1, 'red pressed');
    a.eq(swatches[4].clicks, 0);
  });

  test('DocViewer: palette closed behind the current-colour button: opened, red pressed, closed', () => {
    const t = setupDocViewer({ tool: 'Point', noPalette: true });
    t.ctl.schedule = () => {};
    const swatches = DV_COLORS.map(([n, f]) => colorButton(n, f));
    const palette = el('div', { class: 'ColorPalette' }, swatches.map((s) => el('div', {}, [s])));
    const trigger = colorButton('Blue', '#008EE2');
    trigger.addEventListener('click', () => {
      if (palette.parentElement) palette.remove(); else t.doc.body.appendChild(palette);
    });
    swatches[0].addEventListener('click', () => palette.remove());
    t.tools[0].parentElement.appendChild(trigger);
    t.ctl.scan();
    a.eq(trigger.clicks, 1, 'palette opened');
    t.ctl.scan();
    a.eq(swatches[0].clicks, 1, 'red pressed');
    t.ctl.scan(); t.ctl.scan();
    a.not(palette.parentElement, 'palette closed');
    a.eq(trigger.clicks, 1);
  });

  test('a ColorButton that is pressed is never taken for the active tool', () => {
    const t = setupDocViewer({ tool: 'Select', noPalette: true });
    const b = colorButton('Red', '#EE0612');
    b.setAttribute('aria-pressed', 'true');
    t.doc.body.appendChild(b);
    a.eq(globalThis.CGP.annotationColor.activeTool(t.doc), null);
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
