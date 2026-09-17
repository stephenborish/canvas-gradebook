/* Canvas Gradebook+ - entry point.
 *
 * Decides which page we are on, waits for Canvas to render its grid, then wires
 * the controllers together. All repainting funnels through one rAF-batched
 * pass, and the MutationObserver ignores mutations caused by our own nodes so
 * Canvas rerenders can never turn into a render loop. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP._booted) return;
  CGP._booted = true;

  var OURS = /(^|\s)cgp-/;

  function isOurNode(node) {
    if (!node) return false;
    if (node.nodeType === 3) return false;
    if (node.classList && OURS.test(node.className || '')) return true;
    if (node.closest && node.closest('.cgp-marks, .cgp-total-layer, .cgp-pop, .cgp-course-menu, .cgp-toast')) return true;
    return false;
  }

  function isOurMutation(rec) {
    if (isOurNode(rec.target)) return true;
    var added = Array.prototype.slice.call(rec.addedNodes || []);
    var removed = Array.prototype.slice.call(rec.removedNodes || []);
    var all = added.concat(removed);
    if (!all.length) return false;
    return all.every(isOurNode);
  }

  function waitFor(test, timeoutMs) {
    return new Promise(function (resolve) {
      if (test()) { resolve(true); return; }
      var started = Date.now();
      var timer = setInterval(function () {
        if (test()) { clearInterval(timer); resolve(true); return; }
        if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(false); }
      }, 200);
    });
  }

  function injectEnvBridge() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return;
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/page/env-bridge.js');
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) { CGP.diag.warn('env.injectFailed'); }
  }

  function startGradebook(courseId) {
    var settings = CGP.settings;
    var api = new CGP.CanvasApi();
    var model = new CGP.GradebookModel(api, courseId);
    var adapter = new CGP.GradebookDomAdapter();
    var registry = new CGP.CellRegistry();

    document.documentElement.classList.add('cgp-gradebook');

    // Bound and injected as early as possible - before the model's own first
    // network round trip even starts, ideally - so the grading period Canvas
    // is actually using has the best chance of being known BEFORE init()'s
    // one and only whole-roster Total read, rather than correcting it
    // afterwards. See env-bridge.js and model.setGradingPeriod. A late
    // arrival still self-corrects; it is just one extra read instead of zero.
    window.addEventListener('message', function (e) {
      if (e.source !== window || !e.data || e.data.source !== 'cgp-env') return;
      var env = e.data.env || {};
      if (env.currentUserId) CGP.diag.set('envUserId', String(env.currentUserId));
      if (env.courseId) CGP.diag.set('envCourseId', String(env.courseId));
      if (env.currentGradingPeriodId !== undefined) model.setGradingPeriod(env.currentGradingPeriodId);
    });
    injectEnvBridge();

    var layout = new CGP.CompactLayoutController({ adapter: adapter, settings: settings });
    layout.start();

    var switcher = new CGP.CourseSwitcher({ api: api, courseId: courseId, settings: settings });
    switcher.start();

    // Started after the switcher so it can seat itself to the right of it in
    // the breadcrumb rather than between the course name and its own control.
    var studentSearch = new CGP.StudentSearch({ api: api, courseId: courseId, settings: settings });
    studentSearch.start();

    var requestPaint = function () { paint(); };

    var cellActions = new CGP.CellActionsController({ adapter: adapter, settings: settings, courseId: courseId });

    var popover = new CGP.CommentPopoverController({
      model: model, adapter: adapter, settings: settings, requestPaint: requestPaint,
      writer: null, // set below
      // Clicking the hover preview opens Canvas's own Grade Detail Tray for
      // that submission, through the same code path double-click uses.
      openSidePane: function (info) { cellActions.openTray(info.el, info, 8); }
    });
    var writer = new CGP.GradeWriter({ api: api, model: model, settings: settings });
    popover.writer = writer;

    var bulkComment = new CGP.BulkCommentController({
      model: model, writer: writer, settings: settings, requestPaint: requestPaint
    });

    var indicators = new CGP.IndicatorController({
      model: model, adapter: adapter, registry: registry, settings: settings,
      onCommentClick: function (info) { popover.open(info); },
      onCommentHover: function (info) { popover.showPreview(info); },
      onCommentLeave: function () { popover.hidePreviewSoon(); },
      onCommentDismiss: function () { popover.hidePreview(); }
    });
    var selection = new CGP.SelectionController({
      adapter: adapter, model: model, settings: settings, requestPaint: requestPaint
    });
    var frozen = new CGP.FrozenTotalController({ adapter: adapter, model: model, settings: settings });
    var keyboard = new CGP.KeyboardGradingController({
      adapter: adapter, model: model, writer: writer, selection: selection,
      settings: settings, requestPaint: requestPaint, bulkComment: bulkComment
    });
    // Header-level action: post the grades a column is still hiding from
    // students. Painted with the headers, because that is where the state it
    // reports (this column has N grades students cannot see) belongs.
    var posting = new CGP.PostGradesController({
      model: model, adapter: adapter, api: api, settings: settings, requestPaint: requestPaint
    });
    var paste = new CGP.BulkPasteController({
      adapter: adapter, model: model, writer: writer, selection: selection,
      settings: settings, requestPaint: requestPaint
    });

    /* Scroll to one student's row and flash it.
     *
     * Used when arriving from the cross-course student search, and when that
     * search picks someone who is already in this gradebook. Rows are matched
     * by the student link Canvas puts in the frozen pane rather than by
     * computing a top from rowIndex * rowHeight, because the two disagree by a
     * pixel on some Canvas builds and a highlight on the wrong row is worse
     * than none. Both panes (and the frozen Total overlay) share a style.top,
     * so lighting all of them lights the whole row. */
    function rowPartsForStudent(userId) {
      var rows = document.querySelectorAll('.grid-canvas > .slick-row');
      var top = null;
      for (var i = 0; i < rows.length; i++) {
        if (String(adapter.studentIdFromRow(rows[i]) || '') === String(userId)) { top = rows[i].style.top; break; }
      }
      if (top === null) return [];
      var parts = document.querySelectorAll('.grid-canvas > .slick-row, .cgp-total-cell');
      var out = [];
      for (var j = 0; j < parts.length; j++) {
        if (parts[j].style && parts[j].style.top === top) out.push(parts[j]);
      }
      return out;
    }

    function flashStudent(userId) {
      var parts = rowPartsForStudent(userId);
      if (!parts.length) return false;
      parts.forEach(function (el) { el.classList.add('cgp-row-flash'); });
      setTimeout(function () {
        parts.forEach(function (el) { el.classList.remove('cgp-row-flash'); });
      }, 3200);
      return true;
    }

    CGP.revealStudent = function (userId) {
      var uid = String(userId);
      adapter.refreshRows();
      var idx = adapter.rowIndexForStudent(uid);
      if (idx !== null) {
        adapter.scrollRowIntoView(idx);
        setTimeout(function () { flashStudent(uid); }, 240);
        return;
      }
      // Not rendered: the row is somewhere off screen, so walk the grid to
      // learn the off-screen row identities before scrolling to it.
      var count = Math.max(model.studentOrder.length, 50);
      adapter.ensureRowsMapped(0, count).then(function () {
        var found = adapter.rowIndexForStudent(uid);
        if (found === null) {
          CGP.ui.error('That student is not in this gradebook\u2019s current view \u2014 a Canvas filter or section may be hiding them.');
          CGP.diag.warn('revealStudent.notInGrid');
          return;
        }
        adapter.scrollRowIntoView(found);
        setTimeout(function () { flashStudent(uid); }, 240);
      });
    };

    /* Arriving from the search in another course: the target student rides in
     * on the URL hash. It is stripped immediately so reloading or bookmarking
     * the page does not keep re-triggering the jump. */
    function consumeStudentHash() {
      var m = /^#cgp-student=(\d+)/.exec(location.hash || '');
      if (!m) return null;
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      return m[1];
    }

    var painting = false;
    var paint = CGP.util.rafBatch(function () {
      painting = true;
      try {
        layout.decorateHeaders(model);
        posting.paint();
        indicators.paint();
        selection.paint(registry.lastCells);
        frozen.paint();
      } finally {
        painting = false;
      }
    }, 'render');

    /* observers ---------------------------------------------------------- */
    var boundViewports = new WeakSet();
    function bindScroll() {
      adapter.viewports().forEach(function (vp) {
        if (boundViewports.has(vp)) return;
        boundViewports.add(vp);
        vp.addEventListener('scroll', paint, { passive: true });
      });
    }

    function observeGrid() {
      var root = adapter.gridRoot() || document.querySelector('#content') || document.body;
      var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          if (!isOurMutation(records[i])) { paint(); return; }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      CGP.diag.log('observer.attached');
      return observer;
    }

    return waitFor(function () { return adapter.isReady(); }, 30000).then(function (ready) {
      if (!ready) {
        CGP.diag.error('boot.gridNotFound');
        return;
      }
      indicators.start();
      selection.start();
      cellActions.start();
      keyboard.start();
      paste.start();
      frozen.start();
      bindScroll();
      observeGrid();
      paint();

      // Slower safety tick: catches any rerender an observer missed. Cheap,
      // because unchanged cells are skipped by their paint signature. Also
      // retries the name-based column fallback while anything is unresolved.
      function safetyTick() {
        bindScroll();
        if (model.ready && adapter._lastUnresolvedColumns) {
          adapter.reconcileColumnsWithModel(model);
        }
        // Cheap and idempotent: recovers a wrapper this session wrongly
        // collapsed because it looked empty at the time but has since had
        // real Canvas content render into it. See recheckCollapsedWrappers.
        if (layout.controlsHidden) layout.recheckCollapsedWrappers();
        // Unconditional, like the initial call in layout.start(): Canvas can
        // re-render the keyboard-shortcuts button with a fresh DOM node
        // (losing our cgp-hidden class) at any point while the gradebook is
        // open. The settings gear is covered by the utility-strip re-hide
        // below, plus a CSS rule that needs no JS at all.
        layout.hideKeyboardShortcutsButton();
        // Re-checked on every tick, not just once at boot: a column that was
        // not yet rendered (or whose first resize attempt failed because
        // Canvas had not finished mounting it) is picked up here instead of
        // being left at Canvas's original width for the rest of the page's
        // life. resizeColumns() itself is cheap to call when nothing is out
        // of spec - one measurement pass, no drags - so this costs nothing in
        // the steady state.
        layout.resizeColumns().then(function () { frozen.measure(); paint(); });
      }

      // Slower safety tick: catches any rerender an observer missed.
      setInterval(function () {
        if (document.hidden) return;
        safetyTick();
      }, 1500);

      // A backgrounded tab pauses the tick above entirely (there is nothing
      // to gain from resizing columns or reconciling column names nobody is
      // looking at), so a teacher switching back to this tab after a while
      // could otherwise be looking at a grid up to 1500ms stale before the
      // next tick happens to land. Running the same work the instant the tab
      // becomes visible again removes that wait - the whole point of never
      // needing to notice anything is stale in the first place.
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        safetyTick();
      });

      // Canvas's own column widths, then re-measure the frozen pane.
      setTimeout(function () {
        layout.resizeColumns().then(function () {
          frozen.measure();
          paint();
        });
      }, 500);

      // Keep the utility strip collapsed if Canvas re-renders it.
      if (CGP.settings.values.hideCanvasUtilityControls) {
        var reHide = CGP.util.debounce(function () {
          if (!layout.controlsHidden) return;
          layout.hideControls();
          layout.applyGeometry();
        }, 600);
        var contentRoot = document.querySelector('#content') || document.body;
        new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            if (isOurMutation(records[i])) continue;
            if (records[i].target && records[i].target.closest &&
              records[i].target.closest('.grid-canvas, .slick-header')) continue;
            reHide();
            return;
          }
        }).observe(contentRoot, { childList: true, subtree: true });
      }

      model.on('cells', paint);
      model.on('cell', paint);
      model.on('totals', paint);

      var jumpTo = consumeStudentHash();

      return model.init().then(function () {
        CGP.diag.log('model.ready', model.stats());
        if (adapter._lastUnresolvedColumns) adapter.reconcileColumnsWithModel(model);
        if (jumpTo) setTimeout(function () { CGP.revealStudent(jumpTo); }, 350);

        // Do not wait for a later paint/scroll cycle to discover comments. Load
        // the assignment columns that are on screen right now immediately.
        // This is the data that drives the in-cell instructor-comment bubble.
        var visibleIds = [];
        adapter.visibleCells().forEach(function (c) {
          if (c.columnType === 'assignment' && c.assignmentId && visibleIds.indexOf(String(c.assignmentId)) < 0) {
            visibleIds.push(String(c.assignmentId));
          }
        });
        CGP.diag.set('visibleAssignmentIds', visibleIds.length);
        // ensureAssignments alone already paints values, comment bubbles and
        // every other indicator for the visible columns - it emits 'cells' as
        // soon as its own (bulk) fetch lands, which model.on('cells', paint)
        // above is already listening for. verifyVisibleComments is a
        // defensive fallback for Canvas builds that do not reliably include
        // comments on that bulk endpoint, and prefetching the rest of the
        // course is background warming - neither is what the teacher is
        // waiting on to see this screenful of the grid, so neither should
        // make the other (or the visible screen) wait on it. Both are still
        // bounded by the same request pool, so this changes nothing about how
        // many requests are in flight at once - only which unrelated things
        // no longer queue behind each other for no reason.
        return model.ensureAssignments(visibleIds).then(function () {
          if (CGP.settings.values.prefetchAllAssignments) {
            setTimeout(function () { model.prefetchRemaining(); }, 1200);
          }
          return model.verifyVisibleComments(visibleIds).then(function () {
            CGP.diag.log('comments.visibleLoaded', model.stats());
            paint();
          });
        });
      }, function (err) {
        CGP.diag.error('boot.modelFailed', { status: err && err.status, message: String(err && err.message) });
        CGP.ui.error(CGP.util.describeApiError(err, { fallback: 'Gradebook+ could not read this course from Canvas' }) +
          ' Canvas itself is unaffected.');
      });
    }).then(function () {
      CGP.settings.onChange(function () {
        registry.invalidateAll();
        layout.start();
        paint();
      });
      CGP.gradebook = {
        model: model, adapter: adapter, layout: layout, selection: selection,
        writer: writer, posting: posting, bulkComment: bulkComment, paint: paint, diag: CGP.diag
      };
    });
  }

  /* Every other page inside a course - Assignments, Modules, Discussions, a
   * single student's Grades, wherever - gets only the breadcrumb course
   * switcher, not the gradebook grid. Canvas already renders the same
   * course-name breadcrumb on every one of these pages, so the same "Switch
   * course" control belongs on all of them, not only on the gradebook: a
   * teacher moving between courses is just as often starting from an
   * assignment or a module page as from the gradebook itself. Nothing else in
   * this file runs here - no model, no grid, no writes - so this costs
   * nothing beyond the one API call the switcher itself only makes once its
   * menu is actually opened. */
  function startCourseChrome(courseId) {
    document.documentElement.classList.add('cgp-on');
    var settings = CGP.settings;
    var api = new CGP.CanvasApi();
    var switcher = new CGP.CourseSwitcher({ api: api, courseId: courseId, settings: settings });
    switcher.start();
    // Re-run (idempotent: start() itself refuses to mount a second toggle,
    // and does nothing at all while the setting is off) so flipping the
    // setting on in the options page takes effect without a reload, the same
    // way the full gradebook page already behaves on a settings change.
    CGP.settings.onChange(function () { switcher.start(); });
  }

  function boot() {
    return CGP.settings.load().then(function () {
      var path = location.pathname;
      var isSpeedGrader = /\/gradebook\/speed_grader/.test(path);
      var isGradebook = !isSpeedGrader && /\/courses\/\d+\/gradebook\/?$/.test(path);
      var courseId = CGP.util.courseIdFromPath(path);
      CGP.diag.set('page', isSpeedGrader ? 'speedgrader' : (isGradebook ? 'gradebook' : (courseId ? 'course-other' : 'other')));

      if (isSpeedGrader) {
        if (CGP.startSpeedGrader) CGP.startSpeedGrader(courseId);
        return null;
      }
      if (isGradebook && courseId) return startGradebook(courseId);
      if (courseId) return startCourseChrome(courseId);
      return null;
    }).catch(function (e) {
      CGP.diag.error('boot.failed', { message: String(e && e.message) });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
