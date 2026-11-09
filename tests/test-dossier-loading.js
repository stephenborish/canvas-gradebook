/* The student overview ("dossier") loads quickly and survives a bad
 * connection:
 *   - its reads jump the shared request queue, and may use reserved slots,
 *     so they never wait behind the gradebook's background warming;
 *   - numbered pages of a long list are read at once;
 *   - a read that stalls is abandoned and retried instead of hanging;
 *   - a section that fails says so and can be read again on its own, and is
 *     never mistaken for "Canvas doesn't offer this";
 *   - an earlier read is shown at once while a fresh one arrives. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

if (!CGP.StudentInsightsController) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src/gradebook/student-insights.js'), 'utf8'),
    { filename: 'src/gradebook/student-insights.js' });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function response(status, body, headers) {
  return {
    ok: status >= 200 && status < 300, status,
    text: () => Promise.resolve(body === undefined ? '[]' : body),
    headers: { get: (h) => (headers || {})[h] || (headers || {})[h.toLowerCase()] || null }
  };
}

suite('student overview loading: the request queue', (test) => {
  test('high-priority work jumps the queue and may use the reserved slots', async () => {
    const gate = CGP.util.pool(2, { reserve: 1 });
    const order = [];
    const holds = [];
    const job = (name) => () => new Promise((r) => { order.push(name); holds.push(r); });
    gate(job('bg1')); gate(job('bg2')); gate(job('bg3'));
    gate(job('high'), { priority: 'high' });
    await tick();
    a.deep(order, ['bg1', 'bg2', 'high'], 'the high-priority read starts at once, in a reserved slot');
    holds.forEach((r) => r()); await tick(); await tick();
    a.deep(order, ['bg1', 'bg2', 'high', 'bg3']);
  });

  test('low-priority work waits until nothing else is queued', async () => {
    const gate = CGP.util.pool(1);
    const order = [];
    let release;
    gate(() => new Promise((r) => { order.push('first'); release = r; }));
    gate(() => { order.push('low'); }, { priority: 'low' });
    gate(() => { order.push('normal'); });
    await tick();
    release(); await tick(); await tick(); await tick();
    a.deep(order, ['first', 'normal', 'low']);
  });

  test('without a priority, the pool behaves exactly as before', async () => {
    const gate = CGP.util.pool(1);
    const order = [];
    await Promise.all([1, 2, 3].map((n) => gate(() => { order.push(n); })));
    a.deep(order, [1, 2, 3]);
  });
});

suite('student overview loading: the Canvas client', (test) => {
  test('a stalled read is abandoned after timeoutMs and retried', async () => {
    let calls = 0;
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url, init) => {
      calls++;
      if (calls === 1) {
        // Never answers; only the abort ends it.
        return new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
      }
      return Promise.resolve(response(200, '{"ok":true}'));
    } }).withDefaults({ timeoutMs: 30 });
    const data = await api.get('/api/v1/courses/1');
    a.eq(calls, 2);
    a.deep(data, { ok: true });
  });

  test('a read that keeps stalling fails with a timeout, not forever', async () => {
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url, init) =>
      new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    }).withDefaults({ timeoutMs: 20 });
    let err = null;
    await api.request('/api/v1/courses/1', { retries: 0 }).catch((e) => { err = e; });
    a.ok(err && err.timedOut, 'reported as a timeout');
  });

  test('no timeout unless asked for: other callers are unchanged', async () => {
    let init0 = null;
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url, init) => { init0 = init; return Promise.resolve(response(200, '{}')); } });
    await api.get('/api/v1/courses/1');
    a.eq(init0.signal, undefined);
  });

  test('numbered pages are read at once, in order, when Canvas gives the last page', async () => {
    const urls = [];
    let inFlight = 0, most = 0;
    const base = 'https://x.instructure.com/api/v1/courses/1/students/submissions?per_page=100';
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url) => {
      urls.push(url);
      inFlight++; most = Math.max(most, inFlight);
      const page = Number(new URL(url).searchParams.get('page') || 1);
      const link = page === 1 ? '<' + base + '&page=2>; rel="next", <' + base + '&page=4>; rel="last"' : '';
      return new Promise((r) => setTimeout(() => { inFlight--; r(response(200, JSON.stringify([page]), { Link: link })); }, 5));
    } }).withDefaults({ parallel: true });
    const all = await api.getAll('/api/v1/courses/1/students/submissions');
    a.deep(all, [1, 2, 3, 4], 'every page, in page order');
    a.eq(urls.length, 4);
    a.ok(most >= 3, 'pages 2-4 were in flight together');
  });

  test('bookmark pagination (no last page) is still read in order', async () => {
    const base = 'https://x.instructure.com/api/v1/users/1/page_views?per_page=100';
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url) => {
      const p = new URL(url).searchParams.get('page');
      const next = !p ? '<' + base + '&page=bookmark:abc>; rel="next"' : '';
      return Promise.resolve(response(200, JSON.stringify([p || 'first']), { Link: next }));
    } }).withDefaults({ parallel: true });
    a.deep(await api.getAll('/api/v1/users/1/page_views'), ['first', 'bookmark:abc']);
  });

  test('a list longer than maxPages is cut there and marked truncated', async () => {
    const base = 'https://x.instructure.com/api/v1/x?per_page=100';
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url) => {
      const page = Number(new URL(url).searchParams.get('page') || 1);
      const link = page === 1 ? '<' + base + '&page=2>; rel="next", <' + base + '&page=9>; rel="last"' : '';
      return Promise.resolve(response(200, JSON.stringify([page]), { Link: link }));
    } });
    const all = await api.getAll('/api/v1/x', {}, { maxPages: 3, parallel: true });
    a.deep(all.slice(), [1, 2, 3]);
    a.ok(all.truncated);
  });
});

suite('student overview loading: the panel’s data', (test) => {
  function fakeApi(over) {
    const calls = [];
    const base = {
      studentWork: (c, u) => { calls.push(['work', u]); return Promise.resolve([{ id: u }]); },
      studentActivity: (c, u) => { calls.push(['activity', u]); return Promise.resolve({ page_views: {} }); },
      enrollmentForUser: (c, u) => { calls.push(['enrollment', u]); return Promise.resolve({ id: 1 }); }
    };
    const api = Object.assign(base, over || {});
    api.withDefaults = (d) => Object.assign(Object.create(api), { _defaults: d });
    return { api, calls };
  }
  function ctl(api) {
    return new CGP.StudentInsightsController({ model: { gradingPeriodId: null, ready: true }, api, adapter: {},
      settings: { values: { studentInsights: true } }, courseId: '5' });
  }

  test('the panel reads through the high-priority, time-limited view', () => {
    const { api } = fakeApi();
    const c = ctl(api);
    a.eq(c.fast._defaults.priority, 'high');
    a.ok(c.fast._defaults.timeoutMs > 0);
    a.ok(c.fast._defaults.parallel);
    a.eq(c.slow._defaults.priority, 'low');
  });

  test('a failed analytics read is read again on its own; their work is not re-read', async () => {
    let fail = true;
    const { api, calls } = fakeApi({ studentActivity: () => { calls.push(['activity']); return fail ? Promise.reject(new Error('net')) : Promise.resolve({}); } });
    const c = ctl(api);
    const e1 = c.studentData('7');
    await e1.work; await e1.activity; await tick();
    a.ok(e1.activityFailed);
    a.eq((await e1.activity).failed, true, 'failed, not "analytics off"');
    fail = false;
    const e2 = c.studentData('7');
    a.eq(e2, e1, 'same entry: their work is kept');
    a.ok(!(await e2.activity).failed, 'analytics read again');
    a.eq(calls.filter((x) => x[0] === 'work').length, 1, 'work read once');
    a.eq(calls.filter((x) => x[0] === 'activity').length, 2);
  });

  test('failed work reads the whole student again', async () => {
    let fail = true;
    const { api, calls } = fakeApi({ studentWork: () => { calls.push(['work']); return fail ? Promise.reject(new Error('net')) : Promise.resolve([]); } });
    const c = ctl(api);
    const e1 = c.studentData('7');
    await e1.work.catch(() => {}); await tick();
    fail = false;
    const e2 = c.studentData('7');
    a.ok(e2 !== e1);
    await e2.work;
    a.eq(calls.filter((x) => x[0] === 'work').length, 2);
  });

  test('an old read is kept to show at once while the fresh one arrives', async () => {
    const { api } = fakeApi();
    const c = ctl(api);
    const e1 = c.studentData('7');
    await e1.work; await tick();
    e1.at -= 10 * 60 * 1000; // long ago
    const e2 = c.studentData('7');
    a.ok(e2 !== e1);
    a.eq(e2.prev, e1, 'the earlier read is there to draw meanwhile');
    a.eq(e1.prev, null, 'no chain of old reads is kept');
  });

  test('a prefetch never replaces a read, and an open does not wait behind a queued prefetch', async () => {
    const { api } = fakeApi();
    const c = ctl(api);
    const low = c.studentData('8', { priority: 'low' });
    a.eq(c.studentData('8', { priority: 'low' }), low);
    const open = c.studentData('8');
    a.ok(open !== low, 'still-waiting prefetch: the open reads at high priority');
    await open.work; await tick();
    a.eq(c.studentData('9', { priority: 'low' }).priority, 'low');
    a.eq(c.studentData('8', { priority: 'low' }), open, 'a prefetch reuses what is there');
  });

  test('analytics or Access Report that failed offer "Try again"; analytics that are off say so', () => {
    const c = ctl(fakeApi().api);
    c._uid = '7';
    const base = () => {
      const r = CGP.studentInsights.summarize({ now: Date.now(), studentId: '7', assignments: [], submissions: [] });
      return Object.assign(r, { analyticsKnown: true, analyticsFailed: false, analyticsOff: false, summariesKnown: true,
        contentKnown: true, contentFailed: false, content: null, studio: null, index: null, indexKnown: true, groupNames: {} });
    };
    const failed = c.activityPanel(Object.assign(base(), { analyticsFailed: true }));
    a.ok(failed.includes('data-si-retry-part="activity"'), 'analytics: Try again');
    a.not(failed.includes('isn’t available for this course'), 'not mistaken for "analytics off"');
    const off = c.activityPanel(Object.assign(base(), { analyticsOff: true }));
    a.ok(off.includes('isn’t available for this course'));
    a.not(off.includes('data-si-retry-part="activity"'));
    const content = c.contentPanel(Object.assign(base(), { contentFailed: true }));
    a.ok(content.includes('data-si-retry-part="content"'), 'Access Report: Try again');
  });

  test('a profile that failed to load offers "Try again"', () => {
    const c = ctl(fakeApi().api);
    const html = c.profilePanel('7', { name: 'A' }, { profile: { failed: true } });
    a.ok(html.includes('data-si-retry-part="profile"'));
  });

  test('"Try again" on one section reads only that section', async () => {
    const { api, calls } = fakeApi();
    const c = ctl(api);
    c._gen = 1;
    let drawn = 0;
    c._open = { uid: '7', gen: 1, parts: { activity: { failed: true } }, draw: () => { drawn++; }, data: { activity: null } };
    c.retryPart('activity');
    a.eq(c._open.parts.activity, undefined, 'back to "reading"');
    await tick(); await tick();
    a.deep(calls, [['activity', '7']]);
    a.ok(c._open.parts.activity && !c._open.parts.activity.failed);
    a.ok(drawn >= 2);
  });
});
