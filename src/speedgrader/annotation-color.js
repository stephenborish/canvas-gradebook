/* Canvas Gradebook+ - red by default for Free Draw and Point annotations.
 *
 * Runs inside DocViewer, the frame SpeedGrader shows a submitted file in
 * (Canvas's annotation tools: point, highlight, text, strikeout, free draw,
 * area). Its colour palette starts on blue; with `annotationDefaultRed` on,
 * whenever a palette appears while the Free Draw or Point tool is the active
 * one, the red swatch is pressed for the teacher - through DocViewer's own
 * button, so DocViewer records the choice exactly as if it were clicked.
 *
 *  - Each palette is handled once (when it appears), so the teacher can
 *    still pick any other colour straight after.
 *  - A colour the teacher picks themselves for one of these tools is kept:
 *    that tool is left alone for the rest of the session in this tab.
 *  - Other tools (highlight, strikeout, text, area) are never touched.
 *
 * DocViewer's markup is not Canvas's and has no stable ids, so everything is
 * found by shape and meaning: the active tool is the toolbar button marked
 * pressed / checked / selected / active, named by its label; a palette is a
 * group of at least five small colour swatches, and red is the one labelled
 * "Red" or, failing a label, the one whose colour is red. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.AnnotationColorDefaults) return;

  var TOOL_PATTERNS = {
    freedraw: /free\s*-?\s*draw|free\s*hand|\bdraw(ing)?\b|\bpen\b|\binking?\b/i,
    point: /\bpoint\b|\bpin\b/i
  };
  // Never mistaken for free draw by the patterns above.
  var NOT_TOOLS = /highlight|strike|area|rectangle|text|select|eraser|zoom|rotate|download|fullscreen|expand/i;
  var RED_LABEL = /^\s*(red|rojo|roja|rouge|rot|rosso|vermelho|rood|czerwony|красный|红色?|赤)\s*$/i;
  var COLOR_LABEL = /^\s*(red|orange|yellow|gold|brown|green|blue|light\s*blue|cyan|teal|pink|magenta|purple|violet|black|gr[ae]y|white)\s*$/i;
  var SWATCH_SELECTOR = 'button, [role="radio"], [role="button"], [role="option"], [role="menuitemradio"], li, a';
  var SESSION_KEY = 'cgp.annotationColor.userChose';
  var SCAN_MS = 120;

  function AnnotationColorDefaults(ctx) {
    this.settings = ctx && ctx.settings;
    this.doc = (ctx && ctx.document) || document;
    this.handled = {};   // tool -> palettes already handled for it
    this.userChose = readSession();
    this.observer = null;
    this.timer = null;
    this.ourClick = false;
  }

  var P = AnnotationColorDefaults.prototype;

  P.enabled = function () {
    return !!(this.settings && this.settings.values && this.settings.values.annotationDefaultRed);
  };

  P.start = function () {
    var self = this;
    var doc = this.doc;
    // A swatch the teacher presses themselves: remember it for that tool.
    doc.addEventListener('click', function (e) { self.onClick(e); }, true);
    if (typeof MutationObserver !== 'undefined' && doc.body) {
      this.observer = new MutationObserver(function () { self.schedule(); });
      this.observer.observe(doc.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'class']
      });
    }
    this.scan();
  };

  P.schedule = function () {
    var self = this;
    if (this.timer) return;
    this.timer = setTimeout(function () { self.timer = null; self.scan(); }, SCAN_MS);
  };

  /* Per tool: a palette DocViewer keeps mounted while the teacher switches
   * from Free Draw to Point still gets red for Point. */
  P.isHandled = function (tool, palette) {
    return (this.handled[tool] || []).indexOf(palette) >= 0;
  };

  P.markHandled = function (tool, palette) {
    var list = this.handled[tool] || (this.handled[tool] = []);
    // Only the last few: a palette re-created on every open must not pile up.
    if (list.push(palette) > 8) list.shift();
  };

  /** Presses red in a newly shown palette, if one of our tools is active. */
  P.scan = function () {
    if (!this.enabled()) return false;
    var tool = activeTool(this.doc);
    if (!tool || this.userChose[tool]) return false;
    var palette = findPalette(this.doc);
    if (!palette || this.isHandled(tool, palette.root)) return false;
    this.markHandled(tool, palette.root);
    var red = palette.red;
    if (!red || isSelected(red)) return false;
    this.ourClick = true;
    try { red.click(); } finally { this.ourClick = false; }
    if (CGP.diag) CGP.diag.bump('annotation.redDefault.' + tool);
    return true;
  };

  P.onClick = function (e) {
    if (this.ourClick || !e || e.isTrusted === false) return;
    var target = e.target;
    if (!target || !target.closest) return;
    // Cheap test first: only a click on something swatch-like is worth the
    // full palette scan.
    var near = target.closest(SWATCH_SELECTOR);
    if (!near || !isSwatch(near)) return;
    var palette = findPalette(this.doc);
    if (!palette) return;
    var hit = null;
    palette.swatches.forEach(function (s) { if (s === target || s.contains(target)) hit = s; });
    if (!hit) return;
    var tool = activeTool(this.doc);
    if (!tool) return;
    this.userChose[tool] = true;
    writeSession(this.userChose);
  };

  /* ---------------------------------------------------------- the toolbar */

  /** 'freedraw', 'point', or null for any other (or no) active tool. */
  function activeTool(doc) {
    var candidates = toArray(doc.querySelectorAll(
      'button, [role="button"], [role="radio"], [role="tab"], [role="menuitemradio"], [role="option"]'));
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isActive(el)) continue;
      var label = labelOf(el);
      if (!label || NOT_TOOLS.test(label) || COLOR_LABEL.test(label)) continue;
      if (TOOL_PATTERNS.point.test(label)) return 'point';
      if (TOOL_PATTERNS.freedraw.test(label)) return 'freedraw';
    }
    return null;
  }

  function isActive(el) {
    var attrs = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v === 'true' || (attrs[i] === 'aria-current' && v && v !== 'false')) return true;
    }
    var cls = ' ' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '')) + ' ';
    return /[\s_-](active|selected|is-active|isactive|current|on)[\s_-]/i.test(cls.replace(/--/g, '-'));
  }

  function labelOf(el) {
    var t = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
    if (!t) {
      var by = el.getAttribute('aria-labelledby');
      var ref = by && el.ownerDocument && el.ownerDocument.getElementById ? el.ownerDocument.getElementById(by.split(/\s+/)[0]) : null;
      t = ref ? String(ref.textContent || '') : String(el.textContent || '');
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  /* ----------------------------------------------------------- the palette */

  /* A palette: the smallest container holding at least five colour swatches
   * side by side (siblings). Returns { root, swatches, red } or null. */
  function findPalette(doc) {
    var groups = [];
    var seen = [];
    toArray(doc.querySelectorAll(SWATCH_SELECTOR)).forEach(function (el) {
      if (!isSwatch(el)) return;
      var parent = el.parentElement;
      if (!parent) return;
      var at = seen.indexOf(parent);
      if (at < 0) { seen.push(parent); groups.push({ root: parent, swatches: [el] }); }
      else groups[at].swatches.push(el);
    });
    var best = null;
    groups.forEach(function (g) {
      if (g.swatches.length < 5) return;
      if (!best || g.swatches.length > best.swatches.length) best = g;
    });
    if (!best) return null;
    var red = null;
    best.swatches.forEach(function (s) { if (!red && RED_LABEL.test(labelOf(s))) red = s; });
    if (!red) best.swatches.forEach(function (s) { if (!red && isRed(swatchColor(s))) red = s; });
    best.red = red;
    return best;
  }

  /** A colour swatch: labelled with a colour name, or a small square-ish
   * control painted in one. */
  function isSwatch(el) {
    var label = labelOf(el);
    if (COLOR_LABEL.test(label) || RED_LABEL.test(label)) return true;
    if (label && label.length > 2 && !/^#|^rgb/i.test(label)) return false;
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r || r.width < 10 || r.height < 10 || r.width > 56 || r.height > 56) return false;
    if (Math.abs(r.width - r.height) > Math.max(r.width, r.height) * 0.5) return false;
    return !!parseColor(swatchColor(el));
  }

  /** The colour a swatch shows: its own background, or the first painted
   * thing inside it (a dot in a ring), or an svg fill. */
  function swatchColor(el) {
    var nodes = [el].concat(toArray(el.querySelectorAll('*')).slice(0, 6));
    for (var i = 0; i < nodes.length; i++) {
      var c = paintOf(nodes[i]);
      if (parseColor(c)) return c;
    }
    return '';
  }

  function paintOf(el) {
    var inline = el.style ? (el.style.backgroundColor || el.style.fill || '') : '';
    if (inline && parseColor(inline)) return inline;
    var attr = el.getAttribute && (el.getAttribute('fill') || el.getAttribute('data-color'));
    if (attr && parseColor(attr)) return attr;
    if (typeof getComputedStyle === 'function') {
      try {
        var cs = getComputedStyle(el);
        if (cs && cs.backgroundColor && parseColor(cs.backgroundColor)) return cs.backgroundColor;
        if (cs && cs.fill && String(el.tagName).toLowerCase() !== 'svg' && parseColor(cs.fill)) return cs.fill;
      } catch (e) { /* not stylable */ }
    }
    return '';
  }

  function isSelected(el) {
    return isActive(el) || !!(el.querySelector && el.querySelector('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]'));
  }

  /* ---------------------------------------------------------------- colour */

  /** [r, g, b] for a visible, non-transparent colour; null otherwise. */
  function parseColor(c) {
    var s = String(c || '').trim().toLowerCase();
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      return [+m[1], +m[2], +m[3]];
    }
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (m) {
      var hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    if (s === 'red') return [255, 0, 0];
    return null;
  }

  /** A strong red: hue within 15° of red, saturated, neither dark nor pale. */
  function isRed(c) {
    var rgb = parseColor(c);
    if (!rgb) return false;
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    if (d < 0.25 || max !== r) return false;
    var l = (max + min) / 2;
    var sat = d / (1 - Math.abs(2 * l - 1));
    var h = ((g - b) / d) % 6 * 60;
    if (h < 0) h += 360;
    return (h <= 15 || h >= 345) && sat >= 0.55 && l >= 0.25 && l <= 0.7;
  }

  /* --------------------------------------------------------------- helpers */

  function readSession() {
    try {
      var raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
      var v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  function writeSession(v) {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch (e) { /* blocked */ }
  }

  function toArray(list) { return Array.prototype.slice.call(list || []); }

  CGP.AnnotationColorDefaults = AnnotationColorDefaults;
  CGP.annotationColor = { activeTool: activeTool, findPalette: findPalette, isRed: isRed };

  // Boot: only in a page that is DocViewer (a palette or annotation toolbar
  // shows up); elsewhere the observer simply never finds one.
  if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage && CGP.settings &&
      !globalThis.__cgpAnnotationTest) {
    CGP.settings.load().then(function () {
      new AnnotationColorDefaults({ settings: CGP.settings }).start();
    }, function () { /* no settings, no defaults */ });
  }
})();
