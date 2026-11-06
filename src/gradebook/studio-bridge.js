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
  var noStudio = null;               // a launch that can't work here: don't retry it
  var lastFailAt = 0;                // the last failed launch, to space retries
  var RETRY_MS = 60 * 1000;

  /* Forget the hidden frame (Studio's sign-in ran out, or it never came up),
   * so the next ask opens Studio afresh. */
  function reset() {
    studio = null;
    opening = null;
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = null;
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || !STUDIO_ORIGIN.test(e.origin) || !frame || !frame.contentWindow) return;
    if (!e.source || !CGP.util.isFrameWithin(e.source, frame.contentWindow)) return;
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
    if (noStudio) return Promise.reject(noStudio);
    if (Date.now() - lastFailAt < RETRY_MS) return Promise.reject(Object.assign(new Error('Studio didn’t open in the background'), { code: 'timeout' }));
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
    opening.catch(function (err) {
      if (err && err.code === 'noStudio') noStudio = err;
      else lastFailAt = Date.now();
      if (!studio) reset();
    });
    return opening;
  }

  function ask(courseNames, embeds) {
    var id = 'v' + (++seq) + '-' + Date.now();
    return new Promise(function (resolve, reject) {
      waiting[id] = { resolve: resolve, reject: reject };
      try { studio.win.postMessage({ source: 'cgp-canvas-ask', type: 'courseVideos', id: id, courseName: courseNames[0], courseNames: courseNames, embeds: embeds || [] }, studio.origin); } catch (e) { delete waiting[id]; reject(e); return; }
      setTimeout(function () {
        if (waiting[id]) { delete waiting[id]; reject(new Error('Studio took too long')); }
      }, ANSWER_WAIT_MS);
    });
  }

  /* {collection, videos: [{uuid, title, duration, thumbnail, createdAt, viewers}]}
   * for the Studio course named `courseName` (a name, or names to try in
   * order), plus the videos in `embeds`
   * ([{uuid, title}], Studio videos embedded in the course's assignments,
   * pages and discussions) that Studio doesn't list under that course. */
  function courseVideos(api, courseId, courseName, embeds) {
    var seen = {};
    var list = (embeds || []).filter(function (e) {
      if (!e || !e.uuid || seen[e.uuid]) return false;
      seen[e.uuid] = true;
      return true;
    }).map(function (e) { return { uuid: String(e.uuid), title: String(e.title || '') }; });
    var names = (Array.isArray(courseName) ? courseName : [courseName]).filter(Boolean);
    var key = names.join('/') + '|' + list.map(function (e) { return e.uuid; }).sort().join(',');
    var hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    var p = open(api, courseId).then(function () {
      return ask(names, list).catch(function (err) {
        // A Studio page that has stopped answering (expired sign-in, gone):
        // open a fresh one next time.
        reset();
        throw err;
      });
    });
    cache[key] = { at: Date.now(), promise: p };
    p.catch(function () { if (cache[key] && cache[key].promise === p) delete cache[key]; });
    return p;
  }

  CGP.studioBridge = { courseVideos: courseVideos };
})();
