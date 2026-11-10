/* Canvas Gradebook+ - pure logic for Make groups (People page).
 *
 * A teacher makes a group set in one step: how many groups (or how many
 * students per group), what the groups are called (a name format the teacher
 * can save and reuse), and how students get into them - sorted at random now,
 * placed by hand, or signing themselves up. The same structure can then be
 * copied to the teacher's other classes (separate Canvas courses), or to
 * another section of this course.
 *
 * This file holds the decisions, not the I/O: the names a format gives, how
 * many groups a size means, which group each student lands in when sorted at
 * random, which membership changes a rearranged board needs, and what a copy
 * creates in another class. No DOM, no chrome.*, so it is unit tested under
 * node (tests/test-group-builder.js). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.groupBuilder) return;

  var MAX_GROUPS = 100;
  var MAX_NAME = 80;          // Canvas allows 255; a name past this is a mistake
  var MAX_FORMAT = 400;       // a list format holds many names (as util.js)

  /* Built-in formats, shown first in the picker. A format is a template with
   * tokens, or a comma-separated list of names (see parseFormat). */
  var PRESETS = [
    { label: 'Numbers', format: 'Group {n}' },
    { label: 'Letters', format: 'Team {A}' },
    { label: 'Tables', format: 'Table {n}' },
    { label: 'Lab groups', format: 'Lab Group {nn}' },
    { label: 'Set name', format: '{set} {n}' },
    { label: 'Elements', format: 'Hydrogen, Helium, Lithium, Beryllium, Boron, Carbon, Nitrogen, Oxygen, Fluorine, Neon, Sodium, Magnesium, Aluminum, Silicon, Phosphorus, Sulfur, Chlorine, Argon, Potassium, Calcium' },
    { label: 'Colors', format: 'Red, Orange, Yellow, Green, Blue, Purple, Pink, Teal, Gold, Silver, Black, White' }
  ];

  var TOKEN = /\{(n|nn|A|a|set)\}/g;

  function letters(i, upper) {
    // 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB ...
    var s = '';
    var n = i + 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return upper ? s : s.toLowerCase();
  }

  function clip(s, max) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /** {kind: 'template', text} or {kind: 'list', items}. A format with a
   * token is always a template; otherwise one with a comma or a new line is
   * a list of names, and plain text is a template that gets " {n}" added so
   * every group's name is different. */
  function parseFormat(format) {
    var f = String(format == null ? '' : format).slice(0, MAX_FORMAT);
    if (TOKEN.test(f)) { TOKEN.lastIndex = 0; return { kind: 'template', text: clip(f, MAX_NAME) }; }
    TOKEN.lastIndex = 0;
    if (/[,\n]/.test(f)) {
      var items = f.split(/[,\n]/).map(function (x) { return clip(x, MAX_NAME); }).filter(Boolean);
      if (items.length) return { kind: 'list', items: items };
    }
    var t = clip(f, MAX_NAME - 4);
    return { kind: 'template', text: (t || 'Group') + ' {n}' };
  }

  /** The names of `count` groups in a format. opts.set: the group set's
   * name (for {set}). A list shorter than count starts again with a number:
   * "Red 2", "Orange 2"... Names never repeat. */
  function formatNames(format, count, opts) {
    opts = opts || {};
    var n = Math.max(0, Math.min(MAX_GROUPS, Math.floor(Number(count) || 0)));
    var p = parseFormat(format);
    var width = Math.max(2, String(n).length);
    var setName = clip(opts.set, MAX_NAME) || 'Group';
    var out = [];
    for (var i = 0; i < n; i++) {
      var name;
      if (p.kind === 'list') {
        var round = Math.floor(i / p.items.length);
        name = p.items[i % p.items.length] + (round ? ' ' + (round + 1) : '');
      } else {
        name = p.text.replace(TOKEN, function (_, tok) {
          if (tok === 'n') return String(i + 1);
          if (tok === 'nn') { var s = String(i + 1); while (s.length < width) s = '0' + s; return s; }
          if (tok === 'A') return letters(i, true);
          if (tok === 'a') return letters(i, false);
          return setName;
        });
      }
      out.push(clip(name, MAX_NAME) || ('Group ' + (i + 1)));
    }
    // A template whose only token is {set} would name every group alike.
    var seen = Object.create(null);
    return out.map(function (name, i) {
      var key = name.toLowerCase();
      if (!seen[key]) { seen[key] = true; return name; }
      var k = 2, next;
      do { next = name + ' ' + (k++); } while (seen[next.toLowerCase()]);
      seen[next.toLowerCase()] = true;
      return next;
    });
  }

  /** How many groups: by 'count' the number itself, by 'size' enough groups
   * that none has more than `value` students. Always 1..MAX_GROUPS. */
  function groupCount(students, by, value) {
    var v = Math.floor(Number(value) || 0);
    if (v < 1) v = 1;
    var n = by === 'size' ? Math.ceil(Math.max(0, Number(students) || 0) / v) : v;
    return Math.max(1, Math.min(MAX_GROUPS, n || 1));
  }

  /** The smallest and largest group when `students` are spread evenly over
   * `count` groups. */
  function sizeRange(students, count) {
    var s = Math.max(0, Math.floor(Number(students) || 0));
    var c = Math.max(1, Math.floor(Number(count) || 1));
    return { min: Math.floor(s / c), max: Math.ceil(s / c) };
  }

  /** A fresh copy of `list` in random order. rng() returns [0, 1). */
  function shuffle(list, rng) {
    var r = typeof rng === 'function' ? rng : Math.random;
    var a = (list || []).slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      if (j > i) j = i;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** Where each student goes when sorted at random.
   *   groups:  [{id, max}]                  (max: a size limit, or none)
   *   current: {userId: groupId}            (who is in which group now)
   *   pool:    [userId]                     (the students being sorted)
   *   keep:    true  - students already in a group stay there; only the
   *                    rest of the pool is placed
   *            false - every student in the pool is placed again
   * Students outside the pool (another section) are never moved, but they
   * do count towards a group's size. Each student goes to the group with
   * the fewest members (in the groups' order on a tie), so groups end up
   * within one student of each other wherever the limits allow.
   * Returns {placement: {userId: groupId}, unplaced: [userId]} - placement
   * covers the whole pool, current members included. */
  function planRandom(opts) {
    var groups = (opts.groups || []).map(function (g) {
      var max = Number(g.max);
      return { id: String(g.id), max: max > 0 ? Math.floor(max) : Infinity, size: 0 };
    });
    var byId = Object.create(null);
    groups.forEach(function (g) { byId[g.id] = g; });
    var current = opts.current || {};
    var pool = (opts.pool || []).map(String);
    var inPool = Object.create(null);
    pool.forEach(function (u) { inPool[u] = true; });
    var placement = {};

    Object.keys(current).forEach(function (u) {
      var g = byId[String(current[u])];
      if (!g) return;
      if (!inPool[u]) { g.size++; return; }
      if (opts.keep) { g.size++; placement[u] = g.id; }
    });

    var unplaced = [];
    shuffle(pool.filter(function (u) { return !placement[u]; }), opts.rng).forEach(function (u) {
      var best = null;
      groups.forEach(function (g) {
        if (g.size >= g.max) return;
        if (!best || g.size < best.size) best = g;
      });
      if (!best) { unplaced.push(u); return; }
      best.size++;
      placement[u] = best.id;
    });
    return { placement: placement, unplaced: unplaced };
  }

  /** The membership changes that turn `before` into `after` (both
   * {userId: groupId|null}): [{userId, from, to}], `to` null for "take out of
   * every group". Only students in `after` are looked at. */
  function moves(before, after) {
    var out = [];
    Object.keys(after || {}).forEach(function (u) {
      var from = before && before[u] != null ? String(before[u]) : null;
      var to = after[u] != null ? String(after[u]) : null;
      if (from !== to) out.push({ userId: String(u), from: from, to: to });
    });
    return out;
  }

  /** A group set name not already used in the course (Canvas refuses a
   * second set with the same name): "Lab Groups", then "Lab Groups (2)"... */
  function uniqueSetName(name, taken) {
    var base = clip(name, MAX_NAME) || 'Groups';
    var used = Object.create(null);
    (taken || []).forEach(function (t) { used[clip(t, 255).toLowerCase()] = true; });
    if (!used[base.toLowerCase()]) return base;
    for (var k = 2; k < 500; k++) {
      var next = base + ' (' + k + ')';
      if (!used[next.toLowerCase()]) return next;
    }
    return base + ' (' + Date.now() + ')';
  }

  function nameTaken(name, taken) {
    var n = clip(name, 255).toLowerCase();
    return (taken || []).some(function (t) { return clip(t, 255).toLowerCase() === n; });
  }

  /** The body for creating a group set (POST group_categories).
   * signup: null (the teacher places students), 'enabled' or 'restricted'
   * (students sign up; restricted: only with classmates in their section).
   * limit: the most students a group may have when they sign up. */
  function categoryBody(name, signup, limit) {
    var body = { name: clip(name, 255) };
    if (signup === 'enabled' || signup === 'restricted') {
      body.self_signup = signup;
      var l = Math.floor(Number(limit) || 0);
      if (l > 0) body.group_limit = l;
    }
    return body;
  }

  /** What a copy of a group set creates in another class.
   *   source: {name, self_signup, group_limit}
   *   groups: [{name, max_membership}]  (in order)
   *   taken:  the names of the destination's own group sets
   *   name:   a different name for the copy (optional)
   * Returns {name, body, groups: [{name, max}], conflict} - conflict true
   * when the destination already has a set with that name (nothing is
   * created there then). */
  function copyPlan(source, groups, taken, name) {
    var setName = clip(name || (source && source.name), 255) || 'Groups';
    var signup = source && (source.self_signup === 'enabled' || source.self_signup === 'restricted') ? source.self_signup : null;
    return {
      name: setName,
      body: categoryBody(setName, signup, source && source.group_limit),
      groups: (groups || []).map(function (g) {
        var max = Number(g && g.max_membership);
        return { name: clip(g && g.name, 255) || 'Group', max: max > 0 ? Math.floor(max) : null };
      }),
      conflict: nameTaken(setName, taken)
    };
  }

  CGP.groupBuilder = {
    PRESETS: PRESETS,
    MAX_GROUPS: MAX_GROUPS,
    parseFormat: parseFormat,
    formatNames: formatNames,
    groupCount: groupCount,
    sizeRange: sizeRange,
    shuffle: shuffle,
    planRandom: planRandom,
    moves: moves,
    uniqueSetName: uniqueSetName,
    nameTaken: nameTaken,
    categoryBody: categoryBody,
    copyPlan: copyPlan
  };
})();
