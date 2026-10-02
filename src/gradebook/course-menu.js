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
    if (this.drawerEl && document.body && document.body.contains(this.drawerEl)) {
      return this.drawerEl;
    }
    var leftSide = (document.getElementById ? document.getElementById('left-side') : null) ||
                   (document.querySelector ? document.querySelector('#left-side, .cgp-course-menu-drawer') : null);
    if (!leftSide) {
      leftSide = document.createElement('div');
      leftSide.id = 'left-side';
      leftSide.className = 'ic-app-course-menu cgp-course-menu-drawer';
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
    } else {
      leftSide.classList.add('cgp-course-menu-drawer');
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

  function defaultCourseTabs(courseId) {
    return [
      { id: 'home', label: 'Home', html_url: '/courses/' + courseId, visibility: 'public' },
      { id: 'announcements', label: 'Announcements', html_url: '/courses/' + courseId + '/announcements', visibility: 'public' },
      { id: 'assignments', label: 'Assignments', html_url: '/courses/' + courseId + '/assignments', visibility: 'public' },
      { id: 'grades', label: 'Grades', html_url: '/courses/' + courseId + '/grades', visibility: 'public' },
      { id: 'modules', label: 'Modules', html_url: '/courses/' + courseId + '/modules', visibility: 'public' },
      { id: 'quizzes', label: 'Quizzes', html_url: '/courses/' + courseId + '/quizzes', visibility: 'public' },
      { id: 'people', label: 'People', html_url: '/courses/' + courseId + '/users', visibility: 'public' },
      { id: 'settings', label: 'Settings', html_url: '/courses/' + courseId + '/settings', visibility: 'admins' }
    ];
  }

  P.fetchTabs = function () {
    var self = this;
    if (this._tabs && this._tabs.length) return Promise.resolve(this._tabs);
    if (this._fetchPromise) return this._fetchPromise;
    if (!this.api) {
      var fb = defaultCourseTabs(this.courseId);
      this._tabs = fb;
      this.renderTabs(fb);
      return Promise.resolve(fb);
    }
    this._fetchPromise = this.api.get('/api/v1/courses/' + this.courseId + '/tabs').then(function (tabs) {
      self._fetchPromise = null;
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
      var fallback = defaultCourseTabs(self.courseId);
      self._tabs = fallback;
      self.renderTabs(fallback);
      return fallback;
    }).catch(function (err) {
      self._fetchPromise = null;
      CGP.diag.warn('courseMenu.fetchFailed', { courseId: self.courseId, error: String(err && err.message) });
      var fallback = self._tabs || defaultCourseTabs(self.courseId);
      self._tabs = fallback;
      self.renderTabs(fallback);
      return fallback;
    });
    return this._fetchPromise;
  };

  P.renderLoading = function () {
    var drawer = this.ensureContainer();
    if (!drawer) return;
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

    var loading = document.createElement('div');
    loading.className = 'cgp-course-menu-loading';
    loading.textContent = 'Loading course navigation…';
    drawer.appendChild(loading);
  };

  P.isTabsPopulated = function () {
    if (!this.drawerEl) return false;
    if (!this.drawerEl.classList.contains('cgp-course-menu-ready')) return false;
    var links = this.drawerEl.querySelectorAll('.cgp-section-tab a[href]');
    return links.length >= 2;
  };

  P.renderTabs = function (tabs) {
    var drawer = this.ensureContainer();
    if (!drawer) return;

    // Filter tabs visible to teachers (Canvas tabs have visibility: 'public', 'members', 'admins', or 'none')
    var list = (tabs || []).filter(function (t) {
      return t && t.visibility !== 'none' && t.label;
    });

    if (!list.length) {
      list = defaultCourseTabs(this.courseId);
    }

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

  P.isCourseMenuToggle = function (target) {
    if (!target) return null;
    var el = (target.nodeType === 1) ? target : (target.parentElement || null);
    if (!el) return null;

    // Look for enclosing button, anchor, or role="button"
    var btn = null;
    if (typeof el.closest === 'function') {
      btn = el.closest('button, a, [role="button"], #courseMenuToggle, .ic-app-course-nav-toggle');
    }
    if (!btn && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')) {
      btn = el;
    }
    if (!btn && el.parentElement && typeof el.parentElement.closest === 'function') {
      btn = el.parentElement.closest('button, a, [role="button"]');
    }
    if (!btn) return null;

    // Never match extension's own controls
    if (btn.classList && (
      btn.classList.contains('cgp-crumb-toggle') ||
      btn.classList.contains('cgp-find-student') ||
      btn.classList.contains('cgp-course-menu-close') ||
      btn.classList.contains('cgp-course-switcher')
    )) {
      return null;
    }
    if (btn.closest && (
      btn.closest('.cgp-course-switcher') ||
      btn.closest('.cgp-find-student-dialog') ||
      btn.closest('.cgp-course-menu-drawer') ||
      btn.closest('#cgp-toast')
    )) {
      return null;
    }

    // 1. Direct ID or classic Canvas class
    if (btn.id === 'courseMenuToggle' || (btn.classList && btn.classList.contains('ic-app-course-nav-toggle'))) {
      return btn;
    }

    // 2. Attribute checks (aria-label, title, class, data attributes)
    var label = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    var title = (btn.getAttribute('title') || '').trim().toLowerCase();
    var className = (btn.className && typeof btn.className === 'string' ? btn.className : '').toLowerCase();
    var track = (btn.getAttribute('data-track-category') || '').toLowerCase();
    var testId = (btn.getAttribute('data-testid') || '').toLowerCase();

    // Canvas uses "Courses Navigation Menu", "Course Navigation Menu", "Courses navigation", etc.
    var navPattern = /(?:course|courses|navigation|nav).*(?:menu|nav)|(?:menu|nav).*(?:course|courses)|courses?\s+navigation|hamburger/i;
    if (navPattern.test(label) || navPattern.test(title) || navPattern.test(className) || navPattern.test(track) || navPattern.test(testId)) {
      return btn;
    }

    if (/navigation\s+menu/i.test(label) || /navigation\s+menu/i.test(title) || /course\s+menu/i.test(label) || /course\s+menu/i.test(title)) {
      return btn;
    }

    // 3. Breadcrumb / header location check:
    // In Canvas, the breadcrumb header (.ic-app-nav-toggle-and-crumbs, #breadcrumbs, .ic-app-crumbs)
    // contains the course title links and exactly one icon button: the course navigation hamburger toggle.
    var inBreadcrumbs = btn.closest && btn.closest('.ic-app-nav-toggle-and-crumbs, #breadcrumbs, .ic-app-crumbs, .navigation-tray-container');
    if (inBreadcrumbs) {
      if (btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button') {
        var hasIcon = !!(btn.querySelector && btn.querySelector('svg, i, [class*="icon"], [class*="Button"]'));
        var text = (btn.textContent || '').trim();
        if (hasIcon || text.length === 0 || /menu|nav|course/i.test(text)) {
          return btn;
        }
      }
    }

    // 4. Hamburger icon check inside button
    if (btn.querySelector && btn.querySelector('.icon-hamburger, [class*="icon-hamburger"], svg[name*="Hamburger" i], svg[class*="Hamburger" i]')) {
      return btn;
    }

    return null;
  };

  P.findToggleButtons = function () {
    var selectors = [
      '#courseMenuToggle',
      'button.ic-app-course-nav-toggle',
      'a.ic-app-course-nav-toggle',
      'button[aria-label*="courses navigation" i]',
      'button[aria-label*="course navigation" i]',
      'button[aria-label*="navigation menu" i]',
      'button[aria-label*="courses menu" i]',
      'button[aria-label*="course menu" i]',
      'button[title*="courses navigation" i]',
      'button[title*="course navigation" i]',
      'button[title*="navigation menu" i]',
      'button[data-track-category*="course_navigation" i]',
      '#breadcrumbs button:not(.cgp-crumb-toggle):not(.cgp-find-student):not(.cgp-course-menu-close)',
      '.ic-app-crumbs button:not(.cgp-crumb-toggle):not(.cgp-find-student):not(.cgp-course-menu-close)',
      '.ic-app-nav-toggle-and-crumbs button:not(.cgp-crumb-toggle):not(.cgp-find-student):not(.cgp-course-menu-close)',
      '#breadcrumbs .icon-hamburger',
      'button:has(.icon-hamburger)'
    ];
    try {
      return Array.prototype.slice.call(document.querySelectorAll(selectors.join(', ')));
    } catch (e) {
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
      var toggleBtn = self.isCourseMenuToggle(target);
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        self.toggle();
        return;
      }

      // Click on link to current page (Grades) closes drawer
      var link = target.closest && target.closest('a');
      if (link && self.drawerEl && self.drawerEl.contains(link)) {
        if (link.classList.contains('grades') || link.classList.contains('active')) {
          e.preventDefault();
          self.close();
          return;
        }
      }

      // Click outside drawer while open closes drawer without needing any backdrop
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

    // Move to document.body so no parent layout clipping or overflow can hide it
    if (drawer.parentElement !== document.body && document.body) {
      document.body.appendChild(drawer);
    }

    // Ensure tabs are populated
    if (!this.isTabsPopulated()) {
      if (this._tabs && this._tabs.length) {
        this.renderTabs(this._tabs);
      } else {
        this.renderLoading();
        var self = this;
        this.fetchTabs().then(function (tabs) {
          if (self.isOpen) self.renderTabs(tabs);
        });
      }
    }

    // Measure Canvas global header (#header) to position drawer cleanly beside it
    var header = document.getElementById('header') ||
                 (document.querySelector ? document.querySelector('.ic-app-header') : null);
    var offsetLeft = 54;
    if (header && header.getBoundingClientRect) {
      var rect = header.getBoundingClientRect();
      if (rect.right > 0 && rect.right < 200) {
        offsetLeft = Math.round(rect.right);
      }
    }
    drawer.style.setProperty('--cgp-nav-left-offset', offsetLeft + 'px');
    drawer.style.setProperty('position', 'fixed', 'important');
    drawer.style.setProperty('top', '0px', 'important');
    drawer.style.setProperty('bottom', '0px', 'important');
    drawer.style.setProperty('left', offsetLeft + 'px', 'important');
    drawer.style.setProperty('width', '260px', 'important');
    drawer.style.setProperty('max-width', '85vw', 'important');
    drawer.style.setProperty('background', '#ffffff', 'important');
    drawer.style.setProperty('z-index', '100005', 'important');
    drawer.style.setProperty('box-shadow', '4px 0 24px rgba(0, 0, 0, 0.18)', 'important');
    drawer.style.setProperty('border-right', '1px solid #d8dcde', 'important');
    drawer.style.setProperty('display', 'flex', 'important');
    drawer.style.setProperty('flex-direction', 'column', 'important');
    drawer.style.setProperty('visibility', 'visible', 'important');
    drawer.style.setProperty('overflow', 'hidden', 'important');
    drawer.style.setProperty('margin', '0px', 'important');
    drawer.style.setProperty('padding', '0px', 'important');

    drawer.classList.add('cgp-course-menu-open');
    document.documentElement.classList.add('cgp-course-menu-expanded');

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
      this.drawerEl.style.setProperty('display', 'none', 'important');
      this.drawerEl.style.setProperty('visibility', 'hidden', 'important');
    }
    document.documentElement.classList.remove('cgp-course-menu-expanded');

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
