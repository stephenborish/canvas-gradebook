/* Canvas Gradebook+ - pure Total column synchronization.
 *
 * Canvas already computes the course score (weighting, drop rules, grading
 * schemes). We never recompute it: we read enrollment grades from the Canvas
 * API and align them to whatever rows the grid is currently showing. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.totals) return;

  /* Round half-up to 0.1, then take the first (highest) threshold the score
   * meets. The scale is sorted descending by sanitizeSettings. */
  function letterFor(score, scale) {
    var n = Number(score);
    if (score === null || score === undefined || score === '' || !isFinite(n)) return null;
    var rounded = Math.floor(n * 10 + 0.5 + 1e-9) / 10;
    var list = Array.isArray(scale) && scale.length ? scale : CGP.DEFAULT_GRADING_SCALE;
    for (var i = 0; i < list.length; i++) {
      if (rounded >= list[i].min) return list[i].letter;
    }
    return list[list.length - 1].letter;
  }

  /* "A+: 96.5" per line, as shown in the options page. */
  function scaleToText(scale) {
    return (scale || []).map(function (r) { return r.letter + ': ' + r.min; }).join('\n');
  }
  function textToScale(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = /^\s*(\S+?)\s*[:=\s]\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(line);
      if (m) out.push({ letter: m[1], min: Number(m[2]) });
    });
    return out;
  }

  function formatTotal(student, scale) {
    if (!student) return { text: '\u2014', title: 'Total unavailable' };
    var score = student.currentScore;
    var letter = letterFor(score, scale) || student.currentGrade;
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
  function buildTotalRows(rows, studentsById, scale) {
    var lookup = studentsById instanceof Map
      ? function (id) { return studentsById.get(String(id)); }
      : function (id) { return studentsById ? studentsById[String(id)] : null; };

    return (rows || []).map(function (row) {
      var student = row && row.studentId ? lookup(row.studentId) : null;
      var f = formatTotal(student, scale);
      return {
        rowIndex: row.rowIndex,
        top: row.top,
        height: row.height,
        studentId: row.studentId || null,
        text: f.text,
        letter: f.letter || null,
        title: student ? f.title : 'Total unavailable',
        resolved: !!student && student.currentScore !== null && student.currentScore !== undefined
      };
    });
  }

  CGP.totals = {
    formatTotal: formatTotal, buildTotalRows: buildTotalRows,
    letterFor: letterFor, scaleToText: scaleToText, textToScale: textToScale
  };
})();
