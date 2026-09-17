/* Canvas Gradebook+ - minimal fake DOM for tests.
 *
 * The gradebook/*.js controllers (dom-adapter.js, layout.js, frozen-total.js,
 * content.js) are DOM-dependent in a way the core modules deliberately are
 * not (see harness.js's own header comment), so they were never exercised by
 * `node tests/run.js` at all. This is not a full jsdom - just enough of
 * Element/Document to run the small, pure-structural parts of those files
 * that matter for the frozen-Total / Test-Student-row bugs: classList, a
 * `style` with setProperty/getPropertyValue/removeProperty AND plain dotted
 * access (both are used across the real code), attributes, a real (if very
 * small) CSS selector engine covering exactly the selector shapes those
 * files actually use (tag/class/attribute compounds, descendant and direct-
 * child combinators, comma lists, and `:scope`), and getBoundingClientRect()
 * backed by a rect a test sets directly.
 *
 * Deliberately NOT implemented: events, layout/reflow, anything CSSOM-real.
 * Nothing here needs them. */
'use strict';

function toCamel(name) {
  return String(name).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
}

/* ------------------------------------------------------------- selectors */

function parseAttr(body) {
  var m = /^([-\w]+)\s*([*^$]?=)?\s*"?([^"]*)"?$/.exec(body.trim());
  return { name: m[1], op: m[2] || null, value: m[3] || '' };
}

function compileCompound(tok) {
  if (tok === ':scope') return { scope: true, tag: null, id: null, classes: [], attrs: [] };
  var rest = tok;
  var tag = null;
  var m = /^[A-Za-z][A-Za-z0-9]*/.exec(rest);
  if (m) { tag = m[0].toLowerCase(); rest = rest.slice(m[0].length); }
  var id = null;
  var classes = [];
  var attrs = [];
  var re = /#([-\w]+)|\.([-\w]+)|\[([^\]]+)\]/g;
  var mm;
  while ((mm = re.exec(rest))) {
    if (mm[1]) id = mm[1];
    else if (mm[2]) classes.push(mm[2]);
    else if (mm[3]) attrs.push(parseAttr(mm[3]));
  }
  return { scope: false, tag: tag, id: id, classes: classes, attrs: attrs };
}

function tokenize(sel) {
  var parts = sel.trim().split(/\s+/).filter(Boolean);
  var out = [];
  var pendingCombinator = null;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '>') { pendingCombinator = '>'; continue; }
    out.push({ combinator: out.length === 0 ? null : (pendingCombinator || ' '), compound: compileCompound(parts[i]) });
    pendingCombinator = null;
  }
  return out;
}

function matchesCompound(el, comp, scopeEl) {
  if (!el || el.nodeType !== 1) return false;
  if (comp.scope) return el === scopeEl;
  if (comp.tag && el.tagName.toLowerCase() !== comp.tag) return false;
  if (comp.id && el.getAttribute('id') !== comp.id) return false;
  for (var i = 0; i < comp.classes.length; i++) {
    if (!el.classList.contains(comp.classes[i])) return false;
  }
  for (var j = 0; j < comp.attrs.length; j++) {
    var at = comp.attrs[j];
    var val = el.getAttribute(at.name);
    if (val === null || val === undefined) return false;
    if (at.op === '*=') { if (String(val).toLowerCase().indexOf(String(at.value).toLowerCase()) < 0) return false; }
    else if (at.op === '=') { if (String(val) !== at.value) return false; }
  }
  return true;
}

function matchesSeq(el, seq, scopeEl) {
  var i = seq.length - 1;
  if (!matchesCompound(el, seq[i].compound, scopeEl)) return false;
  var current = el;
  for (i = seq.length - 1; i >= 1; i--) {
    var combinator = seq[i].combinator;
    var ancestorCompound = seq[i - 1].compound;
    if (combinator === '>') {
      current = current.parentElement;
      if (!current || !matchesCompound(current, ancestorCompound, scopeEl)) return false;
    } else {
      var p = current.parentElement;
      var found = false;
      while (p) {
        if (matchesCompound(p, ancestorCompound, scopeEl)) { found = true; current = p; break; }
        p = p.parentElement;
      }
      if (!found) return false;
    }
  }
  return true;
}

function compileSelectorList(selectorList) {
  return selectorList.split(',').map(function (s) { return tokenize(s.trim()); });
}

function matchesSelectorList(el, compiledList, scopeEl) {
  for (var i = 0; i < compiledList.length; i++) {
    if (matchesSeq(el, compiledList[i], scopeEl)) return true;
  }
  return false;
}

