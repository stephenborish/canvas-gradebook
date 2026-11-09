/* Page-load speed: what has to happen before the gradebook can show
 * anything, and what every course page (and every frame in it) pays.
 *
 * - The model reads numbered list pages several at a time, and background
 *   warming (prefetch, the comment double-check) waits behind columns the
 *   teacher is looking at.
 * - Who is signed in is read once per page, however many parts ask.
 * - Frames inside a course page get a small gate script, not the whole
 *   content-script set; only a comment editor's frame in the gradebook or
 *   SpeedGrader asks for the few scripts snippets need. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;
const ROOT = path.resolve(__dirname, '..');

function response(status, body, headers) {
  return {
    ok: status >= 200 && status < 300, status,
    text: () => Promise.resolve(body === undefined ? '[]' : body),
    headers: { get: (h) => (headers || {})[h] || (headers || {})[h.toLowerCase()] || null }
  };
}

/* A client whose list reads record the defaults they were sent with. */
function recordingApi() {
  const reads = [];
  const api = {
    _defaults: null,
    withDefaults(defs) {
      const view = Object.create(api);
      view._defaults = Object.assign({}, this._defaults || {}, defs);
      return view;
    },
    currentUser: () => Promise.resolve({ id: '1', name: 'T' }),
    assignments(courseId) { reads.push({ name: 'assignments', defaults: this._defaults }); return Promise.resolve([{ id: '50', name: 'A' }, { id: '51', name: 'B' }]); },
    studentEnrollments(courseId) { reads.push({ name: 'enrollments', defaults: this._defaults }); return Promise.resolve([{ user: { id: '10', name: 'S' }, grades: {} }]); },
    submissionsForAssignments(courseId, ids) { reads.push({ name: 'submissions', ids: ids.slice(), defaults: this._defaults }); return Promise.resolve([]); },
    submissionsForAssignment(courseId, id) { reads.push({ name: 'verify', id, defaults: this._defaults }); return Promise.resolve([]); }
  };
  return { api, reads };
}

suite('load speed: the gradebook model', (test) => {
  test('the first reads go out with numbered pages read in parallel, at normal priority', async () => {
    const { api, reads } = recordingApi();
    const model = new CGP.GradebookModel(api, '7');
    await model.init();
    const first = reads.filter((r) => r.name === 'assignments' || r.name === 'enrollments');
    a.eq(first.length, 2);
    first.forEach((r) => {
      a.eq(r.defaults.parallel, true, r.name + ' parallel');
      a.eq(r.defaults.priority, undefined, r.name + ' keeps normal priority');
    });
  });

  test('a column the teacher is looking at is read at normal priority; background warming at low', async () => {
    const { api, reads } = recordingApi();
    const model = new CGP.GradebookModel(api, '7');
    await model.init();
    await model.ensureAssignments(['50']);
    const visible = reads.filter((r) => r.name === 'submissions')[0];
    a.deep(visible.ids, ['50']);
    a.eq(visible.defaults.parallel, true);
    a.eq(visible.defaults.priority, undefined);

    await model.prefetchRemaining();
    const warm = reads.filter((r) => r.name === 'submissions')[1];
    a.deep(warm.ids, ['51']);
    a.eq(warm.defaults.priority, 'low', 'prefetch waits behind on-screen columns');

    await model.verifyVisibleComments(['50']);
    const verify = reads.filter((r) => r.name === 'verify')[0];
    a.eq(verify.defaults.priority, 'low', 'the comment double-check waits too');
  });

  test('a client without withDefaults (a test double, an older caller) is used as it is', async () => {
    const calls = [];
    const api = {
      currentUser: () => Promise.resolve(null),
      assignments: () => { calls.push('a'); return Promise.resolve([]); },
      studentEnrollments: () => { calls.push('e'); return Promise.resolve([]); }
    };
    const model = new CGP.GradebookModel(api, '7');
    await model.init();
    a.deep(calls.sort(), ['a', 'e']);
    a.ok(model.ready);
  });

  test('getAll in parallel mode reads every numbered page and keeps their order', async () => {
    const base = 'https://x.instructure.com/api/v1/courses/1/assignments';
    const seen = [];
    const api = new CGP.CanvasApi({ origin: 'https://x.instructure.com', fetch: (url) => {
      const page = Number(new URL(url).searchParams.get('page') || 1);
      seen.push(page);
      const link = page === 1 ? '<' + base + '?page=2&per_page=100>; rel="next", <' + base + '?page=4&per_page=100>; rel="last"' : null;
      // Later pages answer first, to prove the order is by page, not arrival.
      return new Promise((res) => setTimeout(() => res(response(200, JSON.stringify([{ id: 'p' + page }]), link ? { Link: link } : {})), page === 1 ? 0 : 20 - page * 4));
    } }).withDefaults({ parallel: true });
    const list = await api.getAll('/api/v1/courses/1/assignments');
    a.deep(list.map((x) => x.id), ['p1', 'p2', 'p3', 'p4']);
    a.deep(seen.slice().sort(), [1, 2, 3, 4]);
  });
});

