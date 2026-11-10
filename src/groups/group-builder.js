/* Canvas Gradebook+ - Make groups, on the People page.
 *
 * Canvas makes a group set one dialog at a time: name the set, then add each
 * group by hand (or accept "Group 1..N"), then drag students in. This puts a
 * "Make groups" button beside Canvas's own "+ Group Set" that does it in one
 * step:
 *   - how many groups, or how many students per group;
 *   - what the groups are called: a name format ("Group {n}", "Team {A}", a
 *     list like "Hydrogen, Helium, ...") the teacher can save and reuse;
 *   - how students get in: sorted at random now, placed by the teacher, or
 *     signing themselves up (optionally only with classmates in their own
 *     section).
 * Any set can then be arranged on a board (drag a student, or pick a group
 * from the list beside their name; shuffle everyone, or only the students not
 * in a group yet), and copied - the same group names, sizes and sign-up
 * settings - to the teacher's other classes, or to another section of this
 * course.
 *
 * Every write is Canvas's own Groups API (group_categories, groups,
 * memberships); nothing is stored but the teacher's choices and saved
 * formats (settings.groupPrefs). The decisions live in core/group-builder.js. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.GroupBuilder) return;

  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  function G() { return CGP.groupBuilder; }

  var PEOPLE_GLYPH =
    '<svg class="cgp-copyto__glyph" viewBox="0 0 16 16" aria-hidden="true">' +
    '<circle cx="5.5" cy="5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<circle cx="11.2" cy="5.6" r="1.9" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M1.6 13.6c.3-2.4 1.9-3.8 3.9-3.8s3.6 1.4 3.9 3.8M9.6 10.1c.5-.3 1-.4 1.6-.4 1.7 0 3 1.2 3.2 3.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function GroupBuilder(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.origin = typeof location !== 'undefined' ? location.origin : '';
    this.button = null;
    this.root = null;
    this.state = null;
    this._tries = 0;
    this._observer = null;
  }

  var P = GroupBuilder.prototype;

  /* ---------------------------------------------------------- the button */

  /** People (/users) and Groups (/groups) pages of this course. */
  P.onPage = function () {
    var base = '/courses/' + this.courseId;
    var p = location.pathname.replace(/\/+$/, '');
    return p === base + '/users' || p === base + '/groups';
  };

  /* Canvas's own "+ Group Set": only teachers who may make groups see it, so
   * the button goes beside it or nowhere. */
  P.findSpot = function () {
    var root = document.querySelector('#content') || document.body;
    var known = root.querySelector('#add-group-set, .add-group-set, [data-testid="add-group-set"]');
    if (known) return known;
    var all = root.querySelectorAll('button, a[role="button"], a.btn');
    for (var i = 0; i < all.length; i++) {
      var t = String(all[i].textContent || '').replace(/\s+/g, ' ').trim();
      var label = String(all[i].getAttribute('aria-label') || '');
      if (/^\+?\s*Group Set$/i.test(t) || /^Add Group Set$/i.test(label)) return all[i];
    }
    return null;
  };

  P.start = function () {
    var self = this;
    if (!this.settings.values.groupBuilder || !this.onPage()) { this.unmount(); return; }
    if (this.button && this.button.isConnected) return;
    var spot = this.findSpot();
    if (!spot) {
      if (this._tries++ < 60) setTimeout(function () { self.start(); }, 250);
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cgp-copyto cgp-groups-btn';
    btn.title = 'Make a group set in one step: how many groups, their names, and random, hand-picked or sign-up groups';
    btn.innerHTML = PEOPLE_GLYPH + '<span class="cgp-copyto__label">Make groups</span>';
    spot.insertAdjacentElement('beforebegin', btn);
    this.button = btn;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.open();
    });
    // Canvas redraws this toolbar when a tab changes: put the button back.
    if (!this._observer && typeof MutationObserver === 'function') {
      var again = CGP.util.debounce(function () {
        if (self.settings.values.groupBuilder && !(self.button && self.button.isConnected)) { self._tries = 0; self.start(); }
      }, 300);
      this._observer = new MutationObserver(function () { if (!(self.button && self.button.isConnected)) again(); });
      this._observer.observe(document.querySelector('#content') || document.body, { childList: true, subtree: true });
    }
  };

  P.unmount = function () {
    if (this.button && this.button.parentNode) this.button.parentNode.removeChild(this.button);
    this.button = null;
  };

  /* -------------------------------------------------------------- dialog */

  /** opts.view: 'new' (default) or 'sets'. */
  P.open = function (opts) {
    var self = this;
    opts = opts || {};
    this.close();
    var prefs = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
    this.state = {
      view: opts.view || 'new',
      loading: true, error: null,
      roster: [], byId: {}, sections: [], sets: [], courses: null,
      changed: false,
      form: {
        name: '', by: prefs.by, count: prefs.count, size: prefs.size,
        format: prefs.format, mode: prefs.mode, limit: '', restrict: false, section: '',
        busy: false, progress: '', error: null
      },
      board: null, copy: null
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-groups';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-groups-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Make groups</div><h2 id="cgp-groups-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-groups__body"></div>' +
      '</div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.requestClose(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.requestClose(); });
    root.addEventListener('click', function (e) { self.onClick(e); });
    root.addEventListener('change', function (e) { self.onChange(e); });
    root.addEventListener('input', function (e) { self.onInput(e); });
    root.addEventListener('dragstart', function (e) { self.onDragStart(e); });
    root.addEventListener('dragover', function (e) { self.onDragOver(e); });
    root.addEventListener('dragleave', function (e) { self.onDragLeave(e); });
    root.addEventListener('drop', function (e) { self.onDrop(e); });
    root.addEventListener('dragend', function () {
      // Dropped outside every card: nothing moves.
      if (!self._dragUid) return;
      self._dragUid = null;
      self.render();
    });
    this._onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.requestClose(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    root.querySelector('#cgp-groups-title').textContent = this.courseName(this.courseId);
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    this.render();
    this.load();
  };

  P.load = function () {
    var self = this;
    var st = this.state;
    st.loading = true;
    st.error = null;
    Promise.all([
      this.api.studentsWithSections(this.courseId),
      this.api.courseSections(this.courseId).catch(function () { return []; }),
      this.api.groupCategories(this.courseId),
      CGP.teachingCourseList ? CGP.teachingCourseList(this.api).catch(function () { return []; }) : Promise.resolve([])
    ]).then(function (r) {
      if (self.state !== st) return;
      self.setRoster(r[0] || [], r[1] || []);
      st.sets = r[2] || [];
      st.courses = r[3] || [];
      st.loading = false;
      if (!st.form.name) st.form.name = G().uniqueSetName('Groups', st.sets.map(function (s) { return s.name; }));
      self.root.querySelector('#cgp-groups-title').textContent = self.courseName(self.courseId);
      self.render();
    }, function (err) {
      if (self.state !== st) return;
      st.loading = false;
      st.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read this class’s students and groups from Canvas' });
      self.render();
    });
  };

  P.setRoster = function (users, sections) {
    var st = this.state;
    var byId = {};
    var withStudents = {};
    var roster = [];
    (users || []).forEach(function (u) {
      if (!u || u.id == null || byId[String(u.id)]) return;
      var secs = [];
      (u.enrollments || []).forEach(function (e) {
        if (e && e.type === 'StudentEnrollment' && e.course_section_id != null) {
          var s = String(e.course_section_id);
          if (secs.indexOf(s) < 0) secs.push(s);
          withStudents[s] = true;
        }
      });
      var row = { id: String(u.id), name: u.name || u.short_name || ('Student ' + u.id), sortable: u.sortable_name || u.name || '', sections: secs };
      byId[row.id] = row;
      roster.push(row);
    });
    roster.sort(function (a, b) { return a.sortable.localeCompare(b.sortable); });
    st.roster = roster;
    st.byId = byId;
    // Sections that hold students; one section is no choice at all.
    st.sections = (sections || []).filter(function (s) { return s && withStudents[String(s.id)]; })
      .map(function (s) { return { id: String(s.id), name: s.name || ('Section ' + s.id) }; });
    if (st.sections.length < 2) st.sections = [];
  };

  P.requestClose = function () {
    var st = this.state;
    if (st && ((st.form && st.form.busy) || (st.board && st.board.saving) || (st.copy && st.copy.running))) {
      CGP.ui.toast('Still saving to Canvas in the background — stay on this page until it is done.');
    } else if (st && st.board && G().moves(st.board.before, st.board.after).length) {
      if (typeof confirm === 'function' && !confirm('Close without saving your changes to the groups?')) return;
    }
    var changed = st && st.changed;
    this.close();
    if (changed) CGP.ui.toast('Reload the page to see the new groups in Canvas’s own tabs.');
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
    var g = CGP.sectionSync && CGP.sectionSync.groupFor(this.settings.values.sectionGroups, this.origin, id);
    if (g && g.names && g.names[String(id)]) return g.names[String(id)];
    if (String(id) === this.courseId) {
      var crumb = document.querySelector('.cgp-crumb-link, #breadcrumbs a[href$="/courses/' + id + '"]');
      var t = crumb ? String(crumb.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t) return t;
    }
    return 'Course ' + id;
  };

  P.sectionName = function (id) {
    var list = (this.state && this.state.sections) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) return list[i].name;
    return 'Section ' + id;
  };

  /** Students in one section of this course, or all of them. */
  P.studentsIn = function (sectionId) {
    var list = this.state.roster;
    if (!sectionId) return list.slice();
    return list.filter(function (s) { return s.sections.indexOf(String(sectionId)) >= 0; });
  };

  P.groupsUrl = function (courseId, categoryId) {
    return '/courses/' + encodeURIComponent(String(courseId)) + '/groups' + (categoryId ? '#tab-' + encodeURIComponent(String(categoryId)) : '');
  };

  /* -------------------------------------------------------------- render */

  P.render = function () {
    if (!this.root || !this.state) return;
    var st = this.state;
    var body = this.root.querySelector('.cgp-groups__body');
    // Keep the caret where the teacher was typing across a redraw.
    var active = document.activeElement;
    var focusKey = active && this.root.contains(active) ? active.getAttribute('data-k') : null;
    var sel = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;

    var html;
    if (st.loading) html = '<p class="cgp-stats__note">Reading your students and groups from Canvas…</p>';
    else if (st.error) html = '<p class="cgp-groups__error">' + esc(st.error) + '</p><button type="button" class="cgp-roster__btn" data-act="retry">Try again</button>';
    else {
      html = this.renderTabs();
      if (st.view === 'board' && st.board) html += this.renderBoard();
      else if (st.view === 'copy' && st.copy) html += this.renderCopy();
      else if (st.view === 'sets') html += this.renderSets();
      else html += this.renderNew();
      if (st.changed) {
        html += '<p class="cgp-groups__reload">Canvas’s own tabs show the changes after a reload. ' +
          '<button type="button" class="cgp-groups__link" data-act="reload">Reload now</button></p>';
      }
    }
    body.innerHTML = html;
    if (focusKey) {
      var again = body.querySelector('[data-k="' + focusKey + '"]');
      if (again) {
        try { again.focus(); if (sel && typeof again.setSelectionRange === 'function') again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ }
      }
    }
  };

  P.renderTabs = function () {
    var st = this.state;
    var tab = function (view, label) {
      var on = st.view === view || (view === 'sets' && (st.view === 'board' || st.view === 'copy'));
      return '<button type="button" class="cgp-sections__tab' + (on ? ' is-on' : '') + '" data-act="view" data-view="' + view + '"' +
        (on ? ' aria-current="true"' : '') + '>' + esc(label) + '</button>';
    };
    return '<div class="cgp-sections__tabs cgp-groups__tabs">' +
      tab('new', 'New group set') + tab('sets', 'Your group sets (' + st.sets.length + ')') + '</div>';
  };

  /* ------------------------------------------------------------ new set */

  P.formNames = function () {
    var f = this.state.form;
    return G().formatNames(f.format, this.formCount(), { set: f.name });
  };

  P.formStudents = function () {
    return this.studentsIn(this.state.form.section).length;
  };

  P.formCount = function () {
    var f = this.state.form;
    return G().groupCount(this.formStudents(), f.by, f.by === 'size' ? f.size : f.count);
  };

  P.sizeLine = function () {
    var n = this.formStudents();
    var c = this.formCount();
    var r = G().sizeRange(n, c);
    var each = r.min === r.max ? String(r.min) : r.min + '–' + r.max;
    return n + ' student' + (n === 1 ? '' : 's') + ' → ' + c + ' group' + (c === 1 ? '' : 's') + ' of ' + each;
  };

  P.previewHtml = function () {
    var names = this.formNames();
    var shown = names.slice(0, 10);
    var more = names.length - shown.length;
    return shown.map(function (n) { return '<span class="cgp-sections__chip">' + esc(n) + '</span>'; }).join('') +
      (more > 0 ? '<span class="cgp-groups__more">and ' + more + ' more</span>' : '');
  };

  P.renderNew = function () {
    var st = this.state;
    var f = st.form;
    var prefs = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
    var presets = G().PRESETS;
    var known = presets.some(function (p) { return p.format === f.format; }) || prefs.formats.indexOf(f.format) >= 0;
    var saved = prefs.formats.indexOf(f.format) >= 0;
    var options = '<optgroup label="Built in">' + presets.map(function (p) {
      return '<option value="p:' + esc(p.format) + '"' + (p.format === f.format ? ' selected' : '') + '>' + esc(p.label) + '</option>';
    }).join('') + '</optgroup>';
    if (prefs.formats.length) {
      options += '<optgroup label="Your formats">' + prefs.formats.map(function (s) {
        var label = s.length > 48 ? s.slice(0, 46) + '…' : s;
        return '<option value="p:' + esc(s) + '"' + (s === f.format ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('') + '</optgroup>';
    }
    options += '<option value="custom"' + (known ? '' : ' selected') + '>Your own…</option>';

    var radio = function (name, value, cur, label) {
      return '<label class="cgp-groups__radio"><input type="radio" name="' + name + '" value="' + value + '" data-f="' + name + '"' +
        (cur === value ? ' checked' : '') + (f.busy ? ' disabled' : '') + '> ' + label + '</label>';
    };
    var sections = st.sections.length ? '<div class="cgp-groups__field"><label class="cgp-groups__label" for="cgp-g-section">Students</label>' +
      '<select id="cgp-g-section" class="cgp-groups__input" data-f="section"' + (f.busy ? ' disabled' : '') + '>' +
      '<option value="">Everyone in this class (' + st.roster.length + ')</option>' +
      st.sections.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (f.section === s.id ? ' selected' : '') + '>Only ' + esc(s.name) + ' (' + this.studentsIn(s.id).length + ')</option>';
      }, this).join('') + '</select></div>' : '';

    var signup = f.mode === 'signup' ? '<div class="cgp-groups__sub">' +
      '<label class="cgp-groups__inline">At most <input type="number" min="1" max="50" class="cgp-groups__num" data-f="limit" data-k="limit" value="' + esc(f.limit) + '" placeholder="' +
      esc(G().sizeRange(this.formStudents(), this.formCount()).max) + '"' + (f.busy ? ' disabled' : '') + '> students per group <span class="cgp-groups__hint">(blank: no limit)</span></label>' +
      (st.sections.length ? '<label class="cgp-groups__inline"><input type="checkbox" data-f="restrict"' + (f.restrict ? ' checked' : '') + (f.busy ? ' disabled' : '') +
        '> Only with classmates in their own section</label>' : '') +
      '</div>' : '';

    var count = this.formCount();
    var go = f.busy ? (f.progress || 'Working…') : 'Make ' + count + ' group' + (count === 1 ? '' : 's');
    return '<div class="cgp-groups__form">' +
      '<div class="cgp-groups__field"><label class="cgp-groups__label" for="cgp-g-name">Group set name</label>' +
      '<input id="cgp-g-name" class="cgp-groups__input" data-f="name" data-k="name" maxlength="80" value="' + esc(f.name) + '"' + (f.busy ? ' disabled' : '') + '>' +
      (G().nameTaken(f.name, st.sets.map(function (s) { return s.name; })) ? '<span class="cgp-groups__warn">This class already has a group set with this name.</span>' : '') +
      '</div>' +
      sections +
      '<div class="cgp-groups__field"><span class="cgp-groups__label">How many</span><div class="cgp-groups__row">' +
      '<label class="cgp-groups__radio"><input type="radio" name="by" value="count" data-f="by"' + (f.by === 'count' ? ' checked' : '') + (f.busy ? ' disabled' : '') + '> ' +
      '<input type="number" min="1" max="100" class="cgp-groups__num" data-f="count" data-k="count" value="' + esc(f.count) + '" aria-label="Number of groups"' + (f.busy ? ' disabled' : '') + '> groups</label>' +
      '<label class="cgp-groups__radio"><input type="radio" name="by" value="size" data-f="by"' + (f.by === 'size' ? ' checked' : '') + (f.busy ? ' disabled' : '') + '> ' +
      '<input type="number" min="1" max="50" class="cgp-groups__num" data-f="size" data-k="size" value="' + esc(f.size) + '" aria-label="Students per group"' + (f.busy ? ' disabled' : '') + '> students per group</label>' +
      '</div><div class="cgp-groups__hint" data-part="sizes">' + esc(this.sizeLine()) + '</div></div>' +
      '<div class="cgp-groups__field"><label class="cgp-groups__label" for="cgp-g-format">Group names</label><div class="cgp-groups__row">' +
      '<select id="cgp-g-format" class="cgp-groups__input cgp-groups__input--select" data-f="formatPick"' + (f.busy ? ' disabled' : '') + '>' + options + '</select>' +
      '<input class="cgp-groups__input cgp-groups__input--grow" data-f="format" data-k="format" maxlength="400" value="' + esc(f.format) + '" aria-label="Name format"' + (f.busy ? ' disabled' : '') + '>' +
      (saved ? '<button type="button" class="cgp-roster__btn" data-act="forget-format"' + (f.busy ? ' disabled' : '') + '>Remove from your formats</button>'
        : (known ? '' : '<button type="button" class="cgp-roster__btn" data-act="save-format"' + (f.busy ? ' disabled' : '') + '>Save format</button>')) +
      '</div><div class="cgp-groups__hint">Use <code>{n}</code> for 1, 2, 3 · <code>{nn}</code> for 01, 02 · <code>{A}</code> for A, B, C · <code>{a}</code> for a, b, c · ' +
      '<code>{set}</code> for the set’s name — or list names separated by commas.</div>' +
      '<div class="cgp-sections__chips" data-part="preview">' + this.previewHtml() + '</div></div>' +
      '<div class="cgp-groups__field"><span class="cgp-groups__label">Putting students in groups</span>' +
      radio('mode', 'random', f.mode, '<b>Sort students at random now</b> <span class="cgp-groups__hint">— groups as even as possible; you can still move anyone afterwards</span>') +
      radio('mode', 'manual', f.mode, '<b>I’ll place students myself</b> <span class="cgp-groups__hint">— opens the groups so you can drag students in</span>') +
      radio('mode', 'signup', f.mode, '<b>Let students sign up</b> <span class="cgp-groups__hint">— students join a group themselves in Canvas</span>') +
      signup + '</div>' +
      (f.error ? '<p class="cgp-groups__error">' + esc(f.error) + '</p>' : '') +
      '<div class="cgp-groups__foot"><button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="create" data-part="go"' +
      (f.busy || !String(f.name).trim() ? ' disabled' : '') + '>' + esc(go) + '</button>' +
      '<span class="cgp-groups__hint">Nothing changes in Canvas until you press this.</span></div>' +
      '</div>';
  };

  /* Live parts of the form, updated while typing without a full redraw. */
  P.refreshNewLive = function () {
    if (!this.root || this.state.view !== 'new') return;
    var sizes = this.root.querySelector('[data-part="sizes"]');
    if (sizes) sizes.textContent = this.sizeLine();
    var prev = this.root.querySelector('[data-part="preview"]');
    if (prev) prev.innerHTML = this.previewHtml();
    var go = this.root.querySelector('[data-part="go"]');
    var f = this.state.form;
    if (go && !f.busy) {
      var c = this.formCount();
      go.textContent = 'Make ' + c + ' group' + (c === 1 ? '' : 's');
      go.disabled = !String(f.name).trim();
    }
  };

  P.savePrefs = function (patch) {
    var next = Object.assign({}, CGP.cleanGroupPrefs(this.settings.values.groupPrefs), patch || {});
    return this.settings.save({ groupPrefs: next }).catch(function (err) {
      CGP.ui.error('Couldn’t save your group choices: ' + String(err && err.message));
    });
  };

  P.create = function () {
    var self = this;
    var st = this.state;
    var f = st.form;
    if (f.busy) return;
    var name = String(f.name || '').trim();
    var taken = st.sets.map(function (s) { return s.name; });
    if (!name) return;
    if (G().nameTaken(name, taken)) {
      f.error = 'This class already has a group set called “' + name + '”. Pick another name.';
      this.render();
      return;
    }
    var names = this.formNames();
    var signup = f.mode === 'signup' ? (f.restrict ? 'restricted' : 'enabled') : null;
    var body = G().categoryBody(name, signup, f.limit);
    f.busy = true;
    f.error = null;
    f.progress = 'Making the group set…';
    this.render();
    this.savePrefs({ format: f.format, by: f.by, count: Number(f.count) || 1, size: Number(f.size) || 1, mode: f.mode });

    var category = null;
    var groups = [];
    var step = function (text) { f.progress = text; if (self.state === st) self.render(); };
    this.api.createGroupCategory(this.courseId, body).then(function (cat) {
      category = cat;
      st.changed = true;
      st.sets.push(cat);
      // One at a time, so Canvas keeps them in this order.
      return names.reduce(function (p, n, i) {
        return p.then(function () {
          step('Making group ' + (i + 1) + ' of ' + names.length + '…');
          return self.api.createGroup(cat.id, { name: n }).then(function (g) { groups.push(g); });
        });
      }, Promise.resolve());
    }).then(function () {
      if (f.mode !== 'random') return { placed: 0, unplaced: [] };
      var pool = self.studentsIn(f.section).map(function (s) { return s.id; });
      var plan = G().planRandom({ groups: groups.map(function (g) { return { id: g.id }; }), current: {}, pool: pool, keep: false });
      var changes = G().moves({}, plan.placement);
      step('Putting students in groups…');
      return self.applyMoves(changes, function (done) {
        step('Putting students in groups… ' + done + ' of ' + changes.length);
      }).then(function (r) {
        if (r.failed.length) throw Object.assign(new Error('Some students could not be put in a group'), { partial: r });
        return { placed: changes.length, unplaced: plan.unplaced };
      });
    }).then(function (r) {
      if (self.state !== st) return;
      f.busy = false;
      f.progress = '';
      f.name = G().uniqueSetName(name, st.sets.map(function (s) { return s.name; }));
      var msg = 'Made “' + name + '” with ' + groups.length + ' group' + (groups.length === 1 ? '' : 's') +
        (f.mode === 'random' ? ' and sorted ' + r.placed + ' student' + (r.placed === 1 ? '' : 's') + ' into them' : '') + '.';
      if (f.mode === 'signup') {
        CGP.ui.toast(msg + ' Students can now sign up in Canvas.');
        st.view = 'sets';
        self.render();
        return;
      }
      CGP.ui.toast(msg);
      self.openBoard(category, msg);
    }).catch(function (err) {
      if (self.state !== st) return;
      f.busy = false;
      f.progress = '';
      var what = category ? 'The group set “' + name + '” was made with ' + groups.length + ' of ' + names.length + ' groups, but then ' : '';
      f.error = what + (err && err.partial ? 'some students couldn’t be placed. Open it under Your group sets to finish.'
        : CGP.util.describeApiError(err, { fallback: (what ? 'Canvas stopped answering' : 'Canvas didn’t make the group set') }));
      self.render();
    });
  };

  /** Membership changes, a few at a time (the API client's own pool).
   * Returns {done: [move], failed: [{move, err}]}; never rejects. */
  P.applyMoves = function (list, onProgress, api) {
    var a = api || this.api;
    var done = [], failed = [];
    var count = 0;
    return Promise.all((list || []).map(function (m) {
      var req = m.to ? a.addGroupMember(m.to, m.userId) : a.removeGroupMember(m.from, m.userId);
      return req.then(function () { done.push(m); }, function (err) { failed.push({ move: m, err: err }); })
        .then(function () { count++; if (onProgress) onProgress(count); });
    })).then(function () { return { done: done, failed: failed }; });
  };

  /* ----------------------------------------------------------- set list */

  P.renderSets = function () {
    var st = this.state;
    if (!st.sets.length) {
      return '<p class="cgp-stats__note">This class has no group sets yet. ' +
        '<button type="button" class="cgp-groups__link" data-act="view" data-view="new">Make one</button></p>';
    }
    var self = this;
    return '<ul class="cgp-groups__sets">' + st.sets.map(function (s) {
      var bits = [];
      if (s.groups_count != null) bits.push(s.groups_count + ' group' + (s.groups_count === 1 ? '' : 's'));
      if (s.self_signup) bits.push('students sign up' + (s.self_signup === 'restricted' ? ' (own section)' : '') + (s.group_limit ? ', ' + s.group_limit + ' max' : ''));
      if (s.unassigned_users_count) bits.push(s.unassigned_users_count + ' not in a group');
      return '<li class="cgp-groups__set">' +
        '<div class="cgp-groups__set-name"><b>' + esc(s.name) + '</b><span class="cgp-groups__hint">' + esc(bits.join(' · ')) + '</span></div>' +
        '<div class="cgp-groups__set-acts">' +
        '<button type="button" class="cgp-roster__btn" data-act="board" data-id="' + esc(s.id) + '">Arrange students</button>' +
        '<button type="button" class="cgp-roster__btn" data-act="copy" data-id="' + esc(s.id) + '">Copy to…</button>' +
        '<a class="cgp-groups__link" href="' + esc(self.groupsUrl(self.courseId, s.id)) + '">Open in Canvas</a>' +
        '</div></li>';
    }).join('') + '</ul>';
  };

  P.findSet = function (id) {
    var list = this.state.sets;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  };

  /** Groups of a set with who is in each: {groups: [{id, name, max}], current: {userId: groupId}, extra: {userId: name}}. */
  P.readSet = function (set) {
    var self = this;
    return this.api.categoryGroups(set.id).then(function (groups) {
      return Promise.all((groups || []).map(function (g) {
        return self.api.groupUsers(g.id).then(function (users) { return { g: g, users: users || [] }; });
      }));
    }).then(function (rows) {
      var current = {}, extra = {};
      var groups = rows.map(function (r) {
        r.users.forEach(function (u) {
          var id = String(u.id);
          current[id] = String(r.g.id);
          if (!self.state.byId[id]) extra[id] = u.sortable_name || u.name || ('User ' + id);
        });
        var max = Number(r.g.max_membership) || Number(set.group_limit) || null;
        return { id: String(r.g.id), name: r.g.name || ('Group ' + r.g.id), max: max > 0 ? max : null };
      });
      return { groups: groups, current: current, extra: extra };
    });
  };

  /* -------------------------------------------------------------- board */

  P.openBoard = function (set, message) {
    var self = this;
    var st = this.state;
    st.view = 'board';
    st.board = { set: set, loading: true, groups: [], before: {}, after: {}, extra: {}, section: '', saving: false, message: message || null, error: null, failed: {} };
    this.render();
    var b = st.board;
    this.readSet(set).then(function (r) {
      if (self.state !== st || st.board !== b) return;
      b.loading = false;
      b.groups = r.groups;
      b.extra = r.extra;
      // Every student on the roster, in a group or not; members who are
      // not on it (no longer active) only as they are.
      st.roster.forEach(function (s) { b.before[s.id] = r.current[s.id] || null; });
      Object.keys(r.extra).forEach(function (id) { b.before[id] = r.current[id]; });
      b.after = Object.assign({}, b.before);
      self.render();
    }, function (err) {
      if (self.state !== st || st.board !== b) return;
      b.loading = false;
      b.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read the groups from Canvas' });
      self.render();
    });
  };

  P.boardVisible = function (uid) {
    var b = this.state.board;
    if (!b.section) return true;
    var s = this.state.byId[uid];
    return !!(s && s.sections.indexOf(b.section) >= 0);
  };

  P.renderBoard = function () {
    var st = this.state;
    var b = st.board;
    var self = this;
    var head = '<div class="cgp-groups__bar"><button type="button" class="cgp-groups__link" data-act="view" data-view="sets">← Your group sets</button>' +
      '<h3 class="cgp-groups__title">' + esc(b.set.name) + '</h3>' +
      '<a class="cgp-groups__link" href="' + esc(this.groupsUrl(this.courseId, b.set.id)) + '">Open in Canvas</a></div>';
    if (b.loading) return head + '<p class="cgp-stats__note">Reading the groups…</p>';
    if (b.error) return head + '<p class="cgp-groups__error">' + esc(b.error) + '</p>';
    if (!b.groups.length) return head + '<p class="cgp-stats__note">This group set has no groups yet.</p>';

    var pending = G().moves(b.before, b.after);
    var name = function (uid) {
      var s = st.byId[uid];
      return s ? s.name : (b.extra[uid] || ('User ' + uid));
    };
    var opts = function (cur) {
      return '<option value=""' + (cur ? '' : ' selected') + '>Not in a group</option>' + b.groups.map(function (g) {
        return '<option value="' + esc(g.id) + '"' + (cur === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
      }).join('');
    };
    var cards = [{ id: '', name: 'Not in a group', max: null }].concat(b.groups).map(function (g) {
      var members = Object.keys(b.after).filter(function (uid) { return (b.after[uid] || '') === g.id; });
      var shown = members.filter(function (uid) { return self.boardVisible(uid); })
        .sort(function (x, y) {
          var a = st.byId[x], c = st.byId[y];
          return String(a ? a.sortable : b.extra[x] || '').localeCompare(String(c ? c.sortable : b.extra[y] || ''));
        });
      var full = g.max && members.length > g.max;
      var rows = shown.map(function (uid) {
        var moved = (b.before[uid] || '') !== (b.after[uid] || '');
        var s = st.byId[uid];
        var tag = !s ? '<span class="cgp-sections__tag">not enrolled</span>'
          : (st.sections.length && !b.section && s.sections.length ? '<span class="cgp-sections__tag">' + esc(self.sectionName(s.sections[0])) + '</span>' : '');
        return '<li class="cgp-groups__member' + (moved ? ' is-moved' : '') + (b.failed[uid] ? ' is-failed' : '') + '" draggable="true" data-uid="' + esc(uid) + '">' +
          '<span class="cgp-groups__grip" aria-hidden="true">⋮⋮</span><span class="cgp-groups__who">' + esc(name(uid)) + '</span>' + tag +
          '<select class="cgp-groups__move" data-uid="' + esc(uid) + '" aria-label="Group for ' + esc(name(uid)) + '"' + (b.saving ? ' disabled' : '') + '>' + opts(b.after[uid] || '') + '</select></li>';
      }).join('');
      var count = members.length + (g.max ? ' / ' + g.max : '');
      return '<section class="cgp-groups__card' + (g.id ? '' : ' cgp-groups__card--none') + (full ? ' is-over' : '') + '" data-gid="' + esc(g.id) + '">' +
        '<h4>' + esc(g.name) + ' <span class="cgp-groups__count">' + esc(count) + '</span></h4>' +
        '<ul>' + (rows || '<li class="cgp-groups__empty">' + (g.id ? 'Drop students here' : 'Everyone is in a group') + '</li>') + '</ul></section>';
    }).join('');

    var sectionPick = st.sections.length ? '<select class="cgp-groups__input cgp-groups__input--select" data-f="boardSection" aria-label="Show students from"' + (b.saving ? ' disabled' : '') + '>' +
      '<option value="">Everyone</option>' + st.sections.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (b.section === s.id ? ' selected' : '') + '>Only ' + esc(s.name) + '</option>';
      }).join('') + '</select>' : '';
    var who = b.section ? ' in ' + esc(this.sectionName(b.section)) : '';
    var tools = '<div class="cgp-groups__tools">' + sectionPick +
      '<button type="button" class="cgp-roster__btn" data-act="shuffle-rest"' + (b.saving ? ' disabled' : '') + ' title="Students' + who + ' who are not in a group yet go into the smallest groups, at random">Sort the rest at random</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="shuffle-all"' + (b.saving ? ' disabled' : '') + ' title="Every student' + who + ' is placed again, at random">Shuffle everyone' + who + '</button>' +
      '<span class="cgp-groups__hint">Drag a student to another group, or pick one beside their name.</span></div>';
    var foot = '<div class="cgp-groups__foot">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="save-board"' + (pending.length && !b.saving ? '' : ' disabled') + '>' +
      (b.saving ? esc(b.progress || 'Saving…') : 'Save ' + pending.length + ' change' + (pending.length === 1 ? '' : 's')) + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="undo-board"' + (pending.length && !b.saving ? '' : ' disabled') + '>Undo changes</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="copy" data-id="' + esc(b.set.id) + '"' + (b.saving ? ' disabled' : '') + '>Copy these groups to…</button>' +
      '<span class="cgp-groups__hint">' + (pending.length ? 'Not saved yet: Canvas changes when you press Save.' : esc(b.message || 'Everything here is saved in Canvas.')) + '</span></div>';
    return head + tools + (b.error ? '<p class="cgp-groups__error">' + esc(b.error) + '</p>' : '') +
      '<div class="cgp-groups__board">' + cards + '</div>' + foot;
  };

  P.boardShuffle = function (keep) {
    var st = this.state;
    var b = st.board;
    var self = this;
    var pool = st.roster.filter(function (s) { return self.boardVisible(s.id); }).map(function (s) { return s.id; });
    var plan = G().planRandom({ groups: b.groups, current: b.after, pool: pool, keep: keep });
    pool.forEach(function (uid) { b.after[uid] = plan.placement[uid] || null; });
    b.message = null;
    if (plan.unplaced.length) CGP.ui.toast(plan.unplaced.length + ' student' + (plan.unplaced.length === 1 ? '' : 's') + ' didn’t fit: every group is full.');
    this.render();
  };

  P.saveBoard = function () {
    var self = this;
    var st = this.state;
    var b = st.board;
    var list = G().moves(b.before, b.after);
    if (!list.length || b.saving) return;
    b.saving = true;
    b.error = null;
    b.failed = {};
    b.progress = 'Saving… 0 of ' + list.length;
    this.render();
    this.applyMoves(list, function (n) {
      b.progress = 'Saving… ' + n + ' of ' + list.length;
      if (self.root && self.state === st && st.board === b) {
        var btn = self.root.querySelector('[data-act="save-board"]');
        if (btn) btn.textContent = b.progress;
      }
    }).then(function (r) {
      if (self.state !== st || st.board !== b) return;
      b.saving = false;
      r.done.forEach(function (m) { b.before[m.userId] = m.to; });
      st.changed = st.changed || r.done.length > 0;
      if (r.failed.length) {
        r.failed.forEach(function (x) { b.failed[x.move.userId] = true; });
        b.error = r.failed.length + ' change' + (r.failed.length === 1 ? '' : 's') + ' didn’t save (marked in red): ' +
          CGP.util.describeApiError(r.failed[0].err, { fallback: 'Canvas refused it' }) + ' Press Save to try again.';
      } else {
        b.message = 'Saved ' + r.done.length + ' change' + (r.done.length === 1 ? '' : 's') + ' in Canvas.';
      }
      self.render();
    });
  };

  /* --------------------------------------------------------------- copy */

  P.siblings = function () {
    return CGP.sectionSync ? CGP.sectionSync.siblings(this.settings.values.sectionGroups, this.origin, this.courseId) : [];
  };

  P.openCopy = function (set) {
    var self = this;
    var st = this.state;
    st.view = 'copy';
    st.copy = { set: set, loading: true, groups: [], dests: {}, name: set.name, random: !set.self_signup, running: false, results: null, error: null, showAll: false, q: '' };
    this.render();
    var c = st.copy;
    this.api.categoryGroups(set.id).then(function (groups) {
      if (self.state !== st || st.copy !== c) return;
      c.loading = false;
      c.groups = groups || [];
      self.render();
    }, function (err) {
      if (self.state !== st || st.copy !== c) return;
      c.loading = false;
      c.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read the groups from Canvas' });
      self.render();
    });
  };

  /* Where a copy can go: the linked classes first, then the teacher's other
   * courses (this term's, when Canvas says which term this is), then the
   * other sections of this course. Keys: 'c:<courseId>' / 's:<sectionId>'. */
  P.copyTargets = function () {
    var st = this.state;
    var self = this;
    var linked = this.siblings();
    var courses = (st.courses || []).filter(function (c) { return String(c.id) !== self.courseId; });
    var mine = (st.courses || []).filter(function (c) { return String(c.id) === self.courseId; })[0];
    var term = mine && mine.term && mine.term.name;
    var linkedRows = linked.map(function (id) {
      var c = courses.filter(function (x) { return String(x.id) === String(id); })[0];
      return { key: 'c:' + id, label: c ? c.name : self.courseName(id), sub: c && c.term ? c.term.name : '', linked: true };
    });
    var others = courses.filter(function (c) { return linked.indexOf(String(c.id)) < 0; })
      .filter(function (c) { return st.copy.showAll || !term || (c.term && c.term.name === term); })
      .map(function (c) { return { key: 'c:' + c.id, label: c.name, sub: c.term ? c.term.name : '' }; });
    var sections = st.sections.map(function (s) { return { key: 's:' + s.id, label: s.name, sub: 'section of this class' }; });
    return { linked: linkedRows, others: others, sections: sections, term: term };
  };

  P.renderCopy = function () {
    var st = this.state;
    var c = st.copy;
    var self = this;
    var head = '<div class="cgp-groups__bar"><button type="button" class="cgp-groups__link" data-act="view" data-view="sets">← Your group sets</button>' +
      '<h3 class="cgp-groups__title">Copy “' + esc(c.set.name) + '”</h3></div>';
    if (c.loading) return head + '<p class="cgp-stats__note">Reading the groups…</p>';
    if (c.error && !c.results) return head + '<p class="cgp-groups__error">' + esc(c.error) + '</p>';

    if (c.results) {
      return head + '<ul class="cgp-groups__results">' + c.results.map(function (r) {
        var link = r.url ? ' <a class="cgp-groups__link" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open</a>' : '';
        return '<li class="cgp-groups__result is-' + r.status + '"><b>' + esc(r.label) + '</b> — ' + esc(r.text) + link + '</li>';
      }).join('') + '</ul>' +
        '<div class="cgp-groups__foot"><button type="button" class="cgp-roster__btn" data-act="view" data-view="sets">Done</button></div>';
    }

    var signup = c.set.self_signup;
    var groupLine = c.groups.length + ' group' + (c.groups.length === 1 ? '' : 's') + ': ' +
      c.groups.slice(0, 6).map(function (g) { return g.name; }).join(', ') + (c.groups.length > 6 ? '…' : '');
    var t = this.copyTargets();
    var row = function (d) {
      return '<label class="cgp-sections__course"><input type="checkbox" data-dest="' + esc(d.key) + '"' + (c.dests[d.key] ? ' checked' : '') + (c.running ? ' disabled' : '') + '>' +
        '<span class="cgp-sections__course-name">' + esc(d.label) + '</span>' +
        (d.linked ? '<span class="cgp-sections__tag cgp-sections__tag--hint">linked class</span>' : '') +
        (d.sub ? '<span class="cgp-sections__term">' + esc(d.sub) + '</span>' : '') + '</label>';
    };
    var list = '';
    if (t.linked.length) list += '<div class="cgp-groups__group-h">Your linked classes</div>' + t.linked.map(row).join('');
    if (t.sections.length) list += '<div class="cgp-groups__group-h">Another section of this class</div>' + t.sections.map(row).join('');
    list += '<div class="cgp-groups__group-h">' + (t.linked.length ? 'Other courses you teach' : 'Courses you teach') + (t.term && !c.showAll ? ' · ' + esc(t.term) : '') + '</div>' +
      (t.others.length ? t.others.map(row).join('') : '<div class="cgp-groups__hint cgp-groups__pad">No other courses' + (t.term && !c.showAll ? ' this term' : '') + '.</div>') +
      (t.term ? '<button type="button" class="cgp-groups__link cgp-groups__pad" data-act="copy-all-terms">' + (c.showAll ? 'Only this term' : 'Show every term') + '</button>' : '');
    var n = Object.keys(c.dests).filter(function (k) { return c.dests[k]; }).length;
    return head +
      '<p class="cgp-stats__note">' + esc(groupLine) + (signup ? ' · students sign up themselves' : '') + '</p>' +
      '<div class="cgp-groups__field"><label class="cgp-groups__label" for="cgp-g-copyname">Name in the other classes</label>' +
      '<input id="cgp-g-copyname" class="cgp-groups__input" data-f="copyName" data-k="copyName" maxlength="80" value="' + esc(c.name) + '"' + (c.running ? ' disabled' : '') + '>' +
      '<span class="cgp-groups__hint">A section of this class gets this name plus the section’s name.</span></div>' +
      '<div class="cgp-groups__field"><span class="cgp-groups__label">Copy to</span><div class="cgp-sections__courses">' + list + '</div></div>' +
      '<div class="cgp-groups__field">' + (signup
        ? '<span class="cgp-groups__hint">Students sign up for these groups themselves, so the copies are sign-up groups too, with the same limit.</span>'
        : '<label class="cgp-groups__inline"><input type="checkbox" data-f="copyRandom"' + (c.random ? ' checked' : '') + (c.running ? ' disabled' : '') +
          '> Sort each class’s students into the groups at random</label><span class="cgp-groups__hint">Off: the groups are made empty, for you to fill.</span>') + '</div>' +
      (c.error ? '<p class="cgp-groups__error">' + esc(c.error) + '</p>' : '') +
      '<div class="cgp-groups__foot"><button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="run-copy"' + (n && !c.running && String(c.name).trim() ? '' : ' disabled') + '>' +
      (c.running ? esc(c.progress || 'Copying…') : (n ? 'Copy to ' + n + ' place' + (n === 1 ? '' : 's') : 'Pick where to copy')) + '</button>' +
      '<span class="cgp-groups__hint">Copies the group set, its group names and sizes — never students from this class.</span></div>';
  };

  P.runCopy = function () {
    var self = this;
    var st = this.state;
    var c = st.copy;
    if (c.running) return;
    var keys = Object.keys(c.dests).filter(function (k) { return c.dests[k]; });
    if (!keys.length) return;
    var base = String(c.name || '').trim() || c.set.name;
    var t = this.copyTargets();
    var labels = {};
    t.linked.concat(t.others, t.sections).forEach(function (d) { labels[d.key] = d.label; });
    c.running = true;
    c.error = null;
    c.results = null;
    var results = [];
    this.render();
    keys.reduce(function (p, key, i) {
      return p.then(function () {
        c.progress = 'Copying ' + (i + 1) + ' of ' + keys.length + '…';
        if (self.state === st) self.render();
        var label = labels[key] || key;
        return self.copyOne(key, base, c).then(function (r) {
          results.push(Object.assign({ label: label }, r));
        }, function (err) {
          results.push({ label: label, status: 'error', text: CGP.util.describeApiError(err, { fallback: 'Canvas refused it' }) });
        });
      });
    }, Promise.resolve()).then(function () {
      if (self.state !== st || st.copy !== c) return;
      c.running = false;
      c.results = results;
      self.render();
    });
  };

  /* One destination: a linked/other course ('c:'), or a section of this
   * course ('s:', a new set here for that section's students). */
  P.copyOne = function (key, baseName, c) {
    var self = this;
    var st = this.state;
    var isSection = key.indexOf('s:') === 0;
    var id = key.slice(2);
    var courseId = isSection ? this.courseId : id;
    var name = isSection ? baseName + ' – ' + this.sectionName(id) : baseName;
    var readTaken = isSection ? Promise.resolve(st.sets) : this.api.groupCategories(courseId);
    var cat = null, made = [];
    return readTaken.then(function (sets) {
      var plan = G().copyPlan(c.set, c.groups, (sets || []).map(function (s) { return s.name; }), name);
      if (plan.conflict) return { status: 'skip', text: 'already has a group set called “' + plan.name + '”, so nothing was made', url: self.groupsUrl(courseId) };
      return self.api.createGroupCategory(courseId, plan.body).then(function (made1) {
        cat = made1;
        if (isSection) { st.sets.push(cat); st.changed = true; }
        return plan.groups.reduce(function (p, g) {
          return p.then(function () {
            var body = { name: g.name };
            if (g.max) body.max_membership = g.max;
            return self.api.createGroup(cat.id, body).then(function (x) { made.push(x); });
          });
        }, Promise.resolve());
      }).then(function () {
        if (!c.random || c.set.self_signup) return 0;
        var students = isSection ? Promise.resolve(self.studentsIn(id).map(function (s) { return s.id; }))
          : self.api.courseStudents(courseId).then(function (us) { return (us || []).map(function (u) { return String(u.id); }); });
        return students.then(function (pool) {
          var r = G().planRandom({ groups: made.map(function (g, i) { return { id: g.id, max: plan.groups[i] && plan.groups[i].max }; }), current: {}, pool: pool, keep: false });
          var list = G().moves({}, r.placement);
          return self.applyMoves(list).then(function (res) {
            if (res.failed.length) throw new Error(res.failed.length + ' student(s) could not be placed');
            return list.length;
          });
        });
      }).then(function (placed) {
        return {
          status: 'ok',
          text: 'made “' + plan.name + '” with ' + made.length + ' group' + (made.length === 1 ? '' : 's') +
            (placed ? ' and sorted ' + placed + ' student' + (placed === 1 ? '' : 's') + ' into them' : ''),
          url: self.groupsUrl(courseId, cat.id)
        };
      }, function (err) {
        if (!cat) throw err;
        return {
          status: 'error',
          text: 'made “' + plan.name + '” with ' + made.length + ' of ' + plan.groups.length + ' groups, then: ' +
            CGP.util.describeApiError(err, { fallback: String(err && err.message) || 'Canvas stopped answering' }),
          url: self.groupsUrl(courseId, cat.id)
        };
      });
    });
  };

  /* -------------------------------------------------------------- events */

  P.onClick = function (e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || !this.root || !this.root.contains(t) || !this.state) return;
    var st = this.state;
    var act = t.getAttribute('data-act');
    if (act === 'retry') { this.load(); this.render(); return; }
    if (act === 'reload') { location.reload(); return; }
    if (act === 'view') {
      if (st.board && G().moves(st.board.before, st.board.after).length && st.view === 'board' &&
          typeof confirm === 'function' && !confirm('Leave without saving your changes to the groups?')) return;
      st.view = t.getAttribute('data-view');
      if (st.view !== 'board') st.board = st.board && st.board.saving ? st.board : null;
      this.render();
      return;
    }
    if (act === 'create') { this.create(); return; }
    if (act === 'save-format') {
      var f = st.form;
      var prefs = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
      var list = [f.format].concat(prefs.formats.filter(function (x) { return x !== f.format; }));
      if (list.length > CGP.SETTINGS_LIMITS.MAX_GROUP_FORMATS) CGP.ui.toast('Your oldest saved format made room for this one.');
      var self = this;
      this.savePrefs({ formats: list.slice(0, CGP.SETTINGS_LIMITS.MAX_GROUP_FORMATS), format: f.format }).then(function () { self.render(); });
      return;
    }
    if (act === 'forget-format') {
      var f2 = st.form;
      var p2 = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
      var self2 = this;
      this.savePrefs({ formats: p2.formats.filter(function (x) { return x !== f2.format; }) }).then(function () { self2.render(); });
      return;
    }
    if (act === 'board') { var s = this.findSet(t.getAttribute('data-id')); if (s) this.openBoard(s); return; }
    if (act === 'copy') {
      var s2 = this.findSet(t.getAttribute('data-id')) || (st.board && st.board.set);
      if (!s2) return;
      if (st.view === 'board' && st.board && G().moves(st.board.before, st.board.after).length &&
          typeof confirm === 'function' && !confirm('Leave without saving your changes to the groups?')) return;
      this.openCopy(s2);
      return;
    }
    if (act === 'shuffle-all') { this.boardShuffle(false); return; }
    if (act === 'shuffle-rest') { this.boardShuffle(true); return; }
    if (act === 'undo-board') { st.board.after = Object.assign({}, st.board.before); st.board.failed = {}; this.render(); return; }
    if (act === 'save-board') { this.saveBoard(); return; }
    if (act === 'copy-all-terms') { st.copy.showAll = !st.copy.showAll; this.render(); return; }
    if (act === 'run-copy') { this.runCopy(); return; }
  };

  P.onChange = function (e) {
    var t = e.target;
    var st = this.state;
    if (!st || !t) return;
    if (t.classList && t.classList.contains('cgp-groups__move')) {
      st.board.after[t.getAttribute('data-uid')] = t.value || null;
      st.board.message = null;
      this.render();
      return;
    }
    if (t.hasAttribute('data-dest')) {
      st.copy.dests[t.getAttribute('data-dest')] = t.checked;
      this.render();
      return;
    }
    var k = t.getAttribute('data-f');
    if (!k) return;
    var f = st.form;
    if (k === 'by' || k === 'mode') { f[k] = t.value; f.error = null; this.render(); return; }
    if (k === 'restrict') { f.restrict = t.checked; return; }
    if (k === 'section') { f.section = t.value; this.render(); return; }
    if (k === 'formatPick') {
      if (t.value.indexOf('p:') === 0) f.format = t.value.slice(2);
      this.render();
      if (t.value === 'custom') {
        var input = this.root.querySelector('[data-k="format"]');
        if (input) { input.focus(); input.select(); }
      }
      return;
    }
    if (k === 'boardSection') { st.board.section = t.value; this.render(); return; }
    if (k === 'copyRandom') { st.copy.random = t.checked; return; }
    // Number and text boxes: their final value, with the full redraw that
    // typing skipped (the format picker follows a typed format, say).
    if (k === 'format' || k === 'count' || k === 'size' || k === 'name') this.render();
  };

  P.onInput = function (e) {
    var t = e.target;
    var st = this.state;
    if (!st || !t) return;
    var k = t.getAttribute('data-f');
    var f = st.form;
    if (k === 'name') { f.name = t.value; f.error = null; this.refreshNewLive(); return; }
    if (k === 'format') { f.format = t.value; this.refreshNewLive(); return; }
    if (k === 'count') { f.count = t.value; if (f.by !== 'count') { f.by = 'count'; this.syncRadio('by', 'count'); } this.refreshNewLive(); return; }
    if (k === 'size') { f.size = t.value; if (f.by !== 'size') { f.by = 'size'; this.syncRadio('by', 'size'); } this.refreshNewLive(); return; }
    if (k === 'limit') { f.limit = t.value; return; }
    if (k === 'copyName') {
      st.copy.name = t.value;
      var go = this.root.querySelector('[data-act="run-copy"]');
      var n = Object.keys(st.copy.dests).filter(function (x) { return st.copy.dests[x]; }).length;
      if (go) go.disabled = !(n && String(t.value).trim());
    }
  };

  P.syncRadio = function (name, value) {
    var r = this.root.querySelector('input[type="radio"][name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  };

  /* Drag a student onto another group's card. */
  P.onDragStart = function (e) {
    var li = e.target.closest ? e.target.closest('.cgp-groups__member') : null;
    if (!li || !this.state || !this.state.board || this.state.board.saving) return;
    this._dragUid = li.getAttribute('data-uid');
    try { e.dataTransfer.setData('text/plain', this._dragUid); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
    li.classList.add('is-dragging');
  };

  P.onDragOver = function (e) {
    if (!this._dragUid) return;
    var card = e.target.closest ? e.target.closest('.cgp-groups__card') : null;
    if (!card) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
    card.classList.add('is-target');
  };

  P.onDragLeave = function (e) {
    var card = e.target.closest ? e.target.closest('.cgp-groups__card') : null;
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('is-target');
  };

  P.onDrop = function (e) {
    var uid = this._dragUid;
    this._dragUid = null;
    var card = e.target.closest ? e.target.closest('.cgp-groups__card') : null;
    if (!uid || !card || !this.state || !this.state.board) { this.render(); return; }
    e.preventDefault();
    this.state.board.after[uid] = card.getAttribute('data-gid') || null;
    this.state.board.message = null;
    this.render();
  };

  CGP.GroupBuilder = GroupBuilder;
})();
