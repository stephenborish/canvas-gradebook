/* Canvas Gradebook+ - score statistics for one assignment column.
 *
 * Highest / lowest students, mean, median, standard deviation and a
 * distribution bucketed by the same letter-grade cutoffs the Total column
 * uses (settings.gradingScale), so a teacher reads an exam's spread in the
 * same terms as the final grades. No DOM, no network: unit tested directly.
 *
 * Only graded scores count. Excused and ungraded submissions are reported as
 * counts but left out of every statistic - a blank is not a zero. A score the
 * teacher entered as 0 (Missing included) is a real 0 and counts. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.scoreStats) return;

  function round(n, places) {
    var f = Math.pow(10, places);
    return Math.round(n * f) / f;
  }

  function median(sorted) {
    var n = sorted.length;
    if (!n) return null;
    var mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* entries: [{ userId, name, score, excused }]  (score in points, null = ungraded)
   * pointsPossible: the assignment's points, or null/0 when it has none
   * scale: [{letter, min}] sorted descending, as sanitizeSettings keeps it
   * top: how many students to list at each end */
  function analyze(entries, pointsPossible, scale, top) {
    top = top || 5;
    var pts = Number(pointsPossible);
    var hasPoints = isFinite(pts) && pts > 0;
    var graded = [];
    var excused = 0;
    var ungraded = 0;
    (entries || []).forEach(function (e) {
      if (!e) return;
      if (e.excused) { excused++; return; }
      var s = (e.score === null || e.score === undefined || e.score === '') ? NaN : Number(e.score);
      if (!isFinite(s)) { ungraded++; return; }
      graded.push({
        userId: String(e.userId),
        name: e.name || '',
        score: s,
        percent: hasPoints ? (s / pts) * 100 : null
      });
    });

    var scores = graded.map(function (g) { return g.score; }).sort(function (x, y) { return x - y; });
    var n = scores.length;
    var mean = n ? scores.reduce(function (t, v) { return t + v; }, 0) / n : null;
    // Population SD: the class in front of the teacher is the whole group,
    // not a sample of some larger one.
    var sd = n ? Math.sqrt(scores.reduce(function (t, v) { return t + (v - mean) * (v - mean); }, 0) / n) : null;

    // Ties at the cut-off stay together, so "lowest 5" never silently drops a
    // student holding exactly the same score as the fifth one listed.
    function ends(desc) {
      var list = graded.slice().sort(function (x, y) {
        return (desc ? y.score - x.score : x.score - y.score) || x.name.localeCompare(y.name);
      });
      if (list.length <= top) return list;
      var cut = list[top - 1].score;
      return list.filter(function (g, i) { return i < top || g.score === cut; });
    }

    var buckets = null;
    if (hasPoints) {
      var list = Array.isArray(scale) && scale.length ? scale : CGP.DEFAULT_GRADING_SCALE;
      // Bucket ranges, highest first: [min, next-higher min).
      buckets = list.map(function (row, i) {
        return {
          letter: row.letter,
          min: i === list.length - 1 ? 0 : row.min,
          max: i === 0 ? null : list[i - 1].min,
          count: 0,
          students: []
        };
      });
      var byLetter = {};
      buckets.forEach(function (b) { byLetter[b.letter] = b; });
      graded.forEach(function (g) {
        // The same rounding and threshold rule the Total column's letter uses.
        var letter = CGP.totals.letterFor(g.percent, list);
        var b = byLetter[letter];
        if (b) { b.count++; b.students.push(g.name); }
      });
    }

    function pct(v) { return (v === null || !hasPoints) ? null : (v / pts) * 100; }

    return {
      count: n,
      excused: excused,
      ungraded: ungraded,
      pointsPossible: hasPoints ? pts : null,
      mean: mean,
      median: median(scores),
      sd: sd,
      min: n ? scores[0] : null,
      max: n ? scores[n - 1] : null,
      meanPercent: pct(mean),
      medianPercent: pct(median(scores)),
      sdPercent: pct(sd),
      highest: ends(true),
      lowest: ends(false),
      buckets: buckets
    };
  }

  CGP.scoreStats = { analyze: analyze, median: median, round: round };
})();
