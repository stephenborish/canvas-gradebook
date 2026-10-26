/* Tests for CourseSwitcher:
 * Verifies breadcrumb discovery, mounting on multi-crumb pages (e.g. assignments),
 * query parameter handling, and max-width / truncate-width overrides. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom, domshim } = require('./domharness');

suite('CourseSwitcher & assignment breadcrumb integration', (test) => {
  test('findCrumbLink locates course link on assignment page with query parameters', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const nav = new FakeElement('nav');
    nav.id = 'breadcrumbs';
    nav.classList.add('ic-app-crumbs');
    doc.body.appendChild(nav);

    const ol = new FakeElement('ol');
    nav.appendChild(ol);

    // Crumb 0: Course home link with query parameter
    const li0 = new FakeElement('li');
    li0.style.maxWidth = '25%';
    const span0 = new FakeElement('span');
    const a0 = new FakeElement('a');
    a0.setAttribute('href', '/courses/379?from_course=1#content');
    const truncSpan = new FakeElement('span');
    truncSpan.setAttribute('data-cid', 'TruncateText');
    const innerSpan = new FakeElement('span');
    innerSpan.style.width = '160px';
    innerSpan.textContent = 'Integrated Science 2...';
    truncSpan.appendChild(innerSpan);
    a0.appendChild(truncSpan);
    span0.appendChild(a0);
    li0.appendChild(span0);
    ol.appendChild(li0);

    // Crumb 1: Assignments list link
    const li1 = new FakeElement('li');
    li1.style.maxWidth = '25%';
    const a1 = new FakeElement('a');
    a1.setAttribute('href', '/courses/379/assignments');
    a1.textContent = 'Assignments';
    li1.appendChild(a1);
    ol.appendChild(li1);

    // Crumb 2: Assignment link
    const li2 = new FakeElement('li');
    li2.style.maxWidth = '25%';
    const a2 = new FakeElement('a');
    a2.setAttribute('href', '/courses/379/assignments/6620');
    a2.textContent = 'POST-LAB - Gel Electrophor...';
    li2.appendChild(a2);
    ol.appendChild(li2);

    const switcher = new CGP.CourseSwitcher({
      api: {},
      courseId: '379',
      settings: { values: { courseSwitcher: true } },
      isGradebookPage: false
    });

    const link = switcher.findCrumbLink();
    a.eq(link, a0, 'findCrumbLink returns the course link, ignoring assignments links');

    switcher.start();

    // Verify toggle button was mounted
    const toggle = span0.querySelector('.cgp-crumb-toggle');
    a.ok(toggle, 'cgp-crumb-toggle was inserted after course link');
    a.eq(toggle.getAttribute('aria-label'), 'Switch course', 'aria-label is Switch course on assignment page');
    a.eq(toggle.title, 'Switch course', 'title is Switch course on assignment page');

    // Verify li0 max-width was released from 25% constraint
    a.eq(li0.style.maxWidth, 'none', 'li maxWidth is released so it does not collide with adjacent crumbs');

    // Verify inner truncate span width was released from explicit 160px
    a.eq(innerSpan.style.width, 'auto', 'TruncateText explicit span width was cleared to prevent gap');

    // Verify classes added
    a.ok(a0.classList.contains('cgp-crumb-link'), 'cgp-crumb-link added to link');
    a.ok(li0.classList.contains('cgp-crumb-item'), 'cgp-crumb-item added to li');
    a.ok(span0.classList.contains('cgp-crumb-item'), 'cgp-crumb-item added to span wrapper');
  });

  test('CourseSwitcher uses gradebook label when isGradebookPage is true', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const nav = new FakeElement('nav');
    nav.id = 'breadcrumbs';
    doc.body.appendChild(nav);

    const li0 = new FakeElement('li');
    const a0 = new FakeElement('a');
    a0.setAttribute('href', '/courses/379');
    li0.appendChild(a0);
    nav.appendChild(li0);

    const switcher = new CGP.CourseSwitcher({
      api: {},
      courseId: '379',
      settings: { values: { courseSwitcher: true } },
      isGradebookPage: true
    });

    switcher.start();

    const toggle = li0.querySelector('.cgp-crumb-toggle');
    a.ok(toggle, 'toggle exists');
    a.eq(toggle.getAttribute('aria-label'), 'Switch course gradebook', 'aria-label is Switch course gradebook on gradebook page');
  });

  test('StudentSearch findAnchor handles query parameters and releases maxWidth', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;

    const nav = new FakeElement('nav');
    nav.id = 'breadcrumbs';
    doc.body.appendChild(nav);

    const li0 = new FakeElement('li');
    li0.style.maxWidth = '50%';
    const a0 = new FakeElement('a');
    a0.setAttribute('href', '/courses/379?login=1');
    li0.appendChild(a0);
    nav.appendChild(li0);

    const search = new CGP.StudentSearch({
      api: {},
      courseId: '379',
      settings: { values: { studentSearch: true } }
    });

    const anchor = search.findAnchor();
    a.eq(anchor, a0, 'findAnchor finds course link with query params');
    a.eq(li0.style.maxWidth, 'none', 'releases li maxWidth');
  });
  test('mounts beside the plain-text course crumb on the course home page', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const prevLocation = globalThis.location;
    globalThis.location = { pathname: '/courses/379', origin: 'https://x.instructure.com' };
    try {
      const nav = new FakeElement('nav');
      nav.id = 'breadcrumbs';
      doc.body.appendChild(nav);
      const ol = new FakeElement('ol');
      nav.appendChild(ol);
      const li = new FakeElement('li');
      const current = new FakeElement('span');
      current.setAttribute('aria-current', 'page');
      current.textContent = 'Integrated Science I - 4';
      li.appendChild(current);
      ol.appendChild(li);

      const switcher = new CGP.CourseSwitcher({
        api: {}, courseId: '379', settings: { values: { courseSwitcher: true } }, isGradebookPage: false
      });
      a.eq(switcher.findCrumbLink(), current, 'the current-page crumb is the anchor on course home');
      switcher.start();
      a.ok(li.querySelector('.cgp-crumb-toggle'), 'Switch course mounted inside the course crumb');

      // Anywhere else, the current crumb is not the course name.
      globalThis.location = { pathname: '/courses/379/assignments', origin: 'https://x.instructure.com' };
      a.eq(switcher.findHomeCrumb(), null, 'never on a non-home page');
    } finally {
      globalThis.location = prevLocation;
    }
  });

  test('course home with no aria-current falls back to the last crumb text', () => {
    const CGP = loadGradebookDom();
    const doc = domshim.install();
    const FakeElement = domshim.FakeElement;
    const prevLocation = globalThis.location;
    globalThis.location = { pathname: '/courses/379/', origin: 'https://x.instructure.com' };
    try {
      const nav = new FakeElement('nav');
      nav.id = 'breadcrumbs';
      doc.body.appendChild(nav);
      const li = new FakeElement('li');
      const span = new FakeElement('span');
      span.textContent = 'Integrated Science I - 4';
      li.appendChild(span);
      nav.appendChild(li);
      const switcher = new CGP.CourseSwitcher({
        api: {}, courseId: '379', settings: { values: { courseSwitcher: true } }, isGradebookPage: false
      });
      a.eq(switcher.findCrumbLink(), span);
    } finally {
      globalThis.location = prevLocation;
    }
  });
});
