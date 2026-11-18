/* The options page's Save: the button claims only what storage has
 * accepted. One save at a time; edits made while a save runs stay on screen
 * and unsaved; the cross-device merge is unchanged; the reload notice only
 * when a changed setting needs one (src/options/save-state.js). */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/options/save-state.js'), 'utf8'), { filename: 'src/options/save-state.js' });

function C() { return globalThis.CGP; }
function S() { return globalThis.CGP.optionsSave; }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

/* A form: what read() returns, edited by the test as a teacher would. */
function form(values) {
  const f = { values: clone(values) };
  f.read = () => clone(f.values);
  return f;
}

/* One computer's chrome.storage.sync, whose writes can be held open. */
function fakeChrome(initial) {
  const data = clone(initial || {});
  const fake = {
    data,
    hold: null,   // a deferred: set() waits for it
    storage: {
      onChanged: { addListener: () => {} },
      sync: {
        get: (key) => Promise.resolve(key === null ? clone(data) : { [key]: clone(data[key]) }),
        set: (items) => {
          const apply = () => { Object.keys(items).forEach((k) => { data[k] = clone(items[k]); }); };
          if (fake.hold) { const h = fake.hold; fake.hold = null; return h.promise.then(apply); }
          apply();
          return Promise.resolve();
        },
        remove: (keys) => { [].concat(keys).forEach((k) => { delete data[k]; }); return Promise.resolve(); }
      }
    }
  };
  return fake;
}

