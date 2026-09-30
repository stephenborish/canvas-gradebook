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
      return typeof grid.getColumns === 'function' &&
        typeof grid.setColumns === 'function';
    } catch (e) {
      return false;
    }
  }

  function findGrid() {
    var candidates = [];

    // 1. Check window globals and properties
    [
      window.gradebook, window.Gradebook, window.grid, window.slickGrid,
      window.slickgrid, window._grid, window.gradebookGrid, window.canvasGradebook,
      window.INST, window.INST && window.INST.gradebook, window.INST && window.INST.Gradebook,
      window.INST && window.INST.grid
    ].forEach(function (g) {
      try {
        if (g && typeof g === 'object' && !isWindow(g)) {
          candidates.push(g);
          if (g.grid && !isWindow(g.grid)) candidates.push(g.grid);
          if (g.slickGrid && !isWindow(g.slickGrid)) candidates.push(g.slickGrid);
          if (g.slickgrid && !isWindow(g.slickgrid)) candidates.push(g.slickgrid);
        }
      } catch (e) {}
    });

    // Scan window top-level properties safely
    try {
      var winKeys = Object.keys(window);
      for (var k = 0; k < winKeys.length; k++) {
        var key = winKeys[k];
        if (/^\d+$/.test(key)) continue;
        try {
          var val = window[key];
          if (val && typeof val === 'object' && !isWindow(val)) {
            candidates.push(val);
            if (val.grid && !isWindow(val.grid)) candidates.push(val.grid);
            if (val.slickGrid && !isWindow(val.slickGrid)) candidates.push(val.slickGrid);
            if (val.slickgrid && !isWindow(val.slickgrid)) candidates.push(val.slickgrid);
            if (val._grid && !isWindow(val._grid)) candidates.push(val._grid);
          }
        } catch (e) {}
      }
    } catch (e) {}

    // 2. Candidate DOM elements across all known Canvas selectors
    var domRoots = [];
    try {
      var queried = document.querySelectorAll(
        '#gradebook_grid, .gradebook-grid, [data-component="GradebookGrid"], .slickgrid-container, .slick-pane, .slick-viewport, .slick-viewport-left, .slick-viewport-right, .slick-header, .grid-canvas, #content, .ic-Layout-contentMain, [class*="gradebook"]'
      );
      domRoots = Array.prototype.slice.call(queried);
    } catch (e) {}

    // Also climb up from any .slick-header-columns or .grid-canvas
    var sample = document.querySelector('.slick-header-columns, .grid-canvas');
    var curr = sample;
    for (var depth = 0; depth < 10 && curr && curr !== document.body; depth++) {
      if (domRoots.indexOf(curr) < 0) domRoots.push(curr);
      curr = curr.parentElement;
    }

    var jq = window.jQuery || window.$;

    for (var d = 0; d < domRoots.length; d++) {
      var el = domRoots[d];
      if (!el) continue;

      // Direct properties
      candidates.push(el.slickGrid, el.slickgrid, el.grid, el.__slickGrid, el._grid, el.gridInstance);

      // jQuery data
      if (typeof jq === 'function') {
        try {
          var data = jq(el).data();
          if (data) {
            candidates.push(data.slickGrid, data.slickgrid, data.grid, data._grid);
            for (var dk in data) {
              if (data[dk] && typeof data[dk] === 'object') {
                candidates.push(data[dk], data[dk].grid, data[dk].slickGrid, data[dk].slickgrid);
              }
            }
          }
        } catch (e) {}
      }

      // React Fiber traversal
      try {
        var keys = Object.keys(el);
        for (var ki = 0; ki < keys.length; ki++) {
          var propName = keys[ki];
          if (propName.indexOf('__reactFiber') === 0 || propName.indexOf('__reactInternalInstance') === 0) {
            var fiber = el[propName];
            var fCurr = fiber;
            for (var fDepth = 0; fDepth < 20 && fCurr; fDepth++) {
              var sn = fCurr.stateNode;
              if (sn && typeof sn === 'object') {
                candidates.push(sn, sn.grid, sn.slickGrid, sn.slickgrid, sn._grid);
                if (sn.state && typeof sn.state === 'object') candidates.push(sn.state.grid, sn.state.slickGrid);
                if (sn.props && typeof sn.props === 'object') candidates.push(sn.props.grid, sn.props.slickGrid);
              }
              var mp = fCurr.memoizedProps;
              if (mp && typeof mp === 'object') {
                candidates.push(mp.grid, mp.slickGrid, mp.slickgrid, mp._grid);
              }
              var ms = fCurr.memoizedState;
              if (ms && typeof ms === 'object') {
                candidates.push(ms.grid, ms.slickGrid, ms.slickgrid, ms._grid);
                var hook = ms;
                for (var hDepth = 0; hDepth < 20 && hook; hDepth++) {
                  if (hook.memoizedState && typeof hook.memoizedState === 'object') {
                    var hs = hook.memoizedState;
                    candidates.push(hs, hs.current, hs.grid, hs._grid);
                    if (hs.current && typeof hs.current === 'object') {
                      candidates.push(hs.current.grid, hs.current._grid, hs.current.slickGrid);
                    }
                  }
                  hook = hook.next;
                }
              }
              // Also check children if stateNode was empty
              if (fCurr.child && fDepth < 5) {
                var ch = fCurr.child;
                if (ch.stateNode && typeof ch.stateNode === 'object') {
                  candidates.push(ch.stateNode, ch.stateNode.grid, ch.stateNode.slickGrid);
                }
              }
              fCurr = fCurr.return;
            }
          }
        }
      } catch (e) {}
    }

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (validGrid(c)) return c;
      try {
        if (c && validGrid(c.current)) return c.current;
      } catch (e) {}
    }
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
        if (!Array.isArray(columns) || !columns.length) { resolve(null); return; }
        var current = signature(columns);
        if (current === previous) { resolve(columns); return; }
        previous = current;
        attempts++;
        if (attempts >= 20) { resolve(null); return; }
        setTimeout(poll, 50);
      }
      poll();
    });
  }

  function waitForGrid(timeoutMs) {
    var g = findGrid();
    if (g) return Promise.resolve(g);
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

  var cgpState = window.__cgpState = window.__cgpState || { hideTotal: false, studentWidth: null, assignmentWidth: null };

  function patchGrid(grid) {
    if (!grid || grid.__cgpPatchedSetColumns) return;
    var orig = grid.setColumns;
    if (typeof orig !== 'function') return;
    grid.setColumns = function(columns) {
      if (!Array.isArray(columns)) return orig.call(this, columns);
      columns.forEach(function(col) {
        var kind = columnKind(col);
        if (kind === 'student') {
          var sWant = cgpState.studentWidth;
          if (sWant !== null && sWant !== undefined) {
            if (Math.round(Number(col.width)) !== sWant) col.width = sWant;
            col.minWidth = sWant;
            col.maxWidth = sWant;
          }
        } else if (kind === 'total') {
          if (cgpState.hideTotal) {
            col.width = 84;
            col.minWidth = 84;
            col.maxWidth = 84;
          }
        } else {
          var aWant = cgpState.assignmentWidth;
          if (aWant !== null && aWant !== undefined) {
            if (Math.round(Number(col.width)) !== aWant) col.width = aWant;
            col.minWidth = aWant;
            col.maxWidth = aWant;
          }
        }
      });
      return orig.call(this, columns);
    };
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
    return waitForGrid(3000).then(function (g) {
      if (!g) return { ok: false, reason: 'unavailable' };
      return doResize(g, studentWidth, assignmentWidth, hideTotal);
    });
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
