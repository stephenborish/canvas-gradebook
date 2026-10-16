/* Canvas Gradebook+ - period shortcuts for Canvas's "Time" boxes.
 *
 * In the Assign To card on the new/edit assignment page (and the same card on
 * quizzes, discussions and modules) type a key such as 1-4 into a Due /
 * Available from / Until "Time" box, then press Tab or Enter - or just click
 * away - and the key is replaced with that period's start time. The shortcut
 * list lives in the options page.
 *
 * Only a box holding nothing but a shortcut key is touched, so typing
 * "12:30" or "1 pm" works as always. The swap happens in the capture phase,
 * before Canvas's own Enter/Tab/blur handling reads the box, and goes through
 * the native value setter plus an `input` event so Canvas's React state sees
 * it as typed. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});

  var TIME_WORD = /(^|[^a-z])time([^a-z]|$)/i;

  /** Labels the way Canvas names the box: <label>, aria-label(ledby), and the
   * data-testid on the field ("due_time_input" and friends). */
  function describe(input) {
    var parts = [input.getAttribute('aria-label') || '', input.getAttribute('data-testid') || ''];
    var by = input.getAttribute('aria-labelledby');
    if (by) {
      by.split(/\s+/).forEach(function (id) {
        var el = id && document.getElementById(id);
        if (el) parts.push(el.textContent || '');
      });
    }
    var labels = input.labels || [];
    for (var i = 0; i < labels.length; i++) parts.push(labels[i].textContent || '');
    var wrap = input.closest && input.closest('[data-testid]');
    if (wrap) parts.push(wrap.getAttribute('data-testid') || '');
    return parts.join(' ');
  }

  function isTimeInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (String(el.getAttribute('type') || 'text').toLowerCase() !== 'text') return false;
    if (el.getAttribute('role') !== 'combobox') return false;
    return TIME_WORD.test(describe(el));
  }

  /* The text up to the caret after the teacher's last real keystroke in each
   * box. A combobox may append an auto-completed tail after the caret and
   * leave it selected; only a selection that starts exactly where that last
   * keystroke left the caret is such a tail. Any other selection is the
   * teacher's own (say, the "2:30" of "12:30") and must never be stripped. */
  var lastTyped = new WeakMap();

  /** What the teacher typed, ignoring a combobox's selected auto-completion. */
  function typedText(input) {
    var v = String(input.value || '');
    var s = input.selectionStart, e = input.selectionEnd;
    var typed = lastTyped.get(input);
    if (typeof s === 'number' && s !== e && e === v.length && typed !== undefined && v.slice(0, s) === typed) {
      return typed;
    }
    return v;
  }

  function setNativeValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function CanvasTimeShortcuts(opts) {
    this.settings = opts.settings;
    this._started = false;
  }

  /** Swaps a typed shortcut key for its time. Returns the shortcut applied. */
  CanvasTimeShortcuts.prototype.apply = function (input) {
    var v = this.settings.values;
    if (!v.timeShortcutsEnabled || !isTimeInput(input)) return null;
    var hit = CGP.timeShortcuts.lookup(typedText(input), v.timeShortcuts);
    if (!hit) return null;
    var lang = (document.documentElement && document.documentElement.lang) || (typeof navigator !== 'undefined' ? navigator.language : '');
    var text = CGP.timeShortcuts.format(hit.time, { hour12: CGP.timeShortcuts.uses12Hour(lang) });
    setNativeValue(input, text);
    CGP.diag.bump('timeShortcuts.applied');
    return hit;
  };

  CanvasTimeShortcuts.prototype.start = function () {
    if (this._started) return;
    this._started = true;
    var self = this;
    document.addEventListener('keydown', function (e) {
      if ((e.key !== 'Enter' && e.key !== 'Tab') || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      self.apply(e.target);
    }, true);
    document.addEventListener('input', function (e) {
      // Trusted only: our own swap below dispatches an untrusted `input`.
      if (!e.isTrusted || !e.target || e.target.tagName !== 'INPUT') return;
      var t = e.target;
      lastTyped.set(t, String(t.value || '').slice(0, typeof t.selectionStart === 'number' ? t.selectionStart : undefined));
    }, true);
    // focusout, not blur: it bubbles, so one document listener covers boxes
    // Canvas mounts later. Also covers clicking straight onto another field.
    document.addEventListener('focusout', function (e) { self.apply(e.target); }, true);
  };

  CGP.CanvasTimeShortcuts = CanvasTimeShortcuts;
  CGP.canvasTimeShortcuts = { isTimeInput: isTimeInput, typedText: typedText };
})();
