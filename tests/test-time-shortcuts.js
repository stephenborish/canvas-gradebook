/* Time shortcuts: typing 1-4 (or any saved key) in a Canvas "Time" box.
 *   - settings: defaults, cleaning, stale/corrupt values
 *   - lookup/format: whole-box keys only, Canvas-friendly time text
 *   - controller: swaps on Tab/Enter/focusout in time comboboxes only */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

const CGP = globalThis.CGP;
const ROOT = path.resolve(__dirname, '..');

suite('time shortcut settings', (test) => {
  test('ship with the four period defaults', () => {
    const s = CGP.sanitizeSettings({});
    a.eq(s.timeShortcutsEnabled, true);
    a.deep(s.timeShortcuts, [
      { key: '1', time: '08:55' }, { key: '2', time: '10:10' },
      { key: '3', time: '12:30' }, { key: '4', time: '13:45' }
    ]);
  });

  test('keys are lower-cased and cleaned, times padded to HH:MM, junk rows dropped', () => {
    const s = CGP.sanitizeSettings({ timeShortcuts: [
      { key: ' HR ', time: '9:05' }, { key: 'a b!', time: '14:00' },
      { key: 'x', time: '25:00' }, { key: '', time: '08:00' }, { key: 'y' }, null
    ] });
    a.deep(s.timeShortcuts, [{ key: 'hr', time: '09:05' }, { key: 'ab', time: '14:00' }]);
  });

  test('a duplicate key keeps the first, and the list is capped', () => {
    const dup = CGP.sanitizeSettings({ timeShortcuts: [{ key: '1', time: '08:00' }, { key: '1', time: '09:00' }] });
    a.deep(dup.timeShortcuts, [{ key: '1', time: '08:00' }]);
    const many = [];
    for (let i = 0; i < 40; i++) many.push({ key: 'k' + i, time: '08:00' });
    a.eq(CGP.sanitizeSettings({ timeShortcuts: many }).timeShortcuts.length, CGP.SETTINGS_LIMITS.MAX_TIME_SHORTCUTS);
  });

  test('an unusable stored value falls back to the defaults, but an empty list stays empty', () => {
    a.deep(CGP.sanitizeSettings({ timeShortcuts: 'oops' }).timeShortcuts, CGP.DEFAULTS.timeShortcuts);
    a.deep(CGP.sanitizeSettings({ timeShortcuts: null }).timeShortcuts, CGP.DEFAULTS.timeShortcuts);
    a.deep(CGP.sanitizeSettings({ timeShortcuts: [] }).timeShortcuts, []);
  });
});

suite('time shortcut lookup and formatting', (test) => {
  const list = CGP.DEFAULTS.timeShortcuts;

  test('finds a key only when it is the whole box', () => {
    a.eq(CGP.timeShortcuts.lookup('1', list).time, '08:55');
    a.eq(CGP.timeShortcuts.lookup(' 4 ', list).time, '13:45');
    a.eq(CGP.timeShortcuts.lookup('12:30', list), null, 'a real time is left alone');
    a.eq(CGP.timeShortcuts.lookup('1 pm', list), null);
    a.eq(CGP.timeShortcuts.lookup('5', list), null);
    a.eq(CGP.timeShortcuts.lookup('', list), null);
  });

  test('keys are case-insensitive', () => {
    a.eq(CGP.timeShortcuts.lookup('LUNCH', [{ key: 'lunch', time: '11:30' }]).time, '11:30');
  });

  test('formats the way Canvas reads times, with plain spaces', () => {
    a.eq(CGP.timeShortcuts.format('08:55'), '8:55 AM');
    a.eq(CGP.timeShortcuts.format('10:10'), '10:10 AM');
    a.eq(CGP.timeShortcuts.format('12:30'), '12:30 PM');
    a.eq(CGP.timeShortcuts.format('13:45'), '1:45 PM');
    a.eq(CGP.timeShortcuts.format('00:05'), '12:05 AM');
    a.eq(CGP.timeShortcuts.format('13:45', { hour12: false }), '13:45');
    a.eq(CGP.timeShortcuts.format('nope'), '');
  });

  test('English locales use 12-hour time, 24-hour locales do not', () => {
    a.eq(CGP.timeShortcuts.uses12Hour('en-US'), true);
    a.eq(CGP.timeShortcuts.uses12Hour('de-DE'), false);
  });
});

/* ------------------------------------------------------------ controller */

class FakeInput {
  constructor(attrs, labelText) {
    this.tagName = 'INPUT';
    this.attrs = Object.assign({ type: 'text', role: 'combobox' }, attrs);
    this.labels = labelText ? [{ textContent: labelText }] : [];
    this._v = '';
    this.events = [];
    this.selectionStart = 0; this.selectionEnd = 0;
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  closest() { return null; }
  get value() { return this._v; }
  set value(v) { this._v = String(v); }
  dispatchEvent(ev) { this.events.push(ev.type); return true; }
  type(text) { this._v = text; this.selectionStart = this.selectionEnd = text.length; return this; }
}

function boot(settingsValues) {
  const handlers = {};
  const sandbox = {
    document: {
      documentElement: { lang: 'en' },
      addEventListener(type, fn) { handlers[type] = fn; },
      getElementById() { return null; }
    },
    Event: class { constructor(type) { this.type = type; } },
    HTMLInputElement: FakeInput,
    navigator: { language: 'en-US' }
  };
  // Own context for the controller (so it sees the fake document), sharing
  // the CGP the rest of the suite already loaded.
  sandbox.CGP = CGP;
  const code = fs.readFileSync(path.join(ROOT, 'src/assignments/time-shortcuts.js'), 'utf8');
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'assignments/time-shortcuts.js' });
  const settings = { values: Object.assign({}, CGP.DEFAULTS, settingsValues) };
  new CGP.CanvasTimeShortcuts({ settings }).start();
  return { handlers, settings };
}

