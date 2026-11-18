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
    /* opts.action: { label, run } adds one button after the message (the
     * "Check again" on a grade or post that couldn't be confirmed). The
     * message then stays up longer, and while the pointer or focus is on it,
     * so the teacher has time to reach the button. */
    toast: function (message, opts) {
      opts = opts || {};
      try {
        var el = ensureHost();
        el.textContent = String(message || '');
        el.classList.toggle('cgp-toast--error', opts.level === 'error');
        el.classList.toggle('cgp-toast--action', !!opts.action);
        var hold = opts.level === 'error' ? 7000 : 3200;
        if (opts.action && typeof opts.action.run === 'function') {
          hold = 20000;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cgp-toast__action';
          btn.textContent = String(opts.action.label || 'Check again');
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove('cgp-toast--on');
            try { opts.action.run(); } catch (err) { /* reported by the action itself */ }
          });
          el.appendChild(document.createTextNode(' '));
          el.appendChild(btn);
        }
        el.classList.add('cgp-toast--on');
        if (hideTimer) clearTimeout(hideTimer);
        var hide = function () {
          if (el.matches && (el.matches(':hover') || el.matches(':focus-within'))) {
            hideTimer = setTimeout(hide, 1500);
            return;
          }
          el.classList.remove('cgp-toast--on');
        };
        hideTimer = setTimeout(hide, hold);
      } catch (e) { /* never let a message break grading */ }
    },
    error: function (message, opts) { this.toast(message, Object.assign({}, opts || {}, { level: 'error' })); },
    copy: copy
  };

  /* Plain text, plus an HTML version when given, so the paste target picks
   * whichever it understands (a formatted table in Gmail, Docs or Word, plain
   * lines in a text message). The async clipboard API first; the copy-event
   * route when that is unavailable or refused. */
  function copy(text, html) {
    function viaCopyEvent() {
      return new Promise(function (resolve, reject) {
        var done = false;
        var onCopy = function (e) {
          e.preventDefault();
          e.clipboardData.setData('text/plain', text);
          if (html) e.clipboardData.setData('text/html', html);
          done = true;
        };
        document.addEventListener('copy', onCopy, true);
        try { document.execCommand('copy'); } catch (e) { /* reported below */ }
        document.removeEventListener('copy', onCopy, true);
        done ? resolve() : reject(new Error('copy failed'));
      });
    }
    var clip = typeof navigator !== 'undefined' && navigator.clipboard;
    if (clip && html && typeof ClipboardItem !== 'undefined' && clip.write) {
      return clip.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      })]).catch(viaCopyEvent);
    }
    if (clip && !html && clip.writeText) return clip.writeText(text).catch(viaCopyEvent);
    return viaCopyEvent();
  }
})();
