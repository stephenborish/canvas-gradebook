/* Settings on every computer: the per-item change times the service worker
 * keeps (settings-times.js), and the merge with the copy in the teacher's
 * Canvas account (core/settings-mirror.js). */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const TIMES = pathToFileURL(path.join(__dirname, '..', 'src', 'settings-times.js')).href;
function M() { return globalThis.CGP.settingsMirror; }

function bag() {
  const data = {};
  return {
    data,
    get: async (k) => {
      if (k === null || k === undefined) return Object.assign({}, data);
      const out = {};
      [].concat(k).forEach((x) => { if (x in data) out[x] = JSON.parse(JSON.stringify(data[x])); });
      return out;
    },
    set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))); },
    remove: async (ks) => { [].concat(ks).forEach((x) => delete data[x]); }
  };
}

function fakeChrome() {
  const listeners = [];
  const sync = bag();
  const local = bag();
  const chrome = { storage: { sync, local, onChanged: { addListener: (f) => listeners.push(f) } } };
  return { chrome, sync, local, listeners };
}

suite('settings everywhere: change times', (test) => {
  test('a setting’s change is timed; putting back the recorded value is not a change', async () => {
    const { createSettingsTimes, valueHash } = await import(TIMES);
    const f = fakeChrome();
    let t = 1000;
    const st = createSettingsTimes(f.chrome, () => t);
    a.eq(await st.onChanged({ 'cgp.setting.enableM': { newValue: false } }, 'sync'), 1);
    a.deep(f.local.data['cgp.st.cgp.setting.enableM'], { at: 1000, h: valueHash(false) });
    t = 2000;
    a.eq(await st.onChanged({ 'cgp.setting.enableM': { oldValue: true, newValue: false } }, 'sync'), 0, 'same value');
    a.eq(await st.onChanged({ 'cgp.snippet.nice': { oldValue: { text: 'x' } } }, 'sync'), 1);
    a.deep(f.local.data['cgp.st.cgp.snippet.nice'], { at: 2000, h: 'deleted', del: true });
    a.eq(await st.onChanged({ 'cgp.device.abc': { newValue: {} }, 'cgp.diag': { newValue: {} } }, 'sync'), 0, 'not settings');
    a.eq(await st.onChanged({ 'cgp.setting.enableM': { newValue: true } }, 'local'), 0, 'only sync');
  });

  test('each computer checks in through Chrome sync, every few hours; old ones are forgotten', async () => {
    const { createSettingsTimes } = await import(TIMES);
    const f = fakeChrome();
    let t = 10 * 86400000 * 100;
    f.sync.data['cgp.device.gone'] = { at: 1, label: 'Mac' };
    const st = createSettingsTimes(f.chrome, () => t);
    a.ok(await st.checkIn(false));
    const mine = Object.keys(f.sync.data).filter((k) => k.indexOf('cgp.device.') === 0);
    a.eq(mine.length, 1, 'the long-gone computer is dropped');
    a.not(await st.checkIn(false), 'not again so soon');
    t += 7 * 3600000;
    a.ok(await st.checkIn(false));
  });
});

