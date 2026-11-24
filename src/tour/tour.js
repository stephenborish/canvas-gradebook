/* Canvas Gradebook+ - the welcome tour.
 *
 * Shown once per install (tour-state.js), on the teacher's own gradebook. It
 * opens with a short introduction: a spotlight on a real cell with feedback
 * in it, what the bubble means, and a choice - Start grading, or one short
 * path (Grade faster, Copy to another class, Set up my schedule). A path is a
 * spotlight moving from one real element to the next - a submission badge,
 * a grade cell, a column header - with a card beside it saying what
 * Gradebook+ does there. Stops marked "try it" let the click through to the
 * page; the tour then folds into a small pill until the teacher asks for the
 * next stop.
 *
 * Everything is drawn inside one shadow root, so Canvas's stylesheet and ours
 * (gradebook.css) never reach in, and the tour's own styles never leak out.
 * While a card is up, keystrokes outside it are held back, so an M or a digit
 * can never land in a grade cell behind the tour. Nothing is read from or
 * written to Canvas.
 *
 * On any other page inside a course, a pending tour shows a small invitation
 * instead, which opens the gradebook with #cgp-tour. SpeedGrader shows
 * nothing: the teacher is in the middle of grading there. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.Tour) return;

  var Z = 2147483000;
  var GAP = 16;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* --------------------------------------------------------------- motion
   * Every movement in the tour shares one spring, so the spotlight, the card
   * and its contents travel together and settle together. Movement is
   * transform, size and opacity on the tour's own few elements, run with the
   * Web Animations API so a step can be interrupted mid-flight and the next
   * one starts from wherever things are on screen. With reduced motion,
   * nothing moves: content cross-fades and everything else is in place. */

  // A slightly under-damped spring (about 2% overshoot), sampled into a
  // linear() easing; durations below are how long it takes to settle.
  function springEasing(zeta, omega) {
    var wd = omega * Math.sqrt(1 - zeta * zeta), pts = [];
    for (var i = 0; i <= 40; i++) {
      var t = i / 40;
      var x = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
      pts.push((i === 40 ? 1 : Math.round(x * 1000) / 1000) + ' ' + (i * 2.5) + '%');
    }
    return 'linear(' + pts.join(', ') + ')';
  }
  var SPRING = springEasing(0.78, 11);
  var OUT = 'cubic-bezier(.16,1,.3,1)';
  var IN = 'cubic-bezier(.5,0,.75,0)';
  var MOVE_MS = 640;

  function tf(x, y) { return 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; }
  function spotFrame(g) {
    return { transform: tf(g.x, g.y), width: Math.max(0, g.w) + 'px', height: Math.max(0, g.h) + 'px', borderRadius: g.r + 'px' };
  }
  function grow(g, by) { return { x: g.x - by, y: g.y - by, w: g.w + by * 2, h: g.h + by * 2, r: g.r + by / 2 }; }
  function dot(g) { return { x: g.x + g.w / 2, y: g.y + g.h / 2, w: 0, h: 0, r: g.r }; }
  function finished(list) {
    return Promise.all(list.map(function (a) { return a && a.finished ? a.finished.catch(function () {}) : null; }));
  }

  /* Smoothly scrolls `el` to the middle of its scroller, resolving once the
   * scroll has settled: on scrollend, or once scrolling has gone quiet (no
   * scroll at all when it was already in view). Not the promise newer
   * Chrome returns from scrollIntoView: when the page itself is what
   * scrolls, that resolves at once, before the scroll has happened. */
  function scrollIntoViewAsync(el, smooth) {
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { /* ignore */ }
    if (!smooth) return Promise.resolve();
    return new Promise(function (resolve) {
      var timer = 0, cap = 0;
      var done = function () {
        clearTimeout(timer); clearTimeout(cap);
        window.removeEventListener('scrollend', done, true);
        window.removeEventListener('scroll', onScroll, true);
        resolve();
      };
      var onScroll = function () { clearTimeout(timer); timer = setTimeout(done, 120); };
      window.addEventListener('scrollend', done, true);
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      timer = setTimeout(done, 120);
      cap = setTimeout(done, 1200);
    });
  }

  /* --------------------------------------------------------------- styles */

  var CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    /* Canvas's own face, ink and blue, so the tour reads as part of the page it sits on. */
    '.layer{position:fixed;inset:0;z-index:' + Z + ';pointer-events:none;font-family:"Lato Extended",Lato,"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;color:#2d3b45;-webkit-font-smoothing:antialiased;--ink:#1a232b;--text:#2d3b45;--muted:#6b7780;--blue:#0374b5;--blue-dk:#045486;--tint:#eef6fb;--wash:#f5f7f8;--rule:#e1e5e8;--green:#0b7a45;--ease:cubic-bezier(.22,1,.36,1);--spring:cubic-bezier(.22,1,.36,1);--spring:' + SPRING + '}',
    '.layer.is-off .spot,.layer.is-off .card,.layer.is-off .block{opacity:0;pointer-events:none!important}',
    /* the spotlight: a cut-out in the dimmed page, ringed like Canvas's keyboard focus */
    '.spot{position:fixed;left:0;top:0;width:0;height:0;border-radius:8px;box-shadow:0 0 0 9999px rgba(26,35,43,.56);opacity:0;will-change:transform,width,height}',
    '.spot.is-on{opacity:1}',
    '.spot::before{content:"";position:absolute;inset:-4px;border-radius:inherit;border:2px solid var(--blue);box-shadow:0 0 0 2px #fff;transition:opacity .25s ease}',
    /* arrival: one ring spreading from the edge (ripple()) */
    '.spot::after{content:"";position:absolute;inset:-4px;border-radius:inherit;box-shadow:0 0 0 0 rgba(3,116,181,0)}',
    '.spot.is-empty::before{opacity:0}',
    '.block{position:fixed;pointer-events:auto;background:transparent}',
    /* the card */
    '.card{position:fixed;left:0;top:0;width:372px;max-width:calc(100vw - 24px);pointer-events:auto;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(26,35,43,.1),0 14px 36px -10px rgba(26,35,43,.38);transition:opacity .3s ease;opacity:0;outline:none;will-change:transform}',
    '.card.is-on{opacity:1}',
    '.card--center{width:520px}',
    '.card--finale{width:400px}',
    '.card__in{position:relative;border-radius:12px;overflow:hidden;padding:18px 20px 16px}',
    '.arrow{position:absolute;width:14px;height:14px;background:#fff;transform:rotate(45deg);border-radius:2px;display:none}',
    '.card[data-side="bottom"] .arrow{display:block;top:-6px}',
    '.card[data-side="top"] .arrow{display:block;bottom:-6px}',
    '.card[data-side="right"] .arrow{display:block;left:-6px}',
    '.card[data-side="left"] .arrow{display:block;right:-6px}',
    '.ghost{position:absolute;pointer-events:none}',
    /* head: which tutorial, how far along (a row of gradebook cells, ticked off as you go), close */
    '.head{display:flex;align-items:center;gap:12px;margin:0 0 12px}',
    '.label{flex:1 1 auto;min-width:0;font-size:13px;font-weight:700;color:var(--blue-dk)}',
    '.cells{flex:0 0 auto;display:flex;gap:3px}',
    '.cells i{width:16px;height:12px;border:1px solid #c7cdd1;border-radius:2px;background:#fff;display:grid;place-items:center;transition:background .35s ease,border-color .35s ease}',
    '.cells i.is-done{background:var(--blue);border-color:var(--blue)}',
    '.cells i.is-done::after{content:"";width:6px;height:3px;border:solid #fff;border-width:0 0 1.5px 1.5px;transform:translateY(-1px) rotate(-45deg)}',
    '.cells i.is-now{border-color:var(--blue);box-shadow:inset 0 0 0 1px var(--blue)}',
    '.x{all:unset;cursor:pointer;flex:0 0 auto;width:28px;height:28px;margin:-4px -6px -4px 0;border-radius:6px;display:grid;place-items:center;color:var(--muted)}',
    '.x:hover{background:var(--wash);color:var(--ink)}',
    '.x:focus-visible{outline:2px solid var(--blue);outline-offset:1px}',
    '.x svg{width:14px;height:14px;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
    'h2{margin:0 0 6px;font-size:18px;line-height:1.3;font-weight:700;color:var(--ink)}',
    'p{margin:0;font-size:14.5px;line-height:1.55;color:var(--text)}',
    'p b{color:var(--ink)}',
    '.c-blue{color:#0a72a8!important}.c-green{color:#0b7a45!important}.c-gray{color:#6b7780!important}',
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--wash);border-radius:4px;padding:1px 5px;color:var(--ink)}',
    '.note{margin-top:12px;padding:8px 12px;border-left:3px solid #c7cdd1;background:var(--wash);font-size:13.5px;line-height:1.5;color:var(--text)}',
    'ul{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:7px}',
    'li{position:relative;padding-left:16px;font-size:14px;line-height:1.55;color:var(--text)}',
    'li::before{content:"";position:absolute;left:2px;top:.62em;width:5px;height:5px;border-radius:1px;background:#8b959c}',
    'li b{color:var(--ink)}',
    /* keys, as on a keyboard; the status keys in Canvas\'s status colours */
    '.kc{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;margin:0 1px;border-radius:5px;font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);background:#fff;border:1px solid #c7cdd1;border-bottom-width:2px;vertical-align:1px}',
    '.kc--red{color:#fff;background:#d1453b;border-color:#a8352d}',
    '.kc--amber{color:#3a2600;background:#e0a300;border-color:#b78512}',
    '.kc--green{color:#fff;background:#0b7a45;border-color:#095f36}',
    /* try it: what to do on the real page */
    '.try{display:flex;gap:10px;align-items:baseline;margin-top:14px;padding:9px 12px;border-left:3px solid var(--blue);background:var(--tint);font-size:14px;line-height:1.5;color:var(--text)}',
    '.try__k{flex:0 0 auto;font-weight:700;color:var(--blue-dk)}',
    '.try b{color:var(--ink)}',
    /* footer */
    '.foot{display:flex;align-items:center;gap:6px;margin-top:16px}',
    '.step{flex:1 1 auto;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:8px;font-size:14px;font-weight:700;white-space:nowrap;transition:background .15s ease,color .15s ease,transform .1s ease}',
    '.btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}',
    '.btn:active{transform:scale(.97)}',
    '.btn--primary{color:#fff;background:var(--blue)}',
    '.btn--primary:hover{background:var(--blue-dk)}',
    '.btn--ghost{color:var(--text)}',
    '.btn--ghost:hover{background:var(--wash);color:var(--ink)}',
    '.btn--soft{color:var(--blue-dk);background:var(--tint)}',
    '.btn--soft:hover{background:#e0eef8}',
    '.btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    /* the welcome card: the tutorials as a ruled list, like a class roster */
    '.card--intro{width:480px}',
    '.card--intro .card__in{max-height:calc(100vh - 24px);overflow:auto}',
    '.brand{display:flex;align-items:center;gap:10px;margin:0 0 14px}',
    '.brand .label{font-size:14px;color:var(--ink)}',
    '.brand__mark{flex:0 0 auto;width:30px;height:30px;border-radius:7px;background:var(--blue);display:grid;place-items:center}',
    '.brand__mark svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.choices{list-style:none;display:block;margin:14px -8px 0;padding:0;border-top:1px solid var(--rule)}',
    '.choices li{padding:0}.choices li::before{display:none}',
    '.choice{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;padding:9px 8px;border-bottom:1px solid var(--rule);transition:background .15s ease}',
    '.choice:hover{background:var(--wash)}',
    '.choice:focus-visible{outline:2px solid var(--blue);outline-offset:-2px;border-radius:4px}',
    '.choice .ico{flex:0 0 auto;width:20px;height:20px;color:var(--blue)}',
    '.choice .ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
    '.choice__t{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}',
    '.choice__t b{font-size:14.5px;font-weight:700;color:var(--ink)}',
    '.choice__t small{font-size:13px;line-height:1.4;color:var(--muted)}',
    '.choice__meta{flex:0 0 auto;font-size:12.5px;color:var(--muted);white-space:nowrap}',
    '.choice__meta.is-done{display:inline-flex;align-items:center;gap:4px;color:var(--green);font-weight:700}',
    '.choice__meta svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '.hint{margin-top:12px;font-size:13px;line-height:1.5;color:var(--muted)}',
    /* illustrations: sizes and colours copied from gradebook.css (named per block) */
    '.art{margin:2px 0 14px;font-family:Lexend,"IBM Plex Sans",system-ui,sans-serif;color:#2d3b45}',
    '.art svg{display:block}',
    '.xl{display:grid;gap:8px}',
    '.xl__row{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--soft)}',
    /* a grade cell (css:91-578) */
    '.xc{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:96px;height:36px;background:#fff;border:1px solid #e6e9ec;font-size:16px;font-weight:600;color:#2d3b45;font-variant-numeric:tabular-nums}',
    '.xc--sel{background-image:linear-gradient(rgba(3,116,181,.13),rgba(3,116,181,.13));outline:2px solid #0374b5;outline-offset:-2px;border-radius:3px}',
    '.xc--active{box-shadow:inset 0 0 0 2px #1a232b,inset 0 0 0 3px #fff,0 2px 8px rgba(19,33,44,.14);border-radius:4px}',
    '.xc__cmt{position:absolute;right:3px;top:50%;width:18px;height:18px;transform:translateY(-50%);color:#0a72a8;filter:drop-shadow(0 0 1px #fff) drop-shadow(0 1px 1.5px rgba(19,33,44,.35))}',
    '.xc__cmt--shift{right:22px}',
    '.xc__cmt svg{width:18px;height:18px;fill:currentColor}',
    '.xc__cmt b{position:absolute;left:0;right:0;top:34%;transform:translateY(-50%);text-align:center;font-size:8.5px;font-weight:800;color:#fff;line-height:1}',
    '.xc__sub{position:absolute;right:3px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:4px;display:grid;place-items:center}',
    '.xc__sub svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
    '.xc__sub--in{background:#0b7a45;color:#fff;box-shadow:0 0 0 1px #fff,0 1px 2px rgba(19,33,44,.25)}',
    '.xc__sub--out{color:#98a3ab;box-shadow:inset 0 0 0 1.2px #98a3ab;opacity:.75}',
    '.xc__resub{position:absolute;left:0;bottom:0;border-style:solid;border-width:8px 0 0 8px;border-color:transparent transparent transparent #6b3fa0}',
    '.xc__st{position:absolute;left:2px;top:2px;width:17px;height:17px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;box-shadow:0 0 0 1.5px #fff,0 1px 2px rgba(19,33,44,.35)}',
    '.xc__st--m{background:#d1453b;color:#fff}.xc__st--l{background:#e0a300;color:#3a2600}',
    '.xc__flag{position:absolute;left:5px;top:50%;width:20px;height:20px;margin-top:-10px;filter:drop-shadow(0 0 .6px rgba(0,0,0,.75))}',
    '.xc__flag svg{width:20px;height:20px}',
    '.xc__flag~.xc__v{padding-left:24px}',
    '.xg{display:inline-grid;border:1px solid #d3d8dc}',
    '.xg__head,.xg__row{display:grid;grid-template-columns:70px 96px 96px}',
    '.xg__head span{padding:6px 8px;font-size:12px;font-weight:600;color:#1a232b;background:linear-gradient(#fdfefe,#eaeef1);border-bottom:2px solid #0374b5;text-align:center}',
    '.xg__head span:first-child{text-align:left}',
    '.xg__name{display:flex;align-items:center;padding:0 8px;font-size:13px;color:#0374b5;border-bottom:1px solid #e6e9ec}',
    '.xg .xc{width:96px;border-width:0 0 1px 1px}',
    '.xcap{margin-top:8px;font-size:12px;color:var(--muted)}',
    /* assignment header with Post (css:943-1071, 1496) */
    '.xh{position:relative;width:200px;height:74px;background:linear-gradient(#fdfefe,#eaeef1);border:1px solid #d3d8dc;border-bottom:2px solid #0374b5}',
    '.xh__label{position:absolute;left:4px;right:4px;top:6px;display:flex;flex-direction:column;align-items:center;text-align:center}',
    '.xh__label b{font-size:12px;font-weight:600;color:#1a232b}.xh__pts{font-size:10.5px;color:#6b7780}.xh__due{font-size:9.5px;font-weight:500;color:#045486}',
    '.xh__post{position:absolute;left:4px;right:4px;bottom:2px;height:15px;display:grid;place-items:center;background:#0374b5;border:1px solid #045486;border-radius:3px;color:#fff;font-size:10px;font-weight:700;letter-spacing:.02em}',
    /* dialog shell (.cgp-stats, css:2311-2515) */
    '.xp{background:#fff;border:1px solid #d3d8dc;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(19,33,44,.12)}',
    '.xp__eyebrow{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7780}',
    '.xp__title{position:relative;font-size:15px;font-weight:600;color:#1a232b;margin:1px 0 8px;padding-right:18px}',
    '.xp__x{position:absolute;right:0;top:-2px;font-size:18px;color:#6b7780;font-weight:400}',
    '.xp__sub{font-size:12px;font-weight:600;color:#1a232b;margin:4px 0 6px}',
    '.xp__foot{display:flex;align-items:center;gap:10px;margin-top:10px}',
    '.xp__cancel{font-size:12px;color:#2d3b45;border:1px solid #c7cdd1;border-radius:6px;padding:4px 10px}',
    '.xbtn{background:#0374b5;color:#fff;font-size:12px;font-weight:600;border-radius:6px;padding:5px 12px}',
    '.xs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}',
    '.xs__t{display:flex;flex-direction:column;border:1px solid #d3d8dc;border-radius:8px;padding:5px 7px}',
    '.xs__t small{font-size:10px;color:#6b7780}.xs__t b{font-size:14px;font-weight:600;color:#1a232b}.xs__t em{font-style:normal;font-size:10px;color:#6b7780}',
    '.xhist{display:flex;align-items:flex-end;gap:3px;height:92px;border-bottom:1px solid #c7cdd1;padding-top:12px}',
    '.xhist__col{flex:1 1 0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative}',
    '.xhist__col i{font-style:normal;font-size:10px;font-weight:600;color:#2d3b45;line-height:1.4}',
    '.xhist__bar{width:100%;background:#0374b5;border-radius:4px 4px 0 0;min-height:0}',
    '.xhist__col em{position:absolute;bottom:-16px;font-style:normal;font-size:10px;font-weight:600}',
    '.xp .xhist{margin-bottom:18px}',
    /* menus (css:1930-1993) */
    '.xm{width:100%;background:#fff;border:1px solid #c7cdd1;border-radius:8px;padding:7px;box-shadow:0 4px 16px rgba(19,33,44,.16)}',
    '.xm__input{border:1px solid #c7cdd1;border-radius:6px;padding:6px 9px;font-size:13px;margin-bottom:6px}',
    '.xm__row{display:flex;flex-direction:column;padding:6px 8px;border-radius:5px}',
    '.xm__row.is-on{background:#eef6fb}',
    '.xm__row b{font-size:13px;font-weight:600;color:#1a232b}.xm__row span{font-size:11.5px;color:#6b7780}',
    /* student overview (css:3108-3937) */
    '.xsi{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #d3d8dc;border-radius:12px;padding:10px 12px}',
    '.xsi__av{flex:0 0 auto;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:16px;font-weight:600;background:linear-gradient(140deg,#0374b5,#045486)}',
    '.xsi__nm{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}',
    '.xsi__nm small{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#6b7780}.xsi__nm b{font-size:16px;font-weight:600;color:#1a232b}.xsi__nm em{font-style:normal;font-size:10.5px;color:#6b7780}',
    '.xsi__gr{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;background:#eef6fb;border-radius:10px;padding:4px 10px}',
    '.xsi__gr b{font-size:18px;font-weight:650;color:#1a232b}.xsi__gr small{font-size:11px;font-weight:600;color:#045486}',
    '.xtiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}',
    '.xtile{display:flex;flex-direction:column;background:#fff;border:1px solid #d3d8dc;border-radius:10px;padding:6px 9px;position:relative;overflow:hidden}',
    '.xtile small{font-size:10.5px;color:#6b7780}.xtile b{font-size:18px;font-weight:650;color:#1a232b;line-height:1.2}.xtile em{font-style:normal;font-size:10px;color:#6b7780}',
    '.xtile--warn::before,.xtile--risk::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#e0a300}.xtile--risk::before{background:#d1453b}',
    '.xcard{background:#fff;border:1px solid #d3d8dc;border-radius:12px;padding:10px 12px}',
    '.xcard h4{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;font-size:13px;font-weight:600;color:#1a232b}',
    '.xso{display:flex;gap:8px;align-items:flex-start;border-radius:8px;padding:7px 9px;margin-top:5px;font-size:12px}',
    '.xso__i{flex:0 0 auto;width:16px;height:16px;margin-top:1px}.xso__i svg{width:16px;height:16px}',
    '.xso b{display:block;font-weight:600;color:#1a232b}.xso small{display:block;font-size:11px;color:#6b7780}',
    '.xso--risk{background:#fdecea}.xso--risk .xso__i{color:#d1453b}',
    '.xso--warn{background:#fdf4dc}.xso--warn .xso__i{color:#c48a00}',
    '.xso--good{background:#e8f5ee}.xso--good .xso__i{color:#0b7a45}',
    '.xshare{display:flex;align-items:center;gap:10px;border:1px solid rgba(3,116,181,.32);background:linear-gradient(#f7fbfe,#fff);border-radius:12px;padding:9px 12px}',
    '.xshare__i{flex:0 0 auto;width:30px;height:30px;border-radius:7px;background:#0374b5;color:#fff;display:grid;place-items:center}.xshare__i svg{width:15px;height:15px}',
    '.xshare__t{flex:1 1 auto;display:flex;flex-direction:column}.xshare__t b{font-size:13px;font-weight:600;color:#1a232b}.xshare__t small{font-size:11px;color:#6b7780}',
    '.xshare__chev{color:#0374b5;font-size:20px}',
    '.xpre{margin:8px 0 0;white-space:pre-wrap;font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8f9;border:1px solid #e6e9ec;border-radius:8px;padding:7px 9px;color:#2d3b45}',
    '.xheat{display:flex;gap:4px}',
    '.xheat__days{display:grid;grid-template-rows:repeat(7,12px);gap:3px;font-size:9px;color:#6b7780}.xheat__days i{font-style:normal;line-height:12px}',
    '.xheat__grid{display:grid;grid-template-rows:repeat(7,12px);grid-auto-flow:column;grid-auto-columns:12px;gap:3px}',
    '.xheat i[class^="h"],.xheat__key i{display:inline-block;width:12px;height:12px;border-radius:2px}',
    '.h0{background:#eef1f3}.h1{background:#cfe3f2}.h2{background:#8fc0e4}.h3{background:#3f8fcb}.h4{background:#045486}',
    '.xheat__key{display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:6px;font-size:10px;color:#6b7780}',
    '.xpill{font-style:normal;font-size:10.5px;font-weight:500;color:#045486;border:1px solid #d3d8dc;border-radius:999px;padding:0 7px}',
    '.xpg{display:flex;flex-wrap:wrap;gap:2px 8px;padding:6px 0;border-top:1px solid #e6e9ec;font-size:12px}',
    '.xpg b{color:#1a232b}.xpg small{flex-basis:100%;font-size:11px;color:#6b7780}',
    /* copy to other classes and compare (css:2660-2975) */
    '.xbox{flex:0 0 auto;width:14px;height:14px;border:1.5px solid #8b959c;border-radius:3px}',
    '.xbox.is-on{background:#0374b5 url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 14 14%27%3E%3Cpath d=%27M3.5 7.2l2.3 2.3 4.7-5%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 stroke-linecap=%27round%27/%3E%3C/svg%3E") center/100% no-repeat;border-color:#0374b5}',
    '.xlk{display:flex;align-items:center;gap:8px;padding:6px 4px;border-top:1px solid #e6e9ec;font-size:12.5px}',
    '.xlk b{font-weight:600;color:#1a232b}.xlk small{margin-left:auto;font-size:11px;color:#6b7780}',
    '.xsug{font-size:10.5px;color:#095f36;background:#e7f5ec;border-radius:4px;padding:0 5px}',
    '.xdest{border:1px solid #d3d8dc;border-radius:8px;padding:8px 10px;margin-top:6px}',
    '.xdest.is-on{border-color:rgba(3,116,181,.45);box-shadow:inset 3px 0 0 #0374b5}',
    '.xdest__h{display:flex;align-items:center;gap:8px;font-size:13px}.xdest__h b{color:#1a232b}',
    '.xpl{font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;white-space:nowrap}',
    '.xpl--new{color:#045486;background:#eef6fb}.xpl--same{color:#095f36;background:#e7f5ec}.xpl--diff{color:#6b3fa0;background:#f1eafb}.xpl--miss{color:#b42318;background:#fde8e7}',
    '.xdate{display:inline-flex;flex-direction:column;margin:6px 0 0 22px}',
    '.xdate small{font-size:10.5px;color:#6b7780}.xdate span{font-size:12px;border:1px solid #c7cdd1;border-radius:5px;padding:2px 6px}',
    '.xtbl{border:1px solid #e6e9ec;border-radius:6px;overflow:hidden;font-size:12px}',
    '.xtbl__r{display:grid;grid-template-columns:1.25fr 1fr 1fr;border-top:1px solid #e6e9ec}',
    '.xtbl__r>span{padding:6px 8px;display:flex;flex-direction:column;align-items:flex-start;gap:3px}',
    '.xtbl__h{border-top:0;background:linear-gradient(#fdfefe,#eaeef1);font-weight:600;color:#1a232b}',
    '.xtbl u{color:#045486}.xact{font-size:11px;color:#045486}',
    /* buttons on the page (css:2660-2700) */
    '.xbar{display:flex;justify-content:flex-end;gap:8px;padding:10px;background:#fff;border:1px solid #e6e9ec;border-radius:8px}',
    '.xcopyto{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;background:#f5f5f5;border:1px solid #c7cdd1;border-radius:4px;font-size:13.5px;color:#2d3b45}',
    '.xcopyto svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}',
    '.xcanvasbtn{display:inline-flex;align-items:center;min-height:34px;padding:0 12px;background:#0374b5;border-radius:4px;color:#fff;font-size:13.5px}',
    /* class schedule panel (css:4564-4651) */
    '.xsc{background:#fff;border:1px solid #d3d8dc;border-radius:8px;padding:8px;box-shadow:0 4px 16px rgba(19,33,44,.16);font-size:13px}',
    '.xsc__head{display:flex;align-items:center;gap:6px;padding-bottom:6px;border-bottom:1px solid #e6e9ec}',
    '.xsc__head b{flex:1 1 auto;text-align:center;font-size:13.5px;font-weight:600;color:#1a232b}',
    '.xsc__nav{width:28px;height:28px;display:grid;place-items:center;border:1px solid #e6e9ec;border-radius:8px;font-size:17px;color:#2d3b45}',
    '.xsc__today{font-size:12px;color:#045486;text-decoration:underline}',
    '.xsc__x{width:24px;text-align:center;font-size:18px;color:#6b7780}',
    '.xsc__tags{margin:6px 0 2px}.xsc__tags span{font-size:11.5px;background:#f3f5f7;border:1px solid #e6e9ec;border-radius:999px;padding:1px 7px}',
    '.xsc__row{display:flex;gap:4px;margin-top:4px}',
    '.xsc__pick{flex:1 1 auto;display:flex;flex-direction:column;padding:5px 9px;border:1px solid #e6e9ec;border-radius:6px}',
    '.xsc__row.is-match .xsc__pick{border-left:3px solid #0374b5}',
    '.xsc__pick b{font-weight:600;color:#1a232b}.xsc__pick small{font-size:12px;color:#6b7780}',
    '.xsc__badge{font-size:10.5px;font-weight:600;color:#fff;background:#0374b5;border-radius:999px;padding:0 6px;margin-left:4px}',
    '.xsc__alt{display:grid;place-items:center;padding:0 9px;border:1px solid #e6e9ec;border-radius:6px;font-size:12px;color:#045486}',
    '.xsc__foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid #e6e9ec;font-size:11.5px;color:#6b7780}',
    '.xsc__foot u{color:#045486}',
    /* a comment box before and after Tab */
    '.xsn{display:flex;flex-direction:column;align-items:flex-start;gap:6px}',
    '.xsn__box{width:100%;border:1px solid #c7cdd1;border-radius:6px;padding:7px 9px;font-size:13px;color:#2d3b45;background:#fff}',
    '.xsn__caret{display:inline-block;width:1.5px;height:15px;margin-left:1px;background:#0374b5;vertical-align:-3px;animation:blink 1s steps(1) infinite}',
    '.xsn__arrow{align-self:center;font-size:12px;color:#6b7780}',
    /* waiting for something the stop opens */
    '.card.is-busy .btn--primary{opacity:.85;cursor:progress}',
    '.spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:spin .8s linear infinite}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    /* numbered steps: a ruled list */
    '.steps{list-style:none;margin:12px 0 0;padding:0;display:block;border-top:1px solid var(--rule)}',
    '.steps li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--rule);font-size:14px;line-height:1.5}',
    '.steps li::before{display:none}',
    '.steps__n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;border:1.5px solid var(--blue);display:grid;place-items:center;font-size:12.5px;font-weight:700;color:var(--blue-dk)}',
    '.steps__t{display:block;color:var(--ink);font-weight:700}',
    /* the last card: a check that draws itself */
    '.done{display:flex;align-items:center;gap:12px;margin:0 0 10px}',
    '.done h2{margin:0}',
    '.done__mark{flex:0 0 auto;width:36px;height:36px;border-radius:50%;background:var(--green);display:grid;place-items:center}',
    '.done__mark svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22;animation:draw .45s .2s cubic-bezier(.65,0,.35,1) forwards}',
    '@keyframes draw{to{stroke-dashoffset:0}}',
    '.card--finale .foot{justify-content:flex-end}',
    /* the bar at the bottom of the page while trying something out, and after closing */
    '.pill{position:fixed;left:50%;bottom:20px;transform:translate(-50%,24px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:6px 6px 6px 16px;border-radius:10px;background:#fff;color:var(--text);box-shadow:0 1px 2px rgba(26,35,43,.12),0 12px 30px -8px rgba(26,35,43,.4);transition:transform .7s var(--spring),opacity .25s ease;font-size:14px}',
    '.pill.is-on{transform:translate(-50%,0);opacity:1;pointer-events:auto}',
    '.pill__txt{white-space:nowrap}.pill__txt b{color:var(--ink)}.pill__txt small{margin-left:10px;font-size:13px;color:var(--muted)}',
    '.pill--note{padding:10px 16px}',
    '.pill .btn{height:32px}',
    /* the offer in the corner */
    '.invite{position:fixed;right:20px;bottom:20px;width:340px;max-width:calc(100vw - 32px);pointer-events:auto;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(26,35,43,.12),0 14px 36px -10px rgba(26,35,43,.4);overflow:hidden;transform:translateY(36px) scale(.96);transform-origin:100% 100%;opacity:0;transition:transform .75s var(--spring),opacity .35s ease}',
    '.invite.is-on{transform:none;opacity:1}',
    '.invite .card__in{padding:16px 18px 14px}',
    '.invite .brand{margin-bottom:10px}',
    '.invite h2{font-size:17px}',
    '.invite p{font-size:14px}',
    '.invite .foot{margin-top:14px;justify-content:flex-end}',
    '@media (max-width:600px){.card,.card--intro,.card--center,.card--finale{width:calc(100vw - 24px)}}',
    /* Reduced motion: movement goes (tour.js does the same for its own
     * animations); end states stay, and fades and colour changes remain. */
    '@media (prefers-reduced-motion:reduce){.xsn__caret{animation:none}.done__mark svg{animation:none;stroke-dashoffset:0}.pill,.invite{transition:opacity .2s ease}.invite{transform:none}.pill{transform:translate(-50%,0)}.btn:active{transform:none}}'
  ].join('\n');

  var X_ICON = '<svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
  var DONE_ICON = '<svg viewBox="0 0 16 16"><path d="M3.5 8.4l3 2.9 6-6.6"/></svg>';
  var MARK = '<svg viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="13" rx="2.2"/><path d="M3 8h14M8 8v8.5"/><path d="M11 11.6l1.6 1.6 2.8-3"/></svg>';
  var SECTION_ICON = { grading: 'keys', student: 'person', tools: 'gear', snippets: 'bubble', classes: 'swap', groups: 'people', schedule: 'calendar' };

  function S() { return CGP.TourState; }
  function sectionInfo(id) { return S().section(id) || { id: id, title: id, page: 'gradebook' }; }

  /* Where this page is: 'gradebook', 'home', 'options' or 'other'. */
  function pageHere() {
    if (typeof location === 'undefined') return 'other';
    if (/\/src\/options\//.test(location.pathname)) return 'options';
    return S().pageKind(location.pathname);
  }

  function courseIdHere() {
    return (/\/courses\/(\d+)/.exec(typeof location !== 'undefined' ? location.pathname : '') || [])[1] || null;
  }

  /* Opens tutorial `id` where it runs: here, or by going to its page. */
  function openSection(id, courseId) {
    var info = sectionInfo(id);
    if (info.page === 'options') {
      // The options page's tab of the same name, with the tutorial on top.
      try { chrome.runtime.sendMessage({ type: 'cgp.openOptions', hash: id + '-tour' }); } catch (e) { /* ignore */ }
      return 'away';
    }
    if (info.page === pageHere()) return 'here';
    courseId = courseId || courseIdHere();
    if (!courseId) return 'none';
    var where = { home: '', gradebook: '/gradebook', people: '/users' }[info.page];
    location.href = '/courses/' + courseId + (where || '') + '#cgp-tour=' + id;
    return 'away';
  }

  /* ---------------------------------------------------------- the tour */

  /* One tutorial (opts.section), or the welcome card (opts.welcome). */
  function Tour(opts) {
    opts = opts || {};
    this.state = opts.state || new CGP.TourState();
    this.courseId = opts.courseId || null;
    // On the options page the teacher types into the page, so keys are not held back.
    this.holdKeys = opts.holdKeys !== false;
    this.welcome = !!opts.welcome;
    this.section = opts.section || null;
    this.record = opts.record || {};
    this.stops = [];
    this.index = 0;
    this.active = false;
    this.minimized = false;
    this.targetEl = null;
    this._raf = 0;
    this._watch = null;
    this._unlisten = null;
    this._lastRect = null;
    this._onKey = this.onKey.bind(this);
    this._onPageClick = this.onPageClick.bind(this);
    this._onResize = this.reflow.bind(this, true);
    this._onScroll = this.schedule.bind(this);
  }

  Tour.prototype.mount = function () {
    if (this.host) return;
    var host = this.host = el('div', 'cgp-tour-host');
    host.setAttribute('data-cgp-tour', '');
    var root = this.root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    var layer = this.layer = el('div', 'layer is-off');
    this.spot = el('div', 'spot is-empty');
    this.blocks = ['t', 'r', 'b', 'l', 'h'].map(function () { return el('div', 'block'); });
    var card = this.card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'cgp-tour-title');
    card.tabIndex = -1;
    this.arrow = el('div', 'arrow');
    this.cardIn = el('div', 'card__in');
    card.appendChild(this.arrow);
    card.appendChild(this.cardIn);
    this.pill = el('div', 'pill');
    this.pill.setAttribute('role', 'status');
    layer.appendChild(this.spot);
    this.blocks.forEach(function (b) { layer.appendChild(b); });
    layer.appendChild(card);
    layer.appendChild(this.pill);
    root.appendChild(layer);
    (document.body || document.documentElement).appendChild(host);

    var self = this;
    // A click on the dimmed page: a gentle nudge toward the card, nothing more.
    this.blocks.forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); self.nudge(); });
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
    });
    card.addEventListener('click', function (e) { self.onCardClick(e); });
    this.pill.addEventListener('click', function (e) { self.onCardClick(e); });
  };

  /* The stops this page can show: the tutorial's own (a stop for a feature
   * switched off, with nothing to point at, is left out), then its last card.
   * The welcome card is one stop of its own. */
  Tour.prototype.plan = function () {
    if (this.welcome) { this.stops = [{ id: 'welcome', kind: 'welcome' }]; return; }
    var all = CGP.tourStops || [];
    var ids = (CGP.tourPaths && CGP.tourPaths[this.section]) || [];
    var list = ids.map(function (id) { return all.filter(function (s) { return s.id === id; })[0]; }).filter(Boolean);
    list = list.filter(function (s) {
      if (!s.optional || !s.target) return true;
      try { return !!s.target(); } catch (e) { return false; }
    });
    var fin = (CGP.tourFinales && CGP.tourFinales[this.section]) || {};
    list.push({ id: this.section + '-done', kind: 'finale', title: fin.title || '', body: fin.body || '' });
    this.stops = list;
  };

  function countedStops(stops) {
    return stops.filter(function (x) { return x.kind !== 'welcome' && x.kind !== 'finale'; });
  }

  Tour.prototype.start = function (opts) {
    if (this.active) return;
    opts = opts || {};
    this.mount();
    this.plan();
    this.active = true;
    // Picking up a tutorial left part-way (a reload, a trip to another course).
    var at = 0;
    if (opts.startAt) {
      for (var k = 0; k < this.stops.length; k++) if (this.stops[k].id === opts.startAt) at = k;
    }
    this.index = at;
    if (this.section && this.state.begin) this.state.begin(this.section, this.stops[at] && this.stops[at].id);
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('keyup', this._onKey, true);
    window.addEventListener('keypress', this._onKey, true);
    // On window, not document: page handlers that stop a click at document
    // capture (student-insights.js on a name) would otherwise hide it from us.
    window.addEventListener('click', this._onPageClick, true);
    window.addEventListener('resize', this._onResize);
    var self = this;
    requestAnimationFrame(function () {
      self.layer.classList.remove('is-off');
      self.show(at, 1);
    });
    CGP.tourInstance = this;
  };

  /* From the welcome card (or "Next: ..." on a last card): another tutorial.
   * One that runs on this page starts right here. */
  Tour.prototype.switchTo = function (id) {
    var self = this;
    var prev = this.shown;
    if (prev && prev.leave) { try { prev.leave(this); } catch (e) { /* ignore */ } }
    var where = openSection(id, this.courseId);
    if (where !== 'here') {
      this.active = false;
      this.detach();
      this.exit();
      if (where === 'away' && sectionInfo(id).page === 'options') this.flash('Opened in a new tab', sectionInfo(id).title + ' is in Gradebook+ settings');
      else setTimeout(function () { self.unmount(); }, 600);
      return;
    }
    this.shown = null;
    this.welcome = false;
    this.section = id;
    this.plan();
    if (this.state.begin) this.state.begin(id, this.stops[0] && this.stops[0].id);
    this.show(0, 1);
  };

  Tour.prototype.stop = function () { return this.stops[this.index]; };

  Tour.prototype.show = function (i, dir) {
    var s = this.stops[i];
    if (!s) return;
    var prev = this.shown;
    var self = this;
    var gen = this._gen = (this._gen || 0) + 1;
    // Leaving a group of stops (the student overview) closes what it opened.
    if (prev && prev !== s && prev.leave && (!s.group || s.group !== prev.group)) {
      try { prev.leave(this); } catch (e) { /* ignore */ }
    }
    this.index = i;
    this.minimized = false;
    this.pill.classList.remove('is-on');
    this.layer.classList.remove('is-off');
    if (!s.enter) { this.paint(s, dir); return; }
    // Something to open first (a student's overview): the card says so meanwhile.
    this.card.classList.add('is-busy');
    var busy = this.cardIn.querySelector('[data-act="next"], [data-act="primary"]');
    if (busy) busy.innerHTML = '<span class="spin"></span>Opening…';
    var done = false;
    var go = function () {
      if (done || gen !== self._gen || !self.active) return;
      done = true;
      self.card.classList.remove('is-busy');
      self.paint(s, dir);
    };
    var p;
    try { p = Promise.resolve(s.enter(this)); } catch (e) { p = Promise.resolve(false); }
    p.then(go, go);
    setTimeout(go, 12000);
  };

  Tour.prototype.paint = function (s, dir) {
    this.shown = s;
    // Only real stops are places to come back to.
    if (s.kind !== 'welcome' && s.kind !== 'finale') this.remember(s.id);
    if (s.kind === 'finale' && this.section && this.state.finish) {
      // Reaching the last card is finishing it, whether or not Done is pressed.
      var self = this;
      var before = this.nextUp();
      Promise.resolve(this.state.finish(this.section, 'done')).then(function (v) {
        if (v) self.record = v;
        if (self.shown !== s || !self.active || self.nextUp() === before) return;
        // Only the buttons change (a "Next:" appears or goes): swap just them.
        var tmp = document.createElement('div');
        tmp.innerHTML = self.render(s, false, 0);
        var oldFoot = self.cardIn.querySelector(':scope > .body > .foot');
        var newFoot = tmp.querySelector('.foot');
        if (!oldFoot || !newFoot) return;
        oldFoot.replaceWith(newFoot);
        if (!reducedMotion()) newFoot.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: OUT });
        var f = newFoot.querySelector('[data-act="section"]') || newFoot.querySelector('[data-act="finish"]');
        if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      });
    }
    // Resolve the element(s) to point at.
    var target = null, usedFallback = false;
    if (s.target) { try { target = s.target(); } catch (e) { target = null; } }
    if (!target && s.fallback) { try { target = s.fallback(); usedFallback = !!target; } catch (e) { target = null; } }
    if (s.kind === 'center' || s.kind === 'finale' || s.kind === 'welcome') target = null;
    var first = Array.isArray(target) ? target[0] : target;
    var r = first && first.getBoundingClientRect ? first.getBoundingClientRect() : null;
    if (r && (r.top < 8 || r.bottom > window.innerHeight - 8)) {
      // Off screen: glide the page to it first, holding the spotlight and
      // card still meanwhile, then move them over once the page has settled.
      var gen = this._gen;
      this._morph = true;
      var self = this;
      scrollIntoViewAsync(first, !reducedMotion()).then(function () {
        if (gen !== self._gen || !self.active || self.minimized) return;
        self.paintNow(s, dir, target, usedFallback);
      });
      return;
    }
    this.paintNow(s, dir, target, usedFallback);
  };

  /* Draws stop `s` and moves everything to it: from the card and spotlight
   * as they are on screen right now (even mid-way through a move), or, when
   * nothing is showing yet, with an entrance. */
  Tour.prototype.paintNow = function (s, dir, target, usedFallback) {
    var first = Array.isArray(target) ? target[0] : target;
    var before = this._visible ? this.snapshot() : null;
    this._paints = (this._paints || 0) + 1; // an exit still settling must not hide this
    this.cancelMotion();
    var oldBody = this.cardIn.firstElementChild;
    if (oldBody) oldBody.remove();
    this.targetEl = target;
    this.targetUsedFallback = usedFallback;
    if (s.onShow && target) { try { s.onShow(this, first); } catch (e) { /* ignore */ } }

    var wide = s.kind === 'center' || (!target && s.fallbackArt);
    this.card.className = 'card is-on' + (s.kind === 'welcome' ? ' card--intro' : '') +
      (wide ? ' card--center' : '') + (s.kind === 'finale' ? ' card--finale' : '');
    this.cardIn.innerHTML = this.render(s, usedFallback, dir);
    this._lastRect = null;
    this._morph = false;
    this.reflow(true);
    // Focus goes to the card itself (a dialog), not a button inside it, so
    // nothing looks pre-selected; Enter does the card's main action, and
    // Tab reaches every button.
    var focusEl = this.card;
    try { focusEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    this.loop();
    if (before) this.morph(before, oldBody, dir || 1, s);
    else this.entrance(s);
    this._visible = true;
  };

  /* ---------------------------------------------------- moving between stops */

  /* Where the card and spotlight are on screen at this instant. */
  Tour.prototype.snapshot = function () {
    var c = this.card.getBoundingClientRect();
    var sp = this.spot.getBoundingClientRect();
    var rad = parseFloat(getComputedStyle(this.spot).borderTopLeftRadius) || 0;
    return {
      card: { x: c.left, y: c.top, w: c.width, h: this.cardIn.getBoundingClientRect().height },
      spot: { x: sp.left, y: sp.top, w: sp.width, h: sp.height, r: rad }
    };
  };

  Tour.prototype.cancelMotion = function () {
    (this._anims || []).forEach(function (a) { try { a.cancel(); } catch (e) { /* ignore */ } });
    this._anims = [];
    var ghosts = this.cardIn ? this.cardIn.querySelectorAll('.ghost') : [];
    Array.prototype.forEach.call(ghosts, function (g) { g.remove(); });
    if (this._newBody) { this._newBody.style.width = ''; this._newBody = null; }
  };

  Tour.prototype.track = function (a) { if (a) this._anims.push(a); return a; };

  /* The new card content arriving: each part in turn, from the direction of travel. */
  Tour.prototype.staggerIn = function (body, dir, delay) {
    var self = this;
    var parts = Array.prototype.slice.call(body.querySelectorAll(':scope > *:not(.choices):not(.badge), :scope > .choices > *'));
    var from = dir ? 'translateX(' + (dir * 22) + 'px)' : 'translateY(10px)';
    parts.forEach(function (el, i) {
      self.track(el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
        { duration: 520, delay: delay + Math.min(i, 9) * 34, easing: OUT, fill: 'backwards' }));
    });
  };

  /* A soft ring that spreads from the spotlight's edge once it arrives; on a
   * "try it" stop it keeps coming back, slowly, as an invitation to click. */
  Tour.prototype.ripple = function (delay) {
    if (reducedMotion() || !this.targets().length) return;
    var s = this.shown || {};
    var invite = s.tryIt && !this.targetUsedFallback;
    try {
      this.track(this.spot.animate([
        { boxShadow: '0 0 0 0 rgba(3,116,181,.45)' },
        { boxShadow: '0 0 0 12px rgba(3,116,181,0)', offset: invite ? 0.35 : 1 },
        { boxShadow: '0 0 0 12px rgba(3,116,181,0)' }
      ], { duration: invite ? 3200 : 1000, delay: delay, easing: 'cubic-bezier(.2,.7,.3,1)', iterations: invite ? Infinity : 1, pseudoElement: '::after' }));
    } catch (e) { /* pseudo-element animation not supported: no ripple */ }
  };

  /* From the previous stop to this one: the card glides and resizes while
   * its old content slides out and the new content follows it in; the
   * spotlight travels with it. Nothing waits on anything else, so a click
   * mid-way simply starts the next move from where things are. */
  Tour.prototype.morph = function (before, oldBody, dir, s) {
    var card = this.card, inner = this.cardIn, spot = this.spot;
    var nextCard = this._cardGeo, nextSpot = this._spotGeo;
    var newBody = inner.firstElementChild;
    var nw = card.offsetWidth, nh = inner.offsetHeight;
    var reduced = reducedMotion();
    var cs = getComputedStyle(inner);
    var padT = parseFloat(cs.paddingTop) || 0, padL = parseFloat(cs.paddingLeft) || 0;
    var padX = padL + (parseFloat(cs.paddingRight) || 0);
    this._morph = true;

    if (oldBody) {
      oldBody.classList.add('ghost');
      oldBody.setAttribute('aria-hidden', 'true');
      oldBody.inert = true;
      var oldTitle = oldBody.querySelector('#cgp-tour-title');
      if (oldTitle) oldTitle.removeAttribute('id');
      oldBody.style.cssText = 'top:' + padT + 'px;left:' + padL + 'px;width:' + Math.max(0, before.card.w - padX) + 'px';
      inner.appendChild(oldBody);
      this.track(oldBody.animate(reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(' + (-dir * 18) + 'px)' }],
        { duration: reduced ? 140 : 200, easing: IN, fill: 'forwards' }));
    }
    if (newBody) {
      this._newBody = newBody;
      newBody.style.width = Math.max(0, nw - padX) + 'px'; // no re-wrapping while the card resizes
      if (reduced) this.track(newBody.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 60, easing: 'ease', fill: 'backwards' }));
      else this.staggerIn(newBody, dir, 120);
    }
    if (!reduced) {
      this.track(card.animate([
        { transform: tf(before.card.x, before.card.y), width: before.card.w + 'px' },
        { transform: tf(nextCard.x, nextCard.y), width: nw + 'px' }
      ], { duration: MOVE_MS, easing: SPRING }));
      this.track(inner.animate([{ height: before.card.h + 'px' }, { height: nh + 'px' }], { duration: MOVE_MS, easing: SPRING }));
      this.track(this.arrow.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: MOVE_MS, easing: 'linear' }));
      var from = before.spot, to = nextSpot;
      // Opening from nothing: an iris at the target. Closing to nothing: an
      // iris shut where the hole was.
      if (from.w < 1 && to.w >= 1) from = dot(to);
      if (to.w < 1 && from.w >= 1) to = dot(from);
      this.track(spot.animate([spotFrame(from), spotFrame(to)], { duration: MOVE_MS, easing: SPRING }));
      this.ripple(MOVE_MS * 0.55);
    } else {
      this.ripple(0);
    }
    this.settle();
  };

  /* Nothing on screen yet: the page dims while the spotlight closes in on
   * its element, then the card rises into place beside it. */
  Tour.prototype.entrance = function (s) {
    var card = this.card, spot = this.spot, body = this.cardIn.firstElementChild;
    var g = this._spotGeo, c = this._cardGeo;
    this._morph = true;
    if (reducedMotion()) {
      this.track(spot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease' }));
      this.track(card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 60, easing: 'ease', fill: 'backwards' }));
      this.ripple(0);
      this.settle();
      return;
    }
    this.track(spot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' }));
    if (g.w >= 1) this.track(spot.animate([spotFrame(grow(g, 90)), spotFrame(g)], { duration: 900, easing: SPRING }));
    var side = card.getAttribute('data-side');
    card.style.transformOrigin = { bottom: '50% 0', top: '50% 100%', right: '0 50%', left: '100% 50%' }[side] || '50% 50%';
    var lift = { bottom: [0, -14], top: [0, 14], right: [-14, 0], left: [14, 0] }[side] || [0, 16];
    this.track(card.animate([
      { opacity: 0, transform: tf(c.x + lift[0], c.y + lift[1]) + ' scale(.94)' },
      { opacity: 1, transform: tf(c.x, c.y) }
    ], { duration: 760, delay: g.w >= 1 ? 90 : 40, easing: SPRING, fill: 'backwards' }));
    if (body) this.staggerIn(body, 0, g.w >= 1 ? 150 : 100);
    this.ripple(700);
    this.settle();
  };

  /* Once every move has finished: back to following the page as it scrolls. */
  Tour.prototype.settle = function () {
    var self = this, list = this._anims.filter(function (a) { return a.effect && a.effect.getTiming().iterations !== Infinity; });
    var token = this._settleToken = (this._settleToken || 0) + 1;
    finished(list).then(function () {
      if (token !== self._settleToken || !self.active) return;
      self.cardIn.querySelectorAll('.ghost').forEach(function (g) { g.remove(); });
      if (self._newBody) { self._newBody.style.width = ''; self._newBody = null; }
      self.card.style.transformOrigin = '';
      self._morph = false;
      self.reflow(true);
    });
  };

  /* Leaving: the card sinks away, and the spotlight opens out until the page
   * is clear. `toPill` folds the card down towards the pill instead. */
  Tour.prototype.exit = function (toPill) {
    var card = this.card, spot = this.spot;
    // From where things are right now, even mid-move.
    var now = this._visible ? this.snapshot() : null;
    var g = now ? now.spot : (this._spotGeo || { x: 0, y: 0, w: 0, h: 0, r: 12 });
    var paints = this._paints;
    this.cancelMotion();
    this._settleToken = (this._settleToken || 0) + 1;
    this._morph = true;
    this._visible = false;
    var reduced = reducedMotion(), list = [];
    var c = now ? now.card : (this._cardGeo || { x: 0, y: 0 });
    var endCard = reduced ? { opacity: 0 } : toPill
      ? { opacity: 0, transform: tf(window.innerWidth / 2 - card.offsetWidth / 2, window.innerHeight - 60) + ' scale(.35)' }
      : { opacity: 0, transform: tf(c.x, c.y + 10) + ' scale(.96)' };
    list.push(this.track(card.animate([{ opacity: 1, transform: tf(c.x, c.y) }, endCard],
      { duration: reduced ? 160 : (toPill ? 380 : 240), easing: toPill ? 'cubic-bezier(.4,0,.2,1)' : IN, fill: 'forwards' })));
    var spotEnd = reduced || g.w < 1 ? { opacity: 0 } : Object.assign(spotFrame(grow(g, 18)), { opacity: 0 });
    var spotStart = reduced || g.w < 1 ? { opacity: 1 } : Object.assign(spotFrame(g), { opacity: 1 });
    list.push(this.track(spot.animate([spotStart, spotEnd], { duration: reduced ? 180 : 340, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })));
    this.blocks.forEach(function (b) { place(b, 0, 0, 0, 0); });
    var self = this;
    return finished(list).then(function () {
      if (self._paints !== paints) return; // shown again meanwhile (Next on the pill)
      self.card.classList.remove('is-on');
      self.spot.classList.remove('is-on');
    });
  };

  Tour.prototype.remember = function (stopId) {
    if (this.section && this.state && this.state.saveStop) this.state.saveStop(stopId);
  };

  /* The tutorial to suggest at the end of this one, if it can be opened from
   * here (the options page has no course to go to). */
  Tour.prototype.nextUp = function () {
    if (pageHere() === 'options') return null;
    return S().nextNew(this.record, this.section);
  };

  /* The stop's element(s), as one list. */
  Tour.prototype.targets = function () {
    var t = this.targetEl;
    return !t ? [] : (Array.isArray(t) ? t : [t]);
  };

  /* The welcome card: every tutorial, with a tick on the ones seen. */
  /* The welcome card: the tutorials as a ruled list, with the ones seen ticked. */
  Tour.prototype.renderWelcome = function () {
    var ICON = CGP.tourIcons || {};
    var v = this.record;
    var html = '<div class="brand"><span class="brand__mark">' + MARK + '</span><span class="label">Gradebook+</span>' +
      '<button class="x" type="button" data-act="finish" aria-label="Close">' + X_ICON + '</button></div>' +
      '<h2 id="cgp-tour-title">Learn Gradebook+ one part at a time</h2>' +
      '<p>Pick a topic to see a short walkthrough on your own pages. Each one takes about a minute.</p>' +
      '<ul class="choices">';
    S().SECTIONS.forEach(function (sec) {
      var seen = S().statusOf(v, sec.id) === 'done';
      html += '<li><button class="choice" type="button" data-act="section" data-id="' + sec.id + '">' +
        '<span class="ico" aria-hidden="true">' + (ICON[SECTION_ICON[sec.id]] || '') + '</span>' +
        '<span class="choice__t"><b>' + sec.title + '</b><small>' + sec.blurb + '</small></span>' +
        (seen ? '<span class="choice__meta is-done">' + DONE_ICON + 'Seen</span>' : '') + '</button></li>';
    });
    html += '</ul><p class="hint">Not now? Close this. You can come back to these anytime from Gradebook+ settings, under <b>Tutorials</b>.</p>';
    return html;
  };

  /* Progress as a row of gradebook cells: ticked for the stops done, outlined for this one. */
  function cellsHtml(pos, total) {
    var h = '<span class="cells" aria-hidden="true">';
    for (var k = 1; k <= total; k++) h += '<i class="' + (k < pos ? 'is-done' : k === pos ? 'is-now' : '') + '"></i>';
    return h + '</span>';
  }

  Tour.prototype.render = function (s, usedFallback, dir) {
    var i = this.index;
    var counted = countedStops(this.stops);
    var pos = counted.indexOf(s) + 1;
    var html = '<div class="body">';
    var live = this.targets().length > 0;
    var name = sectionInfo(this.section).title;

    if (s.kind === 'welcome') return html + this.renderWelcome() + '</div>';

    if (s.kind === 'finale') {
      var nxt = this.nextUp();
      html += '<div class="done"><span class="done__mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2 8.8-9.4"/></svg></span>' +
        '<h2 id="cgp-tour-title">' + (s.title || 'You’ve finished ' + name) + '</h2></div>' + (s.body ? '<p>' + s.body + '</p>' : '');
      html += '<div class="foot">' + (i > 0 ? '<button class="btn btn--ghost" type="button" data-act="back">Back</button>' : '');
      if (nxt) {
        html += '<button class="btn btn--soft" type="button" data-act="finish">Close</button>' +
          '<button class="btn btn--primary" type="button" data-act="section" data-id="' + nxt + '">Next: ' + sectionInfo(nxt).title + '</button>';
      } else {
        html += '<button class="btn btn--primary" type="button" data-act="finish">Done</button>';
      }
      return html + '</div></div>';
    }

    html += '<div class="head"><span class="label">' + name + '</span>' + cellsHtml(pos, counted.length) +
      '<button class="x" type="button" data-act="skip" aria-label="Skip this tutorial" title="Skip this tutorial (Esc)">' + X_ICON + '</button></div>';
    // With the real thing spotlighted, the page speaks for itself. The
    // illustration is only for when the stop's own element is not on screen
    // (or a fallback stands in for it), or the card points at nothing.
    if (s.art && (!live || usedFallback)) html += '<div class="art">' + s.art() + '</div>';
    html += '<h2 id="cgp-tour-title">' + s.title + '</h2>';
    if (s.body) html += '<p>' + s.body + '</p>';
    if (s.bullets) html += '<ul>' + s.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>';
    if (s.steps) {
      html += '<ol class="steps">' + s.steps.map(function (st) {
        return '<li><span class="steps__n" aria-hidden="true">' + st.n + '</span><span><span class="steps__t">' + st.t + '</span>' + st.d + '</span></li>';
      }).join('') + '</ol>';
    }
    if ((usedFallback || (s.fallbackArt && !live)) && s.fallbackNote) html += '<div class="note">' + s.fallbackNote + '</div>';
    else if (s.try && live) html += '<div class="try"><span class="try__k">Try it</span><span>' + s.try + '</span></div>';

    var last = pos === counted.length;
    html += '<div class="foot"><span class="step">Step ' + pos + ' of ' + counted.length + '</span>';
    if (i > 0) html += '<button class="btn btn--ghost" type="button" data-act="back">Back</button>';
    html += s.primary
      ? '<button class="btn btn--primary" type="button" data-act="primary">' + s.primary.label + '</button></div>'
      : '<button class="btn btn--primary" type="button" data-act="next">' + (last ? 'Finish' : 'Next') + '</button></div>';
    return html + '</div>';
  };

  /* ------------------------------------------------------------ geometry */

  Tour.prototype.targetRect = function () {
    var list = this.targets();
    if (!list.length) return null;
    if (!list.every(function (n) { return n.isConnected; })) {
      // Canvas re-rendered it (a virtualized row); find the stop's element again.
      var s = this.shown || this.stop();
      var again = null;
      try { again = (s.target && s.target()) || (s.fallback && s.fallback()); } catch (e) { again = null; }
      if (!again) return null;
      this.targetEl = again;
      list = this.targets();
      var w = this._watch;
      if (w && w.ro) list.forEach(function (n) { try { w.ro.observe(n); } catch (e) { /* ignore */ } });
    }
    var r = list.reduce(function (u, n) {
      var b = n.getBoundingClientRect();
      if (!u) return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      return { left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) };
    }, null);
    var st = this.shown || this.stop();
    var pad = st.padding === undefined ? 6 : st.padding;
    var vw = window.innerWidth, vh = window.innerHeight;
    var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    var x2 = Math.min(vw - 4, r.right + pad), y2 = Math.min(vh - 4, r.bottom + pad);
    if (x2 - x < 4 || y2 - y < 4) return null;
    return { x: x, y: y, w: x2 - x, h: y2 - y };
  };

  /* Keeps the spotlight on its element. No per-frame polling: a reflow is
   * scheduled (at most once a frame) when the page scrolls - any scroller,
   * the grid included - when the element changes size, and on a slow
   * heartbeat for anything else that moves it (Canvas re-rendering a row, a
   * panel finishing its animation). */
  Tour.prototype.loop = function () {
    this.unwatch();
    var self = this;
    var w = this._watch = { ro: null, beat: 0 };
    window.addEventListener('scroll', this._onScroll, { capture: true, passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      w.ro = new ResizeObserver(function () { self.schedule(); });
      this.targets().forEach(function (n) { try { w.ro.observe(n); } catch (e) { /* ignore */ } });
    }
    w.beat = setInterval(function () { self.schedule(); }, 400);
  };

  Tour.prototype.unwatch = function () {
    var w = this._watch;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    window.removeEventListener('scroll', this._onScroll, { capture: true });
    if (!w) return;
    if (w.ro) w.ro.disconnect();
    clearInterval(w.beat);
    this._watch = null;
  };

  Tour.prototype.schedule = function () {
    if (this._raf || !this.active || this.minimized) return;
    var self = this;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self.reflow(false); });
  };

  Tour.prototype.reflow = function (force) {
    if (!this.active || this.minimized) return;
    // While a move is running the animation owns the spotlight and card;
    // settle() catches up with the page once it has finished.
    if (this._morph && !force) return;
    var rect = this.targetRect();
    var last = this._lastRect;
    var same = last && rect && Math.abs(last.x - rect.x) < 1 && Math.abs(last.y - rect.y) < 1 &&
      Math.abs(last.w - rect.w) < 1 && Math.abs(last.h - rect.h) < 1;
    if (!force && (same || (!rect && last === 'none'))) return;
    this._lastRect = rect || 'none';
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = this.shown || this.stop();

    // The spotlight (or, with nothing to point at, a dim page and no hole).
    var spot = this.spot;
    spot.classList.add('is-on');
    var prevSpot = this._spotGeo;
    var g = rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: Math.min(12, rect.h / 2) }
      // No hole: closed to a point where the last one was (or mid-screen).
      : (prevSpot && prevSpot.w >= 1 ? dot(prevSpot) : (prevSpot || { x: vw / 2, y: vh / 2, w: 0, h: 0, r: 12 }));
    this._spotGeo = g;
    spot.classList.toggle('is-empty', !rect);
    var f = spotFrame(g);
    spot.style.transform = f.transform;
    spot.style.width = f.width;
    spot.style.height = f.height;
    spot.style.borderRadius = f.borderRadius;

    // Click shields around the hole - and over it, unless this stop invites a click.
    var h = rect || { x: vw / 2, y: vh / 2, w: 0, h: 0 };
    var b = this.blocks;
    place(b[0], 0, 0, vw, h.y);
    place(b[1], h.x + h.w, h.y, vw - h.x - h.w, h.h);
    place(b[2], 0, h.y + h.h, vw, vh - h.y - h.h);
    place(b[3], 0, h.y, h.x, h.h);
    if (s.tryIt && rect && !this.targetUsedFallback) place(b[4], 0, 0, 0, 0);
    else place(b[4], h.x, h.y, h.w, h.h);

    this.positionCard(rect);
  };

  function place(n, x, y, w, h) {
    n.style.left = x + 'px'; n.style.top = y + 'px';
    n.style.width = Math.max(0, w) + 'px'; n.style.height = Math.max(0, h) + 'px';
  }

  Tour.prototype.positionCard = function (rect) {
    var card = this.card;
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = card.offsetWidth || 380, ch = card.offsetHeight || 300;
    var m = 12;
    var x, y, side = '';
    if (!rect) {
      x = (vw - cw) / 2; y = Math.max(m, (vh - ch) / 2);
    } else {
      var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      var room = {
        bottom: vh - (rect.y + rect.h) - GAP,
        top: rect.y - GAP,
        right: vw - (rect.x + rect.w) - GAP,
        left: rect.x - GAP
      };
      var order = ['bottom', 'right', 'top', 'left'];
      for (var k = 0; k < order.length; k++) {
        var o = order[k];
        var fits = (o === 'bottom' || o === 'top') ? room[o] >= ch + m : room[o] >= cw + m;
        if (fits) { side = o; break; }
      }
      if (side === 'bottom') { y = rect.y + rect.h + GAP; x = cx - cw / 2; }
      else if (side === 'top') { y = rect.y - GAP - ch; x = cx - cw / 2; }
      else if (side === 'right') { x = rect.x + rect.w + GAP; y = cy - ch / 2; }
      else if (side === 'left') { x = rect.x - GAP - cw; y = cy - ch / 2; }
      else {
        // A target as big as the screen (the whole grid): sit inside it, low and to the right.
        x = Math.min(vw - cw - 28, rect.x + rect.w - cw - 28);
        y = Math.min(vh - ch - 28, rect.y + rect.h - ch - 28);
      }
      x = Math.max(m, Math.min(vw - cw - m, x));
      y = Math.max(m, Math.min(vh - ch - m, y));
      if (side === 'bottom' || side === 'top') this.arrow.style.cssText = 'left:' + Math.max(18, Math.min(cw - 34, cx - x - 8)) + 'px';
      else if (side) this.arrow.style.cssText = 'top:' + Math.max(18, Math.min(ch - 34, cy - y - 8)) + 'px';
    }
    card.setAttribute('data-side', side);
    this._cardGeo = { x: Math.round(x), y: Math.round(y) };
    card.style.transform = tf(x, y);
  };

  /* ---------------------------------------------------------- interaction */
  /* ---------------------------------------------------------- interaction */

  Tour.prototype.onCardClick = function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'next') this.next();
    else if (act === 'back') this.back();
    else if (act === 'skip') this.end('skipped');
    else if (act === 'finish') this.end('done');
    else if (act === 'resume') this.next();
    else if (act === 'section') {
      var id = b.getAttribute('data-id');
      if (!S().section(id)) return;
      var self = this;
      this.chosen = true;   // under way: never dismissed as untouched
      // Recorded before switchTo, which may leave the page.
      Promise.resolve(this.welcome && this.state.welcomeSeen ? this.state.welcomeSeen() : null)
        .then(function () { self.switchTo(id); });
    }
    else if (act === 'primary') {
      var s = this.stop();
      if (s && s.primary && s.primary.run && !this.card.classList.contains('is-busy')) s.primary.run(this);
    }
  };

  Tour.prototype.next = function () {
    if (this.card && this.card.classList.contains('is-busy')) return;
    if (this.index >= this.stops.length - 1) { this.end('done'); return; }
    this.show(this.index + 1, 1);
  };

  Tour.prototype.back = function () {
    if (this.index > 0) this.show(this.index - 1, -1);
  };

  Tour.prototype.nudge = function () {
    var c = this.card;
    if (reducedMotion() || !c.animate) return;
    var t = c.style.transform;
    c.animate([{ transform: t }, { transform: t + ' scale(1.025)' }, { transform: t }], { duration: 260, easing: 'ease-out' });
  };

  // While a card is up, keys belong to the tour: arrows move, Escape closes,
  // and nothing reaches Canvas's grid (or keyboard.js) behind it.
  Tour.prototype.onKey = function (e) {
    if (!this.active || this.minimized) return;
    var inside = e.composedPath && e.composedPath().indexOf(this.host) >= 0;
    var typing = !inside && e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (e.type === 'keydown' && !typing) {
      var s = this.stop();
      // The welcome card is a choice, not a step: arrows never pick for the teacher.
      var picking = s && s.kind === 'welcome';
      if (e.key === 'ArrowRight') { if (!picking) this.next(); swallow(e); return; }
      if (e.key === 'ArrowLeft') { if (!picking) this.back(); swallow(e); return; }
      if (e.key === 'Escape') { this.end(s && (s.kind === 'finale' || s.kind === 'welcome') ? 'done' : 'skipped'); swallow(e); return; }
    }
    if (!this.holdKeys && !inside) return;
    var origin = e.composedPath ? e.composedPath()[0] : e.target;
    if (e.type === 'keydown' && e.key === 'Enter' && origin === this.card) {
      var main = this.cardIn.querySelector('[data-act="primary"], [data-act="next"]') ||
        this.cardIn.querySelector('.foot [data-act="section"]') || this.cardIn.querySelector('.foot [data-act="finish"]');
      if (main) main.click();
      swallow(e);
      return;
    }
    if (inside && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab')) {
      e.stopPropagation(); // the button handles it; Canvas never sees it
      return;
    }
    swallow(e);
  };

  function swallow(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }

  // A "try it" click went through to the page: step aside while the teacher
  // looks, and wait for them to ask for the next stop.
  Tour.prototype.onPageClick = function (e) {
    if (!this.active || this.minimized) return;
    if (this.synthetic) return;
    var s = this.shown;
    if (!s || !s.tryIt || !this.targetEl || this.targetUsedFallback) return;
    if (!this.targets().some(function (n) { return n.contains(e.target); })) return;
    var self = this;
    setTimeout(function () { self.minimize(); }, 30);
  };

  Tour.prototype.minimize = function () {
    this.minimized = true;
    this.unwatch();
    // The teacher is trying it out - which may take them to another page (a
    // course from the switcher): the tutorial carries on from the next stop.
    var after = this.stops[this.index + 1];
    if (after && after.kind !== 'finale') this.remember(after.id);
    var self = this;
    this.exit(true).then(function () { if (self.minimized) self.layer.classList.add('is-off'); });
    var counted = countedStops(this.stops);
    var pos = counted.indexOf(this.stop()) + 1;
    this.pill.className = 'pill';
    this.pill.innerHTML = '<span class="pill__txt"><b>Try it, then continue</b><small>Step ' + pos + ' of ' + counted.length + '</small></span>' +
      '<button class="btn btn--ghost" type="button" data-act="skip">Skip tutorial</button>' +
      '<button class="btn btn--primary" type="button" data-act="resume">Next</button>';
    setTimeout(function () { if (self.minimized) self.pill.classList.add('is-on'); }, reducedMotion() ? 0 : 160);
  };

  Tour.prototype.detach = function () {
    this.unwatch();
    if (this._unlisten) { this._unlisten(); this._unlisten = null; }
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('keyup', this._onKey, true);
    window.removeEventListener('keypress', this._onKey, true);
    window.removeEventListener('click', this._onPageClick, true);
    window.removeEventListener('resize', this._onResize);
  };

  /* A one-line note at the bottom of the page, then gone. */
  Tour.prototype.flash = function (head, small) {
    var self = this;
    this.pill.className = 'pill pill--note';
    this.pill.innerHTML = '<span class="pill__txt"><b>' + head + '</b>' + (small ? '<small>' + small + '</small>' : '') + '</span>';
    setTimeout(function () { self.pill.classList.add('is-on'); }, reducedMotion() ? 0 : 180);
    setTimeout(function () { self.pill.classList.remove('is-on'); }, 4200);
    setTimeout(function () { self.unmount(); }, 4800);
  };

  /* how: 'done' (finished, or the welcome card closed) or 'skipped' (this
   * tutorial only: the others are still offered). */
  Tour.prototype.end = function (how) {
    if (!this.active) return;
    var shown = this.shown;
    this.active = false;
    this.endedHere = true;
    this.detach();
    if (shown && shown.leave) { try { shown.leave(this); } catch (e) { /* ignore */ } }
    if (this.welcome) { if (this.state.welcomeSeen) this.state.welcomeSeen(); }
    else if (this.section && this.state.finish) this.state.finish(this.section, how === 'done' ? 'done' : 'skipped');
    // Over: another tutorial may start now, while this one's closing note shows.
    if (CGP.tourInstance === this) CGP.tourInstance = null;
    var self = this;
    this.exit();
    if (this.welcome) this.flash('Tutorials are in Gradebook+ settings', 'Click the Gradebook+ icon in Chrome’s toolbar');
    else if (how === 'skipped') this.flash('Skipped “' + sectionInfo(this.section).title + '”', 'Your other tutorials are still available');
    else {
      this.pill.classList.remove('is-on');
      setTimeout(function () { self.unmount(); }, 900);
    }
  };

  /* Closed elsewhere (another tab finished it): leave without a word. */
  Tour.prototype.dismissQuietly = function () {
    if (!this.active) return;
    this.active = false;
    this.detach();
    this.unmount();
  };

  Tour.prototype.unmount = function () {
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    if (CGP.tourInstance === this) CGP.tourInstance = null;
  };

  /* ---------------------------------------------------------- the offer */

  /* The small card in the corner offering one tutorial (or, before the
   * welcome card has been seen, the welcome card on the gradebook). Its X
   * hides it for this tab's visit; Skip hides that tutorial only. */
  function offerCopy(d) {
    if (d.section === 'welcome') {
      return { label: 'Gradebook+', title: 'New to Gradebook+?', body: 'Take a one-minute walkthrough on your own gradebook.' };
    }
    var info = sectionInfo(d.section);
    if (d.resume) return { label: 'Tutorial in progress', title: 'Finish “' + info.title + '”?', body: 'Pick up where you left off.' };
    return { label: info.mins + '-minute tutorial', title: info.title, body: info.blurb + '.' };
  }

  function showOffer(state, courseId, d) {
    var copy = offerCopy(d);
    var host = el('div', 'cgp-tour-host');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    var layer = el('div', 'layer');
    var card = el('div', 'invite');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'cgp-invite-title');
    card.innerHTML = '<div class="card__in">' +
      '<div class="brand"><span class="brand__mark">' + MARK + '</span><span class="label">' + copy.label + '</span>' +
      '<button class="x" type="button" data-act="later" aria-label="Not now" title="Not now">' + X_ICON + '</button></div>' +
      '<h2 id="cgp-invite-title">' + copy.title + '</h2>' +
      '<p>' + copy.body + '</p>' +
      '<div class="foot"><button class="btn btn--ghost" type="button" data-act="skip">' + (d.section === 'welcome' ? 'No thanks' : 'Skip this one') + '</button>' +
      '<button class="btn btn--primary" type="button" data-act="go">Show me</button></div></div>';
    layer.appendChild(card);
    root.appendChild(layer);
    (document.body || document.documentElement).appendChild(host);
    requestAnimationFrame(function () { requestAnimationFrame(function () { card.classList.add('is-on'); }); });
    // Skipped or finished in another tab: this offer goes too.
    var unlisten = listenForChange(function (v) {
      var now = S().decide(v, S().pageKind(location.pathname), null, S().snoozed());
      if (!now || now.section !== d.section) close();
    });
    function close() {
      if (unlisten) { unlisten(); unlisten = null; }
      card.classList.remove('is-on');
      setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 600);
    }
    card.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'go') {
        close();
        if (d.section === 'welcome') { location.href = '/courses/' + courseId + '/gradebook#cgp-tour'; return; }
        if (openSection(d.section, courseId) === 'here') {
          state.load().then(function (v) {
            var t = new Tour({ state: state, section: d.section, courseId: courseId, record: v });
            t.start({ startAt: v.active && v.active.section === d.section ? v.active.stop : null });
          });
        }
      } else if (act === 'skip') {
        if (d.section === 'welcome') {
          // "No thanks" to the welcome card: it is not shown again, and each
          // tutorial is still offered on its own page later.
          state.welcomeSeen();
          S().snooze('welcome');
        } else {
          state.finish(d.section, 'skipped');
        }
        close();
      } else {
        S().snooze(d.section);
        close();
      }
    });
    return { close: close };
  }

  /* ---------------------------------------------------------------- boot */

  function waitFor(test, ms, every) { return CGP.tourWaitFor(test, ms, every || 250); }

  function whenVisible() {
    if (!document.hidden) return Promise.resolve();
    return new Promise(function (resolve) {
      var on = function () {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', on);
        resolve();
      };
      document.addEventListener('visibilitychange', on);
    });
  }

  /* What a page needs before a tutorial can point at it. */
  function pageReady(page) {
    if (page === 'gradebook') {
      // Canvas's grid, our first paint of it, and the bubbles and badges for the screenful.
      return waitFor(function () {
        return document.querySelector('.grid-canvas .slick-row') && document.documentElement.classList.contains('cgp-gradebook');
      }, 45000).then(function (ok) {
        return ok && waitFor(function () { return !!document.querySelector('.cgp-sub, .cgp-cmt'); }, 6000).then(function () { return true; });
      });
    }
    // The People page: Make groups, drawn once Canvas has drawn "+ Group Set".
    if (page === 'people') return waitFor(function () { return !!document.querySelector('.cgp-groups-btn'); }, 8000).then(function () { return true; });
    // The course home: its Copy to other classes button, if it is on.
    return waitFor(function () { return !!document.querySelector('.cgp-copyto'); }, 5000).then(function () { return true; });
  }

  function boot() {
    if (window.self !== window.top) return;
    if (!CGP.TourState) return;
    var path = location.pathname;
    var m = /\/courses\/(\d+)/.exec(path);
    if (!m) return;
    var courseId = m[1];
    if (/\/gradebook\/speed_grader/i.test(path)) return;
    var page = S().pageKind(path);
    var state = new CGP.TourState();
    var forced = S().sectionFromHash(location.hash);
    if (forced) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }

    state.load().then(function (v) {
      var d = S().decide(v, page, forced, forced ? [] : S().snoozed());
      if (!d) return;
      if (d.kind === 'offer') {
        // A little later than the page itself, so it never competes with it.
        setTimeout(function () {
          whenVisible().then(function () { return state.load(); }).then(function (now) {
            var again = S().decide(now, page, null, S().snoozed());
            if (again && again.kind === 'offer' && again.section === d.section && !CGP.tourInstance) showOffer(state, courseId, d);
          });
        }, 2500);
        return;
      }
      pageReady(page).then(function (ok) {
        if (!ok) return;
        return new Promise(function (r) { setTimeout(r, 900); })
          .then(whenVisible)
          .then(function () { return state.load(); })
          .then(function (now) {
            if (CGP.tourInstance) return;
            var tour = new Tour({ state: state, welcome: d.kind === 'welcome', section: d.section, courseId: courseId, record: now });
            tour.start({ startAt: d.stop });
            // Closed in another tab: an untouched welcome card here goes too.
            tour._unlisten = listenForChange(function (nv) {
              if (tour.welcome && !tour.chosen && !tour.endedHere && S().normalize(nv).welcome !== 'due') tour.dismissQuietly();
            });
          });
      });
    });
  }

  // The record changed (in this tab or another). Returns the function that
  // stops listening.
  function listenForChange(fn) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return null;
    var on = function (changes, area) {
      if (area !== 'local' || !changes[CGP.TourState.KEY]) return;
      fn(changes[CGP.TourState.KEY].newValue || {});
    };
    chrome.storage.onChanged.addListener(on);
    return function () { try { chrome.storage.onChanged.removeListener(on); } catch (e) { /* ignore */ } };
  }

  CGP.Tour = Tour;

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && !/\/src\/options\//.test(location.pathname)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})();
