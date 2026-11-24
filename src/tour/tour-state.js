/* Canvas Gradebook+ - which tutorials a teacher has seen, and which to offer.
 *
 * The welcome tour is a set of short tutorials, one per part of the
 * extension (SECTIONS below). Each one is tracked on its own: finishing or
 * skipping one never hides the others. A teacher who closes "Grading basics"
 * part-way is still offered "Student overview" and "Copy between classes".
 *
 * A fresh install (background.js; never an update) writes a record with the
 * welcome card due and every tutorial new. The welcome card lists them all on
 * the first gradebook visit. After that each tutorial still new is offered
 * with a small card in the corner of the page it runs on, one at a time,
 * until the teacher watches it or presses Skip on it. Closing that card with
 * its X only hides it for the rest of this browser tab's visit.
 *
 * chrome.storage.local, not .sync: an install on a second computer is a new
 * install, but Chrome sync would carry "already seen" over from the first.
 *
 * The options page's Tutorials list can start any tutorial again.
 *
 * Older records (one tour with a single pending flag) are read through
 * normalize(): what the teacher had finished stays finished; everything else
 * is offered again, one tutorial at a time - the old tour hid every part as
 * soon as any card was closed. An install from before the tour existed (no
 * record) is never offered anything on its own.
 *
 * This file is the one definition of that record. background.js imports it
 * (it is safe to run as a module: it only adds CGP.TourState to globalThis),
 * the options page loads it with a script tag, and the content scripts run it
 * on every course page. There it also decides whether anything is wanted on
 * this page, and only then asks background.js to inject the tour itself
 * (tour-content.js, tour.js) into this tab.
 *
 * No DOM and no chrome.* at load time, so tests load it as-is. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.TourState) return;

  var KEY = 'cgp.tour';
  var SNOOZE_KEY = 'cgp.tour.snooze';

  /* The tutorials, in the order they are suggested. `page` is where one runs:
   * the gradebook, the course home page, the People page, or the options
   * page (on its tab of the same name as the tutorial). One that runs on the
   * options page is offered on the Canvas page named by `offerOn`. */
  var SECTIONS = [
    { id: 'grading', page: 'gradebook', title: 'Grading basics', blurb: 'Feedback bubbles, status keys, pasting grades', mins: 1 },
    { id: 'student', page: 'gradebook', title: 'Student overview', blurb: 'One student’s grades, missing work and parent emails', mins: 1 },
    { id: 'tools', page: 'gradebook', title: 'Gradebook tools', blurb: 'Total column, score stats, finding a student', mins: 1 },
    { id: 'snippets', page: 'options', offerOn: 'gradebook', title: 'Comment snippets', blurb: 'Reuse comments you type often', mins: 1 },
    { id: 'classes', page: 'home', title: 'Copy between classes', blurb: 'Copy work to your other sections', mins: 1 },
    { id: 'groups', page: 'people', title: 'Make groups', blurb: 'Build a group set in one step', mins: 1 },
    { id: 'schedule', page: 'options', offerOn: 'home', title: 'Class schedule', blurb: 'Pick due times from your class periods', mins: 2 }
  ];
  var IDS = SECTIONS.map(function (s) { return s.id; });

  function defaultStorage() {
    var local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    return local || null;
  }

  function TourState(storage) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  TourState.KEY = KEY;
  TourState.SNOOZE_KEY = SNOOZE_KEY;
  TourState.SECTIONS = SECTIONS;
  TourState.FLOW = 3;

  TourState.section = function (id) {
    return SECTIONS.filter(function (s) { return s.id === id; })[0] || null;
  };

  /* A fresh install's record. */
  TourState.installed = function (now) {
    return { flow: TourState.FLOW, welcome: 'due', sections: {}, active: null, requested: null, installedAt: now || Date.now() };
  };

  /* The message a course page sends to have the tour injected. */
  TourState.INJECT = 'cgp.tourInject';
  TourState.FILES = ['src/tour/tour-content.js', 'src/tour/tour.js'];

  /* ------------------------------------------------------------ the record */

  // Where each stop of the old single tour now lives: a tour left part-way
  // before this version carries on in the tutorial that holds its stop.
  var OLD_STOPS = {
    comments: 'grading', submissions: 'grading', statuses: 'grading', spreadsheet: 'grading', post: 'grading',
    student: 'student', 'si-overview': 'student', 'si-standout': 'student', 'si-work': 'student', 'si-activity': 'student',
    total: 'tools', menus: 'tools', switcher: 'tools', find: 'tools', gear: 'tools',
    'classes-link': 'classes', 'classes-copy': 'classes', 'classes-compare': 'classes',
    schedule: 'schedule', 'schedule-connect': 'schedule'
  };
  // Which tutorials an old, finished path had shown in full.
  var OLD_PATHS = {
    grade: ['grading'], more: ['student', 'tools'], full: ['grading', 'student', 'tools'],
    copy: ['classes'], classes: ['classes', 'schedule']
  };

  /* The record as this version reads it, whatever version wrote it. Pure:
   * nothing is written back until the teacher does something. */
  TourState.normalize = function (raw) {
    var v = raw && typeof raw === 'object' ? raw : {};
    if (v.flow === TourState.FLOW) {
      return {
        flow: TourState.FLOW,
        welcome: v.welcome === 'due' ? 'due' : 'seen',
        sections: v.sections && typeof v.sections === 'object' ? v.sections : {},
        active: v.active && TourState.section(v.active.section) ? v.active : null,
        requested: TourState.section(v.requested) ? v.requested : null,
        installedAt: v.installedAt
      };
    }
    var out = { flow: TourState.FLOW, welcome: 'seen', sections: {}, active: null, requested: null, installedAt: v.installedAt };
    // No record at all: installed before the tour existed. Nothing is offered
    // on its own; the options page's Tutorials list still has every one.
    if (!Object.keys(v).length) {
      IDS.forEach(function (id) { out.sections[id] = 'skipped'; });
      return out;
    }
    // The old tour's record. Whatever it shows was finished stays finished.
    var done = [];
    if (v.outcome === 'completed' && OLD_PATHS[v.path]) done = OLD_PATHS[v.path];
    else if (v.outcome === 'completed' && !v.path && v.chapter === 'classes') done = ['grading', 'student', 'tools', 'classes', 'schedule'];
    done.forEach(function (id) { out.sections[id] = 'done'; });
    if (v.pending === true) {
      var sec = OLD_STOPS[v.stop];
      if (sec) out.active = { section: sec, stop: v.stop };
      else if (!v.stop && !(v.chapter === 'classes')) out.welcome = 'due';
      else if (v.chapter === 'classes') out.requested = 'classes';
    }
    return out;
  };

  TourState.statusOf = function (v, id) {
    var s = v && v.sections && v.sections[id];
    return s === 'done' || s === 'skipped' ? s : 'new';
  };

  TourState.prototype.read = function () {
    var s = this.storage;
    if (!s) return Promise.resolve({});
    // An extension reloaded under an open tab throws here synchronously.
    var got;
    try { got = s.get(KEY); } catch (e) { return Promise.resolve({}); }
    return Promise.resolve(got).then(function (got) {
      var v = got && got[KEY];
      return v && typeof v === 'object' ? v : {};
    }, function () { return {}; });
  };

  /* The record, normalized. */
  TourState.prototype.load = function () {
    return this.read().then(TourState.normalize);
  };

  /* Applies `fn` to the normalized record and stores the result. Storage
   * failures are swallowed (the tour is a nicety) unless opts.strict, for a
   * caller that reports them. */
  TourState.prototype.update = function (fn, opts) {
    var s = this.storage;
    var self = this;
    // One write at a time, each reading what the last one wrote: a "this
    // stop" save still in flight can never land after "finished" and bring
    // the tutorial back.
    var run = function () {
      return self.read().then(function (cur) {
        var v = TourState.normalize(cur);
        v.sections = Object.assign({}, v.sections);
        var next = fn(v) || v;
        if (!s) return next;
        var o = {};
        o[KEY] = next;
        return new Promise(function (resolve) { resolve(s.set(o)); }).then(function () { return next; });
      });
    };
    var done = (this._queue || Promise.resolve()).then(run);
    this._queue = done.catch(function () { /* the next write still runs */ });
    if (!(opts && opts.strict)) done = done.catch(function () { return null; });
    return done.then(function (v) { self.last = v; return v; });
  };

  /* A fresh install (background.js): the whole record, not a merge. */
  TourState.prototype.markInstalled = function () {
    var s = this.storage;
    if (!s) return Promise.resolve(null);
    var o = {};
    o[KEY] = TourState.installed();
    return Promise.resolve().then(function () { return s.set(o); }).then(function () { return o[KEY]; }, function () { return null; });
  };

  /* chrome.runtime.onInstalled (background.js). Only a fresh install makes
   * anything due. An update leaves the record exactly as it was. */
  TourState.prototype.handleInstalled = function (reason) {
    if (reason === 'install') return this.markInstalled();
    return this.read();
  };

  /* The welcome card was shown and closed (or a tutorial was picked from it). */
  TourState.prototype.welcomeSeen = function () {
    return this.update(function (v) { v.welcome = 'seen'; });
  };

  /* A tutorial started (from the welcome card, its offer, or the options page). */
  TourState.prototype.begin = function (id, stop) {
    return this.update(function (v) {
      v.active = { section: id, stop: stop || null };
      if (v.requested === id) v.requested = null;
    });
  };

  /* Where the teacher is, so a reload carries on from there. */
  TourState.prototype.saveStop = function (stop) {
    return this.update(function (v) { if (v.active) v.active = { section: v.active.section, stop: stop || null }; });
  };

  /* Finished ('done') or skipped: that tutorial only. */
  TourState.prototype.finish = function (id, how) {
    return this.update(function (v) {
      v.sections[id] = how === 'done' ? 'done' : 'skipped';
      if (v.active && v.active.section === id) v.active = null;
      if (v.requested === id) v.requested = null;
    });
  };

  /* The options page: one tutorial again (`id`), or all of them. Strict, so
   * the page can say when it failed. */
  TourState.prototype.request = function (id) {
    return this.update(function (v) {
      if (id) {
        v.sections[id] = 'new';
        v.requested = id;
        if (v.active && v.active.section !== id) v.active = null;
      } else {
        v.sections = {};
        v.welcome = 'due';
        v.active = null;
        v.requested = null;
      }
    }, { strict: true });
  };

  /* ----------------------------------------------------- what to show here */

  /* Which kind of course page this is: 'gradebook', 'home', 'people' (People
   * or Groups, where Make groups lives) or 'other'. */
  TourState.pageKind = function (pathname) {
    var p = String(pathname || '');
    if (/\/courses\/\d+\/gradebook\/?$/i.test(p)) return 'gradebook';
    if (/^\/courses\/\d+\/?$/.test(p)) return 'home';
    if (/^\/courses\/\d+\/(users|groups)\/?$/.test(p)) return 'people';
    return 'other';
  };

  /* #cgp-tour (the welcome card) or #cgp-tour=<tutorial>: how an offer on
   * one page hands over to the page its tutorial runs on. */
  TourState.sectionFromHash = function (hash) {
    var m = /(?:^#|&)cgp-tour(?:=([a-z]+))?(?:&|$)/.exec(String(hash || ''));
    if (!m) return null;
    if (m[1] && IDS.indexOf(m[1]) >= 0) return m[1];
    return 'welcome';
  };

  TourState.wantsTourFromHash = function (hash) {
    return TourState.sectionFromHash(hash) !== null;
  };

  function runsOn(sec, page) {
    // A tutorial on the options page is offered on the Canvas page it is
    // about (snippets on the gradebook, the class schedule on the course home).
    return sec.page === page || (sec.page === 'options' && sec.offerOn === page);
  }

  /* What this page shows, if anything:
   *   { kind: 'welcome' }                       the welcome card (gradebook)
   *   { kind: 'tour', section, stop }           a tutorial, running here
   *   { kind: 'offer', section, resume }        a small card offering one
   *   null                                      nothing
   * `forced`: from the address (sectionFromHash). `snoozed`: tutorials whose
   * offer the teacher closed in this tab. Pure, so it is tested directly. */
  TourState.decide = function (v, page, forced, snoozed) {
    v = TourState.normalize(v);
    snoozed = snoozed || [];
    var asleep = function (id) { return snoozed.indexOf(id) >= 0; };
    var here = function (id) { var s = TourState.section(id); return s && s.page === page; };

    if (forced === 'welcome' && page === 'gradebook') return { kind: 'welcome' };
    if (forced && forced !== 'welcome' && here(forced)) {
      return { kind: 'tour', section: forced, stop: v.active && v.active.section === forced ? v.active.stop : null };
    }
    if (v.requested) {
      if (here(v.requested)) return { kind: 'tour', section: v.requested, stop: null };
      if (!asleep(v.requested) && page !== 'other') return { kind: 'offer', section: v.requested };
    }
    if (v.active) {
      if (here(v.active.section)) return { kind: 'tour', section: v.active.section, stop: v.active.stop };
      if (!asleep(v.active.section)) return { kind: 'offer', section: v.active.section, resume: true };
    }
    if (v.welcome === 'due') {
      if (page === 'gradebook') return { kind: 'welcome' };
      if (!asleep('welcome')) return { kind: 'offer', section: 'welcome' };
      return null;
    }
    for (var i = 0; i < SECTIONS.length; i++) {
      var sec = SECTIONS[i];
      if (TourState.statusOf(v, sec.id) !== 'new' || asleep(sec.id) || !runsOn(sec, page)) continue;
      return { kind: 'offer', section: sec.id };
    }
    return null;
  };

  /* The next tutorial still new after `id`, for "Next: ..." at the end of one. */
  TourState.nextNew = function (v, id) {
    v = TourState.normalize(v);
    var from = IDS.indexOf(id);
    for (var k = 1; k <= IDS.length; k++) {
      var cand = IDS[(from + k) % IDS.length];
      if (cand !== id && TourState.statusOf(v, cand) === 'new') return cand;
    }
    return null;
  };

  /* Tutorials whose offer was closed in this tab (sessionStorage). */
  TourState.snoozed = function () {
    try { return JSON.parse(sessionStorage.getItem(SNOOZE_KEY) || '[]') || []; } catch (e) { return []; }
  };
  TourState.snooze = function (id) {
    try {
      var list = TourState.snoozed();
      if (list.indexOf(id) < 0) list.push(id);
      sessionStorage.setItem(SNOOZE_KEY, JSON.stringify(list));
    } catch (e) { /* private mode: it just comes back next page */ }
  };

  /* Is anything wanted on this page? The top frame of a course page (not
   * SpeedGrader) with something to show, or #cgp-tour in the address. */
  TourState.wantedHere = function (loc, record, snoozed) {
    var path = String(loc.pathname || '');
    if (!/\/courses\/\d+/.test(path) || /\/gradebook\/speed_grader/i.test(path)) return false;
    if (TourState.wantsTourFromHash(loc.hash)) return true;
    return !!TourState.decide(record, TourState.pageKind(path), null, snoozed);
  };

  CGP.TourState = TourState;

  // On a course page: ask for the tour only when it is wanted here.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.top === window &&
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage &&
      /\/courses\/\d+/.test(location.pathname)) {
    new TourState().read().then(function (v) {
      if (!TourState.wantedHere(location, v, TourState.snoozed()) || CGP.Tour) return;
      try { chrome.runtime.sendMessage({ type: TourState.INJECT }); } catch (e) { /* extension reloaded */ }
    });
  }
})();
