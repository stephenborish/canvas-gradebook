/* Canvas Gradebook+ - who in the class has watched a Studio video.
 *
 * Studio's Insights tab lists only the people who pressed play. This joins
 * that list with the course's full Canvas roster, so the teacher sees every
 * student alphabetically - watched, partly watched or not watched at all -
 * and what share of the video each one saw.
 *
 * Pure functions over what Studio's own page loads:
 *   /api/media_management/perspectives/<uuid>/insights/users
 *     -> { insights: [{ id, display_name, email, role_names, completion_rate }] }
 *   /api/media_management/perspectives/<uuid>/insights/overview?role=Student
 *   /api/media_management/media/<id>/perspectives
 * and the Canvas roster ({id, name, sortable_name, email}). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.studioClass) return;

  // At or above this share of the video counts as watched. Studio's own
  // completion reaches 1.0 only for every second played, which a student
  // who skipped the last few seconds of credits never gets.
  var WATCHED_AT = 0.9;

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function normName(s) {
    return String(s || '').toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* "Thomas (Tommy) Tegler" -> "thomas tegler"; "Tegler, Thomas" -> "thomas tegler" */
  function plainName(s) {
    var t = String(s || '').replace(/\([^)]*\)/g, ' ');
    var m = /^([^,]+),\s*(.+)$/.exec(t);
    if (m) t = m[2] + ' ' + m[1];
    return normName(t);
  }

  function isTeacher(roles) {
    return (roles || []).some(function (r) { return /teacher|instructor|ta\b|admin|designer/i.test(String(r)); });
  }

  /* The viewers in one insights/users answer. */
  function viewersFrom(data) {
    var list = Array.isArray(data) ? data : (data && (data.insights || data.users || data.viewers)) || [];
    if (!Array.isArray(list)) return [];
    return list.filter(Boolean).map(function (v) {
      var roles = Array.isArray(v.role_names) ? v.role_names : v.role ? [v.role] : Array.isArray(v.roles) ? v.roles : [];
      var c = num(v.completion_rate !== undefined ? v.completion_rate : v.completion);
      if (c !== null && c > 1.0001) c = c / 100;      // a percent, should Studio ever send one
      return {
        id: v.id === undefined || v.id === null ? null : String(v.id),
        name: String(v.display_name || v.full_name || v.name || ''),
        email: String(v.email || '').trim().toLowerCase(),
        roles: roles.map(String),
        teacher: isTeacher(roles),
        completion: c === null ? null : Math.max(0, Math.min(1, c))
      };
    });
  }

  function statusOf(completion) {
    if (completion === null || completion === undefined || completion <= 0) return 'none';
    return completion >= WATCHED_AT ? 'watched' : 'partial';
  }

  /* Every roster student, alphabetically by last name, with what Studio
   * says they watched. Viewers Studio lists as students but the roster
   * doesn't have (dropped, another section's embed) come back apart. */
  function classList(roster, viewers) {
    var students = (viewers || []).filter(function (v) { return !v.teacher; });
    var byEmail = Object.create(null), byName = Object.create(null), byPlain = Object.create(null);
    students.forEach(function (v) {
      if (v.email) byEmail[v.email] = byEmail[v.email] || v;
      var n = normName(v.name), p = plainName(v.name);
      if (n) byName[n] = byName[n] === undefined ? v : false;
      if (p) byPlain[p] = byPlain[p] === undefined ? v : false;
    });
    var used = new Set();
    var rows = (roster || []).filter(Boolean).map(function (s) {
      var email = String(s.email || s.login_id || '').trim().toLowerCase();
      var v = (email && byEmail[email]) || byName[normName(s.name)] || byPlain[plainName(s.name)] ||
        byPlain[plainName(s.sortable_name || s.sortableName)] || null;
      if (v && used.has(v)) v = null;
      if (v) used.add(v);
      var completion = v ? v.completion : null;
      return {
        id: s.id === undefined ? null : String(s.id),
        name: String(s.name || s.short_name || ''),
        sortableName: String(s.sortable_name || s.sortableName || s.name || ''),
        email: email,
        viewer: v,
        completion: v ? (completion === null ? 0 : completion) : null,
        status: statusOf(completion)
      };
    });
    rows.sort(function (a, b) {
      return a.sortableName.localeCompare(b.sortableName, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name);
    });
    var extra = students.filter(function (v) { return !used.has(v); })
      .sort(function (a, b) { return plainName(a.name).localeCompare(plainName(b.name)); });
    var counts = { total: rows.length, watched: 0, partial: 0, none: 0 };
    var sum = 0;
    rows.forEach(function (r) { counts[r.status]++; sum += r.completion || 0; });
    return {
      rows: rows,
      extra: extra,
      counts: counts,
      averageCompletion: rows.length ? sum / rows.length : null
    };
  }

  /* Studio viewers alone, alphabetically - for when the roster can't be read. */
  function viewersOnly(viewers) {
    var rows = (viewers || []).filter(function (v) { return !v.teacher; }).map(function (v) {
      var parts = plainName(v.name).split(' ');
      return {
        id: v.id, name: v.name, sortableName: parts.length > 1 ? parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ') : v.name,
        email: v.email, viewer: v, completion: v.completion === null ? 0 : v.completion, status: statusOf(v.completion)
      };
    }).sort(function (a, b) { return a.sortableName.localeCompare(b.sortableName); });
    var counts = { total: rows.length, watched: 0, partial: 0, none: 0 };
    rows.forEach(function (r) { counts[r.status]++; });
    return { rows: rows, extra: [], counts: counts, averageCompletion: null, viewersOnly: true };
  }

  /* The embeds (perspectives) of one video: [{uuid, name}], in whatever
   * shape Studio answers - a bare list, or one under a key. */
  function perspectivesFrom(data) {
    var list = Array.isArray(data) ? data : null;
    if (!list && data && typeof data === 'object') {
      Object.keys(data).some(function (k) { if (Array.isArray(data[k])) { list = data[k]; return true; } return false; });
    }
    return (list || []).filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
      var course = p.course || p.collection || p.context || {};
      return {
        uuid: String(p.uuid || p.id || ''),
        name: String(p.course_name || course.name || course.title || p.name || p.title || ''),
        courseId: num(course.course_id) || num(p.course_id) || num(course.canvas_course_id) || null
      };
    }).filter(function (p) { return p.uuid; });
  }

  /* Views, time viewed, unique viewers and the "which parts" timeline
   * from insights/overview - read loosely, since only the users answer
   * has been seen first-hand. timeline: [{at: 0..1, value}] or null. */
  function overviewFrom(data) {
    if (!data || typeof data !== 'object') return null;
    var root = data.insights && typeof data.insights === 'object' && !Array.isArray(data.insights) ? data.insights : data.overview || data;
    function pick(re) {
      var out = null;
      Object.keys(root).some(function (k) {
        if (re.test(k) && !Array.isArray(root[k]) && typeof root[k] !== 'object' && num(root[k]) !== null) { out = num(root[k]); return true; }
        return false;
      });
      return out;
    }
    var timeline = null;
    function series(arr) {
      if (!Array.isArray(arr) || arr.length < 3) return null;
      if (arr.every(function (x) { return num(x) !== null; })) {
        return arr.map(function (x, i) { return { at: arr.length > 1 ? i / (arr.length - 1) : 0, value: num(x) }; });
      }
      if (arr.every(function (x) { return x && typeof x === 'object'; })) {
        var keys = Object.keys(arr[0]);
        var vk = keys.filter(function (k) { return /count|value|viewers|views|y$|total/i.test(k) && num(arr[0][k]) !== null; })[0];
        var tk = keys.filter(function (k) { return /time|second|offset|position|start|x$|at$/i.test(k) && num(arr[0][k]) !== null; })[0];
        if (!vk) return null;
        var last = tk ? num(arr[arr.length - 1][tk]) || 1 : arr.length - 1 || 1;
        return arr.map(function (x, i) { return { at: tk ? (num(x[tk]) || 0) / last : i / last, value: num(x[vk]) || 0 }; });
      }
      return null;
    }
    Object.keys(root).some(function (k) {
      if (!Array.isArray(root[k])) return false;
      if (!/unique|viewer|timeline|time_based|segments|chart|data/i.test(k) && timeline) return false;
      var s = series(root[k]);
      if (s) { timeline = s; return /unique/i.test(k); }
      return false;
    });
    var views = pick(/^(views|plays|video_views|number_of_plays|total_views)$/i);
    if (views === null) views = pick(/views|plays/i);
    return {
      views: views,
      secondsViewed: pick(/time_viewed|seconds_viewed|watch_time|time/i),
      uniqueViewers: pick(/unique/i),
      timeline: timeline
    };
  }

  /* Plain text for pasting: one name per line, "First Last". */
  function namesText(rows) {
    return rows.map(function (r) { return r.name; }).join('\n');
  }

  CGP.studioClass = {
    WATCHED_AT: WATCHED_AT,
    viewersFrom: viewersFrom,
    perspectivesFrom: perspectivesFrom,
    overviewFrom: overviewFrom,
    classList: classList,
    viewersOnly: viewersOnly,
    statusOf: statusOf,
    namesText: namesText,
    plainName: plainName,
    normName: normName
  };
})();
