/* Canvas Gradebook+ - post to the other sections right from Canvas's own
 * editor.
 *
 * On Canvas's create/edit page for an assignment, quiz, discussion or page
 * in a linked course, a panel sits just above the Save button: "Also post
 * to your other sections", one row per linked section, each with its own
 * due date and time (and, under More dates, available from / until). The
 * teacher ticks the sections, sets their dates, and presses Canvas's own
 * Save as usual.
 *
 * Canvas then opens the saved item's page, and the copies are made there:
 * Canvas's own course copy into each ticked section (sync-runner.js run(),
 * the same as Copy to sections), then that section's dates. A banner shows
 * each section's progress and links to its copy.
 *
 * What the panel holds is kept on this computer while the teacher edits
 * (chrome.storage.local), because saving loads a new page. It is used only
 * when the saved item is really the one edited - the same id (edit) or
 * created since the panel was set, with the same title (new) - and only if
 * it was saved since: an edit that is cancelled copies nothing. It is used
 * once, and forgotten after half an hour.
 *
 * The same checklist (no dates) is added to Canvas's Add Module dialog: the
 * new module is copied to the ticked sections once Canvas has created it. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.InlineSectionCopy) return;

  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  function S() { return CGP.sectionSync; }

  var INTENT_PREFIX = 'cgp.inline.intent.';
  var PREFS_PREFIX = 'cgp.inline.prefs.';
  var INTENT_TTL_MS = 30 * 60 * 1000;
  var SAVE_TEXT = /^\s*(save|save\s*(&|and)\s*publish|publish|update|update\s+module|add\s+module|build)\s*$/i;

  /** The date fields the panel offers for a type. */
  function panelFields(type) {
    if (type === 'assignment' || type === 'quiz' || type === 'discussion') return ['due_at', 'unlock_at', 'lock_at'];
    return [];
  }

  function store() {
    var local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    return local || null;
  }

  function InlineSectionCopy(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.controller = ctx.controller;           // SectionCopyController (names, linking, the item on screen)
    this.copier = ctx.controller ? ctx.controller.copier : new CGP.SectionCopier({ api: ctx.api });
    this.origin = typeof location !== 'undefined' ? location.origin : '';
    this.panel = null;
    this.state = null;
  }

  var P = InlineSectionCopy.prototype;

  /* One entry per editor tab (two editors open at once never overwrite
   * each other's choices); the saved page uses only the one that matches. */
  P.intentKey = function () {
    if (!this.tabToken) this.tabToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return INTENT_PREFIX + this.origin + '|' + this.tabToken;
  };
  P.prefsKey = function () { return PREFS_PREFIX + this.origin + '.' + this.courseId; };

  P.siblings = function () {
    return S().siblings(this.settings.values.sectionGroups, this.origin, this.courseId);
  };

  P.name = function (id) { return this.controller ? this.controller.courseName(id) : 'Course ' + id; };

  P.start = function () {
    if (!this.settings.values.sectionCopy || window.self !== window.top) return;
    var page = S().editPageFromPath(location.pathname);
    if (page && page.courseId === this.courseId) this.mountPanel(page);
    if (/^\/courses\/\d+\/modules\/?$/.test(location.pathname)) this.watchModuleDialog();
    this.runSaved();
  };

  /* ------------------------------------------------------------- panel */

  P.mountPanel = function (page) {
    var self = this;
    var sibs = this.siblings();
    var st = this.state = {
      page: page, sibs: sibs, rows: {}, existing: {}, tz: null, itemId: page.id, armedAt: 0, savedAt: 0,
      openedAt: Date.now(), fields: panelFields(page.type), loading: true
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
      var prefs = r[1] || {};
      st.courses = r[2] || [];
      sibs.forEach(function (d) {
        var pref = prefs[d] || {};
        var row = st.rows[d] = { on: pref.on !== false, entry: {} };
        // A section's usual due time (its class period) is remembered.
        if (pref.time && st.fields.length) row.entry.due_at = { date: '', time: pref.time };
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
    // 1. The item's version when the editor opened: a later save is one
    // made from this editor; an earlier one is not.
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

  /* Sections that already have a copy of the item being edited, with that
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
        return Promise.all(rel.to.map(function (r) {
          st.existing[r.courseId] = { destId: r.destId };
          if (!st.fields.length) return null;
          return self.api.dateDetails(r.courseId, page.type, r.destId).then(function (dd) {
            var row = st.rows[r.courseId];
            if (!row) return;
            st.fields.forEach(function (f) {
              var local = S().isoToLocal(dd && dd[f], st.tz);
              // Its date, or that it has none: kept as it is unless changed
              // here (blank would otherwise mean "same as this class").
              row.entry[f] = local ? { date: local.slice(0, 10), time: CGP.timeShortcuts.format(local.slice(11)) } : { date: '', time: '', none: true };
            });
          }, function () { /* boxes stay as they are */ });
        }));
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
    el.setAttribute('aria-label', 'Also post to your other classes');
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
    });
    this.renderBody();
  };

  P.renderBody = function () {
    var st = this.state;
    var el = this.panel;
    if (!el || !st) return;
    var self = this;
    var thing = S().TYPES[st.page.type].label.toLowerCase();
    if (!st.sibs.length) {
      el.innerHTML = '<div class="cgp-inline__head"><strong>Also post to your other classes</strong></div>' +
        '<p class="cgp-inline__hint">Teach this course to more than one class? Choose those classes once, and this ' + esc(thing) +
        ' can be posted to all of them when you save, each with its own due date.</p>' +
        '<button type="button" class="cgp-roster__btn" data-inline-act="link">Choose your classes…</button>';
      return;
    }
    if (st.loading) { el.innerHTML = '<div class="cgp-inline__head"><strong>Also post to your other classes</strong></div><p class="cgp-inline__hint">Loading your classes…</p>'; return; }
    var fields = st.fields;
    var rows = st.sibs.map(function (d) {
      var row = st.rows[d] || { on: true, entry: {} };
      var ex = st.existing[d];
      var status = ex ? 'Has a copy: saving updates it (and these dates).' : 'Gets a copy when you save.';
      var boxes = function (f) {
        var e = row.entry[f] || {};
        return '<label class="cgp-inline__date"><span>' + esc(S().DATE_LABELS[f]) + '</span>' +
          '<input type="date" data-d="' + esc(d) + '" data-f="' + f + '" data-part="date" value="' + esc(e.date || '') + '"' + (row.on ? '' : ' disabled') + '>' +
          '<input type="text" class="cgp-inline__time" data-d="' + esc(d) + '" data-f="' + f + '" data-part="time" value="' + esc(e.time || '') + '" placeholder="' + (e.none ? 'none there' : 'time or period') + '"' + (row.on ? '' : ' disabled') + '></label>';
      };
      var more = fields.length > 1
        ? '<details class="cgp-inline__more"' + (fields.slice(1).some(function (f) { var e = row.entry[f] || {}; return e.date || e.time; }) ? ' open' : '') +
          '><summary>More dates</summary>' + fields.slice(1).map(boxes).join('') + '</details>'
        : '';
      var problems = self.rowErrors(d);
      return '<div class="cgp-inline__row' + (row.on ? '' : ' is-off') + '">' +
        '<label class="cgp-inline__name"><input type="checkbox" data-on="' + esc(d) + '"' + (row.on ? ' checked' : '') + '> ' + esc(self.name(d)) + '</label>' +
        (fields.length ? boxes(fields[0]) : '') + more +
        '<span class="cgp-inline__status">' + esc(status) + '</span>' +
        '<span class="cgp-inline__err" data-err="' + esc(d) + '">' + esc(problems.join('; ')) + '</span></div>';
    }).join('');
    var on = st.sibs.filter(function (d) { return st.rows[d] && st.rows[d].on; }).length;
    el.innerHTML = '<div class="cgp-inline__head"><strong>Also post to your other classes</strong>' +
      '<span class="cgp-inline__count">' + (on ? on + ' of ' + st.sibs.length + ' will get it when you save' : 'None ticked') + '</span></div>' +
      rows +
      (fields.length ? '<p class="cgp-inline__hint">Leave a date blank for the same as this class. A time alone (or a period shortcut, like ' +
        esc(this.firstShortcut()) + ') means this class’s day at that time. Times are in ' + esc(st.tz || 'your time zone') + '.</p>' : '') +
      '<p class="cgp-inline__hint">The copies are made when the saved ' + esc(thing) + ' opens, through Canvas’s own course copy.</p>';
  };

  P.firstShortcut = function () {
    var list = this.settings.values.timeShortcuts || [];
    return list.length ? '“' + list[list.length > 3 ? 3 : 0].key + '”' : '“1:45 pm”';
  };

  /* Problems with a row's boxes, checked against a stand-in for this
   * section's dates (its real ones are only known once it is saved). */
  P.rowErrors = function (d) {
    var st = this.state;
    var row = st.rows[d];
    if (!row || !row.on || !st.fields.length) return [];
    var errs = [];
    st.fields.forEach(function (f) {
      var e = row.entry[f] || {};
      if (e.time && !S().parseClock(e.time, this.settings.values.timeShortcuts)) errs.push((S().DATE_LABELS[f]) + ': “' + e.time + '” is not a time or period shortcut');
    }, this);
    return errs;
  };

  P.onPanelInput = function (e, final) {
    var st = this.state;
    var t = e.target;
    if (!st) return;
    if (t.hasAttribute('data-on')) {
      var d0 = t.getAttribute('data-on');
      st.rows[d0] = st.rows[d0] || { on: true, entry: {} };
      st.rows[d0].on = !!t.checked;
      this.renderBody();
    } else if (t.hasAttribute('data-d')) {
      var d = t.getAttribute('data-d'), f = t.getAttribute('data-f'), part = t.getAttribute('data-part');
      var row = st.rows[d] = st.rows[d] || { on: true, entry: {} };
      row.entry[f] = row.entry[f] || { date: '', time: '' };
      row.entry[f][part] = t.value;
      if (t.value) row.entry[f].none = false;
      var err = this.panel.querySelector('[data-err="' + d + '"]');
      if (err) err.textContent = this.rowErrors(d).join('; ');
    } else return;
    st.armedAt = st.armedAt || Date.now();
    this.saveIntent();
    if (final) this.savePrefs();
  };

  P.readPrefs = function () {
    var local = store();
    var k = this.prefsKey();
    if (!local) return Promise.resolve({});
    return local.get(k).then(function (r) { return (r && r[k]) || {}; }, function () { return {}; });
  };

  /* Which sections were ticked, and each one's due time, for next time. */
  P.savePrefs = function () {
    var local = store();
    var st = this.state;
    if (!local || !st) return;
    var prefs = {};
    st.sibs.forEach(function (d) {
      var row = st.rows[d] || {};
      prefs[d] = { on: row.on !== false, time: row.entry && row.entry.due_at && !row.entry.due_at.date ? row.entry.due_at.time || '' : '' };
    });
    var o = {};
    o[this.prefsKey()] = prefs;
    local.set(o).catch(function () { return null; });
  };

  P.titleOnPage = function () {
    var el = document.querySelector('#assignment_name, input[name="name"], input[name="title"], #discussion-title, input[name="quiz[title]"], #quiz_title, #wiki_page_title, input[aria-label*="itle"]');
    return el ? String(el.value || '').trim() : '';
  };

  /* Kept on this computer as the teacher edits, so it is there when Canvas
   * opens the saved item. Armed from the panel's first use (or the page's
   * first load with sections ticked by default). */
  P.saveIntent = function () {
    var local = store();
    var st = this.state;
    if (!local || !st) return Promise.resolve();
    var sections = {};
    st.sibs.forEach(function (d) {
      var row = st.rows[d];
      if (row && row.on) sections[d] = { entry: row.entry || {} };
    });
    var o = {};
    o[this.intentKey()] = {
      courseId: this.courseId, type: st.page.type, id: st.itemId || null, isNew: !st.page.id && !st.page.slug,
      armedAt: st.openedAt, savedAt: st.savedAt || 0, title: this.titleOnPage() || st.title || '',
      baseUpdated: st.baseUpdated === undefined ? null : st.baseUpdated,
      sections: sections
    };
    return local.set(o).catch(function () { return null; });
  };

  P.onPageClick = function (e) {
    var b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], [role="button"]');
    if (!b || b.closest('.cgp-inline') || !this.state) return;
    var text = String(b.textContent || b.value || '').replace(/\s+/g, ' ');
    if (SAVE_TEXT.test(text)) this.markSaved();
  };

  P.markSaved = function () {
    var st = this.state;
    if (!st || !st.sibs.length) return;
    var any = st.sibs.some(function (d) { return st.rows[d] && st.rows[d].on; });
    if (!any) {
      var local = store();
      if (local) local.remove(this.intentKey()).catch(function () { return null; });
      return;
    }
    st.armedAt = st.armedAt || st.openedAt || Date.now();
    st.savedAt = Date.now();
    st.title = this.titleOnPage();
    this.saveIntent();
    this.savePrefs();
  };

  /* Sections linked (or unlinked) after the page opened. */
  P.refresh = function () {
    var st = this.state;
    if (!st) return;
    var sibs = this.siblings();
    if (sibs.join() === st.sibs.join()) return;
    st.sibs = sibs;
    sibs.forEach(function (d) { if (!st.rows[d]) st.rows[d] = { on: true, entry: {} }; });
    this.renderBody();
    this.saveIntent();
  };

  /* ------------------------------------------------- after Canvas saves */

  /* On the saved item's page: if this computer holds the panel's choices
   * for exactly this item, saved since they were made, make the copies. */
  P.runSaved = function () {
    var self = this;
    var local = store();
    if (!local) return Promise.resolve(null);
    var here = S().itemFromPath(location.pathname);
    var prefix = INTENT_PREFIX + this.origin + '|';
    return local.get(null).then(function (all) {
      var keys = Object.keys(all || {}).filter(function (k) { return k.indexOf(prefix) === 0; });
      var live = [];
      keys.forEach(function (k) {
        var it = all[k];
        if (!it || Date.now() - Number(it.savedAt || it.armedAt || 0) > INTENT_TTL_MS) { local.remove(k); return; }
        live.push({ key: k, intent: it });
      });
      if (!here || here.courseId !== self.courseId) return null;
      var candidates = live.filter(function (x) {
        var it = x.intent;
        return it.courseId === self.courseId && (here.type === it.type || (it.type === 'discussion' && here.type === 'announcement'));
      }).sort(function (x, y) { return Number(y.intent.savedAt || y.intent.armedAt) - Number(x.intent.savedAt || x.intent.armedAt); });
      // The newest one this saved item matches.
      return candidates.reduce(function (chain, x) {
        return chain.then(function (found) {
          if (found) return found;
          var it = Object.assign({}, x.intent, { alone: candidates.length === 1 });
          return self.matchSaved(it, here).then(function (item) { return item ? { item: item, x: x } : null; });
        });
      }, Promise.resolve(null)).then(function (hit) {
        if (!hit) return null;
        // Used once: a reload of this page must not copy again.
        return local.remove(hit.x.key).then(function () { return self.copyNow(hit.item, hit.x.intent); });
      });
    }).catch(function (e) { CGP.diag.warn('inline.runFailed', { message: String(e && e.message) }); });
  };

  /* The saved item, if it is the one the panel was set for: the same id,
   * or (new) created since the panel was set with the same title; and
   * changed since Save was pressed. null otherwise. */
  P.matchSaved = function (intent, here) {
    var api = this.api;
    var read = here.type === 'page' ? api.pageBySlug(this.courseId, here.slug)
      : api.sectionItem(this.courseId, here.type === 'announcement' ? 'discussion' : here.type, here.id);
    var self = this;
    return read.then(function (o) {
      if (!o) return null;
      var id = String(here.type === 'page' ? o.page_id : o.id);
      var slack = 15000;
      if (intent.isNew) {
        var created = Date.parse(o.created_at || o.posted_at || '');
        if (!(created >= Number(intent.armedAt || intent.savedAt) - slack)) return null;
        // The title typed in that editor. Where it could not be read, only
        // when no other editor's choices are waiting and its Save was seen,
        // so a second editor's new item cannot take this one's choices.
        var title = String(o.name || o.title || '').trim();
        if (intent.title ? intent.title !== title : !(intent.alone && intent.savedAt)) return null;
      } else {
        if (String(intent.id) !== id) return null;
        // Saved from that editor: a newer version than the one it opened
        // on (an update just before it opened is not one). Without that
        // version, or an updated time at all (discussions), the Save itself
        // must have been seen.
        var updated = Date.parse(o.updated_at || '');
        if (isFinite(updated) && intent.baseUpdated !== null && intent.baseUpdated !== undefined) {
          if (!(updated > Number(intent.baseUpdated))) return null;
        } else if (!intent.savedAt || (isFinite(updated) && updated < Number(intent.savedAt) - slack)) {
          return null;
        }
      }
      return self.controller.currentItem();
    });
  };

  P.copyNow = function (item, intent) {
    var self = this;
    var sync = S();
    var dests = Object.keys(intent.sections || {}).filter(function (d) { return self.siblings().indexOf(d) >= 0; });
    if (!dests.length || !item) return Promise.resolve();
    var banner = this.banner(item, dests);
    // A page's own availability dates are not set from this panel.
    if (item.type === 'page') item.noDates = true;
    if (item.newQuiz) {
      banner.done('This is a New Quiz: add its questions first, then use Copy to other classes to post it there.');
      return Promise.resolve();
    }
    var tz;
    return this.api.profileTimeZone().catch(function () { return null; }).then(function (z) {
      tz = z || Intl.DateTimeFormat().resolvedOptions().timeZone;
      return self.copier.survey(self.courseId, [item], dests, { placeInModules: true });
    }).then(function (survey) {
      var gate = CGP.util.pool(3);
      return Promise.all(dests.map(function (d) {
        var dest = survey.dests.filter(function (x) { return String(x.courseId) === d; })[0] || {};
        var info = (dest.items || {})[item.type + ':' + item.id] || {};
        if (dest.error) { banner.set(d, { error: dest.error }); return null; }
        if (info.lookalike && !info.destId) {
          banner.set(d, { error: 'Not copied: it already has “' + info.lookalike.title + '”, which was not copied from here. Copy to other classes can add it anyway.' });
          return null;
        }
        var res = sync.resolveInline(sync.dateFields(item), item.dates || {}, (intent.sections[d] || {}).entry, tz, self.settings.values.timeShortcuts);
        if (res.errors.length) { banner.set(d, { error: 'Not copied: ' + res.errors.join('; ') + '.' }); return null; }
        var existing = !!(info.destId && info.status !== 'restore');
        var keep = existing && !sync.defaultReplace(info.status);
        var fresh = !info.status || info.status === 'new';
        var task = {
          srcCourseId: self.courseId, destCourseId: d, destName: self.name(d), item: item,
          mode: keep ? 'keep' : 'copy', dates: res.iso, children: [], note: info.note || '', publish: 'match',
          module: fresh ? info.module : null, assignmentGroupId: fresh ? info.assignmentGroupId : null,
          destId: info.destId || null, mapping: dest.mapping || {}, childNotes: {}
        };
        return gate(function () {
          return self.copier.run(task, function (step) { banner.set(d, { step: step }); }).then(function (r) {
            if (keep && r.ok) r.warnings.unshift('Its copy there had been changed in that class, so only its dates were updated. Use Copy to other classes to replace it.');
            banner.set(d, { result: r });
          });
        });
      }));
    }).then(function () { banner.finish(); }, function (err) {
      banner.done('Could not post to your other classes: ' + CGP.util.describeApiError(err, { fallback: 'Canvas did not answer' }));
    });
  };

  /* The progress banner at the top of the saved item's page. */
  P.banner = function (item, dests) {
    var self = this;
    var box = document.createElement('div');
    box.className = 'cgp-inline-banner';
    box.setAttribute('role', 'status');
    var lines = {};
    dests.forEach(function (d) { lines[d] = { step: 'Waiting' }; });
    var title = esc(item.title || S().TYPES[item.type].label);
    function paint(final) {
      box.innerHTML = '<div class="cgp-sections-notice__head"><strong>' + (final ? 'Posted “' + title + '” to your other classes' : 'Posting “' + title + '” to your other classes…') + '</strong>' +
        (final ? '<button type="button" class="cgp-sections__x" aria-label="Close">×</button>' : '') + '</div>' +
        dests.map(function (d) {
          var l = lines[d];
          var r = l.result;
          var icon = l.error ? '×' : (r ? (r.ok ? (r.warnings.length ? '!' : '✓') : (r.pending ? '…' : '×')) : '…');
          var text = l.error ? esc(l.error) : (r ? (r.error ? esc(r.error) : 'Done.') : esc(l.step || ''));
          var link = r && r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Open</a>' : '';
          var warns = r && r.warnings && r.warnings.length ? '<ul>' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '';
          return '<div class="cgp-sections-notice__line"><span class="cgp-inline-banner__icon">' + icon + '</span> <strong>' + esc(self.name(d)) + '</strong>: ' + text + link + warns + '</div>';
        }).join('');
    }
    paint(false);
    var host = document.querySelector('#content') || document.body;
    host.insertBefore(box, host.firstChild);
    box.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.cgp-sections__x')) box.remove(); });
    return {
      set: function (d, patch) { Object.assign(lines[d], patch); paint(false); },
      finish: function () {
        paint(true);
        var bad = dests.filter(function (d) { return lines[d].error || (lines[d].result && !lines[d].result.ok); }).length;
        if (bad) CGP.ui.error('Posted to ' + (dests.length - bad) + ' of ' + dests.length + ' classes. See the top of the page.');
        else CGP.ui.toast('Posted to ' + dests.length + (dests.length === 1 ? ' class.' : ' classes.'));
      },
      done: function (msg) { box.innerHTML = '<div class="cgp-sections-notice__line">' + esc(msg) + '</div>'; }
    };
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
    box.innerHTML = '<div class="cgp-inline__head"><strong>Also add this module to your other classes</strong></div>' +
      sibs.map(function (d) {
        return '<label class="cgp-inline__name"><input type="checkbox" data-mod-on="' + esc(d) + '" checked> ' + esc(self.name(d)) + '</label>';
      }).join('') +
      '<p class="cgp-inline__hint">Each ticked class gets a copy once Canvas has created the module.</p>';
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
  CGP.inlineCopy = { panelFields: panelFields, SAVE_TEXT: SAVE_TEXT };
})();
