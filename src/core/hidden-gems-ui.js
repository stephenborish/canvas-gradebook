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
 * #cgp-gem=snow, #cgp-gem=snow:heavy, #cgp-gem=rain, #cgp-gem=rain:heavy or
 * #cgp-gem=rain:thunder. */
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

    /* The teacher always wins: a key press, a click, or scrolling ends the
     * piece at once. A piece that has borrowed the real page replaces
     * api.dismiss so it can hand the page back first. The event itself is
     * never stopped: the key, click or scroll still does what it would. */
    api.dismiss = function () { api.end(450); };
    on(document, 'keydown', function (e) {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      api.dismiss('key');
    }, true);
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

  function collectLedges(stage) {
    var W = window.innerWidth, H = window.innerHeight;
    var out = [];
    var visited = 0;
    function walk(el, parentBg) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (++visited > 15000) return;
        if (c === stage || SKIP_TAGS[c.tagName] || (c.classList && c.classList.contains('cgp-gem-sky'))) continue;
        var cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.2) continue;
        var r = c.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) { walk(c, parentBg); continue; }
        if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
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
        if ((ownBg || border || LEDGE_TAGS[c.tagName]) && x1 - x0 >= 30 && top > 6 && top < H - 12) {
          var hit = document.elementFromPoint(clamp((x0 + x1) / 2, 0, W - 1), clamp(top + 2, 0, H - 1));
          if (hit && (hit === c || c.contains(hit) || hit.contains(c))) {
            var radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, 6);
            out.push({ x0: x0 + radius * 0.5, x1: x1 - radius * 0.5, y: top });
          }
        }
        walk(c, opaque(bg) ? bg : parentBg);
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
          M.x0 = Math.min(M.x0, L.x0); M.x1 = Math.max(M.x1, L.x1); used = true; break;
        }
        if (L.x0 >= M.x0 - 2 && L.x1 <= M.x1 + 2 && L.y > M.y && L.y - M.y < 4) { used = true; break; }
      }
      if (!used) merged.push({ x0: L.x0, x1: L.x1, y: L.y });
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
      if (!covered) open.push(A);
      if (open.length >= 70) break;
    }
    return open;
  }

  /* ================================================================== SKY
   * The light of the day, laid over the page: an overcast gradient with soft
   * cloud shadows drifting across it with the wind. A tiny canvas, scaled up
   * so it is perfectly soft. It sits outside the stage on purpose: the stage
   * is its own stacking context, and a blend inside it would only blend with
   * the empty stage instead of darkening the page. */

  function makeSky(session, kind, rng) {
    var SC = 10;
    var el = document.createElement('canvas');
    el.className = 'cgp-gem-sky';
    el.setAttribute('aria-hidden', 'true');
    var w = Math.ceil(window.innerWidth / SC) + 2, h = Math.ceil(window.innerHeight / SC) + 2;
    el.width = w; el.height = h;
    el.style.width = (w * SC) + 'px';
    el.style.height = (h * SC) + 'px';
    document.body.appendChild(el);
    session.onDestroy(function () { if (el.parentNode) el.parentNode.removeChild(el); });
    var g = el.getContext('2d');
    var snow = kind === 'snow';
    var top = snow ? 'rgb(206,216,229)' : 'rgb(178,189,203)';
    var mid = snow ? 'rgb(226,233,241)' : 'rgb(198,207,218)';
    var bot = snow ? 'rgb(238,242,247)' : 'rgb(211,218,226)';
    var shade = snow ? [158, 172, 194] : [128, 140, 158];
    var clouds = [];
    var big = Math.max(w, h);
    for (var i = 0; i < 7; i++) {
      clouds.push({ x: rng() * (w + big) - big / 2, y: rng() * h * 0.9, r: big * (0.18 + rng() * 0.3),
        a: (snow ? 0.16 : 0.15) + rng() * (snow ? 0.16 : 0.12), sp: 0.6 + rng() * 0.8, sq: 0.45 + rng() * 0.3 });
    }
    var last = -1;
    return {
      on: function () { el.classList.add('is-on'); },
      off: function () { el.classList.remove('is-on'); el.classList.add('is-off'); },
      draw: function (t, drift, gloom) {
        if (t - last < 0.05) return;   // 20 frames a second is plenty for clouds
        var dt = last < 0 ? 0 : t - last;
        last = t;
        g.globalCompositeOperation = 'source-over';
        var grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, top); grd.addColorStop(0.55, mid); grd.addColorStop(1, bot);
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'multiply';
        for (var k = 0; k < clouds.length; k++) {
          var c = clouds[k];
          c.x += drift * c.sp * dt / SC;
          if (c.x - c.r > w) c.x = -c.r; else if (c.x + c.r < 0) c.x = w + c.r;
          g.save();
          g.translate(c.x, c.y);
          g.scale(1, c.sq);
          var rg = g.createRadialGradient(0, 0, 0, 0, 0, c.r);
          rg.addColorStop(0, rgba(shade, c.a));
          rg.addColorStop(0.6, rgba(shade, c.a * 0.45));
          rg.addColorStop(1, rgba(shade, 0));
          g.fillStyle = rg;
          g.beginPath(); g.arc(0, 0, c.r, 0, TAU); g.fill();
          g.restore();
        }
        if (gloom > 0) {
          g.fillStyle = 'rgba(150,158,172,' + clamp(gloom, 0, 1).toFixed(3) + ')';
          g.fillRect(0, 0, w, h);
        }
        g.globalCompositeOperation = 'source-over';
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

  /* =================================================================== SNOW
   * Snow on a snowy day. The light turns cold and grey and clouds drift over
   * the page. Flakes fall at every depth: a haze of tiny far ones, crisp
   * middle ones, the odd six-armed crystal turning as it falls, and a few
   * big soft out-of-focus ones drifting past close up. Gusts sweep through
   * and swirl them. Snow settles and piles up on the page's own ledges, in
   * soft caps that bulge over the ends and glint, and banks up along the
   * bottom of the window; when a cap is full, a little of it slides off the
   * end. A quick swipe of the pointer knocks snow off a ledge, and the
   * pointer pushes the falling flakes aside. */

  var SNOW_COL = 2;
  function makeShelf(x0, x1, y, maxDepth, ground) {
    var n = Math.max(2, Math.ceil((x1 - x0) / SNOW_COL) + 1);
    return { x0: x0, x1: x1, y: y, n: n, depth: new Float32Array(n), max: maxDepth, total: 0, ground: !!ground, slideT: 0 };
  }
  function shelfDepth(sh, x) {
    var i = Math.round((x - sh.x0) / SNOW_COL);
    return i >= 0 && i < sh.n ? sh.depth[i] : 0;
  }
  function shelfCap(sh, i, noise) {
    var edge = Math.min(i, sh.n - 1 - i) * SNOW_COL;
    var shape = sh.ground
      ? 0.55 + 0.45 * (noise(i * 0.012, 3.1) * 0.5 + 0.5) + 0.25 * noise(i * 0.05, 9.4)
      : 0.72 + 0.28 * noise(sh.y * 0.1 + i * 0.045, 7.7);
    return sh.max * (sh.ground ? 1 : clamp(0.22 + edge / 16, 0.22, 1)) * clamp(shape, 0.3, 1.2);
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

  /* A snow cap: smooth, bulging over the ends, cool white, lit from above,
   * with a soft blue shadow where it meets the ledge. */
  function capProfile(sh) {
    var d = sh.depth, n = sh.n;
    var sm = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var a = 0, wsum = 0;
      for (var k = -4; k <= 4; k++) {
        var j = i + k;
        if (j < 0 || j >= n) continue;
        var w = 5 - Math.abs(k);
        a += d[j] * w; wsum += w;
      }
      sm[i] = a / wsum;
    }
    return sm;
  }
  function traceCap(ctx, sh, sm, first, last) {
    var y = sh.y;
    var x0 = sh.x0 + first * SNOW_COL, x1 = sh.x0 + last * SNOW_COL;
    var over = sh.ground ? 0 : Math.min(4.5, sm[first] * 0.75), overR = sh.ground ? 0 : Math.min(4.5, sm[last] * 0.75);
    ctx.moveTo(x0 - over, y + 1.5);
    ctx.bezierCurveTo(x0 - over - 1.2, y - sm[first] * 0.3, x0 - over * 0.4, y - sm[first], x0, y - sm[first]);
    for (var p = first + 1; p <= last; p++) ctx.lineTo(sh.x0 + p * SNOW_COL, y - sm[p]);
    ctx.bezierCurveTo(x1 + overR * 0.4, y - sm[last], x1 + overR + 1.2, y - sm[last] * 0.3, x1 + overR, y + 1.5);
  }
  function drawCap(ctx, sh, alpha) {
    if (sh.total < 0.4) return null;
    var sm = capProfile(sh);
    var first = -1, last = -1, top = 0;
    for (var q = 0; q < sh.n; q++) if (sm[q] > 0.3) { if (first < 0) first = q; last = q; if (sm[q] > top) top = sm[q]; }
    if (first < 0) return null;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Body, with a soft shadow beneath it.
    ctx.beginPath();
    traceCap(ctx, sh, sm, first, last);
    ctx.closePath();
    ctx.shadowColor = 'rgba(58, 80, 112, 0.30)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;
    var g = ctx.createLinearGradient(0, sh.y - top, 0, sh.y + 1.5);
    g.addColorStop(0, '#f7fafd');
    g.addColorStop(0.5, '#eef3f9');
    g.addColorStop(1, '#d6e1ee');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Sunlit crest: a brighter band just under the top surface.
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    traceCap(ctx, sh, sm, first, last);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
    // A faint cool outline so it reads on white.
    ctx.beginPath();
    traceCap(ctx, sh, sm, first, last);
    ctx.strokeStyle = 'rgba(112, 138, 172, 0.5)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
    return sm;
  }

  /* Flake sprites, drawn once. Soft discs (with a faint cool edge so white
   * snow shows on a white page), sharper crystals, and big defocused bokeh. */
  function makeSprite(size, paint) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var c = document.createElement('canvas');
    c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    paint(g, size / 2);
    return { c: c, s: size };
  }
  /* A real flake up close is a loose clump of crystals: a few soft lobes. */
  function fluffSprite(r, soft, rng) {
    return makeSprite((r + soft + 3) * 2, function (g, m) {
      var lobes = [[0, 0, 0.75]];
      for (var i = 0; i < 4; i++) {
        var a = rng() * TAU, d = r * (0.3 + rng() * 0.35);
        lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.45 + rng() * 0.3]);
      }
      for (var k = 0; k < lobes.length; k++) {
        var lx = m + lobes[k][0], ly = m + lobes[k][1], lr = r * lobes[k][2];
        var sh = g.createRadialGradient(lx, ly + 0.6, lr * 0.4, lx, ly + 0.6, lr + soft + 1);
        sh.addColorStop(0, 'rgba(56, 80, 114, 0.12)');
        sh.addColorStop(1, 'rgba(56, 80, 114, 0)');
        g.fillStyle = sh;
        g.beginPath(); g.arc(lx, ly + 0.6, lr + soft + 1, 0, TAU); g.fill();
      }
      for (var j = 0; j < lobes.length; j++) {
        var x = m + lobes[j][0], y = m + lobes[j][1], rr = r * lobes[j][2];
        var f = g.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr + soft);
        f.addColorStop(0, 'rgba(255,255,255,1)');
        f.addColorStop(0.6, 'rgba(255,255,255,0.9)');
        f.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = f;
        g.beginPath(); g.arc(x, y, rr + soft, 0, TAU); g.fill();
      }
    });
  }

  function discSprite(r, soft) {
    return makeSprite((r + soft + 2) * 2, function (g, m) {
      var sh = g.createRadialGradient(m, m + 0.5, r * 0.5, m, m + 0.5, r + soft + 1);
      sh.addColorStop(0, 'rgba(56, 80, 114, 0.20)');
      sh.addColorStop(1, 'rgba(56, 80, 114, 0)');
      g.fillStyle = sh;
      g.beginPath(); g.arc(m, m + 0.5, r + soft + 1, 0, TAU); g.fill();
      var f = g.createRadialGradient(m - r * 0.3, m - r * 0.3, 0, m, m, r + soft);
      f.addColorStop(0, 'rgba(255,255,255,1)');
      f.addColorStop(clamp(r / (r + soft), 0.2, 0.95) * 0.75, 'rgba(255,255,255,0.96)');
      f.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = f;
      g.beginPath(); g.arc(m, m, r + soft, 0, TAU); g.fill();
    });
  }
  function crystalSprite(r, rng) {
    var twig = 0.45 + rng() * 0.25, twigLen = 0.28 + rng() * 0.12, twig2 = rng() < 0.6;
    return makeSprite((r + 3) * 2, function (g, m) {
      function arms(color, width, dy) {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.lineCap = 'round';
        for (var a = 0; a < 6; a++) {
          var an = a * Math.PI / 3;
          var cx = Math.cos(an), sy = Math.sin(an);
          g.beginPath(); g.moveTo(m, m + dy); g.lineTo(m + cx * r, m + sy * r + dy); g.stroke();
          var pts = twig2 ? [twig, twig + 0.25] : [twig];
          for (var p = 0; p < pts.length; p++) {
            var bx = m + cx * r * pts[p], by = m + sy * r * pts[p] + dy;
            var L = r * twigLen * (p ? 0.7 : 1);
            for (var s = -1; s <= 1; s += 2) {
              g.beginPath(); g.moveTo(bx, by);
              g.lineTo(bx + Math.cos(an + s * 1.0) * L, by + Math.sin(an + s * 1.0) * L); g.stroke();
            }
          }
        }
      }
      arms('rgba(60, 86, 122, 0.32)', Math.max(1.1, r * 0.2), 0.7);
      arms('#ffffff', Math.max(0.8, r * 0.13), 0);
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(m, m, r * 0.2, 0, TAU); g.fill();
    });
  }
  function bokehSprite(r) {
    return makeSprite(r * 2 + 4, function (g, m) {
      var f = g.createRadialGradient(m, m, 0, m, m, r);
      // Far out of focus: a soft glow with no edge at all.
      f.addColorStop(0, 'rgba(255,255,255,0.5)');
      f.addColorStop(0.35, 'rgba(255,255,255,0.38)');
      f.addColorStop(0.7, 'rgba(255,255,255,0.14)');
      f.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = f;
      g.beginPath(); g.arc(m, m, r, 0, TAU); g.fill();
    });
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

    var shelves = [];
    function gather() {
      shelves = collectLedges(session.stage).map(function (L) { return makeShelf(L.x0, L.x1, L.y, L.x1 - L.x0 > 300 ? 13 : 10); });
    }
    gather();
    var ground = makeShelf(-6, W + 6, H + 2, Math.min(46, H * 0.06), true);
    followScroll(session, function () {
      for (var k = 0; k < shelves.length; k++) if (shelves[k].total > 2) knock(shelves[k], shelves[k].x0, shelves[k].x1, 0.5);
      shelves = [];
    }, gather);

    var discs = [];
    for (var s = 0; s < 7; s++) discs.push(discSprite(0.7 + s * 0.6, 0.5 + s * 0.35));
    var fluffs = [];
    for (var fI = 0; fI < 8; fI++) fluffs.push(fluffSprite(3 + rng() * 2.6, 0.6 + rng() * 0.6, rng));
    var crystals = [crystalSprite(4.5, rng), crystalSprite(5.5, rng), crystalSprite(6.5, rng)];
    var bokeh = bokehSprite(26);

    var COUNT = Math.round(clamp(W * H / (heavy ? 1100 : 1700), 300, 1300));
    var flakes = [];
    function spawn(f, top) {
      var z = Math.pow(rng(), 1.4);                      // most flakes are far and small
      f.z = z;
      f.r = lerp(0.7, 4.3, z);
      f.crystal = z > 0.82 && rng() < 0.5;
      f.fluff = !f.crystal && z > 0.62 && rng() < 0.7;
      f.sp = f.crystal ? crystals[Math.floor(rng() * crystals.length)]
        : (f.fluff ? fluffs[Math.floor(rng() * fluffs.length)] : discs[Math.min(6, Math.floor(z * 7))]);
      f.x = rng() * (W + 400) - 200;
      f.y = top ? -12 - rng() * 80 : rng() * H;
      f.vy = lerp(18, 74, z) * (0.75 + rng() * 0.5) * (f.crystal ? 0.8 : 1);
      f.ph = rng() * TAU;
      f.hz = 0.25 + rng() * 0.6;
      f.amp = lerp(5, 26, z);
      f.spin = (rng() - 0.5) * 1.6;
      f.rot = rng() * TAU;
      f.py = f.y;
      f.dead = false;
      return f;
    }
    for (var i = 0; i < COUNT; i++) { flakes.push(spawn({}, true)); flakes[i].y -= rng() * H * 1.3; }
    var near = [];
    for (var b = 0; b < (heavy ? 9 : 6); b++) {
      near.push({ x: rng() * W, y: -60 - rng() * H, r: 10 + rng() * 16, vy: 34 + rng() * 26, ph: rng() * TAU, a: 0.5 + rng() * 0.4 });
    }

    var glints = [];
    var clumps = [];
    // Gusts: every few seconds a wave of wind sweeps across the screen.
    var gusts = [];
    for (var gt = 5 + rng() * 4; gt < DURATION; gt += 6 + rng() * 6) gusts.push({ t: gt, a: (rng() < 0.5 ? -1 : 1) * (70 + rng() * 90) });
    var drift = (rng() < 0.5 ? -1 : 1) * (8 + rng() * 14);

    function windAt(x, t) {
      var w = drift + noise(t * 0.06, 0.5) * 30;
      for (var k = 0; k < gusts.length; k++) {
        var gg = gusts[k];
        var lag = (gg.a > 0 ? x / W : 1 - x / W) * 1.1;   // the wave crosses the screen
        var u = (t - gg.t - lag) / 1.3;
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
        if (rng() < 0.5) {
          clumps.push({ x: sh.x0 + i * SNOW_COL, y: sh.y - dpt * 0.6, vx: (rng() - 0.5) * 70 + pv * 0.1 * power,
            vy: -30 * power - rng() * 80 * power, r: 0.7 + Math.min(2.6, dpt * 0.3) * rng() + 0.5, life: 0, puff: rng() < 0.5 });
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
      var density = snowing ? smoothstep(0, 5, t) : 0;
      if (!snowing && !sky.ended) { sky.off(); sky.ended = true; }
      var windMid = windAt(W / 2, t);
      sky.draw(t, windMid * 0.6 + drift * 2, 0);

      ctx.clearRect(0, 0, cv.w, cv.h);

      // Snow on the ledges and banked along the bottom.
      var melt = snowing ? 0 : smoothstep(0, 5, t - DURATION);
      var all = shelves.concat([ground]);
      for (var k = 0; k < all.length; k++) {
        var sh = all[k];
        if (melt > 0) {
          for (var m = 0; m < sh.n; m++) sh.depth[m] *= 1 - 2.2 * dt * melt;
        } else if (t > 1.2) {
          // The steady settling of countless flakes too small to draw.
          var rate = (heavy ? 1.0 : 0.65) * density * dt * (sh.ground ? 1.7 : 1);
          for (var gI = 0; gI < sh.n; gI++) {
            var cap = shelfCap(sh, gI, noise);
            if (sh.depth[gI] < cap) sh.depth[gI] = Math.min(cap, sh.depth[gI] + rate * (0.6 + 0.8 * (noise(gI * 0.08, sh.y * 0.05) * 0.5 + 0.5)));
          }
          sh.total += rate * sh.n * 0.5;
          // A full cap lets a little slide off its end now and then.
          if (!sh.ground && sh.depth[0] > shelfCap(sh, 0, noise) * 0.9 && t > sh.slideT) {
            sh.slideT = t + 2 + rng() * 6;
            var leftEnd = rng() < 0.5;
            var ex = leftEnd ? sh.x0 : sh.x1;
            for (var c2 = 0; c2 < 4; c2++) {
              clumps.push({ x: ex + (leftEnd ? -2 : 2), y: sh.y - 2, vx: (leftEnd ? -1 : 1) * (8 + rng() * 20), vy: rng() * 20,
                r: 0.8 + rng() * 1.4, life: 0, puff: true });
            }
          }
        }
        if (live && pv > 380 && !sh.ground && p.x > sh.x0 - 6 && p.x < sh.x1 + 6 && p.y > sh.y - 18 && p.y < sh.y + 8) {
          knock(sh, p.x - 24, p.x + 24, 1);
        }
        var prof = drawCap(ctx, sh, 1 - melt * 0.9);
        // Glints: a crystal on the surface catching the light for an instant.
        if (prof && snowing && rng() < (sh.x1 - sh.x0) * 0.00035 * (sh.ground ? 3 : 1)) {
          var gi = Math.floor(rng() * sh.n);
          if (prof[gi] > 2.5) glints.push({ x: sh.x0 + gi * SNOW_COL, y: sh.y - prof[gi] + 1.2 + rng() * 2, life: 0, max: 0.5 + rng() * 0.5, s: 1.6 + rng() * 2.2 });
        }
      }
      for (var gl = glints.length - 1; gl >= 0; gl--) {
        var G = glints[gl];
        G.life += dt;
        if (G.life > G.max) { glints.splice(gl, 1); continue; }
        var ga = Math.sin(Math.PI * G.life / G.max);
        ctx.strokeStyle = 'rgba(255,255,255,' + ga.toFixed(3) + ')';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(G.x - G.s * ga, G.y); ctx.lineTo(G.x + G.s * ga, G.y);
        ctx.moveTo(G.x, G.y - G.s * ga); ctx.lineTo(G.x, G.y + G.s * ga);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,' + ga.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(G.x, G.y, 0.9, 0, TAU); ctx.fill();
      }

      // Falling flakes.
      for (var f = 0; f < flakes.length; f++) {
        var fl = flakes[f];
        if (fl.dead) {
          if (snowing && rng() < density * 0.08) spawn(fl, true);
          else continue;
        }
        fl.ph += fl.hz * TAU * dt;
        var wind = windAt(fl.x, t);
        var tx = noise(fl.x * 0.003, fl.y * 0.003, t * 0.22) * 34;
        var ty = noise(fl.x * 0.003 + 50, fl.y * 0.003, t * 0.22) * 16;
        var push = 0, pushY = 0;
        if (live && pv > 100) {
          var dx = fl.x - p.x, dy = fl.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 150 * 150) { var q = 1 - Math.sqrt(d2) / 150; push = p.vx * q * 0.55; pushY = p.vy * q * 0.4; }
        }
        fl.x += (wind * (0.3 + 0.7 * fl.z) + tx * (0.4 + fl.z) + Math.sin(fl.ph) * fl.amp * 0.6 + push) * dt;
        fl.py = fl.y;
        fl.y += (fl.vy + ty * fl.z + pushY) * dt;
        fl.rot += fl.spin * dt;
        if (fl.z > 0.28 && fl.y > fl.py) {
          for (var s2 = 0; s2 <= shelves.length; s2++) {
            var S2 = s2 < shelves.length ? shelves[s2] : ground;
            if (fl.x < S2.x0 || fl.x > S2.x1) continue;
            var surf = S2.y - shelfDepth(S2, fl.x);
            if (fl.py <= surf && fl.y >= surf) {
              if (rng() < 0.7 || S2.ground) { deposit(S2, fl.x, fl.r * (heavy ? 0.7 : 0.5), fl.r * 1.6 + 2, noise); fl.dead = true; }
              break;
            }
          }
        }
        if (fl.y > H + 14 || fl.x < -220 || fl.x > W + 220) fl.dead = true;
        if (fl.dead) continue;
        var sp = fl.sp;
        ctx.globalAlpha = 0.5 + fl.z * 0.5;
        if (fl.crystal || fl.fluff) {
          ctx.save(); ctx.translate(fl.x, fl.y); ctx.rotate(fl.rot);
          ctx.drawImage(sp.c, -sp.s / 2, -sp.s / 2, sp.s, sp.s);
          ctx.restore();
        } else {
          ctx.drawImage(sp.c, fl.x - sp.s / 2, fl.y - sp.s / 2, sp.s, sp.s);
        }
      }
      ctx.globalAlpha = 1;

      // Big soft flakes drifting past, close to you and out of focus.
      for (var nb = 0; nb < near.length; nb++) {
        var N = near[nb];
        N.ph += dt * 0.6;
        N.x += (windMid * 1.3 + Math.sin(N.ph) * 18) * dt;
        N.y += N.vy * dt;
        if (N.y - N.r > H || N.x < -80 || N.x > W + 80) {
          if (!snowing) { N.y = H * 3; continue; }
          N.x = rng() * W; N.y = -N.r * 2 - rng() * 200;
        }
        var bs = N.r * 2 / 26;
        ctx.globalAlpha = N.a * 0.8 * (snowing ? 1 : 0.6) * smoothstep(0, 6, t);
        ctx.drawImage(bokeh.c, N.x - bokeh.s * bs / 2, N.y - bokeh.s * bs / 2, bokeh.s * bs, bokeh.s * bs);
      }
      ctx.globalAlpha = 1;

      // Snow knocked or sliding off a ledge: clumps that break into powder.
      for (var c = clumps.length - 1; c >= 0; c--) {
        var cl = clumps[c];
        cl.life += dt;
        cl.vy += 700 * dt;
        cl.vx *= Math.pow(0.4, dt);
        cl.x += cl.vx * dt; cl.y += cl.vy * dt;
        if (cl.y > H + 10 || cl.life > 2.5) { clumps.splice(c, 1); continue; }
        if (cl.puff && cl.life > 0.25 && cl.r > 1.2) {
          // Burst into finer powder.
          for (var pz = 0; pz < 3; pz++) clumps.push({ x: cl.x, y: cl.y, vx: cl.vx + (rng() - 0.5) * 50, vy: cl.vy * 0.4 - rng() * 30, r: cl.r * 0.45, life: 0, puff: false });
          clumps.splice(c, 1);
          continue;
        }
        ctx.drawImage(discs[Math.min(6, Math.round(cl.r))].c, cl.x - cl.r - 2, cl.y - cl.r - 2, cl.r * 2 + 4, cl.r * 2 + 4);
      }

      return t < DURATION + 6;
    }, 900);
  };

  /* =================================================================== RAIN
   * Rain on a rainy day. The light goes slate grey and clouds roll over the
   * page. Rain falls in fine slanted streaks at three depths, in moving
   * sheets of heavier and lighter rain, leaning with the wind. Drops burst
   * on the page's own ledges in tiny crowns and droplets; the ledges shine
   * wet; water beads at their ends and drips off. Drops spatter the screen
   * itself: beads of water gather, merge, and when heavy enough run down the
   * glass in stop-start trickles, leaving trails. Puddle rings spread along
   * the bottom of the window. A thunderstorm brings lightning. */

  function beadSprite(r) {
    return makeSprite(r * 2 + 6, function (g, m) {
      // Shadow the drop casts on the page behind the glass.
      g.fillStyle = 'rgba(22, 34, 52, 0.22)';
      g.beginPath(); g.ellipse(m + 0.7, m + 1.5, r, r * 0.95, 0, 0, TAU); g.fill();
      // The drop: clear and bright inside, darker rim (heaviest at the bottom).
      var body = g.createRadialGradient(m, m - r * 0.25, r * 0.15, m, m, r);
      body.addColorStop(0, 'rgba(248, 251, 254, 0.75)');
      body.addColorStop(0.62, 'rgba(214, 226, 238, 0.5)');
      body.addColorStop(1, 'rgba(46, 66, 92, 0.75)');
      g.fillStyle = body;
      g.beginPath(); g.arc(m, m, r, 0, TAU); g.fill();
      var rim = g.createLinearGradient(0, m - r, 0, m + r);
      rim.addColorStop(0, 'rgba(60, 82, 110, 0.3)');
      rim.addColorStop(1, 'rgba(20, 34, 54, 0.75)');
      g.strokeStyle = rim;
      g.lineWidth = Math.max(0.6, r * 0.22);
      g.beginPath(); g.arc(m, m, r * 0.88, 0, TAU); g.stroke();
      // Highlights: the window's reflection, and light focused through the drop.
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.ellipse(m - r * 0.32, m - r * 0.38, r * 0.28, r * 0.18, -0.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.ellipse(m + r * 0.2, m + r * 0.48, r * 0.3, r * 0.12, 0.2, 0, TAU); g.fill();
    });
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
    var cv = session.canvas();
    var ctx = cv.ctx;
    var glassCv = session.canvas();
    var gctx = glassCv.ctx;
    var ending = false;
    weatherDismiss(session, function () { ending = true; });

    var ledges = [];
    function gather() {
      ledges = collectLedges(session.stage).map(function (L) {
        return { x0: L.x0, x1: L.x1, y: L.y, beadL: rng() * 0.6, beadR: rng() * 0.6, wet: 0 };
      });
    }
    gather();
    followScroll(session, function () { ledges = []; }, gather);

    var COUNT = Math.round(clamp(W * H / (heavy ? 800 : 1300), 400, 1700));
    var drops = [];
    function spawn(d) {
      d.z = Math.pow(rng(), 1.25);
      d.len = lerp(9, 42, d.z) * (0.8 + rng() * 0.4);
      d.v = lerp(650, 1400, d.z) * (0.9 + rng() * 0.2);
      d.x = rng() * (W + 500) - 250;
      d.y = -d.len - rng() * 120;
      d.py = d.y;
      d.dead = false;
      return d;
    }
    for (var i = 0; i < COUNT; i++) { drops.push(spawn({})); drops[i].y -= rng() * H * 1.4; }

    var bits = [], crowns = [], rings = [], falls = [];
    var beads = [];
    var sprites = [];
    for (var s = 0; s <= 16; s++) sprites.push(beadSprite(1 + s * 0.5));
    function beadSp(r) { return sprites[clamp(Math.round((r - 1) * 2), 0, 16)]; }

    function splash(x, y, power, n) {
      crowns.push({ x: x, y: y, life: 0, w: 2 + power * 5 });
      for (var k = 0; k < n; k++) {
        var side = rng() < 0.5 ? -1 : 1;
        bits.push({ x: x, y: y - 0.5, vx: side * (30 + rng() * 120) * power, vy: -(80 + rng() * 160) * power, life: 0, r: 0.5 + rng() * 0.9 });
      }
    }

    // Lightning, in a thunderstorm: each strike a quick double flicker.
    var strikes = [];
    if (props.thunder) for (var st = 5 + rng() * 4; st < DURATION - 4; st += 9 + rng() * 10) strikes.push(st);
    function flashLevel(t) {
      for (var k = 0; k < strikes.length; k++) {
        var ft = t - strikes[k];
        if (ft < 0 || ft > 1.2) continue;
        if (ft < 0.05) return 0.55;
        if (ft < 0.11) return 0.12;
        if (ft < 0.17) return 0.42;
        if (ft < 0.24) return 0.2;
        if (ft < 0.3) return 0.3;
        return Math.max(0, 0.3 - (ft - 0.3) * 0.5);
      }
      return 0;
    }

    var dir = rng() < 0.5 ? -1 : 1;
    sky.on();

    session.loop(function (dt, t) {
      var raining = !ending && t < DURATION;
      var density = raining ? smoothstep(0, 4, t) : 0;
      if (!raining && !sky.ended) { sky.off(); sky.ended = true; }
      var slant = dir * (0.1 + 0.07 * (noise(t * 0.07, 2.2) * 0.5 + 0.5) + 0.06 * Math.max(0, noise(t * 0.25, 8.8)));
      var lvl = flashLevel(t);
      sky.draw(t, slant * 420, props.thunder ? 0.12 : 0);
      if (flash) flash.style.opacity = lvl.toFixed(3);

      ctx.clearRect(0, 0, cv.w, cv.h);

      // Streaks, by depth: far ones fine and a touch blurred, near ones longer.
      var LAYERS = [
        { lo: 0, hi: 0.4, w: 0.7, a: 0.2, blur: 0.7 },
        { lo: 0.4, hi: 0.75, w: 0.95, a: 0.3, blur: 0 },
        { lo: 0.75, hi: 1.01, w: 1.3, a: 0.42, blur: 0 }
      ];
      ctx.lineCap = 'round';
      for (var L = 0; L < 3; L++) {
        var lay = LAYERS[L];
        ctx.beginPath();
        var any = false;
        for (var j = 0; j < drops.length; j++) {
          var d = drops[j];
          if (d.z < lay.lo || d.z >= lay.hi) continue;
          if (d.dead) {
            // Sheets of rain: heavier and lighter bands that move with the wind.
            var sheet = 0.45 + 0.55 * (noise(d.x * 0.0022 - t * 0.5 * dir, t * 0.1) * 0.5 + 0.5);
            if (raining && rng() < density * sheet * 0.5) spawn(d); else continue;
          }
          d.py = d.y;
          d.y += d.v * dt;
          d.x += d.v * dt * slant;
          var hit = false;
          if (d.z > 0.45) {
            for (var k = 0; k < ledges.length; k++) {
              var lg = ledges[k];
              if (d.x >= lg.x0 && d.x <= lg.x1 && d.py <= lg.y && d.y >= lg.y) {
                if (rng() < 0.8) {
                  splash(d.x, lg.y, lerp(0.5, 1.05, d.z), d.z > 0.8 ? 3 : 2);
                  lg.wet = Math.min(1, lg.wet + 0.02);
                  if (d.x - lg.x0 < 50) lg.beadL += 0.07; else if (lg.x1 - d.x < 50) lg.beadR += 0.07;
                  hit = true;
                }
                break;
              }
            }
          }
          // The nearest drops hit the screen itself.
          if (!hit && d.z > 0.93 && d.y > 8 && d.y < H - 30 && rng() < 0.02 * (heavy ? 1.6 : 1) && beads.length < 240) {
            // Landing on a bead already there makes one bigger bead.
            var merged = false;
            for (var mb = 0; mb < beads.length; mb++) {
              var MB = beads[mb];
              if (!MB.run && Math.abs(MB.x - d.x) < MB.r + 2 && Math.abs(MB.y - d.y) < MB.r + 2) { MB.r = Math.min(7, Math.sqrt(MB.r * MB.r + 2.5)); merged = true; break; }
            }
            if (merged) { d.dead = true; continue; }
            beads.push({ x: d.x, y: d.y, r: 2 + rng() * rng() * 3, vy: 0, run: false, life: 0, trailAt: 0, wob: rng() * 10 });
            hit = true;
          }
          if (!hit && d.y > H - 2) {
            if (d.z > 0.35 && rng() < 0.6) {
              if (rng() < 0.45) rings.push({ x: d.x, y: H - 2 - rng() * 16, life: 0, r: lerp(5, 15, d.z) });
              else splash(d.x, H - 1, lerp(0.4, 0.9, d.z), 2);
            }
            hit = true;
          }
          if (hit) { d.dead = true; continue; }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * slant, d.y - d.len);
          any = true;
        }
        if (any) {
          ctx.save();
          if (lay.blur) ctx.filter = 'blur(' + lay.blur + 'px)';
          ctx.lineWidth = lay.w;
          ctx.strokeStyle = 'rgba(58, 76, 100,' + lay.a + ')';
          ctx.stroke();
          if (L === 2) {
            // The near drops catch the light along one side.
            ctx.translate(0.8, 0);
            ctx.lineWidth = 0.6;
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Wet ledges: a thin shine of water along the top, beads at the ends, drips.
      for (var g = 0; g < ledges.length; g++) {
        var lg2 = ledges[g];
        if (lg2.wet > 0.05) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * lg2.wet).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(lg2.x0 + 2, lg2.y + 0.5); ctx.lineTo(lg2.x1 - 2, lg2.y + 0.5); ctx.stroke();
          ctx.strokeStyle = 'rgba(52, 72, 98,' + (0.22 * lg2.wet).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(lg2.x0 + 2, lg2.y - 0.6); ctx.lineTo(lg2.x1 - 2, lg2.y - 0.6); ctx.stroke();
        }
        if (raining) { lg2.beadL += dt * 0.05 * density; lg2.beadR += dt * 0.05 * density; }
        var ends = [[lg2.x0 + 1, 'beadL'], [lg2.x1 - 1, 'beadR']];
        for (var e = 0; e < 2; e++) {
          var bx = ends[e][0], key = ends[e][1];
          var size = Math.min(1, lg2[key]);
          if (size > 0.15) {
            var br = 0.8 + size * 2.4;
            var sp = beadSp(br);
            ctx.drawImage(sp.c, bx - sp.s / 2, lg2.y + 0.5 + br * 0.9 - sp.s / 2, sp.s, sp.s * (1 + size * 0.25));
          }
          if (lg2[key] >= 1) {
            falls.push({ x: bx, y: lg2.y + 3, vy: 0, r: 2.4 });
            lg2[key] = 0;
          }
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
        if (landed) { splash(fd.x, fd.y, 1.1, 5); falls.splice(f, 1); continue; }
        var fs = beadSp(fd.r);
        ctx.drawImage(fs.c, fd.x - fs.s / 2, fd.y - fs.s * 0.65, fs.s, fs.s * 1.35);
      }

      // Splash droplets and crowns.
      ctx.fillStyle = 'rgba(60, 84, 114, 0.6)';
      for (var b = bits.length - 1; b >= 0; b--) {
        var bt = bits[b];
        bt.life += dt;
        if (bt.life > 0.45) { bits.splice(b, 1); continue; }
        bt.vy += 1500 * dt;
        bt.x += bt.vx * dt; bt.y += bt.vy * dt;
        ctx.globalAlpha = 1 - bt.life / 0.45;
        ctx.beginPath(); ctx.arc(bt.x, bt.y, bt.r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 0.8;
      for (var c = crowns.length - 1; c >= 0; c--) {
        var cr = crowns[c];
        cr.life += dt;
        if (cr.life > 0.16) { crowns.splice(c, 1); continue; }
        var cu = cr.life / 0.16;
        ctx.globalAlpha = 1 - cu;
        ctx.strokeStyle = 'rgba(60, 84, 114, 0.55)';
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y - 0.5, cr.w * (0.5 + cu), 1.2 + cu * 2.2, 0, Math.PI, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y - 1.2, cr.w * (0.4 + cu * 0.8), 1 + cu * 1.6, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Spray hanging over the ground where the rain hits hardest.
      var spray = ctx.createLinearGradient(0, H - 46, 0, H);
      spray.addColorStop(0, 'rgba(255,255,255,0)');
      spray.addColorStop(1, 'rgba(240,245,250,' + (0.5 * density).toFixed(3) + ')');
      ctx.fillStyle = spray;
      ctx.fillRect(0, H - 46, W, 46);
      // Puddle rings along the bottom: a dark ring and its lit inner edge.
      for (var r = rings.length - 1; r >= 0; r--) {
        var rg = rings[r];
        rg.life += dt;
        if (rg.life > 1) { rings.splice(r, 1); continue; }
        var ru = rg.life;
        var rr = rg.r * (0.3 + ru * 1.5);
        ctx.globalAlpha = (1 - ru) * 0.7;
        ctx.strokeStyle = 'rgba(50, 72, 100, 0.6)';
        ctx.beginPath(); ctx.ellipse(rg.x, rg.y, rr, rr * 0.24, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.ellipse(rg.x, rg.y + 0.8, rr * 0.8, rr * 0.18, 0, 0, Math.PI); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Water on the glass.
      gctx.clearRect(0, 0, glassCv.w, glassCv.h);
      var dry = raining ? 0 : smoothstep(0, 5, t - DURATION);
      for (var bI = beads.length - 1; bI >= 0; bI--) {
        var B = beads[bI];
        B.life += dt;
        if (!B.run && B.r > 4.2) { B.run = true; B.vy = 0; }
        if (B.run) {
          // Stop-start: water snags on the glass, then lets go.
          var stick = noise(B.wob, t * 1.6) > 0.15 ? 0.15 : 1;
          B.vy = lerp(B.vy, (40 + B.r * 18) * stick, clamp(dt * 6, 0, 1));
          B.y += B.vy * dt;
          B.x += noise(B.wob + 3, B.y * 0.04) * 14 * dt;
          if (B.y - B.trailAt > 7 + rng() * 6) {
            B.trailAt = B.y;
            var tr = B.r * (0.3 + rng() * 0.15);
            if (B.r > 2.6 && beads.length < 300) {
              beads.push({ x: B.x + (rng() - 0.5), y: B.y - B.r * 1.2, r: tr, vy: 0, run: false, life: 0, trailAt: 0, wob: rng() * 10, trail: true });
              B.r = Math.sqrt(Math.max(1, B.r * B.r - tr * tr * 0.5));
            }
          }
          // Gather up the beads in its path.
          for (var o = beads.length - 1; o >= 0; o--) {
            var O = beads[o];
            if (O === B || O.run || O.trail && B.y - O.y < 30) continue;
            var ox = O.x - B.x, oy = O.y - B.y;
            if (ox * ox + oy * oy < (B.r + O.r) * (B.r + O.r)) {
              B.r = Math.min(7.5, Math.sqrt(B.r * B.r + O.r * O.r));
              beads.splice(o, 1);
              if (o < bI) bI--;
            }
          }
          if (B.r < 3.4) B.run = false;
          if (B.y > H + 10) { beads.splice(bI, 1); continue; }
        } else if (B.trail || B.life > 25) {
          B.r -= dt * (B.trail ? 0.05 : 0.08);
        }
        if (dry > 0) B.r -= dt * 0.9 * dry;
        if (B.r < 0.7) { beads.splice(bI, 1); continue; }
        var spb = beadSp(B.r);
        var stretch = B.run ? 1 + clamp(B.vy / 220, 0, 0.45) : 1;
        gctx.drawImage(spb.c, B.x - spb.s / 2, B.y - spb.s * stretch / 2, spb.s, spb.s * stretch);
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

  /* #cgp-gem=snow, #cgp-gem=snow:heavy, #cgp-gem=rain, #cgp-gem=rain:heavy,
   * #cgp-gem=rain:thunder: play at once, whatever the weather. */
  P._checkHashPreview = function () {
    try {
      var m = /^#cgp-gem=(snow|rain)(?::(heavy|thunder))?$/i.exec(String(location.hash || ''));
      if (!m) return false;
      var id = m[1].toLowerCase();
      var how = (m[2] || '').toLowerCase();
      var self = this;
      setTimeout(function () { self.play(id, { heavy: !!how, thunder: how === 'thunder' }); }, 600);
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

    if (this._checkHashPreview()) return;
    if (!this.settings || !this.settings.values || this.settings.values.hiddenGems === false) return;
    if (prefersReducedMotion() || !CGP.hiddenGems) return;

    Promise.all([currentWeather(), readState()]).then(function (r) {
      var kind = r[0], state = r[1];
      if (!kind || !CGP.hiddenGems.weatherDue(state, Date.now(), { enabled: true, reducedMotion: prefersReducedMotion() })) return;
      // Let the page settle first, and play only if the teacher is still here.
      self._timer = setTimeout(function () {
        self._timer = null;
        if (document.hidden || !self.settings.values.hiddenGems || prefersReducedMotion()) return;
        withClaimLock(function (hasLock) {
          return readState().then(function (fresh) {
            var claimNow = Date.now();
            if (!CGP.hiddenGems.weatherDue(fresh, claimNow, { enabled: true })) return null;
            var claimId = claimNow + ':' + Math.random().toString(36).slice(2, 8);
            return writeState(Object.assign({}, fresh, { weatherShownAt: claimNow, weatherClaimId: claimId })).then(function (okWrite) {
              if (!okWrite || document.hidden) return null;
              var go = function () { return self._render(kind.id, { heavy: kind.heavy, thunder: kind.thunder }); };
              if (hasLock) return go();
              // Without Web Locks: play only if this window's claim won.
              return readState().then(function (verify) {
                return verify && verify.weatherClaimId === claimId ? go() : null;
              });
            });
          });
        });
      }, 8000 + Math.random() * 10000);
    }, function () { return null; });
  };

  CGP.HiddenGemsController = HiddenGemsController;
})();
