/* Canvas Gradebook+ - pure Total column synchronization.
 *
 * Canvas already computes the course score (weighting, drop rules, grading
 * schemes). We never recompute it: we read enrollment grades from the Canvas
 * API and align them to whatever rows the grid is currently showing. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.totals) return;

  function formatTotal(student) {
    if (!student) return { text: '\u2014', title: 'Total unavailable' };
    var score = student.currentScore;
    var letter = student.currentGrade;
    if (score === null || score === undefined || score === '') {
      return { text: '\u2014', title: 'No graded work yet' };
    }
    var text = CGP.util.fmtPercent(score);
    var title = 'Total ' + text + (letter ? ' (' + letter + ')' : '');
    return { text: text, title: title, letter: letter || null };
  }

  /**
   * buildTotalRows(rows, studentsById)
   * rows: [{rowIndex, top, height, studentId}] taken straight from the rendered
   *       frozen pane, so vertical alignment is inherited from Canvas itself.
   */
  function buildTotalRows(rows, studentsById) {
    var lookup = studentsById instanceof Map
      ? function (id) { return studentsById.get(String(id)); }
      : function (id) { return studentsById ? studentsById[String(id)] : null; };

    return (rows || []).map(function (row) {
      var student = row && row.studentId ? lookup(row.studentId) : null;
      var f = formatTotal(student);
      return {
        rowIndex: row.rowIndex,
        top: row.top,
        height: row.height,
        studentId: row.studentId || null,
        text: f.text,
        title: student ? f.title : 'Total unavailable',
        resolved: !!student && student.currentScore !== null && student.currentScore !== undefined
      };
    });
  }

  CGP.totals = { formatTotal: formatTotal, buildTotalRows: buildTotalRows };
})();
