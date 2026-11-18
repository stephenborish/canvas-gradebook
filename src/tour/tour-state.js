/* Canvas Gradebook+ - whether the welcome tour is due, and remembering that it
 * was seen.
 *
 * The tour is offered once per install of the extension: background.js writes
 * { pending: true } into chrome.storage.local when Chrome reports a fresh
 * install (never on an update, so teachers who already use the extension are
 * not interrupted), and the first gradebook page that shows it clears it again
 * - whether the teacher finished it or skipped it. chrome.storage.local, not
 * .sync: an install on a second computer is a new install, but Chrome sync
 * would otherwise carry "already seen" over from the first, or carry "pending"
 * to a computer that has long had the extension.
 *
 * The options page's "Replay tour" sets pending again.
 *
 * What a teacher sees first is a short introduction on their gradebook: one
 * feature shown on a real cell, then a choice - start grading, or a short
 * path: 'grade' (grade faster), 'copy' (copy to another class), or the
 * calendar setup on the options page. The record remembers the path, so a
 * reload carries on with the same one.
 *
 * Records written before the introduction existed have no `flow`. One left
 * part-way through then carries on through the whole tour it started
 * ('full', or 'classes' for part 2) rather than starting over. One already
 * finished or skipped stays that way: an update never touches the record.
 *
 * This file is the one definition of that record. background.js imports it
 * (it is safe to run as a module: it only adds CGP.TourState to globalThis),
 * the options page loads it with a script tag, and the content scripts run it
 * on every course page. There it also decides whether the tour is wanted at
 * all, and only then asks background.js to inject the tour itself
 * (tour-content.js, tour.js) into this tab: some 1,700 lines a teacher needs
 * once are not parsed on every page for the life of the install.
 *
 * No DOM and no chrome.* at load time, so tests load it as-is. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.TourState) return;

  var KEY = 'cgp.tour';

  function defaultStorage() {
    var local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    return local || null;
  }

  function TourState(storage) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  TourState.KEY = KEY;

  /* A fresh install's record. */
  TourState.FLOW = 2;

  TourState.installed = function (now) {
    return { pending: true, flow: TourState.FLOW, chapter: 'gradebook', path: null, stop: null, installedAt: now || Date.now() };
  };

  /* The message a course page sends to have the tour injected. */
  TourState.INJECT = 'cgp.tourInject';
  TourState.FILES = ['src/tour/tour-content.js', 'src/tour/tour.js'];

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

  /* Merges `patch` into the record. Storage failures are swallowed (the tour
   * is a nicety) unless opts.strict, for a caller that reports them. */
  TourState.prototype.write = function (patch, opts) {
    var s = this.storage;
    if (!s) return Promise.resolve(patch);
    var self = this;
    // One write at a time, each reading what the last one wrote: a "this
    // stop" save still in flight can never land after "finished" and bring
    // the tour back.
    var run = function () {
      return self.read().then(function (cur) {
        var next = opts && opts.replace ? Object.assign({}, patch) : Object.assign({}, cur, patch);
        var o = {};
        o[KEY] = next;
        return new Promise(function (resolve) { resolve(s.set(o)); }).then(function () { return next; });
      });
    };
    var done = (this._queue || Promise.resolve()).then(run);
    this._queue = done.catch(function () { /* the next write still runs */ });
    if (!(opts && opts.strict)) done = done.catch(function () { return patch; });
    return done.then(function (v) { self.last = v; return v; });
  };

  /* A fresh install (background.js): the whole record, not a merge. */
  TourState.prototype.markInstalled = function () {
    return this.write(TourState.installed(), { replace: true });
  };

  /* chrome.runtime.onInstalled (background.js). Only a fresh install makes
   * the tour due. An update leaves the record exactly as it was: finished
   * and skipped stay finished and skipped, a replay already asked for stays
   * asked for, and a tour part-way carries on (pathFor). */
  TourState.prototype.handleInstalled = function (reason) {
    if (reason === 'install') return this.markInstalled();
    return this.read();
  };

  /* Where the teacher is, so a reload or a trip to another course carries on
   * from there instead of starting over. */
  TourState.prototype.saveStop = function (stopId) {
    return this.write({ stop: stopId || null });
  };

  /* Due: never seen since this install (or asked for again). */
  TourState.prototype.isPending = function () {
    return this.read().then(function (v) { return v.pending === true; });
  };

  /* Finished or skipped: either way, not offered again on its own. `path`
   * records how it ended ('intro' for Start grading, 'schedule', ...). */
  TourState.prototype.markDone = function (how, stepId, path) {
    var patch = {
      pending: false,
      outcome: how === 'completed' ? 'completed' : 'skipped',
      lastStep: stepId || null,
      doneAt: Date.now()
    };
    if (path) patch.path = path;
    return this.write(patch);
  };

  /* "Replay tour" on the options page: the introduction again, from the top. */
  TourState.prototype.request = function () {
    return this.write({ pending: true, flow: TourState.FLOW, chapter: 'gradebook', path: null, stop: null, requestedAt: Date.now() }, { strict: true });
  };

  /* The teacher picked a path from the introduction (or "More tips"). */
  TourState.prototype.setPath = function (path) {
    return this.write({ path: path, stop: null });
  };

  /* The paths. Each is a list of stop ids in tour-content.js (CGP.tourPaths). */
  TourState.PATHS = ['intro', 'grade', 'more', 'full', 'copy', 'classes'];

  /* Which path to show for this record on this chapter's page. */
  TourState.pathFor = function (v, chapter) {
    v = v || {};
    var p = TourState.PATHS.indexOf(v.path) >= 0 ? v.path : null;
    if (chapter === 'classes') return p === 'copy' ? 'copy' : 'classes';
    if (p && p !== 'copy' && p !== 'classes') return p;
    // Left part-way by a version from before the introduction.
    if (v.flow !== TourState.FLOW && v.pending === true && v.stop) return 'full';
    return 'intro';
  };

  /* The tour has two chapters, on two pages: 'gradebook' (the grid and the
   * student overview) and 'classes' (the course home: linking classes,
   * Compare classes, the class schedule). Finishing the first records
   * chapter: 'classes', so the second is picked up wherever the teacher
   * goes next. */
  TourState.CHAPTERS = ['gradebook', 'classes'];

  TourState.prototype.setChapter = function (chapter, path) {
    var patch = { chapter: chapter, stop: null };
    if (path) patch.path = path;
    return this.write(patch);
  };

  /* The page asked for the tour in its address - #cgp-tour (the first
   * chapter) or #cgp-tour=classes - which is how the invitation on other
   * course pages and the end of the first chapter hand over. */
  TourState.chapterFromHash = function (hash) {
    var m = /(?:^#|&)cgp-tour(?:=([a-z]+))?(?:&|$)/.exec(String(hash || ''));
    if (!m) return null;
    return TourState.CHAPTERS.indexOf(m[1]) >= 0 ? m[1] : 'gradebook';
  };

  TourState.wantsTourFromHash = function (hash) {
    return TourState.chapterFromHash(hash) !== null;
  };

  /* Is the tour wanted on this page? The top frame of a course page (not
   * SpeedGrader) with the tour due, or #cgp-tour in the address. */
  TourState.wantedHere = function (loc, record) {
    var path = String(loc.pathname || '');
    if (!/\/courses\/\d+/.test(path) || /\/gradebook\/speed_grader/i.test(path)) return false;
    return (record && record.pending === true) || TourState.wantsTourFromHash(loc.hash);
  };

  CGP.TourState = TourState;

  // On a course page: ask for the tour only when it is wanted here.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.top === window &&
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage &&
      /\/courses\/\d+/.test(location.pathname)) {
    new TourState().read().then(function (v) {
      if (!TourState.wantedHere(location, v) || CGP.Tour) return;
      try { chrome.runtime.sendMessage({ type: TourState.INJECT }); } catch (e) { /* extension reloaded */ }
    });
  }
})();
