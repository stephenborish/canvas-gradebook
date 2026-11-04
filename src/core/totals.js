/* Canvas Gradebook+ - letter grades and the Total column.
 *
 * The teacher's letter-grade scale (Options -> Appearance): reading and
 * writing it as text, and the letter a percentage earns on it. Also the
 * Total column's rounding (0.1) and its colour thresholds. */
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

  /* ------------------------------------------------ the Total column */

  /* Half-up to 0.1, the same rounding letterFor uses, so the percentage a
   * teacher reads and the letter it earns always agree. */
  function roundTenth(score) {
    var n = Number(score);
    if (score === null || score === undefined || score === '' || !isFinite(n)) return null;
    return Math.floor(n * 10 + 0.5 + 1e-9) / 10;
  }

  /* 86.02 -> "86.0%". */
  function formatPercent(score) {
    var r = roundTenth(score);
    return r === null ? '' : r.toFixed(1) + '%';
  }

  /* The percentage in a piece of Canvas's Total text ("86.02%", "86,02 %"),
   * or null when there is none (a points display, "–", a letter only). */
  function parsePercent(text) {
    var m = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(String(text || ''));
    return m ? Number(m[1].replace(',', '.')) : null;
  }

  /* Rules are { below: 70, color: 'red' }. The strictest rule a score falls
   * under wins: with "below 70 red" and "below 80 yellow", 65 is red and 75
   * yellow. Compared on the rounded score, the one shown in the cell. */
  function highlightFor(score, rules) {
    var r = roundTenth(score);
    if (r === null || !Array.isArray(rules)) return null;
    var hit = null;
    rules.forEach(function (rule) {
      if (!rule || !isFinite(rule.below) || r >= rule.below) return;
      if (!hit || rule.below < hit.below) hit = rule;
    });
    return hit ? hit.color : null;
  }

  CGP.totals = {
    letterFor: letterFor, scaleToText: scaleToText, textToScale: textToScale, badScaleLines: badScaleLines,
    roundTenth: roundTenth, formatPercent: formatPercent, parsePercent: parsePercent,
    HIGHLIGHT_COLORS: CGP.HIGHLIGHT_COLORS, highlightFor: highlightFor, sanitizeHighlights: CGP.sanitizeHighlights
  };
})();
