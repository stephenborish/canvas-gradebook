/* Canvas Gradebook+ - options page.
 * The only place any setting lives; the gradebook itself never grows a toolbar. */
(function () {
  'use strict';

  var CGP = globalThis.CGP;
  var DEFAULTS = CGP.DEFAULTS;
  var KEY = 'cgp.settings';

  var BOOLS = Object.keys(DEFAULTS).filter(function (k) { return typeof DEFAULTS[k] === 'boolean'; });
  var NUMS = Object.keys(DEFAULTS).filter(function (k) { return typeof DEFAULTS[k] === 'number'; });

  function $(id) { return document.getElementById(id); }

  function status(message) {
    var el = $('status');
    el.textContent = message || '';
    if (message) setTimeout(function () { if (el.textContent === message) el.textContent = ''; }, 2600);
  }

  /* ------------------------------------------------------------- snippets */

  function snippetsToText(list) {
    return (list || []).map(function (s) { return s.trigger + '\n' + s.text; }).join('\n\n');
  }

  function textToSnippets(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map(function (block) {
        var lines = block.split('\n');
        var trigger = (lines.shift() || '').trim();
        return { trigger: trigger, text: lines.join('\n').trim() };
      })
      .filter(function (s) { return s.trigger && s.text; });
  }

  /* --------------------------------------------------------------- form io */

  function fill(values) {
    BOOLS.forEach(function (k) { var el = $(k); if (el) el.checked = !!values[k]; });
    NUMS.forEach(function (k) { var el = $(k); if (el) el.value = values[k]; });
    $('snippets').value = snippetsToText(values.snippets);
  }

  function read() {
    var patch = {};
    BOOLS.forEach(function (k) { var el = $(k); if (el) patch[k] = el.checked; });
    NUMS.forEach(function (k) { var el = $(k); if (el) patch[k] = Number(el.value); });
    patch.snippets = textToSnippets($('snippets').value);
    return CGP.sanitizeSettings(patch);
  }

  function load() {
    return chrome.storage.sync.get(KEY).then(function (got) {
      var values = CGP.sanitizeSettings(got && got[KEY]);
      fill(values);
      return values;
    });
  }

  function save() {
    var values = read();
    var payload = {};
    payload[KEY] = values;
    return chrome.storage.sync.set(payload).then(function () {
      fill(values); // show the clamped, sanitized result back to the teacher
      status('Saved. Reload the gradebook tab to see the change.');
    }, function (err) {
      // A rejected write (most likely the 8KB-per-item quota, from a large
      // snippet library) previously vanished silently: nothing here ever
      // reacted to a rejection, so nothing was saved AND nothing told the
      // teacher that - the form just sat there looking like any other click.
      status('Not saved: ' + (err && err.message ? err.message : 'Canvas storage rejected this.') +
        ' Try shortening your snippets.');
    });
  }

  /* ----------------------------------------------------------- extra hosts */

  function normalizeHost(raw) {
    var text = String(raw || '').trim();
    if (!text) return null;
    text = text.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) return null;
    return text.toLowerCase();
  }

  function listDomains() {
    chrome.permissions.getAll().then(function (perms) {
      var extra = (perms.origins || []).filter(function (o) {
        return o.indexOf('instructure.com') === -1 && o !== '*://*/*';
      });
      $('domainList').textContent = extra.length
        ? 'Enabled here: ' + extra.join(', ')
        : 'No extra domains enabled. instructure.com always works.';
    });
  }

  function grantDomain() {
    var host = normalizeHost($('customDomain').value);
    if (!host) { status('That does not look like a domain name.'); return; }
    chrome.permissions.request({ origins: ['*://' + host + '/*'] }).then(function (granted) {
      if (!granted) { status('Permission was not granted.'); return; }
      chrome.runtime.sendMessage({ type: 'cgp.syncDynamicScripts' }, function () {
        listDomains();
        $('customDomain').value = '';
        status(host + ' enabled. Open its gradebook in a new tab.');
      });
    });
  }

  /* ---------------------------------------------------------- diagnostics */

  function renderDiag() {
    chrome.storage.local.get('cgp.diag').then(function (got) {
      var snap = got && got['cgp.diag'];
      if (!snap) {
        $('diagOut').textContent = $('diagnostics').checked
          ? 'No diagnostics recorded yet. Open a gradebook, then press Refresh.'
          : 'Diagnostics off.';
        return;
      }
      var lines = [];
      lines.push('version ' + snap.version + '   recorded ' + new Date(snap.at).toLocaleString());
      if (snap.page) lines.push('page ' + snap.page);
      lines.push('');
      lines.push('-- facts --');
      Object.keys(snap.facts || {}).sort().forEach(function (k) {
        lines.push(k.padEnd(28) + ' ' + JSON.stringify(snap.facts[k]));
      });
      lines.push('');
      lines.push('-- counters --');
      Object.keys(snap.counters || {}).sort().forEach(function (k) {
        lines.push(k.padEnd(28) + ' ' + snap.counters[k]);
      });
      lines.push('');
      lines.push('-- recent events --');
      (snap.events || []).slice(-40).forEach(function (e) {
        var stamp = new Date(e.t).toLocaleTimeString();
        lines.push(stamp + '  ' + e.level.toUpperCase().padEnd(5) + ' ' + e.k +
          (e.data ? '  ' + JSON.stringify(e.data) : ''));
      });
      $('diagOut').textContent = lines.join('\n');
    });
  }

  /* ---------------------------------------------------------------- wiring */

  $('save').addEventListener('click', save);

  $('reset').addEventListener('click', function () {
    if (!window.confirm('Restore every setting to its default?')) return;
    var payload = {};
    payload[KEY] = CGP.sanitizeSettings({});
    chrome.storage.sync.set(payload).then(function () {
      load();
      status('Defaults restored.');
    });
  });

  $('grantDomain').addEventListener('click', grantDomain);
  $('customDomain').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); grantDomain(); }
  });

  $('refreshDiag').addEventListener('click', renderDiag);
  $('clearDiag').addEventListener('click', function () {
    chrome.storage.local.remove('cgp.diag').then(function () {
      $('diagOut').textContent = 'Cleared.';
    });
  });

  load().then(function () {
    listDomains();
    renderDiag();
  });
})();
