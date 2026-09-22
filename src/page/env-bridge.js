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

  /* SlickGrid is also owned by Canvas's page world. Function-bearing grid
   * objects cannot be passed to the isolated content script, so perform the
   * complete, atomic column transaction here and return only its outcome. */
  function validGrid(grid) {
    return grid && typeof grid.getColumns === 'function' &&
      typeof grid.setColumns === 'function' && typeof grid.invalidate === 'function' &&
      typeof grid.render === 'function' && typeof grid.resizeCanvas === 'function';
  }

  function findGrid() {
    var root = document.querySelector('#gradebook_grid');
    var candidates = [];
    if (root) candidates.push(root.slickGrid, root.slickgrid, root.grid, root.__slickGrid);
    var jq = window.jQuery || window.$;
    if (root && typeof jq === 'function') {
      try {
        var data = jq(root).data();
        if (data) candidates.push(data.slickGrid, data.slickgrid, data.grid);
      } catch (e) { /* an unrelated `$` is not a grid API */ }
    }
    [window.gradebook, window.Gradebook].forEach(function (owner) {
      if (owner) candidates.push(owner.grid, owner.slickGrid, owner.slickgrid);
    });
    for (var i = 0; i < candidates.length; i++) if (validGrid(candidates[i])) return candidates[i];
    return null;
  }

  function columnKind(column) {
    var id = String((column && (column.id || column.field)) || '').toLowerCase();
    if (id === 'student' || id === 'student_name' || id === 'name') return 'student';
    if (/^assignment[_-]/.test(id) || (column && column.assignment_id != null)) return 'assignment';
    return null;
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

  function resizeColumns(studentWidth, assignmentWidth) {
    var grid = findGrid();
    if (!grid) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return stableColumns(grid).then(function (columns) {
      if (!columns) return { ok: false, reason: 'unstable' };
      var changed = 0;
      var next = columns.map(function (column) {
        var copy = Object.assign({}, column);
        var kind = columnKind(copy);
        var want = kind === 'student' ? studentWidth : (kind === 'assignment' ? assignmentWidth : null);
        if (want !== null && Math.round(Number(copy.width)) !== want) {
          copy.width = want;
          changed++;
        }
        return copy;
      });
      if (!changed) return { ok: true, changed: 0 };
      try {
        grid.setColumns(next);
        grid.invalidate();
        grid.render();
        grid.resizeCanvas();
        return { ok: true, changed: changed };
      } catch (e) {
        try { grid.setColumns(columns); grid.invalidate(); grid.render(); grid.resizeCanvas(); } catch (ignored) { /* stand down */ }
        return { ok: false, reason: 'failed' };
      }
    });
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window || !message || message.source !== 'cgp-grid-request' || !message.id) return;
    var studentWidth = Number(message.studentWidth);
    var assignmentWidth = Number(message.assignmentWidth);
    if (!isFinite(studentWidth) || !isFinite(assignmentWidth) || studentWidth < 1 || assignmentWidth < 1) return;
    resizeColumns(Math.round(studentWidth), Math.round(assignmentWidth)).then(function (result) {
      window.postMessage({ source: 'cgp-grid-response', id: message.id, result: result }, window.location.origin);
    });
  });
})();
