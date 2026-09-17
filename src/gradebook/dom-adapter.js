/* Canvas Gradebook+ - DOM adapter for the Canvas (SlickGrid) gradebook.
 *
 * This is the only file that is allowed to know what Canvas's markup looks
 * like. Everything else works with {assignmentId, userId, rowIndex, colIndex}.
 * If Canvas ships a different gradebook implementation, a sibling adapter can
 * be written without touching the grading logic.
 *
 * Mapping strategy (no reliance on a single fragile path, and no reliance on
 * DOM order alone, because rows and columns virtualize):
 *   column -> header element id "slickgrid_<uid>_assignment_<id>", or
 *             data-column-id, or an /assignments/<id> link in the header
 *   cell   -> absolute column index from the SlickGrid "l<n>" class
 *   row    -> style.top / rowHeight, with the student id read from the
 *             /courses/<id>/grades/<user_id> link in the frozen student cell
 * Both maps are remembered for the life of the page, so a cell that scrolls
 * out of view and back stays resolvable. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.GradebookDomAdapter) return;
  var gridMap = CGP.gridMap;

  var DEFAULT_ROW_HEIGHT = 35;

  function GradebookDomAdapter() {
    this.colIndexToColumn = new Map();   // absolute column index -> {columnId, type, assignmentId}
    this.columnIdToIndex = new Map();
    this.rowIndexToStudent = new Map();  // row index -> userId
    this.topToStudent = new Map();       // rounded style.top -> userId
    this.studentToRowIndex = new Map();
    this.paneOffsets = [];
    this.nameOverrideByTitle = new Map(); // header title (lowercase) -> assignmentId, learned once
    this._rowHeight = 0;
    this.unmapped = 0;
  }

  var P = GradebookDomAdapter.prototype;

  P.name = 'slickgrid';

  P.gridRoot = function () {
    var el = document.querySelector('#gradebook_grid');
    if (el) return el;
    var header = document.querySelector('.slick-header-columns');
    if (!header) return null;
    var node = header;
    for (var i = 0; i < 6 && node; i++) {
      node = node.parentElement;
      if (node && node.querySelector('.grid-canvas')) return node;
    }
    return document.querySelector('.gradebook-grid') || null;
  };

  P.isReady = function () {
    return !!(document.querySelector('.slick-header-column') && document.querySelector('.grid-canvas'));
  };

  P.headerContainers = function () {
    return this.orderPaneElements(document.querySelectorAll('.slick-header-columns'));
  };

  P.canvases = function () {
    return this.orderPaneElements(document.querySelectorAll('.grid-canvas'));
  };

  /* Left-to-right order for the two body/header panes - NOT by their current
   * getBoundingClientRect().left, which is only a safe proxy for "which pane
   * is which" while both are scrolled to their start. The right (scrolling)
   * pane's `.grid-canvas`/`.slick-header-columns` is the content INSIDE an
   * overflow:auto viewport, not the viewport itself - scrolling that viewport
   * moves the content left relative to the page, so a horizontal scroll far
   * enough right drives this element's rect left BELOW the stationary frozen
   * pane's, and a plain numeric sort then reports the scrolling pane as
   * pane[0] ("the frozen one") instead. Every caller of canvases()/
   * headerContainers() - frozenRowGeometry, frozenNaturalWidth, bodyPanes,
   * headerPanes, hideTestStudentRows, and more - trusts pane[0] to mean
   * "frozen", so that flip silently redirects the Total overlay and the
   * pane-widening math onto the wrong (scrolling) pane mid-scroll.
   *
   * leftViewport()/rightViewport() are the VIEWPORT (clipping) boxes, not
   * their scrolled content, so their own rect.left is untouched by their
   * internal scroll position - ordering by which viewport actually CONTAINS
   * each element is scroll-position-independent. Only falls back to the old
   * rect-based sort when a Canvas build doesn't split into two distinct
   * viewports at all (a single-pane course, or a markup this extension
   * doesn't recognize), where there is nothing to get backwards. */
  P.orderPaneElements = function (nodeList) {
    var list = Array.prototype.slice.call(nodeList);
    if (list.length < 2) return list;
    var left = this.leftViewport();
    var right = this.rightViewport();
    if (left && right && left !== right) {
      var inLeft = list.filter(function (el) { return left.contains(el); });
      var inRight = list.filter(function (el) { return right.contains(el); });
      var rest = list.filter(function (el) {
        return inLeft.indexOf(el) < 0 && inRight.indexOf(el) < 0;
      });
      if (inLeft.length && inRight.length) return inLeft.concat(inRight, rest);
    }
    return list.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
  };

  P.viewports = function () {
    return Array.prototype.slice.call(document.querySelectorAll('.slick-viewport'));
  };

  P.leftViewport = function () {
    var vps = this.viewports();
    if (!vps.length) return null;
    var left = vps.filter(function (v) { return /viewport-left/.test(v.className); });
    if (left.length) return left[0];
    return vps.slice().sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    })[0];
  };

  P.rightViewport = function () {
    var vps = this.viewports();
    if (!vps.length) return null;
    var right = vps.filter(function (v) { return /viewport-right/.test(v.className); });
    if (right.length) return right[0];
    var scrollable = vps.filter(function (v) { return v.scrollWidth > v.clientWidth + 4; });
    if (scrollable.length) return scrollable[scrollable.length - 1];
    return vps[vps.length - 1];
  };

  P.rowHeight = function () {
    if (this._rowHeight) return this._rowHeight;
    var row = document.querySelector('.grid-canvas .slick-row');
    var h = row ? Math.round(row.getBoundingClientRect().height) : 0;
    // Only a REAL measurement is ever cached. Locking in DEFAULT_ROW_HEIGHT
    // just because this ran before Canvas had rendered a single row yet -
    // entirely possible this early - would wrongly stick for the rest of the
    // page's life on any build whose actual row height differs from that
    // guess, and every row-index computation downstream (rowIndexFromTop)
    // divides by this same wrong number. That silently maps two DIFFERENT
    // real rows onto the SAME computed index, so one of the two students
    // there is simply never resolvable by index again. Returning the guess
    // for THIS call (so a caller has something usable right now) while
    // leaving _rowHeight unset means the very next call keeps trying for a
    // real measurement instead of being stuck with a wrong one forever.
    if (h > 8) this._rowHeight = h;
    return h > 8 ? h : DEFAULT_ROW_HEIGHT;
  };

  P.columnIdForHeader = function (el) {
    var fromId = gridMap.parseSlickColumnId(el.id || '');
    if (fromId) return fromId;

    var attr = el.getAttribute('data-column-id') || (el.dataset && el.dataset.columnId);
    if (attr) return attr;

    // A descendant may carry the id even when the header container does not
    // (seen with data-assignment-id on an inner title/button element).
    var withAssignmentAttr = el.querySelector('[data-assignment-id]');
    if (withAssignmentAttr) {
      var aid = withAssignmentAttr.getAttribute('data-assignment-id');
      if (aid) return 'assignment_' + aid;
    }
    var withColAttr = el.querySelector('[data-column-id]');
    if (withColAttr) {
      var cid = withColAttr.getAttribute('data-column-id');
      if (cid) return cid;
    }

    var link = el.querySelector('a[href*="/assignments/"]');
    if (link) {
      var m = /\/assignments\/(\d+)/.exec(link.getAttribute('href') || '');
      if (m) return 'assignment_' + m[1];
    }
    // Some header variants only expose the assignment via a button that opens
    // a details tray, using the id in an aria-controls / data-testid value.
    var btn = el.querySelector('[aria-controls*="assignment_" i], [data-testid*="assignment_" i]');
    if (btn) {
      var raw = (btn.getAttribute('aria-controls') || btn.getAttribute('data-testid') || '');
      var m2 = /assignment_(\d+)/.exec(raw);
      if (m2) return 'assignment_' + m2[1];
    }

    var text = (el.textContent || '').trim().toLowerCase();
    if (/^total/.test(text)) return 'total_grade';
    if (/^student/.test(text) || text.indexOf('student name') >= 0) return 'student';
    return null;
  };

  /** Visible title text of an assignment header, with the "Out of N" / points
   * line stripped, for the last-resort name match against the model. */
  P.headerTitleText = function (el) {
    var clone = el.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('.slick-resizable-handle, .cgp-header-label')).forEach(function (n) { n.remove(); });
    var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/\bout of\s+[\d.]+\s*$/i, '').replace(/[\u2014-]\s*[\d.]+\s*pts?\.?\s*$/i, '').trim();
    return text;
  };

  /** Header text with our OWN synthetic .cgp-header-label (and the resize
   * handle) stripped, but the native points/"out of N" text left in - unlike
   * headerTitleText, which strips that too. For reading the trailing points
   * number back out (reconcileColumnsWithModel's disambiguation, and
   * refreshColumns()'s re-check of it): once layout.js's decorateHeaders has
   * ever run on this header, it leaves behind a persistent
   * .cgp-header-label carrying its OWN "N pts"/due-date text, and plain
   * el.textContent would then end with THAT instead of Canvas's native
   * points text - reading the wrong number, or none at all, right after the
   * very re-decoration this points check itself triggers. */
  P.headerPointsSourceText = function (el) {
    var clone = el.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('.slick-resizable-handle, .cgp-header-label')).forEach(function (n) { n.remove(); });
    return clone.textContent || '';
  };

  /** Last resort: match still-unresolved header columns to a known assignment
   * by their visible title text. Only used for columns structural parsing
   * could not identify, and only ever narrows an 'other'/'unknown' column to
   * 'assignment' - it never overrides a column already classified.
   * Matches are remembered by title (not column index, which can shift) so
   * every future refreshColumns() picks them up without asking again. */
  P.reconcileColumnsWithModel = function (model) {
    if (!model || !model.ready) return 0;
    var self = this;
    var byName = new Map();
    model.assignmentOrder.forEach(function (id) {
      var a = model.assignments.get(id);
      if (!a || !a.name) return;
      var key = a.name.trim().toLowerCase();
      (byName.get(key) || byName.set(key, []).get(key)).push(a);
    });

    var fixed = 0;
    this.colIndexToColumn.forEach(function (entry, index) {
      if (!entry || entry.type === 'assignment' || !entry.el || !entry.el.isConnected) return;
      if (entry.type === 'student' || entry.type === 'total' || entry.type === 'group') return;
      var title = self.headerTitleText(entry.el);
      if (!title || self.nameOverrideByTitle.has(title.toLowerCase())) return;
      var candidates = byName.get(title.toLowerCase());
      if (!candidates || !candidates.length) return;
      var pick = candidates[0];
      var ambiguous = candidates.length > 1;
      if (ambiguous) {
        // Disambiguate identically named assignments using the points line.
        // (This guard only ever reaches columns not already typed
        // 'assignment', which is also exactly when decorateHeaders has never
        // added its own .cgp-header-label here - but headerPointsSourceText
        // strips it anyway, so that stays true even if this guard ever
        // loosens rather than being a coincidence this depends on.)
        var m = /([\d.]+)\s*$/.exec(self.headerPointsSourceText(entry.el));
        if (m) {
          var byPoints = candidates.filter(function (a) { return String(a.pointsPossible) === m[1]; });
          if (byPoints.length === 1) pick = byPoints[0];
          else return; // still ambiguous: leave unresolved rather than guess wrong
        } else {
          return;
        }
      }
      // Remembering just the id would let refreshColumns()'s fast path below
      // force-match a LATER, different column sharing this same title onto
      // this same assignment with no further check - silently sending every
      // grade typed into that other column to the wrong assignment. Whether
      // this title was ever actually ambiguous (more than one assignment
      // shares it) is remembered alongside the id so the fast path can
      // require the SAME points-based check here whenever it was.
      self.nameOverrideByTitle.set(title.toLowerCase(), {
        id: pick.id, ambiguous: ambiguous, points: pick.pointsPossible
      });
      entry.type = 'assignment';
      entry.assignmentId = pick.id;
      entry.columnId = 'assignment_' + pick.id;
      self.columnIdToIndex.set(entry.columnId, index);
      fixed++;
    });
    if (fixed) CGP.diag.bump('adapter.columns.reconciledByName', fixed);
    return fixed;
  };

  /** Refresh (and remember) the absolute column index -> column identity map. */
  P.refreshColumns = function () {
    var self = this;
    var index = 0;
    var seen = [];
    var unresolved = 0;
    var sampled = 0;
    this.paneOffsets = [];
    this.headerContainers().forEach(function (container) {
      self.paneOffsets.push(index);
      var cols = container.querySelectorAll('.slick-header-column');
      for (var i = 0; i < cols.length; i++) {
        var el = cols[i];
        var columnId = self.columnIdForHeader(el);
        var info = gridMap.classifyColumnId(columnId || '');
        if (info.type !== 'assignment' && self.nameOverrideByTitle.size) {
          var known = self.nameOverrideByTitle.get(self.headerTitleText(el).toLowerCase());
          if (known) {
            // An unambiguous title (only one assignment anywhere in the
            // course has this exact name) is safe to force-match on sight -
            // there is no OTHER assignment it could be. One that was only
            // resolved by disambiguating on points, though, must have THIS
            // column's own points re-checked before reusing that id: without
            // this, a second column that happens to share the same title
            // (and a DIFFERENT point value) would silently be forced onto
            // the first one's assignment instead of staying unresolved.
            var apply = !known.ambiguous;
            if (known.ambiguous) {
              var pm = /([\d.]+)\s*$/.exec(self.headerPointsSourceText(el));
              apply = !!pm && String(known.points) === pm[1];
            }
            if (apply) {
              info = { type: 'assignment', assignmentId: known.id };
              columnId = 'assignment_' + known.id;
            }
          }
        }
        var entry = {
          index: index,
          columnId: columnId,
          type: info.type,
          assignmentId: info.assignmentId || null,
          groupId: info.groupId || null,
          el: el
        };
        self.colIndexToColumn.set(index, entry);
        if (columnId) self.columnIdToIndex.set(columnId, index);
        else {
          unresolved++;
          // Keep a couple of real samples so diagnostics can show *why* a
          // column could not be identified, without dumping the whole grid.
          if (sampled < 3) {
            sampled++;
            CGP.diag.set('sampleUnresolvedHeader' + sampled, {
              id: el.id || null,
              className: el.className || null,
              title: self.headerTitleText(el).slice(0, 60)
            });
          }
        }
        seen.push(entry);
        index++;
      }
    });
    this._lastUnresolvedColumns = unresolved;
    CGP.diag.set('columnsMapped', this.colIndexToColumn.size);
    CGP.diag.set('columnsUnresolved', unresolved);
    return seen;
  };

  P.columnAt = function (colIndex) {
    var e = this.colIndexToColumn.get(Number(colIndex));
    return e || null;
  };

  /** Column index for a body cell. Prefers SlickGrid's own "l<n>" class; falls
   * back to the cell's position among its row's siblings plus that pane's
   * starting offset, so a different l/r naming convention cannot blind us. */
  P.resolveColIndexForCell = function (cell, row) {
    var idx = gridMap.columnIndexFromClassName(cell.className);
    if (idx !== null) return idx;
    if (!this.paneOffsets || !this.paneOffsets.length) this.refreshColumns();
    var canvases = this.canvases();
    var canvas = (row && row.closest && row.closest('.grid-canvas')) || (row && row.parentElement);
    var paneIndex = canvas ? canvases.indexOf(canvas) : -1;
    if (paneIndex < 0) paneIndex = 0;
    var offset = this.paneOffsets[paneIndex] || 0;
    if (!row) return null;
    var siblings = Array.prototype.filter.call(row.children, function (c) {
      return c.classList && c.classList.contains('slick-cell');
    });
    var local = siblings.indexOf(cell);
    return local < 0 ? null : offset + local;
  };

  P.studentIdFromRow = function (row) {
    var link = row.querySelector('a[href*="/grades/"]');
    if (link) {
      var m = /\/grades\/(\d+)/.exec(link.getAttribute('href') || '');
      if (m) return m[1];
    }
    // A link straight to the student's context card or user page also embeds
    // the id, and is what some header variants use instead of /grades/.
    var userLink = row.querySelector('a[href*="/users/"]');
    if (userLink) {
      var m2 = /\/users\/(\d+)/.exec(userLink.getAttribute('href') || '');
      if (m2) return m2[1];
    }
    var byData = row.querySelector('[data-student-id]');
    if (byData) return byData.getAttribute('data-student-id');
    var byUser = row.querySelector('[data-user-id]');
    if (byUser) return byUser.getAttribute('data-user-id');
    var byTestId = row.querySelector('[data-testid="student-name"], [data-testid*="student-cell"]');
    if (byTestId) {
      var idAttr = byTestId.getAttribute('data-student-id') || byTestId.getAttribute('data-user-id');
      if (idAttr) return idAttr;
      var innerLink = byTestId.querySelector('a[href*="/"]');
      if (innerLink) {
        var m3 = /\/(?:grades|users)\/(\d+)/.exec(innerLink.getAttribute('href') || '');
        if (m3) return m3[1];
      }
    }
    return null;
  };

  /* Canvas's Student View / "Test Student" pseudo-enrollee always renders
   * with that exact, non-customizable display name - unlike a real student's
   * id, which this extension deliberately never learns (teachingCourseList
   * and the roster fetch both filter to type[]=StudentEnrollment, so the
   * model itself never has this row's identity to key off of). Matching the
   * literal name is therefore the stable signal, not an id lookup. */
  P.isTestStudentRow = function (row) {
    var link = row.querySelector('a[href*="/grades/"], a[href*="/users/"], .student-name');
    if (!link) return false;
    return String(link.textContent || '').trim() === 'Test Student';
  };

  /* Cross-pane check: is the row AT THIS VERTICAL POSITION the Test Student?
   * isTestStudentRow() alone only ever sees the name, which only the frozen
   * pane renders - a grade cell's own row (in the scrolling pane) carries no
   * name to check, so resolving identity there by whatever data attribute
   * Canvas happens to expose could still hand back the pseudo-user's real
   * id. Cross-checking every identity resolution against the frozen pane's
   * row at the same `top` - the one place this extension can actually see
   * the name - is what keeps the Test Student unresolvable everywhere
   * (bulk paste, Shift-click ranges, a single M/E/L keystroke), not merely
   * invisible. See hideTestStudentRows() in layout.js for the (separate)
   * purely cosmetic hiding. */
  P.isTestStudentAtTop = function (top) {
    if (top === null || top === undefined) return false;
    var frozen = this.canvases()[0];
    if (!frozen) return false;
    var rows = frozen.querySelectorAll(':scope > .slick-row');
    for (var i = 0; i < rows.length; i++) {
      if (this.rowTop(rows[i]) === top) return this.isTestStudentRow(rows[i]);
    }
    return false;
  };

  P.rowTop = function (row) {
    var top = parseFloat((row.style && row.style.top) || '');
    if (isFinite(top)) return Math.round(top);
    var offset = row.offsetTop;
    return isFinite(offset) ? Math.round(offset) : null;
  };

  /** Learn student identities from whichever rows are currently rendered. */
  P.refreshRows = function () {
    var self = this;
    var h = this.rowHeight();
    var canvases = this.canvases();
    var unresolved = 0;
    var sampled = 0;
    var reordered = false;
    var seen = [];   // {top, idx, sid} actually read live this pass

    // Computed once per pass, not per row: the Test Student must never be
    // resolvable to a rowIndex/userId at all - not merely hidden - so
    // nothing downstream (bulk paste's consecutive-row mapping, a
    // Shift-click range, a single M/E/L keystroke) can ever target it.
    var testTops = {};
    var frozen = canvases[0];
    if (frozen) {
      var frozenRows = frozen.querySelectorAll(':scope > .slick-row');
      for (var fi = 0; fi < frozenRows.length; fi++) {
        if (self.isTestStudentRow(frozenRows[fi])) {
          var ftop = self.rowTop(frozenRows[fi]);
          if (ftop !== null) testTops[ftop] = true;
        }
      }
    }

    canvases.forEach(function (canvas) {
      var rows = canvas.querySelectorAll(':scope > .slick-row');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var top = self.rowTop(row);
        if (top === null) continue;
        if (testTops[top]) {
          // Wipe any stale entry too, not just skip refreshing it - a prior
          // pass (or a live read elsewhere, e.g. cellInfo()) may have
          // already cached this position's real id before this row was
          // known to be the Test Student.
          var staleIdx = gridMap.rowIndexFromTop(top, h);
          var staleSid = self.topToStudent.get(top);
          self.topToStudent.delete(top);
          if (staleIdx !== null) self.rowIndexToStudent.delete(staleIdx);
          if (staleSid) self.studentToRowIndex.delete(String(staleSid));
          unresolved++;
          continue;
        }
        var idx = gridMap.rowIndexFromTop(top, h);
        var live = self.studentIdFromRow(row);
        var sid = live || self.topToStudent.get(top) ||
          (idx !== null ? self.rowIndexToStudent.get(idx) : null);
        if (live) {
          // A live read that disagrees with whoever this exact pixel offset
          // / row index used to hold is the signature of a sort, filter, or
          // roster change happening right now: the grid has been reordered
          // under us. Every OTHER cached row is now suspect too, most of all
          // any not currently rendered - this loop only ever corrects rows
          // actually on screen, so an off-screen row's stale entry from
          // before the reorder would otherwise linger and silently feed a
          // Shift-click range (grid-map.js rangeTargets) that spans it.
          var priorTop = self.topToStudent.get(top);
          var priorIdx = idx !== null ? self.rowIndexToStudent.get(idx) : undefined;
          if ((priorTop !== undefined && priorTop !== live) ||
            (priorIdx !== undefined && priorIdx !== live)) {
            reordered = true;
          }
        }
        if (sid) {
          seen.push({ top: top, idx: idx, sid: sid });
          self.topToStudent.set(top, sid);
          if (idx !== null) {
            self.rowIndexToStudent.set(idx, sid);
            self.studentToRowIndex.set(String(sid), idx);
          }
        } else {
          unresolved++;
          // Structure only - never the row's text, which would be the name.
          if (sampled < 2 && canvas === canvases[0]) {
            sampled++;
            var linkTags = Array.prototype.map.call(row.querySelectorAll('a'), function (a) {
              return a.getAttribute('href');
            });
            CGP.diag.set('sampleUnresolvedRow' + sampled, { className: row.className || null, links: linkTags });
          }
        }
      }
    });
    if (reordered) {
      // Rebuilt from exactly what this pass saw live, with no second DOM
      // walk needed: every cached entry not just reconfirmed above is wiped
      // rather than trusted, since after a reorder a stale one is now just
      // as likely as a correct one.
      this.topToStudent.clear();
      this.rowIndexToStudent.clear();
      this.studentToRowIndex.clear();
      seen.forEach(function (r) {
        self.topToStudent.set(r.top, r.sid);
        if (r.idx !== null) {
          self.rowIndexToStudent.set(r.idx, r.sid);
          self.studentToRowIndex.set(String(r.sid), r.idx);
        }
      });
      CGP.diag.warn('adapter.rows.reorderDetected');
    }
    CGP.diag.set('rowsMapped', this.rowIndexToStudent.size);
    CGP.diag.set('rowsUnresolved', unresolved);
  };

  P.studentAt = function (rowIndex) {
    var v = this.rowIndexToStudent.get(Number(rowIndex));
    return v || null;
  };

  P.rowIndexForStudent = function (userId) {
    var v = this.studentToRowIndex.get(String(userId));
    return v === undefined ? null : v;
  };

  /** All rendered cells with identity resolved where possible. */
  P.visibleCells = function () {
    this.refreshColumns();
    this.refreshRows();
    var self = this;
    var h = this.rowHeight();
    var out = [];
    var unmapped = 0;

    this.canvases().forEach(function (canvas) {
      var rows = canvas.querySelectorAll(':scope > .slick-row');
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var top = self.rowTop(row);
        var rowIndex = top === null ? null : gridMap.rowIndexFromTop(top, h);
        var studentId = (top !== null && self.topToStudent.get(top)) ||
          (rowIndex !== null ? self.studentAt(rowIndex) : null) || null;
        var kids = row.children;
        for (var c = 0; c < kids.length; c++) {
          var cell = kids[c];
          if (!cell.classList || !cell.classList.contains('slick-cell')) continue;
          var colIndex = self.resolveColIndexForCell(cell, row);
          var column = colIndex === null ? null : self.columnAt(colIndex);
          var info = {
            el: cell,
            row: row,
            top: top,
            rowIndex: rowIndex,
            colIndex: colIndex,
            column: column,
            columnType: column ? column.type : null,
            assignmentId: column ? column.assignmentId : null,
            studentId: studentId
          };
          if (column && column.type === 'assignment' && (!studentId || !column.assignmentId)) unmapped++;
          out.push(info);
        }
      }
    });
    this.unmapped = unmapped;
    CGP.diag.set('visibleCells', out.length);
    CGP.diag.set('unmappedCells', unmapped);
    return out;
  };

  /** Identity for one specific cell element (used by clicks and keystrokes). */
  P.cellInfo = function (el) {
    if (!el || !el.closest) return null;
    var cell = el.classList && el.classList.contains('slick-cell') ? el : el.closest('.slick-cell');
    if (!cell) return null;
    var row = cell.closest('.slick-row');
    if (!row) return null;
    var top = this.rowTop(row);
    var h = this.rowHeight();
    var rowIndex = top === null ? null : gridMap.rowIndexFromTop(top, h);
    // A live read of THIS row wins over any cache: the cache (topToStudent /
    // rowIndexToStudent) is keyed by pixel offset / row index, neither of
    // which changes when Canvas re-sorts or re-filters the grid - only which
    // student now sits there does. Checking the cache first (as an earlier
    // version of this did) meant a click or keystroke on this exact row,
    // right after a sort, could resolve to whoever occupied it BEFORE the
    // sort - a real grade landing on the wrong student with no error at all.
    // Falling back to the cache only when there is no row to read live (this
    // cell's row somehow was not found) keeps every other call site that
    // still legitimately needs the cache (off-screen rows) unaffected.
    var live = this.studentIdFromRow(row);
    var studentId = live || (top !== null && this.topToStudent.get(top)) ||
      (rowIndex !== null ? this.studentAt(rowIndex) : null) || null;
    // This live read bypasses refreshRows()'s own Test Student exclusion (by
    // design - see the comment above), so it needs the same cross-pane check
    // applied here directly: a click or keystroke on a grade cell whose row
    // happens to expose the pseudo-user's real id (through whichever
    // attribute this Canvas build uses) must never resolve to it, and must
    // never re-poison the cache with it either.
    if (studentId && top !== null && this.isTestStudentAtTop(top)) {
      studentId = null;
      this.topToStudent.delete(top);
      if (rowIndex !== null) this.rowIndexToStudent.delete(rowIndex);
    }
    if (studentId && rowIndex !== null) {
      if (top !== null) this.topToStudent.set(top, studentId);
      this.rowIndexToStudent.set(rowIndex, studentId);
      this.studentToRowIndex.set(String(studentId), rowIndex);
    }
    if (!this.colIndexToColumn.size) this.refreshColumns();
    var colIndex = this.resolveColIndexForCell(cell, row);
    if (colIndex !== null && !this.colIndexToColumn.has(colIndex)) this.refreshColumns();
    var column = colIndex === null ? null : this.columnAt(colIndex);
    return {
      el: cell, row: row, top: top, rowIndex: rowIndex, colIndex: colIndex,
      column: column, columnType: column ? column.type : null,
      assignmentId: column ? column.assignmentId : null,
      studentId: studentId
    };
  };

  P.activeCellEl = function () {
    var active = document.activeElement;
    if (active && active.closest) {
      var owned = active.closest('.slick-cell');
      if (owned) return owned;
    }
    return document.querySelector('.slick-cell.active') || null;
  };

  P.activeCellInfo = function () {
    var el = this.activeCellEl();
    return el ? this.cellInfo(el) : null;
  };

  P.editorInput = function (cellEl) {
    if (!cellEl) return null;
    return cellEl.querySelector('input:not([type=hidden]), textarea, select') || null;
  };

  P.isEditableGradeCell = function (info) {
    if (!info || info.columnType !== 'assignment' || !info.assignmentId || !info.studentId) return false;
    if (info.el.classList.contains('cannot_edit')) return false;
    if (info.el.querySelector('.Grid__ReadOnlyCell')) return false;
    return true;
  };

  P.cellElementAt = function (rowIndex, colIndex) {
    var cells = this.visibleCells();
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].rowIndex === rowIndex && cells[i].colIndex === colIndex) return cells[i].el;
    }
    return null;
  };

  P.cellElementFor = function (assignmentId, userId) {
    var cells = this.visibleCells();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (String(c.assignmentId) === String(assignmentId) && String(c.studentId) === String(userId)) return c.el;
    }
    return null;
  };

  /* ----------------------------------------------------- synthetic gestures */

  P.dispatchMouse = function (el, type, opts) {
    opts = opts || {};
    var rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: opts.clientX === undefined ? Math.round(rect.left + rect.width / 2) : opts.clientX,
      clientY: opts.clientY === undefined ? Math.round(rect.top + rect.height / 2) : opts.clientY,
      button: 0, buttons: type === 'mouseup' ? 0 : 1
    }));
  };

  P.sendKey = function (el, key, keyCode) {
    if (!el) return;
    el.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: key, code: key,
      keyCode: keyCode, which: keyCode
    }));
  };

  /** Cancel an open Canvas grade editor so it cannot later commit a stale value. */
  P.cancelEditor = function (cellEl) {
    var input = this.editorInput(cellEl);
    if (!input) return false;
    this.sendKey(input, 'Escape', 27);
    return true;
  };


  /* Update Canvas's already-open editor using the native input setter so React/
   * SlickGrid sees the same value the teacher sees. This is deliberately used
   * for the M shortcut instead of synthetic Escape, which can tear down the
   * active SlickGrid editor and shift pane geometry on some Canvas builds. */
  P.setEditorValue = function (input, value) {
    if (!input) return false;
    try {
      var proto = input.tagName && input.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(input, String(value));
      else input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      try { input.value = String(value); return true; } catch (_) { return false; }
    }
  };

  P.activateCell = function (cellEl) {
    if (!cellEl) return false;
    this.dispatchMouse(cellEl, 'mousedown');
    this.dispatchMouse(cellEl, 'mouseup');
    this.dispatchMouse(cellEl, 'click');
    return true;
  };

  P.scrollRowIntoView = function (rowIndex) {
    var vp = this.leftViewport();
    if (!vp) return;
    var h = this.rowHeight();
    var target = rowIndex * h;
    var top = vp.scrollTop;
    var bottom = top + vp.clientHeight;
    if (target < top + h) vp.scrollTop = Math.max(0, target - h);
    else if (target + h > bottom - h) vp.scrollTop = Math.max(0, target - vp.clientHeight + 2 * h);
  };

  P.scrollColumnIntoView = function (colIndex) {
    var column = this.columnAt(colIndex);
    var vp = this.rightViewport();
    if (!column || !column.el || !vp) return;
    var colRect = column.el.getBoundingClientRect();
    var vpRect = vp.getBoundingClientRect();
    if (colRect.left < vpRect.left + 4) vp.scrollLeft -= (vpRect.left - colRect.left) + 40;
    else if (colRect.right > vpRect.right - 4) vp.scrollLeft += (colRect.right - vpRect.right) + 40;
  };

  /** Walk the grid vertically so ids for off-screen rows can be resolved. */
  P.ensureRowsMapped = function (startIndex, count) {
    var self = this;
    var vp = this.leftViewport();
    if (!vp) return Promise.resolve(false);
    var h = this.rowHeight();
    var savedTop = vp.scrollTop;
    var needed = [];
    for (var i = startIndex; i < startIndex + count; i++) {
      if (!self.rowIndexToStudent.has(i)) needed.push(i);
    }
    if (!needed.length) return Promise.resolve(true);

    var stops = [];
    var perScreen = Math.max(1, Math.floor(vp.clientHeight / h) - 1);
    for (var s = startIndex; s < startIndex + count; s += perScreen) stops.push(s * h);

    var seq = Promise.resolve();
    stops.forEach(function (top) {
      seq = seq.then(function () {
        vp.scrollTop = top;
        return CGP.util.sleep(70).then(function () { self.refreshRows(); });
      });
    });
    return seq.then(function () {
      vp.scrollTop = savedTop;
      return CGP.util.sleep(70);
    }).then(function () {
      self.refreshRows();
      var missing = needed.filter(function (i) { return !self.rowIndexToStudent.has(i); });
      if (missing.length) CGP.diag.warn('adapter.rows.unresolved', { count: missing.length });
      return missing.length === 0;
    });
  };

  /** Walk the grid horizontally so ids for off-screen columns can be resolved. */
  P.ensureColumnsMapped = function (startIndex, count) {
    var self = this;
    var vp = this.rightViewport();
    if (!vp) return Promise.resolve(false);
    var missingNow = [];
    for (var i = startIndex; i < startIndex + count; i++) {
      if (!self.colIndexToColumn.has(i)) missingNow.push(i);
    }
    if (!missingNow.length) return Promise.resolve(true);
    var savedLeft = vp.scrollLeft;
    var step = Math.max(200, vp.clientWidth - 80);
    var stops = [];
    for (var x = savedLeft; x <= vp.scrollWidth; x += step) stops.push(x);
    var seq = Promise.resolve();
    stops.forEach(function (left) {
      seq = seq.then(function () {
        vp.scrollLeft = left;
        return CGP.util.sleep(60).then(function () { self.refreshColumns(); });
      });
    });
    return seq.then(function () {
      vp.scrollLeft = savedLeft;
      return CGP.util.sleep(60);
    }).then(function () {
      self.refreshColumns();
      var missing = missingNow.filter(function (i) { return !self.colIndexToColumn.has(i); });
      if (missing.length) CGP.diag.warn('adapter.columns.unresolved', { count: missing.length });
      return missing.length === 0;
    });
  };

  /** Rows currently rendered in the frozen pane, for the Total overlay. */
  P.frozenRowGeometry = function () {
    var self = this;
    var canvas = this.canvases()[0];
    if (!canvas) return [];
    var h = this.rowHeight();
    var out = [];
    var rows = canvas.querySelectorAll(':scope > .slick-row');
    for (var i = 0; i < rows.length; i++) {
      var top = self.rowTop(rows[i]);
      if (top === null) continue;
      var sid = self.studentIdFromRow(rows[i]) || self.topToStudent.get(top) || null;
      out.push({
        top: top,
        height: Math.round(rows[i].getBoundingClientRect().height) || h,
        rowIndex: CGP.gridMap.rowIndexFromTop(top, h),
        studentId: sid,
        selected: rows[i].classList.contains('active') || rows[i].classList.contains('slick-row-selected')
      });
    }
    return out;
  };

  /** Natural width of the frozen (student) pane, measured from header columns. */
  P.frozenNaturalWidth = function () {
    var container = this.headerContainers()[0];
    if (!container) return 0;
    var w = 0;
    var cols = container.querySelectorAll('.slick-header-column');
    for (var i = 0; i < cols.length; i++) w += cols[i].getBoundingClientRect().width;
    return Math.round(w);
  };

  P.hasFrozenPane = function () {
    return this.canvases().length > 1;
  };

  /* The actual pane element the frozen-Total CSS widens (see
   * `.slick-pane-left` / `.slick-viewport-left` in gradebook.css) - NOT
   * `.grid-canvas`, whose width SlickGrid sets to the sum of that pane's
   * column widths rather than to the pane's own (CSS-overridden) box width.
   * Measuring the canvas instead of this element is what made
   * FrozenTotalController.verifyWidened() never see the widen take hold.
   *
   * Falls back to positionedAncestor() (below) when neither class name
   * matches - see that method's own comment for why that fallback exists at
   * all: this Canvas build's real pane class names are not something this
   * extension can verify against a live site. */
  P.frozenPaneLeft = function () {
    var byClass = document.querySelector('.slick-pane-left') ||
      document.querySelector('.slick-viewport-left');
    if (byClass) return byClass;
    var canvas = this.canvases()[0];
    return canvas ? this.positionedAncestor(canvas) : null;
  };

  /* Nearest ancestor (starting at el itself, walking up toward <body>) whose
   * OWN box is `position: absolute` - i.e. the actual pane div SlickGrid
   * moves and sizes to build the frozen/scrolling two-pane layout, whatever
   * this particular Canvas build happens to name it.
   *
   * The frozen-Total feature (see frozen-total.js) has to change that pane's
   * width - both the frozen (left) one, widening it, and the scrolling
   * (right) one, shrinking it back by the same amount so the grid's total
   * on-screen footprint never grows. Doing that by class name alone
   * (`.slick-pane-left` / `.slick-pane-right`) is exactly the kind of single
   * fragile path this file's own header comment warns against: a Canvas
   * build that names or nests these panes differently would leave the right
   * pane's geometry completely untouched while the left one still widened
   * (via the broader class-name matches elsewhere), silently pushing the
   * grid's rendered content past whatever fixed-width box actually contains
   * both panes - which is what turns into a horizontal scrollbar on some
   * ANCESTOR of the grid that scrolls both (frozen and scrolling) panes
   * together as one unit, since neither is `position: fixed` relative to
   * that ancestor. Walking up by *computed position* instead of by class
   * name survives a markup change that renames or restructures those
   * classes, the same lesson `frozenPaneLeft()`'s own history already
   * taught once (see its comment). */
  P.positionedAncestor = function (el) {
    var node = el;
    for (var i = 0; i < 8 && node && node !== document.body && node !== document.documentElement; i++) {
      var pos = '';
      try { pos = getComputedStyle(node).position; } catch (e) { pos = ''; }
      if (pos === 'absolute') return node;
      node = node.parentElement;
    }
    return null;
  };

  /* The two body panes (frozen/left, scrolling/right), left-to-right by
   * current position - not by class name, so a Canvas build that names them
   * differently (or doesn't split header/body pane classes the way this
   * extension assumed) is still handled. Only ever returns as many entries
   * as `canvases()` found (0, 1, or 2+ - a course with no frozen pane at all
   * yields exactly one). */
  P.bodyPanes = function () {
    var self = this;
    return this.canvases().map(function (canvas) {
      return self.positionedAncestor(canvas) || canvas.parentElement || canvas;
    });
  };

  /* Same idea as bodyPanes(), for the header row's own pane split. Canvas's
   * frozen-column header is typically a SEPARATE pair of pane elements from
   * the body (its own `.slick-pane-header-left` / `-right`, or similar),
   * which must be kept in sync with the body panes' widen/shrink or the
   * header row drifts out of alignment with the columns beneath it - see
   * frozen-total.js's applyPaneGeometry(). */
  P.headerPanes = function () {
    var self = this;
    return this.headerContainers().map(function (container) {
      return self.positionedAncestor(container) || container.parentElement || container;
    });
  };

  CGP.GradebookDomAdapter = GradebookDomAdapter;
})();
