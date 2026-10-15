/* Regression tests for the comment UI fixes:
 *   - comment popover: a slow save never re-renders/rewires a popover that has
 *     moved on to another student; Ctrl/Cmd+Enter cannot double-post; unsent
 *     replies survive closing; Tab is only kept for a real snippet expansion.
 *   - bulk comment: partial failure keeps the dialog aimed at only the failed
 *     cells; a session-expired error stops the batch; no close while saving.
 *   - SpeedGrader drafts: saved under the key captured at input time and
 *     flushed on student change; "posted" confirmed only by a NEW comment
 *     node; the global snippet Tab handler only on grading pages.
 *   - comment analysis: a name match never overrides a real author id.
 *   - course menu: only positively identified toggles; cached lookup; tab
 *     hrefs validated.
 *
 * domshim deliberately has no events and no innerHTML parsing, so this file
 * adds both, locally, to the elements it creates (see enhance()). */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

const ROOT = path.resolve(__dirname, '..');
const FakeElement = domshim.FakeElement;

/* ------------------------------------------------------------ test helpers */

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Gives a FakeElement listeners, focus/selection stubs, matches() and an
 * innerHTML setter that builds real (fake) child elements. */
function enhance(el) {
  el._listeners = {};
  el.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
  el.removeEventListener = function () {};
  el.focus = function () {};
  el.dispatchEvent = function () { return true; };
  el.setSelectionRange = function (s) { this.selectionStart = s; this.selectionEnd = s; };
  el.matches = function (sel) { return this.closest(sel) === this; };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return html; },
    set(v) {
      html = String(v);
      this.children.slice().forEach((c) => this.removeChild(c));
      this._text = '';
      const stack = [this];
      const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
      let m;
      while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[4] !== undefined) { top._text = (top._text || '') + decode(m[4]); continue; }
        if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); continue; }
        const child = enhance(new FakeElement(m[1]));
        const attrRe = /([^\s=]+)(?:="([^"]*)")?/g;
        let am;
        while ((am = attrRe.exec(m[2] || ''))) {
          const val = am[2] === undefined ? '' : decode(am[2]);
          if (am[1] === 'class') child.className = val; else child.setAttribute(am[1], val);
        }
        top.appendChild(child);
        if (!m[3] && !VOID.has(m[1].toLowerCase())) stack.push(child);
      }
    }
  });
  return el;
}

function mk(tag, attrs) {
  const el = enhance(new FakeElement(tag));
  Object.keys(attrs || {}).forEach((k) => {
    if (k === 'class') el.className = attrs[k];
    else if (k === 'text') el._text = attrs[k];
    else el.setAttribute(k, attrs[k]);
  });
  return el;
}

function fire(el, type, props) {
  const e = Object.assign({
    type, target: el, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, stopImmediatePropagation() {}
  }, props || {});
  (el._listeners && el._listeners[type] || []).slice().forEach((fn) => fn(e));
  return e;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));

/** A fresh fake document whose createElement returns enhanced elements, and
 * a recording CGP.ui / window, all restored by the returned undo(). */
function setupDom(CGP) {
  const doc = domshim.install();
  doc.createElement = (tag) => enhance(new FakeElement(tag));
  const origUi = CGP.ui;
  const origWindow = global.window;
  const said = [];
  CGP.ui = {
    toast: (m) => said.push({ level: 'info', text: String(m) }),
    error: (m) => said.push({ level: 'error', text: String(m) })
  };
  global.window = { addEventListener() {}, innerWidth: 1200, innerHeight: 800, confirm: () => true };
  return { doc, said, undo() { CGP.ui = origUi; global.window = origWindow; } };
}

let popoverLoaded = false;
function loadPopover() {
  const CGP = loadGradebookDom();
  if (!popoverLoaded) {
    popoverLoaded = true;
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/gradebook/comment-popover.js'), 'utf8'),
      { filename: 'src/gradebook/comment-popover.js' });
  }
  return CGP;
}

