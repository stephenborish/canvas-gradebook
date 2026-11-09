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

  test('only the small record module loads on every course page; the tour itself is injected on demand', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts.find((c) => (c.js || []).includes('src/gradebook/content.js')).js;
    const list = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
    a.ok(js.includes('src/tour/tour-state.js'), 'tour-state.js in manifest.json');
    a.ok(list.includes("'src/tour/tour-state.js'"), 'tour-state.js in script-manifest.js');
    TourState.FILES.forEach((f) => {
      a.not(js.includes(f), f + ' is not a static content script');
      a.not(list.includes("'" + f + "'"), f + ' is not in script-manifest.js');
      a.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
    });
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(bg.includes("import './tour/tour-state.js'"), 'background shares the record module');
    a.ok(/msg\.type === TourState\.INJECT[\s\S]*executeScript[\s\S]*files: TourState\.FILES/.test(bg), 'background injects on request');
  });

  test('a fresh install, and only a fresh install, marks the tour due', async () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(/details\.reason === 'install'[\s\S]{0,200}markInstalled\(\)/.test(bg));
    // The whole record, not a merge: nothing from an earlier install survives.
    const store = memoryStorage({ [TourState.KEY]: { pending: false, stop: 'gear', outcome: 'skipped' } });
    await new TourState(store).markInstalled();
    const v = store.bag[TourState.KEY];
    a.eq(v.pending, true); a.eq(v.chapter, 'gradebook'); a.eq(v.stop, null); a.eq(v.outcome, undefined);
  });

  test('wanted on a course page while due, or when asked for in the address; never in SpeedGrader', () => {
    const loc = (pathname, hash) => ({ pathname, hash: hash || '' });
    a.ok(TourState.wantedHere(loc('/courses/5/gradebook'), { pending: true }));
    a.ok(TourState.wantedHere(loc('/courses/5/assignments/9'), { pending: true }), 'the invitation');
    a.not(TourState.wantedHere(loc('/courses/5/gradebook'), { pending: false }));
    a.ok(TourState.wantedHere(loc('/courses/5', '#cgp-tour=classes'), {}));
    a.not(TourState.wantedHere(loc('/courses/5/gradebook/speed_grader'), { pending: true }));
    a.not(TourState.wantedHere(loc('/profile/settings'), { pending: true }));
  });

  test('progress is kept, so a reload or another course carries on from the same stop', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed() });
    const s = new TourState(store);
    await s.saveStop('find');
    a.eq(store.bag[TourState.KEY].stop, 'find');
    a.eq(await s.isPending(), true);
    await s.setChapter('classes');
    a.eq(store.bag[TourState.KEY].stop, null, 'a new part starts at its first stop');
  });

  test('writes run in order: a progress save in flight never undoes "finished"', async () => {
    let slow = true;
    const bag = { [TourState.KEY]: TourState.installed() };
    const store = {
      get: async (k) => ({ [k]: bag[k] }),
      set: (o) => new Promise((r) => setTimeout(() => { Object.assign(bag, JSON.parse(JSON.stringify(o))); r(); }, slow ? 30 : 0))
    };
    const s = new TourState(store);
    const p1 = s.saveStop('gear');          // slow write starts first
    slow = false;
    const p2 = s.markDone('skipped', 'gear');
    await Promise.all([p1, p2]);
    a.eq(bag[TourState.KEY].pending, false);
    a.eq(bag[TourState.KEY].stop, 'gear');
  });

  test('"Replay" reports a storage failure; ordinary writes swallow it', async () => {
    const s = new TourState({ get: async () => ({}), set: async () => { throw new Error('quota'); } });
    let failed = false;
    await s.request().catch(() => { failed = true; });
    a.ok(failed, 'request() rejects');
    await s.saveStop('x'); // must not throw
  });

  test('the options page uses the shared record for Replay', () => {
    const opts = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');
    a.ok(opts.includes('new CGP.TourState().request()'));
    a.not(opts.includes("'cgp.tour'"), 'no second copy of the key');
    const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
    a.ok(html.indexOf('../tour/tour-state.js') > 0 && html.indexOf('../tour/tour-state.js') < html.indexOf('options.js"'));
  });

  test('the tour cleans up after itself: no per-frame polling, listeners removed', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/tour/tour.js'), 'utf8');
    a.not(/function tick\b/.test(src), 'no requestAnimationFrame loop');
    a.ok(src.includes('ResizeObserver'), 'element size changes are observed');
    a.ok(src.includes('chrome.storage.onChanged.removeListener(on)'), 'storage listener is removable');
    a.not(/function waitFor\(test, timeoutMs/.test(src), 'one shared waitFor (tour-content.js)');
  });

});
