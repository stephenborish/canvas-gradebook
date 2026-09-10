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
    var list = Array.prototype.slice.call(document.querySelectorAll('.slick-header-columns'));
    return list.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
  };

  P.canvases = function () {
    var list = Array.prototype.slice.call(document.querySelectorAll('.grid-canvas'));
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
    this._rowHeight = h > 8 ? h : DEFAULT_ROW_HEIGHT;
    return this._rowHeight;
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
    var handle = clone.querySelector('.slick-resizable-handle, .cgp-due');
    if (handle) handle.remove();
    var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/\bout of\s+[\d.]+\s*$/i, '').replace(/[\u2014-]\s*[\d.]+\s*pts?\.?\s*$/i, '').trim();
    return text;
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
      if (candidates.length > 1) {
        // Disambiguate identically named assignments using the points line.
        var m = /([\d.]+)\s*$/.exec(entry.el.textContent || '');
        if (m) {
          var byPoints = candidates.filter(function (a) { return String(a.pointsPossible) === m[1]; });
          if (byPoints.length === 1) pick = byPoints[0];
          else return; // still ambiguous: leave unresolved rather than guess wrong
        } else {
          return;
        }
      }
      self.nameOverrideByTitle.set(title.toLowerCase(), pick.id);
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
          var knownId = self.nameOverrideByTitle.get(self.headerTitleText(el).toLowerCase());
          if (knownId) {
            info = { type: 'assignment', assignmentId: knownId };
            columnId = 'assignment_' + knownId;
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
    canvases.forEach(function (canvas) {
      var rows = canvas.querySelectorAll(':scope > .slick-row');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var top = self.rowTop(row);
        if (top === null) continue;
        var idx = gridMap.rowIndexFromTop(top, h);
        var sid = self.studentIdFromRow(row) || self.topToStudent.get(top) ||
          (idx !== null ? self.rowIndexToStudent.get(idx) : null);
        if (sid) {
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
    var studentId = (top !== null && this.topToStudent.get(top)) || this.studentIdFromRow(row) ||
      (rowIndex !== null ? this.studentAt(rowIndex) : null) || null;
    if (studentId && rowIndex !== null) {
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

  CGP.GradebookDomAdapter = GradebookDomAdapter;
})();
