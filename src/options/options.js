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

  /* ------------------------------------------------------- export / import */

  /* A settings backup a teacher can carry to another computer by hand - the
   * counterpart to chrome.storage.sync, which only carries settings between
   * computers signed into the same, syncing Chrome profile. Downloaded
   * straight from this page with no network request of any kind: the file is
   * built and saved entirely client-side. */
  function exportSettings() {
    var payload = {
      app: 'canvas-gradebook-plus',
      formatVersion: 1,
      extensionVersion: CGP.VERSION,
      exportedAt: new Date().toISOString(),
      settings: read()
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'canvas-gradebook-plus-settings-' + payload.exportedAt.slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked shortly after, not immediately: some browsers cancel a
    // still-in-flight download if the object URL disappears too soon.
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    status('Settings file downloaded.');
  }

  /* Accepts either this extension's own export (wrapped in {settings: ...})
   * or a bare settings object, so a file someone hand-edited or extracted
   * from an older export still loads. Every field still passes through
   * sanitizeSettings - exactly the same clamping and coercion a value coming
   * from chrome.storage.sync gets - so a corrupted or hand-edited file can
   * never write something the options form itself could not have produced. */
  function importSettingsFromText(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      status('That file is not a valid settings file (not JSON).');
      return;
    }
    var raw = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : parsed;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      status('That file does not look like a Gradebook+ settings file.');
      return;
    }
    var values = CGP.sanitizeSettings(raw);
    var payload = {};
    payload[KEY] = values;
    chrome.storage.sync.set(payload).then(function () {
      fill(values);
      status('Settings restored from file. Reload the gradebook tab to see the change.');
    }, function (err) {
      status('Not saved: ' + (err && err.message ? err.message : 'Canvas storage rejected this.'));
    });
  }

  function importSettingsFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { importSettingsFromText(String(reader.result || '')); };
    reader.onerror = function () { status('Could not read that file.'); };
    reader.readAsText(file);
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

  /* -------------------------------------------------------------------- tabs */

  var TAB_STORAGE_KEY = 'cgp.options.activeTab';

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
    if (!tabs.length) return;

    function activate(id, opts) {
      var found = false;
      tabs.forEach(function (tab) {
        var on = tab.dataset.tab === id;
        if (on) found = true;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
      });
      if (!found) return false;
      panels.forEach(function (panel) { panel.hidden = panel.dataset.panel !== id; });
      if (!(opts && opts.silent)) {
        try { localStorage.setItem(TAB_STORAGE_KEY, id); } catch (e) { /* private mode, ignore */ }
      }
      return true;
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { activate(tab.dataset.tab); });
      // Standard roving-tabindex arrow-key navigation for a vertical tablist:
      // Up/Down move focus one tab at a time (wrapping at the ends), Home/End
      // jump to the first/last. Activating on focus (rather than requiring a
      // separate Enter/Space) matches how every other Chrome/OS settings
      // sidebar already behaves, so nothing here has to be learned.
      tab.addEventListener('keydown', function (e) {
        var dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        var target = null;
        if (dir) target = tabs[(i + dir + tabs.length) % tabs.length];
        else if (e.key === 'Home') target = tabs[0];
        else if (e.key === 'End') target = tabs[tabs.length - 1];
        if (!target) return;
        e.preventDefault();
        activate(target.dataset.tab);
        target.focus();
      });
    });

    var stored = null;
    try { stored = localStorage.getItem(TAB_STORAGE_KEY); } catch (e) { /* private mode, ignore */ }
    if (!stored || !activate(stored, { silent: true })) activate(tabs[0].dataset.tab, { silent: true });
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

  $('exportSettings').addEventListener('click', exportSettings);
  $('importSettingsButton').addEventListener('click', function () { $('importSettingsFile').click(); });
  $('importSettingsFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    importSettingsFile(file);
    this.value = ''; // clears the selection so picking the same file again still fires 'change'
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

  initTabs();

  load().then(function () {
    listDomains();
    renderDiag();
  });
})();
