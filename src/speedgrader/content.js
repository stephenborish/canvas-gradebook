/* Canvas Gradebook+ - SpeedGrader draft protection.
 *
 * Typed-but-unsent submission comments are the easiest thing to lose in
 * SpeedGrader: one stray navigation and the text is gone. This autosaves the
 * comment box to local extension storage, keyed by host + course + assignment +
 * student, restores it when you come back, and deletes it only once Canvas has
 * actually confirmed the comment. Nothing leaves the browser.
 *
 * Also: type /trigger then Tab to expand a saved snippet. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});

  var TEXTAREA_SELECTORS = [
    '#speed_grader_comment_textarea',
    'textarea[name="comment[text_comment]"]',
    '#comment_textarea',
    'textarea#speedgrader_comment_textarea',
    '#add_a_comment textarea',
    '#discussion textarea',
    '.comment_area textarea',
    'textarea[data-testid*="comment" i]',
    'textarea[name*="comment" i]',
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="comment" i]'
  ].join(', ');

  var SUBMIT_SELECTORS = [
    '#comment_submit_button',
    'button[data-testid="comment-submit-button"]',
    'button[data-testid*="submit-comment" i]',
    '#submit_comment_button'
  ].join(', ');

  /** Last resort when none of the selectors above match: SpeedGrader normally
   * has exactly one meaningful, visible comment box on the page. */
  function findTextareaFallback() {
    var areas = Array.prototype.filter.call(document.querySelectorAll('textarea'), function (t) {
      if (t.disabled || t.readOnly) return false;
      var r = t.getBoundingClientRect();
      return r.width > 60 && r.height > 14 && t.offsetParent !== null;
    });
    return areas.length === 1 ? areas[0] : null;
  }

  var COMMENTS_SELECTORS = ['#comments', '#comment_list', '.comment_list', '.comments'].join(', ');

  /* Canvas may render SpeedGrader comments with the RCE-lite editor instead of
   * a textarea. In that mode the editable surface is contenteditable and the
   * old textarea-only Tab handler never runs. Expand /trigger at the caret in
   * the current text node without flattening the rest of the rich-text DOM. */
  function isCommentEditor(el) {
    if (!el || !el.matches) return false;
    if (el.matches(TEXTAREA_SELECTORS)) return true;
    if (!el.matches('[contenteditable="true"]')) return false;
    if (el.closest('#speedgrader_comment_textarea_mount_point, #add_a_comment, #discussion, .comment_area')) return true;
    var label = ((el.getAttribute('aria-label') || '') + ' ' +
      (el.getAttribute('data-testid') || '') + ' ' +
      (el.getAttribute('class') || '') + ' ' +
      (el.getAttribute('role') || '')).toLowerCase();
    return /comment|feedback|message/.test(label);
  }

  function pointAtTextOffset(root, offset) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, used = 0, last = null;
    while ((n = walker.nextNode())) {
      last = n;
      var len = (n.nodeValue || '').length;
      if (used + len >= offset) return { node: n, offset: Math.max(0, offset - used) };
      used += len;
    }
    if (!last) { last = document.createTextNode(''); root.appendChild(last); }
    return { node: last, offset: (last.nodeValue || '').length };
  }

  function expandRichSnippet(editor, snippets) {
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return false;
    var caret = sel.getRangeAt(0);
    if (!caret.collapsed) return false;
    var before = document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(caret.endContainer, caret.endOffset);
    var prefix = before.toString();
    var hit = CGP.snippets.findTrigger(prefix, prefix.length);
    if (!hit) return false;
    var snip = CGP.snippets.lookup(hit.name, snippets);
    if (!snip) return false;
    var a = pointAtTextOffset(editor, hit.start);
    var b = pointAtTextOffset(editor, hit.end);
    var replace = document.createRange();
    replace.setStart(a.node, a.offset);
    replace.setEnd(b.node, b.offset);
    replace.deleteContents();
    var tn = document.createTextNode(snip.text);
    replace.insertNode(tn);
    var next = document.createRange();
    next.setStart(tn, tn.nodeValue.length);
    next.collapse(true);
    sel.removeAllRanges();
    sel.addRange(next);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: snip.text }));
    return true;
  }

  function expandTextareaSnippet(editor, snippets) {
    var out = CGP.snippets.expand(editor.value, editor.selectionStart, snippets);
    if (!out) return false;
    var proto = editor.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(editor, out.text); else editor.value = out.text;
    editor.setSelectionRange(out.caret, out.caret);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    return true;
  }

  function handleSnippetKeydown(e) {
    if (e.__cgpSnippetHandled || e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
    var editor = e.target && e.target.closest ? e.target.closest('textarea, input, [contenteditable="true"]') : null;
    if (!isCommentEditor(editor)) return false;
    var ok = editor.isContentEditable ? expandRichSnippet(editor, CGP.settings.values.snippets)
      : expandTextareaSnippet(editor, CGP.settings.values.snippets);
    if (!ok) return false;
    e.__cgpSnippetHandled = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    CGP.diag.bump(editor.isContentEditable ? 'snippet.expanded.rich' : 'snippet.expanded');
    return true;
  }

  function bindSnippetCapture() {
    if (CGP._snippetCaptureInstalled) return;
    CGP._snippetCaptureInstalled = true;
    document.addEventListener('keydown', handleSnippetKeydown, true);
  }

  // Install in every matching frame. Canvas can place a rich comment editor in
  // a same-origin/about:blank iframe; Manifest V3 injects this content script
  // into those frames, so /trigger + Tab still works there.
  bindSnippetCapture();

  function studentIdFromHash() {
    var hash = location.hash || '';
    var raw = hash.replace(/^#/, '');
    if (!raw) return null;
    try {
      var decoded = decodeURIComponent(raw);
      var m = /"student_id"\s*:\s*"?(\d+)"?/.exec(decoded);
      if (m) return m[1];
      var obj = JSON.parse(decoded);
      if (obj && obj.student_id) return String(obj.student_id);
    } catch (e) { /* fall through */ }
    var m2 = /student_id[^0-9]*(\d+)/.exec(raw);
    return m2 ? m2[1] : null;
  }

  function assignmentIdFromUrl() {
    var m = /[?&]assignment_id=(\d+)/.exec(location.search || '');
    return m ? m[1] : null;
  }

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function startSpeedGrader(courseId) {
    var settings = CGP.settings.values;
    document.documentElement.classList.add('cgp-speedgrader');

    var state = { key: null, textarea: null, pendingSubmit: null, confirmTimer: null, watching: false };
    bindSnippetCapture();

    function draftKey() {
      var studentId = studentIdFromHash();
      var assignmentId = assignmentIdFromUrl();
      if (!studentId || !assignmentId) return null;
      return ['cgp.draft', location.host, courseId || 'course', assignmentId, studentId].join(':');
    }

    // chrome.storage.local.set/remove return promises that can reject
    // asynchronously (quota pressure, "Extension context invalidated" during
    // an auto-update mid-session); a bare try/catch only ever caught a
    // SYNCHRONOUS throw, so a rejected save previously vanished silently -
    // CGP.diag.bump('draft.saved') fired unconditionally right after,
    // reporting success even when nothing was actually persisted. Warned
    // once per page load rather than every keystroke, so a genuine outage
    // does not spam the teacher while they are trying to finish grading.
    function warnSaveFailedOnce() {
      if (state.saveWarned) return;
      state.saveWarned = true;
      CGP.ui.error('Gradebook+ couldn’t save your draft comment just now. ' +
        'Copy your text somewhere safe before navigating away.');
    }

    function saveDraft(text) {
      if (!CGP.settings.values.speedgraderDrafts) return;
      var key = state.key;
      if (!key || typeof chrome === 'undefined' || !chrome.storage) return;
      var value = String(text || '');
      if (!value.trim()) { removeDraft(key); return; }
      var payload = {};
      payload[key] = { text: value, at: Date.now() };
      try {
        var result = chrome.storage.local.set(payload);
        CGP.diag.bump('draft.saved');
        if (result && typeof result.catch === 'function') {
          result.catch(function (e) {
            CGP.diag.error('draft.saveRejected', { message: String(e && e.message) });
            warnSaveFailedOnce();
          });
        }
      } catch (e) {
        CGP.diag.warn('draft.saveFailed');
        warnSaveFailedOnce();
      }
    }

    function removeDraft(key) {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      try {
        var result = chrome.storage.local.remove(key || state.key);
        if (result && typeof result.catch === 'function') {
          result.catch(function (e) { CGP.diag.warn('draft.removeFailed', { message: String(e && e.message) }); });
        }
      } catch (e) { /* ignore */ }
    }

    function inlineNote(textarea, message) {
      var parent = textarea.parentElement;
      var note = parent ? parent.querySelector('.cgp-draft-note') : null;
      if (!note) {
        note = document.createElement('div');
        note.className = 'cgp-draft-note';
        textarea.insertAdjacentElement('afterend', note);
      }
      note.textContent = message;
      note.classList.add('cgp-draft-note--on');
      setTimeout(function () { note.classList.remove('cgp-draft-note--on'); }, 4000);
    }

    function restoreDraft(textarea) {
      if (!CGP.settings.values.speedgraderDrafts) return;
      var key = state.key;
      if (!key || typeof chrome === 'undefined' || !chrome.storage) return;
      chrome.storage.local.get(key).then(function (got) {
        // A teacher clicking through students quickly is the ordinary case,
        // not an edge one: this read is async, and by the time it resolves
        // the student (and therefore which key/textarea a draft belongs to)
        // may have moved on again - Canvas can also reuse the same textarea
        // DOM node across students. Applying a stale result here landed one
        // student's saved draft in a DIFFERENT student's comment box, with
        // the "Unsent draft restored" note making it look legitimate.
        if (state.key !== key || state.textarea !== textarea) return;
        var box = got && got[key];
        if (!box || !box.text) return;
        if (String(textarea.value || '').trim()) return;   // never clobber live typing
        textarea.value = box.text;
        inlineNote(textarea, 'Unsent draft restored');
        CGP.diag.bump('draft.restored');
      }).catch(function () { /* ignore */ });
    }

    var save = CGP.util.debounce(function () {
      if (state.textarea) saveDraft(state.textarea.value);
    }, 400);

    function attach(textarea) {
      if (!textarea || textarea.dataset.cgpBound === '1') return;
      textarea.dataset.cgpBound = '1';
      state.textarea = textarea;
      state.key = draftKey();

      textarea.addEventListener('input', save);
      textarea.addEventListener('blur', function () { saveDraft(textarea.value); });
      textarea.addEventListener('keydown', handleSnippetKeydown, true);
      restoreDraft(textarea);
      CGP.diag.log('speedgrader.bound', { hasKey: !!state.key });
    }

    function watchSubmit() {
      document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(SUBMIT_SELECTORS) : null;
        if (!btn || !state.textarea) return;
        var text = String(state.textarea.value || '');
        if (!text.trim()) return;
        state.pendingSubmit = { text: text, key: state.key, at: Date.now() };
        saveDraft(text);
        if (state.confirmTimer) clearTimeout(state.confirmTimer);
        state.confirmTimer = setTimeout(function () {
          if (!state.pendingSubmit) return;
          CGP.diag.error('comment.unconfirmed');
          CGP.ui.error('Canvas did not confirm that comment. Your text is saved and will come back here.');
        }, 15000);
      }, true);
    }

    // Re-checked on every poll tick (see the setInterval below) rather than
    // attached once: this used to grab whichever #comments-shaped container
    // existed the FIRST time any textarea was found, and never looked again.
    // If Canvas replaces that whole panel element (rather than mutating it
    // in place) when switching submissions - plausible for a per-submission
    // feed - the observer went on watching a now-detached node forever.
    // Every later confirmation was then missed: removeDraft() never ran, so
    // an already-posted comment's local draft lingered and could be offered
    // back as "unsent" and resubmitted as a duplicate. Cheap to re-check
    // (one querySelector) and a no-op whenever the container has not changed.
    function watchConfirmation() {
      var container = document.querySelector(COMMENTS_SELECTORS) || document.body;
      if (state.confirmContainer === container && state.confirmObserver) return;
      if (state.confirmObserver) state.confirmObserver.disconnect();
      state.confirmContainer = container;
      state.confirmObserver = new MutationObserver(function () {
        if (!state.pendingSubmit) return;
        var target = normalize(state.pendingSubmit.text);
        if (!target) return;
        var host = document.querySelector(COMMENTS_SELECTORS);
        var body = normalize(host ? host.textContent : '');
        var probe = target.length > 60 ? target.slice(0, 60) : target;
        if (body.indexOf(probe) >= 0) {
          removeDraft(state.pendingSubmit.key);
          if (state.confirmTimer) clearTimeout(state.confirmTimer);
          state.pendingSubmit = null;
          CGP.diag.bump('comment.confirmed');
        }
      });
      state.confirmObserver.observe(container, { childList: true, subtree: true, characterData: true });
    }

    function onStudentChange() {
      // Deliberately NOT "if (state.textarea) saveDraft(state.textarea.value)"
      // here any more. This runs 250ms after the hash already changed, with
      // no guarantee Canvas has not already repopulated this same reused
      // textarea node for the NEW student by then - reading its value now
      // could be the new student's content, saved under the OLD student's
      // key (still in state.key at this point), silently overwriting or
      // deleting the old student's real draft. The blur listener attached in
      // attach() already saves the outgoing textarea's value at the correct
      // moment (navigating away blurs it first), and the debounced input
      // listener keeps storage caught up while still typing - both fire
      // before content could have changed, so nothing further is needed here.
      state.key = draftKey();
      var textarea = document.querySelector(TEXTAREA_SELECTORS) || findTextareaFallback();
      if (textarea) {
        state.textarea = textarea;
        if (!String(textarea.value || '').trim()) restoreDraft(textarea);
      }
      // Also re-checked here, not just from the polling loop below: that
      // loop stops itself after 60 seconds (it exists only to catch
      // SpeedGrader's own async initial load), while a real grading session
      // routinely runs for many minutes and switches students - via this
      // same hashchange - well past that window. Confined to the poll
      // alone, a comments panel Canvas replaces wholesale after the first
      // minute would never be re-attached to again for the rest of the
      // session: the exact stale-observer bug this was fixing, just
      // delayed instead of prevented.
      watchConfirmation();
    }

    window.addEventListener('hashchange', function () { setTimeout(onStudentChange, 250); });

    var poll = setInterval(function () {
      var textarea = document.querySelector(TEXTAREA_SELECTORS) || findTextareaFallback();
      if (textarea) {
        attach(textarea);
        // watchSubmit binds to document itself, once, and never needs
        // re-binding. watchConfirmation is cheap and re-checks/re-attaches
        // to whatever the CURRENT comments container is on every tick - see
        // its own comment for why that must not be a one-time thing.
        if (!state.watching) {
          state.watching = true;
          watchSubmit();
        }
        watchConfirmation();
      } else if (!state.sampledMiss) {
        state.sampledMiss = true;
        var all = Array.prototype.map.call(document.querySelectorAll('textarea'), function (t) {
          return { id: t.id || null, name: t.getAttribute('name'), className: t.className || null };
        });
        CGP.diag.warn('speedgrader.textareaNotFound', { visibleTextareas: all.length, samples: all.slice(0, 5) });
      }
    }, 700);
    setTimeout(function () { clearInterval(poll); }, 60000);
    void settings;
  }

  CGP.startSpeedGrader = startSpeedGrader;
})();