function popoverFixture(CGP, snippets) {
  const names = { A: 'Alice Able', B: 'Bob Baker' };
  const calls = [];
  const pending = [];
  const writer = {
    addComment(assignmentId, userId, text) {
      calls.push({ assignmentId, userId, text });
      const d = deferred();
      pending.push(d);
      return d.promise;
    }
  };
  const paints = [];
  const model = {
    courseId: '5', instructorId: '900',
    cell: () => ({ commentList: [] }),
    student: (id) => ({ name: names[id] }),
    assignment: () => ({ name: 'Lab 1' })
  };
  const adapter = { viewports: () => [], cellInfo: () => null, activateCell() {} };
  const ctrl = new CGP.CommentPopoverController({
    model, adapter, writer,
    settings: { values: { commentPopover: true, snippets: snippets || [] } },
    requestPaint: () => paints.push(1)
  });
  const cell = (studentId) => ({ assignmentId: 'a1', studentId, el: mk('div').setRect({ left: 10, top: 10, width: 80, height: 30 }) });
  const q = (sel) => ctrl.el.querySelector(sel);
  const type = (text) => { const i = q('.cgp-pop__input'); i.value = text; i.selectionStart = text.length; fire(i, 'input'); return i; };
  return { ctrl, calls, pending, paints, cell, q, type, adapter };
}

/* -------------------------------------------------------- comment popover */

