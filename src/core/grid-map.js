/* Canvas Gradebook+ - pure grid mapping.
 *
 * Canvas renders the gradebook with a SlickGrid-style virtualized grid:
 *   - header cells carry an id of the form  slickgrid_<uid>_<columnId>
 *   - body cells carry the absolute column index in their class list: "l7 r7"
 *   - rows are absolutely positioned; style.top / rowHeight gives the row index
 *
 * Nothing here touches the DOM. The DOM adapter feeds these functions strings
 * and numbers, which keeps the risky part small and unit testable. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.gridMap) return;

  /* SlickGrid always appends the column id verbatim to the end of the header
   * element's id, but the per-grid uid prefix in front of it is not something
   * we can rely on the exact shape of (it has been seen with and without a
   * separating underscore, numeric and alphanumeric). Anchoring on a known
   * column-id shape at the END of the string sidesteps that entirely. */
  var KNOWN_COLUMN_ID = /(assignment_group_\d+|assignment_\d+|total_grade_override|total_grade|custom_col_\d+|student)$/;

  function parseSlickColumnId(elementId) {
    var id = String(elementId || '');
    if (!id) return null;
    var known = KNOWN_COLUMN_ID.exec(id);
    if (known) return known[1];
    // Fall back to the original underscore-separated assumption, in case a
    // future column id shape is not in the known list above.
    var m = /^slickgrid_\d+_(.+)$/.exec(id);
    if (m) return m[1];
    m = /^slickgrid_(.+)$/.exec(id);
    if (m && !/^\d+$/.test(m[1])) return m[1];
    return null;
  }

  function classifyColumnId(columnId) {
    var id = String(columnId || '');
    var m;
    if ((m = /^assignment_(\d+)$/.exec(id))) return { type: 'assignment', assignmentId: m[1] };
    if ((m = /^assignment_group_(\d+)$/.exec(id))) return { type: 'group', groupId: m[1] };
    if (/^total_grade/.test(id)) return { type: 'total' };
    if (/^student/.test(id)) return { type: 'student' };
    if (/^custom_col_/.test(id)) return { type: 'custom' };
    return { type: id ? 'other' : 'unknown' };
  }

  function columnIndexFromClassName(className) {
    var m = /(?:^|\s)l(\d+)(?:\s|$)/.exec(String(className || ''));
    return m ? Number(m[1]) : null;
  }

  function rowIndexFromTop(top, rowHeight) {
    var h = Number(rowHeight);
    if (!isFinite(h) || h <= 0) return null;
    var t = Number(top);
    if (!isFinite(t)) return null;
    return Math.round(t / h);
  }

  function cellKey(assignmentId, userId) {
    return String(assignmentId) + ':' + String(userId);
  }

  /**
   * Rectangular selection between two cell references.
   * refs are {rowIndex, colIndex}; accessors supply column + student lookups.
   */
  function rangeTargets(anchor, focus, accessors) {
    if (!anchor || !focus) return [];
    var r0 = Math.min(anchor.rowIndex, focus.rowIndex);
    var r1 = Math.max(anchor.rowIndex, focus.rowIndex);
    var c0 = Math.min(anchor.colIndex, focus.colIndex);
    var c1 = Math.max(anchor.colIndex, focus.colIndex);
    var out = [];
    for (var r = r0; r <= r1; r++) {
      var userId = accessors.studentAt(r);
      if (!userId) continue;
      for (var c = c0; c <= c1; c++) {
        var col = accessors.columnAt(c);
        if (!col || col.type !== 'assignment' || !col.assignmentId) continue;
        out.push({ assignmentId: String(col.assignmentId), userId: String(userId), rowIndex: r, colIndex: c });
      }
    }
    return out;
  }

  /**
   * Map a parsed clipboard matrix onto concrete Canvas ids, starting at anchor.
   * Nothing is written unless the caller is happy with `errors`.
   */
  function mapMatrixToTargets(matrix, anchor, accessors) {
    var rows = (matrix && matrix.rows) || [];
    var targets = [];
    var errors = [];
    var skipped = 0;

    for (var r = 0; r < rows.length; r++) {
      var rowIndex = anchor.rowIndex + r;
      var userId = accessors.studentAt(rowIndex);
      for (var c = 0; c < rows[r].length; c++) {
        var token = String(rows[r][c] === undefined || rows[r][c] === null ? '' : rows[r][c]).trim();
        var colIndex = anchor.colIndex + c;
        if (token === '') { skipped++; continue; }
        if (!userId) { errors.push({ code: 'unresolved-student', rowIndex: rowIndex, colIndex: colIndex }); continue; }
        var col = accessors.columnAt(colIndex);
        if (!col) { errors.push({ code: 'unresolved-column', rowIndex: rowIndex, colIndex: colIndex }); continue; }
        if (col.type !== 'assignment' || !col.assignmentId) {
          errors.push({ code: 'not-an-assignment', rowIndex: rowIndex, colIndex: colIndex, columnType: col.type });
          continue;
        }
        targets.push({
          assignmentId: String(col.assignmentId),
          userId: String(userId),
          token: token,
          rowIndex: rowIndex,
          colIndex: colIndex
        });
      }
    }
    return { targets: targets, errors: errors, skipped: skipped };
  }

  CGP.gridMap = {
    parseSlickColumnId: parseSlickColumnId,
    classifyColumnId: classifyColumnId,
    columnIndexFromClassName: columnIndexFromClassName,
    rowIndexFromTop: rowIndexFromTop,
    cellKey: cellKey,
    rangeTargets: rangeTargets,
    mapMatrixToTargets: mapMatrixToTargets
  };
})();
