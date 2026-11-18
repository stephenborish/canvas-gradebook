/* Canvas Gradebook+ - copy to the teacher's linked courses right from
 * Canvas's own editor.
 *
 * "Linked courses" are separate Canvas course shells the teacher teaches
 * as the same course (one per class period). ("Sections" are only ever
 * the sections inside one course shell.)
 *
 * On Canvas's create/edit page for an assignment, quiz, discussion or page
 * in a linked course, a panel sits just above the Save button: one row per
 * linked course, each answering before Save: which class, what will happen
 * to its copy (a new copy, its copy updated, or only its dates when it was
 * edited there), and what its due date will be (the same as this class,
 * its own date kept, a new date, or - when its date could not be read -
 * left exactly as it is unless the teacher types one).
 *
 * Canvas then opens the saved item's page, and the copies are made there:
 * Canvas's own course copy into each ticked course (sync-runner.js run()),
 * then that course's dates. A banner shows each course's outcome, and its
 * headline is counted from those same outcomes.
 *
 * What the panel holds is kept on this computer while the teacher edits
 * (chrome.storage.local), because saving loads a new page. It is tied to
 * the one editor it came from: pressing Save writes that editor's id into
 * this tab's sessionStorage, and only the next page this tab opens may use
 * it - and only if it is the saved item (same id, or created since with the
 * same title) and that item changed since. A timestamp or a title alone
 * never does: an editor that was never saved, or another tab's save, copies
 * nothing. Cancel forgets it. It is claimed once (two tabs never both copy),
 * and forgotten after half an hour.
 *
 * While the copies run, their progress is kept too, so a reload of the page
 * picks the banner back up and finishes Canvas's copy instead of starting a
 * second one.
 *
 * The same checklist (no dates) is added to Canvas's Add Module dialog: the
 * new module is copied to the ticked courses once Canvas has created it. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.InlineSectionCopy) return;

  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  function S() { return CGP.sectionSync; }

  var INTENT_PREFIX = 'cgp.inline.intent.';
  var RUN_PREFIX = 'cgp.inline.run.';
  var CLAIM_PREFIX = 'cgp.inline.claim.';
  var PREFS_PREFIX = 'cgp.inline.prefs.';
  var SESSION_SAVED = 'cgp.inline.saved';
  var SESSION_RUN = 'cgp.inline.run';
  var INTENT_TTL_MS = 30 * 60 * 1000;
  var RUN_TTL_MS = 3 * 3600 * 1000;
  var SAVE_TEXT = /^\s*(save|save\s*(&|and)\s*publish|publish|update|update\s+module|add\s+module|build)\s*$/i;
  var CANCEL_TEXT = /^\s*cancel\s*$/i;

  /** The date fields the panel offers for a type. */
  function panelFields(type) {
    if (type === 'assignment' || type === 'quiz' || type === 'discussion') return ['due_at', 'unlock_at', 'lock_at'];
    return [];
  }

  function store() {
    var local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    return local || null;
  }

  function syncStore() {
    var sync = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    return sync || null;
  }

  function sGet(ss, k) { try { var v = ss && ss.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sSet(ss, k, v) { try { if (ss) ss.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function sDel(ss, k) { try { if (ss) ss.removeItem(k); } catch (e) { /* storage blocked */ } }
  function token() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

  function InlineSectionCopy(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.controller = ctx.controller;           // SectionCopyController (names, linking, the item on screen)
    this.copier = ctx.controller && ctx.controller.copier ? ctx.controller.copier : new CGP.SectionCopier({ api: ctx.api });
    this.origin = typeof location !== 'undefined' ? location.origin : '';
    this._session = ctx.session;                 // tests: a sessionStorage stand-in
    this.claimDelayMs = ctx.claimDelayMs === undefined ? 400 : ctx.claimDelayMs;
    this.path = ctx.path;                        // tests: the page's path
    // This editor (one page load): the id its Save hands to the next page.
    this.editId = token();
    this.panel = null;
    this.state = null;
  }

  var P = InlineSectionCopy.prototype;

  P.session = function () {
    if (this._session !== undefined) return this._session;
    try { return (typeof sessionStorage !== 'undefined' && sessionStorage) || null; } catch (e) { return null; }
  };
  P.pathname = function () { return this.path || (typeof location !== 'undefined' ? location.pathname : ''); };

  /* One entry per editor (two editors open at once never overwrite each
   * other's choices); the saved page uses only the one its Save named. */
  P.intentKey = function (id) { return INTENT_PREFIX + this.origin + '|' + (id || this.editId); };
  P.runKey = function (id) { return RUN_PREFIX + this.origin + '|' + id; };
  // This computer's copy, from versions that kept the choices here only.
  P.prefsKey = function () { return PREFS_PREFIX + this.origin + '.' + this.courseId; };
  // The course's entry in the synced item (CGP.sectionSync.fitClassPrefs).
  P.syncPrefsKey = function () { return this.origin + '.' + this.courseId; };

  P.siblings = function () {
    return S().siblings(this.settings.values.sectionGroups, this.origin, this.courseId);
  };

  P.name = function (id) { return this.controller ? this.controller.courseName(id) : 'Course ' + id; };

  P.start = function () {
    if (!this.settings.values.sectionCopy || window.self !== window.top) return;
    var page = S().editPageFromPath(location.pathname);
    if (page && page.courseId === this.courseId) this.mountPanel(page);
    if (/^\/courses\/\d+\/modules\/?$/.test(location.pathname)) this.watchModuleDialog();
    if (!page) this.runSaved();
  };

  /* ------------------------------------------------------------- panel */

  P.mountPanel = function (page) {
    var self = this;
    var sibs = this.siblings();
    var st = this.state = {
      page: page, sibs: sibs, rows: {}, existing: {}, tz: null, itemId: page.id, armedAt: 0, savedAt: 0,
      openedAt: Date.now(), fields: panelFields(page.type), loading: true, unknown: false
    };
    var tries = 0;
    (function place() {
      if (self.state !== st) return;
      var anchor = self.findSaveRow();
      if (!anchor && tries++ < 40) { setTimeout(place, 250); return; }
      self.renderPanel(anchor);
    })();
    Promise.all([
      this.api.profileTimeZone().catch(function () { return null; }),
      this.readPrefs(),
      CGP.teachingCourseList(this.api).catch(function () { return []; })
    ]).then(function (r) {
      st.tz = r[0] || (Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      var prefs = st.prefs = r[1] || {};
      st.courses = r[2] || [];
      sibs.forEach(function (d) {
        var pref = prefs[d] || {};
        var row = st.rows[d] = { on: pref.on !== false, entry: {}, read: {} };
        // A course's usual due time (its class period) is remembered. (A
        // period-shortcut key saved by an older version is not a time.)
        if (pref.time && S().parseClock(pref.time) && st.fields.length) row.entry.due_at = { date: '', time: pref.time };
      });
      return self.findExisting();
    }).then(function () {
      st.loading = false;
      self.renderBody();
      // Kept from the start: Save loads another page, and a write made only
      // as it is pressed could be lost with the page.
      self.saveIntent();
    }, function () {
      st.loading = false;
      self.renderBody();
    });
    document.addEventListener('click', function (e) { self.onPageClick(e); }, true);
    document.addEventListener('submit', function () { self.markSaved(); }, true);
    // The title as it is typed: a new item is matched to its choices by it.
    var keepTitle = CGP.util.debounce(function () { if (self.state === st) self.saveIntent(); }, 500);
    document.addEventListener('input', function (e) {
      if (e.target && !(e.target.closest && e.target.closest('.cgp-inline'))) keepTitle();
    }, true);
    // The item's version when the editor opened: only a newer one can be
    // this editor's save.
    if (page.id || page.slug) {
      var read = page.type === 'page' ? this.api.pageBySlug(this.courseId, page.slug)
        : this.api.sectionItem(this.courseId, page.type, page.id);
      read.then(function (o) {
        var u = o && Date.parse(o.updated_at || '');
        st.baseUpdated = isFinite(u) ? u : null;
        self.saveIntent();
      }, function () { st.baseUpdated = null; });
    }
  };

  /* A row whose date there is not known: its boxes start blank and marked,
   * so Save leaves that date as it is (a remembered period time is not the
   * teacher changing it). */
  function markUnreadable(row, fields, read) {
    fields.forEach(function (f) {
      row.entry[f] = { date: '', time: '', unreadable: true };
      if (read) row.read[f] = { unreadable: true };
    });
  }

  /* Courses that already have a copy of the item being edited, with that
   * copy's dates (shown in its boxes, so saving does not reset them). */
  P.findExisting = function () {
    var self = this;
    var st = this.state;
    var page = st.page;
    var idRead = page.type === 'page' && page.slug
      ? this.api.pageBySlug(this.courseId, page.slug).then(function (o) { st.itemId = o && o.page_id ? String(o.page_id) : null; })
      : Promise.resolve();
    return idRead.then(function () {
      if (!st.itemId) return null;
      return self.copier.relations(self.courseId, { type: page.type, id: st.itemId }, st.sibs).then(function (rel) {
        // This item is that class's copy: that class has the item it was
        // copied from, and saving updates that one (copier.runBack) rather
        // than adding a second. For the teacher it is the same as any class
        // that already has it.
        st.origins = {};
        var here = { type: page.type, id: st.itemId };
        var there = rel.to.map(function (r) {
          return { courseId: r.courseId, destId: r.destId, ctx: { origCourse: self.courseId, origRef: here, copyCourse: r.courseId, copyId: r.destId }, hereIsOrig: true };
        }).concat(rel.from.map(function (r) {
          return { courseId: r.courseId, destId: r.srcId, ctx: { origCourse: r.courseId, origRef: { type: page.type, id: r.srcId }, copyCourse: self.courseId, copyId: st.itemId }, hereIsOrig: false };
        }));
        return Promise.all(there.map(function (r) {
          st.existing[r.courseId] = { destId: r.destId, ctx: r.ctx };
          self.copier.compare(r.ctx.origCourse, r.ctx.origRef, r.ctx.copyCourse, r.ctx.copyId).then(function (c) {
            var side = c && c.side;
            var editedThere = side === 'both' || side === 'unknown' || (r.hereIsOrig ? side === 'copy' : side === 'original');
            if (editedThere && st.existing[r.courseId]) { st.existing[r.courseId].differs = true; self.renderBody(); }
          }, function () { /* the row stays as it is */ });
          if (!st.fields.length) return null;
          return self.api.dateDetails(r.courseId, page.type, r.destId).then(function (dd) {
            var row = st.rows[r.courseId];
            if (!row) return;
            st.fields.forEach(function (f) {
              var local = S().isoToLocal(dd && dd[f], st.tz);
              // Its date, or that it has none: kept as it is unless changed
              // here (blank would otherwise mean "same as this class").
              var box = local ? { date: local.slice(0, 10), time: CGP.courseCalendar.formatClock(local.slice(11)) } : { date: '', time: '', none: true };
              row.entry[f] = Object.assign({}, box);
              row.read[f] = Object.assign({}, box);
            });
          }, function () {
            // Not known: never shown as blank (which would mean "same as
            // this class" and overwrite it).
            var row = st.rows[r.courseId];
            if (row) markUnreadable(row, st.fields, true);
          });
        }));
      }, function () {
        // Which courses already have it could not be checked: each one's
        // date is left alone unless the teacher types one.
        st.unknown = true;
        st.sibs.forEach(function (d) { if (st.rows[d]) markUnreadable(st.rows[d], st.fields, false); });
      });
    });
  };

  /* Canvas's own Save, wherever this page draws it: the panel goes just
   * above the row it sits in. */
  P.findSaveRow = function () {
    var root = document.querySelector('#content') || document.body;
    var buttons = root.querySelectorAll('button, input[type="submit"], [role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.closest('.cgp-inline')) continue;
      var text = String(b.textContent || b.value || '').replace(/\s+/g, ' ');
      if (!/^\s*save\b/i.test(text)) continue;
      if (b.offsetParent === null && b.getClientRects().length === 0) continue;
      return b.closest('.form-actions, .form-controls, footer, [class*="Footer"], [class*="footer"], [class*="actions"]') || b.parentElement;
    }
    return null;
  };

  P.renderPanel = function (anchor) {
    var el = document.createElement('section');
    el.className = 'cgp-inline';
    el.setAttribute('aria-label', 'Also copy to your linked courses');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
    else { el.classList.add('cgp-inline--floating'); document.body.appendChild(el); }
    this.panel = el;
    var self = this;
    el.addEventListener('change', function (e) { self.onPanelInput(e, true); });
    el.addEventListener('input', function (e) { self.onPanelInput(e, false); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-inline-act]');
      if (!b) return;
      e.preventDefault();
      if (b.getAttribute('data-inline-act') === 'link' && self.controller) self.controller.open({ items: [] });
      if (b.getAttribute('data-inline-act') === 'pick' && self.controller) {
        var ex = self.state && self.state.existing[b.getAttribute('data-d')];
        if (ex && ex.ctx) self.controller.openMatch(ex.ctx, null);
      }
    });
    this.renderBody();
  };

  /* Each row's three answers: which class, what happens to its copy, and
   * its due date. */
  P.rowSummary = function (d) {
    var st = this.state;
    var row = st.rows[d] || { on: true, entry: {}, read: {} };
    var field = st.fields.indexOf('due_at') >= 0 ? 'due_at' : null;
    return S().inlineRowSummary(row, st.existing[d] || null, field, st.unknown);
  };

  P.renderBody = function () {
    var st = this.state;
    var el = this.panel;
    if (!el || !st) return;
    var self = this;
    var thing = S().TYPES[st.page.type].label.toLowerCase();
    var head = '<div class="cgp-inline__head"><strong>Also copy to your linked courses</strong>';
    if (!st.sibs.length) {
      el.innerHTML = head + '</div>' +
        '<p class="cgp-inline__hint">Teach this course to more than one class, each in its own Canvas course? Link those courses once, and this ' + esc(thing) +
        ' can be copied to all of them when you save, each with its own due date.</p>' +
        '<button type="button" class="cgp-roster__btn" data-inline-act="link">Link your courses…</button>';
      return;
    }
    if (st.loading) { el.innerHTML = head + '</div><p class="cgp-inline__hint">Loading your linked courses…</p>'; return; }
    var fields = st.fields;
    var rows = st.sibs.map(function (d) {
      var row = st.rows[d] || { on: true, entry: {} };
      var ex = st.existing[d];
      var sum = self.rowSummary(d);
      var boxes = function (f) {
        var e = row.entry[f] || {};
        var ph = e.unreadable ? 'unknown there' : (e.none ? 'none there' : 'time');
        return '<label class="cgp-inline__date"><span>' + esc(S().DATE_LABELS[f]) + '</span>' +
          '<input type="date" data-d="' + esc(d) + '" data-f="' + f + '" data-part="date" value="' + esc(e.date || '') + '"' + (row.on ? '' : ' disabled') + '>' +
          '<input type="text" class="cgp-inline__time" data-d="' + esc(d) + '" data-f="' + f + '" data-part="time" value="' + esc(e.time || '') + '" placeholder="' + ph + '"' + (row.on ? '' : ' disabled') + '></label>';
      };
      var more = fields.length > 1
        ? '<details class="cgp-inline__more"' + (fields.slice(1).some(function (f) { var e = row.entry[f] || {}; return e.date || e.time; }) ? ' open' : '') +
          '><summary>More dates</summary>' + fields.slice(1).map(boxes).join('') + '</details>'
        : '';
      var problems = self.rowErrors(d);
      var warnAction = sum.actionKind === 'dates' || sum.actionKind === 'unknown';
      return '<div class="cgp-inline__row' + (row.on ? '' : ' is-off') + '" data-row="' + esc(d) + '">' +
        '<label class="cgp-inline__name"><input type="checkbox" data-on="' + esc(d) + '"' + (row.on ? ' checked' : '') + '> ' + esc(self.name(d)) + '</label>' +
        (fields.length ? boxes(fields[0]) : '') + more +
        '<span class="cgp-inline__status' + (warnAction ? ' is-warn' : '') + '" data-action="' + esc(sum.actionKind) + '">' + esc(sum.action) +
        (ex && ex.differs && ex.ctx && self.controller ? ' <button type="button" class="cgp-board__link" data-inline-act="pick" data-d="' + esc(d) + '">Pick a version…</button>' : '') + '</span>' +
        (sum.due ? '<span class="cgp-inline__status cgp-inline__due' + (sum.due.kind === 'unreadable' ? ' is-warn' : '') + '" data-due="' + esc(sum.due.kind) + '">Due: ' + esc(sum.due.text) + '</span>' : '') +
        '<span class="cgp-inline__err" data-err="' + esc(d) + '">' + esc(problems.join('; ')) + '</span></div>';
    }).join('');
    var on = st.sibs.filter(function (d) { return st.rows[d] && st.rows[d].on; }).length;
    el.innerHTML = head +
      '<span class="cgp-inline__count">' + (on ? on + ' of ' + st.sibs.length + ' linked courses get it when you save' : 'None ticked') + '</span></div>' +
      rows +
      (fields.length ? '<p class="cgp-inline__hint">Blank date: same as this class. Time only (like “1:45 pm”): this class’s day at that time' +
        (this.settings.values.courseScheduleEnabled && this.settings.values.courseCalendarUrl ? ', or click the time box to pick that class’s period' : '') +
        '. Times are in ' + esc(st.tz || 'your time zone') + '.</p>' : '');
  };

  /* Problems with a row's boxes. */
  P.rowErrors = function (d) {
    var st = this.state;
    var row = st.rows[d];
    if (!row || !row.on || !st.fields.length) return [];
    var errs = [];
    st.fields.forEach(function (f) {
      var e = row.entry[f] || {};
      if (e.time && !S().parseClock(e.time)) errs.push((S().DATE_LABELS[f]) + ': “' + e.time + '” is not a time');
    }, this);
    return errs;
  };

  P.onPanelInput = function (e, final) {
    var st = this.state;
    var t = e.target;
    if (!st) return;
    if (t.hasAttribute('data-on')) {
      var d0 = t.getAttribute('data-on');
      st.rows[d0] = st.rows[d0] || { on: true, entry: {}, read: {} };
      st.rows[d0].on = !!t.checked;
      this.renderBody();
    } else if (t.hasAttribute('data-d')) {
      var d = t.getAttribute('data-d'), f = t.getAttribute('data-f'), part = t.getAttribute('data-part');
      var row = st.rows[d] = st.rows[d] || { on: true, entry: {}, read: {} };
      row.entry[f] = row.entry[f] || { date: '', time: '' };
      row.entry[f][part] = t.value;
      // "none there" is replaced by what is typed; "unknown there" stays
      // marked, so clearing the boxes again leaves that date alone again.
      if (t.value) row.entry[f].none = false;
      var err = this.panel.querySelector('[data-err="' + d + '"]');
      if (err) err.textContent = this.rowErrors(d).join('; ');
      if (final) this.renderBody();
    } else return;
    st.armedAt = st.armedAt || Date.now();
    this.saveIntent();
    if (final) this.savePrefs();
  };

  /* The course's choices as Chrome sync holds them (made on any of the
   * teacher's computers), else this computer's own from before they synced. */
  P.readPrefs = function () {
    var local = store(), sync = syncStore();
    var k = this.prefsKey(), sk = this.syncPrefsKey();
    var KEY = S().CLASS_PREFS_KEY;
    var fromSync;
    try {
      fromSync = sync ? sync.get(KEY).then(function (r) { return S().classPrefsFor(r && r[KEY], sk); }, function () { return null; }) : Promise.resolve(null);
    } catch (e) { fromSync = Promise.resolve(null); }
    return fromSync.then(function (p) {
      if (p) return p;
      if (!local) return {};
      return local.get(k).then(function (r) { return (r && r[k]) || {}; }, function () { return {}; });
    });
  };

  /* Which courses were ticked, and each one's due time, for next time. */
  P.savePrefs = function () {
    var local = store();
    var st = this.state;
    if (!local || !st) return;
    var prefs = {};
    st.sibs.forEach(function (d) {
      var row = st.rows[d] || {};
      // Unticked only because this item came from there: not a choice to keep.
      if (st.origins && st.origins[d]) { prefs[d] = (st.prefs && st.prefs[d]) || { on: true, time: '' }; return; }
      prefs[d] = { on: row.on !== false, time: row.entry && row.entry.due_at && !row.entry.due_at.date ? row.entry.due_at.time || '' : '' };
    });
    var k = this.prefsKey(), sk = this.syncPrefsKey();
    var KEY = S().CLASS_PREFS_KEY;
    var sync = syncStore();
    var keepHere = function () {
      var o = {};
      o[k] = prefs;
      try { local.set(o).catch(function () { return null; }); } catch (e) { /* orphaned tab */ }
    };
    if (!sync) { keepHere(); return; }
    // One write after another: each reads what the last one stored.
    this._prefsWrite = (this._prefsWrite || Promise.resolve()).then(function () {
      return sync.get(KEY).then(function (r) {
        var o = {};
        o[KEY] = S().fitClassPrefs(r && r[KEY], sk, prefs, Date.now());
        return sync.set(o);
      }).then(function () {
        // Now in Chrome sync: this computer's old copy is not needed.
        return local.remove(k).catch(function () { return null; });
      });
    }).catch(keepHere);
  };

  P.titleOnPage = function () {
    var el = document.querySelector('#assignment_name, input[name="name"], input[name="title"], #discussion-title, input[name="quiz[title]"], #quiz_title, #wiki_page_title, input[aria-label*="itle"]');
    return el ? String(el.value || '').trim() : '';
  };

  /* Kept on this computer as the teacher edits, so it is there when Canvas
   * opens the saved item. Nothing here is used until this editor's Save
   * names it (markSaved). */
  P.saveIntent = function () {
    var local = store();
    var st = this.state;
    if (!local || !st) return Promise.resolve();
    var sections = {};
    st.sibs.forEach(function (d) {
      var row = st.rows[d];
      if (row && row.on) sections[d] = { entry: row.entry || {}, read: row.read || {} };
    });
    var o = {};
    o[this.intentKey()] = {
      editId: this.editId, courseId: this.courseId, type: st.page.type, id: st.itemId || null, isNew: !st.page.id && !st.page.slug,
      armedAt: st.openedAt, savedAt: st.savedAt || 0, title: this.titleOnPage() || st.title || '',
      baseUpdated: st.baseUpdated === undefined ? null : st.baseUpdated,
      sections: sections
    };
    return local.set(o).catch(function () { return null; });
  };

  P.onPageClick = function (e) {
    var b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], [role="button"], a');
    if (!b || b.closest('.cgp-inline') || !this.state) return;
    var text = String(b.textContent || b.value || '').replace(/\s+/g, ' ');
    if (b.tagName !== 'A' && SAVE_TEXT.test(text)) this.markSaved();
    else if (CANCEL_TEXT.test(text)) this.cancel();
  };

  /* Save was pressed in this editor: the next page this tab opens may use
   * its choices (once), and no other page or tab may. */
  P.markSaved = function () {
    var st = this.state;
    if (!st || !st.sibs.length) return Promise.resolve();
    var any = st.sibs.some(function (d) { return st.rows[d] && st.rows[d].on; });
    if (!any) { this.cancel(); return Promise.resolve(); }
    st.armedAt = st.armedAt || st.openedAt || Date.now();
    st.savedAt = Date.now();
    st.title = this.titleOnPage();
    sSet(this.session(), SESSION_SAVED, { editId: this.editId, at: st.savedAt });
    this.savePrefs();
    return this.saveIntent();
  };

  /* Cancel: this editor copies nothing. */
  P.cancel = function () {
    var st = this.state;
    if (st) st.savedAt = 0;
    var ss = this.session();
    var saved = sGet(ss, SESSION_SAVED);
    if (saved && saved.editId === this.editId) sDel(ss, SESSION_SAVED);
    var local = store();
    if (local) return local.remove(this.intentKey()).catch(function () { return null; });
    return Promise.resolve();
  };

  /* Courses linked (or unlinked) after the page opened. */
  P.refresh = function () {
    var st = this.state;
    if (!st) return;
    var sibs = this.siblings();
    if (sibs.join() === st.sibs.join()) return;
    st.sibs = sibs;
    sibs.forEach(function (d) { if (!st.rows[d]) st.rows[d] = { on: true, entry: {}, read: {} }; });
    this.renderBody();
    this.saveIntent();
  };

  /* ------------------------------------------------- after Canvas saves */

  /* The first page this tab opens after an editor's Save: if it is that
   * editor's saved item, make the copies. A reload of a page whose copies
   * were running picks them back up instead. */
  P.runSaved = function () {
    var self = this;
    var local = store();
    if (!local) return Promise.resolve(null);
    var ss = this.session();
    var saved = sGet(ss, SESSION_SAVED);
    var runPtr = sGet(ss, SESSION_RUN);
    // Used up by this page, whichever page it is: a Save that led
    // somewhere else must not be picked up by a later page.
    if (saved) sDel(ss, SESSION_SAVED);
    var here = S().itemFromPath(this.pathname());
    var origin = this.origin;
    return local.get(null).then(function (all) {
      all = all || {};
      var now = Date.now();
      var gone = Object.keys(all).filter(function (k) {
        var v = all[k];
        if (k.indexOf(INTENT_PREFIX + origin + '|') === 0) return !v || now - Number(v.savedAt || v.armedAt || 0) > INTENT_TTL_MS;
        if (k.indexOf(CLAIM_PREFIX + origin + '|') === 0) return !v || now - Number(v.at || 0) > INTENT_TTL_MS;
        if (k.indexOf(RUN_PREFIX + origin + '|') === 0) return !v || now - Number(v.at || 0) > RUN_TTL_MS;
        return false;
      });
      if (gone.length) local.remove(gone).catch(function () { return null; });
      var live = function (k) { return gone.indexOf(k) < 0 ? all[k] : null; };

      if (!saved && runPtr) {
        var rec = live(self.runKey(runPtr.editId));
        if (rec && rec.path === self.pathname()) return self.recover(rec);
        sDel(ss, SESSION_RUN);
        return null;
      }
      if (!saved || !saved.editId || now - Number(saved.at || 0) > INTENT_TTL_MS) return null;
      var key = self.intentKey(saved.editId);
      var it = live(key);
      if (!it || it.editId !== saved.editId) return null;
      var sameType = here && here.courseId === self.courseId && it.courseId === self.courseId &&
        (here.type === it.type || (it.type === 'discussion' && here.type === 'announcement'));
      var check = sameType ? self.matchSaved(it, here) : Promise.resolve(null);
      return check.then(function (item) {
        if (!item) {
          // That editor's Save led here, and this is not its item: its
          // choices are not waiting for any other page.
          CGP.diag.log('inline.notMatched', { type: it.type });
          return local.remove(key).then(function () { return null; });
        }
        return self.claim(saved.editId).then(function (won) {
          if (!won) return null;
          // The page's own "not in your other classes yet" notice waits for
          // this copy instead of reporting the classes it is about to fill.
          if (self.controller) self.controller.inlineCopying = true;
          return local.remove(key).then(function () { return self.copyNow(item, it); });
        });
      });
    }).catch(function (e) { CGP.diag.warn('inline.runFailed', { message: String(e && e.message) }); });
  };

  /* Used once, by one tab: each tab writes its own mark, and after a short
   * wait only the tab whose mark stayed goes on. */
  P.claim = function (editId) {
    var local = store();
    var self = this;
    var k = CLAIM_PREFIX + this.origin + '|' + editId;
    var me = token();
    return local.get(k).then(function (r) {
      if (r && r[k]) return false;
      var o = {};
      o[k] = { by: me, at: Date.now() };
      return local.set(o).then(function () {
        return new Promise(function (res) { setTimeout(res, self.claimDelayMs); });
      }).then(function () { return local.get(k); }).then(function (r2) { return !!(r2 && r2[k] && r2[k].by === me); });
    }).catch(function () { return false; });
  };

  /* The saved item, if it is the one this editor saved: Save seen, and the
   * same id (edit) or created since the editor opened with the title typed
   * there (new), and changed since the editor opened and since its Save.
   * null otherwise. */
  P.matchSaved = function (intent, here) {
    if (!intent || !intent.savedAt) return Promise.resolve(null);
    var api = this.api;
    var read = here.type === 'page' ? api.pageBySlug(this.courseId, here.slug)
      : api.sectionItem(this.courseId, here.type === 'announcement' ? 'discussion' : here.type, here.id);
    var self = this;
    return read.then(function (o) {
      if (!o) return null;
      var id = String(here.type === 'page' ? o.page_id : o.id);
      // Canvas's clock and this computer's can differ a little.
      var slack = 120000;
      if (intent.isNew) {
        var created = Date.parse(o.created_at || o.posted_at || '');
        if (!(created >= Number(intent.armedAt) - slack) || !(created >= Number(intent.savedAt) - slack)) return null;
        var title = String(o.name || o.title || '').trim();
        if (intent.title && intent.title !== title) return null;
      } else {
        if (String(intent.id) !== id) return null;
        var updated = Date.parse(o.updated_at || '');
        if (isFinite(updated)) {
          if (intent.baseUpdated !== null && intent.baseUpdated !== undefined && !(updated > Number(intent.baseUpdated))) return null;
          if (updated < Number(intent.savedAt) - slack) return null;
        }
      }
      return self.controller.currentItem();
    });
  };

  /* One destination's task, from the survey and the editor's boxes. Its
   * date that could not be read before Save is read again now: Canvas's copy
   * replaces that class's dates, so a copy over an unknown date is not made. */
  P.planDest = function (item, d, survey, intent, tz) {
    var sync = S();
    var self = this;
    var dest = survey.dests.filter(function (x) { return String(x.courseId) === d; })[0] || {};
    var info = (dest.items || {})[item.type + ':' + item.id] || {};
    if (dest.error) return Promise.resolve({ error: dest.error, retry: 'copy' });
    if (info.lookalike && !info.destId) {
      return Promise.resolve({ error: 'It has its own “' + info.lookalike.title + '”, so a copy would be a second one. Use Copy to other classes to add it anyway.' });
    }
    var existing = !!(info.destId && info.status !== 'restore');
    var keep = existing && !sync.defaultReplace(info.status);
    var fresh = !info.status || info.status === 'new';
    var mode = keep ? 'keep' : (existing || info.origin ? 'update' : 'copy');
    var entry = clone((intent.sections[d] || {}).entry);
    // Nothing there to leave alone: blank boxes are this class's date.
    if (!existing) Object.keys(entry).forEach(function (f) { if (entry[f]) delete entry[f].unreadable; });
    var res = sync.resolveInline(sync.dateFields(item), item.dates || {}, entry, tz);
    if (res.errors.length) return Promise.resolve({ error: res.errors.join('; ') + '.' });
    var iso = Promise.resolve(res.iso);
    if (res.keep.length && mode === 'update' && !info.origin) {
      iso = this.api.dateDetails(d, item.type, info.destId).then(function (dd) {
        var out = Object.assign({}, res.iso);
        var ok = res.keep.every(function (f) { return dd && dd[f] !== undefined; });
        if (!ok) return null;
        res.keep.forEach(function (f) { out[f] = dd[f] || null; });
        return out;
      }, function () { return null; });
    }
    return iso.then(function (dates) {
      if (!dates) {
        return { error: 'Its due date there couldn’t be read, and copying would replace it. Try again, or type its date in the editor.', retry: 'copy', mode: mode };
      }
      return {
        mode: mode, iso: dates,
        task: {
          srcCourseId: self.courseId, destCourseId: d, destName: self.name(d), item: item,
          mode: keep ? 'keep' : 'copy', dates: dates, children: [], note: info.note || '', publish: 'match',
          module: fresh ? info.module : null, assignmentGroupId: fresh ? info.assignmentGroupId : null,
          destId: info.destId || null, origin: info.origin ? true : undefined, mapping: dest.mapping || {}, childNotes: {}
        }
      };
    });
  };

  /* only: the courses to copy to (a retry), else every ticked one. banner:
   * the banner to report into (a retry), else a new one. */
  P.copyNow = function (item, intent, only, banner) {
    var self = this;
    var dests = Object.keys(intent.sections || {}).filter(function (d) { return self.siblings().indexOf(d) >= 0; });
    if (only) dests = dests.filter(function (d) { return only.indexOf(d) >= 0; });
    if (!dests.length || !item) return Promise.resolve();
    banner = banner || this.banner(item, dests, intent);
    // A page's own availability dates are not set from this panel.
    if (item.type === 'page') item.noDates = true;
    if (item.newQuiz) {
      banner.done('This is a New Quiz: add its questions first, then use Copy to other classes to copy it to your linked courses.');
      return Promise.resolve();
    }
    dests.forEach(function (d) { banner.set(d, { step: 'Looking at that course', error: null, result: null, unknown: null, retry: null }); });
    var tz;
    return this.api.profileTimeZone().catch(function () { return null; }).then(function (z) {
      tz = z || Intl.DateTimeFormat().resolvedOptions().timeZone;
      return self.copier.survey(self.courseId, [item], dests, { placeInModules: true });
    }).then(function (survey) {
      var gate = CGP.util.pool(3);
      return Promise.all(dests.map(function (d) {
        return self.planDest(item, d, survey, intent, tz).then(function (plan) {
          if (!plan.task) { banner.set(d, { error: plan.error, retry: plan.retry || null, mode: plan.mode }); return null; }
          banner.set(d, { mode: plan.mode, iso: plan.iso, step: 'Waiting' });
          return gate(function () {
            return self.copier.run(plan.task, function (step) { banner.set(d, { step: step }); }).then(function (r) {
              if (plan.mode === 'keep' && r.ok) r.warnings.unshift('Its version there was edited in that class, so only its dates changed. To replace it, use Copy to other classes.');
              banner.set(d, { result: r });
            });
          });
        });
      }));
    }).then(function () { banner.finish(); }, function (err) {
      var msg = 'Could not reach your linked courses: ' + CGP.util.describeApiError(err, { fallback: 'Canvas did not answer' });
      dests.forEach(function (d) { banner.set(d, { error: msg, retry: 'copy' }); });
      banner.finish();
    });
  };

  /* A reload while the copies ran: show what was known, finish Canvas's
   * copy jobs this tab had started, and never start a second copy. */
  P.recover = function (rec) {
    var self = this;
    var item0 = rec.item;
    var dests = Object.keys(rec.lines || {});
    var current = this.controller && this.controller.currentItem ? this.controller.currentItem().catch(function () { return null; }) : Promise.resolve(null);
    return current.then(function (it) {
      var item = it || item0;
      var banner = self.banner(item, dests, { editId: rec.editId, sections: rec.sections }, rec);
      var JOB = CGP.SectionCopier.JOB_PREFIX;
      return self.copier.store.get(null).then(function (all) {
        var jobs = Object.keys(all || {}).filter(function (k) { return k.indexOf(JOB) === 0; }).map(function (k) { return all[k]; });
        return Promise.all(dests.map(function (d) {
          var l = rec.lines[d] || {};
          if (l.phase === 'done') return null;
          if (l.phase === 'waiting') {
            banner.set(d, { error: 'Not started: the page reloaded before this course’s copy began.', retry: 'copy', result: null });
            return null;
          }
          var job = l.phase === 'copying' && jobs.filter(function (j) {
            return (j.tasks || (j.task ? [j.task] : [])).some(function (t) {
              return String(t.destCourseId) === d && String(t.item.id) === String(item0.id) && t.item.type === item0.type;
            });
          })[0];
          if (job) {
            banner.set(d, { step: 'Canvas is copying' });
            var results = (job.tasks || [job.task]).map(function () { return { ok: false, destId: null, url: null, warnings: [], pending: false, error: null }; });
            return self.copier.saveJob(job).then(function () {
              return self.copier.continueJob(job, results, function (i, step) { banner.set(d, { step: step }); });
            }).then(function (rs) { banner.set(d, { result: rs[0] }); });
          }
          if (l.phase === 'copying') {
            // Finished while the page reloaded: find the copy, and offer its
            // dates again rather than a second copy.
            return self.copier.survey(self.courseId, [item], [d], {}).then(function (sv) {
              var dest = sv.dests[0] || {};
              var info = (dest.items || {})[item.type + ':' + item.id] || {};
              if (info.destId) {
                banner.set(d, { result: { ok: true, destId: info.destId, url: info.url || null, warnings: [], pending: false,
                  error: 'The page reloaded before its due date was confirmed.', dates: l.iso ? 'failed' : 'ok' } });
              } else banner.set(d, { unknown: 'The page reloaded while Canvas was copying. Check that course in a few minutes before copying again.' });
            }, function () {
              banner.set(d, { unknown: 'The page reloaded while Canvas was copying. Check that course in a few minutes before copying again.' });
            });
          }
          // A copy request may already have reached Canvas: never sent again.
          banner.set(d, { unknown: 'The page reloaded just as this started. Check that course before copying again.' });
          return null;
        }));
      }).then(function () { banner.finish(); });
    }).catch(function (e) { CGP.diag.warn('inline.recoverFailed', { message: String(e && e.message) }); });
  };

  /* The banner at the top of the saved item's page. Its headline is counted
   * from the same outcomes its rows show (sectionSync.inlineOutcome). */
  P.banner = function (item, dests, intent, rec) {
    var self = this;
    var box = document.createElement('div');
    box.className = 'cgp-inline-banner';
    box.setAttribute('role', 'status');
    var lines = {};
    dests.forEach(function (d) { lines[d] = rec && rec.lines && rec.lines[d] ? clone(rec.lines[d]) : { step: 'Waiting', phase: 'waiting' }; });
    var title = item.title || S().TYPES[item.type].label;
    var editId = intent && intent.editId;
    var ss = this.session();
    var local = store();
    var announced = false;
    var record = function () {
      if (!editId || !local) return;
      var o = {};
      o[self.runKey(editId)] = {
        editId: editId, path: self.pathname(), courseId: self.courseId, at: Date.now(),
        item: { type: item.type, id: String(item.id), title: item.title || '', graded: !!item.graded, noDates: !!item.noDates, published: !!item.published },
        sections: intent.sections || {}, lines: lines
      };
      local.set(o).catch(function () { return null; });
    };
    if (editId) sSet(ss, SESSION_RUN, { editId: editId });
    var outcomes = function () { return dests.map(function (d) { return S().inlineOutcome(lines[d]); }); };
    function paint() {
      var outs = outcomes();
      var head = S().inlineHeadline(outs, title);
      box.innerHTML = '<div class="cgp-sections-notice__head"><strong data-headline>' + esc(head.text) + '</strong>' +
        (head.final ? '<button type="button" class="cgp-sections__x" aria-label="Close">×</button>' : '') + '</div>' +
        dests.map(function (d, i) {
          var l = lines[d];
          var o = outs[i];
          var r = l.result;
          var icon = { copied: '✓', updated: '✓', dates: '✓', 'date-failed': '!', copying: '…', working: '…', failed: '×', unknown: '?' }[o.state];
          var link = r && r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Open</a>' : '';
          var warns = r && r.warnings && r.warnings.length ? '<ul>' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '';
          var btn = '';
          if (o.state === 'date-failed' && r && r.destId && l.iso) btn = ' <button type="button" class="cgp-board__link" data-retry-date="' + esc(d) + '">Retry due date</button>';
          else if (o.state === 'failed' && l.retry === 'copy') btn = ' <button type="button" class="cgp-board__link" data-retry-copy="' + esc(d) + '">Try again</button>';
          return '<div class="cgp-sections-notice__line" data-line="' + esc(d) + '" data-state="' + o.state + '"><span class="cgp-inline-banner__icon">' + icon + '</span> <strong>' +
            esc(self.name(d)) + '</strong> · <span data-label>' + esc(o.label) + '</span>' + (o.detail ? ': ' + esc(o.detail) : '') + link + btn + warns + '</div>';
        }).join('');
      return head;
    }
    var host = document.querySelector('#content') || document.body;
    host.insertBefore(box, host.firstChild);
    var api = {
      el: box,
      lines: lines,
      set: function (d, patch) {
        var l = lines[d];
        Object.assign(l, patch);
        // Where it got to, for a reload: a copy request may have gone out
        // once Canvas's copy is being started.
        if (l.result && !l.result.pending) l.phase = 'done';
        else if (l.result && l.result.pending) l.phase = 'copying';
        else if (l.error || l.unknown) l.phase = 'done';
        else if (patch.step === 'Canvas is copying') l.phase = 'copying';
        else if (patch.step && /^Starting|^Updating|^Reading/.test(patch.step)) l.phase = 'starting';
        else if (patch.step && l.phase !== 'copying' && l.phase !== 'starting') l.phase = 'waiting';
        paint();
        record();
      },
      finish: function () {
        var head = paint();
        record();
        if (!head.final) return;
        if (dests.every(function (d) { return lines[d].phase === 'done'; }) && editId) sDel(ss, SESSION_RUN);
        if (announced) return;
        announced = true;
        if (head.ok) CGP.ui.toast(head.text + '.');
        else CGP.ui.error(head.text + '. See the top of the page.');
      },
      done: function (msg) { box.innerHTML = '<div class="cgp-sections-notice__line">' + esc(msg) + '</div>'; }
    };
    box.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      if (t.closest('.cgp-sections__x')) { box.remove(); return; }
      var rd = t.closest('[data-retry-date]');
      if (rd) {
        var d = rd.getAttribute('data-retry-date');
        self.retryDate(api, item, d);
        return;
      }
      var rc = t.closest('[data-retry-copy]');
      if (rc) self.retryCopy(api, intent, rc.getAttribute('data-retry-copy'));
    });
    paint();
    record();
    return api;
  };

  /* Only the due date, onto the copy that exists: never a second copy. */
  P.retryDate = function (banner, item, d) {
    var l = banner.lines[d];
    var r = l.result;
    if (!r || !r.destId || !l.iso) return Promise.resolve();
    banner.set(d, { step: 'Setting dates' });
    return this.copier.retryDates(d, item, r.destId, l.iso).then(function (x) {
      var next = Object.assign({}, r, { dates: x.dates, warnings: x.warnings, error: x.dates === 'failed' ? (x.warnings[0] || 'Canvas refused the dates.') : null });
      banner.set(d, { result: next });
      banner.finish();
    });
  };

  /* A course that was not copied: looked at afresh (a copy made meanwhile
   * is found and updated, not doubled), then copied. */
  P.retryCopy = function (banner, intent, d) {
    var self = this;
    var current = this.controller ? this.controller.currentItem() : Promise.resolve(null);
    return current.then(function (item) {
      if (!item) return null;
      return self.copyNow(item, intent, [d], banner);
    });
  };

  /* --------------------------------------------- Canvas's Add Module dialog */

  P.watchModuleDialog = function () {
    var self = this;
    if (!this.siblings().length) return;
    var obs = new MutationObserver(function () { self.decorateModuleDialog(); });
    obs.observe(document.body, { childList: true, subtree: true });
    this.decorateModuleDialog();
  };

  P.moduleNameInput = function () {
    var el = document.querySelector('#context_module_name, input[name="context_module[name]"], input[name="name"][id*="module" i]');
    if (el) return el;
    var inputs = document.querySelectorAll('[role="dialog"] input[type="text"], form input[type="text"]');
    for (var i = 0; i < inputs.length; i++) {
      var lab = inputs[i].labels && inputs[i].labels[0] ? inputs[i].labels[0].textContent : (inputs[i].getAttribute('aria-label') || '');
      if (/module name/i.test(lab)) return inputs[i];
    }
    return null;
  };

  P.decorateModuleDialog = function () {
    var input = this.moduleNameInput();
    if (!input || input.offsetParent === null) return;
    var scope = input.closest('[role="dialog"], form, .ui-dialog') || input.parentElement;
    if (!scope || scope.querySelector('.cgp-inline--module')) return;
    // Editing an existing module's settings uses the same dialog: only a
    // new module (its name box empty when the dialog opens) is offered.
    if (String(input.value || '').trim()) return;
    var self = this;
    var sibs = this.siblings();
    var box = document.createElement('div');
    box.className = 'cgp-inline cgp-inline--module';
    box.innerHTML = '<div class="cgp-inline__head"><strong>Also add this module to your linked courses</strong></div>' +
      sibs.map(function (d) {
        return '<label class="cgp-inline__name"><input type="checkbox" data-mod-on="' + esc(d) + '" checked> ' + esc(self.name(d)) + '</label>';
      }).join('') +
      '<p class="cgp-inline__hint">Each ticked course gets a copy once Canvas has created the module.</p>';
    var field = input.closest('.form-group, .ic-Form-control, [class*="FormField"], label, div') || input;
    field.parentNode.insertBefore(box, field.nextSibling);
    var maxId = this.api.courseItems(this.courseId, 'module').then(function (mods) {
      return (mods || []).reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0);
    }, function () { return null; });
    scope.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button, input[type="submit"]');
      if (!b || box.contains(b)) return;
      if (!/^\s*(add module|add|save|create)\s*$/i.test(String(b.textContent || b.value || ''))) return;
      var dests = Array.prototype.filter.call(box.querySelectorAll('[data-mod-on]'), function (c) { return c.checked; })
        .map(function (c) { return c.getAttribute('data-mod-on'); });
      var name = String(input.value || '').trim();
      if (!dests.length || !name) return;
      maxId.then(function (max) { if (max !== null) self.followNewModule(name, max, dests); });
    }, true);
  };

  /* Canvas creates the module in the background: look for it (a module
   * newer than any before, with that name) for a little while, then copy. */
  P.followNewModule = function (name, maxId, dests) {
    var self = this;
    var waits = [1500, 3000, 5000, 8000, 12000];
    (function look(i) {
      if (i >= waits.length) { CGP.ui.error('The new module did not show up in Canvas, so it was not copied. Use Copy to other classes.'); return; }
      setTimeout(function () {
        self.api.courseItems(self.courseId, 'module').then(function (mods) {
          var hit = (mods || []).filter(function (m) { return Number(m.id) > maxId && String(m.name || '').trim() === name; })[0];
          if (!hit) return look(i + 1);
          var item = S().toItem('module', hit);
          item.children = [];
          return self.copyNow(item, { sections: dests.reduce(function (o, d) { o[d] = { entry: {} }; return o; }, {}) });
        }, function () { look(i + 1); });
      }, waits[i]);
    })(0);
  };

  CGP.InlineSectionCopy = InlineSectionCopy;
  CGP.inlineCopy = { panelFields: panelFields, SAVE_TEXT: SAVE_TEXT, CANCEL_TEXT: CANCEL_TEXT, SESSION_SAVED: SESSION_SAVED, SESSION_RUN: SESSION_RUN };
})();
