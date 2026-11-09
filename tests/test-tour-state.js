/* The welcome tour is offered once per install: due after a fresh install,
 * cleared for good by finishing or skipping it, and due again only when the
 * teacher asks for it from the options page. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/tour/tour-state.js'), 'utf8'), { filename: 'src/tour/tour-state.js' });
const TourState = globalThis.CGP.TourState;

function memoryStorage(initial) {
  const bag = Object.assign({}, initial);
  return {
    bag,
    get: async (k) => (k in bag ? { [k]: bag[k] } : {}),
    set: async (o) => { Object.assign(bag, JSON.parse(JSON.stringify(o))); }
  };
}

suite('Welcome tour: once per install', (test) => {
  test('an install that predates the tour (no record) is not shown it', async () => {
    const s = new TourState(memoryStorage());
    a.eq(await s.isPending(), false);
  });

  test('a fresh install is due, and finishing it clears it for good', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed(1) });
    const s = new TourState(store);
    a.eq(await s.isPending(), true);
    await s.markDone('completed', 'done');
    a.eq(await s.isPending(), false);
    a.eq(store.bag[TourState.KEY].outcome, 'completed');
    a.eq(store.bag[TourState.KEY].installedAt, 1, 'the install time is kept');
  });

  test('skipping counts as seen too', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed() });
    const s = new TourState(store);
    await s.markDone('skipped', 'statuses');
    a.eq(await s.isPending(), false);
    a.eq(store.bag[TourState.KEY].outcome, 'skipped');
    a.eq(store.bag[TourState.KEY].lastStep, 'statuses');
  });

  test('"Replay the tour" makes it due again', async () => {
    const store = memoryStorage({ [TourState.KEY]: { pending: false, outcome: 'skipped' } });
    const s = new TourState(store);
    await s.request();
    a.eq(await s.isPending(), true);
  });

  test('storage that throws reads as "not due" rather than breaking the page', async () => {
    const s = new TourState({ get: () => Promise.reject(new Error('context invalidated')), set: () => Promise.reject(new Error('x')) });
    a.eq(await s.isPending(), false);
    await s.markDone('skipped'); // must not throw
  });

  test('#cgp-tour in the address asks for it', () => {
    a.ok(TourState.wantsTourFromHash('#cgp-tour'));
    a.not(TourState.wantsTourFromHash('#cgp-student=12'));
    a.not(TourState.wantsTourFromHash(''));
  });

  test('both content-script lists load the tour, before the gradebook entry point', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts.find((c) => (c.js || []).includes('src/gradebook/content.js')).js;
    const list = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
    ['src/tour/tour-state.js', 'src/tour/tour-content.js', 'src/tour/tour.js'].forEach((f) => {
      a.ok(js.includes(f), f + ' in manifest.json');
      a.ok(list.includes("'" + f + "'"), f + ' in script-manifest.js');
      a.ok(js.indexOf(f) < js.indexOf('src/gradebook/content.js'), f + ' before content.js');
    });
  });

  test('a fresh install, and only a fresh install, marks the tour due', () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(/details\.reason === 'install'/.test(bg));
    a.ok(/'cgp\.tour': \{ pending: true/.test(bg));
  });
});
