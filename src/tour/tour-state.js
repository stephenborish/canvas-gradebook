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
 * The options page's "Replay the tour" sets pending again.
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
  TourState.installed = function (now) {
    return { pending: true, installedAt: now || Date.now() };
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

  TourState.prototype.write = function (patch) {
    var s = this.storage;
    if (!s) return Promise.resolve(patch);
    var self = this;
    return this.read().then(function (cur) {
      var next = Object.assign({}, cur, patch);
      var o = {};
      o[KEY] = next;
      return new Promise(function (resolve) { resolve(s.set(o)); }).then(function () { return next; });
    }).catch(function () { return patch; }).then(function (v) { self.last = v; return v; });
  };

  /* Due: never seen since this install (or asked for again). */
  TourState.prototype.isPending = function () {
    return this.read().then(function (v) { return v.pending === true; });
  };

  /* Finished or skipped: either way, not offered again on its own. */
  TourState.prototype.markDone = function (how, stepId) {
    return this.write({
      pending: false,
      outcome: how === 'completed' ? 'completed' : 'skipped',
      lastStep: stepId || null,
      doneAt: Date.now()
    });
  };

  /* "Replay the tour" on the options page. */
  TourState.prototype.request = function () {
    return this.write({ pending: true, chapter: 'gradebook', requestedAt: Date.now() });
  };

  /* The tour has two chapters, on two pages: 'gradebook' (the grid and the
   * student overview) and 'classes' (the course home: linking classes,
   * Compare classes, the class schedule). Finishing the first records
   * chapter: 'classes', so the second is picked up wherever the teacher
   * goes next. */
  TourState.CHAPTERS = ['gradebook', 'classes'];

  TourState.prototype.setChapter = function (chapter) {
    return this.write({ chapter: chapter });
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

  CGP.TourState = TourState;
})();
