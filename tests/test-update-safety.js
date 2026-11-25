/* Canvas writes have a time limit, and a timed-out write is never sent a
 * second time, even when it calls itself safe to repeat; the gradebook
 * says when Canvas's grid never appears; the settings page asks before
 * closing with unsaved edits. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

function okAnswer(body) {
  return { ok: true, status: 200, url: '', redirected: false,
    headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) },
    text: () => Promise.resolve(JSON.stringify(body || {})) };
}

suite('Canvas writes are time-limited', (test) => {
  test('every write has a time limit; a timed-out write is never re-sent, even when "idempotent"', async () => {
    const before = CGP.CanvasApi.WRITE_TIMEOUT_MS;
    CGP.CanvasApi.WRITE_TIMEOUT_MS = 20;
    let sent = 0;
    let sawSignal = false;
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url, init) => {
      sent++;
      sawSignal = !!init.signal;
      return new Promise((resolve, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    } });
    try {
      let err = null;
      await api.request('/api/v1/x', { method: 'PUT', form: { a: 1 }, idempotent: true, retries: 3 }).catch((e) => { err = e; });
      a.ok(sawSignal, 'the write carries an abort signal');
      a.ok(err && err.timedOut && err.network, 'reported as a timed-out network failure');
      a.eq(sent, 1, 'not sent again: it may still land');
    } finally {
      CGP.CanvasApi.WRITE_TIMEOUT_MS = before;
    }
  });

  test('a caller can turn the write limit off, and reads still have none by default', async () => {
    const inits = [];
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url, init) => {
      inits.push(init);
      return Promise.resolve(okAnswer({}));
    } });
    await api.request('/api/v1/x', { method: 'POST', json: {}, timeoutMs: 0 });
    await api.get('/api/v1/y');
    a.eq(inits[0].signal, undefined, 'no limit when asked for none');
    a.eq(inits[1].signal, undefined, 'reads keep their old behaviour');
  });
});

suite('gradebook boot: a missing grid', (test) => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'gradebook', 'content.js'), 'utf8');

  test('a grid that never appears is said out loud, with a Reload, and the wait goes on', () => {
    a.ok(/return waitForGrid\(\)\.then/.test(src), 'the gradebook waits through waitForGrid');
    const fn = src.slice(src.indexOf('function warnGridMissing'), src.indexOf('function waitForGrid'));
    a.ok(/CGP\.ui\.error\(/.test(fn), 'the teacher is told, not only diagnostics');
    a.ok(/label: 'Reload'/.test(fn));
    a.ok(/looksLikeIndividualView\(\)/.test(fn), 'Individual View, which has no grid, is left alone');
    const wait = src.slice(src.indexOf('function waitForGrid'), src.indexOf('var gridObserver = null'));
    a.ok(/visibilityState === 'hidden'/.test(wait), 'a background tab is not warned until it is seen');
    a.ok(/GRID_LATE_WAIT_MS/.test(wait), 'a slow grid still gets its tools once it appears');
  });

});

suite('gradebook boot: grading scripts that never arrive', (test) => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'gradebook', 'content.js'), 'utf8');
  test('the course-page tools still start, and the teacher is told, with a Reload', () => {
    const at = src.indexOf("CGP.diag.error('boot.gradingScriptsMissing')");
    a.ok(at > 0);
    const after = src.slice(at, at + 600);
    a.ok(/CGP\.ui\.error\(/.test(after), 'told');
    a.ok(/label: 'Reload'/.test(after));
    a.ok(/startCourseChrome\(courseId\)/.test(after), 'Switch course and Find student still start');
  });
});

suite('the settings page', (test) => {
  test('leaving the settings page with unsaved edits asks first', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'options', 'options.js'), 'utf8');
    a.ok(/addEventListener\('beforeunload'[\s\S]{0,300}isDirty\(\)/.test(src));
  });
});

suite('a notice that waits for an answer', (test) => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { domshim } = require('./domharness');

  function freshUi() {
    domshim.install();
    const saved = globalThis.CGP.ui;
    delete globalThis.CGP.ui;
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ui.js'), 'utf8'), { filename: 'src/core/ui.js' });
    const ui = globalThis.CGP.ui;
    globalThis.CGP.ui = saved;
    return ui;
  }

  test('a toast never replaces a notice; a button runs its action and closes it', () => {
    const ui = freshUi();
    let ran = 0;
    ui.notice('Finish setting up?', { id: 'x', actions: [{ label: 'Finish now', run: () => { ran++; } }, { label: 'Not now' }] });
    ui.toast('Grade saved');
    const notices = document.querySelectorAll('.cgp-notice');
    a.eq(notices.length, 1, 'still showing after a toast');
    const buttons = notices[0].querySelectorAll('button');
    a.deep(Array.prototype.map.call(buttons, (b) => b.textContent), ['Finish now', 'Not now']);
    buttons[0].dispatchEvent(Object.assign(new globalThis.Event('click'), { preventDefault() {}, stopPropagation() {} }));
    a.eq(ran, 1);
    a.eq(document.querySelectorAll('.cgp-notice').length, 0, 'closed');
  });

  test('a second notice with the same id replaces the first', () => {
    const ui = freshUi();
    ui.notice('one', { id: 'y' });
    ui.notice('two', { id: 'y' });
    const n = document.querySelectorAll('.cgp-notice[data-cgp-notice="y"]');
    a.eq(n.length, 1);
    a.eq(n[0].querySelector('.cgp-notice__text').textContent, 'two');
  });
});
