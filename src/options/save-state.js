/* Canvas Gradebook+ - what the options page's Save button may claim.
 *
 * The page shows "Saved" only for what storage has accepted. Three rules:
 *
 *  - One save at a time. A second click while one is running joins it
 *    instead of starting another, and every other write from this page
 *    (Connect calendar, Restore defaults, Unlink) waits its turn, so two
 *    read-then-write cycles never interleave.
 *  - Edits made while a save is running are kept. When the save finishes,
 *    any field the teacher changed after clicking Save stays as typed and
 *    still counts as unsaved. Every other field takes the stored value.
 *  - The reload notice appears only when a changed setting needs one. Most
 *    settings reach an open Canvas tab right away (CGP.settings.onChange, or
 *    read each time they are used). The settings below are read once, when a
 *    Canvas page loads.
 *
 * The cross-device merge is unchanged: a save still writes only the
 * difference between the baseline (what the form started from) and the form,
 * on top of whatever is stored now (CGP.settingsStorage.write).
 *
 * No DOM and no chrome.* here, so the tests load it as-is. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.optionsSave) return;

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* When a change needs a reload of open Canvas tabs:
   *   always - the page reads it once at load (or never undoes it live);
   *   on     - only when switched on (switching off is harmless live);
   *   synced - Canvas View Options, which matter only while
   *            syncViewOptionsToCanvas is on, applied once per page load.
   * src/gradebook/content.js and layout.js are the readers. */
  var RELOAD = {
    hideCanvasUtilityControls: 'always',   // the re-hide observer is set up at load; off never unhides live
    courseSwitcher: 'always',              // the gradebook never restarts it, and off never removes it
    studentSearch: 'always',               // likewise
    prefetchAllAssignments: 'on',          // scheduled once, after the first screenful loads
    syncViewOptionsToCanvas: 'on',         // applied once per page load
    gbShowNotes: 'synced',
    gbShowUnpublishedAssignments: 'synced',
    gbSplitStudentNames: 'synced',
    gbHideAssignmentGroupTotals: 'synced',
    gbHideTotalColumn: 'synced',
    gbViewHiddenGradesIndicator: 'synced',
    gbEnableStatusIcons: 'synced'
  };

  function keysOf(a, b) {
    var seen = {};
    Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (k) { seen[k] = true; });
    return Object.keys(seen);
  }

  /* The settings that differ between two settings objects. */
  function changedKeys(before, after) {
    return keysOf(before, after).filter(function (k) { return !same((before || {})[k], (after || {})[k]); });
  }

  /* The changed settings that an open Canvas tab picks up only on reload. */
  function reloadKeys(before, after) {
    after = after || {};
    return changedKeys(before, after).filter(function (k) {
      var rule = RELOAD[k];
      if (rule === 'always') return true;
      if (rule === 'on') return !!after[k];
      if (rule === 'synced') return !!after.syncViewOptionsToCanvas;
      return false;
    });
  }

  /* After a save resolves.
   *   submitted: what the form held when Save was clicked (and was written)
   *   current:   what the form holds now
   *   stored:    what storage holds now
   * edited:   fields changed after the click. They stay as typed, unsaved.
   * stale:    fields not edited whose stored value differs from the form
   *           (another computer saved them meanwhile). The form keeps
   *           showing its value, and the next save leaves storage alone for
   *           these fields.
   * baseline: what the next save compares the form against. An edited
   *           field is compared with storage, so the edit is written. Any
   *           other field is compared with the form, so nothing is written
   *           for it. */
  function settle(submitted, current, stored) {
    var edited = changedKeys(submitted, current);
    var baseline = {};
    var stale = [];
    keysOf(submitted, stored).forEach(function (k) {
      if (edited.indexOf(k) >= 0) { baseline[k] = stored[k]; return; }
      baseline[k] = submitted[k];
      if (!same(stored[k], submitted[k])) stale.push(k);
    });
    return { edited: edited, stale: stale, baseline: baseline };
  }

  /* One save at a time, and every write in order.
   *   read():            the form's values now
   *   write(base, next): resolves with what is stored afterwards */
  function Saver(o) {
    this.read = o.read;
    this.write = o.write;
    this.baseline = null;
    this.inflight = null;   // the Save click being processed
    this._tail = Promise.resolve();
    this._pending = 0;
  }

  /* Runs fn after every write queued before it. */
  Saver.prototype.enqueue = function (fn) {
    var self = this;
    this._pending++;
    var run = this._tail.then(function () { return fn(); });
    var settled = function () { self._pending--; };
    this._tail = run.then(settled, settled);
    return run;
  };

  /* Any write from this page still running or waiting. */
  Saver.prototype.busy = function () { return this._pending > 0; };

  Saver.prototype.dirty = function () {
    return !!this.baseline && !same(this.read(), this.baseline);
  };

  Saver.prototype.changed = function () {
    return this.baseline ? changedKeys(this.baseline, this.read()) : [];
  };

  /* Save: the form as it is now, against the baseline. While one is running,
   * another click gets the same promise and starts nothing. Resolves with
   * { stored, submitted, edited, stale, reload }. Rejects (nothing saved,
   * baseline unchanged) when the write is refused. */
  Saver.prototype.save = function () {
    if (this.inflight) return this.inflight;
    var self = this;
    var base = this.baseline;
    var submitted = this.read();
    var done = this.enqueue(function () { return self.write(base, submitted); }).then(function (stored) {
      self.inflight = null;
      var s = settle(submitted, self.read(), stored);
      self.baseline = s.baseline;
      return {
        stored: stored, submitted: submitted, edited: s.edited, stale: s.stale,
        reload: reloadKeys(base, submitted)
      };
    }, function (err) {
      self.inflight = null;
      throw err;
    });
    this.inflight = done;
    return done;
  };

  CGP.optionsSave = {
    RELOAD: RELOAD,
    changedKeys: changedKeys,
    reloadKeys: reloadKeys,
    settle: settle,
    Saver: Saver
  };
})();
