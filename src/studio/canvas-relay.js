/* Canvas Gradebook+ - the class list for Studio, from the Canvas page
 * Studio is open in.
 *
 * Studio (on <school>.instructuremedia.com, in a frame of this Canvas
 * page) knows who watched a video but not who is in the class. When the
 * extension's own script in that frame (studio/content.js) asks, this
 * reads the course's students - names and emails - with the teacher's
 * Canvas session and answers that frame only. It answers only a frame
 * inside this page, only from a Studio site, only for a course this
 * teacher teaches, and keeps nothing. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.studioRelayStarted || typeof window === 'undefined' || window.self !== window.top) return;
  CGP.studioRelayStarted = true;

  var ASK = 'cgp-studio-ask';
  var RELAY = 'cgp-canvas-relay';
  var STUDIO_ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.instructuremedia\.com$/i;

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
          return { id: String(u.id), name: u.name || u.short_name || '', sortable_name: u.sortable_name || '', email: u.email || u.login_id || '' };
        });
      });
      rosters[courseId].catch(function () { delete rosters[courseId]; });
    }
    return rosters[courseId];
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.source !== ASK || d.type !== 'roster') return;
    if (!STUDIO_ORIGIN.test(e.origin) || !e.source || e.source === window || !CGP.util || !CGP.util.isFrameWithin(e.source, window)) return;
    if (!CGP.CanvasApi) return;
    if (!api) api = new CGP.CanvasApi();
    var reply = function (msg) {
      try { e.source.postMessage(Object.assign({ source: RELAY, id: String(d.id || '') }, msg), e.origin); } catch (err) { /* frame gone */ }
    };
    var name = String(d.courseName || '').slice(0, 300);
    findCourse(name, /^\d+$/.test(String(d.courseId || '')) ? String(d.courseId) : null).then(function (course) {
      if (!course) {
        reply({ ok: false, error: name ? 'No course you teach in Canvas is called “' + name + '”' : 'Couldn’t tell which course this embed belongs to' });
        return;
      }
      return roster(course.id).then(function (students) {
        reply({ ok: true, courseId: String(course.id), courseName: course.name || name, students: students });
      });
    }).catch(function (err) {
      reply({ ok: false, error: (CGP.util && CGP.util.describeApiError) ? CGP.util.describeApiError(err, { fallback: 'Canvas didn’t give the class list' }) : 'Canvas didn’t give the class list' });
    });
  });
})();
