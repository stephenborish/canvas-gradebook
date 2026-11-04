/* Canvas Gradebook+ - the student overview.
 *
 * Clicking a student's name in the gradebook opens one panel that answers
 * "how is this student doing?" at a glance: their grade, what is missing and
 * how many points that is, how often work arrives late and by how much, their
 * average in each assignment group against the class, a list of missing and
 * late work ready to send to a parent, counselor or the student, and what Canvas analytics knows about their activity (page views by
 * day and hour, participations, last activity, time in the course, and where
 * all of that sits in the class).
 *
 * A plain click is taken; Cmd/Ctrl/Shift/middle-click on the name still does
 * what Canvas's link does. Left/Right arrows (or the chevrons) step to the
 * previous/next student without closing.
 *
 * Data is read from Canvas when the panel opens - the student's submissions
 * with comments, Canvas course analytics if the course has it, and the course's
 * assignment groups - and is held in memory for this page only. Class
 * comparisons use the scores the gradebook model already holds. Numbers are
 * computed in core/student-insights.js. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.StudentInsightsController) return;

  var SI = function () { return CGP.studentInsights; };
  var esc = function (s) { return CGP.util.escapeHtml(String(s === null || s === undefined ? '' : s)); };
  var CACHE_MS = 90 * 1000;
  var DAY = 86400000;

  var STATUS = {
    onTime: { label: 'On time', cls: 'ontime' },
    late: { label: 'Late', cls: 'late' },
    missing: { label: 'Missing', cls: 'missing' },
    excused: { label: 'Excused', cls: 'excused' },
    graded: { label: 'Graded', cls: 'graded' },
    upcoming: { label: 'Upcoming', cls: 'upcoming' },
    notSubmitted: { label: 'Not submitted', cls: 'none' }
  };

  var ICONS = {
    risk: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 1.5 19 17.5H1zM9 7v5h2V7zm0 6.5v2h2v-2z"/></svg>',
    warn: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="currentColor"/><path fill="#fff" d="M9 5h2v6H9zm0 7.5h2v2H9z"/></svg>',
    info: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="currentColor"/><path fill="#fff" d="M9 8.5h2V15H9zm0-3.5h2v2H9z"/></svg>',
    good: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="currentColor"/><path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m6 10.2 2.7 2.7L14.2 7"/></svg>'
  };
  var LEVEL_LABEL = { risk: 'Needs attention', warn: 'Watch', info: 'Note', good: 'Going well' };

  function StudentInsightsController(ctx) {
    this.model = ctx.model;
    this.api = ctx.api;
    this.adapter = ctx.adapter;
    this.settings = ctx.settings;
    this.courseId = String(ctx.courseId);
    this._root = null;
    this._uid = null;
    this._tab = 'overview';
    this._filter = 'all';
    this._query = '';
    // What "Copy List of Missing/Late Work" copies; kept from one student to
    // the next. open: the builder is expanded.
    this._share = { missing: true, late: true, links: true, open: false };
    this._shareExcluded = {};      // assignmentId -> true, this student only
    this._courseName = '';
    this._cache = new Map();       // uid -> {at, work, activity, enrollment}
    this._course = null;           // promise: {groups, weighted}
    this._summaries = null;        // promise: student_summaries or null
    this._classLoad = null;        // promise: every column loaded
    this._gen = 0;
  }

  var P = StudentInsightsController.prototype;

  P.start = function () {
    var self = this;
    document.addEventListener('click', function (e) { self.onClick(e); }, true);
  };

  /* The student behind a click on a name in the grid, or null. */
  P.studentForClick = function (e) {
    if (!this.settings.values.studentInsights) return null;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    var t = e.target;
    var link = t && t.closest && t.closest('a');
    if (!link || !link.closest('.slick-cell')) return null;
    var href = link.getAttribute('href') || '';
    if (!/\/(grades|users)\/\d+/.test(href) && !link.classList.contains('student_context_card_trigger')) return null;
    var row = link.closest('.slick-row');
    if (!row || !row.closest('.grid-canvas')) return null;
    if (this.adapter.isTestStudentRow && this.adapter.isTestStudentRow(row)) return null;
    var uid = (link.getAttribute('data-student_id') || '').match(/^\d+$/) ? link.getAttribute('data-student_id')
      : this.adapter.studentIdFromRow(row);
    if (!uid) return null;
    return String(uid);
  };

  P.onClick = function (e) {
    var uid = this.studentForClick(e);
    if (!uid) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    this.open(uid);
  };

  /* Real students in the order Canvas sorts its roster by default. */
  P.roster = function () {
    var self = this;
    return this.model.studentOrder.filter(function (uid) {
      var s = self.model.students.get(uid);
      return s && !/^test student$/i.test(s.name || '');
    }).sort(function (a, b) {
      var x = self.model.students.get(a), y = self.model.students.get(b);
      return String(x.sortableName || x.name).localeCompare(String(y.sortableName || y.name));
    });
  };

  /* ---------------------------------------------------------------- data */

  P.courseInfo = function () {
    var self = this;
    if (!this._course) {
      this._course = Promise.all([
        this.api.assignmentGroups(this.courseId).catch(function () { return []; }),
        this.api.course(this.courseId).catch(function () { return null; })
      ]).then(function (r) {
        self._courseName = (r[1] && (r[1].name || r[1].course_code)) || '';
        return { groups: r[0] || [], weighted: !!(r[1] && r[1].apply_assignment_group_weights) };
      });
    }
    return this._course;
  };

  P.summaries = function () {
    if (!this._summaries) {
      var self = this;
      this._summaries = this.api.studentSummaries(this.courseId).catch(function () { self._summaries = null; return null; });
    }
    return this._summaries;
  };

  /* The class's scores in every column, for the medians. The gradebook
   * usually has them already (it warms every column in the background). */
  P.classScores = function () {
    var self = this;
    var missing = this.model.assignmentOrder.filter(function (id) { return !self.model.everLoadedAssignments.has(id); });
    if (!missing.length) return Promise.resolve(null);
    if (!this._classLoad) {
      this._classLoad = this.model.ensureAssignments(missing, { includeComments: false }).then(function () {
        self._classLoad = null;
      }, function () { self._classLoad = null; });
    }
    return this._classLoad;
  };

  P.studentData = function (uid, fresh) {
    var self = this;
    var hit = this._cache.get(uid);
    if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit;
    var entry = {
      at: Date.now(),
      work: this.api.studentWork(this.courseId, uid),
      activity: this.api.studentActivity(this.courseId, uid).catch(function () { return null; }),
      enrollment: this.api.enrollmentForUser(this.courseId, uid, this.model.gradingPeriodId).catch(function () { return null; })
    };
    entry.work.catch(function () { if (self._cache.get(uid) === entry) self._cache.delete(uid); });
    this._cache.set(uid, entry);
    return entry;
  };

  /* -------------------------------------------------------------- dialog */

  P.open = function (uid) {
    var self = this;
    uid = String(uid);
    this._uid = uid;
    // The previous student's summary must not feed Copy while this one loads.
    this._last = null;
    this._shareExcluded = {};
    this._filter = 'all';
    this._query = '';
    var gen = ++this._gen;
    this.ensureRoot();
    var student = this.model.students.get(uid) || { name: 'Student', fullName: '' };
    this.renderHeader(student, null);
    this.setBody('<div class="cgp-si__loading" role="status"><span class="cgp-si__spinner" aria-hidden="true"></span>Reading ' +
      esc(student.fullName || student.name) + '’s work from Canvas…</div>');

    var data = this.studentData(uid);
    var parts = { work: null, activity: undefined, enrollment: null, course: null, summaries: undefined, classReady: false };
    function draw() {
      if (gen !== self._gen || !self._root) return;
      if (!parts.work) return;
      self.renderAll(uid, parts);
    }
    var ready = this.model.ready ? Promise.resolve() : this.model.init();
    ready.then(function () {
      if (gen !== self._gen) return;
      data.work.then(function (w) { parts.work = w || []; draw(); }, function () {
        if (gen !== self._gen) return;
        self.setBody('<div class="cgp-si__empty"><b>Couldn’t read this student’s work from Canvas.</b>' +
          '<span>Check your connection and try again.</span><button type="button" class="cgp-si__btn" data-si-retry>Try again</button></div>');
      });
      data.activity.then(function (a) { parts.activity = a; draw(); });
      data.enrollment.then(function (en) { parts.enrollment = en; draw(); });
      self.courseInfo().then(function (c) { parts.course = c; draw(); }, function () {});
      self.summaries().then(function (s) { parts.summaries = s; draw(); });
      self.classScores().then(function () { parts.classReady = true; draw(); });
    }, function () {
      if (gen === self._gen) self.setBody('<div class="cgp-si__empty"><b>The gradebook hasn’t finished loading.</b><span>Try again in a moment.</span></div>');
    });
  };

  P.step = function (dir) {
    var list = this.roster();
    var i = list.indexOf(this._uid);
    if (i < 0 || !list.length) return;
    var next = list[(i + dir + list.length) % list.length];
    this.open(next);
  };

  P.ensureRoot = function () {
    if (this._root && this._root.isConnected) return this._root;
    var self = this;
    var root = document.createElement('div');
    root.className = 'cgp-si';
    root.innerHTML =
      '<div class="cgp-si__backdrop"></div>' +
      '<div class="cgp-si__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-si-name" tabindex="-1">' +
        '<header class="cgp-si__head"></header>' +
        '<nav class="cgp-si__tabs" role="tablist" aria-label="Student overview sections"></nav>' +
        '<div class="cgp-si__body"></div>' +
        '<footer class="cgp-si__foot"></footer>' +
        '<div class="cgp-si__tip" role="tooltip" hidden></div>' +
      '</div>';
    root.querySelector('.cgp-si__backdrop').addEventListener('click', function () { self.close(); });
    root.addEventListener('click', function (e) { self.onPanelClick(e); });
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('[data-si-search]')) { self._query = t.value; self.applyFilter(self._filter); }
    });
    root.addEventListener('change', function (e) {
      var t = e.target;
      var key = t && t.getAttribute && t.getAttribute('data-si-share');
      if (key) { self._share[key] = !!t.checked; self.refreshShare(); return; }
      var item = t && t.getAttribute && t.getAttribute('data-si-share-item');
      if (item) {
        if (t.checked) delete self._shareExcluded[item];
        else self._shareExcluded[item] = true;
        self.refreshShare();
      }
    });
    root.addEventListener('mouseover', function (e) { self.onTip(e); });
    root.addEventListener('focusin', function (e) { self.onTip(e); });
    root.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget || !root.contains(e.relatedTarget) || !e.relatedTarget.closest('[data-tip]')) self.hideTip();
    });
    this._onKey = function (e) {
      if (!self._root) return;
      var typing = e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault();
        if (typing && typing.matches('[data-si-search]') && typing.value) {
          typing.value = ''; self._query = ''; self.applyFilter(self._filter); return;
        }
        self.close(); return;
      }
      if (typing) return;
      var btn = e.target && e.target.closest && e.target.closest('[role="button"][data-si-tab]');
      if (btn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); btn.click(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.target && e.target.closest && e.target.closest('[role="tab"]')) return;
        e.stopPropagation(); e.preventDefault();
        self.step(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this._root = root;
    this._returnFocus = document.activeElement;
    try { root.querySelector('.cgp-si__panel').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return root;
  };

  P.close = function () {
    this._gen++;
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
    this._uid = null;
    var back = this._returnFocus;
    this._returnFocus = null;
    if (back && back.isConnected && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };

  P.onPanelClick = function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-si-close]')) { this.close(); return; }
    if (t.closest('[data-si-prev]')) { this.step(-1); return; }
    if (t.closest('[data-si-next]')) { this.step(1); return; }
    if (t.closest('[data-si-retry]')) { this._cache.delete(this._uid); this.open(this._uid); return; }
    var tab = t.closest('[data-si-tab]');
    if (tab) { this.selectTab(tab.getAttribute('data-si-tab'), tab.getAttribute('data-si-filter')); return; }
    if (t.closest('[data-si-copy]')) { this.copyReport(); return; }
    if (t.closest('[data-si-share-open]')) { this.openShare(); return; }
    if (t.closest('[data-si-share-toggle]')) { this._share.open = !this._share.open; this.refreshShare(true); return; }
    var mode = t.closest('[data-si-share-mode]');
    if (mode && !mode.disabled) {
      var m = mode.getAttribute('data-si-share-mode');
      this._share.missing = m !== 'late';
      this._share.late = m !== 'missing';
      this.refreshShare();
      return;
    }
    var chip = t.closest('[data-si-filter-chip]');
    if (chip) { this.applyFilter(chip.getAttribute('data-si-filter-chip')); return; }
  };

  P.selectTab = function (name, filter) {
    if (!this._root) return;
    this._tab = name;
    this._root.querySelectorAll('[role="tab"]').forEach(function (b) {
      var on = b.getAttribute('data-si-tab') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    this._root.querySelectorAll('[role="tabpanel"]').forEach(function (p) {
      p.hidden = p.getAttribute('data-si-panel') !== name;
    });
    if (filter) this.applyFilter(filter);
    var body = this._root.querySelector('.cgp-si__body');
    if (body) body.scrollTop = 0;
  };

  P.applyFilter = function (f) {
    if (!this._root) return;
    this._filter = f;
    this._root.querySelectorAll('[data-si-filter-chip]').forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-si-filter-chip') === f ? 'true' : 'false');
    });
    var shown = 0;
    var q = this._query || '';
    this._root.querySelectorAll('.cgp-si__table tbody tr').forEach(function (tr) {
      var tags = (tr.getAttribute('data-tags') || '').split(' ');
      var on = (f === 'all' || tags.indexOf(f) >= 0) && SI().matchesSearch(tr.getAttribute('data-search'), q);
      tr.hidden = !on;
      if (on) shown++;
    });
    var empty = this._root.querySelector('.cgp-si__table-empty');
    if (empty) empty.hidden = shown > 0;
  };

  /* One tooltip for every chart: any element with data-tip. */
  P.onTip = function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-tip]');
    if (!el || !this._root) return;
    var tip = this._root.querySelector('.cgp-si__tip');
    var panel = this._root.querySelector('.cgp-si__panel');
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    var r = el.getBoundingClientRect();
    var pr = panel.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = r.left + r.width / 2 - pr.left - tw / 2;
    x = Math.max(8, Math.min(pr.width - tw - 8, x));
    var y = r.top - pr.top - th - 8;
    if (y < 8) y = r.bottom - pr.top + 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };

  P.hideTip = function () {
    var tip = this._root && this._root.querySelector('.cgp-si__tip');
    if (tip) tip.hidden = true;
  };

  P.setBody = function (html) {
    if (!this._root) return;
    this._root.querySelector('.cgp-si__body').innerHTML = html;
    this._root.querySelector('.cgp-si__tabs').innerHTML = '';
  };

  /* ----------------------------------------------------------- rendering */

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function fmtPct(v, places) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    var f = Math.pow(10, places === undefined ? 1 : places);
    return (Math.round(v * f) / f) + '%';
  }

  function fmtNum(v, places) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    var f = Math.pow(10, places === undefined ? 2 : places);
    return String(Math.round(v * f) / f);
  }

  function fmtDate(t, withTime) {
    if (!t) return '–';
    var d = new Date(t);
    var opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
    try { return d.toLocaleString(undefined, opts); } catch (e) { return d.toDateString(); }
  }

  function hoursText(seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '–';
    var h = seconds / 3600;
    if (h < 1) return Math.round(seconds / 60) + ' min';
    return (h < 10 ? Math.round(h * 10) / 10 : Math.round(h)) + ' h';
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  P.speedGraderUrl = function (assignmentId, uid) {
    return '/courses/' + this.courseId + '/gradebook/speed_grader?assignment_id=' + encodeURIComponent(assignmentId) +
      '&student_id=' + encodeURIComponent(uid);
  };

  P.renderHeader = function (student, r) {
    if (!this._root) return;
    var name = student.fullName || student.name || 'Student';
    var list = this.roster();
    var pos = list.indexOf(this._uid);
    var score = student.currentScore;
    var letter = student.currentGrade || (score !== null && score !== undefined
      ? CGP.totals.letterFor(score, this.settings.values.gradingScale) : null);
    var tone = score === null || score === undefined ? '' : score >= 89.5 ? 'a' : score >= 79.5 ? 'b' : score >= 69.5 ? 'c' : 'd';
    var meta = [];
    if (r && r.engagement.lastActivityAt) meta.push('Last active ' + SI().lastActiveText(r.engagement.lastActivityAt, r.now));
    else if (student.lastActivityAt) meta.push('Last active ' + SI().lastActiveText(Date.parse(student.lastActivityAt), Date.now()));
    if (student.totalActivityTime) meta.push(hoursText(student.totalActivityTime) + ' in the course');
    if (pos >= 0) meta.push('Student ' + (pos + 1) + ' of ' + list.length);
    this._root.querySelector('.cgp-si__head').innerHTML =
      '<div class="cgp-si__avatar" aria-hidden="true">' + esc(initials(name)) + '</div>' +
      '<div class="cgp-si__who">' +
        '<div class="cgp-si__eyebrow">Student overview</div>' +
        '<h2 id="cgp-si-name">' + esc(name) + '</h2>' +
        '<div class="cgp-si__meta">' + meta.map(esc).join('<span aria-hidden="true"> · </span>') + '</div>' +
      '</div>' +
      '<div class="cgp-si__grade cgp-si__grade--' + tone + '" data-tip="Canvas’s current score: graded work only, with your course’s weighting and drop rules">' +
        '<b>' + (score === null || score === undefined ? '–' : fmtPct(score, 1)) + '</b>' +
        '<span>' + (letter ? esc(letter) : 'No grade yet') + '</span>' +
      '</div>' +
      '<div class="cgp-si__nav">' +
        '<button type="button" class="cgp-si__icon" data-si-prev aria-label="Previous student" title="Previous student (←)">' +
          '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button type="button" class="cgp-si__icon" data-si-next aria-label="Next student" title="Next student (→)">' +
          '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button type="button" class="cgp-si__icon" data-si-close aria-label="Close" title="Close (Esc)">' +
          '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '</div>';
    var uid = this._uid;
    var base = '/courses/' + this.courseId;
    this._root.querySelector('.cgp-si__foot').innerHTML =
      '<a class="cgp-si__link" href="' + base + '/grades/' + esc(uid) + '" target="_blank" rel="noopener">Grades page</a>' +
      '<a class="cgp-si__link" href="/conversations?context_id=course_' + esc(this.courseId) + '&amp;user_id=' + esc(uid) +
        '&amp;user_name=' + encodeURIComponent(name) + '" target="_blank" rel="noopener">Message student</a>' +
      '<a class="cgp-si__link" href="' + base + '/users/' + esc(uid) + '/usage" target="_blank" rel="noopener">Access report</a>' +
      '<button type="button" class="cgp-si__link cgp-si__link--btn" data-si-share-open title="Choose what to include, preview it and copy it">Copy list of missing/late work</button>' +
      '<span class="cgp-si__hint">← → next student · Esc to close</span>';
  };

  P.renderAll = function (uid, parts) {
    var self = this;
    var model = this.model;
    var student = Object.assign({}, model.students.get(uid) || {});
    var en = parts.enrollment;
    if (en) {
      if (en.last_activity_at) student.lastActivityAt = en.last_activity_at;
      if (en.total_activity_time !== undefined) student.totalActivityTime = en.total_activity_time;
    }
    var roster = this.roster();
    var assignments = model.assignmentOrder.map(function (id) { return model.assignments.get(id); }).filter(Boolean);
    var cellOf = function (aid, sid) { return model.cell(aid, sid); };
    // The class's medians only move once every column has loaded; the other
    // partial redraws (analytics, enrollment, course) reuse them.
    if (!parts.medians || parts.mediansReady !== parts.classReady) {
      parts.medians = SI().classMedians(cellOf, assignments, roster);
      parts.groupMedians = SI().classGroupMedians(cellOf, assignments, roster);
      parts.mediansReady = parts.classReady;
    }
    var medians = parts.medians;
    var groupMedians = parts.groupMedians;
    var r = SI().summarize({
      now: Date.now(),
      studentId: uid,
      instructorId: model.instructorId,
      classmateIds: roster.filter(function (id) { return id !== uid; }),
      assignments: assignments,
      submissions: parts.work,
      groups: parts.course ? parts.course.groups : [],
      weighted: parts.course ? parts.course.weighted : false,
      classMedians: medians,
      classGroupMedians: groupMedians,
      student: student,
      // This student's figure is the fresh one from their enrollment, the
      // same value the percentile is taken for.
      classActivityTimes: roster.map(function (id) {
        if (id === uid) return student.totalActivityTime;
        var s = model.students.get(id); return s && s.totalActivityTime;
      }),
      activity: parts.activity || null,
      summaries: parts.summaries || null
    });
    r.analyticsKnown = parts.activity !== undefined;
    r.analyticsOff = parts.activity === null;
    r.summariesKnown = parts.summaries !== undefined;
    this._last = r;

    this.renderHeader(student, r);
    var body = this._root.querySelector('.cgp-si__body');
    var keepScroll = body.scrollTop;
    // Later data (analytics, class scores) re-renders the panel; whoever is
    // typing in the search box keeps their place.
    var active = document.activeElement;
    var searching = active && active.matches && active.matches('[data-si-search]') ? { start: active.selectionStart, end: active.selectionEnd } : null;
    var c = r.counts;
    var tabs = [
      ['overview', 'Overview', ''],
      ['work', 'Assignments', c.missing ? '<span class="cgp-si__badge cgp-si__badge--missing">' + c.missing + '</span>' : ''],
      ['activity', 'Activity', '']
    ];
    this._root.querySelector('.cgp-si__tabs').innerHTML = tabs.map(function (t) {
      var on = self._tab === t[0];
      return '<button type="button" role="tab" id="cgp-si-tab-' + t[0] + '" aria-controls="cgp-si-panel-' + t[0] + '" data-si-tab="' + t[0] +
        '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + t[1] + t[2] + '</button>';
    }).join('');
    this.wireTabKeys();
    body.innerHTML =
      this.panel('overview', this.overview(r)) +
      this.panel('work', this.work(r)) +
      this.panel('activity', this.activityPanel(r));
    this.applyFilter(this._filter);
    body.scrollTop = keepScroll;
    if (searching) {
      var box = body.querySelector('[data-si-search]');
      if (box) {
        try { box.focus({ preventScroll: true }); box.setSelectionRange(searching.start, searching.end); } catch (e) { /* ignore */ }
      }
    }
  };

  P.wireTabKeys = function () {
    var self = this;
    var tabs = Array.prototype.slice.call(this._root.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (tab, i) {
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); e.stopPropagation();
        var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        self.selectTab(next.getAttribute('data-si-tab'));
        next.focus();
      });
    });
  };

  P.panel = function (name, html) {
    return '<section role="tabpanel" id="cgp-si-panel-' + name + '" aria-labelledby="cgp-si-tab-' + name + '" data-si-panel="' + name + '"' +
      (this._tab === name ? '' : ' hidden') + '>' + html + '</section>';
  };

  function tile(label, value, sub, opts) {
    opts = opts || {};
    var attrs = opts.tab ? ' role="button" tabindex="0" data-si-tab="' + opts.tab + '"' + (opts.filter ? ' data-si-filter="' + opts.filter + '"' : '') : '';
    return '<div class="cgp-si__tile' + (opts.tone ? ' cgp-si__tile--' + opts.tone : '') + (opts.tab ? ' cgp-si__tile--link' : '') + '"' + attrs +
      (opts.tip ? ' data-tip="' + esc(opts.tip) + '"' : '') + '>' +
      '<div class="cgp-si__k">' + esc(label) + '</div>' +
      '<div class="cgp-si__v">' + value + '</div>' +
      (sub ? '<div class="cgp-si__s">' + sub + '</div>' : '') + '</div>';
  }

  function section(title, html, aside) {
    return '<div class="cgp-si__card"><div class="cgp-si__card-head"><h3>' + esc(title) + '</h3>' +
      (aside ? '<span class="cgp-si__aside">' + aside + '</span>' : '') + '</div>' + html + '</div>';
  }

  /* --------------------------------------------------------- overview tab */

  P.overview = function (r) {
    var c = r.counts;
    var turnedIn = c.onTime + c.late;
    var e = r.engagement;
    var avg = r.overall ? r.overall.percent : null;
    var vsClass = r.relative.count && r.relative.avgDiff !== null
      ? (Math.round(r.relative.avgDiff) > 0 ? '+' : Math.round(r.relative.avgDiff) < 0 ? '−' : '±') + Math.abs(Math.round(r.relative.avgDiff)) + ' vs class median'
      : (r.overall ? r.overall.count + ' graded' : 'Nothing graded yet');
    var tiles = [
      tile('Missing', '<b>' + c.missing + '</b>',
        c.missing ? esc(fmtNum(r.missingPoints, 1)) + ' pts outstanding' : 'Nothing missing',
        { tone: c.missing ? (c.missing >= 3 ? 'risk' : 'warn') : 'good', tab: 'work', filter: 'missing' }),
      tile('Late', '<b>' + c.late + '</b>',
        turnedIn ? fmtPct((r.rates.late || 0) * 100, 0) + ' of submitted work' : 'No submissions yet',
        { tone: c.late && r.rates.late >= 0.25 ? 'warn' : '', tab: 'work', filter: 'late' }),
      tile('On-time rate', '<b>' + (r.rates.completion === null ? '–' : fmtPct((c.onTime / (turnedIn + c.missing)) * 100, 0)) + '</b>',
        (turnedIn + c.missing) ? c.onTime + ' of ' + (turnedIn + c.missing) + ' due so far' : 'Nothing due yet',
        { tip: 'Share of work that was due and arrived by the deadline. Excused work is left out.' }),
      tile('Average score', '<b>' + fmtPct(avg, 1) + '</b>', esc(vsClass),
        { tip: 'Points earned over points possible on graded work, unweighted. The header shows Canvas’s official current score.' }),
      tile('Needs grading', '<b>' + r.lists.needsGrading.length + '</b>',
        r.lists.needsGrading.length ? 'Submitted, not graded' : 'All caught up',
        { tab: 'work', filter: 'needs' }),
      tile('Last active', '<b>' + (e.daysSinceActivity === null ? '–' : e.daysSinceActivity === 0 ? 'Today' : e.daysSinceActivity + 'd') + '</b>',
        e.lastActivityAt ? esc(fmtDate(e.lastActivityAt, true)) : 'No activity recorded',
        { tone: e.daysSinceActivity >= 7 ? 'risk' : e.daysSinceActivity >= 4 ? 'warn' : '', tab: 'activity' })
    ].join('');

    var insights = r.insights.length
      ? '<ul class="cgp-si__insights">' + r.insights.map(function (i) {
        return '<li class="cgp-si__insight cgp-si__insight--' + i.level + '"><span class="cgp-si__insight-icon" role="img" aria-label="' +
          LEVEL_LABEL[i.level] + '">' + ICONS[i.level] + '</span><div><b>' + esc(i.text) + '</b>' +
          (i.detail ? '<span>' + esc(i.detail) + '</span>' : '') + '</div></li>';
      }).join('') + '</ul>'
      : '<p class="cgp-si__note">Nothing stands out yet — not enough graded or due work to say.</p>';

    return '<div class="cgp-si__tiles">' + tiles + '</div>' +
      '<div class="cgp-si__grid2 cgp-si__grid2--top">' +
        section('What stands out', insights) +
        '<div class="cgp-si__stackcol">' +
          section('Submission record', this.statusBar(r)) +
          (r.groups.length ? section('Average by category', this.groupBars(r), r.weightedEstimate !== null ? 'Weighted est. ' + fmtPct(r.weightedEstimate, 1) : '') : '') +
        '</div>' +
      '</div>';
  };

  P.statusBar = function (r) {
    var c = r.counts;
    var segs = [['onTime', c.onTime], ['late', c.late], ['missing', c.missing], ['excused', c.excused]];
    var total = segs.reduce(function (t, s) { return t + s[1]; }, 0);
    if (!total) return '<p class="cgp-si__note">No work has been due or submitted yet.</p>';
    var bar = '<div class="cgp-si__stack" role="img" aria-label="' + esc(segs.map(function (s) { return s[1] + ' ' + STATUS[s[0]].label.toLowerCase(); }).join(', ')) + '">' +
      segs.filter(function (s) { return s[1]; }).map(function (s) {
        return '<span class="cgp-si__seg cgp-si__seg--' + STATUS[s[0]].cls + '" style="flex:' + s[1] + ' 1 0" data-tip="' +
          esc(STATUS[s[0]].label + ': ' + s[1] + ' (' + Math.round((s[1] / total) * 100) + '%)') + '"></span>';
      }).join('') + '</div>';
    var legend = '<ul class="cgp-si__legend">' + segs.map(function (s) {
      return '<li><i class="cgp-si__sw cgp-si__sw--' + STATUS[s[0]].cls + '"></i>' + STATUS[s[0]].label + '<b>' + s[1] + '</b></li>';
    }).join('') + '</ul>';
    var extra = [];
    if (c.graded) extra.push(c.graded + ' graded without an online submission');
    if (c.notSubmitted) extra.push(c.notSubmitted + ' past due with nothing turned in (not flagged Missing)');
    if (c.upcoming) extra.push(c.upcoming + ' not due yet');
    var lateLine = r.lateness.count
      ? '<p class="cgp-si__line">When late, typically <b>' + esc(SI().duration(r.lateness.median)) + '</b> after the deadline · longest ' +
        esc(SI().duration(r.lateness.max)) + '</p>' : '';
    var streak = r.streak && r.streak.count >= 2
      ? '<p class="cgp-si__line">Current streak: <b>' + r.streak.count + ' ' + STATUS[r.streak.status].label.toLowerCase() + '</b> in a row</p>' : '';
    return bar + legend + lateLine + streak + (extra.length ? '<p class="cgp-si__note">' + esc(extra.join(' · ')) + '</p>' : '');
  };

  P.groupBars = function (r) {
    return '<ul class="cgp-si__bars">' + r.groups.map(function (g) {
      var v = g.average;
      var w = v === null ? 0 : Math.max(0, Math.min(100, v));
      var m = g.classMedian === null ? null : Math.max(0, Math.min(100, g.classMedian));
      var tip = g.name + ': ' + (v === null ? 'nothing graded' : fmtPct(v, 1) + ' over ' + g.graded + ' graded') +
        (m !== null ? ' · class median ' + fmtPct(g.classMedian, 1) : '') + (g.missing ? ' · ' + g.missing + ' missing' : '');
      return '<li data-tip="' + esc(tip) + '"><div class="cgp-si__bar-label"><span>' + esc(g.name) + '</span>' +
        (g.weight ? '<i>' + fmtNum(g.weight, 1) + '%</i>' : '') + '</div>' +
        '<div class="cgp-si__track">' + (v === null ? '' : '<span class="cgp-si__fill" style="width:' + w + '%"></span>') +
          (m !== null ? '<span class="cgp-si__tick" style="left:' + m + '%"></span>' : '') + '</div>' +
        '<b>' + (v === null ? '–' : fmtPct(v, 1)) + '</b>' +
        (g.missing ? '<span class="cgp-si__pill cgp-si__pill--missing">' + g.missing + ' missing</span>' : '<span></span>') +
        '</li>';
    }).join('') + '</ul><p class="cgp-si__note"><i class="cgp-si__key cgp-si__key--tick"></i> Class median for the category. Averages count graded work only and ignore drop rules.</p>';
  };

  /* ------------------------------------------------------- assignments tab */

  /* Where "see this student's work" goes, by how the work is handed in.
   * null for on-paper and no-submission assignments: nothing to open.
   * An external tool's submission opens in the tool through Canvas's own
   * launch - the same one SpeedGrader embeds - so the teacher lands on THIS
   * student's work in Turnitin, Edpuzzle, Google Assignments...; without a
   * per-student launch, the assignment's own launch opens the tool's
   * teacher view. */
  P.workLink = function (i) {
    if (i.kind === 'paper' || i.kind === 'none') return null;
    if (i.kind === 'tool') {
      var name = i.toolName || 'the tool';
      var href = i.submissionUrl
        ? '/courses/' + this.courseId + '/external_tools/retrieve?display=borderless&assignment_id=' + encodeURIComponent(i.id) +
          '&url=' + encodeURIComponent(i.submissionUrl)
        : this.assignmentUrl(i.id);
      return {
        href: href,
        label: 'Open in ' + name,
        primary: !!i.submittedAt,
        title: i.submissionUrl ? 'Open this student’s work in ' + name : 'Open ' + name + ' for this assignment'
      };
    }
    if (i.submittedAt) {
      return { href: this.speedGraderUrl(i.id, this._uid), label: 'View work', primary: true, title: 'Open this student’s submission in SpeedGrader' };
    }
    return { href: this.speedGraderUrl(i.id, this._uid), label: 'SpeedGrader', primary: false, title: 'Open this student in SpeedGrader' };
  };

  P.assignmentUrl = function (assignmentId) {
    return '/courses/' + this.courseId + '/assignments/' + encodeURIComponent(assignmentId);
  };

  /* ------------------------------------------- sharing missing / late work */

  P.report = function () {
    var r = this._last;
    if (!r) return null;
    var self = this;
    var origin = (typeof location !== 'undefined' && location.origin) || '';
    // No student name in the list: it goes to that student or their family,
    // and is pasted under a greeting that already says who it is about.
    return SI().workReport(r, {
      courseName: this._courseName || '',
      now: r.now,
      include: { missing: this._share.missing, late: this._share.late },
      links: this._share.links,
      exclude: this._shareExcluded,
      urlFor: function (i) { return origin + self.assignmentUrl(i.id); }
    });
  };

  P.copyReport = function () {
    var rep = this.report();
    if (!rep) { CGP.ui.toast('Still reading this student’s work from Canvas…'); return; }
    if (!this._share.missing && !this._share.late) { CGP.ui.error('Pick Missing, Late or both first.'); return; }
    if (!rep.count) { CGP.ui.error('Nothing is selected to copy - tick at least one assignment.'); return; }
    var n = rep.count;
    CGP.ui.copy(rep.text, rep.html).then(function () {
      CGP.ui.toast(n + (n === 1 ? ' assignment' : ' assignments') + ' copied — paste into an email, message or document');
    }, function () { CGP.ui.error('Couldn’t copy to the clipboard.'); });
  };

  /* The footer's "Copy list of missing/late work": straight to the builder. */
  P.openShare = function () {
    if (!this._root) return;
    this._share.open = true;
    if (this._tab !== 'assignments') this.selectTab('assignments');
    this.refreshShare(true);
    var card = this._root.querySelector('.cgp-si__share');
    if (!card && this._last) CGP.ui.toast('Nothing is missing or late for this student right now.');
    if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  };

  /* Redraw the builder in place after a choice changes. focusToggle: put the
   * focus back on the open/close button the teacher just pressed. */
  P.refreshShare = function (focusToggle) {
    if (!this._root || !this._last) return;
    var old = this._root.querySelector('.cgp-si__share');
    if (!old) return;
    var focusedItem = document.activeElement && document.activeElement.getAttribute &&
      (document.activeElement.getAttribute('data-si-share-item') || document.activeElement.getAttribute('data-si-share') ||
        document.activeElement.getAttribute('data-si-share-mode'));
    var holder = document.createElement('div');
    holder.innerHTML = this.sharePanel(this._last);
    var next = holder.firstChild;
    old.parentNode.replaceChild(next, old);
    var target = focusToggle ? next.querySelector('[data-si-share-toggle]')
      : focusedItem ? next.querySelector('[data-si-share-item="' + focusedItem + '"], [data-si-share="' + focusedItem + '"], [data-si-share-mode="' + focusedItem + '"]') : null;
    if (target && target.focus) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };

  var COPY_ICON = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="6.5" y="6.5" width="10" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M13.5 4.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v9A1.5 1.5 0 0 0 5 14.5h.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  /* "Copy List of Missing/Late Work": a single button until the teacher
   * opens it; open, it shows what to include (missing, late or both, and
   * each assignment), the exact text that will be copied, and the Copy
   * button. */
  P.sharePanel = function (r) {
    var sh = this._share;
    var L = r.lists;
    var ex = this._shareExcluded;
    var summary = [L.missing.length ? L.missing.length + ' missing' : '', L.late.length ? L.late.length + ' late' : '']
      .filter(Boolean).join(' · ');
    var toggle = '<button type="button" class="cgp-si__share-toggle" data-si-share-toggle aria-expanded="' + !!sh.open + '" aria-controls="cgp-si-share-body">' +
      '<span class="cgp-si__share-icon">' + COPY_ICON + '</span>' +
      '<span class="cgp-si__share-title">Copy List of Missing/Late Work' +
        '<small>' + esc(summary) + ' · for a parent, counselor or the student</small></span>' +
      '<svg class="cgp-si__share-chev" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';
    if (!sh.open) return '<div class="cgp-si__card cgp-si__share">' + toggle + '</div>';

    var mode = sh.missing && sh.late ? 'both' : sh.missing ? 'missing' : sh.late ? 'late' : '';
    function seg(key, label, count, disabled) {
      return '<button type="button" class="cgp-si__seg" data-si-share-mode="' + key + '" aria-pressed="' + (mode === key) + '"' +
        (disabled ? ' disabled' : '') + '>' + label + (count === undefined ? '' : ' <b>' + count + '</b>') + '</button>';
    }
    function group(title, items, on) {
      if (!items.length) return '';
      return '<fieldset class="cgp-si__share-group"' + (on ? '' : ' disabled') + '><legend>' + title + '</legend>' + items.map(function (i) {
        var id = String(i.id);
        var detail = title === 'Missing'
          ? (i.dueAt ? 'Due ' + fmtDate(i.dueAt) : 'No due date')
          : SI().duration(i.secondsLate) + ' late';
        return '<label class="cgp-si__share-item"><input type="checkbox" data-si-share-item="' + esc(id) + '"' + (on && !ex[id] ? ' checked' : '') + '>' +
          '<span>' + esc(i.name) + '</span><em>' + esc(detail) + '</em></label>';
      }).join('') + '</fieldset>';
    }
    var rep = this.report();
    var n = rep ? rep.count : 0;
    return '<div class="cgp-si__card cgp-si__share is-open">' + toggle +
      '<div class="cgp-si__share-body" id="cgp-si-share-body">' +
        '<div class="cgp-si__share-pick">' +
          '<div class="cgp-si__share-label">Include</div>' +
          '<div class="cgp-si__segs" role="group" aria-label="Which work to include">' +
            seg('both', 'Both', L.missing.length + L.late.length, !L.missing.length || !L.late.length) +
            seg('missing', 'Missing', L.missing.length, !L.missing.length) +
            seg('late', 'Late', L.late.length, !L.late.length) +
          '</div>' +
          '<div class="cgp-si__share-items">' + group('Missing', L.missing, sh.missing) + group('Late', L.late, sh.late) + '</div>' +
          '<label class="cgp-si__check"><input type="checkbox" data-si-share="links"' + (sh.links ? ' checked' : '') + '>Include a link to each assignment</label>' +
        '</div>' +
        '<div class="cgp-si__share-out">' +
          '<div class="cgp-si__share-label">Preview <span>— exactly what will be copied</span></div>' +
          '<pre class="cgp-si__preview" aria-label="What will be copied" aria-live="polite">' + esc(rep ? rep.text : '') + '</pre>' +
          '<div class="cgp-si__share-foot">' +
            '<p class="cgp-si__note">Pastes as a table with linked assignment names in Gmail, Outlook, Docs and Word; as plain lines in a text or Canvas message.</p>' +
            '<button type="button" class="cgp-si__btn cgp-si__btn--copy" data-si-copy' + (n ? '' : ' disabled') + '>' + COPY_ICON +
              (n ? 'Copy ' + n + (n === 1 ? ' assignment' : ' assignments') : 'Nothing selected') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '</div>';
  };

  /* ------------------------------------------------------- assignments tab */

  P.work = function (r) {
    var self = this;
    var uid = this._uid;
    var L = r.lists;
    var chips = [
      ['all', 'All', r.items.length],
      ['missing', 'Missing', L.missing.length],
      ['late', 'Late', L.late.length],
      ['submitted', 'Submitted', r.items.filter(function (i) { return i.submittedAt; }).length],
      ['needs', 'Needs grading', L.needsGrading.length],
      ['upcoming', 'Upcoming', r.counts.upcoming],
      ['resub', 'Resubmitted', L.resubmitted.length]
    ];
    var chipHtml = '<div class="cgp-si__chips" role="toolbar" aria-label="Filter assignments">' + chips.map(function (c) {
      return '<button type="button" class="cgp-si__chip" data-si-filter-chip="' + c[0] + '" aria-pressed="' + (self._filter === c[0]) + '"' +
        (c[2] || c[0] === 'all' ? '' : ' disabled') + '>' + c[1] + '<b>' + c[2] + '</b></button>';
    }).join('') + '</div>';
    var search = '<div class="cgp-si__search">' +
      '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m12.7 12.7 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '<input type="search" data-si-search placeholder="Search by assignment name or date (e.g. lab, Oct 12, 10/12, Monday)" aria-label="Search assignments by name or date" value="' + esc(this._query || '') + '">' +
      '</div>';

    var rows = r.items.slice().reverse().map(function (i) {
      var tags = [i.status === 'missing' ? 'missing' : '', i.status === 'late' ? 'late' : '', i.needsGrading ? 'needs' : '',
        i.status === 'upcoming' ? 'upcoming' : '', i.attempt > 1 ? 'resub' : '', i.submittedAt ? 'submitted' : ''].filter(Boolean).join(' ');
      var st = STATUS[i.status];
      var submitted = i.submittedAt
        ? esc(fmtDate(i.submittedAt, true)) + (i.status === 'late' ? '<span class="cgp-si__sub cgp-si__sub--late">' + esc(SI().duration(i.secondsLate)) + ' late</span>'
          : (i.dueAt && i.submittedAt <= i.dueAt ? '<span class="cgp-si__sub">' + esc(SI().duration((i.dueAt - i.submittedAt) / 1000)) + ' early</span>' : ''))
        : (i.status === 'missing' && i.dueAt ? '<span class="cgp-si__sub cgp-si__sub--missing">' + Math.max(0, Math.floor((r.now - i.dueAt) / DAY)) + ' days overdue</span>' : '<span class="cgp-si__muted">–</span>');
      var score = i.status === 'excused' ? '<span class="cgp-si__muted">EX</span>'
        : i.score === null ? '<span class="cgp-si__muted">–</span>'
          : fmtNum(i.score) + (i.pointsPossible ? '<span class="cgp-si__muted"> / ' + fmtNum(i.pointsPossible) + '</span>' : '') +
            (i.percent === null ? '' : '<span class="cgp-si__sub">' + fmtPct(i.percent, 0) + '</span>');
      var diff = (i.percent !== null && i.classMedian !== null) ? Math.round(i.percent - i.classMedian) : null;
      var medianCell = i.classMedian === null ? '<span class="cgp-si__muted">–</span>'
        : fmtPct(i.classMedian, 0) + (diff === null ? '' : '<span class="cgp-si__delta cgp-si__delta--' + (diff >= 2 ? 'up' : diff <= -2 ? 'down' : 'flat') + '">' +
          (diff > 0 ? '+' : diff < 0 ? '−' : '±') + Math.abs(diff) + '</span>');
      var flags = (i.needsGrading ? '<span class="cgp-si__pill cgp-si__pill--needs">Needs grading</span>' : '') +
        (i.attempt > 1 ? '<span class="cgp-si__pill">Attempt ' + i.attempt + '</span>' : '');
      var link = self.workLink(i);
      var action = link
        ? '<a class="cgp-si__work' + (link.primary ? '' : ' cgp-si__work--quiet') + '" href="' + esc(link.href) + '" target="_blank" rel="noopener" title="' +
          esc(link.title) + '">' + esc(link.label) + '</a>'
        : '<span class="cgp-si__muted" title="' + (i.kind === 'paper' ? 'Turned in on paper' : 'No online submission') + '">' +
          (i.kind === 'paper' ? 'On paper' : 'No submission') + '</span>';
      var haystack = [i.name, st.label, SI().dateSearchText(i.dueAt), SI().dateSearchText(i.submittedAt)].join(' | ');
      return '<tr data-tags="' + tags + '" data-search="' + esc(haystack.toLowerCase()) + '">' +
        '<td class="cgp-si__name-cell"><a href="' + esc(self.assignmentUrl(i.id)) + '" target="_blank" rel="noopener" title="Open the assignment">' + esc(i.name) + '</a>' + flags + '</td>' +
        '<td>' + (i.dueAt ? esc(fmtDate(i.dueAt, true)) : '<span class="cgp-si__muted">No due date</span>') + '</td>' +
        '<td><span class="cgp-si__status cgp-si__status--' + st.cls + '">' + st.label + '</span></td>' +
        '<td>' + submitted + '</td>' +
        '<td class="cgp-si__num">' + score + '</td>' +
        '<td class="cgp-si__num">' + medianCell + '</td>' +
        '<td class="cgp-si__act">' + action + '</td>' +
        '</tr>';
    }).join('');
    var table = '<div class="cgp-si__table-wrap"><table class="cgp-si__table"><thead><tr><th>Assignment</th><th>Due</th><th>Status</th><th>Submitted</th>' +
      '<th class="cgp-si__num">Score</th><th class="cgp-si__num">Class median</th><th><span class="cgp-si__sr">Open</span></th></tr></thead><tbody>' + rows +
      '</tbody></table><p class="cgp-si__table-empty cgp-si__note" hidden>No assignments match.</p></div>';

    var missingCard = L.missing.length ? section('Missing work', '<ul class="cgp-si__todo">' + L.missing.map(function (i) {
      var overdue = i.dueAt ? Math.max(0, Math.floor((r.now - i.dueAt) / DAY)) : null;
      return '<li><a href="' + esc(self.assignmentUrl(i.id)) + '" target="_blank" rel="noopener" title="Open the assignment">' + esc(i.name) + '</a>' +
        '<span>' + (i.dueAt ? 'Due ' + esc(fmtDate(i.dueAt)) + ' · ' + overdue + (overdue === 1 ? ' day' : ' days') + ' overdue' : 'No due date') + '</span>' +
        '<b>' + (i.pointsPossible ? fmtNum(i.pointsPossible) + ' pts' : '') + '</b></li>';
    }).join('') + '</ul>', fmtNum(r.missingPoints, 1) + ' pts outstanding') : '';

    var lateCard = r.lateness.count ? section('Late work', '<ul class="cgp-si__todo">' + L.late.map(function (i) {
      var link = self.workLink(i) || { href: self.assignmentUrl(i.id), title: 'Open the assignment' };
      return '<li><a href="' + esc(link.href) + '" target="_blank" rel="noopener" title="' + esc(link.title) + '">' + esc(i.name) + '</a>' +
        '<span>Due ' + esc(fmtDate(i.dueAt)) + ' · <em class="cgp-si__late-by">' + esc(SI().duration(i.secondsLate)) + ' late</em></span>' +
        '<b>' + (i.score === null ? '' : fmtNum(i.score) + (i.pointsPossible ? '/' + fmtNum(i.pointsPossible) : '')) + '</b></li>';
    }).join('') + '</ul>' + this.latenessChart(r), fmtPct((r.rates.late || 0) * 100, 0) + ' of submissions') : '';

    var upcoming = L.upcoming.length ? section('Coming up (next 14 days)', '<ul class="cgp-si__todo">' + L.upcoming.map(function (i) {
      return '<li><a href="' + esc(self.assignmentUrl(i.id)) + '" target="_blank" rel="noopener" title="Open the assignment">' + esc(i.name) + '</a><span>Due ' + esc(fmtDate(i.dueAt, true)) + ' · ' +
        esc(SI().relativeDay(i.dueAt, r.now)) + '</span><b>' + (i.pointsPossible ? fmtNum(i.pointsPossible) + ' pts' : '') + '</b></li>';
    }).join('') + '</ul>') : '';

    var top = [missingCard, lateCard].filter(Boolean);
    return (L.missing.length || L.late.length ? this.sharePanel(r) : '') +
      (top.length ? '<div class="cgp-si__grid2 cgp-si__grid2--top' + (top.length === 1 ? ' cgp-si__grid2--one' : '') + '">' + top.join('') + '</div>' : '') +
      upcoming +
      section('Every assignment', search + chipHtml + table);
  };

  P.latenessChart = function (r) {
    var b = r.lateness.buckets;
    var max = b.reduce(function (m, x) { return Math.max(m, x.count); }, 0) || 1;
    return '<ul class="cgp-si__hbars">' + b.map(function (x) {
      return '<li data-tip="' + esc(x.label + ' late: ' + x.count + (x.count === 1 ? ' submission' : ' submissions')) + '"><span>' + esc(x.label) + '</span>' +
        '<div class="cgp-si__track">' + (x.count ? '<span class="cgp-si__fill cgp-si__fill--late" style="width:' + (x.count / max) * 100 + '%"></span>' : '') + '</div>' +
        '<b>' + x.count + '</b></li>';
    }).join('') + '</ul>' +
      '<p class="cgp-si__line">Median <b>' + esc(SI().duration(r.lateness.median)) + '</b> · average <b>' + esc(SI().duration(r.lateness.mean)) +
      '</b> · longest <b>' + esc(SI().duration(r.lateness.max)) + '</b></p>';
  };

  /* ---------------------------------------------------------- activity tab */

  P.activityPanel = function (r) {
    var e = r.engagement;
    var a = r.activity;
    function versus(pctile, med, unit) {
      var bits = [];
      if (pctile !== null && pctile !== undefined) bits.push(ordinal(pctile) + ' percentile');
      if (med !== null && med !== undefined) bits.push('class median ' + med + (unit || ''));
      return bits.length ? esc(bits.join(' · ')) : '';
    }
    var tiles = [
      tile('Last active', '<b>' + (e.lastActivityAt ? esc(SI().relativeDay(e.lastActivityAt, r.now)) : '–') + '</b>',
        e.lastActivityAt ? esc(fmtDate(e.lastActivityAt, true)) : 'No activity recorded',
        { tone: e.daysSinceActivity >= 7 ? 'risk' : e.daysSinceActivity >= 4 ? 'warn' : '' }),
      tile('Time in course', '<b>' + hoursText(e.totalActivitySeconds) + '</b>',
        versus(e.activityPercentile, e.classMedianActivitySeconds === null ? null : hoursText(e.classMedianActivitySeconds)),
        { tip: 'Canvas’s total activity time for this enrollment' }),
      tile('Page views', '<b>' + (e.pageViews === null ? '–' : e.pageViews.toLocaleString()) + '</b>',
        versus(e.pageViewPercentile, e.classMedianPageViews === null ? null : Math.round(e.classMedianPageViews)),
        { tone: e.pageViewPercentile !== null && e.pageViewPercentile <= 20 ? 'warn' : '' }),
      tile('Participations', '<b>' + (e.participations === null ? '–' : e.participations) + '</b>',
        versus(e.participationPercentile, e.classMedianParticipations === null ? null : Math.round(e.classMedianParticipations)),
        { tip: 'Submissions, discussion posts, quiz attempts and other actions Canvas counts as participating' })
    ];
    if (a) {
      tiles.push(tile('Last 7 days', '<b>' + a.last7 + '</b>', 'page views'));
      tiles.push(tile('Active days', '<b>' + a.activeDays30 + '<small> / 30</small></b>', 'days with any page view'));
    }

    var out = '<div class="cgp-si__tiles">' + tiles.join('') + '</div>';
    if (!r.analyticsKnown) {
      out += '<div class="cgp-si__loading cgp-si__loading--inline" role="status"><span class="cgp-si__spinner" aria-hidden="true"></span>Reading Canvas analytics…</div>';
    } else if (!a) {
      out += '<div class="cgp-si__card"><p class="cgp-si__note">Canvas analytics isn’t available for this course, so page views by day and hour can’t be shown. ' +
        'Last activity and time in the course come from the enrollment and are shown above.</p></div>';
    } else {
      var trend30 = a.prior30 ? Math.round(((a.last30 - a.prior30) / a.prior30) * 100) : null;
      out += section('Daily page views', this.heatmap(a),
        a.last30 + ' in the last 30 days' + (trend30 !== null ? ' (' + (trend30 >= 0 ? '+' : '−') + Math.abs(trend30) + '% vs the 30 before)' : ''));
      out += '<div class="cgp-si__grid2">' +
        section('By day of week', this.columns(a.byWeekday, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], 'page views', null)) +
        section('By time of day', this.columns(a.byHour, hourLabels(), 'page views', 6)) +
        '</div>';
    }
    var t = r.timing;
    if (t.submitted) {
      var lead = t.medianLeadHours === null ? '–' : SI().duration(t.medianLeadHours * 3600);
      out += '<div class="cgp-si__grid2">' +
        section('When work gets submitted', this.columns(t.byHour, hourLabels(), 'submissions', 6) +
          '<p class="cgp-si__line">On-time work arrives a median <b>' + esc(lead) + '</b> before the deadline' +
          (t.lastMinuteShare !== null ? ' · <b>' + Math.round(t.lastMinuteShare * 100) + '%</b> within the last 2 hours' : '') + '</p>' +
          (t.lateNight ? '<p class="cgp-si__note">' + t.lateNight + ' of ' + t.submitted + ' submitted between 10 pm and 4 am.</p>' : '')) +
        section('Feedback conversation', this.feedback(r)) +
        '</div>';
    } else {
      out += section('Feedback conversation', this.feedback(r));
    }
    return out;
  };

  function hourLabels() {
    var out = [];
    for (var h = 0; h < 24; h++) out.push(h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p');
    return out;
  }

  P.feedback = function (r) {
    var f = r.feedback;
    var rows = '<dl class="cgp-si__dl">' +
      '<div><dt>Your comments</dt><dd>' + f.fromYou + '</dd></div>' +
      (f.fromTeachers > f.fromYou ? '<div><dt>Other instructors</dt><dd>' + (f.fromTeachers - f.fromYou) + '</dd></div>' : '') +
      '<div><dt>Student comments</dt><dd>' + f.fromStudent + '</dd></div>' +
      '<div><dt>Resubmissions</dt><dd>' + r.lists.resubmitted.length + '</dd></div></dl>';
    var uid = this._uid, self = this;
    var unanswered = f.unanswered.length
      ? '<p class="cgp-si__line"><b>Waiting on a reply from you:</b></p><ul class="cgp-si__todo">' + f.unanswered.map(function (u) {
        return '<li><a href="' + esc(self.speedGraderUrl(u.id, uid)) + '" target="_blank" rel="noopener">' + esc(u.name) + '</a><span>' +
          esc(SI().relativeDay(u.at, r.now)) + '</span><b></b></li>';
      }).join('') + '</ul>' : '';
    return rows + unanswered;
  };

  /* Vertical bars; labels every `every` bars (all when null). */
  P.columns = function (values, labels, unit, every) {
    var max = values.reduce(function (m, v) { return Math.max(m, v); }, 0);
    if (!max) return '<p class="cgp-si__note">No ' + esc(unit) + ' recorded.</p>';
    var W = 340, H = 130, padB = 18, padT = 6;
    var slot = W / values.length;
    var bw = Math.max(3, slot - (values.length > 12 ? 3 : 8));
    var plotH = H - padB - padT;
    var peak = values.indexOf(max);
    var svg = '<svg class="cgp-si__cols" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(unit) + ' by ' + (values.length === 7 ? 'day of week' : 'hour') + '">';
    values.forEach(function (v, i) {
      var h = (v / max) * plotH;
      var x = i * slot + (slot - bw) / 2;
      var y = padT + plotH - h;
      if (v) {
        var rr = Math.min(3, bw / 2, h);
        svg += '<path class="cgp-si__col' + (i === peak ? ' cgp-si__col--peak' : '') + '" d="M' + x + ' ' + (y + h) + 'V' + (y + rr) + 'Q' + x + ' ' + y + ' ' + (x + rr) + ' ' + y +
          'H' + (x + bw - rr) + 'Q' + (x + bw) + ' ' + y + ' ' + (x + bw) + ' ' + (y + rr) + 'V' + (y + h) + 'Z"/>';
      }
      svg += '<rect class="cgp-si__hit" x="' + (i * slot) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '" data-tip="' +
        esc(labels[i] + ': ' + v + ' ' + unit) + '"/>';
      if (every === null || i % every === 0) {
        svg += '<text class="cgp-si__axis" x="' + (i * slot + slot / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(labels[i]) + '</text>';
      }
    });
    svg += '<line class="cgp-si__baseline" x1="0" x2="' + W + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) + '"/></svg>';
    return svg + '<p class="cgp-si__note">Busiest: <b>' + esc(labels[peak]) + '</b> (' + max + ' ' + esc(unit) + ')</p>';
  };

  /* GitHub-style calendar: one column per week, Sunday on top. */
  P.heatmap = function (a) {
    var days = a.days;
    var weeks = Math.ceil(days.length / 7);
    var cell = 22, gap = 4, padL = 30, padT = 18;
    var W = padL + weeks * (cell + gap), H = padT + 7 * (cell + gap);
    var max = a.maxDay || 1;
    function level(n) {
      if (!n) return 0;
      var f = n / max;
      return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
    }
    var svg = '<svg class="cgp-si__heat" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Page views per day over the last ' + weeks + ' weeks">';
    ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach(function (l, i) {
      if (l) svg += '<text class="cgp-si__axis" x="0" y="' + (padT + i * (cell + gap) + cell - 3) + '">' + l + '</text>';
    });
    var lastMonth = -1, lastLabelWeek = -9;
    days.forEach(function (d, idx) {
      var w = Math.floor(idx / 7), dow = idx % 7;
      var x = padL + w * (cell + gap), y = padT + dow * (cell + gap);
      var dt = new Date(d.date);
      if (dow === 0 && dt.getMonth() !== lastMonth && w - lastLabelWeek >= 3) {
        lastMonth = dt.getMonth();
        lastLabelWeek = w;
        var mName = dt.toLocaleString(undefined, { month: 'short' });
        svg += '<text class="cgp-si__axis" x="' + x + '" y="11">' + esc(mName) + '</text>';
      }
      if (d.future) return;
      svg += '<rect class="cgp-si__heat-cell cgp-si__heat-' + level(d.count) + '" x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell +
        '" rx="3" data-tip="' + esc(dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ': ' +
          (d.count ? d.count + (d.count === 1 ? ' page view' : ' page views') : 'no activity')) + '"/>';
    });
    svg += '</svg>';
    var legend = '<div class="cgp-si__heat-legend">Less' + [0, 1, 2, 3, 4].map(function (l) {
      return '<i class="cgp-si__heat-cell cgp-si__heat-' + l + '"></i>';
    }).join('') + 'More</div>';
    var total = days.reduce(function (t, d) { return t + d.count; }, 0);
    var active = days.filter(function (d) { return d.count; }).length;
    var past = days.filter(function (d) { return !d.future; }).length;
    var side = '<dl class="cgp-si__dl cgp-si__dl--stack">' +
      '<div><dt>Page views, last ' + weeks + ' weeks</dt><dd>' + total.toLocaleString() + '</dd></div>' +
      '<div><dt>Days with activity</dt><dd>' + active + '<small> / ' + past + '</small></dd></div>' +
      '<div><dt>Busiest day</dt><dd>' + a.maxDay + '<small> views</small></dd></div></dl>';
    return '<div class="cgp-si__heat-row"><div class="cgp-si__heat-wrap">' + svg + legend + '</div>' + side + '</div>';
  };

  CGP.StudentInsightsController = StudentInsightsController;
})();
