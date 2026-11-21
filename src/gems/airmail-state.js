/* Canvas Gradebook+ - Airmail: the rare paper airplane.
 *
 * Every so often - not often - a folded paper airplane glides slowly across
 * the gradebook and lands in the corner, where it waits. Click it and it
 * opens into an airmail letter: the kind of note a teacher finds on their
 * desk once in a while and keeps for years. Caught notes go into the Shoebox
 * (a tab on the options page that does not exist until the first note is
 * caught). One left waiting for over a minute flies off, and is gone.
 *
 * When one can fly - never more than one a day, and only by luck:
 *   - 'columnDone': the teacher fills in the last empty cell of a column, so
 *     every student in it has a grade (or is excused)            1 in 5
 *   - 'posted':     a column's grades were posted to students      1 in 8
 *   - 'idle':       a while after the gradebook opens              1 in 100
 *   - 'summon':     #cgp-airmail in the address. Always, and it does not use
 *                   up the day's plane (for showing a colleague).
 *
 * What the note says depends on where and when it arrives:
 *   - about one plane in twenty is gold: a note from the teacher's own first
 *     year of teaching;
 *   - more often than not, it is about the subject of the course it lands
 *     in, read from the course's name (subjectOf): Spanish notes are in
 *     Spanish, French in French, math notes are a little bit nerdy, a
 *     theology class gets Augustine, a band gets a fermata...;
 *   - otherwise after 10pm it is a night note, on a Friday afternoon a
 *     Friday note, and at the start of the year, before winter break and in
 *     the last weeks of the year, sometimes a note for the season.
 * The plane suits the subject too: its trail is drawn in that subject's
 * marks (pi and sigmas behind a math plane, notes behind a music one), and
 * the note arrives stamped and postmarked. About one flight in thirty is a
 * whole flock in formation; any one of them carries the note.
 *
 * This file is the small part loaded on every course page: the odds, the
 * record, and spotting a finished column. The plane itself and its notes
 * (airmail.js, airmail-notes.js) are injected by background.js only on the
 * day one actually flies, the same way as the welcome tour.
 *
 * The record lives in chrome.storage.local ('cgp.airmail'): which notes were
 * caught and when, how many got away, the day the last plane flew, and
 * whether planes are switched off. No student, course or grade is in it.
 *
 * No DOM and no chrome.* at load time, so tests load it as-is. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.AirmailState) return;

  var KEY = 'cgp.airmail';

  function defaultStorage() {
    var local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    return local || null;
  }

  function AirmailState(storage) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  AirmailState.KEY = KEY;
  AirmailState.INJECT = 'cgp.airmailInject';
  AirmailState.FILES = ['src/gems/airmail-notes.js', 'src/gems/airmail.js'];
  AirmailState.ODDS = { columnDone: 1 / 5, posted: 1 / 8, idle: 1 / 100, summon: 1 };
  AirmailState.GOLDEN = 1 / 20;
  AirmailState.FLOCK = 1 / 30;
  AirmailState.SUBJECT_CHANCE = 0.6;
  AirmailState.SEASON_CHANCE = 0.4;

  /* Subjects a course name can name, most specific first: "AP Chemistry"
   * is chemistry before it is science, "English Language Arts" English
   * before art. `pile` is the note pile, `label` the postmark. */
  AirmailState.SUBJECTS = [
    { id: 'spanish', label: 'Español', re: /\b(spanish|espa[nñ]ol|spn)\b/ },
    { id: 'french', label: 'Français', re: /\b(french|fran[cç]ais)\b/ },
    { id: 'german', label: 'Deutsch', re: /\b(german|deutsch)\b/ },
    { id: 'latin', label: 'Latina', re: /\blatin\b/ },
    { id: 'chinese', label: '中文', re: /\b(chinese|mandarin)\b|中文/ },
    { id: 'cs', label: 'Code', re: /\b(computer|computing|programming|coding|python|java|robotics|cs ?\d*|csa|csp)\b/ },
    { id: 'chemistry', label: 'Chem', re: /\bchem/ },
    { id: 'physics', label: 'Physics', re: /\bphysics\b/ },
    { id: 'biology', label: 'Biology', re: /\b(bio\w*|anatomy|physiology|ecology|genetics|life science|zoology|botany|marine)\b/ },
    { id: 'science', label: 'Science', re: /\b(science|earth|environmental|astronomy|geology|stem|lab|engineering)\b/ },
    { id: 'math', label: 'Math', re: /\b(math\w*|algebra|geometry|calc\w*|precalc\w*|pre-calc\w*|statistics|stats?|trig\w*|numbers)\b/ },
    { id: 'economics', label: 'Econ', re: /\b((macro|micro)?econ\w*|finance|business|accounting|marketing|entrepreneur\w*)\b/ },
    { id: 'psychology', label: 'Psych', re: /\b(psych\w*|sociology)\b/ },
    { id: 'english', label: 'English', re: /\b(english|literature|lit|writing|composition|rhetoric|poetry|language arts|ela|journalism|humanities)\b/ },
    { id: 'history', label: 'History', re: /\b(history|hist|civics|government|gov|social studies|geography|apush|world cultures|western civ\w*)\b/ },
    { id: 'theology', label: 'Theology', re: /\b(theology|religion|religious|scripture|bible|biblical|catholic|christian\w*|church|sacraments?|augustin\w*|catechism|faith|morality|ministry|hebrew scriptures|new testament|old testament)\b/ },
    { id: 'music', label: 'Music', re: /\b(music|band|choir|chorus|chorale|orchestra|jazz|piano|guitar|strings|ensemble|percussion|vocal)\b/ },
    { id: 'drama', label: 'Theatre', re: /\b(drama|theat(er|re)|acting|stagecraft|improv)\b/ },
    { id: 'art', label: 'Art', re: /\b(art|arts|drawing|painting|ceramics|pottery|sculpture|photography|design|illustration)\b/ },
    { id: 'pe', label: 'Gym', re: /\b(pe|p\.e\.?|physical education|health|fitness|wellness|athletics|gym|kinesiology)\b/ }
  ];

  /* The subject a course name names, or null. */
  AirmailState.subjectOf = function (text) {
    var t = String(text || '').toLowerCase();
    if (!t) return null;
    for (var i = 0; i < AirmailState.SUBJECTS.length; i++) {
      if (AirmailState.SUBJECTS[i].re.test(t)) return AirmailState.SUBJECTS[i].id;
    }
    return null;
  };

  AirmailState.subjectLabel = function (id) {
    for (var i = 0; i < AirmailState.SUBJECTS.length; i++) if (AirmailState.SUBJECTS[i].id === id) return AirmailState.SUBJECTS[i].label;
    return '';
  };

  /* The school year's seasons that have notes of their own. */
  AirmailState.season = function (d) {
    d = d instanceof Date ? d : new Date(d);
    var m = d.getMonth();
    if (m === 7 || m === 8) return 'fall';
    if (m === 11) return 'winter';
    if (m === 4 || m === 5) return 'finale';
    return null;
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* The local calendar day, 'YYYY-MM-DD': "one a day" means the teacher's day. */
  AirmailState.dayKey = function (d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  /* Which kind of note suits the moment. */
  AirmailState.flavor = function (d) {
    d = d instanceof Date ? d : new Date(d);
    var h = d.getHours();
    if (h >= 22 || h < 4) return 'night';
    if (d.getDay() === 5 && h >= 13) return 'friday';
    return 'day';
  };

  /* Should a plane fly now? `record` is the stored record, `rand` a function
   * returning [0, 1). Returns what to fly - { trigger, flavor, golden } - or
   * null. Pure: the caller stores the day if it flies. */
  AirmailState.decide = function (record, trigger, now, rand, subject) {
    record = record || {};
    rand = rand || Math.random;
    var odds = AirmailState.ODDS[trigger];
    if (!odds) return null;
    var forced = trigger === 'summon';
    if (!forced) {
      if (record.off === true) return null;
      if (record.lastDay === AirmailState.dayKey(now)) return null;
      if (rand() >= odds) return null;
    }
    return {
      trigger: trigger,
      flavor: AirmailState.flavor(now),
      season: AirmailState.season(now),
      subject: subject || null,
      golden: rand() < AirmailState.GOLDEN,
      flock: rand() < AirmailState.FLOCK
    };
  };

  /* Which pile a plane's note comes from: gold first, then (by luck) the
   * course's subject, then the hour (night, Friday), then (by luck) the
   * season, else the everyday pile. */
  AirmailState.pileFor = function (spec, rand) {
    rand = rand || Math.random;
    spec = spec || {};
    if (spec.golden) return 'golden';
    if (spec.subject && rand() < AirmailState.SUBJECT_CHANCE) return spec.subject;
    if (spec.flavor === 'night' || spec.flavor === 'friday') return spec.flavor;
    if (spec.season && rand() < AirmailState.SEASON_CHANCE) return spec.season;
    return 'day';
  };

  /* The note a plane carries, from pileFor's pile (the everyday pile if that
   * one is empty). A note not yet caught is always preferred, so the Shoebox
   * fills before anything repeats. `notes` is CGP.AIRMAIL_NOTES. */
  AirmailState.pickNote = function (notes, record, spec, rand) {
    rand = rand || Math.random;
    var list = Array.isArray(notes) ? notes : [];
    var pile = AirmailState.pileFor(spec, rand);
    var pool = list.filter(function (n) { return n.pile === pile; });
    if (!pool.length) pool = list.filter(function (n) { return n.pile === 'day'; });
    if (!pool.length) return null;
    var caught = {};
    ((record && record.caught) || []).forEach(function (c) { if (c && c.id) caught[c.id] = true; });
    var fresh = pool.filter(function (n) { return !caught[n.id]; });
    var from = fresh.length ? fresh : pool;
    return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
  };

  /* -------------------------------------------------------- the record */

  AirmailState.prototype.read = function () {
    var s = this.storage;
    if (!s) return Promise.resolve({});
    var got;
    try { got = s.get(KEY); } catch (e) { return Promise.resolve({}); }
    return Promise.resolve(got).then(function (got) {
      var v = got && got[KEY];
      return v && typeof v === 'object' ? v : {};
    }, function () { return {}; });
  };

  /* Merges `patch` (or what `fn(current)` returns) into the record, one write
   * at a time. A plane is a nicety: storage failures are swallowed. */
  AirmailState.prototype.write = function (patch) {
    var s = this.storage;
    var self = this;
    var run = function () {
      return self.read().then(function (cur) {
        var p = typeof patch === 'function' ? patch(cur) : patch;
        var next = Object.assign({}, cur, p);
        if (!s) return next;
        var o = {};
        o[KEY] = next;
        return new Promise(function (resolve) { resolve(s.set(o)); }).then(function () { return next; });
      });
    };
    var done = (this._queue || Promise.resolve()).then(run);
    this._queue = done.catch(function () { /* the next write still runs */ });
    return done.catch(function () { return null; });
  };

  /* A plane is in the air: today's is used up. */
  AirmailState.prototype.noteFlight = function (now) {
    var day = AirmailState.dayKey(now);
    return this.write(function (cur) { return { lastDay: day, flights: (Number(cur.flights) || 0) + 1 }; });
  };

  /* Caught: into the Shoebox, once per note (catching one again only moves
   * its date). Resolves with { first, record }: first is true for the very
   * first note ever caught. */
  AirmailState.prototype.keep = function (noteId, now) {
    var at = now instanceof Date ? now.getTime() : Number(now) || Date.now();
    var first = false;
    return this.write(function (cur) {
      var caught = Array.isArray(cur.caught) ? cur.caught.filter(function (c) { return c && c.id !== noteId; }) : [];
      first = !(Array.isArray(cur.caught) && cur.caught.length);
      caught.push({ id: String(noteId), at: at });
      return { caught: caught };
    }).then(function (rec) { return { first: first, record: rec }; });
  };

  /* One that got away. */
  AirmailState.prototype.miss = function () {
    return this.write(function (cur) { return { missed: (Number(cur.missed) || 0) + 1 }; });
  };

  AirmailState.prototype.setOff = function (off) {
    return this.write({ off: !!off });
  };

  /* --------------------------------------------- spotting a finished column */

  /* A submission counts as done when it has a grade or is excused. */
  AirmailState.isGraded = function (rec) {
    if (!rec) return false;
    if (rec.excused) return true;
    if (rec.score !== null && rec.score !== undefined && rec.score !== '') return true;
    return rec.grade !== null && rec.grade !== undefined && String(rec.grade) !== '';
  };

  /* Is every student in this column done? null when it can't be told yet
   * (not every student's submission is loaded, or a class of one). */
  AirmailState.columnComplete = function (records, studentCount) {
    if (!Array.isArray(records) || !studentCount || studentCount < 2 || records.length < studentCount) return null;
    for (var i = 0; i < records.length; i++) if (!AirmailState.isGraded(records[i])) return false;
    return true;
  };

  /* Remembers each column's state and says when a column goes from
   * unfinished to finished by an edit the teacher just made. A column that
   * loads already finished, or finishes on a re-read, never counts. */
  function ColumnWatcher() { this.state = Object.create(null); }
  ColumnWatcher.prototype.observe = function (assignmentId, complete, byEdit) {
    if (complete === null || complete === undefined) return false;
    var id = String(assignmentId);
    var was = this.state[id];
    this.state[id] = !!complete;
    return !!(byEdit && complete && was === false);
  };
  AirmailState.ColumnWatcher = ColumnWatcher;

  /* ------------------------------------------------------- on a course page */

  var inFlight = false;

  /* Rolls for a plane and, if one flies, has background.js inject the plane
   * into this tab and launches it. Safe to call often. */
  AirmailState.trigger = function (trigger, opts) {
    if (inFlight || typeof document === 'undefined' || typeof chrome === 'undefined' ||
        !chrome.runtime || !chrome.runtime.sendMessage) return Promise.resolve(null);
    if (trigger !== 'summon' && document.visibilityState === 'hidden') return Promise.resolve(null);
    var state = new AirmailState();
    var now = new Date();
    inFlight = true;
    return Promise.all([state.read(), courseSubject()]).then(function (got) {
      var rec = got[0];
      var spec = AirmailState.decide(rec, trigger, now, opts && opts.rand, got[1]);
      if (!spec) return null;
      return (trigger === 'summon' ? Promise.resolve() : state.noteFlight(now)).then(function () {
        return loadPlane();
      }).then(function (ok) {
        if (!ok || !CGP.AirmailFlight || !CGP.AIRMAIL_NOTES) return null;
        var note = AirmailState.pickNote(CGP.AIRMAIL_NOTES, rec, spec);
        if (!note) return null;
        if (CGP.diag) CGP.diag.bump('airmail.flight');
        return new Promise(function (resolve) {
          CGP.AirmailFlight.launch({
            note: note,
            spec: spec,
            onCatch: function () { return state.keep(note.id, Date.now()); },
            onMiss: function () { state.miss(); },
            onDone: function () { resolve(spec); }
          });
        });
      });
    }).then(function (v) { inFlight = false; return v; }, function () { inFlight = false; return null; });
  };

  /* This course's subject, from its name: the breadcrumb and the page title
   * Canvas already shows, or - if neither names one - the course's name and
   * code from Canvas (one small read, once per page). */
  var subjectPromise = null;
  function courseSubject() {
    if (subjectPromise) return subjectPromise;
    var onPage = [];
    try {
      var crumbs = document.querySelectorAll('#breadcrumbs li a span, #breadcrumbs li a');
      for (var i = 0; i < crumbs.length && i < 4; i++) onPage.push(crumbs[i].textContent || '');
      onPage.push(document.title || '');
    } catch (e) { /* no page */ }
    var found = AirmailState.subjectOf(onPage.join(' \u2022 '));
    var m = typeof location !== 'undefined' && /\/courses\/(\d+)/.exec(location.pathname || '');
    if (found || !m || !CGP.CanvasApi) return (subjectPromise = Promise.resolve(found));
    var asked = new CGP.CanvasApi().course(m[1]).then(function (c) {
      return AirmailState.subjectOf([c && c.name, c && c.course_code, c && c.original_name].join(' \u2022 '));
    }, function () { return null; });
    var late = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 3000); });
    return (subjectPromise = Promise.race([asked, late]));
  }

  function loadPlane() {
    if (CGP.AirmailFlight && CGP.AIRMAIL_NOTES) return Promise.resolve(true);
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: AirmailState.INJECT }, function (res) {
          void (chrome.runtime.lastError);
          resolve(!!(res && res.ok));
        });
      } catch (e) { resolve(false); }
    });
  }

  /* Wired up by gradebook/content.js once the model is ready: watches for a
   * finished column, and rolls once for an 'idle' plane some minutes in. */
  AirmailState.watchGradebook = function (model) {
    if (!model || typeof model.on !== 'function') return;
    var watcher = new ColumnWatcher();
    var check = function (assignmentId, byEdit) {
      var id = String(assignmentId);
      if (model.everLoadedAssignments && !model.everLoadedAssignments.has(id)) return;
      var complete = AirmailState.columnComplete(model.recordsForAssignment(id), (model.studentOrder || []).length);
      if (watcher.observe(id, complete, byEdit)) AirmailState.trigger('columnDone');
    };
    model.on('cells', function (e) {
      ((e && e.assignmentIds) || []).forEach(function (id) { check(id, false); });
    });
    model.on('cell', function (e) {
      if (e && e.assignmentId) check(e.assignmentId, AirmailState.isGraded(e.record));
    });
    if (typeof location !== 'undefined' && /^#cgp-airmail\b/.test(location.hash || '')) {
      setTimeout(function () { AirmailState.trigger('summon'); }, 1500);
    } else {
      setTimeout(function () { AirmailState.trigger('idle'); }, 45000 + Math.floor(Math.random() * 240000));
    }
  };

  CGP.AirmailState = AirmailState;
})();
