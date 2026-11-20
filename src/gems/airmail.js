/* Canvas Gradebook+ - Airmail: the paper airplane and the note it carries.
 *
 * Injected by background.js only when airmail-state.js has decided a plane
 * flies today. CGP.AirmailFlight.launch({ note, spec, onCatch, onMiss, onDone })
 * sends one plane across the page:
 *
 *   - it drifts in from the left on a gentle wave, does one loop-de-loop
 *     over the grid, and glides off the right edge, leaving a dotted trail;
 *   - missed, it banks round once and makes one slower pass back;
 *   - missed twice, it is gone (onMiss);
 *   - clicked, it spins to the middle of the page and unfolds into the note
 *     (onCatch keeps it in the Shoebox), stamped with the subject's mark and
 *     postmarked with the day. Escape, a click outside the note or "Tuck it
 *     in the Shoebox" folds it away.
 *
 * Its trail is drawn in the course subject's marks (spec.subject): pi and
 * integrals behind a math plane, eighth notes behind a music one, ¡ ¿ ñ
 * behind a Spanish one; snowflakes join in in December. A flock
 * (spec.flock) flies five planes in a V with no loop; catching any one
 * catches the note and the rest peel away.
 *
 * Everything is drawn inside one shadow root, so Canvas's styles cannot
 * reach it and it cannot reach Canvas. With "reduce motion" on, the plane
 * does not fly: it settles quietly in the corner for a while instead.
 * Nothing here is ever focused uninvited, so typing in the grid carries on. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.AirmailFlight) return;

  var CSS = [
    ':host { all: initial; }',
    '.sky { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; }',
    '.plane { position: absolute; left: 0; top: 0; width: 64px; height: 64px; margin: -32px 0 0 -32px; padding: 0;',
    '  border: 0; background: none; cursor: pointer; pointer-events: auto; will-change: transform;',
    '  filter: drop-shadow(0 6px 6px rgba(20, 30, 40, .22)); -webkit-tap-highlight-color: transparent; }',
    '.plane:focus-visible { outline: 2px dashed #0374b5; outline-offset: 4px; border-radius: 50%; }',
    '.plane svg { display: block; width: 100%; height: 100%; overflow: visible; }',
    '.plane.is-caught { transition: transform .7s cubic-bezier(.5, -.3, .4, 1.2), opacity .25s .6s; opacity: 0; }',
    '.trail { position: absolute; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;',
    '  background: rgba(120, 140, 155, .45); animation: trail 1.6s ease-out forwards; }',
    '.trail.is-gold { background: #f2c14e; box-shadow: 0 0 6px #f7d674; width: 6px; height: 6px; }',
    '.trail.is-night { background: #cfe0ff; box-shadow: 0 0 5px #ffffff; }',
    '@keyframes trail { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(.2) translateY(6px); } }',
    '.trail.is-glyph { width: auto; height: auto; margin: -10px 0 0 -6px; background: none; box-shadow: none; border-radius: 0;',
    '  font: 700 17px/1 "Cambria Math", "STIX Two Math", "Times New Roman", serif; color: #6d7f8f; white-space: nowrap;',
    '  animation: glyph 2.2s ease-out forwards; }',
    '.trail.is-glyph.is-gold { color: #c9971c; text-shadow: 0 0 6px #ffe08a; }',
    '.trail.is-glyph.is-night { color: #b9c9f5; text-shadow: 0 0 6px #fff; }',
    '@keyframes glyph { 0% { opacity: 0; transform: scale(.4) rotate(0); } 15% { opacity: .95; }',
    '  100% { opacity: 0; transform: translateY(26px) scale(1.15) rotate(var(--spin, 0deg)); } }',
    '.plane.is-wing { width: 50px; height: 50px; margin: -25px 0 0 -25px; }',
    '.plane.is-scatter { transition: transform 1.1s cubic-bezier(.4, 0, .9, .6), opacity .9s; opacity: 0; }',
    '.stamp { position: absolute; right: 16px; top: 14px; width: 58px; padding: 6px 4px 4px; box-sizing: border-box;',
    '  text-align: center; background: #fff; color: #b23a48; transform: rotate(4deg);',
    '  border: 2px dotted #e6dcc8; outline: 3px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.18); }',
    '.stamp b { display: block; font: 700 22px/1.2 "Cambria Math", "STIX Two Math", "Times New Roman", serif; white-space: nowrap; overflow: hidden; }',
    '.stamp i { display: block; margin-top: 2px; font: 700 7.5px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-style: normal; letter-spacing: .06em; text-transform: uppercase; color: #6a4b52; white-space: nowrap; overflow: hidden; }',
    '.postmark { position: absolute; right: 46px; top: 46px; width: 62px; height: 62px; box-sizing: border-box; border-radius: 50%;',
    '  border: 2px solid rgba(40, 60, 120, .45); color: rgba(40, 60, 120, .6); transform: rotate(-14deg);',
    '  display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;',
    '  font: 700 8px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .08em; text-transform: uppercase; }',
    '.note .text { padding-right: 96px; min-height: 92px; }',
    '.corner { position: absolute; left: auto; top: auto; right: 28px; bottom: 28px; margin: 0; animation: settle 1.2s ease-out both; }',
    '@keyframes settle { from { opacity: 0; transform: translateY(10px) rotate(-8deg); } to { opacity: 1; transform: none; } }',
    '.veil { position: fixed; inset: 0; pointer-events: auto; background: rgba(20, 28, 36, .28);',
    '  animation: veil .45s ease-out both; }',
    '@keyframes veil { from { opacity: 0; } }',
    '.note { position: fixed; left: 50%; top: 50%; width: min(470px, calc(100vw - 32px)); box-sizing: border-box;',
    '  padding: 30px 30px 22px 58px; pointer-events: auto; color: #2b2f38; border-radius: 3px;',
    '  background: repeating-linear-gradient(#fffdf6 0 27px, #c9dcef 27px 28px) 0 18px / 100% 28px, #fffdf6;',
    '  box-shadow: 0 1px 1px rgba(0,0,0,.08), 0 18px 40px rgba(20, 30, 40, .35);',
    '  transform: translate(-50%, -50%) rotate(-1.6deg); transform-origin: 50% 50%;',
    '  animation: unfold .9s cubic-bezier(.2, .9, .25, 1.15) both;',
    '  font: 400 20px/28px "Segoe Print", "Bradley Hand", "Noteworthy", "Chalkboard SE", "Comic Sans MS", cursive; }',
    '.note::before { content: ""; position: absolute; left: 44px; top: 0; bottom: 0; width: 1.5px; background: #ef9a9a; }',
    '.note::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: 3px;',
    '  background: linear-gradient(135deg, transparent 49.6%, rgba(0,0,0,.05) 50%, transparent 50.6%),',
    '              linear-gradient(45deg, transparent 49.6%, rgba(0,0,0,.04) 50%, transparent 50.6%),',
    '              linear-gradient(90deg, transparent 49.8%, rgba(0,0,0,.035) 50%, transparent 50.2%); }',
    '@keyframes unfold {',
    '  0% { opacity: 0; transform: translate(-50%, -50%) perspective(900px) rotateX(78deg) rotateZ(-30deg) scale(.15); }',
    '  55% { opacity: 1; transform: translate(-50%, -50%) perspective(900px) rotateX(-12deg) rotateZ(2deg) scale(1.04); }',
    '  100% { transform: translate(-50%, -50%) rotate(-1.6deg); } }',
    '.note.is-away { animation: tuck .55s cubic-bezier(.6, -.2, .7, .4) forwards; }',
    '@keyframes tuck { to { opacity: 0; transform: translate(-50%, 40vh) rotate(8deg) scale(.25); } }',
    '.note p { margin: 0; }',
    '.note .from { margin-top: 14px; text-align: right; font-size: 17px; color: #4a5160; }',
    '.note .doodle { display: inline-block; vertical-align: middle; width: 24px; height: 24px; margin-right: 6px; color: #e57373; transform: rotate(-8deg); }',
    '.note .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px;',
    '  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #5c6670; }',
    '.note .first { flex: 1 1 auto; }',
    '.note .first a { color: #0374b5; cursor: pointer; text-decoration: underline; }',
    '.note button.keep { flex: 0 0 auto; border: 0; border-radius: 999px; padding: 8px 14px; cursor: pointer;',
    '  font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '  background: #2d3b45; color: #fff; }',
    '.note button.keep:hover { background: #1a232b; }',
    '.note button.keep:focus-visible { outline: 2px solid #0374b5; outline-offset: 2px; }',
    '.note.is-gold { background: radial-gradient(circle at 20% 0%, #fff8e1, #fdf0c8 70%, #f7e2a1);',
    '  box-shadow: 0 0 0 3px #e2b33c, 0 0 0 5px #fff4cf, 0 18px 46px rgba(120, 80, 0, .4); }',
    '.note.is-gold::before { display: none; }',
    '.note.is-gold { padding-left: 32px; }',
    '.note.is-gold .doodle { color: #b8860b; }',
    '.note.is-gold .stamp { color: #9a6b00; border-color: #e2b33c; }',
    '.note.is-gold .label { display: block; margin-bottom: 8px; font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  letter-spacing: .14em; text-transform: uppercase; color: #9a6b00; }',
    '.note.is-night { background: repeating-linear-gradient(#f4f6ff 0 27px, #cdd6f6 27px 28px) 0 18px / 100% 28px, #f4f6ff; }',
    '.note.is-night .doodle { color: #7b8ad6; }',
    '.sparkle { position: fixed; width: 8px; height: 8px; margin: -4px; pointer-events: none; border-radius: 50%;',
    '  background: #f6cf5a; box-shadow: 0 0 8px #ffe08a; animation: spark 1.1s ease-out forwards; }',
    '@keyframes spark { to { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.3); } }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .note, .note.is-away, .veil, .corner { animation-duration: .01s; }',
    '  .plane.is-caught { transition: opacity .2s; } }'
  ].join('\n');

  function planeSvg(kind) {
    var top = '#ffffff', under = '#dfe6ec', fold = '#b9c5cf', edge = '#8796a3';
    if (kind === 'gold') { top = '#ffe9a8'; under = '#f2c14e'; fold = '#d39b1c'; edge = '#a8740a'; }
    if (kind === 'night') { top = '#eef3ff'; under = '#c9d6f5'; fold = '#9fb0e0'; edge = '#6f80b8'; }
    // A dart folded from one sheet, nose to the right: the top wing, the
    // keel folded under it, and the far wing just showing below.
    return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      '<path d="M4 30 L60 22 L22 40 Z" fill="' + under + '" stroke="' + edge + '" stroke-width="1" stroke-linejoin="round"/>' +
      '<path d="M22 40 L60 22 L26 48 Z" fill="' + fold + '" stroke="' + edge + '" stroke-width="1" stroke-linejoin="round"/>' +
      '<path d="M4 30 L60 22 L18 20 Z" fill="' + top + '" stroke="' + edge + '" stroke-width="1" stroke-linejoin="round"/>' +
      '<path d="M18 20 L60 22" stroke="' + edge + '" stroke-width=".8" opacity=".6"/>' +
      '</svg>';
  }

  var DOODLES = {
    heart: '<svg class="doodle" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 20s-7-4.4-8.6-9C2.2 7.6 4.6 4.6 7.6 4.8c2 .1 3.4 1.6 4.4 3.2 1-1.6 2.4-3.1 4.4-3.2 3-.2 5.4 2.8 4.2 6.2C19 15.6 12 20 12 20z"/></svg>',
    star: '<svg class="doodle" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
    moon: '<svg class="doodle" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5z"/><path fill="currentColor" d="M18 4l.6 1.4L20 6l-1.4.6L18 8l-.6-1.4L16 6l1.4-.6z"/></svg>',
    sun: '<svg class="doodle" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>'
  };

  /* What a plane's trail is drawn in, by subject - and in the season's
   * marks when the season has some (snow in December). */
  var GLYPHS = {
    math: ['π', '∑', '√', '∞', '÷', '∫', 'x²', '≠', 'Δ'],
    spanish: ['¡', '¿', 'ñ', 'á', 'é', '¡olé!', 'hola'],
    french: ['é', 'è', 'ç', '«', '»', 'ê', 'oui'],
    german: ['ä', 'ö', 'ü', 'ß', 'ja!'],
    latin: ['I', 'V', 'X', 'L', 'C', 'SPQR'],
    chinese: ['你好', '学', '文', '谢', '☆'],
    biology: ['❀', '✿', '⚘', '❦', 'DNA'],
    chemistry: ['⚗', 'H₂O', 'Na⁺', 'O₂', '⌬', 'CO₂'],
    physics: ['⚛', 'λ', 'Δ', 'ħ', 'F=ma', 'E=mc²'],
    science: ['⚛', '⚗', '☄', '✶', '?'],
    history: ['⚜', '✒', '1066', '1776', '1492', '⚔'],
    english: ['“', '”', '¶', '§', ';', 'Aa', '…'],
    theology: ['✝', '✦', '❁', '♡', 'α', 'ω'],
    music: ['♪', '♫', '♩', '♬', '♭', '♯'],
    art: ['●', '●', '●', '✦', '▲'],
    drama: ['☺', '☹', '★', '✦'],
    cs: ['{', '}', '</>', '0', '1', ';', '=>'],
    pe: ['★', '➔', '!', '♡'],
    economics: ['$', '€', '¥', '£', '%', '↗'],
    psychology: ['?', '!', '☺', '♡', '✦'],
    winter: ['❄', '❅', '❆'],
    fall: ['❦', '❧', '✿'],
    finale: ['☀', '★', '✦']
  };
  var ART_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];

  function trailGlyphs(spec) {
    var out = [];
    (GLYPHS[spec.subject] || []).forEach(function (t) {
      out.push({ t: t, c: spec.subject === 'art' ? ART_COLORS[Math.floor(Math.random() * ART_COLORS.length)] : null });
    });
    // Season marks join in; with no subject, they are the whole trail.
    (GLYPHS[spec.season] || []).forEach(function (t) { out.push({ t: t, c: null }); });
    return out;
  }

  /* The postage stamp in the note's corner: the subject's mark (or the
   * season's, or a plane), with the subject's name under it. */
  function stampFor(spec, kind) {
    var mark = kind === 'gold' ? '★' : (GLYPHS[spec.subject] || GLYPHS[spec.season] || ['✈'])[0];
    var label = spec.subject && CGP.AirmailState ? CGP.AirmailState.subjectLabel(spec.subject) : 'Airmail';
    return { mark: mark, label: label };
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* Where the plane is at t (0..1) of a pass across a w x h page: a gentle
   * wave left to right, with one full loop-de-loop part way along. */
  function pathAt(t, geo) {
    var loopAt = geo.loopAt, loopLen = geo.loopLen;
    var s, lx = 0, ly = 0;
    if (t < loopAt) s = t;
    else if (t < loopAt + loopLen) {
      s = loopAt;
      var th = ((t - loopAt) / loopLen) * Math.PI * 2;
      lx = geo.r * Math.sin(th);
      ly = -geo.r * (1 - Math.cos(th));
    } else s = t - loopLen;
    var u = s / (1 - loopLen);
    var x = -90 + u * (geo.w + 180);
    var y = geo.y0 + geo.amp * Math.sin(u * Math.PI * 2 * geo.waves) + geo.drift * u;
    if (geo.reverse) x = geo.w - x;
    return { x: x + (geo.reverse ? -lx : lx), y: y + ly };
  }

  function launch(opts) {
    opts = opts || {};
    var note = opts.note || {};
    var spec = opts.spec || {};
    var kind = spec.golden ? 'gold' : spec.flavor === 'night' ? 'night' : 'plain';
    var finished = false;

    var host = el('div', 'cgp-airmail');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    var sky = el('div', 'sky');
    root.appendChild(sky);
    document.documentElement.appendChild(host);

    function done() {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      setTimeout(function () { host.remove(); }, 700);
      try { if (opts.onDone) opts.onDone(); } catch (e) { /* ignore */ }
    }

    // The lead plane, and in a flock its wingmen: echelons behind it in a
    // V, a beat later along the same path. Any one of them carries the note.
    var formation = [{ dx: 0, dy: 0, lag: 0 }];
    if (spec.flock && !reducedMotion()) {
      formation.push({ dx: -70, dy: -46, lag: 0.018 }, { dx: -70, dy: 46, lag: 0.018 },
        { dx: -140, dy: -92, lag: 0.036 }, { dx: -140, dy: 92, lag: 0.036 });
    }
    var caught = false;
    var raf = 0, missTimer = 0, flip = 1;
    var planes = formation.map(function (f, i) {
      var b = el('button', 'plane' + (i ? ' is-wing' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', i ? 'Another paper airplane in the flock.' :
        (formation.length > 1 ? 'A flock of paper airplanes is flying by. Catch one to read the note.' :
          'A paper airplane is flying by. Catch it to read the note.'));
      b.innerHTML = planeSvg(kind);
      b._f = f;
      b._angle = 0;
      sky.appendChild(b);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (caught) return;
        cancelAnimationFrame(raf);
        clearTimeout(missTimer);
        catchIt(b);
      });
      return b;
    });
    var plane = planes[0];
    var glyphs = trailGlyphs(spec);

    if (reducedMotion()) {
      plane.classList.add('corner');
      plane.style.position = 'absolute';
      missTimer = setTimeout(function () {
        plane.style.transition = 'opacity .8s';
        plane.style.opacity = '0';
        try { if (opts.onMiss) opts.onMiss(); } catch (e) { /* ignore */ }
        setTimeout(done, 800);
      }, 15000);
    } else {
      fly(false, formation.length > 1 ? 9500 : 8500);
    }

    function fly(reverse, duration) {
      var w = window.innerWidth, h = window.innerHeight;
      var geo = {
        w: w, h: h, reverse: reverse,
        y0: h * (0.22 + Math.random() * 0.3),
        amp: 26 + Math.random() * 30,
        waves: 1 + Math.random() * 0.8,
        drift: h * (Math.random() * 0.16 - 0.04),
        loopAt: 0.38 + Math.random() * 0.2,
        // A flock keeps formation: no loop for them.
        loopLen: reverse || formation.length > 1 ? 0 : 0.16,
        r: 48 + Math.random() * 26
      };
      flip = reverse ? -1 : 1;
      var start = 0, lastTrail = 0, trailN = 0;
      var maxLag = formation[formation.length - 1].lag;
      planes.forEach(function (b) { b._prev = null; });
      var step = function (ts) {
        if (!start) start = ts;
        var t = (ts - start) / duration;
        if (t >= 1 + maxLag) {
          if (!reverse) { missTimer = setTimeout(function () { fly(true, 10500); }, 1400); return; }
          try { if (opts.onMiss) opts.onMiss(); } catch (e) { /* ignore */ }
          done();
          return;
        }
        var trailNow = ts - lastTrail > 55;
        if (trailNow) lastTrail = ts;
        planes.forEach(function (b) {
          var f = b._f;
          var p = pathAt(Math.min(Math.max(0, t - f.lag), 1), geo);
          p = { x: p.x + (reverse ? -f.dx : f.dx), y: p.y + f.dy };
          var prev = b._prev || p;
          var dx = p.x - prev.x, dy = p.y - prev.y;
          if (dx || dy) b._angle = Math.atan2(dy, dx) * 180 / Math.PI;
          b._prev = p;
          b._pos = p;
          b.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) rotate(' + b._angle.toFixed(1) + 'deg)' + (flip < 0 ? ' scaleY(-1)' : '');
          if (trailNow && (b === plane || trailN % 2 === 0)) dropTrail(p, b._angle, trailN);
        });
        if (trailNow) trailN++;
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    /* One puff of the trail behind a plane: a dot, or every third puff one
     * of the subject's marks (a pi, a note, a ñ), drifting as it fades. */
    function dropTrail(p, angle, n) {
      var rad = angle * Math.PI / 180;
      var glyph = glyphs.length && n % 3 === 0 ? glyphs[Math.floor(Math.random() * glyphs.length)] : null;
      var dot = el('span', 'trail' + (glyph ? ' is-glyph' : '') + (kind === 'gold' ? ' is-gold' : kind === 'night' ? ' is-night' : ''));
      dot.setAttribute('aria-hidden', 'true');
      if (glyph) {
        dot.textContent = glyph.t;
        if (glyph.c) dot.style.color = glyph.c;
        dot.style.setProperty('--spin', (Math.random() * 60 - 30).toFixed(0) + 'deg');
      }
      dot.style.left = (p.x - Math.cos(rad) * 28).toFixed(1) + 'px';
      dot.style.top = (p.y - Math.sin(rad) * 28).toFixed(1) + 'px';
      sky.appendChild(dot);
      setTimeout(function () { dot.remove(); }, glyph ? 2300 : 1700);
    }

    function catchIt(b) {
      caught = true;
      var kept = Promise.resolve(null);
      try { if (opts.onCatch) kept = Promise.resolve(opts.onCatch()); } catch (e) { /* ignore */ }
      var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      if (b.classList.contains('corner')) {
        var r = b.getBoundingClientRect();
        b.classList.remove('corner');
        b.style.right = 'auto';
        b.style.bottom = 'auto';
        b.style.left = '0';
        b.style.top = '0';
        b.style.margin = '-32px 0 0 -32px';
        b.style.transform = 'translate(' + (r.left + r.width / 2) + 'px,' + (r.top + r.height / 2) + 'px)';
        void b.offsetWidth;
      }
      // The rest of the flock peels away upward and is gone.
      planes.forEach(function (o) {
        if (o === b || !o._pos) return;
        o.classList.add('is-scatter');
        o.style.transform = 'translate(' + (o._pos.x + (Math.random() * 300 - 150)).toFixed(0) + 'px,-120px) rotate(-80deg)';
      });
      b.classList.add('is-caught');
      b.style.transform = 'translate(' + cx + 'px,' + cy + 'px) rotate(' + ((b._angle || 0) + 720) + 'deg) scale(1.6)';
      setTimeout(function () { planes.forEach(function (o) { o.remove(); }); showNote(kept); }, reducedMotion() ? 150 : 650);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeNote(); }
    }

    var card = null, veil = null, returnFocus = null;

    function showNote(kept) {
      returnFocus = document.activeElement;
      veil = el('div', 'veil');
      veil.addEventListener('click', closeNote);
      sky.appendChild(veil);

      card = el('div', 'note' + (kind === 'gold' ? ' is-gold' : kind === 'night' ? ' is-night' : ''));
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'A note from a paper airplane');
      var doodle = kind === 'gold' ? 'star' : kind === 'night' ? 'moon' : spec.flavor === 'friday' ? 'sun' : (Math.random() < 0.5 ? 'heart' : 'star');
      var st = stampFor(spec, kind);
      var stamp = el('div', 'stamp');
      stamp.setAttribute('aria-hidden', 'true');
      stamp.appendChild(el('b', '', st.mark));
      stamp.appendChild(el('i', '', st.label));
      card.appendChild(stamp);
      var today = new Date();
      var pm = el('div', 'postmark');
      pm.setAttribute('aria-hidden', 'true');
      pm.appendChild(el('span', '', formation.length > 1 ? 'By flock' : 'Airmail'));
      pm.appendChild(el('span', '', today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
      pm.appendChild(el('span', '', String(today.getFullYear())));
      card.appendChild(pm);
      if (kind === 'gold') card.appendChild(el('span', 'label', 'A very rare note'));
      card.appendChild(el('p', 'text', note.text || ''));
      var from = el('p', 'from');
      from.innerHTML = DOODLES[doodle];
      from.appendChild(document.createTextNode('\u2014 ' + (note.from || 'someone')));
      card.appendChild(from);
      var foot = el('div', 'foot');
      var first = el('span', 'first');
      foot.appendChild(first);
      var keep = el('button', 'keep', 'Tuck it in the Shoebox');
      keep.type = 'button';
      keep.addEventListener('click', closeNote);
      foot.appendChild(keep);
      card.appendChild(foot);
      sky.appendChild(card);
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { try { keep.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 400);
      if (kind === 'gold' && !reducedMotion()) sparkles();

      kept.then(function (res) {
        if (!res || !res.first || !first.isConnected) return;
        first.appendChild(document.createTextNode('Your first note. It’s kept in your '));
        var a = el('a', '', 'Shoebox');
        a.setAttribute('role', 'link');
        a.tabIndex = 0;
        var open = function (e) {
          e.preventDefault();
          try { chrome.runtime.sendMessage({ type: 'cgp.openOptions', hash: 'shoebox' }); } catch (err) { /* extension reloaded */ }
        };
        a.addEventListener('click', open);
        a.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(e); });
        first.appendChild(a);
        first.appendChild(document.createTextNode('.'));
      }, function () { /* the note still shows */ });
    }

    function sparkles() {
      var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      for (var i = 0; i < 22; i++) {
        var s = el('span', 'sparkle');
        var a = Math.random() * Math.PI * 2, d = 150 + Math.random() * 170;
        s.style.left = cx + 'px';
        s.style.top = cy + 'px';
        s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
        s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
        s.style.animationDelay = (Math.random() * 0.25).toFixed(2) + 's';
        sky.appendChild(s);
      }
    }

    function closeNote() {
      if (!card || card.classList.contains('is-away')) return;
      card.classList.add('is-away');
      if (veil) { veil.style.transition = 'opacity .4s'; veil.style.opacity = '0'; }
      try { if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      done();
    }
  }

  CGP.AirmailFlight = { launch: launch, _pathAt: pathAt };
})();
