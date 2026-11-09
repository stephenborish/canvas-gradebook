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
   * message - a "not saved" must not fade away before it has been read. */
  function status(message, opts) {
    var el = $('status');
    var isError = !!(opts && opts.error);
    el.textContent = message || '';
    el.classList.toggle('status--error', isError);
    el.setAttribute('role', isError ? 'alert' : 'status');
    if (message && !isError) setTimeout(function () { if (el.textContent === message) el.textContent = ''; }, 2600);
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

  function setCalendarStatus(text, kind) {
    var el = $('calendarStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
  }

  /* Asks Chrome to let the extension read the feed's site - only from a
   * click, which Chrome requires - then has the service worker read it. */
  function connectCalendar() {
    var url = typedCalendarUrl();
    if (url === '') { setCalendarStatus('Paste your calendar\u2019s address first.', 'error'); return Promise.resolve(false); }
    if (!url) {
      setCalendarStatus('That is not a calendar\u2019s link. In Google Calendar open Settings, click your class calendar, then Integrate calendar, and copy \u201cPublic URL to this calendar\u201d.', 'error');
      return Promise.resolve(false);
    }
    $('courseCalendarUrl').value = url;
    var host = calendarHost(url);
    return chrome.permissions.request({ origins: [Cal().originPattern(url)] }).then(function (granted) {
      if (!granted) {
        setCalendarStatus('Chrome was not allowed to let Gradebook+ read ' + host + ', so the calendar cannot be read.', 'error');
        return false;
      }
      setCalendarStatus('Reading your calendar\u2026');
      return new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: CAL_REFRESH, url: url, force: true }, function (res) {
          void chrome.runtime.lastError;
          renderCalendarStatus().then(function () {
            if (res && res.ok && url !== (baseline && baseline.courseCalendarUrl)) status('Calendar connected \u2014 click Save changes to keep it.');
            resolve(!!(res && res.ok));
          });
        });
      });
    }, function (e) {
      setCalendarStatus('Not connected: ' + String(e && e.message), 'error');
      return false;
    });
  }

  function disconnectCalendar() {
    var url = typedCalendarUrl() || Cal().normalizeUrl(baseline && baseline.courseCalendarUrl);
    $('courseCalendarUrl').value = '';
    scheduleDay = null;
    chrome.runtime.sendMessage({ type: CAL_REFRESH, url: '' }, function () {
      void chrome.runtime.lastError;
      renderCalendarStatus();
    });
    if (url && chrome.permissions.remove) chrome.permissions.remove({ origins: [Cal().originPattern(url)] }).catch(function () { return false; });
    status('Calendar removed below \u2014 click Save changes to keep it that way.');
  }

  function fmtWhen(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  /** What is stored for the address in the box: connected or not, how many
   * classes, any error, and the preview. */
  function renderCalendarStatus() {
    var url = typedCalendarUrl();
    var get = chrome.storage && chrome.storage.local ? chrome.storage.local.get(CAL_KEY) : Promise.resolve({});
    var perm = url && chrome.permissions && chrome.permissions.contains
      ? chrome.permissions.contains({ origins: [Cal().originPattern(url)] }).catch(function () { return false; })
      : Promise.resolve(true);
    return Promise.all([get, perm]).then(function (r) {
      var rec = (r[0] && r[0][CAL_KEY]) || null;
      var granted = r[1];
      lastCalendar = rec && url && rec.url === url ? rec : null;
      if (url === '') setCalendarStatus('No calendar connected.');
      else if (!url) setCalendarStatus('That is not a calendar address yet.', 'error');
      else if (!granted) {
        // Typically the address arrived through Chrome sync from another
        // computer: Chrome asks for the site's permission on each one.
        setCalendarStatus('Your calendar is saved in your settings, but Chrome asks once on each computer: click Connect to let Gradebook+ read ' +
          calendarHost(url) + ' here.', 'error');
      }
      else if (!lastCalendar) setCalendarStatus('Not read yet \u2014 click Connect.');
      else if (!lastCalendar.ok) {
        setCalendarStatus(lastCalendar.error + (lastCalendar.occ ? ' (Showing the schedule read ' + fmtWhen(lastCalendar.lastOk) + '.)' : ''), 'error');
      } else {
        var timed = (lastCalendar.occ || []).filter(function (o) { return !o.a; }).length;
        setCalendarStatus('\u2713 Connected' + (lastCalendar.name ? ' to \u201c' + lastCalendar.name + '\u201d' : '') + ': ' +
          timed + ' class meeting' + (timed === 1 ? '' : 's') + ' between ' + fmtDay(lastCalendar.from) + ' and ' + fmtDay(lastCalendar.to) +
          '. Read ' + fmtWhen(lastCalendar.fetchedAt) + '.', timed ? 'ok' : 'error');
      }
      var needsConnect = !!url && !granted;
      var btn = $('connectCalendar');
      btn.classList.toggle('btn--attention', needsConnect);
      // Sent here from the schedule panel in Canvas ("Allow on this computer").
      if (needsConnect && location.hash === '#schedule' && !renderCalendarStatus.focused) {
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
    $('disconnectCalendar').addEventListener('click', disconnectCalendar);
    $('courseCalendarUrl').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); connectCalendar(); }
    });
    $('courseCalendarUrl').addEventListener('input', CGP.util.debounce(function () { scheduleDay = null; renderCalendarStatus(); }, 300));
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
    $('courseCalendarUrl').value = values.courseCalendarUrl || '';
    $('courseScheduleTime').value = values.courseScheduleTime === 'end' ? 'end' : 'start';
    scheduleDay = null;
    renderCalendarStatus();
    renderSectionGroups(values.sectionGroups);
    currentRosterPrefs = values.rosterPrefs;
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

  /* What sanitizeSettings would silently drop from the threshold rows. */
  function thresholdProblems(rules) {
    var seen = {};
    for (var i = 0; i < rules.length; i++) {
      var b = rules[i].below;
      if (!isFinite(b) || b < 0.1 || b > 1000) return 'a Total threshold needs a number from 0 to 999.9 - fill it in or remove that row.';
      if (seen[b]) return 'two Total thresholds are both "at or below ' + tenth(b - 0.1) + '%" - change or remove one.';
      seen[b] = true;
    }
    if (rules.length > 8) return 'at most 8 Total thresholds can be saved.';
    return '';
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

  /** The snippets exactly as the teacher entered them, before sanitizing. */
  function readRawSnippets() {
    if (isRawMode) return textToSnippets($('snippets').value);
    return currentSnippets.map(function (s) {
      return {
        trigger: String(s.trigger || '').replace(/^\/+/, '').trim(),
        text: String(s.text || '').trim()
      };
    }).filter(function (s) { return s.trigger && s.text; });
  }

  function read() {
    var patch = {};
    BOOLS.forEach(function (k) { var el = $(k); if (el) patch[k] = el.checked; });
    NUMS.forEach(function (k) { var el = $(k); if (el) patch[k] = Number(el.value); });
    patch.snippets = readRawSnippets();
    // Stored as the feed address it stands for (a Public URL or share link
    // becomes its .ics address); left as typed if it is not one, so save()
    // can say so.
    patch.courseCalendarUrl = typedCalendarUrl() || String($('courseCalendarUrl').value || '').trim();
    patch.courseScheduleTime = $('courseScheduleTime').value;
    patch.gradingScale = CGP.totals.textToScale($('gradingScale').value);
    patch.totalHighlightRules = currentThresholds.slice();
    patch.sectionGroups = currentGroups;
    if (currentRosterPrefs) patch.rosterPrefs = currentRosterPrefs;
    return CGP.sanitizeSettings(patch);
  }

  function sanitizedTrigger(t) {
    // Mirrors sanitizeSettings' own trigger clean-up, for reporting only.
    return String(t || '').trim().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
  }

  /* What sanitizeSettings would silently drop or cut from these snippets,
   * spelled out by shortcut so the teacher knows exactly what to fix. */
  function snippetLosses(raw) {
    var notes = [];
    var seen = Object.create(null);
    var usable = (raw || []).filter(function (s) {
      var t = sanitizedTrigger(s.trigger);
      if (!t) {
        notes.push('"' + s.trigger + '" is not a usable shortcut (letters, numbers, - and _ only).');
        return false;
      }
      if (seen[t.toLowerCase()]) {
        notes.push('/' + t + ' is used twice (shortcuts ignore capitals), and only the first one would be kept.');
        return false;
      }
      seen[t.toLowerCase()] = true;
      return true;
    });
    var label = function (s) { return '/' + sanitizedTrigger(s.trigger); };
    if (usable.length > MAX_SNIPPETS) {
      notes.push('Only ' + MAX_SNIPPETS + ' snippets fit, so ' + usable.slice(MAX_SNIPPETS).map(label).join(', ') +
        ' would be dropped.');
    }
    var kept = usable.slice(0, MAX_SNIPPETS);
    var long = kept.filter(function (s) { return String(s.text || '').length > MAX_SNIPPET_TEXT; });
    if (long.length) {
      notes.push(long.map(function (s) { return label(s) + ' (' + String(s.text).length + ' characters)'; }).join(', ') +
        ' would be cut to ' + MAX_SNIPPET_TEXT + ' characters.');
    }
    // Chrome sync's quotas count UTF-8 bytes, per snippet and in total, so
    // accented or emoji-heavy text can hit them even when every count and
    // length above is fine.
    if (!notes.length) {
      var store = CGP.settingsStorage;
      var items = kept.map(function (s) { return { trigger: sanitizedTrigger(s.trigger), text: String(s.text || '') }; });
      var big = items.filter(function (s) { return store.snippetItemBytes(s) > LIMITS.MAX_SNIPPET_ITEM_BYTES; });
      if (big.length) {
        notes.push(big.map(function (s) { return '/' + s.trigger; }).join(', ') + ' would be cut: Chrome sync stores at most ' +
          LIMITS.MAX_SNIPPET_ITEM_BYTES + ' bytes per snippet (accented letters count as 2 bytes, emoji as 4).');
      }
      var bytes = items.reduce(function (t, s) { return t + store.snippetItemBytes(s); }, 0);
      if (!big.length && bytes > LIMITS.MAX_SNIPPET_BYTES) {
        notes.push('Your snippets come to ' + bytes + ' bytes and at most ' + LIMITS.MAX_SNIPPET_BYTES +
          ' fit in Chrome sync (accented letters count as 2 bytes, emoji as 4), so the last ones would be dropped.');
      }
    }
    return notes;
  }

  /* What the form held when it was last filled from storage, read back
   * through the form itself, so the comparison in a save only ever sees the
   * teacher's own edits (see CGP.settingsStorage.plan). */
  var baseline = null;
  var shown = null;   // the stored settings the form was last filled from

  function show(values) {
    fill(values);
    shown = JSON.stringify(values);
    baseline = read();
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
      if (saving) return;
      var untouched = baseline && JSON.stringify(read()) === JSON.stringify(baseline);
      CGP.settingsStorage.read().then(function (r) {
        // This page's own save (its change event can arrive after the save
        // has finished) or nothing that changes what is shown.
        if (JSON.stringify(r.values) === shown) return;
        if (untouched) {
          show(r.values);
          status('Updated with settings saved on another computer.');
        } else {
          status('Settings were changed on another computer. Saving keeps your edits here and their other changes.');
        }
      });
    });
  }

  /* Refuses, with the reason, anything that would not round-trip intact:
   * snippets sanitizing would drop or cut (the form keeps them so nothing is
   * lost). A merged library too big for sync is refused by the write
   * itself (CGP.settingsStorage.plan), with its own explanation. */
  function checkSavable(values, raw) {
    var losses = raw ? snippetLosses(raw) : [];
    if (losses.length) {
      return 'Not saved: ' + losses.join(' ') + ' Shorten or remove those snippets, then save again.';
    }
    // Every other setting is its own small sync item (CGP.settingsStorage),
    // well inside Chrome sync's per-item quota.
    return null;
  }

  /* base: what the form started from, so only the teacher's edits are
   * written; null replaces everything (Restore defaults, Import). */
  var saving = false;
  function writeSettings(base, values, okMessage) {
    var done;
    saving = true;
    try {
      done = Promise.resolve(CGP.settingsStorage.write(base, values));
    } catch (e) {
      done = Promise.reject(e);
    }
    return done.then(function (stored) {
      saving = false;
      show(stored); // the clamped, sanitized result, merged with anything saved elsewhere
      status(okMessage);
    }, function (err) {
      saving = false;
      // A rejected write (a sync quota, or snippets saved elsewhere that
      // would not fit alongside these) used to vanish silently.
      status('Not saved: ' + (err && err.message ? err.message : 'Chrome storage rejected this. Try shortening your snippets.'),
        { error: true });
    });
  }

  function save() {
    var badLines = CGP.totals.badScaleLines($('gradingScale').value);
    if (badLines.length) {
      status('Not saved: the letter-grade scale has line(s) that are not "Letter: number" - ' +
        badLines.join('; ') + '. Fix or remove them, then save again.', { error: true });
      return Promise.resolve();
    }
    var thresholdProblem = thresholdProblems(currentThresholds);
    if (thresholdProblem) { status('Not saved: ' + thresholdProblem, { error: true }); return Promise.resolve(); }
    var calUrl = typedCalendarUrl();
    if (calUrl === null) {
      status('Not saved: the Class Schedule calendar address is not a calendar address. Fix it or click Remove, then save again.', { error: true });
      return Promise.resolve();
    }
    // A new address needs Chrome's permission for its site, which can only
    // be asked from this click.
    if (calUrl && calUrl !== Cal().normalizeUrl(baseline && baseline.courseCalendarUrl) && !(lastCalendar && lastCalendar.url === calUrl && lastCalendar.ok)) {
      connectCalendar();
    }
    var raw = readRawSnippets();
    var values = read();
    var problem = checkSavable(values, raw);
    if (problem) { status(problem, { error: true }); return Promise.resolve(); }
    return writeSettings(baseline, values, 'Saved. Reload the gradebook tab to see the change.');
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
    var problem = checkSavable(values, rawSnippets);
    if (problem) { status(problem.replace(/^Not saved:/, 'Not restored:'), { error: true }); return; }
    writeSettings(null, values, 'Settings restored from file. Reload the gradebook tab to see the change.');
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

  $('reset').addEventListener('click', function () {
    if (!window.confirm('Restore every setting to its default? Your linked sections are kept (unlink them below).')) return;
    saving = true;
    CGP.settingsStorage.write(null, CGP.sanitizeSettings({ sectionGroups: currentGroups })).then(function (stored) {
      saving = false;
      show(stored);
      status('Defaults restored.');
    }, function (err) {
      saving = false;
      status('Defaults not restored: ' + (err && err.message ? err.message : 'Chrome storage rejected this.'), { error: true });
    });
  });

  var groupsBox = $('sectionGroupsList');
  if (groupsBox) {
    groupsBox.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-unlink]');
      if (!btn) return;
      if (JSON.stringify(read()) !== JSON.stringify(baseline)) {
        status('Save (or reload to discard) your other changes first, then unlink.', { error: true });
        return;
      }
      var i = Number(btn.getAttribute('data-unlink'));
      var next = Object.assign({}, baseline, { sectionGroups: currentGroups.filter(function (g, j) { return j !== i; }) });
      writeSettings(baseline, next, 'Unlinked. Those courses no longer copy to each other.');
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
    var KEY = 'cgp.tour';
    chrome.storage.local.get(KEY).then(function (got) {
      var o = {};
      o[KEY] = Object.assign({}, got && got[KEY], { pending: true, chapter: 'gradebook', requestedAt: Date.now() });
      return chrome.storage.local.set(o);
    }).then(function () {
      status('The tour starts the next time you open a Canvas gradebook.');
    }, function () {
      status('Could not schedule the tour.', { error: true });
    });
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
    var ver = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || CGP.VERSION || '1.30.0';
    el.textContent = ver;
  }

  initTabs();
  initSnippetsUI();
  initScheduleUI();
  initVersion();

  followRemoteChanges();
  load().then(function () {
    listDomains();
    renderDiag();
  });
})();
