/* Canvas Gradebook+ - one student's picture of the course, as numbers.
 *
 * Feeds the student overview (gradebook/student-insights.js) that opens when a
 * teacher clicks a student's name. Everything here is a pure function of what
 * Canvas already reported - that student's submissions, the course's
 * assignments and groups, the class's scores in the same columns, and (when
 * the course has Canvas analytics) page views and participations - so it is
 * unit tested directly. No DOM, no network.
 *
 * Status words follow Canvas's own flags rather than re-deriving them: a
 * submission is Missing when Canvas says `missing` (or a teacher applied it),
 * Late when Canvas says `late` (or a teacher applied it). Excused work is left
 * out of every rate and average. A blank is never a zero: averages count
 * graded work only, the same way Canvas's current score does. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.studentInsights) return;

  var HOUR = 3600 * 1000;
  var DAY = 24 * HOUR;

  function time(v) {
    if (!v) return null;
    var t = typeof v === 'number' ? v : Date.parse(v);
    return isFinite(t) ? t : null;
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function median(values) {
    var s = values.filter(function (v) { return isFinite(v); }).slice().sort(function (a, b) { return a - b; });
    if (!s.length) return null;
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function mean(values) {
    var s = values.filter(function (v) { return isFinite(v); });
    if (!s.length) return null;
    return s.reduce(function (t, v) { return t + v; }, 0) / s.length;
  }

  /* Where `value` sits among `values` (0-100): the share of the class below
   * it, ties counted half - so the middle student reads 50, not 0 or 100. */
  function percentile(value, values) {
    var list = (values || []).filter(function (v) { return isFinite(v); });
    if (value === null || value === undefined || !isFinite(value) || list.length < 2) return null;
    var below = 0, same = 0;
    list.forEach(function (v) { if (v < value) below++; else if (v === value) same++; });
    return Math.round(((below + same / 2) / list.length) * 100);
  }

  var ONLINE = ['online_upload', 'online_text_entry', 'online_url', 'online_quiz', 'discussion_topic',
    'media_recording', 'student_annotation', 'basic_lti_launch', 'external_tool'];

  function acceptsOnline(a) {
    return (a.submissionTypes || []).some(function (t) { return ONLINE.indexOf(t) >= 0; });
  }

  /* How work for this assignment is handed in, which decides where a
   * teacher goes to see it:
   *   tool   - an external tool (Turnitin, Edpuzzle, Google Assignments...):
   *            the work lives in the tool
   *   online - handed in to Canvas: SpeedGrader shows it
   *   paper  - on paper: there is nothing online to open
   *   none   - no submission at all (or not graded) */
  function submissionKind(a) {
    var types = a.submissionTypes || [];
    if (types.indexOf('external_tool') >= 0 || types.indexOf('basic_lti_launch') >= 0) return 'tool';
    if (acceptsOnline(a)) return 'online';
    if (types.indexOf('on_paper') >= 0) return 'paper';
    return 'none';
  }

  var KNOWN_TOOLS = [
    [/turnitin/i, 'Turnitin'],
    [/edpuzzle/i, 'Edpuzzle'],
    [/assignments\.google|google\.com\/.*assignments|classroom\.google|googleusercontent|\bgoogle\b/i, 'Google Assignments'],
    [/deltamath/i, 'DeltaMath'],
    [/khanacademy/i, 'Khan Academy'],
    [/pear(deck)?\.com|peardeck/i, 'Pear Deck'],
    [/nearpod/i, 'Nearpod'],
    [/quizizz|wayground/i, 'Quizizz'],
    [/kami/i, 'Kami'],
    [/flip(grid)?\.com/i, 'Flip'],
    [/newsela/i, 'Newsela'],
    [/commonlit/i, 'CommonLit'],
    [/ixl\.com/i, 'IXL'],
    [/gradescope/i, 'Gradescope'],
    [/mcgraw|connect\.mheducation/i, 'McGraw Hill Connect'],
    [/pearson|mylab|mastering/i, 'Pearson'],
    [/webassign/i, 'WebAssign'],
    [/youtube|playposit/i, 'PlayPosit']
  ];

  /* A readable name for the tool behind a launch URL ("Turnitin"), or the
   * tool's own host name when it is not one we know. */
  function toolName(url) {
    if (!url) return null;
    var s = String(url);
    for (var i = 0; i < KNOWN_TOOLS.length; i++) if (KNOWN_TOOLS[i][0].test(s)) return KNOWN_TOOLS[i][1];
    var m = /^https?:\/\/([^/?#]+)/i.exec(s);
    if (!m) return null;
    var host = m[1].replace(/^www\./i, '').replace(/:\d+$/, '').split('.');
    var core = host.length > 2 ? host[host.length - 2] : host[0];
    return core ? core.charAt(0).toUpperCase() + core.slice(1) : null;
  }

  /* One row per assignment the student has been given. */
  function classify(a, sub, now) {
    var due = time(sub.cached_due_date || a.dueAt);
    var submittedAt = time(sub.submitted_at);
    var score = num(sub.score);
    var pp = num(a.pointsPossible);
    var lps = sub.late_policy_status || null;
    var excused = !!sub.excused;
    var missing = !excused && (lps === 'missing' || (!!sub.missing && lps !== 'none'));
    var late = !excused && !missing && (lps === 'late' || (!!sub.late && lps !== 'none'));
    var status;
    if (excused) status = 'excused';
    else if (missing) status = 'missing';
    else if (late) status = 'late';
    else if (submittedAt) status = 'onTime';
    else if (score !== null) status = 'graded';         // on paper, or graded without a submission
    else if (due !== null && due > now) status = 'upcoming';
    else status = 'notSubmitted';                         // past due, nothing in, Canvas calls it neither
    var secondsLate = num(sub.seconds_late);
    if (status === 'late' && (!secondsLate || secondsLate <= 0) && submittedAt && due) {
      secondsLate = Math.max(0, (submittedAt - due) / 1000);
    }
    var needsGrading = !excused && !!submittedAt &&
      (sub.workflow_state === 'submitted' || sub.workflow_state === 'pending_review' ||
       (score === null && sub.workflow_state !== 'graded') || sub.grade_matches_current_submission === false);
    return {
      id: String(a.id),
      name: a.name || '',
      groupId: a.groupId === undefined || a.groupId === null ? null : String(a.groupId),
      pointsPossible: pp,
      dueAt: due,
      submittedAt: submittedAt,
      gradedAt: time(sub.graded_at),
      score: excused ? null : score,
      grade: sub.grade === undefined ? null : sub.grade,
      percent: (!excused && score !== null && pp) ? (score / pp) * 100 : null,
      status: status,
      online: acceptsOnline(a),
      kind: submissionKind(a),
      toolUrl: a.toolUrl || null,
      toolName: submissionKind(a) === 'tool' ? (toolName(sub.url) || toolName(a.toolUrl)) : null,
      // For an external-tool submission, the tool's launch URL for THIS
      // student's work - what SpeedGrader itself opens.
      submissionUrl: sub.submission_type === 'basic_lti_launch' && sub.url ? String(sub.url) : null,
      secondsLate: status === 'late' ? (secondsLate || 0) : null,
      attempt: num(sub.attempt) || 0,
      needsGrading: needsGrading,
      omitFromFinal: !!a.omitFromFinal,
      comments: Array.isArray(sub.submission_comments) ? sub.submission_comments : []
    };
  }

  var LATE_BUCKETS = [
    { key: 'hour', label: '< 1 hour', max: 3600 },
    { key: 'day', label: '1–24 hours', max: 86400 },
    { key: 'days3', label: '1–3 days', max: 3 * 86400 },
    { key: 'week', label: '3–7 days', max: 7 * 86400 },
    { key: 'more', label: '> 1 week', max: Infinity }
  ];

  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function startOfDay(t) {
    var d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /* Canvas analytics' activity payload: page_views is {isoHour: count},
   * participations is [{created_at, url}]. Folded into the shapes the panel
   * draws: a daily calendar of the last `weeks` weeks (whole weeks, Sunday
   * first, ending this week), and totals by weekday and by hour. */
  function activity(input, now, weeks) {
    if (!input) return null;
    weeks = weeks || 16;
    var views = input.page_views || input.pageViews || {};
    var parts = Array.isArray(input.participations) ? input.participations : [];
    var byDay = Object.create(null);
    var byWeekday = [0, 0, 0, 0, 0, 0, 0];
    var byHour = new Array(24).fill(0);
    var total = 0, last7 = 0, last30 = 0, prior30 = 0, lastView = null;
    Object.keys(views).forEach(function (k) {
      var t = time(k);
      var n = num(views[k]) || 0;
      if (t === null || !n) return;
      total += n;
      var d = new Date(t);
      byDay[dayKey(t)] = (byDay[dayKey(t)] || 0) + n;
      byWeekday[d.getDay()] += n;
      byHour[d.getHours()] += n;
      var age = now - t;
      if (age <= 7 * DAY) last7 += n;
      if (age <= 30 * DAY) last30 += n;
      else if (age <= 60 * DAY) prior30 += n;
      if (lastView === null || t > lastView) lastView = t;
    });
    var partTimes = parts.map(function (p) { return time(p && p.created_at); }).filter(function (t) { return t !== null; });
    var lastParticipation = partTimes.length ? Math.max.apply(null, partTimes) : null;

    // The calendar: `weeks` columns of 7 days, the last one holding today.
    var today = startOfDay(now);
    var end = today + (6 - new Date(today).getDay()) * DAY;   // this week's Saturday
    var start = end - (weeks * 7 - 1) * DAY;
    var days = [];
    var activeDays30 = 0;
    for (var t = start; t <= end + HOUR; t += DAY) {
      var dt = startOfDay(t + 2 * HOUR); // DST-proof step
      var key = dayKey(dt);
      var count = byDay[key] || 0;
      days.push({ date: dt, key: key, count: count, future: dt > today });
      if (count && today - dt < 30 * DAY) activeDays30++;
    }
    var maxDay = days.reduce(function (m, d) { return Math.max(m, d.count); }, 0);
    return {
      total: total, last7: last7, last30: last30, prior30: prior30,
      lastView: lastView,
      participations: partTimes.length,
      participations30: partTimes.filter(function (t) { return now - t <= 30 * DAY; }).length,
      lastParticipation: lastParticipation,
      days: days, maxDay: maxDay, weeks: weeks, activeDays30: activeDays30,
      byWeekday: byWeekday, byHour: byHour
    };
  }

  /* Score average over graded work with points, Canvas-style: total earned
   * over total possible, no drop rules. */
  function pointsAverage(items) {
    var earned = 0, possible = 0, n = 0;
    items.forEach(function (i) {
      if (i.score === null || i.score === undefined || i.omitFromFinal) return;
      // A zero-point assignment is extra credit: its points count toward
      // what was earned and add nothing to what was possible.
      earned += i.score; possible += i.pointsPossible || 0; n++;
    });
    return possible ? { percent: (earned / possible) * 100, earned: earned, possible: possible, count: n } : null;
  }

  /* input:
   *   now              ms
   *   studentId        string
   *   instructorId     string | null
   *   assignments      [{id, name, pointsPossible, dueAt, groupId, published, omitFromFinal, submissionTypes}]
   *   submissions      raw Canvas submissions for this student
   *   groups           [{id, name, group_weight}]   (optional)
   *   weighted         bool (course applies group weights)
   *   classMedians     {assignmentId: percent}      (optional)
   *   classGroupMedians {groupId: percent}          (optional) - see classGroupMedians()
   *   student          {currentScore, currentGrade, lastActivityAt, totalActivityTime}
   *   classActivityTimes  [seconds]                  (optional, the whole class incl. this student)
   *   activity         Canvas analytics activity payload (optional)
   *   summaries        Canvas analytics student_summaries (optional)
   */
  function summarize(input) {
    input = input || {};
    var now = time(input.now) || Date.now();
    var sid = String(input.studentId || '');
    var byId = new Map();
    (input.assignments || []).forEach(function (a) { if (a && a.id !== undefined) byId.set(String(a.id), a); });

    var items = [];
    (input.submissions || []).forEach(function (s) {
      if (!s || s.assignment_id === undefined) return;
      var a = byId.get(String(s.assignment_id));
      if (!a || a.published === false) return;
      if (s.workflow_state === 'deleted') return;
      items.push(classify(a, s, now));
    });
    // Chronological by due date; undated work sorts by when it happened.
    function when(i) { return i.dueAt || i.submittedAt || i.gradedAt || 0; }
    items.sort(function (x, y) { return when(x) - when(y) || x.name.localeCompare(y.name); });

    var medians = input.classMedians || {};
    items.forEach(function (i) {
      var m = medians[i.id];
      i.classMedian = (m === undefined || m === null || !isFinite(m)) ? null : m;
    });

    var counts = { total: items.length, onTime: 0, late: 0, missing: 0, excused: 0, graded: 0, upcoming: 0, notSubmitted: 0 };
    items.forEach(function (i) { counts[i.status] = (counts[i.status] || 0) + 1; });
    var turnedIn = counts.onTime + counts.late;
    var due = turnedIn + counts.missing;
    var rates = {
      onTime: turnedIn ? counts.onTime / turnedIn : null,
      late: turnedIn ? counts.late / turnedIn : null,
      missing: due ? counts.missing / due : null,
      completion: due ? turnedIn / due : null
    };

    // How late, when late.
    var lateItems = items.filter(function (i) { return i.status === 'late'; });
    var lateSecs = lateItems.map(function (i) { return i.secondsLate || 0; });
    var lateness = {
      count: lateItems.length,
      median: median(lateSecs),
      mean: mean(lateSecs),
      max: lateSecs.length ? Math.max.apply(null, lateSecs) : null,
      buckets: LATE_BUCKETS.map(function (b, idx) {
        var min = idx ? LATE_BUCKETS[idx - 1].max : -Infinity;
        return { key: b.key, label: b.label, count: lateSecs.filter(function (s) { return s > min && s <= b.max; }).length };
      })
    };

    // When they submit, relative to the deadline and the clock.
    var submitted = items.filter(function (i) { return i.submittedAt; });
    var withDue = submitted.filter(function (i) { return i.dueAt; });
    var early = withDue.filter(function (i) { return i.status !== 'late' && i.submittedAt <= i.dueAt; });
    var leadHours = early.map(function (i) { return (i.dueAt - i.submittedAt) / HOUR; });
    var lastMinute = early.filter(function (i) { return i.dueAt - i.submittedAt <= 2 * HOUR; }).length;
    var byHour = new Array(24).fill(0);
    var lateNight = 0;
    submitted.forEach(function (i) {
      var h = new Date(i.submittedAt).getHours();
      byHour[h]++;
      if (h >= 22 || h < 4) lateNight++;
    });
    var timing = {
      submitted: submitted.length,
      medianLeadHours: median(leadHours),
      lastMinute: lastMinute,
      lastMinuteShare: early.length ? lastMinute / early.length : null,
      onTimeWithDue: early.length,
      lateNight: lateNight,
      lateNightShare: submitted.length ? lateNight / submitted.length : null,
      byHour: byHour
    };

    // Averages: overall and per assignment group.
    var gradedItems = items.filter(function (i) { return i.score !== null; });
    var overall = pointsAverage(gradedItems);
    var groupMedians = input.classGroupMedians || {};
    var groups = (input.groups || []).map(function (g) {
      var gid = String(g.id);
      var mine = items.filter(function (i) { return i.groupId === gid; });
      var avg = pointsAverage(mine);
      return {
        id: gid,
        name: g.name || 'Group',
        weight: num(g.group_weight),
        average: avg ? avg.percent : null,
        graded: avg ? avg.count : 0,
        // The median of every classmate's own average in this category,
        // computed the same way as this student's - never an average of
        // per-assignment medians, which mis-weights mixed point values.
        classMedian: groupMedians[gid] === undefined || groupMedians[gid] === null ? null : groupMedians[gid],
        missing: mine.filter(function (i) { return i.status === 'missing'; }).length,
        total: mine.length
      };
    }).filter(function (g) { return g.total > 0; });
    var weightedEstimate = null;
    if (input.weighted) {
      var wsum = 0, acc = 0;
      groups.forEach(function (g) {
        if (g.average === null || !g.weight) return;
        wsum += g.weight; acc += g.average * g.weight;
      });
      weightedEstimate = wsum ? acc / wsum : null;
    }

    // Trend over graded work in due-date order.
    var series = items.filter(function (i) { return i.percent !== null; });
    var recentN = Math.min(5, Math.floor(series.length / 2));
    var recentAvg = recentN ? mean(series.slice(-recentN).map(function (i) { return i.percent; })) : null;
    var priorAvg = recentN ? mean(series.slice(0, -recentN).map(function (i) { return i.percent; })) : null;
    var trend = {
      series: series.map(function (i) {
        return { id: i.id, name: i.name, at: when(i), percent: i.percent, classMedian: i.classMedian, status: i.status };
      }),
      recentCount: recentN,
      recentAvg: recentAvg,
      priorAvg: priorAvg,
      delta: (recentAvg !== null && priorAvg !== null) ? recentAvg - priorAvg : null
    };

    // Against the class, column by column.
    var compared = series.filter(function (i) { return i.classMedian !== null; });
    var diffs = compared.map(function (i) { return i.percent - i.classMedian; });
    var relative = {
      count: compared.length,
      above: diffs.filter(function (d) { return d > 2; }).length,
      below: diffs.filter(function (d) { return d < -2; }).length,
      near: diffs.filter(function (d) { return d >= -2 && d <= 2; }).length,
      avgDiff: mean(diffs)
    };

    // Streaks over work whose deadline has passed, newest first.
    var history = items.filter(function (i) { return i.status === 'onTime' || i.status === 'late' || i.status === 'missing'; })
      .filter(function (i) { return !i.dueAt || i.dueAt <= now; });
    var streak = null;
    if (history.length) {
      var lastStatus = history[history.length - 1].status;
      var n = 0;
      for (var k = history.length - 1; k >= 0 && history[k].status === lastStatus; k--) n++;
      streak = { status: lastStatus, count: n };
    }

    // Feedback conversation.
    var iid = input.instructorId ? String(input.instructorId) : null;
    var feedback = { fromYou: 0, fromTeachers: 0, fromStudent: 0, unanswered: [] };
    items.forEach(function (i) {
      var lastTeacher = null, lastStudent = null;
      i.comments.forEach(function (c) {
        if (!c || c.draft === true) return;
        var author = c.author_id === undefined || c.author_id === null ? '' : String(c.author_id);
        var t = time(c.created_at) || 0;
        if (author === sid) {
          feedback.fromStudent++;
          if (lastStudent === null || t > lastStudent) lastStudent = t;
        } else {
          feedback.fromTeachers++;
          if (iid && author === iid) feedback.fromYou++;
          if (lastTeacher === null || t > lastTeacher) lastTeacher = t;
        }
      });
      if (lastStudent !== null && (lastTeacher === null || lastStudent > lastTeacher)) {
        feedback.unanswered.push({ id: i.id, name: i.name, at: lastStudent });
      }
    });

    var lists = {
      missing: items.filter(function (i) { return i.status === 'missing'; }).reverse(),
      late: lateItems.slice().reverse(),
      needsGrading: items.filter(function (i) { return i.needsGrading; }).reverse(),
      upcoming: items.filter(function (i) { return i.status === 'upcoming' && i.dueAt - now <= 14 * DAY; }),
      resubmitted: items.filter(function (i) { return i.attempt > 1; })
    };
    var missingPoints = lists.missing.reduce(function (t, i) { return t + (i.pointsPossible || 0); }, 0);

    // Online activity.
    var st = input.student || {};
    var lastActivity = time(st.lastActivityAt);
    var act = activity(input.activity, now, input.weeks);
    if (act && act.lastView && (!lastActivity || act.lastView > lastActivity)) lastActivity = act.lastView;
    var summaries = Array.isArray(input.summaries) ? input.summaries : null;
    var mySummary = summaries ? summaries.filter(function (s) { return s && String(s.id) === sid; })[0] || null : null;
    var pageViewValues = summaries ? summaries.map(function (s) { return num(s && s.page_views); }).filter(function (v) { return v !== null; }) : [];
    var partValues = summaries ? summaries.map(function (s) { return num(s && s.participations); }).filter(function (v) { return v !== null; }) : [];
    var activityTimes = (input.classActivityTimes || []).map(num).filter(function (v) { return v !== null; });
    var engagement = {
      lastActivityAt: lastActivity,
      daysSinceActivity: lastActivity ? Math.floor((now - lastActivity) / DAY) : null,
      totalActivitySeconds: num(st.totalActivityTime),
      classMedianActivitySeconds: median(activityTimes),
      activityPercentile: percentile(num(st.totalActivityTime), activityTimes),
      pageViews: mySummary ? num(mySummary.page_views) : (act ? act.total : null),
      classMedianPageViews: median(pageViewValues),
      pageViewPercentile: mySummary ? percentile(num(mySummary.page_views), pageViewValues) : null,
      participations: mySummary ? num(mySummary.participations) : (act ? act.participations : null),
      classMedianParticipations: median(partValues),
      participationPercentile: mySummary ? percentile(num(mySummary.participations), partValues) : null
    };

    var result = {
      now: now,
      items: items,
      counts: counts,
      rates: rates,
      lateness: lateness,
      timing: timing,
      overall: overall,
      weightedEstimate: weightedEstimate,
      groups: groups,
      trend: trend,
      relative: relative,
      streak: streak,
      feedback: feedback,
      lists: lists,
      missingPoints: missingPoints,
      activity: act,
      engagement: engagement
    };
    result.insights = insights(result);
    return result;
  }

  function pct(r) { return Math.round(r * 100) + '%'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* The handful of things a teacher should notice first, most urgent first.
   * level: risk | warn | info | good. */
  function insights(r) {
    var out = [];
    function add(level, text, detail) { out.push({ level: level, text: text, detail: detail || '' }); }
    var c = r.counts;

    if (c.missing) {
      add(c.missing >= 3 ? 'risk' : 'warn', plural(c.missing, 'missing assignment') + ' on record',
        r.missingPoints ? Math.round(r.missingPoints * 10) / 10 + ' points not yet earned' : '');
    }
    if (r.lateness.count >= 2 && r.rates.late >= 0.25) {
      add(r.rates.late >= 0.5 ? 'risk' : 'warn', 'Turns in ' + pct(r.rates.late) + ' of work late',
        r.lateness.count + ' of ' + (c.onTime + c.late) + ' submissions · typically ' + duration(r.lateness.median) + ' late');
    }
    var e = r.engagement;
    if (e.daysSinceActivity !== null) {
      if (e.daysSinceActivity >= 7) add('risk', 'No Canvas activity in ' + e.daysSinceActivity + ' days');
      else if (e.daysSinceActivity >= 4) add('warn', 'Last active in Canvas ' + e.daysSinceActivity + ' days ago');
    }
    if (r.trend.delta !== null && Math.abs(r.trend.delta) >= 8) {
      var up = r.trend.delta > 0;
      add(up ? 'good' : 'warn', 'Scores trending ' + (up ? 'up' : 'down') + ' ' + Math.round(Math.abs(r.trend.delta)) + ' points',
        'Last ' + r.trend.recentCount + ' graded avg ' + Math.round(r.trend.recentAvg) + '% vs ' + Math.round(r.trend.priorAvg) + '% before');
    }
    if (r.relative.count >= 3 && r.relative.avgDiff !== null) {
      if (r.relative.avgDiff <= -10) {
        add('warn', 'Scores run ' + Math.round(-r.relative.avgDiff) + ' points below the class median',
          'Below median on ' + r.relative.below + ' of ' + r.relative.count + ' assignments');
      } else if (r.relative.avgDiff >= 5) {
        add('good', 'Scores run ' + Math.round(r.relative.avgDiff) + ' points above the class median',
          'Above median on ' + r.relative.above + ' of ' + r.relative.count + ' assignments');
      }
    }
    if (e.pageViewPercentile !== null && e.pageViewPercentile <= 20) {
      add('warn', 'Fewer page views than ' + (100 - e.pageViewPercentile) + '% of the class');
    } else if (e.pageViewPercentile !== null && e.pageViewPercentile >= 85) {
      add('good', 'More page views than ' + e.pageViewPercentile + '% of the class');
    }
    if (r.feedback.unanswered.length) {
      add('info', 'Replied to feedback on ' + plural(r.feedback.unanswered.length, 'assignment') + ' — no answer yet',
        r.feedback.unanswered.slice(0, 3).map(function (u) { return u.name; }).join(', '));
    }
    if (r.lists.needsGrading.length) {
      add('info', plural(r.lists.needsGrading.length, 'submission') + ' waiting for a grade');
    }
    if (r.timing.lastMinuteShare !== null && r.timing.onTimeWithDue >= 4 && r.timing.lastMinuteShare >= 0.5) {
      add('info', 'Usually submits within 2 hours of the deadline',
        r.timing.lastMinute + ' of ' + r.timing.onTimeWithDue + ' on-time submissions');
    }
    if (r.timing.lateNightShare !== null && r.timing.submitted >= 4 && r.timing.lateNightShare >= 0.4) {
      add('info', pct(r.timing.lateNightShare) + ' of submissions arrive between 10 pm and 4 am');
    }
    var soon = r.lists.upcoming.filter(function (i) { return i.dueAt - r.now <= 3 * DAY; });
    if (soon.length) add('info', plural(soon.length, 'assignment') + ' due in the next 3 days, not yet submitted');
    if (r.streak && r.streak.status === 'onTime' && r.streak.count >= 5) {
      add('good', r.streak.count + ' on-time submissions in a row');
    } else if (r.streak && r.streak.status === 'missing' && r.streak.count >= 2) {
      add('risk', 'Missed the last ' + r.streak.count + ' assignments in a row');
    }
    if (!c.missing && !c.late && c.onTime >= 3) add('good', 'Every submission so far on time');

    var order = { risk: 0, warn: 1, info: 2, good: 3 };
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  }

  /* "3 d 4 h", "5 h", "12 min" - the two largest units, never more. */
  function duration(seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '–';
    var s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(s / 3600);
    var rm = Math.round((s - h * 3600) / 60);
    if (h < 24) return rm && h < 10 ? h + ' h ' + rm + ' min' : h + ' h';
    var d = Math.floor(h / 24);
    var rh = h - d * 24;
    return rh && d < 7 ? d + ' d ' + rh + ' h' : d + ' d';
  }

  /* "today", "yesterday", "5 days ago", "in 3 days". */
  function relativeDay(t, now) {
    if (t === null || t === undefined) return '–';
    var days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days === -1) return 'tomorrow';
    if (days > 0) return days < 60 ? days + ' days ago' : Math.round(days / 30) + ' months ago';
    return 'in ' + (-days) + ' days';
  }

  /* Each assignment's class median percent, from whatever the gradebook model
   * holds: graded, non-excused scores of real students only. */
  function classMedians(cellsFor, assignments, studentIds) {
    var out = {};
    (assignments || []).forEach(function (a) {
      var pp = num(a.pointsPossible);
      if (!pp) return;
      var vals = [];
      studentIds.forEach(function (uid) {
        var rec = cellsFor(a.id, uid);
        if (!rec || rec.excused) return;
        var s = num(rec.score);
        if (s !== null) vals.push((s / pp) * 100);
      });
      if (vals.length >= 2) out[String(a.id)] = median(vals);
    });
    return out;
  }

  /* Each assignment group's class median: every student's own category
   * average (points earned over points possible on their graded work, extra
   * credit included - pointsAverage), then the median of those. */
  function classGroupMedians(cellsFor, assignments, studentIds) {
    var byGroup = Object.create(null);
    (assignments || []).forEach(function (a) {
      if (!a || a.published === false || a.groupId === null || a.groupId === undefined) return;
      var g = String(a.groupId);
      (byGroup[g] = byGroup[g] || []).push(a);
    });
    var out = {};
    Object.keys(byGroup).forEach(function (g) {
      var avgs = [];
      studentIds.forEach(function (uid) {
        var items = [];
        byGroup[g].forEach(function (a) {
          var rec = cellsFor(a.id, uid);
          if (!rec || rec.excused) return;
          var sc = num(rec.score);
          if (sc === null) return;
          items.push({ score: sc, pointsPossible: num(a.pointsPossible), omitFromFinal: !!a.omitFromFinal });
        });
        var avg = pointsAverage(items);
        if (avg) avgs.push(avg.percent);
      });
      if (avgs.length >= 2) out[g] = median(avgs);
    });
    return out;
  }

  /* ------------------------------------------------ missing / late list */

  function escHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function longDate(t, withTime) {
    if (!t) return '';
    var o = { weekday: 'short', month: 'short', day: 'numeric' };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
    try { return new Date(t).toLocaleString('en-US', o); } catch (e) { return new Date(t).toDateString(); }
  }

  function points(i) {
    if (!i.pointsPossible) return '';
    var pp = Math.round(i.pointsPossible * 100) / 100;
    if (i.score === null) return 'worth ' + pp + ' pts';
    return (Math.round(i.score * 100) / 100) + ' / ' + pp + ' pts';
  }

  /* A list of a student's missing and/or late work, ready to paste into an
   * email, a message or a document - as plain text and as an HTML table.
   *
   * opts: { studentName, courseName, now, include: {missing, late},
   *         links: bool, urlFor(item) -> absolute assignment URL } */
  function workReport(r, opts) {
    opts = opts || {};
    var now = opts.now || r.now || Date.now();
    var inc = opts.include || { missing: true, late: true };
    var urlFor = opts.urlFor || function () { return ''; };
    var groups = [];
    function byDue(a, b) { return (a.dueAt || 0) - (b.dueAt || 0); }
    if (inc.missing) {
      groups.push({ title: 'Missing', items: r.lists.missing.slice().sort(byDue), detail: function (i) {
        var days = i.dueAt ? Math.max(0, Math.floor((now - i.dueAt) / DAY)) : null;
        return days === null ? 'not turned in' : 'not turned in · ' + days + (days === 1 ? ' day' : ' days') + ' overdue';
      } });
    }
    if (inc.late) {
      groups.push({ title: 'Late', items: r.lists.late.slice().sort(byDue), detail: function (i) {
        return 'turned in ' + longDate(i.submittedAt, true) + ' · ' + duration(i.secondsLate) + ' late';
      } });
    }
    var total = groups.reduce(function (t, g) { return t + g.items.length; }, 0);
    var what = groups.map(function (g) { return g.title.toLowerCase(); }).join(' and ');
    var title = (what ? what.charAt(0).toUpperCase() + what.slice(1) : 'No') + ' work' +
      (opts.studentName ? ' — ' + opts.studentName : '');
    var sub = [opts.courseName, 'as of ' + longDate(now)].filter(Boolean).join(' · ');

    var text = [title, sub, ''];
    var html = '<p><b>' + escHtml(title) + '</b><br>' + escHtml(sub) + '</p>';
    if (!total) {
      text.push('Nothing ' + (what || 'selected') + ' right now.');
      html += '<p>Nothing ' + escHtml(what || 'selected') + ' right now.</p>';
    }
    groups.forEach(function (g) {
      if (!g.items.length) return;
      text.push(g.title + ' (' + g.items.length + ')');
      html += '<p><b>' + escHtml(g.title) + ' (' + g.items.length + ')</b></p>' +
        '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">' +
        '<thead><tr style="background:#f2f4f5"><th align="left">Assignment</th><th align="left">Due</th><th align="left">Status</th><th align="left">Score</th></tr></thead><tbody>';
      g.items.forEach(function (i) {
        var due = i.dueAt ? 'due ' + longDate(i.dueAt, true) : 'no due date';
        var pts = points(i);
        text.push('• ' + i.name + ' — ' + due + ' — ' + g.detail(i) + (pts ? ' — ' + pts : ''));
        var url = opts.links ? urlFor(i) : '';
        if (url) text.push('  ' + url);
        html += '<tr><td>' + (url ? '<a href="' + escHtml(url) + '">' + escHtml(i.name) + '</a>' : escHtml(i.name)) + '</td>' +
          '<td>' + escHtml(i.dueAt ? longDate(i.dueAt, true) : 'No due date') + '</td>' +
          '<td>' + escHtml(g.detail(i).charAt(0).toUpperCase() + g.detail(i).slice(1)) + '</td>' +
          '<td>' + escHtml(pts) + '</td></tr>';
      });
      html += '</tbody></table>';
      text.push('');
    });
    var missingGroup = groups.filter(function (g) { return g.title === 'Missing'; })[0];
    if (missingGroup && missingGroup.items.length) {
      var at = missingGroup.items.reduce(function (t, i) { return t + (i.pointsPossible || 0); }, 0);
      if (at) {
        var line = 'Points not yet earned on missing work: ' + Math.round(at * 100) / 100;
        text.push(line);
        html += '<p>' + escHtml(line) + '</p>';
      }
    }
    return { text: text.join('\n').replace(/\n+$/, '') + '\n', html: html, count: total };
  }

  /* Every way a teacher might type a date, so a search for "10/12",
   * "Oct 12", "october 12", "2026-10-12" or "monday" finds it. */
  function dateSearchText(t) {
    if (!t) return '';
    var d = new Date(t);
    var m = d.getMonth() + 1, day = d.getDate(), y = d.getFullYear();
    var out = [m + '/' + day, m + '/' + day + '/' + y, m + '/' + day + '/' + String(y).slice(2),
      String(m).padStart(2, '0') + '/' + String(day).padStart(2, '0'),
      y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0')];
    try {
      out.push(d.toLocaleString('en-US', { month: 'short', day: 'numeric' }));
      out.push(d.toLocaleString('en-US', { month: 'long', day: 'numeric' }));
      out.push(d.toLocaleString('en-US', { weekday: 'long' }));
      out.push(d.toLocaleString(undefined, { month: 'short', day: 'numeric' }));
    } catch (e) { /* the numeric forms are enough */ }
    return out.join(' | ').toLowerCase();
  }

  /* Does one assignment match a search? Every word must appear somewhere in
   * its name or one of its dates. */
  function matchesSearch(haystack, query) {
    var words = String(query || '').toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var h = String(haystack || '').toLowerCase().replace(/,/g, ' ');
    return words.every(function (w) { return h.indexOf(w) >= 0; });
  }

  CGP.studentInsights = {
    submissionKind: submissionKind,
    toolName: toolName,
    workReport: workReport,
    dateSearchText: dateSearchText,
    matchesSearch: matchesSearch,
    summarize: summarize,
    insights: insights,
    activity: activity,
    classMedians: classMedians,
    classGroupMedians: classGroupMedians,
    duration: duration,
    relativeDay: relativeDay,
    percentile: percentile,
    median: median,
    LATE_BUCKETS: LATE_BUCKETS
  };
})();
