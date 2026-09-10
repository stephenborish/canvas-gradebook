/* Canvas Gradebook+ - pure clipboard parsing.
 *
 * Excel / Google Sheets copy as TSV: tab = next column, newline = next row.
 * A single line of space separated values is treated as a column, because that
 * is what a teacher means when they type "5 5 M 4 E" by hand. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.clipboardMatrix) return;

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
      if (parts.length > 1) {
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
