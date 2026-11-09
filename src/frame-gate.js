/* Canvas Gradebook+ - what a frame inside a course page gets.
 *
 * The full set of content scripts (about 1.6 MB of script and 200 KB of
 * styles) runs in the course page itself only. It used to run in every
 * frame of every course page as well - each rich-text editor's blank frame,
 * SpeedGrader's submission preview, every same-site frame - where all of it
 * was read and compiled again, only for the page boot to return at once
 * because the page is not the top window. On a page with a few editors that
 * was a noticeable part of the time the page took to finish loading, and in
 * SpeedGrader it was paid again on every student.
 *
 * Inside a frame the extension does one thing: expand the teacher's
 * snippets in the comment editor of the gradebook or SpeedGrader (the top
 * page also binds those editors' documents itself; this covers a frame it
 * cannot reach). So this small script runs in frames instead, and only a
 * frame inside one of those pages asks the service worker to add the three
 * scripts snippets need (FILES), then loads the teacher's settings.
 *
 * Also imported by the service worker, for MESSAGE and FILES; nothing below
 * the definitions runs there. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});

  var FrameGate = CGP.FrameGate || {
    MESSAGE: 'cgp.frameScripts',
    // In order. speedgrader/content.js binds the Tab handler on load when
    // its frame sits in a grading page (onGradingPage there).
    FILES: ['src/core/util.js', 'src/core/snippets.js', 'src/speedgrader/content.js']
  };
  CGP.FrameGate = FrameGate;

  function isGradingPath(path) {
    return /\/gradebook(\/|$)|\/speed_grader/i.test(String(path || ''));
  }

  /* Same test as speedgrader/content.js: the frame's own address, else its
   * parent's or the top page's (a blank frame inherits their origin, so
   * they are readable), else the referrer. */
  FrameGate.inGradingPage = function (win) {
    try { if (isGradingPath(win.location.pathname)) return true; } catch (e) { /* ignore */ }
    try { if (win.parent && isGradingPath(win.parent.location.pathname)) return true; } catch (e) { /* cross-origin */ }
    try { if (win.top && isGradingPath(win.top.location.pathname)) return true; } catch (e) { /* cross-origin */ }
    try {
      var ref = win.document && win.document.referrer;
      if (ref && isGradingPath(new URL(ref).pathname)) return true;
    } catch (e) { /* unparsable referrer */ }
    return false;
  };

  /* Returns true when the scripts were asked for. */
  FrameGate.run = function (win, runtime) {
    if (!win || !runtime || typeof runtime.sendMessage !== 'function') return false;
    // The page itself already has everything (the full content-script set).
    if (win.top === win.self) return false;
    if (CGP._frameScriptsRequested || CGP.snippets) return false;
    if (!FrameGate.inGradingPage(win)) return false;
    CGP._frameScriptsRequested = true;
    try {
      runtime.sendMessage({ type: FrameGate.MESSAGE }, function () {
        void runtime.lastError;   // the extension was reloaded: nothing to do
        // The teacher's own snippets, not the built-in defaults.
        if (CGP.settings && typeof CGP.settings.load === 'function') {
          CGP.settings.load().catch(function () { /* defaults stay */ });
        }
      });
    } catch (e) { /* extension context gone */ }
    return true;
  };

  if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
    FrameGate.run(window, chrome.runtime);
  }
})();
