/* Canvas Gradebook+ - page-context ENV bridge.
 *
 * Content scripts run in an isolated world and cannot read Canvas's window.ENV
 * directly. This tiny script runs in the page, posts back a short allowlist of
 * identifiers (never student data, never grades, never comments) and removes
 * itself. It is used only to cross-check the course and user ids the extension
 * already resolved from the URL and the Canvas API. */
(function () {
  'use strict';
  try {
    var ENV = window.ENV || {};
    var opts = ENV.GRADEBOOK_OPTIONS || {};
    var payload = {
      currentUserId: ENV.current_user_id === undefined ? null : String(ENV.current_user_id),
      courseId: (ENV.COURSE_ID || ENV.course_id || opts.context_id || null),
      gradebookEditable: opts.gradebook_is_editable === undefined ? null : !!opts.gradebook_is_editable,
      gradingPeriodsEnabled: !!(opts.grading_period_set || opts.multiple_grading_periods_enabled),
      postPolicies: !!opts.post_policies_enabled
    };
    if (payload.courseId !== null) payload.courseId = String(payload.courseId);
    window.postMessage({ source: 'cgp-env', env: payload }, window.location.origin);
  } catch (e) {
    /* Canvas layout differences must never break the page */
  }
})();
