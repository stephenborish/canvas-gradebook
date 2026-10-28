/* Canvas Gradebook+ - the copy of the settings kept in the teacher's own
 * Canvas account.
 *
 * Settings and snippets are saved to chrome.storage.sync, which Chrome
 * carries to every computer signed in to the same Google account - but only
 * with Chrome sync on, and with Extensions among what it syncs. A school can
 * turn Chrome sync off for its accounts, and then nothing reaches the
 * teacher's other computers. So every Canvas page also merges the settings
 * with a copy in the teacher's Canvas user data (Canvas's custom_data API):
 * any computer where the teacher opens Canvas ends up with the same
 * settings, Chrome sync or not.
 *
 * The merge is item by item - exactly the items chrome.storage.sync holds,
 * one per setting and one per snippet (CGP.settingsStorage) - and for each,
 * the newer change wins. Every item's time is stored beside it in
 * chrome.storage.sync ('cgp.t.*', CGP.settingsTimes), written in the same
 * write as the item, on Canvas's clock: so the time travels with the change
 * whichever way it goes, and computers whose clocks disagree compare
 * fairly. Rules:
 *  - An item stored before times were kept, a default, or one moved out of
 *    the old single 'cgp.settings' item has time 0: any real change wins.
 *  - Two computers that both have a different value at time 0 (upgraded,
 *    never synced) are not decided here: the options page asks the teacher.
 *  - A value that changed without its time (written by an older version of
 *    the extension, say) waits two minutes - Chrome sync may still be
 *    delivering its time - and then counts as a change made when it was
 *    first seen.
 *  - A removed snippet keeps its time (a tombstone), so it is not brought
 *    back by a computer that still has it.
 *  - A merge never leaves more snippets than Chrome sync can hold: what
 *    does not fit is left in Canvas and reported, not dropped silently.
 * Canvas layout: custom_data "settings/<item key, dots as ~>" = {at, v} or
 * {at, del: true}. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.settingsMirror) return;

  var STATUS_KEY = 'cgp.mirror.status';
  var PENDING_KEY = 'cgp.mirror.pending';
  var OFFSET_KEY = 'cgp.clockOffset';
  var MIN_GAP_MS = 60 * 1000;
  var UNTIMED_WAIT_MS = 2 * 60 * 1000;
  var ITEM_BYTES = 8000;
  var TOTAL_BYTES = 100000;

  function T() { return CGP.settingsTimes; }
  function hash(v) { return CGP.util.valueHash(v); }
  function same(a, b) { return CGP.util.stableStringify(a) === CGP.util.stableStringify(b); }

  function isMirrored(k) {
    k = String(k);
    return k === 'cgp.snippetStore' || k === 'cgp.snippetOrder' || k.indexOf('cgp.setting.') === 0 || k.indexOf('cgp.snippet.') === 0;
  }
  function isSnippet(k) { return String(k).indexOf('cgp.snippet.') === 0; }

  // A dot ends a Canvas API path's format (".json"), so none go in a scope.
  function remoteKey(k) { return String(k).replace(/\./g, '~'); }
  function itemKey(rk) { return String(rk).replace(/~/g, '.'); }

  /* What to change where.
   *   all:     everything in chrome.storage.sync (items and their times)
   *   remote:  the Canvas copy, keys as stored there, or null
   *   pending: {key: {h, at}} untimed changes seen on earlier runs
   *   now:     Canvas's clock now; offset: this computer's clock to Canvas's
   * Returns {set, remove, times: {key: rec}, push: {key: rec}, pending,
   * conflicts: [key], waiting: [key]}. Pure; unit tested. */
  var DEFAULT_AT = -0.5;   // a built-in default: below any real change, even 0

  function looseSame(k, a, b) {
    // A snippet's place is the order item's business, not the snippet's.
    if (isSnippet(k) && a && b && typeof a === 'object' && typeof b === 'object') {
      return same({ trigger: a.trigger, text: a.text }, { trigger: b.trigger, text: b.text });
    }
    return same(a, b);
  }

  var FOREIGN_CLOCK_WAIT_MS = 7 * 86400000;

  function plan(all, remote, pending, now, offset, deviceId) {
    all = all || {};
    pending = pending || {};
    offset = Number(offset) || 0;
    var rem = {};
    Object.keys(remote && typeof remote === 'object' ? remote : {}).forEach(function (rk) {
      var k = itemKey(rk);
      var r = remote[rk];
      if (isMirrored(k) && r && typeof r === 'object' && isFinite(Number(r.at))) rem[k] = r;
    });
    var times = T().readAll(all);
    var out = { set: {}, remove: [], times: {}, push: {}, pending: {}, conflicts: [], waiting: [] };
    var keys = {};
    Object.keys(all).forEach(function (k) { if (isMirrored(k)) keys[k] = 1; });
    Object.keys(times).forEach(function (k) { if (isMirrored(k)) keys[k] = 1; });
    Object.keys(rem).forEach(function (k) { keys[k] = 1; });

    function waitOrTake(k, h) {
      // Changed (or removed) without its time. Chrome sync may still be
      // delivering the time: wait; past that, the change is timed from when
      // it was first seen here - and that time is written, once.
      var p = pending[k];
      if (p && p.h === h && now - p.at >= UNTIMED_WAIT_MS) return p.at;
      out.pending[k] = p && p.h === h ? p : { h: h, at: now };
      out.waiting.push(k);
      return null;
    }

    Object.keys(keys).forEach(function (k) {
      var has = Object.prototype.hasOwnProperty.call(all, k);
      var t = times[k] || null;
      var r = rem[k] || null;
      var lat, ldel = false;
      // A time taken by a computer's own clock before it knew how far off
      // that is: only that computer can put it on Canvas's clock. Another
      // computer leaves the item alone meanwhile - for a week at most, then
      // takes the time as it is.
      if (t && t.u) {
        var mine = t.u === true || (deviceId && t.u === deviceId);
        if (mine) {
          t = Object.assign({}, t, { a: Math.max(0, t.a + offset), u: false });
          out.times[k] = t;
        } else if (now - t.a < FOREIGN_CLOCK_WAIT_MS) {
          out.waiting.push(k);
          return;
        } else {
          t = Object.assign({}, t, { u: false });
          out.times[k] = t;
        }
      }
      if (has) {
        var h = hash(all[k]);
        if (!t) lat = 0;                                   // stored before times were kept
        else if (!t.d && t.h === h) lat = t.def ? DEFAULT_AT : t.a;
        else {
          var at = waitOrTake(k, h);
          if (at === null) { delete out.times[k]; return; }
          lat = at;
          out.times[k] = { a: at, h: h };
        }
      } else if (t && t.d) {
        lat = t.a;
        ldel = true;
      } else if (t) {
        var at2 = waitOrTake(k, 'deleted');                // removed without a tombstone
        if (at2 === null) { delete out.times[k]; return; }
        lat = at2;
        ldel = true;
        out.times[k] = { a: at2, d: true };
      } else {
        lat = -1;                                          // never here
      }

      var rat = r ? (r.def ? DEFAULT_AT : Number(r.at)) : -1;
      var agree = r && (r.del ? !has : (has && looseSame(k, all[k], r.v)));
      if (r && agree) return;
      if (r && lat === 0 && rat === 0 && has && !r.del) {
        out.conflicts.push(k);                             // the teacher decides
        return;
      }
      if (r && rat >= lat) {
        if (r.del) {
          if (has) out.remove.push(k);
          out.times[k] = { a: Number(r.at), d: true };
        } else {
          out.set[k] = r.v;
          out.times[k] = r.def ? { a: 0, h: hash(r.v), def: true } : { a: Number(r.at), h: hash(r.v) };
        }
      } else if (lat > rat) {
        if (ldel) out.push[k] = { at: lat, del: true };
        else if (lat === DEFAULT_AT) out.push[k] = { at: 0, v: all[k], def: true };
        else out.push[k] = { at: lat, v: all[k] };
      }
    });
    return out;
  }

  function bytes(k, v) { return CGP.util.byteLength(k + JSON.stringify(v)); }

  /* Keeps what is pulled within what chrome.storage.sync holds: no item
   * over its per-item size, at most the snippet count and bytes the
   * settings allow (the newest pulled snippets first), and the whole within
   * quota. Changes p in place; returns what was left out. */
  function fit(all, p) {
    var left = [];
    function drop(k) {
      delete p.set[k];
      delete p.times[k];
      left.push(k);
    }
    Object.keys(p.set).forEach(function (k) {
      if (isMirrored(k) && bytes(k, p.set[k]) > ITEM_BYTES) drop(k);
    });
    var L = CGP.SETTINGS_LIMITS;
    var after = Object.assign({}, all, p.set);
    p.remove.forEach(function (k) { delete after[k]; });
    var snippets = Object.keys(after).filter(isSnippet);
    var snipBytes = function () { return snippets.reduce(function (n, k) { return n + bytes(k, after[k]); }, 0); };
    // New snippets from Canvas, oldest change first, are what gives way.
    var incoming = Object.keys(p.set).filter(function (k) { return isSnippet(k) && !Object.prototype.hasOwnProperty.call(all, k); })
      .sort(function (a, b) { return ((p.times[a] || {}).a || 0) - ((p.times[b] || {}).a || 0); });
    while (incoming.length && (snippets.length > L.MAX_SNIPPETS || snipBytes() > L.MAX_SNIPPET_BYTES)) {
      var k = incoming.shift();
      drop(k);
      delete after[k];
      snippets = snippets.filter(function (x) { return x !== k; });
    }
    var total = function () { return Object.keys(after).reduce(function (n, x) { return n + bytes(x, after[x]); }, 0); };
    incoming = incoming.filter(function (k) { return p.set[k] !== undefined; });
    while (incoming.length && total() > TOTAL_BYTES) {
      var k2 = incoming.shift();
      drop(k2);
      delete after[k2];
    }
    return left;
  }

  function SettingsMirror(opts) {
    this.api = opts.api;
    this.origin = opts.origin || (typeof location !== 'undefined' ? location.origin : '');
    this.chrome = opts.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    this.now = opts.now || function () { return Date.now(); };
    this.running = null;
    this.again = false;
  }

  /* One merge. At most once a minute unless forced (a setting changed); a
   * change made while one runs gets a run of its own right after. Resolves
   * a status (also kept for the options page); never rejects. */
  SettingsMirror.prototype.run = function (force) {
    var self = this;
    if (this.running) {
      if (force) this.again = true;
      return this.running;
    }
    var c = this.chrome;
    if (!c || !c.storage || !c.storage.sync || !c.storage.local || !this.api || !this.api.customDataTimed) {
      return Promise.resolve({ ok: false, skipped: 'no storage' });
    }
    var statusKey = STATUS_KEY + '.' + this.origin;
    var deviceId = null;
    this.running = c.storage.local.get([statusKey, PENDING_KEY, 'cgp.deviceId']).then(function (r) {
      deviceId = (r && r['cgp.deviceId']) || null;
      var last = r && r[statusKey];
      if (!force && last && self.now() - Number(last.tried || last.at || 0) < MIN_GAP_MS) return { skipped: 'recent' };
      var pending = (r && r[PENDING_KEY]) || {};
      return self.sameUser().then(function (who) {
        if (!who.ok) return { at: null, tried: self.now(), ok: false, otherUser: true, error: who.reason };
        return self.migrateLegacy().then(function () {
          return Promise.all([c.storage.sync.get(null), self.api.customDataTimed('settings')]);
        }).then(function (got) { return self.merge(got, pending, deviceId); });
      });
    }).then(null, function (err) {
      return { at: null, tried: self.now(), ok: false, error: CGP.util.describeApiError(err, { fallback: 'Canvas did not answer' }) };
    }).then(function (status) {
      self.running = null;
      if (status && !status.skipped) {
        var o = {};
        o[statusKey] = status;
        c.storage.local.set(o).catch(function () { return null; });
        if (status.ok && (status.pulled || status.pushed)) CGP.diag.log('settingsMirror', { pulled: status.pulled, pushed: status.pushed });
      }
      if (self.again) { self.again = false; return self.run(true); }
      return status;
    });
    return this.running;
  };

  /* These settings belong to one Canvas person: the first this Chrome
   * profile merged with, on this Canvas. Anyone else signed in to Canvas
   * here - a co-teacher, a student at the teacher's desk - gets no merge at
   * all: their Canvas account neither receives this profile's settings nor
   * hands this profile theirs. */
  var USER_KEY = 'cgp.mirror.user';
  SettingsMirror.prototype.sameUser = function () {
    var self = this;
    var c = this.chrome;
    var key = USER_KEY + '.' + this.origin;
    if (!this.api.currentUser) return Promise.resolve({ ok: true });
    if (!this._who) this._who = this.api.currentUser().then(function (u) { return u && u.id ? String(u.id) : null; });
    return Promise.all([this._who, c.storage.local.get(key)]).then(function (r) {
      var id = r[0];
      var bound = r[1] && r[1][key];
      if (!id) throw new Error('Canvas did not say who is signed in');
      if (!bound) {
        var o = {};
        o[key] = { id: id, at: self.now() };
        return c.storage.local.set(o).then(function () { return { ok: true }; });
      }
      if (String(bound.id) === id) return { ok: true };
      return { ok: false, reason: 'Someone else is signed in to Canvas here, so their Canvas account and these settings are kept apart.' };
    });
  };

  SettingsMirror.prototype.merge = function (got, pending, deviceId) {
    var self = this;
    var c = this.chrome;
    return Promise.resolve().then(function () {
      var all = got[0] || {};
      var offset = Number(got[1].offset) || 0;
      var remote = got[1].data && typeof got[1].data === 'object' ? got[1].data : null;
      var now = self.now() + offset;
      var p = plan(all, remote, pending, now, offset, deviceId);
      var left = fit(all, p);
      // The items' times, in the same write as the items.
      if (Object.keys(p.times).length) Object.assign(p.set, T().shardWrites(all, p.times, now));
      var conflicts = p.conflicts.map(function (k) {
        return { key: k, mine: all[k], theirs: (remote[remoteKey(k)] || {}).v };
      });
      var status = {
        at: self.now(), tried: self.now(), ok: true,
        pulled: Object.keys(p.set).filter(isMirrored).length + p.remove.length,
        pushed: Object.keys(p.push).length,
        leftOut: left.length ? left : null,
        conflicts: conflicts.length ? conflicts : null,
        waiting: p.waiting.length || 0
      };
      var keep = {};
      keep[OFFSET_KEY] = offset;
      keep[PENDING_KEY] = p.pending;
      // Items and their times in one write, so neither lands alone.
      return c.storage.local.set(keep).then(function () {
        return Object.keys(p.set).length ? c.storage.sync.set(p.set) : null;
      }).then(function () {
        return p.remove.length ? c.storage.sync.remove(p.remove) : null;
      }).then(function () {
        var keys = Object.keys(p.push);
        if (!keys.length) return null;
        // A first copy goes up in one request; after that one item at a
        // time, so two computers writing different items never collide.
        if (!remote) {
          var whole = {};
          keys.forEach(function (k) { whole[remoteKey(k)] = p.push[k]; });
          return self.api.setCustomData('settings', whole);
        }
        return keys.reduce(function (chain, k) {
          return chain.then(function () { return self.api.setCustomData('settings/' + remoteKey(k), p.push[k]); });
        }, Promise.resolve());
      }).then(function () { return status; });
    });
  };

  /* The old single 'cgp.settings' item is moved into one item per setting
   * and snippet first (times 0: a move is no change), so nothing in it is
   * hidden by items arriving from Canvas. */
  SettingsMirror.prototype.migrateLegacy = function () {
    var S = CGP.settingsStorage;
    var c = this.chrome;
    return c.storage.sync.get(S.LEGACY_KEY).then(function (r) {
      if (!r || !r[S.LEGACY_KEY]) return null;
      return S.read().then(function (cur) { return S.write(cur.values, cur.values); });
    });
  };

  /* The options page's answer to a conflict: keep this computer's values
   * (they become this computer's changes, now) or take Canvas's (stored
   * here at time 0, which then agrees with Canvas). */
  function resolve(chromeApi, conflicts, keepMine, now) {
    return chromeApi.storage.sync.get(null).then(function (all) {
      var set = {};
      var changes = {};
      (conflicts || []).forEach(function (cf) {
        if (keepMine) {
          // This computer's value as it is NOW (not as the conflict saw it).
          if (!Object.prototype.hasOwnProperty.call(all, cf.key)) return;
          changes[cf.key] = { a: now, h: hash(all[cf.key]) };
        } else {
          set[cf.key] = cf.theirs;
          changes[cf.key] = { a: 0, h: hash(cf.theirs) };
        }
      });
      Object.assign(set, T().shardWrites(all, changes, now));
      return Object.keys(set).length ? chromeApi.storage.sync.set(set) : null;
    });
  }

  CGP.settingsMirror = {
    plan: plan, fit: fit, resolve: resolve, isMirrored: isMirrored, remoteKey: remoteKey, itemKey: itemKey,
    STATUS_KEY: STATUS_KEY, PENDING_KEY: PENDING_KEY, OFFSET_KEY: OFFSET_KEY
  };
  CGP.SettingsMirror = SettingsMirror;
})();
