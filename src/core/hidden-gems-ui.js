/* Canvas Gradebook+ - Hidden Gems: snow and rain on real snowy and rainy days.
 *
 * When it is really snowing or raining around Philadelphia and Malvern
 * (core/hidden-gems.js decides, from weather.js in the service worker), the
 * Canvas page the teacher is on gets the weather too, for about forty
 * seconds, at most once every three hours:
 *   snow  flakes at every depth; snow piles up on the page's own buttons,
 *         header bars and headings, and banks up along the bottom
 *   rain  sheets of slanted rain splashing off those same ledges, water
 *         running down the glass, lightning in a thunderstorm
 *
 * Rules both keep: the stage never takes a click (pointer-events: none; the
 * pointer only matters by hovering), never takes focus, never changes the
 * page, fades away the moment the teacher types, and removes every node,
 * timer and listener when finished. Preview on a Canvas course page with
 * #cgp-gem-snow, #cgp-gem-snow-heavy, #cgp-gem-rain, #cgp-gem-rain-heavy or
 * #cgp-gem-rain-thunder (typing it into the address bar of an open page
 * works too). The names are valid element ids on purpose: Canvas looks the
 * address's #fragment up as a jQuery selector, and anything else (such as
 * "#cgp-gem=snow:heavy") makes Canvas's own code throw. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.HiddenGemsController) return;

  var STORAGE_KEY = 'cgp.hiddenGems.state';
  var TAU = Math.PI * 2;

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

  /* ------------------------------------------------------------ math helpers */

  /* Small, fast seeded generator (mulberry32): one seed, one picture. */
  function makeRng(seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* Gradient noise in 3D (Perlin's improved noise), seeded. Returns about -1..1. */
  function makeNoise(rng) {
    var perm = new Uint8Array(512);
    var p = [];
    for (var i = 0; i < 256; i++) p[i] = i;
    for (var j = 255; j > 0; j--) {
      var k = Math.floor(rng() * (j + 1));
      var tmp = p[j]; p[j] = p[k]; p[k] = tmp;
    }
    for (var m = 0; m < 512; m++) perm[m] = p[m & 255];
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function grad(h, x, y, z) {
      var hh = h & 15;
      var u = hh < 8 ? x : y;
      var v = hh < 4 ? y : (hh === 12 || hh === 14 ? x : z);
      return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
    }
    return function (x, y, z) {
      z = z || 0;
      var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      var u = fade(x), v = fade(y), w = fade(z);
      var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
      var B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
      return lerp(
        lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
             lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
        lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
             lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
        w);
    };
  }

  function rgba(rgb, a) {
    return 'rgba(' + Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]) + ',' + a + ')';
  }


  /* -------------------------------------------------------- stage lifecycle */

  /* One session per piece: the stage element, its canvases, its timers and
   * listeners, the pointer, and a clean teardown. */
  function createSession(onEnd) {
    var stage = document.createElement('div');
    stage.className = 'cgp-gem-stage';
    stage.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stage);

    var timers = [];
    var rafId = 0;
    var listeners = [];
    var canvases = [];
    var cleanups = [];
    var done = false;
    var leaving = false;

    var pointer = { x: -9999, y: -9999, vx: 0, vy: 0, speed: 0, at: 0, seen: false };

    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn, opts]);
    }

    on(window, 'pointermove', function (e) {
      var now = performance.now();
      var dt = Math.max(8, now - (pointer.at || now - 16)) / 1000;
      if (pointer.seen) {
        var vx = (e.clientX - pointer.x) / dt;
        var vy = (e.clientY - pointer.y) / dt;
        pointer.vx = lerp(pointer.vx, vx, 0.5);
        pointer.vy = lerp(pointer.vy, vy, 0.5);
      }
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.at = now;
      pointer.seen = true;
    }, { passive: true });
    on(document, 'pointerleave', function () { pointer.x = -9999; pointer.y = -9999; pointer.seen = false; }, { passive: true });

    var api = {
      stage: stage,
      pointer: pointer,
      isDone: function () { return done; },
      /* Runs at teardown, however the session ends: used to hand the real
       * page back exactly as it was. */
      onDestroy: function (fn) { cleanups.push(fn); },
      isLeaving: function () { return leaving; },
      on: on,
      after: function (ms, fn) {
        if (done) return 0;
        var id = setTimeout(function () { if (!done) fn(); }, ms);
        timers.push(id);
        return id;
      },
      /* A canvas covering the viewport (or a fixed box: {left|right, top|bottom,
       * width, height}), sized for the screen's pixel density. */
      canvas: function (box, cls) {
        var el = document.createElement('canvas');
        el.className = 'cgp-gem-canvas' + (cls ? ' ' + cls : '');
        var ctx = el.getContext('2d');
        var rec = { el: el, ctx: ctx, w: 0, h: 0, dpr: 1, box: box || null };
        function size() {
          var w = box ? box.width : window.innerWidth;
          var h = box ? box.height : window.innerHeight;
          var dpr = Math.min(2, window.devicePixelRatio || 1);
          rec.w = w; rec.h = h; rec.dpr = dpr;
          el.width = Math.max(1, Math.round(w * dpr));
          el.height = Math.max(1, Math.round(h * dpr));
          el.style.width = w + 'px';
          el.style.height = h + 'px';
          if (box) {
            el.style.left = box.left != null ? box.left + 'px' : 'auto';
            el.style.right = box.right != null ? box.right + 'px' : 'auto';
            el.style.top = box.top != null ? box.top + 'px' : 'auto';
            el.style.bottom = box.bottom != null ? box.bottom + 'px' : 'auto';
          } else {
            el.style.left = '0px';
            el.style.top = '0px';
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        size();
        rec.resize = size;
        stage.appendChild(el);
        canvases.push(rec);
        return rec;
      },
      /* Calls fn(dt, t) every frame (dt and t in seconds) until it returns
       * false, then fades the stage out and ends the session. */
      loop: function (fn, fadeMs) {
        var start = performance.now();
        var last = start;
        function frame(now) {
          if (done) return;
          var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
          last = now;
          var keep;
          try { keep = fn(dt, (now - start) / 1000); } catch (e) {
            if (CGP.diag) CGP.diag.error('hiddenGems.frameFailed', { message: String(e && e.message) });
            keep = false;
            fadeMs = 0;
          }
          if (keep === false) { api.end(fadeMs == null ? 0 : fadeMs); return; }
          rafId = requestAnimationFrame(frame);
        }
        rafId = requestAnimationFrame(frame);
      },
      /* Fade the whole stage out, then tear everything down. */
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
        for (var c = 0; c < canvases.length; c++) {
          // Release the backing store right away instead of waiting for GC.
          try { canvases[c].el.width = 0; canvases[c].el.height = 0; } catch (e) { /* ignore */ }
        }
        if (stage.parentNode) stage.parentNode.removeChild(stage);
        if (typeof onEnd === 'function') onEnd(api);
      }
    };

    on(window, 'resize', function () {
      for (var i = 0; i < canvases.length; i++) {
        if (!canvases[i].box) canvases[i].resize();
      }
    }, { passive: true });

    /* The teacher always wins: by default a key press, a click, or scrolling
     * ends the piece at once; a piece may replace api.dismiss to choose
     * (snow and rain keep falling through clicks and scrolling, and end on a
     * key press). The event itself is never stopped: the key, click or
     * scroll still does what it would. */
    api.dismiss = function () { api.end(450); };
    function onKey(e) {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      api.dismiss('key');
    }
    on(document, 'keydown', onKey, true);
    // Typing in an editor frame (Canvas's rich content editor) never reaches
    // this document: listen in the frame of this site that has focus, both
    // one already focused when the piece starts and any focused later.
    var watchedFrames = [];
    function watchFocusedFrame() {
      var f = document.activeElement;
      if (!f || f.tagName !== 'IFRAME') return;
      try {
        var fd = f.contentDocument;
        if (fd && watchedFrames.indexOf(fd) === -1) {
          watchedFrames.push(fd);
          on(fd, 'keydown', onKey, true);
        }
      } catch (e) { /* another site's frame: its keys cannot be seen */ }
    }
    watchFocusedFrame();
    on(window, 'blur', function () { api.after(0, watchFocusedFrame); });
    on(window, 'pointerdown', function () { api.dismiss('click'); }, true);
    on(window, 'wheel', function () { api.dismiss('scroll'); }, { capture: true, passive: true });
    on(document, 'scroll', function () { api.dismiss('scroll'); }, { capture: true, passive: true });
    on(window, 'resize', function () { api.dismiss('resize'); }, { passive: true });
    on(document, 'visibilitychange', function () {
      if (document.hidden) api.destroy();
    });

    return api;
  }

  /* ======================================================== PIECES (PLAYERS) */

  var PLAYERS = {};

  /* ======================================================== THE PAGE ITSELF
   * The "ledges" of the page on screen: the top edges real snow would settle
   * on and real rain would splash off (buttons, header bars, table headers,
   * headings, panels, images). Read once, never changed. */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, HEAD: 1, META: 1, LINK: 1, BR: 1, OPTION: 1, OBJECT: 1, EMBED: 1 };
  var LEDGE_TAGS = { BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, IMG: 1, TH: 1, H1: 1, H2: 1, H3: 1, NAV: 1, HEADER: 1 };

  function opaque(color) {
    var m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return false;
    var parts = m[1].split(',');
    return parts.length < 4 || parseFloat(parts[3]) > 0.5;
  }

  /* Rows of a grid, table or list are never ledges themselves (the shelter
   * rule below would cover them anyway), and their insides hold none, so
   * they are not walked at all: on a gradebook that skips thousands of
   * cells. */
  function isRow(el) {
    var t = el.tagName;
    if (t === 'TR' || t === 'TD' || t === 'TBODY') return true;
    var role = el.getAttribute && el.getAttribute('role');
    return role === 'row' || role === 'gridcell' || role === 'rowgroup' || role === 'cell';
  }

  function collectLedges(stage) {
    var W = window.innerWidth, H = window.innerHeight;
    var out = [];
    var visited = 0;
    function walk(el, parentBg) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (++visited > 6000) return;
        if (c === stage || SKIP_TAGS[c.tagName] || (c.classList && c.classList.contains('cgp-gem-sky'))) continue;
        var cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.2) continue;
        var r = c.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) { walk(c, parentBg); continue; }
        if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
        var row = isRow(c);
        var bg = cs.backgroundColor;
        var ownBg = opaque(bg) && bg !== parentBg;
        var border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && opaque(cs.borderTopColor);
        var top = r.top;
        var x0 = Math.max(0, r.left), x1 = Math.min(W, r.right);
        if (/^H[1-3]$/.test(c.tagName) && !ownBg && !border) {
          // Snow sits on the letters themselves, not on the empty line around them.
          var fs = parseFloat(cs.fontSize) || 16, lh = parseFloat(cs.lineHeight) || fs * 1.2;
          top = r.top + parseFloat(cs.paddingTop || 0) + Math.max(0, (lh - fs) / 2) + fs * 0.14;
          try {
            var range = document.createRange();
            range.selectNodeContents(c);
            var tr = range.getClientRects()[0];
            if (tr) { x0 = Math.max(0, tr.left + 1); x1 = Math.min(W, tr.right - 1); }
          } catch (e) { /* keep the element's own width */ }
        }
        if (!row && (ownBg || border || LEDGE_TAGS[c.tagName]) && x1 - x0 >= 30 && top > 6 && top < H - 12) {
          var radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, 6);
          out.push({ x0: x0 + radius * 0.5, x1: x1 - radius * 0.5, y: top, el: c });
        }
        if (!row) walk(c, opaque(bg) ? bg : parentBg);
      }
    }
    walk(document.body, getComputedStyle(document.body).backgroundColor);
    // Merge ledges on the same line that touch; drop ones hidden just under another.
    out.sort(function (a, b) { return (b.x1 - b.x0) - (a.x1 - a.x0); });
    var merged = [];
    for (var i = 0; i < out.length; i++) {
      var L = out[i], used = false;
      for (var j = 0; j < merged.length; j++) {
        var M = merged[j];
        if (Math.abs(M.y - L.y) < 3 && L.x0 <= M.x1 + 2 && L.x1 >= M.x0 - 2) {
          M.x0 = Math.min(M.x0, L.x0); M.x1 = Math.max(M.x1, L.x1); M.els.push(L.el); used = true; break;
        }
        if (L.x0 >= M.x0 - 2 && L.x1 <= M.x1 + 2 && L.y > M.y && L.y - M.y < 4) { used = true; break; }
      }
      if (!used) merged.push({ x0: L.x0, x1: L.x1, y: L.y, els: [L.el] });
    }
    // Sheltered ledges: nothing falls onto a ledge that sits just under
    // another one, so the rows of a table or a list get snow only on top.
    merged.sort(function (a, b) { return a.y - b.y; });
    var open = [];
    for (var s = 0; s < merged.length; s++) {
      var A = merged[s], covered = false;
      for (var o = 0; o < merged.length && !covered; o++) {
        var B = merged[o];
        if (B === A || B.y >= A.y || A.y - B.y > 36) continue;
        var overlap = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        if (overlap > (A.x1 - A.x0) * 0.6) covered = true;
      }
      if (covered) continue;
      // Only now, for the few that are left: is the ledge really on top,
      // not hidden under a menu, a modal or a sticky header?
      var hit = document.elementFromPoint(clamp((A.x0 + A.x1) / 2, 0, W - 1), clamp(A.y + 2, 0, H - 1));
      var seen = false;
      for (var e = 0; e < A.els.length && !seen; e++) {
        var el = A.els[e];
        if (hit && (hit === el || el.contains(hit) || hit.contains(el))) seen = true;
      }
      if (seen) open.push({ x0: A.x0, x1: A.x1, y: A.y });
      if (open.length >= 70) break;
    }
    return open;
  }

  /* ==================================================================== SKY
   * The light of the day, laid over the page the way a gloomy day dims a
   * room: an overcast veil, heavier toward the top and the corners, with very
   * large, very soft cloud shadows sliding across with the wind. Dimming the
   * page is what lets white snow and bright rain show against it, as in
   * life. A tiny canvas scaled up, so it is perfectly smooth; a plain
   * translucent layer (no blend mode), so it costs next to nothing to show. */

  function makeSky(session, kind, rng) {
    var SC = 12;
    var el = document.createElement('canvas');
    el.className = 'cgp-gem-sky';
    var w = Math.ceil(window.innerWidth / SC) + 2, h = Math.ceil(window.innerHeight / SC) + 2;
    el.width = w; el.height = h;
    el.style.width = (w * SC) + 'px';
    el.style.height = (h * SC) + 'px';
    session.stage.insertBefore(el, session.stage.firstChild);
    var g = el.getContext('2d');
    var snow = kind === 'snow';
    var ink = snow ? [42, 58, 86] : [26, 38, 56];
    var aTop = snow ? 0.27 : 0.46, aMid = snow ? 0.21 : 0.39, aBot = snow ? 0.16 : 0.33;
    var aEdge = snow ? 0.13 : 0.16, aCloud = snow ? 0.08 : 0.11;
    var clouds = [];
    var big = Math.max(w, h);
    for (var i = 0; i < 5; i++) {
      clouds.push({ x: rng() * (w + big) - big / 2, y: rng() * h, r: big * (0.4 + rng() * 0.35),
        a: 0.5 + rng() * 0.5, sp: 0.6 + rng() * 0.8, sq: 0.5 + rng() * 0.3 });
    }
    var last = -1;
    return {
      on: function () { el.classList.add('is-on'); },
      off: function () { el.classList.remove('is-on'); el.classList.add('is-off'); },
      draw: function (t, drift) {
        if (t - last < 0.05) return;   // 20 frames a second is plenty for light
        var dt = last < 0 ? 0 : t - last;
        last = t;
        g.clearRect(0, 0, w, h);
        var grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, rgba(ink, aTop)); grd.addColorStop(0.55, rgba(ink, aMid)); grd.addColorStop(1, rgba(ink, aBot));
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        for (var k = 0; k < clouds.length; k++) {
          var c = clouds[k];
          c.x += drift * c.sp * dt / SC;
          if (c.x - c.r > w) c.x = -c.r; else if (c.x + c.r < 0) c.x = w + c.r;
          g.save();
          g.translate(c.x, c.y);
          g.scale(1, c.sq);
          var rg = g.createRadialGradient(0, 0, 0, 0, 0, c.r);
          rg.addColorStop(0, rgba(ink, aCloud * c.a));
          rg.addColorStop(1, rgba(ink, 0));
          g.fillStyle = rg;
          g.beginPath(); g.arc(0, 0, c.r, 0, TAU); g.fill();
          g.restore();
        }
        // The corners of a dim room fall off first.
        var vg = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.75);
        vg.addColorStop(0, rgba(ink, 0));
        vg.addColorStop(1, rgba(ink, aEdge));
        g.fillStyle = vg;
        g.fillRect(0, 0, w, h);
      }
    };
  }

  /* Weather keeps falling while you click and scroll; a key press ends it. */
  function weatherDismiss(session, onEnd) {
    var ending = false;
    session.dismiss = function (why) {
      if (ending || why === 'click' || why === 'scroll') return;
      ending = true;
      if (onEnd) onEnd();
      session.end(700);
    };
  }

  /* Ledges move when the page scrolls: let go of them, find the new ones. */
  function followScroll(session, onScroll, onSettled) {
    var timer = 0;
    session.on(document, 'scroll', function () {
      onScroll();
      clearTimeout(timer);
      timer = session.after(260, onSettled);
    }, { capture: true, passive: true });
  }

  /* A soft white sprite, drawn once: a flake, a clump, a droplet of spray. */
  function makeSprite(size, paint) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var c = document.createElement('canvas');
    c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    paint(g, size / 2);
    return { c: c, s: size };
  }
  function softDot(r, hardness, alpha) {
    return makeSprite(r * 2 + 2, function (g, m) {
      var f = g.createRadialGradient(m, m, 0, m, m, r);
      f.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
      f.addColorStop(hardness, 'rgba(255,255,255,' + (alpha * 0.85) + ')');
      f.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = f;
      g.beginPath(); g.arc(m, m, r, 0, TAU); g.fill();
    });
  }

  /* =================================================================== SNOW
   * Snow on a snowy day. The page dims to the flat grey light of a snow
   * sky. Flakes fall at every depth, soft and white: a fine haze far away,
   * clearly drawn flakes in the middle, and a few large, out-of-focus ones
   * drifting past close up. They do not sway in step: each rides the eddies
   * of the air, and now and then a gust sweeps across the screen and
   * swirls them. Snow settles on the page's own ledges (buttons, header
   * bars, the letters of headings, nav icons) in soft, lumpy, unoutlined
   * caps, bright on top and blue-grey underneath, and banks up along the
   * bottom of the window. Rows of a table or list are sheltered by the row
   * above, so only their top collects snow. A swipe of the pointer knocks
   * snow off a ledge; moving the pointer stirs the falling flakes. */

  var SNOW_COL = 2;
  function makeShelf(x0, x1, y, maxDepth, ground) {
    var n = Math.max(2, Math.ceil((x1 - x0) / SNOW_COL) + 1);
    return { x0: x0, x1: x1, y: y, n: n, depth: new Float32Array(n), max: maxDepth, total: 0, ground: !!ground, slideT: 0, seed: Math.random() * 100 };
  }
  function shelfDepth(sh, x) {
    var i = Math.round((x - sh.x0) / SNOW_COL);
    return i >= 0 && i < sh.n ? sh.depth[i] : 0;
  }
  function shelfCap(sh, i, noise) {
    var edge = Math.min(i, sh.n - 1 - i) * SNOW_COL;
    // Lumpy, the way real snow lies: big undulations and small clumps.
    var lump = 0.68 + 0.22 * noise(sh.seed + i * 0.02, 1.3) + 0.16 * noise(sh.seed + i * 0.11, 4.7);
    if (sh.ground) return sh.max * clamp(0.5 + 0.35 * noise(i * 0.008, 3.1) + 0.2 * noise(i * 0.05, 9.4), 0.25, 1.1);
    return sh.max * clamp(0.18 + edge / 18, 0.18, 1) * clamp(lump, 0.35, 1.15);
  }
  function deposit(sh, x, amount, spread, noise) {
    var ci = (x - sh.x0) / SNOW_COL;
    var R = Math.max(1, Math.round(spread / SNOW_COL));
    for (var k = -R; k <= R; k++) {
      var i = Math.round(ci) + k;
      if (i < 0 || i >= sh.n) continue;
      var w = Math.exp(-(k * k) / (R * R * 0.6));
      sh.depth[i] = Math.min(shelfCap(sh, i, noise), sh.depth[i] + amount * w);
    }
    sh.total += amount;
  }
  function capProfile(sh) {
    var d = sh.depth, n = sh.n;
    var sm = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var a = 0, wsum = 0;
      for (var k = -3; k <= 3; k++) {
        var j = i + k;
        if (j < 0 || j >= n) continue;
        var w = 4 - Math.abs(k);
        a += d[j] * w; wsum += w;
      }
      sm[i] = a / wsum;
    }
    return sm;
  }
  function traceCap(ctx, sh, sm, first, last) {
    var y = sh.y;
    var x0 = sh.x0 + first * SNOW_COL, x1 = sh.x0 + last * SNOW_COL;
    var over = sh.ground ? 0 : Math.min(4, sm[first] * 0.6), overR = sh.ground ? 0 : Math.min(4, sm[last] * 0.6);
    ctx.moveTo(x0 - over, y + 1.2);
    ctx.bezierCurveTo(x0 - over - 1, y - sm[first] * 0.25, x0 - over * 0.5, y - sm[first], x0, y - sm[first]);
    for (var p = first + 1; p <= last; p++) ctx.lineTo(sh.x0 + p * SNOW_COL, y - sm[p]);
    ctx.bezierCurveTo(x1 + overR * 0.5, y - sm[last], x1 + overR + 1, y - sm[last] * 0.25, x1 + overR, y + 1.2);
  }
  function drawCap(ctx, sh, alpha) {
    if (sh.total < 0.4) return;
    var sm = capProfile(sh);
    var first = -1, last = -1, top = 0;
    for (var q = 0; q < sh.n; q++) if (sm[q] > 0.3) { if (first < 0) first = q; last = q; if (sm[q] > top) top = sm[q]; }
    if (first < 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    // The shadow the snow casts on the ledge's face, then the snow itself.
    ctx.beginPath();
    traceCap(ctx, sh, sm, first, last);
    ctx.closePath();
    ctx.shadowColor = 'rgba(40, 58, 86, 0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    var g = ctx.createLinearGradient(0, sh.y - top, 0, sh.y + 1.2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#f6f9fc');
    g.addColorStop(1, '#d9e2ee');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  PLAYERS.snow = function (session, props) {
    var rng = makeRng(props.seed);
    var noise = makeNoise(rng);
    var W = window.innerWidth, H = window.innerHeight;
    var heavy = !!props.heavy;
    var DURATION = props.duration || 40;
    var sky = makeSky(session, 'snow', rng);
    var cv = session.canvas();
    var ctx = cv.ctx;
    var ending = false;
    weatherDismiss(session, function () { ending = true; });

    // It has been snowing outside for a while: snow already lies on the
    // ledges, a little of it, and keeps building from there.
    var shelves = [];
    function lying(sh, amount) {
      for (var i = 0; i < sh.n; i++) sh.depth[i] = shelfCap(sh, i, noise) * amount * (0.75 + 0.25 * noise(sh.seed + i * 0.05, 2.2));
      sh.total = sh.n;
      return sh;
    }
    function gather() {
      shelves = collectLedges(session.stage).map(function (L) {
        return lying(makeShelf(L.x0, L.x1, L.y, L.x1 - L.x0 > 300 ? 12 : 9), 0.4);
      });
    }
    // The page is read just after the first frames, so the snow is already
    // falling while it is read.
    session.after(50, gather);
    var ground = lying(makeShelf(-6, W + 6, H + 2, Math.min(40, H * 0.055), true), 0.35);
    followScroll(session, function () {
      for (var k = 0; k < shelves.length; k++) if (shelves[k].total > 2) knock(shelves[k], shelves[k].x0, shelves[k].x1, 0.5);
      shelves = [];
    }, gather);

    // Flake sprites by depth: far flakes small and soft, near flakes larger
    // and crisp-centred, the nearest large and out of focus.
    var far = [softDot(1.1, 0.3, 0.8), softDot(1.5, 0.35, 0.85)];
    var midS = [softDot(2.0, 0.5, 0.95), softDot(2.5, 0.55, 0.95), softDot(3.0, 0.55, 1)];
    var nearS = [softDot(3.6, 0.55, 1), softDot(4.4, 0.5, 1)];
    var bokeh = softDot(14, 0.25, 0.42);

    var COUNT = Math.round(clamp(W * H / (heavy ? 850 : 1300), 400, 1700));
    var flakes = [];
    function spawn(f, top) {
      var z = Math.pow(rng(), 1.5);
      f.z = z;
      f.sp = z < 0.35 ? far[Math.floor(rng() * far.length)] : (z < 0.8 ? midS[Math.floor(rng() * midS.length)] : nearS[Math.floor(rng() * nearS.length)]);
      f.r = f.sp.s / 2;
      f.x = rng() * (W + 400) - 200;
      f.y = top ? -10 - rng() * 60 : rng() * H;
      f.vy = lerp(22, 64, z) * (0.7 + rng() * 0.6);   // big flakes fall a little faster, but not much
      f.vx = 0;
      f.k = rng() * 100;
      f.py = f.y;
      f.dead = false;
      return f;
    }
    // Already snowing: flakes fill the screen from the first frame.
    for (var i = 0; i < COUNT; i++) flakes.push(spawn({}, false));
    var near = [];
    for (var b = 0; b < (heavy ? 7 : 5); b++) near.push({ x: rng() * W, y: rng() * H - 60, r: 9 + rng() * 14, vy: 40 + rng() * 30, k: rng() * 100 });

    var clumps = [];
    var gusts = [];
    for (var gt = 6 + rng() * 4; gt < DURATION; gt += 7 + rng() * 7) gusts.push({ t: gt, a: (rng() < 0.5 ? -1 : 1) * (60 + rng() * 80) });
    var drift = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 12);
    function windAt(x, t) {
      var w = drift + noise(t * 0.05, 0.5) * 26;
      for (var k = 0; k < gusts.length; k++) {
        var gg = gusts[k];
        var lag = (gg.a > 0 ? x / W : 1 - x / W) * 1.2;   // the gust crosses the screen as a wave
        var u = (t - gg.t - lag) / 1.4;
        if (u > -3 && u < 3) w += gg.a * Math.exp(-u * u);
      }
      return w;
    }

    function knock(sh, xa, xb, power) {
      var i0 = Math.max(0, Math.floor((xa - sh.x0) / SNOW_COL)), i1 = Math.min(sh.n - 1, Math.ceil((xb - sh.x0) / SNOW_COL));
      var pv = session.pointer.vx || 0;
      for (var i = i0; i <= i1; i++) {
        var dpt = sh.depth[i];
        if (dpt < 0.6) continue;
        if (rng() < 0.55) {
          clumps.push({ x: sh.x0 + i * SNOW_COL, y: sh.y - dpt * 0.6, vx: (rng() - 0.5) * 70 + pv * 0.1 * power,
            vy: -30 * power - rng() * 80 * power, r: 0.8 + Math.min(2.4, dpt * 0.28) * rng() + 0.6, life: 0, burst: rng() < 0.6 });
        }
        sh.total -= dpt;
        sh.depth[i] = 0;
      }
    }

    sky.on();

    session.loop(function (dt, t) {
      var p = session.pointer;
      var live = p.seen && performance.now() - p.at < 100;
      var pv = live ? Math.hypot(p.vx, p.vy) : 0;
      var snowing = !ending && t < DURATION;
      var density = snowing ? smoothstep(0, 1, t) : 0;
      var intro = smoothstep(0, 0.9, t);
      if (!snowing && !sky.ended) { sky.off(); sky.ended = true; }
      var windMid = windAt(W / 2, t);
      sky.draw(t, windMid + drift * 2);

      ctx.clearRect(0, 0, cv.w, cv.h);

      // Snow lying on the ledges and banked along the bottom.
      var melt = snowing ? 0 : smoothstep(0, 5, t - DURATION);
      var all = shelves.concat([ground]);
      for (var k = 0; k < all.length; k++) {
        var sh = all[k];
        if (melt > 0) {
          for (var m = 0; m < sh.n; m++) sh.depth[m] *= 1 - 2.2 * dt * melt;
        } else {
          // The steady settling of countless flakes too small to see.
          var rate = (heavy ? 0.9 : 0.6) * density * dt * (sh.ground ? 1.6 : 1);
          for (var gI = 0; gI < sh.n; gI++) {
            var cap = shelfCap(sh, gI, noise);
            if (sh.depth[gI] < cap) sh.depth[gI] = Math.min(cap, sh.depth[gI] + rate * (0.5 + noise(sh.seed + gI * 0.07, t * 0.1) * 0.5 + 0.5));
          }
          sh.total += rate * sh.n * 0.5;
          // A full ledge sheds a little powder off its end now and then.
          if (!sh.ground && sh.depth[0] > shelfCap(sh, 0, noise) * 0.9 && t > sh.slideT) {
            sh.slideT = t + 3 + rng() * 7;
            var leftEnd = rng() < 0.5;
            for (var c2 = 0; c2 < 5; c2++) {
              clumps.push({ x: (leftEnd ? sh.x0 - 2 : sh.x1 + 2) + (rng() - 0.5) * 3, y: sh.y - 2 - rng() * 3, vx: (leftEnd ? -1 : 1) * (6 + rng() * 16),
                vy: rng() * 15, r: 0.6 + rng() * 1.2, life: 0, burst: false });
            }
          }
        }
        if (live && pv > 380 && !sh.ground && p.x > sh.x0 - 6 && p.x < sh.x1 + 6 && p.y > sh.y - 18 && p.y < sh.y + 8) {
          knock(sh, p.x - 24, p.x + 24, 1);
        }
        drawCap(ctx, sh, (1 - melt * 0.9) * intro);
      }

      // Falling flakes: each rides the eddies of the air on its own.
      for (var f = 0; f < flakes.length; f++) {
        var fl = flakes[f];
        if (fl.dead) {
          if (snowing && rng() < density * 0.08) spawn(fl, true);
          else continue;
        }
        var e = 0.004;
        var n0 = noise(fl.x * e, fl.y * e, t * 0.18);
        var cx = (noise(fl.x * e, (fl.y + 8) * e, t * 0.18) - n0) / 8;
        var cy = (noise((fl.x + 8) * e, fl.y * e, t * 0.18) - n0) / 8;
        var curlX = cx * 9000, curlY = -cy * 5000;
        var wobble = noise(fl.k, t * 0.6) * 18 * (0.3 + fl.z);   // each flake's own flutter
        var targetVx = windAt(fl.x, t) * (0.35 + 0.65 * fl.z) + curlX * (0.3 + fl.z) + wobble;
        if (live && pv > 100) {
          var dx = fl.x - p.x, dy = fl.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 150 * 150) targetVx += p.vx * (1 - Math.sqrt(d2) / 150) * 0.6;
        }
        fl.vx = lerp(fl.vx, targetVx, clamp(dt * 2.5, 0, 1));
        fl.x += fl.vx * dt;
        fl.py = fl.y;
        fl.y += (fl.vy + curlY * fl.z) * dt;
        if (fl.z > 0.3 && fl.y > fl.py) {
          for (var s2 = 0; s2 <= shelves.length; s2++) {
            var S2 = s2 < shelves.length ? shelves[s2] : ground;
            if (fl.x < S2.x0 || fl.x > S2.x1) continue;
            var surf = S2.y - shelfDepth(S2, fl.x);
            if (fl.py <= surf && fl.y >= surf) {
              if (rng() < 0.7 || S2.ground) { deposit(S2, fl.x, fl.r * (heavy ? 0.6 : 0.45), fl.r * 1.6 + 2, noise); fl.dead = true; }
              break;
            }
          }
        }
        if (fl.y > H + 14 || fl.x < -220 || fl.x > W + 220) fl.dead = true;
        if (fl.dead) continue;
        ctx.globalAlpha = (0.55 + fl.z * 0.45) * intro;
        ctx.drawImage(fl.sp.c, fl.x - fl.sp.s / 2, fl.y - fl.sp.s / 2, fl.sp.s, fl.sp.s);
      }
      ctx.globalAlpha = 1;

      // A few big flakes right in front of you, out of focus.
      for (var nb = 0; nb < near.length; nb++) {
        var N = near[nb];
        N.x += (windMid * 1.4 + noise(N.k, t * 0.4) * 30) * dt;
        N.y += N.vy * dt;
        if (N.y - N.r > H || N.x < -80 || N.x > W + 80) {
          if (!snowing) { N.y = H * 3; continue; }
          N.x = rng() * W; N.y = -N.r * 2 - rng() * 300;
        }
        var bs = N.r / 14;
        ctx.globalAlpha = 0.75 * intro * (snowing ? 1 : 0.5);
        ctx.drawImage(bokeh.c, N.x - bokeh.s * bs / 2, N.y - bokeh.s * bs / 2, bokeh.s * bs, bokeh.s * bs);
      }
      ctx.globalAlpha = 1;

      // Snow knocked or shed off a ledge: clumps that break into powder.
      for (var c = clumps.length - 1; c >= 0; c--) {
        var cl = clumps[c];
        cl.life += dt;
        cl.vy += 650 * dt;
        cl.vx *= Math.pow(0.4, dt);
        cl.x += cl.vx * dt; cl.y += cl.vy * dt;
        if (cl.y > H + 10 || cl.life > 3) { clumps.splice(c, 1); continue; }
        if (cl.burst && cl.life > 0.22 && cl.r > 1.1) {
          for (var pz = 0; pz < 4; pz++) clumps.push({ x: cl.x, y: cl.y, vx: cl.vx + (rng() - 0.5) * 60, vy: cl.vy * 0.3 - rng() * 30, r: cl.r * 0.45, life: 0, burst: false });
          clumps.splice(c, 1);
          continue;
        }
        var cs = midS[Math.min(2, Math.max(0, Math.round(cl.r) - 1))];
        ctx.drawImage(cs.c, cl.x - cl.r - 1, cl.y - cl.r - 1, cl.r * 2 + 2, cl.r * 2 + 2);
      }

      return t < DURATION + 6;
    }, 900);
  };

  /* =================================================================== RAIN
   * Rain on a rainy day. The page dims to the slate light of a rain sky and
   * clouds slide across. Rain falls in faint, bright, motion-blurred
   * streaks, the way rain looks against a dark room: a fine mist of distant
   * rain, clearer streaks in the middle, long fast ones close up, leaning
   * with the wind and coming in sheets. It splashes into fine spray on the
   * page's own ledges, which shine wet, and drips off their ends.
   *
   * And it runs down the glass: real drops on the screen that bend the page
   * behind them, the way water on a window shows a tiny upside-down view
   * of what is behind it (a CSS backdrop filter: an SVG displacement map
   * shaped like a lens). Drops land, merge, and once heavy enough slide down
   * in stop-start runs, leaving a trail of tiny droplets. A thunderstorm
   * brings lightning. */

  /* The lens: displacement that makes each drop show the page behind it
   * upside down and smaller, with the squeeze toward the rim a real drop
   * has. One map, a few filters for a few drop sizes. */
  var LENS_SIZES = [3, 5, 7, 9, 12];
  function makeLenses(session) {
    var S = 96;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    var im = g.createImageData(S, S);
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
        var r = Math.hypot(dx, dy);
        // Sample at -m * p: inverted and shrunk; m grows toward the rim.
        var m = 0.55 + 0.4 * Math.pow(Math.min(1, r), 3);
        var k = r < 1 ? (1 + m) / 2 : 0;   // displacement = -(1 + m) p, encoded around 0.5
        var i = (y * S + x) * 4;
        im.data[i] = clamp(128 - 127 * dx * k, 0, 255);
        im.data[i + 1] = clamp(128 - 127 * dy * k, 0, 255);
        im.data[i + 2] = 128;
        im.data[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    var url = c.toDataURL();
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'cgp-gem-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    var html = '';
    for (var s = 0; s < LENS_SIZES.length; s++) {
      var R = LENS_SIZES[s];
      html += '<filter id="cgp-gem-lens-' + R + '" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">' +
        '<feImage href="' + url + '" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + (2 * R * 2) + '" xChannelSelector="R" yChannelSelector="G"/>' +
        '</filter>';
    }
    svg.innerHTML = html;
    session.stage.appendChild(svg);
    return function (r) {
      for (var i = 0; i < LENS_SIZES.length; i++) if (r <= LENS_SIZES[i] * 1.15) return LENS_SIZES[i];
      return LENS_SIZES[LENS_SIZES.length - 1];
    };
  }

  PLAYERS.rain = function (session, props) {
    var rng = makeRng(props.seed);
    var noise = makeNoise(rng);
    var W = window.innerWidth, H = window.innerHeight;
    var heavy = !!props.heavy || !!props.thunder;
    var DURATION = props.duration || 38;
    var sky = makeSky(session, 'rain', rng);
    var flash = null;
    if (props.thunder) {
      flash = document.createElement('div');
      flash.className = 'cgp-gem-flash';
      session.stage.appendChild(flash);
    }
    // The glass comes before the rain canvas, so each drop bends the page
    // itself and not the rain streaks, which would make every drop redraw
    // on every frame.
    var glass = document.createElement('div');
    glass.className = 'cgp-gem-glass';
    session.stage.appendChild(glass);
    var cv = session.canvas();
    var ctx = cv.ctx;
    var lensFor = makeLenses(session);
    var ending = false;
    weatherDismiss(session, function () { ending = true; });

    // It has been raining for a while: the ledges are already wet.
    var ledges = [];
    function gather() {
      ledges = collectLedges(session.stage).map(function (L) {
        return { x0: L.x0, x1: L.x1, y: L.y, beadL: 0.3 + rng() * 0.6, beadR: 0.3 + rng() * 0.6, wet: 0.6 };
      });
    }
    session.after(50, gather);
    followScroll(session, function () { ledges = []; }, gather);

    var COUNT = Math.round(clamp(W * H / (heavy ? 750 : 1100), 450, 1800));
    var drops = [];
    function spawn(d) {
      d.z = Math.pow(rng(), 1.15);
      d.len = d.z < 0.45 ? 8 + rng() * 10 : (d.z < 0.8 ? 22 + rng() * 22 : 48 + rng() * 46);
      d.v = lerp(700, 1600, d.z) * (0.9 + rng() * 0.2);
      d.x = rng() * (W + 600) - 300;
      d.y = -d.len - rng() * 150;
      d.py = d.y;
      d.dead = false;
      return d;
    }
    // Already raining: streaks fill the screen from the first frame.
    for (var i = 0; i < COUNT; i++) { drops.push(spawn({})); drops[i].y = rng() * (H + 100) - 100; }

    var spray = [];
    var spraySprite = softDot(3, 0.2, 0.55);
    var dotSprite = softDot(1.4, 0.6, 0.95);
    var falls = [];

    /* Drops on the glass: DOM elements, so each can bend the real page.
     * Elements are kept and reused (hidden while spare) rather than added and
     * removed, so drops coming and going never wake the page's own
     * childList MutationObservers (SpeedGrader's layout scans and others). */
    var beads = [];
    var spareEls = [];
    function addBead(x, y, r) {
      if (beads.length >= 70) return null;
      var el = spareEls.pop();
      if (el) {
        el.style.display = '';
      } else {
        el = document.createElement('div');
        el.className = 'cgp-gem-drop';
        glass.appendChild(el);
      }
      var b = { el: el, x: x, y: y, r: r, lens: 0, run: false, vy: 0, life: 0, trailAt: y, k: rng() * 50, born: 0 };
      beads.push(b);
      sizeBead(b);
      el.style.transform = 'translate3d(' + (x - r).toFixed(1) + 'px,' + (y - b.h / 2).toFixed(1) + 'px,0) scale(0.6)';
      return b;
    }
    function sizeBead(b) {
      var lens = lensFor(b.r);
      if (lens !== b.lens) { b.lens = lens; b.el.style.backdropFilter = 'url(#cgp-gem-lens-' + lens + ') brightness(1.06) contrast(1.08)'; }
      var w = b.r * 2, h = b.r * 2 * (b.run ? 1.22 : 1.04);
      b.el.style.width = w.toFixed(1) + 'px';
      b.el.style.height = h.toFixed(1) + 'px';
      b.h = h;
    }
    function removeBead(idx) {
      var b = beads[idx];
      b.el.style.display = 'none';
      b.el.style.backdropFilter = '';
      spareEls.push(b.el);
      beads.splice(idx, 1);
    }

    // And the glass is already spotted with water.
    for (var ib = 0; ib < (heavy ? 30 : 20); ib++) {
      var nb0 = addBead(rng() * W, 20 + rng() * (H - 80), 2.2 + rng() * rng() * 5.5);
      if (nb0) nb0.life = -rng() * 0.6;   // they appear over the first moment, not all at once
    }

    var strikes = [];
    if (props.thunder) for (var st = 5 + rng() * 4; st < DURATION - 4; st += 9 + rng() * 10) strikes.push(st);
    function flashLevel(t) {
      for (var k = 0; k < strikes.length; k++) {
        var ft = t - strikes[k];
        if (ft < 0 || ft > 1.4) continue;
        if (ft < 0.05) return 0.5;
        if (ft < 0.11) return 0.08;
        if (ft < 0.17) return 0.38;
        if (ft < 0.24) return 0.12;
        if (ft < 0.3) return 0.26;
        return Math.max(0, 0.26 - (ft - 0.3) * 0.3);
      }
      return 0;
    }

    var dir = rng() < 0.5 ? -1 : 1;
    sky.on();

    session.loop(function (dt, t) {
      var raining = !ending && t < DURATION;
      var density = raining ? smoothstep(0, 0.8, t) : 0;
      if (!raining && !sky.ended) { sky.off(); sky.ended = true; }
      var slant = dir * (0.09 + 0.06 * (noise(t * 0.07, 2.2) * 0.5 + 0.5) + 0.05 * Math.max(0, noise(t * 0.25, 8.8)));
      sky.draw(t, slant * 500);
      if (flash) flash.style.opacity = flashLevel(t).toFixed(3);

      ctx.clearRect(0, 0, cv.w, cv.h);

      // Streaks. Far rain is a faint blurred mist; near rain long and bright.
      var LAYERS = [
        { lo: 0, hi: 0.45, w: 1.1, a: 0.11, blur: 0 },
        { lo: 0.45, hi: 0.8, w: 1.0, a: 0.24, blur: 0 },
        { lo: 0.8, hi: 1.01, w: 1.35, a: 0.34, blur: 0 }
      ];
      ctx.lineCap = 'round';
      for (var L = 0; L < 3; L++) {
        var lay = LAYERS[L];
        ctx.beginPath();
        var heads = [];
        var any = false;
        for (var j = 0; j < drops.length; j++) {
          var d = drops[j];
          if (d.z < lay.lo || d.z >= lay.hi) continue;
          if (d.dead) {
            // Sheets of rain: heavier and lighter bands moving with the wind.
            var sheet = 0.4 + 0.6 * (noise(d.x * 0.002 - t * 0.45 * dir, t * 0.1) * 0.5 + 0.5);
            if (raining && rng() < density * sheet * 0.5) spawn(d); else continue;
          }
          d.py = d.y;
          d.y += d.v * dt;
          d.x += d.v * dt * slant;
          var hit = false;
          if (d.z > 0.5) {
            for (var k = 0; k < ledges.length; k++) {
              var lg = ledges[k];
              if (d.x >= lg.x0 && d.x <= lg.x1 && d.py <= lg.y && d.y >= lg.y) {
                if (rng() < 0.8) {
                  var pw = lerp(0.5, 1.1, d.z);
                  spray.push({ x: d.x, y: lg.y - 1, vx: (rng() - 0.5) * 30, vy: -20 - rng() * 30, life: 0, max: 0.25 + rng() * 0.2, s: 1.6 * pw, mist: true });
                  for (var sp = 0; sp < (d.z > 0.8 ? 3 : 2); sp++) {
                    spray.push({ x: d.x, y: lg.y - 1, vx: (rng() < 0.5 ? -1 : 1) * (30 + rng() * 110) * pw, vy: -(90 + rng() * 150) * pw, life: 0, max: 0.4, s: 0.6 + rng() * 0.5, mist: false });
                  }
                  lg.wet = Math.min(1, lg.wet + 0.02);
                  if (d.x - lg.x0 < 50) lg.beadL += 0.06; else if (lg.x1 - d.x < 50) lg.beadR += 0.06;
                  hit = true;
                }
                break;
              }
            }
          }
          // The nearest drops strike the glass itself.
          if (!hit && d.z > 0.9 && d.y > 10 && d.y < H - 40 && rng() < 0.05 * (heavy ? 1.5 : 1)) {
            var merged = false;
            for (var mb = 0; mb < beads.length; mb++) {
              var MB = beads[mb];
              if (!MB.run && Math.abs(MB.x - d.x) < MB.r + 3 && Math.abs(MB.y - d.y) < MB.r + 3) {
                MB.r = Math.min(10, Math.sqrt(MB.r * MB.r + 6)); sizeBead(MB); merged = true; break;
              }
            }
            if (!merged) addBead(d.x, d.y, 2.4 + rng() * rng() * 6.5);
            hit = true;
          }
          if (!hit && d.y > H) {
            if (d.z > 0.45 && rng() < 0.5) spray.push({ x: d.x, y: H - 1 - rng() * 6, vx: (rng() - 0.5) * 40, vy: -30 - rng() * 40, life: 0, max: 0.35, s: 2, mist: true });
            hit = true;
          }
          if (hit) { d.dead = true; continue; }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * slant, d.y - d.len);
          if (L === 2) heads.push(d);
          any = true;
        }
        if (any) {
          ctx.save();
          if (lay.blur) ctx.filter = 'blur(' + lay.blur + 'px)';
          ctx.lineWidth = lay.w;
          ctx.strokeStyle = 'rgba(236, 242, 250,' + lay.a + ')';
          ctx.stroke();
          ctx.restore();
        }
        // The leading part of a near streak is brightest: the drop itself.
        if (heads.length) {
          ctx.beginPath();
          for (var hI = 0; hI < heads.length; hI++) {
            var hd = heads[hI];
            ctx.moveTo(hd.x, hd.y);
            ctx.lineTo(hd.x - hd.len * 0.35 * slant, hd.y - hd.len * 0.35);
          }
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(248, 251, 255, 0.5)';
          ctx.stroke();
        }
      }

      // Wet ledges shine; water gathers at their ends and drips off.
      for (var g = 0; g < ledges.length; g++) {
        var lg2 = ledges[g];
        if (lg2.wet > 0.05) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 * lg2.wet).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(lg2.x0 + 2, lg2.y + 0.5); ctx.lineTo(lg2.x1 - 2, lg2.y + 0.5); ctx.stroke();
        }
        if (raining) { lg2.beadL += dt * 0.04 * density; lg2.beadR += dt * 0.04 * density; }
        var ends = [[lg2.x0 + 1.5, 'beadL'], [lg2.x1 - 1.5, 'beadR']];
        for (var e = 0; e < 2; e++) {
          var bx = ends[e][0], key = ends[e][1];
          var size = Math.min(1, lg2[key]);
          if (size > 0.2) {
            var br = 0.8 + size * 2;
            var by = lg2.y + 0.5 + br;
            var hb = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, 0, bx, by, br);
            hb.addColorStop(0, 'rgba(255,255,255,0.95)');
            hb.addColorStop(0.5, 'rgba(220,230,240,0.5)');
            hb.addColorStop(1, 'rgba(40,58,82,0.55)');
            ctx.fillStyle = hb;
            ctx.beginPath(); ctx.ellipse(bx, by, br * 0.85, br * (1 + size * 0.2), 0, 0, TAU); ctx.fill();
          }
          if (lg2[key] >= 1) { falls.push({ x: bx, y: lg2.y + 3, vy: 0 }); lg2[key] = 0; }
        }
      }
      for (var f = falls.length - 1; f >= 0; f--) {
        var fd = falls[f];
        fd.vy += 1500 * dt;
        var ny = fd.y + fd.vy * dt;
        var landed = ny >= H - 1;
        for (var q = 0; q < ledges.length && !landed; q++) {
          var lq = ledges[q];
          if (fd.x >= lq.x0 && fd.x <= lq.x1 && fd.y < lq.y - 1 && ny >= lq.y) { ny = lq.y; landed = true; }
        }
        fd.y = ny;
        if (landed) {
          for (var sq = 0; sq < 5; sq++) spray.push({ x: fd.x, y: fd.y - 1, vx: (rng() - 0.5) * 160, vy: -(80 + rng() * 120), life: 0, max: 0.4, s: 0.7, mist: false });
          falls.splice(f, 1); continue;
        }
        ctx.strokeStyle = 'rgba(240,246,252,0.7)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(fd.x, fd.y); ctx.lineTo(fd.x, fd.y - Math.min(12, fd.vy * 0.02)); ctx.stroke();
      }

      // Spray: fine bright droplets and a puff of mist at each impact.
      for (var s = spray.length - 1; s >= 0; s--) {
        var S = spray[s];
        S.life += dt;
        if (S.life > S.max) { spray.splice(s, 1); continue; }
        var u = S.life / S.max;
        if (S.mist) {
          S.x += S.vx * dt; S.y += S.vy * dt;
          var ms = S.s * (1 + u * 3);
          ctx.globalAlpha = (1 - u) * 0.6;
          ctx.drawImage(spraySprite.c, S.x - ms * 2, S.y - ms * 2, ms * 4, ms * 4);
        } else {
          S.vy += 1500 * dt;
          S.x += S.vx * dt; S.y += S.vy * dt;
          ctx.globalAlpha = 1 - u;
          ctx.drawImage(dotSprite.c, S.x - S.s * 2, S.y - S.s * 2, S.s * 4, S.s * 4);
        }
      }
      ctx.globalAlpha = 1;

      // Water on the glass.
      var dry = raining ? 0 : smoothstep(0, 5, t - DURATION);
      for (var bI = beads.length - 1; bI >= 0; bI--) {
        var B = beads[bI];
        B.life += dt;
        if (!B.run && B.r > 6.5) { B.run = true; B.vy = 0; sizeBead(B); }
        if (B.run) {
          // Water on glass moves in fits: it snags, then lets go.
          var stick = noise(B.k, t * 1.4) > 0.2 ? 0.08 : 1;
          B.vy = lerp(B.vy, (50 + B.r * 16) * stick, clamp(dt * 6, 0, 1));
          B.y += B.vy * dt;
          B.x += noise(B.k + 3, B.y * 0.03) * 10 * dt;
          if (B.y - B.trailAt > 9 + rng() * 8 && B.r > 4) {
            B.trailAt = B.y;
            var tr = 1.4 + rng() * 1.2;
            addBead(B.x + (rng() - 0.5) * 1.5, B.y - B.h * 0.45, tr);
            B.r = Math.sqrt(Math.max(9, B.r * B.r - tr * tr * 0.6));
            sizeBead(B);
          }
          // It sweeps up the drops in its path.
          for (var o = beads.length - 1; o >= 0; o--) {
            var O = beads[o];
            if (O === B || O.run || O.y < B.y) continue;   // only drops below, in its path
            var ox = O.x - B.x, oy = O.y - B.y;
            if (ox * ox + oy * oy < (B.r + O.r) * (B.r + O.r)) {
              B.r = Math.min(11, Math.sqrt(B.r * B.r + O.r * O.r));
              removeBead(o);
              if (o < bI) bI--;
              sizeBead(B);
            }
          }
          if (B.r < 5) { B.run = false; sizeBead(B); }
          if (B.y > H + 20) { removeBead(bI); continue; }
        }
        if (dry > 0 || B.life > 30) {
          B.r -= dt * (dry > 0 ? 1.4 * dry : 0.06);
          if (B.r < 1.2) { removeBead(bI); continue; }
          sizeBead(B);
        }
        var pop = clamp(B.life / 0.12, 0, 1);
        B.el.style.transform = 'translate3d(' + (B.x - B.r).toFixed(1) + 'px,' + (B.y - B.h / 2).toFixed(1) + 'px,0) scale(' + (0.6 + 0.4 * pop).toFixed(3) + ')';
      }

      return t < DURATION + 6;
    }, 900);
  };

  /* ============================================================= CONTROLLER */

  function HiddenGemsController(ctx) {
    this.settings = ctx.settings;
    this._active = null;
    this._timer = null;
    this._started = false;
  }

  var P = HiddenGemsController.prototype;

  P._render = function (id, props) {
    if (!Object.prototype.hasOwnProperty.call(PLAYERS, id)) return null;
    if (this._active) {
      this._active.destroy();
      this._active = null;
    }
    var self = this;
    var session = createSession(function (s) { if (self._active === s) self._active = null; });
    this._active = session;
    var p = Object.assign({ seed: Math.floor(Math.random() * 4294967295) >>> 0 }, props || {});
    try {
      PLAYERS[id](session, p);
    } catch (e) {
      session.destroy();
      if (CGP.diag) CGP.diag.error('hiddenGems.playFailed', { gem: id, message: String(e && e.message) });
      return null;
    }
    if (CGP.diag) CGP.diag.log('hiddenGems.played', { gem: id, heavy: !!p.heavy, thunder: !!p.thunder });
    return { gem: id };
  };

  /* Plays snow or rain now (opts: { heavy, thunder }). */
  P.play = function (id, opts) {
    return Promise.resolve(this._render(id, opts));
  };

  P.stop = function () {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._active) { this._active.destroy(); this._active = null; }
  };

  /* Preview: #cgp-gem-snow, #cgp-gem-snow-heavy, #cgp-gem-rain,
   * #cgp-gem-rain-heavy, #cgp-gem-rain-thunder play at once, whatever the
   * weather (the older "#cgp-gem=snow:heavy" spelling is still read). Checked
   * when the page loads and whenever the address's #fragment changes, since
   * typing a new #fragment into the address bar does not reload the page. */
  P._checkHashPreview = function () {
    try {
      var m = /^#cgp-gem[-=](snow|rain)(?:[-:](heavy|thunder))?$/i.exec(String(location.hash || ''));
      if (!m) return false;
      var id = m[1].toLowerCase();
      var how = (m[2] || '').toLowerCase();
      var self = this;
      setTimeout(function () { self.play(id, { heavy: !!how, thunder: how === 'thunder' }); }, 50);
      return true;
    } catch (e) { return false; }
  };

  /* Asks the service worker what is falling around Philadelphia (it keeps
   * the answer for 20 minutes). Resolves to the weather kind or null. */
  function currentWeather() {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) { resolve(null); return; }
        chrome.runtime.sendMessage({ type: 'cgp.weather.now' }, function (res) {
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(res && res.ok ? CGP.hiddenGems.weatherKind(res.codes) : null);
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

    // Ask about the weather only when it could show: a page load within three
    // hours of the last weather costs no request at all.
    readState().then(function (state) {
      if (!CGP.hiddenGems.weatherDue(state, Date.now(), { enabled: true, reducedMotion: prefersReducedMotion() })) return null;
      return currentWeather();
    }).then(function (kind) {
      if (!kind) return;
      // A moment for the page to finish drawing, then the weather: soon
      // enough that a teacher passing through the page still sees it.
      self._timer = setTimeout(function () {
        self._timer = null;
        if (!stillWanted()) return;
        withClaimLock(function (hasLock) {
          return readState().then(function (fresh) {
            if (!stillWanted()) return null;
            var claimNow = Date.now();
            if (!CGP.hiddenGems.weatherDue(fresh, claimNow, { enabled: true })) return null;
            var claimId = claimNow + ':' + Math.random().toString(36).slice(2, 8);
            // Only the weather's own record: the earlier pieces' keys are left behind.
            return writeState({ weatherShownAt: claimNow, weatherClaimId: claimId }).then(function (okWrite) {
              if (!okWrite || !stillWanted()) return null;
              var go = function () { return stillWanted() ? self._render(kind.id, { heavy: kind.heavy, thunder: kind.thunder }) : null; };
              if (hasLock) return go();
              // Without Web Locks: play only if this window's claim won.
              return readState().then(function (verify) {
                return verify && verify.weatherClaimId === claimId ? go() : null;
              });
            });
          });
        });
      }, 1200 + Math.random() * 1300);
    }, function () { return null; });
  };

  CGP.HiddenGemsController = HiddenGemsController;
})();