function withChrome(fake, fn) {
  const prev = globalThis.chrome;
  globalThis.chrome = fake;
  return Promise.resolve().then(fn).finally(() => { globalThis.chrome = prev; });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

suite('Options Save: what the button claims', (test) => {
  test('an edit made while a save is running stays on screen, marked unsaved', async () => {
    const f = form({ gradeFontSize: 16, narrowColumns: true });
    const d = deferred();
    const writes = [];
    const saver = new (S().Saver)({ read: f.read, write: (base, next) => { writes.push(next); return d.promise; } });
    saver.baseline = f.read();

    f.values.gradeFontSize = 18;            // first edit
    a.ok(saver.dirty(), 'unsaved before Save');
    const p = saver.save();                  // Save clicked
    f.values.narrowColumns = false;          // second edit, while saving
    d.resolve({ gradeFontSize: 18, narrowColumns: true });
    const r = await p;

    a.deep(writes, [{ gradeFontSize: 18, narrowColumns: true }], 'only what was there at the click is written');
    a.deep(r.edited, ['narrowColumns'], 'the second edit is reported as made during the save');
    a.eq(f.values.narrowColumns, false, 'the second edit is still in the form');
    a.ok(saver.dirty(), 'and still counts as unsaved');
    a.deep(saver.changed(), ['narrowColumns'], 'only the second edit is unsaved');
  });

  test('the next save writes the edit made during the first', async () => {
    const f = form({ gradeFontSize: 16, narrowColumns: true });
    const writes = [];
    let d = deferred();
    const saver = new (S().Saver)({ read: f.read, write: (base, next) => { writes.push({ base, next }); return d.promise; } });
    saver.baseline = f.read();
    f.values.gradeFontSize = 18;
    const p = saver.save();
    f.values.narrowColumns = false;
    d.resolve({ gradeFontSize: 18, narrowColumns: true });
    await p;
    d = deferred();
    const p2 = saver.save();
    d.resolve({ gradeFontSize: 18, narrowColumns: false });
    await p2;
    a.deep(writes[1].base, { gradeFontSize: 18, narrowColumns: true }, 'compared with what was stored');
    a.deep(writes[1].next, { gradeFontSize: 18, narrowColumns: false });
    a.not(saver.dirty(), 'everything saved now');
  });

  test('a double-click starts one save, not two', async () => {
    const f = form({ gradeFontSize: 16 });
    const d = deferred();
    let calls = 0;
    const saver = new (S().Saver)({ read: f.read, write: () => { calls++; return d.promise; } });
    saver.baseline = f.read();
    f.values.gradeFontSize = 20;
    const p1 = saver.save();
    const p2 = saver.save();
    a.eq(p1, p2, 'the second click joins the first');
    d.resolve({ gradeFontSize: 20 });
    await p1;
    a.eq(calls, 1, 'one write');
  });

  test('other writes from the page wait for a running save', async () => {
    const f = form({ x: 1 });
    const d = deferred();
    const order = [];
    const saver = new (S().Saver)({ read: f.read, write: () => { order.push('save start'); return d.promise.then((v) => { order.push('save end'); return v; }); } });
    saver.baseline = f.read();
    f.values.x = 2;
    const p = saver.save();
    const q = saver.enqueue(() => { order.push('calendar'); return Promise.resolve(); });
    a.ok(saver.busy());
    await tick();
    a.deep(order, ['save start'], 'the calendar write has not started');
    d.resolve({ x: 2 });
    await Promise.all([p, q]);
    a.deep(order, ['save start', 'save end', 'calendar']);
    a.not(saver.busy());
  });

  test('a refused save keeps every edit unsaved, and the button can try again', async () => {
    const f = form({ x: 1 });
    const saver = new (S().Saver)({ read: f.read, write: () => Promise.reject(new Error('quota')) });
    saver.baseline = f.read();
    f.values.x = 2;
    let failed = false;
    await saver.save().catch(() => { failed = true; });
    a.ok(failed);
    a.ok(saver.dirty(), 'still unsaved');
    a.eq(saver.inflight, null, 'not stuck saving');
    a.not(saver.busy(), 'the queue moved on');
  });

  test('with the real storage, the edit made during a save does not undo another computer\'s change', async () => {
    const base = C().sanitizeSettings({});
    const fake = fakeChrome({});
    await withChrome(fake, async () => {
      const f = form(base);
      const saver = new (S().Saver)({ read: f.read, write: (b, n) => C().settingsStorage.write(b, n) });
      saver.baseline = f.read();
      // Another computer turned off the row highlight; this form has not seen it.
      fake.data['cgp.setting.rowHoverHighlight'] = false;
      f.values.gradeFontSize = 18;
      fake.hold = deferred();
      const hold = fake.hold;
      const p = saver.save();
      await tick(); await tick();
      f.values.narrowColumns = false;        // typed while saving
      hold.resolve();
      const r = await p;
      a.eq(fake.data['cgp.setting.gradeFontSize'], 18, 'the first edit is saved');
      a.eq(fake.data['cgp.setting.narrowColumns'], undefined, 'the second is not, yet');
      a.eq(fake.data['cgp.setting.rowHoverHighlight'], false, 'the other computer\'s change is kept');
      a.deep(r.edited, ['narrowColumns']);
      a.ok(r.stale.indexOf('rowHoverHighlight') >= 0, 'reported as changed elsewhere');
      // Save again: the edit goes in, and the other computer's change still stands.
      await saver.save();
      a.eq(fake.data['cgp.setting.narrowColumns'], false);
      a.eq(fake.data['cgp.setting.rowHoverHighlight'], false, 'not overwritten by the stale form value');
      a.not(saver.dirty());
    });
  });
});

suite('Options Save: the reload notice', (test) => {
  const D = () => C().sanitizeSettings({});
  test('settings an open Canvas tab picks up live need no reload', () => {
    const before = D();
    const after = Object.assign({}, before, { gradeFontSize: 20, commentIndicator: false, snippets: [{ trigger: 'x', text: 'y' }], enableM: false });
    a.deep(S().reloadKeys(before, after), []);
  });

  test('a setting read once when the page loads does', () => {
    const before = D();
    a.deep(S().reloadKeys(before, Object.assign({}, before, { hideCanvasUtilityControls: !before.hideCanvasUtilityControls })), ['hideCanvasUtilityControls']);
    a.deep(S().reloadKeys(before, Object.assign({}, before, { courseSwitcher: false })), ['courseSwitcher']);
  });

  test('Canvas View Options need one only while they are applied to Canvas', () => {
    const before = Object.assign(D(), { syncViewOptionsToCanvas: false });
    a.deep(S().reloadKeys(before, Object.assign({}, before, { gbShowNotes: true })), [], 'not applied: nothing to reload');
    const on = Object.assign({}, before, { syncViewOptionsToCanvas: true });
    a.deep(S().reloadKeys(on, Object.assign({}, on, { gbShowNotes: true })), ['gbShowNotes']);
    a.deep(S().reloadKeys(before, on), ['syncViewOptionsToCanvas'], 'switching it on');
    a.deep(S().reloadKeys(on, before), [], 'switching it off');
  });

  test('every setting named for a reload is a real setting', () => {
    Object.keys(S().RELOAD).forEach((k) => a.ok(k in C().DEFAULTS, k));
  });

  test('a save reports the reload need of what it wrote, not of edits made after the click', async () => {
    const f = form(D());
    const d = deferred();
    const saver = new (S().Saver)({ read: f.read, write: () => d.promise });
    saver.baseline = f.read();
    f.values.gradeFontSize = 20;
    const p = saver.save();
    f.values.courseSwitcher = false;
    d.resolve(Object.assign(D(), { gradeFontSize: 20 }));
    const r = await p;
    a.deep(r.reload, [], 'the font size applies live');
  });
});

suite('Options page: wired to the save rules', (test) => {
  const opts = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  test('save-state.js loads before options.js', () => {
    a.ok(html.indexOf('save-state.js') > 0 && html.indexOf('save-state.js') < html.indexOf('options.js"'));
  });
  test('every write from the page goes through the one queue', () => {
    a.not(/saving\s*=\s*true/.test(opts), 'no separate saving flag');
    const direct = opts.match(/CGP\.settingsStorage\.write\(/g) || [];
    a.eq(direct.length, 3, 'only inside saver / enqueue callbacks');
    a.ok(/saver\.enqueue\(function \(\) \{\s*return CGP\.settingsStorage\.read\(\)/.test(opts), 'Connect calendar waits its turn');
  });
  test('no reload instruction is written unconditionally', () => {
    a.not(/Reload the gradebook tab/.test(opts));
    a.ok(/reloadKeys\(/.test(opts));
  });
  test('there is a place for the save state beside the button', () => {
    a.ok(/id="saveState"/.test(html));
  });
});
