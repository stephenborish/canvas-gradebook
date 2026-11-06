/* Canvas Gradebook+ - a tidier Grade Detail Tray.
 *
 * Canvas's tray stacks its Status radios (None / Late / Missing / Excused,
 * plus any custom statuses) one per row, each a full-width band, and puts the
 * comment box's Cancel / Submit buttons BELOW a tall editor - so the Status
 * section eats half the tray and a typed comment's Submit is off the bottom
 * of the screen. With `trayLayout` on:
 *
 *  - the Status options sit side by side as one row of equal pills - a
 *    segmented control - each pill a single click target, tinted in its
 *    status colour (Canvas's own, darkened into an accent) once checked.
 *    Late's "days late" box, which Canvas puts inside the Late option, is
 *    shown as a strip UNDER the row, so the four pills stay on one line.
 *  - the comment box is one card: its Cancel / Submit as a slim bar on top,
 *    a single compact row of formatting buttons (the "more" drawer opens as
 *    one row too), a shorter editing area, and no status bar under it (the
 *    element path, word count and accessibility checker button).
 *
 * Nothing is moved in the DOM: the tray is React's, and moving its nodes
 * would break its next render. Elements are only tagged with data-cgp-tray-*
 * attributes (never classes: React rewrites className whenever Canvas
 * toggles one of its own, e.g. on the checked radio) and the CSS keyed off
 * those attributes and html.cgp-tray-tidy does the rest - a flex row for the
 * statuses, `order: -1` for the buttons. Turning the setting off drops the
 * root class, which puts the tray back exactly as Canvas draws it.
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

  function TrayLayoutController(ctx) {
    var self = this;
    this.settings = ctx.settings;
    this.observer = null;
    this.tray = null;   // the tray dialog last seen, while it is on the page
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
    if (on) this.observe(); else this.disconnect();
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
    if (this.tray && !this.tray.isConnected) this.tray = null;
    var radios = toArray((this.tray || document).querySelectorAll(RADIO_SELECTOR));
    if (radios.length < 2) return false;
    tagStatuses(radios);
    // Comment forms are only looked for inside the tray itself: falling back
    // to the whole page would restyle any other textarea + buttons on it
    // (the gradebook's own comment popover, say).
    this.tray = trayFor(radios[0]);
    if (this.tray) tagCommentForms(this.tray);
    return true;
  };

  /* ------------------------------------------------------------- statuses */

  function tagStatuses(radios) {
    // The band Canvas paints (its status colour) around each radio.
    var pills = radios.map(function (r) {
      return (r.closest && r.closest('.SubmissionTray__RadioInput')) || r;
    });
    pills.forEach(function (pill, n) {
      if (pill.tagName === 'INPUT') return;
      setAttr(pill, 'data-cgp-tray-value', String(radios[n].value || radios[n].getAttribute('value') || '').toLowerCase());
      paintAccent(pill);
      // Late's "days late" box: the part of the option holding a field
      // other than the radio.
      toArray(pill.children).forEach(function (child) {
        var field = toArray(child.querySelectorAll('input')).filter(function (i) {
          var t = (i.getAttribute('type') || 'text').toLowerCase();
          return t !== 'radio' && t !== 'hidden';
        })[0];
        if (field && !child.contains(radios[n])) setAttr(child, 'data-cgp-tray-days', '');
      });
    });
    var row = commonAncestor(pills);
    if (!row) return;
    setAttr(row, 'data-cgp-tray-status', '');
    toArray(row.children).forEach(function (child) {
      var pill = null;
      for (var i = 0; i < pills.length; i++) {
        if (child.contains(pills[i])) { pill = pills[i]; break; }
      }
      if (!pill) return;
      setAttr(child, 'data-cgp-tray-opt', '');
      // When the radio itself is all there is, the column it sits in is the pill.
      setAttr(pill.tagName === 'INPUT' ? child : pill, 'data-cgp-tray-pill', '');
    });
  }

  /* Canvas paints each status option in its status colour - pale tints
   * (late blue, missing red, excused yellow, or the teacher's own choices).
   * The same hue, darkened into a readable accent, becomes the pill's
   * --cgp-tray-accent: its underline, and its border and text once checked.
   * A custom property is the one thing set in a style: React only rewrites
   * the style properties it manages, so this survives its renders. */
  function paintAccent(pill) {
    var bg = (pill.style && pill.style.backgroundColor) || '';
    if (pill.getAttribute('data-cgp-tray-bg') === bg) return;
    setAttr(pill, 'data-cgp-tray-bg', bg);
    var accent = accentFor(bg);
    if (!pill.style || typeof pill.style.setProperty !== 'function') return;
    if (accent) pill.style.setProperty('--cgp-tray-accent', accent);
    else if (pill.style.removeProperty) pill.style.removeProperty('--cgp-tray-accent');
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
      // count (found once, then not searched for again).
      if (!tagStatusBar(editor) && !editor.querySelector('[data-cgp-tray-hide]')) tagWordCount(editor);
    });
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
})();