suite('load speed: who is signed in', (test) => {
  test('several clients on the page share one read; a failed read is tried again', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    let fail = true;
    globalThis.fetch = () => {
      calls++;
      if (fail) return Promise.resolve(response(404, '{"errors":[]}'));
      return Promise.resolve(response(200, '{"id":"5","name":"Teacher"}'));
    };
    try {
      const origin = 'https://share-' + Date.now() + '.instructure.com';
      const one = new CGP.CanvasApi({ origin });
      let err = null;
      await one.currentUser().catch((e) => { err = e; });
      a.ok(err, 'the failure reaches the caller');
      fail = false;
      const two = new CGP.CanvasApi({ origin });
      const [u1, u2] = await Promise.all([one.currentUser(), two.currentUser()]);
      a.eq(u1.id, '5');
      a.eq(u2.id, '5');
      await one.withDefaults({ priority: 'high' }).currentUser();
      a.eq(calls, 2, 'one failed read, then one shared read');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a client with its own fetch keeps to itself', async () => {
    let calls = 0;
    const f = () => { calls++; return Promise.resolve(response(200, '{"id":"5"}')); };
    const origin = 'https://own-' + Date.now() + '.instructure.com';
    await new CGP.CanvasApi({ origin, fetch: f }).currentUser();
    await new CGP.CanvasApi({ origin, fetch: f }).currentUser();
    a.eq(calls, 2);
  });
});

/* ------------------------------------------------------------------ frames */

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/frame-gate.js'), 'utf8'), { filename: 'src/frame-gate.js' });
const FrameGate = globalThis.CGP.FrameGate;

function fakeWindow(path, parentPath, opts) {
  opts = opts || {};
  const top = { location: { pathname: parentPath } };
  const win = { location: { pathname: path }, document: { referrer: opts.referrer || '' } };
  win.self = win;
  if (opts.isTop) { win.top = win; win.parent = win; } else { win.top = top; win.parent = top; }
  return win;
}

function fakeRuntime() {
  const sent = [];
  return { sent, lastError: null, sendMessage(msg, cb) { sent.push(msg); if (cb) cb({ ok: true }); } };
}

