/* Canvas Gradebook+ - whole-cell gestures.
 *
 * Two small behaviours that make the grid feel like a spreadsheet rather than
 * a web page:
 *
 *  1. Double-clicking a grade cell opens whatever Canvas's own trailing arrow
 *     button in that cell opens (the Grade Detail Tray, or SpeedGrader on
 *     builds that link straight there). That control is a ~14px target that
 *     only exists while the cell is being edited; the whole cell is a much
 *     easier thing to hit, and double-click is the gesture people already
 *     expect to mean "open this". Canvas's own control is *clicked*, never
 *     reimplemented - so whatever it opens today is what a double-click opens,
 *     with no URL guessing on our part.
 *
 *     Because of that, the arrow itself is hidden by default (the CSS keeps it
 *     in the DOM and clickable, it just stops taking up pixels in an already
 *     narrow cell). This gesture is then the way in, which is why openTray
 *     below refuses to fail silently.
 *
 *     The arrow is rendered by Canvas only once the cell is active, and the
 *     first click of the double-click is what activates it, so the control may
 *     not exist yet at the moment the dblclick fires. We poll a few frames for
 *     it rather than assuming either way.
 *
 *  2. Row hover highlighting across BOTH panes. SlickGrid splits every row
 *     into one element per frozen pane, so a plain :hover rule lights up the
 *     student name or the grades but never both, which reads as a rendering
 *     bug rather than a highlight. Rows belonging to the same record always
 *     share a style.top, so that is what we match on. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CellActionsController) return;

  /* Ordered most-specific first. Everything here is a control CANVAS renders
   * inside the grade cell; our own markers live under .cgp-marks and are
   * excluded explicitly below. */
  var TRAY_SELECTORS = [
    '.Grid__GradeCell__Options button',
    '.Grid__GradeCell__Options [role="button"]',
    'button[data-testid*="grade-detail-tray" i]',
    'button[aria-label*="grade detail" i]',
    'button[title*="grade detail" i]',
    'a[href*="speed_grader" i]',
    '.Grid__GradeCell__EndContainer button',
    '.Grid__GradeCell__EndContainer a[href]'
  ];

  function CellActionsController(ctx) {
    this.adapter = ctx.adapter;
    this.settings = ctx.settings;
    this.courseId = ctx.courseId ? String(ctx.courseId) : null;
    this._hoverTop = null;
  }

  var P = CellActionsController.prototype;

  /** Canvas's own "open this submission" control inside one grade cell. */
  P.trayControl = function (cell) {
    for (var i = 0; i < TRAY_SELECTORS.length; i++) {
      var el = cell.querySelector(TRAY_SELECTORS[i]);
      if (el && !el.closest('.cgp-marks')) return el;
    }
    // Last resort: any control Canvas put in the cell that is not one of ours.
    var all = cell.querySelectorAll('button, [role="button"], a[href]');
    for (var j = 0; j < all.length; j++) {
      if (!all[j].closest('.cgp-marks')) return all[j];
    }
    return null;
  };

  /** Click Canvas's control, retrying while its editor is still rendering.
   *
   * The fallback matters more than it looks: with the arrow hidden (the
   * default), double-click is the ONLY way in, so "Canvas's markup was not
   * what we expected" must not become a dead end. If no control turns up,
   * open SpeedGrader for this exact submission instead - the same place the
   * arrow's tray is a shortcut to - rather than silently doing nothing. */
  P.openTray = function (cell, info, triesLeft) {
    var self = this;
    if (!cell.isConnected) return;
    var control = this.trayControl(cell);
    if (control) {
      // A plain native click: Canvas's own React handler is what we want to
      // run, and firing extra mousedown/mouseup around it can toggle a
      // freshly-opened tray straight back shut.
      control.click();
      CGP.diag.bump('cellActions.trayOpened');
      return;
    }
    if (triesLeft > 0) {
      setTimeout(function () { self.openTray(cell, info, triesLeft - 1); }, 90);
      return;
    }
    CGP.diag.warn('cellActions.trayControlMissing');
    if (!this.courseId || !info || !info.assignmentId || !info.studentId) return;
    var url = '/courses/' + encodeURIComponent(this.courseId) +
      '/gradebook/speed_grader?assignment_id=' + encodeURIComponent(String(info.assignmentId)) +
      '&student_id=' + encodeURIComponent(String(info.studentId));
    window.open(url, '_blank', 'noopener');
    CGP.diag.bump('cellActions.speedGraderFallback');
  };

  P.bindDoubleClick = function () {
    var self = this;
    document.addEventListener('dblclick', function (e) {
      if (!self.settings.values.doubleClickOpensTray) return;
      var target = e.target;
      if (!target || !target.closest) return;
      // Our own affordances keep their own gestures.
      if (target.closest('.cgp-cmt, .cgp-sub, .cgp-pop, .cgp-preview, .cgp-course-menu')) return;
      // A double-click that landed on Canvas's arrow already did this.
      if (target.closest('button, [role="button"], a[href]')) return;
      var cell = target.closest('.slick-cell');
      if (!cell) return;
      var info = self.adapter.cellInfo(cell);
      if (!info || info.columnType !== 'assignment' || !info.assignmentId || !info.studentId) return;
      // Only suppress the text-selection default; Canvas keeps the event.
      e.preventDefault();
      self.openTray(cell, info, 8);
    }, true);
  };

  /* ------------------------------------------------------------ row hover */

  /* Everything that represents one student row and is positioned by top:
   * the row element in each frozen pane, plus the overlay cell the frozen
   * Total column draws (which is stacked ON TOP of the left pane, so without
   * it the highlight would drop out every time the pointer crossed Total). */
  var ROW_PARTS = '.grid-canvas > .slick-row, .cgp-total-cell';

  P.clearRowHover = function () {
    if (this._hoverTop === null) return;
    this._hoverTop = null;
    var lit = document.querySelectorAll('.cgp-row-hover');
    for (var i = 0; i < lit.length; i++) lit[i].classList.remove('cgp-row-hover');
  };

  P.setRowHover = function (part) {
    var top = (part.style && part.style.top) || '';
    if (top === this._hoverTop) return;
    this.clearRowHover();
    this._hoverTop = top;
    if (!top) { part.classList.add('cgp-row-hover'); return; }
    var parts = document.querySelectorAll(ROW_PARTS);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].style && parts[i].style.top === top) parts[i].classList.add('cgp-row-hover');
    }
  };

  P.bindRowHover = function () {
    var self = this;
    document.addEventListener('mouseover', function (e) {
      if (!self.settings.values.rowHoverHighlight) return;
      var target = e.target;
      if (!target || !target.closest) return;
      // Our own floating surfaces are not "somewhere else in the page"; they
      // are drawn over the row being read, so leave the highlight alone.
      if (target.closest('.cgp-pop, .cgp-preview, .cgp-course-menu, .cgp-toast')) return;
      var part = target.closest(ROW_PARTS);
      if (!part) { self.clearRowHover(); return; }
      self.setRowHover(part);
    }, true);
    // Scrolling moves rows out from under the pointer without a mouseout, and
    // a re-render can replace the very element we lit.
    this.adapter.viewports().forEach(function (vp) {
      vp.addEventListener('scroll', function () { self.clearRowHover(); }, { passive: true });
    });
    // Leaving the document entirely (relatedTarget null) never produces a
    // mouseover on something else, so clear explicitly.
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget) self.clearRowHover();
    }, true);
  };

  P.start = function () {
    this.bindDoubleClick();
    this.bindRowHover();
  };

  CGP.CellActionsController = CellActionsController;
})();
