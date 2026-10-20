/* Canvas Gradebook+ - page-world bridge for the gradebook.
 *
 * Registered (manifest.json / background.js) as a MAIN-world document_start
 * script on gradebook URLs only. Content scripts run in an isolated world and
 * can reach neither Canvas's window.ENV, its SlickGrid object nor its
 * Gradebook object, so this script does these jobs on their behalf:
 *
 *  1. ENV: posts a short allowlist of identifiers ({source:'cgp-env'}) - never
 *     student data, grades or comments - and re-posts the grading period
 *     whenever it changes in-page (URL ?grading_period_id or the gradebook
 *     options object), so the content script's Total stays scoped correctly.
 *  2. Columns: on a {source:'cgp-grid-request'} from layout.js, applies the
 *     teacher's column widths through SlickGrid's own setColumns in one
 *     transaction and answers with {source:'cgp-grid-response'}. Until such a
 *     request arrives nothing about the grid is changed. Only Canvas's own
 *     gradebook grid (inside #gradebook_grid) is ever patched, only the
 *     student, total and assignment_<id> columns are ever resized, and
 *     maxWidth is never pinned, so teachers can still drag-resize.
 *  3. Canvas's store: every submission the content script saves (or learns
 *     changed elsewhere) is handed to Canvas's own gradebook store, so its
 *     cells, Total and Grade Detail Tray show it without a reload. See
 *     "Canvas's own gradebook store" below.
 *
 * Canvas's own writes on this page are watched by write-watch.js. */
