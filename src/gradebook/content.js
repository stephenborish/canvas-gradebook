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

    var layout = new CGP.CompactLayoutController({ adapter: adapter, settings: settings });
    layout.start();

    var switcher = new CGP.CourseSwitcher({ api: api, courseId: courseId, settings: settings });
    switcher.start();

    var requestPaint = function () { paint(); };

    var popover = new CGP.CommentPopoverController({
      model: model, adapter: adapter, settings: settings, requestPaint: requestPaint,
      writer: null // set below
    });
    var writer = new CGP.GradeWriter({ api: api, model: model, settings: settings });
    popover.writer = writer;

    var indicators = new CGP.IndicatorController({
      model: model, adapter: adapter, registry: registry, settings: settings,
      onCommentClick: function (info) { popover.open(info); }
    });
    var selection = new CGP.SelectionController({
      adapter: adapter, model: model, settings: settings, requestPaint: requestPaint
    });
    var frozen = new CGP.FrozenTotalController({ adapter: adapter, model: model, settings: settings });
    var keyboard = new CGP.KeyboardGradingController({
      adapter: adapter, model: model, writer: writer, selection: selection,
      settings: settings, requestPaint: requestPaint
    });
    var paste = new CGP.BulkPasteController({
      adapter: adapter, model: model, writer: writer, selection: selection,
      settings: settings, requestPaint: requestPaint
    });

    var painting = false;
    var paint = CGP.util.rafBatch(function () {
      painting = true;
      try {
        layout.decorateHeaders(model);
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
      keyboard.start();
      paste.start();
      frozen.start();
      bindScroll();
      observeGrid();
      paint();

      // Slower safety tick: catches any rerender an observer missed. Cheap,
      // because unchanged cells are skipped by their paint signature. Also
      // retries the name-based column fallback while anything is unresolved.
      setInterval(function () {
        if (document.hidden) return;
        bindScroll();
        if (model.ready && adapter._lastUnresolvedColumns) {
          adapter.reconcileColumnsWithModel(model);
        }
        paint();
      }, 1500);

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

      return model.init().then(function () {
        CGP.diag.log('model.ready', model.stats());
        if (adapter._lastUnresolvedColumns) adapter.reconcileColumnsWithModel(model);

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
        return model.ensureAssignments(visibleIds).then(function () {
          return model.verifyVisibleComments(visibleIds);
        }).then(function () {
          CGP.diag.log('comments.visibleLoaded', model.stats());
          paint();
          if (CGP.settings.values.prefetchAllAssignments) {
            setTimeout(function () { model.prefetchRemaining(); }, 1200);
          }
        });
      }, function (err) {
        CGP.diag.error('boot.modelFailed', { status: err && err.status, message: String(err && err.message) });
        CGP.ui.error('Gradebook+ could not read this course from Canvas. Canvas itself is unaffected.');
      });
    }).then(function () {
      CGP.settings.onChange(function () {
        registry.invalidateAll();
        layout.start();
        paint();
      });
      window.addEventListener('message', function (e) {
        if (e.source !== window || !e.data || e.data.source !== 'cgp-env') return;
        var env = e.data.env || {};
        if (env.currentUserId) CGP.diag.set('envUserId', String(env.currentUserId));
        if (env.courseId) CGP.diag.set('envCourseId', String(env.courseId));
      });
      injectEnvBridge();
      CGP.gradebook = {
        model: model, adapter: adapter, layout: layout, selection: selection,
        writer: writer, paint: paint, diag: CGP.diag
      };
    });
  }

  function boot() {
    return CGP.settings.load().then(function () {
      var path = location.pathname;
      var isSpeedGrader = /\/gradebook\/speed_grader/.test(path);
      var isGradebook = !isSpeedGrader && /\/courses\/\d+\/gradebook\/?$/.test(path);
      var courseId = CGP.util.courseIdFromPath(path);
      CGP.diag.set('page', isSpeedGrader ? 'speedgrader' : (isGradebook ? 'gradebook' : 'other'));

      if (isSpeedGrader) {
        if (CGP.startSpeedGrader) CGP.startSpeedGrader(courseId);
        return null;
      }
      if (!isGradebook || !courseId) return null;
      return startGradebook(courseId);
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
