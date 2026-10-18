/* Self-update: an update Chrome has downloaded is applied by reloading the
 * extension, but never while a Canvas course page is open (its content
 * scripts would be orphaned), and the Web Store is asked at most hourly. */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const MODULE = pathToFileURL(path.join(__dirname, '..', 'src', 'self-update.js')).href;

function fakeChrome(opts) {
  const o = Object.assign({ tabs: [], origins: ['*://*.instructure.com/*'] }, opts);
  const local = {};
  const session = {};
  const calls = { reload: 0, check: 0, queries: [] };
  const store = (bag) => ({
    get: async (k) => (k in bag ? { [k]: bag[k] } : {}),
    set: async (obj) => { Object.assign(bag, obj); }
  });
  const chrome = {
    storage: { local: store(local), session: store(session) },
    permissions: { getAll: async () => ({ origins: o.origins }) },
    tabs: {
      query: async (q) => { calls.queries.push(q); return o.tabs; },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: {
      reload: () => { calls.reload++; },
      requestUpdateCheck: async () => { calls.check++; return { status: 'no_update' }; },
      onUpdateAvailable: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  return { chrome, calls, local, session, opts: o };
}

suite('self-update', (test) => {
  test('a downloaded update reloads at once when no Canvas page is open', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    a.eq(await createSelfUpdater(f.chrome).onUpdateAvailable({ version: '1.16.0' }), true);
    a.eq(f.calls.reload, 1);
  });

  test('an open Canvas page holds the update until it closes', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ tabs: [{ id: 1 }] });
    const u = createSelfUpdater(f.chrome);
    await u.onUpdateAvailable({ version: '1.16.0' });
    a.eq(f.calls.reload, 0, 'not while the gradebook is open');
    f.opts.tabs = [];
    await u.applyIfIdle();
    a.eq(f.calls.reload, 1, 'applied once the last Canvas tab is gone');
  });

  test('self-hosted Canvas domains count as Canvas pages', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ origins: ['*://*.instructure.com/*', '*://canvas.school.edu/*', '*://*/*'] });
    await createSelfUpdater(f.chrome).onUpdateAvailable({});
    a.eq(JSON.stringify(f.calls.queries[0].url),
      JSON.stringify(['*://*.instructure.com/courses/*', '*://canvas.school.edu/courses/*']));
  });

  test('nothing reloads when no update is pending', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome();
    a.eq(await createSelfUpdater(f.chrome).applyIfIdle(), false);
    await createSelfUpdater(f.chrome).onTabUpdated(1, { status: 'complete' }, { url: 'https://example.com/' });
    a.eq(f.calls.reload, 0);
  });

  test('a tab finishing its load applies a held update', async () => {
    const { createSelfUpdater } = await import(MODULE);
    const f = fakeChrome({ tabs: [{ id: 1 }] });
    const u = createSelfUpdater(f.chrome);
    await u.onUpdateAvailable({});
    f.opts.tabs = [];
    await u.onTabUpdated(1, { status: 'complete' }, {});   // left Canvas; URL hidden
    a.eq(f.calls.reload, 1);
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
