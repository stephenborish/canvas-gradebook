/* Applying an update without breaking what a Canvas tab is doing.
 *
 * Before reloading into a downloaded update, the service worker asks every
 * open Canvas tab whether it is busy (self-update.js). These cases pin down
 * what a tab answers (CGP.busy, core/util.js), and that every Canvas write
 * is counted - and, now that writes have a time limit, that a write which
 * timed out is never sent a second time, even when it calls itself safe to
 * repeat. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

function okAnswer(body) {
  return { ok: true, status: 200, url: '', redirected: false,
    headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) },
    text: () => Promise.resolve(JSON.stringify(body || {})) };
}

suite('update safety: is this tab busy?', (test) => {
  test('idle by default; a registered check gives its reason; unregistering clears it', () => {
    CGP.busy._reset();
    a.eq(CGP.busy.reason(), '');
    let copying = true;
    const off = CGP.busy.register(() => (copying ? 'copying to your other classes' : ''));
    a.eq(CGP.busy.reason(), 'copying to your other classes');
    copying = false;
    a.eq(CGP.busy.reason(), '');
    copying = true;
    off();
    a.eq(CGP.busy.reason(), '', 'unregistered');
  });

  test('a check that throws counts as idle, never breaks the answer', () => {
    CGP.busy._reset();
    CGP.busy.register(() => { throw new Error('gone'); });
    a.eq(CGP.busy.reason(), '');
  });

  test('a write in flight, and for a short grace after, keeps the page busy', () => {
    CGP.busy._reset();
    CGP.busy.beginWrite();
    a.eq(CGP.busy.reason(), 'saving to Canvas');
    CGP.busy.endWrite();
    a.eq(CGP.busy.reason(), 'just saved to Canvas', 'the next step of a multi-step change may follow');
    a.eq(CGP.busy.reason(Date.now() + CGP.busy.WRITE_GRACE_MS + 1), '');
    CGP.busy.endWrite();
    a.eq(CGP.busy.reason(Date.now() + CGP.busy.WRITE_GRACE_MS + 1), '', 'never goes below zero');
  });

  test('the page answers the service worker\'s question, and listens only once', () => {
    CGP.busy._reset();
    CGP.busy._listening = false;
    const listeners = [];
    const runtime = { onMessage: { addListener: (fn) => listeners.push(fn) } };
    a.eq(CGP.busy.listen(runtime), true);
    a.eq(CGP.busy.listen(runtime), false);
    a.eq(listeners.length, 1);
    let answer = null;
    CGP.busy.register(() => 'saving groups');
    a.eq(listeners[0]({ type: 'other' }, {}, (r) => { answer = r; }), false);
    a.eq(answer, null, 'other messages are not answered');
    listeners[0]({ type: CGP.busy.MESSAGE }, {}, (r) => { answer = r; });
    a.deep(answer, { busy: true, reason: 'saving groups' });
    CGP.busy._reset();
    CGP.busy._listening = false;
  });

  test('the same message name on both sides', async () => {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'self-update.js')).href);
    a.eq(mod.BUSY_MESSAGE, CGP.busy.MESSAGE);
  });
});

suite('update safety: Canvas writes are counted and time-limited', (test) => {
  test('a write counts as busy while it runs; a read does not', async () => {
    CGP.busy._reset();
    let release;
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url, init) => {
      if (init.method === 'GET') return Promise.resolve(okAnswer([]));
      return new Promise((r) => { release = () => r(okAnswer({ id: 1 })); });
    } });
    await api.get('/api/v1/courses/1');
    a.eq(CGP.busy.reason(), '', 'reads are not counted');
    const p = api.request('/api/v1/courses/1/things', { method: 'POST', json: {} });
    await new Promise((r) => setTimeout(r, 0));
    a.eq(CGP.busy.reason(), 'saving to Canvas');
    release();
    await p;
    a.eq(CGP.busy.reason(), 'just saved to Canvas');
    CGP.busy._reset();
  });

  test('a failed write is counted down too', async () => {
    CGP.busy._reset();
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: () => Promise.resolve({
      ok: false, status: 400, headers: { get: () => null }, text: () => Promise.resolve('{}') }) });
    await api.request('/api/v1/x', { method: 'PUT', form: { a: 1 } }).then(() => a.fail('should reject'), () => 0);
    a.eq(CGP.busy.reason(Date.now() + CGP.busy.WRITE_GRACE_MS + 1), '');
  });

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
      CGP.busy._reset();
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
    CGP.busy._reset();
  });
});

suite('gradebook boot: wiring for busy answers and a missing grid', (test) => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'gradebook', 'content.js'), 'utf8');

  test('the top-frame boot answers "are you busy?", frames do not', () => {
    const boot = src.slice(src.indexOf('function boot()'));
    const frameReturn = boot.indexOf('window.self !== window.top');
    const listen = boot.indexOf('CGP.busy.listen(chrome.runtime)');
    a.ok(frameReturn > 0 && listen > frameReturn, 'listens only after the frame check has returned');
  });

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

  test('Copy to other classes, Make groups and SpeedGrader register their busy checks', () => {
    const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'sections', 'sync-runner.js'), 'utf8');
    const groups = fs.readFileSync(path.join(__dirname, '..', 'src', 'groups', 'group-builder.js'), 'utf8');
    const sg = fs.readFileSync(path.join(__dirname, '..', 'src', 'speedgrader', 'content.js'), 'utf8');
    a.ok(/CGP\.busy\.register\([\s\S]*?copying to your other classes/.test(runner));
    a.ok(/CGP\.busy\.register\([\s\S]*?saving groups/.test(groups));
    a.ok(/CGP\.busy\.register\([\s\S]*?typing a SpeedGrader comment/.test(sg));
  });
});

suite('update safety: the settings page', (test) => {
  test('leaving the settings page with unsaved edits asks first', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'options', 'options.js'), 'utf8');
    a.ok(/addEventListener\('beforeunload'[\s\S]{0,300}isDirty\(\)/.test(src));
  });
});
