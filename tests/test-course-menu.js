/* Tests for CourseMenuController:
 * Ensures the course navigation menu is fetched, rendered with clean tabs,
 * and toggled cleanly without leaving the drawer blank on the Gradebook page. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

suite('CourseMenuController & layout protection', (test) => {
  const sampleTabs = [
    { id: 'home', label: 'Home', html_url: '/courses/379', visibility: 'public' },
    { id: 'announcements', label: 'Announcements', html_url: '/courses/379/announcements', visibility: 'public' },
    { id: 'assignments', label: 'Assignments', html_url: '/courses/379/assignments', visibility: 'public' },
    { id: 'grades', label: 'Grades', html_url: '/courses/379/grades', visibility: 'public' },
    { id: 'people', label: 'People', html_url: '/courses/379/users', visibility: 'public' },
    { id: 'settings', label: 'Settings', html_url: '/courses/379/settings', visibility: 'admins' },
    { id: 'hidden_tab', label: 'Hidden Item', html_url: '/courses/379/hidden', visibility: 'none' }
  ];

  test('CourseMenuController populates #left-side with course tabs from api', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const wrapper = new FakeElement('div');
    wrapper.id = 'wrapper';
    doc.body.appendChild(wrapper);

    const toggleBtn = new FakeElement('button');
    toggleBtn.id = 'courseMenuToggle';
    toggleBtn.classList.add('ic-app-course-nav-toggle');
    wrapper.appendChild(toggleBtn);

    const fakeApi = {
      get: (path) => {
        if (path === '/api/v1/courses/379/tabs') return Promise.resolve(sampleTabs);
        return Promise.reject(new Error('Unknown path ' + path));
      }
    };

    const ctrl = new CGP.CourseMenuController({
      api: fakeApi,
      courseId: '379',
      settings: { values: {} }
    });

    ctrl.start();
    await ctrl.fetchTabs();

    const leftSide = doc.getElementById('left-side');
    a.ok(leftSide, '#left-side container exists');

    const links = leftSide.querySelectorAll('a[href]');
    // 6 valid tabs (hidden_tab has visibility: 'none' and should be filtered out)
    a.eq(links.length, 6, 'valid tabs rendered into course menu');

    // Grades tab should be active
    const gradesLink = leftSide.querySelector('a.grades');
    a.ok(gradesLink, 'grades tab exists');
    a.ok(gradesLink.classList.contains('active'), 'grades tab is active');
    a.eq(gradesLink.getAttribute('aria-current'), 'page', 'grades tab has aria-current="page"');

    // Settings tab has visibility: admins, so it should have a hidden badge
    const settingsLink = leftSide.querySelector('a.settings');
    a.ok(settingsLink, 'settings tab exists');
    a.ok(settingsLink.classList.contains('cgp-tab-hidden'), 'settings marked with cgp-tab-hidden');
  });

  test('open() and close() manage drawer classes and aria-expanded state', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const wrapper = new FakeElement('div');
    wrapper.id = 'wrapper';
    doc.body.appendChild(wrapper);

    const toggleBtn = new FakeElement('button');
    toggleBtn.id = 'courseMenuToggle';
    wrapper.appendChild(toggleBtn);

    const fakeApi = {
      get: () => Promise.resolve(sampleTabs)
    };

    const ctrl = new CGP.CourseMenuController({
      api: fakeApi,
      courseId: '379',
      settings: { values: {} }
    });

    ctrl.start();
    await ctrl.fetchTabs();

    const leftSide = doc.getElementById('left-side');

    a.eq(ctrl.isOpen, false);
    ctrl.open();
    a.eq(ctrl.isOpen, true);
    a.ok(leftSide.classList.contains('cgp-course-menu-open'), '#left-side has cgp-course-menu-open');
    a.eq(toggleBtn.getAttribute('aria-expanded'), 'true', 'toggle button has aria-expanded=true');

    ctrl.close();
    a.eq(ctrl.isOpen, false);
    a.ok(!leftSide.classList.contains('cgp-course-menu-open'), '#left-side no longer has open class');
    a.eq(toggleBtn.getAttribute('aria-expanded'), 'false', 'toggle button has aria-expanded=false');
  });

  test('CourseMenuController falls back to default course tabs when API fails and never creates backdrops', async () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const wrapper = new FakeElement('div');
    wrapper.id = 'wrapper';
    doc.body.appendChild(wrapper);

    const toggleBtn = new FakeElement('button');
    toggleBtn.id = 'courseMenuToggle';
    wrapper.appendChild(toggleBtn);

    const failingApi = {
      get: () => Promise.reject(new Error('Network error'))
    };

    const ctrl = new CGP.CourseMenuController({
      api: failingApi,
      courseId: '379',
      settings: { values: {} }
    });

    ctrl.start();
    const tabs = await ctrl.fetchTabs();
    a.ok(tabs.length >= 6, 'fallback tabs returned on API failure');

    const leftSide = doc.getElementById('left-side');
    a.ok(leftSide, '#left-side exists');
    const links = leftSide.querySelectorAll('a[href]');
    a.ok(links.length >= 6, 'fallback links rendered in menu');

    ctrl.open();
    a.eq(ctrl.isOpen, true);
    a.ok(leftSide.classList.contains('cgp-course-menu-open'), 'drawer is open');

    // Ensure no backdrop element exists
    const backdrops = doc.body.querySelectorAll('.cgp-course-menu-backdrop');
    a.eq(backdrops.length, 0, 'zero backdrop elements created');
  });

  test('layout controller protects course navigation elements from collapsing', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const layout = new CGP.CompactLayoutController({
      adapter: new CGP.GradebookDomAdapter(),
      settings: { values: { hideCanvasUtilityControls: true } }
    });

    const leftSide = new FakeElement('div');
    leftSide.id = 'left-side';

    const courseNav = new FakeElement('nav');
    courseNav.id = 'course-nav';

    const sectionTabs = new FakeElement('ul');
    sectionTabs.id = 'section-tabs';

    const toggle = new FakeElement('button');
    toggle.id = 'courseMenuToggle';

    a.ok(layout.isProtected(leftSide), '#left-side is protected');
    a.ok(layout.isProtected(courseNav), '#course-nav is protected');
    a.ok(layout.isProtected(sectionTabs), '#section-tabs is protected');
    a.ok(layout.isProtected(toggle), '#courseMenuToggle is protected');
  });
});
