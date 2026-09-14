/* Canvas Gradebook+ - compact layout.
 *
 * Three jobs:
 *  1. Collapse Canvas's utility strip (searches, filters, Import/Export/Sync/
 *     View Options). Hiding the buttons is not enough: their wrappers are
 *     collapsed too, but only when nothing visible is left inside them.
 *  2. Give the grid the rest of the viewport.
 *  3. Narrow the assignment columns. Column geometry in a SlickGrid comes from a
 *     generated stylesheet, so widths are changed through Canvas's own resize
 *     handles (which also persists them) rather than by fighting that CSS. If
 *     the first resize does not take, the whole feature stands down instead of
 *     leaving a half-resized grid. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CompactLayoutController) return;

  var CONTROL_SELECTORS = [
    '#gradebook-actions',
    '.gradebook-menus',
    '.gradebook_menu',
    '[data-component="EnhancedActionMenu"]',
    '[data-component="ActionMenu"]',
    '[data-component="ViewOptionsMenu"]',
    '[data-testid="view-options-menu"]',
    '[data-testid="enhanced-actions-menu"]',
    '[data-testid="apply-filters-button"]',
    '[data-testid="gradebook-student-filter"]',
    '[data-testid="gradebook-assignment-filter"]',
    '#gradebook-student-search',
    '#gradebook-assignment-search',
    '.gradebook-filter-container',
    '.enhanced-gradebook-filters',
    '.gradebook_filters',
    '#gradebook_filters',
    '.Gradebook__FilterRow',
    '.gradebook-filters'
  ];

  var SEARCH_SELECTORS = [
    'input[placeholder*="Student Names" i]',
    'input[placeholder*="Assignment Names" i]',
    'input[aria-label*="Student Names" i]',
    'input[aria-label*="Assignment Names" i]',
    'input[placeholder*="Search Students" i]',
    'input[placeholder*="Search Assignments" i]'
  ];

  var BUTTON_LABELS = [
    'import', 'export', 'sync', 'sync to sis', 'view options', 'apply filters',
    'actions', 'export current gradebook view'
  ];

  // Canvas's own gradebook-settings gear. Deliberately kept OUT of
  // CONTROL_SELECTORS/BUTTON_LABELS above (it used to be hidden along with
  // everything else in the utility strip): a teacher needs this control
  // often enough - column sorting, arrangement, late/missing policies - that
  // it should stay reachable regardless of the "collapse Canvas's utility
  // strip" setting. candidates() below uses this only to find the real
  // button so it (and any wrapper that would take it down too) is never a
  // hide candidate - Canvas's own gear stays exactly where Canvas put it.
  var SETTINGS_SELECTORS = [
    '#gradebook_settings_modal_button',
    '#gradebook-settings',
    '[data-testid="gradebook-settings-button"]',
    '[data-component="GradebookSettingsButton"]',
    'button[aria-label*="gradebook settings" i]',
    'button[title*="gradebook settings" i]'
  ];

  // Used only to find Apply Filters as an anchor for alignSettingsGear() -
  // Canvas's own button, never touched or moved.
  var APPLY_FILTERS_SELECTORS = [
    '[data-testid="apply-filters-button"]',
    'button[aria-label*="apply filters" i]'
  ];

  // Canvas's own "keyboard shortcuts" icon button. These selectors only catch
  // the accessible name when Canvas exposes it as an aria-label/title
  // attribute on the button itself - findKeyboardShortcutsButton() below adds
  // a text-scan fallback for builds that instead put it in a visually-hidden
  // child node (an INSTUI IconButton screen-reader-only span), which no CSS
  // attribute selector can reach.
  var KEYBOARD_SHORTCUTS_SELECTORS = [
    '[data-testid="keyboard-shortcuts-button"]',
    'button[aria-label*="keyboard shortcut" i]',
    'button[title*="keyboard shortcut" i]',
    'a[aria-label*="keyboard shortcut" i]'
  ];

  function CompactLayoutController(ctx) {
    this.adapter = ctx.adapter;
    this.settings = ctx.settings;
    this.hidden = [];
    this._resizeStoodDown = false;
    this._lastHidePass = 0;
    this.controlsHidden = false;
    this.applyGeometry = CGP.util.debounce(this._applyGeometry.bind(this), 120);
    this._gridTop = null;
    this._gridHeight = null;
    this._selfResize = false;
  }

  var P = CompactLayoutController.prototype;

  P.start = function () {
    var s = this.settings.values;
    var root = document.documentElement;
    root.classList.add('cgp-on');
    root.classList.toggle('cgp-narrow', !!s.narrowColumns);
    root.classList.toggle('cgp-center', !!s.centerAssignmentColumns);
    root.classList.toggle('cgp-max-height', !!s.maximizeHeight);
    // Never hide Canvas's tray arrow unless double-click-to-open is there to
    // replace it; otherwise the action would have no way in at all.
    root.classList.toggle('cgp-hide-arrow', !!(s.hideGradeCellArrow && s.doubleClickOpensTray));
    root.style.setProperty('--cgp-student-w', s.studentColumnWidth + 'px');
    root.style.setProperty('--cgp-assignment-w', s.assignmentColumnWidth + 'px');
    root.style.setProperty('--cgp-grade-font', s.gradeFontSize + 'px');
    var headerH = (s.narrowColumns ? 72 : 48) + (s.showAssignmentDueDate ? 14 : 0);
    root.style.setProperty('--cgp-header-h', headerH + 'px');

    if (s.hideCanvasUtilityControls) this.hideControls();
    // Unconditional, like the utility-strip gear protection above: a teacher
    // wants the settings gear next to Apply Filters regardless of whether
    // the rest of the utility strip is being collapsed.
    this.alignSettingsGear();
    this.hideKeyboardShortcutsButton();
    this.settleQuickly();
    this.applyGeometry();
    this.bindShortcut();
    if (!this._resizeBound) {
      this._resizeBound = this.onWindowResize.bind(this);
      window.addEventListener('resize', this._resizeBound);
    }
  };

  P.bindShortcut = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      // Alt+Shift+H: bring Canvas's utility controls back for one page visit.
      if (e.altKey && e.shiftKey && String(e.key).toLowerCase() === 'h') {
        e.preventDefault();
        self.toggleControls();
      }
    }, true);
  };

  P.toggleControls = function () {
    if (this.controlsHidden) {
      this.restoreControls();
      CGP.ui.toast('Canvas gradebook controls shown');
    } else {
      this.hideControls();
      CGP.ui.toast('Canvas gradebook controls hidden');
    }
    this.applyGeometry();
  };

  P.restoreControls = function () {
    this.hidden.forEach(function (el) {
      el.classList.remove('cgp-hidden');
      el.classList.remove('cgp-collapsed');
    });
    this.hidden = [];
    this.controlsHidden = false;
  };

  P.candidates = function () {
    var found = [];
    // Resolved fresh, once per call: Canvas's real settings gear is never
    // hidden (a teacher needs it too often - column sorting, arrangement,
    // late/missing policies - to bury it behind Alt+Shift+H), so it can
    // still be sitting inside one of the whole-container CONTROL_SELECTORS
    // entries below (#gradebook-actions and friends). Collapsing that
    // container with display:none would take the real button down with it,
    // so a container holding it is never a hide candidate here.
    var realGear = this.findSettingsButton();
    var push = function (el) {
      if (el && realGear && el.contains(realGear)) return;
      if (el && found.indexOf(el) < 0) found.push(el);
    };

    CONTROL_SELECTORS.forEach(function (sel) {
      Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(push);
    });
    SEARCH_SELECTORS.forEach(function (sel) {
      Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(function (input) {
        // hide the labelled field wrapper, not just the bare input
        var wrap = input.closest('span[class*="TextInput"], div[class*="TextInput"], .ic-Form-control') || input;
        push(wrap);
      });
    });
    Array.prototype.slice.call(document.querySelectorAll('#content button, #content [role="button"]')).forEach(function (btn) {
      if (btn.closest('.slick-header') || btn.closest('.grid-canvas') || btn.closest('#breadcrumbs')) return;
      if (btn.closest('.cgp-course-menu') || btn.classList.contains('cgp-crumb-toggle')) return;
      if (btn.classList.contains('cgp-find-student')) return;
      var label = ((btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '') + ' ' +
        (btn.getAttribute('title') || '')).trim().toLowerCase().replace(/\s+/g, ' ');
      if (!label) return;
      for (var i = 0; i < BUTTON_LABELS.length; i++) {
        if (label === BUTTON_LABELS[i] || label.indexOf(BUTTON_LABELS[i]) === 0) { push(btn); return; }
      }
    });
    return found;
  };

  /* Find Canvas's own gradebook-settings gear, wherever this Canvas build
   * currently renders it. Used only so candidates() can protect whatever
   * container holds it (see candidates() above) - the button itself is
   * never touched or moved. */
  P.findSettingsButton = function () {
    for (var i = 0; i < SETTINGS_SELECTORS.length; i++) {
      var el = document.querySelector(SETTINGS_SELECTORS[i]);
      if (el) return el.closest('button, [role="button"]') || el;
    }
    // Fallback: anything actually labelled "settings" inside the gradebook's
    // own action area, in case this Canvas build uses none of the ids/test
    // ids above.
    var area = document.querySelectorAll(
      '#gradebook-actions button, .gradebook-menus button, [data-component="EnhancedActionMenu"] button');
    for (var j = 0; j < area.length; j++) {
      var candidate = area[j];
      var label = ((candidate.getAttribute('aria-label') || '') + ' ' +
        (candidate.getAttribute('title') || '') + ' ' + (candidate.textContent || '')).toLowerCase();
      if (label.indexOf('settings') >= 0) return candidate;
    }
    return null;
  };

  /* Find Canvas's own Apply Filters button. Used only as an anchor point for
   * alignSettingsGear() below - never touched or moved. */
  P.findApplyFiltersButton = function () {
    for (var i = 0; i < APPLY_FILTERS_SELECTORS.length; i++) {
      var el = document.querySelector(APPLY_FILTERS_SELECTORS[i]);
      if (el) return el;
    }
    var buttons = document.querySelectorAll('#content button, #content [role="button"]');
    for (var j = 0; j < buttons.length; j++) {
      if ((buttons[j].textContent || '').trim().toLowerCase() === 'apply filters') return buttons[j];
    }
    return null;
  };

  /* Find Canvas's own "keyboard shortcuts" icon button, wherever this Canvas
   * build renders it and however it exposes its accessible name. The CSS
   * attribute selectors in KEYBOARD_SHORTCUTS_SELECTORS only match a build
   * that sets aria-label/title on the button itself; some builds instead put
   * the name in a visually-hidden child span (same pattern as
   * findSettingsButton()'s fallback below), so this scans by combined
   * textContent/aria-label/title the same way candidates() matches
   * BUTTON_LABELS. */
  P.findKeyboardShortcutsButton = function () {
    for (var i = 0; i < KEYBOARD_SHORTCUTS_SELECTORS.length; i++) {
      var el = document.querySelector(KEYBOARD_SHORTCUTS_SELECTORS[i]);
      if (el) return el.closest('button, [role="button"], a') || el;
    }
    var area = document.querySelectorAll(
      '#gradebook-actions button, #gradebook-actions a, .gradebook-menus button, ' +
      '[data-component="EnhancedActionMenu"] button, [data-component="EnhancedActionMenu"] a');
    for (var j = 0; j < area.length; j++) {
      var candidate = area[j];
      var label = ((candidate.getAttribute('aria-label') || '') + ' ' +
        (candidate.getAttribute('title') || '') + ' ' + (candidate.textContent || '')).toLowerCase();
      if (label.indexOf('keyboard shortcut') >= 0) return candidate;
    }
    return null;
  };

  /* Unconditional, like alignSettingsGear() - there is no setting for this
   * one and Alt+Shift+H does not bring it back. The CSS rule in
   * gradebook.css already hides it the instant it matches, with no JS
   * involved; this only covers the builds that CSS attribute selectors can't
   * reach (see findKeyboardShortcutsButton() above). Re-resolved on every
   * call since Canvas can re-render the button with a fresh DOM node at any
   * point while the gradebook is open. */
  P.hideKeyboardShortcutsButton = function () {
    var btn = this.findKeyboardShortcutsButton();
    if (btn && btn.isConnected) btn.classList.add('cgp-hidden');
  };

  /* Put Canvas's own settings gear on the same visual line as Apply Filters.
   *
   * The gear is never moved, cloned, or reparented - only its on-screen
   * POSITION changes, via position:fixed computed from Apply Filters' own
   * rect. Canvas's React tree never learns anything moved, so the gear's own
   * click handler (bound by React's event delegation against the real DOM
   * tree, not screen position) keeps working. An earlier version of this
   * feature instead relocated the real button's DOM node out to <body>, which
   * broke exactly that: React's delegated listener stopped seeing the click
   * bubble through the tree it expected. A separate, later version built a
   * lookalike proxy button beside Apply Filters that forwarded clicks to the
   * real one - workable, but left two gear icons on screen since Canvas's
   * real gear was never actually hidden. Repositioning the real button
   * avoids both problems.
   *
   * Re-resolved and reapplied on every call, since Canvas can re-render
   * either button - handing it a fresh DOM node with none of our inline
   * styles - at any point while the gradebook is open. */
  P.alignSettingsGear = function () {
    var gear = this.findSettingsButton();
    if (!gear || !gear.isConnected) return;
    var anchor = this.findApplyFiltersButton();
    if (!anchor || !anchor.isConnected || anchor === gear) { this.resetGearPosition(gear); return; }
    var rect = anchor.getBoundingClientRect();
    if (!rect.width && !rect.height) { this.resetGearPosition(gear); return; } // anchor not laid out yet/hidden
    // Prefer to the right of Apply Filters, but a narrow or zoomed viewport
    // can leave too little room there - falling back to fixed positioning
    // unconditionally would push the gear off-screen and unreachable. Use
    // the gear's own current size (position:fixed does not affect it) to
    // check, and put it on the left instead when the right does not fit.
    var margin = 8;
    var gearWidth = gear.getBoundingClientRect().width || 32;
    var left = rect.right + margin;
    if (left + gearWidth > window.innerWidth) {
      left = Math.max(margin, rect.left - gearWidth - margin);
    }
    gear.classList.add('cgp-gear-aligned');
    gear.style.position = 'fixed';
    gear.style.left = Math.round(left) + 'px';
    gear.style.top = Math.round(rect.top + rect.height / 2) + 'px';
    gear.style.transform = 'translateY(-50%)';
    gear.style.zIndex = '2147483000';
  };

  /* Undo alignSettingsGear()'s inline styles so the gear falls back to
   * wherever Canvas naturally laid it out - used when Apply Filters is not
   * currently on screen to align against (e.g. hidden by the "collapse
   * Canvas's utility strip" setting). */
  P.resetGearPosition = function (gear) {
    if (!gear || !gear.classList.contains('cgp-gear-aligned')) return;
    gear.classList.remove('cgp-gear-aligned');
    gear.style.position = '';
    gear.style.left = '';
    gear.style.top = '';
    gear.style.transform = '';
    gear.style.zIndex = '';
  };

  /* Right after boot, Apply Filters and the settings gear are frequently not
   * laid out yet - Canvas renders the gradebook toolbar asynchronously - so
   * the alignSettingsGear() call in start() often lands before anchor has a
   * real rect and falls back to the gear's natural (unaligned) position.
   * Without this, the only thing left to retry it is content.js's 1500ms
   * safety tick, which reads to a teacher as the gear sitting visibly
   * misaligned for up to a second and a half after the page looks done
   * loading. Polling fast for a few seconds right after start (and stopping
   * as soon as both this and the keyboard-shortcuts hide have taken, or the
   * budget runs out) gets it visually correct within a tenth of a second in
   * the common case instead, without leaving a fast interval running for the
   * life of the page. */
  P.settleQuickly = function () {
    if (this._settling) return;
    this._settling = true;
    var self = this;
    var attempts = 0;
    var tick = function () {
      self.alignSettingsGear();
      self.hideKeyboardShortcutsButton();
      attempts++;
      var gear = self.findSettingsButton();
      // A control that has not mounted yet is NOT settled - Canvas can still
      // render it on a later tick, and start() runs before content.js's own
      // grid-readiness wait, so "not found" on an early tick usually means
      // "not there yet", not "never coming". Only an affirmative aligned/
      // hidden state - or the deliberate-utility-collapse case below, where
      // the gear provably never gets a real anchor to align against - counts
      // as settled; everything else keeps polling until the budget runs out.
      var gearSettled = (gear && gear.isConnected && gear.classList.contains('cgp-gear-aligned')) ||
        self.controlsHidden;
      var kbdBtn = self.findKeyboardShortcutsButton();
      var kbdSettled = !!(kbdBtn && kbdBtn.classList.contains('cgp-hidden'));
      if ((gearSettled && kbdSettled) || attempts >= 30) { self._settling = false; return; }
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  };

  P.hideControls = function () {
    var now = Date.now();
    if (now - this._lastHidePass < 400) return;
    this._lastHidePass = now;

    var self = this;
    var targets = this.candidates();
    targets.forEach(function (el) {
      if (el.classList.contains('cgp-hidden')) return;
      el.classList.add('cgp-hidden');
      self.hidden.push(el);
    });
    if (targets.length) this.collapseEmptyWrappers(targets);
    this.controlsHidden = true;
    CGP.diag.set('canvasControlsHidden', this.hidden.length);
  };

  P.isProtected = function (el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.id === 'content' || el.id === 'main' || el.id === 'application' || el.id === 'wrapper') return true;
    if (el.id === 'breadcrumbs' || el.closest('#breadcrumbs') === el) return true;
    if (el.querySelector('.slick-header, .grid-canvas, #gradebook_grid')) return true;
    if (el.querySelector('select')) return true;                     // gradebook selector
    if (el.classList.contains('cgp-total-header')) return true;
    return false;
  };

  P.hasVisibleSubstance = function (el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) {
        if (String(node.nodeValue || '').trim() !== '') {
          var parent = node.parentElement;
          if (parent && !parent.closest('.cgp-hidden, .cgp-collapsed')) return true;
        }
      } else if (node.nodeType === 1) {
        if (node.classList.contains('cgp-hidden') || node.classList.contains('cgp-collapsed')) {
          // skip the hidden subtree entirely
          var skip = node;
          node = walker.nextNode();
          while (node && skip.contains(node)) node = walker.nextNode();
          continue;
        }
        var tag = node.tagName.toLowerCase();
        if (['input', 'select', 'textarea', 'button', 'img', 'svg', 'canvas', 'table', 'a'].indexOf(tag) >= 0) return true;
      }
      node = walker.nextNode();
    }
    return false;
  };

  /* Walk up from each hidden control and collapse wrappers that now hold nothing. */
  P.collapseEmptyWrappers = function (targets) {
    var self = this;
    targets.forEach(function (el) {
      var node = el.parentElement;
      for (var depth = 0; depth < 5 && node; depth++) {
        if (self.isProtected(node)) break;
        if (node.classList.contains('cgp-collapsed')) { node = node.parentElement; continue; }
        if (self.hasVisibleSubstance(node)) break;
        var rect = node.getBoundingClientRect();
        if (rect.height >= 4) {
          node.classList.add('cgp-collapsed');
          self.hidden.push(node);
          CGP.diag.bump('layout.wrappersCollapsed');
        }
        node = node.parentElement;
      }
    });
  };

  /* A wrapper collapsed above only because it looked EMPTY at that moment -
   * never one of the deliberate, direct cgp-hidden matches - can be wrong:
   * Canvas can still be about to render real content into it asynchronously
   * (a lazy-loaded filter panel, say), and nothing before this ever
   * reconsidered a wrapper once collapsed. That made a false-positive
   * permanent - hiding a control the teacher genuinely needs for the rest of
   * the page's life, recoverable only via Alt+Shift+H or turning the whole
   * setting off, neither of which a teacher has any reason to try for this.
   * Cheap to run periodically (see content.js's safety tick): only wrappers
   * already in `hidden` are ever considered, and un-collapsing one that
   * really does have content now is always correct regardless of why it
   * looked empty before. */
  P.recheckCollapsedWrappers = function () {
    var self = this;
    var recovered = 0;
    this.hidden.forEach(function (el) {
      if (!el || !el.isConnected || !el.classList.contains('cgp-collapsed')) return;
      if (self.hasVisibleSubstance(el)) {
        el.classList.remove('cgp-collapsed');
        recovered++;
      }
    });
    if (recovered) CGP.diag.bump('layout.wrappersRecovered', recovered);
  };

  /* Where the grid starts, and therefore how tall it is allowed to be.
   *
   * Both numbers are published as whole pixels and, crucially, only when they
   * have actually CHANGED. Two things depended on that and neither was true
   * before:
   *
   *  1. Nudging Canvas with a synthetic window resize re-entered this method
   *     (it is itself bound to window resize), which nudged again, ~180ms
   *     apart, forever. Every nudge makes SlickGrid recompute its viewport and
   *     re-render, and the row on the boundary of the rendered range - the
   *     LAST row on screen - is the one that gets added and removed each time.
   *     That is exactly the "the last student blinks" behaviour: a feedback
   *     loop, not a rendering quirk of that student's row.
   *  2. The height was a CSS calc() against 100vh, so it landed on fractional
   *     pixels; SlickGrid's "how many rows fit" arithmetic sat right on the
   *     boundary and flipped the same last row in and out. Rounding down to a
   *     whole pixel here settles it. */
  P._applyGeometry = function () {
    var grid = document.querySelector('#gradebook_grid') || this.adapter.gridRoot();
    if (!grid) return;
    var top = Math.round(grid.getBoundingClientRect().top + window.scrollY);
    if (!isFinite(top) || top < 0) return;
    var height = Math.max(340, Math.floor(window.innerHeight - top - 10));
    if (top === this._gridTop && height === this._gridHeight) return;
    this._gridTop = top;
    this._gridHeight = height;
    var root = document.documentElement;
    root.style.setProperty('--cgp-grid-top', top + 'px');
    root.style.setProperty('--cgp-grid-h', height + 'px');
    CGP.diag.set('gridTop', top);
    CGP.diag.set('gridHeight', height);
    this.nudgeCanvasResize();
  };

  /* Canvas recomputes its own viewport heights on resize; ask it to.
   *
   * The flag is not just a throttle: this controller listens for window
   * resize itself, so without ignoring the event it is about to fire, the
   * nudge would answer its own nudge indefinitely. */
  P.nudgeCanvasResize = function () {
    if (this._nudging) return;
    this._nudging = true;
    var self = this;
    setTimeout(function () {
      self._selfResize = true;
      try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
      setTimeout(function () { self._selfResize = false; self._nudging = false; }, 250);
    }, 60);
  };

  P.onWindowResize = function () {
    if (this._selfResize) return;   // our own nudge, not the window actually changing
    this.applyGeometry();
    this.alignSettingsGear();
  };

  /* ------------------------------------------------------- column narrowing */

  P.resizeColumns = function () {
    var s = this.settings.values;
    if (!s.narrowColumns || this._resizeStoodDown || this._resizing) return Promise.resolve();
    var self = this;
    var headers = this.adapter.refreshColumns();
    var work = [];
    headers.forEach(function (h) {
      if (!h.el || !h.el.isConnected) return;
      var want = h.type === 'assignment' ? s.assignmentColumnWidth
        : (h.type === 'student' ? s.studentColumnWidth : null);
      if (want === null) return;
      var have = Math.round(h.el.getBoundingClientRect().width);
      if (!have) return;
      if (Math.abs(have - want) > 6) work.push({ el: h.el, want: want, have: have, type: h.type });
    });
    if (!work.length) return Promise.resolve();

    this._resizing = true;
    var seq = Promise.resolve();
    var applied = 0;
    work.slice(0, 40).forEach(function (item, i) {
      seq = seq.then(function () {
        return self.dragResize(item).then(function (ok) {
          if (ok) { applied++; return; }
          if (i === 0 && applied === 0) {
            self._resizeStoodDown = true;
            CGP.diag.warn('layout.columnResizeUnavailable', { type: item.type });
            throw new Error('resize-unavailable');
          }
          // The drag missed its target width. This batch can take seconds to
          // work through every column, so by the time a later column's turn
          // comes its width may already have moved on from what was measured
          // when the batch was planned - and dragResize computes its distance
          // from that same measurement. Driving the handle the wrong distance
          // is exactly how a column ends up jammed against SlickGrid's own
          // minimum width instead of ours: too narrow to read anything in.
          // One corrective pass, re-measured fresh right now, fixes that
          // instead of leaving the column at whatever width the miss landed
          // on.
          return self.dragResize(item).then(function (ok2) {
            if (ok2) { applied++; return; }
            CGP.diag.warn('layout.columnResizeMissed', { type: item.type, want: item.want });
            // Two attempts at the target width both missed. This is Canvas's
            // OWN real resize handle, so whatever odd width the failed drags
            // left behind is not just a cosmetic glitch - Canvas persists it
            // exactly as if the teacher had dragged it there themselves,
            // including on their next login. Leaving it there with nothing
            // but a diagnostics-only trace is worse than trying to put it
            // back: drag it toward its ORIGINAL width instead, and only if
            // that also fails, say so where the teacher can actually see it.
            return self.dragResize({ el: item.el, want: item.have, type: item.type }).then(function (reverted) {
              if (reverted) return;
              if (self._resizeMissedNotified) return;
              self._resizeMissedNotified = true;
              CGP.ui.error('Gradebook+ couldn’t resize one or more columns to fit. ' +
                'Check their widths in Canvas if they look off.');
            });
          });
        });
      });
    });
    return seq.catch(function () { return null; }).then(function () {
      self._resizing = false;
      CGP.diag.bump('layout.columnsResized', applied);
      self.applyGeometry();
    });
  };

  P.dragResize = function (item) {
    var handle = item.el.querySelector('.slick-resizable-handle');
    if (!handle) return Promise.resolve(false);
    var rect = item.el.getBoundingClientRect();
    // Measured now, not whenever this resize batch was planned - the column
    // may have already been dragged once (a corrective retry) or the batch
    // may simply have reached it seconds after `item.have` was snapshotted.
    // Computing the distance to travel from a width that no longer matches
    // reality is what drives the handle too far and jams the column against
    // SlickGrid's own minimum width.
    var have = Math.round(rect.width);
    var y = Math.round(rect.top + rect.height / 2);
    var startX = Math.round(rect.right - 1);
    var delta = item.want - have;
    if (!delta) return Promise.resolve(true);
    var step = delta > 0 ? 3 : -3;

    function fire(node, type, x) {
      node.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1
      }));
    }

    fire(handle, 'mousedown', startX);
    return CGP.util.sleep(16).then(function () {
      fire(document, 'mousemove', startX + step);            // clear the drag threshold
      fire(document, 'mousemove', startX + delta);
      return CGP.util.sleep(16);
    }).then(function () {
      fire(document, 'mouseup', startX + delta);
      return CGP.util.sleep(50);
    }).then(function () {
      var now = Math.round(item.el.getBoundingClientRect().width);
      return Math.abs(now - item.want) <= 12;
    }, function () { return false; });
  };

  /* Render one clean, non-interactive label over Canvas's assignment header.
   * Canvas's own title/points elements use several positioning systems across
   * Gradebook variants; squeezing them into narrow columns caused the overlap
   * shown in the user's screenshot. We leave Canvas's header cell/events intact
   * but visually replace only its text with a stable title + points (+ due
   * date, when enabled) stack. Interactive elements Canvas renders in the same
   * cell (its column options/"..." menu trigger) are left alone entirely -
   * see the CSS for exactly what stays visible - so they still work on hover.
   * The CSS hides every native descendant of the header cell and re-shows only
   * this label plus real interactive controls (by tag/role, at any nesting
   * depth) - not "whichever wrapper happens to contain a button" - because
   * Canvas sometimes puts its title text and its menu button inside the same
   * wrapper, and the older, coarser rule was un-hiding both together. */
  P.decorateHeaders = function (model) {
    var showDue = this.settings.values.showAssignmentDueDate;
    var headers = this.adapter.refreshColumns();
    headers.forEach(function (h) {
      if (!h.el) return;
      var oldLabel = h.el.querySelector(':scope > .cgp-header-label');
      if (h.type === 'assignment' && h.assignmentId) {
        var a = model ? model.assignment(h.assignmentId) : null;
        if (a) {
          var pointsText = (a.pointsPossible === null || a.pointsPossible === undefined) ? '' : (a.pointsPossible + ' pts');
          var dueText = showDue ? CGP.util.fmtDueDate(a.dueAt, a.hasMultipleDueDates) : '';
          var tooltip = a.name + (pointsText ? ' — ' + pointsText : '') + (dueText ? ' — ' + dueText : '');
          h.el.setAttribute('title', tooltip);
          if (!oldLabel) {
            oldLabel = document.createElement('div');
            oldLabel.className = 'cgp-header-label';
            oldLabel.innerHTML = '<div class="cgp-header-title"></div><div class="cgp-header-points"></div><div class="cgp-header-due"></div>';
            h.el.appendChild(oldLabel);
          }
          oldLabel.querySelector('.cgp-header-title').textContent = a.name;
          oldLabel.querySelector('.cgp-header-points').textContent = pointsText;
          var dueEl = oldLabel.querySelector('.cgp-header-due');
          if (dueEl) {
            dueEl.textContent = dueText;
            dueEl.hidden = !dueText;
          }
        }
      } else if (oldLabel) {
        oldLabel.remove();
      }
      var type = h.type || 'unknown';
      if (h.el.getAttribute('data-cgp-col') !== type) h.el.setAttribute('data-cgp-col', type);
    });
  };

  CGP.CompactLayoutController = CompactLayoutController;
})();
