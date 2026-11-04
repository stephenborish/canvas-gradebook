/* Canvas Gradebook+ - Studio's own Insights answers, passed to the
 * extension (page world, Studio's site only).
 *
 * Studio's page reads who watched a video with the teacher's own Studio
 * session. This sees those answers as they arrive - the viewer list, the
 * overview and the list of a video's course embeds, nothing else - and
 * posts a copy to the extension's script in the same frame
 * (studio/content.js). Nothing is requested, changed or stored, and no
 * request header (so no sign-in token) is ever looked at. */
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
      return origOpen.apply(this, arguments);
    };
  }
})();
