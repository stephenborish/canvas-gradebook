/* Settings on every computer: each item's time kept beside it in
 * chrome.storage.sync (CGP.settingsTimes), the merge with the copy in the
 * teacher's Canvas account (core/settings-mirror.js), and Chrome sync
 * check-ins (settings-times.js). The last suites run whole timelines on
 * several simulated computers - each with its own Chrome storage and its
 * own wrong clock - against a fake Canvas that reorders object keys the
 * way its database does and whose clock reading jitters by a second. */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const CHECKIN = pathToFileURL(path.join(__dirname, '..', 'src', 'settings-times.js')).href;
function C() { return globalThis.CGP; }
function M() { return globalThis.CGP.settingsMirror; }

function bag(onSet) {
  const data = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    data,
    get: async (k) => {
      if (k === null || k === undefined) return clone(data);
      const out = {};
      [].concat(k).forEach((x) => { if (x in data) out[x] = clone(data[x]); });
      return out;
    },
    set: async (o) => { Object.assign(data, clone(o)); if (onSet) onSet(Object.keys(o)); },
    remove: async (ks) => { [].concat(ks).forEach((x) => delete data[x]); if (onSet) onSet([].concat(ks)); }
  };
}

/* Postgres jsonb hands objects back with their keys reordered. */
function reorder(v) {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reorder);
  const out = {};
  Object.keys(v).sort().reverse().forEach((k) => { out[k] = reorder(v[k]); });
  return out;
}