suite('comment popover: slow saves, double submit, drafts, Tab', (test) => {
  test('a save for A that resolves after B was opened never renders A into B\'s popover', async () => {
    const CGP = loadPopover();
    const env = setupDom(CGP);
    try {
      const f = popoverFixture(CGP);
      f.ctrl.open(f.cell('A'));
      f.type('Nice work on the hypothesis');
      fire(f.q('.cgp-pop__save'), 'click');
      a.eq(f.calls.length, 1);

      f.ctrl.open(f.cell('B'));
      a.eq(f.q('.cgp-pop__who').textContent, 'Bob Baker', 'B is showing');
      f.pending[0].resolve({ id: 1 });
      await flush();

      a.eq(f.q('.cgp-pop__who').textContent, 'Bob Baker', 'still B after A\'s save resolved');
      a.ok(env.said.some((s) => s.level === 'info' && s.text === 'Comment saved for Alice Able'), 'toast names A');
      a.ok(f.paints.length >= 1, 'repaint requested');

      // B's Save is wired to B, not A.
      f.type('Check your units');
      fire(f.q('.cgp-pop__save'), 'click');
      a.eq(f.calls.length, 2);
      a.eq(f.calls[1].userId, 'B', 'second save went to B');
    } finally { env.undo(); }
  });

  test('a stale failure names the student and keeps the text in that cell\'s draft', async () => {
    const CGP = loadPopover();
    const env = setupDom(CGP);
    try {
      const f = popoverFixture(CGP);
      f.ctrl.open(f.cell('A'));
      f.type('Please resubmit');
      fire(f.q('.cgp-pop__save'), 'click');
      f.ctrl.open(f.cell('B'));
      f.pending[0].reject({ status: 500 });
      await flush();

      a.eq(f.q('.cgp-pop__who').textContent, 'Bob Baker', 'B untouched');
      const err = env.said.find((s) => s.level === 'error');
      a.ok(err && err.text.indexOf('Alice Able') >= 0, 'error names A: ' + (err && err.text));
      a.ok(err.text.indexOf('Canvas rejected that comment') >= 0, 'uses describeApiError wording');

      f.ctrl.open(f.cell('A'));
      a.eq(f.q('.cgp-pop__input').value, 'Please resubmit', 'A\'s text restored on reopen');
    } finally { env.undo(); }
  });

  test('Ctrl+Enter twice (or held) posts once; a failure re-enables the box', async () => {
    const CGP = loadPopover();
    const env = setupDom(CGP);
    try {
      const f = popoverFixture(CGP);
      f.ctrl.open(f.cell('A'));
      const input = f.type('Good');
      fire(input, 'keydown', { key: 'Enter', ctrlKey: true });
      a.eq(input.readOnly, true, 'read-only while saving');
      fire(input, 'keydown', { key: 'Enter', ctrlKey: true });
      fire(input, 'keydown', { key: 'Enter', metaKey: true, repeat: true });
      fire(f.q('.cgp-pop__save'), 'click');
      a.eq(f.calls.length, 1, 'only one addComment');

      f.pending[0].reject(new Error('Comments are disabled for anonymous assignments'));
      await flush();
      a.eq(input.readOnly, false, 'editable again after failure');
      a.eq(input.value, 'Good', 'text kept');
      const err = env.said.find((s) => s.level === 'error');
      a.ok(err && err.text.indexOf('anonymous') >= 0, 'extension refusal message shown as-is');

      fire(input, 'keydown', { key: 'Enter', ctrlKey: true, repeat: true });
      a.eq(f.calls.length, 1, 'auto-repeat never submits');
      fire(input, 'keydown', { key: 'Enter', ctrlKey: true });
      a.eq(f.calls.length, 2, 'a fresh press retries');
    } finally { env.undo(); }
  });

  test('an unsent reply survives close and reopen; a successful save clears it', async () => {
    const CGP = loadPopover();
    const env = setupDom(CGP);
    try {
      const f = popoverFixture(CGP);
      f.ctrl.open(f.cell('A'));
      f.type('Half a thought');
      f.ctrl.close();
      f.ctrl.open(f.cell('B'));
      a.eq(f.q('.cgp-pop__input').value || '', '', 'B has no draft');
      f.ctrl.open(f.cell('A'));
      a.eq(f.q('.cgp-pop__input').value, 'Half a thought', 'A\'s draft restored');
      fire(f.q('.cgp-pop__save'), 'click');
      f.pending[0].resolve({});
      await flush();
      a.eq(f.q('.cgp-pop__input').value || '', '', 'cleared after save');
      a.eq(f.ctrl.drafts['a1:A'], undefined, 'draft deleted');
    } finally { env.undo(); }
  });

  test('Tab is only swallowed when a snippet actually expands', () => {
    const CGP = loadPopover();
    const env = setupDom(CGP);
    try {
      const f = popoverFixture(CGP, [{ trigger: 'gj', text: 'Good job!' }]);
      f.ctrl.open(f.cell('A'));
      let input = f.type('see and/or');
      let e = fire(input, 'keydown', { key: 'Tab' });
      a.eq(e.defaultPrevented, false, '"/or" with no snippet lets Tab move focus');
      input = f.type('https://example.com/page');
      e = fire(input, 'keydown', { key: 'Tab' });
      a.eq(e.defaultPrevented, false, 'a URL lets Tab move focus');
      input = f.type('Overall /gj');
      e = fire(input, 'keydown', { key: 'Tab' });
      a.eq(e.defaultPrevented, true, 'a real snippet keeps Tab');
      a.eq(input.value, 'Overall Good job!');
    } finally { env.undo(); }
  });

  test('preview click refuses a recycled cell before activating it', () => {
    const CGP = loadPopover();
    const env = setupDom(CGP);
    try {
      const f = popoverFixture(CGP);
      let activated = 0, opened = 0;
      f.adapter.activateCell = () => { activated++; };
      f.ctrl.openSidePane = () => { opened++; };
      const info = f.cell('A');
      env.doc.body.appendChild(info.el);
      f.adapter.cellInfo = () => ({ assignmentId: 'a1', studentId: 'B' });
      f.ctrl._previewInfo = info;
      f.ctrl.openPaneFromPreview();
      a.eq(activated + opened, 0, 'recycled cell not activated');
      f.adapter.cellInfo = () => ({ assignmentId: 'a1', studentId: 'A' });
      f.ctrl._previewInfo = info;
      f.ctrl.openPaneFromPreview();
      a.eq(activated, 1, 'same cell activated');
      a.eq(opened, 1, 'side pane opened');
    } finally { env.undo(); }
  });
});

/* ----------------------------------------------------------- bulk comment */