function walk(root, visit) {
  var stack = root.children.slice().reverse();
  while (stack.length) {
    var el = stack.pop();
    visit(el);
    for (var i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
  }
}

/* ------------------------------------------------------------- classList */

function ClassList(el) { this._el = el; }
ClassList.prototype._set = function () {
  return String(this._el._className || '').trim().split(/\s+/).filter(Boolean);
};
ClassList.prototype.contains = function (name) { return this._set().indexOf(name) >= 0; };
ClassList.prototype.add = function () {
  var set = this._set();
  for (var i = 0; i < arguments.length; i++) {
    if (set.indexOf(arguments[i]) < 0) set.push(arguments[i]);
  }
  this._el._className = set.join(' ');
};
ClassList.prototype.remove = function () {
  var set = this._set();
  for (var i = 0; i < arguments.length; i++) {
    var idx = set.indexOf(arguments[i]);
    if (idx >= 0) set.splice(idx, 1);
  }
  this._el._className = set.join(' ');
};
ClassList.prototype.toggle = function (name, force) {
  var has = this.contains(name);
  var want = force === undefined ? !has : !!force;
  if (want) this.add(name); else this.remove(name);
  return want;
};

/* ----------------------------------------------------------------- style */

function Style() {}
Style.prototype.setProperty = function (name, value, priority) {
  this[toCamel(name)] = value;
  this['__cssprop_' + name] = { value: value, important: priority === 'important' };
};
Style.prototype.getPropertyValue = function (name) {
  var rec = this['__cssprop_' + name];
  if (rec) return rec.value;
  var v = this[toCamel(name)];
  return v === undefined ? '' : v;
};
Style.prototype.removeProperty = function (name) {
  var rec = this['__cssprop_' + name];
  var old = rec ? rec.value : (this[toCamel(name)] || '');
  delete this['__cssprop_' + name];
  delete this[toCamel(name)];
  return old;
};

/* --------------------------------------------------------------- Element */

function FakeElement(tagName) {
  this.nodeType = 1;
  this.tagName = String(tagName || 'div').toUpperCase();
  this._className = '';
  this.attributes = {};
  this.style = new Style();
  this.classList = new ClassList(this);
  this.children = [];
  this.parentElement = null;
  this.dataset = {};
  this._rect = { left: 0, top: 0, width: 0, height: 0 };
}

Object.defineProperty(FakeElement.prototype, 'className', {
  get: function () { return this._className; },
  set: function (v) { this._className = v; }
});

Object.defineProperty(FakeElement.prototype, 'isConnected', {
  get: function () {
    var node = this;
    while (node.parentElement) node = node.parentElement;
    return node === global.document.documentElement;
  }
});

Object.defineProperty(FakeElement.prototype, 'textContent', {
  get: function () { return this._text || ''; },
  set: function (v) { this._text = String(v); this.children = []; }
});

FakeElement.prototype.getBoundingClientRect = function () {
  var r = this._rect || { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: r.left, top: r.top, width: r.width, height: r.height,
    right: r.left + r.width, bottom: r.top + r.height
  };
};

FakeElement.prototype.setRect = function (rect) {
  this._rect = Object.assign({ left: 0, top: 0, width: 0, height: 0 }, rect);
  return this;
};

FakeElement.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
};
FakeElement.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
  if (/^data-/.test(name)) this.dataset[toCamel(name.slice(5))] = String(value);
};
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };

FakeElement.prototype.appendChild = function (child) {
  if (child.parentElement) child.parentElement.removeChild(child);
  this.children.push(child);
  child.parentElement = this;
  return child;
};
FakeElement.prototype.removeChild = function (child) {
  var idx = this.children.indexOf(child);
  if (idx >= 0) this.children.splice(idx, 1);
  child.parentElement = null;
  return child;
};
FakeElement.prototype.remove = function () {
  if (this.parentElement) this.parentElement.removeChild(this);
};

FakeElement.prototype.querySelectorAll = function (selectorList) {
  var compiled = compileSelectorList(selectorList);
  var out = [];
  var scopeEl = this;
  walk(this, function (el) {
    if (matchesSelectorList(el, compiled, scopeEl)) out.push(el);
  });
  return out;
};
FakeElement.prototype.querySelector = function (selectorList) {
  return this.querySelectorAll(selectorList)[0] || null;
};
FakeElement.prototype.contains = function (other) {
  var node = other;
  while (node) {
    if (node === this) return true;
    node = node.parentElement;
  }
  return false;
};
FakeElement.prototype.closest = function (selectorList) {
  var compiled = compileSelectorList(selectorList);
  var node = this;
  while (node && node.nodeType === 1) {
    if (matchesSelectorList(node, compiled, node)) return node;
    node = node.parentElement;
  }
  return null;
};
FakeElement.prototype.cloneNode = function (deep) {
  var clone = new FakeElement(this.tagName);
  clone._className = this._className;
  clone.attributes = Object.assign({}, this.attributes);
  clone._text = this._text;
  if (deep) {
    this.children.forEach(function (c) { clone.appendChild(c.cloneNode(true)); });
  }
  return clone;
};

FakeElement.prototype.addEventListener = function () {};
FakeElement.prototype.removeEventListener = function () {};

/* -------------------------------------------------------------- document */

function makeDocument() {
  var html = new FakeElement('html');
  var body = new FakeElement('body');
  html.appendChild(body);
  var doc = {
    documentElement: html,
    body: body,
    nodeType: 9,
    createElement: function (tag) { return new FakeElement(tag); },
    querySelectorAll: function (sel) { return html.querySelectorAll.call(html, sel).concat(
      matchesSelectorList(html, compileSelectorList(sel), html) ? [html] : []); },
    querySelector: function (sel) { return doc.querySelectorAll(sel)[0] || null; },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  return doc;
}

function install() {
  var doc = makeDocument();
  global.document = doc;
  global.getComputedStyle = function (el) {
    return { position: (el && el.style && el.style.position) || 'static' };
  };
  return doc;
}

module.exports = { install: install, FakeElement: FakeElement, makeDocument: makeDocument };
