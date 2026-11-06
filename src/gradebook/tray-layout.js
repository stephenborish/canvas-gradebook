/* Canvas Gradebook+ - a tidier Grade Detail Tray.
 *
 * Canvas's tray stacks its Status radios (None / Late / Missing / Excused,
 * plus any custom statuses) one per row, each a full-width band, and puts the
 * comment box's Cancel / Submit buttons BELOW a tall editor - so the Status
 * section eats half the tray and a typed comment's Submit is off the bottom
 * of the screen. With `trayLayout` on:
 *
 *  - the Status options sit side by side as one row of pills (wrapping onto a
 *    second row only when there are too many to fit), each pill a single
 *    click target; the checked one is outlined. When Late is picked and its
 *    "days late" box appears, that pill takes the whole row so the box fits.
 *  - the comment form's buttons move ABOVE the editor as a slim toolbar
 *    joined to its top edge (a quiet Cancel, a compact blue Submit), the
 *    editor is made shorter, and the RCE's word count is hidden, so the box
 *    stays in view and an added comment is easy to spot.
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
      // Once found, the word count is not searched for again.
      if (editor.tagName !== 'TEXTAREA' && !editor.querySelector('[data-cgp-tray-hide]')) tagWordCount(editor);
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
