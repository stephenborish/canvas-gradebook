/* Canvas Gradebook+ - jump to another course's gradebook.
 *
 * Rather than adding a bar or a toolbar, the course name already sitting in the
 * Canvas breadcrumb becomes a dropdown: click it, type a few letters, hit
 * Enter, and Canvas loads that course's gradebook. The only pixels added are a
 * caret next to the crumb; the menu itself is ephemeral.
 * Courses come from the instructor's own Canvas session and are cached locally
 * for 30 minutes. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CourseSwitcher) return;

  var CACHE_KEY = 'cgp.courses';
  var CACHE_MS = 30 * 60 * 1000;

  function CourseSwitcher(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.menu = null;
    this.toggle = null;
    this.courses = null;
    this.filter = '';
    this.activeIndex = 0;
  }

  var P = CourseSwitcher.prototype;

  P.start = function () {
    if (!this.settings.values.courseSwitcher) return;
    var crumbLink = this.findCrumbLink();
    if (!crumbLink) { CGP.diag.warn('switcher.noBreadcrumb'); return; }
    if (crumbLink.parentElement.querySelector('.cgp-crumb-toggle')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cgp-crumb-toggle';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Switch course gradebook');
    btn.title = 'Switch course gradebook';
    // A bare caret next to the breadcrumb was easy to miss entirely. A small
    // labeled, pill-shaped button reads as "a control" at a glance instead of
    // looking like part of the page furniture.
    btn.innerHTML = '<span class="cgp-crumb-toggle__label">Switch course</span>' +
      '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M0.6 0.9 5 5.2 9.4 0.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    crumbLink.insertAdjacentElement('afterend', btn);
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
    CGP.diag.log('switcher.ready');
  };

  P.findCrumbLink = function () {
    var links = document.querySelectorAll('#breadcrumbs a[href*="/courses/"], .ic-app-crumbs a[href*="/courses/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (/\/courses\/\d+\/?$/.test(href)) return links[i];
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
    this.loadCourses().then(function (courses) {
      self.courses = courses;
      self.paintList();
    });
    var input = this.menu.querySelector('.cgp-course-menu__filter');
    if (input) { input.value = ''; this.filter = ''; setTimeout(function () { input.focus(); }, 0); }
  };

  P.close = function () {
    if (this.menu) this.menu.classList.remove('cgp-course-menu--on');
    if (this.toggle) this.toggle.setAttribute('aria-expanded', 'false');
  };

  P.ensureMenu = function () {
    if (this.menu && this.menu.isConnected) return this.menu;
    var el = document.createElement('div');
    el.className = 'cgp-course-menu';
    el.innerHTML =
      '<input class="cgp-course-menu__filter" type="text" placeholder="Find a course\u2026" aria-label="Find a course" autocomplete="off">' +
      '<div class="cgp-course-menu__list" role="listbox" tabindex="-1"></div>';
    document.body.appendChild(el);
    this.menu = el;

    var self = this;
    var input = el.querySelector('.cgp-course-menu__filter');
    input.addEventListener('input', function () {
      self.filter = input.value;
      self.activeIndex = 0;
      self.paintList();
    });
    input.addEventListener('keydown', function (e) {
      var items = self.visibleCourses();
      if (e.key === 'ArrowDown') { e.preventDefault(); self.activeIndex = Math.min(items.length - 1, self.activeIndex + 1); self.paintList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self.activeIndex = Math.max(0, self.activeIndex - 1); self.paintList(); }
      else if (e.key === 'Enter') { e.preventDefault(); var pick = items[self.activeIndex]; if (pick) self.go(pick); }
      else if (e.key === 'Escape') { e.preventDefault(); self.close(); }
      e.stopPropagation();
    }, false);
    el.querySelector('.cgp-course-menu__list').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('[data-course-id]') : null;
      if (!row) return;
      var id = row.getAttribute('data-course-id');
      var pick = (self.courses || []).filter(function (c) { return String(c.id) === id; })[0];
      if (pick) self.go(pick);
    });
    return el;
  };

  P.position = function () {
    if (!this.toggle || !this.menu) return;
    var rect = this.toggle.getBoundingClientRect();
    var width = 320;
    this.menu.style.width = width + 'px';
    this.menu.style.left = Math.round(Math.min(Math.max(8, rect.left - 12), window.innerWidth - width - 12)) + 'px';
    this.menu.style.top = Math.round(rect.bottom + 6) + 'px';
  };

  P.visibleCourses = function () {
    var q = String(this.filter || '').trim().toLowerCase();
    var list = this.courses || [];
    if (!q) return list;
    return list.filter(function (c) {
      var hay = ((c.name || '') + ' ' + (c.course_code || '') + ' ' + ((c.term && c.term.name) || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  };

  P.paintList = function () {
    var box = this.menu.querySelector('.cgp-course-menu__list');
    if (!this.courses) { box.innerHTML = '<div class="cgp-course-menu__empty">Loading courses\u2026</div>'; return; }
    var items = this.visibleCourses();
    if (!items.length) { box.innerHTML = '<div class="cgp-course-menu__empty">No matching courses.</div>'; return; }
    var self = this;
    box.innerHTML = items.map(function (c, i) {
      var current = String(c.id) === self.courseId;
      var term = (c.term && c.term.name) ? c.term.name : '';
      return '<div class="cgp-course-menu__item' + (i === self.activeIndex ? ' is-active' : '') +
        (current ? ' is-current' : '') + '" role="option" aria-selected="' + (i === self.activeIndex) +
        '" data-course-id="' + CGP.util.escapeHtml(String(c.id)) + '">' +
        '<span class="cgp-course-menu__name">' + CGP.util.escapeHtml(c.name || c.course_code || ('Course ' + c.id)) + '</span>' +
        (term ? '<span class="cgp-course-menu__term">' + CGP.util.escapeHtml(term) + '</span>' : '') +
        '</div>';
    }).join('');
    var active = box.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  };

  P.go = function (course) {
    this.close();
    window.location.href = '/courses/' + encodeURIComponent(String(course.id)) + '/gradebook';
  };

  P.loadCourses = function () {
    var self = this;
    if (this.courses) return Promise.resolve(this.courses);
    var fromCache = function () {
      if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve(null);
      return chrome.storage.local.get(CACHE_KEY).then(function (got) {
        var box = got && got[CACHE_KEY];
        if (!box || box.origin !== location.origin) return null;
        if (Date.now() - box.at > CACHE_MS) return null;
        return box.courses || null;
      }).catch(function () { return null; });
    };
    return fromCache().then(function (cached) {
      if (cached && cached.length) return cached;
      return self.api.teachingCourses().then(function (courses) {
        var slim = (courses || []).map(function (c) {
          return {
            id: String(c.id), name: c.name || '', course_code: c.course_code || '',
            term: c.term ? { name: c.term.name || '' } : null
          };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        if (typeof chrome !== 'undefined' && chrome.storage) {
          var payload = {};
          payload[CACHE_KEY] = { at: Date.now(), origin: location.origin, courses: slim };
          try { chrome.storage.local.set(payload); } catch (e) { /* ignore */ }
        }
        CGP.diag.set('switcherCourses', slim.length);
        return slim;
      }, function (err) {
        CGP.diag.error('switcher.loadFailed', { status: err && err.status });
        return [];
      });
    });
  };

  CGP.CourseSwitcher = CourseSwitcher;
})();
