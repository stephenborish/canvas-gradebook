/* Canvas Gradebook+ - the welcome tour.
 *
 * Shown once per install (tour-state.js), on the teacher's own gradebook: a
 * spotlight moves from one real element to the next - a comment bubble, a
 * submission badge, a student's name, the Total - with a card beside it
 * saying what Gradebook+ does there. Stops marked "try it" let the click
 * through to the page; the tour then folds into a small pill until the
 * teacher asks for the next stop.
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

  /* --------------------------------------------------------------- styles */

  var CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.layer{position:fixed;inset:0;z-index:' + Z + ';pointer-events:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#18222b;-webkit-font-smoothing:antialiased;--brand:#0374b5;--brand2:#5b3fd0;--ink:#18222b;--soft:#4a5864;--muted:#7a8792;--line:#e5e9ee;--ease:cubic-bezier(.22,1,.36,1)}',
    '.layer.is-off .spot,.layer.is-off .card,.layer.is-off .block{opacity:0;pointer-events:none!important}',

    /* the spotlight */
    '.spot{position:fixed;left:0;top:0;width:0;height:0;border-radius:12px;box-shadow:0 0 0 9999px rgba(9,16,29,.64);transition:transform .55s var(--ease),width .55s var(--ease),height .55s var(--ease),border-radius .55s var(--ease),opacity .4s ease;opacity:0}',
    '.spot.is-on{opacity:1}',
    '.spot::before{content:"";position:absolute;inset:-2px;border-radius:inherit;padding:2px;background:linear-gradient(135deg,#5ec2ff,#7a5cff 55%,#ff7ab6);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.95}',
    '.spot::after{content:"";position:absolute;inset:-2px;border-radius:inherit;box-shadow:0 0 0 0 rgba(122,92,255,.55);animation:pulse 2.2s ease-out infinite}',
    '.spot.is-empty::before,.spot.is-empty::after{display:none}',
    '@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(122,92,255,.5)}70%{box-shadow:0 0 0 14px rgba(122,92,255,0)}100%{box-shadow:0 0 0 0 rgba(122,92,255,0)}}',
    '.block{position:fixed;pointer-events:auto;background:transparent}',

    /* the card */
    '.card{position:fixed;left:0;top:0;width:380px;max-width:calc(100vw - 24px);pointer-events:auto;background:rgba(255,255,255,.98);border-radius:18px;box-shadow:0 24px 64px -12px rgba(9,16,29,.45),0 4px 14px rgba(9,16,29,.12),inset 0 0 0 1px rgba(255,255,255,.6);transition:transform .55s var(--ease),opacity .35s ease;opacity:0;outline:none;overflow:visible}',
    '.card.is-on{opacity:1}',
    '.card--hero{width:520px}',
    '.card--center{width:540px}',
    '.card--finale{width:440px;text-align:center}',
    '.card__in{position:relative;border-radius:18px;overflow:hidden;padding:22px 24px 18px}',
    '.card__in::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#0374b5,#5b3fd0 55%,#e2589c)}',
    '.arrow{position:absolute;width:16px;height:16px;background:#fff;transform:rotate(45deg);border-radius:3px;box-shadow:-2px -2px 6px rgba(9,16,29,.06);display:none}',
    '.card[data-side="bottom"] .arrow{display:block;top:-7px}',
    '.card[data-side="top"] .arrow{display:block;bottom:-7px;box-shadow:2px 2px 6px rgba(9,16,29,.1)}',
    '.card[data-side="right"] .arrow{display:block;left:-7px}',
    '.card[data-side="left"] .arrow{display:block;right:-7px;box-shadow:2px -2px 6px rgba(9,16,29,.08)}',
    '.body{animation:enter .45s var(--ease) both}',
    '.body.is-back{animation-name:enterBack}',
    '@keyframes enter{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}',
    '@keyframes enterBack{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}',

    '.head{display:flex;align-items:center;gap:10px;margin:2px 0 12px}',
    '.ico{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#e7f3fb,#efeafe);color:var(--brand)}',
    '.ico svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '.eyebrow{flex:1 1 auto;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:linear-gradient(90deg,#0374b5,#5b3fd0);-webkit-background-clip:text;background-clip:text;color:transparent}',
    '.count{font-size:12px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.x{all:unset;cursor:pointer;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--muted);margin-right:-6px}',
    '.x:hover{background:#f1f4f7;color:var(--ink)}',
    '.x:focus-visible{box-shadow:0 0 0 3px rgba(3,116,181,.3)}',
    '.x svg{width:14px;height:14px;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
    'h2{margin:0 0 8px;font-size:19px;line-height:1.28;font-weight:700;letter-spacing:-.01em;color:var(--ink)}',
    '.card--hero h2{font-size:26px;letter-spacing:-.02em;margin-bottom:10px}',
    '.card--finale h2{font-size:28px}',
    'p{margin:0;font-size:14px;line-height:1.58;color:var(--soft)}',
    'p strong,p b{color:var(--ink)}',
    '.c-blue{color:#0a72a8!important}.c-purple{color:#6b3fa0!important}.c-green{color:#0b7a45!important}.c-gray{color:#6b7780!important}.c-amber{color:#a35f0c!important}',
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f1f4f7;border-radius:5px;padding:1px 5px;color:var(--ink)}',
    '.note{margin-top:10px;font-size:12.5px;line-height:1.5;color:#6a5a1f;background:#fff8e6;border:1px solid #f6e3ad;border-radius:10px;padding:8px 11px}',
    'ul{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}',
    'li{position:relative;padding-left:18px;font-size:13.5px;line-height:1.55;color:var(--soft)}',
    'li::before{content:"";position:absolute;left:3px;top:.62em;width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,#0374b5,#5b3fd0)}',
    '.kc{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;margin:0 1px;border-radius:6px;font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#28343e;background:linear-gradient(#fff,#f1f4f7);border:1px solid #d5dbe1;box-shadow:0 1.5px 0 #c4ccd4;vertical-align:1px}',
    '.kc--red{color:#fff;background:linear-gradient(#e5484d,#c9363b);border-color:#b52f33;box-shadow:0 1.5px 0 #94262a}',
    '.kc--amber{color:#4a3200;background:linear-gradient(#ffd25e,#f2b829);border-color:#d9a01c;box-shadow:0 1.5px 0 #b78512}',
    '.kc--green{color:#fff;background:linear-gradient(#2f9e6a,#1f8656);border-color:#197148;box-shadow:0 1.5px 0 #145c3a}',
    '.try{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,rgba(3,116,181,.07),rgba(91,63,208,.08));border:1px solid rgba(91,63,208,.16);font-size:13px;line-height:1.5;color:#2f2a63}',
    '.try__dot{flex:0 0 auto;margin-top:3px;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#0374b5,#5b3fd0);display:grid;place-items:center;box-shadow:0 0 0 4px rgba(91,63,208,.14);animation:tap 1.8s ease-in-out infinite}',
    '.try__dot::after{content:"";width:6px;height:6px;border-radius:50%;background:#fff}',
    '@keyframes tap{0%,100%{transform:scale(1)}50%{transform:scale(.82)}}',
    '.try b{color:#2f2a63}',

    /* footer */
    '.foot{display:flex;align-items:center;gap:12px;margin-top:18px}',
    '.dots{flex:1 1 auto;display:flex;gap:5px;align-items:center;flex-wrap:wrap}',
    '.dot{width:6px;height:6px;border-radius:6px;background:#d8dee4;transition:width .35s var(--ease),background .35s}',
    '.dot.is-done{background:#9fc6e2}',
    '.dot.is-now{width:20px;background:linear-gradient(90deg,#0374b5,#5b3fd0)}',
    '.btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:11px;font-size:14px;font-weight:650;letter-spacing:.005em;transition:transform .15s ease,box-shadow .2s ease,background .2s ease;white-space:nowrap}',
    '.btn:focus-visible{box-shadow:0 0 0 3px rgba(3,116,181,.35)}',
    '.btn--ghost{color:var(--soft)}',
    '.btn--ghost:hover{background:#f1f4f7;color:var(--ink)}',
    '.btn--primary{color:#fff;background:linear-gradient(135deg,#0374b5,#4f46d8);box-shadow:0 6px 16px -6px rgba(63,70,216,.6),inset 0 1px 0 rgba(255,255,255,.18)}',
    '.btn--primary:hover{transform:translateY(-1px);box-shadow:0 10px 22px -8px rgba(63,70,216,.7),inset 0 1px 0 rgba(255,255,255,.18)}',
    '.btn--primary:active{transform:translateY(0)}',
    '.btn--primary:focus-visible{box-shadow:0 0 0 3px rgba(79,70,216,.35),0 6px 16px -6px rgba(63,70,216,.6)}',
    '.btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.btn--lg{height:44px;padding:0 22px;font-size:15px;border-radius:13px}',
    '.btn--soft{color:#3a3f9e;background:#eef0ff}',
    '.btn--soft:hover{background:#e3e6ff}',

    /* hero */
    '.hero-art{position:relative;margin:-22px -24px 18px;padding:26px 24px 22px;background:radial-gradient(120% 140% at 0% 0%,#e3f2fc 0%,rgba(227,242,252,0) 55%),radial-gradient(120% 140% at 100% 0%,#efe8ff 0%,rgba(239,232,255,0) 60%),linear-gradient(#f8fbfd,#fff);border-bottom:1px solid var(--line);overflow:hidden}',
    '.hero-art::after{content:"";position:absolute;width:320px;height:320px;right:-120px;top:-180px;background:radial-gradient(closest-side,rgba(122,92,255,.18),rgba(122,92,255,0));animation:drift 9s ease-in-out infinite alternate}',
    '@keyframes drift{to{transform:translate(-60px,40px)}}',
    '.brand{position:relative;z-index:1;display:flex;align-items:center;gap:10px;margin-bottom:16px}',
    '.brand__mark{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#0374b5,#5b3fd0);display:grid;place-items:center;box-shadow:0 8px 18px -8px rgba(63,70,216,.7)}',
    '.brand__mark svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.brand__name{font-size:14px;font-weight:700;color:var(--ink)}.brand__name span{color:#5b3fd0}',
    '.hero-grid{position:relative;z-index:1;background:#fff;border:1px solid #e1e6eb;border-radius:12px;box-shadow:0 10px 30px -18px rgba(9,16,29,.35);overflow:hidden;font-size:12px}',
    '.hg-row{display:grid;grid-template-columns:1.25fr repeat(4,1fr);border-top:1px solid #eef1f4}',
    '.hg-head{border-top:0;background:linear-gradient(#fdfefe,#eef2f5);font-weight:650;color:#4a5864;font-size:11px}',
    '.hg-row>span{padding:9px 8px;text-align:center;border-left:1px solid #eef1f4;position:relative}',
    '.hg-row>span:first-child{border-left:0}',
    '.hg-name{text-align:left!important;color:#2d3b45;font-weight:600}',
    '.hg-cell{font-variant-numeric:tabular-nums;color:#2d3b45;font-weight:500}',
    '.hg-cell>.mk-cmt,.hg-cell>.mk-m,.hg-cell>.mk-l,.hg-cell>.mk-sub,.hg-cell>.mk-cnt{animation:pop .5s var(--ease) both;animation-delay:calc(.35s + var(--i) * 90ms)}',
    '@keyframes pop{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}',
    '.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}',
    '.meta span{font-size:12px;font-weight:600;color:#4a5864;background:#f1f4f7;border-radius:999px;padding:5px 10px}',

    /* cell marks, drawn like the real ones */
    '.mk-cmt{position:absolute;right:3px;bottom:2px;width:13px;height:13px;color:#0a72a8}',
    '.mk-cmt svg{width:100%;height:100%;fill:currentColor}',
    '.mk-cmt--reply{color:#6b3fa0}.mk-cmt--reply svg{fill:none;stroke:currentColor;stroke-width:1.6}',
    '.mk-cnt{position:absolute;right:16px;bottom:2px;font-size:9px;font-weight:700;color:#0a72a8;line-height:13px}',
    '.mk-sub{position:absolute;right:3px;top:3px;width:9px;height:9px;border-radius:50%}',
    '.mk-sub--in{background:#0b7a45}',
    '.mk-sub--out{border:1.5px solid #98a3ab}',
    '.mk-m,.mk-l{position:absolute;left:3px;top:3px;width:13px;height:13px;border-radius:50%;font-size:8.5px;font-weight:800;line-height:13px;text-align:center;color:#fff;background:#d23b3f}',
    '.mk-l{background:#f0b429;color:#3d2a00}',
    '.mk-resub{position:absolute;left:0;bottom:0;width:0;height:0;border-style:solid;border-width:9px 0 0 9px;border-color:transparent transparent transparent #6b3fa0}',
    '.mk-flag{display:inline-grid;place-items:center;width:15px;height:15px;margin-left:5px;border-radius:50%;font-size:10px;font-weight:800;color:#fff;vertical-align:-2px}',
    '.mk-flag--red{background:#d23b3f}',
    '.mk-flag--amber{background:transparent;color:#d9a01c}',
    '.mk-flag svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}',

    /* art panels */
    '.art{margin:2px 0 14px}',
    '.legend{display:grid;gap:7px}',
    '.lg{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--soft)}',
    '.mc{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:74px;height:34px;border:1px solid #e1e6eb;border-radius:8px;background:#fff;font-size:13px;font-weight:600;color:#2d3b45;font-variant-numeric:tabular-nums;box-shadow:0 1px 2px rgba(9,16,29,.04)}',
    '.lg:nth-child(1) .mc{animation:pop .45s var(--ease) .05s both}.lg:nth-child(2) .mc{animation:pop .45s var(--ease) .14s both}.lg:nth-child(3) .mc{animation:pop .45s var(--ease) .23s both}',

    '.status-demo{display:flex;align-items:center;gap:18px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#f6f9fc,#f3f0ff)}',
    '.sd-cell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:110px;height:44px;border-radius:9px;background:#fff;border:1.5px solid #0374b5;box-shadow:0 0 0 3px rgba(3,116,181,.15);font-weight:700;color:#2d3b45;animation:sdTint 3.2s ease-in-out infinite}',
    '.sd-m{position:absolute;left:5px;top:5px;width:17px;height:17px;border-radius:50%;background:#d23b3f;color:#fff;font-size:10px;font-weight:800;line-height:17px;text-align:center;animation:sdM 3.2s var(--ease) infinite}',
    '.sd-cursor{position:absolute;left:58px;top:12px;width:1.5px;height:20px;background:#0374b5;animation:blink 1s steps(1) infinite}',
    '.sd-press .kc{animation:sdKey 3.2s ease-in-out infinite;transform-origin:50% 100%;min-width:34px;height:34px;font-size:16px;border-radius:9px}',
    '@keyframes sdM{0%,38%{opacity:0;transform:scale(.2)}48%{opacity:1;transform:scale(1.25)}56%,92%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1)}}',
    '@keyframes sdKey{0%,30%{transform:none}36%{transform:translateY(2px) scaleY(.92);box-shadow:0 0 0 #94262a}44%,100%{transform:none}}',
    '@keyframes sdTint{0%,40%{background:#fff}52%,90%{background:#fff3f3}100%{background:#fff}}',
    '@keyframes blink{50%{opacity:0}}',
    '.sd-press{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;color:var(--muted)}',

    '.sel-demo{position:relative;display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #e1e6eb;border-radius:10px;overflow:hidden;background:#fff}',
    '.sdc{height:30px;display:grid;place-items:center;border-right:1px solid #eef1f4;border-bottom:1px solid #eef1f4;font-size:12.5px;font-weight:600;color:#2d3b45;font-variant-numeric:tabular-nums}',
    '.sdc:nth-child(4n){border-right:0}.sdc:nth-child(n+9){border-bottom:0}',
    '.sdc span{animation:fill 4s ease-in-out infinite;animation-delay:calc(var(--i) * 40ms)}',
    '@keyframes fill{0%,55%{opacity:1}60%{opacity:0;transform:translateY(-4px)}66%,100%{opacity:1;transform:none}}',
    '.sel-rect{position:absolute;left:25%;top:0;width:0;height:0;border:2px solid #0374b5;background:rgba(3,116,181,.1);border-radius:3px;animation:sel 4s var(--ease) infinite}',
    '@keyframes sel{0%,8%{width:25%;height:33.3%;opacity:0}14%{opacity:1;width:25%;height:33.3%}40%,80%{width:50%;height:100%;opacity:1}92%,100%{width:50%;height:100%;opacity:0}}',

    '.post-demo{display:grid;grid-template-columns:1fr;max-width:200px;border:1px solid #e1e6eb;border-radius:10px;overflow:hidden;background:#fff}',
    '.pd-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:linear-gradient(#fdfefe,#eef2f5);font-size:12px;font-weight:650;color:#4a5864}',
    '.pd-btn{font-size:11px;font-weight:700;color:#fff;background:#b3701a;border-radius:6px;padding:3px 8px;box-shadow:0 0 0 0 rgba(179,112,26,.5);animation:postGlow 2.2s ease-out infinite}',
    '@keyframes postGlow{0%{box-shadow:0 0 0 0 rgba(179,112,26,.5)}70%,100%{box-shadow:0 0 0 8px rgba(179,112,26,0)}}',
    '.pd-cell{position:relative;padding:7px 10px;text-align:center;border-top:1px solid #eef1f4;font-size:12.5px;font-weight:600;color:#2d3b45}',
    '.pd-cell--hid::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#d9932f}',

    '.si-demo{border:1px solid #e1e6eb;border-radius:14px;padding:12px;background:linear-gradient(#fff,#fafbfd)}',
    '.si-top{display:flex;align-items:center;gap:10px}',
    '.si-av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,#0374b5,#5b3fd0)}',
    '.si-nm{flex:1 1 auto;font-size:13.5px;font-weight:700;color:var(--ink);display:flex;flex-direction:column}',
    '.si-nm small,.si-gr small{font-size:11px;font-weight:500;color:var(--muted)}',
    '.si-gr{font-size:18px;font-weight:800;color:#0b7a45;display:flex;flex-direction:column;align-items:flex-end;line-height:1.1}',
    '.si-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}',
    '.si-t{display:flex;flex-direction:column;gap:1px;padding:7px 9px;border-radius:9px;font-size:11px;color:var(--soft);background:#f4f6f8;animation:pop .45s var(--ease) both}',
    '.si-t:nth-child(2){animation-delay:.08s}.si-t:nth-child(3){animation-delay:.16s}',
    '.si-t b{font-size:16px;color:var(--ink)}',
    '.si-t--red b{color:#c9363b}.si-t--amber b{color:#a35f0c}.si-t--green b{color:#0b7a45}',

    '.hist{display:flex;align-items:flex-end;gap:7px;height:76px;padding:0 4px;border-bottom:1.5px solid #d5dbe1}',
    '.hist span{flex:1 1 0;height:var(--h);border-radius:5px 5px 0 0;background:linear-gradient(#5b8def,#4f46d8);transform-origin:bottom;animation:grow .7s var(--ease) both;animation-delay:calc(var(--i) * 70ms)}',
    '@keyframes grow{from{transform:scaleY(0)}to{transform:none}}',
    '.hist-axis{display:flex;gap:7px;padding:5px 4px 0}',
    '.hist-axis span{flex:1 1 0;text-align:center;font-size:11px;font-weight:600;color:var(--muted)}',

    '.find-demo{display:grid;gap:6px}',
    '.fd-box{display:flex;align-items:center;gap:8px;height:36px;padding:0 11px;border-radius:10px;border:1.5px solid #0374b5;box-shadow:0 0 0 3px rgba(3,116,181,.14);background:#fff;color:#4a5864}',
    '.fd-box svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}',
    '.fd-typed{font-size:13.5px;color:var(--ink);font-weight:500}',
    '.fd-typed::before{content:"";animation:typing 4s steps(1) infinite}',
    '.fd-typed::after{content:"";display:inline-block;width:1.5px;height:16px;margin-left:1px;background:#0374b5;vertical-align:-3px;animation:blink 1s steps(1) infinite}',
    '@keyframes typing{0%{content:""}8%{content:"n"}14%{content:"ne"}20%{content:"new"}26%{content:"new "}32%{content:"new t"}38%{content:"new to"}44%,100%{content:"new tom"}}',
    '.fd-hit{display:flex;justify-content:space-between;align-items:center;padding:8px 11px;border-radius:10px;background:#eef6fb;font-size:13px;animation:hit 4s ease infinite}',
    '.fd-hit b{color:var(--ink)}.fd-hit span{font-size:12px;color:var(--muted)}',
    '@keyframes hit{0%,46%{opacity:0;transform:translateY(-4px)}54%,94%{opacity:1;transform:none}100%{opacity:0}}',

    '.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}',
    '.tile{padding:13px 14px;border-radius:14px;background:linear-gradient(160deg,#f7fafc,#f4f1ff);border:1px solid #e9e6fb;animation:pop .5s var(--ease) both}',
    '.tile:nth-child(2){animation-delay:.07s}.tile:nth-child(3){animation-delay:.14s}.tile:nth-child(4){animation-delay:.21s}',
    '.tile .ico{width:30px;height:30px;border-radius:9px;margin-bottom:8px;background:#fff;box-shadow:0 2px 6px rgba(9,16,29,.06)}',
    '.tile .ico svg{width:16px;height:16px}',
    '.tile b{display:block;font-size:13.5px;color:var(--ink);margin-bottom:3px}',
    '.tile span{display:block;font-size:12.5px;line-height:1.45;color:var(--soft)}',

    /* finale */
    '.badge{width:72px;height:72px;margin:6px auto 14px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(135deg,#0374b5,#5b3fd0 60%,#e2589c);box-shadow:0 14px 30px -12px rgba(91,63,208,.7);animation:pop .7s var(--ease) both}',
    '.badge svg{width:38px;height:38px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24;animation:draw .6s .35s ease forwards}',
    '@keyframes draw{to{stroke-dashoffset:0}}',
    '.card--finale .foot{justify-content:center}',
    '.confetti{position:fixed;inset:0;pointer-events:none;overflow:hidden}',
    '.confetti i{position:absolute;top:-16px;width:8px;height:13px;border-radius:2px;opacity:.95;animation:fall var(--d) cubic-bezier(.25,.7,.4,1) var(--delay) forwards}',
    '@keyframes fall{0%{transform:translate3d(0,0,0) rotate(0)}100%{transform:translate3d(var(--x),105vh,0) rotate(var(--r));opacity:.9}}',

    /* the paused pill and the invitation */
    '.pill{position:fixed;left:50%;bottom:22px;transform:translate(-50%,24px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 14px;border-radius:999px;background:rgba(20,26,40,.94);color:#fff;box-shadow:0 14px 40px -10px rgba(9,16,29,.6);transition:transform .45s var(--ease),opacity .3s ease;font-size:13.5px;font-weight:600;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}',
    '.pill.is-on{transform:translate(-50%,0);opacity:1;pointer-events:auto}',
    '.pill__spark{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#5ec2ff,#7a5cff);display:grid;place-items:center;margin-right:2px}',
    '.pill__spark svg{width:13px;height:13px;fill:#fff;stroke:none}',
    '.pill__txt{padding-right:6px;white-space:nowrap}.pill__txt small{color:#a9b4c2;font-weight:500;margin-left:6px}',
    '.pill .btn{height:32px;padding:0 14px;font-size:13px;border-radius:999px}',
    '.pill .btn--ghost{color:#c4ccd6}.pill .btn--ghost:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.invite{position:fixed;right:22px;bottom:22px;width:350px;max-width:calc(100vw - 32px);pointer-events:auto;background:#fff;border-radius:18px;box-shadow:0 24px 60px -14px rgba(9,16,29,.45),0 3px 10px rgba(9,16,29,.1);overflow:hidden;transform:translateY(30px);opacity:0;transition:transform .6s var(--ease),opacity .4s ease}',
    '.invite.is-on{transform:none;opacity:1}',
    '.invite .card__in{padding:18px 20px 16px}',
    '.invite h2{font-size:17px}',
    '.invite p{font-size:13.5px}',
    '.invite .foot{margin-top:14px;justify-content:flex-end}',

    '@media (max-width:600px){.card,.card--hero,.card--center,.card--finale{width:calc(100vw - 24px)}.tiles{grid-template-columns:1fr}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001s!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:.001s!important}.confetti{display:none}.fd-typed::before{content:"new tom"}}'
  ].join('\n');

  var X_ICON = '<svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
  var NEXT_ICON = '<svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
  var MARK = '<svg viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="13" rx="2.2"/><path d="M3 8h14M8 8v8.5"/><path d="M11 11.6l1.6 1.6 2.8-3"/></svg>';

  /* ---------------------------------------------------------- the tour */

  function Tour(opts) {
    opts = opts || {};
    this.state = opts.state || new CGP.TourState();
    this.allStops = opts.stops || CGP.tourStops || [];
    this.stops = [];
    this.index = 0;
    this.active = false;
    this.minimized = false;
    this.targetEl = null;
    this._raf = 0;
    this._lastRect = null;
    this._onKey = this.onKey.bind(this);
    this._onPageClick = this.onPageClick.bind(this);
    this._onResize = this.reflow.bind(this, true);
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

  /* Which stops this gradebook can show: a stop for a feature that is
   * switched off (no course switcher, no gear) is left out. */
  Tour.prototype.plan = function () {
    this.stops = this.allStops.filter(function (s) {
      if (!s.optional || !s.target) return true;
      try { return !!s.target(); } catch (e) { return false; }
    });
  };

  Tour.prototype.start = function (opts) {
    if (this.active) return;
    opts = opts || {};
    this.mount();
    this.plan();
    this.active = true;
    this.index = 0;
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('keyup', this._onKey, true);
    window.addEventListener('keypress', this._onKey, true);
    document.addEventListener('click', this._onPageClick, true);
    window.addEventListener('resize', this._onResize);
    var self = this;
    requestAnimationFrame(function () {
      self.layer.classList.remove('is-off');
      self.show(0, 1);
    });
    CGP.tourInstance = this;
  };

  Tour.prototype.stop = function () { return this.stops[this.index]; };

  Tour.prototype.show = function (i, dir) {
    var s = this.stops[i];
    if (!s) return;
    this.index = i;
    this.minimized = false;
    this.pill.classList.remove('is-on');
    this.layer.classList.remove('is-off');

    // Resolve the element to point at.
    var target = null, usedFallback = false;
    if (s.target) { try { target = s.target(); } catch (e) { target = null; } }
    if (!target && s.fallback) { try { target = s.fallback(); usedFallback = !!target; } catch (e) { target = null; } }
    if (s.kind === 'hero' || s.kind === 'center' || s.kind === 'finale') target = null;
    if (target && target.scrollIntoView) {
      var r = target.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ignore */ }
      }
    }
    this.targetEl = target;
    this.targetUsedFallback = usedFallback;

    this.card.className = 'card' + (s.kind === 'hero' ? ' card--hero' : '') +
      (s.kind === 'center' ? ' card--center' : '') + (s.kind === 'finale' ? ' card--finale' : '');
    this.cardIn.innerHTML = this.render(s, usedFallback, dir);
    this._lastRect = null;
    this.reflow(true);
    this.card.classList.add('is-on');
    var focusEl = this.cardIn.querySelector('[data-act="next"]') || this.card;
    try { focusEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    this.loop();
    if (s.kind === 'finale') this.celebrate();
  };

  Tour.prototype.render = function (s, usedFallback, dir) {
    var ICON = CGP.tourIcons || {};
    var n = this.stops.length;
    var i = this.index;
    var counted = this.stops.filter(function (x) { return x.kind !== 'hero' && x.kind !== 'finale'; });
    var pos = counted.indexOf(s) + 1;
    var html = '<div class="body' + (dir < 0 ? ' is-back' : '') + '">';

    if (s.kind === 'hero') {
      html += '<div class="hero-art"><div class="brand"><span class="brand__mark">' + MARK + '</span>' +
        '<span class="brand__name">Canvas Gradebook<span>+</span></span></div>' + (s.art ? s.art() : '') + '</div>';
      html += '<div class="head"><span class="eyebrow">' + s.eyebrow + '</span>' +
        '<button class="x" type="button" data-act="skip" aria-label="Skip the tour">' + X_ICON + '</button></div>';
      html += '<h2 id="cgp-tour-title">' + s.title + '</h2><p>' + s.body + '</p>';
      if (s.meta) html += '<div class="meta">' + s.meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>';
      html += '<div class="foot"><span class="dots"></span>' +
        '<button class="btn btn--ghost" type="button" data-act="skip">Skip tour</button>' +
        '<button class="btn btn--primary btn--lg" type="button" data-act="next">Show me around ' + NEXT_ICON + '</button></div>';
      return html + '</div>';
    }

    if (s.kind === 'finale') {
      html += '<div class="badge"><svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2 8.8-9.4"/></svg></div>';
      html += '<span class="eyebrow">' + s.eyebrow + '</span>';
      html += '<h2 id="cgp-tour-title" style="margin-top:6px">' + s.title + '</h2><p>' + s.body + '</p>';
      html += '<div class="foot"><button class="btn btn--ghost" type="button" data-act="back">Back</button>' +
        '<button class="btn btn--primary btn--lg" type="button" data-act="finish">Start grading</button></div>';
      return html + '</div>';
    }

    html += '<div class="head">' + (s.icon && ICON[s.icon] ? '<span class="ico">' + ICON[s.icon] + '</span>' : '') +
      '<span class="eyebrow">' + s.eyebrow + '</span>' +
      '<span class="count">' + pos + ' / ' + counted.length + '</span>' +
      '<button class="x" type="button" data-act="skip" aria-label="End the tour">' + X_ICON + '</button></div>';
    if (s.art && s.kind !== 'center') html += '<div class="art">' + s.art() + '</div>';
    html += '<h2 id="cgp-tour-title">' + s.title + '</h2>';
    if (s.body) html += '<p>' + s.body + '</p>';
    if (s.bullets) html += '<ul>' + s.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>';
    if (s.tiles) {
      html += '<div class="tiles">' + s.tiles.map(function (t) {
        return '<div class="tile"><span class="ico">' + (ICON[t.icon] || '') + '</span><b>' + t.t + '</b><span>' + t.d + '</span></div>';
      }).join('') + '</div>';
    }
    if (usedFallback && s.fallbackNote) html += '<div class="note">' + s.fallbackNote + '</div>';
    else if (s.try && this.targetEl) html += '<div class="try"><span class="try__dot"></span><span><b>Try it:</b> ' + s.try + '</span></div>';

    var dots = '';
    for (var d = 0; d < n; d++) {
      if (this.stops[d].kind === 'hero' || this.stops[d].kind === 'finale') continue;
      dots += '<span class="dot' + (d < i ? ' is-done' : '') + (d === i ? ' is-now' : '') + '"></span>';
    }
    html += '<div class="foot"><span class="dots" aria-hidden="true">' + dots + '</span>';
    if (s.action && s.action.type === 'options') html += '<button class="btn btn--soft" type="button" data-act="options">Settings</button>';
    html += '<button class="btn btn--ghost" type="button" data-act="back">Back</button>' +
      '<button class="btn btn--primary" type="button" data-act="next">Next ' + NEXT_ICON + '</button></div>';
    return html + '</div>';
  };

  /* ------------------------------------------------------------ geometry */

  Tour.prototype.targetRect = function () {
    var t = this.targetEl;
    if (!t) return null;
    if (!t.isConnected) {
      // Canvas re-rendered it (a virtualized row); find the stop's element again.
      var s = this.stop();
      var again = null;
      try { again = (s.target && s.target()) || (s.fallback && s.fallback()); } catch (e) { again = null; }
      if (!again) return null;
      this.targetEl = t = again;
    }
    var r = t.getBoundingClientRect();
    var pad = this.stop().padding === undefined ? 6 : this.stop().padding;
    var vw = window.innerWidth, vh = window.innerHeight;
    var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    var x2 = Math.min(vw - 4, r.right + pad), y2 = Math.min(vh - 4, r.bottom + pad);
    if (x2 - x < 4 || y2 - y < 4) return null;
    return { x: x, y: y, w: x2 - x, h: y2 - y };
  };

  Tour.prototype.loop = function () {
    var self = this;
    cancelAnimationFrame(this._raf);
    var tick = function () {
      if (!self.active || self.minimized) return;
      self.reflow(false);
      self._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  };

  Tour.prototype.reflow = function (force) {
    if (!this.active || this.minimized) return;
    var rect = this.targetRect();
    var last = this._lastRect;
    var same = last && rect && Math.abs(last.x - rect.x) < 1 && Math.abs(last.y - rect.y) < 1 &&
      Math.abs(last.w - rect.w) < 1 && Math.abs(last.h - rect.h) < 1;
    if (!force && (same || (!rect && last === 'none'))) return;
    this._lastRect = rect || 'none';
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = this.stop();

    // The spotlight (or, with nothing to point at, a dim page and no hole).
    var spot = this.spot;
    spot.classList.add('is-on');
    if (rect) {
      spot.classList.remove('is-empty');
      spot.style.transform = 'translate(' + rect.x + 'px,' + rect.y + 'px)';
      spot.style.width = rect.w + 'px';
      spot.style.height = rect.h + 'px';
      spot.style.borderRadius = Math.min(12, rect.h / 2) + 'px';
    } else {
      spot.classList.add('is-empty');
      spot.style.transform = 'translate(' + (vw / 2) + 'px,' + (vh / 2) + 'px)';
      spot.style.width = '0px';
      spot.style.height = '0px';
    }

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
    var tf = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    if (!this._placed) {
      // The very first placement appears in place rather than sliding in
      // from the corner.
      card.style.transition = 'none';
      card.style.transform = tf;
      void card.offsetWidth;
      card.style.transition = '';
      this._placed = true;
      return;
    }
    card.style.transform = tf;
  };

  /* ---------------------------------------------------------- interaction */

  Tour.prototype.onCardClick = function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'next') this.next();
    else if (act === 'back') this.back();
    else if (act === 'skip') this.end('skipped');
    else if (act === 'finish') this.end('completed');
    else if (act === 'resume') this.next();
    else if (act === 'options') {
      try { chrome.runtime.sendMessage({ type: 'cgp.openOptions', hash: 'layout' }); } catch (err) { /* ignore */ }
    }
  };

  Tour.prototype.next = function () {
    if (this.index >= this.stops.length - 1) { this.end('completed'); return; }
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

  // While a card is up, keys belong to the tour: arrows move, Escape ends,
  // and nothing reaches Canvas's grid (or keyboard.js) behind it.
  Tour.prototype.onKey = function (e) {
    if (!this.active || this.minimized) return;
    var inside = e.composedPath && e.composedPath().indexOf(this.host) >= 0;
    if (e.type === 'keydown') {
      if (e.key === 'ArrowRight') { this.next(); swallow(e); return; }
      if (e.key === 'ArrowLeft') { this.back(); swallow(e); return; }
      if (e.key === 'Escape') { this.end(this.stop().kind === 'finale' ? 'completed' : 'skipped'); swallow(e); return; }
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
    var s = this.stop();
    if (!s || !s.tryIt || !this.targetEl || this.targetUsedFallback) return;
    if (!this.targetEl.contains(e.target)) return;
    var self = this;
    setTimeout(function () { self.minimize(); }, 30);
  };

  Tour.prototype.minimize = function () {
    this.minimized = true;
    cancelAnimationFrame(this._raf);
    this.layer.classList.add('is-off');
    this.card.classList.remove('is-on');
    this.spot.classList.remove('is-on');
    this.blocks.forEach(function (b) { place(b, 0, 0, 0, 0); });
    var counted = this.stops.filter(function (x) { return x.kind !== 'hero' && x.kind !== 'finale'; });
    var pos = counted.indexOf(this.stop()) + 1;
    this.pill.innerHTML = '<span class="pill__spark">' + ((CGP.tourIcons || {}).sparkle || '') + '</span>' +
      '<span class="pill__txt">Explore away<small>Tour ' + pos + ' / ' + counted.length + '</small></span>' +
      '<button class="btn btn--ghost" type="button" data-act="skip">End tour</button>' +
      '<button class="btn btn--primary" type="button" data-act="resume">Next stop ' + NEXT_ICON + '</button>';
    this.pill.classList.add('is-on');
  };

  Tour.prototype.celebrate = function () {
    if (reducedMotion()) return;
    var box = el('div', 'confetti');
    var colors = ['#0374b5', '#5b3fd0', '#e2589c', '#5ec2ff', '#f2b829', '#2f9e6a'];
    for (var i = 0; i < 70; i++) {
      var p = el('i');
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--x', ((Math.random() - 0.5) * 220) + 'px');
      p.style.setProperty('--r', ((Math.random() - 0.5) * 900) + 'deg');
      p.style.setProperty('--d', (2.2 + Math.random() * 1.8) + 's');
      p.style.setProperty('--delay', (Math.random() * 0.5) + 's');
      if (i % 3 === 0) { p.style.width = '7px'; p.style.height = '7px'; p.style.borderRadius = '50%'; }
      box.appendChild(p);
    }
    this.layer.insertBefore(box, this.card);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 4800);
  };

  Tour.prototype.end = function (how) {
    if (!this.active) return;
    var s = this.stop();
    this.active = false;
    this.endedHere = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('keyup', this._onKey, true);
    window.removeEventListener('keypress', this._onKey, true);
    document.removeEventListener('click', this._onPageClick, true);
    window.removeEventListener('resize', this._onResize);
    this.state.markDone(how, s && s.id);
    var self = this;
    this.card.classList.remove('is-on');
    this.spot.classList.remove('is-on');
    this.blocks.forEach(function (b) { place(b, 0, 0, 0, 0); });
    if (how === 'skipped') {
      this.pill.innerHTML = '<span class="pill__spark">' + ((CGP.tourIcons || {}).sparkle || '') + '</span>' +
        '<span class="pill__txt">Tour closed<small>Replay it any time from Gradebook+ settings</small></span>';
      this.pill.classList.add('is-on');
      setTimeout(function () { self.pill.classList.remove('is-on'); }, 3800);
      setTimeout(function () { self.unmount(); }, 4400);
    } else {
      this.pill.classList.remove('is-on');
      setTimeout(function () { self.unmount(); }, 5000);
    }
  };

  /* Closed elsewhere (another tab finished it): leave without a word. */
  Tour.prototype.dismissQuietly = function () {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('keyup', this._onKey, true);
    window.removeEventListener('keypress', this._onKey, true);
    document.removeEventListener('click', this._onPageClick, true);
    window.removeEventListener('resize', this._onResize);
    this.unmount();
  };

  Tour.prototype.unmount = function () {
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    if (CGP.tourInstance === this) CGP.tourInstance = null;
  };

  /* ---------------------------------------------------- the invitation */

  function showInvite(state, courseId) {
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
      '<div class="head"><span class="brand__mark" style="width:30px;height:30px;border-radius:9px">' + MARK + '</span>' +
      '<span class="eyebrow">Gradebook+ is installed</span>' +
      '<button class="x" type="button" data-act="later" aria-label="Not now">' + X_ICON + '</button></div>' +
      '<h2 id="cgp-invite-title">Take the 2-minute tour?</h2>' +
      '<p>See what’s new, live on your own gradebook — feedback bubbles, one-key statuses, student overviews and more.</p>' +
      '<div class="foot"><button class="btn btn--ghost" type="button" data-act="skip">Skip tour</button>' +
      '<button class="btn btn--primary" type="button" data-act="go">Show me ' + NEXT_ICON + '</button></div></div>';
    layer.appendChild(card);
    root.appendChild(layer);
    (document.body || document.documentElement).appendChild(host);
    requestAnimationFrame(function () { requestAnimationFrame(function () { card.classList.add('is-on'); }); });
    function close() {
      card.classList.remove('is-on');
      setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 600);
    }
    card.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'go') location.href = '/courses/' + courseId + '/gradebook#cgp-tour';
      else if (act === 'skip') { state.markDone('skipped', 'invite'); close(); }
      else close();
    });
    return { close: close };
  }

  /* ---------------------------------------------------------------- boot */

  function waitFor(test, timeoutMs, every) {
    return new Promise(function (resolve) {
      if (test()) { resolve(true); return; }
      var started = Date.now();
      var t = setInterval(function () {
        if (test()) { clearInterval(t); resolve(true); }
        else if (Date.now() - started > timeoutMs) { clearInterval(t); resolve(false); }
      }, every || 250);
    });
  }

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

  function boot() {
    if (window.self !== window.top) return;
    if (!CGP.TourState) return;
    var path = location.pathname;
    var m = /\/courses\/(\d+)/.exec(path);
    if (!m) return;
    var courseId = m[1];
    var isSpeedGrader = /\/gradebook\/speed_grader/i.test(path);
    if (isSpeedGrader) return;
    var isGradebook = /\/courses\/\d+\/gradebook\/?$/i.test(path);
    var state = new CGP.TourState();
    var forced = isGradebook && CGP.TourState.wantsTourFromHash(location.hash);
    if (forced) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }

    state.isPending().then(function (pending) {
      if (!pending && !forced) return;
      if (!isGradebook) {
        // A little later than the page itself, so it never competes with it.
        setTimeout(function () {
          whenVisible().then(function () {
            state.isPending().then(function (still) {
              if (!still) return;
              var invite = showInvite(state, courseId);
              listenForDone(function () { invite.close(); });
            });
          });
        }, 1800);
        return;
      }
      // The gradebook: wait for Canvas's grid and our first paint of it.
      waitFor(function () {
        return document.querySelector('.grid-canvas .slick-row') && document.documentElement.classList.contains('cgp-gradebook');
      }, 45000).then(function (ready) {
        if (!ready) return;
        // Let the bubbles and badges for the screenful arrive.
        return waitFor(function () { return !!document.querySelector('.cgp-sub, .cgp-cmt'); }, 6000)
          .then(function () { return new Promise(function (r) { setTimeout(r, 900); }); })
          .then(whenVisible)
          .then(function () { return forced ? true : state.isPending(); })
          .then(function (go) {
            if (!go || CGP.tourInstance) return;
            var tour = new Tour({ state: state });
            tour.start();
            listenForDone(function () { if (!tour.endedHere && tour.index === 0) tour.dismissQuietly(); });
          });
      });
    });
  }

  // Finished or skipped in another tab: an untouched welcome card here goes too.
  function listenForDone(fn) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[CGP.TourState.KEY]) return;
      var v = changes[CGP.TourState.KEY].newValue;
      if (v && v.pending === false) fn();
    });
  }

  CGP.Tour = Tour;
  CGP.startTour = function () {
    if (CGP.tourInstance) return CGP.tourInstance;
    var t = new Tour();
    t.start();
    return t;
  };

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})();
