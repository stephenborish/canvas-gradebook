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
    a.not(globalThis.CGP.tourScheduleStops.some((x) => x.id === 'opt-save'), 'no separate Save step: Connect saves');
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
    a.ok(/onInstalled[\s\S]{0,400}handleInstalled\(details\.reason\)/.test(bg));
    a.ok(/reason === 'install'\) return this\.markInstalled\(\)/.test(fs.readFileSync(path.join(ROOT, 'src/tour/tour-state.js'), 'utf8')));
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

suite('Welcome tour: the first five minutes', (test) => {
  const C = () => globalThis.CGP;
  const stop = (id) => C().tourStops.filter((x) => x.id === id)[0];

  /* A stand-in for the Tour, recording what a choice asks of it. */
  function fakeTour() {
    const calls = [];
    return {
      calls,
      choose: (p) => calls.push(['choose', p]),
      goChapter: (c, p) => calls.push(['goChapter', c, p]),
      openOptions: (h) => calls.push(['openOptions', h]),
      end: (how, o) => calls.push(['end', how, o && o.path]),
      next: () => calls.push(['next'])
    };
  }

  test('a fresh install opens with the short introduction, nothing else', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed(1) });
    const v = await new TourState(store).read();
    a.eq(TourState.pathFor(v, 'gradebook'), 'intro');
    a.deep(C().tourPaths.intro, ['intro']);
  });

  test('the introduction shows one feature on a real cell, with its illustration as the fallback', () => {
    const s = stop('intro');
    a.eq(s.kind, 'intro');
    a.ok(/feedback/i.test(s.title));
    a.eq(typeof s.target, 'function');
    a.ok(s.fallbackArt && typeof s.art === 'function' && /mk-cmt/.test(s.art()), 'the existing bubble legend');
    a.eq(s.art, stop('comments').art, 'the same illustration the comments stop uses');
    a.not(s.tryIt, 'a click on the cell does not fold it away');
  });

  test('then: start grading, or Grade faster, Copy to another class, Set up my schedule', () => {
    const s = stop('intro');
    a.deep(s.choices.map((c) => c.label), ['Grade faster', 'Copy to another class', 'Set up my schedule']);
    s.choices.forEach((c) => a.ok(c.label.length <= 22 && c.help && c.help.length <= 45, 'short label, help beside it: ' + c.label));
    const t = fakeTour();
    s.choices[0].run(t);
    s.choices[1].run(t);
    s.choices[2].run(t);
    a.deep(t.calls, [
      ['choose', 'grade'],
      ['goChapter', 'classes', 'copy'],
      ['openOptions', 'schedule-tour'],
      ['end', 'completed', 'schedule']
    ]);
  });

  test('"Set up my schedule" opens the existing calendar setup screen', () => {
    // #schedule-tour: the Class Schedule tab with its guided setup on top.
    const opts = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');
    a.ok(/guided && wanted === 'schedule'\) startScheduleTour\(\)/.test(opts));
    a.ok(C().tourScheduleStops.some((x) => x.id === 'opt-paste'));
  });

  test('each path is short and every stop in it exists', () => {
    const ids = C().tourStops.map((x) => x.id);
    Object.keys(C().tourPaths).forEach((p) => {
      a.ok(TourState.PATHS.includes(p), p + ' is a known path');
      C().tourPaths[p].forEach((id) => a.ok(ids.includes(id), p + ': ' + id));
    });
    a.ok(C().tourPaths.grade.length <= 5, 'Grade faster is a minute, not four');
    a.eq(stop(C().tourPaths.grade.slice(-1)[0]).kind, 'finale');
    a.eq(stop('grade-done').secondary.label, 'More tips');
    a.deep(C().tourPaths.copy.slice(-1), ['done']);
    a.not(C().tourPaths.copy.includes('schedule'), 'Copy to another class is only about copying');
  });

  test('the chosen path is remembered, so a reload carries on with it', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed() });
    const s = new TourState(store);
    await s.setPath('grade');
    await s.saveStop('statuses');
    const v = await s.read();
    a.eq(TourState.pathFor(v, 'gradebook'), 'grade');
    a.eq(v.stop, 'statuses');
    await s.setChapter('classes', 'copy');
    a.eq(TourState.pathFor(await s.read(), 'classes'), 'copy');
  });

  test('dismissal: closing the introduction is recorded as skipped, for good', async () => {
    const store = memoryStorage({ [TourState.KEY]: TourState.installed() });
    const s = new TourState(store);
    await s.markDone('skipped', 'intro', 'intro');
    a.eq(await s.isPending(), false);
    a.eq(store.bag[TourState.KEY].outcome, 'skipped');
    a.eq(store.bag[TourState.KEY].path, 'intro');
    a.not(TourState.wantedHere({ pathname: '/courses/5/gradebook', hash: '' }, store.bag[TourState.KEY]));
  });

  test('replay: the introduction again, whatever path was taken before', async () => {
    const store = memoryStorage({ [TourState.KEY]: { pending: false, flow: 2, path: 'grade', chapter: 'classes', stop: 'post', outcome: 'completed' } });
    await new TourState(store).request();
    const v = store.bag[TourState.KEY];
    a.eq(v.pending, true);
    a.eq(v.path, null);
    a.eq(v.stop, null);
    a.eq(TourState.pathFor(v, 'gradebook'), 'intro');
  });

  test('upgrade after the tour was completed: not shown again', async () => {
    const before = { pending: false, chapter: 'classes', stop: 'done', outcome: 'completed', lastStep: 'done', doneAt: 5, installedAt: 1 };
    const store = memoryStorage({ [TourState.KEY]: before });
    const s = new TourState(store);
    await s.handleInstalled('update');
    a.deep(store.bag[TourState.KEY], before, 'the record is untouched');
    a.eq(await s.isPending(), false);
    a.not(TourState.wantedHere({ pathname: '/courses/5/gradebook', hash: '' }, store.bag[TourState.KEY]));
  });

  test('upgrade after the tour was skipped, or with a replay already asked for', async () => {
    const skipped = memoryStorage({ [TourState.KEY]: { pending: false, outcome: 'skipped', lastStep: 'statuses' } });
    await new TourState(skipped).handleInstalled('update');
    a.eq(skipped.bag[TourState.KEY].pending, false);
    const replay = memoryStorage({ [TourState.KEY]: { pending: true, chapter: 'gradebook', stop: null, requestedAt: 3 } });
    await new TourState(replay).handleInstalled('update');
    a.eq(replay.bag[TourState.KEY].pending, true);
    a.eq(TourState.pathFor(replay.bag[TourState.KEY], 'gradebook'), 'intro', 'a replay asked for before the update opens with the introduction');
  });

  test('upgrade part-way through the old tour: it carries on from the same stop', async () => {
    const store = memoryStorage({ [TourState.KEY]: { pending: true, chapter: 'gradebook', stop: 'statuses', installedAt: 1 } });
    await new TourState(store).handleInstalled('update');
    const v = store.bag[TourState.KEY];
    a.eq(TourState.pathFor(v, 'gradebook'), 'full');
    a.ok(C().tourPaths.full.includes('statuses'));
    const part2 = { pending: true, chapter: 'classes', stop: 'classes-copy' };
    a.eq(TourState.pathFor(part2, 'classes'), 'classes');
    a.ok(C().tourPaths.classes.includes('classes-copy'));
  });

  test('a reinstall starts fresh, with the introduction', async () => {
    const store = memoryStorage({ [TourState.KEY]: { pending: false, path: 'grade', outcome: 'completed' } });
    await new TourState(store).handleInstalled('install');
    const v = store.bag[TourState.KEY];
    a.eq(v.pending, true); a.eq(v.flow, TourState.FLOW); a.eq(v.path, null); a.eq(v.outcome, undefined);
  });

  test('the introduction is never saved as a place to resume, and arrows never pick a choice', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/tour/tour.js'), 'utf8');
    a.ok(/s\.kind !== 'intro' && s\.kind !== 'finale'\) this\.remember/.test(src));
    a.ok(/picking = this\.stop\(\) && this\.stop\(\)\.kind === 'intro'/.test(src));
    a.ok(/markDone\(how, s && s\.id, opts\.path \|\| this\.path\)/.test(src), 'how it ended is recorded');
  });
});

