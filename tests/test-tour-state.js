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
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/tour/tour-content.js'), 'utf8'), { filename: 'src/tour/tour-content.js' });
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

  test('#cgp-tour in the address asks for it, and names its chapter', () => {
    a.ok(TourState.wantsTourFromHash('#cgp-tour'));
    a.eq(TourState.chapterFromHash('#cgp-tour'), 'gradebook');
    a.eq(TourState.chapterFromHash('#cgp-tour=classes'), 'classes');
    a.eq(TourState.chapterFromHash('#cgp-tour=nonsense'), 'gradebook');
    a.eq(TourState.chapterFromHash('#cgp-student=12'), null);
    a.not(TourState.wantsTourFromHash('#cgp-student=12'));
    a.not(TourState.wantsTourFromHash(''));
  });

  test('finishing part 1 hands over to part 2 and keeps the tour due', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed() });
    const s = new TourState(store);
    await s.setChapter('classes');
    a.eq(await s.isPending(), true);
    a.eq(store.bag[TourState.KEY].chapter, 'classes');
  });

  test('a replay starts again from part 1', async () => {
    const store = memoryStorage({ [TourState.KEY]: { pending: false, chapter: 'classes' } });
    await new TourState(store).request();
    a.eq(store.bag[TourState.KEY].chapter, 'gradebook');
    a.eq(store.bag[TourState.KEY].pending, true);
  });

  test('the tour covers the student overview, linking classes and the class schedule', () => {
    const stops = globalThis.CGP.tourStops;
    const ids = (ch) => stops.filter((x) => (x.chapter || 'gradebook') === ch).map((x) => x.id);
    const gb = ids('gradebook');
    ['student', 'si-overview', 'si-standout', 'si-work', 'si-activity', 'bridge'].forEach((id) => a.ok(gb.includes(id), id + ' in part 1'));
    a.eq(gb[gb.length - 1], 'bridge', 'part 1 ends by handing over to part 2');
    const cl = ids('classes');
    ['classes-link', 'classes-copy', 'classes-compare', 'schedule', 'schedule-connect', 'done'].forEach((id) => a.ok(cl.includes(id), id + ' in part 2'));
    // Every stop that opens the student overview also closes it on the way out.
    stops.filter((x) => x.group === 'si').forEach((x) => a.ok(typeof x.enter === 'function' && typeof x.leave === 'function', x.id));
    a.ok(globalThis.CGP.tourScheduleStops.some((x) => x.id === 'opt-paste'), 'guided calendar setup on the options page');
  });

  test('"Connect my calendar" can open the options page with its guided setup', () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(bg.includes('/^[a-z]+(-tour)?$/'));
    const opts = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');
    a.ok(/startScheduleTour\(\)/.test(opts));
    const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
    a.ok(html.indexOf('../tour/tour.js') > 0 && html.indexOf('../tour/tour.js') < html.indexOf('options.js"'));
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
