/* Canvas Gradebook+ - the class list for Studio, from the Canvas page
 * Studio is open in.
 *
 * Studio (on <school>.instructuremedia.com, in a frame of this Canvas
 * page) knows who watched a video but not who is in the class. When the
 * extension's own script in that frame (studio/content.js) asks, through
 * the service worker, this reads the course's students - names and emails,
 * which is how Studio's viewers are matched to them - with the teacher's
 * Canvas session. It answers only for a course this teacher teaches, only
 * by extension messaging (never window.postMessage), and keeps nothing. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.studioRelayStarted || typeof window === 'undefined' || window.self !== window.top) return;
  CGP.studioRelayStarted = true;

  // Sent by background.js, which received cgp.studio.roster from a Studio frame.
  var ROSTER_ASK = 'cgp.studio.roster.ask';

  var api = null;
  var courses = null;
  var rosters = Object.create(null);

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
  }

  function pageCourseId() {
    var m = /\/courses\/(\d+)(?:\/|$)/.exec(location.pathname);
    return m ? m[1] : null;
  }

  /* The course Studio's embed belongs to: by name (Studio names an embed
   * after its Canvas course), else the course this page is in. */
  function findCourse(name, idHint) {
    if (!courses) courses = api.teachingCourses().catch(function (e) { courses = null; throw e; });
    return courses.then(function (list) {
      var n = norm(name);
      var byId = function (id) { return id ? list.filter(function (c) { return String(c.id) === String(id); })[0] : null; };
      var hit = null;
      if (n) {
        var named = list.filter(function (c) { return norm(c.name) === n || norm(c.course_code) === n; });
        if (named.length > 1) {
          // The same name in two terms: this page's course, else the one still running.
          hit = byId(pageCourseId()) && named.indexOf(byId(pageCourseId())) >= 0 ? byId(pageCourseId())
            : named.filter(function (c) { return c.workflow_state === 'available'; })[0] || named[0];
        } else hit = named[0] || null;
      }
      if (!hit && idHint) hit = byId(idHint);
      if (!hit && !n) hit = byId(pageCourseId());
      return hit;
    });
  }

  function roster(courseId) {
    if (!rosters[courseId]) {
      rosters[courseId] = api.courseRoster(courseId).then(function (users) {
        return (users || []).map(function (u) {
          return { id: String(u.id), name: u.name || u.short_name || '', sortable_name: u.sortable_name || '', email: u.email || '', login_id: u.login_id || '' };
        });
      });
      rosters[courseId].catch(function () { delete rosters[courseId]; });
    }
    return rosters[courseId];
  }

  /* Asked by the service worker on behalf of the extension's own script in
   * a Studio frame of this tab (background.js checks that sender: a frame,
   * not this page, on a Studio site, in this same tab). Page scripts can
   * neither send this question nor read its answer, unlike the
   * window.postMessage relay this replaces. */
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
  chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || msg.type !== ROSTER_ASK) return false;
    // From the service worker only: an extension sender with no tab.
    if (!sender || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (!CGP.CanvasApi) return false;
    if (!api) api = new CGP.CanvasApi();
    var name = String(msg.courseName || '').slice(0, 300);
    findCourse(name, /^\d+$/.test(String(msg.courseId || '')) ? String(msg.courseId) : null).then(function (course) {
      if (!course) {
        respond({ ok: false, error: name ? 'No course you teach in Canvas is called “' + name + '”' : 'Couldn’t tell which course this embed belongs to' });
        return;
      }
      return roster(course.id).then(function (students) {
        respond({ ok: true, courseId: String(course.id), courseName: course.name || name, students: students });
      });
    }).catch(function (err) {
      respond({ ok: false, error: (CGP.util && CGP.util.describeApiError) ? CGP.util.describeApiError(err, { fallback: 'Canvas didn’t give the class list' }) : 'Canvas didn’t give the class list' });
    });
    return true;   // answered asynchronously
  });
})();
