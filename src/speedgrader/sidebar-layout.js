/* Canvas Gradebook+ - a tidier SpeedGrader sidebar.
 *
 * With `speedgraderTidyComments` on (html.cgp-sg-tidy), SpeedGrader's
 * right-hand panel becomes a grey panel of white cards - Submission,
 * Assessment, Comments - with small-caps headings, file rows, matching field
 * labels, comment bubbles and a quiet footer for Reassign / Download.
 *
 * Canvas's sidebar markup differs between Canvas versions and feature flags
 * (the ids in Canvas's open-source template are not all on every school's
 * page), so nothing here relies on its ids. The sections are found by what
 * they hold - "Submitted", "Assessment" / "Grade out of", the comment box -
 * and the cards are the children of the smallest box holding all of them.
 * Nodes are only tagged with data-cgp-sg-* attributes, which speedgrader.css
 * styles; nothing is moved, hidden or shown. Turning the setting off removes
 * every tag. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.SpeedGraderSidebarLayout) return;

  var SCAN_MS = 400;
  var TEXT_TAGS = 'h1, h2, h3, h4, h5, h6, label, legend, strong, b, span, div, p, dt, th';
  var MAX_TEXT = 80;

  var SUBMISSION_IDS = '#submission_details, #submission_files_container, #submission_word_count, #multiple_submissions';
  var SUBMISSION_TEXT = /^\s*(submitted(\s+files)?|word\s+count)\s*:/i;
  var ASSESSMENT_IDS = '#grading, #grade_container, #grading-box-extended';
  var ASSESSMENT_HEAD = /^\s*(assessment|grading|grade)\s*$/i;
  var ASSESSMENT_TEXT = /^\s*grade\s+out\s+of\b/i;
  var COMMENTS_IDS = '#add_a_comment, #speedgrader_comment_textarea_mount_point, #speed_grader_comment_textarea_mount_point, #comments, .cgp-sgbar';
  var COMMENTS_HEAD = /^\s*(assignment\s+comments|comments\s+for\s+this\s+attempt|submission\s+comments|comments)\s*$/i;
  var FIELD_LABEL = /^\s*(grade(\s+out\s+of\s+[\d.,]+)?|status|days|hours|late\s+penalty:?|final\s+grade:?|points)\s*$/i;
  var FOOT_TEXT = /^\s*(reassign\s+assignment|download\s+submission\s+comments)\s*$/i;
  var FILE_EXT = /\.(pdf|docx?|pptx?|xlsx?|png|jpe?g|gif|heic|txt|rtf|odt|pages|key|numbers|zip|mp[34]|mov|m4a|csv|html?)\s*$/i;

  var ATTRS = ['data-cgp-sg-panel', 'data-cgp-sg-card', 'data-cgp-sg-heading', 'data-cgp-sg-label',
    'data-cgp-sg-file', 'data-cgp-sg-foot'];

  function SpeedGraderSidebarLayout(ctx) {
    this.settings = ctx && ctx.settings;
    this.observer = null;
    this.timer = null;
  }

  var P = SpeedGraderSidebarLayout.prototype;

  P.enabled = function () {
    return !!(this.settings && this.settings.values && this.settings.values.speedgraderTidyComments);
  };

  P.start = function () {
    var self = this;
    this.apply();
    if (this.settings && typeof this.settings.onChange === 'function') {
      this.settings.onChange(function () { self.apply(); });
    }
  };

  P.apply = function () {
    if (this.enabled()) {
      document.documentElement.classList.add('cgp-sg-tidy');
      this.observe();
    } else {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      clearAll(document);
    }
  };

  P.observe = function () {
    var self = this;
    if (!this.observer && typeof MutationObserver !== 'undefined' && document.body) {
      // SpeedGrader redraws the panel on every student change.
      this.observer = new MutationObserver(function () {
        if (self.timer) return;
        self.timer = setTimeout(function () { self.timer = null; self.scan(); }, SCAN_MS);
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
    this.scan();
  };

  /** Tags the panel, its cards and what is in them. Safe to call often.
   * Returns the panel, or null when no sidebar is found. */
  P.scan = function () {
    if (!this.enabled()) return null;
    var found = findSections(document);
    if (!found) { clearAll(document); return null; }
    var panel = found.panel;
    // Tags left from a panel Canvas threw away, or a card that is no longer one.
    toArray(document.querySelectorAll('[data-cgp-sg-panel], [data-cgp-sg-card]')).forEach(function (el) {
      if (el !== panel && !found.cards.some(function (c) { return c.el === el; })) {
        el.removeAttribute('data-cgp-sg-panel');
        el.removeAttribute('data-cgp-sg-card');
      }
    });
    setAttr(panel, 'data-cgp-sg-panel', '');
    found.cards.forEach(function (c) {
      setAttr(c.el, 'data-cgp-sg-card', c.kind);
      if (c.heading && c.el.contains(c.heading)) setAttr(c.heading, 'data-cgp-sg-heading', '');
      if (c.kind === 'submission') tagFiles(c.el);
      if (c.kind === 'assessment') tagLabels(c.el);
    });
    tagFoot(panel, found.cards);
    return panel;
  };

  /* ------------------------------------------------------------ finding */

  function findSections(doc) {
    var texts = textElements(doc);
    var marks = {
      submission: firstOf(doc, SUBMISSION_IDS) || deepest(texts, function (t) { return SUBMISSION_TEXT.test(t); }),
      assessment: exact(texts, ASSESSMENT_HEAD) || firstOf(doc, ASSESSMENT_IDS) ||
        deepest(texts, function (t) { return ASSESSMENT_TEXT.test(t); }),
      comments: exact(texts, COMMENTS_HEAD) || firstOf(doc, COMMENTS_IDS)
    };
    var kinds = Object.keys(marks).filter(function (k) { return !!marks[k]; });
    if (kinds.length < 2) return null;
    var lca = commonAncestor(kinds.map(function (k) { return marks[k]; }));
    if (!lca || lca === doc.body || lca === doc.documentElement) return null;
    var cards = [];
    kinds.forEach(function (k) {
      var child = childOn(lca, marks[k]);
      if (!child) return;
      var other = cards.filter(function (c) { return c.el === child; })[0];
      if (other) { other.shared = true; return; }
      cards.push({ kind: k, el: child, heading: headingIn(child, k, texts) });
    });
    // Two sections in one child cannot be told apart as cards: leave it be.
    cards = cards.filter(function (c) { return !c.shared; });
    if (!cards.length) return null;
    return { panel: lca, cards: cards };
  }

  /** Elements with a short text of their own: few children, short text. */
  function textElements(doc) {
    return toArray(doc.querySelectorAll(TEXT_TAGS)).filter(function (el) {
      if (el.closest && el.closest('[data-cgp-sg-own], script, style, iframe')) return false;
      if (el.children && el.children.length > 4) return false;
      var t = String(el.textContent || '');
      return t.length > 0 && t.length <= MAX_TEXT;
    }).map(function (el) {
      return { el: el, text: String(el.textContent || '').replace(/\s+/g, ' ').trim() };
    });
  }

  /** The innermost element whose whole text matches `re` (an <h2> rather
   * than a <div> wrapped round just it). */
  function exact(texts, re) {
    return deepest(texts, function (t) { return re.test(t); });
  }

  /** The innermost element whose text passes `test`. */
  function deepest(texts, test) {
    var hits = texts.filter(function (t) { return test(t.text); }).map(function (t) { return t.el; });
    for (var i = 0; i < hits.length; i++) {
      var inner = hits.some(function (o) { return o !== hits[i] && hits[i].contains(o); });
      if (!inner) return hits[i];
    }
    return null;
  }

  function firstOf(doc, selector) {
    return doc.querySelector(selector);
  }

  function commonAncestor(nodes) {
    var first = nodes[0];
    var node = first.parentElement;
    while (node) {
      var all = true;
      for (var i = 1; i < nodes.length; i++) if (!node.contains(nodes[i])) { all = false; break; }
      if (all) return node;
      node = node.parentElement;
    }
    return null;
  }

  /** The child of `root` holding `node`. */
  function childOn(root, node) {
    var n = node;
    while (n && n.parentElement !== root) n = n.parentElement;
    return n || null;
  }

  function headingIn(card, kind, texts) {
    var re = kind === 'assessment' ? ASSESSMENT_HEAD : kind === 'comments' ? COMMENTS_HEAD : null;
    if (!re) return null;
    return deepest(texts.filter(function (t) { return card.contains(t.el); }), function (t) { return re.test(t); });
  }

  /* ------------------------------------------------------------ tagging */

  /** Each submitted file: its row (Canvas's .submission-file, or the box
   * around a link named like a file). */
  function tagFiles(card) {
    var rows = toArray(card.querySelectorAll('.submission-file')).filter(function (r) {
      return r.getAttribute('id') !== 'submission_file_hidden';
    });
    toArray(card.querySelectorAll('a')).forEach(function (a) {
      var name = String(a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!FILE_EXT.test(name) && !/(^|\s)display_name(\s|$)/.test(String(a.className || ''))) return;
      if (rows.some(function (r) { return r.contains(a); })) return;
      var row = a.closest('li') || a.parentElement;
      if (row && row !== card && rows.indexOf(row) < 0) rows.push(row);
    });
    rows.forEach(function (r) { setAttr(r, 'data-cgp-sg-file', ''); });
  }

  function tagLabels(card) {
    textElements(card).forEach(function (t) {
      if (FIELD_LABEL.test(t.text) && !ASSESSMENT_HEAD.test(t.text)) setAttr(t.el, 'data-cgp-sg-label', '');
    });
  }

  /** Reassign Assignment and Download Submission Comments: the box around
   * each, inside a card or loose in the panel. */
  function tagFoot(panel, cards) {
    toArray(panel.querySelectorAll('button, a, [role="button"]')).forEach(function (el) {
      if (!FOOT_TEXT.test(String(el.textContent || '').replace(/\s+/g, ' '))) return;
      var box = el;
      // Up to the outermost wrapper that holds just this control.
      while (box.parentElement && box.parentElement !== panel &&
             !cards.some(function (c) { return c.el === box.parentElement; }) &&
             box.parentElement.querySelectorAll('button, a, [role="button"], textarea, input, iframe').length === 1) {
        box = box.parentElement;
      }
      setAttr(box, 'data-cgp-sg-foot', '');
    });
  }

  function clearAll(doc) {
    var sel = ATTRS.map(function (a) { return '[' + a + ']'; }).join(', ');
    toArray(doc.querySelectorAll(sel)).forEach(function (el) {
      ATTRS.forEach(function (a) { el.removeAttribute(a); });
    });
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function toArray(list) { return Array.prototype.slice.call(list || []); }

  CGP.SpeedGraderSidebarLayout = SpeedGraderSidebarLayout;
})();
