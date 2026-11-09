/* Canvas Gradebook+ - a tidier SpeedGrader comment box.
 *
 * SpeedGrader's comment box is a tall rich-text editor whose formatting
 * buttons hide behind a "more" button, a status bar under it, and a loose,
 * ragged row of small icons (attach a file, record or upload media, speech
 * to text) with Submit Comment dropped onto a line of its own. With
 * `speedgraderTidyComments` on it becomes one composer card:
 *
 *  - the editor gets the Grade Detail Tray's treatment (tray-layout.js): its
 *    formatting buttons always on show, no status bar, a short editing area
 *    that grows with the text down to the bottom of the window;
 *  - joined to the bottom of the editor, a footer bar of our own (SgBar):
 *    the comment tools as one group of matching icon buttons on the left,
 *    Submit Comment on the right, all on one line, all the same height.
 *
 * Canvas's own tools and Submit button stay on the page, hidden, and every
 * press of ours goes through them - Canvas does exactly what it would have
 * done (open its media recorder, add a file field, post the comment). As in
 * the tray, nothing of Canvas's is moved: nodes are only tagged with
 * data-cgp-* attributes and styled while html.cgp-sg-tidy is on; the bar is
 * a node of our own, placed right after the editor's mount point. Turning
 * the setting off removes the bar and drops the class, which puts
 * SpeedGrader back as Canvas draws it. */
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
    this.bar = null;
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
      if (this.bar) this.bar.destroy();
      this.bar = null;
      if (this.row && this.row.isConnected) clearRow(this.row);
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
      // Canvas shows / hides its tools and disables Submit by attribute and
      // inline style, which the childList observer never reports.
      if (self.bar && self.row) self.bar.sync();
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
    if (row && rce) {
      if (!this.bar) this.bar = new SgBar();
      this.bar.attach({ rce: rce, row: row, submit: submit });
    } else if (this.bar) {
      this.bar.detach();
    }
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

  /** Room to keep under the editor: our footer bar (or Canvas's row). */
  P.gapBelow = function () {
    var row = this.bar && this.bar.root && this.bar.root.isConnected ? this.bar.root : this.row;
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
      // Never our own footer's Submit, which stands in for Canvas's.
      if (buttons[i].closest && buttons[i].closest('[data-cgp-sg-own]')) continue;
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
      // A control inside another control (an icon link in a button) is
      // part of that one.
      var outer = el.parentElement && el.parentElement.closest &&
        el.parentElement.closest('button, a[href], a[role="button"], [role="button"], label[for]');
      if (outer && row.contains(outer)) return;
      setAttr(el, 'data-cgp-sg-tool', '');
    });
  }

  function clearRow(row) {
    row.removeAttribute('data-cgp-sg-actions');
    row.removeAttribute('data-cgp-sg-proxied');
    toArray(row.querySelectorAll('[data-cgp-sg-tool], [data-cgp-sg-submit], [data-cgp-sg-proxied]')).forEach(function (el) {
      el.removeAttribute('data-cgp-sg-tool');
      el.removeAttribute('data-cgp-sg-submit');
      el.removeAttribute('data-cgp-sg-proxied');
    });
  }

  /* ------------------------------------------------------- the footer bar */

  /* Kinds of comment tool, told by id, class, icon and label; each gets one
   * of our icons so the group reads as one set. Anything else keeps a copy
   * of Canvas's own icon. */
  var TOOL_KINDS = [
    { kind: 'attach', test: /attach|paperclip|\bfile\b|upload/i, label: 'Attach a file',
      icon: 'M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5.8a3 3 0 0 1 6 0v9.7a1.5 1.5 0 0 1-3 0V6.5h-1.5v9a3 3 0 0 0 6 0V5.8a4.5 4.5 0 0 0-9 0v10.7a6 6 0 0 0 12 0v-10z' },
    { kind: 'screen', test: /screen/i, label: 'Record your screen',
      icon: 'M3 5h18v11H3zm2 2v7h14V7zM8 18h8v2H8zM4 3h3v1.5H5.5V6H4zm16 0v3h-1.5V4.5H17V3z' },
    { kind: 'speech', test: /speech|dictat|microphone|\bvoice\b|\baudio\b/i, label: 'Speech to text',
      icon: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-1.2 3v6a1.2 1.2 0 0 0 2.4 0V6a1.2 1.2 0 0 0-2.4 0zM6 11h1.8a4.2 4.2 0 0 0 8.4 0H18a6 6 0 0 1-5.1 5.9V20H16v1.5H8V20h3.1v-3.1A6 6 0 0 1 6 11z' },
    { kind: 'media', test: /media|video|record|camera/i, label: 'Record or upload media',
      icon: 'M3 6.5h12a1.5 1.5 0 0 1 1.5 1.5v1.8L21 7v10l-4.5-2.8V16a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 16V8A1.5 1.5 0 0 1 3 6.5zm.3 1.8v7.4h11.4V8.3z' }
  ];
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function toolKind(el) {
    var icon = el.querySelector ? el.querySelector('i, svg, img') : null;
    var hay = [el.getAttribute('id'), classOf(el), icon ? classOf(icon) : '', el.getAttribute('aria-label'),
      el.getAttribute('title'), el.getAttribute('data-testid'), textOf(el)].join(' ');
    for (var i = 0; i < TOOL_KINDS.length; i++) if (TOOL_KINDS[i].test.test(hay)) return TOOL_KINDS[i];
    return null;
  }

  function labelOf(el) {
    return String(el.getAttribute('aria-label') || el.getAttribute('title') || textOf(el) || '').replace(/\s+/g, ' ').trim();
  }

  /** Shown by Canvas: no [hidden], no inline display:none, no hiding class,
   * on it or a wrapper up to `stop`. Our own hiding does not count. */
  function canvasShows(el, stop) {
    var node = el;
    while (node && node !== stop && node.getAttribute) {
      if (node.getAttribute('hidden') !== null) return false;
      if (node.style && String(node.style.display || '') === 'none') return false;
      if (node.style && String(node.style.visibility || '') === 'hidden') return false;
      if (/(^|\s)(hidden|hide|screenreader-only|ui-helper-hidden)(\s|$)/.test(classOf(node))) return false;
      node = node.parentElement;
    }
    return true;
  }

  function isOff(el) {
    return !!el.disabled || el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true';
  }

  function svgIcon(d) {
    if (typeof document.createElementNS !== 'function') return null;
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(path);
    return svg;
  }

  /* Our footer bar under the editor: Canvas's comment tools as one group of
   * icon buttons, Submit Comment on the right. Each button presses Canvas's
   * own; Canvas's row is hidden while the bar stands in for it. */
  function SgBar() {
    this.root = null;
    this.tools = null;
    this.submitBtn = null;
    this.anchor = null;
    this.row = null;
    this.submit = null;
    this.sig = '';
    this.toolNodes = [];   // the Canvas controls the tool buttons press
  }

  var B = SgBar.prototype;

  B.build = function () {
    var root = document.createElement('div');
    root.className = 'cgp-sgbar';
    root.setAttribute('data-cgp-sg-own', '');
    var tools = document.createElement('div');
    tools.className = 'cgp-sgbar__tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Comment tools');
    var submit = document.createElement('button');
    submit.setAttribute('type', 'button');
    submit.className = 'cgp-sgbar__submit';
    var self = this;
    submit.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var c = self.submit;
      if (!c || !c.isConnected || isOff(c)) return;
      c.click();
    });
    root.appendChild(tools);
    root.appendChild(submit);
    this.root = root;
    this.tools = tools;
    this.submitBtn = submit;
  };

  /** Shows the bar for this editor and row. Cheap to call often. */
  B.attach = function (o) {
    if (!this.root) this.build();
    var anchor = anchorFor(o.rce, o.row);
    if (!anchor || !anchor.parentElement) { this.detach(); return false; }
    if (this.anchor && this.anchor !== anchor) this.anchor.removeAttribute('data-cgp-sg-composer');
    if (this.row && this.row !== o.row) unproxy(this.row);
    this.anchor = anchor;
    this.row = o.row;
    this.submit = o.submit;
    setAttr(anchor, 'data-cgp-sg-composer', '');
    if (anchor.nextSibling !== this.root || this.root.parentElement !== anchor.parentElement) {
      anchor.parentElement.insertBefore(this.root, anchor.nextSibling);
    }
    this.sync();
    return true;
  };

  /** Re-reads Canvas's tools and Submit and redraws whatever changed. */
  B.sync = function () {
    if (!this.root || !this.row || !this.submit) return;
    var row = this.row;
    var submit = this.submit;
    var tools = toArray(row.querySelectorAll('[data-cgp-sg-tool]')).filter(function (el) {
      return canvasShows(el, row);
    });
    var label = String(textOf(submit) || submit.getAttribute('value') || '').replace(/\s+/g, ' ').trim() || 'Submit Comment';
    var sig = tools.map(function (t) {
      return (t.getAttribute('id') || '') + '|' + labelOf(t) + '|' + (isOff(t) ? 1 : 0) + '|' + classOf(t);
    }).join('\u0001') + '\u0002' + label + '|' + (isOff(submit) ? 1 : 0);
    // Canvas's whole row is hidden only when it holds nothing but the
    // controls the bar stands in for; otherwise just those controls are.
    proxyRow(row, submit);
    // Canvas may swap in new nodes that look the same: the buttons must
    // press the controls on the page now, not the ones it threw away.
    var same = tools.length === this.toolNodes.length &&
      tools.every(function (t, i) { return t === this.toolNodes[i]; }, this);
    if (sig === this.sig && same && this.root.isConnected) return;
    this.sig = sig;
    this.toolNodes = tools;
    this.renderTools(tools);
    if (this.submitBtn.textContent !== label) this.submitBtn.textContent = label;
    var off = isOff(submit);
    this.submitBtn.disabled = off;
    if (off) setAttr(this.submitBtn, 'disabled', ''); else this.submitBtn.removeAttribute('disabled');
  };

  B.renderTools = function (tools) {
    var box = this.tools;
    while (box.children.length) box.removeChild(box.children[0]);
    tools.forEach(function (canvas) {
      var kind = toolKind(canvas);
      var b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.className = 'cgp-sgbar__tool';
      var label = labelOf(canvas) || (kind && kind.label) || 'Comment tool';
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      if (kind) b.setAttribute('data-kind', kind.kind);
      var icon = kind ? svgIcon(kind.icon) : null;
      if (!icon) {
        var own = canvas.querySelector && canvas.querySelector('i, svg');
        icon = own ? own.cloneNode(true) : null;
      }
      if (icon) b.appendChild(icon);
      else {
        var t = document.createElement('span');
        t.className = 'cgp-sgbar__tool-txt';
        t.textContent = label;
        b.appendChild(t);
      }
      if (isOff(canvas)) { b.disabled = true; b.setAttribute('disabled', ''); }
      b.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!canvas.isConnected || isOff(canvas)) return;
        canvas.click();
      });
      box.appendChild(b);
    });
    if (tools.length) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
  };

  B.detach = function () {
    if (this.root) this.root.remove();
    if (this.anchor) this.anchor.removeAttribute('data-cgp-sg-composer');
    if (this.row) unproxy(this.row);
    this.anchor = this.row = this.submit = null;
    this.sig = '';
    this.toolNodes = [];
  };

  B.destroy = function () {
    this.detach();
    this.root = this.tools = this.submitBtn = null;
  };

  /* Where the bar goes: right after the editor's mount point when that
   * holds the editor but not Canvas's row (so the bar never lands inside
   * React's mount), else right after the editor itself. */
  function anchorFor(rce, row) {
    var mount = rce.closest ? rce.closest(MOUNT_SELECTOR) : null;
    if (mount && mount !== rce && !mount.contains(row) && !row.contains(mount)) return mount;
    if (rce.parentElement && !rce.contains(row)) return rce;
    return null;
  }

  function proxyRow(row, submit) {
    var controls = toArray(row.querySelectorAll('[data-cgp-sg-tool]')).concat([submit]);
    // Anything else in the row that shows or takes input: a file field,
    // an attachment list, a text, another control.
    var other = toArray(row.querySelectorAll('input, select, textarea, button, a[href], [role="button"], img, video, audio, li'))
      .filter(function (el) {
        if ((el.getAttribute('type') || '').toLowerCase() === 'hidden') return false;
        return !controls.some(function (c) { return c === el || c.contains(el); });
      });
    var loose = toArray(row.querySelectorAll('*')).some(function (el) {
      if (el.children.length) return false;
      if (controls.some(function (c) { return c === el || c.contains(el); })) return false;
      return /\S/.test(String(el.textContent || '')) && canvasShows(el, row);
    });
    if (!other.length && !loose) {
      setAttr(row, 'data-cgp-sg-proxied', '');
      return;
    }
    row.removeAttribute('data-cgp-sg-proxied');
    controls.forEach(function (c) { setAttr(c, 'data-cgp-sg-proxied', ''); });
  }

  function unproxy(row) {
    row.removeAttribute('data-cgp-sg-proxied');
    toArray(row.querySelectorAll('[data-cgp-sg-proxied]')).forEach(function (el) { el.removeAttribute('data-cgp-sg-proxied'); });
  }

  function classOf(el) {
    var c = el && el.className;
    if (c && typeof c === 'object' && c.baseVal !== undefined) c = c.baseVal;
    return String(c || '');
  }

  function textOf(el) {
    return el ? String(el.textContent || '') : '';
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function toArray(list) { return Array.prototype.slice.call(list || []); }

  CGP.SpeedGraderCommentLayout = SpeedGraderCommentLayout;
  CGP.SpeedGraderCommentBar = SgBar;
})();