suite('settings everywhere: the merge with the Canvas copy', (test) => {
  test('a fresh computer takes everything from Canvas', () => {
    const p = M().plan({}, {}, { 'cgp.setting.enableM': { at: 500, v: false }, 'cgp.snippet.nice': { at: 400, v: { trigger: 'nice', text: 'Hi', pos: 0 } } }, 0);
    a.deep(p.set, { 'cgp.setting.enableM': false, 'cgp.snippet.nice': { trigger: 'nice', text: 'Hi', pos: 0 } });
    a.eq(Object.keys(p.push).length, 0);
    a.eq(p.times['cgp.setting.enableM'].at, 500);
  });

  test('the newer change wins, item by item, both ways', () => {
    const local = { 'cgp.setting.enableM': true, 'cgp.setting.enableE': false, 'cgp.snippet.a': { text: 'mine' } };
    const times = { 'cgp.setting.enableM': { at: 100 }, 'cgp.setting.enableE': { at: 900 }, 'cgp.snippet.a': { at: 50 } };
    const remote = { 'cgp.setting.enableM': { at: 800, v: false }, 'cgp.setting.enableE': { at: 300, v: true }, 'cgp.snippet.b': { at: 10, v: { text: 'theirs' } } };
    const p = M().plan(local, times, remote, 0);
    a.deep(p.set, { 'cgp.setting.enableM': false, 'cgp.snippet.b': { text: 'theirs' } });
    a.deep(p.push, { 'cgp.setting.enableE': { at: 900, v: false }, 'cgp.snippet.a': { at: 50, v: { text: 'mine' } } });
  });

  test('a removal is carried like a change, and an old removal does not undo a newer add', () => {
    let p = M().plan({}, { 'cgp.snippet.old': { at: 700, del: true } }, { 'cgp.snippet.old': { at: 600, v: { text: 'x' } } }, 0);
    a.deep(p.push, { 'cgp.snippet.old': { at: 700, del: true } });
    a.deep(p.set, {});
    p = M().plan({ 'cgp.snippet.old': { text: 'x' } }, { 'cgp.snippet.old': { at: 500 } }, { 'cgp.snippet.old': { at: 600, del: true } }, 0);
    a.deep(p.remove, ['cgp.snippet.old']);
    p = M().plan({ 'cgp.snippet.back': { text: 'y' } }, { 'cgp.snippet.back': { at: 900 } }, { 'cgp.snippet.back': { at: 600, del: true } }, 0);
    a.deep(p.push, { 'cgp.snippet.back': { at: 900, v: { text: 'y' } } });
  });

  test('settings stored before times were kept: Canvas’s copy wins a tie, so computers converge', () => {
    const p = M().plan({ 'cgp.setting.enableM': true, 'cgp.snippet.only': { text: 'here' } }, {}, { 'cgp.setting.enableM': { at: 0, v: false } }, 0);
    a.deep(p.set, { 'cgp.setting.enableM': false });
    a.deep(p.push, { 'cgp.snippet.only': { at: 0, v: { text: 'here' } } }, 'nothing only one computer has is lost');
    const agree = M().plan({ 'cgp.setting.enableM': false }, {}, { 'cgp.setting.enableM': { at: 0, v: false } }, 0);
    a.deep(agree.set, {});
    a.deep(agree.push, {});
  });

  test('a computer whose clock is off is measured against Canvas’s clock', () => {
    // This computer's clock is 1 hour fast: its 3600900 is Canvas's 900.
    const p = M().plan({ 'cgp.setting.enableM': true }, { 'cgp.setting.enableM': { at: 3600900 } },
      { 'cgp.setting.enableM': { at: 1000, v: false } }, -3600000);
    a.deep(p.set, { 'cgp.setting.enableM': false }, 'Canvas’s 1000 is newer than this computer’s 900');
    a.eq(p.times['cgp.setting.enableM'].at, 3601000, 'recorded back in this computer’s clock');
    const q = M().plan({ 'cgp.setting.enableM': true }, { 'cgp.setting.enableM': { at: 3601500 } }, {}, -3600000);
    a.deep(q.push, { 'cgp.setting.enableM': { at: 1500, v: true } }, 'sent in Canvas’s clock');
  });

  test('only settings items are merged, and nothing too big for Chrome sync is applied', () => {
    const p = M().plan({ 'cgp.diag': {}, 'cgp.device.x': {} }, {}, { 'cgp.evil': { at: 9, v: 1 }, 'cgp.setting.big': { at: 9, v: 'x'.repeat(9000) } }, 0);
    a.deep(Object.keys(p.set), ['cgp.setting.big']);
    const problems = M().fit({}, p);
    a.deep(problems, ['cgp.setting.big']);
    a.deep(p.set, {});
  });

  test('one run: applies Canvas’s newer items, then sends this computer’s newer ones, item by item', async () => {
    const f = fakeChrome();
    f.sync.data['cgp.setting.enableE'] = false;
    f.local.data['cgp.st.cgp.setting.enableE'] = { at: 5000, h: 'x' };
    const puts = [];
    const api = {
      customDataTimed: async () => ({ data: { 'cgp.setting.enableM': { at: 4000, v: false } }, offset: 0 }),
      setCustomData: async (scope, data) => { puts.push([scope, data]); return { data }; }
    };
    const m = new globalThis.CGP.SettingsMirror({ api, chrome: f.chrome, origin: 'https://s.instructure.com', now: () => 9000 });
    const st = await m.run(true);
    a.ok(st.ok, st.error);
    a.eq(f.sync.data['cgp.setting.enableM'], false);
    a.eq(f.local.data['cgp.st.cgp.setting.enableM'].at, 4000, 'timed before it is written, so it is not a new change');
    a.deep(puts, [['settings/cgp.setting.enableE', { at: 5000, v: false }]]);
    a.eq(f.local.data['cgp.mirror.status.https://s.instructure.com'].pulled, 1);
    const again = await m.run(false);
    a.eq(again.skipped, 'recent', 'at most once a minute unless something changed');
  });

  test('a first copy goes up whole; a Canvas failure is recorded, not thrown', async () => {
    const f = fakeChrome();
    f.sync.data['cgp.setting.enableM'] = false;
    const puts = [];
    let api = { customDataTimed: async () => ({ data: null, offset: 0, missing: true }), setCustomData: async (s, d) => { puts.push([s, d]); } };
    let st = await new globalThis.CGP.SettingsMirror({ api, chrome: f.chrome, origin: 'o', now: () => 1 }).run(true);
    a.ok(st.ok);
    a.deep(puts, [['settings', { 'cgp.setting.enableM': { at: 0, v: false } }]]);
    api = { customDataTimed: async () => { throw Object.assign(new Error('x'), { status: 500 }); }, setCustomData: async () => {} };
    st = await new globalThis.CGP.SettingsMirror({ api, chrome: f.chrome, origin: 'o2', now: () => 1 }).run(true);
    a.not(st.ok);
    a.ok(f.local.data['cgp.mirror.status.o2'] && !f.local.data['cgp.mirror.status.o2'].ok);
  });

  test('the Copy Roster layout is a setting, sanitized', () => {
    const v = globalThis.CGP.sanitizeSettings({ rosterPrefs: { nameFormat: 'split', email: false, sortBy: 'bogus', extra: 1 } });
    a.deep(v.rosterPrefs, { nameFormat: 'split', email: false, header: true, sortBy: 'last', separator: 'comma' });
    a.eq(globalThis.CGP.sanitizeSettings({}).settingsInCanvas, true);
  });
});
