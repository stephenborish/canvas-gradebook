/* Canvas Gradebook+ - pure clipboard parsing.
 *
 * Excel / Google Sheets copy as TSV: tab = next column, newline = next row.
 * A single line of space separated values is treated as a column, because that
 * is what a teacher means when they type "5 5 M 4 E" by hand. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.clipboardMatrix) return;

  /* A space- (or NBSP-) separated run that is actually ONE locale-grouped
   * number ("1 000", "12 345 678") rather than several values a teacher
   * typed by hand ("5 5 M 4 E"). Real thousands grouping always takes a very
   * specific shape - a short leading group followed by one or more groups of
   * EXACTLY three digits - that a hand-typed list of grades never happens to
   * take (a plain "5 5" is two one-digit values, not a mistaken grouping of
   * "55"; nothing legitimately groups in anything but 3s). Catching only
   * this narrow shape keeps the deliberate "type a row of grades" feature
   * intact for everything else, while stopping the one case that silently
   * split a single pasted number across two students. */
  function looksLikeGroupedNumber(parts) {
    if (parts.length < 2) return false;
    if (!/^-?\d{1,3}$/.test(parts[0])) return false;
    for (var i = 1; i < parts.length; i++) {
      if (!/^\d{3}$/.test(parts[i])) return false;
    }
    return true;
  }

  function parseClipboardMatrix(text) {
    var raw = String(text === null || text === undefined ? '' : text)
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    var lines = raw.split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    while (lines.length && lines[0].trim() === '' && lines.length > 1) lines.shift();

    if (!lines.length || (lines.length === 1 && lines[0].trim() === '')) {
      return { rows: [], rowCount: 0, colCount: 0, cellCount: 0, source: 'empty' };
    }

    var rows, source;
    if (raw.indexOf('\t') >= 0) {
      rows = lines.map(function (l) { return l.split('\t').map(function (t) { return t.trim(); }); });
      source = 'tsv';
    } else if (lines.length > 1) {
      rows = lines.map(function (l) { return [l.trim()]; });
      source = 'column';
    } else {
      var parts = lines[0].trim().split(/\s+/).filter(function (x) { return x !== ''; });
      if (parts.length > 1 && looksLikeGroupedNumber(parts)) {
        // "1 000" copied from a locale that groups thousands with a space or
        // a non-breaking space is ONE value, not two - see
        // looksLikeGroupedNumber. Without this, pasting that single Excel
        // cell onto one student silently wrote "1" to them and "000" (a
        // silent 0) to the very next student in the grid.
        rows = [[parts.join('')]];
        source = 'grouped-number';
      } else if (parts.length > 1) {
        rows = parts.map(function (p) { return [p]; });
        source = 'spaced-column';
      } else {
        rows = [[lines[0].trim()]];
        source = 'single';
      }
    }

    var colCount = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    rows.forEach(function (r) { while (r.length < colCount) r.push(''); });

    var cellCount = rows.reduce(function (n, r) {
      return n + r.filter(function (v) { return String(v).trim() !== ''; }).length;
    }, 0);

    return {
      rows: rows,
      rowCount: rows.length,
      colCount: colCount,
      cellCount: cellCount,
      source: source
    };
  }

  CGP.clipboardMatrix = { parse: parseClipboardMatrix };
})();
