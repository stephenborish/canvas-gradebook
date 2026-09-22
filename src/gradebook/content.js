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

  // manifest.json exposes env-bridge.js as web-accessible to "*://*/*", not
  // just *.instructure.com: this content script itself only ever runs on an
  // instructure.com domain or a self-hosted one the teacher explicitly
  // granted through the options page (optional_host_permissions is already
  // "*://*/*" for exactly that reason), so a self-hosted domain would
  // otherwise have this <script src> silently blocked by Chrome and never
  // learn the active grading period at all. The bridge script itself reads
  // nothing but window.ENV and posts back an allowlisted, already-public
  // payload, so being loadable on a wider set of origins than it actually
  // ever runs on is not a new exposure.
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

    var switcher = new CGP.CourseSwitcher({ api: api, courseId: courseId, settings: settings, isGradebookPage: true });
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
    var frozen = new CGP.FrozenTotalController({
      adapter: adapter, model: model, settings: settings,
      // While a column-sizing transaction is in flight, the frozen pane's
      // natural width and the grid's real column widths are momentarily out
      // of step - see layout.resizeColumns(). Skipping paint()/measure()
      // for that narrow window means the overlay is only ever built from a
      // grid Canvas has finished laying out, never a half-applied one.
      isSizingPending: function () { return !!layout._resizing; }
    });
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
        // frozen.paint() runs BEFORE hideTestStudentRows(), not after: it is
        // what creates/repositions the .cgp-total-cell overlay elements (see
        // frozen-total.js), and hideTestStudentRows()'s own `others` query
        // matches those same .cgp-total-cell nodes to keep the Test
        // Student's row hidden across every pane, INCLUDING that overlay.
        // Running hideTestStudentRows() first used to mean a .cgp-total-cell
        // freshly created THIS SAME PASS (a fresh rowIndex the cell pool had
        // never seen - e.g. right after a scroll or a re-render moved the
        // Test Student to a row this overlay hadn't drawn before) got no
        // cgp-hidden-row class at all until the NEXT full paint pass - a
        // real, if narrow, window where the Test Student's Total cell could
        // show. Ordering it last closes that window every single pass.
        frozen.paint();
        layout.hideTestStudentRows();
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

    /* Belt-and-braces for bindScroll() above: per-viewport listeners only
     * ever cover whichever `.slick-viewport` ELEMENTS existed at the moment
     * bindScroll() last ran. Canvas can - on a sort, a filter change, or
     * simply re-rendering a pane after this extension's own frozen-Total
     * widen (see frozen-total.js) - tear down and recreate that element
     * outright, which silently orphans the old listener: nothing calls
     * paint() again for that pane's scrolling until the next periodic
     * bindScroll() call (content.js's safetyTick, up to 1500ms later) finds
     * and binds the replacement. That gap is exactly the kind of window
     * where hideTestStudentRows() would not re-run after a scroll and the
     * Test Student's row could sit unhidden for up to a second and a half.
     *
     * A single capture-phase listener on `document` sidesteps needing to
     * know which element scrolled at all: the 'scroll' event does not
     * bubble, but it IS dispatched during the capture phase on every
     * ancestor of the element that scrolled, `document` included, in every
     * browser this extension runs in. This also means ANY horizontal scroll
     * of an ancestor above the grid - the exact failure mode Bug 1's fix
     * (applyPaneGeometry / clampAncestorOverflow in frozen-total.js) targets
     * directly - still triggers a repaint even if that fix somehow missed a
     * case this extension does not yet know about, instead of the Test
     * Student staying visible with nothing left to ever hide it again. */
    function bindDocumentScroll() {
      document.addEventListener('scroll', paint, { passive: true, capture: true });
    }

    // Reconciles column widths and, on success, the frozen-pane geometry that
    // depends on them. Debounced so a burst of header mutations (Canvas
    // replacing several column nodes in one re-render) triggers exactly one
    // transaction rather than one per mutation record.
    //
    // resizeColumns() can legitimately decline to run this pass - the bridge
    // reports the column model still settling, or a teacher is mid-edit, in
    // a column menu, or mid-drag (see layout.js's isUserBusy()/backoff). None
    // of those states has any OTHER trigger that will ever ask again: with
    // the old unconditional 1.5s tick gone, a visible tab that sees no
    // further header mutation or visibility change would otherwise sit at
    // Canvas's default widths indefinitely. So a decline reschedules its own
    // retry instead of just repainting and giving up - narrowColumns being on
    // is itself the standing request to keep trying until it succeeds (or is
    // turned off).
    var _reconcileRetryTimer = null;
    function scheduleReconcileRetry() {
      if (_reconcileRetryTimer) return;
      _reconcileRetryTimer = setTimeout(function () {
        _reconcileRetryTimer = null;
        reconcileColumns();
      }, 1000);
    }
    var reconcileColumns = CGP.util.debounce(function () {
      layout.resizeColumns().then(function (sized) {
        if (sized) { frozen.measure(); paint(); return; }
        paint();
        if (settings.values.narrowColumns) scheduleReconcileRetry();
      });
    }, 200);

    function mutationTouchesHeader(record) {
      if (record.target && record.target.closest && record.target.closest('.slick-header')) return true;
      // Canvas can replace the `.slick-header` element itself, not just a
      // node inside it - the mutation's target is then the header's PARENT,
      // so target.closest('.slick-header') finds nothing even though the
      // added/removed node IS (or contains) the header. Checking those nodes
      // directly catches that wholesale-replacement case too.
      var moved = Array.prototype.slice.call(record.addedNodes || [])
        .concat(Array.prototype.slice.call(record.removedNodes || []));
      for (var i = 0; i < moved.length; i++) {
        var node = moved[i];
        if (node.nodeType !== 1) continue;
        if (node.classList && node.classList.contains('slick-header')) return true;
        if (node.querySelector && node.querySelector('.slick-header')) return true;
      }
      return false;
    }

    function observeGrid() {
      var root = adapter.gridRoot() || document.querySelector('#content') || document.body;
      var observer = new MutationObserver(function (records) {
        var relevant = false;
        var headerChanged = false;
        for (var i = 0; i < records.length; i++) {
          if (isOurMutation(records[i])) continue;
          relevant = true;
          if (mutationTouchesHeader(records[i])) headerChanged = true;
        }
        if (relevant) paint();
        // A header replacement is exactly the event narrowColumns needs to
        // react to - Canvas rebuilding the header row is what leaves column
        // widths at their un-narrowed defaults again.
        if (headerChanged) reconcileColumns();
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
      bindDocumentScroll();
      observeGrid();
      paint();

      // Best-effort, once per page load: push this teacher's preferred View
      // Options into Canvas's own settings tray so they never have to do it
      // by hand per course. A no-op unless syncViewOptionsToCanvas is on.
      layout.syncViewOptions();

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
        // A backgrounded tab is exactly the kind of gap Canvas can use to
        // rebuild the header row (or leave a resize half-settled) with no one
        // watching - reconcile column widths the moment the teacher looks
        // again rather than waiting for the next header-mutation event.
        reconcileColumns();
      });

      // Narrow Canvas's own column widths once the grid has had a moment to
      // settle after boot, then re-measure the frozen pane.
      setTimeout(reconcileColumns, 500);

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
        // frozen.paint() (called from the render loop below) already retries
        // start() on its own while the setting is on and not yet enabled -
        // but turning the setting OFF has no such path back, since paint()
        // only ever checks in the other direction. Stop explicitly here so
        // toggling it off actually removes the overlay and restores Canvas's
        // own pane geometry immediately, instead of leaving both in place
        // until the next full page load.
        if (!CGP.settings.values.frozenTotal && frozen.enabled) frozen.stop();
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
    var switcher = new CGP.CourseSwitcher({ api: api, courseId: courseId, settings: settings, isGradebookPage: false });
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
