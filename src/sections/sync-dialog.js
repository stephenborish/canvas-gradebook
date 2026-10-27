/* Canvas Gradebook+ - "Copy to sections": post an item to every linked
 * section in one go.
 *
 * A teacher with three periods of the same course (three Canvas courses, not
 * cross-listed) links them once. From then on, on any page of any of them,
 * Copy to sections in the breadcrumb copies the item on screen - or any
 * assignments, quizzes, discussions, announcements, pages and modules picked
 * from the course - into the others, through Canvas's own course copy, with:
 *   - each section's own dates (prefilled from this one; a day shift and a
 *     time - a period shortcut such as "3" works - apply to a whole section),
 *   - an optional note for one section only, at the top of its instructions,
 *   - the copy placed in that section's matching module,
 *   - a first copy put in the matching assignment group.
 * Before anything is written every section is looked at (sync-runner.js
 * survey()): a copy already there is updated rather than duplicated, a copy
 * that was edited in its own section is left alone unless the teacher says
 * otherwise, and a same-titled item that came from elsewhere is flagged,
 * because copying would add a second one.
 *
 * Nothing is copied without the teacher pressing Copy. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.SectionCopyController) return;

  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  var PICK_TYPES = ['assignment', 'quiz', 'discussion', 'announcement', 'page', 'module'];
  var NUDGE_WINDOW_MS = 3 * 3600 * 1000;

  function S() { return CGP.sectionSync; }

  function SectionCopyController(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.origin = typeof location !== 'undefined' ? location.origin : '';
    this.copier = new CGP.SectionCopier({ api: this.api, origin: this.origin });
    this.button = null;
    this.root = null;
    this.state = null;
    this._tries = 0;
  }

  var P = SectionCopyController.prototype;

  /* -------------------------------------------------------- breadcrumb */

  P.start = function () {
    if (!this.settings.values.sectionCopy) { this.unmount(); return; }
    if (this.button && this.button.isConnected) return;
    var anchor = this.findAnchor();
    if (!anchor) {
      // Some course pages mount their breadcrumb late.
      if (this._tries++ < 20) { var self = this; setTimeout(function () { self.start(); }, 250); }
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cgp-crumb-toggle cgp-sections-toggle';
    btn.title = 'Copy content from this course to your other sections';
    btn.innerHTML =
      '<svg class="cgp-sections-toggle__glyph" viewBox="0 0 16 16" aria-hidden="true">' +
      '<rect x="1.5" y="4.5" width="8.5" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M6 2.5h6.4c.9 0 1.6.7 1.6 1.6v8.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '<span class="cgp-crumb-toggle__label">Copy to sections</span>';
    anchor.insertAdjacentElement('afterend', btn);
    this.button = btn;
    var self2 = this;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self2.open();
    });
    if (this.settings.values.sectionCopyNudge) this.nudge();
  };

  P.unmount = function () {
    if (this.button && this.button.parentNode) this.button.parentNode.removeChild(this.button);
    this.button = null;
  };

  P.findAnchor = function () {
    var sel = ['.cgp-settings-gear', '.cgp-find-student', '.cgp-crumb-toggle:not(.cgp-sections-toggle)'];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector('#breadcrumbs ' + sel[i] + ', .ic-app-crumbs ' + sel[i]);
      if (el) return el;
    }
    var links = document.querySelectorAll('#breadcrumbs a[href*="/courses/"], .ic-app-crumbs a[href*="/courses/"]');
    for (var j = 0; j < links.length; j++) {
      var href = (links[j].getAttribute('href') || '').split(/[?#]/)[0];
      if (/\/courses\/\d+\/?$/.test(href)) return links[j];
    }
    var cur = document.querySelector('#breadcrumbs [aria-current="page"], .ic-app-crumbs [aria-current="page"]');
    return cur || null;
  };

  P.siblings = function () {
    return S().siblings(this.settings.values.sectionGroups, this.origin, this.courseId);
  };

  /* On a just-created item's page: say so if it is not in the linked
   * sections yet. Reads only when the course is linked and the item is new,
   * and never writes. */
  P.nudge = function () {
    var self = this;
    var sibs = this.siblings();
    var here = S().itemFromPath(location.pathname);
    if (!sibs.length || !here || here.courseId !== this.courseId) return;
    this.currentItem().then(function (item) {
      if (!item || !item.createdAt || Date.now() - Date.parse(item.createdAt) > NUDGE_WINDOW_MS) return null;
      return Promise.all(sibs.map(function (d) {
        return self.api.contentMigrations(d).then(function (migs) {
          var last = S().latestCopyFrom(migs, self.courseId);
          if (!last) return false;
          return self.api.assetIdMapping(d, last.id).then(function (m) { return !!S().destIdFor(m, item.type, item.id); });
        }).catch(function () { return true; });
      })).then(function (present) {
        var missing = present.filter(function (p) { return !p; }).length;
        if (!missing || !self.button) return;
        self.button.classList.add('cgp-sections-toggle--new');
        self.button.title = 'This ' + S().TYPES[item.type].label.toLowerCase() + ' is not in ' + missing +
          (missing === 1 ? ' of your other sections' : ' of your other sections') + ' yet';
        CGP.ui.toast('New ' + S().TYPES[item.type].label.toLowerCase() + ': not in your other sections yet. Use Copy to sections to post it there.');
      });
    }).catch(function () { /* a nudge is never worth an error */ });
  };

  /* The item this page shows, as the dialog's item (null on other pages). */
  P.currentItem = function () {
    var api = this.api;
    var here = S().itemFromPath(location.pathname);
    if (!here || here.courseId !== this.courseId) return Promise.resolve(null);
    var read = here.type === 'page' ? api.pageBySlug(this.courseId, here.slug)
      : api.sectionItem(this.courseId, here.type === 'announcement' ? 'discussion' : here.type, here.id);
    return read.then(function (o) {
      if (!o) return null;
      var type = here.type;
      if (type === 'assignment') {
        // An assignment page can be a quiz's or a graded discussion's.
        if (o.quiz_id) return api.sectionItem(here.courseId, 'quiz', o.quiz_id).then(function (q) { return withMeta(S().toItem('quiz', q), q); });
        if (o.discussion_topic && o.discussion_topic.id) {
          return api.sectionItem(here.courseId, 'discussion', o.discussion_topic.id).then(function (t) { return withMeta(S().toItem('discussion', t), t); });
        }
      }
      if (type === 'discussion' && o.is_announcement) type = 'announcement';
      return withMeta(S().toItem(type === 'announcement' ? 'discussion' : type, o), o);
    }).catch(function () { return null; });
  };

  function withMeta(item, o) {
    if (!item) return null;
    item.createdAt = o.created_at || o.posted_at || null;
    item.htmlLoaded = true;
    return item;
  }

  /* -------------------------------------------------------------- dialog */

  P.open = function () {
    var self = this;
    this.close();
    this.state = {
      items: [], dests: [], courses: null, tz: null, survey: null, surveying: false, surveyError: null,
      cells: {}, notes: {}, include: {}, replace: {}, adjust: {},
      publish: 'match', placeInModules: true, view: 'main', picker: { type: 'assignment', q: '', lists: {}, chosen: {} },
      running: false, results: null
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Copy to sections</div><h2 id="cgp-sections-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-sections__body"></div>' +
      '</div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.requestClose(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.requestClose(); });
    root.addEventListener('click', function (e) { self.onClick(e); });
    root.addEventListener('change', function (e) { self.onChange(e); });
    root.addEventListener('input', function (e) { self.onInput(e); });
    this._onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.requestClose(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    this.root.querySelector('#cgp-sections-title').textContent = this.courseName(this.courseId);
    this.render();

    var st = this.state;
    Promise.all([
      CGP.teachingCourseList(this.api).catch(function () { return []; }),
      this.api.profileTimeZone().catch(function () { return null; }),
      this.currentItem()
    ]).then(function (r) {
      if (self.state !== st) return;
      st.courses = r[0] || [];
      st.tz = r[1] || (Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      if (r[2]) st.items.push(r[2]);
      st.dests = self.siblings();
      if (!st.dests.length) st.view = 'link';
      self.root.querySelector('#cgp-sections-title').textContent = self.courseName(self.courseId);
      self.render();
      self.resurvey();
    });
  };

  P.requestClose = function () {
    if (this.state && this.state.running) {
      CGP.ui.toast('Still copying — the dialog will stay open until Canvas is done.');
      return;
    }
    this.close();
  };

  P.close = function () {
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.state = null;
  };

  P.courseName = function (id) {
    var list = (this.state && this.state.courses) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i].name || ('Course ' + id);
    if (String(id) === this.courseId) {
      var crumb = document.querySelector('.cgp-crumb-link, #breadcrumbs a[href$="/courses/' + id + '"]');
      var t = crumb ? String(crumb.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t) return t;
    }
    return 'Course ' + id;
  };

  function itemKey(it) { return it.type + ':' + it.id; }
  function cellKey(it, dest) { return itemKey(it) + '>' + dest; }

  /* ------------------------------------------------------------- survey */

  P.resurvey = function () {
    var self = this;
    var st = this.state;
    if (!st || st.view !== 'main') return;
    st.survey = null;
    st.surveyError = null;
    if (!st.items.length || !st.dests.length) { this.render(); return; }
    st.surveying = true;
    this.render();
    var token = st.surveyToken = {};
    // A module's items are dated per section too; read them first.
    Promise.all(st.items.map(function (it) { return Promise.all([self.loadChildren(it), self.loadDates(it)]); })).then(function () {
      return self.copier.survey(self.courseId, st.items, st.dests, { placeInModules: st.placeInModules });
    }).then(function (survey) {
      if (self.state !== st || st.surveyToken !== token) return;
      st.surveying = false;
      st.survey = survey;
      self.seedCells();
      self.render();
    }, function (err) {
      if (self.state !== st || st.surveyToken !== token) return;
      st.surveying = false;
      st.surveyError = CGP.util.describeApiError(err, { fallback: 'Couldn’t read your sections from Canvas' });
      self.render();
    });
  };

  P.loadChildren = function (item) {
    var self = this;
    if (item.type !== 'module' || item.children) return Promise.resolve();
    var read = item.items ? Promise.resolve(item.items)
      : this.api.modulesWithItems(this.courseId).then(function (mods) {
        var m = (mods || []).filter(function (x) { return String(x.id) === String(item.id); })[0];
        return (m && m.items) || [];
      });
    return read.then(function (mi) {
      var kids = S().moduleChildren(mi);
      return Promise.all(kids.map(function (k) {
        return self.api.sectionItem(self.courseId, k.type, k.id).then(function (o) {
          var full = S().toItem(k.type, o);
          if (full) { k.title = full.title || k.title; k.dates = full.dates; k.graded = full.graded; k.html = full.html; }
          return k;
        }, function () { k.dates = {}; return k; });
      })).then(function (list) { item.children = list; });
    });
  };

  /* A page's availability dates live only in its Assign To data. A course
   * whose pages cannot have dates answers with an error: no date boxes. */
  P.loadDates = function (item) {
    if (item.type !== 'page' || item.datesLoaded) return Promise.resolve();
    return this.api.dateDetails(this.courseId, 'page', item.id).then(function (d) {
      item.dates = { unlock_at: (d && d.unlock_at) || null, lock_at: (d && d.lock_at) || null };
      item.datesLoaded = true;
      if (d && d.only_visible_to_overrides) item.hasOverrides = true;
    }, function () {
      item.noDates = true;
      item.datesLoaded = true;
    });
  };

  /* Starting values for every box: this section's dates, the include and
   * replace defaults the survey implies, and each section's existing note. */
  P.seedCells = function () {
    var st = this.state;
    var sync = S();
    st.items.forEach(function (it) {
      st.dests.forEach(function (d) {
        var k = cellKey(it, d);
        var info = surveyInfo(st, it, d);
        if (!(k in st.include)) st.include[k] = !(info && info.lookalike) && !(destOf(st, d) && destOf(st, d).error);
        if (!(k in st.replace)) st.replace[k] = info ? sync.defaultReplace(info.status) : true;
        if (!(k in st.notes)) st.notes[k] = info && info.note ? info.note : '';
        dated(it).forEach(function (row) {
          var rk = k + '|' + itemKey(row);
          if (st.cells[rk]) return;
          st.cells[rk] = {};
          sync.dateFields(row).forEach(function (f) { st.cells[rk][f] = sync.isoToLocal((row.dates || {})[f], st.tz); });
        });
      });
    });
  };

  function destOf(st, d) {
    var list = (st.survey && st.survey.dests) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].courseId) === String(d)) return list[i];
    return null;
  }

  function surveyInfo(st, it, d) {
    var dest = destOf(st, d);
    return dest && dest.items ? dest.items[itemKey(it)] || null : null;
  }

  /** The rows that get dates for an item: itself, plus a module's items. */
  function dated(it) {
    var rows = [];
    if (S().dateFields(it).length) rows.push(it);
    (it.children || []).forEach(function (c) { if (S().dateFields(c).length) rows.push(c); });
    return rows;
  }

  /* -------------------------------------------------------------- render */

  P.render = function () {
    if (!this.root || !this.state) return;
    var body = this.root.querySelector('.cgp-sections__body');
    var st = this.state;
    if (!st.courses) { body.innerHTML = '<p class="cgp-stats__note">Loading your courses…</p>'; return; }
    if (st.view === 'link') { body.innerHTML = this.renderLink(); return; }
    if (st.view === 'pick') { body.innerHTML = this.renderPicker(); return; }
    body.innerHTML = this.renderMain();
  };

  P.renderLink = function () {
    var st = this.state;
    var sync = S();
    var current = null;
    st.courses.forEach(function (c) { if (String(c.id) === this.courseId) current = c; }, this);
    var linked = this.siblings();
    var suggested = sync.suggestSiblings(st.courses, current || { id: this.courseId, name: this.courseName(this.courseId) });
    if (!st.linkDraft) st.linkDraft = linked.length ? linked.slice() : suggested.slice();
    var self = this;
    var others = st.courses.filter(function (c) { return String(c.id) !== self.courseId; });
    // Suggestions first, then the rest by term and name.
    others.sort(function (a, b) {
      var sa = suggested.indexOf(String(a.id)) >= 0 ? 0 : 1, sb = suggested.indexOf(String(b.id)) >= 0 ? 0 : 1;
      return (sa - sb) || String((b.term && b.term.name) || '').localeCompare(String((a.term && a.term.name) || '')) ||
        String(a.name).localeCompare(String(b.name));
    });
    var q = String(st.linkFilter || '').toLowerCase();
    var rows = others.filter(function (c) {
      return !q || (String(c.name) + ' ' + ((c.term && c.term.name) || '')).toLowerCase().indexOf(q) >= 0;
    }).map(function (c) {
      var id = String(c.id);
      var on = st.linkDraft.indexOf(id) >= 0;
      var elsewhere = sync.groupFor(self.settings.values.sectionGroups, self.origin, id);
      var note = elsewhere && linked.indexOf(id) < 0 ? '<span class="cgp-sections__tag">linked with other courses</span>' : '';
      return '<label class="cgp-sections__course"><input type="checkbox" data-link="' + esc(id) + '"' + (on ? ' checked' : '') + '> ' +
        '<span class="cgp-sections__course-name">' + esc(c.name) + '</span>' +
        (suggested.indexOf(id) >= 0 ? '<span class="cgp-sections__tag cgp-sections__tag--hint">suggested</span>' : '') + note +
        (c.term && c.term.name ? '<span class="cgp-sections__term">' + esc(c.term.name) + '</span>' : '') + '</label>';
    }).join('');
    return '<section class="cgp-roster__section">' +
      '<h3>Which courses are other sections of this one?</h3>' +
      '<p class="cgp-stats__note">Pick every Canvas course you teach as the same course to a different section. ' +
      'They are linked to each other, so any of them can copy to the rest. Only course ids are saved (in your Chrome settings).</p>' +
      '<input type="search" class="cgp-sections__filter" data-role="link-filter" placeholder="Filter courses…" value="' + esc(st.linkFilter || '') + '">' +
      '<div class="cgp-sections__courses">' + (rows || '<p class="cgp-stats__note">No other courses where you teach.</p>') + '</div>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="save-link">' +
      (st.linkDraft.length ? 'Link ' + (st.linkDraft.length + 1) + ' sections' : (linked.length ? 'Unlink this course' : 'Save')) + '</button>' +
      (linked.length ? '<button type="button" class="cgp-roster__btn" data-act="cancel-link">Cancel</button>' : '') +
      '</div></section>';
  };

  P.renderPicker = function () {
    var st = this.state;
    var pk = st.picker;
    var sync = S();
    var tabs = PICK_TYPES.map(function (t) {
      return '<button type="button" class="cgp-sections__tab' + (pk.type === t ? ' is-on' : '') + '" data-pick-type="' + t + '">' +
        esc(sync.TYPES[t].plural) + '</button>';
    }).join('');
    var list = pk.lists[pk.type];
    var rows;
    if (list === undefined) { rows = '<p class="cgp-stats__note">Loading…</p>'; this.loadPickList(pk.type); }
    else if (list === null) rows = '<p class="cgp-stats__note">Couldn’t load these from Canvas.</p>';
    else {
      var q = String(pk.q || '').toLowerCase();
      var already = st.items.map(itemKey);
      var shown = list.filter(function (it) { return !q || String(it.title).toLowerCase().indexOf(q) >= 0; });
      rows = shown.length ? shown.slice(0, 300).map(function (it) {
        var k = itemKey(it);
        var dis = already.indexOf(k) >= 0;
        return '<label class="cgp-sections__course"><input type="checkbox" data-pick="' + esc(k) + '"' +
          ((pk.chosen[k] || dis) ? ' checked' : '') + (dis ? ' disabled' : '') + '> <span class="cgp-sections__course-name">' + esc(it.title || '(untitled)') + '</span>' +
          (it.published ? '' : '<span class="cgp-sections__tag">unpublished</span>') +
          (it.newQuiz ? '<span class="cgp-sections__tag">New Quiz</span>' : '') + '</label>';
      }).join('') : '<p class="cgp-stats__note">Nothing here.</p>';
    }
    var n = Object.keys(pk.chosen).filter(function (k) { return pk.chosen[k]; }).length;
    return '<section class="cgp-roster__section"><h3>Add items to copy</h3>' +
      '<div class="cgp-sections__tabs">' + tabs + '</div>' +
      '<input type="search" class="cgp-sections__filter" data-role="pick-filter" placeholder="Filter…" value="' + esc(pk.q || '') + '">' +
      '<div class="cgp-sections__courses">' + rows + '</div>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="pick-done"' + (n ? '' : ' disabled') + '>Add ' + (n || '') + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="pick-cancel">Cancel</button></div></section>';
  };

  P.loadPickList = function (type) {
    var self = this;
    var st = this.state;
    if (st.picker.loading === type) return;
    st.picker.loading = type;
    this.api.courseItems(this.courseId, type).then(function (list) {
      if (self.state !== st) return;
      st.picker.lists[type] = (list || []).map(function (o) { return S().toItem(type, o); }).filter(Boolean)
        .filter(function (it) { return it.type === type; });
      st.picker.loading = null;
      self.render();
    }, function () {
      if (self.state !== st) return;
      st.picker.lists[type] = null;
      st.picker.loading = null;
      self.render();
    });
  };

  P.renderMain = function () {
    var st = this.state;
    var self = this;
    var sync = S();
    if (st.results) return this.renderResults();

    var items = st.items.map(function (it) {
      return '<span class="cgp-sections__chip">' + esc(sync.TYPES[it.type].label) + ' · ' + esc(it.title || '(untitled)') +
        (st.running ? '' : ' <button type="button" class="cgp-sections__x" aria-label="Remove" data-remove="' + esc(itemKey(it)) + '">×</button>') + '</span>';
    }).join('');
    var dests = st.dests.map(function (d) {
      return '<span class="cgp-sections__chip">' + esc(self.courseName(d)) + '</span>';
    }).join('');

    var html = '<section class="cgp-roster__section"><h3>What to copy</h3>' +
      '<div class="cgp-sections__chips">' + (items || '<span class="cgp-stats__note">Nothing chosen yet.</span>') + '</div>' +
      '<div class="cgp-roster__row"><button type="button" class="cgp-roster__btn" data-act="pick"' + (st.running ? ' disabled' : '') + '>Add items…</button></div></section>' +
      '<section class="cgp-roster__section"><h3>Copy to</h3>' +
      '<div class="cgp-sections__chips">' + dests + '</div>' +
      '<div class="cgp-roster__row"><button type="button" class="cgp-roster__btn" data-act="edit-link"' + (st.running ? ' disabled' : '') + '>Change linked sections…</button>' +
      '<label class="cgp-roster__field">Publishing <select data-role="publish"' + (st.running ? ' disabled' : '') + '>' +
      [['match', 'Same as this section'], ['unpublished', 'Leave copies unpublished'], ['published', 'Publish copies']].map(function (o) {
        return '<option value="' + o[0] + '"' + (st.publish === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="cgp-roster__choice"><input type="checkbox" data-role="modules"' + (st.placeInModules ? ' checked' : '') + (st.running ? ' disabled' : '') +
      '> Put new copies in the matching module</label></div></section>';

    if (!st.items.length) return html;
    if (st.surveying) return html + '<p class="cgp-stats__note cgp-sections__busy">Checking your sections…</p>';
    if (st.surveyError) return html + '<p class="cgp-stats__note cgp-sections__err">' + esc(st.surveyError) + ' <button type="button" class="cgp-roster__btn" data-act="resurvey">Try again</button></p>';
    if (!st.survey) return html;

    html += '<section class="cgp-roster__section"><h3>Dates for each section</h3>' +
      '<p class="cgp-stats__note">Times are in ' + esc(st.tz || 'your computer’s time zone') + ', as Canvas shows them. ' +
      'Each section starts with this section’s dates. To move a whole section, shift its dates by days or set its due time ' +
      '(a time, or one of your period shortcuts such as 1–4).</p>' +
      st.dests.map(function (d) { return self.renderAdjust(d); }).join('') + '</section>';

    html += st.items.map(function (it) { return self.renderItem(it); }).join('');

    var plan = this.planSummary();
    html += '<div class="cgp-roster__row cgp-roster__actions cgp-sections__go">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="run"' + (plan.count && !plan.errors.length && !st.running ? '' : ' disabled') + '>' +
      (plan.count ? 'Copy ' + plan.count + (plan.count === 1 ? ' item' : ' items') : 'Nothing to copy') + '</button>' +
      '<span class="cgp-stats__note">' + esc(plan.errors.length ? plan.errors[0] : plan.text) + '</span></div>';
    return html;
  };

  P.renderAdjust = function (d) {
    var a = this.state.adjust[d] || {};
    var dest = destOf(this.state, d);
    if (dest && dest.error) {
      return '<div class="cgp-sections__adjust"><strong>' + esc(this.courseName(d)) + '</strong> <span class="cgp-sections__err">' + esc(dest.error) + '</span></div>';
    }
    return '<div class="cgp-sections__adjust" data-dest="' + esc(d) + '"><strong>' + esc(this.courseName(d)) + '</strong>' +
      '<label>Shift <input type="number" step="1" class="cgp-sections__days" data-adjust="days" value="' + esc(a.days || '') + '" placeholder="0"> days</label>' +
      '<label>Due time <input type="text" class="cgp-sections__time" data-adjust="time" value="' + esc(a.time || '') + '" placeholder="e.g. 3 or 1:45 pm"></label>' +
      '<button type="button" class="cgp-roster__btn" data-act="adjust" data-dest="' + esc(d) + '">Apply</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="reset" data-dest="' + esc(d) + '">Reset</button></div>';
  };

  var STATUS_TEXT = {
    'new': 'Not in this section yet — it will be copied.',
    restore: 'It was deleted in this section — copying brings it back.',
    same: 'Already there with the same instructions — copying again updates it.',
    stale: 'Already there, from an earlier version — copying updates it.',
    edited: 'Already there, and its instructions were changed in this section since it was copied.',
    differs: 'Already there, with different instructions from this section’s.'
  };

  P.renderItem = function (it) {
    var st = this.state;
    var self = this;
    var sync = S();
    var t = sync.TYPES[it.type];
    var rows = st.dests.map(function (d) {
      var dest = destOf(st, d);
      if (dest && dest.error) return '';
      var info = surveyInfo(st, it, d) || {};
      var k = cellKey(it, d);
      var on = !!st.include[k];
      var existing = info.destId && info.status !== 'restore';
      var status = STATUS_TEXT[info.status || 'new'] || '';
      if (!on && (info.status || 'new') === 'new') status = 'Not in this section yet.';
      if (it.type === 'module' && info.changedChildren && info.changedChildren.length) {
        status = 'Already there. Copying the module again also replaces everything in it, and these were changed in this section: ' +
          info.changedChildren.join(', ') + '.';
      }
      var bits = [];
      if (info.lookalike && !info.destId) {
        bits.push('<span class="cgp-sections__warn">This section already has “' + esc(info.lookalike.title) + '”, which was not copied from here ' +
          '(it may have come from another course). Copying would add a second one, so it is unticked.</span>');
      }
      if (!existing && info.moduleWanted && st.placeInModules) {
        bits.push(info.module ? 'Goes in module “' + esc(info.module.name) + '”.'
          : '<span class="cgp-sections__warn">No module “' + esc(info.moduleWanted) + '” here; the copy will not be in a module.</span>');
      }
      if (!existing && info.groupMissing) {
        bits.push('<span class="cgp-sections__warn">No assignment group “' + esc(info.groupMissing) + '” here; Canvas will put it in “Imported Assignments”.</span>');
      }
      var choice = '';
      if (existing && (info.status === 'edited' || info.status === 'differs' || info.status === 'stale')) {
        var rep = !!st.replace[k];
        choice = '<div class="cgp-sections__choice">' +
          '<label><input type="radio" name="rep-' + esc(k) + '" data-replace="' + esc(k) + '" value="1"' + (rep ? ' checked' : '') + '> Replace with this section’s version</label>' +
          '<label><input type="radio" name="rep-' + esc(k) + '" data-replace="' + esc(k) + '" value="0"' + (rep ? '' : ' checked') + '> Keep that section’s own version (only dates' + (t.body ? ' and note' : '') + ' change)</label></div>';
      }
      var dateRows = dated(it).map(function (row) {
        var rk = k + '|' + itemKey(row);
        var vals = st.cells[rk] || {};
        var fields = sync.dateFields(row).map(function (f) {
          return '<label class="cgp-sections__date"><span>' + esc(sync.DATE_LABELS[f]) + '</span>' +
            '<input type="datetime-local" data-cell="' + esc(rk) + '" data-field="' + f + '" value="' + esc(vals[f] || '') + '"' + (on ? '' : ' disabled') + '></label>';
        }).join('');
        var check = sync.checkDates(vals, st.tz);
        return '<div class="cgp-sections__daterow" data-row="' + esc(rk) + '">' + (row !== it ? '<span class="cgp-sections__child">' + esc(row.title || '') + '</span>' : '') +
          fields + '<span class="cgp-sections__err" data-row-err>' + esc(check.errors.join('; ')) + '</span></div>';
      }).join('');
      var note = '';
      if (t.body) {
        var nv = st.notes[k] || '';
        note = '<details class="cgp-sections__note"' + (nv ? ' open' : '') + '><summary>Note for this section only' + (nv ? ' (has one)' : '') + '</summary>' +
          '<textarea rows="2" data-note="' + esc(k) + '" placeholder="Shown at the top of the instructions in this section only."' + (on ? '' : ' disabled') + '>' + esc(nv) + '</textarea></details>';
      }
      return '<div class="cgp-sections__dest' + (on ? '' : ' is-off') + '">' +
        '<label class="cgp-sections__dest-head"><input type="checkbox" data-include="' + esc(k) + '"' + (on ? ' checked' : '') + '> <strong>' + esc(self.courseName(d)) + '</strong></label>' +
        '<div class="cgp-stats__note">' + esc(status) + '</div>' +
        (bits.length ? '<div class="cgp-stats__note">' + bits.join(' ') + '</div>' : '') +
        choice + dateRows + note + '</div>';
    }).join('');
    var extra = [];
    if (it.hasOverrides) extra.push('It has dates for particular students or sections in this course; copies get only the dates set below.');
    if (it.newQuiz) extra.push('A New Quiz: Canvas copies its questions in a second step, so it can take a few minutes.');
    if (it.type === 'module') extra.push('Copies the module and everything in it. Dates for the module’s items can be set for each section below.');
    if (it.type === 'page' && !dated(it).length) extra.push('Pages have no dates to set.');
    return '<section class="cgp-roster__section cgp-sections__item"><h3>' + esc(t.label) + ': ' + esc(it.title || '(untitled)') + '</h3>' +
      (extra.length ? '<p class="cgp-stats__note">' + esc(extra.join(' ')) + '</p>' : '') + rows + '</section>';
  };

  P.renderResults = function () {
    var st = this.state;
    var self = this;
    var lines = st.results.map(function (r) {
      var res = r.result;
      var icon = !res ? '…' : (res.ok ? (res.warnings.length ? '!' : '✓') : (res.pending ? '…' : '×'));
      var cls = !res ? 'is-run' : (res.ok ? (res.warnings.length ? 'is-warn' : 'is-ok') : (res.pending ? 'is-run' : 'is-err'));
      var detail = !res ? esc(r.step || 'Waiting') : (res.error ? esc(res.error) : (res.ok ? (r.task.mode === 'keep' ? 'Dates updated.' : 'Copied.') : ''));
      var link = res && res.url ? ' <a href="' + esc(res.url) + '" target="_blank" rel="noopener">Open</a>' : '';
      var warns = res && res.warnings.length ? '<ul>' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '';
      return '<li class="cgp-sections__result ' + cls + '"><span class="cgp-sections__icon">' + icon + '</span><div><strong>' +
        esc(self.courseName(r.task.destCourseId)) + '</strong> · ' + esc(r.task.item.title || '') + ' — ' + detail + link + warns + '</div></li>';
    }).join('');
    return '<section class="cgp-roster__section"><h3>' + (st.running ? 'Copying…' : 'Done') + '</h3>' +
      (st.running ? '<p class="cgp-stats__note">Canvas copies one item at a time into each section; this can take a minute or two.</p>' : '') +
      '<ul class="cgp-sections__results">' + lines + '</ul>' +
      (st.running ? '' : '<div class="cgp-roster__row cgp-roster__actions"><button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="close">Close</button>' +
        '<button type="button" class="cgp-roster__btn" data-act="again">Copy something else</button></div>') + '</section>';
  };

  /* ------------------------------------------------------------- events */

  P.onClick = function (e) {
    var st = this.state;
    if (!st) return;
    var t = e.target;
    var act = t.closest && t.closest('[data-act]');
    var typeBtn = t.closest && t.closest('[data-pick-type]');
    var rm = t.closest && t.closest('[data-remove]');
    if (typeBtn) { st.picker.type = typeBtn.getAttribute('data-pick-type'); this.render(); return; }
    if (rm && !st.running) {
      var key = rm.getAttribute('data-remove');
      st.items = st.items.filter(function (it) { return itemKey(it) !== key; });
      this.resurvey();
      return;
    }
    if (!act || act.disabled) return;
    var a = act.getAttribute('data-act');
    if (a === 'save-link') return this.saveLink();
    if (a === 'cancel-link') { st.view = 'main'; st.linkDraft = null; this.render(); return; }
    if (a === 'edit-link') { st.view = 'link'; st.linkDraft = null; this.render(); return; }
    if (a === 'pick') { st.view = 'pick'; st.picker.chosen = {}; this.render(); return; }
    if (a === 'pick-cancel') { st.view = 'main'; this.render(); return; }
    if (a === 'pick-done') return this.pickDone();
    if (a === 'resurvey') return this.resurvey();
    if (a === 'adjust') return this.applyAdjust(act.getAttribute('data-dest'));
    if (a === 'reset') return this.resetDest(act.getAttribute('data-dest'));
    if (a === 'run') return this.runAll();
    if (a === 'close') return this.close();
    if (a === 'again') { st.results = null; st.items = []; st.survey = null; st.cells = {}; st.include = {}; st.replace = {}; st.notes = {}; this.render(); return; }
  };

  P.onChange = function (e) {
    var st = this.state;
    if (!st) return;
    var t = e.target;
    if (t.hasAttribute('data-link')) {
      var id = t.getAttribute('data-link');
      st.linkDraft = st.linkDraft.filter(function (x) { return x !== id; });
      if (t.checked) st.linkDraft.push(id);
      this.render();
      return;
    }
    if (t.hasAttribute('data-pick')) { st.picker.chosen[t.getAttribute('data-pick')] = !!t.checked; this.render(); return; }
    if (t.getAttribute('data-role') === 'publish') { st.publish = t.value; return; }
    if (t.getAttribute('data-role') === 'modules') { st.placeInModules = !!t.checked; this.resurvey(); return; }
    if (t.hasAttribute('data-include')) { st.include[t.getAttribute('data-include')] = !!t.checked; this.render(); return; }
    if (t.hasAttribute('data-replace')) { st.replace[t.getAttribute('data-replace')] = t.value === '1'; this.render(); return; }
    if (t.hasAttribute('data-cell')) { this.setCell(t); this.refreshValidity(); return; }
  };

  P.onInput = function (e) {
    var st = this.state;
    if (!st) return;
    var t = e.target;
    if (t.hasAttribute('data-note')) { st.notes[t.getAttribute('data-note')] = t.value; return; }
    if (t.hasAttribute('data-cell')) { this.setCell(t); this.refreshValidity(); return; }
    if (t.hasAttribute('data-adjust')) {
      var d = t.closest('[data-dest]').getAttribute('data-dest');
      st.adjust[d] = st.adjust[d] || {};
      st.adjust[d][t.getAttribute('data-adjust')] = t.value;
      return;
    }
    var role = t.getAttribute('data-role');
    if (role === 'link-filter' || role === 'pick-filter') {
      if (role === 'link-filter') st.linkFilter = t.value; else st.picker.q = t.value;
      var pos = t.selectionStart;
      this.render();
      var again = this.root.querySelector('[data-role="' + role + '"]');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } }
    }
  };

  /* After a date box changes: that row's problems and the Copy button,
   * without redrawing (which would take the focus out of the box). */
  P.refreshValidity = function () {
    var st = this.state;
    if (!this.root || !st) return;
    var sync = S();
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-row]'), function (row) {
      var err = row.querySelector('[data-row-err]');
      if (err) err.textContent = sync.checkDates(st.cells[row.getAttribute('data-row')] || {}, st.tz).errors.join('; ');
    });
    var go = this.root.querySelector('.cgp-sections__go');
    if (!go) return;
    var plan = this.planSummary();
    var btn = go.querySelector('[data-act="run"]');
    if (btn) {
      btn.disabled = !(plan.count && !plan.errors.length && !st.running);
      btn.textContent = plan.count ? 'Copy ' + plan.count + (plan.count === 1 ? ' item' : ' items') : 'Nothing to copy';
    }
    var note = go.querySelector('.cgp-stats__note');
    if (note) note.textContent = plan.errors.length ? plan.errors[0] : plan.text;
  };

  P.setCell = function (input) {
    var rk = input.getAttribute('data-cell');
    var f = input.getAttribute('data-field');
    this.state.cells[rk] = this.state.cells[rk] || {};
    this.state.cells[rk][f] = input.value;
  };

  P.saveLink = function () {
    var self = this;
    var st = this.state;
    var ids = [this.courseId].concat(st.linkDraft);
    var names = {};
    ids.forEach(function (id) { names[id] = self.courseName(id); });
    var next = S().setGroup(this.settings.values.sectionGroups, this.origin, ids, names);
    this.settings.save({ sectionGroups: next }).then(function () {
      if (self.state !== st) return;
      st.dests = self.siblings();
      st.linkDraft = null;
      st.view = st.dests.length ? 'main' : 'link';
      st.cells = {}; st.include = {}; st.replace = {}; st.notes = {};
      self.render();
      self.resurvey();
    }, function (err) {
      CGP.ui.error('Couldn’t save the linked sections: ' + String(err && err.message));
    });
  };

  P.pickDone = function () {
    var st = this.state;
    var chosen = st.picker.chosen;
    Object.keys(st.picker.lists).forEach(function (type) {
      (st.picker.lists[type] || []).forEach(function (it) {
        if (chosen[itemKey(it)] && !st.items.some(function (x) { return itemKey(x) === itemKey(it); })) st.items.push(it);
      });
    });
    st.view = 'main';
    this.resurvey();
  };

  P.applyAdjust = function (d) {
    var st = this.state;
    var sync = S();
    var a = st.adjust[d] || {};
    var days = Math.round(Number(a.days || 0)) || 0;
    var clock = a.time ? sync.parseClock(a.time, this.settings.values.timeShortcuts) : null;
    if (a.time && !clock) { CGP.ui.error('“' + a.time + '” is not a time or one of your period shortcuts.'); return; }
    st.items.forEach(function (it) {
      dated(it).forEach(function (row) {
        var rk = cellKey(it, d) + '|' + itemKey(row);
        var base = {};
        sync.dateFields(row).forEach(function (f) { base[f] = sync.isoToLocal((row.dates || {})[f], st.tz); });
        var out = {};
        Object.keys(base).forEach(function (f) {
          var v = base[f];
          if (v && days) v = sync.shiftLocal(v, days);
          if (v && clock && (f === 'due_at' || (f === 'delayed_post_at'))) v = sync.withTime(v, clock);
          out[f] = v;
        });
        st.cells[rk] = out;
      });
    });
    this.render();
  };

  P.resetDest = function (d) {
    var st = this.state;
    st.adjust[d] = {};
    var sync = S();
    st.items.forEach(function (it) {
      dated(it).forEach(function (row) {
        var rk = cellKey(it, d) + '|' + itemKey(row);
        st.cells[rk] = {};
        sync.dateFields(row).forEach(function (f) { st.cells[rk][f] = sync.isoToLocal((row.dates || {})[f], st.tz); });
      });
    });
    this.render();
  };

  /* ------------------------------------------------------------ the run */

  /* Every (item, section) the teacher left ticked, as runner tasks - or the
   * first reason the set cannot run yet. */
  P.buildTasks = function () {
    var st = this.state;
    var sync = S();
    var self = this;
    var tasks = [];
    var errors = [];
    st.items.forEach(function (it) {
      st.dests.forEach(function (d) {
        var dest = destOf(st, d);
        var k = cellKey(it, d);
        if (!dest || dest.error || !st.include[k]) return;
        var info = surveyInfo(st, it, d) || {};
        var existing = !!(info.destId && info.status !== 'restore');
        var mode = existing && !st.replace[k] ? 'keep' : 'copy';
        var dates = {};
        var children = [];
        dated(it).forEach(function (row) {
          var vals = st.cells[k + '|' + itemKey(row)] || {};
          var check = sync.checkDates(vals, st.tz);
          if (check.errors.length) errors.push(self.courseName(d) + ', “' + (row.title || '') + '”: ' + check.errors[0] + '.');
          var iso = {};
          sync.dateFields(row).forEach(function (f) { iso[f] = check.iso[f] === undefined ? null : check.iso[f]; });
          if (row === it) dates = iso;
          else children.push({ type: row.type, id: row.id, title: row.title, graded: !!row.graded, dates: iso });
        });
        var fresh = info.status === 'new' || !info.status;
        tasks.push({
          srcCourseId: self.courseId, destCourseId: String(d), destName: self.courseName(d),
          item: it, mode: mode, dates: dates, children: children,
          note: st.notes[k] || '', publish: st.publish,
          module: fresh && st.placeInModules ? info.module : null,
          assignmentGroupId: fresh ? info.assignmentGroupId : null,
          destId: info.destId || null
        });
      });
    });
    return { tasks: tasks, errors: errors };
  };

  P.planSummary = function () {
    var b = this.buildTasks();
    var copies = b.tasks.filter(function (t) { return t.mode === 'copy'; }).length;
    var keeps = b.tasks.length - copies;
    var parts = [];
    if (copies) parts.push(copies + (copies === 1 ? ' copy' : ' copies'));
    if (keeps) parts.push(keeps + (keeps === 1 ? ' date-only update' : ' date-only updates'));
    return { count: b.tasks.length, errors: b.errors, text: parts.join(', ') };
  };

  P.runAll = function () {
    var self = this;
    var st = this.state;
    var b = this.buildTasks();
    if (b.errors.length || !b.tasks.length || st.running) return;
    st.running = true;
    st.results = b.tasks.map(function (t) { return { task: t, result: null, step: 'Waiting' }; });
    this.render();
    // One section at a time per course (Canvas queues copies into a course
    // behind each other anyway); up to three sections at once.
    var byDest = {};
    st.results.forEach(function (r) { (byDest[r.task.destCourseId] = byDest[r.task.destCourseId] || []).push(r); });
    var gate = CGP.util.pool(3);
    var repaint = CGP.util.rafBatch(function () { if (self.state === st) self.render(); }, 'sections');
    Promise.all(Object.keys(byDest).map(function (d) {
      return gate(function () {
        return byDest[d].reduce(function (p, r) {
          return p.then(function () {
            return self.copier.run(r.task, function (step) { r.step = step; repaint(); }).then(function (res) {
              r.result = res;
              repaint();
            });
          });
        }, Promise.resolve());
      });
    })).then(function () {
      st.running = false;
      if (self.state === st) self.render();
      var ok = st.results.filter(function (r) { return r.result && r.result.ok; }).length;
      var bad = st.results.length - ok;
      CGP.diag.bump('sections.copied', ok);
      if (bad) CGP.ui.error(ok + ' of ' + st.results.length + ' done. See the list for what needs attention.');
      else CGP.ui.toast('Copied to your sections (' + ok + ').');
    });
  };

  /* --------------------------------------------- jobs left by a closed tab */

  P.resume = function () {
    var self = this;
    return this.copier.resumePending().then(function (done) {
      if (!done.length) return;
      var ok = done.filter(function (d) { return d.result.ok; });
      var first = done[0];
      if (ok.length === done.length) {
        CGP.ui.toast('Finished copying ' + (done.length === 1 ? '“' + first.job.task.item.title + '” to ' + (first.job.task.destName || 'a section')
          : done.length + ' items to your sections') + '.');
      } else {
        var bad = done.filter(function (d) { return !d.result.ok; })[0];
        CGP.ui.error('Copying “' + bad.job.task.item.title + '” to ' + (bad.job.task.destName || 'a section') + ' did not finish: ' + (bad.result.error || 'unknown error'));
      }
      CGP.diag.log('sections.resumed', { count: done.length, ok: ok.length });
      self.lastResumed = done;
    });
  };

  CGP.SectionCopyController = SectionCopyController;
})();
