/* Settings carried between computers by chrome.storage.sync: the snippets
 * live one per sync item, and a save writes only what the teacher changed,
 * on top of whatever another computer has stored meanwhile. */
'use strict';

const { suite, assert: a } = require('./harness');

function CGP() { return globalThis.CGP; }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* One computer's chrome.storage (sync area only). */
function fakeChrome(initial) {
  const data = clone(initial || {});
  const listeners = [];
  function fire(changes) { listeners.forEach((f) => f(changes, 'sync')); }
  return {
    data,
    storage: {
      onChanged: { addListener: (f) => listeners.push(f) },
      sync: {
        get: (key) => Promise.resolve(key === null ? clone(data) : { [key]: clone(data[key]) }),
        set: (items) => {
          const changes = {};
          Object.keys(items).forEach((k) => { changes[k] = { oldValue: data[k], newValue: clone(items[k]) }; data[k] = clone(items[k]); });
          fire(changes);
          return Promise.resolve();
        },
        remove: (keys) => {
          const changes = {};
          [].concat(keys).forEach((k) => { changes[k] = { oldValue: data[k] }; delete data[k]; });
          fire(changes);
          return Promise.resolve();
        }
      }
    }
  };
}

function withChrome(fake, fn) {
  const prev = globalThis.chrome;
  globalThis.chrome = fake;
  return Promise.resolve().then(fn).finally(() => { globalThis.chrome = prev; });
}

function snip(trigger, text) { return { trigger, text }; }
function settingsWith(patch) { return CGP().sanitizeSettings(Object.assign({}, patch)); }

suite('settings sync: how settings are stored', (test) => {
  test('settings saved by an older version (snippets inside cgp.settings) still read the same', () => {
    const raw = CGP().settingsStorage.assemble({ 'cgp.settings': { gradeFontSize: 15, snippets: [snip('a', 'A')] } });
    const v = CGP().sanitizeSettings(raw);
    a.eq(v.gradeFontSize, 15);
    a.deep(v.snippets, [snip('a', 'A')]);
  });

  test('a computer that has stored nothing and changed nothing writes nothing', () => {
    const base = settingsWith({});
    const p = CGP().settingsStorage.plan({}, base, base);
    a.deep({ set: p.set, remove: p.remove, problem: p.problem, stamps: p.stamps, removed: p.removed },
      { set: {}, remove: [], problem: null, stamps: {}, removed: [] });
  });

  test('changing one setting on a computer with nothing stored writes only that setting, never the default snippets', () => {
    const base = settingsWith({});
    const p = CGP().settingsStorage.plan({}, base, settingsWith({ gradeFontSize: 18 }));
    a.deep(p.set, { 'cgp.setting.gradeFontSize': 18 });
    a.deep(p.remove, []);
  });

  test('the first save moves old-style snippets into their own items', async () => {
    const fake = fakeChrome({ 'cgp.settings': { gradeFontSize: 15, snippets: [snip('a', 'A'), snip('b', 'B')] } });
    await withChrome(fake, async () => {
      const { values } = await CGP().settingsStorage.read();
      const stored = await CGP().settingsStorage.write(values, Object.assign({}, values, { frozenTotal: false }));
      a.eq(fake.data['cgp.settings'], undefined, 'the old single item is gone');
      a.eq(fake.data['cgp.snippetStore'], 'keys');
      a.eq(fake.data['cgp.setting.gradeFontSize'], 15, 'its settings moved to items of their own');
      a.deep(fake.data['cgp.snippet.a'], { trigger: 'a', text: 'A', pos: 0 });
      a.deep(stored.snippets, [snip('a', 'A'), snip('b', 'B')]);
      a.eq(stored.frozenTotal, false);
      a.eq(stored.gradeFontSize, 15);
    });
  });

  test('more and longer snippets than the old single-item limit allowed are saved and read back intact', async () => {
    const list = [];
    for (let i = 0; i < 40; i++) list.push(snip('s' + i, 'Feedback number ' + i + ' ' + 'y'.repeat(900)));
    const fake = fakeChrome({});
    await withChrome(fake, async () => {
      const base = settingsWith({});
      const stored = await CGP().settingsStorage.write(base, settingsWith({ snippets: list }));
      a.eq(stored.snippets.length, 40);
      a.deep(stored.snippets, list, 'same text, same order');
      a.eq(fake.data['cgp.snippet.evidence'], undefined, 'built-in snippets the teacher replaced are gone');
      Object.keys(fake.data).forEach((k) => {
        a.ok(CGP().util.byteLength(k + JSON.stringify(fake.data[k])) <= 8192, k + ' fits one sync item');
      });
    });
  });
});

