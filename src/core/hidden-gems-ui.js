/* Canvas Gradebook+ - Hidden Gems: the pieces.
 *
 *   gravity  the page on screen breaks into tiles that fall, pile up at the
 *            bottom of the window and fly back into place
 *
 * Rules every piece keeps: the stage never takes a click (pointer-events:
 * none; the pointer only matters by hovering), never takes focus, ends at
 * once on any key, click or scroll, ends on its own within ~20 seconds, and
 * removes every node, timer and listener when finished, handing back any
 * part of the page it borrowed. Preview with #cgp-gem=<id> or
 * #cgp-gem=random on a Canvas course page. */
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

  /* Cheap smooth 1D noise, about -1..1, for tremors. */
  function noise1(seed, x) {
    var i = Math.floor(x), f = x - i;
    function h(n) { var v = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; }
    var u = f * f * (3 - 2 * f);
    return lerp(h(i), h(i + 1), u);
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

  /* ================================================================ GRAVITY
   * The page you are looking at falls apart. Every button, link, heading,
   * icon, table cell and menu item on screen shivers, breaks loose and
   * tumbles to the bottom of the window, bouncing and piling up. Swipe the
   * pointer through the heap to bat pieces into the air. Then each piece
   * lifts off the pile and flies home, and the page is exactly as it was.
   *
   * Nothing on the page is moved or rewritten. Each piece is drawn by a
   * look-alike copy in the stage (its computed look copied onto it), while
   * the original is only made invisible (visibility, which never changes
   * layout) until its copy lands back on top of it. */

  var GRAV_SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, HEAD: 1, META: 1, LINK: 1, BR: 1, OPTION: 1, OBJECT: 1, EMBED: 1 };
  var GRAV_ATOMIC = { IMG: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, svg: 1, SVG: 1, I: 1, LABEL: 1, H1: 1, H2: 1, H3: 1, H4: 1 };
  var GRAV_PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'line-height',
    'letter-spacing', 'word-spacing', 'text-transform', 'text-decoration-line', 'text-decoration-color',
    'text-decoration-style', 'text-align', 'text-indent', 'text-shadow', 'white-space', 'text-overflow',
    'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'background-clip', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'box-shadow', 'box-sizing', 'display',
    'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'vertical-align', 'overflow',
    'fill', 'stroke', 'stroke-width', 'opacity', 'list-style-type', 'object-fit', 'width', 'height',
    'min-width', 'min-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'float', 'cursor'
  ];

  function ownText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    }
    return false;
  }

  /* The pieces: the smallest things on screen that still read as one thing. */
  function collectPieces(stage, limit, rng) {
    var W = window.innerWidth, H = window.innerHeight;
    var out = [];
    var visited = 0;
    function walk(el) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (++visited > 20000) return;
        if (c === stage || GRAV_SKIP[c.tagName]) continue;
        if (c.id && /^cgp-tour/.test(c.id)) continue;
        var cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.05) continue;
        var r = c.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) { walk(c); continue; }   // display: contents and friends
        if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
        var atomic = GRAV_ATOMIC[c.tagName] || ownText(c);
        if (!atomic && !c.firstElementChild && r.width * r.height < 4000 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') atomic = true;
        if (atomic && r.width <= W * 0.75 && r.height <= 150 && r.width >= 3 && r.height >= 3) {
          // Only pieces that are actually on screen and not tucked under a
          // scrolled-away part of their container.
          var cx = clamp(r.left + r.width / 2, 0, W - 1), cy = clamp(r.top + r.height / 2, 0, H - 1);
          var hit = document.elementFromPoint(cx, cy);
          if (hit && (hit === c || c.contains(hit) || hit.contains(c))) out.push({ el: c, rect: r, cs: cs });
          continue;
        }
        if (c.tagName === 'svg' || c.tagName === 'SVG') continue;
        walk(c);
      }
    }
    walk(document.body);
    if (out.length > limit) {
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      out.length = limit;
    }
    return out;
  }

  function copyLook(src, dst, cs) {
    var style = cs || getComputedStyle(src);
    var css = '';
    for (var i = 0; i < GRAV_PROPS.length; i++) {
      var v = style.getPropertyValue(GRAV_PROPS[i]);
      if (v) css += GRAV_PROPS[i] + ':' + v + ';';
    }
    dst.style.cssText = css;
    var sk = src.children, dk = dst.children;
    for (var k = 0; k < sk.length && k < dk.length && k < 60; k++) copyLook(sk[k], dk[k]);
  }

  function opaque(color) {
    var m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return false;
    var parts = m[1].split(',');
    return parts.length < 4 || parseFloat(parts[3]) > 0.5;
  }
  function pageColorBehind(el) {
    for (var p = el.parentElement; p; p = p.parentElement) {
      var bg = getComputedStyle(p).backgroundColor;
      if (opaque(bg)) return bg;
    }
    return '#fff';
  }

  function makeCopy(piece) {
    var el = piece.el, r = piece.rect, cs = piece.cs;
    var copy = el.cloneNode(true);
    copyLook(el, copy, cs);
    if (copy.removeAttribute) {
      copy.removeAttribute('id');
      var withId = copy.querySelectorAll ? copy.querySelectorAll('[id]') : [];
      for (var i = 0; i < withId.length; i++) withId[i].removeAttribute('id');
    }
    if ('value' in el && 'value' in copy) { try { copy.value = el.value; } catch (e) { /* ignore */ } }
    var disp = cs.display;
    var block = disp.indexOf('table') === 0 || disp === 'inline' || disp === 'list-item' || disp === 'contents';
    if (block && cs.verticalAlign === 'middle' && disp.indexOf('table') === 0) {
      copy.style.display = 'flex';
      copy.style.alignItems = 'center';
      copy.style.justifyContent = cs.textAlign === 'center' ? 'center' : (cs.textAlign === 'right' || cs.textAlign === 'end' ? 'flex-end' : 'flex-start');
    } else if (block) {
      copy.style.display = 'block';
    }
    copy.style.position = 'absolute';
    copy.style.left = r.left + 'px';
    copy.style.top = r.top + 'px';
    copy.style.width = r.width + 'px';
    copy.style.height = r.height + 'px';
    copy.style.boxSizing = 'border-box';
    copy.style.margin = '0';
    copy.style.transformOrigin = '50% 50%';
    copy.style.pointerEvents = 'none';
    copy.style.overflow = 'hidden';
    copy.setAttribute('inert', '');
    copy.classList.add('cgp-gem-piece');
    // A piece that breaks off the page takes its patch of the page with it.
    if (!opaque(cs.backgroundColor) && cs.backgroundImage === 'none') copy.style.backgroundColor = pageColorBehind(el);
    return copy;
  }

  PLAYERS.gravity = function (session, props) {
    var rng = makeRng(props.seed);
    var W = window.innerWidth, H = window.innerHeight;
    var found = collectPieces(session.stage, Math.round(clamp(W * H / 9000, 60, 120)), rng);
    if (found.length < 8) { session.end(0); return; }

    var layer = document.createElement('div');
    layer.className = 'cgp-gem-layer';
    session.stage.appendChild(layer);
    var dustCv = session.canvas();
    var dctx = dustCv.ctx;
    var dust = [];
    var jolt = 0;
    function puff(x, y, w, power) {
      var n = Math.round(clamp(power * w / 60, 3, 22));
      for (var k = 0; k < n; k++) {
        var side = rng() < 0.5 ? -1 : 1;
        dust.push({ x: x + rng() * w, y: y - rng() * 3, vx: side * (30 + rng() * 140) * power, vy: -(20 + rng() * 90) * power,
          r: 1.5 + rng() * 3.5, life: 0, max: 0.5 + rng() * 0.6 });
      }
    }

    var bodies = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < found.length; i++) {
      var p = found[i];
      var copy;
      try { copy = makeCopy(p); } catch (e) { continue; }
      frag.appendChild(copy);
      var r = p.rect;
      var small = Math.min(r.width, r.height);
      bodies.push({
        el: p.el, copy: copy,
        x0: r.left, y0: r.top, w: r.width, h: r.height,
        x: r.left, y: r.top, vx: 0, vy: 0, ang: 0, av: 0, rest: 0,
        state: 'hold', hidden: false,
        release: 0, shake: rng() * 100,
        spin: clamp(14 / Math.sqrt(Math.max(16, small * Math.max(r.width, r.height)) / 8), 0.6, 7)
      });
    }
    layer.appendChild(frag);

    /* Hand the real page over to the copies, and always hand it back. */
    function hide(b) {
      if (b.hidden) return;
      b.prevVis = b.el.style.getPropertyValue('visibility');
      b.prevPri = b.el.style.getPropertyPriority('visibility');
      b.el.style.setProperty('visibility', 'hidden', 'important');
      b.hidden = true;
    }
    function show(b) {
      if (!b.hidden) return;
      if (b.prevVis) b.el.style.setProperty('visibility', b.prevVis, b.prevPri);
      else b.el.style.removeProperty('visibility');
      if (!b.el.getAttribute('style')) b.el.removeAttribute('style');
      b.hidden = false;
    }
    session.onDestroy(function () { for (var k = 0; k < bodies.length; k++) show(bodies[k]); });
    for (var h = 0; h < bodies.length; h++) hide(bodies[h]);

    /* The order things give way: the bottom of the page first, so the rest
     * rains down on top of it, with enough jitter to feel like a collapse. */
    var order = bodies.slice().sort(function (a, b) { return (b.y0 + b.h) - (a.y0 + a.h); });
    var SHAKE_T = 0.9;
    for (var o = 0; o < order.length; o++) {
      var f = o / order.length;
      order[o].release = SHAKE_T + Math.pow(f, 0.8) * 2.1 + rng() * 0.35;
    }

    /* The floor: a height map in 4px columns that rises as pieces settle. */
    var COL = 4, NCOL = Math.ceil(W / COL) + 1;
    var floor = new Float32Array(NCOL);
    function rebuildFloor() {
      for (var c = 0; c < NCOL; c++) floor[c] = H;
      var piled = bodies.filter(function (b) { return b.state === 'pile'; });
      piled.sort(function (a, b) { return b.y - a.y; });
      for (var k = 0; k < piled.length; k++) {
        var pb = piled[k];
        var c0 = Math.max(0, Math.floor(pb.x / COL)), c1 = Math.min(NCOL - 1, Math.floor((pb.x + pb.w) / COL));
        for (var cc = c0; cc <= c1; cc++) floor[cc] = Math.min(floor[cc], pb.y + Math.min(4, pb.h * 0.15));
      }
    }
    rebuildFloor();
    function surfaceUnder(b) {
      var c0 = Math.max(0, Math.floor((b.x + 2) / COL)), c1 = Math.min(NCOL - 1, Math.floor((b.x + b.w - 2) / COL));
      var s = H;
      for (var c = c0; c <= c1; c++) if (floor[c] < s) s = floor[c];
      return s;
    }
    function settle(b) {
      b.state = 'pile';
      b.vx = 0; b.vy = 0; b.av = 0;
      // Lean a little, the way things land on an uneven heap.
      b.restAng = b.w > 220 ? (rng() - 0.5) * 0.04 : (rng() - 0.5) * 0.22;
      var c0 = Math.max(0, Math.floor(b.x / COL)), c1 = Math.min(NCOL - 1, Math.floor((b.x + b.w) / COL));
      for (var c = c0; c <= c1; c++) floor[c] = Math.min(floor[c], b.y + Math.min(4, b.h * 0.15));
      b.copy.classList.remove('is-flying');
      b.copy.classList.add('is-piled');
    }
    function loosen(b) {
      if (b.state !== 'pile') return;
      b.state = 'fall';
      b.copy.classList.add('is-flying');
      b.copy.classList.remove('is-piled');
      // Anything resting on it comes down too.
      for (var k = 0; k < bodies.length; k++) {
        var o2 = bodies[k];
        if (o2.state === 'pile' && o2.y < b.y && o2.x < b.x + b.w && o2.x + o2.w > b.x) loosen(o2);
      }
    }

    var returning = false, returnStart = 0, quick = false;
    var holdUntil = 9.5;
    var lastPlay = -10;
    var GRAVITY = 2600;

    function startReturn(t, fast) {
      if (returning && !fast) return;
      if (returning && fast && quick) return;
      returning = true; quick = !!fast;
      returnStart = t;
      // Top of the heap first, so the pile unbuilds itself.
      var seq = bodies.filter(function (b) { return b.state !== 'home'; });
      seq.sort(function (a, b) { return a.y - b.y; });
      for (var k = 0; k < seq.length; k++) {
        var b = seq[k];
        if (b.state === 'return' && !fast) continue;
        b.state = 'return';
        b.fromX = b.x; b.fromY = b.y; b.fromAng = b.ang;
        b.retAt = t + (fast ? 0 : (k / Math.max(1, seq.length)) * 1.5);
        b.retDur = fast ? 0.32 : 0.75 + rng() * 0.3;
        b.copy.classList.add('is-flying');
      }
    }

    var nowT = 0;
    var instant = false;
    session.dismiss = function (why) {
      if (why === 'scroll' || why === 'resize') {
        // The page moved under us: give it back this instant.
        instant = true;
        session.destroy();
        return;
      }
      startReturn(nowT, true);
    };

    session.loop(function (dt, t) {
      nowT = t;
      var ptr = session.pointer;
      var live = ptr.seen && performance.now() - ptr.at < 90;
      var pv = live ? Math.hypot(ptr.vx, ptr.vy) : 0;
      if (pv > 300 && t > SHAKE_T) lastPlay = t;
      if (!returning && t > holdUntil && t - lastPlay > 1.6) startReturn(t, false);
      if (!returning && t > 18) startReturn(t, false);

      var home = 0;
      for (var k = 0; k < bodies.length; k++) {
        var b = bodies[k];
        if (b.state === 'home') { home++; continue; }

        if (b.state === 'hold') {
          if (t >= b.release) {
            b.state = 'fall';
            b.vx = (rng() - 0.5) * 300;
            b.vy = -60 - rng() * 200;
            b.av = (rng() - 0.5) * b.spin;
            b.copy.classList.add('is-flying');
          } else {
            // The tremor before the fall: building as release nears.
            var q = smoothstep(0, b.release, t) * 1.6;
            var nx = noise1(b.shake, t * 18) * q, ny = noise1(b.shake + 9, t * 18) * q;
            b.x = b.x0 + nx; b.y = b.y0 + ny; b.ang = noise1(b.shake + 4, t * 14) * q * 0.012;
          }
        } else if (b.state === 'fall') {
          b.vy += GRAVITY * dt;
          b.vx *= Math.pow(0.7, dt);
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.ang += b.av * dt;
          if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx) * 0.5; }
          if (b.x + b.w > W) { b.x = W - b.w; b.vx = -Math.abs(b.vx) * 0.5; }
          var s = surfaceUnder(b);
          // A heap never climbs past half the window: anything more drops
          // out of sight and comes home from below.
          if (s < H * 0.55) s = H + 400;
          if (b.y > H + 300) { b.state = 'gone'; b.y = H + 300; b.vx = 0; b.vy = 0; }
          if (b.y + b.h >= s && b.vy > 0) {
            b.y = s - b.h;
            var impact = clamp((b.vy - 250) / 1500, 0, 1);
            if (impact > 0.05) {
              puff(b.x, b.y + b.h, b.w, impact);
              jolt = Math.max(jolt, impact * clamp(b.w * b.h / 9000, 0.15, 1) * 5);
            }
            if (b.vy > 420) {
              b.vy = -b.vy * 0.3;
              b.vx = b.vx * 0.6 + (rng() - 0.5) * 80;
              b.av = -b.av * 0.45 + (rng() - 0.5) * 2;
            } else {
              settle(b);
            }
          }
        } else if (b.state === 'gone') {
          // waiting below the window for the trip home
        } else if (b.state === 'pile') {
          b.ang += (b.restAng - b.ang) * clamp(dt * 12, 0, 1);
        } else if (b.state === 'return') {
          if (t >= b.retAt) {
            var u = clamp((t - b.retAt) / b.retDur, 0, 1);
            var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
            var dist = Math.hypot(b.x0 - b.fromX, b.y0 - b.fromY);
            var lift = Math.sin(Math.PI * u) * Math.min(160, dist * 0.3) * (quick ? 0.3 : 1);
            b.x = lerp(b.fromX, b.x0, e);
            b.y = lerp(b.fromY, b.y0, e) - lift;
            b.ang = b.fromAng * (1 - e) + (quick ? 0 : Math.sin(Math.PI * u) * 0.25 * (b.shake > 50 ? 1 : -1));
            if (u >= 1) {
              b.state = 'home';
              b.x = b.x0; b.y = b.y0; b.ang = 0;
              show(b);
              if (b.copy.parentNode) b.copy.parentNode.removeChild(b.copy);
              home++;
              continue;
            }
          }
        }

        // Swat: a quick pass of the pointer through a piece sends it flying.
        if (live && pv > 300 && b.state !== 'return' && b.state !== 'hold' &&
            ptr.x > b.x - 6 && ptr.x < b.x + b.w + 6 && ptr.y > b.y - 6 && ptr.y < b.y + b.h + 6) {
          if (b.state === 'pile') { loosen(b); rebuildFloor(); }
          var kick = clamp(pv, 300, 2600);
          b.vx = ptr.vx * 0.55 + (rng() - 0.5) * 120;
          b.vy = Math.min(b.vy, -kick * 0.55 - 200);
          b.av = (rng() - 0.5) * b.spin * 3;
        }

        b.copy.style.transform = 'translate3d(' + (b.x - b.x0).toFixed(1) + 'px,' + (b.y - b.y0).toFixed(1) + 'px,0) rotate(' + b.ang.toFixed(4) + 'rad)';
      }

      // A heavy landing jolts the whole heap for a moment.
      jolt *= Math.pow(0.02, dt);
      layer.style.transform = jolt > 0.05 ? 'translate3d(0,' + (Math.sin(t * 70) * jolt).toFixed(2) + 'px,0)' : '';

      // Dust kicked up by landings.
      dctx.clearRect(0, 0, dustCv.w, dustCv.h);
      for (var d = dust.length - 1; d >= 0; d--) {
        var pt = dust[d];
        pt.life += dt;
        if (pt.life > pt.max) { dust.splice(d, 1); continue; }
        pt.vx *= Math.pow(0.05, dt); pt.vy = pt.vy * Math.pow(0.1, dt) - 8 * dt;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        var a = (1 - pt.life / pt.max);
        dctx.fillStyle = 'rgba(150,158,166,' + (0.32 * a).toFixed(3) + ')';
        dctx.beginPath(); dctx.arc(pt.x, pt.y, pt.r * (1 + pt.life * 2.2), 0, TAU); dctx.fill();
      }
      return home < bodies.length;
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