function fakeCanvas(clock) {
  const store = {};
  const api = {
    puts: 0,
    customDataTimed: async (scope) => {
      // Canvas's Date header: whole seconds, so the offset jitters.
      const server = Math.floor(clock() / 1000) * 1000;
      const data = scope === 'settings' ? (Object.keys(store).length ? reorder(JSON.parse(JSON.stringify(store))) : null) : null;
      return { data, offset: server - api.localNow() + (Math.random() < 0.5 ? 0 : 999) };
    },
    setCustomData: async (scope, data) => {
      api.puts++;
      if (scope === 'settings') Object.assign(store, JSON.parse(JSON.stringify(data)));
      else store[scope.replace(/^settings\//, '')] = JSON.parse(JSON.stringify(data));
      return { data };
    },
    store
  };
  return api;
}

/* One computer: its own Chrome storage and clock (skew ms off true time). */
function computer(name, trueClock, skew) {
  const c = { name, skew, sync: bag(), local: bag() };
  c.now = () => trueClock() + skew;
  c.chrome = { storage: { sync: c.sync, local: c.local, onChanged: { addListener() {} } } };
  return c;
}

/* Run fn with this computer's chrome and clock as the globals. */
async function on(comp, fn) {
  const prevChrome = globalThis.chrome;
  const prevNow = Date.now;
  globalThis.chrome = comp.chrome;
  Date.now = comp.now;
  try { return await fn(); } finally { globalThis.chrome = prevChrome; Date.now = prevNow; }
}

async function save(comp, patch) {
  return on(comp, async () => {
    const cur = await C().settingsStorage.read();
    const next = C().sanitizeSettings(Object.assign({}, cur.values, patch));
    return C().settingsStorage.write(cur.values, next);
  });
}

async function values(comp) { return on(comp, async () => (await C().settingsStorage.read()).values); }

async function mirror(comp, canvas) {
  canvas.localNow = comp.now;
  return on(comp, () => new (C().SettingsMirror)({ api: canvas, chrome: comp.chrome, origin: 'https://s.instructure.com', now: comp.now }).run(true));
}

/* Chrome sync between computers that have it on: every item copied as is. */
async function chromeSync(from, to) {
  const all = await from.sync.get(null);
  await to.sync.set(all);
}

function snippets(v) { return v.snippets.map((s) => s.trigger + '=' + s.text).sort(); }

suite('settings everywhere: times beside the settings', (test) => {
  test('a saved change carries its time and hash, in the same write', async () => {
    let t = 1e12;
    const A = computer('A', () => t, 0);
    await save(A, { enableM: false });
    const times = C().settingsTimes.readAll(A.sync.data);
    a.eq(times['cgp.setting.enableM'].a, 1e12);
    a.ok(times['cgp.setting.enableM'].u, 'not yet on Canvas’s clock: this computer has not been to Canvas');
    a.eq(times['cgp.setting.enableM'].h, C().util.valueHash(false));
    a.lacksKey(times, 'cgp.setting.enableE', 'an untouched setting gets no time');
    a.ok(Object.keys(A.sync.data).every((k) => k.indexOf('cgp.t.') !== 0), 'times are packed, not one item each');
  });

  test('a removed snippet leaves a tombstone; default snippets written for the first time get time 0', async () => {
    const t = 1e12;
    const A = computer('A', () => t, 0);
    const v = await values(A);
    await save(A, { snippets: v.snippets.filter((s) => s.trigger !== 'evidence').concat([{ trigger: 'mine', text: 'Mine' }]) });
    const times = C().settingsTimes.readAll(A.sync.data);
    a.eq(times['cgp.snippet.evidence'].d, true);
    a.eq(times['cgp.snippet.mine'].a, 1e12);
    a.ok(times['cgp.snippet.units'].def, 'a built-in written out is no change: a default');
  });

  test('stable JSON: key order never makes a difference', () => {
    a.eq(C().util.stableStringify({ b: 1, a: [{ y: 2, x: 1 }] }), C().util.stableStringify({ a: [{ x: 1, y: 2 }], b: 1 }));
    a.eq(C().util.valueHash({ b: 1, a: 2 }), C().util.valueHash({ a: 2, b: 1 }));
  });

  test('a snippet called "json" survives Canvas’s ".json" path suffix', () => {
    a.eq(M().remoteKey('cgp.snippet.json'), 'cgp~snippet~json');
    a.eq(M().itemKey('cgp~snippet~json'), 'cgp.snippet.json');
  });
});

suite('settings everywhere: the merge rules', (test) => {
  const T = () => C().settingsTimes;
  const h = (v) => C().util.valueHash(v);
  const withTimes = (items, times) => Object.assign({}, items, T().shardWrites(items, times, 1e12));
  test('newer wins both ways, item by item', () => {
    const all = withTimes({ 'cgp.setting.enableM': true, 'cgp.setting.enableE': false },
      { 'cgp.setting.enableM': { a: 100, h: h(true) }, 'cgp.setting.enableE': { a: 900, h: h(false) } });
    const remote = { 'cgp~setting~enableM': { at: 800, v: false }, 'cgp~setting~enableE': { at: 300, v: true } };
    const p = M().plan(all, remote, {}, 1000);
    a.eq(p.set['cgp.setting.enableM'], false);
    a.eq(p.times['cgp.setting.enableM'].a, 800, 'pulled with its own time, as received');
    a.deep(p.push, { 'cgp.setting.enableE': { at: 900, v: false } });
  });

  test('two computers both at time 0 with different values: the teacher decides', () => {
    const p = M().plan({ 'cgp.setting.enableM': true }, { 'cgp~setting~enableM': { at: 0, v: false } }, {}, 5);
    a.deep(p.conflicts, ['cgp.setting.enableM']);
    a.deep(p.set, {});
    a.deep(p.push, {});
  });

  test('a value changed without its time waits two minutes, then counts from when it was first seen', () => {
    const all = withTimes({ 'cgp.setting.enableM': false }, { 'cgp.setting.enableM': { a: 100, h: h(true) } });
    const remote = { 'cgp~setting~enableM': { at: 100, v: true } };
    let p = M().plan(all, remote, {}, 10000);
    a.deep(p.waiting, ['cgp.setting.enableM']);
    a.deep(p.push, {});
    a.deep(p.set, {});
    p = M().plan(all, remote, p.pending, 10000 + 3 * 60000);
    a.deep(p.push, { 'cgp.setting.enableM': { at: 10000, v: false } });
    a.deep(p.times['cgp.setting.enableM'], { a: 10000, h: h(false) }, 'and its time is written, so it is settled for good');
  });

  test('pulls that would overflow Chrome sync’s snippet limit are left in Canvas and reported', () => {
    const all = {};
    for (let i = 0; i < 95; i++) all['cgp.snippet.a' + i] = { trigger: 'a' + i, text: 'x', pos: i };
    const remote = {};
    for (let i = 0; i < 10; i++) remote['cgp~snippet~b' + i] = { at: 100 + i, v: { trigger: 'b' + i, text: 'y', pos: i } };
    remote['cgp~setting~enableM'] = { at: 50, v: false };
    const p = M().plan(all, remote, {}, 1000);
    const left = M().fit(all, p);
    a.eq(left.length, 5);
    a.deep(left.slice(0, 2), ['cgp.snippet.b0', 'cgp.snippet.b1'], 'the oldest give way');
    a.eq(p.set['cgp.setting.enableM'], false, 'settings still come through');
  });
});

suite('settings everywhere: timelines on several computers', (test) => {
  test('the reviewer’s timeline: Chrome sync delivering an older change never beats a newer one', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const D = computer('D (no Chrome sync)', clock, +3600000);  // clock an hour fast
    const W = computer('W', clock, -120000);
    const L = computer('L', clock, 0);
    await save(D, { gradeFontSize: 18 });               // Saturday, X
    await mirror(D, canvas);
    t += 60000;
    await mirror(W, canvas);                            // W pulls X
    t += 86400000;
    await save(D, { gradeFontSize: 20 });               // Sunday, Y
    await mirror(D, canvas);
    t += 86400000;
    await mirror(L, canvas);                            // Monday: L pulls Y
    await chromeSync(W, L);                             // ...then W's X arrives through Chrome sync
    t += 60000;
    await mirror(L, canvas);
    await mirror(D, canvas);
    await mirror(W, canvas);
    a.eq((await values(L)).gradeFontSize, 20, 'L');
    a.eq((await values(D)).gradeFontSize, 20, 'D');
    a.eq((await values(W)).gradeFontSize, 20, 'W');
  });

  test('it settles: no re-uploads once in step, whatever the clock jitter and key order', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const A = computer('A', clock, 4000);
    const B = computer('B', clock, -7000);
    const va = await values(A);
    const many = va.snippets.concat(Array.from({ length: 30 }, (_, i) => ({ trigger: 's' + i, text: 'Snippet ' + i })));
    await save(A, { snippets: many, gradingScale: va.gradingScale.slice(0, 5), rosterPrefs: { nameFormat: 'split' } });
    for (let i = 0; i < 3; i++) { t += 61000; await mirror(A, canvas); await mirror(B, canvas); }
    const before = canvas.puts;
    for (let i = 0; i < 5; i++) { t += 61000; await mirror(A, canvas); await mirror(B, canvas); }
    a.eq(canvas.puts, before, 'no PUTs once both computers agree');
    a.deep(snippets(await values(B)), snippets(await values(A)));
    a.deep((await values(B)).rosterPrefs, (await values(A)).rosterPrefs);
  });

  test('a fresh computer that saves before its first merge does not undo the teacher’s work elsewhere', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const A = computer('A', clock, 0);
    const v = await values(A);
    await save(A, { snippets: v.snippets.filter((s) => s.trigger !== 'evidence').map((s) => (s.trigger === 'units' ? { trigger: 'units', text: 'Edited on A' } : s)) });
    await mirror(A, canvas);
    t += 86400000;
    const Cc = computer('C (new)', clock, 0);
    const vc = await values(Cc);
    await save(Cc, { snippets: vc.snippets.concat([{ trigger: 'fresh', text: 'From C' }]) });
    await mirror(Cc, canvas);
    t += 61000;
    await mirror(A, canvas);
    for (const comp of [A, Cc]) {
      const s = snippets(await values(comp));
      a.ok(s.indexOf('units=Edited on A') >= 0, comp.name + ': A’s edit kept');
      a.ok(!s.some((x) => x.indexOf('evidence=') === 0), comp.name + ': A’s deletion kept');
      a.ok(s.indexOf('fresh=From C') >= 0, comp.name + ': C’s new snippet kept');
    }
  });

  test('a computer still on the old single-item format loses nothing', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const A = computer('A', clock, 0);
    await save(A, { enableM: false });
    await mirror(A, canvas);
    const Old = computer('Old', clock, 0);
    Old.sync.data['cgp.settings'] = { snippets: [{ trigger: 'mine', text: 'Old computer' }], gradeFontSize: 19 };
    t += 61000;
    await mirror(Old, canvas);
    const v = await values(Old);
    a.ok(snippets(v).indexOf('mine=Old computer') >= 0, 'its snippet survives');
    a.eq(v.gradeFontSize, 19);
    a.eq(v.enableM, false, 'and it gets A’s change');
    a.lacksKey(Old.sync.data, 'cgp.settings', 'moved to its own items');
    t += 61000;
    await mirror(A, canvas);
    a.ok(snippets(await values(A)).indexOf('mine=Old computer') >= 0, 'A gets it too');
  });

  test('Restore defaults wins over an older different value elsewhere', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const A = computer('A', clock, 0);
    const B = computer('B', clock, 0);
    await save(A, { gradeFontSize: 22 });
    await mirror(A, canvas);
    t += 61000;
    await mirror(B, canvas);
    t += 61000;
    await on(B, () => C().settingsStorage.write(null, C().sanitizeSettings({})));
    await mirror(B, canvas);
    t += 61000;
    await mirror(A, canvas);
    a.eq((await values(A)).gradeFontSize, C().DEFAULTS.gradeFontSize);
  });

  test('two computers that never synced: a different setting is put to the teacher, then resolved either way', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const A = computer('A', clock, 0);
    const B = computer('B', clock, 0);
    A.sync.data['cgp.setting.gradeFontSize'] = 18;       // stored before times existed
    B.sync.data['cgp.setting.gradeFontSize'] = 21;
    await mirror(A, canvas);
    t += 61000;
    const st = await mirror(B, canvas);
    a.eq(st.conflicts.length, 1);
    a.eq(st.conflicts[0].mine, 21);
    a.eq(st.conflicts[0].theirs, 18);
    await on(B, () => M().resolve(B.chrome, st.conflicts, true, t));
    t += 61000;
    await mirror(B, canvas);
    t += 61000;
    await mirror(A, canvas);
    a.eq((await values(A)).gradeFontSize, 21, 'kept B’s, everywhere');
  });
});