suite('bulk comment: partial failure, session expiry, busy close', (test) => {
  function bulkFixture(CGP, behaviour) {
    const calls = [];
    const writer = {
      addComment(assignmentId, userId, text) {
        calls.push({ assignmentId, userId, text });
        return behaviour(userId, calls.length);
      }
    };
    const ctrl = new CGP.BulkCommentController({
      model: {}, writer, settings: { values: { bulkConfirmThreshold: 100, snippets: [] } }, requestPaint() {}
    });
    return { ctrl, calls };
  }
  const targets = (ids) => ids.map((u) => ({ assignmentId: 'a1', userId: u }));

  test('partial failure keeps the dialog open, aimed only at the failed cells', async () => {
    const CGP = loadGradebookDom();
    const env = setupDom(CGP);
    try {
      let failU2 = true;
      const f = bulkFixture(CGP, (u) => (u === 'u2' && failU2 ? Promise.reject({ status: 500 }) : Promise.resolve({})));
      f.ctrl.open(targets(['u1', 'u2', 'u3']));
      const input = f.ctrl.el.querySelector('.cgp-pop__input');
      const save = f.ctrl.el.querySelector('.cgp-pop__save');
      input.value = 'See rubric';
      fire(save, 'click');
      await flush(); await flush();

      a.ok(f.ctrl.isOpen(), 'still open after partial failure');
      a.eq(input.value, 'See rubric', 'text kept');
      a.deep(f.ctrl.targets.map((t) => t.userId), ['u2'], 'only the failed target remains');
      a.eq(save.textContent, 'Retry 1 failed');
      a.eq(save.disabled, false);
      const err = env.said.find((s) => s.level === 'error');
      a.ok(err && /1 of 3/.test(err.text) && err.text.indexOf('Canvas rejected that comment') >= 0, err && err.text);

      failU2 = false;
      fire(save, 'click');
      await flush(); await flush();
      a.deep(f.calls.map((c) => c.userId), ['u1', 'u2', 'u3', 'u2'], 'retry re-sent only u2');
      a.eq(f.ctrl.isOpen(), false, 'closed after full success');
    } finally { env.undo(); }
  });

  test('a session-expired error stops sending the remaining targets', async () => {
    const CGP = loadGradebookDom();
    const env = setupDom(CGP);
    try {
      const f = bulkFixture(CGP, (u) => (u === 'u1' ? Promise.reject({ status: 401 }) : new Promise((r) => setTimeout(() => r({}), 5))));
      f.ctrl.open(targets(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']));
      f.ctrl.el.querySelector('.cgp-pop__input').value = 'Hi';
      fire(f.ctrl.el.querySelector('.cgp-pop__save'), 'click');
      await new Promise((r) => setTimeout(r, 40));
      a.eq(f.calls.length, 3, 'only the three already in flight were sent');
      a.deep(f.ctrl.targets.map((t) => t.userId), ['u1', 'u4', 'u5', 'u6'], 'unsent ones kept for retry');
      a.ok(f.ctrl.isOpen(), 'dialog stays open');
    } finally { env.undo(); }
  });

  test('closing while saving is refused; the batch then finishes cleanly', async () => {
    const CGP = loadGradebookDom();
    const env = setupDom(CGP);
    try {
      const d = deferred();
      const f = bulkFixture(CGP, () => d.promise);
      f.ctrl.open(targets(['u1']));
      const input = f.ctrl.el.querySelector('.cgp-pop__input');
      input.value = 'Hi';
      fire(input, 'keydown', { key: 'Enter', ctrlKey: true });
      a.eq(input.readOnly, true, 'read-only while saving');
      a.eq(f.ctrl.close(), false, 'close refused while busy');
      a.ok(f.ctrl.isOpen(), 'still open');
      fire(input, 'keydown', { key: 'Enter', ctrlKey: true });
      await flush();
      a.eq(f.calls.length, 1, 'no second batch');
      d.resolve({});
      await flush(); await flush();
      a.eq(f.ctrl.busy, false);
      a.eq(f.ctrl.isOpen(), false, 'closed on success');
      f.ctrl.open(targets(['u9']));
      a.ok(f.ctrl.isOpen(), 'next open works');
    } finally { env.undo(); }
  });

  test('bulk Tab: an unmatched /word does not trap focus', () => {
    const CGP = loadGradebookDom();
    const env = setupDom(CGP);
    try {
      const f = bulkFixture(CGP, () => Promise.resolve({}));
      f.ctrl.open(targets(['u1']));
      const input = f.ctrl.el.querySelector('.cgp-pop__input');
      input.value = 'and/or'; input.selectionStart = 6;
      a.eq(fire(input, 'keydown', { key: 'Tab' }).defaultPrevented, false);
    } finally { env.undo(); }
  });
});

/* ---------------------------------------------------- SpeedGrader drafts */

function speedGraderEnv(opts) {
  opts = opts || {};
  const timers = [];
  let now = 0, nextId = 1;
  const addTimer = (fn, ms, every) => { const id = nextId++; timers.push({ id, fn, at: now + (ms || 0), every }); return id; };
  const clear = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every; else clear(due.id);
      due.fn();
    }
    now = end;
  }

  const doc = domshim.makeDocument();
  doc.createElement = (tag) => enhance(new FakeElement(tag));
  const docListeners = {};
  doc.addEventListener = (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); };
  const winListeners = {};
  const store = {};
  const removed = [];
  const observers = [];
  const loc = {
    pathname: opts.pathname || '/courses/5/gradebook/speed_grader',
    search: '?assignment_id=9',
    hash: '#' + encodeURIComponent('{"student_id":"11"}'),
    host: 'school.instructure.com',
    origin: 'https://school.instructure.com'
  };
  const win = { addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); } };
  win.top = win; win.self = win;
  const CGPx = {
    settings: { values: { speedgraderDrafts: true, snippets: opts.snippets || [] } },
    diag: { bump() {}, log() {}, warn() {}, error() {} },
    ui: { error() {}, toast() {} },
    util: {}
  };
  const ctx = {
    console, URL, WeakSet, Promise,
    setTimeout: (fn, ms) => addTimer(fn, ms), clearTimeout: clear,
    setInterval: (fn, ms) => addTimer(fn, ms, ms), clearInterval: clear,
    document: doc, window: win, location: loc,
    chrome: { storage: { local: {
      set(p) { Object.assign(store, p); return Promise.resolve(); },
      remove(k) { removed.push(k); delete store[k]; return Promise.resolve(); },
      get(k) { const o = {}; if (store[k]) o[k] = store[k]; return Promise.resolve(o); }
    } } },
    MutationObserver: function (cb) { this.cb = cb; this.observe = () => {}; this.disconnect = () => {}; observers.push(this); },
    NodeFilter: { SHOW_TEXT: 4 },
    InputEvent: function () {},
    HTMLTextAreaElement: function () {},
    HTMLInputElement: function () {},
    CGP: CGPx
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/snippets.js'), 'utf8'), ctx, { filename: 'src/core/snippets.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/speedgrader/content.js'), 'utf8'), ctx, { filename: 'src/speedgrader/content.js' });

  const docFire = (type, target, props) => {
    const e = Object.assign({
      type, target, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}
    }, props || {});
    (docListeners[type] || []).slice().forEach((fn) => fn(e));
    return e;
  };
  const setStudent = (id) => {
    loc.hash = '#' + encodeURIComponent('{"student_id":"' + id + '"}');
    (winListeners.hashchange || []).forEach((fn) => fn({}));
  };
  const keyFor = (id) => 'cgp.draft:school.instructure.com:5:9:' + id;
  return { ctx, doc, docListeners, store, removed, observers, advance, docFire, setStudent, keyFor, CGP: CGPx };
}

