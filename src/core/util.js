/* Canvas Gradebook+ - shared utilities, settings and diagnostics.
 * Loaded first in every content-script entry. Nothing here touches the DOM or the
 * chrome.* APIs at load time, so the pure logic can also be loaded inside a Node
 * vm for unit tests. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.util) return;

  CGP.VERSION = '1.14.2';

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

  // See the snippets branch of sanitizeSettings below for why these are
  // this conservative: chrome.storage.sync caps a single stored item
  // (the whole cgp.settings blob, not just this array) at 8192 bytes.
  var MAX_SNIPPETS = 15;
  var MAX_SNIPPET_TEXT = 280;
  // Leaves ~2KB of the 8192-byte item for every other setting.
  var MAX_SNIPPET_BYTES = 6000;
  // ~35 bytes each, so the whole list stays well inside what the snippet
  // budget above leaves for "every other setting".
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
      if (k === 'snippets') {
        // Unlike every other field above, an unusable stored value here used
        // to be silently coerced to an EMPTY array rather than falling back
        // to the real defaults - so a corrupted or legacy-schema snippets
        // value (null, an object, a string) wiped the whole library,
        // built-in defaults included, on the very next load, and the next
        // save from the options page baked that loss in for good.
        if (!Array.isArray(v)) { out[k] = d[k]; return; }
        // MAX_SNIPPET_TEXT/MAX_SNIPPETS keep the whole cgp.settings blob
        // (this array plus every other setting) under chrome.storage.sync's
        // real per-item quota (QUOTA_BYTES_PER_ITEM, 8192 bytes) - a limit
        // the old 60-snippets-of-4000-chars ceiling could exceed by itself,
        // several times over. Saving past that quota fails the ENTIRE write
        // atomically, silently discarding every other pending setting change
        // in the same save, not just the snippets.
        var list = v.map(function (s) {
          return {
            trigger: String((s && s.trigger) || '').trim().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32),
            text: String((s && s.text) || '').slice(0, MAX_SNIPPET_TEXT)
          };
        }).filter(function (s) { return s.trigger && s.text; }).slice(0, MAX_SNIPPETS);
        // The quota is in UTF-8 BYTES, not characters: 15 x 280 characters
        // of accented, CJK or quote-heavy text can be two to three times
        // the budget on its own. Snippets past the byte budget are dropped
        // from the end rather than letting the whole save be refused.
        while (list.length && util.byteLength(JSON.stringify(list)) > MAX_SNIPPET_BYTES) list.pop();
        out[k] = list;
        return;
      }
      out[k] = v;
    });
    return out;
  }
  CGP.sanitizeSettings = sanitizeSettings;
  CGP.SETTINGS_LIMITS = {
    MAX_SNIPPETS: MAX_SNIPPETS, MAX_SNIPPET_TEXT: MAX_SNIPPET_TEXT, MAX_SNIPPET_BYTES: MAX_SNIPPET_BYTES,
    MAX_TIME_SHORTCUTS: MAX_TIME_SHORTCUTS, MAX_TIME_SHORTCUT_KEY: MAX_TIME_SHORTCUT_KEY
  };
  CGP.normalizeClock = normalizeClock;
  CGP.normalizeTimeKey = normalizeTimeKey;

  CGP.settings = {
    values: sanitizeSettings({}),
    _cbs: [],
    STORAGE_KEY: 'cgp.settings',
    load: function () {
      var self = this;
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        return Promise.resolve(self.values);
      }
      return chrome.storage.sync.get(self.STORAGE_KEY).then(function (got) {
        self.values = sanitizeSettings(got && got[self.STORAGE_KEY]);
        CGP.diag.enabled = !!self.values.diagnostics;
        if (chrome.storage.onChanged && !self._bound) {
          self._bound = true;
          chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== 'sync' || !changes[self.STORAGE_KEY]) return;
            self.values = sanitizeSettings(changes[self.STORAGE_KEY].newValue);
            CGP.diag.enabled = !!self.values.diagnostics;
            self._cbs.forEach(function (cb) { try { cb(self.values); } catch (e) { /* ignore */ } });
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
      var payload = {}; payload[this.STORAGE_KEY] = next;
      return chrome.storage.sync.set(payload).then(function () { return next; }, function (err) {
        // The in-memory value was already optimistically updated above; a
        // rejected write (quota exceeded, a sync conflict) must not leave
        // this tab believing the change took when nothing was actually
        // persisted - the next load (or any other open tab) would silently
        // revert to the old value with no explanation. Rolled back here so
        // at least THIS tab stays consistent with what is really saved.
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
