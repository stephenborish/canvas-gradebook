/* Canvas Gradebook+ - options page.
 * The only place any setting lives; the gradebook itself never grows a toolbar. */
(function () {
  'use strict';

  var CGP = globalThis.CGP;
  var DEFAULTS = CGP.DEFAULTS;

  var BOOLS = Object.keys(DEFAULTS).filter(function (k) { return typeof DEFAULTS[k] === 'boolean'; });
  var NUMS = Object.keys(DEFAULTS).filter(function (k) { return typeof DEFAULTS[k] === 'number'; });

  function $(id) { return document.getElementById(id); }

  /* opts.error: shown in the error style and left in place until the next
   * message - a "not saved" must not fade away before it has been read.
   * opts.persist: an instruction (reload Canvas) that stays until the next
   * message, without the error style. */
  function status(message, opts) {
    var el = $('status');
    var isError = !!(opts && opts.error);
    el.textContent = message || '';
    el.classList.toggle('status--error', isError);
    el.setAttribute('role', isError ? 'alert' : 'status');
    if (message && !isError && !(opts && opts.persist)) {
      setTimeout(function () { if (el.textContent === message) el.textContent = ''; }, 2600);
    }
  }

  /* ------------------------------------------------------------- snippets */

  var LIMITS = CGP.SETTINGS_LIMITS;
  var MAX_SNIPPETS = LIMITS.MAX_SNIPPETS;
  var MAX_SNIPPET_TEXT = LIMITS.MAX_SNIPPET_TEXT;
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
          // Tab is only kept when something was actually expanded, exactly
          // as in SpeedGrader and the gradebook; otherwise it moves focus
          // as usual (keyboard users must be able to leave this box).
          var snippetsToUse = isRawMode ? textToSnippets($('snippets').value) : currentSnippets;
          var out = CGP.snippets && CGP.snippets.expand(testInput.value, testInput.selectionStart, snippetsToUse);
          if (out) {
            e.preventDefault();
            e.stopPropagation();
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
              e.preventDefault();
              e.stopPropagation();
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

  /* ------------------------------------------------------- class schedule */

  var CAL_KEY = 'cgp.calendar';
  var CAL_REFRESH = 'cgp.calendar.refresh';
  var CAL_ADOPT = 'cgp.calendar.adopt';
  var scheduleDay = null;
  var lastCalendar = null;

  function Cal() { return CGP.courseCalendar; }

  function calendarHost(url) {
    try { return new URL(url).hostname; } catch (e) { return 'that site'; }
  }

  /** The address as typed, as a feed address ('' for none, null for junk). */
  function typedCalendarUrl() {
    var raw = String($('courseCalendarUrl').value || '').trim();
    if (!raw) return '';
    return Cal().normalizeUrl(raw);
  }

  /* The link saved in the settings ('' for none). Connect calendar and
   * Remove change it, each in one step; Save changes never does, so a link
   * typed in the box is not saved until it has been read. */
  var savedCalUrl = '';
  var savedSetupDismissed = false;
  var calendarResult = null;    // the last Connect's outcome, until the box changes
  var connectedRec = null;      // what Connect read, until storage has it
  var calendarConnector = null;

  function connector() {
    if (calendarConnector) return calendarConnector;
    calendarConnector = CGP.calendarConnect.create({
      locale: navigator.language,
      request: function (origins) { return chrome.permissions.request({ origins: origins }); },
      probe: function (url) {
        return new Promise(function (resolve) {
          chrome.runtime.sendMessage({ type: CAL_REFRESH, url: url, force: true, probe: true }, function (res) {
            void chrome.runtime.lastError;
            resolve(res || { ok: false, code: 'error' });
          });
        });
      },
      adopt: function (rec) {
        return new Promise(function (resolve) {
          chrome.runtime.sendMessage({ type: CAL_ADOPT, rec: rec }, function (res) { void chrome.runtime.lastError; resolve(res); });
        });
      },
      saveUrl: function (url) { return saveSettingFields({ courseCalendarUrl: url }); }
    });
    return calendarConnector;
  }

  /* Writes only these settings, on top of what is stored now: whatever
   * else is being edited on this page stays unsaved, as it was. */
  function saveSettingFields(patch) {
    // In line behind any Save still running, so the two never interleave.
    return saver.enqueue(function () {
      return CGP.settingsStorage.read().then(function (r) {
        var next = CGP.sanitizeSettings(Object.assign({}, r.values, patch));
        return CGP.settingsStorage.write(r.values, next);
      });
    }).then(function (stored) {
      shown = JSON.stringify(stored);
      if (saver.baseline) Object.keys(patch).forEach(function (k) { saver.baseline[k] = stored[k]; });
      if ('courseCalendarUrl' in patch) savedCalUrl = Cal().normalizeUrl(stored.courseCalendarUrl) || '';
      if ('courseScheduleSetupDismissed' in patch) savedSetupDismissed = !!stored.courseScheduleSetupDismissed;
      renderSaveState();
      return stored;
    });
  }

  function setCalendarStatus(text, kind, actions, next) {
    var el = $('calendarStatus');
    if (!el) return;
    el.innerHTML = '';
    if (text) {
      var p = document.createElement('p');
      p.className = 'schedule-status__text';
      p.textContent = text;
      el.appendChild(p);
    }
    (function () {
      if (!actions || !actions.length) return;
      var row = document.createElement('div');
      row.className = 'schedule-status__actions';
      actions.forEach(function (x) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--secondary btn--sm';
        b.setAttribute('data-cal-act', x.id);
        b.textContent = x.label;
        row.appendChild(b);
      });
      el.appendChild(row);
    })();
    void next;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
    el.classList.toggle('is-busy', kind === 'busy');
  }

  function setCalendarBusy(on) {
    ['connectCalendar', 'authorizeCalendar', 'disconnectCalendar'].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!on;
    });
  }

  function showResult(res) {
    if (!res || res.kind === 'busy') return;
    calendarResult = res.ok ? null : res;
    if (res.ok) {
      connectedRec = res.rec;
      $('courseCalendarUrl').value = savedCalUrl;
      scheduleDay = null;
    }
    renderCalendarStatus();
  }

  /* Connect calendar: everything in one click (calendar-connect.js). The
   * connector asks Chrome first, while the click still counts. */
  function connectCalendar() {
    var c = connector();
    if (c.inflight) return c.inflight;
    var p = c.connect($('courseCalendarUrl').value, { savedUrl: savedCalUrl });
    if (c.inflight) { setCalendarBusy(true); setCalendarStatus('Checking your calendar…', 'busy'); }
    return p.then(function (res) { setCalendarBusy(false); showResult(res); return res; });
  }

  /* The saved link, on a computer Chrome has not allowed its site on yet:
   * the link is not asked for again. */
  function authorizeCalendar() {
    var c = connector();
    if (c.inflight) return c.inflight;
    var p = c.authorize(savedCalUrl);
    if (c.inflight) { setCalendarBusy(true); setCalendarStatus('Checking your calendar…', 'busy'); }
    return p.then(function (res) { setCalendarBusy(false); if (res && !res.ok) res.authorize = true; showResult(res); return res; });
  }

  function retryCalendarSave() {
    var c = connector();
    if (c.inflight) return c.inflight;
    var p = c.retrySave();
    if (c.inflight) { setCalendarBusy(true); setCalendarStatus('Saving…', 'busy'); }
    return p.then(function (res) { setCalendarBusy(false); showResult(res); return res; });
  }

  /* Remove: the link leaves the settings at once, and only then the stored
   * meetings and Chrome's permission for the site. */
  function disconnectCalendar() {
    var url = savedCalUrl;
    if (!url) { $('courseCalendarUrl').value = ''; calendarResult = null; renderCalendarStatus(); return Promise.resolve(); }
    setCalendarBusy(true);
    return saveSettingFields({ courseCalendarUrl: '' }).then(function () {
      setCalendarBusy(false);
      $('courseCalendarUrl').value = '';
      calendarResult = null;
      connectedRec = null;
      scheduleDay = null;
      chrome.runtime.sendMessage({ type: CAL_REFRESH, url: '' }, function () { void chrome.runtime.lastError; renderCalendarStatus(); });
      if (chrome.permissions.remove) chrome.permissions.remove({ origins: [Cal().originPattern(url)] }).catch(function () { return false; });
      setCalendarStatus('Calendar removed. Canvas’s date boxes no longer show your classes.');
    }, function (err) {
      setCalendarBusy(false);
      calendarResult = { kind: 'save-failed', message: 'Couldn’t remove the calendar (' + String((err && err.message) || 'Chrome storage refused it') + '). It is still connected.', actions: [] };
      renderCalendarStatus();
    });
  }

  function skipCalendar() {
    return saveSettingFields({ courseScheduleSetupDismissed: true }).then(function () {
      $('skipCalendarNote').hidden = false;
      $('skipCalendar').hidden = true;
    }, function (err) {
      status('Not saved: ' + String((err && err.message) || 'Chrome storage refused it'), { error: true });
    });
  }

  function onCalendarAction(id) {
    if (id === 'guide') {
      var g = $('calendarGuide');
      g.open = true;
      var sum = g.querySelector('summary');
      if (sum && sum.focus) sum.focus();
      if (g.scrollIntoView) g.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (id === 'connect') {
      if (calendarResult && calendarResult.authorize) authorizeCalendar(); else connectCalendar();
    } else if (id === 'authorize') authorizeCalendar();
    else if (id === 'save') retryCalendarSave();
    else if (id === 'refresh') {
      setCalendarStatus('Reading your calendar…', 'busy');
      chrome.runtime.sendMessage({ type: CAL_REFRESH, url: savedCalUrl, force: true }, function () { void chrome.runtime.lastError; renderCalendarStatus(); });
    }
  }

  function fmtWhen(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  /** What the Class Schedule tab says now: the last Connect's problem, or
   * the saved calendar's state, with what can be done next. Never the link. */
  function renderCalendarStatus() {
    var typed = typedCalendarUrl();
    var raw = String($('courseCalendarUrl').value || '').trim();
    var saved = savedCalUrl;
    var get = chrome.storage && chrome.storage.local ? chrome.storage.local.get(CAL_KEY) : Promise.resolve({});
    var perm = saved && chrome.permissions && chrome.permissions.contains
      ? chrome.permissions.contains({ origins: [Cal().originPattern(saved)] }).catch(function () { return false; })
      : Promise.resolve(true);
    return Promise.all([get, perm]).then(function (r) {
      var rec = (r[0] && r[0][CAL_KEY]) || null;
      var granted = r[1];
      lastCalendar = saved && rec && rec.url === saved ? rec : (saved && connectedRec && connectedRec.url === saved ? connectedRec : null);
      if (connectedRec && rec && rec.url === connectedRec.url) connectedRec = null;
      var switching = !!raw && typed !== saved;
      var needsAllow = !!saved && !granted && !switching;
      $('connectCalendar').hidden = needsAllow;
      $('authorizeCalendar').hidden = !needsAllow;
      $('disconnectCalendar').hidden = !saved;
      $('skipCalendar').hidden = !!saved || savedSetupDismissed;
      $('skipCalendarNote').hidden = !!saved || !savedSetupDismissed;

      if (calendarResult) {
        setCalendarStatus(calendarResult.message, 'error', calendarResult.actions);
      } else if (switching) {
        setCalendarStatus(saved
          ? 'Click Connect calendar to switch to this link. Your current calendar stays connected until the new one has been read and saved.'
          : 'Click Connect calendar.');
      } else if (!saved) {
        setCalendarStatus('');
      } else if (needsAllow) {
        // The link came through Chrome sync: Chrome asks once per computer.
        setCalendarStatus('Your calendar link came with your settings from another computer. Chrome asks once on each computer: click ' +
          'Allow calendar access on this computer, and choose Allow. You don\u2019t need to paste the link again.', 'error');
      } else if (!lastCalendar) {
        setCalendarStatus('Saved. Your calendar hasn’t been read on this computer yet.', null, [{ id: 'refresh', label: 'Read it now' }]);
      } else if (!lastCalendar.ok) {
        setCalendarStatus(Cal().scrub(lastCalendar.error, saved) +
          (lastCalendar.occ ? ' (Showing the schedule read ' + fmtWhen(lastCalendar.lastOk) + '.)' : ''), 'error', [{ id: 'refresh', label: 'Try again' }]);
      } else {
        var view = connector().describe(lastCalendar);
        var off = !$('courseScheduleEnabled').checked ? ' The class schedule is turned off above: turn it on and click Save changes to see it in Canvas.' : '';
        setCalendarStatus(view.text + off, 'ok');
      }
      var btn = $('authorizeCalendar');
      btn.classList.toggle('btn--attention', needsAllow);
      // Sent here from the schedule panel in Canvas ("Allow on this computer").
      if (needsAllow && location.hash === '#schedule' && !renderCalendarStatus.focused) {
        renderCalendarStatus.focused = true;
        btn.focus();
      }
      renderSchedulePreview();
    });
  }

  // With the year whenever it is not this one: the range read runs from
  // weeks ago to more than a year ahead.
  function fmtDay(key) { return key ? Cal().formatDay(key, undefined, String(new Date().getFullYear())) : ''; }

  function renderSchedulePreview() {
    var box = $('schedulePreview');
    if (!box) return;
    var rec = lastCalendar;
    if (!rec || !Array.isArray(rec.occ) || !rec.occ.length) { box.hidden = true; return; }
    box.hidden = false;
    // The calendar's own zone - the one the teacher thinks in - else this
    // computer's (Canvas's own zone is only known on a Canvas page).
    var tz = (rec.zone && Cal().validZone(rec.zone)) ? rec.zone : Cal().localZone();
    var today = Cal().today(tz);
    if (!scheduleDay) {
      scheduleDay = Cal().dayView(rec.occ, today, tz).classes.length ? today : (Cal().nextClassDay(rec.occ, today, tz, 1, 60) || today);
    }
    var h12 = Cal().uses12Hour(navigator.language);
    var view = Cal().dayView(rec.occ, scheduleDay, tz);
    $('scheduleDay').textContent = Cal().formatDay(scheduleDay, undefined, today.slice(0, 4)) + (scheduleDay === today ? ' (today)' : '');
    var html = '';
    if (view.allDay.length) {
      html += '<div class="schedule-preview__tags">' + view.allDay.map(function (t) {
        return '<span class="schedule-preview__tag">' + escapeHtml(t) + '</span>';
      }).join('') + '</div>';
    }
    html += view.classes.length ? view.classes.map(function (c) {
      return '<div class="schedule-preview__row"><span class="schedule-preview__title">' + escapeHtml(c.title) + '</span>' +
        '<span class="schedule-preview__time">' + escapeHtml(Cal().formatRange(c.start, c.end, { hour12: h12 })) +
        (c.loc ? ' \u00b7 ' + escapeHtml(c.loc) : '') + '</span></div>';
    }).join('') : '<p class="schedule-preview__empty">No classes on this day.</p>';
    $('scheduleDayList').innerHTML = html;
  }

  function initScheduleUI() {
    $('connectCalendar').addEventListener('click', function () { connectCalendar(); });
    $('authorizeCalendar').addEventListener('click', function () { authorizeCalendar(); });
    $('disconnectCalendar').addEventListener('click', function () { disconnectCalendar(); });
    $('skipCalendar').addEventListener('click', function () { skipCalendar(); });
    $('calendarStatus').addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-cal-act]');
      if (b) onCalendarAction(b.getAttribute('data-cal-act'));
    });
    $('courseCalendarUrl').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); connectCalendar(); }
    });
    $('courseCalendarUrl').addEventListener('input', CGP.util.debounce(function () { calendarResult = null; scheduleDay = null; renderCalendarStatus(); }, 300));
    $('courseScheduleEnabled').addEventListener('change', function () { renderCalendarStatus(); });
    $('schedulePrev').addEventListener('click', function () { scheduleDay = Cal().addDays(scheduleDay, -1); renderSchedulePreview(); });
    $('scheduleNext').addEventListener('click', function () { scheduleDay = Cal().addDays(scheduleDay, 1); renderSchedulePreview(); });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[CAL_KEY]) renderCalendarStatus();
      });
    }
  }

  /* --------------------------------------------------------------- form io */

  function fill(values) {
    BOOLS.forEach(function (k) { var el = $(k); if (el) el.checked = !!values[k]; });
    NUMS.forEach(function (k) { var el = $(k); if (el) el.value = values[k]; });
    $('gradingScale').value = CGP.totals.scaleToText(values.gradingScale);
    renderThresholds(values.totalHighlightRules);
    var snips = Array.isArray(values.snippets) ? values.snippets.slice() : [];
    renderSnippetCards(snips);
    $('snippets').value = snippetsToText(snips);
    savedCalUrl = Cal().normalizeUrl(values.courseCalendarUrl || '') || '';
    savedSetupDismissed = !!values.courseScheduleSetupDismissed;
    $('courseCalendarUrl').value = savedCalUrl;
    calendarResult = null;
    $('courseScheduleTime').value = values.courseScheduleTime === 'end' ? 'end' : 'start';
    scheduleDay = null;
    renderCalendarStatus();
    renderSectionGroups(values.sectionGroups);
    currentRosterPrefs = values.rosterPrefs;
    currentGroupPrefs = values.groupPrefs;
  }

  /* Total thresholds: one row per rule, "At or below [72.4] % get [Alert] [Red-orange]".
   * Stored as { below: 72.5 }: the Total is compared after rounding to 0.1,
   * so "at or below 72.4" and "under 72.5" are the same rule; the form shows
   * the at-or-below number teachers think in. */
  var currentThresholds = [];

  function tenth(n) { return Math.round(n * 10) / 10; }
  function colorLabel(c) {
    var sw = CGP.highlightSwatch(c);
    return sw ? (sw.label === 'Custom' ? 'Custom (' + c + ')' : sw.label) : c;
  }

  function iconLabel(id) {
    var ic = CGP.totalIcon(id);
    return ic ? ic.label.toLowerCase() : 'icon';
  }

  /* "Totals 70% or below: red alert · 70.1–77%: yellow flag". */
  function thresholdSummary(rules) {
    var sorted = rules.filter(function (r) { return isFinite(r.below); }).slice().sort(function (a, b) { return a.below - b.below; });
    if (!sorted.length) return 'No Totals are flagged.';
    return 'Totals ' + sorted.map(function (r, i) {
      var top = tenth(r.below - 0.1);
      var range = i === 0 ? top + '% or below' : tenth(sorted[i - 1].below) + '–' + top + '%';
      return range + ': ' + colorLabel(r.color).toLowerCase() + ' ' + iconLabel(r.icon);
    }).join(' · ') + '.';
  }

  /* What sanitizeSettings would silently drop from the threshold rows:
   * { index: the row to fix, message } or null. */
  function thresholdProblem(rules) {
    var seen = {};
    for (var i = 0; i < rules.length; i++) {
      var b = rules[i].below;
      if (!isFinite(b) || b < 0.1 || b > 1000) return { index: i, message: 'Enter a percentage from 0 to 999.9, or remove this row.' };
      if (seen[b]) return { index: i, message: 'Another row already uses ' + tenth(b - 0.1) + '%. Change this one or remove it.' };
      seen[b] = true;
    }
    if (rules.length > 8) return { index: 8, message: 'At most 8 thresholds can be saved. Remove this row and any below it.' };
    return null;
  }

  function renderThresholds(list) {
    currentThresholds = (Array.isArray(list) ? list : []).map(function (r, i) {
      return { below: r.below, color: r.color, icon: CGP.totalIcon(r.icon) ? r.icon : (i === 0 ? 'alert' : 'warning') };
    });
    var box = $('totalHighlightList');
    if (!box) return;
    box.innerHTML = '';
    var summary = document.createElement('p');
    summary.className = 'threshold-summary';
    var updateSummary = function () { summary.textContent = thresholdSummary(currentThresholds); };
    if (!currentThresholds.length) {
      box.innerHTML = '<p class="threshold-empty">No thresholds. Click <strong>+ Add threshold</strong>.</p>';
    }
    currentThresholds.forEach(function (rule, i) {
      var row = document.createElement('div');
      row.className = 'threshold-row';
      var swatch = document.createElement('span');
      swatch.className = 'threshold-row__swatch';
      var swatchIcon = document.createElement('span');
      swatchIcon.className = 'threshold-row__icon';
      swatch.appendChild(swatchIcon);
      var lead = document.createElement('span');
      lead.textContent = 'At or below';
      var num = document.createElement('input');
      num.type = 'number';
      num.min = '0'; num.max = '1000'; num.step = '0.1';
      num.value = tenth(rule.below - 0.1);
      num.setAttribute('aria-label', 'Highest percentage that gets this icon');
      var pct = document.createElement('span');
      pct.textContent = '% get';
      var iconSel = document.createElement('select');
      iconSel.setAttribute('aria-label', 'Icon');
      CGP.TOTAL_ICONS.forEach(function (ic) {
        var o = document.createElement('option');
        o.value = ic.id;
        o.textContent = ic.label;
        if (ic.id === rule.icon) o.selected = true;
        iconSel.appendChild(o);
      });
      var sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Icon color');
      var isCustom = !CGP.HIGHLIGHT_PALETTE.some(function (c) { return c.id === rule.color; });
      CGP.HIGHLIGHT_PALETTE.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.label;
        if (c.id === rule.color) o.selected = true;
        sel.appendChild(o);
      });
      var co = document.createElement('option');
      co.value = 'custom';
      co.textContent = 'Custom color…';
      if (isCustom) co.selected = true;
      sel.appendChild(co);
      var picker = document.createElement('input');
      picker.type = 'color';
      picker.className = 'threshold-row__picker';
      picker.setAttribute('aria-label', 'Custom color');
      picker.value = isCustom && /^#[0-9a-f]{6}$/i.test(rule.color) ? rule.color : '#e0531f';
      picker.hidden = !isCustom;
      var paintSwatch = function () {
        var sw = CGP.highlightSwatch(rule.color) || CGP.HIGHLIGHT_PALETTE[0];
        swatchIcon.style.color = sw.edge;
        swatchIcon.innerHTML = CGP.totalIconSvg(rule.icon, 20);
        updateSummary();
      };
      paintSwatch();
      num.addEventListener('input', function () {
        var v = Number(num.value);
        rule.below = num.value === '' || !isFinite(v) ? NaN : tenth(v + 0.1);
        updateSummary();
      });
      sel.addEventListener('change', function () {
        picker.hidden = sel.value !== 'custom';
        rule.color = sel.value === 'custom' ? picker.value.toLowerCase() : sel.value;
        paintSwatch();
        if (sel.value === 'custom' && picker.showPicker) { try { picker.showPicker(); } catch (e) { /* ignore */ } }
      });
      picker.addEventListener('input', function () { rule.color = picker.value.toLowerCase(); paintSwatch(); });
      iconSel.addEventListener('change', function () { rule.icon = iconSel.value; paintSwatch(); });
      var spacer = document.createElement('span');
      spacer.className = 'threshold-row__spacer';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'threshold-row__delete';
      del.title = 'Remove threshold';
      del.setAttribute('aria-label', 'Remove threshold');
      del.textContent = '×';
      del.addEventListener('click', function () {
        currentThresholds.splice(i, 1);
        renderThresholds(currentThresholds);
      });
      [swatch, lead, num, pct, iconSel, sel, picker, spacer, del].forEach(function (n) { row.appendChild(n); });
      box.appendChild(row);
    });
    if (currentThresholds.length) box.appendChild(summary);
    updateSummary();
  }

  // Chosen in the gradebook's Copy Roster panel, not here; carried as is.
  var currentRosterPrefs = null;
  // Make groups' remembered choices and saved name formats: changed only from
  // the People page, carried through a save here untouched.
  var currentGroupPrefs = null;

  /* Linked sections are edited from Copy to sections in Canvas, where the
   * course list is; here they are listed, and can be unlinked. They are not
   * a form field: the list shown is what is stored. */
  var currentGroups = [];

  function renderSectionGroups(groups) {
    currentGroups = Array.isArray(groups) ? groups : [];
    var box = $('sectionGroupsList');
    if (!box) return;
    if (!currentGroups.length) {
      box.innerHTML = '<p class="hint">None yet. In Canvas, open an assignment (or the course home) and press Copy to other classes.</p>';
      return;
    }
    box.innerHTML = currentGroups.map(function (g, i) {
      var names = g.courseIds.map(function (id) {
        return escapeHtml((g.names && g.names[id]) || ('Course ' + id));
      }).join(' &middot; ');
      return '<div class="section-group"><div class="section-group__text"><span class="section-group__names">' + names + '</span>' +
        '<span class="section-group__where">' + g.courseIds.length + ' classes &middot; ' + escapeHtml(g.origin.replace(/^https?:\/\//, '')) + '</span></div>' +
        '<button type="button" class="btn btn--quiet btn--sm" data-unlink="' + i + '">Remove</button></div>';
    }).join('');
  }

  /** The snippets exactly as the teacher entered them, before sanitizing.
   * In card view each carries `card`, the index of its card. */
  function readRawSnippets() {
    if (isRawMode) return textToSnippets($('snippets').value);
    return currentSnippets.map(function (s, i) {
      return {
        trigger: String(s.trigger || '').replace(/^\/+/, '').trim(),
        text: String(s.text || '').trim(),
        card: i
      };
    }).filter(function (s) { return s.trigger && s.text; });
  }

  /* A card with a shortcut but no text, or text but no shortcut: it would be
   * left out of a save without a word, so it counts as unsaved and Save
   * points at it. */
  function incompleteSnippet() {
    if (isRawMode) return null;
    for (var i = 0; i < currentSnippets.length; i++) {
      var t = String(currentSnippets[i].trigger || '').replace(/^\/+/, '').trim();
      var x = String(currentSnippets[i].text || '').trim();
      if (t && !x) return { card: i, part: 'text', message: 'Add the comment for /' + t + ', or delete this snippet.' };
      if (!t && x) return { card: i, part: 'trigger', message: 'Give this snippet a shortcut, or delete it.' };
    }
    return null;
  }

  function read() {
    var patch = {};
    BOOLS.forEach(function (k) { var el = $(k); if (el) patch[k] = el.checked; });
    NUMS.forEach(function (k) { var el = $(k); if (el) patch[k] = Number(el.value); });
    patch.snippets = readRawSnippets();
    // The calendar link is saved only by Connect calendar and Remove, once
    // it has been read: Save changes keeps the saved one, whatever is typed.
    patch.courseCalendarUrl = savedCalUrl;
    patch.courseScheduleSetupDismissed = savedSetupDismissed;
    patch.courseScheduleTime = $('courseScheduleTime').value;
    patch.gradingScale = CGP.totals.textToScale($('gradingScale').value);
    patch.totalHighlightRules = currentThresholds.slice();
    patch.sectionGroups = currentGroups;
    if (currentRosterPrefs) patch.rosterPrefs = currentRosterPrefs;
    if (currentGroupPrefs) patch.groupPrefs = currentGroupPrefs;
    return CGP.sanitizeSettings(patch);
  }

  function sanitizedTrigger(t) {
    // Mirrors sanitizeSettings' own trigger clean-up, for reporting only.
    return String(t || '').trim().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
  }

  /* What sanitizeSettings would silently drop or cut from these snippets,
   * spelled out by shortcut so the teacher knows exactly what to fix. Each
   * note is { message, snip (the raw snippet it is about), part: 'trigger' |
   * 'text' }. */
  function snippetLosses(raw) {
    var notes = [];
    var note = function (message, s, part) { notes.push({ message: message, snip: s, part: part }); };
    var seen = Object.create(null);
    var usable = (raw || []).filter(function (s) {
      var t = sanitizedTrigger(s.trigger);
      if (!t) {
        note('"' + s.trigger + '" can’t be a shortcut. Use letters, numbers, - and _ only.', s, 'trigger');
        return false;
      }
      if (seen[t.toLowerCase()]) {
        note('/' + t + ' is already a shortcut (capitals don’t count). Rename this one or delete it.', s, 'trigger');
        return false;
      }
      seen[t.toLowerCase()] = true;
      return true;
    });
    var label = function (s) { return '/' + sanitizedTrigger(s.trigger); };
    if (usable.length > MAX_SNIPPETS) {
      note('Only ' + MAX_SNIPPETS + ' snippets fit, so ' + usable.slice(MAX_SNIPPETS).map(label).join(', ') +
        ' would be dropped. Delete some you no longer use.', usable[MAX_SNIPPETS], 'trigger');
    }
    var kept = usable.slice(0, MAX_SNIPPETS);
    kept.filter(function (s) { return String(s.text || '').length > MAX_SNIPPET_TEXT; }).forEach(function (s) {
      note(label(s) + ' has ' + String(s.text).length + ' characters. Shorten it to ' + MAX_SNIPPET_TEXT + '.', s, 'text');
    });
    // Chrome sync's quotas count UTF-8 bytes, per snippet and in total, so
    // accented or emoji-heavy text can hit them even when every count and
    // length above is fine.
    if (!notes.length) {
      var store = CGP.settingsStorage;
      var items = kept.map(function (s) { return { trigger: sanitizedTrigger(s.trigger), text: String(s.text || ''), snip: s }; });
      var big = items.filter(function (s) { return store.snippetItemBytes(s) > LIMITS.MAX_SNIPPET_ITEM_BYTES; });
      big.forEach(function (s) {
        note('/' + s.trigger + ' is too long for Chrome sync (at most ' + LIMITS.MAX_SNIPPET_ITEM_BYTES +
          ' bytes; accented letters count as 2, emoji as 4). Shorten it.', s.snip, 'text');
      });
      var bytes = items.reduce(function (t, s) { return t + store.snippetItemBytes(s); }, 0);
      if (!big.length && bytes > LIMITS.MAX_SNIPPET_BYTES) {
        note('Your snippets come to ' + bytes + ' bytes and at most ' + LIMITS.MAX_SNIPPET_BYTES +
          ' fit in Chrome sync. Shorten or delete some.', items[items.length - 1] && items[items.length - 1].snip, 'text');
      }
    }
    return notes;
  }

  /* One save at a time, edits made during a save kept, and the reload
   * notice only when it is needed (save-state.js). saver.baseline is what
   * the form held when it was last filled from storage, read back through
   * the form itself, so a save only ever writes the teacher's own edits (see
   * CGP.settingsStorage.plan). */
  var shown = null;   // the stored settings, as JSON, that this page last saw
  var saver = new CGP.optionsSave.Saver({
    read: function () { return read(); },
    write: function (base, values) { return CGP.settingsStorage.write(base, values); },
    // read() shows the calendar link normalized (savedCalUrl); a stored link
    // spelled otherwise (an import, an older version) is not a change.
    asForm: function (stored) {
      return Object.assign({}, stored, { courseCalendarUrl: Cal().normalizeUrl(stored.courseCalendarUrl || '') || '' });
    }
  });

  function show(values) {
    fill(values);
    shown = JSON.stringify(values);
    saver.baseline = read();
    clearProblems();
    renderSaveState();
  }

  function load() {
    return CGP.settingsStorage.read().then(function (r) {
      show(r.values);
      return r.values;
    });
  }

  /* Settings saved on another computer (or in another tab) arrive here
   * through Chrome sync. An untouched form simply shows them; one with edits
   * in progress keeps the edits, and a save then writes only those edits, on
   * top of the new settings. */
  function followRemoteChanges() {
    if (!chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync' || !Object.keys(changes).some(CGP.settingsStorage.isSettingsKey)) return;
      if (saver.busy()) return;
      var untouched = !isDirty();
      CGP.settingsStorage.read().then(function (r) {
        // This page's own save (its change event can arrive after the save
        // has finished) or nothing that changes what is shown.
        if (JSON.stringify(r.values) === shown || saver.busy()) return;
        if (untouched) {
          show(r.values);
          status('Updated with settings saved on another computer.');
        } else {
          status('Settings were changed on another computer. Saving keeps your edits here and their other changes.');
        }
      });
    });
  }

  /* ------------------------------------------------------ save and status */

  /* Unsaved: the form differs from what is stored, or a snippet card is
   * half filled in (a save would leave it out). */
  function isDirty() { return saver.dirty() || !!incompleteSnippet(); }

  /* The tab each setting lives on, for the "unsaved" dot and for sending
   * the teacher to a field that needs fixing. */
  function tabOf(el) {
    var panel = el && el.closest && el.closest('.panel');
    return panel ? panel.getAttribute('data-panel') : null;
  }

  function tabOfKey(k) {
    if (k === 'snippets') return 'snippets';
    if (k === 'totalHighlightRules') return 'layout';
    if (k === 'sectionGroups') return 'course';
    return tabOf($(k));
  }

  /* The button, the line under it, a dot on each tab with unsaved edits,
   * and a note beside each changed setting that needs a Canvas reload. */
  function renderSaveState() {
    var btn = $('save');
    var line = $('saveState');
    if (!btn || !line) return;
    var busy = !!saver.inflight;
    // The form, read once: read() sanitizes everything, and this runs on
    // every edit.
    var current = saver.baseline ? read() : null;
    var half = incompleteSnippet();
    var dirty = !busy && (saver.dirty(current) || !!half);
    btn.textContent = busy ? 'Saving…' : (dirty ? 'Save changes' : 'Saved');
    btn.setAttribute('aria-disabled', busy ? 'true' : 'false');
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.classList.toggle('btn--done', !busy && !dirty);
    line.textContent = busy ? 'Saving…' : (dirty ? 'Unsaved changes' : '');
    line.classList.toggle('save-state--dirty', dirty);

    var changed = saver.changed(current);
    if (half) changed.push('snippets');
    var tabs = {};
    changed.forEach(function (k) { var t = tabOfKey(k); if (t) tabs[t] = true; });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var on = !busy && !!tabs[tab.getAttribute('data-tab')];
      var dot = tab.querySelector('.tab__dot');
      if (on && !dot) {
        dot = document.createElement('span');
        dot.className = 'tab__dot';
        dot.innerHTML = '<span class="sr-only">(unsaved changes)</span>';
        tab.appendChild(dot);
      } else if (!on && dot) dot.remove();
    });

    var reload = current ? CGP.optionsSave.reloadKeys(saver.baseline, current) : [];
    Array.prototype.forEach.call(document.querySelectorAll('.reload-note'), function (n) {
      if (reload.indexOf(n.getAttribute('data-key')) < 0) n.remove();
    });
    reload.forEach(function (k) {
      var el = $(k);
      var lab = el && document.querySelector('label[for="' + k + '"]');
      if (!lab || lab.querySelector('.reload-note')) return;
      var note = document.createElement('span');
      note.className = 'reload-note';
      note.setAttribute('data-key', k);
      note.textContent = 'Reload Canvas after saving';
      lab.appendChild(note);
    });
  }

  // Coalesced: a burst of keystrokes repaints the state once.
  var stateQueued = false;
  function queueSaveState() {
    if (stateQueued) return;
    stateQueued = true;
    setTimeout(function () { stateQueued = false; renderSaveState(); }, 0);
  }

  /* -------------------------------------------------------------- problems */

  /* Everything that would not save as shown, in page order:
   * [{ el: the field to fix, message }]. Fields sanitizing would quietly
   * clamp (a width of 900) count too: what is saved must be what is shown. */
  function problems() {
    var out = [];
    NUMS.forEach(function (k) {
      var el = $(k);
      if (!el || el.type !== 'number') return;
      var v = el.validity || {};
      if (el.value === '' || v.badInput || v.rangeUnderflow || v.rangeOverflow) {
        out.push({ el: el, message: 'Enter a number from ' + el.min + ' to ' + el.max + '.' });
      }
    });
    var t = thresholdProblem(currentThresholds);
    if (t) {
      var rows = document.querySelectorAll('#totalHighlightList .threshold-row');
      var row = rows[Math.min(t.index, rows.length - 1)];
      out.push({ el: row ? row.querySelector('input[type="number"]') : $('addTotalHighlight'), message: t.message });
    }
    var bad = CGP.totals.badScaleLines($('gradingScale').value);
    if (bad.length) {
      out.push({ el: $('gradingScale'), message: 'Use one “Letter: number” per line, like B+: 87. Fix ' +
        (bad.length === 1 ? 'this line: ' : 'these lines: ') + bad.join('; ') + '.' });
    }
    var half = incompleteSnippet();
    if (half) out.push({ el: snippetField(half.card, half.part), message: half.message });
    var raw = readRawSnippets();
    snippetLosses(raw).forEach(function (n) {
      out.push({ el: n.snip && n.snip.card !== undefined ? snippetField(n.snip.card, n.part) : $('snippets'), message: n.message });
    });
    // Page order, so the first one reported is the first one on the page.
    out = out.filter(function (p) { return p.el; });
    out.sort(function (a, b) {
      if (a.el === b.el) return 0;
      return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1;  // 4: b follows a
    });
    return out;
  }

  function snippetField(card, part) {
    if (isRawMode) return $('snippets');
    var cards = document.querySelectorAll('#snippets-card-list .snippet-card');
    var c = cards[card];
    if (!c) return $('snippets-card-list');
    return c.querySelector(part === 'text' ? '.snippet-card__text-input' : '.snippet-card__trigger-input');
  }

  function clearProblems() {
    Array.prototype.forEach.call(document.querySelectorAll('.field-error'), function (n) { n.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll('[aria-invalid="true"]'), function (el) {
      el.removeAttribute('aria-invalid');
      var ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (id) { return id && id !== 'cgp-field-error'; });
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
    });
  }

  /* Opens the tab the first problem is on, puts the explanation right under
   * the field, and focuses it. */
  function reportProblems(list) {
    clearProblems();
    var p = list[0];
    var tab = tabOf(p.el);
    if (tab && showTab) showTab(tab);
    var msg = document.createElement('p');
    msg.className = 'field-error';
    msg.id = 'cgp-field-error';
    msg.textContent = p.message;
    var anchor = p.el.closest('.threshold-row, .snippet-card, .setting__control, .snippets-raw-container') || p.el;
    anchor.insertAdjacentElement('afterend', msg);
    p.el.setAttribute('aria-invalid', 'true');
    var ids = (p.el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    ids.push('cgp-field-error');
    p.el.setAttribute('aria-describedby', ids.join(' '));
    try { p.el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    try { p.el.focus({ preventScroll: true }); } catch (e) { p.el.focus(); }
    var where = tab ? (document.querySelector('.tab[data-tab="' + tab + '"] .tab__label') || {}).textContent : '';
    status('Not saved. ' + (list.length > 1 ? list.length + ' fields need fixing, starting with ' : 'Fix ') +
      'the one shown' + (where ? ' in ' + where : '') + '.', { error: true });
  }

  /* -------------------------------------------------------------- writing */

  /* After any save: the reload notice only when a changed setting needs it. */
  function savedMessage(lead, reload) {
    return reload.length ? lead + ' Reload open Canvas tabs to apply ' + (reload.length === 1 ? 'it.' : 'them.') : lead;
  }

  /* base: what the form started from, so only the teacher's edits are
   * written; null replaces everything (Restore defaults, Import). The form
   * is then filled from what was stored. */
  function writeSettings(base, values, okMessage, failLead) {
    var before = shown ? JSON.parse(shown) : null;
    var done = saver.enqueue(function () { return CGP.settingsStorage.write(base, values); });
    renderSaveState();
    return done.then(function (stored) {
      show(stored); // the clamped, sanitized result, merged with anything saved elsewhere
      var reload = before ? CGP.optionsSave.reloadKeys(before, stored) : [];
      status(savedMessage(okMessage, reload), { persist: reload.length > 0 });
    }, function (err) {
      renderSaveState();
      // A rejected write (a sync quota, or snippets saved elsewhere that
      // would not fit alongside these) used to vanish silently.
      status((failLead || 'Not saved: ') + (err && err.message ? err.message : 'Chrome storage rejected this. Try shortening your snippets.'),
        { error: true });
    });
  }

  function save() {
    // A second click while saving joins the save already running.
    if (saver.inflight) return saver.inflight.catch(function () { /* reported by the first click */ });
    var typedRaw = String($('courseCalendarUrl').value || '').trim();
    var pendingLink = typedRaw && typedCalendarUrl() !== savedCalUrl;
    var linkNote = ' Your calendar link isn’t saved: click Connect calendar to use it.';
    var list = problems();
    if (list.length) { reportProblems(list); return Promise.resolve(); }
    clearProblems();
    if (!isDirty()) {
      status(pendingLink ? 'Nothing else to save.' + linkNote : 'Everything is already saved.');
      return Promise.resolve();
    }
    var done = saver.save();
    renderSaveState();
    return done.then(function (r) {
      // A half-filled snippet card is not in read(), so it is not among the
      // edits: refilling the form would throw it away.
      if (!r.edited.length && !incompleteSnippet()) {
        show(r.stored);   // nothing typed meanwhile: show exactly what is stored
      } else {
        // Typed after clicking Save: those fields stay as typed, unsaved.
        shown = JSON.stringify(r.stored);
        renderSaveState();
      }
      var msg = savedMessage(r.edited.length ? 'Saved what you had when you clicked Save.' : 'Saved.', r.reload);
      if (r.stale.length) msg += ' Another computer changed some settings meanwhile; they are kept.';
      if (pendingLink) msg += linkNote;
      status(msg, { persist: r.reload.length > 0 || pendingLink || r.stale.length > 0 });
    }, function (err) {
      renderSaveState();
      status('Not saved: ' + (err && err.message ? err.message : 'Chrome storage rejected this. Try shortening your snippets.'),
        { error: true });
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
    // A backup from before linked sections existed has none: the ones this
    // computer has are kept rather than wiped.
    if (!Array.isArray(raw.sectionGroups)) raw = Object.assign({}, raw, { sectionGroups: currentGroups });
    var values = CGP.sanitizeSettings(raw);
    var rawSnippets = Array.isArray(raw.snippets) ? raw.snippets.map(function (s) {
      return { trigger: String((s && s.trigger) || '').replace(/^\/+/, '').trim(), text: String((s && s.text) || '') };
    }).filter(function (s) { return s.trigger && s.text; }) : null;
    // Refused, with the reason, when snippets would not round-trip intact.
    var losses = rawSnippets ? snippetLosses(rawSnippets) : [];
    if (losses.length) {
      status('Not restored: ' + losses.map(function (n) { return n.message; }).join(' '), { error: true });
      return;
    }
    writeSettings(null, values, 'Settings restored from file.', 'Not restored: ');
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
      // The rule in isCustomCanvasOrigin (src/script-manifest.js): Canvas
      // domains are granted as "*://host/*", a class-schedule calendar's
      // site as "https://host/*".
      var extra = (perms.origins || []).filter(function (o) {
        return o.indexOf('*://') === 0 && o.indexOf('instructure.com') === -1 && o !== '*://*/*';
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
  var showTab = null;   // opens a tab by id (set by initTabs)

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
    showTab = activate;

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

    // A link straight to one tab (the class-schedule picker's "settings").
    // "#schedule-tour" (the welcome tour's "Connect my calendar") opens that
    // tab with its guided setup on top.
    var wanted = String(location.hash || '').replace(/^#/, '');
    var guided = /-tour$/.test(wanted);
    if (guided) wanted = wanted.replace(/-tour$/, '');
    if (wanted && activate(wanted, { silent: true })) {
      if (guided && wanted === 'schedule') startScheduleTour();
      return;
    }
    var stored = null;
    try { stored = localStorage.getItem(TAB_STORAGE_KEY); } catch (e) { /* private mode, ignore */ }
    if (!stored || !activate(stored, { silent: true })) activate(tabs[0].dataset.tab, { silent: true });
  }

  /* ---------------------------------------------------------------- wiring */

  $('addTotalHighlight').addEventListener('click', function () {
    var used = currentThresholds.map(function (r) { return r.color; });
    var color = CGP.HIGHLIGHT_COLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || 'gray';
    var top = currentThresholds.reduce(function (m, r) { return Math.max(m, Number(r.below) || 0); }, 0);
    currentThresholds.push({ below: Math.min(100, top ? tenth(top + 10) : 72.5), color: color, icon: currentThresholds.length ? 'eye' : 'alert' });
    renderThresholds(currentThresholds);
  });
  $('resetTotalHighlights').addEventListener('click', function () {
    renderThresholds(CGP.DEFAULTS.totalHighlightRules);
    status('Default thresholds restored above \u2014 click Save changes to keep them.');
  });

  $('resetGradingScale').addEventListener('click', function () {
    $('gradingScale').value = CGP.totals.scaleToText(CGP.DEFAULT_GRADING_SCALE);
  });
  $('save').addEventListener('click', save);

  /* Any edit anywhere on the page updates the button and its status. Clicks
   * count too: adding or deleting a snippet or a threshold is an edit. An
   * edit to a field that was flagged clears its explanation. */
  (function trackEdits() {
    var main = document.querySelector('.content') || document.body;
    var onEdit = function (e) {
      var t = e && e.target;
      if (t && t.getAttribute && t.getAttribute('aria-invalid') === 'true' && e.type !== 'click') clearProblems();
      queueSaveState();
    };
    ['input', 'change', 'click'].forEach(function (type) { main.addEventListener(type, onEdit); });
  })();

  $('reset').addEventListener('click', function () {
    if (!window.confirm('Restore every setting to its default? Your linked sections are kept (unlink them below).')) return;
    writeSettings(null, CGP.sanitizeSettings({ sectionGroups: currentGroups }), 'Defaults restored.', 'Defaults not restored: ');
  });

  var groupsBox = $('sectionGroupsList');
  if (groupsBox) {
    groupsBox.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-unlink]');
      if (!btn) return;
      // isDirty: a half-filled snippet card would be lost when the form is
      // refilled after the unlink.
      if (saver.busy() || isDirty()) {
        status('Save (or reload to discard) your other changes first, then unlink.', { error: true });
        return;
      }
      var i = Number(btn.getAttribute('data-unlink'));
      var base = saver.baseline;
      var next = Object.assign({}, base, { sectionGroups: currentGroups.filter(function (g, j) { return j !== i; }) });
      writeSettings(base, next, 'Unlinked. Those courses no longer copy to each other.');
    });
  }

  /* ------------------------------------------------------- sync status */

  /* Whether Chrome sync is carrying anything between this teacher's
   * computers: each computer checks in through it (settings-times.js), so
   * another computer's check-in arriving here is the proof. Plus how the
   * copy in Canvas last went, per Canvas this computer has been used on. */
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'just now';
    if (m < 90) return m + ' minutes ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + ' hours ago';
    return Math.round(h / 24) + ' days ago';
  }

  function renderSyncStatus() {
    var box = $('syncStatus');
    if (!box || typeof chrome === 'undefined' || !chrome.storage) return;
    Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]).then(function (r) {
      var sync = r[0] || {}, local = r[1] || {};
      var me = local['cgp.deviceId'];
      var others = Object.keys(sync).filter(function (k) {
        return k.indexOf('cgp.device.') === 0 && k !== 'cgp.device.' + me;
      }).map(function (k) { return sync[k]; }).sort(function (a, b) { return b.at - a.at; });
      var lines = [];
      if (others.length) {
        lines.push('<p class="sync-status__ok"><strong>Chrome sync is working.</strong> It is carrying your settings to ' + others.length +
          (others.length === 1 ? ' other computer' : ' other computers') + ': ' + others.map(function (d) {
            return escapeHtml(d.label || 'Computer') + ' (last seen ' + ago(d.at) + ')';
          }).join(', ') + '.</p>');
      } else {
        lines.push('<p class="sync-status__warn"><strong>No other computer has been seen through Chrome sync yet.</strong> ' +
          'If you use this extension on another computer and it has not shown up here within an hour of opening Chrome there, ' +
          'Chrome sync is not carrying it: in Chrome, open Settings &rarr; You and Google &rarr; Sync and Google services &rarr; Manage what you sync, ' +
          'and make sure sync is on and <em>Extensions</em> is included, on both computers. If your school has turned Chrome sync off, ' +
          'the copy in your Canvas account below keeps your settings in step instead.</p>');
      }
      var mirrors = Object.keys(local).filter(function (k) { return k.indexOf('cgp.mirror.status.') === 0; });
      if (!mirrors.length) {
        lines.push('<p class="hint">Canvas copy: not used on this computer yet (it runs when you open a Canvas course page).</p>');
      }
      mirrors.forEach(function (k) {
        var st = local[k] || {};
        var where = escapeHtml(k.slice('cgp.mirror.status.'.length).replace(/^https?:\/\//, ''));
        if (st.ok) {
          lines.push('<p class="sync-status__ok"><strong>Canvas copy (' + where + '):</strong> in step ' + ago(st.at) +
            (st.pulled ? ', ' + st.pulled + ' change(s) brought here' : '') + (st.pushed ? ', ' + st.pushed + ' change(s) saved to Canvas' : '') + '.</p>');
          if (st.leftOut) {
            lines.push('<p class="sync-status__warn">' + st.leftOut.length + ' snippet(s) from your other computers do not fit here: Chrome holds at most ' +
              CGP.SETTINGS_LIMITS.MAX_SNIPPETS + ' snippets. Remove some you no longer use (on any computer), and they will come through: ' +
              st.leftOut.map(function (k) { return escapeHtml('/' + k.replace(/^cgp\.snippet\./, '')); }).join(', ') + '.</p>');
          }
          if (st.waiting) lines.push('<p class="hint">' + st.waiting + ' change(s) are waiting for Chrome sync to finish delivering them.</p>');
          if (st.conflicts) lines.push(conflictHtml(k, st.conflicts));
        } else {
          lines.push('<p class="sync-status__warn"><strong>Canvas copy (' + where + '):</strong> last try ' + ago(st.at || Date.now()) +
            ' did not work. ' + escapeHtml(st.error || '') + '</p>');
        }
      });
      box.innerHTML = lines.join('');
    }, function () { box.innerHTML = '<p class="hint">Sync status is not available.</p>'; });
  }

  /* Two computers that never synced, with different values for the same
   * setting or snippet and no record of which is newer: the teacher picks. */
  function label(key) {
    if (key.indexOf('cgp.snippet.') === 0) return 'snippet /' + key.slice('cgp.snippet.'.length);
    var name = key.replace(/^cgp\.setting\./, '');
    var el = document.getElementById(name);
    var lab = el && document.querySelector('label[for="' + name + '"]');
    return lab ? String(lab.firstChild && lab.firstChild.textContent || name).trim() : name;
  }

  function shortValue(v) {
    if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
    var t = typeof v === 'string' ? v : JSON.stringify(v);
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  }

  function conflictHtml(statusKey, conflicts) {
    return '<div class="sync-conflict" data-status="' + escapeHtml(statusKey) + '"><p><strong>Your computers disagree on ' + conflicts.length +
      (conflicts.length === 1 ? ' setting' : ' settings') + '</strong>, and neither was changed since this extension started keeping times, ' +
      'so it can’t tell which is newer:</p><ul>' + conflicts.map(function (c) {
        return '<li>' + escapeHtml(label(c.key)) + ': this computer <code>' + escapeHtml(shortValue(c.mine)) + '</code>, other computer <code>' +
          escapeHtml(shortValue(c.theirs)) + '</code></li>';
      }).join('') + '</ul><div class="action-row"><button type="button" class="btn btn--primary" data-resolve="mine">Keep this computer’s</button>' +
      '<button type="button" class="btn" data-resolve="theirs">Use the other computer’s</button></div></div>';
  }

  var statusBox = $('syncStatus');
  if (statusBox) {
    statusBox.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-resolve]');
      if (!b) return;
      var box = b.closest('[data-status]');
      var key = box.getAttribute('data-status');
      chrome.storage.local.get([key, 'cgp.clockOffset']).then(function (r) {
        var st = r[key] || {};
        var now = Date.now() + (Number(r['cgp.clockOffset']) || 0);
        return CGP.settingsMirror.resolve(chrome, st.conflicts || [], b.getAttribute('data-resolve') === 'mine', now).then(function () {
          st.conflicts = null;
          var o = {};
          o[key] = st;
          return chrome.storage.local.set(o);
        });
      }).then(function () {
        status('Done. Your other computers get it the next time Canvas is opened there.');
        renderSyncStatus();
      }, function (err) { status('Not done: ' + String(err && err.message), { error: true }); });
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: 'cgp.checkIn' }, function () { void chrome.runtime.lastError; renderSyncStatus(); });
    } catch (e) { renderSyncStatus(); }
  }
  renderSyncStatus();
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes) {
      if (Object.keys(changes).some(function (k) { return k.indexOf('cgp.device.') === 0 || k.indexOf('cgp.mirror.status.') === 0; })) renderSyncStatus();
    });
  }

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

  /* The welcome tour's guided calendar setup, on the Class Schedule tab. It
   * is not the once-per-install tour itself, so it records nothing. */
  function startScheduleTour() {
    if (!CGP.Tour || !CGP.tourScheduleStops) return;
    try { history.replaceState(null, '', location.pathname + '#schedule'); } catch (e) { /* ignore */ }
    setTimeout(function () {
      var tour = new CGP.Tour({
        stops: CGP.tourScheduleStops,
        state: { markDone: function () { return Promise.resolve(); } },
        holdKeys: false,
        finishLabel: 'Done'
      });
      tour.start();
    }, 400);
  }

  /* The welcome tour (src/tour/) is offered once per install; this marks it
   * due again on this computer, and the next gradebook opened shows it. */
  $('replayTour').addEventListener('click', function () {
    new CGP.TourState().request().then(function () {
      status('Done. The tour starts next time you open a Canvas gradebook.');
    }, function () {
      status('Could not schedule the tour.', { error: true });
    });
  });

  /* ---------------------------------------------------------------- updates */

  var UPDATE_KEY = 'cgp.update';
  var CHROME_CHECK_MS = 5 * 60 * 60 * 1000;

  function when(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var today = new Date();
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return 'today at ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
  }

  /* What is installed, when Chrome last really checked, and - after a
   * "Check for updates now" - what that check said. */
  function renderUpdates(result) {
    var box = $('updateStatus');
    if (!box || !chrome.storage) return;
    chrome.storage.local.get(UPDATE_KEY).then(function (got) {
      var st = (got && got[UPDATE_KEY]) || {};
      var version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || CGP.VERSION;
      var lines = ['You have version <b>' + version + '</b>' +
        (st.updatedFrom && st.updatedTo === version ? ', updated from ' + st.updatedFrom + ' ' + when(st.updatedAt) : '') + '.'];
      var warn = false;
      var status = result ? result.status : st.lastStatus;
      if (status === 'update_available') {
        lines.push('Version <b>' + ((result && result.version) || st.foundVersion || 'new') + '</b> found. Installing it now; this page closes while Gradebook+ restarts.');
      } else if (status === 'no_update') {
        lines.push('This is the latest version (checked ' + when(st.lastCheckedAt || Date.now()) + ').');
      } else if (status === 'throttled') {
        var next = st.lastCheckedAt ? st.lastCheckedAt + CHROME_CHECK_MS : null;
        lines.push('Chrome already checked ' + (st.lastCheckedAt ? when(st.lastCheckedAt) : 'recently') +
          ' and allows the next check ' + (next && next > Date.now() ? 'around ' + when(next) : 'soon') +
          '. Gradebook+ will check then on its own.');
      } else if (status === 'error') {
        warn = true;
        lines.push('Couldn’t reach the Chrome Web Store' + (st.lastTryAt ? ' (' + when(st.lastTryAt) + ')' : '') + '.');
      } else if (st.lastCheckedAt) {
        lines.push('Last checked ' + when(st.lastCheckedAt) + '.');
      }
      box.innerHTML = lines.join(' ');
      box.classList.toggle('updates__status--warn', warn);
    }).catch(function () { box.textContent = ''; });
  }

  $('checkUpdates').addEventListener('click', function () {
    var btn = $('checkUpdates');
    btn.disabled = true;
    $('updateStatus').textContent = 'Asking the Chrome Web Store…';
    chrome.runtime.sendMessage({ type: 'cgp.checkForUpdate' }).then(function (res) {
      renderUpdates(res || { status: 'error' });
    }, function () {
      renderUpdates({ status: 'error' });
    }).then(function () { btn.disabled = false; });
  });

  $('refreshDiag').addEventListener('click', renderDiag);
  $('clearDiag').addEventListener('click', function () {
    chrome.storage.local.remove('cgp.diag').then(function () {
      $('diagOut').textContent = 'Cleared.';
    });
  });

  function initVersion() {
    var el = $('extensionVersion');
    if (!el) return;
    var ver = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || CGP.VERSION || '1.31.0';
    el.textContent = ver;
  }

  initTabs();
  initSnippetsUI();
  initScheduleUI();
  initVersion();
  renderUpdates();

  followRemoteChanges();
  load().then(function () {
    listDomains();
    renderDiag();
  });
})();
