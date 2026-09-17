/* Canvas Gradebook+ - Canvas REST client.
 *
 * Uses the instructor's existing authenticated Canvas session:
 *   - same-origin fetch with credentials, so no API token is ever requested
 *   - X-CSRF-Token taken from Canvas's own _csrf_token cookie for writes
 *   - hard refusal of any non same-origin URL, so no data can leave Canvas
 * Every request is funnelled through a bounded pool with retry/backoff. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CanvasApi) return;
  var util = CGP.util;

  function CanvasApiError(message, info) {
    var e = Error.call(this, message);
    this.name = 'CanvasApiError';
    this.message = message;
    this.stack = e.stack;
    Object.assign(this, info || {});
  }
  CanvasApiError.prototype = Object.create(Error.prototype);
  CanvasApiError.prototype.constructor = CanvasApiError;

  function parseBody(text) {
    if (!text) return null;
    var body = text.replace(/^while\(1\);\s*/, '');
    try { return JSON.parse(body); } catch (e) { return null; }
  }

  function nextLink(linkHeader) {
    if (!linkHeader) return null;
    var parts = String(linkHeader).split(',');
    for (var i = 0; i < parts.length; i++) {
      var m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(parts[i]);
      if (m) return m[1];
    }
    return null;
  }

  function CanvasApi(opts) {
    opts = opts || {};
    this.origin = opts.origin || (typeof location !== 'undefined' ? location.origin : '');
    this.fetchImpl = opts.fetch || (typeof fetch === 'function' ? function () { return fetch.apply(null, arguments); } : null);
    // Bulk boot work (assignments + enrollments together, then several
    // 8-assignment submission batches while prefetching) is several
    // independent request chains that all want to run at once; a pool this
    // narrow serialized them more than Canvas itself needs, which is exactly
    // the kind of thing that reads as "slow to load" without any single
    // request actually being slow. 429s and 5xxs already retry with backoff
    // (see request() below), so a modest increase costs nothing on a course
    // that never gets throttled and only means slightly more patience on one
    // that does.
    this.gate = util.pool(opts.concurrency || 6);
  }

  CanvasApi.prototype.csrfToken = function () {
    return util.cookie('_csrf_token');
  };

  CanvasApi.prototype.url = function (path, params) {
    var u = /^https?:/i.test(path) ? new URL(path) : new URL(String(this.origin).replace(/\/$/, '') + path);
    if (u.origin !== this.origin) {
      throw new CanvasApiError('Refusing non same-origin Canvas request', { path: String(path) });
    }
    if (params) {
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null) return;
        if (Array.isArray(v)) v.forEach(function (x) { u.searchParams.append(k, String(x)); });
        else u.searchParams.set(k, String(v));
      });
    }
    return u;
  };

  CanvasApi.prototype.request = function (path, opts) {
    var self = this;
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var u = this.url(path, opts.params);
    var headers = {
      'Accept': 'application/json+canvas-string-ids, application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    var body;
    if (opts.json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      var sp = new URLSearchParams();
      Object.keys(opts.form).forEach(function (k) {
        var v = opts.form[k];
        if (v === undefined || v === null) return;
        sp.append(k, String(v));
      });
      body = sp.toString();
    }
    if (method !== 'GET' && method !== 'HEAD') {
      var token = this.csrfToken();
      if (token) headers['X-CSRF-Token'] = token;
      else CGP.diag.warn('csrf.missing', { method: method, path: u.pathname });
    }

    var maxRetries = opts.retries === undefined ? 2 : opts.retries;

    function attempt(n) {
      return self.gate(function () {
        if (!self.fetchImpl) return Promise.reject(new CanvasApiError('fetch unavailable', { path: u.pathname }));
        return self.fetchImpl(u.toString(), {
          method: method, headers: headers, body: body,
          credentials: 'same-origin', redirect: 'follow', cache: 'no-store'
        }).then(function (res) {
          return res.text().then(function (text) {
            if (!res.ok) {
              throw new CanvasApiError('Canvas ' + res.status + ' on ' + method + ' ' + u.pathname, {
                status: res.status, path: u.pathname, method: method,
                snippet: String(text || '').slice(0, 160)
              });
            }
            CGP.diag.bump('api.requests');
            return { data: parseBody(text), link: res.headers.get('Link') || res.headers.get('link') };
          });
        }, function (e) {
          throw new CanvasApiError('Network error on ' + method + ' ' + u.pathname, {
            path: u.pathname, method: method, network: true, message: String(e && e.message)
          });
        });
      }).catch(function (err) {
        var retriable = err.network === true || err.status === 429 || err.status === 403 ||
          (err.status >= 500 && err.status < 600);
        if (n < maxRetries && retriable) {
          CGP.diag.bump('api.retries');
          return util.sleep(400 * Math.pow(2, n)).then(function () { return attempt(n + 1); });
        }
        CGP.diag.error('api.failed', {
          method: err.method || method, path: err.path || u.pathname,
          status: err.status === undefined ? null : err.status, attempts: n + 1
        });
        throw err;
      });
    }
    return attempt(0);
  };

  CanvasApi.prototype.get = function (path, params) {
    return this.request(path, { params: params }).then(function (r) { return r.data; });
  };

  CanvasApi.prototype.getAll = function (path, params, opts) {
    var self = this;
    opts = opts || {};
    var maxPages = opts.maxPages || 40;
    var merged = Object.assign({ per_page: 100 }, params || {});
    var out = [];

    function step(target, page) {
      return self.request(target, {}).then(function (r) {
        if (Array.isArray(r.data)) out = out.concat(r.data);
        else if (r.data) out.push(r.data);
        var next = nextLink(r.link);
        if (next && page + 1 < maxPages) return step(next, page + 1);
        if (next) CGP.diag.warn('api.pagination.truncated', { path: String(path), pages: maxPages });
        return out;
      });
    }
    return step(this.url(path, merged).toString(), 0);
  };

  /* ------------------------------------------------------------- endpoints */

  CanvasApi.prototype.currentUser = function () {
    return this.get('/api/v1/users/self').then(function (u) {
      if (!u || u.id === undefined) return null;
      return {
        id: String(u.id),
        name: u.name || '',
        shortName: u.short_name || '',
        sortableName: u.sortable_name || ''
      };
    });
  };

  CanvasApi.prototype.currentUserId = function () {
    return this.currentUser().then(function (u) { return u ? u.id : null; });
  };

  CanvasApi.prototype.assignments = function (courseId) {
    return this.getAll('/api/v1/courses/' + courseId + '/assignments', { order_by: 'position' }, { maxPages: 20 });
  };

  /* gradingPeriodId - scopes the returned grades (current_score,
   * computed_current_score, ...) to one grading period, exactly the way
   * Canvas's own gradebook does when a grading-period filter is active -
   * see model.js's grading-period tracking for why this matters: without it,
   * this Total disagrees with Canvas's own whenever the gradebook is filtered
   * to anything but the whole course. Omitted (null/undefined) means the
   * whole course, same as leaving the parameter off entirely. */
  CanvasApi.prototype.studentEnrollments = function (courseId, gradingPeriodId) {
    return this.getAll('/api/v1/courses/' + courseId + '/enrollments', {
      'type[]': ['StudentEnrollment'],
      'state[]': ['active', 'invited'],
      grading_period_id: (gradingPeriodId === undefined || gradingPeriodId === null) ? undefined : String(gradingPeriodId)
    }, { maxPages: 20 });
  };

  CanvasApi.prototype.enrollmentForUser = function (courseId, userId, gradingPeriodId) {
    return this.getAll('/api/v1/courses/' + courseId + '/enrollments', {
      user_id: String(userId),
      'type[]': ['StudentEnrollment'],
      'state[]': ['active', 'invited'],
      grading_period_id: (gradingPeriodId === undefined || gradingPeriodId === null) ? undefined : String(gradingPeriodId)
    }, { maxPages: 2 }).then(function (list) { return (list && list[0]) || null; });
  };

  /* One request covers many assignments x every student, with comments -
   * unless opts.includeComments is explicitly false, for a caller that only
   * needs grades and posted-state (a Post button's own before/after column
   * re-reads, most of all: comments play no part in what it decides or
   * reports, and asking Canvas to also serialize every comment on every
   * submission, every time, on a column that can run to hundreds of students,
   * is pure added weight on the one action this extension most needs to feel
   * instant). Omitting it here never loses cached comments already held for
   * this column - applySubmission falls back to whatever it already has
   * whenever a response carries no submission_comments field at all - it just
   * skips re-fetching them for a read that was never going to use them. */
  CanvasApi.prototype.submissionsForAssignments = function (courseId, assignmentIds, opts) {
    opts = opts || {};
    var params = {
      'student_ids[]': ['all'],
      'assignment_ids[]': (assignmentIds || []).map(String),
      grouped: false
    };
    if (opts.includeComments !== false) params['include[]'] = ['submission_comments'];
    return this.getAll('/api/v1/courses/' + courseId + '/students/submissions', params,
      { maxPages: opts.maxPages || 60 });
  };

  /* Assignment-specific fallback. Canvas's Gradebook itself preloads visible
   * submission comments per assignment; this endpoint mirrors that data source
   * and is used to verify comment presence for the columns currently on screen. */
  CanvasApi.prototype.submissionsForAssignment = function (courseId, assignmentId, opts) {
    opts = opts || {};
    return this.getAll('/api/v1/courses/' + courseId + '/assignments/' + assignmentId + '/submissions', {
      'include[]': ['submission_comments']
    }, { maxPages: opts.maxPages || 30 });
  };

  CanvasApi.prototype.submission = function (courseId, assignmentId, userId) {
    return this.get('/api/v1/courses/' + courseId + '/assignments/' + assignmentId + '/submissions/' + userId,
      { 'include[]': ['submission_comments'] });
  };

  CanvasApi.prototype.updateSubmission = function (courseId, assignmentId, userId, form) {
    return this.request('/api/v1/courses/' + courseId + '/assignments/' + assignmentId + '/submissions/' + userId, {
      method: 'PUT',
      form: form,
      params: { 'include[]': ['submission_comments'] },
      retries: 1
    }).then(function (r) { return r.data; });
  };

  CanvasApi.prototype.addComment = function (courseId, assignmentId, userId, text) {
    return this.updateSubmission(courseId, assignmentId, userId, { 'comment[text_comment]': text });
  };

  /* ------------------------------------------------------- posting grades */

  /* Canvas's GraphQL endpoint, same session and same CSRF token as the REST
   * calls above. Only used for the one thing Canvas's REST API has no verb
   * for: posting (unhiding) an assignment's grades. GraphQL answers 200 with
   * an "errors" array rather than an HTTP error, so that is checked here
   * instead of being left to look like success. */
  CanvasApi.prototype.graphql = function (query, variables) {
    return this.request('/api/graphql', {
      method: 'POST',
      json: { query: query, variables: variables || {} },
      retries: 1
    }).then(function (r) {
      var data = r.data || {};
      if (data.errors && data.errors.length) {
        var first = data.errors[0] || {};
        throw new CanvasApiError('Canvas GraphQL: ' + (first.message || 'request rejected'), {
          graphql: true, message: first.message || null
        });
      }
      return data.data || null;
    });
  };

  var POST_GRADES_MUTATION =
    'mutation PostAssignmentGrades($assignmentId: ID!, $gradedOnly: Boolean) {' +
    '  postAssignmentGrades(input: {assignmentId: $assignmentId, gradedOnly: $gradedOnly}) {' +
    '    progress { _id state }' +
    '    errors { attribute message }' +
    '  }' +
    '}';

  /* Post every grade in one assignment column to the students.
   *
   * This is Canvas's own "Post grades" action, reached the same way Canvas's
   * own Gradebook reaches it. It returns a Progress job id: Canvas posts the
   * submissions in the background, so the caller has to wait for that job
   * before the new posted_at timestamps can be read back.
   *
   * gradedOnly (default true) is the same choice Canvas's own tray offers:
   * post the grades that exist, and leave ungraded submissions hidden rather
   * than showing students an empty grade they were not waiting for.
   */
  CanvasApi.prototype.postAssignmentGrades = function (assignmentId, opts) {
    opts = opts || {};
    return this.graphql(POST_GRADES_MUTATION, {
      assignmentId: String(assignmentId),
      gradedOnly: opts.gradedOnly === undefined ? true : !!opts.gradedOnly
    }).then(function (data) {
      var payload = (data && data.postAssignmentGrades) || {};
      if (payload.errors && payload.errors.length) {
        throw new CanvasApiError('Canvas refused to post these grades: ' +
          (payload.errors[0].message || 'unknown reason'), { message: payload.errors[0].message || null });
      }
      return payload.progress || null;
    });
  };

  CanvasApi.prototype.progress = function (progressId) {
    return this.get('/api/v1/progress/' + encodeURIComponent(String(progressId)));
  };

  /* Wait for a Canvas Progress job to finish.
   *
   * Polls on a gentle backoff and gives up rather than waiting forever; a job
   * we stopped watching is not a job that failed, so the caller treats a
   * timeout as "probably done, re-read the column and see" rather than as an
   * error shown to the teacher. */
  CanvasApi.prototype.waitForProgress = function (progressId, opts) {
    var self = this;
    opts = opts || {};
    var maxTries = opts.maxTries || 20;
    function attempt(n) {
      return self.progress(progressId).then(function (p) {
        var state = (p && p.workflow_state) || '';
        if (state === 'completed') return { done: true, progress: p };
        if (state === 'failed') {
          throw new CanvasApiError('Canvas could not finish posting these grades', {
            message: (p && p.message) || null
          });
        }
        if (n + 1 >= maxTries) return { done: false, progress: p };
        return util.sleep(Math.min(2000, 300 + n * 200)).then(function () { return attempt(n + 1); });
      });
    }
    return attempt(0);
  };

  /* The student roster for one course, names only.
   *
   * Used by the cross-course student search. Deliberately NOT cached to disk:
   * this is a list of real students' names, and the only things this extension
   * ever persists are settings, SpeedGrader drafts and the diagnostics
   * snapshot. Rosters live in memory for the life of the page and no longer. */
  CanvasApi.prototype.courseStudents = function (courseId) {
    return this.getAll('/api/v1/courses/' + courseId + '/users', {
      'enrollment_type[]': ['student'],
      'enrollment_state[]': ['active', 'invited']
    }, { maxPages: 6 });
  };

  CanvasApi.prototype.teachingCourses = function () {
    return this.getAll('/api/v1/courses', {
      enrollment_state: 'active',
      'include[]': ['term', 'favorites'],
      'state[]': ['available', 'completed']
    }, { maxPages: 6 }).then(function (list) {
      return (list || []).filter(function (c) {
        if (!c || c.access_restricted_by_date) return false;
        var roles = (c.enrollments || []).map(function (e) { return e.type; });
        return roles.some(function (r) { return r === 'teacher' || r === 'ta' || r === 'designer'; });
      });
    });
  };

  CGP.CanvasApi = CanvasApi;
  CGP.CanvasApiError = CanvasApiError;
  CGP.apiInternals = { parseBody: parseBody, nextLink: nextLink };
})();
