/* Studio's class list: asked for and answered by extension messaging only.
 *
 * It used to travel over window.postMessage between the Studio frame and
 * the Canvas page, where any script on the Studio page could ask for it and
 * read the answer (students' names and emails). Now studio/content.js asks
 * the service worker (studio-roster.js), which checks the asker and asks the
 * Canvas page's own script (studio/canvas-relay.js) in the same tab. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const ROOT = path.join(__dirname, '..');
const MODULE = pathToFileURL(path.join(ROOT, 'src', 'studio-roster.js')).href;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function fakeChrome(answer) {
  const asked = [];
  return {
    asked,
    chrome: {
      runtime: { id: 'ext' },
      tabs: {
        sendMessage: async (tabId, msg, opts) => {
          asked.push({ tabId, msg, opts });
          if (answer instanceof Error) throw answer;
          return answer;
        }
      }
    }
  };
}

const studioFrame = { id: 'ext', tab: { id: 7 }, frameId: 3, url: 'https://school.instructuremedia.com/lti/launch' };

function call(r, msg, sender) {
  return new Promise((resolve) => {
    const async = r.handle(msg, sender, resolve);
    if (async === false) setTimeout(() => resolve(undefined), 5);
  });
}

suite('Studio class list: the service worker hop', (test) => {
  test('a Studio frame\'s ask goes to its own tab\'s top frame, and the answer comes back', async () => {
    const { createStudioRoster, STUDIO_ROSTER, STUDIO_ROSTER_ASK } = await import(MODULE);
    const f = fakeChrome({ ok: true, courseId: '5', students: [{ id: '1', name: 'A', email: 'a@x.edu' }] });
    const res = await call(createStudioRoster(f.chrome), { type: STUDIO_ROSTER, courseName: 'Bio', courseId: '5' }, studioFrame);
    a.eq(res.ok, true);
    a.eq(res.students.length, 1);
    a.eq(f.asked.length, 1);
    a.eq(f.asked[0].tabId, 7, 'the asking frame\'s own tab');
    a.deep(f.asked[0].opts, { frameId: 0 }, 'the Canvas page itself, not another frame');
    a.deep(f.asked[0].msg, { type: STUDIO_ROSTER_ASK, courseName: 'Bio', courseId: '5' });
  });

  test('refused unless the asker is the extension, in a frame, on a Studio site', async () => {
    const { createStudioRoster, STUDIO_ROSTER } = await import(MODULE);
    const f = fakeChrome({ ok: true, students: [] });
    const r = createStudioRoster(f.chrome);
    const bad = [
      Object.assign({}, studioFrame, { id: 'other-extension' }),
      Object.assign({}, studioFrame, { frameId: 0 }),
      Object.assign({}, studioFrame, { tab: undefined }),
      Object.assign({}, studioFrame, { url: 'https://evil.example.com/' }),
      Object.assign({}, studioFrame, { url: 'https://instructuremedia.com.evil.com/' }),
      Object.assign({}, studioFrame, { url: 'http://school.instructuremedia.com/' }),
      Object.assign({}, studioFrame, { url: 'not a url' }),
      null
    ];
    for (const s of bad) {
      const res = await call(r, { type: STUDIO_ROSTER }, s);
      a.ok(!res || res.ok === false, 'refused: ' + JSON.stringify(s));
    }
    a.eq(f.asked.length, 0, 'the Canvas page was never asked');
  });

  test('the course id must be a number; the name is capped', async () => {
    const { createStudioRoster, STUDIO_ROSTER } = await import(MODULE);
    const f = fakeChrome({ ok: true, students: [] });
    await call(createStudioRoster(f.chrome), { type: STUDIO_ROSTER, courseName: 'x'.repeat(1000), courseId: '5; drop' }, studioFrame);
    a.eq(f.asked[0].msg.courseId, null);
    a.eq(f.asked[0].msg.courseName.length, 300);
  });

  test('no Canvas page script to answer: a plain failure, never a throw', async () => {
    const { createStudioRoster, STUDIO_ROSTER } = await import(MODULE);
    const f = fakeChrome(new Error('Receiving end does not exist.'));
    const res = await call(createStudioRoster(f.chrome), { type: STUDIO_ROSTER }, studioFrame);
    a.eq(res.ok, false);
  });

  test('the service worker routes the message to it', () => {
    const bg = read('src/background.js');
    a.ok(bg.includes("from './studio-roster.js'"));
    a.ok(/msg\.type === STUDIO_ROSTER\) return studioRoster\.handle\(msg, sender, respond\)/.test(bg));
  });
});

suite('Studio class list: the Canvas page answers the service worker only', (test) => {
  function loadRelay(opts) {
    const listeners = [];
    const ctx = {
      location: { pathname: '/courses/5/external_tools/9', origin: 'https://x.instructure.com' },
      chrome: { runtime: { id: 'ext', onMessage: { addListener: (fn) => listeners.push(fn) } } },
      window: null,
      CGP: {
        util: { describeApiError: () => 'failed' },
        CanvasApi: function () {
          this.teachingCourses = () => Promise.resolve([{ id: '5', name: 'Bio', workflow_state: 'available' }]);
          this.courseRoster = () => Promise.resolve([{ id: '1', name: 'Ann', sortable_name: 'Ann', email: 'ann@x.edu', login_id: 'ann' }]);
        }
      },
      Promise, String, Object, RegExp
    };
    ctx.window = ctx;
    ctx.self = ctx; ctx.top = ctx;
    ctx.globalThis = ctx;
    vm.runInNewContext(read('src/studio/canvas-relay.js'), ctx);
    return { listeners, ctx };
  }

  test('answers the service worker (no tab) with the class', async () => {
    const { listeners } = loadRelay();
    a.eq(listeners.length, 1);
    const res = await new Promise((resolve) => {
      a.eq(listeners[0]({ type: 'cgp.studio.roster.ask', courseName: 'Bio', courseId: '5' }, { id: 'ext' }, resolve), true);
    });
    a.eq(res.ok, true);
    a.eq(res.courseId, '5');
    a.eq(res.students[0].email, 'ann@x.edu');
  });

  test('ignores a content script in some tab, another extension, and other messages', () => {
    const { listeners } = loadRelay();
    let answered = false;
    const respond = () => { answered = true; };
    a.eq(listeners[0]({ type: 'cgp.studio.roster.ask' }, { id: 'ext', tab: { id: 1 } }, respond), false);
    a.eq(listeners[0]({ type: 'cgp.studio.roster.ask' }, { id: 'other' }, respond), false);
    a.eq(listeners[0]({ type: 'something.else' }, { id: 'ext' }, respond), false);
    a.not(answered);
  });

  test('neither side uses window.postMessage for the class list any more', () => {
    const relay = read('src/studio/canvas-relay.js');
    const studio = read('src/studio/content.js');
    a.not(/addEventListener\('message'/.test(relay), 'the Canvas page no longer listens to frames for it');
    a.not(/cgp-studio-ask|cgp-canvas-relay/.test(relay + studio), 'the old postMessage names are gone');
    a.ok(/runtime\.sendMessage\(\{ type: ROSTER_MESSAGE/.test(studio), 'Studio asks through the extension');
  });
});
