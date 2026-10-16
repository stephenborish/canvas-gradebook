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

  /** What the teacher typed, ignoring any inline auto-completion the combobox
   * may have appended and left selected. */
  function typedText(input) {
    var v = String(input.value || '');
    var s = input.selectionStart, e = input.selectionEnd;
    if (typeof s === 'number' && s !== e && e === v.length) v = v.slice(0, s);
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
    // focusout, not blur: it bubbles, so one document listener covers boxes
    // Canvas mounts later. Also covers clicking straight onto another field.
    document.addEventListener('focusout', function (e) { self.apply(e.target); }, true);
  };

  CGP.CanvasTimeShortcuts = CanvasTimeShortcuts;
  CGP.canvasTimeShortcuts = { isTimeInput: isTimeInput, typedText: typedText };
})();