suite('SpeedGrader drafts and confirmation', (test) => {
  function boot(env) {
    const textarea = mk('textarea', { id: 'speed_grader_comment_textarea' });
    textarea.value = '';
    env.doc.body.appendChild(textarea);
    const comments = mk('div', { id: 'comments' });
    env.doc.body.appendChild(comments);
    const submit = mk('button', { id: 'comment_submit_button' });
    env.doc.body.appendChild(submit);
    const handle = env.CGP.startSpeedGrader('5');
    env.advance(700);   // one startup poll tick: finds and attaches the box
    return { textarea, comments, submit, handle };
  }

  test('typing then moving on quickly saves A\'s text under A\'s key, never B\'s', async () => {
    const env = speedGraderEnv();
    const sg = boot(env);
    env.docFire('focusin', sg.textarea);
    sg.textarea.value = 'Strong conclusion, cite more data';
    env.docFire('input', sg.textarea);
    env.advance(100);
    env.setStudent('12');                 // flushed synchronously here
    a.eq(env.store[env.keyFor('11')] && env.store[env.keyFor('11')].text, 'Strong conclusion, cite more data');
    // Canvas repopulates the reused box for B; the old focus then blurs.
    sg.textarea.value = '';
    env.docFire('focusout', sg.textarea);
    env.advance(1000);                    // debounce window + onStudentChange
    await flush();
    a.eq(env.store[env.keyFor('11')] && env.store[env.keyFor('11')].text, 'Strong conclusion, cite more data',
      'A\'s draft not deleted by the blur after the switch');
    a.eq(env.store[env.keyFor('12')], undefined, 'nothing written under B');
    a.eq(env.removed.indexOf(env.keyFor('12')), -1, 'B\'s draft never deleted');
    a.eq(sg.handle.state.key, env.keyFor('12'), 'state moved to B');

    // Text typed for B goes under B.
    sg.textarea.value = 'For B';
    env.docFire('input', sg.textarea);
    env.advance(450);
    a.eq(env.store[env.keyFor('12')] && env.store[env.keyFor('12')].text, 'For B');
  });

  test('a textarea Canvas replaces after the startup poll still gets drafts', () => {
    const env = speedGraderEnv();
    const sg = boot(env);
    env.advance(61000);                   // poll gone
    sg.textarea.remove();
    const fresh = mk('textarea', { id: 'speed_grader_comment_textarea' });
    fresh.value = '';
    env.doc.body.appendChild(fresh);
    fresh.value = 'New box text';
    env.docFire('input', fresh);
    env.advance(450);
    a.eq(env.store[env.keyFor('11')] && env.store[env.keyFor('11')].text, 'New box text');
    a.eq(sg.handle.state.textarea, fresh);
  });

  test('an identical earlier comment does not confirm; a new one does', () => {
    const env = speedGraderEnv();
    const sg = boot(env);
    sg.comments.appendChild(mk('div', { class: 'comment', text: 'Great work on this lab' }));
    env.docFire('focusin', sg.textarea);
    sg.textarea.value = 'Great work on this lab';
    env.docFire('click', sg.submit);
    a.ok(sg.handle.state.pendingSubmit, 'pending');
    a.eq(sg.handle.checkConfirmation(), false, 'old identical comment does not confirm');
    a.ok(env.store[env.keyFor('11')], 'draft kept');

    sg.comments.appendChild(mk('div', { class: 'comment', text: 'Great work on this lab, really' }));
    a.eq(sg.handle.checkConfirmation(), false, 'a merely similar new comment does not confirm');

    sg.comments.appendChild(mk('div', { class: 'comment', text: '  Great   work on this lab ' }));
    a.eq(sg.handle.checkConfirmation(), true, 'new matching node confirms');
    a.eq(env.store[env.keyFor('11')], undefined, 'draft removed');
  });

  test('no confirmation once SpeedGrader has moved to another student', () => {
    const env = speedGraderEnv();
    const sg = boot(env);
    sg.textarea.value = 'Revise paragraph two';
    env.docFire('click', sg.submit);
    env.setStudent('12');
    sg.comments.appendChild(mk('div', { class: 'comment', text: 'Revise paragraph two' }));
    a.eq(sg.handle.checkConfirmation(), false, 'other student\'s panel never confirms');
    a.ok(env.store[env.keyFor('11')], 'A\'s draft kept');
  });

  test('SpeedGrader Tab: only a real expansion is swallowed', () => {
    const env = speedGraderEnv({ snippets: [{ trigger: 'gj', text: 'Good job' }] });
    const sg = boot(env);
    sg.textarea.value = 'see https://x.org/a'; sg.textarea.selectionStart = sg.textarea.value.length;
    a.eq(env.docFire('keydown', sg.textarea, { key: 'Tab' }).defaultPrevented, false, 'URL: Tab moves on');
    sg.textarea.value = 'and/or'; sg.textarea.selectionStart = 6;
    a.eq(env.docFire('keydown', sg.textarea, { key: 'Tab' }).defaultPrevented, false, 'and/or: Tab moves on');
    sg.textarea.value = 'Nice /gj'; sg.textarea.selectionStart = 8;
    a.eq(env.docFire('keydown', sg.textarea, { key: 'Tab' }).defaultPrevented, true, 'snippet: Tab kept');
    a.eq(sg.textarea.value, 'Nice Good job');
  });

  test('the global snippet Tab handler is not installed on other course pages', () => {
    const env = speedGraderEnv({ pathname: '/courses/5/discussion_topics/7' });
    a.eq((env.docListeners.keydown || []).length, 0, 'no keydown capture on a discussion page');
    const sgEnv = speedGraderEnv();
    a.eq((sgEnv.docListeners.keydown || []).length, 1, 'installed on SpeedGrader');
  });
});

