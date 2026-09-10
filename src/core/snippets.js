/* Canvas Gradebook+ - pure snippet expansion.
 * Type /trigger then press Tab. No snippet toolbar anywhere. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.snippets) return;

  function findTrigger(text, caret) {
    var s = String(text === null || text === undefined ? '' : text);
    var pos = Math.max(0, Math.min(Number(caret) || 0, s.length));
    var before = s.slice(0, pos);
    var m = /\/([A-Za-z0-9_-]+)$/.exec(before);
    if (!m) return null;
    return { start: pos - m[0].length, end: pos, name: m[1] };
  }

  function lookup(name, snippets) {
    var key = String(name || '').toLowerCase();
    var list = Array.isArray(snippets) ? snippets : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].trigger || '').toLowerCase() === key) return list[i];
    }
    return null;
  }

  /** Returns {text, caret, snippet} or null when nothing matched. */
  function expand(text, caret, snippets) {
    var hit = findTrigger(text, caret);
    if (!hit) return null;
    var snip = lookup(hit.name, snippets);
    if (!snip) return null;
    var s = String(text);
    var next = s.slice(0, hit.start) + snip.text + s.slice(hit.end);
    return { text: next, caret: hit.start + snip.text.length, snippet: snip };
  }

  CGP.snippets = { findTrigger: findTrigger, lookup: lookup, expand: expand };
})();
