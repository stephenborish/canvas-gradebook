/* Canvas Gradebook+ - find a student across every course you teach.
 *
 * The problem this solves: a teacher knows a student's name but not which of
 * their six gradebooks that student is in, so finding one grade to fix means
 * opening courses one at a time until the name turns up. Here they type the
 * name once, in the breadcrumb next to the course switcher, and pick the
 * student-in-a-course they want; Canvas loads that gradebook and the row is
 * scrolled to and briefly highlighted on arrival.
 *
 * How the data is gathered, and what is deliberately NOT done with it:
 *
 *  - The course list comes from CGP.teachingCourseList, shared with the course
 *    switcher, so the two never duplicate the request.
 *  - Rosters are fetched per course, lazily, the first time the search is
 *    opened - never on page load, because a teacher who never uses the search
 *    should never pay for it - with a small concurrency limit so opening the
 *    search does not fire thirty parallel requests at Canvas.
 *  - Rosters are held IN MEMORY ONLY, for the life of the page. They are a
 *    list of real students' names; the only things this extension ever writes
 *    to disk are settings, SpeedGrader drafts and the diagnostics snapshot,
 *    and a roster is none of those. Reopening the search in a new tab fetches
 *    again rather than reading names back off the device.
 *  - Matching happens locally once the rosters are in, so typing is instant
 *    and no keystroke is ever sent anywhere. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.StudentSearch) return;

  var CONCURRENCY = 5;
  var MAX_RESULTS = 40;
  /** Marker left on the destination URL so the arriving page knows who to
   * scroll to. Read and stripped by content.js. */
  var HASH_PREFIX = '#cgp-student=';

  function StudentSearch(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.menu = null;
    this.toggle = null;
    this.index = null;        // [{userId, name, sortName, courseId, courseName, term}]
    this.loading = false;
    this.progress = null;     // {done, total}
    this.query = '';
    this.activeIndex = 0;
    this.error = null;
  }

  var P = StudentSearch.prototype;

  P.start = function () {
    if (!this.settings.values.studentSearch) return;
    var anchor = this.findAnchor();
    if (!anchor) { CGP.diag.warn('studentSearch.noBreadcrumb'); return; }
    if (document.querySelector('.cgp-find-student')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cgp-crumb-toggle cgp-find-student';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Find a student in any course you teach';
    btn.innerHTML =
      '<svg class="cgp-find-student__glyph" viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<path d="M10.4 10.4 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
      '<span class="cgp-crumb-toggle__label">Find student</span>';
    anchor.insertAdjacentElement('afterend', btn);
    this.toggle = btn;

    var self = this;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.isOpen() ? self.close() : self.open();
    });
    document.addEventListener('mousedown', function (e) {
      if (!self.isOpen()) return;
      if (self.menu.contains(e.target) || btn.contains(e.target)) return;
      self.close();
    }, true);
    CGP.diag.log('studentSearch.ready');
  };

  /* Sit to the right of the course switcher when there is one, so the
   * breadcrumb reads course -> switch course -> find student; otherwise
   * straight after the course crumb itself. */
  P.findAnchor = function () {
    var existing = document.querySelector('#breadcrumbs .cgp-crumb-toggle, .ic-app-crumbs .cgp-crumb-toggle');
    if (existing) return existing;
    var links = document.querySelectorAll('#breadcrumbs a[href*="/courses/"], .ic-app-crumbs a[href*="/courses/"]');
    for (var i = 0; i < links.length; i++) {
      if (/\/courses\/\d+\/?$/.test(links[i].getAttribute('href') || '')) {
        // Course switcher is off, so nothing has tagged this crumb yet - do
        // it here instead. See course-switcher.js for why: without it, this
        // button can wrap onto its own line, out of alignment with the
        // course name it sits beside.
        var li = links[i].closest('li') || links[i].parentElement;
        if (li) li.classList.add('cgp-crumb-item');
        return links[i];
      }
    }
    return links.length ? links[links.length - 1] : null;
  };

  P.isOpen = function () { return !!(this.menu && this.menu.classList.contains('cgp-course-menu--on')); };

  P.open = function () {
    var self = this;
    this.ensureMenu();
    this.menu.classList.add('cgp-course-menu--on');
    if (this.toggle) this.toggle.setAttribute('aria-expanded', 'true');
    this.position();
    this.loadIndex();
    var input = this.menu.querySelector('.cgp-course-menu__filter');
    if (input) { input.value = ''; this.query = ''; this.activeIndex = 0; setTimeout(function () { input.focus(); }, 0); }
    this.paintList();
  };

  P.close = function () {
    if (this.menu) this.menu.classList.remove('cgp-course-menu--on');
    if (this.toggle) this.toggle.setAttribute('aria-expanded', 'false');
  };

  P.ensureMenu = function () {
    if (this.menu && this.menu.isConnected) return this.menu;
    var el = document.createElement('div');
    el.className = 'cgp-course-menu cgp-student-menu';
    el.innerHTML =
      '<input class="cgp-course-menu__filter" type="text" placeholder="Type a student\u2019s name\u2026" ' +
      'aria-label="Find a student in any course you teach" autocomplete="off" spellcheck="false">' +
      '<div class="cgp-course-menu__list" role="listbox" tabindex="-1"></div>';
    document.body.appendChild(el);
    this.menu = el;

    var self = this;
    var input = el.querySelector('.cgp-course-menu__filter');
    input.addEventListener('input', function () {
      self.query = input.value;
      self.activeIndex = 0;
      self.paintList();
    });
    input.addEventListener('keydown', function (e) {
      var items = self.matches();
      if (e.key === 'ArrowDown') { e.preventDefault(); self.activeIndex = Math.min(items.length - 1, self.activeIndex + 1); self.paintList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self.activeIndex = Math.max(0, self.activeIndex - 1); self.paintList(); }
      else if (e.key === 'Enter') { e.preventDefault(); var pick = items[self.activeIndex]; if (pick) self.go(pick); }
      else if (e.key === 'Escape') { e.preventDefault(); self.close(); }
      e.stopPropagation();
    }, false);
    el.querySelector('.cgp-course-menu__list').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('[data-hit]') : null;
      if (!row) return;
      var hit = self.matches()[Number(row.getAttribute('data-hit'))];
      if (hit) self.go(hit);
    });
    return el;
  };

  P.position = function () {
    if (!this.toggle || !this.menu) return;
    var rect = this.toggle.getBoundingClientRect();
    var width = 380;
    this.menu.style.width = width + 'px';
    this.menu.style.left = Math.round(Math.min(Math.max(8, rect.left - 12), window.innerWidth - width - 12)) + 'px';
    this.menu.style.top = Math.round(rect.bottom + 6) + 'px';
  };

  /* ------------------------------------------------------------- the index */

  P.loadIndex = function () {
    var self = this;
    if (this.index || this.loading) return Promise.resolve(this.index);
    this.loading = true;
    this.error = null;

    return CGP.teachingCourseList(this.api).then(function (courses) {
      var list = (courses || []).slice();
      self.progress = { done: 0, total: list.length };
      self.paintList();
      if (!list.length) { self.index = []; self.loading = false; self.paintList(); return self.index; }

      var rows = [];
      var next = 0;

      function worker() {
        if (next >= list.length) return Promise.resolve();
        var course = list[next++];
        return self.api.courseStudents(course.id).then(function (users) {
          (users || []).forEach(function (u) {
            if (!u || u.id === undefined) return;
            var name = u.name || u.short_name || '';
            if (!name) return;
            rows.push({
              userId: String(u.id),
              name: name,
              sortName: u.sortable_name || '',
              courseId: String(course.id),
              courseName: course.name || course.course_code || ('Course ' + course.id),
              term: (course.term && course.term.name) || ''
            });
          });
        }, function (err) {
          // One course a teacher cannot list students for (concluded, a
          // permission quirk) must not sink the whole search.
          CGP.diag.warn('studentSearch.rosterFailed', { status: err && err.status });
        }).then(function () {
          self.progress.done++;
          self.paintList();
          return worker();
        });
      }

      var workers = [];
      for (var i = 0; i < Math.min(CONCURRENCY, list.length); i++) workers.push(worker());
      return Promise.all(workers).then(function () {
        self.index = rows;
        self.loading = false;
        self.progress = null;
        CGP.diag.set('studentSearchIndex', rows.length);
        self.paintList();
        return rows;
      });
    }, function (err) {
      self.loading = false;
      self.error = 'Could not read your course list from Canvas.';
      CGP.diag.error('studentSearch.coursesFailed', { status: err && err.status });
      self.paintList();
      return null;
    });
  };

  /* ------------------------------------------------------------- searching */

  /** Every word typed must appear somewhere in the name, in any order, so
   * "tommy newnam", "newnam tommy" and "new tom" all find the same student. */
  P.matches = function () {
    var q = String(this.query || '').trim().toLowerCase();
    if (!q || !this.index) return [];
    var words = q.split(/\s+/).filter(Boolean);
    var self = this;
    var hits = this.index.filter(function (row) {
      var hay = (row.name + ' ' + row.sortName).toLowerCase();
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
    // A name that starts with what was typed is almost always the one meant,
    // and the course you are already in sorts first among a student's courses.
    hits.sort(function (a, b) {
      var ap = a.name.toLowerCase().indexOf(words[0]) === 0 ? 0 : 1;
      var bp = b.name.toLowerCase().indexOf(words[0]) === 0 ? 0 : 1;
      if (ap !== bp) return ap - bp;
      var an = a.name.localeCompare(b.name);
      if (an !== 0) return an;
      var ac = a.courseId === self.courseId ? 0 : 1;
      var bc = b.courseId === self.courseId ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.courseName.localeCompare(b.courseName);
    });
    return hits.slice(0, MAX_RESULTS);
  };

  P.paintList = function () {
    if (!this.menu) return;
    var box = this.menu.querySelector('.cgp-course-menu__list');
    if (!box) return;
    var esc = CGP.util.escapeHtml;

    if (this.error) { box.innerHTML = '<div class="cgp-course-menu__empty">' + esc(this.error) + '</div>'; return; }
    if (this.loading) {
      var p = this.progress;
      var label = p && p.total
        ? 'Reading your rosters\u2026 ' + p.done + ' of ' + p.total + ' courses'
        : 'Reading your courses\u2026';
      box.innerHTML = '<div class="cgp-course-menu__empty">' + esc(label) + '</div>';
      return;
    }
    if (!this.index) { box.innerHTML = '<div class="cgp-course-menu__empty">Reading your courses\u2026</div>'; return; }
    if (!String(this.query || '').trim()) {
      box.innerHTML = '<div class="cgp-course-menu__empty">' +
        esc('Type a name to search ' + this.index.length + ' students across your courses.') + '</div>';
      return;
    }
    var items = this.matches();
    if (!items.length) { box.innerHTML = '<div class="cgp-course-menu__empty">No student matches that.</div>'; return; }

    var self = this;
    box.innerHTML = items.map(function (row, i) {
      var here = row.courseId === self.courseId;
      return '<div class="cgp-course-menu__item cgp-student-hit' + (i === self.activeIndex ? ' is-active' : '') +
        '" role="option" aria-selected="' + (i === self.activeIndex) + '" data-hit="' + i + '">' +
        '<span class="cgp-course-menu__name">' + esc(row.name) + '</span>' +
        '<span class="cgp-course-menu__term">' + esc(row.courseName) +
        (row.term ? ' \u00b7 ' + esc(row.term) : '') +
        (here ? ' \u00b7 this gradebook' : '') + '</span>' +
        '</div>';
    }).join('');
    var active = box.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  };

  P.go = function (hit) {
    this.close();
    var target = '/courses/' + encodeURIComponent(hit.courseId) + '/gradebook' + HASH_PREFIX + encodeURIComponent(hit.userId);
    CGP.diag.bump('studentSearch.jumps');
    if (hit.courseId === this.courseId) {
      // Already here: no reason to reload the whole gradebook just to scroll.
      if (CGP.revealStudent) CGP.revealStudent(hit.userId);
      else window.location.href = target;
      return;
    }
    window.location.href = target;
  };

  StudentSearch.HASH_PREFIX = HASH_PREFIX;
  CGP.StudentSearch = StudentSearch;
})();
