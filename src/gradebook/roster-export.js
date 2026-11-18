/* Canvas Gradebook+ - "Copy Roster" in the Student Name column's "..." menu.
 *
 * Canvas has no way to get a class list out of the gradebook short of an
 * export of every grade. This adds one item, at the top, to the Student Name
 * column's own menu (Sort by, Display as, Secondary info, Show). Choosing it opens a small
 * panel that reads the course's students - names and email addresses - from
 * Canvas, and lets the teacher:
 *   - copy every email address at once, ready for a To: or Bcc: field -
 *     the students', their parents' and guardians' (Canvas's "observers",
 *     a word no teacher uses), or both
 *   - copy a table of names and emails, laid out the way they choose
 *     (First Last, Last, First, separate first/last columns, with or without
 *     email), which pastes as a real table into Docs, Word, Gmail or Sheets
 *   - download the same table as a CSV
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
  var PREVIEW_ROWS = 6;
  var DEFAULT_PREFS = {
    nameFormat: 'first-last', email: true, header: true, sortBy: 'last', separator: 'comma',
    emailStudents: true, emailGuardians: false
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
    ['split', 'First and Last in separate columns']
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

  P.savePrefs = function () {
    var prefs = Object.assign({}, this.prefs);
    if (CGP.settings && CGP.settings.save) {
      CGP.settings.save({ rosterPrefs: prefs }).then(function () {
        try { localStorage.removeItem(PREFS_KEY); } catch (e) { /* ignore */ }
      }, function () { /* kept for this page; reported in diagnostics */ });
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
    var settle = function () {
      if (document.activeElement !== item) {
        try { item.focus({ preventScroll: true }); } catch (e) { item.focus(); }
      }
      // Close any submenu (Sort by, Display as...) still standing open.
      if (CGP.ui && CGP.ui.closeFlyouts) CGP.ui.closeFlyouts(menu, item);
    };
    item.addEventListener('mouseenter', settle);
    item.addEventListener('focus', function () {
      if (CGP.ui && CGP.ui.closeFlyouts) CGP.ui.closeFlyouts(menu, item);
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

  var esc = function (s) { return CGP.util.escapeHtml(String(s)); };

  function radios(name, choices, value) {
    return choices.map(function (c) {
      return '<label class="cgp-roster__choice"><input type="radio" name="' + name + '" value="' + c[0] + '"' +
        (c[0] === value ? ' checked' : '') + '> ' + esc(c[1]) + '</label>';
    }).join('');
  }

  function options(choices, value) {
    return choices.map(function (c) {
      return '<option value="' + c[0] + '"' + (c[0] === value ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
    }).join('');
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
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-roster';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-roster-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Class roster</div><h2 id="cgp-roster-title">' + esc(this.courseName()) + '</h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<p class="cgp-stats__note cgp-roster__status">Loading students…</p>' +
      '<section class="cgp-roster__section">' +
        '<h3 id="cgp-roster-emails">All email addresses</h3>' +
        '<div class="cgp-roster__who" role="group" aria-labelledby="cgp-roster-emails">' +
          '<label class="cgp-roster__tile"><input type="checkbox" data-pref="emailStudents"' + (p.emailStudents ? ' checked' : '') + '>' +
            '<span class="cgp-roster__tile-text"><span class="cgp-roster__tile-title">Students</span>' +
            '<span class="cgp-roster__tile-count" data-count="students">…</span></span></label>' +
          '<label class="cgp-roster__tile"><input type="checkbox" data-pref="emailGuardians"' + (p.emailGuardians ? ' checked' : '') + '>' +
            '<span class="cgp-roster__tile-text"><span class="cgp-roster__tile-title">Parents &amp; guardians</span>' +
            '<span class="cgp-roster__tile-count" data-count="guardians">Linked in Canvas</span></span></label>' +
        '</div>' +
        '<p class="cgp-stats__note cgp-roster__guardian-note">Parents and guardians are the family members linked to each student in Canvas (Canvas calls them observers).</p>' +
        '<div class="cgp-roster__row">' +
          '<label class="cgp-roster__field">Separate with <select data-pref="separator">' + options(SEPARATOR_CHOICES, p.separator) + '</select></label>' +
          '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="emails" disabled>Copy emails</button>' +
        '</div>' +
      '</section>' +
      '<section class="cgp-roster__section">' +
        '<h3>Roster table</h3>' +
        '<fieldset class="cgp-roster__names"><legend>Names</legend>' + radios('cgp-roster-name', NAME_CHOICES, p.nameFormat) + '</fieldset>' +
        '<div class="cgp-roster__row">' +
          '<label class="cgp-roster__choice"><input type="checkbox" data-pref="email"' + (p.email ? ' checked' : '') + '> Email</label>' +
          '<label class="cgp-roster__choice"><input type="checkbox" data-pref="header"' + (p.header ? ' checked' : '') + '> Header row</label>' +
          '<label class="cgp-roster__field">Sort by <select data-pref="sortBy">' +
            options([['last', 'Last name'], ['first', 'First name']], p.sortBy) + '</select></label>' +
        '</div>' +
        '<div class="cgp-roster__preview" aria-live="polite"></div>' +
        '<div class="cgp-roster__row cgp-roster__actions">' +
          '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="table" disabled>Copy table</button>' +
          '<button type="button" class="cgp-roster__btn" data-act="csv" disabled>Download CSV</button>' +
        '</div>' +
        '<p class="cgp-stats__note">Copy table pastes as a formatted table in Google Docs, Word and Gmail, and as columns in Sheets or Excel.</p>' +
      '</section>' +
      '</div>';

    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.close(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.close(); });
    root.addEventListener('change', function (e) { self.onChange(e.target); });
    root.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (btn && !btn.disabled) self.act(btn.getAttribute('data-act'));
    });
    this._onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this._dialog = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }

    this._rows = null;
    this._users = null;
    this._guardians = null;
    this._guardianState = 'idle';
    if (p.emailGuardians) this.loadGuardians();
    return this.api.courseRoster(this.courseId).then(function (users) {
      if (self._dialog !== root) return;
      self._users = users || [];
      self.refresh();
    }, function (err) {
      if (self._dialog !== root) return;
      self.setStatus('Couldn’t load the roster from Canvas. ' +
        CGP.util.describeApiError(err, { fallback: 'Try again in a moment.' }));
    });
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
      if (self._users) self.refresh();
    }, function (err) {
      if (self._dialog !== root) return;
      self._guardianState = 'error';
      self._guardianError = CGP.util.describeApiError(err, { fallback: 'Try again in a moment.' });
      if (self._users) self.refresh();
    });
  };

  /* The parent/guardian addresses for the current students, or null while
   * they are not loaded. */
  P.guardianInfo = function () {
    if (this._guardianState !== 'ready') return null;
    return CGP.rosterFormat.guardians(this._guardians, this._rows || []);
  };

  P.setStatus = function (text) {
    var el = this._dialog && this._dialog.querySelector('.cgp-roster__status');
    if (el) el.textContent = text;
  };

  P.onChange = function (el) {
    if (!el) return;
    if (el.name === 'cgp-roster-name') this.prefs.nameFormat = el.value;
    var key = el.getAttribute && el.getAttribute('data-pref');
    if (key) this.prefs[key] = el.type === 'checkbox' ? !!el.checked : el.value;
    if (key === 'emailGuardians' && el.checked) this.loadGuardians();
    this.savePrefs();
    if (this._users) this.refresh();
  };

  P.currentTable = function () {
    return CGP.rosterFormat.table(this._rows || [], { nameFormat: this.prefs.nameFormat, email: this.prefs.email });
  };

  /* Re-sorts and re-renders the preview for the current choices. */
  P.refresh = function () {
    if (!this._dialog) return;
    this._rows = CGP.rosterFormat.normalize(this._users, this.prefs.sortBy);
    var n = this._rows.length;
    var noEmail = this._rows.filter(function (r) { return !r.email; }).length;
    this.setStatus(n + (n === 1 ? ' student' : ' students') +
      (noEmail && n ? ' · ' + noEmail + ' without an email address Canvas will share' : ''));
    var t = this.currentTable();
    var box = this._dialog.querySelector('.cgp-roster__preview');
    if (!t.header.length) {
      box.innerHTML = '<p class="cgp-stats__note">Pick names or email to build a table.</p>';
    } else {
      var shown = t.body.slice(0, PREVIEW_ROWS);
      box.innerHTML = '<table><thead><tr>' + t.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + shown.map(function (cells) {
          return '<tr>' + cells.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
        (t.body.length > shown.length ? '<p class="cgp-stats__note">…and ' + (t.body.length - shown.length) + ' more</p>' : '');
    }
    var hasTable = !!t.header.length && !!n;
    var emailCount = this.renderEmailChoices(n - noEmail);
    var dialog = this._dialog;
    [['emails', emailCount > 0], ['table', hasTable], ['csv', hasTable]].forEach(function (b) {
      var btn = dialog.querySelector('[data-act="' + b[0] + '"]');
      if (btn) btn.disabled = !b[1];
    });
  };

  /* The two "whose addresses" tiles, the note under them and the Copy
   * button's label. Returns how many addresses Copy would copy. */
  P.renderEmailChoices = function (studentEmails) {
    var root = this._dialog;
    var p = this.prefs;
    var g = this.guardianInfo();
    var set = function (sel, text) { var el = root.querySelector(sel); if (el) el.textContent = text; };
    var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

    set('[data-count="students"]', plural(studentEmails, 'email', 'emails'));
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
    } else if (g) {
      set('[data-count="guardians"]', plural(g.count, 'email', 'emails'));
      var total = (this._rows || []).length;
      note = g.uncovered
        ? plural(g.uncovered, 'student has', 'students have') + ' no parent or guardian linked in Canvas, so ' +
          (g.uncovered === 1 ? 'that family isn’t' : 'those families aren’t') + ' on the list.'
        : 'Every student has at least one parent or guardian linked in Canvas (' + total + ' of ' + total + ').';
    } else {
      set('[data-count="guardians"]', 'Linked in Canvas');
      note = 'Parents and guardians are the family members linked to each student in Canvas (Canvas calls them observers).';
    }
    set('.cgp-roster__guardian-note', note);

    var count = 0;
    if (this._rows) {
      count = CGP.rosterFormat.emailList(this._rows, 'newline', {
        students: p.emailStudents,
        guardians: p.emailGuardians && g ? g.emails : []
      }).split('\n').filter(Boolean).length;
    }
    var btn = root.querySelector('[data-act="emails"]');
    if (btn) {
      var waiting = p.emailGuardians && this._guardianState === 'loading';
      btn.textContent = count ? 'Copy ' + plural(count, 'email', 'emails') : 'Copy emails';
      if (waiting) count = 0; // the list isn't whole yet
    }
    return count;
  };

  P.act = function (what) {
    var fmt = CGP.rosterFormat;
    var rows = this._rows || [];
    if (what === 'emails') {
      var g = this.guardianInfo();
      var list = fmt.emailList(rows, this.prefs.separator, {
        students: this.prefs.emailStudents,
        guardians: this.prefs.emailGuardians && g ? g.emails : []
      });
      if (!list) { CGP.ui.error('There are no email addresses to copy for the people chosen.'); return; }
      var count = fmt.emailList(rows, 'newline', {
        students: this.prefs.emailStudents,
        guardians: this.prefs.emailGuardians && g ? g.emails : []
      }).split('\n').length;
      copy(list, null).then(function () {
        CGP.ui.toast(count + (count === 1 ? ' email' : ' emails') + ' copied');
      }, function () { CGP.ui.error('Couldn’t copy to the clipboard.'); });
    } else if (what === 'table') {
      var t = this.currentTable();
      copy(fmt.toTsv(t, this.prefs.header), fmt.toHtml(t, this.prefs.header)).then(function () {
        CGP.ui.toast('Roster copied (' + t.body.length + (t.body.length === 1 ? ' student)' : ' students)'));
      }, function () { CGP.ui.error('Couldn’t copy to the clipboard.'); });
    } else if (what === 'csv') {
      download(fmt.toCsv(this.currentTable(), this.prefs.header), fileName(this.courseName()));
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
