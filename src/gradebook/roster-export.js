/* Canvas Gradebook+ - "Copy Roster" in the Student Name column's "..." menu.
 *
 * Canvas has no way to get a class list out of the gradebook short of an
 * export of every grade. This adds one item, at the top, to the Student Name
 * column's own menu (Sort by, Display as, Secondary info, Show). Choosing it opens a small
 * panel that reads the course's students - names and email addresses - from
 * Canvas, on two pages:
 *   - Email addresses: copy every address at once, ready for a To: or Bcc:
 *     field - the students', their parents' and guardians' (Canvas's
 *     "observers", a word no teacher uses), or both
 *   - Roster table: the whole class in one table, laid out the way the
 *     teacher chooses (First Last, Last, First, separate first/last columns,
 *     with or without the student's email, and optionally each student's
 *     parents' and guardians' names and emails), which pastes as a real
 *     table into Docs, Word, Gmail or Sheets, or downloads as a CSV
 *
 * The roster lives in memory for as long as the panel is open; only the
 * layout choices (never a name or an address) are remembered between visits.
 *
 * The menu is found the same way score-analysis.js finds a column's menu: a
 * press on a control inside the Student Name header, immediately followed by
 * a menu carrying Canvas's own Student Name items. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.RosterExportController) return;

  // Items only Canvas's Student Name column menu carries.
  var STUDENT_MENU_ITEMS = /^(display as|secondary info)/i;
  var OPEN_WINDOW_MS = 4000;
  var ITEM_LABEL = 'Copy Roster';
  var ITEM_HINT = 'Names and emails';
  var PREFS_KEY = 'cgp.rosterPrefs';
  var DEFAULT_PREFS = {
    nameFormat: 'first-last', email: true, header: true, sortBy: 'last', separator: 'comma',
    emailStudents: true, emailGuardians: false, guardianNames: false, guardianEmails: false, view: 'emails'
  };

  var ICON_SVG =
    '<svg class="cgp-analyze-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<rect x="8" y="3" width="12" height="15" rx="2"/>' +
      '<path d="M16 21H6a2 2 0 0 1-2-2V7"/>' +
      '<path d="M11 8h6M11 11.5h6M11 15h3.5"/>' +
    '</svg>';
  var ITEM_HTML = ICON_SVG +
    '<span class="cgp-analyze-text">' +
      '<span class="cgp-analyze-title">' + ITEM_LABEL +
        '<span class="cgp-analyze-pill" aria-hidden="true">NEW</span>' +
      '</span>' +
      '<span class="cgp-analyze-hint">' + ITEM_HINT + '</span>' +
    '</span>';

  var NAME_CHOICES = [
    ['first-last', 'First Last'],
    ['last-first', 'Last, First'],
    ['split', 'First and Last in separate columns'],
    ['comma-line', 'First, Last, Email on one line']
  ];
  var SEPARATOR_CHOICES = [
    ['comma', 'Commas (Gmail)'],
    ['semicolon', 'Semicolons (Outlook)'],
    ['newline', 'One per line']
  ];

  function RosterExportController(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.adapter = ctx.adapter;
    this._lastTrigger = 0;
    this._observer = null;
    this._dialog = null;
    this._rows = null;
    this.prefs = loadPrefs();
  }

  var P = RosterExportController.prototype;

  /* The layout choices are a setting (CGP.settings rosterPrefs), so they
   * follow the teacher to every computer like the rest. A choice made by an
   * earlier version lives in this site's localStorage: it is taken over
   * once, if nothing has been saved as a setting yet. */
  function loadPrefs() {
    var prefs = Object.assign({}, DEFAULT_PREFS, (CGP.settings && CGP.settings.values.rosterPrefs) || {});
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      var untouched = JSON.stringify(prefs) === JSON.stringify(DEFAULT_PREFS);
      if (saved && typeof saved === 'object' && untouched) {
        Object.keys(DEFAULT_PREFS).forEach(function (k) {
          if (typeof saved[k] === typeof DEFAULT_PREFS[k]) prefs[k] = saved[k];
        });
      }
    } catch (e) { /* private mode or blocked storage: defaults */ }
    // "First name only" and "No names" were dropped; a choice saved before
    // that falls back to First Last.
    if (NAME_CHOICES.every(function (c) { return c[0] !== prefs.nameFormat; })) prefs.nameFormat = DEFAULT_PREFS.nameFormat;
    return prefs;
  }

  /* Saving waits until the clicking stops, and always comes after the panel
   * has redrawn: a save never holds up (or, failing, stops) what the
   * teacher sees. Each saved setting is also a write to Chrome sync and a
   * note to every open Canvas tab, so a burst of clicks is one save. */
  var SAVE_DELAY_MS = 500;

  P.savePrefs = function () {
    var self = this;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(function () { self.flushPrefs(); }, SAVE_DELAY_MS);
  };

  /* Writes a waiting save now (closing the panel does this). */
  P.flushPrefs = function () {
    if (!this._saveTimer) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    var prefs = Object.assign({}, this.prefs);
    try {
      if (CGP.settings && CGP.settings.save) {
        CGP.settings.save({ rosterPrefs: prefs }).then(function () {
          try { localStorage.removeItem(PREFS_KEY); } catch (e) { /* ignore */ }
        }, function () { /* kept for this page; reported in diagnostics */ });
      }
    } catch (e) {
      // A tab left open across an extension update can no longer save
      // settings at all; the choices still apply for as long as it is open.
    }
  };

  P.start = function () {
    var self = this;
    var remember = function (e) { self.rememberTrigger(e.target); };
    document.addEventListener('mousedown', remember, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') remember(e);
    }, true);
    this._observer = new MutationObserver(function (records) {
      if (!self._lastTrigger) return;
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1 || (node.closest && node.closest('.cgp-stats'))) continue;
          var menus = node.matches && node.matches('[role="menu"]') ? [node] : [];
          if (node.querySelectorAll) menus = menus.concat(Array.prototype.slice.call(node.querySelectorAll('[role="menu"]')));
          menus.forEach(function (m) { self.decorateMenu(m); });
        }
      }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });
    // A choice made just before leaving the page is still saved.
    window.addEventListener('pagehide', function () { self.flushPrefs(); });
  };

  P.rememberTrigger = function (target) {
    var header = target && target.closest && target.closest('.slick-header-column');
    if (!header) return;
    if (!target.closest('button, [role="button"], [aria-haspopup]')) return;
    if (CGP.gridMap.classifyColumnId(this.adapter.columnIdForHeader(header)).type === 'student') {
      this._lastTrigger = Date.now();
    }
  };

  function itemText(el) {
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function labelNode(el, text) {
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (itemText(kids[i]) === text) return labelNode(kids[i], text);
    }
    return el;
  }

  P.decorateMenu = function (menu) {
    if (!this._lastTrigger || Date.now() - this._lastTrigger > OPEN_WINDOW_MS) return;
    if (menu.querySelector('.cgp-roster-item')) return;
    var anchor = null;
    Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]')).forEach(function (it) {
      if (STUDENT_MENU_ITEMS.test(itemText(it))) anchor = it;
    });
    if (!anchor) return;

    var unit = anchor;
    if (unit.parentElement && unit.parentElement !== menu &&
        (unit.parentElement.getAttribute('role') === 'none' || unit.parentElement.tagName === 'LI')) {
      unit = unit.parentElement;
    }
    var clone = unit.cloneNode(true);
    var item = clone.getAttribute('role') === 'menuitem' ? clone : clone.querySelector('[role="menuitem"]');
    if (!item) return;
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('[id]'))).forEach(function (n) {
      if (n.removeAttribute) n.removeAttribute('id');
    });
    // The items it is cloned from open a submenu; this one opens nothing, so
    // it drops the flyout's arrow and the attributes announcing one.
    ['aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-disabled', 'aria-describedby', 'href'].forEach(function (a) {
      item.removeAttribute(a);
    });
    Array.prototype.slice.call(clone.querySelectorAll('svg')).forEach(function (svg) {
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    });
    item.classList.add('cgp-analyze-item', 'cgp-roster-item');
    var label = labelNode(item, itemText(anchor));
    label.innerHTML = ITEM_HTML;
    label.classList.add('cgp-analyze-label');
    item.setAttribute('aria-label', ITEM_LABEL);
    item.setAttribute('title', 'Copy or download every student’s name and email');

    var self = this;
    function choose(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      self.closeMenu(menu);
      self.open();
    }
    item.addEventListener('click', choose, true);
    item.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
    if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '-1');
    // Taking focus (by hover or keyboard) closes any submenu (Sort by,
    // Display as...) still standing open beside this item.
    var closeOpen = function () { if (CGP.ui && CGP.ui.closeFlyouts) CGP.ui.closeFlyouts(menu, item); };
    item.addEventListener('focus', closeOpen);
    item.addEventListener('mouseenter', function () {
      if (document.activeElement !== item) {
        try { item.focus({ preventScroll: true }); } catch (e) { item.focus(); }
      } else {
        closeOpen();
      }
    });
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') choose(e);
    }, true);
    // First in the menu, above Canvas's own "Sort by".
    var first = menu.querySelector('[role="menuitem"]') || anchor;
    var top = first;
    if (top.parentElement && top.parentElement !== menu &&
        (top.parentElement.getAttribute('role') === 'none' || top.parentElement.tagName === 'LI')) {
      top = top.parentElement;
    }
    top.parentNode.insertBefore(clone, top);
  };

  P.closeMenu = function (menu) {
    try {
      var opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      menu.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
    } catch (e) { /* the panel opening on top is enough */ }
  };

  /* ---------------------------------------------------------------- panel */

  /* Two pages, picked with the tabs under the title:
   *   Email addresses  whose addresses (students, parents & guardians), how
   *                    to separate them, the list itself, and one Copy.
   *   Roster table     every student in one table, with the name layout,
   *                    sort, and which columns (student email, parents' and
   *                    guardians' names and emails) the teacher picks;
   *                    Copy table and Download CSV.
   * The actions sit in a footer that stays put while the table scrolls. */

  var esc = function (s) { return CGP.util.escapeHtml(String(s)); };

  var VIEWS = [
    ['emails', 'Email addresses',
      '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 5.5l7 5.5 7-5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'],
    ['table', 'Roster table',
      '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 8h15M2.5 12.3h15M8 8v8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>']
  ];

  function options(choices, value) {
    return choices.map(function (c) {
      return '<option value="' + c[0] + '"' + (c[0] === value ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
    }).join('');
  }

  function segments(name, choices, value) {
    return choices.map(function (c) {
      return '<label class="cgp-roster__seg-opt"><input type="radio" name="' + name + '" value="' + c[0] + '"' +
        (c[0] === value ? ' checked' : '') + '><span>' + esc(c[1]) + '</span></label>';
    }).join('');
  }

  function chip(pref, label, on) {
    return '<label class="cgp-roster__chip"><input type="checkbox" data-pref="' + pref + '"' + (on ? ' checked' : '') + '>' +
      '<span>' + esc(label) + '</span></label>';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  var SPINNER = '<span class="cgp-roster__spinner" aria-hidden="true"></span>';

  /* A "still loading" message with a spinner beside it. */
  function loadingHtml(text, tag) {
    tag = tag || 'p';
    return '<' + tag + ' class="cgp-roster__empty cgp-roster__loading">' + SPINNER + '<span>' + esc(text) + '</span></' + tag + '>';
  }

  P.courseName = function () {
    var crumb = document.querySelector('.cgp-crumb-link, #breadcrumbs a[href*="/courses/"]');
    var name = crumb ? itemText(crumb) : '';
    if (!name) name = String(document.title || '').replace(/^gradebook\s*[-–:]\s*/i, '');
    return name || 'Course ' + this.courseId;
  };

  P.open = function () {
    var self = this;
    this.close();
    var p = this.prefs;
    var view = p.view === 'table' ? 'table' : 'emails';
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-roster';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel cgp-roster__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-roster-title" tabindex="-1">' +
      '<header class="cgp-roster__head"><div class="cgp-roster__head-text">' +
        '<div class="cgp-stats__eyebrow">Class roster</div>' +
        '<h2 id="cgp-roster-title">' + esc(this.courseName()) + '</h2>' +
        '<p class="cgp-roster__status" aria-live="polite">Loading students…</p></div>' +
        '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-roster__tabs" role="tablist" aria-label="Roster">' +
        VIEWS.map(function (v) {
          return '<button type="button" role="tab" class="cgp-roster__tab" id="cgp-roster-tab-' + v[0] + '" data-view="' + v[0] + '"' +
            ' aria-controls="cgp-roster-pane-' + v[0] + '">' + v[2] + '<span>' + v[1] + '</span>' +
            '<span class="cgp-roster__spinner cgp-roster__tab-busy" aria-hidden="true"></span></button>';
        }).join('') +
      '</div>' +
      '<div class="cgp-roster__body">' +
        '<section class="cgp-roster__pane" role="tabpanel" id="cgp-roster-pane-emails" aria-labelledby="cgp-roster-tab-emails" data-pane="emails">' +
          '<h3 class="cgp-roster__label" id="cgp-roster-who">Whose addresses</h3>' +
          '<div class="cgp-roster__who" role="group" aria-labelledby="cgp-roster-who">' +
            '<label class="cgp-roster__tile"><input type="checkbox" data-pref="emailStudents"' + (p.emailStudents ? ' checked' : '') + '>' +
              '<span class="cgp-roster__tile-text"><span class="cgp-roster__tile-title">Students</span>' +
              '<span class="cgp-roster__tile-count" data-count="students">…</span></span></label>' +
            '<label class="cgp-roster__tile"><input type="checkbox" data-pref="emailGuardians"' + (p.emailGuardians ? ' checked' : '') + '>' +
              '<span class="cgp-roster__tile-text"><span class="cgp-roster__tile-title">Parents &amp; guardians</span>' +
              '<span class="cgp-roster__tile-count" data-count="guardians">Linked in Canvas</span></span></label>' +
          '</div>' +
          '<p class="cgp-roster__hint cgp-roster__guardian-note"></p>' +
          '<h3 class="cgp-roster__label" id="cgp-roster-sep">Separate addresses with</h3>' +
          '<div class="cgp-roster__seg" role="radiogroup" aria-labelledby="cgp-roster-sep">' +
            segments('cgp-roster-sep', SEPARATOR_CHOICES, p.separator) + '</div>' +
          '<h3 class="cgp-roster__label" id="cgp-roster-list">Addresses</h3>' +
          '<div class="cgp-roster__addresses" role="region" aria-labelledby="cgp-roster-list" tabindex="0"></div>' +
        '</section>' +
        '<section class="cgp-roster__pane cgp-roster__pane--table" role="tabpanel" id="cgp-roster-pane-table" aria-labelledby="cgp-roster-tab-table" data-pane="table">' +
          '<div class="cgp-roster__controls">' +
            '<label class="cgp-roster__field"><span class="cgp-roster__label">Names</span><select data-pref="nameFormat">' +
              options(NAME_CHOICES, p.nameFormat) + '</select></label>' +
            '<label class="cgp-roster__field"><span class="cgp-roster__label">Sort by</span><select data-pref="sortBy">' +
              options([['last', 'Last name'], ['first', 'First name']], p.sortBy) + '</select></label>' +
            '<div class="cgp-roster__field cgp-roster__field--cols" role="group" aria-labelledby="cgp-roster-cols">' +
              '<span class="cgp-roster__label" id="cgp-roster-cols">Columns</span>' +
              '<div class="cgp-roster__chips">' +
                chip('email', 'Student email', p.email) +
                chip('guardianNames', 'Parent/guardian names', p.guardianNames) +
                chip('guardianEmails', 'Parent/guardian emails', p.guardianEmails) +
              '</div></div>' +
          '</div>' +
          '<p class="cgp-roster__hint cgp-roster__table-status" hidden></p>' +
          '<div class="cgp-roster__table-wrap" role="region" aria-label="Roster table" tabindex="0"></div>' +
        '</section>' +
      '</div>' +
      '<footer class="cgp-roster__foot">' +
        '<p class="cgp-roster__foot-note"></p>' +
        '<div class="cgp-roster__foot-actions" data-pane="emails">' +
          '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="emails" disabled>Copy emails</button>' +
        '</div>' +
        '<div class="cgp-roster__foot-actions" data-pane="table">' +
          '<label class="cgp-roster__check"><input type="checkbox" data-pref="header"' + (p.header ? ' checked' : '') + '> Include header row</label>' +
          '<button type="button" class="cgp-roster__btn" data-act="csv" disabled>Download CSV</button>' +
          '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="table" disabled>Copy table</button>' +
        '</div>' +
      '</footer>' +
      '</div>';

    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.close(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.close(); });
    root.addEventListener('change', function (e) { self.onChange(e.target); });
    root.addEventListener('click', function (e) {
      var tab = e.target.closest && e.target.closest('[role="tab"][data-view]');
      if (tab) { self.showView(tab.getAttribute('data-view'), true); return; }
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (btn && !btn.disabled) self.act(btn.getAttribute('data-act'));
    });
    // Left/Right (and Home/End) move between the two tabs, as in any tab list.
    root.querySelector('.cgp-roster__tabs').addEventListener('keydown', function (e) {
      var keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
      if (!(e.key in keys)) return;
      e.preventDefault();
      var ids = VIEWS.map(function (v) { return v[0]; });
      var at = ids.indexOf(self.prefs.view);
      var next = keys[e.key] === -Infinity ? 0 : keys[e.key] === Infinity ? ids.length - 1 : (at + keys[e.key] + ids.length) % ids.length;
      self.showView(ids[next], true);
      var t = root.querySelector('#cgp-roster-tab-' + ids[next]);
      if (t) t.focus();
    });
    this._onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this._dialog = root;
    this.showView(view, false);
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }

    this._rows = null;
    this._users = null;
    this._loadFailed = false;
    this._guardians = null;
    this._guardianState = 'idle';
    if (this.needsGuardians()) this.loadGuardians();
    this.refresh();
    return this.api.courseRoster(this.courseId).then(function (users) {
      if (self._dialog !== root) return;
      self._users = users || [];
      self.refresh();
    }, function (err) {
      if (self._dialog !== root) return;
      self._loadFailed = true;
      self.refresh();
      self.setStatus('Couldn’t load the roster from Canvas. ' +
        CGP.util.describeApiError(err, { fallback: 'Try again in a moment.' }));
    });
  };

  /* Switches the page shown; `remember` saves it as the page to open on. */
  P.showView = function (view, remember) {
    var root = this._dialog;
    if (!root) return;
    view = view === 'table' ? 'table' : 'emails';
    var changed = this.prefs.view !== view;
    this.prefs.view = view;
    root.classList.toggle('cgp-roster--table', view === 'table');
    Array.prototype.slice.call(root.querySelectorAll('[role="tab"][data-view]')).forEach(function (t) {
      var on = t.getAttribute('data-view') === view;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
    });
    Array.prototype.slice.call(root.querySelectorAll('[data-pane]')).forEach(function (el) {
      el.hidden = el.getAttribute('data-pane') !== view;
    });
    this.renderFootNote();
    if (remember && changed) this.savePrefs();
  };

  /* Whether any choice needs the parents' and guardians' list. */
  P.needsGuardians = function () {
    var p = this.prefs;
    return !!(p.emailGuardians || p.guardianNames || p.guardianEmails);
  };

  /* Parents and guardians are read only once the teacher asks for them:
   * most never will, and it is a second roster of real people's addresses. */
  P.loadGuardians = function () {
    var self = this;
    var root = this._dialog;
    if (!root || this._guardianState === 'loading' || this._guardianState === 'ready') return;
    if (!this.api.courseObservers) { this._guardianState = 'error'; return; }
    this._guardianState = 'loading';
    this.api.courseObservers(this.courseId).then(function (users) {
      if (self._dialog !== root) return;
      self._guardians = users || [];
      self._guardianState = 'ready';
      self.refresh();
    }, function (err) {
      if (self._dialog !== root) return;
      self._guardianState = 'error';
      self._guardianError = CGP.util.describeApiError(err, { fallback: 'Try again in a moment.' });
      self.refresh();
    });
  };

  /* The parent/guardian addresses for the current students, or null while
   * they are not loaded. */
  P.guardianInfo = function () {
    if (this._guardianState !== 'ready') return null;
    return CGP.rosterFormat.guardians(this._guardians, this._rows || []);
  };

  /* The addresses "Copy emails" copies right now, each once. */
  P.chosenEmails = function (g) {
    return CGP.rosterFormat.emailAddresses(this._rows || [], {
      students: this.prefs.emailStudents,
      guardians: this.prefs.emailGuardians && g ? g.emails : []
    });
  };

  P.setStatus = function (text) {
    var el = this._dialog && this._dialog.querySelector('.cgp-roster__status');
    if (el) el.textContent = text;
  };

  P.onChange = function (el) {
    if (!el) return;
    if (el.name === 'cgp-roster-sep') this.prefs.separator = el.value;
    var key = el.getAttribute && el.getAttribute('data-pref');
    if (key) this.prefs[key] = el.type === 'checkbox' ? !!el.checked : el.value;
    if (this.needsGuardians()) {
      // A failed read is tried again when a parent/guardian choice is
      // switched on afresh - not by any other change.
      var guardianKey = key === 'emailGuardians' || key === 'guardianNames' || key === 'guardianEmails';
      if (this._guardianState === 'error' && guardianKey && el.checked) this._guardianState = 'idle';
      this.loadGuardians();
    }
    // Redrawn first: the list, the counts, the Copy button and the table
    // always match the choices on screen, whatever happens to the save.
    this.refresh();
    this.savePrefs();
  };

  /* The table for the current choices. Parent/guardian columns are left
   * out until their list is in. */
  P.currentTable = function (nameFormat) {
    var g = this.guardianInfo();
    return CGP.rosterFormat.table(this._rows || [], {
      nameFormat: nameFormat || this.prefs.nameFormat,
      email: this.prefs.email,
      guardians: g ? g.byStudent : null,
      guardianNames: this.prefs.guardianNames,
      guardianEmails: this.prefs.guardianEmails
    });
  };

  /* Whether the table is waiting on (or missing) parent/guardian columns
   * the teacher asked for. */
  P.tableNeedsGuardians = function () {
    return (this.prefs.guardianNames || this.prefs.guardianEmails) && this._guardianState !== 'ready';
  };

  /* Re-sorts and re-renders both pages for the current choices. */
  P.refresh = function () {
    var root = this._dialog;
    if (!root) return;
    var loaded = !!this._users;
    this._rows = loaded ? CGP.rosterFormat.normalize(this._users, this.prefs.sortBy) : [];
    var n = this._rows.length;
    var noEmail = this._rows.filter(function (r) { return !r.email; }).length;
    if (loaded) {
      this.setStatus(plural(n, 'student', 'students') +
        (noEmail && n ? ' · ' + noEmail + ' without an email address Canvas will share' : ''));
    }
    var emailCount = this.renderEmailChoices(loaded ? n - noEmail : null);
    var tableReady = this.renderTable(loaded);
    var btnOn = { emails: emailCount > 0, table: tableReady, csv: tableReady };
    Object.keys(btnOn).forEach(function (k) {
      var btn = root.querySelector('[data-act="' + k + '"]');
      if (btn) btn.disabled = !btnOn[k];
    });
    this.renderFootNote();
  };

  /* The whole table, every student, with a row number that is only for
   * reading (it is never copied). Returns whether it can be copied. */
  P.renderTable = function (loaded) {
    var root = this._dialog;
    var box = root.querySelector('.cgp-roster__table-wrap');
    var status = root.querySelector('.cgp-roster__table-status');
    var wantsG = this.prefs.guardianNames || this.prefs.guardianEmails;
    var gNote = '';
    if (wantsG && this._guardianState === 'loading') gNote = 'Loading parents and guardians from Canvas…';
    else if (wantsG && this._guardianState === 'error') gNote = 'Couldn’t load parents and guardians from Canvas. ' + (this._guardianError || 'Try again in a moment.');
    else if (wantsG && this._guardianState === 'ready') {
      var g = this.guardianInfo();
      var pr = this.prefs;
      // A guardian counts only if they have something for the columns shown.
      var usable = function (x) { return (pr.guardianNames && x.name) || (pr.guardianEmails && x.email); };
      var none = this._rows.filter(function (r) { return !(g.byStudent[r.id] || []).some(usable); }).length;
      if (none && this._rows.length) {
        gNote = plural(none, 'student has', 'students have') + ' no parent or guardian ' +
          (pr.guardianNames ? 'linked' : 'email address') + ' in Canvas; ' +
          (none === 1 ? 'that row’s' : 'those rows’') + ' parent columns are blank.';
      }
    }
    var gLoading = wantsG && this._guardianState === 'loading';
    if (gLoading) status.innerHTML = SPINNER + '<span>' + esc(gNote) + '</span>';
    else status.textContent = gNote;
    status.classList.toggle('cgp-roster__loading', gLoading);
    status.hidden = !gNote;
    // The tab shows it is still working, so a teacher who switches to it
    // straight away sees why the table isn't complete yet.
    var busy = (!loaded && !this._loadFailed) || gLoading;
    box.setAttribute('aria-busy', busy ? 'true' : 'false');
    var tab = root.querySelector('#cgp-roster-tab-table');
    if (tab) tab.classList.toggle('cgp-roster__tab--busy', busy);

    if (!loaded) {
      box.innerHTML = this._loadFailed
        ? '<p class="cgp-roster__empty">The class list couldn’t be loaded. Close this and choose Copy Roster again.</p>'
        : loadingHtml('Loading students from Canvas…');
      return false;
    }
    var t = this.currentTable();
    if (!t.header.length) {
      box.innerHTML = '<p class="cgp-roster__empty">Pick at least one column to build a table.</p>';
      return false;
    }
    if (!t.body.length) {
      box.innerHTML = '<p class="cgp-roster__empty">No students are enrolled in this course.</p>';
      return false;
    }
    var headOff = !this.prefs.header;
    box.innerHTML = '<table class="cgp-roster__table' + (t.oneLine ? ' cgp-roster__table--line' : '') + '">' +
      '<thead' + (headOff ? ' class="cgp-roster__thead--off" title="The header row isn’t copied"' : '') + '><tr>' +
        '<th class="cgp-roster__num" aria-label="Row"></th>' +
        t.header.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      t.body.map(function (cells, i) {
        return '<tr><td class="cgp-roster__num">' + (i + 1) + '</td>' +
          cells.map(function (c) { return '<td>' + (c ? esc(c) : '<span class="cgp-roster__blank">—</span>') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    return !this.tableNeedsGuardians();
  };

  /* The note at the left of the footer, for the page shown. */
  P.renderFootNote = function () {
    var root = this._dialog;
    var el = root && root.querySelector('.cgp-roster__foot-note');
    if (!el) return;
    if (this.prefs.view === 'table') {
      var t = this._users ? this.currentTable() : null;
      el.textContent = t && t.oneLine
        ? 'Copies one line per student. The CSV has a column for each part.'
        : 'Pastes as a table in Docs, Word and Gmail, and as columns in Sheets or Excel.';
    } else {
      el.textContent = 'Paste into the To: or Bcc: line of an email.';
    }
  };

  /* The two "whose addresses" tiles, the note under them, the list of
   * addresses and the Copy button's label. Returns how many addresses Copy
   * would copy. */
  P.renderEmailChoices = function (studentEmails) {
    var root = this._dialog;
    var p = this.prefs;
    var g = this.guardianInfo();
    var set = function (sel, text) { var el = root.querySelector(sel); if (el) el.textContent = text; };

    set('[data-count="students"]', studentEmails === null ? (this._loadFailed ? 'Unavailable' : 'Loading…') : plural(studentEmails, 'email', 'emails'));
    var note;
    if (this._guardianState === 'loading') {
      set('[data-count="guardians"]', 'Loading…');
      note = 'Looking up the parents and guardians linked to these students in Canvas…';
    } else if (this._guardianState === 'error') {
      set('[data-count="guardians"]', 'Unavailable');
      note = 'Couldn’t load parents and guardians from Canvas. ' + (this._guardianError || 'Try again in a moment.');
    } else if (g && !g.count) {
      set('[data-count="guardians"]', 'None linked');
      note = 'No parents or guardians are linked to these students in Canvas (Canvas calls them observers).';
    } else if (g && this._rows && this._rows.length) {
      set('[data-count="guardians"]', plural(g.count, 'email', 'emails'));
      var total = this._rows.length;
      note = g.uncovered
        ? plural(g.uncovered, 'student has', 'students have') + ' no parent or guardian linked in Canvas, so ' +
          (g.uncovered === 1 ? 'that family isn’t' : 'those families aren’t') + ' on the list.'
        : 'Every student has at least one parent or guardian linked in Canvas (' + total + ' of ' + total + ').';
    } else {
      set('[data-count="guardians"]', 'Linked in Canvas');
      note = 'The family members linked to each student in Canvas (Canvas calls them observers).';
    }
    set('.cgp-roster__guardian-note', note);

    var list = this._users ? this.chosenEmails(g) : [];
    var count = list.length;
    var waiting = p.emailGuardians && this._guardianState !== 'ready';
    var box = root.querySelector('.cgp-roster__addresses');
    if (box) {
      if (!this._users && this._loadFailed) box.innerHTML = '<span class="cgp-roster__empty">The class list couldn’t be loaded. Close this and choose Copy Roster again.</span>';
      else if (!this._users) box.innerHTML = loadingHtml('Loading students from Canvas…', 'span');
      else if (!p.emailStudents && !p.emailGuardians) box.innerHTML = '<span class="cgp-roster__empty">Choose Students, Parents &amp; guardians, or both.</span>';
      else if (waiting && this._guardianState === 'loading') box.innerHTML = loadingHtml('Loading parents and guardians…', 'span');
      // Not the students' list alone, which would look like the whole one.
      else if (waiting) box.innerHTML = '<span class="cgp-roster__empty">Parents and guardians couldn’t be loaded, so there is nothing to copy yet. Uncheck them to copy students only.</span>';
      else if (!count) box.innerHTML = '<span class="cgp-roster__empty">No email addresses for the people chosen.</span>';
      else box.textContent = CGP.rosterFormat.joinEmails(list, p.separator);
      box.classList.toggle('cgp-roster__addresses--lines', p.separator === 'newline');
    }

    var btn = root.querySelector('[data-act="emails"]');
    if (btn) btn.textContent = count && !waiting ? 'Copy ' + plural(count, 'email', 'emails') : 'Copy emails';
    // With Parents & guardians checked, nothing is copied until their list
    // is in: a students-only list would look like the whole thing.
    if (waiting) count = 0;
    return count;
  };

  P.act = function (what) {
    var fmt = CGP.rosterFormat;
    if (what === 'emails') {
      if (this.prefs.emailGuardians && this._guardianState !== 'ready') {
        CGP.ui.error('Parents and guardians aren’t loaded. Uncheck them to copy students only, or check them again to retry.');
        return;
      }
      var addresses = this.chosenEmails(this.guardianInfo());
      if (!addresses.length) { CGP.ui.error('There are no email addresses to copy for the people chosen.'); return; }
      var count = addresses.length;
      copy(fmt.joinEmails(addresses, this.prefs.separator), null).then(function () {
        CGP.ui.toast(count + (count === 1 ? ' email' : ' emails') + ' copied');
      }, function () { CGP.ui.error('Couldn’t copy to the clipboard.'); });
      return;
    }
    if (this.tableNeedsGuardians()) {
      CGP.ui.error('Parents and guardians aren’t loaded. Turn their columns off to continue without them.');
      return;
    }
    if (what === 'table') {
      var t = this.currentTable();
      // "First, Last, Email on one line" is copied as plain lines of text,
      // not a one-column table, so it pastes exactly as shown.
      copy(fmt.toTsv(t, this.prefs.header), t.oneLine ? null : fmt.toHtml(t, this.prefs.header)).then(function () {
        CGP.ui.toast('Roster copied (' + t.body.length + (t.body.length === 1 ? ' student)' : ' students)'));
      }, function () { CGP.ui.error('Couldn’t copy to the clipboard.'); });
    } else if (what === 'csv') {
      // A CSV is already comma separated: the one-line layout downloads as
      // its First Name, Last Name, Email columns rather than one quoted cell.
      var csvTable = this.currentTable();
      if (csvTable.oneLine) csvTable = this.currentTable('split');
      download(fmt.toCsv(csvTable, this.prefs.header), fileName(this.courseName()));
    }
  };

  function fileName(course) {
    var base = String(course).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'course';
    return base + ' - roster.csv';
  }

  /* Shared with the student overview's missing / late list (core/ui.js). */
  function copy(text, html) { return CGP.ui.copy(text, html); }

  function download(text, name) {
    // A byte-order mark so Excel reads accented names as UTF-8.
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  P.close = function () {
    this.flushPrefs();
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    if (this._dialog && this._dialog.parentNode) this._dialog.parentNode.removeChild(this._dialog);
    this._dialog = null;
    this._rows = null;
    this._users = null;
    this._guardians = null;
    this._guardianState = 'idle';
  };

  CGP.RosterExportController = RosterExportController;
})();
