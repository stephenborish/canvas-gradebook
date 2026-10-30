/* Canvas Gradebook+ - letter grades for Analyze Scores.
 *
 * The teacher's letter-grade scale (Options -> Appearance): reading and
 * writing it as text, and the letter a percentage earns on it. */
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

  var LINE_RE = /^\s*(\S+?)\s*[:=\s]\s*(\d+(?:\.\d+)?)\s*%?\s*$/;

  /* "A+: 96.5" per line, as shown in the options page. */
  function scaleToText(scale) {
    return (scale || []).map(function (r) { return r.letter + ': ' + r.min; }).join('\n');
  }
  /* Non-blank lines textToScale cannot read, so a typo is reported instead of
   * silently saving a different scale. */
  function badScaleLines(text) {
    return String(text || '').split(/\r?\n/).filter(function (line) {
      return line.trim() && !LINE_RE.test(line);
    }).map(function (line) { return line.trim(); });
  }
  function textToScale(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = LINE_RE.exec(line);
      if (m) out.push({ letter: m[1], min: Number(m[2]) });
    });
    return out;
  }

  CGP.totals = {
    letterFor: letterFor, scaleToText: scaleToText, textToScale: textToScale, badScaleLines: badScaleLines
  };
})();
