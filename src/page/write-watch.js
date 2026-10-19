/* Canvas Gradebook+ - page-world watcher for Canvas's own submission writes.
 *
 * Registered (manifest.json / background.js) as a MAIN-world document_start
 * script on the gradebook AND on SpeedGrader. Content scripts run in an
 * isolated world, so their own requests never pass through the wrappers
 * here; what does is everything Canvas's own code saves - the Grade Detail
 * Tray, the grid's own editor, SpeedGrader (classic and the newer platform
 * SpeedGrader), Canvas's own posting tray.
 *
 * A grade, status or comment saved that way goes into Canvas's own page but
 * never reaches the content script's model, which then kept its old record:
 * no comment bubble, no M badge, a status painted from before the change.
 * And on SpeedGrader nothing at all reached the gradebook open in another
 * tab. So each successful write is reported as {source:'cgp-native-write'}
 * with ids only - never bodies or responses - and the content script
 * re-reads that cell (gradebook) or tells the other tabs (SpeedGrader).
 *
 * It also keeps, per cell, whether such a write is still out and when the
 * latest one started (window.__cgpNativeWrites.state), so env-bridge.js never
 * hands Canvas's store a read that is older than Canvas's own save. */
(function () {
  'use strict';
  if (window.__cgpWriteWatchLoaded) return;
  window.__cgpWriteWatchLoaded = true;

  var PAGE_PATH = /\/courses\/\d+\/gradebook(?:\/speed_grader)?\/?$/;
  var SPEEDGRADER_PATH = /\/courses\/\d+\/gradebook\/speed_grader\/?$/;
  // The REST API, and the plain route classic SpeedGrader saves comments to.
  var SUBMISSION_URL = /^(?:\/api\/v1)?\/courses\/(\d+)\/assignments\/(\d+)\/submissions\/(\d+)(?:[\/?#]|$)/;
  // Anonymous grading names the student by anonymous id only.
  var ANONYMOUS_URL = /^(?:\/api\/v1)?\/courses\/(\d+)\/assignments\/(\d+)\/anonymous_submissions\/[^\/?#]+(?:[\/?#]|$)/;
  var LEGACY_UPDATE_URL = /\/courses\/(\d+)\/gradebook\/update_submission(?:[?#]|$)/;
  var COMMENT_URL = /\/submission_comments\/(\d+)(?:[\/?#]|$)/;
  var GRAPHQL_URL = /^\/api\/graphql(?:[?#]|$)/;
  // Mutations that can change what a grade cell shows. Anything else
  // (settings, read receipts that do not match, comment-bank items) is not
  // worth a re-read.
  var GRADING_WORDS = /grade|score|submission|comment|status|excuse|rubric|assess|post|hide|sticker|late|missing|extend/i;
  var MUTATING_NAME = /^(update|create|delete|post|hide|set|save|add|remove|submit|grade|excuse|mark|reassign)/i;

  function onWatchedPage() {
    try { return PAGE_PATH.test(String(window.location.pathname || '')); } catch (e) { return false; }
  }

  function post(message) {
    try { window.postMessage(message, window.location.origin); } catch (e) { /* never break the page */ }
  }

  function courseFromPath() {
    var m = /\/courses\/(\d+)/.exec(String(window.location.pathname || ''));
    return m ? m[1] : null;
  }

  /* The assignment and student SpeedGrader is showing: ?assignment_id= and
   * ?student_id=, or classic SpeedGrader's #{"student_id":"..."} hash. */
  function speedGraderIds() {
    var out = { assignmentId: null, userId: null };
    try {
      if (!SPEEDGRADER_PATH.test(String(window.location.pathname || ''))) return out;
      var q = new URLSearchParams(String(window.location.search || ''));
      if (/^\d+$/.test(q.get('assignment_id') || '')) out.assignmentId = q.get('assignment_id');
      if (/^\d+$/.test(q.get('student_id') || '')) out.userId = q.get('student_id');
      if (!out.userId) {
        var hash = decodeURIComponent(String(window.location.hash || '').replace(/^#/, ''));
        var m = /"student_id"\s*:\s*"?(\d+)"?/.exec(hash);
        if (m) out.userId = m[1];
      }
    } catch (e) { /* ids stay unknown */ }
    return out;
  }

  function bodyField(body, name) {
    try {
      if (!body) return null;
      if (typeof body === 'string') {
        if (/^\s*\{/.test(body)) {
          var json = JSON.parse(body);
          var path = name.replace(/\]/g, '').split('[');
          for (var i = 0; i < path.length && json; i++) json = json[path[i]];
          return json === undefined || json === null ? null : String(json);
        }
        var params = new URLSearchParams(body);
        return params.get(name);
      }
      if (typeof body.get === 'function') {
        var v = body.get(name);
        return v === null || v === undefined ? null : String(v);
      }
    } catch (e) { /* unreadable body: nothing to report */ }
    return null;
  }

  function bodyKeys(body) {
    var keys = [];
    try {
      if (typeof body === 'string' && !/^\s*[\{\[]/.test(body)) {
        new URLSearchParams(body).forEach(function (v, k) { keys.push(k); });
      } else if (body && typeof body.forEach === 'function' && typeof body.get === 'function') {
        body.forEach(function (v, k) { keys.push(k); });
      }
    } catch (e) { /* no keys */ }
    return keys;
  }

  // What a comment save carries besides the comment itself - classic
  // SpeedGrader sends its comment as submission[comment] alongside these.
  var COMMENT_COMPANIONS = /^submission\[(comment|draft_comment|group_comment|assignment_id|user_id|anonymous_id|attempt|media_comment_id|media_comment_type)\]$/;

  /* Does this write carry a comment and nothing else (no grade, no status)? */
  function commentOnly(body) {
    try {
      if (!body) return false;
      if (typeof body === 'string' && /^\s*\{/.test(body)) {
        var json = JSON.parse(body) || {};
        return !!json.comment && !json.submission;
      }
      var keys = bodyKeys(body);
      var comment = keys.some(function (k) { return /^comment\[/.test(k) || k === 'submission[comment]'; });
      return comment && keys.every(function (k) { return !/^submission\[/.test(k) || COMMENT_COMPANIONS.test(k); });
    } catch (e) { return false; }
  }

  /* A relay id ("QXNzaWdubWVudC0xMjM=" = "Assignment-123") or a plain one. */
  function legacyId(value, type) {
    if (value === null || value === undefined) return null;
    var s = String(value);
    if (/^\d+$/.test(s)) return s;
    try {
      var decoded = typeof atob === 'function' ? atob(s) : '';
      var m = new RegExp('^' + type + '-(\\d+)$').exec(decoded);
      if (m) return m[1];
    } catch (e) { /* not base64 */ }
    return null;
  }

  function findVar(vars, names, type) {
    if (!vars || typeof vars !== 'object') return null;
    for (var i = 0; i < names.length; i++) {
      var id = legacyId(vars[names[i]], type);
      if (id) return id;
    }
    // One level down: {input: {...}}.
    var keys = Object.keys(vars);
    for (var j = 0; j < keys.length; j++) {
      var v = vars[keys[j]];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (var n = 0; n < names.length; n++) {
          var inner = legacyId(v[names[n]], type);
          if (inner) return inner;
        }
      }
    }
    return null;
  }

  /* A GraphQL mutation that can change a grade cell: the platform
   * SpeedGrader saves this way, and so does Canvas's own posting tray. The
   * ids come from the mutation's variables where it names them, and from
   * SpeedGrader's own URL where it does not. */
  function graphqlTarget(body) {
    if (typeof body !== 'string') return null;
    var json;
    try { json = JSON.parse(body); } catch (e) { return null; }
    var ops = Array.isArray(json) ? json : [json];
    var target = null;
    ops.forEach(function (op) {
      if (target || !op || typeof op !== 'object') return;
      var query = String(op.query || '');
      var name = String(op.operationName || '');
      var mutation = /^\s*mutation\b/.test(query.replace(/^\s*#[^\n]*\n/g, '')) || (!query && MUTATING_NAME.test(name));
      if (!mutation || !GRADING_WORDS.test(name + ' ' + query.slice(0, 400))) return;
      var vars = op.variables || {};
      var sg = speedGraderIds();
      var aid = findVar(vars, ['assignmentId', 'assignment_id', 'assignmentLid'], 'Assignment') || sg.assignmentId;
      if (!aid) return;
      var uid = findVar(vars, ['userId', 'user_id', 'studentId', 'student_id', 'userLid'], 'User') || sg.userId;
      target = { courseId: courseFromPath(), assignmentId: aid, graphql: true };
      if (uid) target.userId = uid;
    });
    return target && target.courseId ? target : null;
  }

  function writeTarget(method, url, body) {
    method = String(method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
    var href;
    try {
      var u = new URL(String(url), window.location.href);
      if (u.origin !== window.location.origin) return null;
      href = u.pathname + u.search;
    } catch (e) { return null; }
    var m = SUBMISSION_URL.exec(href);
    if (m) {
      var target = { courseId: m[1], assignmentId: m[2], userId: m[3] };
      if (commentOnly(body)) target.commentOnly = true;
      return target;
    }
    m = ANONYMOUS_URL.exec(href);
    if (m) {
      var anon = speedGraderIds();
      var who = anon.assignmentId === m[2] ? anon.userId : null;
      var anonTarget = { courseId: m[1], assignmentId: m[2] };
      if (who) anonTarget.userId = who;
      if (commentOnly(body)) anonTarget.commentOnly = true;
      return anonTarget;
    }
    m = LEGACY_UPDATE_URL.exec(href);
    if (m) {
      var aid = bodyField(body, 'submission[assignment_id]');
      var uid = bodyField(body, 'submission[user_id]');
      if (aid && uid && /^\d+$/.test(aid) && /^\d+$/.test(uid)) return { courseId: m[1], assignmentId: aid, userId: uid };
      // Anonymous SpeedGrader names the student by anonymous id only.
      var sg = speedGraderIds();
      if (aid && /^\d+$/.test(aid) && sg.userId && sg.assignmentId === aid) {
        return { courseId: m[1], assignmentId: aid, userId: sg.userId };
      }
      // Canvas's bulk dialogs (Set Default Grade, Curve Grades) send many.
      var bulk = null;
      bodyKeys(body).forEach(function (k) {
        if (bulk || !/^submissions\[[^\]]*\]\[assignment_id\]$/.test(k)) return;
        var id = bodyField(body, k);
        if (id && /^\d+$/.test(id)) bulk = id;
      });
      if (bulk || (aid && /^\d+$/.test(aid))) return { courseId: m[1], assignmentId: bulk || aid, bulk: true };
      return null;
    }
    m = COMMENT_URL.exec(href);
    if (m) return { commentId: m[1] };
    if (GRAPHQL_URL.test(href)) return graphqlTarget(body);
    return null;
  }

  /* ------------------------------------------------------- in-flight record */

  var cells = Object.create(null);   // "assignmentId:userId" -> {pending, lastStartedAt}

  function cellKey(target) {
    return target && target.assignmentId && target.userId ? target.assignmentId + ':' + target.userId : null;
  }

  function started(target) {
    var k = cellKey(target);
    if (!k) return;
    var st = cells[k] || (cells[k] = { pending: 0, lastStartedAt: 0 });
    st.pending++;
    st.lastStartedAt = Date.now();
  }

  function settled(target) {
    var k = cellKey(target);
    if (!k || !cells[k]) return;
    cells[k].pending = Math.max(0, cells[k].pending - 1);
  }

  try {
    Object.defineProperty(window, '__cgpNativeWrites', {
      configurable: true,
      value: {
        state: function (assignmentId, userId) {
          var st = cells[String(assignmentId) + ':' + String(userId)];
          return st ? { pending: st.pending, lastStartedAt: st.lastStartedAt } : null;
        }
      }
    });
  } catch (e) { /* the bridge just goes without */ }

  function report(target) {
    var message = { source: 'cgp-native-write' };
    Object.keys(target).forEach(function (k) {
      if (target[k] !== null && target[k] !== undefined) message[k] = target[k];
    });
    post(message);
  }

  function watch() {
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype && !XHR.prototype.__cgpWatched) {
      var origOpen = XHR.prototype.open;
      var origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try { this.__cgpReq = { method: method, url: url }; } catch (e) { /* ignore */ }
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function (body) {
        try {
          var req = this.__cgpReq;
          // Kept on the request, not captured per send: a reused XHR must
          // report only the write it is finishing now, never an earlier one.
          this.__cgpTarget = (req && writeTarget(req.method, req.url, body)) || null;
          if (this.__cgpTarget) started(this.__cgpTarget);
          if (this.__cgpTarget && !this.__cgpListening) {
            this.__cgpListening = true;
            this.addEventListener('loadend', function () {
              var target = this.__cgpTarget;
              this.__cgpTarget = null;
              if (!target) return;
              settled(target);
              if (this.status >= 200 && this.status < 300) report(target);
            });
          }
        } catch (e) { /* never break Canvas's request */ }
        return origSend.apply(this, arguments);
      };
      XHR.prototype.__cgpWatched = true;
    }
    var origFetch = window.fetch;
    if (typeof origFetch === 'function' && !origFetch.__cgpWatched) {
      var wrapped = function (input, init) {
        var target = null;
        try {
          var isRequest = input && typeof input === 'object' && typeof input.url === 'string';
          var method = (init && init.method) || (isRequest ? input.method : 'GET');
          target = writeTarget(method, isRequest ? input.url : input, init && init.body);
          if (target) started(target);
        } catch (e) { target = null; }
        var promise = origFetch.apply(this, arguments);
        if (target) {
          try {
            promise.then(function (res) {
              settled(target);
              if (res && res.ok) report(target);
            }, function () { settled(target); });
          } catch (e) { /* never break Canvas's request */ }
        }
        return promise;
      };
      wrapped.__cgpWatched = true;
      window.fetch = wrapped;
    }
  }

  if (onWatchedPage()) {
    try { watch(); } catch (e) { /* never break the page */ }
  }
})();
