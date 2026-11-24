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
      var cu = v.canvas_user_id !== undefined && v.canvas_user_id !== null ? v.canvas_user_id
        : (v.canvas_id !== undefined && v.canvas_id !== null ? v.canvas_id : null);
      return {
        id: v.id === undefined || v.id === null ? null : String(v.id),
        // The Canvas user id, when Studio gives one: as strong as an email.
        canvasUserId: cu === null ? null : String(cu),
        name: String(v.display_name || v.full_name || v.name || ''),
        email: String(v.email || '').trim().toLowerCase(),
        roles: roles.map(String),
        teacher: isTeacher(roles),
        completion: c === null ? null : Math.max(0, Math.min(1, c))
      };
    });
  }

  /* A share of the video -> 'watched' | 'partial' | 'none'; a share
   * Studio didn't give -> 'unknown' (never "not watched"). */
  function statusOf(completion) {
    if (completion === null || completion === undefined || !isFinite(completion)) return 'unknown';
    if (completion <= 0) return 'none';
    return completion >= WATCHED_AT ? 'watched' : 'partial';
  }

  /* What a row's status says, word for word, wherever it is shown. */
  var LABELS = {
    watched: 'Watched', partial: 'Partly watched', none: 'Not watched',
    completion: 'Completion unavailable', ambiguous: 'Match unclear', error: 'Unavailable',
    noaccess: 'No access in Studio', notfound: 'Not found in Studio'
  };

  /* Why Studio didn't give a video's viewers, from its answer's status:
   * 401/403 - the embed belongs to another Studio course or someone else's
   * library, and Studio shares insights only with that course or owner;
   * 404 - the embed no longer exists in Studio; anything else - unknown. */
  function errorReason(status) {
    status = Number(status) || 0;
    if (status === 401 || status === 403) return 'noaccess';
    if (status === 404 || status === 410) return 'notfound';
    return 'error';
  }
  function labelOf(row) {
    if (!row) return '';
    if (row.status === 'unknown') return LABELS[row.unknownReason] || LABELS.error;
    return LABELS[row.status] || '';
  }

  function rosterEmails(s) {
    var out = [];
    [s.email, s.login_id, s.loginId].forEach(function (e) {
      e = String(e || '').trim().toLowerCase();
      if (e && e.indexOf('@') > 0 && out.indexOf(e) < 0) out.push(e);
    });
    return out;
  }

  function nameKeys(names) {
    var out = [];
    names.forEach(function (n) {
      [normName(n), plainName(n)].forEach(function (k) { if (k && out.indexOf(k) < 0) out.push(k); });
    });
    return out;
  }

  /* Who on the roster is which Studio viewer.
   *   1. An exact email (or the Canvas user id) settles it, across the
   *      whole roster first - before any name is looked at.
   *   2. Only then a name, and only when it names exactly one remaining
   *      student and exactly one remaining viewer, and their emails don't
   *      disagree (a viewer with another email is someone else).
   * A name shared by two remaining students or two remaining viewers is
   * "Match unclear": nobody gets that viewing, and nobody is called "not
   * watched" because of it.
   * -> {match: Map(rosterIndex -> {viewer, how}), unclear: Set(rosterIndex),
   *     unclearViewers: [viewer], used: Set(viewer)} */
  function matchViewers(roster, students) {
    var match = new Map(), used = new Set(), unclear = new Set(), unclearViewers = [];
    var info = roster.map(function (s) {
      return {
        id: s.id === undefined || s.id === null ? null : String(s.id),
        emails: rosterEmails(s),
        keys: nameKeys([s.name, s.short_name, s.sortable_name || s.sortableName])
      };
    });
    // 1. Strong identifiers.
    students.forEach(function (v) {
      var hits = [];
      info.forEach(function (r, i) {
        if ((v.email && r.emails.indexOf(v.email) >= 0) || (v.canvasUserId && r.id === v.canvasUserId)) hits.push(i);
      });
      if (hits.length !== 1) {
        if (hits.length > 1) { hits.forEach(function (i) { unclear.add(i); }); used.add(v); unclearViewers.push(v); }
        return;
      }
      var i = hits[0];
      var have = match.get(i);
      used.add(v);
      // Studio listing one person twice: the most of it they watched.
      if (have) {
        if (v.completion !== null && (have.viewer.completion === null || v.completion > have.viewer.completion)) have.viewer = v;
        return;
      }
      match.set(i, { viewer: v, how: v.email && info[i].emails.indexOf(v.email) >= 0 ? 'email' : 'id' });
    });
    // 2. Names, between whoever is left on both sides.
    var restV = students.filter(function (v) { return !used.has(v); });
    var vKeys = restV.map(function (v) { return nameKeys([v.name]); });
    var openRows = info.map(function (r, i) { return i; }).filter(function (i) { return !match.has(i) && !unclear.has(i); });
    var shared = function (a, b) { return a.some(function (k) { return b.indexOf(k) >= 0; }); };
    var conflicts = function (r, v) { return !!(v.email && r.emails.length && r.emails.indexOf(v.email) < 0); };
    var plan = [];
    openRows.forEach(function (i) {
      var r = info[i];
      var cands = restV.filter(function (v, j) { return shared(r.keys, vKeys[j]) && !conflicts(r, v); });
      if (!cands.length) return;
      var v = cands[0];
      var vk = vKeys[restV.indexOf(v)];
      var rivals = openRows.filter(function (k) { return shared(info[k].keys, vk) && !conflicts(info[k], v); });
      if (cands.length === 1 && rivals.length === 1) plan.push([i, v]);
      else { unclear.add(i); cands.forEach(function (c) { if (unclearViewers.indexOf(c) < 0) unclearViewers.push(c); }); }
    });
    plan.forEach(function (p) {
      if (unclear.has(p[0]) || used.has(p[1])) return;
      match.set(p[0], { viewer: p[1], how: 'name' });
      used.add(p[1]);
    });
    unclearViewers.forEach(function (v) { used.add(v); });
    return { match: match, unclear: unclear, unclearViewers: unclearViewers, used: used };
  }

  function rowFor(s, m, isUnclear) {
    var v = m ? m.viewer : null;
    var row = {
      id: s.id === undefined || s.id === null ? null : String(s.id),
      name: String(s.name || s.short_name || ''),
      sortableName: String(s.sortable_name || s.sortableName || s.name || ''),
      email: String(s.email || s.login_id || '').trim().toLowerCase(),
      viewer: v,
      matchedBy: m ? m.how : null,
      completion: null,
      status: 'none',
      unknownReason: null
    };
    if (isUnclear) { row.status = 'unknown'; row.unknownReason = 'ambiguous'; }
    else if (v) {
      row.completion = v.completion;
      row.status = statusOf(v.completion);
      if (row.status === 'unknown') row.unknownReason = 'completion';
    }
    // Not among Studio's viewers at all: Studio lists everyone who pressed
    // play, so that is "not watched" (no share, rather than a measured 0%).
    row.label = labelOf(row);
    return row;
  }

  /* counts by status, and the class average over the students whose share
   * is known (a student who never pressed play counts as 0; an unknown
   * share counts as nothing at all). */
  function tally(rows) {
    var counts = { total: rows.length, watched: 0, partial: 0, none: 0, unknown: 0 };
    var sum = 0, n = 0;
    rows.forEach(function (r) {
      counts[r.status]++;
      if (r.status === 'unknown') return;
      sum += r.completion || 0;
      n++;
    });
    return { counts: counts, averageCompletion: n ? sum / n : null, averageOf: n };
  }

  /* Every roster student, alphabetically by last name, with what Studio
   * says they watched. Viewers Studio lists as students but the roster
   * doesn't have (dropped, another section's embed) come back apart; ones
   * whose name fits two students come back as `unclear`. */
  function classList(roster, viewers) {
    var students = (viewers || []).filter(function (v) { return v && !v.teacher; });
    var list = (roster || []).filter(Boolean);
    var m = matchViewers(list, students);
    // An exact email or id match settles a row, even when another viewer's
    // identifiers also pointed at it (that viewer is the unclear one).
    var rows = list.map(function (s, i) { return rowFor(s, m.match.get(i), m.unclear.has(i) && !m.match.has(i)); });
    rows.sort(function (a, b) {
      return a.sortableName.localeCompare(b.sortableName, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name);
    });
    var extra = students.filter(function (v) { return !m.used.has(v); })
      .sort(function (a, b) { return plainName(a.name).localeCompare(plainName(b.name)); });
    var t = tally(rows);
    return {
      rows: rows,
      extra: extra,
      unclear: m.unclearViewers.slice(),
      counts: t.counts,
      averageCompletion: t.averageCompletion,
      averageOf: t.averageOf
    };
  }

  /* Studio viewers alone, alphabetically - for when the roster can't be read. */
  function viewersOnly(viewers) {
    var rows = (viewers || []).filter(function (v) { return v && !v.teacher; }).map(function (v) {
      var parts = plainName(v.name).split(' ');
      var status = statusOf(v.completion);
      var row = {
        id: v.id, name: v.name, sortableName: parts.length > 1 ? parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ') : v.name,
        email: v.email, viewer: v, matchedBy: null, completion: v.completion, status: status,
        unknownReason: status === 'unknown' ? 'completion' : null
      };
      row.label = labelOf(row);
      return row;
    }).sort(function (a, b) { return a.sortableName.localeCompare(b.sortableName); });
    var t = tally(rows);
    return { rows: rows, extra: [], unclear: [], counts: t.counts, averageCompletion: null, averageOf: 0, viewersOnly: true };
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
      uniqueViewers: pick(/unique/i),
      timeline: timeline
    };
  }

  /* A Studio course's videos (tiles), from collections/<id>/tiles. */
  function videosFromTiles(data) {
    var tiles = (data && Array.isArray(data.tiles)) ? data.tiles : [];
    return tiles.filter(function (t) { return t && t.item_type === 'perspective' && t.data && t.data.id; }).map(function (t) {
      var d = t.data, m = d.media || {};
      return {
        uuid: String(d.id),
        mediaId: num(m.id) || num(d.media_id),
        title: String(d.title || m.title || 'Untitled video'),
        duration: num(m.duration),
        thumbnail: m.thumbnail_url || null,
        createdAt: d.created_at || m.created_at || null,
        archived: !!(d.archived_at || m.archived_at)
      };
    });
  }

  /* The Studio course (collection) for a Canvas course, by name. names: one
   * name or several to try in order (the course's real name first: Studio
   * names its course after it, while Canvas's API gives the teacher's own
   * nickname for the course as `name` when one is set). */
  function findCollection(collections, names) {
    var tries = (Array.isArray(names) ? names : [names]).map(normName).filter(Boolean);
    for (var i = 0; i < tries.length; i++) {
      var n = tries[i];
      var list = (collections || []).filter(function (c) { return c && normName(c.name) === n; });
      var hit = list.filter(function (c) { return c.type === 'course_wide'; })[0] || list[0];
      if (hit) return hit;
    }
    return null;
  }

  /* One student's line for each of a course's videos, newest first:
   * videos [{uuid, title, duration, createdAt, viewers, places}] (viewers
   * from viewersFrom), student {name, sortable_name, email}.
   * opts.classEmails: the class's emails; when given, "in class" counts
   * only those viewers (an embed copied from another class is watched by
   * that class too). opts.roster: the whole class ({id, name, sortable_name,
   * email}); the student is matched against all of it, so a name another
   * student shares is "Match unclear" rather than taken. */
  function studentVideos(videos, student, opts) {
    var classEmails = opts && opts.classEmails;
    var roster = opts && opts.roster && opts.roster.length ? opts.roster.slice() : [];
    var sid = student && student.id !== undefined && student.id !== null ? String(student.id) : null;
    var at = roster.map(function (s) { return s && s.id !== undefined && s.id !== null ? String(s.id) : null; }).indexOf(sid);
    if (sid === null || at < 0) roster.push(student);
    else roster[at] = Object.assign({}, roster[at], student, { email: student.email || roster[at].email });
    var inClass = classEmails && Object.keys(classEmails).length ? function (x) { return !!(x.email && classEmails[x.email]); } : function () { return true; };
    var submitted = (opts && opts.studentEmbeds) || {};
    var rows = (videos || []).filter(function (v) { return v && !v.archived; }).map(function (v) {
      var base = { uuid: v.uuid, title: v.title, duration: v.duration, thumbnail: v.thumbnail, createdAt: v.createdAt,
        places: v.places || [], embeddedOnly: !!v.embeddedOnly };
      Object.assign(base, originOf(v, submitted));
      // Studio didn't give this video's viewers: unknown, not "not watched".
      if (v.error) {
        var why = errorReason(v.errorStatus);
        return Object.assign(base, { completion: null, status: 'unknown', unknownReason: why, label: LABELS[why],
          watchedSeconds: null, classWatched: null, errorStatus: v.errorStatus || null });
      }
      var L = classList(roster, v.viewers || []);
      var r = L.rows.filter(function (x) { return sid !== null && x.id === sid; })[0] ||
        L.rows.filter(function (x) { return x.name === String(student.name || ''); })[0] || null;
      return Object.assign(base, {
        completion: r ? r.completion : null,
        status: r ? r.status : 'unknown',
        unknownReason: r ? r.unknownReason : 'ambiguous',
        label: r ? r.label : LABELS.ambiguous,
        matchedBy: r ? r.matchedBy : null,
        watchedSeconds: r && r.completion !== null && r.completion !== undefined && v.duration ? r.completion * v.duration : null,
        classWatched: (v.viewers || []).filter(function (x) {
          var st = statusOf(x.completion);
          return !x.teacher && inClass(x) && (st === 'watched' || st === 'partial');
        }).length
      });
    });
    rows.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    var counts = { total: rows.length, watched: 0, partial: 0, none: 0, unknown: 0 };
    var posted = { total: 0, watched: 0, partial: 0, none: 0, unknown: 0 };
    rows.forEach(function (r) {
      counts[r.status]++;
      if (r.origin === 'posted') { posted.total++; posted[r.status]++; }
    });
    return { rows: rows, counts: counts, postedCounts: posted };
  }

  /* Studio's own default title for a recording made in the browser
   * ("[Untitled Thu Nov 19 2026 16:42:28 GMT-0500 (Eastern Standard Time)]"):
   * a quick capture - in a class's list, nearly always a student's. */
  function isCaptureTitle(title) {
    return /^\s*\[?\s*untitled\b.*\b\d{4}\b.*\bgmt\s*[+-]\d{4}/i.test(String(title || ''));
  }

  /* Where a video comes from, for a teacher's list:
   *   'posted'  - embedded in an assignment, quiz, discussion, page or module;
   *   'student' - not posted, and either a student embedded it in their own
   *               work (a submission or discussion reply: Studio copies media
   *               a student embeds into the course's list) or it carries
   *               Studio's default "[Untitled <date>]" recording title;
   *   'unposted' - in Studio's list for the course, but nowhere in Canvas.
   * submitted: {embedUuid: {userId, kind}} (studentEmbeds). */
  function originOf(v, submitted) {
    if (v.places && v.places.length) return { origin: 'posted' };
    var ids = [v.uuid].concat(v.aliases || []);
    for (var i = 0; i < ids.length; i++) {
      var hit = submitted[ids[i]];
      if (hit) return { origin: 'student', submittedBy: hit.userId || null, submittedIn: hit.kind || null };
    }
    if (isCaptureTitle(v.title)) return { origin: 'student', submittedBy: null, submittedIn: null };
    return { origin: 'unposted' };
  }

  /* The Studio videos students put in their own work:
   * submissions [{user_id, url, body, submission_type}] (a Studio
   * submission's launch address, or embeds in a text entry) and discussion
   * entries [{user_id, message}] (replies). -> {embedUuid: {userId, kind}},
   * the first student found for each. */
  function studentEmbeds(submissions, entries) {
    var out = Object.create(null);
    function add(uuid, userId, kind) {
      if (!uuid || out[uuid]) return;
      out[uuid] = { userId: userId === undefined || userId === null ? null : String(userId), kind: kind };
    }
    (submissions || []).forEach(function (s) {
      if (!s) return;
      add(embedIdFromUrl(s.url || ''), s.user_id, 'Submission');
      embedsFromHtml(s.body || '').forEach(function (e) { add(e.uuid, s.user_id, 'Submission'); });
    });
    (entries || []).forEach(function (e) {
      if (!e) return;
      embedsFromHtml(e.message || '').forEach(function (x) { add(x.uuid, e.user_id, 'Discussion reply'); });
    });
    return out;
  }

  /* ------------------------------------- Studio videos inside Canvas */

  function decodeEntities(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|#39|lt|gt);/gi, function (m, e) {
      var k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'quot') return '"';
      if (k === 'apos' || k === '#39') return "'";
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return isFinite(n) ? String.fromCharCode(n) : m;
    });
  }

  /* The Studio embed (perspective) id in one link or frame address, or
   * null. Canvas wraps Studio's launch in its own external_tools address,
   * URL-encoded once or twice:
   *   /courses/1/external_tools/retrieve?display=borderless&url=https%3A%2F%2F
   *     x.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3D<id>...
   * and a share link is https://x.instructuremedia.com/embed/<id>. */
  function embedIdFromUrl(url) {
    var u = decodeEntities(url);
    for (var i = 0; i < 4; i++) {
      var m = /custom_arc_media_id=([A-Za-z0-9_-]{6,})/.exec(u) ||
        /instructuremedia\.com\/(?:embed|media|lti\/launch\/embed)\/([A-Za-z0-9_-]{6,})/.exec(u);
      if (m) return m[1];
      var next;
      try { next = decodeURIComponent(u); } catch (e) { return null; }
      if (next === u) return null;
      u = next;
    }
    return null;
  }

  function attr(tag, name) {
    var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    return m ? decodeEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : '';
  }

  /* The Studio videos embedded in a piece of Canvas HTML (an assignment's
   * description, a page's body, a discussion's message): [{uuid, title}],
   * each video once. */
  function embedsFromHtml(html) {
    var out = [], seen = Object.create(null);
    var re = /<(iframe|a|embed|object)\b[^>]*>/gi, m;
    var text = String(html || '');
    while ((m = re.exec(text))) {
      var tag = m[0];
      var id = embedIdFromUrl(attr(tag, 'src')) || embedIdFromUrl(attr(tag, 'href')) || embedIdFromUrl(attr(tag, 'data-src')) ||
        embedIdFromUrl(attr(tag, 'data'));
      if (!id || seen[id]) continue;
      seen[id] = true;
      var title = (attr(tag, 'title') || attr(tag, 'aria-label') || '').replace(/^\s*(video player for|embedded video:?)\s*/i, '').trim();
      out.push({ uuid: id, title: title });
    }
    return out;
  }

  /* Joins the course's Studio videos with where each one is embedded in
   * Canvas. embeds: [{uuid, title, place: {kind, name, url, modules}}].
   * Returns {videos, missing}: the videos with `places` added, and the
   * embedded ones Studio's course list doesn't have (copied from another
   * class, or added from someone else's library) as [{uuid, title, places}]. */
  function joinEmbeds(videos, embeds) {
    var byId = Object.create(null);
    var list = (videos || []).map(function (v) {
      var c = Object.assign({}, v, { places: (v.places || []).slice() });
      byId[c.uuid] = c;
      // Embeds folded into this video (foldEmbeds) are placed on it too.
      (c.aliases || []).forEach(function (a) { if (!byId[a]) byId[a] = c; });
      return c;
    });
    var missing = [], missingById = Object.create(null);
    (embeds || []).forEach(function (e) {
      if (!e || !e.uuid) return;
      var target = byId[e.uuid] || missingById[e.uuid];
      if (!target) {
        target = missingById[e.uuid] = { uuid: e.uuid, title: e.title || '', places: [] };
        missing.push(target);
      }
      if (!target.title && e.title) target.title = e.title;
      if (!e.place) return;
      // One entry per place: the same kind, name and address. Two module
      // items with the same title in different modules are two places; the
      // same place reached twice keeps every module it sits in.
      var same = target.places.filter(function (p) {
        return p.kind === e.place.kind && p.name === e.place.name && (p.url || '') === (e.place.url || '');
      })[0];
      if (!same) { target.places.push(Object.assign({}, e.place, { modules: (e.place.modules || []).slice() })); return; }
      if (e.place.order !== undefined && (same.order === undefined || e.place.order < same.order)) same.order = e.place.order;
      (e.place.modules || []).forEach(function (m) {
        same.modules = same.modules || [];
        if (same.modules.indexOf(m) < 0) same.modules.push(m);
      });
    });
    return { videos: list, missing: missing };
  }

  /* Two viewer lists of the same video as one: each person once, with the
   * most of it they watched in either. */
  function mergeViewers(a, b) {
    var out = [], at = Object.create(null);
    (a || []).concat(b || []).forEach(function (v) {
      if (!v) return;
      var k = v.email ? 'e:' + v.email : v.id ? 'i:' + v.id : 'n:' + plainName(v.name);
      var have = at[k];
      if (!have) { at[k] = Object.assign({}, v); out.push(at[k]); return; }
      if (v.completion !== null && (have.completion === null || v.completion > have.completion)) have.completion = v.completion;
    });
    return out;
  }

  /* The same video, once. A video embedded in an assignment or module often
   * carries another embed id (perspective) than the one in Studio's list
   * for this course - an embed copied with the course from another class,
   * or added from the teacher's own library - and Studio records this
   * class's watching under the course's own perspective. Studio's course
   * list can also hold the same media twice (added to the course twice).
   * Each copy is folded into one video:
   *   1. an embed Studio names as another perspective of a course video
   *      (aliasOf: {embedUuid: courseVideoUuid}, from the media's list of
   *      perspectives);
   *   2. course videos of the same media (mediaId);
   *   3. videos with the same title and the same length. A copy whose
   *      length isn't known (an embed Studio gave nothing for) joins the
   *      one length its title has; with two lengths under one title they
   *      are different videos and nothing is guessed.
   * The video kept is the course's own (else a readable one); it keeps the
   * others' embed ids as `aliases`, so their places land on it, and the
   * viewers of all of them. */
  function foldEmbeds(videos, aliasOf) {
    aliasOf = aliasOf || {};
    var list = (videos || []).filter(Boolean);
    var byId = Object.create(null);
    list.forEach(function (v) { if (!v.embeddedOnly) byId[v.uuid] = v; });
    var dropped = new Set();

    function absorb(target, v) {
      if (target === v || dropped.has(v)) return;
      dropped.add(v);
      target.aliases = (target.aliases || []).concat([v.uuid], v.aliases || []);
      if (target.duration === null || target.duration === undefined) target.duration = v.duration === undefined ? null : v.duration;
      if (!target.mediaId && v.mediaId) target.mediaId = v.mediaId;
      if (!target.createdAt && v.createdAt) target.createdAt = v.createdAt;
      if (v.error) return;
      if (target.error) {
        target.viewers = (v.viewers || []).slice();
        delete target.error;
        delete target.errorStatus;
      } else {
        target.viewers = mergeViewers(target.viewers, v.viewers);
      }
    }
    // The copy to keep: the course's own, then a readable one, then the first.
    function primary(group) {
      return group.slice().sort(function (a, b) {
        return (!!a.embeddedOnly - !!b.embeddedOnly) || (!!a.error - !!b.error) || (list.indexOf(a) - list.indexOf(b));
      })[0];
    }
    function known(d) { return d !== null && d !== undefined && isFinite(d) && d > 0; }

    // 1. Embeds Studio says are the course's video.
    list.forEach(function (v) {
      var t = v.embeddedOnly ? byId[aliasOf[v.uuid]] : null;
      if (t) absorb(t, v);
    });
    // 2. The same media twice.
    var byMedia = Object.create(null);
    list.forEach(function (v) {
      if (dropped.has(v) || !v.mediaId) return;
      (byMedia[v.mediaId] = byMedia[v.mediaId] || []).push(v);
    });
    Object.keys(byMedia).forEach(function (k) {
      var g = byMedia[k];
      if (g.length < 2) return;
      var p = primary(g);
      g.forEach(function (v) { absorb(p, v); });
    });
    // 3. The same title and length.
    var byTitle = Object.create(null);
    list.forEach(function (v) {
      if (dropped.has(v)) return;
      var t = normName(v.title);
      if (!t || t === 'studio video' || t === 'untitled video') return;
      (byTitle[t] = byTitle[t] || []).push(v);
    });
    Object.keys(byTitle).forEach(function (t) {
      var g = byTitle[t];
      if (g.length < 2) return;
      var lengths = [];   // [[videos of one length]]
      var unknown = [];
      // Two known, different media ids are two videos, whatever the title
      // and however close the lengths: a title is only a guess.
      var fits = function (c, v) { return !v.mediaId || c.every(function (x) { return !x.mediaId || String(x.mediaId) === String(v.mediaId); }); };
      g.forEach(function (v) {
        if (!known(v.duration)) { unknown.push(v); return; }
        var c = lengths.filter(function (l) { return Math.abs(l[0].duration - v.duration) <= 2 && fits(l, v); })[0];
        if (c) c.push(v); else lengths.push([v]);
      });
      var media = function (c) { var m = []; c.forEach(function (x) { if (x.mediaId && m.indexOf(String(x.mediaId)) < 0) m.push(String(x.mediaId)); }); return m; };
      if (lengths.length === 1) lengths[0] = lengths[0].concat(unknown.filter(function (v) { return fits(lengths[0], v); }));
      // No length known at all: embeds join the title's one course video;
      // two course videos with no length to tell them apart stay apart.
      else if (!lengths.length && unknown.filter(function (v) { return !v.embeddedOnly; }).length <= 1 && media(unknown).length <= 1) lengths.push(unknown);
      lengths.forEach(function (c) {
        if (c.length < 2) return;
        var p = primary(c);
        c.forEach(function (v) { absorb(p, v); });
      });
    });
    return list.filter(function (v) { return !dropped.has(v); });
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
    LABELS: LABELS,
    labelOf: labelOf,
    matchViewers: matchViewers,
    namesText: namesText,
    videosFromTiles: videosFromTiles,
    findCollection: findCollection,
    studentVideos: studentVideos,
    embedIdFromUrl: embedIdFromUrl,
    embedsFromHtml: embedsFromHtml,
    joinEmbeds: joinEmbeds,
    errorReason: errorReason,
    isCaptureTitle: isCaptureTitle,
    originOf: originOf,
    studentEmbeds: studentEmbeds,
    foldEmbeds: foldEmbeds,
    mergeViewers: mergeViewers,
    plainName: plainName,
    normName: normName
  };
})();
