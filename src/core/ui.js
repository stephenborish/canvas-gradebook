/* Canvas Gradebook+ - the only chrome this extension ever draws: a small
 * transient message used for write failures and bulk results. It is created on
 * demand, disappears on its own, and is never a persistent control. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.ui) return;

  var host = null;
  var hideTimer = null;

  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.className = 'cgp-toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  CGP.ui = {
    toast: function (message, opts) {
      opts = opts || {};
      try {
        var el = ensureHost();
        el.textContent = String(message || '');
        el.classList.toggle('cgp-toast--error', opts.level === 'error');
        el.classList.add('cgp-toast--on');
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { el.classList.remove('cgp-toast--on'); },
          opts.level === 'error' ? 7000 : 3200);
      } catch (e) { /* never let a message break grading */ }
    },
    error: function (message) { this.toast(message, { level: 'error' }); }
  };
})();
