/* Self-update: an update Chrome has downloaded is applied by reloading the
 * extension, and the Web Store is asked when a Canvas course page loads, at
 * most hourly. */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const MODULE = pathToFileURL(path.join(__dirname, '..', 'src', 'self-update.js')).href;

function fakeChrome(opts) {
  const o = Object.assign({ origins: ['*://*.instructure.com/*'] }, opts);
  const local = {};
  const calls = { reload: 0, check: 0 };
  const store = (bag) => ({
    get: async (k) => (k in bag ? { [k]: bag[k] } : {}),
    set: async (obj) => { Object.assign(bag, obj); }
  });
  const chrome = {
    storage: { local: store(local) },
    permissions: { getAll: async () => ({ origins: o.origins }) },
    tabs: { onUpdated: { addListener() {} } },
    runtime: {
      reload: () => { calls.reload++; },
      requestUpdateCheck: async () => { calls.check++; return { status: 'no_update' }; },
      onUpdateAvailable: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  return { chrome, calls };
}

suite('self-update', (test) => {
  test('a downloaded update reloads the extension', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    createSelfUpdater(f.chrome).onUpdateAvailable({ version: '1.17.0' });
    a.eq(f.calls.reload, 1);
  });

  test('self-hosted Canvas domains count as Canvas pages', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ origins: ['*://*.instructure.com/*', '*://canvas.school.edu/*', '*://*/*'] });
    await createSelfUpdater(f.chrome).onTabUpdated(1, { status: 'complete' }, { url: 'https://canvas.school.edu/courses/9' });
    a.eq(f.calls.check, 1);
  });

  test('the Web Store is asked at most once an hour', async () => {
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
});
