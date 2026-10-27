/* Canvas Gradebook+ - pure logic for copying course content to a teacher's
 * other sections (parallel courses that are not cross-listed).
 *
 * The copy itself is Canvas's own: a selective course copy
 * (POST /api/v1/courses/:dest/content_migrations, course_copy_importer), the
 * same request Canvas's "Copy To..." tray sends. That is what carries rubrics,
 * linked files, quiz questions and module contents across, and what makes a
 * second copy of the same item update the first instead of duplicating it
 * (Canvas matches on a migration_id derived from the SOURCE item). Everything
 * Canvas's copy cannot do per section - dates, a note for one section only,
 * which module it lands in - is applied to the copy afterwards.
 *
 * This file holds the decisions, not the I/O: which request to send, which
 * destination object Canvas says is the copy, what dates each section gets,
 * how a section note is written into and read back out of the HTML, and
 * whether a section's copy still matches what was copied there. No DOM, no
 * chrome.*, so it is unit tested under node. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.sectionSync) return;

  /* ---------------------------------------------------------------- types */

  /* select: the content_migrations select[] key Canvas's own Copy To sends.
   * map: the key asset_id_mapping reports the copy under.
   * dates: the base ("everyone") date fields, in the order shown.
   * datesVia: 'details' = PUT .../date_details (Canvas's Assign To tray),
   *           'topic'   = PUT discussion_topics/:id (announcements),
   *           'module'  = PUT modules/:id module[unlock_at].
   * body: where the instructions live, for the section note.
   * insert: insert_into_module_type, or null when the type is never placed. */
  var TYPES = {
    assignment: {
      label: 'Assignment', plural: 'Assignments', select: 'assignments', map: 'assignments',
      api: 'assignments', dates: ['due_at', 'unlock_at', 'lock_at'], datesVia: 'details',
      body: { field: 'description', param: 'assignment', key: 'description' }, insert: 'assignments',
      graded: true, path: 'assignments'
    },
    quiz: {
      label: 'Quiz', plural: 'Quizzes', select: 'quizzes', map: 'quizzes',
      api: 'quizzes', dates: ['due_at', 'unlock_at', 'lock_at'], datesVia: 'details',
      body: { field: 'description', param: 'quiz', key: 'description' }, insert: 'quizzes',
      graded: true, path: 'quizzes'
    },
    discussion: {
      label: 'Discussion', plural: 'Discussions', select: 'discussion_topics', map: 'discussion_topics',
      api: 'discussion_topics', dates: ['due_at', 'unlock_at', 'lock_at'], datesVia: 'details',
      body: { field: 'message', param: null, key: 'message' }, insert: 'discussion_topics',
      graded: false, path: 'discussion_topics'
    },
    announcement: {
      label: 'Announcement', plural: 'Announcements', select: 'announcements', map: 'announcements',
      api: 'discussion_topics', dates: ['delayed_post_at', 'lock_at'], datesVia: 'topic',
      body: { field: 'message', param: null, key: 'message' }, insert: null,
      graded: false, path: 'discussion_topics'
    },
    page: {
      label: 'Page', plural: 'Pages', select: 'pages', map: 'pages',
      api: 'pages', dates: ['unlock_at', 'lock_at'], datesVia: 'details',
      body: { field: 'body', param: 'wiki_page', key: 'body' }, insert: 'pages',
      graded: false, path: 'pages'
    },
    module: {
      label: 'Module', plural: 'Modules', select: 'modules', map: 'modules',
      api: 'modules', dates: ['unlock_at'], datesVia: 'module',
      body: null, insert: null, graded: false, path: 'modules'
    }
  };

  var DATE_LABELS = {
    due_at: 'Due', unlock_at: 'Available from', lock_at: 'Until', delayed_post_at: 'Post at'
  };

  /** The base date fields one item actually has. An ungraded discussion has
   * no due date (Canvas refuses due_at for it); a graded one does. */
  function dateFields(item) {
    var t = TYPES[item && item.type];
    if (!t || item.noDates) return [];
    if (item.type === 'discussion' && !item.graded) return ['unlock_at', 'lock_at'];
    return t.dates.slice();
  }

  /* -------------------------------------------------------- linked groups */

  /* A group is the set of courses that are "the same course" for this
   * teacher. Stored as a setting (CGP.DEFAULTS.sectionGroups), one entry per
   * group: {origin, courseIds}. A course belongs to at most one group. */
  function cleanGroups(v) { return CGP.cleanSectionGroups(v); }

  function normOrigin(o) { return String(o || '').trim().toLowerCase().replace(/\/+$/, ''); }

  function groupFor(groups, origin, courseId) {
    var o = normOrigin(origin), id = String(courseId);
    var list = Array.isArray(groups) ? groups : [];
    for (var i = 0; i < list.length; i++) {
      if (normOrigin(list[i].origin) === o && (list[i].courseIds || []).map(String).indexOf(id) >= 0) return list[i];
    }
    return null;
  }

  /** The other courses linked with courseId (never courseId itself). */
  function siblings(groups, origin, courseId) {
    var g = groupFor(groups, origin, courseId);
    if (!g) return [];
    return g.courseIds.map(String).filter(function (id) { return id !== String(courseId); });
  }

  /** Groups after making `courseIds` (which include the current course) one
   * group: each of them leaves whatever group it was in, and a group left
   * with fewer than two courses goes away. Fewer than two ids unlinks. The
   * new group goes first: it is the last one a full list would give up. */
  function setGroup(groups, origin, courseIds, names) {
    var o = normOrigin(origin);
    var ids = [];
    (courseIds || []).forEach(function (id) {
      var s = String(id);
      if (/^\d+$/.test(s) && ids.indexOf(s) < 0) ids.push(s);
    });
    var out = (Array.isArray(groups) ? groups : []).map(function (g) {
      if (normOrigin(g.origin) !== o) return g;
      return { origin: g.origin, names: g.names, courseIds: (g.courseIds || []).map(String).filter(function (id) { return ids.indexOf(id) < 0; }) };
    }).filter(function (g) { return g.courseIds.length >= 2; });
    if (ids.length >= 2) out.unshift({ origin: o, courseIds: ids, names: names || {} });
    return cleanGroups(out);
  }

  /* Words that tell parallel sections apart rather than name the course:
   * "AP Chemistry - Period 2", "AP Chemistry (P4)" and "AP Chemistry Sec. 7B"
   * are the same course. A bare number is kept - "Algebra 1" and "Algebra 2"
   * are not - unless it trails a dash at the end. */
  var SECTION_TAG = /\b(period|per|pd|p|section|sect|sec|s|block|blk|b|hour|hr|h|class|cohort|group|grp)\.?\s*\d+[a-z]?\b/g;
  var SECTION_WORD = /\b(period|section|block|hour|cohort)\b/g;

  function baseName(name) {
    return String(name || '').toLowerCase()
      .replace(/[()\[\]]/g, ' ')
      .replace(SECTION_TAG, ' ')
      .replace(SECTION_WORD, ' ')
      // "Biology - 3" ends in a section; "Algebra 2" is a different course.
      .replace(/\s[-\u2013\u2014,:|/]\s*\d+[a-z]?\s*$/, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim().replace(/\s+/g, ' ');
  }

  /** Courses that look like other sections of `current`: the same name once
   * period / section / block numbers are taken out, in the same term. Only a
   * suggestion - the teacher ticks the boxes. */
  function suggestSiblings(courses, current) {
    if (!current) return [];
    var base = baseName(current.name);
    var term = current.term && current.term.name ? current.term.name : '';
    if (!base) return [];
    return (courses || []).filter(function (c) {
      if (!c || String(c.id) === String(current.id)) return false;
      var t = c.term && c.term.name ? c.term.name : '';
      return t === term && baseName(c.name) === base;
    }).map(function (c) { return String(c.id); });
  }

  /* ------------------------------------------------------------- requests */

  /** The content_migrations body for copying one item into `dest`.
   * opts.module {id, position}: place the copy in that destination module
   * (Canvas's own insert_into_module; position is 1-based, null = end).
   * opts.assignmentGroupId: a destination assignment group for a NEW copy -
   * without it Canvas puts a first copy in "Imported Assignments". */
  function copyRequest(srcCourseId, item, opts) {
    opts = opts || {};
    var t = TYPES[item.type];
    if (!t) throw new Error('Unknown item type: ' + item.type);
    var select = {};
    select[t.select] = [String(item.id)];
    var settings = { source_course_id: String(srcCourseId) };
    if (opts.module && opts.module.id && t.insert) {
      settings.insert_into_module_id = String(opts.module.id);
      // Always sent with the id: without a type Canvas inserts every item the
      // copy brought along, files referenced from the description included.
      settings.insert_into_module_type = t.insert;
      if (opts.module.position) settings.insert_into_module_position = Number(opts.module.position);
    }
    if (opts.assignmentGroupId) settings.move_to_assignment_group_id = String(opts.assignmentGroupId);
    return { migration_type: 'course_copy_importer', select: select, settings: settings };
  }

  /** Canvas's own state names for a migration (lib/api/v1/content_migration.rb). */
  function migrationState(m) {
    var s = String((m && m.workflow_state) || '');
    if (s === 'completed' || s === 'imported') return 'completed';
    if (s === 'failed' || s === 'pre_process_error') return 'failed';
    if (s === 'waiting_for_select') return 'stuck';
    return 'running';
  }

  /** The newest completed course copy from srcCourseId among a destination's
   * migrations (Canvas lists them newest first). Its asset_id_mapping covers
   * EVERY object in the destination copied from that source, not just what
   * that one migration brought. */
  function latestCopyFrom(migrations, srcCourseId) {
    var list = (migrations || []).filter(function (m) {
      return m && m.migration_type === 'course_copy_importer' && migrationState(m) === 'completed' &&
        m.settings && String(m.settings.source_course_id) === String(srcCourseId);
    });
    list.sort(function (a, b) { return Number(b.id) - Number(a.id); });
    return list[0] || null;
  }

  /** Destination id of the copy of (type, srcId), or null. asset_id_mapping
   * also holds migration_id -> {source, destination} objects under the same
   * key; only the plain "srcId": "destId" strings are read here. */
  function destIdFor(mapping, type, srcId) {
    var t = TYPES[type];
    if (!t || !mapping) return null;
    var box = mapping[t.map];
    if (!box || typeof box !== 'object') return null;
    var v = box[String(srcId)];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    return null;
  }

  /** The URL path segment the APIs take for an item. Pages go by
   * "page_id:<id>", which every wiki lookup accepts (Wiki#find_page). */
  function itemRef(type, id) {
    return type === 'page' ? 'page_id:' + String(id) : encodeURIComponent(String(id));
  }

  function itemApiPath(courseId, type, id) {
    var t = TYPES[type];
    return '/api/v1/courses/' + encodeURIComponent(String(courseId)) + '/' + t.api + '/' + itemRef(type, id);
  }

  function itemHtmlPath(courseId, type, id) {
    var t = TYPES[type];
    if (type === 'announcement') return '/courses/' + courseId + '/discussion_topics/' + id;
    return '/courses/' + courseId + '/' + t.path + '/' + (type === 'page' ? itemRef(type, id) : id);
  }

  /* ---------------------------------------------------------------- dates */

  /* The date boxes show wall-clock time in the teacher's Canvas time zone
   * (their profile's, as Canvas itself shows dates), not the computer's. */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function zoneParts(ms, tz) {
    var f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var out = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') out[p.type] = Number(p.value); });
    if (out.hour === 24) out.hour = 0;
    return out;
  }

  function validZone(tz) {
    if (!tz) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  /** ISO instant -> "YYYY-MM-DDTHH:MM" wall time in tz ('' for none). */
  function isoToLocal(iso, tz) {
    if (!iso) return '';
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return '';
    var p = validZone(tz) ? zoneParts(ms, tz) : null;
    if (!p) {
      var d = new Date(ms);
      p = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
    }
    return p.year + '-' + pad(p.month) + '-' + pad(p.day) + 'T' + pad(p.hour) + ':' + pad(p.minute);
  }

  var LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

  /** "YYYY-MM-DDTHH:MM" wall time in tz -> ISO instant (null for blank,
   * undefined for something that is not a date). A wall time that a DST
   * change skips is moved forward by the length of the gap. */
  function localToIso(local, tz) {
    var s = String(local == null ? '' : local).trim();
    if (!s) return null;
    var m = LOCAL_RE.exec(s);
    if (!m) return undefined;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return undefined;
    var wall = Date.UTC(y, mo - 1, d, h, mi);
    var check = new Date(wall);
    if (check.getUTCDate() !== d) return undefined; // Feb 30th and friends
    if (!validZone(tz)) return new Date(y, mo - 1, d, h, mi).toISOString();
    // The zone's offset a little before and after that wall time. Read with
    // the earlier one first, an ambiguous (repeated) time is its first
    // occurrence; a time a DST change skips matches neither and is read
    // with the earlier offset, which lands the same distance past the gap.
    var before = offsetAt(wall - 12 * 3600000, tz);
    var after = offsetAt(wall + 12 * 3600000, tz);
    var tries = [wall - before, wall - after];
    for (var i = 0; i < tries.length; i++) {
      var p = zoneParts(tries[i], tz);
      if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall) return new Date(tries[i]).toISOString();
    }
    return new Date(wall - before).toISOString();
  }

  /** The zone's UTC offset at an instant, in ms (east positive). */
  function offsetAt(ms, tz) {
    var p = zoneParts(ms, tz);
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  /** localToIso, keeping the seconds of `base` (the date the box started
   * from) when the clock time is the same: an 11:59:59 PM deadline moved
   * to another day stays 11:59:59, not 11:59:00. */
  function localToIsoKeeping(local, tz, base) {
    var iso = localToIso(local, tz);
    if (!iso || !base) return iso;
    var b = Date.parse(base);
    if (!isFinite(b) || isoToLocal(base, tz).slice(11) !== String(local).trim().slice(11)) return iso;
    var sec = new Date(b).getUTCSeconds();
    if (!sec) return iso;
    return new Date(Date.parse(iso) + sec * 1000).toISOString();
  }

  /** Move a wall time by whole days, keeping its clock time. */
  function shiftLocal(local, days) {
    var m = LOCAL_RE.exec(String(local || ''));
    if (!m || !days) return local || '';
    var t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Number(days)));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + 'T' + m[4] + ':' + m[5];
  }

  /** Same day, another clock time ("HH:MM"). */
  function withTime(local, clock) {
    var m = LOCAL_RE.exec(String(local || ''));
    var c = CGP.normalizeClock ? CGP.normalizeClock(clock) : null;
    if (!m || !c) return local || '';
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + c;
  }

  /** What a teacher types as a time: a period shortcut from the Time
   * Shortcuts list ("3"), "13:45", "1:45 pm", "9am". -> "HH:MM" or null. */
  function parseClock(text, shortcuts) {
    var raw = String(text == null ? '' : text).trim().toLowerCase();
    if (!raw) return null;
    if (CGP.timeShortcuts && shortcuts) {
      var hit = CGP.timeShortcuts.lookup(raw, shortcuts);
      if (hit) return CGP.normalizeClock(hit.time);
    }
    var m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/.exec(raw);
    if (m) {
      var h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
      if (h < 1 || h > 12 || min > 59) return null;
      if (m[3] === 'p' && h < 12) h += 12;
      if (m[3] === 'a' && h === 12) h = 0;
      return pad(h) + ':' + pad(min);
    }
    return CGP.normalizeClock ? CGP.normalizeClock(raw) : null;
  }

  /** Problems with one section's dates for one item: unreadable boxes, and
   * the order Canvas enforces (available from <= due <= until). */
  function checkDates(values, tz) {
    var errs = [];
    var iso = {};
    Object.keys(values || {}).forEach(function (k) {
      var v = localToIso(values[k], tz);
      if (v === undefined) errs.push((DATE_LABELS[k] || k) + ' is not a date');
      else iso[k] = v;
    });
    var from = iso.unlock_at || iso.delayed_post_at;
    function before(a, b) { return a && b && Date.parse(a) > Date.parse(b); }
    if (before(from, iso.due_at)) errs.push('Available from is after Due');
    if (before(iso.due_at, iso.lock_at)) errs.push('Due is after Until');
    if (!iso.due_at && before(from, iso.lock_at)) errs.push('Available from is after Until');
    return { errors: errs, iso: iso };
  }

  /** Same instant, ignoring seconds and formatting. */
  function sameInstant(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    var x = Date.parse(a), y = Date.parse(b);
    return isFinite(x) && isFinite(y) && Math.floor(x / 60000) === Math.floor(y / 60000);
  }

  /* The write that gives a copy its section's dates, given the copy's own
   * date_details (null when the type has none). Never touches overrides
   * (no assignment_overrides key: Canvas leaves them exactly as they are),
   * so a student extension added in that section survives. Returns
   * {skip: reason} instead when there is nothing it may safely write. */
  function datesWrite(item, isoDates, destDetails) {
    var t = TYPES[item.type];
    var fields = dateFields(item);
    if (t.datesVia === 'details' && destDetails) {
      if (destDetails.checkpoints && destDetails.checkpoints.length) {
        return { skip: 'it has checkpoint due dates (reply to topic / required replies), which Gradebook+ leaves to Canvas' };
      }
      if (destDetails.visible_to_everyone === false && !destDetails.only_visible_to_overrides) {
        // An older section-specific discussion: any date_details write would
        // clear its section restriction (update_ungraded_object).
        return { skip: 'it is open only to particular sections there, so its dates are set in its Assign To' };
      }
      if (destDetails.only_visible_to_overrides) {
        // Base dates do not apply to anyone then, and sending due_at alone
        // would make Canvas assign it to everyone (handle_only_visible_to_overrides!).
        return { skip: 'it is assigned only to particular students or sections there, so its dates are set in its Assign To' };
      }
    }
    var body = {};
    var changed = false;
    fields.forEach(function (f) {
      var want = isoDates[f] === undefined ? null : isoDates[f];
      body[f] = want;
      var have = destDetails ? destDetails[f] : undefined;
      if (have === undefined || !sameInstant(have, want)) changed = true;
    });
    if (!changed) return { unchanged: true };
    if (t.datesVia === 'details') {
      body.only_visible_to_overrides = false;
      return { via: 'details', body: body };
    }
    if (t.datesVia === 'topic') return { via: 'topic', body: body };
    return { via: 'module', body: { module: body } };
  }

  /* --------------------------------------------------------- section note */

  /* A note for one section is written at the top of the copy's
   * instructions as a <div data-cgp-section-note>. Canvas's sanitizer keeps
   * data-* attributes and inline styles, so the block can be found again:
   * re-copying replaces the instructions with this section's, and the note
   * is put back; the dialog reads it to show what that section already has. */
  var NOTE_ATTR = 'data-cgp-section-note';
  var NOTE_OPEN = /<div\b[^>]*\bdata-cgp-section-note\b[^>]*>/i;
  var NOTE_STYLE = 'border-left: 4px solid #0770a3; background: #eef6fb; padding: 8px 12px; margin: 0 0 12px 0; border-radius: 4px;';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function noteHtml(text) {
    var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
    if (!t) return '';
    var paras = t.split(/\n{2,}/).map(function (p) {
      return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>';
    });
    return '<div ' + NOTE_ATTR + '="1" style="' + NOTE_STYLE + '">' + paras.join('') + '</div>';
  }

  /** Where the note block starts and ends in html (balanced <div>s), or null. */
  function findNote(html) {
    var s = String(html || '');
    var m = NOTE_OPEN.exec(s);
    if (!m) return null;
    var depth = 1;
    var re = /<(\/?)div\b[^>]*>/gi;
    re.lastIndex = m.index + m[0].length;
    var x;
    while ((x = re.exec(s))) {
      depth += x[1] ? -1 : 1;
      if (depth === 0) return { start: m.index, innerStart: m.index + m[0].length, innerEnd: x.index, end: re.lastIndex };
    }
    return { start: m.index, innerStart: m.index + m[0].length, innerEnd: s.length, end: s.length };
  }

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, function (all, e) {
      var k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.charAt(0) === '#') {
        var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        if (isFinite(n) && n > 0 && n < 0x110000) { try { return String.fromCodePoint(n); } catch (er) { return all; } }
      }
      return all;
    });
  }

  function htmlToText(html, keepBreaks) {
    var s = String(html || '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    if (keepBreaks) {
      s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n');
    }
    s = decodeEntities(s.replace(/<[^>]*>/g, keepBreaks ? '' : ' '));
    if (keepBreaks) {
      return s.split('\n').map(function (l) { return l.replace(/[ \t ]+/g, ' ').trim(); })
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    return s.replace(/[\s ]+/g, ' ').trim();
  }

  /** {html: without the note, note: its text ('' for none)}. */
  function splitNote(html) {
    var s = String(html || '');
    var at = findNote(s);
    if (!at) return { html: s, note: '' };
    var rest = s.slice(0, at.start) + s.slice(at.end);
    return { html: rest.replace(/^\s+/, ''), note: htmlToText(s.slice(at.innerStart, at.innerEnd), true) };
  }

  /** html with its section note replaced by `text` (removed when blank). */
  function withNote(html, text) {
    var base = splitNote(html).html;
    var block = noteHtml(text);
    return block ? block + base : base;
  }

  /* -------------------------------------------------------- copy tracking */

  /* Whether a section's copy has been changed THERE since it was copied is
   * the one thing that decides if updating it is safe. Canvas keeps no such
   * record for a course copy (only Blueprint does), so after every copy the
   * copy's text is fingerprinted and kept on this computer; a later look
   * compares the copy as it is now against that. Text, not HTML: the same
   * content links to different file and course ids in every course. */
  function fingerprint(html) {
    var t = htmlToText(splitNote(html).html, false);
    var h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8) + ':' + t.length;
  }

  /** How a section's existing copy relates to the item being copied:
   *  'same'    - same text as the item now (only dates/settings can differ)
   *  'stale'   - unchanged there since it was copied; the item has moved on
   *  'edited'  - changed there since it was copied
   *  'differs' - different text, and this computer has no record of the
   *              copy to say which side changed. */
  function compareCopy(srcHtml, destHtml, baseline) {
    var src = fingerprint(srcHtml);
    var dest = fingerprint(destHtml);
    if (src === dest) return 'same';
    if (!baseline) return 'differs';
    return baseline === dest ? 'stale' : 'edited';
  }

  /** Updating overwrites the copy unless it was edited there; when it is
   * unknown which side changed, the safe default keeps the section's own. */
  function defaultReplace(status) {
    return status === 'same' || status === 'stale' || status === 'new';
  }

  /** A same-titled item already in the destination that is NOT a copy of
   * this one (it came from another course - last year's, say). Canvas's copy
   * cannot know they are the same thing, so copying adds a second one. */
  function lookalike(destItems, title) {
    var want = String(title || '').trim().toLowerCase();
    if (!want) return null;
    for (var i = 0; i < (destItems || []).length; i++) {
      var d = destItems[i];
      if (d && String(d.title || d.name || '').trim().toLowerCase() === want) return d;
    }
    return null;
  }

  function trackKey(origin, srcCourseId, type, srcId, destCourseId) {
    return normOrigin(origin) + '|' + srcCourseId + '|' + type + ':' + srcId + '>' + destCourseId;
  }

  /* --------------------------------------------------------- module index */

  /** Where each piece of content sits in a course's modules:
   * "type:id" -> [{moduleId, moduleName, position}] (1-based position among
   * the module's items). Pages are indexed by page id and by url. */
  function moduleIndex(modules) {
    var idx = Object.create(null);
    (modules || []).forEach(function (mod) {
      (mod.items || []).forEach(function (it, i) {
        var key = null, alt = null;
        if (it.type === 'Assignment') key = 'assignment:' + it.content_id;
        else if (it.type === 'Quiz') key = 'quiz:' + it.content_id;
        else if (it.type === 'Discussion') key = 'discussion:' + it.content_id;
        else if (it.type === 'Page') { key = it.content_id ? 'page:' + it.content_id : null; alt = it.page_url ? 'pageurl:' + it.page_url : null; }
        var place = { moduleId: String(mod.id), moduleName: mod.name || '', position: i + 1 };
        [key, alt].forEach(function (k) { if (k) (idx[k] = idx[k] || []).push(place); });
      });
    });
    return idx;
  }

  /** Where the copy should go in the destination: the destination module
   * that IS the copy of the source module (asset_id_mapping), else the one
   * destination module with exactly the same name. null when neither. */
  function destModuleFor(place, mapping, destModules) {
    if (!place) return null;
    var mapped = destIdFor(mapping, 'module', place.moduleId);
    var list = destModules || [];
    if (mapped) {
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === mapped) return { id: mapped, name: list[i].name, position: place.position };
    }
    var want = String(place.moduleName || '').trim().toLowerCase();
    var hits = list.filter(function (m) { return String(m.name || '').trim().toLowerCase() === want; });
    if (hits.length === 1) return { id: String(hits[0].id), name: hits[0].name, position: place.position };
    return null;
  }

  /* -------------------------------------------------------- course items */

  /** One Canvas object (from its list API) -> the item the dialog works with.
   * An assignment that is really a classic quiz or a discussion is offered
   * as that quiz or discussion instead, which is what Canvas copies. */
  function toItem(type, o) {
    if (!o) return null;
    if (type === 'assignment') {
      var st = o.submission_types || [];
      if (o.quiz_id || st.indexOf('online_quiz') >= 0) return null;
      if (st.indexOf('discussion_topic') >= 0) return null;
      return {
        type: 'assignment', id: String(o.id), title: o.name || '', published: !!o.published,
        newQuiz: !!o.is_quiz_lti_assignment, assignmentGroupId: o.assignment_group_id ? String(o.assignment_group_id) : null,
        html: o.description || '', dates: pick(o, ['due_at', 'unlock_at', 'lock_at']),
        hasOverrides: !!(o.has_overrides || o.only_visible_to_overrides)
      };
    }
    if (type === 'quiz') {
      return {
        type: 'quiz', id: String(o.id), title: o.title || '', published: !!o.published,
        assignmentGroupId: o.assignment_group_id ? String(o.assignment_group_id) : null,
        html: o.description || '', dates: pick(o, ['due_at', 'unlock_at', 'lock_at']),
        hasOverrides: !!o.only_visible_to_overrides
      };
    }
    if (type === 'discussion' || type === 'announcement') {
      var isAnn = !!o.is_announcement || type === 'announcement';
      var a = o.assignment || null;
      var item = {
        type: isAnn ? 'announcement' : 'discussion', id: String(o.id), title: o.title || '',
        published: o.published !== false, html: o.message || '', graded: !isAnn && !!(o.assignment_id || a),
        assignmentGroupId: a && a.assignment_group_id ? String(a.assignment_group_id) : null
      };
      if (isAnn) item.dates = pick(o, ['delayed_post_at', 'lock_at']);
      else if (item.graded && a) item.dates = pick(a, ['due_at', 'unlock_at', 'lock_at']);
      else item.dates = { unlock_at: o.delayed_post_at || o.unlock_at || null, lock_at: o.lock_at || null };
      return item;
    }
    if (type === 'page') {
      return {
        type: 'page', id: String(o.page_id), url: o.url || '', title: o.title || '', published: !!o.published,
        html: o.body || '', dates: {}
      };
    }
    if (type === 'module') {
      return {
        type: 'module', id: String(o.id), title: o.name || '', published: o.published !== false,
        html: '', dates: pick(o, ['unlock_at']), items: o.items || null
      };
    }
    return null;
  }

  function pick(o, keys) {
    var out = {};
    keys.forEach(function (k) { out[k] = o[k] || null; });
    return out;
  }

  /** The gradable or dated things inside a module that get their own
   * per-section dates when the module is copied (its items' contents are
   * copied with it). Sub-headers, links and files carry no dates here. */
  function moduleChildren(moduleItems) {
    var out = [];
    (moduleItems || []).forEach(function (it) {
      if (it.type === 'Assignment') out.push({ type: 'assignment', id: String(it.content_id), title: it.title || '' });
      else if (it.type === 'Quiz') out.push({ type: 'quiz', id: String(it.content_id), title: it.title || '' });
      else if (it.type === 'Discussion') out.push({ type: 'discussion', id: String(it.content_id), title: it.title || '' });
    });
    return out;
  }

  /* ------------------------------------------------------ the current page */

  /** What item, if any, the current course page is. */
  function itemFromPath(pathname) {
    var p = String(pathname || '');
    var m;
    if ((m = /^\/courses\/(\d+)\/assignments\/(\d+)(\/edit)?\/?$/.exec(p))) return { courseId: m[1], type: 'assignment', id: m[2] };
    if ((m = /^\/courses\/(\d+)\/quizzes\/(\d+)(\/edit)?\/?$/.exec(p))) return { courseId: m[1], type: 'quiz', id: m[2] };
    if ((m = /^\/courses\/(\d+)\/(discussion_topics|announcements)\/(\d+)(\/edit)?\/?$/.exec(p))) {
      return { courseId: m[1], type: m[2] === 'announcements' ? 'announcement' : 'discussion', id: m[3] };
    }
    if ((m = /^\/courses\/(\d+)\/(pages|wiki)\/([^\/]+?)(\/edit)?\/?$/.exec(p))) {
      if (m[3] === 'new') return null;
      var slug;
      try { slug = decodeURIComponent(m[3]); } catch (e) { slug = m[3]; }
      return { courseId: m[1], type: 'page', slug: slug };
    }
    return null;
  }

  CGP.sectionSync = {
    TYPES: TYPES,
    DATE_LABELS: DATE_LABELS,
    dateFields: dateFields,
    cleanGroups: cleanGroups,
    groupFor: groupFor,
    siblings: siblings,
    setGroup: setGroup,
    baseName: baseName,
    suggestSiblings: suggestSiblings,
    copyRequest: copyRequest,
    migrationState: migrationState,
    latestCopyFrom: latestCopyFrom,
    destIdFor: destIdFor,
    itemRef: itemRef,
    itemApiPath: itemApiPath,
    itemHtmlPath: itemHtmlPath,
    isoToLocal: isoToLocal,
    localToIso: localToIso,
    localToIsoKeeping: localToIsoKeeping,
    shiftLocal: shiftLocal,
    withTime: withTime,
    parseClock: parseClock,
    checkDates: checkDates,
    sameInstant: sameInstant,
    datesWrite: datesWrite,
    noteHtml: noteHtml,
    splitNote: splitNote,
    withNote: withNote,
    htmlToText: htmlToText,
    fingerprint: fingerprint,
    compareCopy: compareCopy,
    defaultReplace: defaultReplace,
    lookalike: lookalike,
    trackKey: trackKey,
    moduleIndex: moduleIndex,
    destModuleFor: destModuleFor,
    toItem: toItem,
    moduleChildren: moduleChildren,
    itemFromPath: itemFromPath
  };
})();
