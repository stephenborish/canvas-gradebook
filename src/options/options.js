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

  var MAX_SNIPPETS = 15;
  var MAX_SNIPPET_TEXT = 280;
  var currentSnippets = [];
  var isRawMode = false;

  function snippetsToText(list) {
    return (list || []).map(function (s) {
      var trig = String((s && s.trigger) || '').replace(/^\/+/, '').trim();
      return trig + '\n' + String((s && s.text) || '').trim();
    }).join('\n\n');
  }

  function textToSnippets(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return [];

    // Support dashed delimiter separator (--- or ===) between snippets if present
    if (raw.indexOf('\n---\n') >= 0 || raw.indexOf('\n===\n') >= 0) {
      return raw.split(/\n(?:---|===)\n/)
        .map(function (block) {
          var lines = block.trim().split('\n');
          var trigger = (lines.shift() || '').trim().replace(/^trigger:\s*/i, '').replace(/^\/+/, '');
          return { trigger: trigger, text: lines.join('\n').trim() };
        })
        .filter(function (s) { return s.trigger && s.text; });
    }

    // Default double-newline block separator: first line is trigger, subsequent lines are comment
    return raw.split(/\n{2,}/)
      .map(function (block) {
        var lines = block.trim().split('\n');
        var trigger = (lines.shift() || '').trim().replace(/^trigger:\s*/i, '').replace(/^\/+/, '');
        return { trigger: trigger, text: lines.join('\n').trim() };
      })
      .filter(function (s) { return s.trigger && s.text; });
  }

  function updateSnippetsCounter() {
    var counterEl = $('snippets-counter');
    if (!counterEl) return;
    var count = currentSnippets.length;
    counterEl.textContent = count + ' of ' + MAX_SNIPPETS + ' snippets';
    var addBtn = $('btn-add-snippet');
    if (addBtn) addBtn.disabled = count >= MAX_SNIPPETS;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderSnippetTestChips() {
    var chipsContainer = $('snippet-test-chips');
    var testInstructions = $('snippet-test-instructions');
    var testInput = $('snippet-test-input');
    var testFeedback = $('snippet-test-feedback');
    if (!chipsContainer) return;
    chipsContainer.innerHTML = '';

    var snippetsToUse = isRawMode ? textToSnippets($('snippets').value) : currentSnippets;
    var validSnippets = (snippetsToUse || []).filter(function (s) {
      return s && s.trigger && String(s.trigger).trim();
    });

    if (validSnippets.length === 0) {
      var emptyChip = document.createElement('span');
      emptyChip.className = 'snippet-test-chip snippet-test-chip--empty';
      emptyChip.textContent = 'No snippets saved yet. Click "+ Add Snippet" above to create one!';
      chipsContainer.appendChild(emptyChip);
      if (testInstructions) {
        testInstructions.innerHTML = 'Add a snippet template above, then test it here:';
      }
      if (testInput) {
        testInput.placeholder = 'Type /shortcut and press Tab here to test...';
      }
      return;
    }

    var firstTrig = String(validSnippets[0].trigger).replace(/^\/+/, '').trim();
    if (testInstructions) {
      testInstructions.innerHTML = 'Click any active shortcut chip below to test instantly, or type <kbd>/' + escapeHtml(firstTrig) + '</kbd> in the box and press <kbd>Tab</kbd>:';
    }
    if (testInput) {
      testInput.placeholder = 'Type /' + firstTrig + ' and press Tab...';
    }

    validSnippets.forEach(function (snip) {
      var trig = String(snip.trigger).replace(/^\/+/, '').trim();
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'snippet-test-chip';
      btn.textContent = '/' + trig;
      btn.title = 'Click to test /' + trig;
      btn.addEventListener('click', function () {
        if (!testInput) return;
        testInput.value = '/' + trig;
        testInput.focus();
        var out = CGP.snippets && CGP.snippets.expand(testInput.value, testInput.value.length, snippetsToUse);
        if (out) {
          testInput.value = out.text;
          testInput.setSelectionRange(out.caret, out.caret);
          if (testFeedback) {
            testFeedback.className = 'snippet-test-feedback is-success';
            testFeedback.textContent = '✓ Successfully expanded "/' + trig + '"! Works in SpeedGrader and Gradebook.';
          }
        }
      });
      chipsContainer.appendChild(btn);
    });
  }

  function renderSnippetCards(list) {
    currentSnippets = Array.isArray(list) ? list.slice() : [];
    var container = $('snippets-card-list');
    if (!container) return;
    container.innerHTML = '';

    if (!currentSnippets.length) {
      var emptyEl = document.createElement('div');
      emptyEl.className = 'snippets-empty';
      emptyEl.innerHTML = '<p>No comment snippets yet. Click <strong>+ Add Snippet</strong> above to create your first feedback template!</p>';
      container.appendChild(emptyEl);
      updateSnippetsCounter();
      renderSnippetTestChips();
      return;
    }

    currentSnippets.forEach(function (snip, idx) {
      var card = document.createElement('div');
      card.className = 'snippet-card';
      card.dataset.index = String(idx);

      var head = document.createElement('div');
      head.className = 'snippet-card__head';

      var triggerWrap = document.createElement('div');
      triggerWrap.className = 'snippet-card__trigger-wrap';

      var slashBadge = document.createElement('span');
      slashBadge.className = 'snippet-card__slash-badge';
      slashBadge.textContent = '/';

      var triggerInput = document.createElement('input');
      triggerInput.type = 'text';
      triggerInput.className = 'snippet-card__trigger-input';
      triggerInput.placeholder = 'shortcut (e.g. late)';
      triggerInput.value = String(snip.trigger || '').replace(/^\/+/, '');
      triggerInput.maxLength = 32;
      triggerInput.spellcheck = false;

      triggerWrap.appendChild(slashBadge);
      triggerWrap.appendChild(triggerInput);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'snippet-card__delete-btn';
      delBtn.title = 'Delete snippet';
      delBtn.setAttribute('aria-label', 'Delete snippet');
      delBtn.innerHTML = '&times;';

      head.appendChild(triggerWrap);
      head.appendChild(delBtn);

      var body = document.createElement('div');
      body.className = 'snippet-card__body';

      var textArea = document.createElement('textarea');
      textArea.className = 'snippet-card__text-input';
      textArea.rows = 3;
      textArea.placeholder = 'Enter feedback comment template here...';
      textArea.value = snip.text || '';
      textArea.maxLength = MAX_SNIPPET_TEXT;

      var foot = document.createElement('div');
      foot.className = 'snippet-card__foot';

      var chars = document.createElement('span');
      chars.className = 'snippet-card__chars';
      chars.textContent = (snip.text || '').length + ' / ' + MAX_SNIPPET_TEXT;

      foot.appendChild(chars);
      body.appendChild(textArea);
      body.appendChild(foot);

      card.appendChild(head);
      card.appendChild(body);
      container.appendChild(card);

      triggerInput.addEventListener('input', function () {
        currentSnippets[idx].trigger = triggerInput.value.trim().replace(/^\/+/, '');
        renderSnippetTestChips();
      });

      textArea.addEventListener('input', function () {
        currentSnippets[idx].text = textArea.value;
        chars.textContent = textArea.value.length + ' / ' + MAX_SNIPPET_TEXT;
        renderSnippetTestChips();
      });

      delBtn.addEventListener('click', function () {
        currentSnippets.splice(idx, 1);
        renderSnippetCards(currentSnippets);
      });
    });

    updateSnippetsCounter();
    renderSnippetTestChips();
  }

  function toggleRawMode() {
    isRawMode = !isRawMode;
    var rawContainer = $('snippets-raw-container');
    var cardList = $('snippets-card-list');
    var toggleBtn = $('btn-toggle-raw');
    var addBtn = $('btn-add-snippet');

    if (isRawMode) {
      $('snippets').value = snippetsToText(currentSnippets);
      rawContainer.style.display = 'block';
      cardList.style.display = 'none';
      toggleBtn.textContent = 'Switch to Card view';
      toggleBtn.setAttribute('aria-expanded', 'true');
      if (addBtn) addBtn.style.display = 'none';
    } else {
      currentSnippets = textToSnippets($('snippets').value);
      renderSnippetCards(currentSnippets);
      rawContainer.style.display = 'none';
      cardList.style.display = 'grid';
      toggleBtn.textContent = 'Bulk / Plain text';
      toggleBtn.setAttribute('aria-expanded', 'false');
      if (addBtn) addBtn.style.display = 'inline-flex';
    }
    renderSnippetTestChips();
  }

  function initSnippetsUI() {
    var addBtn = $('btn-add-snippet');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (currentSnippets.length >= MAX_SNIPPETS) return;
        currentSnippets.push({ trigger: '', text: '' });
        renderSnippetCards(currentSnippets);
        var inputs = document.querySelectorAll('.snippet-card__trigger-input');
        if (inputs.length) {
          inputs[inputs.length - 1].focus();
        }
      });
    }

    var toggleBtn = $('btn-toggle-raw');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleRawMode);
    }

    var rawArea = $('snippets');
    if (rawArea) {
      rawArea.addEventListener('input', function () {
        renderSnippetTestChips();
      });
    }

    var testInput = $('snippet-test-input');
    var testFeedback = $('snippet-test-feedback');
    if (testInput && testFeedback) {
      testInput.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && !e.shiftKey) {
          // ALWAYS prevent browser default tab navigation so focus stays in test playground!
          e.preventDefault();
          e.stopPropagation();

          var snippetsToUse = isRawMode ? textToSnippets($('snippets').value) : currentSnippets;
          var out = CGP.snippets && CGP.snippets.expand(testInput.value, testInput.selectionStart, snippetsToUse);
          if (out) {
            testInput.value = out.text;
            testInput.setSelectionRange(out.caret, out.caret);
            testFeedback.className = 'snippet-test-feedback is-success';
            testFeedback.textContent = '✓ Expanded "/' + (out.snippet.trigger || '') + '" snippet!';
            return;
          }

          var hit = CGP.snippets && CGP.snippets.findTrigger(testInput.value, testInput.selectionStart);
          var activeTriggers = (snippetsToUse || [])
            .map(function (s) { return s.trigger ? '/' + String(s.trigger).replace(/^\/+/, '').trim() : ''; })
            .filter(Boolean);

          if (hit) {
            testFeedback.className = 'snippet-test-feedback is-warning';
            if (activeTriggers.length > 0) {
              testFeedback.textContent = 'Shortcut "/' + hit.name + '" not found. Your active shortcuts: ' + activeTriggers.join(', ');
            } else {
              testFeedback.textContent = 'Shortcut "/' + hit.name + '" not found in snippets above.';
            }
            return;
          }

          // Check if teacher typed the trigger word without leading slash (e.g. typed "PDF" then hit Tab)
          var valBefore = testInput.value.slice(0, testInput.selectionStart);
          var lastWordMatch = /([A-Za-z0-9_-]+)$/.exec(valBefore);
          if (lastWordMatch) {
            var word = lastWordMatch[1];
            var matchedSnip = CGP.snippets && CGP.snippets.lookup(word, snippetsToUse);
            if (matchedSnip) {
              var startIdx = valBefore.length - word.length;
              testInput.value = testInput.value.slice(0, startIdx) + matchedSnip.text + testInput.value.slice(testInput.selectionStart);
              var newCaret = startIdx + matchedSnip.text.length;
              testInput.setSelectionRange(newCaret, newCaret);
              testFeedback.className = 'snippet-test-feedback is-success';
              testFeedback.textContent = '✓ Expanded "/' + matchedSnip.trigger + '"! (Tip: in SpeedGrader, start with a slash, e.g. /' + matchedSnip.trigger + ')';
              return;
            }
          }

          testFeedback.className = 'snippet-test-feedback is-hint';
          if (activeTriggers.length > 0) {
            testFeedback.textContent = 'Type a slash shortcut (e.g. ' + activeTriggers[0] + ') then press Tab.';
          } else {
            testFeedback.textContent = 'Add a snippet template above, then type its shortcut here and press Tab.';
          }
        }
      });
    }
  }

  /* --------------------------------------------------------------- form io */

  function fill(values) {
    BOOLS.forEach(function (k) { var el = $(k); if (el) el.checked = !!values[k]; });
    NUMS.forEach(function (k) { var el = $(k); if (el) el.value = values[k]; });
    var snips = Array.isArray(values.snippets) ? values.snippets.slice() : [];
    renderSnippetCards(snips);
    $('snippets').value = snippetsToText(snips);
  }

  function read() {
    var patch = {};
    BOOLS.forEach(function (k) { var el = $(k); if (el) patch[k] = el.checked; });
    NUMS.forEach(function (k) { var el = $(k); if (el) patch[k] = Number(el.value); });
    if (isRawMode) {
      patch.snippets = textToSnippets($('snippets').value);
    } else {
      patch.snippets = currentSnippets.map(function (s) {
        return {
          trigger: String(s.trigger || '').replace(/^\/+/, '').trim(),
          text: String(s.text || '').trim()
        };
      }).filter(function (s) { return s.trigger && s.text; });
    }
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
  initSnippetsUI();

  load().then(function () {
    listDomains();
    renderDiag();
  });
})();