suite('settings sync: two computers', (test) => {
  test('a save on a computer that had not caught up keeps the snippets saved elsewhere', () => {
    const S = CGP().settingsStorage;
    // Laptop: the teacher's snippets, as sync now holds them everywhere.
    const laptop = settingsWith({ snippets: [snip('a', 'A'), snip('b', 'B')] });
    const synced = {};
    const first = S.plan({}, settingsWith({}), laptop);
    Object.assign(synced, first.set);
    // Desktop: its options page was opened before those arrived (built-in
    // snippets on screen); the teacher changes the font size and saves.
    const desktopBase = settingsWith({});
    const p = S.plan(synced, desktopBase, Object.assign({}, desktopBase, { gradeFontSize: 20 }));
    Object.assign(synced, p.set);
    p.remove.forEach((k) => { delete synced[k]; });
    const after = CGP().sanitizeSettings(S.assemble(synced));
    a.deep(after.snippets, [snip('a', 'A'), snip('b', 'B')], 'laptop snippets survive');
    a.eq(after.gradeFontSize, 20, 'desktop change kept');
  });

  test('different settings changed on two computers before either synced: both are kept', () => {
    const S = CGP().settingsStorage;
    const start = settingsWith({});
    const synced = {};
    // Laptop changes the font size; the desktop, not yet caught up, turns
    // the frozen Total off. Each save applies to what sync holds by then.
    Object.assign(synced, S.plan(synced, start, Object.assign({}, start, { gradeFontSize: 20 })).set);
    Object.assign(synced, S.plan(synced, start, Object.assign({}, start, { frozenTotal: false })).set);
    const after = CGP().sanitizeSettings(S.assemble(synced));
    a.eq(after.gradeFontSize, 20);
    a.eq(after.frozenTotal, false);
  });

  test('the same holds when the second computer saves first and sync then delivers the other', () => {
    const S = CGP().settingsStorage;
    const start = settingsWith({});
    const laptop = S.plan({}, start, Object.assign({}, start, { gradeFontSize: 20 })).set;
    const desktop = S.plan({}, start, Object.assign({}, start, { frozenTotal: false })).set;
    // Sync settles per item, last write wins; the two touch different items.
    const merged = Object.assign({}, laptop, desktop);
    const after = CGP().sanitizeSettings(S.assemble(merged));
    a.eq(after.gradeFontSize, 20);
    a.eq(after.frozenTotal, false);
  });

  test('a save whose snippets, merged with another computer\'s, would not fit is refused, writing nothing', async () => {
    const L = CGP().SETTINGS_LIMITS;
    const S = CGP().settingsStorage;
    const list = (prefix, n) => Array.from({ length: n }, (_, i) => snip(prefix + i, 'text ' + i));
    const shared = list('s', L.MAX_SNIPPETS - 10);
    const start = settingsWith({ snippets: shared });
    const synced = {};
    Object.assign(synced, S.plan({}, null, start).set);
    // The laptop adds 10, reaching the limit; the desktop, from the same
    // starting list, adds 10 different ones.
    Object.assign(synced, S.plan(synced, start, settingsWith({ snippets: shared.concat(list('x', 10)) })).set);
    const p = S.plan(synced, start, settingsWith({ snippets: shared.concat(list('y', 10)) }));
    a.ok(p.problem && /another computer/.test(p.problem), 'explained');
    a.deep(p.set, {});
    a.deep(p.remove, []);
    const fake = fakeChrome(synced);
    await withChrome(fake, async () => {
      let refused = null;
      await S.write(start, settingsWith({ snippets: shared.concat(list('y', 10)) })).catch((e) => { refused = e; });
      a.ok(refused, 'write rejects');
      a.deep(fake.data, synced, 'nothing stored changed');
    });
  });

  test('a snippet added on each computer: both are kept', () => {
    const S = CGP().settingsStorage;
    const start = settingsWith({ snippets: [snip('a', 'A')] });
    const synced = {};
    Object.assign(synced, S.plan({}, null, start).set);
    // Both computers start from the same list; each adds one.
    const p1 = S.plan(synced, start, Object.assign({}, start, { snippets: [snip('a', 'A'), snip('x', 'X')] }));
    Object.assign(synced, p1.set);
    const p2 = S.plan(synced, start, Object.assign({}, start, { snippets: [snip('a', 'A'), snip('y', 'Y')] }));
    Object.assign(synced, p2.set);
    const triggers = CGP().sanitizeSettings(S.assemble(synced)).snippets.map((s) => s.trigger).sort();
    a.deep(triggers, ['a', 'x', 'y']);
  });

  test('deleting or editing a snippet on one computer reaches the others', () => {
    const S = CGP().settingsStorage;
    const start = settingsWith({ snippets: [snip('a', 'A'), snip('b', 'B')] });
    const synced = {};
    Object.assign(synced, S.plan({}, null, start).set);
    const p = S.plan(synced, start, Object.assign({}, start, { snippets: [snip('b', 'B, revised')] }));
    a.deep(p.remove, ['cgp.snippet.a']);
    Object.assign(synced, p.set);
    p.remove.forEach((k) => { delete synced[k]; });
    a.deep(CGP().sanitizeSettings(S.assemble(synced)).snippets, [snip('b', 'B, revised')]);
  });

  test('Restore defaults and Import replace everything, removing every other snippet', () => {
    const S = CGP().settingsStorage;
    const synced = {};
    Object.assign(synced, S.plan({}, null, settingsWith({ snippets: [snip('a', 'A')], gradeFontSize: 20 })).set);
    const p = S.plan(synced, null, settingsWith({}));
    Object.assign(synced, p.set);
    p.remove.forEach((k) => { delete synced[k]; });
    const after = CGP().sanitizeSettings(S.assemble(synced));
    a.deep(after.snippets, CGP().DEFAULTS.snippets);
    a.eq(after.gradeFontSize, CGP().DEFAULTS.gradeFontSize);
    a.eq(synced['cgp.snippet.a'], undefined);
  });

  test('an open gradebook picks up a snippet saved on another computer', async () => {
    const fake = fakeChrome({ 'cgp.snippetStore': 'keys', 'cgp.snippet.a': { trigger: 'a', text: 'A', pos: 0 } });
    await withChrome(fake, async () => {
      const settings = CGP().settings;
      settings._bound = false;
      settings._cbs = [];
      await settings.load();
      a.deep(settings.values.snippets, [snip('a', 'A')]);
      let seen = null;
      settings.onChange((v) => { seen = v; });
      // Sync delivers a new snippet item, nothing else.
      await fake.storage.sync.set({ 'cgp.snippet.b': { trigger: 'b', text: 'B', pos: 1 } });
      await new Promise((r) => setTimeout(r, 0));
      a.ok(seen, 'listeners told');
      a.deep(settings.values.snippets, [snip('a', 'A'), snip('b', 'B')]);
    });
  });
});