(function () {
  'use strict';
  if (window.__cgpBridgeLoaded) return;
  window.__cgpBridgeLoaded = true;

  var GRADEBOOK_PATH = /\/courses\/\d+\/gradebook\/?$/;
  var TOTAL_WIDTH = 84;          // the frozen-Total feature's slot (frozen-total.js)
  var MIN_WIDTH_FLOOR = 24;      // minWidth is only ever lowered to this
  var SEARCH_EVERY_MS = 1500;
  var SEARCH_BUDGET_MS = 60000;
  var POLL_EVERY_MS = 2000;
  var ENV_REPEAT_TICKS = 30;     // keep re-posting the full ENV for ~60s

  function onGradebookPage() {
    try { return GRADEBOOK_PATH.test(String(window.location.pathname || '')); } catch (e) { return false; }
  }

  function post(message) {
    try { window.postMessage(message, window.location.origin); } catch (e) { /* never break the page */ }
  }

  /* ------------------------------------------------------------------ ENV */

  function gradebookOptions() {
    var ENV = window.ENV || {};
    return ENV.GRADEBOOK_OPTIONS || {};
  }

  /* Which grading period Canvas's OWN Total column is scoped to right now.
   * An explicit ?grading_period_id= wins (Canvas honours it); otherwise the
   * gradebook options object. null = whole course; "0" = "All Grading
   * Periods", which the model also treats as the whole course. */
  function currentGradingPeriodId() {
    try {
      var m = /[?&]grading_period_id=([^&#]*)/.exec(String(window.location.search || ''));
      if (m && m[1] !== '') return decodeURIComponent(m[1]);
    } catch (e) { /* fall through */ }
    var id = gradebookOptions().current_grading_period_id;
    return (id === undefined || id === null) ? null : String(id);
  }

  function envPayload() {
    var ENV = window.ENV || {};
    var opts = ENV.GRADEBOOK_OPTIONS || {};
    var payload = {
      currentUserId: ENV.current_user_id === undefined ? null : String(ENV.current_user_id),
      courseId: (ENV.COURSE_ID || ENV.course_id || opts.context_id || null),
      gradebookEditable: opts.gradebook_is_editable === undefined ? null : !!opts.gradebook_is_editable,
      gradingPeriodsEnabled: !!(opts.grading_period_set || opts.multiple_grading_periods_enabled),
      currentGradingPeriodId: currentGradingPeriodId(),
      postPolicies: !!opts.post_policies_enabled
    };
    if (payload.courseId !== null) payload.courseId = String(payload.courseId);
    return payload;
  }

  var lastPeriod;   // undefined until the first post

  /* At document_start ENV usually does not exist yet, and the content
   * script's listener may attach later still - so the full payload is
   * posted once ENV exists and repeated for a while (setGradingPeriod
   * ignores an unchanged period); after that only a change is posted. */
  var envTicks = 0;
  function pollEnv() {
    try {
      if (!window.ENV) return;
      envTicks++;
      if (lastPeriod === undefined || envTicks <= ENV_REPEAT_TICKS) {
        var payload = envPayload();
        lastPeriod = payload.currentGradingPeriodId;
        post({ source: 'cgp-env', env: payload });
        return;
      }
      var period = currentGradingPeriodId();
      if (period !== lastPeriod) {
        lastPeriod = period;
        post({ source: 'cgp-env', env: { currentGradingPeriodId: period } });
      }
    } catch (e) { /* Canvas layout differences must never break the page */ }
  }

  /* ------------------------------------------------------------- the grid */

  var cgpState = window.__cgpState = { active: false, narrow: false, hideTotal: false, moveTotal: false, studentWidth: null, assignmentWidth: null };

  function isWindow(obj) {
    if (!obj) return false;
    try {
      if (obj === window) return true;
      if (typeof Window !== 'undefined' && obj instanceof Window) return true;
      if (obj.window === obj || obj.self === obj) return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  function validGrid(grid) {
    if (!grid || typeof grid !== 'object' || isWindow(grid)) return false;
    try {
      return typeof grid.getColumns === 'function' && typeof grid.setColumns === 'function';
    } catch (e) {
      return false;
    }
  }

  function gradebookRoot() {
    try {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
      return document.querySelector('#gradebook_grid') ||
        document.querySelector('[data-component="GradebookGrid"]') ||
        document.querySelector('.gradebook-grid');
    } catch (e) {
      return null;
    }
  }

  function within(node, root) {
    if (!node || !root) return false;
    if (node === root) return true;
    try { return typeof root.contains === 'function' && root.contains(node); } catch (e) { return false; }
  }

  function resolveContainer(c) {
    try {
      if (!c) return null;
      if (c.nodeType === 1) return c;
      if (typeof c === 'string' && typeof document !== 'undefined') return document.querySelector(c);
      if (c.jquery && c[0]) return c[0];
    } catch (e) { /* ignore */ }
    return null;
  }

  function containerOf(grid) {
    try {
      if (typeof grid.getContainerNode === 'function') {
        var node = grid.getContainerNode();
        if (node) return node;
      }
    } catch (e) { /* ignore */ }
    return grid.__cgpContainer || null;
  }

  /* Canvas's gradebook grid, not some other SlickGrid on the page (a modal,
   * a tray): its container must sit inside the gradebook root. A grid with
   * no reachable container counts only if it was found ON that root. */
  function inGradebook(grid, foundOn, knownRoot) {
    var root = knownRoot || gradebookRoot();
    if (!root) return false;
    var container = containerOf(grid);
    if (container) return within(container, root);
    return within(foundOn, root);
  }

  function gridConnected(grid) {
    var container = containerOf(grid);
    return !container || container.isConnected !== false;
  }

  var GRID_KEYS = ['slickGrid', 'slickgrid', 'grid', '_grid', '__slickGrid', 'gridInstance', 'table', 'current'];

  /* obj itself, or a grid held under one of the usual property names. */
  function gridFrom(obj) {
    if (!obj || typeof obj !== 'object' || isWindow(obj)) return null;
    try {
      if (validGrid(obj)) return obj;
      for (var i = 0; i < GRID_KEYS.length; i++) {
        var v = obj[GRID_KEYS[i]];
        if (validGrid(v)) return v;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* gridFrom on obj and (shallowly) on each of its own values. */
  function scanObject(obj) {
    var g = gridFrom(obj);
    if (g || !obj || typeof obj !== 'object' || isWindow(obj)) return g;
    var n = 0;
    try {
      for (var k in obj) {
        if (++n > 60) break;
        g = gridFrom(obj[k]);
        if (g) return g;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function accept(grid, foundOn, root) {
    if (!grid || !inGradebook(grid, foundOn, root)) return null;
    try {
      if (!containerOf(grid) && foundOn && foundOn.nodeType === 1) grid.__cgpContainer = foundOn;
    } catch (e) { /* ignore */ }
    window.__cgpLiveGrid = grid;
    return grid;
  }

  /* Look for Canvas's grid object on and around the gradebook root only:
   * element properties, jQuery data, then a bounded walk of the React fibers
   * attached to those elements. */
  function findGrid() {
    var live = window.__cgpLiveGrid;
    if (live && validGrid(live) && gridConnected(live)) return live;
    // Canvas's own Gradebook object holds the grid outright.
    var gb = findGradebook();
    var owned = gb && gb.gradebookGrid && gb.gradebookGrid.grid;
    if (owned && validGrid(owned)) {
      window.__cgpLiveGrid = owned;
      return owned;
    }
    var root = gradebookRoot();
    if (!root) return null;

    var els = [root];
    try {
      if (typeof root.querySelectorAll === 'function') {
        var inner = root.querySelectorAll('.slickgrid-container, .slick-pane, .slick-viewport, .slick-header, .grid-canvas');
        els = els.concat(Array.prototype.slice.call(inner, 0, 20));
      }
      var up = root.parentElement;
      for (var u = 0; u < 3 && up; u++) { els.push(up); up = up.parentElement; }
    } catch (e) { /* ignore */ }

    var jq = window.jQuery || window.$;
    var found;
    for (var d = 0; d < els.length; d++) {
      var el = els[d];
      if (!el) continue;
      found = accept(gridFrom(el), el, root);
      if (found) return found;
      try {
        for (var ek in el) {
          if (ek.indexOf('jQuery') !== 0) continue;
          var jData = el[ek];
          found = accept(gridFrom(jData) || (jData && gridFrom(jData.data)), el, root);
          if (found) return found;
        }
      } catch (e) { /* ignore */ }
      if (typeof jq === 'function') {
        try {
          found = accept(scanObject(jq(el).data()), el, root);
          if (found) return found;
        } catch (e) { /* ignore */ }
      }
    }

    // React fibers hanging off those same elements (bounded BFS).
    try {
      var queue = [];
      for (var f = 0; f < els.length; f++) {
        var fel = els[f];
        if (!fel || typeof fel !== 'object') continue;
        for (var p in fel) {
          if (p.indexOf('__reactContainer') === 0) {
            var cr = fel[p];
            if (cr) queue.push(cr.current || cr);
          } else if (p.indexOf('__reactFiber') === 0 || p.indexOf('__reactInternalInstance') === 0) {
            if (fel[p]) queue.push(fel[p]);
          }
        }
      }
      var visited = new Set();
      var NodeCtor = typeof Node === 'function' ? Node : null;
      var count = 0;
      while (queue.length && count < 4000) {
        var fiber = queue.shift();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);
        count++;
        var sn = fiber.stateNode;
        if (sn && typeof sn === 'object' && !(NodeCtor && sn instanceof NodeCtor)) {
          found = accept(scanObject(sn), root, root);
          if (found) return found;
        }
        var hook = fiber.memoizedState;
        for (var h = 0; hook && typeof hook === 'object' && h < 100; h++) {
          found = accept(scanObject(hook.memoizedState), root, root);
          if (found) return found;
          hook = hook.next;
        }
        if (fiber.memoizedProps && typeof fiber.memoizedProps === 'object') {
          found = accept(scanObject(fiber.memoizedProps), root, root);
          if (found) return found;
        }
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
        if (fiber.return && !visited.has(fiber.return)) queue.push(fiber.return);
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  // Grids Canvas constructs after this script ran (document_start).
  function wrapGridConstructor(Orig) {
    if (typeof Orig !== 'function' || Orig.__cgpWrapped) return Orig;
    var Wrapped = function (container, data, columns, options) {
      var inst = new Orig(container, data, columns, options);
      try {
        if (!containerOf(inst)) {
          var node = resolveContainer(container);
          if (node) inst.__cgpContainer = node;
        }
        if (accept(inst, null)) patchGrid(inst);
      } catch (e) { /* ignore */ }
      return inst;
    };
    Wrapped.prototype = Orig.prototype;
    for (var k in Orig) {
      if (Object.prototype.hasOwnProperty.call(Orig, k)) Wrapped[k] = Orig[k];
    }
    Wrapped.__cgpWrapped = true;
    return Wrapped;
  }

  function hookSlick(s) {
    if (!s || typeof s !== 'object') return;
    if (s.Grid) s.Grid = wrapGridConstructor(s.Grid);
    var innerGrid = s.Grid;
    try {
      Object.defineProperty(s, 'Grid', {
        configurable: true,
        enumerable: true,
        get: function () { return innerGrid; },
        set: function (val) { innerGrid = wrapGridConstructor(val); }
      });
    } catch (e) { /* ignore */ }
  }
  var slick = window.Slick;
  if (slick) hookSlick(slick);
  try {
    Object.defineProperty(window, 'Slick', {
      configurable: true,
      enumerable: true,
      get: function () { return slick; },
      set: function (val) { slick = val; hookSlick(val); }
    });
  } catch (e) { /* ignore */ }

  var jqAtStart = window.jQuery || window.$;
  if (jqAtStart && jqAtStart.fn && !jqAtStart.fn.__cgpDataHooked && typeof jqAtStart.fn.data === 'function') {
    var origData = jqAtStart.fn.data;
    jqAtStart.fn.data = function (key, value) {
      if (arguments.length >= 2 && (key === 'slickgrid' || key === 'slickGrid' || key === 'grid') && validGrid(value)) {
        try { if (accept(value, this && this[0])) patchGrid(value); } catch (e) { /* ignore */ }
      }
      return origData.apply(this, arguments);
    };
    jqAtStart.fn.__cgpDataHooked = true;
  }

  /* Only the column kinds this extension sizes; everything else - custom
   * columns, assignment groups, Final Grade Override, split-name or any
   * unknown column - is 'other' and is never touched. */
  function columnKind(column) {
    if (!column) return null;
    var id = String(column.id || column.field || '').toLowerCase().replace(/^slickgrid_\d+_?/, '');
    if (id === 'student') return 'student';
    if (id === 'total_grade') return 'total';
    if (/^assignment_\d+$/.test(id)) return 'assignment';
    return 'other';
  }

  /* The width this extension wants for a column right now, or null for
   * "leave it alone" (inactive, narrowing off, or not a sized kind). */
  function wantedWidth(kind) {
    if (!cgpState.active) return null;
    if (kind === 'total') return cgpState.hideTotal ? TOTAL_WIDTH : null;
    if (!cgpState.narrow) return null;
    if (kind === 'student') return cgpState.studentWidth;
    if (kind === 'assignment') return cgpState.assignmentWidth;
    return null;
  }

  /* Width only. minWidth is lowered just enough to allow the width; maxWidth
   * is never set, so the teacher's own drag-resize keeps working. */
  // Canvas's own width for every column this bridge has resized, so a
  // setting turned off later (narrow columns, frozen Total) puts the column
  // back the way Canvas had it instead of leaving it at our width.
  var origWidths = {};

  function applyWidth(col) {
    var key = String(col.id || col.field || '');
    var want = wantedWidth(columnKind(col));
    if (want === null || want === undefined) {
      var orig = key ? origWidths[key] : null;
      if (!orig) return false;
      delete origWidths[key];
      var restored = Math.round(Number(col.width)) !== orig.width;
      col.width = orig.width;
      if (orig.minWidth !== undefined) col.minWidth = orig.minWidth;
      return restored;
    }
    if (key && !origWidths[key] && isFinite(Number(col.width)) && Math.round(Number(col.width)) !== want) {
      origWidths[key] = { width: Math.round(Number(col.width)), minWidth: col.minWidth };
    }
    var changed = Math.round(Number(col.width)) !== want;
    col.width = want;
    if (typeof col.minWidth === 'number' && col.minWidth > want) col.minWidth = Math.min(MIN_WIDTH_FLOOR, want);
    return changed;
  }

  /* The frozen Total sits immediately right of the frozen pane, so a native
   * Total still parked at the far right (Canvas's default, the first time a
   * teacher turns the feature on) is moved to be the first scrolling column.
   * Returns a reordered copy, or the same array when nothing needs to move.
   * Only runs while the frozen Total is wanted; in-memory only, so Canvas's
   * own saved column order is never rewritten. */
  var totalHome = null;   // Canvas's own index for Total, while it is moved
  function totalFirst(grid, columns) {
    if (!Array.isArray(columns)) return columns;
    if (!cgpState.active || !cgpState.hideTotal || !cgpState.moveTotal) {
      // Feature turned off, or the frozen Total stood down: put Total back where Canvas had it.
      if (totalHome === null) return columns;
      var cur = -1;
      for (var j = 0; j < columns.length; j++) if (columnKind(columns[j]) === 'total') { cur = j; break; }
      var home = Math.min(totalHome, columns.length - 1);
      totalHome = null;
      if (cur < 0 || cur === home) return columns;
      var back = columns.slice();
      back.splice(home, 0, back.splice(cur, 1)[0]);
      return back;
    }
    var from = -1, studentAt = -1;
    for (var i = 0; i < columns.length; i++) {
      var kind = columnKind(columns[i]);
      if (kind === 'total' && from < 0) from = i;
      if (kind === 'student' && studentAt < 0) studentAt = i;
    }
    if (from < 0) return columns;
    var frozen = -1;
    try { frozen = Number((grid.getOptions() || {}).frozenColumn); } catch (e) { frozen = -1; }
    var target = isFinite(frozen) && frozen >= 0 ? frozen + 1 : (studentAt >= 0 ? studentAt + 1 : -1);
    if (target < 0 || from <= target) return columns;
    totalHome = from;
    var next = columns.slice();
    var moved = next.splice(from, 1)[0];
    next.splice(target, 0, moved);
    return next;
  }

  function redraw(grid) {
    if (typeof grid.invalidate === 'function') grid.invalidate();
    if (typeof grid.render === 'function') grid.render();
    if (typeof grid.invalidateAllRows === 'function') grid.invalidateAllRows();
    if (typeof grid.resizeCanvas === 'function') grid.resizeCanvas();
  }

  function enforceColumnWidths(grid) {
    if (!cgpState.active || !grid || typeof grid.getColumns !== 'function') return false;
    var columns;
    try { columns = grid.getColumns(); } catch (e) { return false; }
    if (!Array.isArray(columns) || !columns.length) return false;
    var changed = false;
    columns.forEach(function (col) { if (col && applyWidth(col)) changed = true; });
    var ordered = totalFirst(grid, columns);
    if (ordered !== columns) { columns = ordered; changed = true; }
    if (changed) {
      try {
        (grid.__cgpOrigSetColumns || grid.setColumns).call(grid, columns);
        redraw(grid);
      } catch (e) { /* ignore */ }
    }
    return changed;
  }

  /* Keep Canvas's own later setColumns/autosize calls from undoing the
   * requested widths. Every hook is a pass-through until a request has
   * activated sizing. */
  function patchGrid(grid) {
    if (!grid || grid.__cgpPatchedSetColumns) return;
    window.__cgpLiveGrid = grid;

    var origSetOptions = grid.setOptions;
    if (typeof origSetOptions === 'function') {
      grid.setOptions = function (options) {
        if (cgpState.active && cgpState.narrow && options && options.forceFitColumns) options.forceFitColumns = false;
        return origSetOptions.apply(this, arguments);
      };
    }

    var origAutosize = grid.autosizeColumns;
    if (typeof origAutosize === 'function') {
      grid.autosizeColumns = function () {
        if (!cgpState.active) return origAutosize.apply(this, arguments);
        if (!cgpState.narrow) origAutosize.apply(this, arguments);
        enforceColumnWidths(this);
      };
    }

    var origSetColumns = grid.setColumns;
    if (typeof origSetColumns === 'function') {
      grid.__cgpOrigSetColumns = origSetColumns;
      grid.setColumns = function (columns) {
        if (cgpState.active && Array.isArray(columns)) {
          columns.forEach(function (col) { if (col) applyWidth(col); });
          columns = totalFirst(this, columns);
        }
        return origSetColumns.call(this, columns);
      };
    }

    grid.__cgpPatchedSetColumns = true;
  }

  function signature(columns) {
    return columns.map(function (column) {
      return String(column && (column.id || column.field) || '');
    }).join('\u001f');
  }

  function stableColumns(grid) {
    var previous = null;
    var attempts = 0;
    return new Promise(function (resolve) {
      function poll() {
        var columns;
        try { columns = grid.getColumns(); } catch (e) { resolve(null); return; }
        if (!Array.isArray(columns) || !columns.length) {
          attempts++;
          if (attempts >= 40) { resolve(null); return; }
          setTimeout(poll, 50);
          return;
        }
        var current = signature(columns);
        if (current === previous) { resolve(columns); return; }
        previous = current;
        attempts++;
        if (attempts >= 40) { resolve(columns); return; }
        setTimeout(poll, 50);
      }
      poll();
    });
  }

  function waitForGrid(timeoutMs) {
    var g = findGrid();
    if (g) return Promise.resolve(g);
    if (typeof setInterval !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var start = Date.now();
      var timer = setInterval(function () {
        var found = findGrid();
        if (found) {
          clearInterval(timer);
          resolve(found);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 100);
    });
  }

  function doResize(grid, studentWidth, assignmentWidth, hideTotal, narrow, moveTotal) {
    cgpState.active = true;
    cgpState.narrow = !!narrow;
    cgpState.hideTotal = !!hideTotal;
    cgpState.moveTotal = !!moveTotal;
    cgpState.studentWidth = studentWidth;
    cgpState.assignmentWidth = assignmentWidth;
    patchGrid(grid);
    if (narrow) {
      // forceFit would squeeze the narrowed columns back to the viewport.
      try {
        if (typeof grid.getOptions === 'function' && typeof grid.setOptions === 'function' &&
            (grid.getOptions() || {}).forceFitColumns) {
          grid.setOptions({ forceFitColumns: false });
        }
      } catch (e) { /* ignore */ }
    }
    return stableColumns(grid).then(function (columns) {
      if (!columns) return { ok: false, reason: 'unstable' };
      var changed = 0;
      var next = columns.map(function (col) {
        var copy = Object.assign({}, col);
        if (applyWidth(copy)) changed++;
        return copy;
      });
      var ordered = totalFirst(grid, next);
      if (ordered !== next) { next = ordered; changed++; }
      if (!changed) return { ok: true, changed: 0 };
      try {
        grid.setColumns(next);
        redraw(grid);
        return { ok: true, changed: changed };
      } catch (e) {
        try {
          (grid.__cgpOrigSetColumns || grid.setColumns).call(grid, columns);
          redraw(grid);
        } catch (ignored) { /* stand down */ }
        return { ok: false, reason: 'failed' };
      }
    });
  }

  function resizeColumns(studentWidth, assignmentWidth, hideTotal, narrow, moveTotal) {
    var grid = findGrid();
    if (grid) return doResize(grid, studentWidth, assignmentWidth, hideTotal, narrow, moveTotal);
    return waitForGrid(4500).then(function (g) {
      if (!g) return { ok: false, reason: 'unavailable' };
      return doResize(g, studentWidth, assignmentWidth, hideTotal, narrow, moveTotal);
    });
  }

  /* Background search for the grid, so Canvas's own later setColumns calls
   * are caught: gradebook page only, stopped as soon as the grid is found
   * and patched, and given up after SEARCH_BUDGET_MS. */
  var searchTimer = null;
  var searchStartedAt = 0;
  function stopSearch() {
    if (searchTimer) { clearInterval(searchTimer); searchTimer = null; }
  }
  function searchTick() {
    var g = findGrid();
    if (g) {
      patchGrid(g);
      enforceColumnWidths(g);
      stopSearch();
      return;
    }
    if (Date.now() - searchStartedAt > SEARCH_BUDGET_MS) stopSearch();
  }
  function startSearch() {
    if (searchTimer || typeof setInterval !== 'function' || !onGradebookPage()) return;
    searchStartedAt = Date.now();
    searchTimer = setInterval(searchTick, SEARCH_EVERY_MS);
  }
  // Cheap liveness check: resume searching only if a found grid was lost.
  function watchGrid() {
    var g = window.__cgpLiveGrid;
    if (!g || gridConnected(g)) return;
    window.__cgpLiveGrid = null;
    startSearch();
  }

  // The content script asks once its own listener is attached, so it never
  // depends on catching one of the timed repeats above.
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-env-request') return;
    try {
      if (!window.ENV) return;   // pollEnv posts as soon as ENV exists
      var payload = envPayload();
      lastPeriod = payload.currentGradingPeriodId;
      post({ source: 'cgp-env', env: payload });
    } catch (e) { /* never break the page */ }
  });

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-grid-request' || !message.id) return;
    var studentWidth = Number(message.studentWidth);
    var assignmentWidth = Number(message.assignmentWidth);
    var hideTotal = !!message.hideTotal;
    // Senders that predate the flag only ever asked in order to narrow.
    var narrow = message.narrow === undefined ? true : !!message.narrow;
    if (narrow && (!isFinite(studentWidth) || !isFinite(assignmentWidth) || studentWidth < 1 || assignmentWidth < 1)) return;
    resizeColumns(Math.round(studentWidth) || null, Math.round(assignmentWidth) || null, hideTotal, narrow, !!message.moveTotal).then(function (result) {
      post({ source: 'cgp-grid-response', id: message.id, result: result });
    });
  });

  /* ------------------------------------------------------- posted grades */

  /* Canvas draws its orange "hidden grade / unposted comment" dot from the
   * submission objects in its own grid rows, and a post made through the API
   * (post-grades.js) never reaches them - so the dot stayed until a reload.
   * On a {source:'cgp-posted'} from the content script, the submissions it
   * names are marked posted in Canvas's own row data and just those rows are
   * re-rendered, so Canvas's formatter redraws the cells without the dot.
   * Only posted_at / has_postable_comments are touched, in whichever spelling
   * the row's submission object already uses. */
  function markRowsPosted(grid, assignmentId, userIds, postedAt) {
    if (!grid || typeof grid.getDataLength !== 'function' || typeof grid.getDataItem !== 'function') return 0;
    var wanted = {};
    userIds.forEach(function (uid) { wanted[String(uid)] = true; });
    var field = 'assignment_' + assignmentId;
    var rows = [];
    var n = grid.getDataLength();
    for (var i = 0; i < n; i++) {
      var item = grid.getDataItem(i);
      if (!item || !wanted[String(item.id)]) continue;
      var sub = item[field];
      if (!sub || typeof sub !== 'object') continue;
      if ('posted_at' in sub || !('postedAt' in sub)) { if (!sub.posted_at) sub.posted_at = postedAt; }
      if ('postedAt' in sub) { if (!sub.postedAt) sub.postedAt = postedAt; }
      if ('has_postable_comments' in sub) sub.has_postable_comments = false;
      if ('hasPostableComments' in sub) sub.hasPostableComments = false;
      rows.push(i);
    }
    if (!rows.length) return 0;
    if (typeof grid.invalidateRows === 'function') grid.invalidateRows(rows);
    else if (typeof grid.invalidate === 'function') grid.invalidate();
    if (typeof grid.render === 'function') grid.render();
    return rows.length;
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-posted') return;
    if (!/^\d+$/.test(String(message.assignmentId)) || !Array.isArray(message.userIds)) return;
    try {
      markRowsPosted(findGrid(), String(message.assignmentId), message.userIds,
        typeof message.postedAt === 'string' ? message.postedAt : new Date().toISOString());
    } catch (e) { /* never break the page */ }
  });

  /* ------------------------------------------ Canvas's own gradebook store */

  /* Every grade, status and comment the content script saves goes through
   * Canvas's REST API, which Canvas's in-page store never hears about. That
   * store is what Canvas draws its cells, its status colours, its Total and
   * the Grade Detail Tray from - and what its own editor compares a typed
   * grade against before deciding whether to save it at all - so until a
   * reload it went on showing (and comparing against) the old record.
   *
   * On a {source:'cgp-submission-sync'} the saved submissions are handed to
   * Canvas the way Canvas hands its own saves to itself:
   * Gradebook#updateSubmissionsFromExternal, the method its Grade Detail
   * Tray's saves land in and its Curve Grades / Set Default Grade dialogs
   * reach through the 'submissions_updated' topic. That one call merges the
   * submission into the student's row, refreshes its locked/hidden state,
   * recalculates the student's grades and re-renders the row and column
   * header; an open Grade Detail Tray on the same submission is then drawn
   * again from that store. Only when Canvas's Gradebook object cannot be
   * reached are the row's own fields patched instead.
   *
   * The answer, {source:'cgp-submission-synced'}, says per cell whether
   * Canvas's store now holds what was sent - the content script drops its
   * own overlay only on that word. A cell Canvas itself has a write in
   * flight for (or sent one since this read began) is skipped: Canvas's own
   * answer is newer and is about to land there anyway. */
  var STORE_FIELDS = [
    // Canvas's gradebook submissionsParams.response_fields, less attachments
    // and proxy_submitter (Object.assign keeps what the row already has),
    // plus the visibility and postable-comment flags it reads too.
    'id', 'user_id', 'assignment_id', 'attempt', 'cached_due_date', 'custom_grade_status_id',
    'entered_grade', 'entered_score', 'excused', 'grade', 'grade_matches_current_submission',
    'grading_period_id', 'late', 'late_policy_status', 'missing', 'points_deducted', 'posted_at',
    'proxy_submitter_id', 'redo_request', 'score', 'seconds_late', 'sticker', 'submission_type',
    'submitted_at', 'workflow_state', 'assignment_visible', 'has_postable_comments'
  ];
  // Checked after the hand-off: what Canvas's store must hold for the cell to
  // show what was sent ("grade" is reformatted on the way in, so it is not).
  var CHECK_FIELDS = ['excused', 'late_policy_status', 'missing', 'late', 'entered_score', 'score', 'workflow_state', 'entered_grade'];

  function isPrimitive(v) {
    var t = typeof v;
    return v === null || t === 'string' || t === 'number' || t === 'boolean';
  }

  function cleanSubmission(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!/^\d+$/.test(String(raw.assignment_id)) || !/^\d+$/.test(String(raw.user_id))) return null;
    var out = {};
    STORE_FIELDS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(raw, k) && isPrimitive(raw[k])) out[k] = raw[k];
    });
    out.assignment_id = String(raw.assignment_id);
    out.user_id = String(raw.user_id);
    if (out.id !== undefined && out.id !== null) out.id = String(out.id);
    return out;
  }

  function copyOf(sub) {
    var c = {};
    Object.keys(sub).forEach(function (k) { c[k] = sub[k]; });
    return c;
  }

  function isGradebook(obj) {
    try {
      return !!obj && typeof obj === 'object' && !isWindow(obj) &&
        typeof obj.updateSubmissionsFromExternal === 'function' &&
        typeof obj.getSubmission === 'function' && typeof obj.student === 'function';
    } catch (e) { return false; }
  }

  /* The current HostRoot fiber React keeps on a mount point: legacy render
   * (what Canvas mounts its gradebook with) or createRoot. */
  function reactRootFiber(el) {
    try {
      var legacy = el._reactRootContainer;
      var fiberRoot = legacy && (legacy._internalRoot || legacy);
      if (fiberRoot && fiberRoot.current) return fiberRoot.current;
      var keys = Object.keys(el);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactContainer') !== 0 || !el[keys[i]]) continue;
        var host = el[keys[i]];
        // The fiber stored on the element can be the stale alternate; the
        // root it belongs to always knows the current one.
        return (host.stateNode && host.stateNode.current) || host;
      }
    } catch (e) { /* not a React mount */ }
    return null;
  }

  /* Canvas's Gradebook component instance. Canvas renders it into
   * #gradebook_app (ui/features/gradebook/index.tsx); the SlickGrid it owns
   * lives in #gradebook_grid, outside that React tree, which is why the grid
   * search above cannot reach it. A bounded breadth-first walk down from the
   * root finds it within a few levels. */
  function findGradebook() {
    var cached = window.__cgpGradebook;
    if (isGradebook(cached)) return cached;
    window.__cgpGradebook = null;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
    var mount;
    try { mount = document.querySelector('#gradebook_app'); } catch (e) { return null; }
    var start = mount ? reactRootFiber(mount) : null;
    if (!start) return null;
    var queue = [start];
    var seen = new Set();
    var NodeCtor = typeof Node === 'function' ? Node : null;
    for (var n = 0; queue.length && n < 5000; n++) {
      var fiber = queue.shift();
      if (!fiber || typeof fiber !== 'object' || seen.has(fiber)) continue;
      seen.add(fiber);
      var sn = fiber.stateNode;
      if (sn && !(NodeCtor && sn instanceof NodeCtor) && isGradebook(sn)) {
        window.__cgpGradebook = sn;
        return sn;
      }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return null;
  }

  function camelCase(snake) {
    return snake.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
  }

  function rowIndexFor(grid, userId) {
    if (!grid || typeof grid.getDataLength !== 'function' || typeof grid.getDataItem !== 'function') return -1;
    var n = grid.getDataLength();
    for (var i = 0; i < n; i++) {
      var item = grid.getDataItem(i);
      if (item && String(item.id) === String(userId)) return i;
    }
    return -1;
  }

  /* What Canvas's store holds for one cell right now. */
  function storedSubmission(gb, assignmentId, userId) {
    try {
      if (gb) return gb.getSubmission(String(userId), String(assignmentId)) || null;
    } catch (e) { /* fall through to the grid's rows */ }
    var grid = findGrid();
    var i = rowIndexFor(grid, userId);
    if (i < 0) return null;
    var item = grid.getDataItem(i);
    var sub = item && item['assignment_' + assignmentId];
    return sub && typeof sub === 'object' ? sub : null;
  }

  function sameValue(a, b) {
    var x = a === undefined ? null : a;
    var y = b === undefined ? null : b;
    if (x === y) return true;
    if (x === null || y === null) return false;
    if (typeof x === 'boolean' || typeof y === 'boolean') return !!x === !!y;
    if (isFinite(Number(x)) && isFinite(Number(y)) && String(x).trim() !== '' && String(y).trim() !== '') {
      return Number(x) === Number(y);
    }
    return String(x) === String(y);
  }

  /* Does the store now hold what was sent? Only fields both sides carry are
   * compared - a row that never had one (in either spelling) has nothing
   * there to be stale. */
  function storeHolds(stored, expected) {
    if (!stored) return false;
    return CHECK_FIELDS.every(function (k) {
      if (!Object.prototype.hasOwnProperty.call(expected, k)) return true;
      var camel = camelCase(k);
      var have;
      if (k in stored) have = stored[k];
      else if (camel in stored) have = stored[camel];
      else return true;
      return sameValue(have, expected[k]);
    });
  }

  /* Field patch, for when Canvas's Gradebook object cannot be reached: the
   * row's own submission object gets the new values, in whichever spelling
   * (snake_case or camelCase) it already uses - a field it does not have is
   * never added - and only that row re-renders. */
  function patchRowSubmission(grid, sub) {
    var i = rowIndexFor(grid, sub.user_id);
    if (i < 0) return false;
    var item = grid.getDataItem(i);
    var target = item && item['assignment_' + sub.assignment_id];
    if (!target || typeof target !== 'object') return false;
    Object.keys(sub).forEach(function (snake) {
      if (snake === 'id' || snake === 'user_id' || snake === 'assignment_id' || snake === 'assignment_visible') return;
      var camel = camelCase(snake);
      if (snake in target) target[snake] = sub[snake];
      if (camel !== snake && camel in target) target[camel] = sub[snake];
    });
    // Canvas draws a pass/fail cell from its unformatted copy of the grade.
    if ('grade' in sub && 'rawGrade' in target) target.rawGrade = sub.grade;
    if (typeof grid.invalidateRows === 'function') grid.invalidateRows([i]);
    else if (typeof grid.invalidate === 'function') grid.invalidate();
    if (typeof grid.render === 'function') grid.render();
    return true;
  }

  /* Hands the submissions to Canvas's store. Returns how each one went in:
   * 'gradebook', 'pubsub' or 'rows' (or nothing). A submission without
   * assignment_visible is never given to Canvas's own method, which would
   * read the missing flag as "no longer assigned to this student". */
  function ingest(gb, subs) {
    var how = [];
    var direct = [];
    var rest = [];
    subs.forEach(function (s, i) {
      if (typeof s.assignment_visible === 'boolean') direct.push(i); else rest.push(i);
    });
    if (direct.length) {
      var payload = direct.map(function (i) { return copyOf(subs[i]); });
      var jq = window.jQuery || window.$;
      try {
        if (gb) {
          gb.updateSubmissionsFromExternal(payload);
          direct.forEach(function (i) { how[i] = 'gradebook'; });
        } else if (jq && typeof jq.publish === 'function') {
          jq.publish('submissions_updated', [payload]);
          direct.forEach(function (i) { how[i] = 'pubsub'; });
        } else {
          rest = rest.concat(direct);
        }
      } catch (e) {
        rest = rest.concat(direct);
      }
    }
    if (rest.length) {
      var grid = findGrid();
      rest.forEach(function (i) {
        try { if (grid && patchRowSubmission(grid, subs[i])) how[i] = 'rows'; } catch (e) { /* leave it */ }
      });
    }
    return how;
  }

  /* An open Grade Detail Tray is a snapshot of the store taken when it was
   * drawn; it is drawn again when the submission it shows has just changed,
   * and its comment list is re-read when that submission's comments did. */
  function refreshOpenTray(gb, changedCells, commentCells) {
    if (!gb || typeof gb.getSubmissionTrayState !== 'function') return;
    try {
      var tray = gb.getSubmissionTrayState();
      if (!tray || !tray.open || !tray.studentId || !tray.assignmentId) return;
      var isTray = function (c) {
        return String(c.userId) === String(tray.studentId) && String(c.assignmentId) === String(tray.assignmentId);
      };
      if (commentCells.some(isTray) && typeof gb.loadSubmissionComments === 'function') {
        gb.loadSubmissionComments(String(tray.assignmentId), String(tray.studentId));
      }
      if (changedCells.some(isTray) && typeof gb.renderSubmissionTray === 'function') {
        gb.renderSubmissionTray(gb.student(String(tray.studentId)));
      }
    } catch (e) { /* the tray stays as drawn */ }
  }

  /* Has Canvas sent its own write for this cell that is newer than a read
   * that began at readStartedAt (write-watch.js keeps the record)? */
  function canvasWriteNewer(assignmentId, userId, readStartedAt) {
    var watch = window.__cgpNativeWrites;
    if (!watch || typeof watch.state !== 'function') return false;
    try {
      var st = watch.state(assignmentId, userId);
      if (!st) return false;
      if (st.pending > 0) return true;
      return !!(readStartedAt && st.lastStartedAt && st.lastStartedAt >= readStartedAt);
    } catch (e) { return false; }
  }

  var syncQueue = [];
  var syncTimer = null;

  /* A hand-off re-renders the student's row, which reloads (Canvas's
   * updateCell) or tears down (SlickGrid's invalidateRows, the row-patch
   * fallback) an editor open in it - so a grade half-typed in that row could
   * silently vanish the moment a save from SpeedGrader, another tab or a
   * refocus re-read landed. Only an editor holding an UNSAVED change is
   * waited for: Canvas keeps an editor open on whichever grade cell is
   * active, so waiting on any open editor would hold back every save for a
   * row being graded across with Tab. If the change is still unsaved after
   * EDIT_WAIT_TRIES, that row is skipped (the content script's overlay then
   * simply stays) rather than lose what was typed. */
  var EDIT_WAIT_MS = 300;
  var EDIT_WAIT_TRIES = 100;  // ~30 s, inside canvas-store.js's wait for a reply

  function editingStudent(gb) {
    try {
      var grid = (gb && gb.gradebookGrid && gb.gradebookGrid.grid) || findGrid();
      var editor = grid && typeof grid.getCellEditor === 'function' ? grid.getCellEditor() : null;
      if (!editor) return null;
      // Nothing typed: reloading the editor loses nothing (and shows the new
      // grade). An editor that cannot say is treated as holding a change.
      if (typeof editor.isValueChanged === 'function' && !editor.isValueChanged()) return null;
      var active = typeof grid.getActiveCell === 'function' ? grid.getActiveCell() : null;
      if (!active || typeof grid.getDataItem !== 'function') return null;
      var item = grid.getDataItem(active.row);
      return item && item.id !== undefined && item.id !== null ? String(item.id) : null;
    } catch (e) { return null; }
  }

  function touchesStudent(message, userId) {
    return (Array.isArray(message.submissions) ? message.submissions : []).some(function (s) {
      return !!s && String(s.user_id) === userId;
    });
  }

  function flushSync() {
    syncTimer = null;
    var gb = findGradebook();
    var editing = editingStudent(gb);
    var batch = [];
    var held = [];
    syncQueue.forEach(function (m) {
      if (editing && (m.editWaits || 0) < EDIT_WAIT_TRIES && touchesStudent(m, editing)) {
        m.editWaits = (m.editWaits || 0) + 1;
        held.push(m);
      } else {
        batch.push(m);
      }
    });
    syncQueue = held;
    if (held.length) syncTimer = setTimeout(flushSync, EDIT_WAIT_MS);
    var accepted = [];
    var expected = [];
    var owners = [];
    var replies = batch.map(function (m) { return { source: 'cgp-submission-synced', id: m.id, results: [] }; });
    var commentCells = [];
    batch.forEach(function (m, mi) {
      (Array.isArray(m.commentsFor) ? m.commentsFor : []).forEach(function (c) {
        if (c && /^\d+$/.test(String(c.assignmentId)) && /^\d+$/.test(String(c.userId))) commentCells.push(c);
      });
      (Array.isArray(m.submissions) ? m.submissions : []).forEach(function (raw) {
        var sub = cleanSubmission(raw);
        if (!sub) return;
        var cell = { assignmentId: sub.assignment_id, userId: sub.user_id };
        if (editing && cell.userId === editing) {
          cell.skipped = 'editing';
          replies[mi].results.push(cell);
          return;
        }
        if (canvasWriteNewer(cell.assignmentId, cell.userId, Number(m.readStartedAt) || 0)) {
          cell.skipped = 'canvas-write';
          replies[mi].results.push(cell);
          return;
        }
        accepted.push(sub);
        expected.push(copyOf(sub));
        owners.push({ reply: replies[mi], cell: cell });
      });
    });
    var how = accepted.length ? ingest(gb, accepted) : [];
    var changed = [];
    owners.forEach(function (o, i) {
      o.cell.via = how[i] || null;
      o.cell.stored = !!how[i] && storeHolds(storedSubmission(gb, o.cell.assignmentId, o.cell.userId), expected[i]);
      if (how[i]) changed.push(o.cell);
      o.reply.results.push(o.cell);
    });
    refreshOpenTray(gb, changed, commentCells);
    replies.forEach(function (r) { if (r.id) post(r); });
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-submission-sync') return;
    try {
      syncQueue.push({
        id: typeof message.id === 'string' ? message.id : null,
        submissions: message.submissions,
        commentsFor: message.commentsFor,
        readStartedAt: message.readStartedAt
      });
      // Coalesced: a paste lands as many answers in quick succession, and
      // Canvas recalculates and re-renders once per hand-off.
      if (!syncTimer) syncTimer = setTimeout(flushSync, 0);
    } catch (e) { /* never break the page */ }
  });

  /* ----------------------------------------------- opening the Grade Detail Tray */

  /* Canvas's own arrow in a grade cell opens the tray WITHOUT committing
   * what is still typed in that cell's editor
   * (AssignmentRowCell#handleToggleTrayButtonClick), so a grade typed and
   * then double-clicked to look at opened the tray on the grade from BEFORE
   * the edit. On a {source:'cgp-open-tray'} the open edit is committed
   * through SlickGrid's own editor lock first - Canvas's own save, exactly as
   * Enter would make it - and the tray is opened through Canvas's own
   * Gradebook#openSubmissionTray, which draws it with that grade pending and
   * again once Canvas has saved it. Answered with {source:
   * 'cgp-open-tray-result', ok}; when it is not ok, the content script
   * clicks Canvas's arrow as before. */
  function openTray(assignmentId, userId) {
    var gb = findGradebook();
    if (!gb || typeof gb.openSubmissionTray !== 'function') return { ok: false };
    var committed = null;
    try {
      var grid = gb.gradebookGrid && gb.gradebookGrid.grid;
      var lock = grid && typeof grid.getEditorLock === 'function' ? grid.getEditorLock() : null;
      if (lock && typeof lock.isActive === 'function' && lock.isActive() && typeof lock.commitCurrentEdit === 'function') {
        committed = lock.commitCurrentEdit() !== false;
      }
    } catch (e) { committed = false; }
    try {
      gb.openSubmissionTray(String(userId), String(assignmentId));
    } catch (e) {
      return { ok: false, committed: committed };
    }
    return { ok: true, committed: committed };
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-open-tray') return;
    if (!/^\d+$/.test(String(message.assignmentId)) || !/^\d+$/.test(String(message.userId))) return;
    var result;
    try { result = openTray(String(message.assignmentId), String(message.userId)); } catch (e) { result = { ok: false }; }
    post({ source: 'cgp-open-tray-result', id: message.id, ok: !!result.ok, committed: result.committed === undefined ? null : result.committed });
  });

  pollEnv();
  if (onGradebookPage()) {
    try {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', pollEnv);
      }
    } catch (e) { /* ignore */ }
    startSearch();
    if (typeof setInterval === 'function') {
      setInterval(function () { pollEnv(); watchGrid(); }, POLL_EVERY_MS);
    }
  }
})();
