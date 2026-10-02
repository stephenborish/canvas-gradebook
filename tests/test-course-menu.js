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

  test('isCourseMenuToggle accurately identifies modern Canvas InstUI hamburger button', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const crumbs = new FakeElement('div');
    crumbs.id = 'breadcrumbs';
    crumbs.classList.add('ic-app-crumbs');
    doc.body.appendChild(crumbs);

    // Modern InstUI button: <button class="Button Button--icon-action" aria-label="Courses Navigation Menu"><svg><path /></svg></button>
    const instUiBtn = new FakeElement('button');
    instUiBtn.classList.add('Button');
    instUiBtn.classList.add('Button--icon-action');
    instUiBtn.setAttribute('aria-label', 'Courses Navigation Menu');

    const svg = new FakeElement('svg');
    const path = new FakeElement('path');
    svg.appendChild(path);
    instUiBtn.appendChild(svg);
    crumbs.appendChild(instUiBtn);

    // Extension button: Switch course
    const switchBtn = new FakeElement('button');
    switchBtn.classList.add('cgp-crumb-toggle');
    switchBtn.setAttribute('aria-label', 'Switch course gradebook');
    crumbs.appendChild(switchBtn);

    // Extension button: Find student
    const findBtn = new FakeElement('button');
    findBtn.classList.add('cgp-crumb-toggle');
    findBtn.classList.add('cgp-find-student');
    crumbs.appendChild(findBtn);

    // Breadcrumb course link
    const courseLink = new FakeElement('a');
    courseLink.setAttribute('href', '/courses/379');
    courseLink.textContent = 'Integrated Science';
    crumbs.appendChild(courseLink);

    const ctrl = new CGP.CourseMenuController({
      api: { get: () => Promise.resolve([]) },
      courseId: '379',
      settings: { values: {} }
    });

    // Clicks on the path/svg inside the InstUI button resolve to the button
    a.eq(ctrl.isCourseMenuToggle(path), instUiBtn, 'path inside InstUI button matches toggle');
    a.eq(ctrl.isCourseMenuToggle(svg), instUiBtn, 'svg inside InstUI button matches toggle');
    a.eq(ctrl.isCourseMenuToggle(instUiBtn), instUiBtn, 'InstUI button itself matches toggle');

    // Extension controls and breadcrumb link must NOT match
    a.eq(ctrl.isCourseMenuToggle(switchBtn), null, 'switch course button is not course menu toggle');
    a.eq(ctrl.isCourseMenuToggle(findBtn), null, 'find student button is not course menu toggle');
    a.eq(ctrl.isCourseMenuToggle(courseLink), null, 'breadcrumb course link is not course menu toggle');
  });

  test('isTabsPopulated requires cgp-course-menu-ready and valid section tab links', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const drawer = new FakeElement('div');
    drawer.id = 'left-side';
    doc.body.appendChild(drawer);

    // Insert 2 raw unstyled links (simulating Canvas skeleton)
    const rawLink1 = new FakeElement('a');
    rawLink1.setAttribute('href', '/courses/379/home');
    const rawLink2 = new FakeElement('a');
    rawLink2.setAttribute('href', '/courses/379/grades');
    drawer.appendChild(rawLink1);
    drawer.appendChild(rawLink2);

    const ctrl = new CGP.CourseMenuController({
      api: { get: () => Promise.resolve([]) },
      courseId: '379',
      settings: { values: {} }
    });
    ctrl.ensureContainer();

    // Not populated yet because cgp-course-menu-ready is absent and links are not .cgp-section-tab
    a.eq(ctrl.isTabsPopulated(), false, 'raw links without ready class are not treated as populated');

    // After renderTabs runs, ready class and .cgp-section-tab links exist
    ctrl.renderTabs(sampleTabs);
    a.eq(ctrl.isTabsPopulated(), true, 'rendered tabs are treated as populated');
  });

  test('open() and close() enforce inline display and positioning overrides', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();

    const ctrl = new CGP.CourseMenuController({
      api: { get: () => Promise.resolve(sampleTabs) },
      courseId: '379',
      settings: { values: {} }
    });

    ctrl.start();
    const drawer = ctrl.ensureContainer();

    ctrl.open();
    a.eq(drawer.style.display, 'flex', 'open sets inline display: flex');
    a.eq(drawer.style.position, 'fixed', 'open sets inline position: fixed');
    a.eq(drawer.style.zIndex, '100005', 'open sets z-index: 100005');
    a.eq(drawer.style.visibility, 'visible', 'open sets inline visibility: visible');

    ctrl.close();
    a.eq(drawer.style.display, 'none', 'close sets inline display: none');
    a.eq(drawer.style.visibility, 'hidden', 'close sets inline visibility: hidden');
  });
});
