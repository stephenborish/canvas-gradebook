/* Tests for SpeedGrader's tidy sidebar (speedgrader/sidebar-layout.js): the
 * sections are found by what they hold, with or without Canvas's ids. */
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

function load() {
  loadGradebookDom();
  const doc = domshim.install();
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src/speedgrader/sidebar-layout.js'), 'utf8'),
    { filename: 'sidebar-layout.js' });
  return doc;
}

function ctl(on) {
  const settings = { values: { speedgraderTidyComments: on !== false }, onChange() {} };
  return new globalThis.CGP.SpeedGraderSidebarLayout({ settings });
}

/* Canvas's open-source template: ids everywhere. */
function classic(doc) {
  const file = el('div', { class: 'submission-file' }, [el('a', { class: 'display_name', href: '#', text: 'Scan_1.pdf' })]);
  const details = el('div', { id: 'submission_details', class: 'content_box' }, [
    el('div', {}, [el('div', { id: 'multiple_submissions' }, [el('b', { text: 'Submitted:' }), el('span', { text: 'Oct 25' })])]),
    el('div', { id: 'submission_word_count' }, [el('b', { text: 'Word Count:' }), el('span', { text: '0' })]),
    el('div', { id: 'submission_files_container' }, [el('label', { text: 'Submitted Files:' }), el('div', { id: 'submission_files_list' }, [file])])
  ]);
  const heading = el('h2', { class: 'gradebookHeader--rightside', text: 'Assessment' });
  const gradeLabel = el('div', { id: 'grading-box-points-possible', text: 'Grade out of 6' });
  const grading = el('div', { class: 'content_box' }, [el('div', { id: 'grading' }, [heading,
    el('div', { id: 'grade_container' }, [el('label', {}, [gradeLabel, el('input', { id: 'grading-box-extended' })])])])]);
  const comHeading = el('h2', { text: 'Assignment Comments' });
  const reassign = el('button', { id: 'reassign_assignment', text: 'Reassign Assignment' });
  const reWrap = el('div', { id: 'reassign_assignment_wrapper' }, [reassign]);
  const comments = el('div', { class: 'content_box' }, [comHeading,
    el('div', { id: 'discussion' }, [el('div', { id: 'comments' }), el('form', { id: 'add_a_comment' }, [
      el('div', { id: 'speedgrader_comment_textarea_mount_point' }), el('button', { id: 'comment_submit_button', text: 'Submit' })])]),
    reWrap]);
  const inner = el('div', { id: 'rightside_inner' }, [el('div', { class: 'secondary_mount_point_container' }), details, grading, comments]);
  doc.body.appendChild(el('div', { id: 'right_side' }, [inner]));
  return { inner, details, grading, comments, heading, comHeading, gradeLabel, file, reWrap };
}

/* No ids at all: what a newer SpeedGrader draws. */
function idless(doc) {
  const sub = el('section', {}, [
    el('p', {}, [el('strong', { text: 'Submitted:' }), el('span', { text: 'Oct 18 at 8:55 PM' })]),
    el('p', {}, [el('strong', { text: 'Word Count:' }), el('span', { text: '0' })]),
    el('div', {}, [el('strong', { text: 'Submitted Files:' }), el('ul', {}, [el('li', {}, [el('a', { href: '/files/1', text: 'IMG_6651.pdf' })])])])
  ]);
  const heading = el('h3', { text: 'Assessment' });
  const gradeLabel = el('span', { text: 'Grade out of 6' });
  const statusLabel = el('span', { text: 'Status' });
  const assess = el('section', {}, [heading, el('div', {}, [el('label', {}, [gradeLabel, el('input')]),
    el('label', {}, [statusLabel, el('input', { role: 'combobox' })])])]);
  const comHeading = el('h3', { text: 'Assignment Comments' });
  const comments = el('section', {}, [comHeading, el('div', { class: 'rce' })]);
  const download = el('a', { href: '#', text: 'Download Submission Comments' });
  const foot = el('div', {}, [download]);
  const col = el('div', { class: 'col' }, [sub, assess, comments, foot]);
  doc.body.appendChild(el('aside', {}, [col]));
  return { col, sub, assess, comments, heading, comHeading, gradeLabel, statusLabel, foot };
}

