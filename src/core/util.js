/* Canvas Gradebook+ - shared utilities, settings and diagnostics.
 * Loaded first in every content-script entry. Nothing here touches the DOM or the
 * chrome.* APIs at load time, so the pure logic can also be loaded inside a Node
 * vm for unit tests. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.util) return;

  CGP.VERSION = '1.9.0';

  CGP.DEFAULTS = {
    // layout
    narrowColumns: true,
    assignmentColumnWidth: 124,
    studentColumnWidth: 190,
    hideCanvasUtilityControls: true,
    maximizeHeight: true,
    frozenTotal: true,
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
    return (Math.round(n * 100) / 100) + '%';
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
    if (err && err.status === 401) {
      return 'Your Canvas session has expired. Reload the page and log back in, then try again.';
    }
    if (err && err.network === true) {
      return 'Canvas could not be reached (a network problem). Check your connection and try again.';
    }
    if (err && err.status === 429) {
      return 'Canvas asked us to slow down (rate limited). Wait a moment and try again.';
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
  util.isSessionExpiredError = function (err) { return !!(err && err.status === 401); };

  /* ---------------------------------------------------------------- settings */

  // See the snippets branch of sanitizeSettings below for why these are
  // this conservative: chrome.storage.sync caps a single stored item
  // (the whole cgp.settings blob, not just this array) at 8192 bytes.
  var MAX_SNIPPETS = 15;
  var MAX_SNIPPET_TEXT = 280;

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
        out[k] = v.map(function (s) {
          return {
            trigger: String((s && s.trigger) || '').trim().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32),
            text: String((s && s.text) || '').slice(0, MAX_SNIPPET_TEXT)
          };
        }).filter(function (s) { return s.trigger && s.text; }).slice(0, MAX_SNIPPETS);
        return;
      }
      out[k] = v;
    });
    return out;
  }
  CGP.sanitizeSettings = sanitizeSettings;

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