suite('settings everywhere: Chrome sync check-ins', (test) => {
  test('each computer checks in every few hours; long-gone ones are forgotten', async () => {
    const { createSettingsTimes } = await import(CHECKIN);
    let t = 1e12;
    const comp = computer('X', () => t, 0);
    comp.sync.data['cgp.device.gone'] = { at: 1, label: 'Mac' };
    const st = createSettingsTimes(comp.chrome, () => t);
    a.ok(await st.checkIn(false));
    a.eq(Object.keys(comp.sync.data).filter((k) => k.indexOf('cgp.device.') === 0).length, 1);
    a.not(await st.checkIn(false));
    t += 7 * 3600000;
    a.ok(await st.checkIn(false));
  });

  test('the Copy Roster layout is a setting, sanitized; the Canvas copy is on by default', () => {
    const v = C().sanitizeSettings({ rosterPrefs: { nameFormat: 'split', email: false, sortBy: 'bogus', extra: 1 } });
    a.deep(v.rosterPrefs, { nameFormat: 'split', email: false, header: true, sortBy: 'last', separator: 'comma' });
    a.eq(C().sanitizeSettings({}).settingsInCanvas, true);
  });
});

suite('settings everywhere: second re-review', (test) => {
  const T = () => C().settingsTimes;
  const h = (v) => C().util.valueHash(v);

  test('a built-in default gives way to a value stored before times existed: no false conflict', () => {
    const all = Object.assign({ 'cgp.snippet.units': { trigger: 'units', text: 'Default', pos: 1 } },
      T().shardWrites({}, { 'cgp.snippet.units': { a: 0, h: h({ trigger: 'units', text: 'Default', pos: 1 }), def: true } }, 1));
    const p = M().plan(all, { 'cgp~snippet~units': { at: 0, v: { trigger: 'units', text: 'Edited long ago', pos: 1 } } }, {}, 5, 0);
    a.deep(p.conflicts, []);
    a.eq(p.set['cgp.snippet.units'].text, 'Edited long ago');
  });

  test('a snippet that differs only in its place is no conflict and no change', () => {
    const p = M().plan({ 'cgp.snippet.nice': { trigger: 'nice', text: 'Hi', pos: 2 } }, { 'cgp~snippet~nice': { at: 0, v: { trigger: 'nice', text: 'Hi', pos: 1 } } }, {}, 5, 0);
    a.deep(p.conflicts, []);
    a.deep(p.set, {});
    a.deep(p.push, {});
  });

  test('a snippet removed without a tombstone (older version) waits, then is removed everywhere', () => {
    const all = T().shardWrites({}, { 'cgp.snippet.gone': { a: 100, h: 'x' } }, 1);
    const remote = { 'cgp~snippet~gone': { at: 100, v: { trigger: 'gone', text: 'x' } } };
    let p = M().plan(all, remote, {}, 10000, 0);
    a.deep(p.set, {}, 'not pulled back');
    p = M().plan(all, remote, p.pending, 10000 + 3 * 60000, 0);
    a.deep(p.push, { 'cgp.snippet.gone': { at: 10000, del: true } });
  });

  test('a time taken before this computer knew its clock is settled on Canvas’s clock', () => {
    const all = Object.assign({ 'cgp.setting.enableM': false }, T().shardWrites({}, { 'cgp.setting.enableM': { a: 5000, h: h(false), u: true } }, 1));
    const p = M().plan(all, { 'cgp~setting~enableM': { at: 4000, v: true } }, {}, 9000, -2000);
    a.eq(p.set['cgp.setting.enableM'], true, 'its 5000 is Canvas’s 3000: older than 4000');
    const q = M().plan(all, { 'cgp~setting~enableM': { at: 2500, v: true } }, {}, 9000, -2000);
    a.deep(q.push, { 'cgp.setting.enableM': { at: 3000, v: false } });
    a.eq(q.times['cgp.setting.enableM'].u, false);
  });

  test('tombstones expire after 90 days; times stay in a few items however many snippets there are', () => {
    const now = 200 * 86400000;
    const out = T().shardWrites({}, { 'cgp.snippet.old': { a: now - 100 * 86400000, d: true }, 'cgp.snippet.recent': { a: now - 86400000, d: true } }, now);
    const recs = T().readAll(out);
    a.lacksKey(recs, 'cgp.snippet.old');
    a.ok(recs['cgp.snippet.recent']);
    const many = {};
    for (let i = 0; i < 300; i++) many['cgp.snippet.s' + i] = { a: now, h: 'x' };
    a.ok(Object.keys(T().shardWrites({}, many, now)).length <= 8);
  });

  test('reordering is one change to the order item, never a change to another computer’s text edit', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const A = computer('A', clock, 0);
    const B = computer('B', clock, 0);
    const v = await values(A);
    await save(A, { snippets: v.snippets.concat([{ trigger: 'q', text: 'Question' }]) });
    await mirror(A, canvas);
    t += 61000;
    await mirror(B, canvas);
    t += 61000;
    const vb = await values(B);
    await save(B, { snippets: vb.snippets.map((s) => (s.trigger === 'q' ? { trigger: 'q', text: 'Edited on B' } : s)) });
    await mirror(B, canvas);
    t += 1000;
    const va = await values(A);                      // A has not pulled B's edit
    const before = canvas.puts;
    await save(A, { snippets: va.snippets.slice().reverse() });
    await mirror(A, canvas);
    a.ok(canvas.puts - before <= 2, 'a reorder sends one item (plus nothing else), not every snippet');
    t += 61000;
    await mirror(B, canvas);
    await mirror(A, canvas);
    for (const comp of [A, B]) {
      const s = (await values(comp)).snippets;
      a.eq(s.find((x) => x.trigger === 'q').text, 'Edited on B', comp.name + ' keeps B’s edit');
      a.eq(s[0].trigger, 'q', comp.name + ' has A’s order');
    }
  });

  test('an old version’s untimed edit is settled once, not re-pushed forever', async () => {
    let t = 1.7e12;
    const clock = () => t;
    const canvas = fakeCanvas(clock);
    const N = computer('N', clock, 0);
    await save(N, { gradeFontSize: 17 });
    await mirror(N, canvas);
    N.sync.data['cgp.setting.gradeFontSize'] = 23;    // an older version wrote it, no time
    t += 61000; await mirror(N, canvas);
    t += 3 * 60000; await mirror(N, canvas);
    const settled = canvas.puts;
    for (let i = 0; i < 4; i++) { t += 61000; await mirror(N, canvas); }
    a.eq(canvas.puts, settled, 'no more pushes after it was settled');
    a.eq(canvas.store['cgp~setting~gradeFontSize'].v, 23);
  });

  test('settings stay far inside Chrome sync’s 512-item limit', async () => {
    const t = 1.7e12;
    const A = computer('A', () => t, 0);
    const v = await values(A);
    const many = Array.from({ length: 100 }, (_, i) => ({ trigger: 'p' + i, text: 'S' + i }));
    await save(A, { snippets: many });
    for (let r = 0; r < 3; r++) await on(A, () => C().settingsStorage.write(null, C().sanitizeSettings(Object.assign({}, v, { snippets: many.map((s) => ({ trigger: s.trigger + 'r' + r, text: s.text })) }))));
    // 100 snippets + every setting + a handful of time items: tombstones of
    // the 300 removed snippets take no items of their own.
    a.ok(Object.keys(A.sync.data).length < 200, String(Object.keys(A.sync.data).length));
  });
});
