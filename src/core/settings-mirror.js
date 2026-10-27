/* Canvas Gradebook+ - the copy of the settings kept in the teacher's own
 * Canvas account.
 *
 * Settings and snippets are saved to chrome.storage.sync, which Chrome
 * carries to every computer signed in to the same Google account - but only
 * with Chrome sync on, and with Extensions among what it syncs. A school can
 * turn Chrome sync off for its accounts, and then nothing reaches the
 * teacher's other computers. So every Canvas page also merges the settings
 * with a copy in the teacher's Canvas user data (Canvas's custom_data API,
 * private to that user): any computer where the teacher opens Canvas ends
 * up with the same settings, Chrome sync or not.
 *
 * The merge is item by item, exactly the items chrome.storage.sync holds
 * (one per setting, one per snippet - see CGP.settingsStorage), and the
 * newer change wins for each: so a snippet added on one computer and a
 * setting changed on another both survive. "When" is the time each item
 * last changed on a computer (settings-times.js keeps it, in the service
 * worker), or 0 for an item stored before this existed - which any real
 * change beats, and which on a tie gives way to the copy in Canvas, so two
 * computers that never synced end up the same. A removed snippet is kept
 * in Canvas as removed, with its time, so it does not come back. Canvas
 * layout: custom_data "settings/<sync key>" = {at, v} or {at, del: true}. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.settingsMirror) return;

  var TIME_PREFIX = 'cgp.st.';
  var STATUS_KEY = 'cgp.mirror.status';
  var MIN_GAP_MS = 60 * 1000;
  var ITEM_BYTES = 8000;          // chrome.storage.sync per-item limit, with room
  var TOTAL_BYTES = 100000;       // and the whole of it

  /** Same hash as settings-times.js valueHash. */
  function valueHash(v) {
    var s = v === undefined ? 'u' : JSON.stringify(v);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  function isMirrored(k) {
    k = String(k);
    return k === 'cgp.snippetStore' || k.indexOf('cgp.setting.') === 0 || k.indexOf('cgp.snippet.') === 0;
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* What to change where. local: every chrome.storage.sync item; times:
   * {key: {at, h, del}} in this computer's clock; remote: the Canvas copy
   * ({key: {at, v|del}}, in Canvas's clock), or null when there is none
   * yet; offset: ms from this computer's clock to Canvas's. Returns
   *   {set: {key: value}, remove: [key], times: {key: rec},   (this computer)
   *    push: {key: {at, v|del}}}                             (Canvas)
   * Pure; unit tested. */
  function plan(local, times, remote, offset) {
    offset = Number(offset) || 0;
    local = local || {};
    times = times || {};
    remote = remote && typeof remote === 'object' ? remote : {};
    var out = { set: {}, remove: [], times: {}, push: {} };
    var keys = {};
    Object.keys(local).forEach(function (k) { if (isMirrored(k)) keys[k] = 1; });
    Object.keys(times).forEach(function (k) { if (isMirrored(k)) keys[k] = 1; });
    Object.keys(remote).forEach(function (k) { if (isMirrored(k)) keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var has = Object.prototype.hasOwnProperty.call(local, k);
      var t = times[k];
      // Times recorded here are moved to Canvas's clock; 0 (stored before
      // times were kept) and -1 (never here) mean what they say in any clock.
      var lat = t ? (Number(t.at) > 0 ? Number(t.at) + offset : 0) : (has ? 0 : -1);
      var ldel = !has && !!(t && t.del);
      if (!has && !ldel) lat = -1;          // never here, never removed here
      var r = remote[k];
      var rat = r && isFinite(Number(r.at)) ? Number(r.at) : -1;
      if (rat > lat || (rat === lat && rat >= 0 && !(r.del ? !has : (has && same(local[k], r.v))))) {
        // Canvas has the newer change (or, on a tie, the one everyone agrees on).
        if (r.del) {
          if (has) out.remove.push(k);
          out.times[k] = { at: rat > 0 ? rat - offset : rat, h: 'deleted', del: true };
        } else {
          if (!has || !same(local[k], r.v)) out.set[k] = r.v;
          out.times[k] = { at: rat > 0 ? rat - offset : rat, h: valueHash(r.v) };
        }
      } else if (lat > rat) {
        out.push[k] = ldel ? { at: lat, del: true } : { at: lat, v: local[k] };
      }
    });
    return out;
  }

  /* The changes from Canvas that may be applied: only settings items, each
   * small enough for one chrome.storage.sync item, all of them together
   * within its quota. Anything else is left out, and said so. */
  function fit(local, p) {
    var problems = [];
    var size = function (k, v) { return CGP.util.byteLength(k + JSON.stringify(v)); };
    Object.keys(p.set).forEach(function (k) {
      if (size(k, p.set[k]) > ITEM_BYTES) { problems.push(k); delete p.set[k]; delete p.times[k]; }
    });
    var after = Object.assign({}, local, p.set);
    p.remove.forEach(function (k) { delete after[k]; });
    var total = Object.keys(after).reduce(function (n, k) { return n + size(k, after[k]); }, 0);
    if (total > TOTAL_BYTES) {
      problems.push('total');
      p.set = {};
      p.remove = [];
      Object.keys(p.times).forEach(function (k) { delete p.times[k]; });
    }
    return problems;
  }

  /* One merge: read both sides, apply Canvas's newer items here, send this
   * computer's newer items to Canvas. Resolves a status object (also kept
   * in chrome.storage.local for the options page); never rejects. */
  function SettingsMirror(opts) {
    this.api = opts.api;
    this.origin = opts.origin || (typeof location !== 'undefined' ? location.origin : '');
    this.chrome = opts.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    this.now = opts.now || function () { return Date.now(); };
    this.running = null;
  }

  SettingsMirror.prototype.run = function (force) {
    var self = this;
    if (this.running) return this.running;
    var c = this.chrome;
    if (!c || !c.storage || !c.storage.sync || !c.storage.local || !this.api || !this.api.customDataTimed) {
      return Promise.resolve({ ok: false, skipped: 'no storage' });
    }
    var statusKey = STATUS_KEY + '.' + this.origin;
    this.running = c.storage.local.get(statusKey).then(function (r) {
      var last = r && r[statusKey];
      if (!force && last && last.ok && self.now() - Number(last.at || 0) < MIN_GAP_MS) return { ok: true, skipped: 'recent' };
      return Promise.all([
        c.storage.sync.get(null),
        c.storage.local.get(null),
        self.api.customDataTimed('settings')
      ]).then(function (got) {
        var local = got[0] || {};
        var times = {};
        Object.keys(got[1] || {}).forEach(function (k) {
          if (k.indexOf(TIME_PREFIX) === 0) times[k.slice(TIME_PREFIX.length)] = got[1][k];
        });
        var remote = got[2].data && typeof got[2].data === 'object' ? got[2].data : null;
        var p = plan(local, times, remote, got[2].offset);
        var problems = fit(local, p);
        var status = { at: self.now(), ok: true, pulled: Object.keys(p.set).length + p.remove.length, pushed: Object.keys(p.push).length,
          problems: problems.length ? problems : null, hadCopy: !!remote };
        // Times first: the change that follows must read as already known
        // (settings-times.js compares hashes), not as a new change here.
        var t = {};
        Object.keys(p.times).forEach(function (k) { t[TIME_PREFIX + k] = p.times[k]; });
        var apply = Promise.resolve()
          .then(function () { return Object.keys(t).length ? c.storage.local.set(t) : null; })
          .then(function () { return Object.keys(p.set).length ? c.storage.sync.set(p.set) : null; })
          .then(function () { return p.remove.length ? c.storage.sync.remove(p.remove) : null; });
        return apply.then(function () {
          var keys = Object.keys(p.push);
          if (!keys.length) return null;
          // A first copy goes up in one request; after that, one item at a
          // time, so two computers writing different items never collide.
          if (!remote) return self.api.setCustomData('settings', p.push);
          return keys.reduce(function (chain, k) {
            return chain.then(function () { return self.api.setCustomData('settings/' + encodeURIComponent(k), p.push[k]); });
          }, Promise.resolve());
        }).then(function () { return status; });
      });
    }).then(null, function (err) {
      return { at: self.now(), ok: false, error: CGP.util.describeApiError(err, { fallback: 'Canvas did not answer' }) };
    }).then(function (status) {
      self.running = null;
      if (status && !status.skipped) {
        var o = {};
        o[statusKey] = status;
        c.storage.local.set(o).catch(function () { return null; });
        if (status.ok && (status.pulled || status.pushed)) CGP.diag.log('settingsMirror', { pulled: status.pulled, pushed: status.pushed });
      }
      return status;
    });
    return this.running;
  };

  CGP.settingsMirror = { plan: plan, fit: fit, valueHash: valueHash, isMirrored: isMirrored, STATUS_KEY: STATUS_KEY, TIME_PREFIX: TIME_PREFIX };
  CGP.SettingsMirror = SettingsMirror;
})();
