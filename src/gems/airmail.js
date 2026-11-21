/* Canvas Gradebook+ - Airmail: the paper airplane and the letter it carries.
 *
 * Injected by background.js only when airmail-state.js has decided a plane
 * flies today. CGP.AirmailFlight.launch({ note, spec, onCatch, onMiss, onDone })
 * sends one plane:
 *
 *   - it glides in slowly from the left on a long, lazy arc (sometimes with
 *     one wide loop), and slows almost to a hover whenever the pointer comes
 *     near it - it wants to be caught;
 *   - it then comes in to land in the bottom-right corner and waits there,
 *     bobbing gently, with a small "A note for you" beside it;
 *   - left alone for a minute and a quarter, it takes off again (onMiss);
 *   - clicked - in the air or waiting - it glides to the middle of the page
 *     and opens into an airmail letter (onCatch keeps it in the Shoebox):
 *     the red-and-blue Par Avion edge, a perforated stamp in the subject's
 *     colour and mark, an inked postmark with the day. "Keep it", Escape or a
 *     click outside folds it away.
 *
 * Its path is drawn behind it as a fine pencil-dotted line on a canvas, with
 * the course subject's marks (pi behind a math plane, eighth notes behind a
 * music one) floating off it now and then; snowflakes in December. A flock
 * (spec.flock) is five planes in a V; the lead lands, the others fly on, and
 * whichever is caught carries the note.
 *
 * Everything is drawn inside one shadow root, so Canvas's styles cannot reach
 * it and it cannot reach Canvas. With "reduce motion" on, the plane does not
 * fly: it is simply waiting in the corner. Nothing here takes focus
 * uninvited, so typing in the grid carries on. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.AirmailFlight) return;

  var SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  /* Each subject's stamp: its colour and its mark. */
  var STAMPS = {
    math: ['#2c5ea8', 'π'], spanish: ['#c4503a', 'ñ'], french: ['#33569c', 'é'],
    german: ['#3f4650', 'ß'], latin: ['#8a3a36', 'L'], chinese: ['#b3302c', '文'],
    biology: ['#2f7d55', '❀'], chemistry: ['#227a73', '⚗'], physics: ['#3b4fa0', '⚛'],
    science: ['#2f7d55', '⚛'], history: ['#8a6a35', '⚜'], english: ['#5f4596', '¶'],
    theology: ['#4f427f', '✝'], music: ['#a8416a', '♫'], art: ['#d9732c', '✦'],
    drama: ['#7d2d3b', '☺'], cs: ['#1d6b76', '{ }'], pe: ['#c95d29', '★'],
    economics: ['#33765a', '$'], psychology: ['#6c55a3', 'ψ']
  };

  /* What floats off a plane's trail, by subject, and by season. */
  var GLYPHS = {
    math: ['π', '∑', '√', '∞', '∫', 'x²', 'Δ'],
    spanish: ['¡', '¿', 'ñ', 'á', 'olé'],
    french: ['é', 'ç', '« »', 'ê', 'oui'],
    german: ['ä', 'ö', 'ü', 'ß'],
    latin: ['I', 'V', 'X', 'SPQR'],
    chinese: ['学', '文', '谢'],
    biology: ['❀', '✿', '❦'],
    chemistry: ['⚗', 'H₂O', 'O₂', 'Na⁺'],
    physics: ['⚛', 'λ', 'ħ', 'E=mc²'],
    science: ['⚛', '⚗', '✶'],
    history: ['⚜', '✒', '1776', '1066'],
    english: ['“ ”', '¶', '§', ';'],
    theology: ['✝', '✦', 'α', 'ω'],
    music: ['♪', '♫', '♩', '♬', '♭'],
    art: ['●', '●', '●', '●'],
    drama: ['☺', '☹', '★'],
    cs: ['{ }', '</>', '0', '1', ';'],
    pe: ['★', '♡'],
    economics: ['$', '€', '%'],
    psychology: ['ψ', '?', '♡'],
    winter: ['❄', '❅', '❆'],
    fall: ['❦', '✿'],
    finale: ['☀', '✦']
  };
  var ART_COLORS = ['#e05a47', '#f0a33a', '#e8c547', '#4fa66b', '#3d7fd1', '#9a5bc4'];

  var CSS = [
    ':host { all: initial; }',
    '.sky { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; }',
    'canvas.trail { position: absolute; inset: 0; width: 100%; height: 100%; }',

    /* The plane: a generous, invisible hit area around the drawing. */
    '.plane { position: absolute; left: 0; top: 0; width: 140px; height: 96px; margin: -48px 0 0 -70px; padding: 0;',
    '  border: 0; background: none; cursor: pointer; pointer-events: auto; will-change: transform;',
    '  -webkit-tap-highlight-color: transparent; outline: none; }',
    '.plane .craft { position: absolute; left: 14px; top: 20px; width: 112px; height: 56px; filter: drop-shadow(0 2px 2px rgba(30, 45, 60, .18)); transition: transform .35s cubic-bezier(.3, 1.4, .5, 1); }',
    '.plane .craft svg { display: block; width: 100%; height: 100%; overflow: visible; }',
    '.plane:hover .craft, .plane:focus-visible .craft { transform: translateY(-5px) scale(1.06); }',
    '.plane:focus-visible::after { content: ""; position: absolute; inset: 6px; border-radius: 40px; border: 2px solid #2c5ea8; }',
    '.plane.is-wing { width: 96px; height: 68px; margin: -34px 0 0 -48px; }',
    '.plane.is-wing .craft { left: 12px; top: 16px; width: 72px; height: 36px; }',
    '.plane.is-perched .craft { animation: bob 3.4s ease-in-out infinite; }',
    '.plane.is-perched:hover .craft { animation-play-state: paused; }',
    '@keyframes bob { 0%, 100% { translate: 0 0; rotate: 0deg; } 50% { translate: 0 -5px; rotate: -2deg; } }',
    '.plane.is-leaving { transition: transform 2.4s cubic-bezier(.55, 0, .9, .45), opacity .6s 1.8s; opacity: 0; }',
    '.plane.is-caught { transition: transform .75s cubic-bezier(.45, 0, .2, 1), opacity .3s .5s; opacity: 0; }',
    '.plane.is-scatter { transition: transform 1.3s cubic-bezier(.4, 0, .9, .6), opacity 1s; opacity: 0; }',

    /* Its shadow on the page below: further and softer the higher it flies. */
    '.shade { position: absolute; left: 0; top: 0; width: 70px; height: 12px; margin: -6px 0 0 -35px; border-radius: 50%;',
    '  background: radial-gradient(closest-side, rgba(20, 32, 44, .32), rgba(20, 32, 44, 0)); will-change: transform, opacity; }',
    '.shade.is-gone { transition: opacity .4s; opacity: 0 !important; }',

    /* "A note for you", beside a waiting plane. */
    '.tag { position: absolute; right: 168px; bottom: 70px; padding: 7px 12px 7px 11px; border-radius: 999px;',
    '  background: #fff; color: #23303b; font: 600 12.5px/1 ' + SANS + '; letter-spacing: .01em; white-space: nowrap;',
    '  box-shadow: 0 1px 2px rgba(15, 25, 35, .12), 0 6px 18px rgba(15, 25, 35, .14);',
    '  opacity: 0; transform: translateX(8px); transition: opacity .4s, transform .4s cubic-bezier(.3, 1.3, .5, 1); }',
    '.tag::after { content: ""; position: absolute; right: -4px; top: 50%; width: 9px; height: 9px; margin-top: -4.5px;',
    '  background: #fff; transform: rotate(45deg); border-radius: 2px; }',
    '.tag.is-on { opacity: 1; transform: none; }',
    '.tag .dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #d6453d;',
    '  vertical-align: 1px; animation: ping 2s ease-out infinite; }',
    '@keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(214, 69, 61, .45); } 70%, 100% { box-shadow: 0 0 0 7px rgba(214, 69, 61, 0); } }',

    /* The letter. */
    '.veil { position: fixed; inset: 0; pointer-events: auto; background: rgba(18, 26, 34, .38);',
    '  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); animation: fade .5s ease-out both; }',
    '.veil.is-away { transition: opacity .35s; opacity: 0; }',
    '@keyframes fade { from { opacity: 0; } }',
    '.letter { position: fixed; left: 50%; top: 50%; width: min(520px, calc(100vw - 32px)); box-sizing: border-box;',
    '  pointer-events: auto; color: #2a2620; border-radius: 6px; overflow: hidden;',
    '  background: radial-gradient(120% 90% at 15% 0%, #fffdf8 0%, #fbf7ee 55%, #f6f0e2 100%);',
    '  box-shadow: 0 1px 0 rgba(255, 255, 255, .7) inset, 0 2px 4px rgba(20, 20, 10, .08), 0 24px 60px rgba(10, 20, 30, .35);',
    '  transform: translate(-50%, -50%); transform-origin: 50% 40%;',
    '  animation: open .8s cubic-bezier(.2, .85, .25, 1) both; }',
    '@keyframes open { 0% { opacity: 0; transform: translate(-50%, -46%) perspective(900px) rotateX(68deg) scale(.55); }',
    '  60% { opacity: 1; } 100% { transform: translate(-50%, -50%) perspective(900px); } }',
    '.letter.is-away { animation: fold .38s cubic-bezier(.5, 0, .75, 0) forwards; }',
    '@keyframes fold { from { transform: translate(-50%, -50%) perspective(900px); }',
    '  to { opacity: 0; transform: translate(-50%, -44%) perspective(900px) rotateX(-24deg) scale(.94); } }',
    /* The Par Avion edge. */
    '.edge { height: 9px; background: repeating-linear-gradient(-45deg, #d6453d 0 11px, transparent 11px 19px, #2f5fa7 19px 30px, transparent 30px 38px); }',
    /* The fold creases the plane left behind. */
    '.creases { position: absolute; inset: 9px 0; pointer-events: none;',
    '  background: linear-gradient(90deg, transparent 49.85%, rgba(90, 70, 40, .07) 50%, rgba(255, 255, 255, .6) 50.15%, transparent 50.4%),',
    '              linear-gradient(162deg, transparent 32%, rgba(90, 70, 40, .045) 32.1%, transparent 32.4%),',
    '              linear-gradient(18deg, transparent 67.6%, rgba(90, 70, 40, .045) 67.7%, transparent 68%); }',
    '.inner { position: relative; padding: 26px 34px 24px; }',
    '.head { display: flex; align-items: baseline; gap: 10px; padding-right: 96px; min-height: 30px;',
    '  font: 700 10.5px/1.3 ' + SANS + '; letter-spacing: .16em; text-transform: uppercase; color: #2f5fa7; }',
    '.head .sep { color: #c9bfa8; }',
    '.head .when { color: #8b8170; font-weight: 600; }',
    '.text { margin: 26px 0 0; padding-right: 72px; font: italic 400 22px/1.5 ' + SERIF + '; color: #2a2620; text-wrap: pretty; }',
    '.text, .from, .foot { animation: rise .6s cubic-bezier(.2, .8, .3, 1) both; }',
    '.text { animation-delay: .25s; } .from { animation-delay: .42s; } .foot { animation-delay: .55s; }',
    '@keyframes rise { from { opacity: 0; transform: translateY(8px); } }',
    '.from { margin: 16px 0 0; text-align: right; font: 400 15px/1.4 ' + SERIF + '; color: #6f6656; }',
    '.foot { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 24px; padding-top: 16px;',
    '  border-top: 1px solid rgba(110, 90, 50, .14); font: 13px/1.4 ' + SANS + '; color: #7b7262; }',
    '.foot .first a { color: #2f5fa7; font-weight: 600; text-decoration: none; cursor: pointer; border-bottom: 1px solid rgba(47, 95, 167, .35); }',
    '.foot .first a:hover { border-bottom-color: #2f5fa7; }',
    '.keep { flex: 0 0 auto; margin-left: auto; border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer;',
    '  font: 600 13.5px/1 ' + SANS + '; background: #23303b; color: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .2);',
    '  transition: background .15s, transform .15s; }',
    '.keep:hover { background: #111a22; }',
    '.keep:active { transform: translateY(1px); }',
    '.keep:focus-visible { outline: 2px solid #2f5fa7; outline-offset: 3px; }',
    /* The stamp: perforated edge, the subject's colour and mark. */
    '.stamp { position: absolute; right: 30px; top: 22px; width: 64px; height: 80px; padding: 5px; box-sizing: border-box;',
    '  background: radial-gradient(circle, transparent 2.4px, #fffefa 2.9px) -4px -4px / 8px 8px;',
    '  filter: drop-shadow(0 1px 1.2px rgba(40, 30, 10, .28)); transform: rotate(3deg); }',
    '.stamp .face { position: relative; width: 100%; height: 100%; box-sizing: border-box; border: 2px solid rgba(255, 255, 255, .85);',
    '  background: var(--ink, #2f5fa7); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }',
    '.stamp .face::before { content: ""; position: absolute; inset: 0; background: radial-gradient(90% 70% at 30% 20%, rgba(255, 255, 255, .28), transparent 60%); }',
    '.stamp .mark { position: relative; font: 400 27px/1 ' + SERIF + '; white-space: nowrap; }',
    '.stamp .name { position: relative; margin-top: 6px; max-width: 46px; overflow: hidden; white-space: nowrap;',
    '  font: 700 7px/1 ' + SANS + '; letter-spacing: .12em; text-transform: uppercase; opacity: .9; }',
    '.postmark { position: absolute; right: 74px; top: 12px; width: 104px; height: 52px; pointer-events: none;',
    '  color: rgba(35, 45, 70, .5); transform: rotate(-11deg); mix-blend-mode: multiply; }',
    '.postmark svg { display: block; width: 100%; height: 100%; overflow: visible; }',
    /* Gold: a note from the teacher's own first year. */
    '.letter.is-gold { background: radial-gradient(120% 90% at 15% 0%, #fffaf0 0%, #fbf1d9 60%, #f3e2b8 100%); }',
    '.letter.is-gold .edge { background: repeating-linear-gradient(-45deg, #c99a2e 0 11px, transparent 11px 19px, #e6c56e 19px 30px, transparent 30px 38px); }',
    '.letter.is-gold .head { color: #9a6c12; }',
    '.letter.is-gold .stamp .face { background: linear-gradient(135deg, #f6d77c, #c8962c 55%, #f1cf73); color: #5a3d00; }',
    '.letter.is-night { background: radial-gradient(120% 90% at 15% 0%, #fbfcff 0%, #f1f3fa 60%, #e6e9f5 100%); }',
    '.letter.is-night .head { color: #3d4f8f; }',
    /* A word once it is kept. */
    '.kept { position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%); padding: 10px 16px; border-radius: 999px;',
    '  background: #23303b; color: #fff; font: 600 13px/1 ' + SANS + '; box-shadow: 0 8px 24px rgba(10, 20, 30, .25);',
    '  animation: kept 2.6s ease both; }',
    '@keyframes kept { 0% { opacity: 0; transform: translate(-50%, 10px); } 12%, 80% { opacity: 1; transform: translate(-50%, 0); }',
    '  100% { opacity: 0; transform: translate(-50%, 0); } }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .letter, .letter.is-away, .veil, .text, .from, .foot, .kept { animation-duration: .01s !important; animation-delay: 0s !important; }',
    '  .plane.is-perched .craft, .tag .dot { animation: none; }',
    '  .plane.is-caught, .plane.is-leaving { transition: opacity .2s; } }'
  ].join('\n');

  /* A paper dart in three-quarter view, nose to the right: the far wing just
   * showing above, the near wing's top face, and the keel folded under it -
   * each shaded, with a crisp fold line down the spine. */
  var planeN = 0;
  var PALETTES = {
    plain: { far: ['#dfe6ed', '#c3cfda'], top: ['#ffffff', '#e8eef4'], keel: ['#b4c1cd', '#8797a7'], line: '#6f8091' },
    night: { far: ['#e6ebfa', '#ccd5f0'], top: ['#fbfcff', '#e9eefc'], keel: ['#b9c4e8', '#97a5d6'], line: '#7f8fc4' },
    gold: { far: ['#f7e3a6', '#e8c66a'], top: ['#fff6d8', '#f6dd92'], keel: ['#dcae45', '#bb8a24'], line: '#a77a1a' }
  };
  function planeSvg(kind) {
    var id = 'am' + (++planeN);
    var c = PALETTES[kind] || PALETTES.plain;
    function grad(name, cols, x2, y2) {
      return '<linearGradient id="' + id + name + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '">' +
        '<stop offset="0" stop-color="' + cols[0] + '"/><stop offset="1" stop-color="' + cols[1] + '"/></linearGradient>';
    }
    return '<svg viewBox="0 0 120 60" aria-hidden="true" focusable="false"><defs>' +
      grad('f', c.far, 1, 0) + grad('t', c.top, 1, 1) + grad('k', c.keel, 0, 1) + '</defs>' +
      '<path d="M10 9 L116 29 L6 21 Z" fill="url(#' + id + 'f)"/>' +
      '<path d="M44 33 L116 29 L50 53 Z" fill="url(#' + id + 'k)"/>' +
      '<path d="M2 22 L116 29 L44 34 Z" fill="url(#' + id + 't)"/>' +
      '<path d="M2 22 L116 29 L44 34 Z" fill="none" stroke="' + c.line + '" stroke-width=".7" stroke-linejoin="round" opacity=".8"/>' +
      '<path d="M44 34 L116 29" stroke="#ffffff" stroke-width="1.1" opacity=".9"/>' +
      '<path d="M44 33.6 L116 29" stroke="' + c.line + '" stroke-width=".6" opacity=".45"/>' +
      '<path d="M44 33 L116 29 L50 53 Z" fill="none" stroke="' + c.line + '" stroke-width=".7" stroke-linejoin="round" opacity=".7"/>' +
      '</svg>';
  }

  function postmarkSvg(date, year) {
    var font = 'font-family="Helvetica, Arial, sans-serif" font-weight="700" fill="currentColor" text-anchor="middle"';
    var waves = '';
    for (var i = 0; i < 4; i++) {
      var y = 18 + i * 7.5;
      waves += '<path d="M62 ' + y + ' q6 -4 12 0 t12 0 t12 0 t12 0 t12 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
    }
    return '<svg viewBox="0 0 126 58" aria-hidden="true">' +
      '<circle cx="29" cy="29" r="26" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<circle cx="29" cy="29" r="20.5" fill="none" stroke="currentColor" stroke-width=".9"/>' +
      '<text x="29" y="24.5" ' + font + ' font-size="6.8" letter-spacing="1">AIRMAIL</text>' +
      '<text x="29" y="33.5" ' + font + ' font-size="7.4">' + date + '</text>' +
      '<text x="29" y="42" ' + font + ' font-size="6.2">' + year + '</text>' +
      waves + '</svg>';
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

  function bez(a, b, c, d, u) {
    var v = 1 - u;
    return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
  }

  /* Where the plane is at progress u (0..1) of its flight: a long cubic arc
   * from off the left edge to its landing spot, a gentle swell that dies
   * away as it comes in, and (if g.loopLen) one wide, slow loop. */
  function pathAt(u, g) {
    var x = bez(g.x0, g.x1, g.x2, g.x3, u);
    var y = bez(g.y0, g.y1, g.y2, g.y3, u);
    y += g.swell * Math.sin(u * Math.PI * 2 * g.waves) * (1 - u) * (1 - u);
    if (g.loopLen && u > g.loopAt && u < g.loopAt + g.loopLen) {
      var k = (u - g.loopAt) / g.loopLen;
      var th = k * Math.PI * 2;
      x += g.r * Math.sin(th) - g.drag * Math.sin(k * Math.PI);
      y -= g.r * (1 - Math.cos(th));
    }
    return { x: x, y: y };
  }

  function launch(opts) {
    opts = opts || {};
    var note = opts.note || {};
    var spec = opts.spec || {};
    var kind = spec.golden ? 'gold' : spec.flavor === 'night' ? 'night' : 'plain';
    var calm = reducedMotion();
    var finished = false;

    var host = el('div', 'cgp-airmail');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    var sky = el('div', 'sky');
    root.appendChild(sky);
    document.documentElement.appendChild(host);

    /* ------------------------------------------------------ the trail */
    var canvas = el('canvas', 'trail');
    canvas.setAttribute('aria-hidden', 'true');
    sky.appendChild(canvas);
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    function sizeCanvas() {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }
    sizeCanvas();
    var dots = [];     // { x, y, born }
    var floaters = []; // { x, y, born, text, color, spin }
    var glyphs = (GLYPHS[spec.subject] || []).concat(GLYPHS[spec.season] || []);
    var dotColor = kind === 'gold' ? '201, 151, 40' : kind === 'night' ? '110, 128, 190' : '96, 114, 132';
    var glyphColor = kind === 'gold' ? '#b98a22' : kind === 'night' ? '#7584c0' : '#6f8396';
    var DOT_LIFE = 2600, GLYPH_LIFE = 3200;

    function drawTrail(now) {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      dots = dots.filter(function (d) { return now - d.born < DOT_LIFE; });
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        var a = 1 - (now - d.born) / DOT_LIFE;
        ctx.fillStyle = 'rgba(' + dotColor + ',' + (0.6 * a * a).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.2 + a * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      floaters = floaters.filter(function (f) { return now - f.born < GLYPH_LIFE; });
      for (var j = 0; j < floaters.length; j++) {
        var f = floaters[j];
        var k = (now - f.born) / GLYPH_LIFE;
        var alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
        ctx.save();
        ctx.globalAlpha = 0.9 * alpha;
        ctx.translate(f.x, f.y + k * 28);
        ctx.rotate(f.spin * k);
        ctx.fillStyle = f.color;
        ctx.font = '500 ' + (16 + k * 3).toFixed(1) + 'px ' + SERIF;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
      }
    }

    var sinceGlyph = 0;
    function leaveTrail(b, angleDeg, now, isLead) {
      var rad = angleDeg * Math.PI / 180;
      var p = b._pos;
      var tail = { x: p.x - Math.cos(rad) * 42, y: p.y - Math.sin(rad) * 42 + 3 };
      var last = b._lastDot;
      if (last && Math.hypot(tail.x - last.x, tail.y - last.y) < 10) return;
      b._lastDot = tail;
      dots.push({ x: tail.x, y: tail.y, born: now });
      if (isLead && glyphs.length && ++sinceGlyph >= 12) {
        sinceGlyph = 0;
        floaters.push({
          x: tail.x, y: tail.y - 12, born: now,
          text: glyphs[Math.floor(Math.random() * glyphs.length)],
          color: spec.subject === 'art' ? ART_COLORS[Math.floor(Math.random() * ART_COLORS.length)] : glyphColor,
          spin: (Math.random() - 0.5) * 0.7
        });
      }
    }

    /* ------------------------------------------------------ the planes */
    var formation = [{ dx: 0, dy: 0, lag: 0 }];
    if (spec.flock && !calm) {
      formation.push({ dx: -84, dy: -52, lag: 0.035 }, { dx: -84, dy: 52, lag: 0.035 },
        { dx: -168, dy: -104, lag: 0.07 }, { dx: -168, dy: 104, lag: 0.07 });
    }
    var caught = false, raf = 0, leaveTimer = 0, tagTimer = 0;
    var planes = formation.map(function (f, i) {
      var b = el('button', 'plane' + (i ? ' is-wing' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', i ? 'Another paper airplane in the flock.' :
        'A paper airplane with a note for you. Open it.');
      var craft = el('span', 'craft');
      craft.innerHTML = planeSvg(kind);
      b.appendChild(craft);
      var shade = el('span', 'shade');
      shade.setAttribute('aria-hidden', 'true');
      sky.insertBefore(shade, canvas.nextSibling);
      b._shade = shade;
      b._f = f;
      b._angle = 0;
      sky.appendChild(b);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!caught) catchIt(b);
      });
      return b;
    });
    var lead = planes[0];

    var tag = el('div', 'tag');
    tag.setAttribute('aria-hidden', 'true');
    tag.innerHTML = '<span class="dot"></span>';
    tag.appendChild(document.createTextNode('A note for you'));
    sky.appendChild(tag);

    function place(b, p, angle, alt) {
      b._pos = p;
      b._angle = angle;
      b.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) rotate(' + angle.toFixed(2) + 'deg)';
      // The shadow falls further below, larger and fainter, the higher it is.
      var drop = 30 + alt * 70;
      b._shade.style.transform = 'translate(' + (p.x - 4).toFixed(1) + 'px,' + (p.y + drop).toFixed(1) + 'px) scale(' +
        (1 + alt * 0.5).toFixed(2) + ',' + (1 + alt * 0.3).toFixed(2) + ')';
      b._shade.style.opacity = (0.8 - alt * 0.5).toFixed(2);
    }

    // Where it lands: the bottom-right corner, clear of the page's edge.
    function perchPoint() { return { x: window.innerWidth - 104, y: window.innerHeight - 92 }; }
    var perch = perchPoint();

    var pointer = { x: -9999, y: -9999 };
    function onPointer(e) { pointer.x = e.clientX; pointer.y = e.clientY; }
    document.addEventListener('pointermove', onPointer, { passive: true });

    function onResize() {
      sizeCanvas();
      perch = perchPoint();
      if (lead.classList.contains('is-perched')) place(lead, perch, -3, 0);
    }
    window.addEventListener('resize', onResize);

    if (calm) {
      place(lead, perch, -3, 0);
      landed();
    } else {
      fly();
    }

    function fly() {
      var w = window.innerWidth, h = window.innerHeight;
      var loops = Math.random() < 0.6 && formation.length === 1;
      var geo = {
        x0: -140, y0: h * (0.16 + Math.random() * 0.18),
        x1: w * 0.32, y1: h * (0.02 + Math.random() * 0.12),
        x2: w * 0.72, y2: h * (0.2 + Math.random() * 0.2),
        x3: perch.x, y3: perch.y,
        swell: 22 + Math.random() * 16, waves: 1.3 + Math.random() * 0.6,
        loopAt: 0.3 + Math.random() * 0.12, loopLen: loops ? 0.13 : 0,
        r: 62 + Math.random() * 16, drag: 40
      };
      var DURATION = formation.length > 1 ? 18000 : 16000;
      var maxLag = formation[formation.length - 1].lag;
      var progress = 0, lastTs = 0, speed = 1;
      var step = function (ts) {
        var dt = lastTs ? Math.min(64, ts - lastTs) : 16;
        lastTs = ts;
        // Slows almost to a hover while the pointer is close: easy to catch.
        var lp = lead._pos;
        var near = lp ? Math.hypot(pointer.x - lp.x, pointer.y - lp.y) : 9999;
        var want = near < 90 ? 0.12 : near < 220 ? 0.35 : 1;
        speed += (want - speed) * Math.min(1, dt / 220);
        progress += (dt * speed) / DURATION;
        var now = performance.now();
        planes.forEach(function (b, i) {
          var t = Math.min(1, Math.max(0, progress - b._f.lag));
          // Comes in quicker, lands slow.
          var u = 1 - Math.pow(1 - t, 1.7);
          var spread = 1 + u * 0.6;
          var p = pathAt(u, geo);
          var q = pathAt(Math.min(1, u + 0.004), geo);
          p = { x: p.x + b._f.dx * spread, y: p.y + b._f.dy * spread };
          q = { x: q.x + b._f.dx * spread, y: q.y + b._f.dy * spread };
          var heading = u > 0.996 ? b._angle : Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
          // A paper plane glides, it doesn't dive: keep the nose within a
          // gentle pitch - except going round the loop.
          var inLoop = geo.loopLen && u > geo.loopAt && u < geo.loopAt + geo.loopLen;
          if (!inLoop) heading = Math.max(-24, Math.min(18, heading));
          // Level off in the last stretch, nose a touch down to settle.
          var settle = Math.max(0, (u - 0.8) / 0.2);
          var angle = heading + (-3 - heading) * settle * settle;
          place(b, p, angle, 1 - u);
          if (u < 0.985) leaveTrail(b, angle, now, i === 0);
        });
        drawTrail(now);
        if (progress >= 1 + maxLag) {
          // The flock's wingmen fly on and away; the lead lands.
          planes.slice(1).forEach(function (b) { scatter(b, 1); });
          landed();
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function landed() {
      lead.classList.add('is-perched');
      tagTimer = setTimeout(function () { tag.classList.add('is-on'); }, calm ? 0 : 500);
      // Let the trail finish fading.
      var fadeTo = performance.now() + DOT_LIFE + 300;
      var fadeOut = function () {
        drawTrail(performance.now());
        if (!caught && performance.now() < fadeTo) raf = requestAnimationFrame(fadeOut);
      };
      raf = requestAnimationFrame(fadeOut);
      leaveTimer = setTimeout(takeOff, 75000);
    }

    function takeOff() {
      if (caught) return;
      tag.classList.remove('is-on');
      lead.classList.remove('is-perched');
      lead.classList.add('is-leaving');
      lead._shade.classList.add('is-gone');
      var p = lead._pos || perch;
      lead.style.transform = 'translate(' + (p.x + 260) + 'px,' + (p.y - window.innerHeight * 0.7) + 'px) rotate(-38deg)';
      try { if (opts.onMiss) opts.onMiss(); } catch (e) { /* ignore */ }
      done(2600);
    }

    function scatter(b, dir) {
      if (!b._pos) return;
      b.classList.add('is-scatter');
      b._shade.classList.add('is-gone');
      b.style.transform = 'translate(' + (b._pos.x + dir * (240 + Math.random() * 200)).toFixed(0) + 'px,' +
        (b._pos.y - 260 - Math.random() * 200).toFixed(0) + 'px) rotate(' + (-30 - Math.random() * 30).toFixed(0) + 'deg)';
    }

    function catchIt(b) {
      caught = true;
      cancelAnimationFrame(raf);
      clearTimeout(leaveTimer);
      clearTimeout(tagTimer);
      tag.classList.remove('is-on');
      var kept = Promise.resolve(null);
      try { if (opts.onCatch) kept = Promise.resolve(opts.onCatch()); } catch (e) { /* ignore */ }
      planes.forEach(function (o) { if (o !== b && !o.classList.contains('is-scatter')) scatter(o, o._f.dy < 0 ? -1 : 1); });
      b.classList.remove('is-perched');
      b._shade.classList.add('is-gone');
      void b.offsetWidth;
      b.classList.add('is-caught');
      b.style.transform = 'translate(' + (window.innerWidth / 2) + 'px,' + (window.innerHeight / 2) + 'px) rotate(-8deg) scale(1.5)';
      setTimeout(function () {
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        showLetter(kept);
      }, calm ? 120 : 560);
    }

    /* ------------------------------------------------------ the letter */
    var letter = null, veil = null, returnFocus = null;

    function onKey(e) {
      if (e.key === 'Escape' && letter) { e.stopPropagation(); e.preventDefault(); closeLetter(); }
    }

    function showLetter(kept) {
      returnFocus = document.activeElement;
      veil = el('div', 'veil');
      veil.addEventListener('click', closeLetter);
      sky.appendChild(veil);

      letter = el('div', 'letter' + (kind === 'gold' ? ' is-gold' : kind === 'night' ? ' is-night' : ''));
      letter.setAttribute('role', 'dialog');
      letter.setAttribute('aria-modal', 'true');
      letter.setAttribute('aria-label', 'A note from a paper airplane');
      letter.appendChild(el('div', 'edge'));
      letter.appendChild(el('div', 'creases'));

      var inner = el('div', 'inner');
      var today = new Date();
      var head = el('div', 'head');
      head.appendChild(el('span', '', kind === 'gold' ? 'A rare one' : 'Par avion'));
      head.appendChild(el('span', 'sep', '·'));
      head.appendChild(el('span', 'when', kind === 'gold' ? 'from your first year' :
        kind === 'night' ? 'late delivery' : formation.length > 1 ? 'by flock' : 'just arrived'));
      inner.appendChild(head);

      var subj = STAMPS[spec.subject];
      var stamp = el('div', 'stamp');
      stamp.setAttribute('aria-hidden', 'true');
      var face = el('div', 'face');
      if (subj) face.style.setProperty('--ink', subj[0]);
      face.appendChild(el('span', 'mark', kind === 'gold' ? '★' : subj ? subj[1] : '✈'));
      var label = spec.subject && CGP.AirmailState ? CGP.AirmailState.subjectLabel(spec.subject) : 'Airmail';
      face.appendChild(el('span', 'name', kind === 'gold' ? 'Year one' : label));
      stamp.appendChild(face);
      inner.appendChild(stamp);

      var pm = el('div', 'postmark');
      var month = today.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      pm.innerHTML = postmarkSvg(month + ' ' + today.getDate(), String(today.getFullYear()));
      inner.appendChild(pm);

      inner.appendChild(el('p', 'text', note.text || ''));
      inner.appendChild(el('p', 'from', '— ' + (note.from || 'someone')));

      var foot = el('div', 'foot');
      var first = el('span', 'first');
      foot.appendChild(first);
      var keep = el('button', 'keep', 'Keep it');
      keep.type = 'button';
      keep.addEventListener('click', closeLetter);
      foot.appendChild(keep);
      inner.appendChild(foot);
      letter.appendChild(inner);
      letter.appendChild(el('div', 'edge'));
      sky.appendChild(letter);

      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { try { keep.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 450);

      kept.then(function (res) {
        if (!res || !first.isConnected) return;
        if (res.first) {
          first.appendChild(document.createTextNode('Your first one. It’s waiting in your '));
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
        } else {
          first.textContent = 'Saved to your Shoebox.';
        }
      }, function () { /* the letter still shows */ });
    }

    function closeLetter() {
      if (!letter || letter.classList.contains('is-away')) return;
      letter.classList.add('is-away');
      if (veil) veil.classList.add('is-away');
      try { if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      setTimeout(function () { sky.appendChild(el('div', 'kept', 'Kept in your Shoebox')); }, 250);
      done(3000);
    }

    function done(linger) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      setTimeout(function () { cancelAnimationFrame(raf); host.remove(); }, linger || 700);
      try { if (opts.onDone) opts.onDone(); } catch (e) { /* ignore */ }
    }
  }

  CGP.AirmailFlight = { launch: launch, _pathAt: pathAt };
})();