/* ------------------------------------------------------- comment analysis */

suite('comment analysis: author id beats author name', (test) => {
  const CGP = globalThis.CGP;
  const opts = { instructorId: '900', instructorNames: ['Pat Lee', 'Pat'], studentId: '77' };

  test('a student whose name equals the teacher\'s is not the teacher', () => {
    const r = CGP.commentAnalysis.analyze([
      { id: '1', author_id: 77, author_name: 'Pat Lee', comment: 'question', created_at: '2026-09-01T12:00:00Z' }
    ], opts);
    a.eq(r.hasInstructorComment, false);
    a.eq(r.lastStudentAt !== null, true, 'still counted as the student');
  });

  test('another user with the teacher\'s short name is not the teacher', () => {
    const r = CGP.commentAnalysis.analyze([
      { id: '2', author_id: '901', author_name: 'Pat', comment: 'peer note', created_at: '2026-09-01T12:00:00Z' }
    ], opts);
    a.eq(r.instructorCount, 0);
  });

  test('the instructor id still counts, and a name still works with no id', () => {
    const r = CGP.commentAnalysis.analyze([
      { id: '3', author_id: '900', author_name: 'Someone Else', comment: 'a', created_at: '2026-09-01T12:00:00Z' },
      { id: '4', author_name: 'pat lee', comment: 'b', created_at: '2026-09-02T12:00:00Z' },
      { id: '5', author_id: '', author_name: 'Pat Lee', comment: 'c', created_at: '2026-09-03T12:00:00Z' }
    ], opts);
    a.eq(r.instructorCount, 3);
  });
});

