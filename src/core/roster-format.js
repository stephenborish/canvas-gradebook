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
  // 'comma-line': one line per student, "First, Last, email" - commas
  // between the parts, the whole line in a single cell. A missing part keeps
  // its place ("Cher, , cher@x.org"), so every line has the same positions.
  var NAME_FORMATS = ['first-last', 'last-first', 'split', 'comma-line'];
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
   *   opts.nameFormat      one of NAME_FORMATS
   *   opts.email           include an Email column
   *   opts.guardians       guardianMap() result: {studentId: [{name, email}]}
   *   opts.guardianNames   add each student's parents/guardians' names
   *   opts.guardianEmails  ... and their addresses
   * Parents and guardians get numbered columns (Parent/Guardian 1, its
   * Email, Parent/Guardian 2, ...), as many as the student with the most
   * has, so every family lines up in the same columns of a spreadsheet. */
  function table(rows, opts) {
    opts = opts || {};
    rows = rows || [];
    var fmt = NAME_FORMATS.indexOf(opts.nameFormat) >= 0 ? opts.nameFormat : 'first-last';
    var gMap = opts.guardians || null;
    var gNames = !!(gMap && opts.guardianNames);
    var gEmails = !!(gMap && opts.guardianEmails);
    var gCount = 0;
    if (gNames || gEmails) {
      rows.forEach(function (r) { gCount = Math.max(gCount, (gMap[r.id] || []).length); });
    }
    var gHeader = [];
    for (var gi = 1; gi <= gCount; gi++) {
      if (gNames) gHeader.push('Parent/Guardian ' + gi);
      if (gEmails) gHeader.push('Parent/Guardian ' + gi + ' Email');
    }
    function gCells(r) {
      var list = gMap ? gMap[r.id] || [] : [];
      var cells = [];
      for (var i = 0; i < gCount; i++) {
        var g = list[i] || { name: '', email: '' };
        if (gNames) cells.push(g.name);
        if (gEmails) cells.push(g.email);
      }
      return cells;
    }
    if (fmt === 'comma-line') {
      return {
        header: [['First Name', 'Last Name'].concat(opts.email ? ['Email'] : [], gHeader).join(', ')],
        body: rows.map(function (r) {
          // A comma inside a part ("John, Jr.") would read as another
          // field, so it becomes a space there.
          var parts = [r.first, r.last].concat(opts.email ? [r.email] : [], gCells(r));
          return [parts.map(function (x) { return clean(String(x || '').replace(/,/g, ' ')); }).join(', ')];
        }),
        oneLine: true
      };
    }
    var header = [];
    if (fmt === 'first-last' || fmt === 'last-first') header.push('Name');
    if (fmt === 'split') header.push('First Name', 'Last Name');
    if (opts.email) header.push('Email');
    header = header.concat(gHeader);
    var body = rows.map(function (r) {
      var cells = [];
      if (fmt === 'first-last') cells.push(clean(r.first + ' ' + r.last));
      if (fmt === 'last-first') cells.push(r.last && r.first ? r.last + ', ' + r.first : (r.last || r.first));
      if (fmt === 'split') cells.push(r.first, r.last);
      if (opts.email) cells.push(r.email);
      return cells.concat(gCells(r));
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

  /* Parents and guardians: the course's observers (Canvas's word, read by
   * CanvasApi.courseObservers) who are linked to one of these students. An
   * observer with no student link is left out - that is a colleague or
   * administrator watching the course, not a family member.
   * Returns {studentId: [{name, email}]}, each person once per student, in
   * the order Canvas lists them. */
  function guardianMap(observers) {
    var byStudent = {};
    (observers || []).forEach(function (u) {
      if (!u) return;
      var email = emailOf(u);
      var n = splitName(u);
      var name = clean(u.name) || clean(n.first + ' ' + n.last);
      if (!email && !name) return;
      // Canvas gives the link either way (the student overview's
      // guardiansFor reads both): each observer enrollment's
      // associated_user_id, or the observed_users list.
      var linked = {};
      (u.enrollments || []).forEach(function (en) {
        var sid = en && en.associated_user_id;
        if (sid !== undefined && sid !== null) linked[String(sid)] = true;
      });
      (u.observed_users || []).forEach(function (o) {
        if (o && o.id !== undefined && o.id !== null) linked[String(o.id)] = true;
      });
      Object.keys(linked).forEach(function (sid) {
        var list = (byStudent[sid] = byStudent[sid] || []);
        var key = (name + '|' + email).toLowerCase();
        if (list.some(function (g) { return (g.name + '|' + g.email).toLowerCase() === key; })) return;
        list.push({ name: name, email: email });
      });
    });
    return byStudent;
  }

  /* The parent/guardian addresses for these students:
   *   emails       each address once, in the students' order
   *   count        how many addresses that is
   *   uncovered    students with no linked parent/guardian address
   *   byStudent    guardianMap() of the same observers */
  function guardians(observers, rows) {
    var byStudent = guardianMap(observers);
    var seen = {};
    var emails = [];
    var uncovered = 0;
    (rows || []).forEach(function (r) {
      var list = (byStudent[r.id] || []).filter(function (g) { return g.email; });
      if (!list.length) uncovered++;
      list.forEach(function (g) {
        var k = g.email.toLowerCase();
        if (seen[k]) return;
        seen[k] = true;
        emails.push(g.email);
      });
    });
    return { emails: emails, count: emails.length, uncovered: uncovered, byStudent: byStudent };
  }

  /* Every address on one line (or one per line), ready for a To: or Bcc:
   * field: the students' (unless opts.students is false), then any
   * parent/guardian addresses in opts.guardians. Students with no address
   * are skipped, and an address on the list twice is copied once. */
  function emailAddresses(rows, opts) {
    opts = opts || {};
    var list = opts.students === false ? [] : (rows || []).map(function (r) { return r.email; });
    list = list.concat(opts.guardians || []);
    var seen = {};
    return list.filter(function (e) {
      if (!e) return false;
      var k = e.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function joinEmails(addresses, separator) {
    return (addresses || []).join(SEPARATORS[separator] || SEPARATORS.comma);
  }

  function emailList(rows, separator, opts) {
    return joinEmails(emailAddresses(rows, opts), separator);
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
    guardians: guardians,
    guardianMap: guardianMap,
    emailAddresses: emailAddresses,
    joinEmails: joinEmails,
    emailList: emailList
  };
})();