suite('load speed: frames inside a course page', (test) => {
  test('the page itself asks for nothing: it already has every script', () => {
    delete CGP._frameScriptsRequested;
    const rt = fakeRuntime();
    a.eq(FrameGate.run(fakeWindow('/courses/1/gradebook', null, { isTop: true }), rt), false);
    a.eq(rt.sent.length, 0);
  });

  test('a frame on an ordinary course page asks for nothing', () => {
    const saved = CGP.snippets;
    delete CGP.snippets;
    delete CGP._frameScriptsRequested;
    try {
      const rt = fakeRuntime();
      a.eq(FrameGate.run(fakeWindow('blank', '/courses/1/assignments/2/edit'), rt), false);
      a.eq(FrameGate.run(fakeWindow('blank', '/courses/1/discussion_topics/3'), rt), false);
      a.eq(rt.sent.length, 0);
    } finally { CGP.snippets = saved; }
  });

  test('a comment frame in the gradebook or SpeedGrader asks once, then loads settings', () => {
    const saved = { snippets: CGP.snippets, settings: CGP.settings };
    delete CGP.snippets;
    delete CGP._frameScriptsRequested;
    let loads = 0;
    CGP.settings = { load: () => { loads++; return Promise.resolve({}); } };
    try {
      const rt = fakeRuntime();
      a.eq(FrameGate.run(fakeWindow('blank', '/courses/1/gradebook/speed_grader'), rt), true);
      a.deep(rt.sent, [{ type: FrameGate.MESSAGE }]);
      a.eq(loads, 1, 'the teacher’s snippets, once the scripts have run');
      a.eq(FrameGate.run(fakeWindow('blank', '/courses/1/gradebook/speed_grader'), rt), false, 'only once');
      delete CGP._frameScriptsRequested;
      a.eq(FrameGate.run(fakeWindow('blank', '/courses/1/gradebook'), rt), true);
      delete CGP._frameScriptsRequested;
      a.eq(FrameGate.run(fakeWindow('/x', '/elsewhere', { referrer: 'https://x.instructure.com/courses/1/gradebook/speed_grader?assignment_id=1' }), rt), true, 'by referrer when the parent is unreadable');
    } finally {
      CGP.snippets = saved.snippets;
      CGP.settings = saved.settings;
      delete CGP._frameScriptsRequested;
    }
  });

  test('the full set runs in the page only; frames get the gate, in both lists', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const main = manifest.content_scripts.find((cs) => (cs.js || []).indexOf('src/gradebook/content.js') >= 0);
    a.ok(!main.all_frames, 'the full set is not injected into frames');
    a.ok(!main.match_about_blank);
    const gate = manifest.content_scripts.find((cs) => (cs.js || []).indexOf('src/frame-gate.js') >= 0);
    a.ok(gate && gate.all_frames && gate.match_about_blank, 'the gate reaches every frame, blank ones too');
    a.deep(gate.matches, main.matches);
    a.ok(!gate.css, 'no stylesheets in frames: every rule is scoped to the page’s own cgp- classes');

    const list = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
    const block = /export const FRAME_JS = \[([\s\S]*?)\];/.exec(list);
    a.ok(block, 'FRAME_JS found');
    a.deep(block[1].match(/'[^']+'/g).map((s) => s.slice(1, -1)), gate.js);

    FrameGate.FILES.forEach((f) => {
      a.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
      a.ok(main.js.indexOf(f) >= 0, f + ' is one of the page’s own scripts');
    });

    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    a.ok(bg.includes("import './frame-gate.js'"), 'background shares the gate’s file list');
    a.ok(/msg\.type === FrameGate\.MESSAGE[\s\S]*executeScript[\s\S]*files: FrameGate\.FILES/.test(bg), 'background injects on request');
    a.ok(/id: DYNAMIC_ID,[\s\S]*?allFrames: false/.test(bg), 'self-hosted Canvas: the full set in the page only');
    a.ok(/id: DYNAMIC_FRAME_ID,[\s\S]*?js: FRAME_JS,[\s\S]*?allFrames: true/.test(bg), 'self-hosted Canvas: the gate in frames');
  });

  test('every stylesheet rule is scoped to a cgp- class, so frames lose nothing without them', () => {
    for (const f of ['src/styles/gradebook.css', 'src/styles/speedgrader.css']) {
      const css = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const re = /([^{};]+)\{/g;
      let m;
      while ((m = re.exec(css))) {
        const sel = m[1].trim();
        if (sel.startsWith('@') || /^(from|to|\d+%)/.test(sel)) continue;
        a.ok(/cgp/.test(sel), f + ': unscoped rule ' + sel.slice(0, 80));
      }
    }
  });
});