suite('time shortcut controller', (test) => {
  test('Tab in a Time box turns 1 into the period start, and fires an input event for React', () => {
    const { handlers } = boot();
    const box = new FakeInput({}, 'Time').type('1');
    handlers.keydown({ key: 'Tab', target: box });
    a.eq(box.value, '8:55 AM');
    a.deep(box.events, ['input']);
  });

  test('Enter and focusout work too, for every default period', () => {
    const { handlers } = boot();
    const expect = { 2: '10:10 AM', 3: '12:30 PM', 4: '1:45 PM' };
    Object.keys(expect).forEach((k, i) => {
      const box = new FakeInput({}, 'Time').type(k);
      if (i % 2) handlers.focusout({ target: box }); else handlers.keydown({ key: 'Enter', target: box });
      a.eq(box.value, expect[k]);
    });
  });

  test('also recognises the box by its data-testid when the label is hidden', () => {
    const { handlers } = boot();
    const box = new FakeInput({ 'data-testid': 'due_time_input' }).type('3');
    handlers.keydown({ key: 'Tab', target: box });
    a.eq(box.value, '12:30 PM');
  });

  test('leaves real times, other keys and other keystrokes alone', () => {
    const { handlers } = boot();
    const typed = new FakeInput({}, 'Time').type('12:30');
    handlers.keydown({ key: 'Tab', target: typed });
    a.eq(typed.value, '12:30');
    const unknown = new FakeInput({}, 'Time').type('7');
    handlers.keydown({ key: 'Tab', target: unknown });
    a.eq(unknown.value, '7');
    const arrow = new FakeInput({}, 'Time').type('1');
    handlers.keydown({ key: 'ArrowDown', target: arrow });
    a.eq(arrow.value, '1', 'only Tab/Enter/focusout commit');
    const modified = new FakeInput({}, 'Time').type('1');
    handlers.keydown({ key: 'Enter', metaKey: true, target: modified });
    a.eq(modified.value, '1');
  });

  test('never touches a box that is not a time combobox', () => {
    const { handlers } = boot();
    const date = new FakeInput({}, 'Due Date').type('1');
    handlers.keydown({ key: 'Tab', target: date });
    a.eq(date.value, '1', 'a Date box');
    const plain = new FakeInput({ role: null }, 'Time').type('1');
    plain.attrs.role = undefined; delete plain.attrs.role;
    handlers.keydown({ key: 'Tab', target: plain });
    a.eq(plain.value, '1', 'not a combobox');
    handlers.keydown({ key: 'Tab', target: { tagName: 'TEXTAREA' } });
  });

  test('ignores an auto-completed tail the combobox left selected after the last keystroke', () => {
    const { handlers } = boot();
    const box = new FakeInput({}, 'Time').type('1');
    handlers.input({ isTrusted: true, target: box });
    box.value = '1:00 AM'; box.selectionStart = 1; box.selectionEnd = 7;
    handlers.keydown({ key: 'Tab', target: box });
    a.eq(box.value, '8:55 AM');
  });

  test('never treats the teacher’s own selection inside a real time as a completion', () => {
    const { handlers } = boot();
    // Typed "12:30", then selected "2:30" (a suffix that leaves the key "1").
    const box = new FakeInput({}, 'Time').type('12:30');
    handlers.input({ isTrusted: true, target: box });
    box.selectionStart = 1; box.selectionEnd = 5;
    handlers.keydown({ key: 'Tab', target: box });
    a.eq(box.value, '12:30');
    // Same when the box was filled by Canvas (no keystroke seen at all).
    const filled = new FakeInput({}, 'Time');
    filled.value = '12:30'; filled.selectionStart = 1; filled.selectionEnd = 5;
    handlers.focusout({ target: filled });
    a.eq(filled.value, '12:30');
  });

  test('does nothing while the setting is off, and follows later edits to the list', () => {
    const off = boot({ timeShortcutsEnabled: false });
    const box = new FakeInput({}, 'Time').type('1');
    off.handlers.keydown({ key: 'Tab', target: box });
    a.eq(box.value, '1');

    const on = boot();
    on.settings.values.timeShortcuts = [{ key: 'lunch', time: '11:30' }];
    const lunch = new FakeInput({}, 'Time').type('Lunch');
    on.handlers.keydown({ key: 'Tab', target: lunch });
    a.eq(lunch.value, '11:30 AM');
    const old = new FakeInput({}, 'Time').type('1');
    on.handlers.keydown({ key: 'Tab', target: old });
    a.eq(old.value, '1', 'a removed shortcut no longer fires');
  });
});