/* ------------------------------------------------------------ course menu */

suite('course menu: only real toggles, cached lookup, safe hrefs', (test) => {
  const newCtrl = (CGP) => new CGP.CourseMenuController({
    api: { get: () => Promise.resolve([]) }, courseId: '379', settings: { values: {} }
  });

  test('a gradebook column header "Course ... Options" button is not hijacked', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const header = mk('div', { class: 'slick-header' });
    const col = mk('div', { class: 'slick-header-column' });
    const btn = mk('button', { 'aria-label': 'Course Reflection Options', title: 'Course Reflection Options menu' });
    col.appendChild(btn); header.appendChild(col); doc.body.appendChild(header);
    const ctrl = newCtrl(CGP);
    a.eq(ctrl.isCourseMenuToggle(btn), null);

    const dialog = mk('div', { role: 'dialog' });
    const navBtn = mk('button', { 'aria-label': 'Courses Navigation Menu' });
    dialog.appendChild(navBtn); doc.body.appendChild(dialog);
    a.eq(ctrl.isCourseMenuToggle(navBtn), null, 'nothing inside a dialog');

    const loose = mk('button', { 'aria-label': 'Navigation menu' });
    loose.appendChild(mk('svg'));
    loose.setRect({ left: 60, top: 20, width: 30, height: 30 });
    doc.body.appendChild(loose);
    a.eq(ctrl.isCourseMenuToggle(loose), null, 'no label/position guessing outside the breadcrumb');
    ctrl.attachDirectListeners();
    a.eq(btn._cgpMenuAttached, undefined);
    a.eq(loose._cgpMenuAttached, undefined, 'guessed buttons never get direct listeners');
  });

  test('exact Canvas toggles and the InstUI breadcrumb button still work', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const crumbs = mk('div', { id: 'breadcrumbs', class: 'ic-app-crumbs' });
    const inst = mk('button', { class: 'Button Button--icon-action', 'aria-label': 'Show Courses Navigation Menu' });
    crumbs.appendChild(inst);
    const other = mk('button', { 'aria-label': 'Reorder columns' });
    crumbs.appendChild(other);
    doc.body.appendChild(crumbs);
    const ctrl = newCtrl(CGP);
    a.eq(ctrl.isCourseMenuToggle(inst), inst);
    a.eq(ctrl.isCourseMenuToggle(other), null, 'an unrelated breadcrumb button is not the toggle');

    const classic = mk('button', { 'aria-controls': 'left-side' });
    doc.body.appendChild(classic);
    a.eq(newCtrl(CGP).isCourseMenuToggle(classic), classic);
  });

  test('the hamburger lookup is cached and redone only once it is disconnected', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const first = mk('button', { id: 'courseMenuToggle' });
    doc.body.appendChild(first);
    const ctrl = newCtrl(CGP);
    a.eq(ctrl.findHamburgerButton(), first);
    let scans = 0;
    const origQsa = doc.querySelectorAll;
    doc.querySelectorAll = function (sel) { scans++; return origQsa.call(doc, sel); };
    for (let i = 0; i < 5; i++) ctrl.attachDirectListeners();
    a.eq(scans, 0, 'no document scans while the cached button is connected');
    a.eq(first._cgpMenuAttached, true);

    first.remove();
    const second = mk('button', { id: 'courseMenuToggle' });
    doc.body.appendChild(second);
    a.eq(ctrl.findHamburgerButton(), second, 're-found after the old one was removed');
    a.ok(scans > 0);
  });

  test('tab hrefs from the API or cache must be same-origin http(s)', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const wrapper = mk('div', { id: 'wrapper' });
    doc.body.appendChild(wrapper);
    const ctrl = newCtrl(CGP);
    ctrl.renderTabs([
      { id: 'home', label: 'Home', html_url: '/courses/379', visibility: 'public' },
      { id: 'evil', label: 'Evil', html_url: 'javascript:alert(1)', visibility: 'public' },
      { id: 'away', label: 'Away', html_url: 'https://evil.example/phish', visibility: 'public' },
      { id: 'data', label: 'Data', full_url: 'data:text/html,hi', visibility: 'public' }
    ]);
    const hrefs = doc.getElementById('left-side').querySelectorAll('a[href]').map((x) => x.getAttribute('href'));
    a.ok(hrefs.indexOf('/courses/379') >= 0, 'same-origin kept');
    a.ok(hrefs.every((h) => h.charAt(0) === '/'), 'only same-origin paths: ' + JSON.stringify(hrefs));
    a.ok(hrefs.indexOf('/courses/379/evil') >= 0, 'unsafe html_url falls back to the course-relative tab route');
  });
});

/* -------------------------------------------------- course list loading */

suite('course list: failures are not cached', (test) => {
  test('a failed course-list load rejects, and the next call retries', async () => {
    const CGP = loadGradebookDom();
    let n = 0;
    const api = {
      teachingCourses() {
        n++;
        return n === 1 ? Promise.reject({ status: 503 }) : Promise.resolve([{ id: 1, name: 'Bio' }]);
      }
    };
    let rejected = null;
    await CGP.teachingCourseList(api).then(() => {}, (err) => { rejected = err; });
    a.ok(rejected && rejected.status === 503, 'first load rejects');
    const list = await CGP.teachingCourseList(api);
    a.eq(list.length, 1, 'second load retried');
    a.eq(n, 2);
  });
});
