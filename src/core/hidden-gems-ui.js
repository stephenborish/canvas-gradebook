/* Canvas Gradebook+ - Hidden Gems UI & miniature vignettes.
 *
 * Renders the 6 unobtrusive, physics-touched margin surprises on any Canvas
 * course page and adapts each one to the teacher's detected subject.
 * Everything lives inside .cgp-gem-stage with pointer-events: none except on
 * the tiny interactive object itself, never steals focus, and cleans up every
 * node, timer and listener when finished. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.HiddenGemsController) return;

  var STORAGE_KEY = 'cgp.hiddenGems.state';
  var COURSES_CACHE_KEY = 'cgp.courses';

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

  /* -------------------------------------------------------- stage lifecycle */

  function createSession(isInteractive) {
    var stage = document.createElement('div');
    stage.className = 'cgp-gem-stage';
    if (!isInteractive) stage.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stage);

    var timers = [];
    var rafs = [];
    var listeners = [];
    var done = false;

    var api = {
      stage: stage,
      isDone: function () { return done; },
      after: function (ms, fn) {
        if (done) return 0;
        var id = setTimeout(function () { if (!done) fn(); }, ms);
        timers.push(id);
        return id;
      },
      raf: function (fn) {
        if (done) return 0;
        var id = requestAnimationFrame(function (ts) { if (!done) fn(ts); });
        rafs.push(id);
        return id;
      },
      on: function (target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        listeners.push([target, type, fn, opts]);
      },
      destroy: function () {
        if (done) return;
        done = true;
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        for (var j = 0; j < rafs.length; j++) cancelAnimationFrame(rafs[j]);
        for (var k = 0; k < listeners.length; k++) {
          var l = listeners[k];
          try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* ignore */ }
        }
        if (stage.parentNode) stage.parentNode.removeChild(stage);
      }
    };
    return api;
  }

  /* ========================================================= 1. WASHER GEM */

  function smudgeSvg(mark) {
    var ink = 'rgba(72, 82, 94, 0.24)';
    if (mark === 'benzene') {
      return '<svg viewBox="0 0 58 58"><g fill="none" stroke="' + ink + '" stroke-width="2">' +
        '<polygon points="29,9 45,18 45,38 29,47 13,38 13,18"/>' +
        '<circle cx="29" cy="28" r="10" stroke-dasharray="4 3"/></g></svg>';
    }
    if (mark === 'orbit') {
      return '<svg viewBox="0 0 58 58"><g fill="none" stroke="' + ink + '" stroke-width="1.6">' +
        '<ellipse cx="29" cy="29" rx="20" ry="8" transform="rotate(-25 29 29)"/>' +
        '<ellipse cx="29" cy="29" rx="20" ry="8" transform="rotate(35 29 29)"/>' +
        '<circle cx="29" cy="29" r="3" fill="' + ink + '"/></g></svg>';
    }
    if (mark === 'helix') {
      return '<svg viewBox="0 0 58 58"><g fill="none" stroke="' + ink + '" stroke-width="2" stroke-linecap="round">' +
        '<path d="M18 8 C38 16, 20 26, 38 34 C20 42, 36 48, 22 52"/>' +
        '<path d="M38 8 C18 16, 36 26, 18 34 C36 42, 20 48, 34 52"/>' +
        '<line x1="22" y1="15" x2="34" y2="15"/><line x1="21" y1="29" x2="35" y2="29"/><line x1="23" y1="43" x2="33" y2="43"/></g></svg>';
    }
    if (mark === 'integral') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="42" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="36" fill="' + ink + '">&#8747;dx</text></svg>';
    }
    if (mark === 'pi') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="42" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="' + ink + '">&#960;</text></svg>';
    }
    if (mark === 'hanzi') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="42" text-anchor="middle" font-family="serif" font-size="34" fill="' + ink + '">&#22909;</text></svg>';
    }
    if (mark === 'exclaim') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="40" text-anchor="middle" font-family="Georgia,serif" font-size="32" fill="' + ink + '">&#161;!</text></svg>';
    }
    if (mark === 'alphaomega') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="39" text-anchor="middle" font-family="Georgia,serif" font-size="24" fill="' + ink + '">&#913;&#937;</text></svg>';
    }
    if (mark === 'compass') {
      return '<svg viewBox="0 0 58 58"><g fill="none" stroke="' + ink + '" stroke-width="1.6">' +
        '<circle cx="29" cy="29" r="18"/><path d="M29 10 L33 29 L29 48 L25 29 Z" fill="' + ink + '"/>' +
        '<line x1="11" y1="29" x2="47" y2="29"/></g></svg>';
    }
    if (mark === 'clef') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="44" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="' + ink + '">&#119070;</text></svg>';
    }
    if (mark === 'braces') {
      return '<svg viewBox="0 0 58 58"><text x="29" y="40" text-anchor="middle" font-family="monospace" font-size="26" fill="' + ink + '">{ ; }</text></svg>';
    }
    return '<svg viewBox="0 0 58 58"><g fill="none" stroke="rgba(90,100,112,0.18)" stroke-width="2" stroke-linecap="round">' +
      '<ellipse cx="29" cy="29" rx="15" ry="20" transform="rotate(-14 29 29)"/>' +
      '<ellipse cx="29" cy="29" rx="10" ry="14" transform="rotate(-14 29 29)" stroke-dasharray="18 5"/>' +
      '<ellipse cx="29" cy="29" rx="5" ry="8" transform="rotate(-14 29 29)"/></g></svg>';
  }

  function playWasher(session, props) {
    var isLeft = props.side === 'left';
    var topPct = typeof props.topPct === 'number' ? props.topPct : 34;
    var capColor = props.capColor || '#c94a38';

    var smudge = document.createElement('div');
    smudge.className = 'cgp-gem-smudge';
    smudge.style.top = topPct + '%';
    if (isLeft) smudge.style.left = '34px';
    else smudge.style.right = '34px';
    smudge.innerHTML = smudgeSvg(props.mark);
    session.stage.appendChild(smudge);

    var wrap = document.createElement('div');
    wrap.className = 'cgp-gem-washer-wrap';
    if (isLeft) wrap.style.left = '16px';
    else wrap.style.right = '16px';

    var rig = document.createElement('div');
    rig.className = 'cgp-gem-washer-rig';

    var targetY = Math.max(110, Math.round(window.innerHeight * (topPct / 100)) - 42);
    var currentY = -120;
    var theta = 0;
    var omega = 0;
    var phase = 'wait';
    var phaseStart = performance.now();
    var lastT = phaseStart;
    var wipePct = 0;
    var mistAlpha = 0;
    var squeegeeY = 0;
    var armTip = 0;

    var cableTop = -(targetY + 300);
    rig.innerHTML =
      '<svg viewBox="0 0 96 600" width="96" height="600" style="overflow:visible">' +
        '<line x1="16" y1="' + cableTop + '" x2="16" y2="56" stroke="#6c7a89" stroke-width="1.4"/>' +
        '<line x1="80" y1="' + cableTop + '" x2="80" y2="56" stroke="#6c7a89" stroke-width="1.4"/>' +
        '<g class="cgp-w-mist" opacity="0" fill="#7ec4e8">' +
          '<circle cx="24" cy="36" r="1.8"/><circle cx="19" cy="32" r="1.4"/><circle cx="21" cy="40" r="1.3"/><circle cx="15" cy="36" r="1.1"/>' +
        '</g>' +
        '<g class="cgp-w-person">' +
          '<rect x="40" y="34" width="16" height="20" rx="4" fill="#2f5d8a"/>' +
          '<circle cx="48" cy="24" r="7.5" fill="#f2c9a0"/>' +
          '<g class="cgp-w-cap">' +
            '<path d="M40 22 Q48 13 56 22 Z" fill="' + capColor + '"/>' +
            '<rect x="38" y="21" width="14" height="2.4" rx="1.2" fill="' + capColor + '" opacity="0.85"/>' +
          '</g>' +
          '<circle cx="45.5" cy="24.5" r="1" fill="#2c2c2c"/>' +
          '<circle cx="50.5" cy="24.5" r="1" fill="#2c2c2c"/>' +
          '<g class="cgp-w-arm">' +
            '<line x1="41" y1="39" x2="26" y2="38" stroke="#f2c9a0" stroke-width="3" stroke-linecap="round"/>' +
            '<rect x="18" y="34" width="12" height="3.2" rx="1" fill="#2c3e50"/>' +
            '<rect x="18" y="33" width="12" height="1.4" rx="0.7" fill="#5dade2"/>' +
          '</g>' +
          '<path d="M62 45 L72 45 L70 55 L64 55 Z" fill="#d9a441" stroke="#9e7424" stroke-width="1"/>' +
        '</g>' +
        '<line x1="12" y1="42" x2="84" y2="42" stroke="#85929e" stroke-width="1.6"/>' +
        '<rect x="10" y="54" width="76" height="7" rx="2" fill="#b8844c" stroke="#7d562d" stroke-width="1.2"/>' +
        '<circle cx="16" cy="57.5" r="1.5" fill="#4e5964"/>' +
        '<circle cx="80" cy="57.5" r="1.5" fill="#4e5964"/>' +
      '</svg>';

    wrap.appendChild(rig);
    session.stage.appendChild(wrap);

    var glint = document.createElement('div');
    glint.className = 'cgp-gem-glint';
    glint.style.top = 'calc(' + topPct + '% + 14px)';
    if (isLeft) glint.style.left = '46px';
    else glint.style.right = '46px';
    glint.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 1 L14.4 9.6 L23 12 L14.4 14.4 L12 23 L9.6 14.4 L1 12 L9.6 9.6 Z" fill="#f4d03f" stroke="#fff" stroke-width="0.8"/></svg>';
    session.stage.appendChild(glint);

    var mistEl = rig.querySelector('.cgp-w-mist');
    var armEl = rig.querySelector('.cgp-w-arm');
    var capEl = rig.querySelector('.cgp-w-cap');

    var lastMx = null;
    session.on(window, 'mousemove', function (e) {
      var nearX = isLeft ? e.clientX < 150 : e.clientX > window.innerWidth - 150;
      if (lastMx !== null && nearX && Math.abs(e.clientY - (currentY + 40)) < 90) {
        var dx = e.clientX - lastMx;
        omega += Math.max(-0.45, Math.min(0.45, dx * 0.008));
      }
      lastMx = e.clientX;
    }, { passive: true });

    session.after(60, function () { smudge.classList.add('is-visible'); });
    session.after(1200, function () { phase = 'down'; phaseStart = performance.now(); });

    function tick(now) {
      if (session.isDone()) return;
      var dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      var accel = -14 * theta - 2.6 * omega;
      omega += accel * dt;
      theta += omega * dt;

      var elapsed = now - phaseStart;
      if (phase === 'down') {
        var p = Math.min(1, elapsed / 1500);
        var ease = 1 - Math.pow(1 - p, 3);
        currentY = -120 + (targetY + 120) * ease;
        if (p >= 1) {
          phase = 'spray';
          phaseStart = now;
          omega += 0.14;
        }
      } else if (phase === 'spray') {
        var sp = Math.min(1, elapsed / 650);
        mistAlpha = Math.sin(sp * Math.PI);
        if (sp >= 1) {
          mistAlpha = 0;
          phase = 'wipe';
          phaseStart = now;
        }
      } else if (phase === 'wipe') {
        var wp = Math.min(1, elapsed / 1100);
        wipePct = Math.round(wp * 100);
        squeegeeY = wp * 22 - 4;
        smudge.style.clipPath = 'inset(' + wipePct + '% 0 0 0)';
        if (wp >= 1) {
          smudge.style.opacity = '0';
          glint.classList.add('is-spark');
          session.after(520, function () { glint.classList.remove('is-spark'); });
          phase = 'tip';
          phaseStart = now;
        }
      } else if (phase === 'tip') {
        var tp = Math.min(1, elapsed / 900);
        squeegeeY = 0;
        armTip = Math.sin(tp * Math.PI) * 14;
        if (tp >= 1) {
          armTip = 0;
          phase = 'up';
          phaseStart = now;
        }
      } else if (phase === 'up') {
        var up = Math.min(1, elapsed / 1350);
        var uEase = up * up;
        currentY = targetY - (targetY + 140) * uEase;
        if (up >= 1) {
          session.destroy();
          return;
        }
      }

      rig.style.transform = 'translateY(' + currentY.toFixed(1) + 'px) rotate(' + (theta * 14).toFixed(2) + 'deg)';
      if (mistEl) mistEl.setAttribute('opacity', mistAlpha.toFixed(2));
      if (armEl) armEl.setAttribute('transform', 'translate(0,' + squeegeeY.toFixed(1) + ')');
      if (capEl) capEl.setAttribute('transform', 'rotate(' + (-armTip).toFixed(1) + ' 48 22)');

      session.raf(tick);
    }

    session.raf(tick);
  }

  /* ========================================================= 2. PAPER BOAT */

  function boatSvg(watermark, tint) {
    var base = tint || '#fbf7ee';
    return '<svg viewBox="0 0 64 38" aria-hidden="true">' +
      '<polygon points="32,4 50,24 14,24" fill="' + base + '" stroke="#c8bda8" stroke-width="1"/>' +
      '<polygon points="32,4 32,24 50,24" fill="#efe6d4" stroke="#c8bda8" stroke-width="0.9"/>' +
      '<polygon points="4,22 60,22 50,34 14,34" fill="' + base + '" stroke="#bfb29a" stroke-width="1.1"/>' +
      '<polygon points="32,22 60,22 50,34 32,34" fill="#eae0cb" stroke="#bfb29a" stroke-width="0.9"/>' +
      '<text x="32" y="20" text-anchor="middle" font-size="8.5" font-family="Georgia,serif" fill="#7d6e57" opacity="0.72">' +
        String(watermark || '').replace(/[<>&]/g, '') +
      '</text>' +
    '</svg>';
  }

  function playBoat(session, props) {
    var waterline = document.createElement('div');
    waterline.className = 'cgp-gem-waterline';
    waterline.setAttribute('aria-hidden', 'true');
    session.stage.appendChild(waterline);
    session.after(40, function () { waterline.classList.add('is-visible'); });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cgp-gem-boat-btn';
    btn.setAttribute('aria-label', 'Unfold paper boat');
    btn.title = 'Click to unfold';
    btn.innerHTML = boatSvg(props.watermark, props.paperTint);

    var refl = document.createElement('div');
    refl.className = 'cgp-gem-boat-reflection';
    refl.setAttribute('aria-hidden', 'true');
    refl.innerHTML = boatSvg('', props.paperTint);

    session.stage.appendChild(refl);
    session.stage.appendChild(btn);

    var dir = props.direction === -1 ? -1 : 1;
    var x = dir === 1 ? -70 : window.innerWidth + 14;
    var speed = 38;
    var paused = false;
    var lastT = performance.now();
    var startT = lastT;
    var noteWrap = null;

    function openNote() {
      if (paused || noteWrap) return;
      paused = true;
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
      refl.style.opacity = '0';

      var card = props.card || { kind: 'fact', front: 'Take a slow breath — you are doing better than you think.' };
      var isRiddle = card.kind === 'riddle' && card.back;

      noteWrap = document.createElement('div');
      noteWrap.className = 'cgp-gem-note-wrap';
      noteWrap.setAttribute('role', 'dialog');
      noteWrap.setAttribute('aria-label', 'Paper boat note');

      var inner = document.createElement('div');
      inner.className = 'cgp-gem-note-inner';

      var front = document.createElement('div');
      front.className = 'cgp-gem-note-face';

      var meta = document.createElement('div');
      meta.className = 'cgp-gem-note-meta';
      var metaLabel = document.createElement('span');
      var kindLabel = isRiddle ? 'Riddle' : (card.kind === 'note' ? 'Note' : 'Curiosity');
      metaLabel.textContent = (props.subjectId && props.subjectId !== 'general' ? props.subjectLabel + ' · ' : '') + kindLabel;
      var metaMark = document.createElement('span');
      metaMark.className = 'cgp-gem-note-mark';
      metaMark.textContent = props.watermark || '✦';
      meta.appendChild(metaLabel);
      meta.appendChild(metaMark);

      var body = document.createElement('p');
      body.className = 'cgp-gem-note-body';
      body.textContent = card.front;

      var actions = document.createElement('div');
      actions.className = 'cgp-gem-note-actions';

      if (isRiddle) {
        var flipBtn = document.createElement('button');
        flipBtn.type = 'button';
        flipBtn.className = 'cgp-gem-note-btn cgp-gem-note-btn--primary';
        flipBtn.textContent = 'Flip for answer';
        flipBtn.addEventListener('click', function () {
          noteWrap.classList.add('is-flipped');
        });
        actions.appendChild(flipBtn);
      }

      var refoldFront = document.createElement('button');
      refoldFront.type = 'button';
      refoldFront.className = 'cgp-gem-note-btn';
      refoldFront.textContent = 'Refold';
      refoldFront.addEventListener('click', closeNote);
      actions.appendChild(refoldFront);

      front.appendChild(meta);
      front.appendChild(body);
      front.appendChild(actions);
      inner.appendChild(front);

      if (isRiddle) {
        var back = document.createElement('div');
        back.className = 'cgp-gem-note-face cgp-gem-note-face--back';

        var backMeta = document.createElement('div');
        backMeta.className = 'cgp-gem-note-meta';
        var bLabel = document.createElement('span');
        bLabel.textContent = 'Answer';
        var bMark = document.createElement('span');
        bMark.className = 'cgp-gem-note-mark';
        bMark.textContent = props.watermark || '✦';
        backMeta.appendChild(bLabel);
        backMeta.appendChild(bMark);

        var ans = document.createElement('p');
        ans.className = 'cgp-gem-note-answer';
        ans.textContent = card.back;

        var backActions = document.createElement('div');
        backActions.className = 'cgp-gem-note-actions';
        var flipBack = document.createElement('button');
        flipBack.type = 'button';
        flipBack.className = 'cgp-gem-note-btn';
        flipBack.textContent = 'Back';
        flipBack.addEventListener('click', function () {
          noteWrap.classList.remove('is-flipped');
        });
        var refoldBack = document.createElement('button');
        refoldBack.type = 'button';
        refoldBack.className = 'cgp-gem-note-btn cgp-gem-note-btn--primary';
        refoldBack.textContent = 'Refold boat';
        refoldBack.addEventListener('click', closeNote);
        backActions.appendChild(flipBack);
        backActions.appendChild(refoldBack);

        back.appendChild(backMeta);
        back.appendChild(ans);
        back.appendChild(backActions);
        inner.appendChild(back);
      }

      noteWrap.appendChild(inner);
      session.stage.appendChild(noteWrap);
      session.after(20, function () { noteWrap.classList.add('is-open'); });
    }

    function closeNote() {
      if (!noteWrap) return;
      noteWrap.classList.remove('is-open');
      noteWrap.classList.add('is-closing');
      var ref = noteWrap;
      noteWrap = null;
      session.after(420, function () {
        if (ref.parentNode) ref.parentNode.removeChild(ref);
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        refl.style.opacity = '0.22';
        paused = false;
        speed = 58;
        lastT = performance.now();
        session.raf(tick);
      });
    }

    session.on(btn, 'click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openNote();
    });
    session.on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && noteWrap) closeNote();
    });

    function tick(now) {
      if (session.isDone() || paused) return;
      var dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      x += dir * speed * dt;
      var t = (now - startT) / 1000;
      var bob = Math.sin(t * 2.6) * 2.2;
      var tilt = Math.cos(t * 2.1) * 3.2;
      btn.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + bob.toFixed(1) + 'px,0) rotate(' + tilt.toFixed(2) + 'deg)';
      refl.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + (-bob * 0.5).toFixed(1) + 'px,0) scaleY(-0.55)';
      var doneSail = dir === 1 ? x > window.innerWidth + 80 : x < -90;
      if (doneSail) {
        waterline.classList.remove('is-visible');
        session.after(900, function () { session.destroy(); });
        return;
      }
      session.raf(tick);
    }

    session.raf(tick);
  }

  /* ====================================================== 3. PAGE-CORNER PEEL */

  function peelWorldSvg(scene) {
    if (scene === 'molecules') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#0f2433"/>' +
        '<g stroke="#4db6ac" stroke-width="1.3" opacity="0.7">' +
          '<line x1="78" y1="92" x2="108" y2="74"/><line x1="108" y1="74" x2="132" y2="96"/>' +
          '<line x1="108" y1="74" x2="112" y2="44"/><line x1="78" y1="92" x2="88" y2="124"/>' +
          '<line x1="88" y1="124" x2="124" y2="120"/><line x1="124" y1="120" x2="132" y2="96"/>' +
        '</g>' +
        '<g fill="#80cbc4"><circle cx="78" cy="92" r="4"/><circle cx="108" cy="74" r="5" fill="#ffd54f"/>' +
        '<circle cx="132" cy="96" r="3.5"/><circle cx="112" cy="44" r="3"/><circle cx="88" cy="124" r="3.5"/><circle cx="124" cy="120" r="4" fill="#ff8a65"/></g>' +
      '</svg>';
    }
    if (scene === 'cosmos') {
      return '<svg viewBox="0 0 148 148">' +
        '<defs><radialGradient id="cgp-sky" cx="75%" cy="75%" r="80%"><stop offset="0%" stop-color="#1d2d50"/><stop offset="100%" stop-color="#090d1a"/></radialGradient></defs>' +
        '<rect width="148" height="148" fill="url(#cgp-sky)"/>' +
        '<g fill="#fff"><circle cx="116" cy="52" r="1.2" opacity="0.9"/><circle cx="88" cy="96" r="1" opacity="0.7"/>' +
        '<circle cx="130" cy="76" r="1.5" opacity="0.85"/><circle cx="96" cy="122" r="1.1" opacity="0.8"/><circle cx="64" cy="126" r="0.9" opacity="0.6"/></g>' +
        '<circle cx="112" cy="96" r="13" fill="#e8c37d"/>' +
        '<ellipse cx="112" cy="96" rx="26" ry="7" fill="none" stroke="#f7e3b5" stroke-width="1.6" transform="rotate(-22 112 96)"/>' +
      '</svg>';
    }
    if (scene === 'blueprint') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#173b66"/>' +
        '<g stroke="rgba(173,216,255,0.22)" stroke-width="0.8">' +
          '<path d="M0 30 H148 M0 60 H148 M0 90 H148 M0 120 H148 M30 0 V148 M60 0 V148 M90 0 V148 M120 0 V148"/>' +
        '</g>' +
        '<path d="M132 128 A42 42 0 0 1 90 86 A26 26 0 0 1 116 60 A16 16 0 0 1 132 76 A10 10 0 0 1 122 86" fill="none" stroke="#f6dd7a" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>';
    }
    if (scene === 'inkwash') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#ebe3d2"/>' +
        '<path d="M35 148 Q84 72 118 106 Q134 86 148 96 L148 148 Z" fill="#5e6b6b" opacity="0.45"/>' +
        '<path d="M58 148 Q104 92 148 118 L148 148 Z" fill="#2f3a3a" opacity="0.65"/>' +
        '<rect x="114" y="68" width="16" height="16" rx="2" fill="#b83b2d"/>' +
        '<text x="122" y="80" text-anchor="middle" font-size="10" font-family="serif" fill="#f7efe2">&#38745;</text>' +
      '</svg>';
    }
    if (scene === 'talavera') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#1b4978"/>' +
        '<g fill="none" stroke="#f5c352" stroke-width="1.5">' +
          '<circle cx="110" cy="108" r="26"/><circle cx="110" cy="108" r="14"/>' +
          '<path d="M110 82 L116 102 L136 108 L116 114 L110 134 L104 114 L84 108 L104 102 Z" fill="#e06d3b" stroke="#fdf5e6" stroke-width="1"/>' +
        '</g>' +
      '</svg>';
    }
    if (scene === 'stainedglass') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#1c1938"/>' +
        '<g transform="translate(110 106)">' +
          '<circle r="28" fill="#2d3b75" stroke="#d4af37" stroke-width="2"/>' +
          '<circle r="17" fill="#7c2846" stroke="#d4af37" stroke-width="1.4"/>' +
          '<circle r="7" fill="#f2c94c"/>' +
          '<g stroke="#d4af37" stroke-width="1.1">' +
            '<line x1="-28" y1="0" x2="28" y2="0"/><line x1="0" y1="-28" x2="0" y2="28"/>' +
            '<line x1="-20" y1="-20" x2="20" y2="20"/><line x1="20" y1="-20" x2="-20" y2="20"/>' +
          '</g>' +
        '</g>' +
      '</svg>';
    }
    if (scene === 'parchment') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#dcc8a0"/>' +
        '<path d="M58 136 Q88 112 104 98 T136 62" fill="none" stroke="#8c3b2b" stroke-width="1.6" stroke-dasharray="4 4"/>' +
        '<g transform="translate(112 106)" stroke="#5b4631" fill="none" stroke-width="1.2">' +
          '<circle r="18"/><polygon points="0,-16 4,0 0,16 -4,0" fill="#8c3b2b"/>' +
          '<polygon points="-16,0 0,4 16,0 0,-4" fill="#5b4631"/>' +
        '</g>' +
      '</svg>';
    }
    if (scene === 'staff') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#231f2e"/>' +
        '<g stroke="rgba(244,213,141,0.45)" stroke-width="1">' +
          '<line x1="30" y1="82" x2="148" y2="82"/><line x1="30" y1="90" x2="148" y2="90"/>' +
          '<line x1="30" y1="98" x2="148" y2="98"/><line x1="30" y1="106" x2="148" y2="106"/><line x1="30" y1="114" x2="148" y2="114"/>' +
        '</g>' +
        '<g fill="#f4d58d"><ellipse cx="96" cy="102" rx="5" ry="3.5" transform="rotate(-18 96 102)"/><rect x="100" y="76" width="1.8" height="26"/>' +
        '<ellipse cx="122" cy="94" rx="5" ry="3.5" transform="rotate(-18 122 94)"/><rect x="126" y="68" width="1.8" height="26"/>' +
        '<path d="M100 76 L128 68 L128 73 L100 81 Z"/></g>' +
      '</svg>';
    }
    if (scene === 'circuit') {
      return '<svg viewBox="0 0 148 148">' +
        '<rect width="148" height="148" fill="#0d1b1e"/>' +
        '<g fill="none" stroke="#38d39f" stroke-width="1.5" opacity="0.78">' +
          '<path d="M62 136 L82 116 L108 116 L122 102 L122 68"/>' +
          '<path d="M84 140 L102 122 L134 122"/>' +
          '<circle cx="122" cy="66" r="3" fill="#38d39f"/><circle cx="136" cy="122" r="3" fill="#38d39f"/>' +
        '</g>' +
      '</svg>';
    }
    return '<svg viewBox="0 0 148 148">' +
      '<rect width="148" height="148" fill="#1c232d"/>' +
      '<g class="cgp-gem-gear-cw" fill="none" stroke="#d4a759" stroke-width="2.4">' +
        '<circle cx="104" cy="104" r="18" stroke-dasharray="6 4"/><circle cx="104" cy="104" r="7"/>' +
      '</g>' +
      '<g class="cgp-gem-gear-ccw" fill="none" stroke="#9aa7b8" stroke-width="2">' +
        '<circle cx="132" cy="78" r="12" stroke-dasharray="5 3"/><circle cx="132" cy="78" r="4"/>' +
      '</g>' +
    '</svg>';
  }

  function playPeel(session, props) {
    var root = document.createElement('div');
    root.className = 'cgp-gem-peel' + (props.corner === 'bottom-left' ? ' is-left' : '');

    var world = document.createElement('div');
    world.className = 'cgp-gem-peel-world';
    world.innerHTML = peelWorldSvg(props.scene);

    var caption = document.createElement('div');
    caption.className = 'cgp-gem-peel-caption';
    caption.textContent = props.caption || '';

    var flap = document.createElement('div');
    flap.className = 'cgp-gem-peel-flap';

    var hit = document.createElement('div');
    hit.className = 'cgp-gem-peel-hit';
    hit.title = 'Peek behind the page';

    root.appendChild(world);
    root.appendChild(caption);
    root.appendChild(flap);
    root.appendChild(hit);
    session.stage.appendChild(root);

    var hovering = false;
    var closing = false;

    function close() {
      if (closing) return;
      closing = true;
      root.classList.remove('is-peek');
      root.classList.remove('is-open');
      session.after(750, function () { session.destroy(); });
    }

    session.on(hit, 'mouseenter', function () {
      if (closing) return;
      hovering = true;
      root.classList.add('is-peek');
    });
    session.on(hit, 'mouseleave', function () {
      hovering = false;
      root.classList.remove('is-peek');
    });
    session.on(hit, 'click', function () { close(); });

    session.after(80, function () { root.classList.add('is-open'); });
    session.after(12500, function () {
      if (!hovering) close();
      else session.after(4500, close);
    });
  }

  /* ================================================ 4. MARGIN HARMONOGRAPH */

  function playHarmonograph(session, props) {
    var wrap = document.createElement('div');
    wrap.className = 'cgp-gem-harm-wrap' + (props.corner === 'bottom-left' ? ' is-left' : '');

    var size = 136;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var canvas = document.createElement('canvas');
    canvas.className = 'cgp-gem-harm-canvas';
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    wrap.appendChild(canvas);
    session.stage.appendChild(wrap);

    var ctx = canvas.getContext('2d');
    if (!ctx) { session.destroy(); return; }
    ctx.scale(dpr, dpr);

    // Offscreen trail canvas so the glowing stylus nib can be redrawn cleanly
    // on top without smudging the fine fountain-pen ink curve.
    var inkCanvas = document.createElement('canvas');
    inkCanvas.width = size * dpr;
    inkCanvas.height = size * dpr;
    var inkCtx = inkCanvas.getContext('2d');
    inkCtx.scale(dpr, dpr);
    inkCtx.strokeStyle = props.ink || '#2b4c6b';
    inkCtx.lineWidth = 0.85;
    inkCtx.lineCap = 'round';
    inkCtx.lineJoin = 'round';
    inkCtx.globalAlpha = 0.62;

    var cx = size * 0.5;
    var cy = size * 0.5;
    var amp = size * 0.31;
    var f1 = props.f1 || 2;
    var f2 = props.f2 || 3;
    var f3 = props.f3 || 1;
    var p1 = props.p1 || 0;
    var p2 = props.p2 || 1.1;
    var p3 = props.p3 || 0.4;
    var damp = props.damping || 0.011;

    var t = 0;
    var maxT = 46;
    var phaseDrift = 0;
    var driftVel = 0;
    var lastX = null;
    var lastY = null;
    var finishing = false;

    function sample(time) {
      var env = Math.exp(-damp * time);
      var x = cx + amp * env * (Math.sin(f1 * time + p1 + phaseDrift) + 0.42 * Math.sin(f3 * time + p3));
      var y = cy + amp * env * (Math.sin(f2 * time + p2 - phaseDrift * 0.6) + 0.42 * Math.cos(f3 * time + p1));
      return [x, y];
    }

    // Subtle cursor perturbation: brushing near the corner nudges the live phase.
    session.on(window, 'mousemove', function (e) {
      var rect = wrap.getBoundingClientRect();
      var dx = e.clientX - (rect.left + rect.width * 0.5);
      var dy = e.clientY - (rect.top + rect.height * 0.5);
      if (dx * dx + dy * dy < 140 * 140) {
        driftVel += 0.0022;
      }
    }, { passive: true });

    session.after(40, function () { wrap.classList.add('is-visible'); });

    function tick() {
      if (session.isDone()) return;

      driftVel *= 0.92;
      phaseDrift += driftVel;

      var steps = 10;
      var stepDt = 0.012;
      var tipX = cx, tipY = cy;

      inkCtx.beginPath();
      for (var s = 0; s < steps; s++) {
        t += stepDt;
        var pt = sample(t);
        if (lastX === null) {
          inkCtx.moveTo(pt[0], pt[1]);
        } else {
          inkCtx.moveTo(lastX, lastY);
          inkCtx.lineTo(pt[0], pt[1]);
        }
        lastX = pt[0];
        lastY = pt[1];
        tipX = pt[0];
        tipY = pt[1];
      }
      inkCtx.stroke();

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(inkCanvas, 0, 0, size, size);

      if (t < maxT) {
        // Tiny silver stylus nib at the active drawing point
        ctx.save();
        ctx.fillStyle = props.ink || '#2b4c6b';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
        session.raf(tick);
      } else if (!finishing) {
        finishing = true;
        // Linger briefly like fresh ink in the margin, then evaporate.
        session.after(3200, function () {
          wrap.classList.add('is-fading');
          session.after(2300, function () { session.destroy(); });
        });
      }
    }

    session.raf(tick);
  }

  /* ========================================================= 5. DESK PRISM */

  function crystalSvg(kind) {
    var stroke = 'rgba(130, 165, 195, 0.55)';
    var fill = 'url(#cgp-glass)';
    if (kind === 'hex') {
      return '<polygon points="0,-16 14,-8 14,8 0,16 -14,8 -14,-8" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>' +
        '<line x1="-14" y1="-8" x2="14" y2="8" stroke="rgba(255,255,255,0.65)" stroke-width="0.7"/>';
    }
    if (kind === 'diamond') {
      return '<polygon points="0,-18 13,0 0,18 -13,0" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>' +
        '<line x1="0" y1="-18" x2="0" y2="18" stroke="rgba(255,255,255,0.7)" stroke-width="0.7"/>';
    }
    if (kind === 'lens') {
      return '<circle cx="0" cy="0" r="14" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>' +
        '<path d="M-8,-6 A10,10 0 0 1 6,-8" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.2" stroke-linecap="round"/>';
    }
    if (kind === 'bevel') {
      return '<polygon points="-13,-10 13,-10 17,10 -17,10" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>' +
        '<polygon points="-8,-6 8,-6 11,6 -11,6" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="0.7"/>';
    }
    // Classic triangular flint-glass prism
    return '<polygon points="0,-17 16,12 -16,12" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>' +
      '<line x1="0" y1="-17" x2="-3" y2="12" stroke="rgba(255,255,255,0.72)" stroke-width="0.8"/>';
  }

  function playPrism(session, props) {
    var corner = props.corner || 'top-right';
    var wrap = document.createElement('div');
    wrap.className = 'cgp-gem-prism-wrap pos-' + corner;

    var palette = (props.palette && props.palette.length) ? props.palette : ['#ff6e6e', '#ffd166', '#66d9a8', '#5dade2', '#b388eb'];
    var spread = props.spreadDeg || 30;
    var baseAngle = props.baseAngle || 0;

    // Anchor the crystal inside the chosen corner, projecting inward.
    var cx = corner === 'top-left' ? 34 : 206;
    var cy = corner === 'bottom-right' ? 166 : 34;
    var inwardBase = corner === 'top-left' ? 38 : (corner === 'bottom-right' ? -142 : 142);

    var beamsMarkup = '';
    var n = palette.length;
    for (var i = 0; i < n; i++) {
      var frac = n > 1 ? (i / (n - 1)) - 0.5 : 0;
      var a1 = (frac * spread - spread / (n * 1.5)) * (Math.PI / 180);
      var a2 = (frac * spread + spread / (n * 1.5)) * (Math.PI / 180);
      var len = 185;
      var x1 = Math.cos(a1) * len;
      var y1 = Math.sin(a1) * len;
      var x2 = Math.cos(a2) * len;
      var y2 = Math.sin(a2) * len;
      beamsMarkup += '<polygon points="0,0 ' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1) + '" fill="' + palette[i] + '" opacity="0.22"/>';
    }

    // Optional hairline Fraunhofer absorption lines for physics/chemistry/science/cs.
    var absorptionMarkup = '';
    if (props.absorption) {
      var lineAngles = [-0.32, -0.08, 0.21, 0.39];
      for (var j = 0; j < lineAngles.length; j++) {
        var la = lineAngles[j] * spread * (Math.PI / 180);
        absorptionMarkup += '<line x1="' + (Math.cos(la) * 22).toFixed(1) + '" y1="' + (Math.sin(la) * 22).toFixed(1) + '" x2="' + (Math.cos(la) * 165).toFixed(1) + '" y2="' + (Math.sin(la) * 165).toFixed(1) + '" stroke="rgba(25,35,48,0.16)" stroke-width="0.9"/>';
      }
    }

    wrap.innerHTML =
      '<svg class="cgp-gem-prism-svg" viewBox="0 0 240 200">' +
        '<defs>' +
          '<linearGradient id="cgp-glass" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="rgba(255,255,255,0.88)"/>' +
            '<stop offset="48%" stop-color="rgba(218,238,252,0.42)"/>' +
            '<stop offset="100%" stop-color="rgba(182,216,240,0.68)"/>' +
          '</linearGradient>' +
          '<filter id="cgp-caustic-blur" x="-30%" y="-30%" width="160%" height="160%">' +
            '<feGaussianBlur stdDeviation="5.5"/>' +
          '</filter>' +
          '<radialGradient id="cgp-beam-fade" cx="50%" cy="50%" r="50%">' +
            '<stop offset="0%" stop-color="#fff" stop-opacity="0.9"/>' +
            '<stop offset="72%" stop-color="#fff" stop-opacity="0.5"/>' +
            '<stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
          '</radialGradient>' +
          '<mask id="cgp-beam-mask"><circle cx="0" cy="0" r="185" fill="url(#cgp-beam-fade)"/></mask>' +
        '</defs>' +
        '<g class="cgp-prism-fan" transform="translate(' + cx + ',' + cy + ') rotate(' + (inwardBase + baseAngle) + ')" mask="url(#cgp-beam-mask)">' +
          '<g filter="url(#cgp-caustic-blur)">' + beamsMarkup + '</g>' +
          absorptionMarkup +
        '</g>' +
        '<g class="cgp-prism-crystal" transform="translate(' + cx + ',' + cy + ') rotate(' + baseAngle + ')">' +
          crystalSvg(props.crystal) +
        '</g>' +
      '</svg>';

    session.stage.appendChild(wrap);
    session.after(50, function () { wrap.classList.add('is-visible'); });

    var fanEl = wrap.querySelector('.cgp-prism-fan');
    var crystalEl = wrap.querySelector('.cgp-prism-crystal');
    var targetOffset = 0;
    var currentOffset = 0;
    var startT = performance.now();

    session.on(window, 'mousemove', function (e) {
      var nx = (e.clientX / Math.max(1, window.innerWidth)) - 0.5;
      var ny = (e.clientY / Math.max(1, window.innerHeight)) - 0.5;
      targetOffset = (nx * 18) + (ny * 10);
    }, { passive: true });

    function tick(now) {
      if (session.isDone()) return;
      var t = (now - startT) / 1000;
      var ambient = Math.sin(t * 0.55) * 4.5;
      currentOffset += ((targetOffset + ambient) - currentOffset) * 0.045;

      if (fanEl) {
        fanEl.setAttribute('transform', 'translate(' + cx + ',' + cy + ') rotate(' + (inwardBase + baseAngle + currentOffset).toFixed(2) + ')');
      }
      if (crystalEl) {
        crystalEl.setAttribute('transform', 'translate(' + cx + ',' + cy + ') rotate(' + (baseAngle + currentOffset * 0.45).toFixed(2) + ')');
      }
      session.raf(tick);
    }

    session.raf(tick);

    session.after(9500, function () {
      wrap.classList.add('is-fading');
      session.after(2100, function () { session.destroy(); });
    });
  }

  /* ====================================================== 6. ROLLING PENCIL */

  function rollerSvg(variant) {
    if (variant === 'marble') {
      return {
        w: 22, h: 22, isRound: true,
        svg: '<svg viewBox="0 0 22 22" width="22" height="22">' +
          '<defs><radialGradient id="cgp-mrb" cx="35%" cy="32%" r="68%"><stop offset="0%" stop-color="#e3f6ff"/><stop offset="45%" stop-color="#4ea3d1"/><stop offset="100%" stop-color="#194266"/></radialGradient></defs>' +
          '<circle cx="11" cy="11" r="9.5" fill="url(#cgp-mrb)" stroke="rgba(255,255,255,0.45)" stroke-width="0.8"/>' +
          '<path d="M6 12 Q11 6 16 12 Q11 16 6 12 Z" fill="rgba(255,255,255,0.32)"/>' +
          '<circle cx="7.5" cy="7.2" r="2.1" fill="#ffffff" opacity="0.85"/></svg>'
      };
    }
    if (variant === 'test-tube') {
      return {
        w: 76, h: 14, isRound: false,
        svg: '<svg viewBox="0 0 76 14" width="76" height="14">' +
          '<path d="M6 2 H66 A5 5 0 0 1 66 12 H6 Z" fill="rgba(225,244,252,0.88)" stroke="#7fa6bd" stroke-width="1.2"/>' +
          '<path d="M38 3.5 H65 A3.5 3.5 0 0 1 65 10.5 H38 Z" fill="rgba(56,196,178,0.68)"/>' +
          '<rect x="3" y="1" width="3.5" height="12" rx="1" fill="#9fb9c9"/>' +
          '<line x1="14" y1="4.5" x2="54" y2="4.5" stroke="#fff" stroke-width="1" opacity="0.7"/></svg>'
      };
    }
    if (variant === 'brush') {
      return {
        w: 84, h: 12, isRound: false,
        svg: '<svg viewBox="0 0 84 12" width="84" height="12">' +
          '<rect x="2" y="3.5" width="60" height="5" rx="2.5" fill="#c89f5d" stroke="#8a6830" stroke-width="0.8"/>' +
          '<line x1="22" y1="3.5" x2="22" y2="8.5" stroke="#8a6830" stroke-width="1"/>' +
          '<line x1="44" y1="3.5" x2="44" y2="8.5" stroke="#8a6830" stroke-width="1"/>' +
          '<rect x="61" y="3" width="5" height="6" rx="1" fill="#3b332b"/>' +
          '<path d="M66 3 Q77 3 83 6 Q77 9 66 9 Z" fill="#1c1c1e"/></svg>'
      };
    }
    if (variant === 'baton') {
      return {
        w: 86, h: 10, isRound: false,
        svg: '<svg viewBox="0 0 86 10" width="86" height="10">' +
          '<ellipse cx="10" cy="5" rx="8.5" ry="4" fill="#d9b382" stroke="#8c683e" stroke-width="0.9"/>' +
          '<polygon points="18,3.8 84,4.7 84,5.3 18,6.2" fill="#f7f4ec" stroke="#b8b0a0" stroke-width="0.6"/></svg>'
      };
    }
    if (variant === 'colored-pencil') {
      return {
        w: 82, h: 11, isRound: false,
        svg: '<svg viewBox="0 0 82 11" width="82" height="11">' +
          '<rect x="2" y="2" width="64" height="7" rx="1" fill="#2c7bb6" stroke="#1b4f78" stroke-width="0.8"/>' +
          '<line x1="2" y1="4.4" x2="66" y2="4.4" stroke="#5ba3d9" stroke-width="1"/>' +
          '<polygon points="66,2 80,5.5 66,9" fill="#e6c49a" stroke="#b08e62" stroke-width="0.7"/>' +
          '<polygon points="75,4.2 80,5.5 75,6.8" fill="#2c7bb6"/></svg>'
      };
    }
    return {
      w: 84, h: 11, isRound: false,
      svg: '<svg viewBox="0 0 84 11" width="84" height="11">' +
        '<rect x="2" y="2" width="7" height="7" rx="1.5" fill="#e58c8a" stroke="#b56361" stroke-width="0.7"/>' +
        '<rect x="9" y="2" width="5" height="7" fill="#c0c6cc" stroke="#89929b" stroke-width="0.6"/>' +
        '<rect x="14" y="2" width="54" height="7" fill="#f2c138" stroke="#c0911b" stroke-width="0.7"/>' +
        '<line x1="14" y1="4.4" x2="68" y2="4.4" stroke="#f9dc7a" stroke-width="1.1"/>' +
        '<polygon points="68,2 82,5.5 68,9" fill="#e6c49a" stroke="#b08e62" stroke-width="0.7"/>' +
        '<polygon points="77,4.2 82,5.5 77,6.8" fill="#2e343b"/></svg>'
    };
  }

  function playPencil(session, props) {
    var spec = rollerSvg(props.variant);
    var el = document.createElement('div');
    el.className = 'cgp-gem-roller';
    el.style.width = spec.w + 'px';
    el.style.height = spec.h + 'px';
    el.title = 'Nudge me';
    el.innerHTML = spec.svg;
    session.stage.appendChild(el);

    var W = window.innerWidth;
    var dir = props.direction === -1 ? -1 : 1;
    var x = dir === 1 ? Math.max(40, W * 0.35) : Math.min(W - spec.w - 40, W * 0.65);
    var vx = dir * 185;
    var angle = 0;
    var nudgedOff = false;
    var settledAt = 0;
    var lastT = performance.now();

    function nudge(fromX) {
      if (nudgedOff) return;
      nudgedOff = true;
      vx = fromX > x + spec.w * 0.5 ? -360 : 360;
    }

    session.on(el, 'mouseenter', function (e) { nudge(e.clientX); });
    session.on(el, 'click', function (e) { nudge(e.clientX); });

    function tick(now) {
      if (session.isDone()) return;
      var dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      if (!nudgedOff) {
        if (!settledAt) {
          vx += dir * 58 * dt;
          vx *= Math.pow(0.58, dt);
          x += vx * dt;
          var minX = 8;
          var maxX = W - spec.w - 8;
          if (dir === 1 && x > maxX) {
            x = maxX;
            vx = -Math.abs(vx) * 0.42;
            if (Math.abs(vx) < 14) { vx = 0; settledAt = now; }
          } else if (dir === -1 && x < minX) {
            x = minX;
            vx = Math.abs(vx) * 0.42;
            if (Math.abs(vx) < 14) { vx = 0; settledAt = now; }
          }
        } else if (now - settledAt > 6500) {
          el.classList.add('is-fading');
          session.after(750, function () { session.destroy(); });
          return;
        }
      } else {
        x += vx * dt;
        if (x < -spec.w - 40 || x > W + 40) {
          session.destroy();
          return;
        }
      }

      if (spec.isRound) {
        angle += (vx * dt) * 5.2;
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0) rotate(' + angle.toFixed(1) + 'deg)';
      } else {
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
      }

      session.raf(tick);
    }

    session.raf(tick);
  }

  /* ============================================================= CONTROLLER */

  var PLAYERS = {
    washer: playWasher,
    boat: playBoat,
    peel: playPeel,
    harmonograph: playHarmonograph,
    prism: playPrism,
    pencil: playPencil
  };

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
    var session = createSession(id === 'boat');
    this._active = session;
    try {
      PLAYERS[id](session, props);
    } catch (e) {
      session.destroy();
      if (CGP.diag) CGP.diag.error('hiddenGems.playFailed', { gem: id, message: String(e && e.message) });
      return null;
    }
    if (CGP.diag) CGP.diag.log('hiddenGems.played', { gem: id, subject: subject.id, source: subject.source });
    return { gem: id, subject: subject, cardId: props && props.card ? props.card.id : null };
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
            var recentCards = Array.isArray(fresh && fresh.recentCards) ? fresh.recentCards.slice(-16) : [];
            var gemId = CGP.hiddenGems.pickGem(recentGems);
            return resolveCurrentSubject(null).then(function (subject) {
              if (document.hidden || !self.settings.values.hiddenGems || prefersReducedMotion()) return null;
              var props = CGP.hiddenGems.contentFor(gemId, subject.id, undefined, { recentCards: recentCards });
              var nextGems = recentGems.concat([gemId]).slice(-4);
              var nextCards = (props && props.card && props.card.id)
                ? recentCards.concat([props.card.id]).slice(-16)
                : recentCards;
              var claimId = claimNow + ':' + Math.random().toString(36).slice(2, 8);
              return writeState({
                lastShownAt: claimNow,
                lastGemId: gemId,
                recentGems: nextGems,
                recentCards: nextCards,
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