suite('SpeedGrader tidy sidebar', (test) => {
  test('Canvas’s classic markup: panel, three cards, headings, file row, label, footer', () => {
    const doc = load();
    const t = classic(doc);
    const c = ctl();
    c.start();
    a.ok(has(t.inner, 'data-cgp-sg-panel'), 'panel');
    a.eq(t.details.getAttribute('data-cgp-sg-card'), 'submission');
    a.eq(t.grading.getAttribute('data-cgp-sg-card'), 'assessment');
    a.eq(t.comments.getAttribute('data-cgp-sg-card'), 'comments');
    a.ok(has(t.heading, 'data-cgp-sg-heading') && has(t.comHeading, 'data-cgp-sg-heading'), 'headings');
    a.ok(has(t.file, 'data-cgp-sg-file'), 'file row');
    a.ok(has(t.gradeLabel, 'data-cgp-sg-label'), 'grade label');
    a.ok(has(t.reWrap, 'data-cgp-sg-foot'), 'reassign in the footer');
  });

  test('no Canvas ids: found by their text all the same', () => {
    const doc = load();
    const t = idless(doc);
    ctl().start();
    a.ok(has(t.col, 'data-cgp-sg-panel'), 'panel');
    a.eq(t.sub.getAttribute('data-cgp-sg-card'), 'submission');
    a.eq(t.assess.getAttribute('data-cgp-sg-card'), 'assessment');
    a.eq(t.comments.getAttribute('data-cgp-sg-card'), 'comments');
    a.ok(has(t.heading, 'data-cgp-sg-heading'));
    a.ok(has(t.gradeLabel, 'data-cgp-sg-label') && has(t.statusLabel, 'data-cgp-sg-label'), 'both labels match');
    a.ok(t.sub.querySelector('li').getAttribute('data-cgp-sg-file') !== null, 'file row');
    a.ok(has(t.foot, 'data-cgp-sg-foot'), 'download in the footer');
    a.not(has(t.foot, 'data-cgp-sg-card'), 'the footer is no card');
  });

  test('setting off: every tag removed; no sidebar: nothing tagged', () => {
    const doc = load();
    const t = classic(doc);
    const c = ctl();
    c.start();
    c.settings.values.speedgraderTidyComments = false;
    c.apply();
    a.eq(doc.querySelectorAll('[data-cgp-sg-card], [data-cgp-sg-panel], [data-cgp-sg-heading], [data-cgp-sg-file]').length, 0);
    a.not(has(t.inner, 'data-cgp-sg-panel'));
    const doc2 = load();
    doc2.body.appendChild(el('div', {}, [el('h2', { text: 'Assessment' })]));
    a.eq(ctl().scan(), null, 'one section alone is not a sidebar');
  });

  test('Canvas redraws a section: the old node loses its tag, the new one gets it', () => {
    const doc = load();
    const t = classic(doc);
    const c = ctl();
    c.start();
    const old = t.grading;
    const fresh = el('div', { class: 'content_box' }, [el('div', { id: 'grading' }, [el('h2', { text: 'Assessment' })])]);
    t.inner.insertBefore(fresh, old);
    old.remove();
    c.scan();
    a.eq(fresh.getAttribute('data-cgp-sg-card'), 'assessment');
  });
});

suite('content-script lists', (test) => {
  test('manifest.json and script-manifest.js (self-hosted Canvas) list the same scripts in the same order', () => {
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const src = fs.readFileSync(path.join(root, 'src/script-manifest.js'), 'utf8');
    const block = /export const CONTENT_JS = \[([\s\S]*?)\];/.exec(src);
    a.ok(block, 'CONTENT_JS found');
    const dynamic = block[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
    const entry = manifest.content_scripts.find((cs) => (cs.js || []).indexOf('src/gradebook/content.js') >= 0);
    a.deep(dynamic, entry.js);
  });
});
