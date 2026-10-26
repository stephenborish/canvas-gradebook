/* Canvas Gradebook+ - turn a course roster into text a teacher can paste.
 *
 * Pure functions, no DOM: roster-export.js asks Canvas for the students and
 * hands them here, and gets back the same rows three ways - tab-separated
 * text (what a spreadsheet pastes as columns), an HTML table (what Docs, Word
 * and Gmail paste as a real table) and CSV (the download).
 *
 * Names are split from Canvas's own sortable_name ("Last, First"), which is
 * the one place Canvas records where a student's surname begins. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.rosterFormat) return;

  // nameFormat values, in the order the export panel offers them.
  var NAME_FORMATS = ['first-last', 'last-first', 'split', 'first', 'none'];
  var SEPARATORS = { comma: ', ', semicolon: '; ', newline: '\n' };

  function clean(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* {first, last} for one Canvas user record. */
  function splitName(user) {
    var sortable = clean(user && user.sortable_name);
    var comma = sortable.indexOf(',');
    if (comma > 0) {
      return { first: clean(sortable.slice(comma + 1)), last: clean(sortable.slice(0, comma)) };
    }
    var full = clean(user && (user.name || user.short_name)) || sortable;
    var space = full.lastIndexOf(' ');
    if (space > 0) return { first: full.slice(0, space), last: full.slice(space + 1) };
    return { first: full, last: '' };
  }

  /* The address Canvas shows for the student: their email, or a login id
   * that is itself an address when the email field is hidden. */
  function emailOf(user) {
    var email = clean(user && user.email);
    if (email) return email;
    var login = clean(user && user.login_id);
    return login.indexOf('@') > 0 ? login : '';
  }

  /* Canvas users -> [{id, first, last, email}], sorted the way the teacher
   * picked (by last name unless sortBy is 'first'), duplicates dropped. */
  function normalize(users, sortBy) {
    var seen = {};
    var out = [];
    (users || []).forEach(function (u) {
      if (!u || u.id === undefined || u.id === null) return;
      var id = String(u.id);
      if (seen[id]) return;
      seen[id] = true;
      var n = splitName(u);
      out.push({ id: id, first: n.first, last: n.last, email: emailOf(u) });
    });
    var key = sortBy === 'first'
      ? function (r) { return [r.first, r.last]; }
      : function (r) { return [r.last, r.first]; };
    out.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      return ka[0].localeCompare(kb[0], undefined, { sensitivity: 'base' }) ||
        ka[1].localeCompare(kb[1], undefined, { sensitivity: 'base' });
    });
    return out;
  }

  /* Column headers and cell values for the chosen options:
   *   opts.nameFormat  one of NAME_FORMATS
   *   opts.email       include an Email column */
  function table(rows, opts) {
    opts = opts || {};
    var fmt = NAME_FORMATS.indexOf(opts.nameFormat) >= 0 ? opts.nameFormat : 'first-last';
    var header = [];
    if (fmt === 'first-last' || fmt === 'last-first' || fmt === 'first') header.push('Name');
    if (fmt === 'split') header.push('First Name', 'Last Name');
    if (opts.email) header.push('Email');
    var body = (rows || []).map(function (r) {
      var cells = [];
      if (fmt === 'first-last') cells.push(clean(r.first + ' ' + r.last));
      if (fmt === 'last-first') cells.push(r.last && r.first ? r.last + ', ' + r.first : (r.last || r.first));
      if (fmt === 'first') cells.push(r.first);
      if (fmt === 'split') cells.push(r.first, r.last);
      if (opts.email) cells.push(r.email);
      return cells;
    });
    return { header: header, body: body };
  }

  function toTsv(t, withHeader) {
    var lines = (withHeader && t.header.length ? [t.header] : []).concat(t.body);
    return lines.map(function (cells) {
      return cells.map(function (c) { return String(c).replace(/[\t\r\n]+/g, ' '); }).join('\t');
    }).join('\n');
  }

  function csvCell(c) {
    var s = String(c);
    // A leading =, +, - or @ makes Excel/Sheets run the cell as a formula.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(t, withHeader) {
    var lines = (withHeader && t.header.length ? [t.header] : []).concat(t.body);
    return lines.map(function (cells) { return cells.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* A plain bordered table: pasted into Google Docs, Word or Gmail it stays a
   * table, with a bold header row. */
  function toHtml(t, withHeader) {
    var cell = 'border:1px solid #c7cdd1;padding:4px 8px;text-align:left;';
    var html = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt;">';
    if (withHeader && t.header.length) {
      html += '<thead><tr>' + t.header.map(function (h) {
        return '<th style="' + cell + 'background:#eef1f3;font-weight:bold;">' + esc(h) + '</th>';
      }).join('') + '</tr></thead>';
    }
    html += '<tbody>' + t.body.map(function (cells) {
      return '<tr>' + cells.map(function (c) { return '<td style="' + cell + '">' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
    return html;
  }

  /* Every address on one line (or one per line), ready for a To: or Bcc:
   * field. Students with no address are skipped. */
  function emailList(rows, separator) {
    var sep = SEPARATORS[separator] || SEPARATORS.comma;
    return (rows || []).map(function (r) { return r.email; }).filter(Boolean).join(sep);
  }

  CGP.rosterFormat = {
    NAME_FORMATS: NAME_FORMATS,
    splitName: splitName,
    emailOf: emailOf,
    normalize: normalize,
    table: table,
    toTsv: toTsv,
    toCsv: toCsv,
    toHtml: toHtml,
    emailList: emailList
  };
})();
