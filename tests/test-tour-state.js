/* The tutorials: one per part of Gradebook+, each tracked on its own, so
 * skipping one never hides the others. Offered after a fresh install, never
 * on an update, and always available from the options page's Tutorials. */
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


suite('Tutorials: each part on its own', (test) => {
  const C = () => globalThis.CGP;
  const fresh = () => memoryStorage({ [TourState.KEY]: TourState.installed(1) });
  const rec = (store) => store.bag[TourState.KEY];
  const ids = TourState.SECTIONS.map((s) => s.id);

  test('there is a tutorial for each part, and each has stops and a last card', () => {
    a.deep(ids, ['grading', 'student', 'tools', 'snippets', 'classes', 'groups', 'schedule']);
    const stopIds = C().tourStops.map((x) => x.id);
    ids.forEach((id) => {
      const p = C().tourPaths[id];
      a.ok(p && p.length >= 3 && p.length <= 6, id + ' is short');
      p.forEach((s) => a.ok(stopIds.includes(s), id + ': ' + s));
      const fin = C().tourFinales[id];
      a.ok(!fin || !fin.body || fin.body.replace(/<[^>]+>/g, '').length <= 120, id + ': a last card says at most one thing');
    });
  });

  test('cards stay short: a title, at most three sentences, at most three bullets', () => {
    C().tourStops.forEach((s) => {
      const text = (s.body || '').replace(/<[^>]+>/g, '');
      a.ok(text.length <= 300, s.id + ' body is ' + text.length + ' characters');
      a.ok((text.match(/[.!?](\s|$)/g) || []).length <= 3, s.id + ' body has at most three sentences');
      // One word for one thing: a teacher's classes are never "sections".
      a.not(/\bsections\b/i.test(text + JSON.stringify(s.bullets || []) + (s.title || '')), s.id + ' says "classes", not "sections"');
      a.ok(!s.bullets || s.bullets.length <= 3, s.id + ' bullets');
      a.ok(s.title && s.title.length <= 60, s.id + ' title');
      a.not('eyebrow' in s, s.id + ': cards are labelled with their tutorial’s name, not their own');
    });
  });

  test('wording matches what the extension shows', () => {
    const all = JSON.stringify(C().tourStops.map((s) => [s.title, s.body, s.bullets, s.try, s.fallbackNote])) + JSON.stringify(C().tourFinales);
    // Gone from the extension or never there: keep them out of the tour.
    a.not(/purple/i.test(all), 'replies are not a purple bubble');
    a.not(/amber bar/i.test(all), 'hidden grades get no bar');
    a.not(/c-amber/.test(all), 'the Post button is blue');
    a.not(/Use this version in/.test(all));
    a.not(/Also post to your other classes/.test(all));
    a.not(/course name is now a menu/i.test(all));
    a.not(/refreshes every six hours/i.test(all));
    // Labels as they read on screen.
    a.ok(all.includes('Switch course'));
    a.ok(all.includes('Also copy to your linked courses'));
    a.ok(all.includes('Pick a version…'));
    a.ok(all.includes('Copy List of Missing/Late Work'));
    const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    a.ok(src('src/gradebook/course-switcher.js').includes('Switch course'));
    a.ok(src('src/sections/inline-copy.js').includes('Also copy to your linked courses'));
    a.ok(src('src/sections/sync-board.js').includes('Pick a version…'));
    a.ok(/e\.code === 'KeyH'/.test(src('src/gradebook/layout.js')), 'Option+Shift+H works on a Mac');
  });

  test('an install that predates the tour (no record) is offered nothing on its own', () => {
    a.eq(TourState.decide({}, 'gradebook', null, []), null);
    a.eq(TourState.decide({}, 'home', null, []), null);
    a.not(TourState.wantedHere({ pathname: '/courses/5/gradebook', hash: '' }, {}, []));
  });

  test('a fresh install shows the welcome card on the gradebook, and an offer elsewhere', () => {
    const v = TourState.installed(1);
    a.deep(TourState.decide(v, 'gradebook', null, []), { kind: 'welcome' });
    a.deep(TourState.decide(v, 'other', null, []), { kind: 'offer', section: 'welcome' });
    a.eq(TourState.decide(v, 'other', null, ['welcome']), null, 'closed with X: not again in this tab');
  });

  test('closing the welcome card hides none of the tutorials', async () => {
    const store = fresh();
    const s = new TourState(store);
    await s.welcomeSeen();
    const v = rec(store);
    ids.forEach((id) => a.eq(TourState.statusOf(v, id), 'new', id));
    a.deep(TourState.decide(v, 'gradebook', null, []), { kind: 'offer', section: 'grading' });
    a.deep(TourState.decide(v, 'home', null, []), { kind: 'offer', section: 'classes' });
  });

  test('skipping one tutorial leaves every other one available', async () => {
    const store = fresh();
    const s = new TourState(store);
    await s.welcomeSeen();
    await s.begin('grading', 'statuses');
    await s.finish('grading', 'skipped');
    const v = rec(store);
    a.eq(TourState.statusOf(v, 'grading'), 'skipped');
    ['student', 'tools', 'snippets', 'classes', 'groups', 'schedule'].forEach((id) => a.eq(TourState.statusOf(v, id), 'new', id));
    a.eq(v.active, null);
    a.deep(TourState.decide(v, 'gradebook', null, []), { kind: 'offer', section: 'student' }, 'the next one is offered');
    await s.finish('student', 'skipped');
    await s.finish('tools', 'done');
    a.deep(TourState.decide(rec(store), 'home', null, []), { kind: 'offer', section: 'classes' }, 'course page tutorials are untouched');
    a.deep(TourState.decide(rec(store), 'gradebook', null, []), { kind: 'offer', section: 'snippets' }, 'snippets are offered on the gradebook');
    await s.finish('snippets', 'skipped');
    a.eq(TourState.decide(rec(store), 'gradebook', null, []), null, 'nothing left for the gradebook');
    a.deep(TourState.decide(rec(store), 'people', null, []), { kind: 'offer', section: 'groups' }, 'Make groups is still offered');
  });

  test('closing an offer with X hides only that offer, only in this tab', () => {
    const v = { flow: 3, welcome: 'seen', sections: {} };
    a.deep(TourState.decide(v, 'gradebook', null, ['grading']), { kind: 'offer', section: 'student' });
    a.deep(TourState.decide(v, 'gradebook', null, []), { kind: 'offer', section: 'grading' });
  });

  test('the class schedule is offered on the course home page, after copying', () => {
    const v = { flow: 3, welcome: 'seen', sections: { classes: 'skipped' } };
    a.deep(TourState.decide(v, 'home', null, []), { kind: 'offer', section: 'schedule' });
    a.eq(TourState.decide(v, 'other', null, []), null, 'other course pages stay quiet');
  });

  test('a tutorial part-way carries on where it was, on its own page', async () => {
    const store = fresh();
    const s = new TourState(store);
    await s.welcomeSeen();
    await s.begin('student');
    await s.saveStop('si-work');
    a.deep(TourState.decide(rec(store), 'gradebook', null, []), { kind: 'tour', section: 'student', stop: 'si-work' });
    a.deep(TourState.decide(rec(store), 'home', null, []), { kind: 'offer', section: 'student', resume: true });
  });

  test('the address can ask for the welcome card or one tutorial', () => {
    a.eq(TourState.sectionFromHash('#cgp-tour'), 'welcome');
    a.eq(TourState.sectionFromHash('#cgp-tour=classes'), 'classes');
    a.eq(TourState.sectionFromHash('#cgp-tour=gradebook'), 'welcome', 'an old link');
    a.eq(TourState.sectionFromHash('#cgp-student=12'), null);
    const done = { flow: 3, welcome: 'seen', sections: { classes: 'done' } };
    a.deep(TourState.decide(done, 'home', 'classes', []), { kind: 'tour', section: 'classes', stop: null }, 'even one already seen');
    a.deep(TourState.decide(done, 'gradebook', 'welcome', []), { kind: 'welcome' });
  });

  test('never in SpeedGrader, never outside a course', () => {
    const v = TourState.installed();
    a.not(TourState.wantedHere({ pathname: '/courses/5/gradebook/speed_grader', hash: '' }, v, []));
    a.not(TourState.wantedHere({ pathname: '/profile/settings', hash: '' }, v, []));
    a.ok(TourState.wantedHere({ pathname: '/courses/5/gradebook', hash: '' }, v, []));
    a.ok(TourState.wantedHere({ pathname: '/courses/5', hash: '#cgp-tour=classes' }, {}, []));
    a.eq(TourState.pageKind('/courses/5/gradebook'), 'gradebook');
    a.eq(TourState.pageKind('/courses/5'), 'home');
    a.eq(TourState.pageKind('/courses/5/modules'), 'other');
    a.eq(TourState.pageKind('/courses/5/users'), 'people');
    a.eq(TourState.pageKind('/courses/5/groups'), 'people');
  });

  test('"Show me" in the options page starts one tutorial, even one seen before', async () => {
    const store = memoryStorage({ [TourState.KEY]: { flow: 3, welcome: 'seen', sections: { student: 'done', grading: 'skipped' } } });
    await new TourState(store).request('student');
    const v = rec(store);
    a.eq(TourState.statusOf(v, 'student'), 'new');
    a.eq(TourState.statusOf(v, 'grading'), 'skipped', 'the others are left as they were');
    a.deep(TourState.decide(v, 'gradebook', null, []), { kind: 'tour', section: 'student', stop: null });
    await new TourState(store).begin('student');
    a.eq(rec(store).requested, null, 'started: no longer waiting');
  });

  test('"Show the welcome card again" resets every tutorial', async () => {
    const store = memoryStorage({ [TourState.KEY]: { flow: 3, welcome: 'seen', sections: { student: 'done', grading: 'skipped' } } });
    await new TourState(store).request();
    const v = rec(store);
    a.eq(v.welcome, 'due');
    ids.forEach((id) => a.eq(TourState.statusOf(v, id), 'new'));
  });

  test('the next tutorial suggested is the next one not yet seen', () => {
    const v = { flow: 3, sections: { grading: 'done', student: 'skipped' } };
    a.eq(TourState.nextNew(v, 'grading'), 'tools');
    const allBut = (id) => { const o = {}; ids.forEach((x) => { if (x !== id) o[x] = 'done'; }); return { flow: 3, sections: o }; };
    a.eq(TourState.nextNew(allBut('schedule'), 'classes'), 'schedule');
    a.eq(TourState.nextNew(allBut('nothing'), 'schedule'), null);
  });

  test('records from the old single tour: what was finished stays finished, the rest is offered', () => {
    const skippedIntro = TourState.normalize({ pending: false, flow: 2, outcome: 'skipped', lastStep: 'intro', path: 'intro' });
    ids.forEach((id) => a.eq(TourState.statusOf(skippedIntro, id), 'new', 'closing the old intro hid ' + id));
    a.eq(skippedIntro.welcome, 'seen', 'no welcome card on an update');
    const grade = TourState.normalize({ pending: false, flow: 2, outcome: 'completed', path: 'grade' });
    a.eq(TourState.statusOf(grade, 'grading'), 'done');
    a.eq(TourState.statusOf(grade, 'student'), 'new');
    const all = TourState.normalize({ pending: false, chapter: 'classes', outcome: 'completed', lastStep: 'done' });
    ['grading', 'student', 'tools', 'classes', 'schedule'].forEach((id) => a.eq(TourState.statusOf(all, id), 'done'));
    ['snippets', 'groups'].forEach((id) => a.eq(TourState.statusOf(all, id), 'new', id + ' was never in the old tour'));
    const partway = TourState.normalize({ pending: true, chapter: 'gradebook', stop: 'statuses' });
    a.deep(partway.active, { section: 'grading', stop: 'statuses' });
    const freshOld = TourState.normalize({ pending: true, flow: 2, chapter: 'gradebook', path: null, stop: null });
    a.eq(freshOld.welcome, 'due');
  });

  test('a fresh install, and only a fresh install, writes the record', async () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(/onInstalled[\s\S]{0,400}handleInstalled\(details\.reason\)/.test(bg));
    const before = { pending: false, outcome: 'skipped' };
    const store = memoryStorage({ [TourState.KEY]: before });
    await new TourState(store).handleInstalled('update');
    a.deep(rec(store), before, 'an update touches nothing');
    await new TourState(store).handleInstalled('install');
    a.eq(rec(store).welcome, 'due');
    a.deep(rec(store).sections, {});
  });

  test('writes run in order: a progress save in flight never undoes "finished"', async () => {
    let slow = true;
    const bag = { [TourState.KEY]: TourState.installed() };
    const store = {
      get: async (k) => ({ [k]: bag[k] }),
      set: (o) => new Promise((r) => setTimeout(() => { Object.assign(bag, JSON.parse(JSON.stringify(o))); r(); }, slow ? 30 : 0))
    };
    const s = new TourState(store);
    await s.begin('tools');
    const p1 = s.saveStop('gear');
    slow = false;
    const p2 = s.finish('tools', 'skipped');
    await Promise.all([p1, p2]);
    a.eq(bag[TourState.KEY].active, null);
    a.eq(bag[TourState.KEY].sections.tools, 'skipped');
  });

  test('storage failures: reads as nothing to show; "Show me" reports it', async () => {
    const broken = { get: () => Promise.reject(new Error('context invalidated')), set: () => Promise.reject(new Error('x')) };
    const s = new TourState(broken);
    a.eq(TourState.decide(await s.read(), 'gradebook', null, []), null);
    await s.finish('grading', 'skipped'); // must not throw
    let failed = false;
    await new TourState({ get: async () => ({}), set: async () => { throw new Error('quota'); } }).request('student').catch(() => { failed = true; });
    a.ok(failed);
  });

  test('the new tutorials point at what the extension draws', () => {
    const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const gb = src('src/groups/group-builder.js');
    ['cgp-groups-btn', 'Make groups', 'Shuffle them in', 'I’ll choose', 'Students sign up', 'Arrange students', 'Shuffle everyone', 'Copy to…', 'Save to my styles']
      .forEach((t) => a.ok(gb.includes(t), 'Make groups shows ' + t));
    const si = src('src/gradebook/student-insights.js');
    ['Parents & guardians', 'Copy all', "'profile', 'Profile'"].forEach((t) => a.ok(si.includes(t), 'Profile tab: ' + t));
    a.ok(src('src/speedgrader/content.js').includes('Unsent draft restored'));
    const html = src('src/options/options.html');
    ['snippets-manager', 'snippets-test-box', '+ Add Snippet'].forEach((t) => a.ok(html.includes(t), 'Snippets tab: ' + t));
  });

  test('every kind of card content a stop uses is drawn', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/tour/tour.js'), 'utf8');
    const used = new Set();
    C().tourStops.forEach((x) => ['body', 'bullets', 'steps', 'tiles', 'try', 'art'].forEach((k) => { if (x[k]) used.add(k); }));
    used.forEach((k) => a.ok(new RegExp('s\\.' + k + '\\b').test(src), 'render() draws s.' + k));
  });

  test('illustrations are drawn from the real components, and only where a card has nothing live to show', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/tour/tour.js'), 'utf8');
    a.ok(/s\.art && \(!live \|\| usedFallback\)/.test(src), 'no drawing beside the real thing');
    C().tourStops.filter((x) => x.art).forEach((x) => {
      const html = x.art();
      a.ok(typeof html === 'string' && html.length > 20, x.id + ' draws');
      a.not(/class="(mk-|lg|mc|si-demo|status-demo|sel-demo|post-demo|mail-demo|link-demo|copy-demo|board-demo|assign-demo|heat |find-demo)/.test(html), x.id + ' uses the new drawings');
    });
    // Labels the drawings borrow from the features.
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    a.ok(read('src/assignments/course-schedule.js').includes('Click a class to put its '));
    a.ok(read('src/gradebook/score-analysis.js').includes('Distribution by letter grade'));
    a.ok(read('src/sections/sync-dialog.js').includes('Link your classes'));
  });

  test('motion: one spring for everything, interruptible, and still with reduced motion', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/tour/tour.js'), 'utf8');
    a.ok(/var SPRING = springEasing\(/.test(src), 'a shared spring easing');
    a.not(/'\.spot\{[^']*transition:transform/.test(src), 'the spotlight follows the page directly, never trailing behind it');
    a.not(/'\.card\{[^']*transition:transform/.test(src), 'nor does the card');
    a.ok(/Tour\.prototype\.snapshot = function/.test(src) && /this\.snapshot\(\)/.test(src), 'a move starts from where things are on screen');
    a.ok(/if \(this\._morph && !force\) return;/.test(src), 'nothing fights a running move');
    a.ok(/reducedMotion\(\)/.test(src.slice(src.indexOf('Tour.prototype.morph'), src.indexOf('Tour.prototype.settle'))), 'reduced motion cross-fades instead of moving');
    a.not(/\*,\*::before,\*::after\{animation-duration/.test(src), 'no blanket animation kill-switch');
    a.not(/scrollIntoView\(\{[^}]*\}\);\s*if \(res/.test(src), 'does not trust the early-resolving scrollIntoView promise');
  });

  test('every student-overview stop that opens the overview also closes it', () => {
    C().tourStops.filter((x) => x.group === 'si').forEach((x) => a.ok(typeof x.enter === 'function' && typeof x.leave === 'function', x.id));
  });

  test('only the small record module loads on every course page; the tour itself is injected on demand', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts.find((c) => (c.js || []).includes('src/gradebook/content.js')).js;
    const list = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
    a.ok(js.includes('src/tour/tour-state.js'));
    a.ok(list.includes("'src/tour/tour-state.js'"));
    TourState.FILES.forEach((f) => {
      a.not(js.includes(f), f + ' is not a static content script');
      a.not(list.includes("'" + f + "'"), f + ' is not in script-manifest.js');
      a.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
    });
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(bg.includes("import './tour/tour-state.js'"));
    a.ok(/msg\.type === TourState\.INJECT[\s\S]*executeScript[\s\S]*files: TourState\.FILES/.test(bg));
    a.ok(bg.includes('/^[a-z]+(-tour)?$/'), '#schedule-tour opens the class schedule tutorial');
  });

  test('the options page lists every tutorial and starts the schedule one in place', () => {
    const opts = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
    a.ok(/if \(guided\) startOptionsTour\(wanted\)/.test(opts));
    a.ok(opts.includes('new CGP.Tour({ section: id'));
    TourState.SECTIONS.filter((x) => x.page === 'options').forEach((x) => {
      a.ok(html.includes('data-tab="' + x.id + '"'), x.id + ' has an options tab of the same name');
      a.ok(x.offerOn, x.id + ' is offered on a Canvas page');
    });
    a.ok(opts.includes('TS.SECTIONS.forEach'));
    a.ok(opts.includes('.request(sec.id)'));
    a.ok(html.includes('id="tutorials"') && html.includes('id="tutorialsList"'));
    a.ok(html.indexOf('../tour/tour.js') > 0 && html.indexOf('../tour/tour.js') < html.indexOf('options.js"'));
    a.not(opts.includes("'cgp.tour'"), 'no second copy of the key');
  });

  test('the tour cleans up after itself, and Escape or X skips only the tutorial on screen', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/tour/tour.js'), 'utf8');
    a.not(/function tick\b/.test(src), 'no requestAnimationFrame loop');
    a.ok(src.includes('ResizeObserver'));
    a.ok(src.includes('chrome.storage.onChanged.removeListener(on)'));
    a.ok(/state\.finish\(this\.section, how === 'done' \? 'done' : 'skipped'\)/.test(src));
    a.ok(src.includes('aria-label="Skip this tutorial"'));
    a.not(/markDone/.test(src), 'nothing ends every tutorial at once');
  });
});
