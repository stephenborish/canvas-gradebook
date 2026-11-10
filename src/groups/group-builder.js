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
        busy: false, progress: '', error: null,
        // The name box shows only for a format that is not one of the tiles.
        custom: !G().PRESETS.some(function (p) { return p.format === prefs.format; }) && prefs.formats.indexOf(prefs.format) < 0
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
      if (self.root) self.root.classList.remove('is-dragging');
      if (!self._dragUid) return;
      self._dragUid = null;
      self.render();
    });
    this._onKey = function (e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // A picked student is let go first; a second Escape closes.
      if (self.state && self.state.board && self.state.board.picked) { self.state.board.picked = null; self.render(); return; }
      self.requestClose();
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

  var ICONS = {
    shuffle: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h3.2c1.4 0 2.6.7 3.4 1.8l2.8 4.4c.8 1.1 2 1.8 3.4 1.8H17M3 14h3.2c1.4 0 2.6-.7 3.4-1.8M12.4 7.8c.8-1.1 2-1.8 3.4-1.8H17M15 4l2 2-2 2M15 12l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hand: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 10V4.5a1.3 1.3 0 0 1 2.6 0V9m0-.5V3.3a1.3 1.3 0 0 1 2.6 0V9m0-4.2a1.3 1.3 0 0 1 2.6 0V11c0 3.6-2.3 6-5.6 6-2.4 0-3.7-1.2-4.9-3.2L2.9 11a1.3 1.3 0 0 1 2.2-1.4L7 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    signup: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="3" width="13" height="14.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 7.5h6M7 11h6M7 14.5h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };

  /** A message inside the dialog (a toast would sit on top of it). */
  P.notice = function (text, kind) {
    if (!this.state) { CGP.ui.toast(text, kind === 'error' ? { level: 'error' } : undefined); return; }
    this.state.notice = text ? { text: text, kind: kind || 'ok' } : null;
  };

  P.render = function () {
    if (!this.root || !this.state) return;
    var st = this.state;
    var body = this.root.querySelector('.cgp-groups__body');
    // Keep the caret where the teacher was typing across a redraw.
    var active = document.activeElement;
    var focusKey = active && this.root.contains(active) ? active.getAttribute('data-k') : null;
    var sel = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    var scroller = this.root.querySelector('.cgp-stats__panel');
    var scrollTop = scroller ? scroller.scrollTop : 0;
    var boardEl = this.root.querySelector('.cgp-g-board');
    var boardTop = boardEl ? boardEl.scrollTop : 0;

    var html;
    if (st.loading) html = '<div class="cgp-g-empty"><span class="cgp-g-spin" aria-hidden="true"></span>Reading your students and groups from Canvas…</div>';
    else if (st.error) html = '<div class="cgp-g-notice is-error">' + esc(st.error) + '</div><button type="button" class="cgp-g-btn" data-act="retry">Try again</button>';
    else {
      html = this.renderTabs();
      if (st.notice) {
        html += '<div class="cgp-g-notice is-' + st.notice.kind + '" role="status"><span>' + esc(st.notice.text) + '</span>' +
          (st.changed && st.notice.kind === 'ok' ? '<button type="button" class="cgp-g-link" data-act="reload">Reload the page to see it in Canvas</button>' : '') +
          '<button type="button" class="cgp-g-x" data-act="dismiss" aria-label="Dismiss">×</button></div>';
      }
      if (st.view === 'board' && st.board) html += this.renderBoard();
      else if (st.view === 'copy' && st.copy) html += this.renderCopy();
      else if (st.view === 'sets') html += this.renderSets();
      else html += this.renderNew();
    }
    body.innerHTML = html;
    if (scroller) scroller.scrollTop = scrollTop;
    var boardNow = this.root.querySelector('.cgp-g-board');
    if (boardNow) boardNow.scrollTop = boardTop;
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
      return '<button type="button" role="tab" class="cgp-g-tab' + (on ? ' is-on' : '') + '" data-act="view" data-view="' + view + '" aria-selected="' + on + '">' + label + '</button>';
    };
    return '<div class="cgp-g-tabs" role="tablist">' +
      tab('new', 'New group set') + tab('sets', 'Your group sets <span class="cgp-g-pill">' + st.sets.length + '</span>') + '</div>';
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
    return c + ' group' + (c === 1 ? '' : 's') + ' of ' + each + ' · ' + n + ' student' + (n === 1 ? '' : 's');
  };

  /* The preview: the groups as they will be made, with how many students
   * each gets (or may take, for sign-up). */
  P.previewHtml = function () {
    var f = this.state.form;
    var names = this.formNames();
    var n = this.formStudents();
    var c = names.length;
    var limit = Math.floor(Number(f.limit) || 0);
    var shown = names.slice(0, 12);
    var cards = shown.map(function (name, i) {
      var size = Math.floor(n / c) + (i < n % c ? 1 : 0);
      var sub = f.mode === 'signup' ? (limit ? 'up to ' + limit : 'open') : (f.mode === 'random' ? size + ' student' + (size === 1 ? '' : 's') : 'empty');
      return '<li><span class="cgp-g-pv__name">' + esc(name) + '</span><span class="cgp-g-pv__sub">' + esc(sub) + '</span></li>';
    }).join('');
    var more = c - shown.length;
    var foot = f.mode === 'random' ? 'Students are shuffled into these groups when you press Make groups.'
      : (f.mode === 'manual' ? 'The groups open next, ready for you to drag students in.' : 'Students pick a group themselves in Canvas.');
    return '<div class="cgp-g-pv__head"><span>Preview</span><b data-part="sizes">' + esc(this.sizeLine()) + '</b></div>' +
      '<ul class="cgp-g-pv__list">' + cards + (more > 0 ? '<li class="cgp-g-pv__more">+ ' + more + ' more</li>' : '') + '</ul>' +
      '<p class="cgp-g-pv__foot">' + esc(foot) + '</p>';
  };

  P.styleTiles = function () {
    var f = this.state.form;
    var prefs = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
    var set = f.name;
    var sample = function (format) { return G().formatNames(format, 3, { set: set }).join(', ') + '…'; };
    var tile = function (format, title, removable) {
      var on = !f.custom && f.format === format;
      return '<div class="cgp-g-tile' + (on ? ' is-on' : '') + '">' +
        '<button type="button" class="cgp-g-tile__btn" data-act="style" data-format="' + esc(format) + '" aria-pressed="' + on + '">' +
        '<b>' + esc(title) + '</b><span>' + esc(sample(format)) + '</span></button>' +
        (removable ? '<button type="button" class="cgp-g-tile__x" data-act="forget-format" data-format="' + esc(format) + '" aria-label="Remove ' + esc(title) + ' from your styles" title="Remove from your styles">×</button>' : '') +
        '</div>';
    };
    var tiles = G().PRESETS.map(function (p) { return tile(p.format, p.label, false); }).join('') +
      prefs.formats.map(function (s) {
        var title = G().parseFormat(s).kind === 'list' ? 'Your list' : (s.length > 22 ? s.slice(0, 21) + '…' : s);
        return tile(s, title, true);
      }).join('') +
      '<div class="cgp-g-tile cgp-g-tile--custom' + (f.custom ? ' is-on' : '') + '"><button type="button" class="cgp-g-tile__btn" data-act="style-custom" aria-pressed="' + !!f.custom + '">' +
      '<b>Your own…</b><span>Type a pattern or a list</span></button></div>';
    return '<div class="cgp-g-tiles">' + tiles + '</div>';
  };

  P.renderNew = function () {
    var st = this.state;
    var f = st.form;
    var prefs = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
    var dis = f.busy ? ' disabled' : '';
    var count = this.formCount();
    var byCount = f.by !== 'size';
    var value = byCount ? f.count : f.size;

    var taken = G().nameTaken(f.name, st.sets.map(function (s) { return s.name; }));
    var step1 = '<section class="cgp-g-step"><h3><span class="cgp-g-num">1</span>Groups</h3>' +
      '<label class="cgp-g-field"><span class="cgp-g-label">Name of the group set</span>' +
      '<input class="cgp-g-input" data-f="name" data-k="name" maxlength="80" value="' + esc(f.name) + '" placeholder="e.g. Lab Groups"' + dis + '>' +
      '<span class="cgp-g-warn" data-part="taken"' + (taken ? '' : ' hidden') + '>This class already has a group set with this name.</span></label>' +
      (st.sections.length ? '<label class="cgp-g-field"><span class="cgp-g-label">Students</span>' +
        '<select class="cgp-g-input" data-f="section"' + dis + '><option value="">Everyone in this class (' + st.roster.length + ')</option>' +
        st.sections.map(function (s) {
          return '<option value="' + esc(s.id) + '"' + (f.section === s.id ? ' selected' : '') + '>Only ' + esc(s.name) + ' (' + this.studentsIn(s.id).length + ')</option>';
        }, this).join('') + '</select></label>' : '') +
      '<div class="cgp-g-field"><span class="cgp-g-label">Make</span><div class="cgp-g-how">' +
      '<div class="cgp-g-stepper"><button type="button" data-act="step" data-d="-1" aria-label="Fewer"' + dis + '>−</button>' +
      '<input type="number" min="1" max="' + (byCount ? 100 : 50) + '" data-f="' + (byCount ? 'count' : 'size') + '" data-k="' + (byCount ? 'count' : 'size') + '" value="' + esc(value) + '" aria-label="' + (byCount ? 'Number of groups' : 'Students per group') + '"' + dis + '>' +
      '<button type="button" data-act="step" data-d="1" aria-label="More"' + dis + '>+</button></div>' +
      '<div class="cgp-g-seg" role="group" aria-label="Count by">' +
      '<button type="button" data-act="by" data-v="count" aria-pressed="' + byCount + '" class="' + (byCount ? 'is-on' : '') + '"' + dis + '>groups</button>' +
      '<button type="button" data-act="by" data-v="size" aria-pressed="' + !byCount + '" class="' + (!byCount ? 'is-on' : '') + '"' + dis + '>students per group</button>' +
      '</div></div></div></section>';

    var custom = f.custom ? '<div class="cgp-g-custom">' +
      '<input class="cgp-g-input" data-f="format" data-k="format" maxlength="400" value="' + esc(f.format) + '" placeholder="e.g. Lab Team {A}  or  Red, Blue, Green" aria-label="Your own group names"' + dis + '>' +
      '<div class="cgp-g-insert"><span>Insert:</span>' +
      '<button type="button" data-act="token" data-t="{n}"' + dis + '>1, 2, 3</button>' +
      '<button type="button" data-act="token" data-t="{nn}"' + dis + '>01, 02, 03</button>' +
      '<button type="button" data-act="token" data-t="{A}"' + dis + '>A, B, C</button>' +
      '<button type="button" data-act="token" data-t="{set}"' + dis + '>set name</button>' +
      (prefs.formats.indexOf(f.format.trim()) < 0 && f.format.trim() ? '<button type="button" class="cgp-g-insert__save" data-act="save-format"' + dis + '>Save to my styles</button>' : '<span class="cgp-g-saved">Saved in your styles</span>') +
      '</div><p class="cgp-g-help">Or type the names, separated by commas.</p></div>' : '';
    var step2 = '<section class="cgp-g-step"><h3><span class="cgp-g-num">2</span>Group names</h3>' + this.styleTiles() + custom + '</section>';

    var mode = function (value2, icon, title, text) {
      var on = f.mode === value2;
      return '<label class="cgp-g-choice' + (on ? ' is-on' : '') + '"><input type="radio" name="mode" value="' + value2 + '" data-f="mode"' + (on ? ' checked' : '') + dis + '>' +
        '<span class="cgp-g-choice__icon">' + ICONS[icon] + '</span><span class="cgp-g-choice__text"><b>' + title + '</b><span>' + text + '</span></span></label>';
    };
    var signup = f.mode === 'signup' ? '<div class="cgp-g-signup">' +
      '<label class="cgp-g-inline">At most <input type="number" min="1" max="50" class="cgp-g-small" data-f="limit" data-k="limit" value="' + esc(f.limit) + '" placeholder="any"' + dis + '> students per group</label>' +
      (st.sections.length ? '<label class="cgp-g-inline"><input type="checkbox" data-f="restrict"' + (f.restrict ? ' checked' : '') + dis + '> Only with classmates in their own section</label>' : '') +
      '</div>' : '';
    var step3 = '<section class="cgp-g-step"><h3><span class="cgp-g-num">3</span>How students join</h3><div class="cgp-g-choices">' +
      mode('random', 'shuffle', 'Shuffle them in', 'Random and even. You can still move anyone.') +
      mode('manual', 'hand', 'I’ll choose', 'Drag each student into a group.') +
      mode('signup', 'signup', 'Students sign up', 'They pick a group in Canvas.') +
      '</div>' + signup + '</section>';

    var go = f.busy ? (f.progress || 'Working…') : 'Make ' + count + ' group' + (count === 1 ? '' : 's');
    return '<div class="cgp-g-new"><div class="cgp-g-steps">' + step1 + step2 + step3 +
      (f.error ? '<div class="cgp-g-notice is-error">' + esc(f.error) + '</div>' : '') + '</div>' +
      '<aside class="cgp-g-pv" data-part="preview" aria-live="polite">' + this.previewHtml() + '</aside></div>' +
      '<footer class="cgp-g-foot"><span class="cgp-g-foot__hint">Nothing changes in Canvas until you press Make.</span>' +
      '<button type="button" class="cgp-g-btn cgp-g-btn--primary" data-act="create" data-part="go"' + (f.busy || !String(f.name).trim() ? ' disabled' : '') + '>' +
      (f.busy ? '<span class="cgp-g-spin" aria-hidden="true"></span>' : '') + esc(go) + '</button></footer>';
  };

  /* Live parts of the form, updated while typing without a full redraw. */
  P.refreshNewLive = function () {
    if (!this.root || this.state.view !== 'new') return;
    var prev = this.root.querySelector('[data-part="preview"]');
    if (prev) prev.innerHTML = this.previewHtml();
    var tiles = this.root.querySelector('.cgp-g-tiles');
    if (tiles && !this.state.form.custom) {
      var wrap = document.createElement('div');
      wrap.innerHTML = this.styleTiles();
      tiles.parentNode.replaceChild(wrap.firstChild, tiles);
    }
    var f = this.state.form;
    var warn = this.root.querySelector('[data-part="taken"]');
    var taken = G().nameTaken(f.name, this.state.sets.map(function (x) { return x.name; }));
    if (warn) warn.hidden = !taken;
    var go = this.root.querySelector('[data-part="go"]');
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
        self.notice(msg + ' Students can now sign up in Canvas.');
        st.view = 'sets';
        self.render();
        return;
      }
      self.notice(msg + ' Move anyone you like, then save.');
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
      return '<div class="cgp-g-empty"><b>No group sets yet</b><span>Make one in a few seconds.</span>' +
        '<button type="button" class="cgp-g-btn cgp-g-btn--primary" data-act="view" data-view="new">New group set</button></div>';
    }
    var self = this;
    return '<ul class="cgp-g-sets">' + st.sets.map(function (s) {
      var bits = [];
      if (s.groups_count != null) bits.push(s.groups_count + ' group' + (s.groups_count === 1 ? '' : 's'));
      if (s.self_signup) bits.push('students sign up' + (s.group_limit ? ' · ' + s.group_limit + ' max' : ''));
      if (s.unassigned_users_count) bits.push(s.unassigned_users_count + ' not in a group');
      return '<li class="cgp-g-set">' +
        '<div class="cgp-g-set__name"><b>' + esc(s.name) + '</b><span>' + esc(bits.join(' · ') || 'Group set') + '</span></div>' +
        '<div class="cgp-g-set__acts">' +
        '<a class="cgp-g-link" href="' + esc(self.groupsUrl(self.courseId, s.id)) + '">Open in Canvas</a>' +
        '<button type="button" class="cgp-g-btn" data-act="copy" data-id="' + esc(s.id) + '">Copy to…</button>' +
        '<button type="button" class="cgp-g-btn cgp-g-btn--primary" data-act="board" data-id="' + esc(s.id) + '">Arrange students</button>' +
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

  /* A colour per section, so a mixed group is visible at a glance. */
  var SECTION_COLORS = ['#0374b5', '#b5470b', '#0b874b', '#8a3ab9', '#c2185b', '#00838f', '#6d4c41', '#5c6bc0'];
  P.sectionColor = function (id) {
    var list = this.state.sections;
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) return SECTION_COLORS[i % SECTION_COLORS.length];
    return '#98a3ab';
  };

  P.crumbs = function (title) {
    return '<nav class="cgp-g-crumbs"><button type="button" class="cgp-g-link" data-act="view" data-view="sets">Your group sets</button>' +
      '<span aria-hidden="true">›</span><b>' + esc(title) + '</b></nav>';
  };

  P.renderBoard = function () {
    var st = this.state;
    var b = st.board;
    var self = this;
    if (b.loading) return this.crumbs(b.set.name) + '<div class="cgp-g-empty"><span class="cgp-g-spin" aria-hidden="true"></span>Reading the groups…</div>';
    if (b.error && !b.groups.length) return this.crumbs(b.set.name) + '<div class="cgp-g-notice is-error">' + esc(b.error) + '</div>';
    if (!b.groups.length) return this.crumbs(b.set.name) + '<div class="cgp-g-empty">This group set has no groups yet.</div>';

    var pending = G().moves(b.before, b.after);
    var showSections = st.sections.length && !b.section;
    var name = function (uid) {
      var s = st.byId[uid];
      return s ? s.name : (b.extra[uid] || ('User ' + uid));
    };
    var sortKey = function (uid) { var s = st.byId[uid]; return String(s ? s.sortable : b.extra[uid] || ''); };
    var membersOf = function (gid) {
      return Object.keys(b.after).filter(function (uid) { return (b.after[uid] || '') === gid && self.boardVisible(uid); })
        .sort(function (x, y) { return sortKey(x).localeCompare(sortKey(y)); });
    };
    var member = function (uid) {
      var s = st.byId[uid];
      var moved = (b.before[uid] || '') !== (b.after[uid] || '');
      var picked = b.picked === uid;
      var dot = showSections && s && s.sections.length
        ? '<span class="cgp-g-dot" style="background:' + self.sectionColor(s.sections[0]) + '" title="' + esc(self.sectionName(s.sections[0])) + '"></span>' : '';
      return '<li class="cgp-g-member' + (moved ? ' is-moved' : '') + (picked ? ' is-picked' : '') + (b.failed[uid] ? ' is-failed' : '') + '" draggable="' + !b.saving + '" data-uid="' + esc(uid) + '">' +
        '<button type="button" data-act="pick" data-uid="' + esc(uid) + '" aria-pressed="' + picked + '"' + (b.saving ? ' disabled' : '') + '>' + dot +
        '<span class="cgp-g-member__name">' + esc(name(uid)) + '</span>' + (!s ? '<span class="cgp-g-tag">not enrolled</span>' : '') + '</button></li>';
    };
    var moveHere = function (gid) {
      if (!b.picked || (b.after[b.picked] || '') === gid) return '';
      return '<button type="button" class="cgp-g-movehere" data-act="drop" data-gid="' + esc(gid) + '">Move ' + esc(name(b.picked).split(' ')[0]) + ' here</button>';
    };

    var unassigned = membersOf('');
    var tray = '<section class="cgp-g-tray' + (unassigned.length ? '' : ' is-empty') + '" data-gid="">' +
      '<h4>Not in a group <span class="cgp-g-count">' + unassigned.length + '</span>' + moveHere('') + '</h4>' +
      (unassigned.length ? '<ul>' + unassigned.map(member).join('') + '</ul>' : '<p>Everyone is in a group. Drop a student here to take them out.</p>') + '</section>';
    var cards = b.groups.map(function (g) {
      var list = membersOf(g.id);
      var total = Object.keys(b.after).filter(function (uid) { return b.after[uid] === g.id; }).length;
      var over = g.max && total > g.max;
      return '<section class="cgp-g-card' + (over ? ' is-over' : '') + (b.picked ? ' is-pickable' : '') + '" data-gid="' + esc(g.id) + '">' +
        '<h4><span class="cgp-g-card__name">' + esc(g.name) + '</span><span class="cgp-g-count">' + total + (g.max ? ' / ' + g.max : '') + '</span></h4>' +
        (list.length ? '<ul>' + list.map(member).join('') + '</ul>' : '<p class="cgp-g-card__empty">No students yet</p>') + moveHere(g.id) + '</section>';
    }).join('');

    var visible = st.roster.filter(function (s) { return self.boardVisible(s.id); }).length;
    var legend = showSections ? '<div class="cgp-g-legend">' + st.sections.map(function (s) {
      return '<span><span class="cgp-g-dot" style="background:' + self.sectionColor(s.id) + '"></span>' + esc(s.name) + '</span>';
    }).join('') + '</div>' : '';
    var sectionPick = st.sections.length ? '<select class="cgp-g-input cgp-g-input--auto" data-f="boardSection" aria-label="Show students from"' + (b.saving ? ' disabled' : '') + '>' +
      '<option value="">All sections</option>' + st.sections.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (b.section === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('') + '</select>' : '';

    var head = this.crumbs(b.set.name) +
      '<div class="cgp-g-boardbar"><div class="cgp-g-boardbar__left">' + sectionPick +
      '<button type="button" class="cgp-g-btn" data-act="shuffle-all"' + (b.saving ? ' disabled' : '') + '>' + ICONS.shuffle + 'Shuffle everyone</button>' +
      (unassigned.length ? '<button type="button" class="cgp-g-btn" data-act="shuffle-rest"' + (b.saving ? ' disabled' : '') + '>Place the ' + unassigned.length + ' not in a group</button>' : '') +
      '</div><div class="cgp-g-boardbar__right"><span class="cgp-g-meta">' + b.groups.length + ' groups · ' + visible + ' students</span>' +
      '<a class="cgp-g-link" href="' + esc(this.groupsUrl(this.courseId, b.set.id)) + '">Open in Canvas</a></div></div>' +
      '<p class="cgp-g-help cgp-g-help--board">' + (b.picked ? '<b>' + esc(name(b.picked)) + '</b> selected — tap a group to move them, or tap them again to cancel.'
        : 'Tap a student, then tap a group to move them. Or drag them.') + '</p>' + legend;

    var foot = '<footer class="cgp-g-foot">' +
      '<button type="button" class="cgp-g-btn cgp-g-foot__copy" data-act="copy" data-id="' + esc(b.set.id) + '"' + (b.saving ? ' disabled' : '') + '>Copy to another class…</button>' +
      '<span class="cgp-g-foot__hint">' + (pending.length ? pending.length + ' unsaved change' + (pending.length === 1 ? '' : 's') : 'All changes saved') + '</span>' +
      '<button type="button" class="cgp-g-btn" data-act="undo-board"' + (pending.length && !b.saving ? '' : ' disabled') + '>Discard</button>' +
      '<button type="button" class="cgp-g-btn cgp-g-btn--primary" data-act="save-board"' + (pending.length && !b.saving ? '' : ' disabled') + '>' +
      (b.saving ? '<span class="cgp-g-spin" aria-hidden="true"></span>' + esc(b.progress || 'Saving…') : 'Save changes') + '</button></footer>';
    return head + (b.error ? '<div class="cgp-g-notice is-error">' + esc(b.error) + '</div>' : '') +
      '<div class="cgp-g-board">' + tray + '<div class="cgp-g-cards">' + cards + '</div></div>' + foot;
  };

  P.boardShuffle = function (keep) {
    var st = this.state;
    var b = st.board;
    var self = this;
    var pool = st.roster.filter(function (s) { return self.boardVisible(s.id); }).map(function (s) { return s.id; });
    var plan = G().planRandom({ groups: b.groups, current: b.after, pool: pool, keep: keep });
    pool.forEach(function (uid) { b.after[uid] = plan.placement[uid] || null; });
    b.message = null;
    b.picked = null;
    this.notice(plan.unplaced.length ? plan.unplaced.length + ' student' + (plan.unplaced.length === 1 ? '' : 's') + ' didn’t fit: every group is full.'
      : 'Shuffled. Nothing is saved until you press Save changes.', plan.unplaced.length ? 'error' : 'info');
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
        self.notice('Saved ' + r.done.length + ' change' + (r.done.length === 1 ? '' : 's') + ' in Canvas.');
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
    var head = this.crumbs('Copy “' + c.set.name + '”');
    if (c.loading) return head + '<div class="cgp-g-empty"><span class="cgp-g-spin" aria-hidden="true"></span>Reading the groups…</div>';
    if (c.error && !c.results) return head + '<div class="cgp-g-notice is-error">' + esc(c.error) + '</div>';

    if (c.results) {
      return head + '<ul class="cgp-g-results">' + c.results.map(function (r) {
        var mark = r.status === 'ok' ? '✓' : (r.status === 'skip' ? '–' : '!');
        var link = r.url ? '<a class="cgp-g-link" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open</a>' : '';
        return '<li class="cgp-g-result is-' + r.status + '"><span class="cgp-g-result__mark" aria-hidden="true">' + mark + '</span>' +
          '<span><b>' + esc(r.label) + '</b><br>' + esc(r.text) + '</span>' + link + '</li>';
      }).join('') + '</ul>' +
        '<footer class="cgp-g-foot"><span class="cgp-g-foot__hint"></span><button type="button" class="cgp-g-btn cgp-g-btn--primary" data-act="view" data-view="sets">Done</button></footer>';
    }

    var signup = c.set.self_signup;
    var t = this.copyTargets();
    var row = function (d) {
      var on = !!c.dests[d.key];
      return '<label class="cgp-g-dest' + (on ? ' is-on' : '') + '"><input type="checkbox" data-dest="' + esc(d.key) + '"' + (on ? ' checked' : '') + (c.running ? ' disabled' : '') + '>' +
        '<span class="cgp-g-dest__name">' + esc(d.label) + (d.linked ? ' <span class="cgp-g-tag cgp-g-tag--ok">linked</span>' : '') + '</span>' +
        (d.sub ? '<span class="cgp-g-dest__sub">' + esc(d.sub) + '</span>' : '') + '</label>';
    };
    var block = function (title, rows) { return rows.length ? '<div class="cgp-g-destgroup"><h4>' + esc(title) + '</h4>' + rows.map(row).join('') + '</div>' : ''; };
    var list = block('Your linked classes', t.linked) + block('Another section of this class', t.sections) +
      block((t.linked.length ? 'Other courses you teach' : 'Courses you teach') + (t.term && !c.showAll ? ' · ' + t.term : ''), t.others) +
      (!t.others.length ? '<p class="cgp-g-help">No other courses' + (t.term && !c.showAll ? ' this term' : '') + '.</p>' : '') +
      (t.term ? '<button type="button" class="cgp-g-link" data-act="copy-all-terms">' + (c.showAll ? 'Only this term' : 'Show courses from every term') + '</button>' : '');
    var n = Object.keys(c.dests).filter(function (k) { return c.dests[k]; }).length;
    var chips = c.groups.slice(0, 8).map(function (g) { return '<span class="cgp-g-chip">' + esc(g.name) + '</span>'; }).join('') +
      (c.groups.length > 8 ? '<span class="cgp-g-help">+ ' + (c.groups.length - 8) + ' more</span>' : '');
    return head +
      '<div class="cgp-g-copy"><div class="cgp-g-copy__main"><section class="cgp-g-step"><h3><span class="cgp-g-num">1</span>Where to</h3>' + list + '</section></div>' +
      '<div class="cgp-g-copy__side"><section class="cgp-g-step"><h3><span class="cgp-g-num">2</span>What they get</h3>' +
      '<div class="cgp-g-chips">' + chips + '</div>' +
      '<label class="cgp-g-field"><span class="cgp-g-label">Group set name</span>' +
      '<input class="cgp-g-input" data-f="copyName" data-k="copyName" maxlength="80" value="' + esc(c.name) + '"' + (c.running ? ' disabled' : '') + '>' +
      (t.sections.length ? '<span class="cgp-g-help">A section of this class gets its section name added.</span>' : '') + '</label>' +
      (signup ? '<p class="cgp-g-help">Students sign up for these groups, so the copies are sign-up groups too.</p>'
        : '<label class="cgp-g-inline cgp-g-inline--box"><input type="checkbox" data-f="copyRandom"' + (c.random ? ' checked' : '') + (c.running ? ' disabled' : '') +
          '><span><b>Shuffle each class’s students in</b><br><span class="cgp-g-help">Off: the groups start empty.</span></span></label>') +
      '</section></div></div>' +
      (c.error ? '<div class="cgp-g-notice is-error">' + esc(c.error) + '</div>' : '') +
      '<footer class="cgp-g-foot"><span class="cgp-g-foot__hint">Only the groups are copied — never students from this class.</span>' +
      '<button type="button" class="cgp-g-btn cgp-g-btn--primary" data-act="run-copy"' + (n && !c.running && String(c.name).trim() ? '' : ' disabled') + '>' +
      (c.running ? '<span class="cgp-g-spin" aria-hidden="true"></span>' + esc(c.progress || 'Copying…') : (n ? 'Copy to ' + n + (n === 1 ? ' place' : ' places') : 'Choose where to copy')) + '</button></footer>';
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

  P.leaveBoardOk = function () {
    var st = this.state;
    return !(st.view === 'board' && st.board && G().moves(st.board.before, st.board.after).length &&
      typeof confirm === 'function' && !confirm('Leave without saving your changes to the groups?'));
  };

  P.onClick = function (e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || !this.root || !this.root.contains(t) || !this.state) return;
    var st = this.state;
    var f = st.form;
    var self = this;
    var act = t.getAttribute('data-act');
    if (act === 'retry') { this.load(); this.render(); return; }
    if (act === 'reload') { location.reload(); return; }
    if (act === 'dismiss') { st.notice = null; this.render(); return; }
    if (act === 'view') {
      if (!this.leaveBoardOk()) return;
      st.view = t.getAttribute('data-view');
      st.notice = st.notice && st.notice.kind === 'ok' && st.view === 'sets' ? st.notice : null;
      if (st.view !== 'board') st.board = st.board && st.board.saving ? st.board : null;
      this.render();
      return;
    }
    if (act === 'create') { this.create(); return; }
    if (act === 'by') {
      f.by = t.getAttribute('data-v');
      this.render();
      return;
    }
    if (act === 'step') {
      var k = f.by === 'size' ? 'size' : 'count';
      var max = k === 'size' ? 50 : 100;
      f[k] = Math.max(1, Math.min(max, (Math.floor(Number(f[k])) || 1) + Number(t.getAttribute('data-d'))));
      var input = this.root.querySelector('[data-k="' + k + '"]');
      if (input) input.value = f[k];
      this.refreshNewLive();
      return;
    }
    if (act === 'style') { f.format = t.getAttribute('data-format'); f.custom = false; this.render(); return; }
    if (act === 'style-custom') {
      if (!f.custom) {
        f.custom = true;
        var known = G().PRESETS.some(function (p) { return p.format === f.format; });
        if (known) f.format = 'Team {n}';
      }
      this.render();
      var box = this.root.querySelector('[data-k="format"]');
      if (box) { box.focus(); try { box.setSelectionRange(box.value.length, box.value.length); } catch (err) { /* ignore */ } }
      return;
    }
    if (act === 'token') {
      var fmt = this.root.querySelector('[data-k="format"]');
      if (!fmt) return;
      var tok = t.getAttribute('data-t');
      var a = typeof fmt.selectionStart === 'number' ? fmt.selectionStart : fmt.value.length;
      var z = typeof fmt.selectionEnd === 'number' ? fmt.selectionEnd : a;
      fmt.value = fmt.value.slice(0, a) + tok + fmt.value.slice(z);
      f.format = fmt.value;
      fmt.focus();
      try { fmt.setSelectionRange(a + tok.length, a + tok.length); } catch (err) { /* ignore */ }
      this.refreshNewLive();
      return;
    }
    if (act === 'save-format') {
      var prefs = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
      var mine = f.format.trim();
      var list = [mine].concat(prefs.formats.filter(function (x) { return x !== mine; }));
      var max2 = CGP.SETTINGS_LIMITS.MAX_GROUP_FORMATS;
      this.savePrefs({ formats: list.slice(0, max2), format: mine }).then(function () {
        if (self.state !== st) return;
        f.format = mine;
        f.custom = false;
        self.notice('Saved to your styles' + (list.length > max2 ? ' (your oldest style made room for it).' : '. It’s there next time too.'));
        self.render();
      });
      return;
    }
    if (act === 'forget-format') {
      var gone = t.getAttribute('data-format');
      var p2 = CGP.cleanGroupPrefs(this.settings.values.groupPrefs);
      this.savePrefs({ formats: p2.formats.filter(function (x) { return x !== gone; }) }).then(function () {
        if (self.state !== st) return;
        if (f.format === gone && !f.custom) f.format = G().PRESETS[0].format;
        self.render();
      });
      return;
    }
    if (act === 'board') { var s = this.findSet(t.getAttribute('data-id')); if (s) { st.notice = null; this.openBoard(s); } return; }
    if (act === 'copy') {
      var s2 = this.findSet(t.getAttribute('data-id')) || (st.board && st.board.set);
      if (!s2 || !this.leaveBoardOk()) return;
      st.notice = null;
      this.openCopy(s2);
      return;
    }
    var b = st.board;
    if (act === 'pick' && b) { var uid = t.getAttribute('data-uid'); b.picked = b.picked === uid ? null : uid; this.render(); return; }
    if (act === 'drop' && b && b.picked) { this.moveTo(b.picked, t.getAttribute('data-gid')); return; }
    if (act === 'shuffle-all') { this.boardShuffle(false); return; }
    if (act === 'shuffle-rest') { this.boardShuffle(true); return; }
    if (act === 'undo-board') { b.after = Object.assign({}, b.before); b.failed = {}; b.picked = null; this.render(); return; }
    if (act === 'save-board') { this.saveBoard(); return; }
    if (act === 'copy-all-terms') { st.copy.showAll = !st.copy.showAll; this.render(); return; }
    if (act === 'run-copy') { this.runCopy(); return; }
  };

  P.moveTo = function (uid, gid) {
    var b = this.state.board;
    b.after[uid] = gid || null;
    b.picked = null;
    b.message = null;
    this.render();
  };

  P.onChange = function (e) {
    var t = e.target;
    var st = this.state;
    if (!st || !t) return;
    if (t.hasAttribute('data-dest')) {
      st.copy.dests[t.getAttribute('data-dest')] = t.checked;
      this.render();
      return;
    }
    var k = t.getAttribute('data-f');
    if (!k) return;
    var f = st.form;
    if (k === 'mode') { f.mode = t.value; f.error = null; this.render(); return; }
    if (k === 'restrict') { f.restrict = t.checked; return; }
    if (k === 'section') { f.section = t.value; this.render(); return; }
    if (k === 'boardSection') { st.board.section = t.value; st.board.picked = null; this.render(); return; }
    if (k === 'copyRandom') { st.copy.random = t.checked; return; }
    // Typed boxes update their live parts as they go (refreshNewLive), never
    // with a full redraw here: one on leaving the box would swallow the click
    // that moved focus away (a tile, Make groups).
  };

  P.onInput = function (e) {
    var t = e.target;
    var st = this.state;
    if (!st || !t) return;
    var k = t.getAttribute('data-f');
    var f = st.form;
    if (k === 'name') { f.name = t.value; f.error = null; this.refreshNewLive(); return; }
    if (k === 'format') { f.format = t.value; this.refreshNewLive(); return; }
    if (k === 'count' || k === 'size') { f[k] = t.value; this.refreshNewLive(); return; }
    if (k === 'limit') { f.limit = t.value; this.refreshNewLive(); return; }
    if (k === 'copyName') {
      st.copy.name = t.value;
      var go = this.root.querySelector('[data-act="run-copy"]');
      var n = Object.keys(st.copy.dests).filter(function (x) { return st.copy.dests[x]; }).length;
      if (go) go.disabled = !(n && String(t.value).trim());
    }
  };

  /* Drag a student onto another group (or the "Not in a group" tray). */
  var DROP = '.cgp-g-card, .cgp-g-tray';

  P.onDragStart = function (e) {
    var li = e.target.closest ? e.target.closest('.cgp-g-member') : null;
    if (!li || !this.state || !this.state.board || this.state.board.saving) return;
    this._dragUid = li.getAttribute('data-uid');
    try { e.dataTransfer.setData('text/plain', this._dragUid); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
    li.classList.add('is-dragging');
    this.root.classList.add('is-dragging');
  };

  P.onDragOver = function (e) {
    if (!this._dragUid) return;
    var card = e.target.closest ? e.target.closest(DROP) : null;
    if (!card) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
    card.classList.add('is-target');
  };

  P.onDragLeave = function (e) {
    var card = e.target.closest ? e.target.closest(DROP) : null;
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('is-target');
  };

  P.onDrop = function (e) {
    var uid = this._dragUid;
    this._dragUid = null;
    this.root.classList.remove('is-dragging');
    var card = e.target.closest ? e.target.closest(DROP) : null;
    if (!uid || !card || !this.state || !this.state.board) { this.render(); return; }
    e.preventDefault();
    this.moveTo(uid, card.getAttribute('data-gid'));
  };

  CGP.GroupBuilder = GroupBuilder;
})();
