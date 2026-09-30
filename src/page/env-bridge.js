/* Canvas Gradebook+ - page-context ENV bridge.
 *
 * Content scripts run in an isolated world and cannot read Canvas's window.ENV
 * directly. This tiny script runs in the page, posts back a short allowlist of
 * identifiers (never student data, never grades, never comments) and removes
 * itself. It is used only to cross-check the course and user ids the extension
 * already resolved from the URL and the Canvas API. */
(function () {
  'use strict';
  try {
    var ENV = window.ENV || {};
    var opts = ENV.GRADEBOOK_OPTIONS || {};
    var payload = {
      currentUserId: ENV.current_user_id === undefined ? null : String(ENV.current_user_id),
      courseId: (ENV.COURSE_ID || ENV.course_id || opts.context_id || null),
      gradebookEditable: opts.gradebook_is_editable === undefined ? null : !!opts.gradebook_is_editable,
      gradingPeriodsEnabled: !!(opts.grading_period_set || opts.multiple_grading_periods_enabled),
      // Which grading period Canvas's OWN Total column is scoped to right
      // now. Canvas decides this server-side (a URL ?grading_period_id=, or
      // its own "current" default when the URL says nothing) and this is the
      // only place that choice is ever exposed - never reliably inferable
      // from the URL alone. null means the whole course (no filter, or the
      // teacher explicitly chose "All Grading Periods").
      currentGradingPeriodId: (opts.current_grading_period_id === undefined || opts.current_grading_period_id === null)
        ? null : String(opts.current_grading_period_id),
      postPolicies: !!opts.post_policies_enabled
    };
    if (payload.courseId !== null) payload.courseId = String(payload.courseId);
    window.postMessage({ source: 'cgp-env', env: payload }, window.location.origin);
  } catch (e) {
    /* Canvas layout differences must never break the page */
  }

  // Intercept SlickGrid constructor whenever Canvas creates it
  var _slick = window.Slick;
  function wrapGridConstructor(Orig) {
    if (typeof Orig !== 'function' || Orig.__cgpWrapped) return Orig;
    var Wrapped = function (container, data, columns, options) {
      if (options && options.forceFitColumns) options.forceFitColumns = false;
      var inst = new Orig(container, data, columns, options);
      window.__cgpLiveGrid = inst;
      try { patchGrid(inst); } catch (e) {}
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
    if (s.Grid) {
      s.Grid = wrapGridConstructor(s.Grid);
    }
    var _innerGrid = s.Grid;
    try {
      Object.defineProperty(s, 'Grid', {
        configurable: true,
        enumerable: true,
        get: function () { return _innerGrid; },
        set: function (val) {
          _innerGrid = wrapGridConstructor(val);
        }
      });
    } catch (e) {}
  }
  if (_slick) hookSlick(_slick);
  try {
    Object.defineProperty(window, 'Slick', {
      configurable: true,
      enumerable: true,
      get: function () { return _slick; },
      set: function (val) {
        _slick = val;
        hookSlick(val);
      }
    });
  } catch (e) {}

  var _jq = window.jQuery || window.$;
  function hookJq(jq) {
    if (!jq || !jq.fn || jq.fn.__cgpDataHooked) return;
    var origData = jq.fn.data;
    if (typeof origData === 'function') {
      jq.fn.data = function (key, value) {
        if (arguments.length >= 2 && (key === 'slickgrid' || key === 'slickGrid' || key === 'grid')) {
          if (validGrid(value)) {
            window.__cgpLiveGrid = value;
            patchGrid(value);
          }
        }
        return origData.apply(this, arguments);
      };
      jq.fn.__cgpDataHooked = true;
    }
  }
  if (_jq) hookJq(_jq);

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

  /* SlickGrid is also owned by Canvas's page world. Function-bearing grid
   * objects cannot be passed to the isolated content script, so perform the
   * complete, atomic column transaction here and return only its outcome. */
  function validGrid(grid) {
    if (!grid || typeof grid !== 'object' || isWindow(grid)) return false;
    try {
      if (typeof grid.getColumns !== 'function' || typeof grid.setColumns !== 'function') return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function findGrid() {
    if (window.__cgpLiveGrid && validGrid(window.__cgpLiveGrid)) return window.__cgpLiveGrid;

    // 1. Check window globals and properties
    var knownGlobals = [
      window.gradebook, window.Gradebook, window.grid, window.slickGrid,
      window.slickgrid, window._grid, window.gradebookGrid, window.canvasGradebook,
      window.INST, window.INST && window.INST.gradebook, window.INST && window.INST.Gradebook,
      window.INST && window.INST.grid, window.ENV && window.ENV.gradebook,
      window.ENV && window.ENV.grid, window.Slick
    ];
    for (var gi = 0; gi < knownGlobals.length; gi++) {
      var g = knownGlobals[gi];
      try {
        if (g && typeof g === 'object' && !isWindow(g)) {
          if (validGrid(g)) { window.__cgpLiveGrid = g; return g; }
          if (validGrid(g.grid)) { window.__cgpLiveGrid = g.grid; return g.grid; }
          if (validGrid(g.slickGrid)) { window.__cgpLiveGrid = g.slickGrid; return g.slickGrid; }
          if (validGrid(g.slickgrid)) { window.__cgpLiveGrid = g.slickgrid; return g.slickgrid; }
          if (validGrid(g._grid)) { window.__cgpLiveGrid = g._grid; return g._grid; }
          if (validGrid(g.current)) { window.__cgpLiveGrid = g.current; return g.current; }
          if (validGrid(g.table)) { window.__cgpLiveGrid = g.table; return g.table; }
        }
      } catch (e) {}
    }

    // 2. Candidate DOM elements across all known Canvas selectors
    var domRoots = [];
    try {
      if (typeof document.querySelector === 'function') {
        var q1 = document.querySelector('#gradebook_grid');
        if (q1) domRoots.push(q1);
      }
      if (typeof document.querySelectorAll === 'function') {
        var queried = document.querySelectorAll(
          '#gradebook_grid, .gradebook-grid, [data-component="GradebookGrid"], .slickgrid-container, .slick-pane, .slick-pane-left, .slick-pane-right, .slick-viewport, .slick-viewport-left, .slick-viewport-right, .slick-header, .slick-header-left, .slick-header-right, .slick-header-columns, .grid-canvas, #content, .ic-Layout-contentMain, #application, [class*="gradebook"]'
        );
        domRoots = domRoots.concat(Array.prototype.slice.call(queried));
      }
    } catch (e) {}

    // Climb up from .slick-header-columns or .grid-canvas to find the grid container element
    try {
      if (typeof document.querySelectorAll === 'function') {
        var samples = document.querySelectorAll('.slick-header-columns, .slick-header-column, .grid-canvas, .slick-row, .slick-cell');
        for (var sIdx = 0; sIdx < Math.min(samples.length, 10); sIdx++) {
          var curr = samples[sIdx];
          for (var depth = 0; depth < 15 && curr && curr !== document.body; depth++) {
            if (domRoots.indexOf(curr) < 0) domRoots.push(curr);
            curr = curr.parentElement;
          }
        }
      }
    } catch (e) {}

    var jq = window.jQuery || window.$;

    for (var d = 0; d < domRoots.length; d++) {
      var el = domRoots[d];
      if (!el) continue;

      // Direct properties
      try {
        var elCandidates = [
          el.slickGrid, el.slickgrid, el.grid, el.__slickGrid, el._grid,
          el.gridInstance, el.slick, el._slick, el.table, el.gradebookGrid
        ];
        for (var ec = 0; ec < elCandidates.length; ec++) {
          if (validGrid(elCandidates[ec])) {
            window.__cgpLiveGrid = elCandidates[ec];
            return elCandidates[ec];
          }
        }
      } catch (e) {}

      // jQuery expando / data
      try {
        for (var ek in el) {
          if (ek.indexOf('jQuery') === 0) {
            var jData = el[ek];
            if (jData && typeof jData === 'object') {
              if (validGrid(jData.slickGrid)) { window.__cgpLiveGrid = jData.slickGrid; return jData.slickGrid; }
              if (validGrid(jData.slickgrid)) { window.__cgpLiveGrid = jData.slickgrid; return jData.slickgrid; }
              if (validGrid(jData.grid)) { window.__cgpLiveGrid = jData.grid; return jData.grid; }
              if (validGrid(jData._grid)) { window.__cgpLiveGrid = jData._grid; return jData._grid; }
              if (jData.data && typeof jData.data === 'object') {
                if (validGrid(jData.data.slickGrid)) { window.__cgpLiveGrid = jData.data.slickGrid; return jData.data.slickGrid; }
                if (validGrid(jData.data.slickgrid)) { window.__cgpLiveGrid = jData.data.slickgrid; return jData.data.slickgrid; }
                if (validGrid(jData.data.grid)) { window.__cgpLiveGrid = jData.data.grid; return jData.data.grid; }
              }
            }
          }
        }
      } catch (e) {}

      if (typeof jq === 'function') {
        try {
          var data = jq(el).data();
          if (data) {
            if (validGrid(data.slickGrid)) { window.__cgpLiveGrid = data.slickGrid; return data.slickGrid; }
            if (validGrid(data.slickgrid)) { window.__cgpLiveGrid = data.slickgrid; return data.slickgrid; }
            if (validGrid(data.grid)) { window.__cgpLiveGrid = data.grid; return data.grid; }
            if (validGrid(data._grid)) { window.__cgpLiveGrid = data._grid; return data._grid; }
            for (var dk in data) {
              if (data[dk] && typeof data[dk] === 'object') {
                if (validGrid(data[dk])) { window.__cgpLiveGrid = data[dk]; return data[dk]; }
                if (validGrid(data[dk].grid)) { window.__cgpLiveGrid = data[dk].grid; return data[dk].grid; }
                if (validGrid(data[dk].slickGrid)) { window.__cgpLiveGrid = data[dk].slickGrid; return data[dk].slickGrid; }
              }
            }
          }
        } catch (e) {}
      }
    }

    // 3. React Fiber Breadth-First-Search traversal
    try {
      var fiberRoots = [];
      for (var fIdx = 0; fIdx < domRoots.length; fIdx++) {
        var fel = domRoots[fIdx];
        if (!fel) continue;
        for (var p in fel) {
          if (p.indexOf('__reactContainer') === 0) {
            var cr = fel[p];
            if (cr && cr.current) fiberRoots.push(cr.current);
            else if (cr) fiberRoots.push(cr);
          } else if (p.indexOf('__reactFiber') === 0 || p.indexOf('__reactInternalInstance') === 0) {
            if (fel[p]) fiberRoots.push(fel[p]);
          }
        }
      }

      var visitedFibers = (typeof Set === 'function') ? new Set() : [];
      function isVisited(fib) {
        if (visitedFibers.has) return visitedFibers.has(fib);
        return visitedFibers.indexOf(fib) >= 0;
      }
      function markVisited(fib) {
        if (visitedFibers.add) visitedFibers.add(fib);
        else if (visitedFibers.length < 5000) visitedFibers.push(fib);
      }

      for (var rIdx = 0; rIdx < fiberRoots.length; rIdx++) {
        var startFiber = fiberRoots[rIdx];
        if (!startFiber || isVisited(startFiber)) continue;
        var queue = [startFiber];
        var count = 0;

        while (queue.length > 0 && count < 8000) {
          var f = queue.shift();
          count++;
          if (!f || isVisited(f)) continue;
          markVisited(f);

          // Check stateNode
          try {
            var sn = f.stateNode;
            if (sn && typeof sn === 'object' && !isWindow(sn) && !(sn instanceof Node)) {
              if (validGrid(sn)) { window.__cgpLiveGrid = sn; return sn; }
              if (validGrid(sn.grid)) { window.__cgpLiveGrid = sn.grid; return sn.grid; }
              if (validGrid(sn.slickGrid)) { window.__cgpLiveGrid = sn.slickGrid; return sn.slickGrid; }
              if (validGrid(sn.slickgrid)) { window.__cgpLiveGrid = sn.slickgrid; return sn.slickgrid; }
              if (validGrid(sn._grid)) { window.__cgpLiveGrid = sn._grid; return sn._grid; }
              if (validGrid(sn.gridInstance)) { window.__cgpLiveGrid = sn.gridInstance; return sn.gridInstance; }
              if (validGrid(sn.table)) { window.__cgpLiveGrid = sn.table; return sn.table; }
              for (var sk in sn) {
                var sv = sn[sk];
                if (validGrid(sv)) { window.__cgpLiveGrid = sv; return sv; }
                if (sv && typeof sv === 'object' && !isWindow(sv)) {
                  if (validGrid(sv.current)) { window.__cgpLiveGrid = sv.current; return sv.current; }
                  if (validGrid(sv.grid)) { window.__cgpLiveGrid = sv.grid; return sv.grid; }
                }
              }
            }
          } catch (e) {}

          // Check memoizedState (hooks chain for functional components)
          try {
            var hook = f.memoizedState;
            var hDepth = 0;
            while (hook && hDepth < 100) {
              hDepth++;
              var hs = hook.memoizedState;
              if (hs && typeof hs === 'object' && !isWindow(hs)) {
                if (validGrid(hs)) { window.__cgpLiveGrid = hs; return hs; }
                if (validGrid(hs.current)) { window.__cgpLiveGrid = hs.current; return hs.current; }
                if (validGrid(hs.grid)) { window.__cgpLiveGrid = hs.grid; return hs.grid; }
                if (validGrid(hs.slickGrid)) { window.__cgpLiveGrid = hs.slickGrid; return hs.slickGrid; }
                if (validGrid(hs.slickgrid)) { window.__cgpLiveGrid = hs.slickgrid; return hs.slickgrid; }
                if (validGrid(hs._grid)) { window.__cgpLiveGrid = hs._grid; return hs._grid; }
                if (validGrid(hs.table)) { window.__cgpLiveGrid = hs.table; return hs.table; }
                for (var hk in hs) {
                  var hv = hs[hk];
                  if (validGrid(hv)) { window.__cgpLiveGrid = hv; return hv; }
                  if (hv && typeof hv === 'object' && !isWindow(hv)) {
                    if (validGrid(hv.current)) { window.__cgpLiveGrid = hv.current; return hv.current; }
                    if (validGrid(hv.grid)) { window.__cgpLiveGrid = hv.grid; return hv.grid; }
                  }
                }
                if (Array.isArray(hs)) {
                  for (var ai = 0; ai < hs.length; ai++) {
                    var aItem = hs[ai];
                    if (validGrid(aItem)) { window.__cgpLiveGrid = aItem; return aItem; }
                    if (aItem && typeof aItem === 'object' && !isWindow(aItem)) {
                      if (validGrid(aItem.current)) { window.__cgpLiveGrid = aItem.current; return aItem.current; }
                      if (validGrid(aItem.grid)) { window.__cgpLiveGrid = aItem.grid; return aItem.grid; }
                    }
                  }
                }
              }
              hook = hook.next;
            }
          } catch (e) {}

          // Check memoizedProps
          try {
            var mp = f.memoizedProps;
            if (mp && typeof mp === 'object' && !isWindow(mp)) {
              if (validGrid(mp.grid)) { window.__cgpLiveGrid = mp.grid; return mp.grid; }
              if (validGrid(mp.slickGrid)) { window.__cgpLiveGrid = mp.slickGrid; return mp.slickGrid; }
              if (validGrid(mp.slickgrid)) { window.__cgpLiveGrid = mp.slickgrid; return mp.slickgrid; }
              for (var pk in mp) {
                var pv = mp[pk];
                if (validGrid(pv)) { window.__cgpLiveGrid = pv; return pv; }
                if (pv && typeof pv === 'object' && !isWindow(pv) && validGrid(pv.current)) {
                  window.__cgpLiveGrid = pv.current;
                  return pv.current;
                }
              }
            }
          } catch (e) {}

          if (f.child) queue.push(f.child);
          if (f.sibling) queue.push(f.sibling);
          if (f.return && !isVisited(f.return)) queue.push(f.return);
        }
      }
    } catch (e) {}

    // 4. Webpack chunk module probe
    try {
      for (var wk in window) {
        if (/^webpackChunk/i.test(wk) || wk === 'webpackJsonp') {
          var chunkArr = window[wk];
          if (chunkArr && typeof chunkArr.push === 'function') {
            var req = null;
            try {
              chunkArr.push([
                [Symbol('cgp-grid-probe')],
                {},
                function (r) { req = r; }
              ]);
            } catch (e) {}
            if (req && req.c) {
              for (var modId in req.c) {
                try {
                  var mod = req.c[modId];
                  if (!mod || !mod.exports) continue;
                  var exp = mod.exports;
                  if (validGrid(exp)) { window.__cgpLiveGrid = exp; return exp; }
                  if (exp.default && validGrid(exp.default)) { window.__cgpLiveGrid = exp.default; return exp.default; }
                  if (exp.grid && validGrid(exp.grid)) { window.__cgpLiveGrid = exp.grid; return exp.grid; }
                  if (exp.slickGrid && validGrid(exp.slickGrid)) { window.__cgpLiveGrid = exp.slickGrid; return exp.slickGrid; }
                  if (typeof exp === 'object' && !isWindow(exp)) {
                    for (var modK in exp) {
                      try {
                        if (validGrid(exp[modK])) { window.__cgpLiveGrid = exp[modK]; return exp[modK]; }
                        if (exp[modK] && typeof exp[modK] === 'object' && validGrid(exp[modK].grid)) {
                          window.__cgpLiveGrid = exp[modK].grid;
                          return exp[modK].grid;
                        }
                      } catch (e) {}
                    }
                  }
                } catch (e) {}
              }
            }
          }
        }
      }
    } catch (e) {}

    // 5. Top-level scan across window properties safely
    try {
      var winProps = Object.getOwnPropertyNames(window);
      for (var k = 0; k < winProps.length; k++) {
        var key = winProps[k];
        if (/^\d+$/.test(key)) continue;
        try {
          var val = window[key];
          if (val && typeof val === 'object' && !isWindow(val)) {
            if (validGrid(val)) { window.__cgpLiveGrid = val; return val; }
            if (val.grid && !isWindow(val.grid) && validGrid(val.grid)) { window.__cgpLiveGrid = val.grid; return val.grid; }
            if (val.slickGrid && !isWindow(val.slickGrid) && validGrid(val.slickGrid)) { window.__cgpLiveGrid = val.slickGrid; return val.slickGrid; }
            if (val.slickgrid && !isWindow(val.slickgrid) && validGrid(val.slickgrid)) { window.__cgpLiveGrid = val.slickgrid; return val.slickgrid; }
            if (val._grid && !isWindow(val._grid) && validGrid(val._grid)) { window.__cgpLiveGrid = val._grid; return val._grid; }
            if (val.table && !isWindow(val.table) && validGrid(val.table)) { window.__cgpLiveGrid = val.table; return val.table; }
            if (val.current && !isWindow(val.current) && validGrid(val.current)) { window.__cgpLiveGrid = val.current; return val.current; }
          }
        } catch (e) {}
      }
    } catch (e) {}

    return null;
  }

  function columnKind(column) {
    if (!column) return null;
    var rawId = String(column.id || '').toLowerCase();
    var field = String(column.field || '').toLowerCase();
    var rawName = String(column.name || column.title || '');
    var textName = rawName.replace(/<[^>]*>/g, '').trim().toLowerCase();
    var cleanId = rawId.replace(/^slickgrid_\d+_?/, '');

    if (cleanId === 'student' || cleanId === 'student_name' || cleanId === 'name' || textName === 'student name' || field === 'student') return 'student';
    if (/^total/.test(cleanId) || /(?:^|_)total(?:_|$)/.test(rawId) || field === 'total_grade' || field === 'total' ||
        column.is_total || /^total/.test(textName) || /^to(\.|$)/.test(textName) || textName === 'total' ||
        cleanId === 'final_grade' || field === 'final_grade' ||
        cleanId === 'total_grade_override' || field === 'total_grade_override' ||
        cleanId.indexOf('total_grade') >= 0 || field.indexOf('total_grade') >= 0) {
      return 'total';
    }
    if (/^assignment_group_/.test(cleanId) || column.group_id != null || field.indexOf('assignment_group') >= 0) return 'group';
    if (/^custom_col_/.test(cleanId) || cleanId === 'notes' || field.indexOf('custom_col') >= 0) return 'custom';
    if (/^assignment[_-]/.test(cleanId) || column.assignment_id != null || /^\d+$/.test(cleanId) || column.points_possible != null || field.indexOf('assignment') >= 0) return 'assignment';
    return 'assignment';
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
      }, 50);
    });
  }

  var cgpState = window.__cgpState = window.__cgpState || { hideTotal: false, studentWidth: 190, assignmentWidth: 124 };

  function enforceColumnWidths(grid) {
    if (!grid || typeof grid.getColumns !== 'function') return false;
    var columns;
    try { columns = grid.getColumns(); } catch (e) { return false; }
    if (!Array.isArray(columns) || !columns.length) return false;
    var changed = false;
    columns.forEach(function(col) {
      if (!col) return;
      var kind = columnKind(col);
      if (kind === 'student') {
        var sWant = cgpState.studentWidth || 190;
        if (Math.round(Number(col.width)) !== sWant || col.minWidth !== sWant || col.maxWidth !== sWant) {
          col.width = sWant; col.minWidth = sWant; col.maxWidth = sWant; changed = true;
        }
      } else if (kind === 'total') {
        if (cgpState.hideTotal) {
          if (Math.round(Number(col.width)) !== 84 || col.minWidth !== 84 || col.maxWidth !== 84) {
            col.width = 84; col.minWidth = 84; col.maxWidth = 84; changed = true;
          }
        }
      } else {
        var aWant = cgpState.assignmentWidth || 124;
        if (Math.round(Number(col.width)) !== aWant || col.minWidth !== aWant || col.maxWidth !== aWant) {
          col.width = aWant; col.minWidth = aWant; col.maxWidth = aWant; changed = true;
        }
      }
    });
    if (changed && typeof grid.setColumns === 'function') {
      try {
        var origSet = grid.__cgpOrigSetColumns || grid.setColumns;
        origSet.call(grid, columns);
        if (typeof grid.invalidate === 'function') grid.invalidate();
        if (typeof grid.render === 'function') grid.render();
        if (typeof grid.invalidateAllRows === 'function') grid.invalidateAllRows();
        if (typeof grid.resizeCanvas === 'function') grid.resizeCanvas();
      } catch (e) {}
    }
    return changed;
  }

  function patchGrid(grid) {
    if (!grid || grid.__cgpPatchedSetColumns) return;
    window.__cgpLiveGrid = grid;

    if (typeof grid.setOptions === 'function') {
      try { grid.setOptions({ forceFitColumns: false }); } catch (e) {}
      var origSetOptions = grid.setOptions;
      grid.setOptions = function (options) {
        if (options && options.forceFitColumns) {
          options.forceFitColumns = false;
        }
        return origSetOptions.call(this, options);
      };
    }

    grid.autosizeColumns = function () {
      enforceColumnWidths(this);
    };

    var orig = grid.setColumns;
    if (typeof orig === 'function') {
      grid.__cgpOrigSetColumns = orig;
      grid.setColumns = function (columns) {
        if (Array.isArray(columns)) {
          columns.forEach(function (col) {
            if (!col) return;
            var kind = columnKind(col);
            if (kind === 'student') {
              var sWant = cgpState.studentWidth || 190;
              col.width = sWant;
              col.minWidth = sWant;
              col.maxWidth = sWant;
            } else if (kind === 'total') {
              if (cgpState.hideTotal) {
                col.width = 84;
                col.minWidth = 84;
                col.maxWidth = 84;
              }
            } else {
              var aWant = cgpState.assignmentWidth || 124;
              col.width = aWant;
              col.minWidth = aWant;
              col.maxWidth = aWant;
            }
          });
        }
        return orig.call(this, columns);
      };
    }

    grid.__cgpPatchedSetColumns = true;
  }

  function doResize(grid, studentWidth, assignmentWidth, hideTotal) {
    cgpState.hideTotal = !!hideTotal;
    cgpState.studentWidth = studentWidth;
    cgpState.assignmentWidth = assignmentWidth;
    patchGrid(grid);
    return stableColumns(grid).then(function (columns) {
      if (!columns) return { ok: false, reason: 'unstable' };
      var changed = 0;
      var next = columns.map(function (col) {
        var copy = Object.assign({}, col);
        var kind = columnKind(copy);
        if (kind === 'student') {
          if (studentWidth !== null && studentWidth !== undefined) {
            if (Math.round(Number(copy.width)) !== studentWidth) {
              copy.width = studentWidth;
              changed++;
            }
            copy.minWidth = studentWidth;
            copy.maxWidth = studentWidth;
          }
        } else if (kind === 'total') {
          if (hideTotal) {
            if (Math.round(Number(copy.width)) !== 84) {
              copy.width = 84;
              changed++;
            }
            copy.minWidth = 84;
            copy.maxWidth = 84;
          }
        } else {
          if (assignmentWidth !== null && assignmentWidth !== undefined) {
            if (Math.round(Number(copy.width)) !== assignmentWidth) {
              copy.width = assignmentWidth;
              changed++;
            }
            copy.minWidth = assignmentWidth;
            copy.maxWidth = assignmentWidth;
          }
        }
        return copy;
      });

      if (!changed && next.length === columns.length) return { ok: true, changed: 0 };
      try {
        grid.setColumns(next);
        if (typeof grid.invalidate === 'function') grid.invalidate();
        if (typeof grid.render === 'function') grid.render();
        if (typeof grid.invalidateAllRows === 'function') grid.invalidateAllRows();
        if (typeof grid.resizeCanvas === 'function') grid.resizeCanvas();
        return { ok: true, changed: changed };
      } catch (e) {
        try {
          grid.setColumns(columns);
          if (typeof grid.invalidate === 'function') grid.invalidate();
          if (typeof grid.render === 'function') grid.render();
          if (typeof grid.invalidateAllRows === 'function') grid.invalidateAllRows();
          if (typeof grid.resizeCanvas === 'function') grid.resizeCanvas();
        } catch (ignored) { /* stand down */ }
        return { ok: false, reason: 'failed' };
      }
    });
  }

  function resizeColumns(studentWidth, assignmentWidth, hideTotal) {
    var grid = findGrid();
    if (grid) return doResize(grid, studentWidth, assignmentWidth, hideTotal);
    return waitForGrid(4500).then(function (g) {
      if (!g) return { ok: false, reason: 'unavailable' };
      return doResize(g, studentWidth, assignmentWidth, hideTotal);
    });
  }

  // Periodic safety pass: keep uniform widths locked even after client-side course navigation
  if (typeof setInterval === 'function') {
    setInterval(function () {
      var g = window.__cgpLiveGrid || findGrid();
      if (g) {
        if (!g.__cgpPatchedSetColumns) patchGrid(g);
        enforceColumnWidths(g);
      }
    }, 1500);
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-grid-request' || !message.id) return;
    var studentWidth = Number(message.studentWidth);
    var assignmentWidth = Number(message.assignmentWidth);
    var hideTotal = !!message.hideTotal;
    if (!isFinite(studentWidth) || !isFinite(assignmentWidth) || studentWidth < 1 || assignmentWidth < 1) return;
    resizeColumns(Math.round(studentWidth), Math.round(assignmentWidth), hideTotal).then(function (result) {
      window.postMessage({ source: 'cgp-grid-response', id: message.id, result: result }, window.location.origin);
    });
  });
})();
