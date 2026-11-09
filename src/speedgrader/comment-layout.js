/* Canvas Gradebook+ - a tidier SpeedGrader comment box.
 *
 * SpeedGrader's comment box is a tall rich-text editor whose formatting
 * buttons hide behind a "more" button, a status bar under it, and a loose row
 * of small icons (attach a file, record or upload media, speech to text)
 * beside Submit Comment. With `speedgraderTidyComments` on it gets the same
 * treatment as the Grade Detail Tray's comment box (tray-layout.js):
 *
 *  - the editor is one rounded card, its formatting buttons always on show
 *    and wrapping (bold, italic, colour, links, IMAGES, lists, the EQUATION
 *    editor...; the "more" button now holds only the Paragraph menu);
 *  - its status bar (element path, word count, keyboard and accessibility
 *    buttons) is hidden;
 *  - it starts short and grows with the text until it reaches the bottom of
 *    the window - leaving room for the row under it - then scrolls inside;
 *  - the row under it becomes one tidy bar: Canvas's attach, media
 *    (video / audio) and speech buttons as clear, evenly sized icon buttons
 *    on the left, Submit Comment larger on the right. Every one of them is
 *    Canvas's own control, untouched - only restyled.
 *
 * As in the tray, nothing of Canvas's is moved or removed: nodes are only
 * tagged with data-cgp-* attributes and styled while html.cgp-sg-tidy is on.
 * Turning the setting off drops the class, which puts SpeedGrader back as
 * Canvas draws it. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.SpeedGraderCommentLayout) return;

  var ROOT_CLASS = 'cgp-sg-tidy';
  var MOUNT_SELECTOR = '#speedgrader_comment_textarea_mount_point, #speed_grader_comment_textarea_mount_point, #add_a_comment';
  // Canvas's comment tools beside Submit: attach a file, media comment
  // (record / upload video or audio), screen capture, speech to text.
  var TOOL_HINT = '#add_attachment, #media_comment_button, #screen_capture_button, [id*="speech" i], ' +
    '[class*="speech" i], .icon-paperclip, .icon-media, .icon-audio, .icon-video, .icon-microphone, ' +
    '[class*="attach" i] button, [aria-label*="attach" i], [aria-label*="media" i], [title*="attach" i], [title*="media" i]';
  var SCAN_MS = 250;
  var GROW_MS = 400;

  function SpeedGraderCommentLayout(ctx) {
    this.settings = ctx.settings;
    this.observer = null;
    this.scanTimer = null;
    this.growTimer = null;
    this.grow = null;
    this.rce = null;
    this.row = null;
  }

  var P = SpeedGraderCommentLayout.prototype;

  P.start = function () {
    var self = this;
    this.apply();
    if (this.settings && typeof this.settings.onChange === 'function') {
      this.settings.onChange(function () { self.apply(); });
    }
  };

  P.enabled = function () {
    return !!(this.settings && this.settings.values && this.settings.values.speedgraderTidyComments);
  };

  P.apply = function () {
    var on = this.enabled();
    document.documentElement.classList.toggle(ROOT_CLASS, on);
    if (on) {
      this.observe();
      this.startGrowing();
    } else {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      if (this.growTimer) clearInterval(this.growTimer);
      this.growTimer = null;
      if (this.grow) this.grow.destroy();
      this.grow = null;
      this.rce = this.row = null;
    }
  };

  P.observe = function () {
    var self = this;
    if (!this.observer && typeof MutationObserver !== 'undefined' && document.body) {
      // SpeedGrader re-renders the comment box on every student change.
      this.observer = new MutationObserver(function () {
        if (self.scanTimer) return;
        self.scanTimer = setTimeout(function () { self.scanTimer = null; self.scan(); }, SCAN_MS);
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
    this.scan();
  };

  /* Text typed, a snippet expanded, the box emptied after Submit: the
   * height follows on a light timer as well as on each keystroke. */
  P.startGrowing = function () {
    var self = this;
    if (this.growTimer) return;
    this.growTimer = setInterval(function () {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (self.grow) self.grow.update();
    }, GROW_MS);
    if (this.growTimer && typeof this.growTimer.unref === 'function') this.growTimer.unref();
  };

  /** Tags the comment editor and its button row. Safe to call repeatedly. */
  P.scan = function () {
    if (!this.enabled()) return false;
    var parts = CGP.trayCommentParts;
    if (!parts) return false;
    var submit = findSubmit();
    var rce = findRce(submit, parts);
    if (rce) {
      setAttr(rce, 'data-cgp-tray-rce', '');
      if (!rce.querySelector('[data-cgp-tray-hide]') && !parts.tagStatusBar(rce)) parts.tagWordCount(rce);
    }
    var row = submit ? rowFor(submit, rce) : null;
    if (this.row && this.row !== row && this.row.isConnected) clearRow(this.row);
    if (row) tagRow(row, submit);
    this.row = row;
    if (rce !== this.rce) {
      this.rce = rce;
      if (!this.grow) {
        var self = this;
        this.grow = new parts.CommentGrow({ gap: function () { return self.gapBelow(); } });
      }
    }
    if (this.grow) this.grow.watch(rce || null);
    return !!rce;
  };

  /** Room to keep under the editor: the attach / record / Submit row. */
  P.gapBelow = function () {
    var row = this.row;
    if (!row || !row.isConnected || !row.getBoundingClientRect) return 16;
    return Math.ceil(row.getBoundingClientRect().height || 0) + 24;
  };

  function findSubmit() {
    // The list lives with the draft code (speedgrader/content.js), read at
    // call time since that file loads after this one.
    var btn = CGP.SPEEDGRADER_SUBMIT_SELECTOR ? document.querySelector(CGP.SPEEDGRADER_SUBMIT_SELECTOR) : null;
    if (btn) return btn;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (/^\s*submit comment\s*$/i.test(buttons[i].textContent || '')) return buttons[i];
    }
    return null;
  }

  /* The comment editor: inside Canvas's comment mount point, or else the RCE
   * nearest above Submit Comment (the one sharing its form). */
  function findRce(submit, parts) {
    var sel = parts.RCE_SELECTOR;
    var mounts = document.querySelectorAll(MOUNT_SELECTOR);
    for (var i = 0; i < mounts.length; i++) {
      var inMount = mounts[i].querySelector(sel);
      if (inMount) return parts.outermostRce(inMount, mounts[i].parentElement || document.body);
    }
    var node = submit && submit.parentElement;
    while (node && node !== document.body) {
      var found = node.querySelector(sel);
      if (found) return parts.outermostRce(found, node);
      node = node.parentElement;
    }
    return null;
  }

  /* The row of comment tools around Submit: the smallest ancestor of the
   * button that also holds Canvas's attach / media / speech controls, as
   * long as it does not hold the editor too; else Submit's own parent. */
  function rowFor(submit, rce) {
    var row = submit.parentElement;
    var node = row;
    for (var depth = 0; node && depth < 4 && node !== document.body; depth++) {
      if (rce && node.contains(rce)) break;
      if (node.querySelector(TOOL_HINT)) return node;
      node = node.parentElement;
    }
    // Submit sitting loose beside the editor: no row of its own to restyle.
    return rce && row && row.contains(rce) ? null : row;
  }

  function tagRow(row, submit) {
    setAttr(row, 'data-cgp-sg-actions', '');
    setAttr(submit, 'data-cgp-sg-submit', '');
    toArray(row.querySelectorAll('button, a[href], a[role="button"], [role="button"], label[for]')).forEach(function (el) {
      if (el === submit || submit.contains(el) || el.contains(submit)) return;
      setAttr(el, 'data-cgp-sg-tool', '');
    });
  }

  function clearRow(row) {
    row.removeAttribute('data-cgp-sg-actions');
    toArray(row.querySelectorAll('[data-cgp-sg-tool], [data-cgp-sg-submit]')).forEach(function (el) {
      el.removeAttribute('data-cgp-sg-tool');
      el.removeAttribute('data-cgp-sg-submit');
    });
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function toArray(list) { return Array.prototype.slice.call(list || []); }

  CGP.SpeedGraderCommentLayout = SpeedGraderCommentLayout;
})();
