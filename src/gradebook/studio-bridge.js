/* Canvas Gradebook+ - Studio, quietly, for the student overview.
 *
 * The student overview's Activity tab shows how much of each of the
 * course's Studio videos the student watched. Studio only answers its own
 * page, signed in through Canvas, so this opens Studio the way the
 * teacher's Studio link in Canvas's left menu does - in a hidden frame,
 * once per page, only when the Activity tab is first shown - and asks the
 * extension's script inside it (studio/content.js) for the course's videos
 * and who watched each one. Studio's sign-in stays inside Studio's page.
 * Answers are kept in memory for a few minutes; nothing is stored. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.studioBridge) return;

  var STUDIO_ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.instructuremedia\.com$/i;
  var READY_WAIT_MS = 30000;
  var ANSWER_WAIT_MS = 90000;
  var CACHE_MS = 3 * 60 * 1000;

  var frame = null;          // the hidden Canvas-launches-Studio frame
  var studio = null;         // {win, origin} once Studio's page has signed in
  var readyWaiters = [];
  var opening = null;
  var waiting = Object.create(null);
  var seq = 0;
  var cache = Object.create(null);   // course name -> {at, promise}

  function isInside(win, root) {
    function walk(w, depth) {
      if (depth > 5) return false;
      for (var i = 0; i < w.frames.length; i++) {
        var f = w.frames[i];
        if (f === win) return true;
        try { if (walk(f, depth + 1)) return true; } catch (e) { /* ignore */ }
      }
      return false;
    }
    try { return root === win || walk(root, 0); } catch (e) { return false; }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || !STUDIO_ORIGIN.test(e.origin) || !frame || !frame.contentWindow) return;
    if (!e.source || !isInside(e.source, frame.contentWindow)) return;
    if (d.source === 'cgp-studio-hello' && d.type === 'ready') {
      studio = { win: e.source, origin: e.origin };
      readyWaiters.splice(0).forEach(function (fn) { fn(); });
      return;
    }
    if (d.source === 'cgp-studio-videos' && waiting[d.id]) {
      var w = waiting[d.id];
      delete waiting[d.id];
      if (d.ok) w.resolve({ collection: d.collection || null, videos: Array.isArray(d.videos) ? d.videos : [] });
      else w.reject(new Error(d.error || 'Studio didn’t answer'));
    }
  });

  /* Canvas's own Studio link (left menu), else the course's Studio tool. */
  function launchUrl(api, courseId) {
    var links = document.querySelectorAll('#menu a[href*="/external_tools/"], #global_nav_tray_container a[href*="/external_tools/"], nav a[href*="/external_tools/"], #section-tabs a[href*="/external_tools/"]');
    for (var i = 0; i < links.length; i++) {
      var label = (links[i].textContent || '') + ' ' + (links[i].getAttribute('aria-label') || '') + ' ' + (links[i].getAttribute('title') || '');
      if (/\bstudio\b/i.test(label)) return Promise.resolve(links[i].getAttribute('href'));
    }
    return api.getAll('/api/v1/courses/' + courseId + '/external_tools', { include_parents: true }, { maxPages: 3 }).then(function (tools) {
      var t = (tools || []).filter(function (x) {
        return x && (/instructuremedia\.com/i.test(String(x.url || '') + ' ' + String(x.domain || '')) || /^(canvas )?studio$/i.test(String(x.name || '')));
      })[0];
      return t ? '/courses/' + courseId + '/external_tools/' + t.id : null;
    }, function () { return null; });
  }

  function open(api, courseId) {
    if (studio) return Promise.resolve();
    if (opening) return opening;
    opening = launchUrl(api, courseId).then(function (href) {
      if (!href) throw Object.assign(new Error('Studio isn’t set up in this Canvas'), { code: 'noStudio' });
      var u = new URL(href, location.origin);
      if (u.origin !== location.origin) throw new Error('Unexpected Studio link');
      u.searchParams.set('display', 'borderless');
      frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.title = 'Studio (hidden, for the student overview)';
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;visibility:hidden;pointer-events:none';
      frame.src = u.toString();
      document.body.appendChild(frame);
      return new Promise(function (resolve, reject) {
        readyWaiters.push(resolve);
        setTimeout(function () { reject(Object.assign(new Error('Studio didn’t open in the background'), { code: 'timeout' })); }, READY_WAIT_MS);
      });
    });
    opening.catch(function () {
      opening = null;
      if (frame && frame.parentNode && !studio) { frame.parentNode.removeChild(frame); frame = null; }
    });
    return opening;
  }

  function ask(courseName) {
    var id = 'v' + (++seq) + '-' + Date.now();
    return new Promise(function (resolve, reject) {
      waiting[id] = { resolve: resolve, reject: reject };
      try { studio.win.postMessage({ source: 'cgp-canvas-ask', type: 'courseVideos', id: id, courseName: courseName }, studio.origin); } catch (e) { delete waiting[id]; reject(e); return; }
      setTimeout(function () {
        if (waiting[id]) { delete waiting[id]; reject(new Error('Studio took too long')); }
      }, ANSWER_WAIT_MS);
    });
  }

  /* {collection, videos: [{uuid, title, duration, thumbnail, createdAt, viewers}]}
   * for the Studio course named `courseName`. */
  function courseVideos(api, courseId, courseName) {
    var hit = cache[courseName];
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    var p = open(api, courseId).then(function () { return ask(courseName); });
    cache[courseName] = { at: Date.now(), promise: p };
    p.catch(function () { if (cache[courseName] && cache[courseName].promise === p) delete cache[courseName]; });
    return p;
  }

  CGP.studioBridge = { courseVideos: courseVideos };
})();
