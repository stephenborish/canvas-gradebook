/* Canvas Gradebook+ - course navigation menu controller.
 *
 * In Canvas Gradebook, clicking the hamburger icon (course navigation toggle)
 * often opens an empty/blank panel because Canvas does not server-render the
 * course tabs on the gradebook route. This controller fetches the course's
 * configured navigation tabs via Canvas's REST API (/api/v1/courses/:id/tabs),
 * caches them in sessionStorage, and renders the native Canvas-style navigation
 * inside #left-side so teachers can always navigate seamlessly between Home,
 * Announcements, Assignments, Modules, Settings, etc. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CourseMenuController) return;

  var CACHE_PREFIX = 'cgp.courseTabs.';

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function CourseMenuController(ctx) {
    ctx = ctx || {};
    this.api = ctx.api;
    this.courseId = String(ctx.courseId || '');
    this.settings = ctx.settings;
    this.isOpen = false;
    this._tabs = null;
    this._fetching = false;
    this._bound = false;
    this.drawerEl = null;
    this.backdropEl = null;
  }

  var P = CourseMenuController.prototype;

  P.start = function () {
    if (!this.courseId) return;
    this.ensureContainer();
    this.loadCachedTabs();
    this.bindEvents();
    // Warm tabs cache in background so the drawer opens with zero latency
    if (!this._tabs) {
      this.fetchTabs();
    }
  };

  P.ensureContainer = function () {
    var leftSide = (document.getElementById ? document.getElementById('left-side') : null) ||
                   (document.querySelector ? document.querySelector('#left-side') : null);
    if (!leftSide) {
      leftSide = document.createElement('div');
      leftSide.id = 'left-side';
      leftSide.className = 'ic-app-course-menu';
      var wrapper = (document.getElementById ? document.getElementById('wrapper') : null) ||
                    (document.querySelector ? document.querySelector('#wrapper') : null) ||
                    (document.getElementById ? document.getElementById('application') : null) ||
                    (document.querySelector ? document.querySelector('#application') : null) ||
                    document.body;
      if (wrapper && wrapper.firstChild && wrapper.insertBefore) {
        wrapper.insertBefore(leftSide, wrapper.firstChild);
      } else if (wrapper && wrapper.appendChild) {
        wrapper.appendChild(leftSide);
      }
    }
    this.drawerEl = leftSide;
    return leftSide;
  };

  P.loadCachedTabs = function () {
    try {
      if (typeof sessionStorage === 'undefined') return;
      var raw = sessionStorage.getItem(CACHE_PREFIX + this.courseId);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._tabs = parsed;
          this.renderTabs(parsed);
        }
      }
    } catch (e) { /* ignore cache read errors */ }
  };

  P.fetchTabs = function () {
    var self = this;
    if (this._fetching || !this.api) return Promise.resolve(this._tabs || []);
    this._fetching = true;
    return this.api.get('/api/v1/courses/' + this.courseId + '/tabs').then(function (tabs) {
      self._fetching = false;
      if (Array.isArray(tabs) && tabs.length > 0) {
        self._tabs = tabs;
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(CACHE_PREFIX + self.courseId, JSON.stringify(tabs));
          }
        } catch (e) { /* ignore storage quota/security errors */ }
        self.renderTabs(tabs);
        return tabs;
      }
      return [];
    }).catch(function (err) {
      self._fetching = false;
      CGP.diag.warn('courseMenu.fetchFailed', { courseId: self.courseId, error: String(err && err.message) });
      return self._tabs || [];
    });
  };

  P.isTabsPopulated = function () {
    if (!this.drawerEl) return false;
    var links = this.drawerEl.querySelectorAll('a[href]');
    return links.length >= 2;
  };

  P.renderTabs = function (tabs) {
    var drawer = this.ensureContainer();
    if (!drawer) return;

    // Filter tabs visible to teachers (Canvas tabs have visibility: 'public', 'members', 'admins', or 'none')
    var list = (tabs || []).filter(function (t) {
      return t && t.visibility !== 'none' && t.label;
    });

    if (!list.length) return;

    // Clear existing children
    drawer.textContent = '';

    var header = document.createElement('div');
    header.className = 'cgp-course-menu-header';

    var headingWrap = document.createElement('div');
    headingWrap.className = 'cgp-course-menu-heading';

    var title = document.createElement('span');
    title.className = 'cgp-course-menu-title';
    title.textContent = 'Course Navigation';
    headingWrap.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cgp-course-menu-close';
    closeBtn.setAttribute('aria-label', 'Close course navigation');
    closeBtn.title = 'Close (Esc)';
    closeBtn.textContent = '×';

    header.appendChild(headingWrap);
    header.appendChild(closeBtn);
    drawer.appendChild(header);

    var nav = document.createElement('nav');
    nav.id = 'course-nav';
    nav.className = 'cgp-course-nav';
    nav.setAttribute('aria-label', 'Course Navigation');

    var ul = document.createElement('ul');
    ul.id = 'section-tabs';
    ul.className = 'cgp-section-tabs';

    var currentPath = (typeof location !== 'undefined' ? location.pathname : '').toLowerCase();

    for (var i = 0; i < list.length; i++) {
      var tab = list[i];
      var href = tab.html_url || tab.full_url || ('/courses/' + this.courseId + '/' + (tab.id || ''));
      var isGrades = tab.id === 'grades' || /gradebook|grades/i.test(tab.id || '') || /\/grades|\/gradebook/i.test(href);
      var isActive = isGrades || (currentPath && href && currentPath === href.toLowerCase());

      var li = document.createElement('li');
      li.className = 'section cgp-section-tab';

      var a = document.createElement('a');
      a.className = (tab.id || 'tab') + (isActive ? ' active' : '');
      a.href = href;
      a.setAttribute('href', href);
      if (isActive) a.setAttribute('aria-current', 'page');

      var textSpan = document.createElement('span');
      textSpan.className = 'cgp-tab-text';
      textSpan.textContent = tab.label;
      a.appendChild(textSpan);

      if (tab.hidden || tab.unused || tab.visibility === 'admins') {
        a.classList.add('cgp-tab-hidden');
        var badge = document.createElement('span');
        badge.className = 'cgp-tab-badge';
        badge.title = 'Not visible to students';
        badge.setAttribute('aria-label', 'Not visible to students');
        badge.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        a.appendChild(badge);
      }

      li.appendChild(a);
      ul.appendChild(li);
    }

    nav.appendChild(ul);
    drawer.appendChild(nav);
    drawer.classList.add('cgp-course-menu-ready');
  };

  P.findToggleButtons = function () {
    var selectors = [
      '#courseMenuToggle',
      'button.ic-app-course-nav-toggle',
      'a.ic-app-course-nav-toggle',
      'button[aria-label*="course navigation" i]',
      'button[title*="course navigation" i]',
      '.ic-app-course-nav-toggle',
      '#breadcrumbs button:has(.icon-hamburger)',
      '#breadcrumbs .icon-hamburger',
      'button:has(.icon-hamburger)'
    ];
    try {
      return Array.prototype.slice.call(document.querySelectorAll(selectors.join(', ')));
    } catch (e) {
      // In case :has is not supported in an older engine
      return Array.prototype.slice.call(document.querySelectorAll('#courseMenuToggle, button.ic-app-course-nav-toggle, .ic-app-course-nav-toggle'));
    }
  };

  P.bindEvents = function () {
    if (this._bound) return;
    this._bound = true;
    var self = this;

    // Delegated click listener so any hamburger or close button click is captured,
    // even across Canvas header rerenders
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target) return;

      // Close button inside drawer
      if (target.closest && target.closest('.cgp-course-menu-close')) {
        e.preventDefault();
        e.stopPropagation();
        self.close();
        return;
      }

      // Check if clicked the course menu toggle / hamburger
      var toggleBtn = target.closest && target.closest(
        '#courseMenuToggle, button.ic-app-course-nav-toggle, a.ic-app-course-nav-toggle, button[aria-label*="course navigation" i], button[title*="course navigation" i], .ic-app-course-nav-toggle'
      );
      if (!toggleBtn && target.classList && target.classList.contains('icon-hamburger')) {
        toggleBtn = target.closest('button, a') || target;
      }

      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        self.toggle();
        return;
      }

      // Click on backdrop
      if (self.isOpen && target.classList && target.classList.contains('cgp-course-menu-backdrop')) {
        e.preventDefault();
        self.close();
        return;
      }

      // Click outside drawer while open
      if (self.isOpen && self.drawerEl && !self.drawerEl.contains(target)) {
        self.close();
      }
    }, true);

    // Escape key closes drawer
    document.addEventListener('keydown', function (e) {
      if (self.isOpen && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        self.close();
      }
    }, true);
  };

  P.open = function () {
    var drawer = this.ensureContainer();
    if (!drawer) return;

    this.isOpen = true;

    // Ensure tabs are populated
    if (!this.isTabsPopulated()) {
      if (this._tabs && this._tabs.length) {
        this.renderTabs(this._tabs);
      } else {
        drawer.innerHTML = '<div class="cgp-course-menu-loading"><div class="cgp-spinner"></div> Loading course navigation…</div>';
        var self = this;
        this.fetchTabs().then(function (tabs) {
          if (self.isOpen) self.renderTabs(tabs);
        });
      }
    }

    // Measure Canvas global header (#header) to position drawer cleanly beside it
    var header = document.getElementById('header');
    var offsetLeft = 0;
    if (header) {
      var rect = header.getBoundingClientRect();
      if (rect.width > 0 && rect.left < 10 && rect.top < 10) {
        offsetLeft = Math.round(rect.right);
      }
    }
    drawer.style.setProperty('--cgp-nav-left-offset', offsetLeft + 'px');

    drawer.classList.add('cgp-course-menu-open');
    document.documentElement.classList.add('cgp-course-menu-expanded');

    // Add backdrop
    if (!this.backdropEl) {
      var bd = document.createElement('div');
      bd.className = 'cgp-course-menu-backdrop';
      document.body.appendChild(bd);
      this.backdropEl = bd;
    }
    this.backdropEl.style.display = 'block';

    // Synchronize toggle buttons aria-expanded
    var buttons = this.findToggleButtons();
    buttons.forEach(function (b) {
      if (b.setAttribute) b.setAttribute('aria-expanded', 'true');
    });

    CGP.diag.bump('courseMenu.opened');
  };

  P.close = function () {
    this.isOpen = false;
    if (this.drawerEl) {
      this.drawerEl.classList.remove('cgp-course-menu-open');
    }
    document.documentElement.classList.remove('cgp-course-menu-expanded');

    if (this.backdropEl) {
      this.backdropEl.style.display = 'none';
    }

    var buttons = this.findToggleButtons();
    buttons.forEach(function (b) {
      if (b.setAttribute) b.setAttribute('aria-expanded', 'false');
    });

    CGP.diag.bump('courseMenu.closed');
  };

  P.toggle = function () {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  };

  CGP.CourseMenuController = CourseMenuController;
})();
