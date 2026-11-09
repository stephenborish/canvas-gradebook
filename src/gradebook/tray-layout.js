/* Canvas Gradebook+ - a tidier Grade Detail Tray.
 *
 * Canvas's tray stacks its Status radios (None / Late / Missing / Excused,
 * plus any custom statuses) one per row, each a full-width band, and puts the
 * comment box's Cancel / Submit buttons BELOW a tall editor - so the Status
 * section eats half the tray and a typed comment's Submit is off the bottom
 * of the screen. With `trayLayout` on:
 *
 *  - the Status radios are replaced by our own segmented control (see
 *    StatusControl below): one row of buttons in Canvas's status colours,
 *    the current one filled; pressing it again clears it; Late gets a tidy
 *    "Late by [-] 2 [+] days" bar. Canvas's radios stay on the page, hidden,
 *    and every press goes through them - Canvas makes its own update.
 *  - the comment box is one card: its Cancel / Submit as a slim bar on top,
 *    compact formatting buttons, always on show and wrapping rather than clipped (the
 *    "more" button now reveals only the Paragraph dropdown - the reverse of
 *    TinyMCE's own split), a shorter editing area, and no status bar under
 *    it (the element path, word count and accessibility checker button).
 *    The editing area grows with what is typed, down to the bottom of the
 *    window, and scrolls from there (CommentGrow below).
 *  - SpeedGrader and Submit for Student sit side by side, sharing the width
 *    equally (ActionsControl below); when Canvas shows only one of them, that
 *    one keeps its own size, centred.
 *
 * None of Canvas's nodes is moved: the tray is React's, and moving its nodes
 * would break its next render. They are only tagged with data-cgp-tray-*
 * attributes (never classes: React rewrites className whenever Canvas
 * toggles one of its own) and the CSS keyed off those attributes and
 * html.cgp-tray-tidy does the rest. The nodes we add are the status
 * control, a sibling right after Canvas's radio group, and the SpeedGrader /
 * Submit for Student row, a sibling right before the first of Canvas's two.
 * Turning the setting off removes them and drops the root class, which puts
 * the tray back exactly as Canvas draws it.
 *
 * Every lookup is anchored on the radios' `name` (SubmissionTrayRadioInput),
 * which Canvas never localizes, rather than on labels or emotion-generated
 * class names, which change between builds. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.TrayLayoutController) return;

  var RADIO_SELECTOR = 'input[name="SubmissionTrayRadioInput"], .SubmissionTray__RadioInput input[type="radio"]';
  var RCE_SELECTOR = '.rce-wrapper, [data-testid="RCEWrapper"], .tox-tinymce';
  var ROOT_CLASS = 'cgp-tray-tidy';
  var GRID_SELECTOR = '.slick-viewport, .grid-canvas';
  var POLL_MS = 200;

  function TrayLayoutController(ctx) {
    var self = this;
    this.settings = ctx.settings;
    this.observer = null;
    this.tray = null;   // the tray dialog last seen, while it is on the page
    this.status = null; // the StatusControl standing in for Canvas's radios
    this.actions = null; // the ActionsControl standing in for SpeedGrader / Submit for Student
    this.grow = null;   // the CommentGrow sizing the comment editor
    this.timer = null;
    this.scheduleScan = CGP.util.rafBatch(function () { self.scan(); }, 'trayLayout');
  }

  var P = TrayLayoutController.prototype;

  P.start = function () {
    var self = this;
    this.apply();
    if (this.settings && typeof this.settings.onChange === 'function') {
      this.settings.onChange(function () { self.apply(); });
    }
  };

  P.enabled = function () {
    return !!(this.settings && this.settings.values && this.settings.values.trayLayout);
  };

  P.apply = function () {
    var on = this.enabled();
    document.documentElement.classList.toggle(ROOT_CLASS, on);
    if (on) this.observe();
    else {
      this.disconnect();
      this.stopPolling();
      if (this.status) this.status.destroy();
      if (this.actions) this.actions.destroy();
      if (this.grow) this.grow.destroy();
      this.status = this.actions = this.grow = null;
    }
  };

  P.observe = function () {
    if (this.observer || typeof MutationObserver === 'undefined' || !document.body) {
      this.scan();
      return;
    }
    var self = this;
    // childList only: the attributes set by scan() never re-trigger it.
    this.observer = new MutationObserver(function (records) { self.onMutations(records); });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scan();
  };

  P.disconnect = function () {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
  };

  /* The observer sees every mutation on the page, and SlickGrid rewrites
   * rows on every scroll frame, so this filter must stay cheap: no scan is
   * scheduled unless the mutation could concern the tray.
   *  - While a tray is open, only mutations inside it count.
   *  - Otherwise, only added nodes outside the grid that hold a status radio
   *    (the tray mounting, or its content arriving in an empty shell). */
  P.onMutations = function (records) {
    if (this.tray && !this.tray.isConnected) this.tray = null;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (this.tray) {
        if (this.tray.contains(rec.target)) { this.scheduleScan(); return true; }
        continue;
      }
      var added = rec.addedNodes || [];
      for (var j = 0; j < added.length; j++) {
        if (mightHoldTray(added[j])) { this.scheduleScan(); return true; }
      }
    }
    return false;
  };

  function mightHoldTray(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.closest && node.closest(GRID_SELECTOR)) return false;
    if (node.closest && node.closest(RADIO_SELECTOR) === node) return true;
    return !!(node.querySelector && node.querySelector(RADIO_SELECTOR));
  }

  /** Tags the tray currently on the page, if any. Safe to call repeatedly.
   * Looks only inside the known tray when there is one. */
  P.scan = function () {
    // A scan queued just before the setting went off must not rebuild the
    // control apply() has just torn down.
    if (!this.enabled()) return false;
    if (this.tray && !this.tray.isConnected) this.tray = null;
    var radios = toArray((this.tray || document).querySelectorAll(RADIO_SELECTOR));
    if (radios.length < 2) return false;
    var row = tagStatuses(radios);
    // Comment forms are only looked for inside the tray itself: falling back
    // to the whole page would restyle any other textarea + buttons on it
    // (the gradebook's own comment popover, say).
    this.tray = trayFor(radios[0]);
    if (this.tray) {
      var editors = tagCommentForms(this.tray);
      if (!this.grow) this.grow = new CommentGrow();
      this.grow.watch(editors[0] || null);
      if (!this.actions) this.actions = new ActionsControl();
      this.actions.attach(this.tray);
    }
    if (row) {
      if (!this.status) this.status = new StatusControl();
      if (this.status.attach(row)) this.startPolling();
    }
    return true;
  };

  /* Canvas flips a radio's `checked` as a property, which no observer
   * reports, so while the control is up it re-reads the radios on a light
   * timer (a handful of property reads; nothing is written unless changed). */
  P.startPolling = function () {
    if (this.timer) return;
    var self = this;
    this.timer = setInterval(function () { self.tick(); }, POLL_MS);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  };

  P.stopPolling = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  P.tick = function () {
    if (!this.status || !this.enabled()) { this.stopPolling(); return; }
    if (this.status.connected()) {
      this.status.sync();
      // Canvas's buttons change by attribute (another student's link, a
      // disabled state), which the childList-only observer never reports.
      if (this.actions && this.tray) this.actions.attach(this.tray);
      if (this.grow) this.grow.update();
      return;
    }
    // The tray closed, or React swapped the group out: find it afresh.
    this.stopPolling();
    if (this.tray && !this.tray.isConnected) this.tray = null;
    this.scan();
  };

  /* ------------------------------------------------------------- statuses */

  /* Tags Canvas's radio group: the row that holds every option (hidden once
   * our control stands in for it). Returns the row, or null when the radios
   * share no ancestor. */
  function tagStatuses(radios) {
    var row = commonAncestor(radios.map(bandFor));
    if (row) setAttr(row, 'data-cgp-tray-status', '');
    return row;
  }

  /** The band Canvas paints (its status colour) around one radio. */
  function bandFor(radio) {
    return (radio.closest && radio.closest('.SubmissionTray__RadioInput')) || radio;
  }

  function radioValue(radio) {
    return String(radio.value || radio.getAttribute('value') || '').toLowerCase();
  }

  /* ---------------------------------------------------- the status control */

  /* Our own status picker, standing in for Canvas's radio list (which stays
   * on the page, hidden, and still does the work).
   *
   *  - One segmented control: a button per status, in Canvas's order and
   *    with Canvas's labels and colours (custom statuses included). The
   *    current one is filled in its colour.
   *  - A button "presses" Canvas's own radio, so Canvas makes exactly the
   *    update it would have made, through its own code.
   *  - Pressing the current status again clears it - presses None - which a
   *    radio can never do.
   *  - The press shows at once (with a small spinner) and settles when
   *    Canvas's radio agrees; if Canvas ignores it, it reverts.
   *  - Late gets a "Late by [-] 2 [+] days" bar under the control, wired to
   *    Canvas's own days field (which commits on blur): typing commits on
   *    Enter or leaving the box, the steppers commit after a short pause.
   *
   * Canvas sets a radio's `checked` as a property, which no observer sees,
   * so the controller re-reads the radios on a light timer while the tray
   * is open; nothing is written to the page unless something changed. */
  var NEUTRAL = '#5b6770';
  var PENDING_MS = 6000;
  var STEP_COMMIT_MS = 650;

  function StatusControl() {
    this.root = null;
    this.row = null;
    this.optsKey = '';
    this.stateKey = '';
    this.buttons = {};
    this.pending = null;       // { value, until }
    this.daysDirty = false;    // our days box holds an uncommitted edit
    this.daysEcho = null;      // { node, canvas, shown } after a commit
    this.stepTimer = null;
    this.model = null;
  }

  var SC = StatusControl.prototype;

  /** Puts the control right after Canvas's row (inside the same group, so
   * it sits under Canvas's "Status" heading) and hides the row. */
  SC.attach = function (row) {
    if (!row || !row.parentElement) return false;
    if (!this.root) this.build();
    if (this.row && this.row !== row) {
      // A new group (another tray): nothing carries over from the last one.
      // A stepper commit still waiting belongs to the old group's student.
      if (this.stepTimer) { clearTimeout(this.stepTimer); this.stepTimer = null; }
      this.row.removeAttribute('data-cgp-tray-proxied');
      this.pending = this.daysEcho = null;
      this.daysDirty = false;
      this.stateKey = '';
    }
    this.row = row;
    if (this.root.parentElement !== row.parentElement || row.nextSibling !== this.root) {
      row.parentElement.insertBefore(this.root, row.nextSibling);
    }
    setAttr(row, 'data-cgp-tray-proxied', '');
    this.sync();
    return true;
  };

  SC.connected = function () {
    return !!(this.root && this.root.isConnected && this.row && this.row.isConnected);
  };

  SC.destroy = function () {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = null;
    if (this.row) this.row.removeAttribute('data-cgp-tray-proxied');
    if (this.root) this.root.remove();
    this.root = this.row = null;
    this.optsKey = this.stateKey = '';
    this.buttons = {};
    this.pending = this.daysEcho = null;
    this.daysDirty = false;
  };

  SC.build = function () {
    var self = this;
    var root = document.createElement('div');
    root.className = 'cgp-tstat';
    root.setAttribute('data-cgp-tray-own', '');

    var seg = document.createElement('div');
    seg.className = 'cgp-tstat__seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Submission status');
    seg.addEventListener('keydown', function (e) { self.onSegKey(e); });

    var late = document.createElement('div');
    late.className = 'cgp-tstat__late';
    late.hidden = true;
    late.setAttribute('hidden', '');

    var lbl = document.createElement('span');
    lbl.className = 'cgp-tstat__late-lbl';
    lbl.textContent = 'Late by';

    var stepper = document.createElement('span');
    stepper.className = 'cgp-tstat__stepper';
    var minus = stepButton('−', 'Less late', function () { self.step(-1); });
    var plus = stepButton('+', 'More late', function () { self.step(1); });
    var input = document.createElement('input');
    input.className = 'cgp-tstat__days';
    input.setAttribute('type', 'text');
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Time late');
    input.addEventListener('input', function () { self.daysDirty = true; });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); self.commitDays(); }
      else if (e.key === 'Escape') { e.stopPropagation(); self.revertDays(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self.step(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); self.step(-1); }
    });
    input.addEventListener('blur', function () {
      if (self.daysDirty) { self.commitDays(); return; }
      // Canvas's amount may have changed while the box had focus (and so was
      // not redrawn): show it now.
      self.stateKey = '';
      self.sync();
    });
    stepper.appendChild(minus);
    stepper.appendChild(input);
    stepper.appendChild(plus);

    var unit = document.createElement('span');
    unit.className = 'cgp-tstat__unit';

    late.appendChild(lbl);
    late.appendChild(stepper);
    late.appendChild(unit);
    root.appendChild(seg);
    root.appendChild(late);

    this.root = root;
    this.seg = seg;
    this.late = late;
    this.daysInput = input;
    this.unit = unit;
    this.minus = minus;
    this.plus = plus;
  };

  function stepButton(text, label, onClick) {
    var b = document.createElement('button');
    b.setAttribute('type', 'button');
    b.className = 'cgp-tstat__step';
    b.setAttribute('aria-label', label);
    b.setAttribute('tabindex', '-1');
    b.textContent = text;
    // Keep focus where it is (the days box keeps its edit going).
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  /** What Canvas's hidden radios say right now. */
  SC.read = function () {
    var radios = this.row ? toArray(this.row.querySelectorAll(RADIO_SELECTOR)) : [];
    var opts = radios.map(function (r) {
      var band = bandFor(r);
      var value = radioValue(r);
      var color = band !== r && band.style ? band.style.backgroundColor : '';
      return {
        value: value,
        label: labelFor(r, band) || value,
        accent: value === 'none' ? null : accentFor(color),
        radio: r,
        band: band,
        checked: flag(r, 'checked'),
        disabled: flag(r, 'disabled')
      };
    });
    var current = null;
    opts.forEach(function (o) { if (o.checked) current = o.value; });
    var lateOpt = opts.filter(function (o) { return o.value === 'late'; })[0];
    return { opts: opts, current: current, days: lateOpt && lateOpt.band !== lateOpt.radio ? readDays(lateOpt.band, lateOpt.radio) : null };
  };

  function labelFor(radio, band) {
    var id = radio.getAttribute('id');
    var label = null;
    if (id && band.querySelector) {
      toArray(band.querySelectorAll('label')).forEach(function (l) {
        if (!label && l.getAttribute('for') === id) label = l;
      });
    }
    label = label || (radio.closest && radio.closest('label')) || (band.querySelector && band.querySelector('label'));
    return label ? textOf(label).replace(/\s+/g, ' ').trim() : '';
  }

  /* Canvas's days field (TimeLateInput: an InstUI NumberInput plus a
   * "Day(s)" / "Hour(s)" word), present only while Late is checked. */
  function readDays(band, radio) {
    var input = toArray(band.querySelectorAll('input')).filter(function (i) {
      var t = (i.getAttribute('type') || 'text').toLowerCase();
      return i !== radio && t !== 'radio' && t !== 'hidden';
    })[0];
    if (!input) return null;
    var box = (input.closest && input.closest('.NumberInput__Container')) || input.parentElement;
    var unit = '';
    toArray(box ? box.querySelectorAll('*') : []).forEach(function (el) {
      if (el.children.length || el === input) return;
      if (el.closest && el.closest('label')) return;   // the screen-reader label
      var t = textOf(el).trim();
      if (t) unit = t;
    });
    return {
      input: input,
      value: String(input.value != null ? input.value : (input.getAttribute('value') || '')),
      unit: unit,
      disabled: flag(input, 'disabled') || input.getAttribute('aria-disabled') === 'true'
    };
  }

  /** Re-reads Canvas and redraws whatever changed. */
  SC.sync = function () {
    if (!this.root || !this.row) return;
    var m = this.read();
    this.model = m;
    if (!m.opts.length) return;
    if (this.pending && (this.pending.value === m.current || Date.now() > this.pending.until)) this.pending = null;

    var optsKey = m.opts.map(function (o) { return o.value + '\u0001' + o.label + '\u0001' + (o.accent || ''); }).join('\u0002');
    if (optsKey !== this.optsKey) {
      this.optsKey = optsKey;
      this.stateKey = '';
      this.buildButtons(m.opts);
    }

    var shown = this.pending ? this.pending.value : m.current;
    var days = m.days;
    var stateKey = [shown, this.pending ? 1 : 0, m.opts.map(function (o) { return o.disabled ? 1 : 0; }).join(''),
      days ? days.value + '|' + days.unit + '|' + (days.disabled ? 1 : 0) : '-', this.daysDirty ? 1 : 0].join('\u0001');
    if (stateKey === this.stateKey) return;
    this.stateKey = stateKey;

    var self = this;
    m.opts.forEach(function (o) {
      var b = self.buttons[o.value];
      if (!b) return;
      var on = o.value === shown;
      setAttr(b, 'aria-pressed', on ? 'true' : 'false');
      if (on && self.pending) setAttr(b, 'data-pending', ''); else b.removeAttribute('data-pending');
      b.disabled = !!o.disabled;
      if (o.disabled) setAttr(b, 'disabled', ''); else b.removeAttribute('disabled');
      setAttr(b, 'title', on && o.value !== 'none' ? o.label + ' – click again to clear' : o.label);
    });
    setAttr(this.root, 'data-current', shown || '');
    this.renderDays(shown === 'late' ? days : null, m.opts);
  };

  SC.buildButtons = function (opts) {
    var self = this;
    while (this.seg.children.length) this.seg.removeChild(this.seg.children[0]);
    this.buttons = {};
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.className = 'cgp-tstat__opt';
      b.setAttribute('data-value', o.value);
      b.setAttribute('aria-pressed', 'false');
      if (b.style && typeof b.style.setProperty === 'function') {
        b.style.setProperty('--cgp-tstat-c', o.accent || NEUTRAL);
      }
      var dot = document.createElement('span');
      dot.className = 'cgp-tstat__dot';
      dot.setAttribute('aria-hidden', 'true');
      var txt = document.createElement('span');
      txt.className = 'cgp-tstat__txt';
      txt.textContent = o.label;
      b.appendChild(dot);
      b.appendChild(txt);
      b.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        self.choose(o.value);
      });
      self.seg.appendChild(b);
      self.buttons[o.value] = b;
    });
    var late = opts.filter(function (o) { return o.value === 'late'; })[0];
    if (this.late.style && typeof this.late.style.setProperty === 'function') {
      this.late.style.setProperty('--cgp-tstat-c', (late && late.accent) || NEUTRAL);
    }
  };

  SC.renderDays = function (days, opts) {
    if (!days) {
      this.late.hidden = true;
      setAttr(this.late, 'hidden', '');
      this.daysDirty = false;
      return;
    }
    this.late.hidden = false;
    this.late.removeAttribute('hidden');
    var unit = days.unit ? days.unit.toLocaleLowerCase() : 'days';
    setAttr(this.daysInput, 'aria-label', 'Late by, in ' + unit);
    var off = !!days.disabled || opts.some(function (o) { return o.value === 'late' && o.disabled; });
    [this.daysInput, this.minus, this.plus].forEach(function (el) {
      el.disabled = off;
      if (off) setAttr(el, 'disabled', ''); else el.removeAttribute('disabled');
    });
    var echo = this.daysEcho;
    if (echo && (echo.node !== days.input || echo.canvas !== days.value)) echo = this.daysEcho = null;
    if (!this.daysDirty && !isFocused(this.daysInput)) {
      var v = echo ? echo.shown : days.value;
      if (this.daysInput.value !== v) this.daysInput.value = v;
    }
    // Canvas words the unit by its whole-number copy ("1.5 Day"); put the
    // English plural right for what is actually shown.
    var n = parseAmount(this.daysInput.value);
    if (n !== null) {
      if (/^(day|hour)$/.test(unit) && n !== 1) unit += 's';
      else if (/^(days|hours)$/.test(unit) && n === 1) unit = unit.slice(0, -1);
    }
    // Only when it changed: each write is a mutation in the tray, which
    // queues another full scan.
    if (this.unit.textContent !== unit) this.unit.textContent = unit;
  };

  /** A status button was pressed. */
  SC.choose = function (value) {
    var m = this.read();
    var shown = this.pending ? this.pending.value : m.current;
    var target = value === shown && value !== 'none' ? 'none' : value;
    if (target === shown && !this.pending) return false;
    var opt = m.opts.filter(function (o) { return o.value === target; })[0];
    if (!opt || opt.disabled) return false;
    if (this.daysDirty) this.commitDays();
    this.pending = { value: target, until: Date.now() + PENDING_MS };
    // Canvas's own radio: the click is what React listens for, so Canvas
    // runs its usual change handler and makes its usual request.
    if (!opt.checked) opt.radio.click();
    this.sync();
    return true;
  };

  /** Drops an uncommitted edit (and any stepper commit still waiting) and
   * shows Canvas's amount again - even though the box still has focus. */
  SC.revertDays = function () {
    if (this.stepTimer) { clearTimeout(this.stepTimer); this.stepTimer = null; }
    this.daysDirty = false;
    var m = this.read();
    this.model = m;
    if (m.days) {
      var echo = this.daysEcho;
      if (echo && (echo.node !== m.days.input || echo.canvas !== m.days.value)) echo = this.daysEcho = null;
      this.daysInput.value = echo ? echo.shown : m.days.value;
    }
    this.stateKey = '';
    this.sync();
  };

  SC.step = function (delta) {
    if (!this.model || !this.model.days || this.daysInput.disabled) return;
    var n = parseAmount(this.daysInput.value);
    if (n === null) n = parseAmount(this.model.days.value) || 0;
    // To the next whole amount in that direction: 1.5 steps to 2 or 1.
    n = Math.max(0, (delta > 0 ? Math.floor(n) : Math.ceil(n)) + delta);
    this.daysInput.value = String(n);
    this.daysDirty = true;
    var self = this;
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = setTimeout(function () { self.stepTimer = null; self.commitDays(); }, STEP_COMMIT_MS);
  };

  /** Hands our days box's value to Canvas's field, the way typing in it
   * and tabbing away would: Canvas commits on blur, reading the field. */
  SC.commitDays = function () {
    if (this.stepTimer) { clearTimeout(this.stepTimer); this.stepTimer = null; }
    var m = this.read();
    this.model = m;
    this.daysDirty = false;
    this.stateKey = '';
    var days = m.days;
    var amount = parseAmount(this.daysInput.value);
    if (!days || amount === null) { this.sync(); return false; }
    // Decimals are welcome ("1.5" or "1,5" alike), kept to Canvas's own two
    // places, and handed over in the page language's decimal separator,
    // which is how Canvas's field parses what it is given.
    amount = Math.round(amount * 100) / 100;
    var typed = formatAmount(amount);
    this.daysInput.value = typed;
    if (amount === parseAmount(days.value)) { this.sync(); return false; }
    var input = days.input;
    setNativeValue(input, typed);
    fire(input, 'input', true);
    // React has put back its own (whole-number) copy by now; the blur
    // handler must see what was typed.
    setNativeValue(input, typed);
    fire(input, 'focusout', true);
    fire(input, 'blur', false);
    this.daysEcho = { node: input, canvas: String(input.value), shown: typed };
    this.sync();
    return true;
  };

  /* Arrow keys move between the status buttons. */
  SC.onSegKey = function (e) {
    var keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    if (!(e.key in keys)) return;
    var list = toArray(this.seg.children).filter(function (b) { return !b.disabled; });
    var at = list.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    var next = list[(at + keys[e.key] + list.length) % list.length];
    if (next && next.focus) next.focus();
  };

  /* The input's own value setter, past any instance-level override: React
   * tracks a controlled field's value through one, and a value set through
   * it would look unchanged to React's change handler. */
  function setNativeValue(input, value) {
    var proto = typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set && input instanceof HTMLInputElement) desc.set.call(input, value);
    else input.value = value;
  }

  /** A typed amount: digits with at most one decimal mark - a point, a
   * comma, or the page language's own (e.g. Persian "٫", which is how
   * formatAmount writes it back) - or null for anything else (negatives,
   * letters, thousands separators). */
  function parseAmount(s) {
    var t = String(s == null ? '' : s).trim();
    var sep = decimalSeparator();
    if (sep !== '.' && sep !== ',') t = t.split(sep).join('.');
    t = t.replace(',', '.');
    if (!t || !/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
    return parseFloat(t);
  }

  /** An amount written with the page language's decimal separator. */
  function formatAmount(n) {
    var text = String(n);
    var sep = decimalSeparator();
    return sep === '.' ? text : text.replace('.', sep);
  }

  /* Canvas sets <html lang> to the user's language, and parses its days
   * field by that language's rules ("1,5" is 1.5 in German, 15 in English). */
  function decimalSeparator() {
    var lang = (typeof document !== 'undefined' && document.documentElement &&
      (document.documentElement.lang || document.documentElement.getAttribute('lang'))) || 'en';
    try {
      var parts = new Intl.NumberFormat(lang).formatToParts(1.5);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'decimal') return parts[i].value;
    } catch (e) { /* unknown language tag: fall through */ }
    return '.';
  }

  function flag(el, name) {
    if (typeof el[name] === 'boolean') return el[name];
    return el.getAttribute(name) !== null;
  }

  function isFocused(el) {
    return typeof document !== 'undefined' && document.activeElement === el;
  }

  function fire(el, type, bubbles) {
    var ev = null;
    try {
      if (/^focus|^blur$/.test(type) && typeof FocusEvent === 'function') ev = new FocusEvent(type, { bubbles: bubbles });
      else if (typeof Event === 'function') ev = new Event(type, { bubbles: bubbles });
    } catch (e) { ev = null; }
    if (ev && typeof el.dispatchEvent === 'function') el.dispatchEvent(ev);
  }

  /** An element's text, descendants included. */
  function textOf(el) {
    if (!el) return '';
    var own = el.textContent;
    if (own) return String(own);
    return toArray(el.children).map(textOf).join(' ');
  }

  /* A pale status colour as a strong accent of the same hue, or null when
   * there is no colour to speak of (white, transparent, grey). */
  function accentFor(color) {
    var rgb = parseColor(color);
    if (!rgb) return null;
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    if (d < 0.02) return null;
    var l = (max + min) / 2;
    var sat = d / (1 - Math.abs(2 * l - 1));
    var h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60 + 360) % 360;
    // Yellows and oranges need to be darker than blues to read on white.
    var light = h >= 30 && h <= 75 ? 32 : 40;
    return 'hsl(' + h + ', ' + Math.round(Math.max(sat, 0.6) * 100) + '%, ' + light + '%)';
  }

  function parseColor(c) {
    var s = String(c || '').trim().toLowerCase();
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      return [+m[1], +m[2], +m[3]];
    }
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (m) {
      var hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    return null;
  }

  /* -------------------------------------------------------------- comments */

  /* The comment form is the nearest ancestor of an editor that also holds,
   * AFTER the editor, a child with buttons in it - Cancel / Submit. That child
   * is what moves to the top. Editors are the RCE (the whole wrapper, whose
   * own status bar has buttons of its own) or a plain textarea. */
  function tagCommentForms(tray) {
    var editors = [];
    toArray(tray.querySelectorAll(RCE_SELECTOR)).forEach(function (el) {
      var outer = outermostRce(el, tray);
      if (editors.indexOf(outer) < 0) editors.push(outer);
    });
    toArray(tray.querySelectorAll('textarea')).forEach(function (ta) {
      if (ta.closest && ta.closest(RCE_SELECTOR)) return;
      editors.push(ta);
    });
    editors.forEach(function (editor) {
      tagCommentForm(editor, tray);
      if (editor.tagName === 'TEXTAREA') return;
      setAttr(editor, 'data-cgp-tray-rce', '');
      // The whole status bar where it can be told apart; else just its word
      // count. Found once, then not searched for again (every keystroke's
      // word count update rescans the tray).
      if (editor.querySelector('[data-cgp-tray-hide]')) return;
      if (!tagStatusBar(editor)) tagWordCount(editor);
    });
    return editors;
  }

  /* The RCE status bar's "N words" count. Matched by Canvas's test id where
   * it has one, otherwise by shape - a leaf outside the editing area whose
   * whole text is a number and one word ("2 words", "2 mots") - so it works
   * in any language. A bare divider right before it goes too, so the bar is
   * not left ending in a separator. */
  var WORD_COUNT_TEXT = /^\d[\d,.\s]*\s+[^\d\s]+$/;
  function tagWordCount(editor) {
    var hits = toArray(editor.querySelectorAll('[data-testid*="word-count"], [data-testid*="wordcount"]'));
    if (!hits.length) {
      toArray(editor.querySelectorAll('span, div, button, p')).forEach(function (el) {
        if (el.children.length || (el.closest && el.closest('.tox-tinymce'))) return;
        if (WORD_COUNT_TEXT.test(String(el.textContent || '').trim())) hits.push(el);
      });
    }
    hits.forEach(function (el) {
      var target = (el.closest && el.closest('button')) || el;
      if (!editor.contains(target) || target === editor) return;
      // Climb through wrappers that hold nothing else.
      while (target.parentElement && target.parentElement !== editor &&
             target.parentElement.children.length === 1) target = target.parentElement;
      setAttr(target, 'data-cgp-tray-hide', '');
      var sibs = target.parentElement ? toArray(target.parentElement.children) : [];
      var prev = sibs[sibs.indexOf(target) - 1] || null;
      // Never an aria-live region: it is empty until it has something to say.
      if (prev && !String(prev.textContent || '').trim() &&
          !prev.getAttribute('aria-live') && !/^(status|alert|log)$/.test(prev.getAttribute('role') || '') &&
          !(prev.querySelector && prev.querySelector('button, svg, input, img'))) {
        setAttr(prev, 'data-cgp-tray-hide', '');
      }
    });
  }

  /* The RCE's status bar under the editing area - the element path ("p"),
   * the word count, the accessibility checker and the HTML / fullscreen
   * buttons. Canvas's test id where it has one; otherwise, beside the
   * TinyMCE box at any level up to the RCE wrapper, a part with buttons and
   * nothing to type in. */
  function tagStatusBar(rce) {
    var bars = toArray(rce.querySelectorAll('[data-testid="RCEStatusBar"]'));
    if (!bars.length) {
      var tox = matchesTox(rce) ? null : rce.querySelector('.tox-tinymce');
      var node = tox;
      while (node && node !== rce) {
        var sibs = node.parentElement ? toArray(node.parentElement.children) : [];
        sibs.slice(sibs.indexOf(node) + 1).forEach(function (sib) {
          if (sib.querySelector && sib.querySelector('button, [role="button"]') &&
              !sib.querySelector('textarea, iframe, input:not([type="hidden"]), [contenteditable="true"]')) bars.push(sib);
        });
        node = node.parentElement;
      }
    }
    bars = bars.filter(function (b) { return b !== rce; });
    bars.forEach(function (b) { setAttr(b, 'data-cgp-tray-hide', ''); });
    return bars.length > 0;
  }

  function matchesTox(el) {
    return (' ' + (el.className || '') + ' ').indexOf(' tox-tinymce ') >= 0;
  }

  function outermostRce(el, tray) {
    var outer = el;
    var p = el.parentElement;
    while (p && p !== tray) {
      if (matchesRce(p)) outer = p;
      p = p.parentElement;
    }
    return outer;
  }

  function matchesRce(el) {
    var cls = ' ' + (el.className || '') + ' ';
    return cls.indexOf(' rce-wrapper ') >= 0 || cls.indexOf(' tox-tinymce ') >= 0 ||
      el.getAttribute('data-testid') === 'RCEWrapper';
  }

  function tagCommentForm(editor, tray) {
    var child = editor;
    var form = editor.parentElement;
    while (form && tray.contains(form)) {
      var kids = toArray(form.children);
      var at = kids.indexOf(child);
      for (var i = at + 1; i < kids.length; i++) {
        if (isButtonBar(kids[i]) && holdsOnly(form, [child, kids[i]])) {
          setAttr(form, 'data-cgp-tray-comment', '');
          setAttr(child, 'data-cgp-tray-comment-editor', '');
          setAttr(kids[i], 'data-cgp-tray-comment-actions', '');
          // Submit is Canvas's last button; anything before it (Cancel) is secondary.
          var buttons = kids[i].tagName === 'BUTTON' ? [kids[i]] : toArray(kids[i].querySelectorAll('button'));
          buttons.forEach(function (b, n) {
            setAttr(b, 'data-cgp-tray-btn', n === buttons.length - 1 ? 'primary' : 'secondary');
          });
          return true;
        }
      }
      // Anything else after the editor at this level (a heading, the list of
      // earlier comments) means the buttons are not in this form's reach.
      if (at < kids.length - 1 || form === tray) break;
      child = form;
      form = form.parentElement;
    }
    return false;
  }

  /** True when every button and radio in `form` sits inside one of `parts`:
   * a comment form is its editor and its buttons, nothing else - so a
   * section that also holds the earlier comments, the statuses or a footer
   * is never mistaken for one. */
  function holdsOnly(form, parts) {
    var stray = toArray(form.querySelectorAll('button, input[type="radio"]')).filter(function (b) {
      return !parts.some(function (p) { return p.contains(b); });
    });
    return !stray.length;
  }

  /** A row of a few buttons and nothing that takes input. */
  function isButtonBar(el) {
    var buttons = el.tagName === 'BUTTON' ? [el] : toArray(el.querySelectorAll('button'));
    if (!buttons.length || buttons.length > 3) return false;
    var fields = toArray(el.querySelectorAll('textarea, input, iframe, ' + RCE_SELECTOR));
    return !fields.some(function (f) { return !(f.tagName === 'INPUT' && f.getAttribute('type') === 'hidden'); });
  }


  /* --------------------------------------- SpeedGrader / Submit for Student */

  /* Canvas stacks its SpeedGrader link and its Submit for Student button,
   * each in its own centred block. Where those blocks sit in Canvas's markup
   * (one shared parent, a flex column with the carousels...) is not
   * something to rely on, so - as with the statuses - Canvas's own are
   * hidden and stand-ins are shown in a row of our own:
   *
   *  - each stand-in is a copy of Canvas's control (same look, same icon),
   *    re-copied whenever Canvas's changes;
   *  - pressing it presses Canvas's own: a click on a button goes to
   *    Canvas's button, and a link takes Canvas's current address first (so
   *    Ctrl/Cmd-click still opens SpeedGrader in a new tab);
   *  - two found: side by side, equal widths. One found (Canvas leaves the
   *    other out for this assignment or student): that one alone, its
   *    natural size, centred. None: nothing is added. */
  var ACTION_KINDS = ['speedgrader', 'submit'];

  function ActionsControl() {
    this.root = null;
    this.items = {};   // kind -> { canvas, slot, proxy, sig }
  }

  var AC = ActionsControl.prototype;

  /** Finds Canvas's controls in `tray` and shows our row for them. Cheap to
   * call often: nothing is written unless something changed. */
  AC.attach = function (tray) {
    var found = findActions(tray);
    var kinds = ACTION_KINDS.filter(function (k) { return found[k]; });
    var self = this;
    // Forget (and show again) anything Canvas no longer renders.
    Object.keys(this.items).forEach(function (k) {
      var it = self.items[k];
      var f = found[k];
      if (f && f.canvas === it.canvas && f.slot === it.slot) return;
      // A slot still in use (by this control's successor, or by the other
      // control when both share one block) stays hidden.
      var inUse = ACTION_KINDS.some(function (j) { return found[j] && found[j].slot === it.slot; });
      if (it.slot && !inUse) it.slot.removeAttribute('data-cgp-tray-action-proxied');
      if (it.proxy) it.proxy.remove();
      delete self.items[k];
    });
    if (!kinds.length) {
      if (this.root) this.root.remove();
      return false;
    }
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'cgp-tact';
      this.root.setAttribute('data-cgp-tray-own', '');
    }
    // The row goes right before the first of Canvas's blocks.
    var first = found[kinds[0]].slot;
    if (first.parentElement && (this.root.parentElement !== first.parentElement || this.root.nextSibling !== first)) {
      first.parentElement.insertBefore(this.root, first);
    }
    kinds.forEach(function (k) {
      var f = found[k];
      var it = self.items[k] || (self.items[k] = { canvas: f.canvas, slot: f.slot, proxy: null, sig: '' });
      setAttr(f.slot, 'data-cgp-tray-action-proxied', '');
      var sig = signature(f.canvas);
      if (!it.proxy || sig !== it.sig) {
        var proxy = makeProxy(f.canvas, k);
        if (it.proxy && it.proxy.parentElement === self.root) self.root.insertBefore(proxy, it.proxy);
        if (it.proxy) it.proxy.remove();
        it.proxy = proxy;
        it.sig = sig;
      }
    });
    // Order: Canvas's own (SpeedGrader, then Submit for Student).
    var want = kinds.map(function (k) { return self.items[k].proxy; });
    var have = toArray(this.root.children);
    if (want.length !== have.length || want.some(function (p, i) { return have[i] !== p; })) {
      want.forEach(function (p) { self.root.appendChild(p); });
    }
    setAttr(this.root, 'data-count', String(kinds.length));
    return true;
  };

  AC.destroy = function () {
    var self = this;
    Object.keys(this.items).forEach(function (k) {
      var it = self.items[k];
      if (it.slot) it.slot.removeAttribute('data-cgp-tray-action-proxied');
    });
    this.items = {};
    if (this.root) this.root.remove();
    this.root = null;
  };

  /** Canvas's SpeedGrader link and Submit for Student button in the tray,
   * each with the block it sits in (what gets hidden). */
  function findActions(tray) {
    var out = {};
    var controls = toArray(tray.querySelectorAll('a, button, [role="button"]')).filter(function (c) {
      if (c.closest && c.closest('[data-cgp-tray-own], [data-cgp-tray-comment], [data-cgp-tray-status], ' + RCE_SELECTOR)) return false;
      return isShown(c, tray);
    });
    controls.forEach(function (c) {
      var kind = actionKind(c);
      if (!kind || out[kind]) return;
      out[kind] = { canvas: c, slot: slotFor(c, tray) };
    });
    // Both in one block: hiding that block would hide both, and our row
    // stands in for both, so that is fine - but the block must hold nothing
    // else that takes a click.
    ACTION_KINDS.forEach(function (k) {
      var f = out[k];
      if (!f) return;
      var mine = ACTION_KINDS.map(function (j) { return out[j] && out[j].canvas; }).filter(Boolean);
      var stray = toArray(f.slot.querySelectorAll('a, button, input, select, textarea, [role="button"]')).filter(function (el) {
        return !mine.some(function (m) { return m.contains(el); });
      });
      if (stray.length) f.slot = f.canvas;
    });
    return out;
  }

  var SPEEDGRADER_HREF = /speed_grader/i;
  var SPEEDGRADER_TEXT = /^\s*speed\s*grader\s*$/i;
  var SUBMIT_TEXT = /submit\s+for\s+student/i;

  function actionKind(c) {
    var testid = String(c.getAttribute('data-testid') || '').toLowerCase();
    var text = textOf(c).replace(/\s+/g, ' ').trim();
    if (/submit-for-student|submitforstudent|submit_for_student/.test(testid) || SUBMIT_TEXT.test(text)) return 'submit';
    if (/speed-?grader/.test(testid) || SPEEDGRADER_HREF.test(String(c.getAttribute('href') || '')) ||
        SPEEDGRADER_TEXT.test(text)) return 'speedgrader';
    return null;
  }

  /** The control's own block: climbs through wrappers that hold only it. */
  function slotFor(c, tray) {
    var slot = c;
    while (slot.parentElement && slot.parentElement !== tray && slot.parentElement.children.length === 1) {
      slot = slot.parentElement;
    }
    return slot;
  }

  /** Rendered by Canvas: not under a [hidden] or visibility: hidden. Our own
   * hiding (data-cgp-tray-action-proxied) does not count. */
  function isShown(el, tray) {
    var node = el;
    while (node && node !== tray) {
      if (node.getAttribute && node.getAttribute('hidden') !== null) return false;
      node = node.parentElement;
    }
    if (typeof getComputedStyle === 'function') {
      try {
        var cs = getComputedStyle(el);
        if (cs && cs.visibility === 'hidden') return false;
      } catch (e) { /* not an element the browser can style */ }
    }
    return true;
  }

  function signature(c) {
    if (typeof c.outerHTML === 'string') return c.outerHTML;
    return [textOf(c), c.getAttribute('href') || '', flag(c, 'disabled') ? 1 : 0].join('\u0001');
  }

  /** A copy of Canvas's control that presses Canvas's own. */
  function makeProxy(canvas, kind) {
    var proxy = canvas.cloneNode(true);
    stripIds(proxy);
    setAttr(proxy, 'data-cgp-tray-action', kind);
    proxy.addEventListener('click', function (e) {
      if (!canvas.isConnected) return;
      var isLink = String(proxy.tagName || '').toUpperCase() === 'A' && proxy.getAttribute('href') !== null;
      if (isLink) {
        // Let the browser follow the link (new tab with Ctrl/Cmd, and so
        // on) - to wherever Canvas's link points right now.
        var href = canvas.getAttribute('href');
        if (href !== null && proxy.getAttribute('href') !== href) proxy.setAttribute('href', href);
        return;
      }
      if (e && e.preventDefault) e.preventDefault();
      if (flag(canvas, 'disabled') || canvas.getAttribute('aria-disabled') === 'true') return;
      canvas.click();
    });
    return proxy;
  }

  function stripIds(el) {
    if (el.removeAttribute) {
      el.removeAttribute('id');
      el.removeAttribute('data-cgp-tray-action-proxied');
    }
    toArray(el.children).forEach(stripIds);
  }

  /* -------------------------------------------------- growing comment box */

  /* The comment editor starts at its usual short height and grows with what
   * is typed, until its bottom reaches the bottom of the window; from there
   * the text scrolls inside it (the RCE's own iframe, or the textarea). The
   * height is handed to the CSS as --cgp-tray-edit-h, since the stylesheet's
   * sizes are !important. Re-measured on every keystroke in the editor and on
   * the controller's tick (text put in some other way: a snippet, the box
   * emptied after Submit). */
  var EDIT_MIN = 104;      // px: the editor's resting height
  var EDIT_GAP = 16;       // px: kept free below it, above the window's edge
  var TEXTAREA_MIN = 56;

  function CommentGrow(opts) {
    // gap(): px to keep free below the editor (SpeedGrader keeps its
    // attach / record / Submit row in view under it).
    this.gapFn = opts && typeof opts.gap === 'function' ? opts.gap : null;
    this.editor = null;
    this.doc = null;     // the RCE iframe's document, while listened to
    this.height = '';
    var self = this;
    this.onInput = function () { self.update(); };
  }

  var CG = CommentGrow.prototype;

  CG.watch = function (editor) {
    if (editor !== this.editor) {
      this.release();
      this.editor = editor;
    }
    this.update();
  };

  CG.release = function () {
    if (this.doc) {
      try {
        ['input', 'keyup', 'paste', 'cut'].forEach(function (t) { this.doc.removeEventListener(t, this.onInput); }, this);
      } catch (e) { /* the iframe is gone */ }
    }
    if (this.editor && this.editor.style && typeof this.editor.style.removeProperty === 'function') {
      this.editor.style.removeProperty('--cgp-tray-edit-h');
    }
    this.doc = null;
    this.height = '';
  };

  CG.destroy = function () {
    this.release();
    this.editor = null;
  };

  CG.update = function () {
    var ed = this.editor;
    if (!ed || !ed.isConnected) return;
    var target = this.measure(ed);
    if (target === null) return;
    var value = target + 'px';
    if (value === this.height) return;
    this.height = value;
    if (ed.style && typeof ed.style.setProperty === 'function') ed.style.setProperty('--cgp-tray-edit-h', value);
  };

  /** The height the editing area should have now, or null when it cannot be
   * told (the RCE still loading). */
  CG.measure = function (ed) {
    var winH = typeof window !== 'undefined' && window.innerHeight;
    var gap = EDIT_GAP;
    if (this.gapFn) { try { gap = Math.max(EDIT_GAP, Number(this.gapFn()) || 0); } catch (e) { gap = EDIT_GAP; } }
    if (ed.tagName === 'TEXTAREA') {
      var top = ed.getBoundingClientRect().top;
      var max = winH ? Math.floor(winH - top - gap) : Infinity;
      // Measured at its natural height: 'auto' lets it shrink back again.
      ed.style.setProperty('--cgp-tray-edit-h', 'auto');
      this.height = '';
      var want = (ed.scrollHeight || 0) + 2;
      return Math.max(TEXTAREA_MIN, Math.min(want, max));
    }
    var area = ed.querySelector('.tox-edit-area');
    var frame = area && area.querySelector('iframe');
    if (!area || !frame) return null;
    var doc = null;
    try { doc = frame.contentDocument; } catch (e) { doc = null; }
    if (!doc || !doc.body) return null;
    if (doc !== this.doc) {
      this.doc = doc;
      ['input', 'keyup', 'paste', 'cut'].forEach(function (t) { doc.addEventListener(t, this.onInput); }, this);
    }
    var areaTop = area.getBoundingClientRect().top;
    var limit = winH ? Math.floor(winH - areaTop - gap) : Infinity;
    var content = contentHeight(doc);
    return Math.max(EDIT_MIN, Math.min(content, limit));
  };

  /** How tall the RCE's content is: the bottom of its last real block
   * (TinyMCE's bogus and off-screen helpers skipped), plus the body's own
   * bottom padding and margin. */
  function contentHeight(doc) {
    var body = doc.body;
    var win = doc.defaultView;
    var style = function (el) {
      try { return win.getComputedStyle(el); } catch (e) { return {}; }
    };
    var scrollY = (win && win.pageYOffset) || (doc.documentElement && doc.documentElement.scrollTop) || 0;
    var last = body.lastElementChild;
    while (last) {
      var ls = style(last);
      if (!last.hasAttribute('data-mce-bogus') && ls.position !== 'absolute' && ls.position !== 'fixed') break;
      last = last.previousElementSibling;
    }
    var bottom;
    if (last) bottom = last.getBoundingClientRect().bottom + scrollY + (parseFloat(style(last).marginBottom) || 0);
    else bottom = body.getBoundingClientRect().top + scrollY;
    var bs = style(body);
    return Math.ceil(bottom + (parseFloat(bs.paddingBottom) || 0) + (parseFloat(bs.marginBottom) || 0));
  }

  /* --------------------------------------------------------------- helpers */

  function trayFor(el) {
    return (el.closest && el.closest('[role="dialog"]')) || null;
  }

  function commonAncestor(els) {
    if (!els.length) return null;
    var anc = els[0].parentElement;
    while (anc) {
      var all = true;
      for (var i = 1; i < els.length; i++) {
        if (!anc.contains(els[i])) { all = false; break; }
      }
      if (all) return anc;
      anc = anc.parentElement;
    }
    return null;
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function toArray(list) { return Array.prototype.slice.call(list || []); }

  CGP.TrayLayoutController = TrayLayoutController;
  // Shared with SpeedGrader's comment box (speedgrader/comment-layout.js),
  // which gets the same editor treatment.
  CGP.trayCommentParts = {
    RCE_SELECTOR: RCE_SELECTOR,
    outermostRce: outermostRce,
    tagStatusBar: tagStatusBar,
    tagWordCount: tagWordCount,
    CommentGrow: CommentGrow
  };
})();
