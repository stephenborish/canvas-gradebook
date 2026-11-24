/* Canvas Gradebook+ - Hidden Gems: the stage and the controller.
 *
 * Five rare, short effects over the Canvas page the teacher is on, each
 * adapted from an open-source project (see src/assets/gems/LICENSES.txt):
 *   rain      drops on the glass, refracting the page (src/gems/rain.js)
 *   snow      cinematic three-layer snowfall (src/gems/snow.js)
 *   leaves    real scanned autumn leaves drifting down (src/gems/leaves.js)
 *   sunshine  dappled light through leaves and blinds (src/gems/sunshine.js)
 *   lights    a string of Christmas lights along the top (src/gems/lights.js)
 *
 * Which one, and whether any, is decided by core/hidden-gems.js from the
 * real weather around Philadelphia (weather.js) and the date: at most one a
 * day, and most days none. The effect's code and textures are loaded only
 * when one actually plays (the service worker injects src/gems/<id>.js).
 *
 * Rules every effect keeps: the stage never takes a click (pointer-events:
 * none) or focus and never changes the page; any key press, click, scroll
 * or window resize ends it at once (the teacher has started working); it
 * ends by itself after about 25 seconds; and everything it created is
 * removed. Preview on a Canvas course page with #cgp-gem-rain,
 * #cgp-gem-rain-heavy, #cgp-gem-rain-storm, #cgp-gem-snow, #cgp-gem-leaves,
 * #cgp-gem-sunshine or #cgp-gem-lights (typed into the address bar of an
 * open page works too; these are valid element ids, so Canvas's own lookup
 * of the #fragment does not throw). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.HiddenGemsController) return;
  CGP.gemPlayers = CGP.gemPlayers || {};

  var STORAGE_KEY = 'cgp.hiddenGems.state';
  var ASSET_DIR = 'src/assets/gems/';
  var DURATION = 25;

  /* --------------------------------------------------------- storage helper */

  function readState() {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) { resolve({}); return; }
        chrome.storage.local.get(STORAGE_KEY, function (res) {
          if (chrome.runtime && chrome.runtime.lastError) { resolve({}); return; }
          resolve((res && res[STORAGE_KEY]) || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  function writeState(state) {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) { resolve(false); return; }
        var obj = {};
        obj[STORAGE_KEY] = state;
        chrome.storage.local.set(obj, function () {
          resolve(!(chrome.runtime && chrome.runtime.lastError));
        });
      } catch (e) { resolve(false); }
    });
  }

  function withClaimLock(fn) {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return navigator.locks.request('cgp-hidden-gems-claim', { ifAvailable: true }, function (lock) {
          if (!lock) return null;
          return fn(true);
        });
      }
    } catch (e) { /* fall through */ }
    return fn(false);
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function assetUrl(name) {
    try { return chrome.runtime.getURL(ASSET_DIR + name); } catch (e) { return ASSET_DIR + name; }
  }

  /* -------------------------------------------------------- stage lifecycle */

  /* One session per effect: its stage element, canvases, timers, listeners,
   * and a clean teardown however it ends. */
  function createSession(onEnd) {
    var stage = document.createElement('div');
    stage.className = 'cgp-gem-stage';
    stage.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stage);

    var timers = [];
    var rafId = 0;
    var listeners = [];
    var cleanups = [];
    var done = false;
    var leaving = false;
    var pointer = { x: -9999, y: -9999, vx: 0, vy: 0, at: 0, seen: false };

    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn, opts]);
    }

    var api = {
      stage: stage,
      pointer: pointer,
      duration: DURATION,
      isDone: function () { return done; },
      on: on,
      onDestroy: function (fn) { cleanups.push(fn); },
      after: function (ms, fn) {
        if (done) return 0;
        var id = setTimeout(function () { if (!done) fn(); }, ms);
        timers.push(id);
        return id;
      },
      /* Images from the extension's own src/assets/gems/, CORS-clean so they
       * can be used as WebGL textures. */
      loadImages: function (names) {
        return Promise.all(names.map(function (n) {
          return new Promise(function (resolve, reject) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('could not load ' + n)); };
            img.src = assetUrl(n);
          });
        }));
      },
      assetUrl: assetUrl,
      /* A canvas covering the viewport at a capped pixel density (opts.dpr). */
      canvas: function (opts) {
        var o = opts || {};
        var el = document.createElement('canvas');
        el.className = 'cgp-gem-canvas' + (o.className ? ' ' + o.className : '');
        var dpr = o.dpr || Math.min(2, window.devicePixelRatio || 1);
        var w = window.innerWidth, h = window.innerHeight;
        el.width = Math.max(1, Math.round(w * dpr));
        el.height = Math.max(1, Math.round(h * dpr));
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        stage.appendChild(el);
        cleanups.push(function () { el.width = 0; el.height = 0; });
        return { el: el, w: w, h: h, dpr: dpr };
      },
      /* fn(dt, t) every frame (seconds) until it returns false. If this
       * computer cannot draw the effect smoothly (under about 20 frames a
       * second for a second and a half), the effect bows out instead of
       * making the page stutter. */
      loop: function (fn) {
        var start = performance.now();
        var last = start;
        var avg = 1 / 60, slowFor = 0;
        function frame(now) {
          if (done) return;
          var raw = Math.max(0, (now - last) / 1000);
          var dt = Math.min(0.05, raw);
          last = now;
          avg = avg * 0.9 + Math.min(0.5, raw) * 0.1;
          slowFor = avg > 0.05 ? slowFor + raw : 0;
          if (CGP.gemFrameGuard !== false && (now - start) > 2000 && slowFor > 1.5) {
            if (CGP.diag) CGP.diag.log('hiddenGems.tooSlow', { fps: Math.round(1 / avg) });
            api.end(700);
            return;
          }
          var keep;
          try { keep = fn(dt, (now - start) / 1000); } catch (e) {
            if (CGP.diag) CGP.diag.error('hiddenGems.frameFailed', { message: String(e && e.message) });
            keep = false;
          }
          if (keep === false) { api.end(900); return; }
          rafId = requestAnimationFrame(frame);
        }
        rafId = requestAnimationFrame(frame);
      },
      /* Fade everything out, then tear it down. */
      end: function (fadeMs) {
        if (done || leaving) return;
        leaving = true;
        var ms = Math.max(0, fadeMs || 0);
        if (!ms) { api.destroy(); return; }
        stage.style.transition = 'opacity ' + ms + 'ms ease';
        stage.style.opacity = '0';
        setTimeout(function () { api.destroy(); }, ms + 40);
      },
      destroy: function () {
        if (done) return;
        done = true;
        leaving = true;
        if (rafId) cancelAnimationFrame(rafId);
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        for (var k = 0; k < listeners.length; k++) {
          var l = listeners[k];
          try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* ignore */ }
        }
        for (var u = cleanups.length - 1; u >= 0; u--) {
          try { cleanups[u](); } catch (e) { /* keep tearing down */ }
        }
        if (stage.parentNode) stage.parentNode.removeChild(stage);
        if (typeof onEnd === 'function') onEnd(api);
      }
    };

    on(window, 'pointermove', function (e) {
      var now = performance.now();
      var dt = Math.max(8, now - (pointer.at || now - 16)) / 1000;
      if (pointer.seen) {
        pointer.vx = pointer.vx * 0.5 + ((e.clientX - pointer.x) / dt) * 0.5;
        pointer.vy = pointer.vy * 0.5 + ((e.clientY - pointer.y) / dt) * 0.5;
      }
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.at = now; pointer.seen = true;
    }, { passive: true });

    /* The teacher has started working: a key, a click, scrolling or resizing
     * ends the effect at once. The event itself is never stopped. */
    function workStarted(e) {
      if (e && e.type === 'keydown' && (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta')) return;
      api.end(350);
    }
    on(document, 'keydown', workStarted, true);
    on(window, 'pointerdown', workStarted, true);
    on(window, 'wheel', workStarted, { capture: true, passive: true });
    on(document, 'scroll', workStarted, { capture: true, passive: true });
    on(window, 'resize', workStarted, { passive: true });
    on(document, 'visibilitychange', function () { if (document.hidden) api.destroy(); });
    // Typing in an editor frame of this site (Canvas's rich content editor)
    // never reaches this document: listen in the focused frame too.
    var watched = [];
    function watchFocusedFrame() {
      var f = document.activeElement;
      if (!f || f.tagName !== 'IFRAME') return;
      try {
        var fd = f.contentDocument;
        if (fd && watched.indexOf(fd) === -1) {
          watched.push(fd);
          on(fd, 'keydown', workStarted, true);
          on(fd, 'pointerdown', workStarted, true);
        }
      } catch (e) { /* another site's frame: cannot be seen */ }
    }
    watchFocusedFrame();
    on(window, 'blur', function () { api.after(0, watchFocusedFrame); });

    return api;
  }

  /* --------------------------------------------- loading an effect's code */

  function loadPlayer(id) {
    if (CGP.gemPlayers[id]) return Promise.resolve(CGP.gemPlayers[id]);
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({ type: 'cgp.gems.load', id: id }, function (res) {
          void (chrome.runtime && chrome.runtime.lastError);
          if (res && res.ok && CGP.gemPlayers[id]) resolve(CGP.gemPlayers[id]);
          else reject(new Error('could not load ' + id));
        });
      } catch (e) { reject(e); }
    });
  }

  /* ============================================================= CONTROLLER */

  function HiddenGemsController(ctx) {
    this.settings = ctx.settings;
    this._active = null;
    this._timer = null;
    this._started = false;
  }

  var P = HiddenGemsController.prototype;

  /* Plays one effect now. opts: { heavy, thunder, light }. */
  P.play = function (id, opts) {
    var self = this;
    if (!CGP.hiddenGems || CGP.hiddenGems.KINDS.indexOf(id) === -1) return Promise.resolve(null);
    return loadPlayer(id).then(function (player) {
      if (self._active) { self._active.destroy(); self._active = null; }
      var session = createSession(function (s) { if (self._active === s) self._active = null; });
      self._active = session;
      return Promise.resolve(player(session, opts || {})).then(function () {
        if (CGP.diag) CGP.diag.log('hiddenGems.played', { gem: id });
        return { gem: id };
      }, function (e) {
        session.destroy();
        throw e;
      });
    }).catch(function (e) {
      if (CGP.diag) CGP.diag.error('hiddenGems.playFailed', { gem: id, message: String(e && e.message) });
      return null;
    });
  };

  P.stop = function () {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._active) { this._active.destroy(); this._active = null; }
  };

  var PREVIEWS = {
    'rain': ['rain', {}], 'rain-light': ['rain', { light: true }], 'rain-heavy': ['rain', { heavy: true }],
    'rain-storm': ['rain', { heavy: true, thunder: true }], 'rain-thunder': ['rain', { heavy: true, thunder: true }],
    'snow': ['snow', {}], 'snow-heavy': ['snow', { heavy: true }],
    'leaves': ['leaves', {}], 'sunshine': ['sunshine', {}], 'lights': ['lights', {}]
  };

  /* Preview: #cgp-gem-<name> plays at once, whatever the weather or date.
   * Checked when the page loads and whenever the #fragment changes, since
   * typing a new #fragment into the address bar does not reload the page. */
  P._checkHashPreview = function () {
    try {
      var m = /^#cgp-gem-([a-z-]+)$/i.exec(String(location.hash || ''));
      if (!m || !Object.prototype.hasOwnProperty.call(PREVIEWS, m[1].toLowerCase())) return false;
      var p = PREVIEWS[m[1].toLowerCase()];
      var self = this;
      // A preview replaces anything today's roll was about to play.
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._previewed = true;
      setTimeout(function () { self.play(p[0], p[1]); }, 50);
      return true;
    } catch (e) { return false; }
  };

  /* Asks the service worker what the weather is doing around Philadelphia
   * (it keeps the answer for 20 minutes). Resolves to { codes, isDay } or null. */
  function currentWeather() {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) { resolve(null); return; }
        chrome.runtime.sendMessage({ type: 'cgp.weather.now' }, function (res) {
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(res && res.ok ? { codes: res.codes, isDay: res.isDay } : null);
        });
      } catch (e) { resolve(null); }
    });
  }

  P.start = function () {
    if (this._started) return;
    this._started = true;
    var self = this;

    if (CGP.hiddenGems) {
      CGP.hiddenGems.play = function (id, opts) { return self.play(id, opts); };
    }
    if (this.settings && this.settings.onChange) {
      this.settings.onChange(function () {
        if (self.settings.values && self.settings.values.hiddenGems === false) self.stop();
      });
    }

    window.addEventListener('hashchange', function () { self._checkHashPreview(); });
    if (this._checkHashPreview()) return;
    if (!this.settings || !this.settings.values || this.settings.values.hiddenGems === false) return;
    if (prefersReducedMotion() || !CGP.hiddenGems) return;

    function stillWanted() {
      return !document.hidden && !!self.settings.values.hiddenGems && !prefersReducedMotion();
    }

    // One decision a day: today's roll, once made, is final.
    readState().then(function (state) {
      if (!CGP.hiddenGems.rollDue(state, new Date())) return null;
      return currentWeather().then(function (weather) { return { weather: weather }; });
    }).then(function (r) {
      if (!r) return;
      // A moment for the page to finish drawing, then the effect: soon
      // enough that a teacher passing through the page still sees it.
      self._timer = setTimeout(function () {
        self._timer = null;
        if (!stillWanted() || self._previewed) return;
        withClaimLock(function (hasLock) {
          return readState().then(function (fresh) {
            if (!stillWanted()) return null;
            var now = new Date();
            if (!CGP.hiddenGems.rollDue(fresh, now)) return null;
            var pick = CGP.hiddenGems.chooseGem(now, r.weather);
            var claimId = now.getTime() + ':' + Math.random().toString(36).slice(2, 8);
            return writeState({ rolledDay: CGP.hiddenGems.dayKey(now), lastGem: pick ? pick.id : null, claimId: claimId }).then(function (okWrite) {
              if (!okWrite || !pick || !stillWanted()) return null;
              var go = function () { return stillWanted() ? self.play(pick.id, pick.opts) : null; };
              if (hasLock) return go();
              // Without Web Locks: play only if this window's claim won.
              return readState().then(function (verify) {
                return verify && verify.claimId === claimId ? go() : null;
              });
            });
          });
        });
      }, 1200 + Math.random() * 1300);
    }, function () { return null; });
  };

  CGP.HiddenGemsController = HiddenGemsController;
})();
