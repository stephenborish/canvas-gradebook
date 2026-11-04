/* Canvas Gradebook+ - Studio's own Insights answers, passed to the
 * extension (page world, Studio's site only).
 *
 * Studio's page reads who watched a video with the teacher's own Studio
 * session. This sees those answers as they arrive - the viewer list, the
 * overview and the list of a video's course embeds, nothing else - and
 * posts a copy to the extension's script in the same frame
 * (studio/content.js).
 *
 * It also answers the extension's own read-only questions about the
 * teacher's courses (which videos a course has, and who watched each one),
 * for the student overview in the gradebook. Those go to Studio exactly as
 * Studio's page sends its own - same site, same sign-in: the token Studio's
 * page puts on its requests is reused here, in this page, and is never
 * posted, stored or sent anywhere else. Only GETs, only the few paths
 * below. */
(function () {
  'use strict';
  if (window.__cgpStudioWatch) return;
  window.__cgpStudioWatch = true;

  var MARK = 'cgp-studio-watch';
  var PATTERNS = [
    { kind: 'users', re: /\/api\/media_management\/perspectives\/([^/?#]+)\/insights\/users(?:[?#]|$)/ },
    { kind: 'overview', re: /\/api\/media_management\/perspectives\/([^/?#]+)\/insights\/overview(?:[?#]|$)/ },
    { kind: 'perspectives', re: /\/api\/media_management\/media\/(\d+)\/perspectives(?:[?#]|$)/ }
  ];

  // Studio's own sign-in, as its page sends it ("Bearer user_id=..., token=...").
  var auth = null;
  var authWaiters = [];
  function noteAuth(value) {
    if (auth || typeof value !== 'string' || !/^Bearer\s+\S/i.test(value)) return;
    auth = value;
    var m = /user_id=(\d+)/.exec(value);
    try { window.postMessage({ source: MARK, kind: 'auth-ready', key: m ? m[1] : '' }, location.origin); } catch (e) { /* ignore */ }
    authWaiters.splice(0).forEach(function (fn) { fn(); });
  }
  function headerFrom(h) {
    if (!h) return null;
    try {
      if (typeof h.get === 'function') return h.get('Authorization');
      if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) if (/^authorization$/i.test(h[i][0])) return h[i][1]; return null; }
      for (var k in h) if (/^authorization$/i.test(k)) return h[k];
    } catch (e) { /* ignore */ }
    return null;
  }
  function isStudioApi(url) {
    try { var u = new URL(String(url), location.href); return u.origin === location.origin && u.pathname.indexOf('/api/') === 0; } catch (e) { return false; }
  }

  function match(url) {
    var u = String(url || '');
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i].re.exec(u);
      if (m) return { kind: PATTERNS[i].kind, key: decodeURIComponent(m[1]) };
    }
    return null;
  }

  function post(hit, url, data) {
    if (!data || typeof data !== 'object') return;
    try {
      window.postMessage({ source: MARK, kind: hit.kind, key: hit.key, url: String(url), data: data }, location.origin);
    } catch (e) { /* a reply that can't be cloned: skip it */ }
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      var p = origFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (!auth && isStudioApi(url)) noteAuth(headerFrom(arguments[1] && arguments[1].headers) || headerFrom(input && input.headers));
        var hit = match(url);
        if (hit) {
          p.then(function (res) {
            if (!res || !res.ok) return;
            res.clone().json().then(function (data) { post(hit, url, data); }, function () { });
          }, function () { });
        }
      } catch (e) { /* never get in Studio's way */ }
      return p;
    };
  }

  var XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    var origOpen = XHR.open;
    XHR.open = function (method, url) {
      try {
        var hit = match(url);
        if (hit && !this.__cgpWatched) {
          this.__cgpWatched = true;
          var xhr = this;
          this.addEventListener('load', function () {
            try {
              if (xhr.status < 200 || xhr.status >= 300) return;
              var data = xhr.responseType === 'json' ? xhr.response
                : (!xhr.responseType || xhr.responseType === 'text') ? JSON.parse(xhr.responseText) : null;
              post(hit, xhr.responseURL || url, data);
            } catch (e) { /* not JSON */ }
          });
        }
      } catch (e) { /* never get in Studio's way */ }
      this.__cgpUrl = url;
      return origOpen.apply(this, arguments);
    };
    var origSet = XHR.setRequestHeader;
    XHR.setRequestHeader = function (name, value) {
      try { if (!auth && /^authorization$/i.test(name) && isStudioApi(this.__cgpUrl)) noteAuth(value); } catch (e) { /* ignore */ }
      return origSet.apply(this, arguments);
    };
  }

  /* ------------------------------------- the extension's own questions */

  var ALLOWED = [
    /^\/api\/media_management\/collections$/,
    /^\/api\/media_management\/collections\/\d+\/tiles$/,
    /^\/api\/media_management\/perspectives\/[A-Za-z0-9_-]+\/insights\/users$/
  ];
  var ASK = 'cgp-studio-req';
  var ANSWER = 'cgp-studio-res';
  var AUTH_WAIT_MS = 20000;

  function whenAuth() {
    if (auth) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      authWaiters.push(resolve);
      setTimeout(function () { reject(new Error('Studio didn’t sign in')); }, AUTH_WAIT_MS);
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window || !d || d.source !== ASK) return;
    var reply = function (msg) { window.postMessage(Object.assign({ source: ANSWER, id: d.id }, msg), location.origin); };
    var path = String(d.path || '');
    if (!ALLOWED.some(function (re) { return re.test(path); })) { reply({ ok: false, status: 0, error: 'not allowed' }); return; }
    var u = new URL(path, location.origin);
    var q = d.query || {};
    Object.keys(q).forEach(function (k) {
      var v = q[k];
      if (Array.isArray(v)) v.forEach(function (x) { u.searchParams.append(k, String(x)); });
      else if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
    whenAuth().then(function () {
      // Studio's own fetch, unwrapped: these answers aren't Studio's page's.
      return origFetch.call(window, u.toString(), {
        method: 'GET', credentials: 'include',
        headers: { 'Authorization': auth, 'Accept': 'application/json' }
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (err) { data = null; }
        reply({ ok: res.ok, status: res.status, data: res.ok ? data : null });
      });
    }).catch(function (err) {
      reply({ ok: false, status: 0, error: String((err && err.message) || err) });
    });
  });
})();
