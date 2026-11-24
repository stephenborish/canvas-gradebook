/* Canvas Gradebook+ - Hidden Gems: the moving pictures.
 *
 * Three short pieces, each drawn by hand on a <canvas> every frame:
 *   murmuration  a cloud of starlings pours across the top of the page
 *   crane        a folded paper crane, in 3D, swoops across the page
 *   blossom      an ink plum branch paints itself into the top corner and blooms
 *
 * Rules every piece keeps: the stage never takes a click (pointer-events:
 * none; the pointer only matters by hovering), never takes focus, fades out
 * the moment the teacher types, ends on its own within ~25 seconds, and
 * removes every node, timer and listener when finished. Preview any piece
 * with #cgp-gem=<id> (or #cgp-gem=<id>:<subject>, or #cgp-gem=random) on a
 * Canvas course page. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.HiddenGemsController) return;

  var STORAGE_KEY = 'cgp.hiddenGems.state';
  var COURSES_CACHE_KEY = 'cgp.courses';
  var TAU = Math.PI * 2;

  /* ---------------------------------------------------------- course lookup */

  function readCurrentCourseName() {
    var links = document.querySelectorAll('#breadcrumbs a[href*="/courses/"], .ic-app-crumbs a[href*="/courses/"]');
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute('href') || '').split(/[?#]/)[0];
      if (/\/courses\/\d+\/?$/.test(href)) {
        var t = (links[i].textContent || '').trim();
        if (t) return t;
      }
    }
    var cur = document.querySelector('#breadcrumbs [aria-current="page"], .ic-app-crumbs [aria-current="page"]');
    if (cur && cur.textContent && cur.textContent.trim()) return cur.textContent.trim();
    return (document.title || '').trim();
  }

  var cachedUid = null;
  var uidInFlight = null;
  function resolveCurrentUserId() {
    if (cachedUid) return Promise.resolve(cachedUid);
    try {
      var envUid = CGP.diag && CGP.diag.facts && CGP.diag.facts.envUserId ? String(CGP.diag.facts.envUserId) : '';
      if (envUid) {
        cachedUid = envUid;
        return Promise.resolve(envUid);
      }
    } catch (e) { /* ignore */ }
    if (uidInFlight) return uidInFlight;
    if (CGP.CanvasApi && typeof CGP.CanvasApi.prototype.currentUser === 'function') {
      uidInFlight = new CGP.CanvasApi().currentUser()
        .then(function (u) {
          uidInFlight = null;
          if (u && u.id) { cachedUid = String(u.id); return cachedUid; }
          return null;
        }, function () {
          uidInFlight = null;
          return null;
        });
      return uidInFlight;
    }
    return Promise.resolve(null);
  }

  function loadCachedCourseNames() {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) { resolve([]); return; }
        chrome.storage.local.get(COURSES_CACHE_KEY, function (res) {
          if (chrome.runtime && chrome.runtime.lastError) { resolve([]); return; }
          var box = res && res[COURSES_CACHE_KEY];
          if (!box || box.origin !== location.origin) { resolve([]); return; }
          resolveCurrentUserId().then(function (uid) {
            resolve(CGP.hiddenGems.extractCachedCourseNames(box, location.origin, uid, Date.now()));
          }, function () { resolve([]); });
        });
      } catch (e) { resolve([]); }
    });
  }

  function resolveCurrentSubject(override) {
    if (override && CGP.hiddenGems.SUBJECT_LABELS[override]) {
      return Promise.resolve({ id: override, label: CGP.hiddenGems.SUBJECT_LABELS[override], source: 'override' });
    }
    var curName = readCurrentCourseName();
    var direct = CGP.hiddenGems.matchSubject(curName);
    if (direct) {
      return Promise.resolve({ id: direct, label: CGP.hiddenGems.SUBJECT_LABELS[direct], source: 'course' });
    }
    return loadCachedCourseNames().then(function (names) {
      return CGP.hiddenGems.detectSubject(curName, names);
    }, function () {
      return CGP.hiddenGems.detectSubject(curName, []);
    });
  }

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
  function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeInOutSine(t) { t = clamp(t, 0, 1); return -(Math.cos(Math.PI * t) - 1) / 2; }
  function easeOutBack(t) {
    t = clamp(t, 0, 1);
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
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

  function hexToRgb(hex) {
    var h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(rgb, a) {
    return 'rgba(' + Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]) + ',' + a + ')';
  }
  function mixRgb(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
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

    // Typing always wins: any real key press fades the piece away at once.
    on(document, 'keydown', function (e) {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      api.end(450);
    }, true);
    on(document, 'visibilitychange', function () {
      if (document.hidden) api.destroy();
    });

    return api;
  }

  /* ======================================================== PIECES (PLAYERS) */

  var PLAYERS = {};

  /* =========================================================== MURMURATION
   * A thousand-odd starlings cross the upper part of the page as one cloud.
   * Each bird chases its own spot on a long ribbon that twists, bends and
   * turns in 3D; where the ribbon turns edge-on the birds crowd into the
   * dark bands that roll through a real murmuration, and where it opens
   * they thin to a haze. Every bird lags its spot a little and is nudged by
   * turbulence, so the cloud flows like smoke instead of moving as a shape.
   * The pointer is a falcon: the cloud tears open around it. */

  PLAYERS.murmuration = function (session, props) {
    var rng = makeRng(props.seed);
    var noise = makeNoise(rng);
    var cv = session.canvas();
    var ctx = cv.ctx;
    var dir = props.direction === -1 ? -1 : 1;
    var CROSS = 19;                         // seconds for the cloud to cross
    var N = Math.round(clamp(cv.w * cv.h / 560, 1300, 2200));

    /* Every bird owns a spot on a long, thin 3D ribbon: s along its length,
     * v across its width, plus a little personal scatter. */
    var birds = [];
    for (var i = 0; i < N; i++) {
      var s = (rng() + rng() + rng()) / 3 - 0.5;           // denser in the middle
      var v = (rng() - 0.5);
      birds.push({
        s: s, v: v,
        jx: (rng() + rng() - 1) * 4, jy: (rng() + rng() - 1) * 3, jz: (rng() + rng() - 1) * 10,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, px: 0, py: 0,
        flap: rng() * TAU, flapHz: 8 + rng() * 4,
        glide: rng() * 100,
        size: 0.85 + rng() * 0.3,
        lag: 7 + rng() * 4
      });
    }

    // The ribbon's shape drifts on slow noise so every pass is different.
    function shape(t) {
      var W = cv.w, H = cv.h;
      var u = t / CROSS;
      var cxn = lerp(-0.3, 1.32, easeInOutSine(u) * 0.35 + u * 0.65);
      var n1 = noise(t * 0.11, 1.7), n2 = noise(t * 0.13, 5.1), n3 = noise(t * 0.09, 9.3), n4 = noise(t * 0.15, 13.7);
      var big = clamp(Math.min(W, 1500) / 1280, 0.7, 1.2);
      return {
        cx: dir === 1 ? cxn * W : (1 - cxn) * W,
        cy: H * (0.22 + 0.05 * Math.sin(t * 0.37 + 0.6)) + n4 * 36,
        L: (560 + 160 * Math.sin(t * 0.29 + 1.1) + 120 * n1) * big,      // length
        Wd: (190 + 60 * n2) * big,                                       // ribbon width (mostly in depth)
        bend: (110 + 70 * Math.sin(t * 0.41)) * big,                     // S-curve amplitude
        bendK: 1.4 + 0.6 * Math.sin(t * 0.23 + 2),
        bendPh: t * 0.55,
        twist0: t * 0.5 + n3 * 2.2,                                      // twist about the length
        twist1: 2.6 * Math.sin(t * 0.21 + 0.4),                          // how much the twist changes along the length
        yaw: 0.6 * Math.sin(t * 0.17 + 1.9) + n2 * 0.6,                  // turning the whole ribbon in depth
        tilt: dir * (-0.12 + 0.3 * Math.sin(t * 0.26 + 0.3) + n1 * 0.25) // tilting it on the page
      };
    }

    var S;
    function target(b, out) {
      var x = b.s * S.L;
      var y = Math.sin(b.s * Math.PI * S.bendK + S.bendPh) * S.bend * 0.5;
      var taper = Math.pow(Math.max(0, 1 - 4 * b.s * b.s), 0.65);
      var tw = S.twist0 + S.twist1 * b.s;
      var w = b.v * S.Wd * taper;
      y += Math.sin(tw) * w + b.jy;
      var z = Math.cos(tw) * w + b.jz;
      x += b.jx;
      // yaw (turn in depth), then tilt (rotate on the page)
      var cyw = Math.cos(S.yaw), syw = Math.sin(S.yaw);
      var x2 = x * cyw + z * syw, z2 = -x * syw + z * cyw;
      var ct = Math.cos(S.tilt), st = Math.sin(S.tilt);
      var persp = 900 / (900 + z2);
      out.x = S.cx + (x2 * ct - y * st) * persp;
      out.y = S.cy + (x2 * st + y * ct) * persp;
      out.z = z2;
    }

    var tmp = { x: 0, y: 0, z: 0 };
    S = shape(0);
    for (var b0 = 0; b0 < N; b0++) {
      target(birds[b0], tmp);
      birds[b0].x = tmp.x - dir * 60; birds[b0].y = tmp.y; birds[b0].z = tmp.z;
      birds[b0].px = birds[b0].x; birds[b0].py = birds[b0].y;
    }

    var buckets = [[], [], []];
    var INK = '#1b2128';

    session.loop(function (dt, t) {
      S = shape(t);
      var p = session.pointer;
      var hasPtr = p.seen && performance.now() - p.at < 4000;
      var anyOn = false;

      for (var i = 0; i < N; i++) {
        var b = birds[i];
        target(b, tmp);
        // Spring toward its spot with a little lag, so the cloud flows
        // like a fluid instead of moving like a stamp.
        var k = b.lag;
        var ax = (tmp.x - b.x) * k * k - b.vx * 2 * k * 0.55;
        var ay = (tmp.y - b.y) * k * k - b.vy * 2 * k * 0.55;
        ax += noise(b.x * 0.008, b.y * 0.008, t * 0.6) * 260;
        ay += noise(b.x * 0.008 + 40, b.y * 0.008, t * 0.6) * 260;
        if (hasPtr) {
          var hx = b.x - p.x, hy = b.y - p.y, h2 = hx * hx + hy * hy;
          if (h2 < 190 * 190) {
            var hd = Math.sqrt(h2) + 1;
            var scare = 1 - hd / 190;
            ax += (hx / hd) * 26000 * scare * scare;
            ay += (hy / hd) * 26000 * scare * scare;
          }
        }
        b.vx += ax * dt; b.vy += ay * dt;
        b.px = b.x; b.py = b.y;
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.z = tmp.z;
        b.flap += b.flapHz * TAU * dt;
        if (b.x > -30 && b.x < cv.w + 30 && b.y > -30 && b.y < cv.h + 30) anyOn = true;
      }

      ctx.clearRect(0, 0, cv.w, cv.h);
      buckets[0].length = 0; buckets[1].length = 0; buckets[2].length = 0;
      for (var m = 0; m < N; m++) {
        var bz = birds[m].z;
        buckets[bz > 45 ? 0 : (bz > -45 ? 1 : 2)].push(birds[m]);
      }
      ctx.strokeStyle = INK;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (var L = 0; L < 3; L++) {
        var layer = buckets[L];
        var scale = [0.74, 0.9, 1.1][L];
        // Wings: a soft gull-wing curve, beating; a bird heading toward or
        // away from you shows almost none, which is what makes the dark
        // bands roll through the cloud.
        ctx.globalAlpha = [0.5, 0.7, 0.9][L];
        ctx.lineWidth = 0.85 * scale;
        ctx.beginPath();
        for (var w = 0; w < layer.length; w++) {
          var B = layer[w];
          var s2 = 1.9 * scale * B.size;
          var dx = B.x - B.px, dy = B.y - B.py;
          var dl = Math.sqrt(dx * dx + dy * dy);
          var hxn = dl > 0.01 ? dx / dl : dir, hyn = dl > 0.01 ? dy / dl : 0;
          var face = clamp(dl / (dt * 160 + 0.0001), 0.2, 1);
          var gliding = noise(B.glide, t * 0.7) > 0.25;
          var beat = gliding ? 0.15 : Math.sin(B.flap);
          var span = s2 * (0.3 + 0.7 * face);
          var lift = beat * s2 * 0.7;
          var nx = -hyn, ny = hxn;
          var bx = B.x, by = B.y;
          var tx = bx - hxn * s2 * 0.45, ty = by - hyn * s2 * 0.45;
          ctx.moveTo(tx + nx * span, ty + ny * span - lift);
          ctx.quadraticCurveTo(bx + nx * span * 0.35, by + ny * span * 0.35 - s2 * 0.25, bx, by);
          ctx.quadraticCurveTo(bx - nx * span * 0.35, by - ny * span * 0.35 - s2 * 0.25, tx - nx * span, ty - ny * span - lift);
        }
        ctx.stroke();
        // Bodies.
        ctx.lineWidth = 1.45 * scale;
        ctx.beginPath();
        for (var c = 0; c < layer.length; c++) {
          var C = layer[c];
          var sc = 1.9 * scale * C.size;
          var ex = C.x - C.px, ey = C.y - C.py;
          var el = Math.sqrt(ex * ex + ey * ey);
          var ux = el > 0.01 ? ex / el : dir, uy = el > 0.01 ? ey / el : 0;
          ctx.moveTo(C.x - ux * sc * 0.6, C.y - uy * sc * 0.6);
          ctx.lineTo(C.x + ux * sc * 0.4, C.y + uy * sc * 0.4);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (t > 4 && !anyOn) return false;
      return t < 30;
    }, 900);
  };

  /* ================================================================= CRANE
   * A traditional folded paper crane, built as a real 3D model (body, neck,
   * head, tail, creased wings), printed with washi paper chosen for the
   * subject, lit from the upper left, and flown along a swooping 3D path:
   * it comes in small and far, sweeps close past you, then climbs away.
   * Its soft shadow falls on the page below it. Bring the pointer close and
   * it beats its wings and lifts away from it. */

  function paperTexture(paper, rng) {
    var S = 512;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    var base = hexToRgb(paper.color);
    var ink = hexToRgb(paper.print);
    // Base sheet with a faint wash of tone, like dyed washi.
    var grd = g.createLinearGradient(0, 0, S, S);
    grd.addColorStop(0, rgba(mixRgb(base, [255, 255, 255], 0.06), 1));
    grd.addColorStop(1, rgba(mixRgb(base, [0, 0, 0], 0.06), 1));
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = rgba(ink, 0.62);
    g.fillStyle = rgba(ink, 0.62);
    g.lineWidth = 3;
    g.lineCap = 'round';
    var x, y, r, k;
    var pat = paper.pattern;
    if (pat === 'seigaiha') {
      // Overlapping waves: rows of concentric half-circles.
      var R = 44;
      for (var row = -1; row < S / (R * 0.5) + 2; row++) {
        for (var col = -1; col < S / (R * 2) + 2; col++) {
          x = col * R * 2 + (row % 2 ? R : 0);
          y = row * R * 0.5;
          g.save();
          g.beginPath(); g.arc(x, y, R, Math.PI, TAU); g.closePath();
          g.fillStyle = rgba(mixRgb(base, [0, 0, 0], 0.04), 1);
          g.fill();
          for (k = 0; k < 4; k++) {
            g.beginPath(); g.arc(x, y, R - k * 10 - 2, Math.PI, TAU); g.stroke();
          }
          g.restore();
        }
      }
    } else if (pat === 'shippo') {
      r = 40;
      for (x = 0; x <= S + r; x += r) {
        for (y = 0; y <= S + r; y += r) {
          g.beginPath(); g.arc(x, y, r * 0.72, 0, TAU); g.stroke();
          g.beginPath(); g.arc(x + r / 2, y + r / 2, r * 0.72, 0, TAU); g.stroke();
        }
      }
    } else if (pat === 'asanoha') {
      // Hemp leaf: six-pointed stars in a triangular lattice.
      var a = 64, h = a * Math.sqrt(3) / 2;
      g.lineWidth = 2.2;
      for (var j = -1; j < S / h + 2; j++) {
        for (var i = -1; i < S / a + 2; i++) {
          x = i * a + (j % 2 ? a / 2 : 0); y = j * h;
          for (k = 0; k < 6; k++) {
            var ang = k * Math.PI / 3;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * a, y + Math.sin(ang) * a); g.stroke();
            var ang2 = ang + Math.PI / 6;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang2) * h * 0.667, y + Math.sin(ang2) * h * 0.667); g.stroke();
          }
        }
      }
    } else if (pat === 'hex') {
      r = 30;
      var hw = r * Math.sqrt(3);
      for (var hy = -1; hy < S / (r * 1.5) + 2; hy++) {
        for (var hx = -1; hx < S / hw + 2; hx++) {
          x = hx * hw + (hy % 2 ? hw / 2 : 0); y = hy * r * 1.5;
          g.beginPath();
          for (k = 0; k < 6; k++) {
            var ha = Math.PI / 6 + k * Math.PI / 3;
            g[k ? 'lineTo' : 'moveTo'](x + Math.cos(ha) * r * 0.8, y + Math.sin(ha) * r * 0.8);
          }
          g.closePath(); g.stroke();
          if ((hx + hy * 3) % 4 === 0) { g.beginPath(); g.arc(x, y, r * 0.42, 0, TAU); g.stroke(); }
        }
      }
    } else if (pat === 'grid') {
      g.lineWidth = 1.4;
      for (k = 0; k <= S; k += 16) {
        g.globalAlpha = (k % 64 === 0) ? 1 : 0.45;
        g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.stroke();
        g.beginPath(); g.moveTo(0, k); g.lineTo(S, k); g.stroke();
      }
      g.globalAlpha = 1;
    } else if (pat === 'stars') {
      for (k = 0; k < 90; k++) {
        x = rng() * S; y = rng() * S; r = 3 + rng() * 9;
        g.beginPath();
        for (var p = 0; p < 8; p++) {
          var rr = p % 2 ? r * 0.28 : r;
          var pa = p * Math.PI / 4;
          g[p ? 'lineTo' : 'moveTo'](x + Math.cos(pa) * rr, y + Math.sin(pa) * rr);
        }
        g.closePath(); g.fill();
      }
      for (k = 0; k < 260; k++) { g.beginPath(); g.arc(rng() * S, rng() * S, 0.8 + rng() * 1.6, 0, TAU); g.fill(); }
    } else if (pat === 'staff') {
      g.lineWidth = 1.6;
      for (y = 20; y < S; y += 96) {
        for (k = 0; k < 5; k++) { g.beginPath(); g.moveTo(0, y + k * 9); g.lineTo(S, y + k * 9); g.stroke(); }
        for (x = 24 + rng() * 30; x < S; x += 44 + rng() * 40) {
          var ny = y + Math.floor(rng() * 9) * 4.5;
          g.beginPath(); g.ellipse(x, ny, 7, 5, -0.4, 0, TAU); g.fill();
          g.beginPath(); g.moveTo(x + 6, ny - 1); g.lineTo(x + 6, ny - 30); g.stroke();
        }
      }
    } else if (pat === 'dots') {
      for (y = 0; y <= S; y += 36) {
        for (x = (y / 36) % 2 ? 18 : 0; x <= S; x += 36) { g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); }
      }
    } else {
      g.lineWidth = 7;
      for (k = -S; k < S * 2; k += 34) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k - S, S); g.stroke(); }
    }
    // Paper fibres and grain.
    for (k = 0; k < 1400; k++) {
      x = rng() * S; y = rng() * S;
      g.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)';
      g.lineWidth = 0.6 + rng();
      var fa = rng() * TAU, fl = 3 + rng() * 12;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(fa + 0.6) * fl * 0.5, y + Math.sin(fa + 0.6) * fl * 0.5, x + Math.cos(fa) * fl, y + Math.sin(fa) * fl); g.stroke();
    }
    return c;
  }

  /* The crane, in model space: x forward, y up, z to the crane's right.
   * Each face lists its corners, which part it belongs to (wings flap), and
   * which plane its paper print is laid out in. */
  function craneModel() {
    var V = {
      F: [0.62, 0.0, 0], R: [-0.62, 0.0, 0], T: [0, 0.13, 0], K: [0, -0.5, 0],
      SL: [0, -0.14, -0.2], SR: [0, -0.14, 0.2],
      NBl: [0.26, -0.34, -0.07], NBr: [0.26, -0.34, 0.07], NFl: [0.6, 0.02, -0.06], NFr: [0.6, 0.02, 0.06],
      N: [1.1, 0.95, 0], N2l: [1.0, 0.8, -0.03], N2r: [1.0, 0.8, 0.03], H: [1.38, 0.7, 0],
      TBl: [-0.26, -0.34, -0.07], TBr: [-0.26, -0.34, 0.07], TFl: [-0.6, 0.02, -0.06], TFr: [-0.6, 0.02, 0.06],
      Tt: [-1.3, 0.9, 0],
      WF: [0.46, 0.04, 0], WR: [-0.46, 0.04, 0], WM: [0.02, 0.11, 0],
      WTr: [-0.12, 0.04, 1.62], WTl: [-0.12, 0.04, -1.62],
      WCr: [0.18, 0.08, 0.5], WCl: [0.18, 0.08, -0.5]
    };
    var F = [
      // body
      ['F', 'T', 'SR', 'b', 'xy'], ['T', 'R', 'SR', 'b', 'xy'], ['F', 'SR', 'K', 'b', 'xy'], ['SR', 'R', 'K', 'b', 'xy'],
      ['F', 'SL', 'T', 'b', 'xy'], ['T', 'SL', 'R', 'b', 'xy'], ['F', 'K', 'SL', 'b', 'xy'], ['SL', 'K', 'R', 'b', 'xy'],
      // neck, head, tail (thin double layers)
      ['NBr', 'NFr', 'N', 'b', 'xy'], ['NBl', 'N', 'NFl', 'b', 'xy'],
      ['N2r', 'N', 'H', 'b', 'xy'], ['N2l', 'H', 'N', 'b', 'xy'],
      ['TBr', 'Tt', 'TFr', 'b', 'xy'], ['TBl', 'TFl', 'Tt', 'b', 'xy'],
      // wings: a front and back facet each side, meeting at a raised crease
      ['WF', 'WM', 'WCr', 'r', 'xz'], ['WCr', 'WM', 'WTr', 'r', 'xz'], ['WM', 'WR', 'WTr', 'r', 'xz'], ['WF', 'WCr', 'WTr', 'r', 'xz'],
      ['WF', 'WCl', 'WM', 'l', 'xz'], ['WCl', 'WTl', 'WM', 'l', 'xz'], ['WM', 'WTl', 'WR', 'l', 'xz'], ['WF', 'WTl', 'WCl', 'l', 'xz']
    ];
    return { V: V, F: F };
  }

  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  PLAYERS.crane = function (session, props) {
    var rng = makeRng(props.seed);
    var noise = makeNoise(rng);
    var paper = props.paper || { color: '#c4413a', print: '#f6e2c2', pattern: 'seigaiha' };
    var tex = paperTexture(paper, rng);
    var model = craneModel();
    var dir = props.direction === -1 ? -1 : 1;

    var shadowCv = session.canvas(null, 'is-multiply');
    var cv = session.canvas();
    var ctx = cv.ctx, sctx = shadowCv.ctx;

    // The flight: screen x and y as fractions of the window, z in pixels
    // toward you (bigger and closer) or away (smaller, further).
    var wobble = (rng() - 0.5) * 0.08;
    var KEYS = [
      [-0.3, 0.3, -380], [-0.08, 0.25, -330], [0.18, 0.28 + wobble, -210], [0.42, 0.44, 30],
      [0.62, 0.43, 140], [0.8, 0.3, 10], [1.0, 0.17, -190], [1.24, 0.07, -360], [1.42, 0.0, -440]
    ];
    function pathAt(u) {
      var n = KEYS.length - 3;
      var f = clamp(u, 0, 0.99999) * n;
      var i = Math.floor(f), t = f - i;
      var a = KEYS[i], b = KEYS[i + 1], c = KEYS[i + 2], d = KEYS[i + 3];
      var xn = catmull(a[0], b[0], c[0], d[0], t);
      return {
        x: (dir === 1 ? xn : 1 - xn) * cv.w,
        y: catmull(a[1], b[1], c[1], d[1], t) * cv.h,
        z: catmull(a[2], b[2], c[2], d[2], t)
      };
    }
    // Arc-length table so the crane flies at an even, unhurried speed.
    var LUT = [0], prev = pathAt(0), total = 0;
    for (var li = 1; li <= 400; li++) {
      var cur = pathAt(li / 400);
      total += Math.hypot(cur.x - prev.x, cur.y - prev.y, (cur.z - prev.z) * 0.6);
      LUT.push(total);
      prev = cur;
    }
    function uAtDist(d) {
      var lo = 0, hi = 400;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (LUT[mid] < d) lo = mid; else hi = mid; }
      var span = LUT[hi] - LUT[lo] || 1;
      return (lo + (d - LUT[lo]) / span) / 400;
    }

    var FOCAL = 1500;
    var unit = clamp(Math.min(cv.w, cv.h) / 17, 32, 52);   // pixels per model unit at z = 0
    var dist = 0;
    var speedBase = total / 14;
    var flapPhase = 0, flapAmt = 1, glideLift = 0.2;
    var dodge = { x: 0, y: 0 };
    var lastPos = pathAt(0), heading = null, bank = 0;
    var LIGHT = (function () { var l = [-0.45, 0.75, 0.55], m = Math.hypot(l[0], l[1], l[2]); return [l[0] / m, l[1] / m, l[2] / m]; })();
    var base = hexToRgb(paper.color);
    var verts = {};
    var faces = [];
    for (var fi = 0; fi < model.F.length; fi++) faces.push({ def: model.F[fi], pts: [[0, 0], [0, 0], [0, 0]], z: 0, shade: 1 });

    function norm(v) { var m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

    function texTri(c, p, uv) {
      // Map the paper texture onto one screen triangle (affine).
      var x0 = p[0][0], y0 = p[0][1], x1 = p[1][0], y1 = p[1][1], x2 = p[2][0], y2 = p[2][1];
      var u0 = uv[0][0], v0 = uv[0][1], u1 = uv[1][0], v1 = uv[1][1], u2 = uv[2][0], v2 = uv[2][1];
      var det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(det) < 1e-6) return;
      var a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
      var b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
      var cc = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
      var d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
      var e = x0 - a * u0 - cc * v0;
      var f = y0 - b * u0 - d * v0;
      c.save();
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineTo(x2, y2); c.closePath();
      c.clip();
      c.transform(a, b, cc, d, e, f);
      c.drawImage(tex, 0, 0);
      c.restore();
    }

    session.loop(function (dt, t) {
      var p = session.pointer;
      var hasPtr = p.seen && performance.now() - p.at < 3000;

      // Pointer nearby: dodge up and away, beating hard.
      var here = pathAt(uAtDist(dist));
      var scared = 0;
      if (hasPtr) {
        var dx = here.x + dodge.x - p.x, dy = here.y + dodge.y - p.y;
        var dd = Math.hypot(dx, dy);
        if (dd < 200) {
          scared = 1 - dd / 200;
          dodge.x += (dx / (dd + 1)) * 260 * scared * dt;
          dodge.y += (-Math.abs(dy / (dd + 1)) - 0.6) * 300 * scared * dt;
        }
      }
      dodge.x *= Math.pow(0.6, dt); dodge.y *= Math.pow(0.75, dt);

      dist += speedBase * (1 + scared * 0.6) * dt * (0.85 + 0.3 * (1 - flapAmt) );
      var u = uAtDist(dist);
      var pos = pathAt(u);
      pos.x += dodge.x; pos.y += dodge.y;

      // Orientation from the direction of travel; bank into turns.
      var vel = [pos.x - lastPos.x, -(pos.y - lastPos.y) * 0.45, (pos.z - lastPos.z) * 0.35];
      lastPos = pos;
      if (Math.hypot(vel[0], vel[1], vel[2]) > 0.01) {
        var nh = norm(vel);
        if (heading) {
          var turn = cross(heading, nh)[1];
          bank = lerp(bank, clamp(-turn * 55, -0.7, 0.7) + noise(t * 0.4, 3.3) * 0.18, clamp(dt * 3, 0, 1));
          heading = norm([lerp(heading[0], nh[0], clamp(dt * 5, 0, 1)), lerp(heading[1], nh[1], clamp(dt * 5, 0, 1)), lerp(heading[2], nh[2], clamp(dt * 5, 0, 1))]);
        } else heading = nh;
      }
      var fwd = heading || [dir, 0, 0];
      var right = norm(cross(fwd, [0, 1, 0]));
      var up = cross(right, fwd);
      var cb = Math.cos(bank), sb = Math.sin(bank);
      var up2 = [up[0] * cb + right[0] * sb, up[1] * cb + right[1] * sb, up[2] * cb + right[2] * sb];
      var right2 = cross(fwd, up2);

      // Wings: beat while climbing or startled, glide while descending.
      var climbing = fwd[1] > -0.02 ? 1 : 0;
      var wantFlap = Math.max(climbing * 0.9, scared > 0.05 ? 1 : 0, t < 1.2 ? 1 : 0);
      flapAmt = lerp(flapAmt, wantFlap, clamp(dt * 1.6, 0, 1));
      flapPhase += dt * TAU * (2.1 + scared * 1.4);
      var beat = Math.sin(flapPhase + 0.45 * Math.sin(flapPhase));   // quicker downstroke
      var wingA = lerp(glideLift + 0.05 * Math.sin(t * 1.3), 0.28 + 0.5 * beat, flapAmt);
      var bob = -beat * flapAmt * 0.05;

      var persp = FOCAL / (FOCAL - pos.z);
      var sc = unit * persp;
      // A fixed camera tilt so we look slightly down onto the crane's back.
      var tilt = 0.98, ct = Math.cos(tilt), st = Math.sin(tilt);

      var keys = Object.keys(model.V);
      for (var k = 0; k < keys.length; k++) {
        var name = keys[k];
        var m = model.V[name];
        var x = m[0], y = m[1] + bob, z = m[2];
        var side = name.charAt(0) === 'W' ? (z > 0.01 ? 1 : (z < -0.01 ? -1 : 0)) : 0;
        if (side) {
          var yy = y - bob - 0.04;
          var ca = Math.cos(wingA), sa = Math.sin(wingA);
          var ny2 = yy * ca + Math.abs(z) * sa;
          var nz2 = -yy * sa + Math.abs(z) * ca;
          y = ny2 + 0.04; z = nz2 * side;
        }
        // model -> world
        var wx = fwd[0] * x + up2[0] * y + right2[0] * z;
        var wy = fwd[1] * x + up2[1] * y + right2[1] * z;
        var wz = fwd[2] * x + up2[2] * y + right2[2] * z;
        // camera tilt (about the screen's x axis)
        var cy2 = wy * ct - wz * st;
        var cz2 = wy * st + wz * ct;
        var vp = verts[name] || (verts[name] = { x: 0, y: 0, z: 0, wx: 0, wy: 0, wz: 0 });
        vp.wx = wx; vp.wy = cy2; vp.wz = cz2;
        var pz = FOCAL / (FOCAL - (pos.z + cz2 * sc));
        vp.x = pos.x + wx * sc * pz / persp;
        vp.y = pos.y - cy2 * sc * pz / persp;
        vp.z = cz2;
      }

      for (var f = 0; f < faces.length; f++) {
        var fc = faces[f];
        var A = verts[fc.def[0]], Bv = verts[fc.def[1]], C = verts[fc.def[2]];
        fc.pts[0][0] = A.x; fc.pts[0][1] = A.y;
        fc.pts[1][0] = Bv.x; fc.pts[1][1] = Bv.y;
        fc.pts[2][0] = C.x; fc.pts[2][1] = C.y;
        fc.z = (A.z + Bv.z + C.z) / 3;
        var n = norm(cross([Bv.wx - A.wx, Bv.wy - A.wy, Bv.wz - A.wz], [C.wx - A.wx, C.wy - A.wy, C.wz - A.wz]));
        if (n[2] < 0) n = [-n[0], -n[1], -n[2]];          // paper is coloured on both outsides
        var lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        var hv = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
        var spec = Math.pow(Math.max(0, n[0] * hv[0] + n[1] * hv[1] + n[2] * hv[2]), 24);
        fc.shade = 0.46 + 0.78 * lam;
        fc.spec = spec * 0.35;
      }
      faces.sort(function (a, b) { return a.z - b.z; });

      // Shadow on the page: the same silhouette, offset by height, soft.
      sctx.clearRect(0, 0, shadowCv.w, shadowCv.h);
      var lift = 26 + (pos.z + 700) * 0.04;
      var shAlpha = clamp(0.16 * persp, 0.06, 0.2);
      sctx.save();
      sctx.filter = 'blur(' + (3 + lift * 0.05).toFixed(1) + 'px)';
      sctx.fillStyle = 'rgba(40,46,60,' + shAlpha.toFixed(3) + ')';
      sctx.beginPath();
      for (var s2 = 0; s2 < faces.length; s2++) {
        var sp = faces[s2].pts;
        var ox = lift * 0.35, oy = lift * 0.95;
        sctx.moveTo(sp[0][0] + ox, pos.y + oy + (sp[0][1] - pos.y) * 0.45);
        sctx.lineTo(sp[1][0] + ox, pos.y + oy + (sp[1][1] - pos.y) * 0.45);
        sctx.lineTo(sp[2][0] + ox, pos.y + oy + (sp[2][1] - pos.y) * 0.45);
        sctx.closePath();
      }
      sctx.fill('nonzero');
      sctx.restore();

      // The crane itself.
      ctx.clearRect(0, 0, cv.w, cv.h);
      ctx.lineJoin = 'round';
      for (var q = 0; q < faces.length; q++) {
        var face = faces[q];
        var pts = face.pts;
        var plane = face.def[4];
        var uv = [];
        for (var c = 0; c < 3; c++) {
          var mv = model.V[face.def[c]];
          var tu = mv[0], tv = plane === 'xz' ? mv[2] : mv[1];
          uv.push([(tu + 2) * 128, (tv + 2) * 128]);
        }
        texTri(ctx, pts, uv);
        // Light and shade over the print.
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0], pts[2][1]); ctx.closePath();
        if (face.shade < 1) ctx.fillStyle = 'rgba(18,14,26,' + (1 - face.shade).toFixed(3) + ')';
        else ctx.fillStyle = 'rgba(255,250,240,' + ((face.shade - 1) * 0.9).toFixed(3) + ')';
        ctx.fill();
        if (face.spec > 0.01) { ctx.fillStyle = 'rgba(255,255,255,' + face.spec.toFixed(3) + ')'; ctx.fill(); }
        // Crisp folds.
        ctx.strokeStyle = rgba(mixRgb(base, [0, 0, 0], 0.45), 0.55);
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      return dist < total * 0.985 && t < 25;
    }, 600);
  };

  /* =============================================================== BLOSSOM
   * A plum branch painted in ink, the way a sumi-e painter would: it enters
   * from the top corner of the page in angular, dry-brush strokes (each
   * bristle leaves its own trail, and the brush runs dry toward the end of a
   * stroke), moss dots are tapped along the bark, then the blossoms open one
   * by one, watercolour petals with fine ink stamens. A two-character
   * inscription, 暗香 ("hidden fragrance", from Lin Bu's plum poem), is
   * brushed beside it and stamped with a red seal. Petals loosen and drift
   * down the margin; sweep the pointer through the branch and more fall. */

  PLAYERS.blossom = function (session, props) {
    var rng = makeRng(props.seed);
    var noise = makeNoise(rng);
    var R = Math.round(clamp(window.innerWidth * 0.36, 300, 470));
    var H = window.innerHeight;
    var box = { right: 0, top: 0, width: R, height: H };
    var inkCv = session.canvas(box, 'is-multiply');
    var flCv = session.canvas(box);
    var ink = inkCv.ctx, fl = flCv.ctx;
    var DPR = inkCv.dpr;
    var INK = [24, 22, 28];
    var scale = clamp(R / 420, 0.78, 1.1);
    var red = rng() < 0.45;   // red plum, or the pale pink-white kind
    var petalIn = red ? [240, 132, 150] : [255, 242, 245];
    var petalOut = red ? [200, 40, 76] : [240, 168, 190];
    var petalLine = red ? [128, 18, 44] : [190, 80, 110];

    /* ---- composition: one angular trunk sagging in from the corner, boughs
     * alternating above and below it, thin straight new shoots off the
     * boughs (where plum flowers cluster). Times are when the brush gets there. */
    var limbs = [];
    var TOP = 16, BOTTOM = Math.min(H * 0.5, 400 * scale), LEFT = 18;
    function limb(x, y, ang, w0, w1, len, pieces, kink, t0, speed, depth) {
      var pts = [{ x: x, y: y }];
      var sign = rng() < 0.5 ? 1 : -1;
      for (var i = 0; i < pieces; i++) {
        var L = len / pieces * (0.7 + rng() * 0.6);
        if (i > 0) { ang += sign * kink * (0.6 + rng() * 0.8); sign = -sign; }
        var nx = x + Math.cos(ang) * L, ny = y + Math.sin(ang) * L;
        if (ny < TOP || ny > BOTTOM || nx < LEFT) {
          var toward = Math.atan2(clamp(ny, TOP + 30, BOTTOM - 30) - y, Math.max(LEFT + 30, nx) - x);
          ang = lerp(ang, toward, 0.75);
          nx = x + Math.cos(ang) * L; ny = y + Math.sin(ang) * L;
        }
        nx = clamp(nx, LEFT, R + 40); ny = clamp(ny, TOP, BOTTOM);
        pts.push({ x: nx, y: ny });
        x = nx; y = ny;
      }
      var lb = { pts: pts, w0: w0, w1: w1, t0: t0, depth: depth, seed: rng() * 100, samples: null, total: 0 };
      sampleLimb(lb);
      lb.t1 = t0 + lb.total / speed;
      limbs.push(lb);
      return lb;
    }
    /* Dense samples along a limb: each piece bows a little, as a hand-drawn
     * stroke would. Each sample knows its distance, width and direction. */
    function sampleLimb(lb) {
      var out = [], d = 0, prev = null;
      for (var i = 1; i < lb.pts.length; i++) {
        var a = lb.pts[i - 1], b = lb.pts[i];
        var L = Math.hypot(b.x - a.x, b.y - a.y);
        var bow = (rng() - 0.5) * 0.14 * L;
        var mx = (a.x + b.x) / 2 - (b.y - a.y) / L * bow, my = (a.y + b.y) / 2 + (b.x - a.x) / L * bow;
        var n = Math.max(2, Math.ceil(L / 1.2));
        for (var k = (i === 1 ? 0 : 1); k <= n; k++) {
          var u = k / n, iu = 1 - u;
          var px = iu * iu * a.x + 2 * iu * u * mx + u * u * b.x;
          var py = iu * iu * a.y + 2 * iu * u * my + u * u * b.y;
          if (prev) d += Math.hypot(px - prev.x, py - prev.y);
          prev = { x: px, y: py, d: d, joint: k === 0 || k === n };
          out.push(prev);
        }
      }
      lb.total = d || 1;
      for (var j = 0; j < out.length; j++) {
        var s = out[j];
        var p0 = out[Math.max(0, j - 3)], p1 = out[Math.min(out.length - 1, j + 3)];
        var tx = p1.x - p0.x, ty = p1.y - p0.y, tl = Math.hypot(tx, ty) || 1;
        s.tx = tx / tl; s.ty = ty / tl;
        var f = s.d / lb.total;
        var w = lerp(lb.w0, lb.w1, Math.pow(f, 0.85));
        w *= 1 + 0.1 * noise(lb.seed, s.d * 0.02);
        if (f < 0.05) w *= 1 + (0.05 - f) * 3;                  // the brush pressed down to start
        if (lb.depth > 0) w *= smoothstep(1.0, 0.7, f) * 0.75 + 0.25; // and lifted off to a point
        s.w = w; s.f = f;
      }
      lb.samples = out;
    }
    function pointOn(lb, f) {
      var S = lb.samples, target = f * lb.total;
      for (var i = 0; i < S.length; i++) {
        if (S[i].d >= target) {
          return { x: S[i].x, y: S[i].y, w: S[i].w, ang: Math.atan2(S[i].ty, S[i].tx), t: lb.t0 + (lb.t1 - lb.t0) * f };
        }
      }
      var e = S[S.length - 1];
      return { x: e.x, y: e.y, w: e.w, ang: Math.atan2(e.ty, e.tx), t: lb.t1 };
    }

    var startY = (70 + rng() * 60) * scale;
    var trunk = limb(R + 34, startY, Math.PI - 0.12 - rng() * 0.22, 24 * scale, 5 * scale, R * 0.9, 4, 0.36, 0.2, 170, 0);
    var nBough = 3 + Math.floor(rng() * 2);
    var upNext = rng() < 0.5;
    var shoots = [];
    for (var bI = 0; bI < nBough; bI++) {
      var at = pointOn(trunk, 0.18 + (bI + 0.2 + rng() * 0.6) / nBough * 0.74);
      var goUp = upNext; upNext = !upNext;
      // Up: rising and leaning back toward the corner's open side. Down: drooping.
      var bang = goUp ? -Math.PI / 2 - 0.2 - rng() * 0.6 : Math.PI - 0.75 - rng() * 0.45;
      var bough = limb(at.x, at.y, bang, at.w * 0.5, 2 * scale, (goUp ? 70 + rng() * 60 : 90 + rng() * 80) * scale,
        2 + Math.floor(rng() * 2), 0.26, at.t + 0.08, 210, 1);
      shoots.push(bough);
      var nt = 1 + Math.floor(rng() * 3);
      for (var tI = 0; tI < nt; tI++) {
        var tat = pointOn(bough, 0.3 + rng() * 0.6);
        var tang = rng() < 0.6 ? -Math.PI / 2 + (rng() - 0.5) * 0.9 : tat.ang + (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.4);
        shoots.push(limb(tat.x, tat.y, tang, Math.max(1.6, tat.w * 0.75), 0.6, (34 + rng() * 52) * scale, 1, 0, tat.t + 0.05, 300, 2));
      }
    }
    for (var sI = 0; sI < 2; sI++) {
      var sat = pointOn(trunk, 0.25 + rng() * 0.6);
      shoots.push(limb(sat.x, sat.y - sat.w * 0.3, -Math.PI / 2 + (rng() - 0.5) * 0.8, 2.6 * scale, 0.6, (44 + rng() * 50) * scale, 1, 0, sat.t + 0.1, 300, 2));
    }
    var growEnd = 0;
    for (var g = 0; g < limbs.length; g++) growEnd = Math.max(growEnd, limbs[g].t1);

    /* ---- paint every limb once, offscreen, as one continuous stroke */
    var full = document.createElement('canvas');
    full.width = inkCv.el.width; full.height = inkCv.el.height;
    var fx = full.getContext('2d');
    fx.scale(DPR, DPR);
    function outline(lb, grow) {
      var S = lb.samples, L = [], Rr = [];
      for (var i = 0; i < S.length; i++) {
        var s = S[i];
        var nx = -s.ty, ny = s.tx;
        var hl = s.w * 0.5 * (1 + 0.14 * noise(lb.seed + 3, s.d * 0.12)) + grow;
        var hr = s.w * 0.5 * (1 + 0.14 * noise(lb.seed + 7, s.d * 0.12)) + grow;
        L.push([s.x + nx * hl, s.y + ny * hl]);
        Rr.push([s.x - nx * hr, s.y - ny * hr]);
      }
      return { L: L, R: Rr };
    }
    function tracePoly(c, o, upto) {
      var n = upto == null ? o.L.length : upto;
      if (n < 2) return;
      c.moveTo(o.L[0][0], o.L[0][1]);
      for (var i = 1; i < n; i++) c.lineTo(o.L[i][0], o.L[i][1]);
      for (var j = n - 1; j >= 0; j--) c.lineTo(o.R[j][0], o.R[j][1]);
      c.closePath();
    }
    for (var li = 0; li < limbs.length; li++) {
      var lb = limbs[li];
      var o = outline(lb, 0);
      var tone = lb.depth === 0 ? 0.74 : (lb.depth === 1 ? 0.86 : 0.93);
      // Soft bleed of wet ink into the paper.
      fx.save();
      fx.filter = 'blur(' + (lb.depth === 0 ? 2.2 : 1.2) + 'px)';
      fx.fillStyle = rgba(INK, 0.22);
      fx.beginPath(); tracePoly(fx, outline(lb, 1.2)); fx.fill();
      fx.restore();
      // The stroke itself.
      fx.fillStyle = rgba(INK, tone);
      fx.beginPath(); tracePoly(fx, o); fx.fill();
      // Darker bone edges on the older wood, broken where the brush skipped.
      if (lb.depth < 2) {
        fx.strokeStyle = rgba(INK, 0.6);
        fx.lineWidth = lb.depth === 0 ? 1.4 : 1;
        fx.lineCap = 'round';
        var sides = [o.L, o.R];
        for (var sd = 0; sd < 2; sd++) {
          fx.beginPath();
          var on = false;
          for (var q = 0; q < sides[sd].length; q++) {
            var vis = noise(lb.seed + 11 + sd * 5, q * 0.03) > -0.15;
            if (vis && !on) { fx.moveTo(sides[sd][q][0], sides[sd][q][1]); on = true; }
            else if (vis) fx.lineTo(sides[sd][q][0], sides[sd][q][1]);
            else on = false;
          }
          fx.stroke();
        }
      }
      // Dry brush: streaks the bristles left bare, mostly late in the stroke.
      var S = lb.samples;
      var nbr = Math.max(5, Math.round(lb.w0 * 1.1));
      var dryBase = lb.depth === 0 ? 0.62 : (lb.depth === 1 ? 0.42 : 0.12);
      fx.save();
      fx.globalCompositeOperation = 'destination-out';
      fx.lineCap = 'round';
      for (var b = 0; b < nbr; b++) {
        var off = (b + 0.5) / nbr - 0.5;
        var edge = Math.abs(off) * 2;
        var bk = rng() * 80;
        fx.lineWidth = Math.max(0.45, lb.w0 / nbr * (0.45 + rng() * 0.5));
        fx.strokeStyle = 'rgba(0,0,0,' + (0.55 + rng() * 0.4).toFixed(2) + ')';
        fx.beginPath();
        var drawing = false;
        for (var si = 0; si < S.length; si++) {
          var sm = S[si];
          var dry = dryBase * smoothstep(0.05, 0.9, sm.f) + (lb.depth === 0 ? 0.12 : 0);
          var gap = noise(bk, sm.d * 0.03) * 0.5 + 0.5;
          var bare = gap < dry * (0.55 + edge * 0.7);
          var px = sm.x - sm.ty * off * sm.w * 0.92, py = sm.y + sm.tx * off * sm.w * 0.92;
          if (bare) { if (!drawing) { fx.moveTo(px, py); drawing = true; } else fx.lineTo(px, py); }
          else drawing = false;
        }
        fx.stroke();
      }
      fx.restore();
      lb.outline = outline(lb, 3);
    }

    /* ---- moss dots along the bark, tapped in after the branch */
    var dots = [];
    var mossT = growEnd + 0.2;
    for (var di = 0; di < limbs.length; di++) {
      var ml = limbs[di];
      if (ml.depth > 1) continue;
      var nd = ml.depth === 0 ? 5 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 2);
      for (var k = 0; k < nd; k++) {
        var mp = pointOn(ml, 0.1 + rng() * 0.8);
        var side = rng() < 0.5 ? -1 : 1;
        var sa = mp.ang + side * Math.PI / 2;
        var rr = (1 + rng() * 2.2) * scale * (ml.depth === 0 ? 1.15 : 0.85);
        dots.push({ x: mp.x + Math.cos(sa) * (mp.w * 0.5 + rr * 0.2), y: mp.y + Math.sin(sa) * (mp.w * 0.5 + rr * 0.2),
          r: rr, t: mossT + dots.length * 0.06, rot: rng() * TAU, sq: 0.6 + rng() * 0.3, k: rng() * 50 });
      }
    }
    function paintDot(c, dt, a) {
      c.save();
      c.translate(dt.x, dt.y);
      c.rotate(dt.rot);
      c.fillStyle = rgba(INK, 0.9 * a);
      c.beginPath();
      for (var i = 0; i <= 10; i++) {
        var an = i / 10 * TAU;
        var r = dt.r * (0.8 + 0.35 * noise(dt.k, i * 0.7));
        c[i ? 'lineTo' : 'moveTo'](Math.cos(an) * r, Math.sin(an) * r * dt.sq);
      }
      c.closePath(); c.fill();
      c.restore();
    }

    /* ---- blossoms and buds */
    var flowers = [];
    function addFlower(x, y, size, t, bud) {
      if (x < 8 || y < 8 || x > R - 4) return;
      for (var f = 0; f < flowers.length; f++) {
        var o = flowers[f];
        if (Math.hypot(o.x - x, o.y - y) < (o.r + size) * 0.85) return;
      }
      flowers.push({ x: x, y: y, r: size, t: t, bud: bud, rot: rng() * TAU, tilt: 0.6 + rng() * 0.4,
        tiltAng: rng() * TAU, sway: 0, swayV: 0, stamens: 9 + Math.floor(rng() * 6), seed: Math.floor(rng() * 1e9),
        side: rng() < 0.22 });
    }
    var bloomStart = growEnd * 0.4;
    for (var sh = 0; sh < shoots.length; sh++) {
      var lbs = shoots[sh];
      var count = (lbs.depth === 2 ? 2 : 2) + Math.floor(rng() * 3);
      for (var c = 0; c < count; c++) {
        var at2 = pointOn(lbs, 0.15 + rng() * 0.75);
        var off2 = (rng() - 0.5) * 2 * (at2.w * 0.5 + 5 * scale);
        var sa2 = at2.ang + Math.PI / 2;
        var bud = rng() < 0.2;
        addFlower(at2.x + Math.cos(sa2) * off2, at2.y + Math.sin(sa2) * off2, (bud ? 3.2 + rng() * 1.4 : 10 + rng() * 5) * scale,
          Math.max(bloomStart, at2.t) + 0.35 + rng() * 2, bud);
      }
      var tipP = pointOn(lbs, 1);
      if (lbs.depth === 2) addFlower(tipP.x, tipP.y, (2.6 + rng()) * scale, tipP.t + 0.3, true);
    }
    for (var c3 = 0; c3 < 3; c3++) {
      var at3 = pointOn(trunk, 0.3 + rng() * 0.6);
      addFlower(at3.x + (rng() - 0.5) * at3.w * 0.6, at3.y + (rng() < 0.5 ? -1 : 1) * at3.w * 0.55, (10.5 + rng() * 4) * scale,
        Math.max(bloomStart, at3.t) + 0.8 + rng(), false);
    }
    flowers.sort(function (a, b) { return a.t - b.t; });
    var lastBloom = 0;
    for (var lbI = 0; lbI < flowers.length; lbI++) lastBloom = Math.max(lastBloom, flowers[lbI].t);

    /* ---- inscription and seal, to one side of the trunk's root */
    var insX = R - 22 * scale;
    var insY = startY + 44 * scale;
    for (var tries = 0; tries < 30; tries++) {
      var clear = true;
      for (var f2 = 0; f2 < flowers.length; f2++) {
        if (Math.abs(flowers[f2].x - insX) < 26 * scale && flowers[f2].y > insY - 14 && flowers[f2].y < insY + 90 * scale) { clear = false; break; }
      }
      if (clear) break;
      insY += 10;
    }
    var insT = Math.max(growEnd + 1.2, lastBloom - 1.2);
    var sealT = insT + 1.4;
    var fontPx = Math.round(19 * scale);
    var FONT = fontPx + "px 'STKaiti','KaiTi','Kaiti SC','Kaiti TC','BiauKai','DFKai-SB','Noto Serif CJK SC','Noto Serif CJK JP','Songti SC','SimSun',serif";
    var glyphs = ['暗', '香'];
    var seal = (function () {
      var Sz = Math.round(22 * scale), pad = 2;
      var cnv = document.createElement('canvas');
      cnv.width = (Sz + pad * 2) * DPR; cnv.height = (Sz + pad * 2) * DPR;
      var sc = cnv.getContext('2d');
      sc.scale(DPR, DPR);
      sc.translate(pad, pad);
      sc.fillStyle = '#b02a22';
      sc.beginPath();
      sc.moveTo(0.6, 0.4); sc.lineTo(Sz - 0.3, 0.9); sc.lineTo(Sz - 0.8, Sz - 0.2); sc.lineTo(0.2, Sz - 0.6); sc.closePath();
      sc.fill();
      sc.globalCompositeOperation = 'destination-out';
      sc.font = 'bold ' + Math.round(Sz * 0.74) + "px 'Kaiti SC','KaiTi','STKaiti','Noto Serif CJK SC','Songti SC','SimSun',serif";
      sc.textAlign = 'center'; sc.textBaseline = 'middle';
      sc.fillStyle = '#000';
      sc.fillText('梅', Sz / 2, Sz / 2 + Sz * 0.05);
      for (var i = 0; i < 80; i++) {
        sc.globalAlpha = 0.3 + rng() * 0.7;
        var onEdge = rng() < 0.6;
        var ex = onEdge ? (rng() < 0.5 ? rng() * 2.2 : Sz - rng() * 2.2) : rng() * Sz;
        var ey = onEdge ? rng() * Sz : rng() * Sz;
        if (rng() < 0.5) { var tmp = ex; ex = ey; ey = tmp; }
        sc.fillRect(ex, ey, 0.5 + rng() * 1.5, 0.5 + rng() * 1.5);
      }
      return { el: cnv, size: Sz + pad * 2 };
    })();

    /* ---- one blossom */
    function drawFlower(f, open) {
      var r = f.r;
      fl.save();
      fl.translate(f.x, f.y);
      fl.rotate(f.tiltAng + f.sway);
      fl.scale(1, f.tilt);
      fl.rotate(f.rot - f.tiltAng);
      if (f.bud) {
        var br = r * lerp(0.2, 1, easeOutBack(open));
        fl.fillStyle = 'rgba(255,255,255,0.9)';
        fl.beginPath(); fl.arc(0, 0, br * 1.05, 0, TAU); fl.fill();
        fl.fillStyle = rgba([70, 38, 34], 0.9);
        fl.beginPath(); fl.ellipse(br * 0.55, br * 0.35, br * 0.6, br * 0.45, 0.6, 0, TAU); fl.fill();
        var gb = fl.createRadialGradient(-br * 0.3, -br * 0.3, br * 0.1, 0, 0, br);
        gb.addColorStop(0, rgba(petalIn, 0.95));
        gb.addColorStop(1, rgba(petalOut, 0.95));
        fl.fillStyle = gb;
        fl.beginPath(); fl.arc(0, 0, br, 0, TAU); fl.fill();
        fl.restore();
        return;
      }
      var e = easeOutBack(clamp(open * 1.05, 0, 1));
      var spread = f.side ? 0.55 : 1;
      var pr = r * 0.52 * e;
      var pd = r * 0.5 * Math.min(1, e);
      // The painter leaves the branch bare behind a flower: paper first.
      fl.fillStyle = 'rgba(255,255,255,' + (0.92 * Math.min(1, open * 1.6)).toFixed(3) + ')';
      for (var u0 = 0; u0 < 5; u0++) {
        var ua = u0 / 5 * TAU;
        fl.beginPath(); fl.ellipse(Math.cos(ua) * pd, Math.sin(ua) * pd * spread, pr * 0.96, pr * 0.88, ua, 0, TAU); fl.fill();
      }
      // Calyx, peeking out between the petals.
      fl.fillStyle = rgba([92, 40, 36], 0.85 * Math.min(1, open * 2));
      for (var cI = 0; cI < 5; cI++) {
        var ca = (cI + 0.5) / 5 * TAU;
        fl.beginPath(); fl.ellipse(Math.cos(ca) * r * 0.42 * e, Math.sin(ca) * r * 0.42 * e, r * 0.16, r * 0.11, ca, 0, TAU); fl.fill();
      }
      for (var p = 0; p < 5; p++) {
        var a = p / 5 * TAU;
        var cx = Math.cos(a) * pd, cy = Math.sin(a) * pd * spread;
        var grad = fl.createRadialGradient(0, 0, pr * 0.1, cx, cy, pr * 1.1);
        grad.addColorStop(0, rgba(mixRgb(petalIn, [255, 255, 255], red ? 0.15 : 0.3), 0.7));
        grad.addColorStop(0.7, rgba(mixRgb(petalIn, petalOut, 0.55), 0.78));
        grad.addColorStop(1, rgba(petalOut, 0.9));
        fl.fillStyle = grad;
        fl.beginPath();
        fl.ellipse(cx, cy, pr, pr * 0.92, a, 0, TAU);
        fl.fill();
        fl.strokeStyle = rgba(petalLine, 0.5);
        fl.lineWidth = 0.55;
        fl.beginPath();
        fl.ellipse(cx, cy, pr * 0.99, pr * 0.91, a, -1.7, 1.7);
        fl.stroke();
      }
      var sOpen = smoothstep(0.4, 1, open);
      if (sOpen > 0) {
        var srng = makeRng(f.seed);
        fl.fillStyle = rgba([214, 196, 92], 0.9);
        fl.beginPath(); fl.arc(0, 0, r * 0.14, 0, TAU); fl.fill();
        fl.strokeStyle = rgba([60, 26, 26], 0.8 * sOpen);
        fl.lineWidth = 0.5;
        fl.beginPath();
        var ends = [];
        for (var s = 0; s < f.stamens; s++) {
          var sa = s / f.stamens * TAU + srng() * 0.35;
          var sl = r * (0.4 + srng() * 0.3) * sOpen;
          var ex = Math.cos(sa) * sl, ey = Math.sin(sa) * sl * spread;
          fl.moveTo(Math.cos(sa) * r * 0.1, Math.sin(sa) * r * 0.1);
          fl.quadraticCurveTo(ex * 0.5 + Math.sin(sa) * 1.1, ey * 0.5 - Math.cos(sa) * 1.1, ex, ey);
          ends.push(ex, ey);
        }
        fl.stroke();
        fl.fillStyle = rgba(INK, 0.92 * sOpen);
        for (var q = 0; q < ends.length; q += 2) {
          fl.beginPath(); fl.arc(ends[q], ends[q + 1], 0.9, 0, TAU); fl.fill();
        }
      }
      fl.restore();
    }

    /* ---- falling petals */
    var falling = [];
    function loosen(f, n) {
      for (var i = 0; i < n; i++) {
        falling.push({ x: f.x + (rng() - 0.5) * f.r, y: f.y + (rng() - 0.5) * f.r, vx: -10 - rng() * 22, vy: 8 + rng() * 10,
          r: f.r * (0.42 + rng() * 0.14), rot: rng() * TAU, spin: (rng() - 0.5) * 2.4, tumble: rng() * TAU,
          tumbleHz: 0.35 + rng() * 0.5, sway: rng() * TAU, swayHz: 0.3 + rng() * 0.25 });
      }
    }
    function drawPetal(pt) {
      fl.save();
      fl.translate(pt.x, pt.y);
      fl.rotate(pt.rot);
      var flip = Math.cos(pt.tumble);
      fl.scale(Math.max(0.1, Math.abs(flip)), 1);
      var grad = fl.createRadialGradient(-pt.r * 0.5, 0, pt.r * 0.1, 0, 0, pt.r * 1.1);
      grad.addColorStop(0, rgba(mixRgb(petalIn, [255, 255, 255], 0.2), 0.75));
      grad.addColorStop(1, rgba(petalOut, flip > 0 ? 0.88 : 0.7));
      fl.fillStyle = grad;
      fl.beginPath();
      fl.moveTo(-pt.r, 0);
      fl.bezierCurveTo(-pt.r, -pt.r * 0.95, pt.r * 0.9, -pt.r * 0.95, pt.r, -pt.r * 0.14);
      fl.quadraticCurveTo(pt.r * 0.86, 0, pt.r, pt.r * 0.14);
      fl.bezierCurveTo(pt.r * 0.9, pt.r * 0.95, -pt.r, pt.r * 0.95, -pt.r, 0);
      fl.fill();
      fl.strokeStyle = rgba(petalLine, 0.35);
      fl.lineWidth = 0.5;
      fl.stroke();
      fl.restore();
    }

    var nextLoose = lastBloom + 0.6;
    var END = Math.max(17, sealT + 6.5);
    var revealedAll = false;

    session.loop(function (dt, t) {
      // 1. The brush: reveal each finished stroke as far as the brush has got.
      if (!revealedAll) {
        ink.clearRect(0, 0, inkCv.w, inkCv.h);
        ink.save();
        ink.beginPath();
        var all = true;
        for (var i = 0; i < limbs.length; i++) {
          var lb = limbs[i];
          if (t < lb.t0) { all = false; continue; }
          var u = easeInOutSine(clamp((t - lb.t0) / (lb.t1 - lb.t0), 0, 1));
          if (u < 1) all = false;
          var reach = u * lb.total;
          var n = 0;
          while (n < lb.samples.length && lb.samples[n].d <= reach) n++;
          tracePoly(ink, lb.outline, n);
        }
        ink.clip();
        ink.setTransform(1, 0, 0, 1, 0, 0);
        ink.drawImage(full, 0, 0);
        ink.restore();
        if (all) {
          revealedAll = true;
          ink.clearRect(0, 0, inkCv.w, inkCv.h);
          ink.save(); ink.setTransform(1, 0, 0, 1, 0, 0); ink.drawImage(full, 0, 0); ink.restore();
          full.width = 0; full.height = 0;
        }
      }
      // Moss dots go straight onto the painting once the branch is done.
      if (revealedAll) {
        for (var dI = 0; dI < dots.length; dI++) {
          if (!dots[dI].done && t >= dots[dI].t) { paintDot(ink, dots[dI], 1); dots[dI].done = true; }
        }
      }
      // 2. Inscription, brushed top to bottom, one character after the other.
      for (var gI = 0; gI < 2; gI++) {
        var gt = insT + gI * 0.6;
        if (t < gt || glyphs[gI] === null) continue;
        var gp = clamp((t - gt) / 0.5, 0, 1);
        var gy = insY + gI * fontPx * 1.1;
        ink.save();
        ink.beginPath();
        ink.rect(insX - fontPx, gy - 2 + fontPx * 1.2 * gp - 3, fontPx * 2, 4);
        ink.clip();
        ink.font = FONT;
        ink.textAlign = 'center';
        ink.textBaseline = 'top';
        ink.fillStyle = rgba(INK, 0.82);
        ink.fillText(glyphs[gI], insX, gy);
        ink.restore();
        if (gp >= 1) glyphs[gI] = null;
      }

      // 3. Blossoms, buds and falling petals.
      fl.clearRect(0, 0, flCv.w, flCv.h);
      var p = session.pointer;
      var px = p.x - (window.innerWidth - R), py = p.y;
      var gust = 0;
      if (p.seen && performance.now() - p.at < 120) {
        var sp = Math.hypot(p.vx, p.vy);
        if (sp > 220) gust = clamp(sp / 1400, 0, 1);
      }
      for (var k = 0; k < flowers.length; k++) {
        var f = flowers[k];
        if (t < f.t) continue;
        var open = clamp((t - f.t) / (f.bud ? 0.6 : 1.3), 0, 1);
        if (gust && Math.hypot(f.x - px, f.y - py) < 80) {
          f.swayV += (rng() - 0.5) * 7 * gust;
          if (!f.bud && open >= 1 && rng() < 0.4 * gust && t < END - 2) loosen(f, 1 + Math.floor(rng() * 2));
        }
        f.swayV += (-f.sway * 38 - f.swayV * 3.5) * dt;
        f.sway += f.swayV * dt;
        drawFlower(f, open);
      }
      if (t > nextLoose && t < END - 3) {
        var opened = flowers.filter(function (o) { return !o.bud && t > o.t + 1.3; });
        if (opened.length) loosen(opened[Math.floor(rng() * opened.length)], 1);
        nextLoose = t + 0.6 + rng() * 1.4;
      }
      for (var m = falling.length - 1; m >= 0; m--) {
        var pt = falling[m];
        pt.sway += pt.swayHz * TAU * dt;
        pt.tumble += pt.tumbleHz * TAU * dt;
        pt.rot += pt.spin * dt;
        // Flutter: a petal falls fastest edge-on and drifts when flat.
        var flat = Math.abs(Math.cos(pt.tumble));
        pt.vy = lerp(pt.vy, 22 + 30 * (1 - flat), clamp(dt * 2, 0, 1));
        pt.x += (pt.vx + Math.sin(pt.sway) * 30) * dt;
        pt.y += pt.vy * dt;
        if (pt.y > flCv.h + 20 || pt.x < -30) { falling.splice(m, 1); continue; }
        drawPetal(pt);
      }

      // 4. The seal, pressed once.
      if (t >= sealT) {
        var sp2 = clamp((t - sealT) / 0.3, 0, 1);
        var ssz = seal.size * lerp(1.3, 1, easeOutCubic(sp2));
        fl.save();
        fl.globalAlpha = 0.92 * easeOutCubic(sp2);
        fl.translate(insX, insY + fontPx * 2.35 + seal.size * 0.5);
        fl.rotate(-0.035);
        fl.drawImage(seal.el, -ssz / 2, -ssz / 2, ssz, ssz);
        fl.restore();
      }

      // 5. The painting fades into the page like ink drying.
      if (t > END) {
        var fade = clamp(1 - (t - END) / 2.6, 0, 1);
        session.stage.style.opacity = fade.toFixed(3);
        if (fade <= 0) return false;
      }
      return true;
    }, 0);
  };

  /* ============================================================= CONTROLLER */

  function HiddenGemsController(ctx) {
    this.settings = ctx.settings;
    this._active = null;
    this._timer = null;
    this._started = false;
  }

  var P = HiddenGemsController.prototype;

  P._render = function (id, subject, props) {
    if (this._active) {
      this._active.destroy();
      this._active = null;
    }
    var self = this;
    var session = createSession(function (s) { if (self._active === s) self._active = null; });
    this._active = session;
    try {
      PLAYERS[id](session, props);
    } catch (e) {
      session.destroy();
      if (CGP.diag) CGP.diag.error('hiddenGems.playFailed', { gem: id, message: String(e && e.message) });
      return null;
    }
    if (CGP.diag) CGP.diag.log('hiddenGems.played', { gem: id, subject: subject.id, source: subject.source });
    return { gem: id, subject: subject };
  };

  P.play = function (gemId, subjectOverride, opts) {
    if (!CGP.hiddenGems) return Promise.resolve(null);
    var self = this;
    var id = PLAYERS[gemId] ? gemId : CGP.hiddenGems.pickGem(null);
    return resolveCurrentSubject(subjectOverride).then(function (subject) {
      var props = CGP.hiddenGems.contentFor(id, subject.id, undefined, opts);
      return self._render(id, subject, props);
    });
  };

  P.stop = function () {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._active) { this._active.destroy(); this._active = null; }
  };

  P._checkHashPreview = function () {
    try {
      var m = /^#cgp-gem=([a-z]+)(?::([a-z]+))?$/i.exec(String(location.hash || ''));
      if (!m) return false;
      var gem = m[1].toLowerCase();
      var subj = m[2] ? m[2].toLowerCase() : null;
      var self = this;
      setTimeout(function () { self.play(gem === 'random' ? null : gem, subj); }, 600);
      return true;
    } catch (e) { return false; }
  };

  P.start = function () {
    if (this._started) return;
    this._started = true;
    var self = this;

    if (CGP.hiddenGems) {
      CGP.hiddenGems.play = function (gemId, subjectOverride) {
        return self.play(gemId, subjectOverride);
      };
    }

    if (this.settings && this.settings.onChange) {
      this.settings.onChange(function () {
        if (self.settings.values && self.settings.values.hiddenGems === false) self.stop();
      });
    }

    if (this._checkHashPreview()) return;

    if (!this.settings || !this.settings.values || this.settings.values.hiddenGems === false) return;
    if (prefersReducedMotion()) return;

    readState().then(function (state) {
      if (document.hidden) return;
      if (!self.settings.values.hiddenGems) return;
      var now = Date.now();
      if (!CGP.hiddenGems.shouldTrigger(state, now, { enabled: true, reducedMotion: prefersReducedMotion() })) return;
      var delay = CGP.hiddenGems.nextDelayMs();
      self._timer = setTimeout(function () {
        self._timer = null;
        if (document.hidden || !self.settings.values.hiddenGems || prefersReducedMotion()) return;
        withClaimLock(function (hasLock) {
          return readState().then(function (fresh) {
            if (document.hidden || !self.settings.values.hiddenGems || prefersReducedMotion()) return null;
            var claimNow = Date.now();
            if (!CGP.hiddenGems.isCooldownClear(fresh, claimNow, { enabled: true, reducedMotion: false })) return null;
            var recentGems = Array.isArray(fresh && fresh.recentGems) ? fresh.recentGems.slice(-4) : (fresh && fresh.lastGemId ? [fresh.lastGemId] : []);
            var gemId = CGP.hiddenGems.pickGem(recentGems);
            return resolveCurrentSubject(null).then(function (subject) {
              if (document.hidden || !self.settings.values.hiddenGems || prefersReducedMotion()) return null;
              var props = CGP.hiddenGems.contentFor(gemId, subject.id);
              var nextGems = recentGems.concat([gemId]).slice(-4);
              var claimId = claimNow + ':' + Math.random().toString(36).slice(2, 8);
              return writeState({
                lastShownAt: claimNow,
                lastGemId: gemId,
                recentGems: nextGems,
                claimId: claimId
              }).then(function (okWrite) {
                if (!okWrite || document.hidden || !self.settings.values.hiddenGems) return null;
                if (hasLock) return self._render(gemId, subject, props);
                // Fallback when Web Locks API is unavailable: verify our claim won.
                return readState().then(function (verify) {
                  if (!verify || verify.claimId !== claimId || document.hidden || !self.settings.values.hiddenGems) return null;
                  return self._render(gemId, subject, props);
                });
              });
            });
          });
        });
      }, delay);
    });
  };

  CGP.HiddenGemsController = HiddenGemsController;
})();
