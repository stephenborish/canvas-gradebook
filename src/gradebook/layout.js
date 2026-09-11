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
    '#gradebook-settings',
    '#gradebook_settings_modal_button',
    '[data-component="EnhancedActionMenu"]',
    '[data-component="ActionMenu"]',
    '[data-component="ViewOptionsMenu"]',
    '[data-testid="gradebook-settings-button"]',
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
    'gradebook settings', 'actions', 'export current gradebook view'
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
    var push = function (el) { if (el && found.indexOf(el) < 0) found.push(el); };

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
    var y = Math.round(rect.top + rect.height / 2);
    var startX = Math.round(rect.right - 1);
    var delta = item.want - item.have;
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
