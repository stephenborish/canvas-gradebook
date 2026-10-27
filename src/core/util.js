/* Canvas Gradebook+ - shared utilities, settings and diagnostics.
 * Loaded first in every content-script entry. Nothing here touches the DOM or the
 * chrome.* APIs at load time, so the pure logic can also be loaded inside a Node
 * vm for unit tests. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.util) return;

  CGP.VERSION = '1.20.0';

  /* Default letter-grade scale: the lowest rounded percentage (to 0.1) that
   * earns each letter. The last entry is the floor and always has min 0. */
  CGP.DEFAULT_GRADING_SCALE = [
    { letter: 'A+', min: 96.5 }, { letter: 'A', min: 92.5 }, { letter: 'A-', min: 89.5 },
    { letter: 'B+', min: 86.5 }, { letter: 'B', min: 82.5 }, { letter: 'B-', min: 79.5 },
    { letter: 'C+', min: 76.5 }, { letter: 'C', min: 72.5 }, { letter: 'C-', min: 69.5 },
    { letter: 'D', min: 64.5 }, { letter: 'F', min: 0 }
  ];

  CGP.DEFAULTS = {
    // layout
    narrowColumns: true,
    assignmentColumnWidth: 124,
    studentColumnWidth: 190,
    hideCanvasUtilityControls: true,
    maximizeHeight: true,
    frozenTotal: true,
    gradingScale: CGP.DEFAULT_GRADING_SCALE,
    centerAssignmentColumns: true,
    showAssignmentDueDate: true,
    hideTestStudent: true,
    // Canvas's own "View Options" checkboxes (Gradebook Settings -> View
    // Options), mirrored here so a teacher sets them once in this extension's
    // options page instead of per-course in Canvas's own settings tray. Kept
    // OFF (syncViewOptionsToCanvas) by default: applying them means driving
    // Canvas's real settings tray the same way a click would, which is only
    // worth doing when a teacher has actually opted in.
    syncViewOptionsToCanvas: false,
    gbShowNotes: false,
    gbShowUnpublishedAssignments: false,
    gbSplitStudentNames: false,
    gbHideAssignmentGroupTotals: true,
    gbHideTotalColumn: false,
    gbViewHiddenGradesIndicator: true,
    gbEnableStatusIcons: true,
    // indicators
    commentIndicator: true,
    showCommentCount: true,
    resubmissionIndicator: true,
    hiddenGradeIndicator: true,
    submissionIndicator: true,
    commentPopover: true,
    // reading
    gradeFontSize: 16,
    // input
    enableM: true,
    enableE: true,
    enableL: true,
    // A grade that earns credit, typed or pasted over a Missing somebody
    // APPLIED, hands the status back to Canvas (late_policy_status null), so
    // Canvas marks the work Late only if it really was submitted late. Off
    // means grades never touch a status at all, exactly like Canvas itself.
    liftMissingOnGrade: true,
    // Changes saved in SpeedGrader (or another gradebook tab) reach this
    // gradebook, and this gradebook's reach an open SpeedGrader, without a
    // reload; the gradebook also re-reads its visible columns when its tab
    // comes back into view.
    liveSync: true,
    spreadsheetNavigation: true,
    bulkPaste: true,
    multiCellSelection: true,
    doubleClickOpensTray: true,
    postGradesButton: true,
    hideGradeCellArrow: true,
    rowHoverHighlight: true,
    bulkConfirmThreshold: 25,
    // extras
    courseSwitcher: true,
    studentSearch: true,
    speedgraderDrafts: true,
    speedgraderStickySubmit: true,
    // Canvas's Assign To "Time" boxes: type a short key (1-4 = school periods)
    // and Tab/Enter to fill in that period's start time. Times are stored as
    // 24-hour "HH:MM" and rendered in Canvas's own 12/24-hour style on use.
    timeShortcutsEnabled: true,
    timeShortcuts: [
      { key: '1', time: '08:55' },
      { key: '2', time: '10:10' },
      { key: '3', time: '12:30' },
      { key: '4', time: '13:45' }
    ],
    snippets: [
      { trigger: 'evidence', text: 'Good claim - now tie it back to the evidence in your data so the reasoning is complete.' },
      { trigger: 'units', text: 'Check your units and significant figures; the value is right but the label is missing.' },
      { trigger: 'nice', text: 'Nicely done. Your reasoning here is clear and well supported.' }
    ],
    prefetchAllAssignments: true,
    // Copy to sections: a "Copy to sections" button in the breadcrumb of
    // every course page, for courses linked as sections of the same course
    // (sectionGroups: [{origin, courseIds}], edited from that button).
    sectionCopy: true,
    // On a new item's own page, point out that it is not in the linked
    // sections yet.
    sectionCopyNudge: true,
    sectionGroups: [],
    // Copy Roster's layout choices (Student Name column menu).
    rosterPrefs: { nameFormat: 'first-last', email: true, header: true, sortBy: 'last', separator: 'comma' },
    // Also keep these settings in the teacher's own Canvas account, so they
    // reach every computer where the teacher opens Canvas even when Chrome
    // sync is off (core/settings-mirror.js).
    settingsInCanvas: true,
    diagnostics: false
  };

  var util = (CGP.util = {});

  util.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  util.debounce = function (fn, wait) {
    var t = null, lastArgs = null;
    return function () {
      lastArgs = Array.prototype.slice.call(arguments);
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(null, lastArgs); }, wait);
    };
  };

  /* Coalesces many triggers into one animation-frame callback. All painting goes
   * through this so MutationObserver bursts cannot become a render loop. */
  util.rafBatch = function (fn, label) {
    var scheduled = false;
    return function () {
      if (scheduled) return;
      scheduled = true;
      var run = function () {
        scheduled = false;
        try { fn(); } catch (e) { CGP.diag.error((label || 'paint') + '.failed', { message: String(e && e.message) }); }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
    };
  };

  /* Promise pool: bounds concurrent Canvas requests. */
  util.pool = function (limit) {
    var active = 0, queue = [];
    function next() {
      if (active >= limit || !queue.length) return;
      var job = queue.shift();
      active++;
      Promise.resolve().then(job.task).then(
        function (v) { active--; job.res(v); next(); },
        function (e) { active--; job.rej(e); next(); }
      );
    }
    return function (task) {
      return new Promise(function (res, rej) { queue.push({ task: task, res: res, rej: rej }); next(); });
    };
  };

  util.chunk = function (arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  util.clampNum = function (v, lo, hi, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  util.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  util.cookie = function (name, cookieString) {
    var src = typeof cookieString === 'string' ? cookieString
      : (typeof document !== 'undefined' ? document.cookie : '');
    var re = new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)');
    var m = re.exec(src || '');
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  };

  util.courseIdFromPath = function (pathname) {
    var m = /\/courses\/(\d+)/.exec(String(pathname || ''));
    return m ? m[1] : null;
  };

  util.fmtPercent = function (score) {
    if (score === null || score === undefined || score === '') return '\u2014';
    var n = Number(score);
    if (!isFinite(n)) return '\u2014';
    return (Math.round(n * 10) / 10) + '%';
  };

  util.fmtDateTime = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  };

  /** One short line for an assignment header: "Due Sep 12, 11:59 PM", "Multiple
   * due dates" for differentiated assignments, or "No due date". */
  util.fmtDueDate = function (iso, hasMultipleDueDates) {
    if (hasMultipleDueDates) return 'Multiple due dates';
    if (!iso) return 'No due date';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return 'Due ' + d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return 'Due ' + d.toISOString().slice(0, 16).replace('T', ' '); }
  };

  /* A Canvas session timing out mid-page is a real, recurring edge case - a
   * teacher grading for a while, or coming back to a tab left open overnight
   * - and every write or read after that happened to fail with whatever
   * generic "(Canvas 401)" message that call site already had, which reads
   * as "something is broken here" rather than "log back in and this all
   * works again". One helper, used at the handful of places a failure is
   * actually shown to the teacher, so that specific, fixable case always
   * gets a specific, actionable message instead of guessing why Canvas said
   * no this time.
   * opts.fallback - the generic lead-in for a plain failure ("Couldn't save
   * this grade"); opts.action - what going wrong stopped ("saved", "posted"),
   * folded into the specific messages below where it reads naturally. */
  util.describeApiError = function (err, opts) {
    opts = opts || {};
    if (util.isPermissionDeniedError(err)) {
      return 'Canvas says you don\u2019t have permission to change this' +
        ' (the grading period may be closed, the course concluded, or your role may not allow it).';
    }
    if (err && err.status === 401) {
      return 'Your Canvas session has expired. Reload the page and log back in, then try again.';
    }
    if (err && err.network === true) {
      return 'Canvas could not be reached (a network problem). Check your connection and try again.';
    }
    var throttled403 = err && err.status === 403 &&
      /rate limit/i.test(String(err.snippet || '') + ' ' + String(err.canvasMessage || ''));
    if (err && (err.status === 429 || throttled403)) {
      var secs = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 0;
      return 'Canvas asked us to slow down (rate limited). ' +
        (secs > 1 ? 'Wait about ' + secs + ' seconds and try again.' : 'Wait a moment and try again.');
    }
    var base = opts.fallback || 'Canvas rejected this request';
    if (err && err.status) return base + ' (Canvas ' + err.status + ').';
    if (err && err.message) return base + ': ' + err.message + '.';
    return base + '.';
  };

  /** True for the one error shape every other check above already handles by
   * name - kept separate so a call site that only needs the yes/no (to skip
   * a retry, say, rather than to build a message) does not have to repeat the
   * status check inline. */
  util.isSessionExpiredError = function (err) {
    return !!(err && err.status === 401 && !util.isPermissionDeniedError(err));
  };

  /* Canvas uses 401 for "not allowed" as well as "not logged in"; its body
   * says which ("unauthorized" vs "unauthenticated"). A plain 403 that is
   * not throttling is a refusal too. */
  util.isPermissionDeniedError = function (err) {
    if (!err) return false;
    if (err.status === 401) {
      return err.canvasStatus === 'unauthorized' || /not authorized/i.test(String(err.canvasMessage || ''));
    }
    if (err.status === 403) return !/rate limit/i.test(String(err.snippet || '') + ' ' + String(err.canvasMessage || ''));
    return false;
  };

  /* ---------------------------------------------------------------- settings */

  // Snippets are stored one per chrome.storage.sync item (see
  // CGP.settingsStorage below), so they are bounded by sync's per-item quota
  // (QUOTA_BYTES_PER_ITEM, 8192 bytes, key included) one at a time, and by
  // its whole-extension quota (QUOTA_BYTES, 102400) all together - with room
  // left for every other setting, which share one item of their own.
  var MAX_SNIPPETS = 100;
  var MAX_SNIPPET_TEXT = 2000;
  var MAX_SNIPPET_ITEM_BYTES = 8000;
  // Leaves ~14KB of sync's 100KB for every other setting and the item keys.
  var MAX_SNIPPET_BYTES = 86000;
  // ~35 bytes each, so the whole list stays well inside the item every
  // setting but the snippets shares.
  var MAX_TIME_SHORTCUTS = 10;
  var MAX_TIME_SHORTCUT_KEY = 12;

  /** "8:55", "08:55" -> "08:55"; anything that is not a 24-hour time -> null. */
  function normalizeClock(v) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(v == null ? '' : v));
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }

  /** A shortcut key as stored: letters, digits, - and _ only, lower-cased. */
  function normalizeTimeKey(k) {
    return String(k == null ? '' : k).trim().toLowerCase().replace(/[^\w-]/g, '').slice(0, MAX_TIME_SHORTCUT_KEY);
  }

  /** UTF-8 byte length - what chrome.storage.sync's quotas actually count. */
  util.byteLength = function (str) {
    var s = String(str == null ? '' : str);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  };

  var SNIPPET_PREFIX = 'cgp.snippet.';

  /** The sync key a snippet is stored under: one per trigger, lower-cased,
   * since triggers are matched case-insensitively. */
  function snippetKey(trigger) {
    return SNIPPET_PREFIX + String(trigger || '').toLowerCase();
  }

  /** What one snippet's sync item costs against the quotas (key + JSON). */
  function snippetItemBytes(s) {
    return util.byteLength(snippetKey(s.trigger) + JSON.stringify({ trigger: s.trigger, text: s.text, pos: 999 }));
  }

  function sanitizeSettings(raw) {
    var out = {};
    var d = CGP.DEFAULTS;
    var src = raw && typeof raw === 'object' ? raw : {};
    Object.keys(d).forEach(function (k) {
      var v = src[k];
      if (v === undefined) { out[k] = d[k]; return; }
      if (typeof d[k] === 'boolean') { out[k] = !!v; return; }
      if (typeof d[k] === 'number') {
        if (k === 'assignmentColumnWidth') out[k] = Math.round(util.clampNum(v, 70, 260, d[k]));
        else if (k === 'studentColumnWidth') out[k] = Math.round(util.clampNum(v, 120, 400, d[k]));
        else if (k === 'bulkConfirmThreshold') out[k] = Math.round(util.clampNum(v, 1, 2000, d[k]));
        else if (k === 'gradeFontSize') out[k] = Math.round(util.clampNum(v, 11, 24, d[k]));
        else out[k] = util.clampNum(v, -1e9, 1e9, d[k]);
        return;
      }
      if (k === 'gradingScale') {
        // Unusable values fall back to the default scale rather than leaving
        // the Total hover without any letter grade.
        var rows = Array.isArray(v) ? v.map(function (r) {
          return { letter: String((r && r.letter) || '').trim().slice(0, 6), min: Number(r && r.min) };
        }).filter(function (r) { return r.letter && isFinite(r.min); }).slice(0, 20) : [];
        if (!rows.length) { out[k] = d[k]; return; }
        rows.forEach(function (r) { r.min = Math.max(0, Math.min(1000, Math.round(r.min * 10) / 10)); });
        rows.sort(function (a, b) { return b.min - a.min; });
        rows[rows.length - 1].min = 0;   // every score maps to some letter
        out[k] = rows;
        return;
      }
      if (k === 'timeShortcuts') {
        // As with snippets, an unusable stored value falls back to the real
        // defaults; an empty array is a real choice (no shortcuts) and stays.
        if (!Array.isArray(v)) { out[k] = d[k]; return; }
        var seen = Object.create(null);
        out[k] = v.map(function (r) {
          return { key: normalizeTimeKey(r && r.key), time: normalizeClock(r && r.time) };
        }).filter(function (r) {
          if (!r.key || !r.time || seen[r.key]) return false;
          seen[r.key] = true;
          return true;
        }).slice(0, MAX_TIME_SHORTCUTS);
        return;
      }
      if (k === 'sectionGroups') {
        out[k] = cleanSectionGroups(v);
        return;
      }
      if (k === 'rosterPrefs') {
        var rp = {};
        var given = v && typeof v === 'object' ? v : {};
        var choices = { nameFormat: ['first-last', 'last-first', 'split', 'first', 'none'], sortBy: ['last', 'first'], separator: ['comma', 'semicolon', 'newline'] };
        Object.keys(d[k]).forEach(function (f) {
          var dv = d[k][f];
          var gv = given[f];
          if (typeof dv === 'boolean') rp[f] = typeof gv === 'boolean' ? gv : dv;
          else rp[f] = choices[f] && choices[f].indexOf(gv) >= 0 ? gv : dv;
        });
        out[k] = rp;
        return;
      }
      if (k === 'snippets') {
        // Unlike every other field above, an unusable stored value here used
        // to be silently coerced to an EMPTY array rather than falling back
        // to the real defaults - so a corrupted or legacy-schema snippets
        // value (null, an object, a string) wiped the whole library,
        // built-in defaults included, on the very next load, and the next
        // save from the options page baked that loss in for good.
        if (!Array.isArray(v)) { out[k] = d[k]; return; }
        // Each snippet is its own sync item (see CGP.settingsStorage), and
        // a write past sync's quota fails as a whole, so the limits are
        // enforced here rather than left to Chrome. Triggers are matched
        // case-insensitively (core/snippets.js), so only the first of any
        // repeat is kept: it is the only one expansion could ever reach.
        var seenTrigger = Object.create(null);
        var list = v.map(function (s) {
          return {
            trigger: String((s && s.trigger) || '').trim().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32),
            text: String((s && s.text) || '').slice(0, MAX_SNIPPET_TEXT)
          };
        }).filter(function (s) {
          var t = s.trigger.toLowerCase();
          if (!s.trigger || !s.text || seenTrigger[t]) return false;
          seenTrigger[t] = true;
          return true;
        }).slice(0, MAX_SNIPPETS);
        // The quotas are in UTF-8 BYTES, not characters: accented letters
        // take 2, emoji 4. A snippet too big for one item is cut to fit, and
        // snippets past the overall budget are dropped from the end, rather
        // than letting the whole save be refused.
        list.forEach(function (s) {
          while (s.text && snippetItemBytes(s) > MAX_SNIPPET_ITEM_BYTES) s.text = s.text.slice(0, -50);
        });
        var total = list.reduce(function (t, s) { return t + snippetItemBytes(s); }, 0);
        while (list.length && total > MAX_SNIPPET_BYTES) total -= snippetItemBytes(list.pop());
        out[k] = list;
        return;
      }
      out[k] = v;
    });
    return out;
  }
  CGP.sanitizeSettings = sanitizeSettings;

  /* Linked sections: groups of courses (on one Canvas) that are the same
   * course taught to different sections - course ids, plus their names for
   * the options page. A course is in at most one group, and a group of
   * fewer than two courses is no group. Newest group first. The list is one
   * sync item (8KB per item): past the budget, the oldest groups lose their
   * names first, then the oldest groups go. */
  var MAX_SECTION_GROUPS = 30;
  var MAX_SECTION_GROUP_COURSES = 12;
  var MAX_SECTION_GROUP_BYTES = 6500;

  function cleanSectionGroups(v) {
    if (!Array.isArray(v)) return [];
    var seen = Object.create(null);
    var out = [];
    v.forEach(function (g) {
      if (!g || typeof g !== 'object') return;
      var origin = String(g.origin || '').trim().toLowerCase().replace(/\/+$/, '');
      if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) return;
      var ids = [];
      (Array.isArray(g.courseIds) ? g.courseIds : []).forEach(function (id) {
        var s = String(id == null ? '' : id).trim();
        if (!/^\d+$/.test(s) || seen[origin + '|' + s]) return;
        if (ids.length >= MAX_SECTION_GROUP_COURSES) return;
        seen[origin + '|' + s] = true;
        ids.push(s);
      });
      if (ids.length < 2 || out.length >= MAX_SECTION_GROUPS) return;
      // Course names, only so the options page can say what is linked.
      var names = {};
      var given = g.names && typeof g.names === 'object' ? g.names : {};
      ids.forEach(function (id) { if (given[id]) names[id] = String(given[id]).slice(0, 80); });
      out.push({ origin: origin, courseIds: ids, names: names });
    });
    var size = function () { return util.byteLength(JSON.stringify(out)); };
    for (var i = out.length - 1; i >= 0 && size() > MAX_SECTION_GROUP_BYTES; i--) out[i].names = {};
    while (out.length && size() > MAX_SECTION_GROUP_BYTES) out.pop();
    return out;
  }
  CGP.cleanSectionGroups = cleanSectionGroups;
  CGP.SETTINGS_LIMITS = {
    MAX_SNIPPETS: MAX_SNIPPETS, MAX_SNIPPET_TEXT: MAX_SNIPPET_TEXT, MAX_SNIPPET_BYTES: MAX_SNIPPET_BYTES,
    MAX_SNIPPET_ITEM_BYTES: MAX_SNIPPET_ITEM_BYTES,
    MAX_TIME_SHORTCUTS: MAX_TIME_SHORTCUTS, MAX_TIME_SHORTCUT_KEY: MAX_TIME_SHORTCUT_KEY,
    MAX_SECTION_GROUPS: MAX_SECTION_GROUPS, MAX_SECTION_GROUP_COURSES: MAX_SECTION_GROUP_COURSES
  };
  CGP.normalizeClock = normalizeClock;
  CGP.normalizeTimeKey = normalizeTimeKey;

  /* How settings are laid out in chrome.storage.sync, which is what carries
   * them between every computer signed in to the same Chrome profile.
   *
   *  - 'cgp.setting.<name>': one item per setting (snippets aside).
   *  - 'cgp.snippet.<trigger>': one item per snippet, {trigger, text, pos},
   *    pos being its place in the list.
   *  - 'cgp.snippetStore': 'keys' once the snippets live in those items.
   *
   * Sync settles a conflict per item, last write wins. Everything used to be
   * one item ('cgp.settings'), rewritten whole on every save, so a save from
   * any computer that had not yet received the latest settings (an options
   * page opened before sync caught up, or left open, or a laptop offline)
   * put its stale values back everywhere, and the 8KB item limit capped the
   * snippets at 15 short ones. Now a save writes only what the teacher
   * changed in that form, each setting and snippet on its own (plan()
   * below), so changes made on two computers to different settings, or
   * different snippets, both survive.
   *
   * 'cgp.settings' from older versions is still read, for any setting with
   * no item of its own, and for the snippets until 'cgp.snippetStore' is
   * set. The first save moves everything in it to its own item and removes
   * it. A computer that has never stored anything and changed nothing
   * writes nothing, so it never puts the built-in defaults over settings a
   * teacher saved elsewhere. Pure apart from read()/write(): unit tested. */
  var LEGACY_KEY = 'cgp.settings';
  var SETTING_PREFIX = 'cgp.setting.';
  var SNIPPET_STORE_KEY = 'cgp.snippetStore';

  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function storedSnippetItems(all) {
    var items = [];
    Object.keys(all || {}).forEach(function (k) {
      if (k.indexOf(SNIPPET_PREFIX) !== 0) return;
      var v = all[k];
      if (v && typeof v === 'object') items.push({ key: k, trigger: v.trigger, text: v.text, pos: Number(v.pos) });
    });
    items.sort(function (a, b) {
      var pa = isFinite(a.pos) ? a.pos : 1e9, pb = isFinite(b.pos) ? b.pos : 1e9;
      return (pa - pb) || String(a.trigger).localeCompare(String(b.trigger));
    });
    return items;
  }

  function legacyOf(all) {
    var v = all && all[LEGACY_KEY];
    return v && typeof v === 'object' ? v : null;
  }

  /** Every stored item -> the raw settings object sanitizeSettings expects. */
  function assemble(all) {
    all = all || {};
    var raw = Object.assign({}, legacyOf(all) || {});
    Object.keys(all).forEach(function (k) {
      if (k.indexOf(SETTING_PREFIX) === 0) raw[k.slice(SETTING_PREFIX.length)] = all[k];
    });
    if (all[SNIPPET_STORE_KEY] === 'keys') {
      raw.snippets = storedSnippetItems(all).map(function (it) { return { trigger: it.trigger, text: it.text }; });
    }
    return raw;
  }

  /* The writes that turn `all` (everything stored right now) into what the
   * teacher meant: the settings and snippets that differ between `base`
   * (what their form started from, or null to replace everything) and
   * `next` (what it holds now), and nothing else. Returns
   * {set: {key: value}, remove: [key], problem: string|null}; a problem
   * means nothing may be written. */
  function plan(all, base, next) {
    all = all || {};
    var out = { set: {}, remove: [], problem: null };
    var legacy = legacyOf(all);
    var migrated = all[SNIPPET_STORE_KEY] === 'keys';

    Object.keys(CGP.DEFAULTS).forEach(function (k) {
      if (k === 'snippets') return;
      var key = SETTING_PREFIX + k;
      var value;
      if (!base || !sameJson(base[k], next[k])) value = next[k];
      else if (Object.prototype.hasOwnProperty.call(all, key)) return;      // untouched, already its own item
      else if (legacy && legacy[k] !== undefined) value = sanitizeSettings(assemble(all))[k];   // moved out of cgp.settings
      else return;                                                         // never stored: the default stays implicit
      if (!sameJson(all[key], value)) out.set[key] = value;
    });

    var snippetsChanged = !base || !sameJson(base.snippets, next.snippets);
    var legacySnippets = !migrated && legacy && Array.isArray(legacy.snippets);
    if (snippetsChanged || legacySnippets) {
      // The snippets as stored now (the built-in ones when none ever were,
      // since that is what every computer shows), keyed by lower-cased trigger.
      var current = {};
      var currentList = migrated
        ? storedSnippetItems(all)
        : sanitizeSettings(assemble(all)).snippets.map(function (s, i) { return { trigger: s.trigger, text: s.text, pos: i }; });
      currentList.forEach(function (it) { current[String(it.trigger).toLowerCase()] = { trigger: it.trigger, text: it.text, pos: it.pos }; });
      if (snippetsChanged) {
        var mine = {};
        (next.snippets || []).forEach(function (s, i) { mine[s.trigger.toLowerCase()] = { trigger: s.trigger, text: s.text, pos: i }; });
        var before = {};
        if (base) (base.snippets || []).forEach(function (s, i) { before[s.trigger.toLowerCase()] = { trigger: s.trigger, text: s.text, pos: i }; });
        // Removed in this form: removed. Added or edited (text, case or
        // place): written. Untouched: whatever is stored stays.
        Object.keys(before).forEach(function (t) { if (!mine[t]) delete current[t]; });
        Object.keys(mine).forEach(function (t) { if (!base || !sameJson(before[t], mine[t])) current[t] = mine[t]; });
        // A form that started from nothing stored (base null) replaces it all.
        if (!base) Object.keys(current).forEach(function (t) { if (!mine[t]) delete current[t]; });
      }
      // Snippets saved on another computer meanwhile count too: the merged
      // library must still fit, or the save is refused rather than leaving
      // items stored that every reader then quietly drops.
      var triggers = Object.keys(current);
      var bytes = triggers.reduce(function (t, k) { return t + snippetItemBytes(current[k]); }, 0);
      if (triggers.length > MAX_SNIPPETS || bytes > MAX_SNIPPET_BYTES) {
        out.problem = 'Together with the snippets saved on another computer, that makes ' + triggers.length +
          ' snippets (' + bytes + ' bytes), and at most ' + MAX_SNIPPETS + ' snippets (' + MAX_SNIPPET_BYTES +
          ' bytes) fit in Chrome sync. Remove some snippets, then save again.';
        out.set = {};
        return out;
      }
      triggers.forEach(function (t) {
        var key = snippetKey(t);
        if (!sameJson(all[key], current[t])) out.set[key] = current[t];
      });
      Object.keys(all).forEach(function (k) {
        if (k.indexOf(SNIPPET_PREFIX) === 0 && !current[k.slice(SNIPPET_PREFIX.length)]) out.remove.push(k);
      });
      if (!migrated) out.set[SNIPPET_STORE_KEY] = 'keys';
    }
    // Everything in the old single item now has an item of its own.
    if (legacy) out.remove.push(LEGACY_KEY);
    return out;
  }

  function isSettingsKey(k) {
    k = String(k);
    return k === LEGACY_KEY || k === SNIPPET_STORE_KEY || k.indexOf(SETTING_PREFIX) === 0 || k.indexOf(SNIPPET_PREFIX) === 0;
  }

  CGP.settingsStorage = {
    LEGACY_KEY: LEGACY_KEY,
    SETTING_PREFIX: SETTING_PREFIX,
    SNIPPET_PREFIX: SNIPPET_PREFIX,
    snippetKey: snippetKey,
    snippetItemBytes: snippetItemBytes,
    assemble: assemble,
    plan: plan,
    isSettingsKey: isSettingsKey,
    /** Everything stored, as one sanitized settings object, plus the raw items. */
    read: function () {
      return chrome.storage.sync.get(null).then(function (all) {
        all = all || {};
        return { all: all, values: sanitizeSettings(assemble(all)) };
      });
    },
    /* Write what changed between base and next on top of what is stored
     * now. Resolves with the settings as stored afterwards; rejects, having
     * written nothing, when the result would not fit. */
    write: function (base, next) {
      var self = this;
      return chrome.storage.sync.get(null).then(function (all) {
        var p = plan(all || {}, base, next);
        if (p.problem) throw new Error(p.problem);
        // Set before remove: the two never share a key, and a refused set
        // must not leave the old values already deleted.
        var work = Promise.resolve();
        if (Object.keys(p.set).length) work = work.then(function () { return chrome.storage.sync.set(p.set); });
        if (p.remove.length) work = work.then(function () { return chrome.storage.sync.remove(p.remove); });
        return work.then(function () { return self.read(); }).then(function (r) { return r.values; });
      });
    }
  };

  CGP.settings = {
    values: sanitizeSettings({}),
    _cbs: [],
    STORAGE_KEY: LEGACY_KEY,
    load: function () {
      var self = this;
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        return Promise.resolve(self.values);
      }
      return CGP.settingsStorage.read().then(function (r) {
        self.values = r.values;
        CGP.diag.enabled = !!self.values.diagnostics;
        if (chrome.storage.onChanged && !self._bound) {
          self._bound = true;
          chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== 'sync' || !Object.keys(changes).some(isSettingsKey)) return;
            // A change can span several items (a snippet and the settings
            // object, say), so the whole set is read back rather than patched.
            CGP.settingsStorage.read().then(function (fresh) {
              self.values = fresh.values;
              CGP.diag.enabled = !!self.values.diagnostics;
              self._cbs.forEach(function (cb) { try { cb(self.values); } catch (e) { /* ignore */ } });
            }, function () { /* keep what we have */ });
          });
        }
        return self.values;
      }, function () { return self.values; });
    },
    save: function (patch) {
      var self = this;
      var prior = this.values;
      var next = sanitizeSettings(Object.assign({}, this.values, patch || {}));
      this.values = next;
      if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve(next);
      return CGP.settingsStorage.write(prior, next).then(function (stored) {
        self.values = stored;
        return stored;
      }, function (err) {
        // The in-memory value was already optimistically updated above; a
        // rejected write (quota exceeded, a sync conflict) must not leave
        // this tab believing the change took when nothing was actually
        // persisted. Rolled back so this tab matches what is really saved.
        self.values = prior;
        CGP.diag.error('settings.saveFailed', { message: String(err && err.message) });
        throw err;
      });
    },
    onChange: function (cb) { this._cbs.push(cb); }
  };

  /* ------------------------------------------------------------ diagnostics */

  var flushTimer = null;
  CGP.diag = {
    enabled: false,
    counters: Object.create(null),
    facts: Object.create(null),
    events: [],
    maxEvents: 160,
    bump: function (k, n) { this.counters[k] = (this.counters[k] || 0) + (n === undefined ? 1 : n); this._flushSoon(); },
    set: function (k, v) { this.facts[k] = v; this._flushSoon(); },
    log: function (k, data) { this._push('info', k, data); },
    warn: function (k, data) { this._push('warn', k, data); },
    error: function (k, data) { this.counters.errors = (this.counters.errors || 0) + 1; this._push('error', k, data); },
    _push: function (level, k, data) {
      this.events.push({ t: Date.now(), level: level, k: k, data: data === undefined ? null : data });
      if (this.events.length > this.maxEvents) this.events.shift();
      if (this.enabled && typeof console !== 'undefined') {
        var fn = level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'log');
        try { console[fn]('[Gradebook+]', k, data === undefined ? '' : data); } catch (e) { /* ignore */ }
      }
      this._flushSoon();
    },
    snapshot: function () {
      var page = '';
      try { page = typeof location !== 'undefined' ? location.origin + location.pathname : ''; } catch (e) { page = ''; }
      return {
        version: CGP.VERSION, at: Date.now(), page: page,
        counters: Object.assign({}, this.counters),
        facts: Object.assign({}, this.facts),
        events: this.events.slice(-90)
      };
    },
    _flushSoon: function () {
      var self = this;
      if (!self.enabled) return;
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      if (flushTimer) return;
      flushTimer = setTimeout(function () {
        flushTimer = null;
        try { chrome.storage.local.set({ 'cgp.diag': self.snapshot() }); } catch (e) { /* ignore */ }
      }, 1500);
    }
  };
})();
