/* Self-update: an update Chrome has downloaded is applied by reloading the
 * extension; the Web Store is asked when Chrome starts, when a Canvas course
 * page loads and on an alarm, at most every 20 minutes (Chrome throttles real
 * checks to about one per five hours anyway); open Canvas tabs are told after
 * an update; and every try is recorded for the options page. */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const MODULE = pathToFileURL(path.join(__dirname, '..', 'src', 'self-update.js')).href;

function fakeChrome(opts) {
  const o = Object.assign({ origins: ['*://*.instructure.com/*'] }, opts);
  const local = {};
  const calls = { reload: 0, check: 0, injected: [], alarms: [] };
  let alarm = o.existingAlarm || null;
  const store = (bag) => ({
    get: async (k) => (k in bag ? { [k]: bag[k] } : {}),
    set: async (obj) => { Object.assign(bag, obj); }
  });
  const chrome = {
    storage: { local: store(local) },
    permissions: { getAll: async () => ({ origins: o.origins }) },
    tabs: {
      onUpdated: { addListener() {} },
      query: async (q) => { calls.query = q; return o.tabs || []; }
    },
    scripting: {
      executeScript: async (inj) => {
        if (o.refuseTab === inj.target.tabId) throw new Error('cannot script');
        calls.injected.push(inj);
      }
    },
    alarms: {
      get: async () => alarm,
      create: (name, info) => { alarm = { name, info }; calls.alarms.push(name); },
      onAlarm: { addListener(fn) { calls.onAlarm = fn; } }
    },
    runtime: {
      reload: () => { calls.reload++; },
      getManifest: () => ({ version: o.version || '1.31.0' }),
      requestUpdateCheck: async () => { calls.check++; return o.answer || { status: 'no_update' }; },
      onUpdateAvailable: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  return { chrome, calls, local };
}

suite('self-update', (test) => {
  test('a downloaded update reloads the extension', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    await createSelfUpdater(f.chrome).onUpdateAvailable({ version: '1.17.0' });
    a.eq(f.calls.reload, 1);
    a.eq(f.local['cgp.update'].foundVersion, '1.17.0', 'recorded before the restart');
  });

  test('self-hosted Canvas domains count as Canvas pages', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ origins: ['*://*.instructure.com/*', '*://canvas.school.edu/*', '*://*/*'] });
    await createSelfUpdater(f.chrome).onTabUpdated(1, { status: 'complete' }, { url: 'https://canvas.school.edu/courses/9' });
    a.eq(f.calls.check, 1);
  });

  test('a class-schedule calendar site granted as https://host/* is not a Canvas domain', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ origins: ['*://*.instructure.com/*', 'https://calendar.google.com/*'] });
    await createSelfUpdater(f.chrome).onTabUpdated(1, { status: 'complete' }, { url: 'https://calendar.google.com/courses/9' });
    a.eq(f.calls.check, 0);
  });

  test('the Web Store is asked at most every 20 minutes', async () => {
    const { createSelfUpdater, CHECK_INTERVAL_MS } = await import(MODULE);
    const f = fakeChrome();
    let t = 10 * CHECK_INTERVAL_MS;
    const u = createSelfUpdater(f.chrome, () => t);
    await u.checkForUpdate();
    await u.checkForUpdate();
    a.eq(f.calls.check, 1);
    t += CHECK_INTERVAL_MS;
    await u.checkForUpdate();
    a.eq(f.calls.check, 2);
  });

  test('loading a Canvas course page triggers a check; other pages do not', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    const u = createSelfUpdater(f.chrome);
    await u.onTabUpdated(1, { status: 'complete' }, { url: 'https://example.com/courses/1' });
    a.eq(f.calls.check, 0);
    await u.onTabUpdated(1, { status: 'loading' }, { url: 'https://malvernprep.instructure.com/courses/379/gradebook' });
    a.eq(f.calls.check, 0, 'only once the page has loaded');
    await u.onTabUpdated(1, { status: 'complete' }, { url: 'https://malvernprep.instructure.com/courses/379/gradebook' });
    a.eq(f.calls.check, 1);
  });

  test('a throttled answer is recorded, but is not counted as Chrome having checked', async () => {
    const { createSelfUpdater, CHECK_INTERVAL_MS } = await import(MODULE);
    const f = fakeChrome({ answer: { status: 'no_update' } });
    let t = 100 * CHECK_INTERVAL_MS;
    const u = createSelfUpdater(f.chrome, () => t);
    const first = await u.checkForUpdate();
    a.eq(first.status, 'no_update');
    a.eq(f.local['cgp.update'].lastCheckedAt, t);
    const checkedAt = t;
    f.chrome.runtime.requestUpdateCheck = async () => ({ status: 'throttled' });
    t += CHECK_INTERVAL_MS;
    const r = await u.checkForUpdate();
    a.eq(r.status, 'throttled');
    a.eq(f.local['cgp.update'].lastCheckedAt, checkedAt, 'still the last real check');
    a.eq(f.local['cgp.update'].lastStatus, 'throttled');
    a.ok(r.nextCheckAt > t, 'says when Chrome will allow the next one');
  });

  test('"Check for updates now" skips the 20-minute wait', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    const u = createSelfUpdater(f.chrome, () => 1e12);
    await u.checkForUpdate();
    await u.checkForUpdate({ force: true });
    a.eq(f.calls.check, 2);
  });

  test('an update found is recorded with its version', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ answer: { status: 'update_available', version: '1.32.0' } });
    const r = await createSelfUpdater(f.chrome, () => 5e12).checkForUpdate({ force: true });
    a.eq(r.status, 'update_available');
    a.eq(f.local['cgp.update'].foundVersion, '1.32.0');
  });

  test('a failed check is recorded as an error, never thrown', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    f.chrome.runtime.requestUpdateCheck = async () => { throw new Error('offline'); };
    const r = await createSelfUpdater(f.chrome).checkForUpdate({ force: true });
    a.eq(r.status, 'error');
    a.eq(f.local['cgp.update'].lastStatus, 'error');
  });

  test('an alarm keeps checking even with no page loads, created only once', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    createSelfUpdater(f.chrome, () => 7e12).start();
    await new Promise((r) => setTimeout(r, 0));
    a.deep(f.calls.alarms, ['cgp.updateCheck']);
    await f.calls.onAlarm({ name: 'cgp.updateCheck' });
    await new Promise((r) => setTimeout(r, 0));
    a.eq(f.calls.check, 1);
    const g = fakeChrome({ existingAlarm: { name: 'cgp.updateCheck' } });
    createSelfUpdater(g.chrome).start();
    await new Promise((r) => setTimeout(r, 0));
    a.deep(g.calls.alarms, [], 'an existing alarm is left running');
  });

  test('after an update, open Canvas tabs are told; one Chrome refuses is skipped', async () => {
    const { createSelfUpdater, showUpdatedNotice } = await import(MODULE);
    const f = fakeChrome({ version: '1.31.0', tabs: [{ id: 1 }, { id: 2 }, { id: 3 }], refuseTab: 2,
      origins: ['*://*.instructure.com/*', '*://canvas.school.edu/*'] });
    const told = await createSelfUpdater(f.chrome, () => 9e12).afterUpdate({ reason: 'update', previousVersion: '1.30.0' });
    a.eq(told, 2);
    a.deep(f.calls.query.url, ['*://*.instructure.com/courses/*', '*://canvas.school.edu/courses/*'], 'Canvas course tabs only');
    a.eq(f.calls.injected[0].func, showUpdatedNotice);
    a.deep(f.calls.injected[0].args, ['1.31.0']);
    a.eq(f.calls.injected[0].target.allFrames, undefined, 'top frame only');
    const st = f.local['cgp.update'];
    a.eq(st.updatedFrom, '1.30.0'); a.eq(st.updatedTo, '1.31.0'); a.eq(st.updatedAt, 9e12);
  });

  test('a reload of the same version (development) tells no one', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ version: '1.31.0', tabs: [{ id: 1 }] });
    a.eq(await createSelfUpdater(f.chrome).afterUpdate({ reason: 'update', previousVersion: '1.31.0' }), 0);
    a.eq(f.calls.injected.length, 0);
  });

  test('the manifest has the alarms permission and nothing that would make Chrome ask again', () => {
    const m = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    a.ok(m.permissions.includes('alarms'));
    a.deep(m.permissions.slice().sort(), ['alarms', 'scripting', 'storage'], 'alarms and scripting carry no install warning');
  });
});

