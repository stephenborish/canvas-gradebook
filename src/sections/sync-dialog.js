/* Canvas Gradebook+ - "Copy to other classes": post an item to every
 * linked class ("section" in the code) in one go.
 *
 * A teacher with three periods of the same course (three Canvas courses, not
 * cross-listed) links them once. From then on, on any page of any of them,
 * Copy to other classes - beside the item's Edit, in the course home's
 * sidebar, or on the Modules page - copies the item on screen, or any
 * assignments, quizzes, discussions, announcements, pages and modules picked
 * from the course, into the others, through Canvas's own course copy, with:
 *   - each section's own dates (prefilled from this one; a day shift and a
 *     time apply to a whole section),
 *   - an optional note for one section only, at the top of its instructions,
 *   - the copy placed in that section's matching module,
 *   - a first copy put in the matching assignment group.
 * Before anything is written every section is looked at (sync-runner.js
 * survey()): a copy already there is updated rather than duplicated, a copy
 * that was edited in its own section is left alone unless the teacher says
 * otherwise, and a same-titled item that came from elsewhere is flagged,
 * because copying would add a second one.
 *
 * Nothing is copied without the teacher pressing Copy. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.SectionCopyController) return;

  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  var PICK_TYPES = ['assignment', 'quiz', 'discussion', 'announcement', 'page', 'module'];
  var NUDGE_WINDOW_MS = 3 * 3600 * 1000;

  function S() { return CGP.sectionSync; }

  function SectionCopyController(ctx) {
    this.api = ctx.api;
    this.courseId = String(ctx.courseId);
    this.settings = ctx.settings;
    this.origin = typeof location !== 'undefined' ? location.origin : '';
    this.copier = new CGP.SectionCopier({ api: this.api, origin: this.origin });
    this.button = null;
    this.root = null;
    this.state = null;
    this._tries = 0;
  }

  var P = SectionCopyController.prototype;

  /* ---------------------------------------------------------- the button */

  /* The button sits beside the thing it copies, never in the breadcrumb
   * (where it read as navigation and offered to copy "this course"):
   *  - an item's own page: next to Canvas's Edit, and copies that item;
   *  - the course home: in the sidebar, under Import Existing Content (its
   *    mirror image), and opens the item picker;
   *  - the Modules page: beside + Module, and opens the item picker.
   * One button per page: Compare classes is inside the dialog it opens, so
   * Canvas's own toolbars keep their room.
   * Other pages get no button. Edit pages neither: what would be copied is
   * the saved version, not what is on screen. */
  var COPY_GLYPH =
    '<svg class="cgp-copyto__glyph" viewBox="0 0 16 16" aria-hidden="true">' +
    '<rect x="1.5" y="4.5" width="8.5" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M6 2.5h6.4c.9 0 1.6.7 1.6 1.6v8.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  P.start = function () {
    if (!this.settings.values.sectionCopy) { this.unmount(); return; }
    if (this.button && this.button.isConnected) return;
    var spot = this.findSpot();
    if (!spot) return;
    if (!spot.at) {
      // React pages mount their header late; an item page that never shows
      // an Edit we recognise gets the button in a bar at the top instead.
      var self = this;
      if (this._tries++ < 40) { setTimeout(function () { self.start(); }, 250); return; }
      if (spot.kind !== 'item') return;
      spot.at = this.fallbackBar();
      spot.where = 'beforeend';
    }
    var btn = document.createElement(spot.kind === 'home' ? 'a' : 'button');
    if (spot.kind === 'home') { btn.href = '#'; btn.setAttribute('role', 'button'); } else btn.type = 'button';
    btn.className = 'cgp-copyto cgp-copyto--' + spot.kind + (spot.kind === 'home' ? ' btn button-sidebar-wide' : '');
    btn.title = spot.tip;
    btn.innerHTML = COPY_GLYPH + '<span class="cgp-copyto__label">' + esc(spot.label) + '</span>';
    // Beside an item's Edit it is icon-only (gradebook.css), so its name
    // goes on the button itself as well.
    if (spot.kind === 'item') { btn.setAttribute('aria-label', spot.label); btn.title = spot.label + ': ' + spot.tip; }
    spot.at.insertAdjacentElement(spot.where, btn);
    this.button = btn;
    if (spot.kind === 'item') this.spareTitle(btn);
    var self2 = this;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self2.open(spot.kind === 'item' ? null : { pick: true });
    });
    if (spot.kind === 'item' && this.settings.values.sectionCopyNudge) this.checkPage();
    // External links in modules get their own copy icon (link-copy.js).
    if (spot.kind === 'modules' && this.decorateLinkRows) this.decorateLinkRows();
  };

  P.unmount = function () {
    document.querySelectorAll('.cgp-copyto-row').forEach(function (el) { el.classList.remove('cgp-copyto-row'); });
    document.querySelectorAll('.cgp-copyto-title').forEach(function (el) { el.classList.remove('cgp-copyto-title'); });
    if (this.button && this.button.parentNode) this.button.parentNode.removeChild(this.button);
    var bar = document.querySelector('.cgp-copyto-bar');
    if (bar) bar.remove();
    this.button = null;
  };

  /* Where this page's button goes: { kind, at, where, label, tip }, with
   * `at` null while the page has not drawn that spot yet; null for a page
   * that gets no button. */
  P.findSpot = function () {
    var path = location.pathname;
    var base = '/courses/' + this.courseId;
    if (path === base || path === base + '/') {
      var side = document.querySelector('#course_show_secondary .course-options, #course_show_secondary');
      var imp = side && side.querySelector('a[href*="/content_migrations"]');
      return {
        kind: 'home', label: 'Copy to other classes',
        tip: 'Pick assignments, quizzes, pages… from this course and put a copy in your other classes of it',
        at: imp || side, where: imp ? 'afterend' : 'afterbegin'
      };
    }
    if (path === base + '/modules' || path === base + '/modules/') {
      var add = document.querySelector('#content .add_module_link, #content button[aria-label="Add Module"], #content button[aria-label="Module"]');
      return {
        kind: 'modules', label: 'Copy to other classes',
        tip: 'Pick modules or items from this course and put a copy in your other classes of it',
        at: add, where: 'beforebegin'
      };
    }
    var here = S().itemFromPath(path);
    if (!here || here.courseId !== this.courseId || /\/edit\/?$/.test(path)) return null;
    var thing = S().TYPES[here.type].label.toLowerCase();
    var edit = this.findEdit(here);
    return {
      kind: 'item', label: 'Copy to other classes',
      tip: 'Put a copy of this ' + thing + ' in your other classes of this course',
      at: edit, where: 'afterend'
    };
  };

  /* Canvas's own Edit for this item: a link to its edit page, or a visible
   * button labelled Edit. Returns the outermost element that wraps only it,
   * so the button lands beside it, not inside its frame. */
  P.findEdit = function (here) {
    var root = document.querySelector('#content') || document.body;
    var visible = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
    var found = null;
    var links = root.querySelectorAll('a[href*="/edit"]');
    for (var i = 0; i < links.length && !found; i++) {
      var p = '';
      try { p = new URL(links[i].getAttribute('href'), location.href).pathname; } catch (e) { continue; }
      var it = /\/edit\/?$/.test(p) ? S().itemFromPath(p) : null;
      if (it && it.type === here.type && String(it.id || it.slug) === String(here.id || here.slug) && visible(links[i])) found = links[i];
    }
    if (!found) {
      var btns = root.querySelectorAll('button, a[role="button"]');
      for (var j = 0; j < btns.length && !found; j++) {
        if (String(btns[j].textContent || '').replace(/\s+/g, ' ').trim() === 'Edit' && visible(btns[j])) found = btns[j];
      }
    }
    if (!found) return null;
    var at = found;
    for (var k = 0; k < 3 && at.parentElement && at.parentElement !== root && at.parentElement.children.length === 1; k++) at = at.parentElement;
    return at;
  };

  /* Canvas draws an item's title and its buttons (Published, Assign To,
   * Edit, ⋮) in one row that doesn't wrap: one more button there squeezed
   * the title into a narrow column, a few letters a line. The row is let
   * wrap, and the title keeps a readable width, so the buttons move under
   * it when there isn't room for both. */
  P.spareTitle = function (btn) {
    var root = document.querySelector('#content') || document.body;
    var el = btn.parentElement;
    for (var i = 0; i < 6 && el && el !== root; i++, el = el.parentElement) {
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return; }
      if (!/flex/.test(cs.display) || cs.flexDirection.indexOf('column') === 0) continue;
      var heading = el.querySelector('h1, h2');
      if (!heading || heading.contains(btn)) continue;
      var cell = heading;
      while (cell.parentElement && cell.parentElement !== el) cell = cell.parentElement;
      if (cell.contains(btn)) continue;
      el.classList.add('cgp-copyto-row');
      cell.classList.add('cgp-copyto-title');
      return;
    }
  };

  P.fallbackBar = function () {
    var bar = document.createElement('div');
    bar.className = 'cgp-copyto-bar';
    var host = document.querySelector('#content') || document.querySelector('main') || document.body;
    host.insertBefore(bar, host.firstChild);
    return bar;
  };

  P.siblings = function () {
    return S().siblings(this.settings.values.sectionGroups, this.origin, this.courseId);
  };

  /* On an item's own page in a linked course, one short line per other class
   * whose version is not the same as this one, with the one button that
   * fixes it:
   *  - an older version there:      Update <class>…
   *  - a newer version there:       Use <class>’s version…
   *  - different, nobody knows why: Pick a version…
   *  - a new item (last few hours) that is in no other class yet.
   * Which class an item was first copied from never shows: the teacher sees
   * "this class" and "that class", and either can be made to match the
   * other (openMatch). Reads only, after the page has settled. */
  P.checkPage = function () {
    var self = this;
    var sibs = this.siblings();
    var here = S().itemFromPath(location.pathname);
    if (!sibs.length || !here || here.courseId !== this.courseId || /\/edit\/?$/.test(location.pathname)) return;
    if (here.type === 'module') return;
    setTimeout(function () {
      self.currentItem().then(function (item) {
        if (!item || item.type === 'module') return null;
        return self.copier.relations(self.courseId, item, sibs).then(function (rel) {
          var notes = [];
          var checks = [];
          // This item is that class's copy.
          rel.from.forEach(function (r) {
            checks.push(self.copier.compare(r.courseId, { type: item.type, id: r.srcId }, self.courseId, item.id).then(function (c) {
              var n = noticeFor(c, true);
              if (n) notes.push(Object.assign(n, { course: r.courseId, ctx: { origCourse: r.courseId, origRef: { type: item.type, id: r.srcId }, copyCourse: self.courseId, copyId: item.id } }));
            }));
          });
          // That class has a copy of this item.
          rel.to.forEach(function (r) {
            checks.push(self.copier.compare(self.courseId, item, r.courseId, r.destId).then(function (c) {
              var n = noticeFor(c, false);
              if (n) notes.push(Object.assign(n, { course: r.courseId, ctx: { origCourse: self.courseId, origRef: item, copyCourse: r.courseId, copyId: r.destId } }));
            }));
          });
          return Promise.all(checks).then(function () {
            var copiedTo = rel.to.map(function (r) { return r.courseId; });
            var missing = sibs.filter(function (d) { return copiedTo.indexOf(String(d)) < 0 && (rel.unreadable || []).indexOf(String(d)) < 0; });
            var fresh = item.createdAt && Date.now() - Date.parse(item.createdAt) <= NUDGE_WINDOW_MS;
            if (!fresh || rel.from.length || !missing.length || self.inlineCopying) return null;
            // Not on record as copied is not the same as not there: the class
            // may have its own item (made there by hand, with its own due
            // date), or its section may be cross-listed into this course.
            return self.copier.alreadyThere(self.courseId, item, missing).then(function (there) {
              var still = missing.filter(function (d) { return there.indexOf(String(d)) < 0; });
              // The copy "Also post to your other classes" started may have
              // begun while this was being read.
              if (still.length && !self.inlineCopying) notes.push({ kind: 'new', courses: still });
            });
          }).then(function () {
            return self.copier.backups(self.courseId, item.type, item.id).then(function (list) {
              var last = list[0];
              if (last && Date.now() - Number(last.at || 0) < 7 * 86400000) notes.push({ kind: 'undo', course: last.from, backup: last });
              notes.sort(function (a, b) { return NOTICE_ORDER.indexOf(a.kind) - NOTICE_ORDER.indexOf(b.kind); });
              if (notes.length) self.showNotice(item, notes);
            });
          });
        });
      }).catch(function (e) { CGP.diag.warn('sections.checkFailed', { message: String(e && e.message) }); });
    }, 1200);
  };

  var NOTICE_ORDER = ['newer-there', 'differs', 'newer-here', 'new', 'undo'];

  /* An original and its copy compared (copier.compare), seen from this
   * class: hereIsCopy says which of the two is here. null: the same. */
  function noticeFor(c, hereIsCopy) {
    if (!c || !c.side || c.side === 'same') return null;
    var side = c.side;
    if (side === 'copy') return { kind: hereIsCopy ? 'newer-here' : 'newer-there', cmp: c };
    if (side === 'original') return { kind: hereIsCopy ? 'newer-there' : 'newer-here', cmp: c };
    return { kind: 'differs', cmp: c };
  }

  function fmtWhen(iso, tz) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var o = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (tz) o.timeZone = tz;
    try { return new Date(t).toLocaleString(undefined, o); } catch (e) {
      try { delete o.timeZone; return new Date(t).toLocaleString(undefined, o); } catch (e2) { return ''; }
    }
  }

  P.noticeLine = function (item, n, idx) {
    var name = esc(this.courseName(n.course));
    var btn = function (act, label, primary) {
      return '<button type="button" class="cgp-roster__btn' + (primary ? ' cgp-roster__btn--primary' : '') + '" data-notice="' + act + '" data-idx="' + idx + '">' + label + '</button>';
    };
    var line = function (text, buttons) {
      return '<div class="cgp-sections-notice__line"><span class="cgp-sections-notice__text">' + text + '</span>' +
        '<span class="cgp-sections-notice__btns">' + buttons + '</span></div>';
    };
    if (n.kind === 'undo') {
      return line('You replaced this with <strong>' + name + '</strong>’s version on ' + esc(fmtWhen(new Date(n.backup.at).toISOString())) + '.', btn('undo', 'Undo'));
    }
    if (n.kind === 'new') {
      var k = n.courses.length;
      return line('Not in ' + (k === 1 ? '<strong>' + esc(this.courseName(n.courses[0])) + '</strong>' : k + ' of your other classes') + ' yet.',
        btn('copy-new', k === 1 ? 'Copy to ' + esc(this.courseName(n.courses[0])) + '…' : 'Copy to other classes…', true));
    }
    // Older, newer or unknown: the same line and the same button; the
    // newer version starts picked in the two cards it opens.
    var act = n.kind === 'newer-here' ? 'match-there' : (n.kind === 'newer-there' ? 'match-here' : 'compare-one');
    return line('<strong>' + name + '</strong> has a different version.', btn(act, 'Pick a version…', true));
  };

  /* The notice sits at the top of the page's content until dismissed. A
   * dismissal lasts until something changes again (it is keyed by what was
   * seen), and only on this computer. */
  P.showNotice = function (item, notes) {
    var self = this;
    var sig = notes.map(function (n) {
      return n.kind + ':' + (n.course || '') + ':' + (n.cmp ? S().fingerprint(n.cmp.orig.html) + S().fingerprint(n.cmp.copy.html) : '') +
        (n.backup ? n.backup.at : '');
    }).join('|');
    var dkey = 'cgp.sections.dismissed.' + this.courseId + '.' + item.type + '.' + item.id;
    try { if (localStorage.getItem(dkey) === sig) return; } catch (e) { /* ignore */ }
    var old = document.querySelector('.cgp-sections-notice');
    if (old) old.remove();
    var box = document.createElement('div');
    box.className = 'cgp-sections-notice';
    box.setAttribute('role', 'status');
    box.innerHTML = '<div class="cgp-sections-notice__head"><strong>Your other classes</strong>' +
      (this.openBoard ? '<button type="button" class="cgp-board__link" data-notice="compare">Compare all items…</button>' : '') +
      '<button type="button" class="cgp-sections__x" data-notice="dismiss" aria-label="Hide until something changes" title="Hide until something changes">×</button></div>' +
      notes.map(function (n, i) { return self.noticeLine(item, n, i); }).join('');
    var host = document.querySelector('#content') || document.querySelector('main') || document.body;
    host.insertBefore(box, host.firstChild);
    if (this.button) this.button.classList.add('cgp-copyto--new');
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-notice]');
      if (!b) return;
      var act = b.getAttribute('data-notice');
      var n = notes[Number(b.getAttribute('data-idx'))] || {};
      if (act === 'dismiss') {
        try { localStorage.setItem(dkey, sig); } catch (er) { /* ignore */ }
        box.remove();
        return;
      }
      if (act === 'copy-new') return self.open({ items: [item], dests: n.courses });
      if (act === 'compare') return self.openBoard();
      if (act === 'undo') {
        b.disabled = true;
        return self.copier.undoBack({ origCourse: self.courseId, type: item.type, origId: item.id }).then(function () {
          CGP.ui.toast('Undone. Reloading to show the earlier version…');
          setTimeout(function () { location.reload(); }, 1200);
        }, function (err) {
          b.disabled = false;
          CGP.ui.error('Couldn’t undo: ' + CGP.util.describeApiError(err, { fallback: String(err && err.message) }));
        });
      }
      if (act === 'match-there') return self.openMatch(n.ctx, 'there');
      if (act === 'match-here') return self.openMatch(n.ctx, 'here');
      if (act === 'compare-one') return self.openMatch(n.ctx, null);
    });
  };

  /* ------------------------------------------- two versions, click one */

  /* The two versions of one item as two cards; the teacher clicks the one
   * to keep. What differs is highlighted in both, so nothing has to be read
   * end to end, and settings that differ sit at the top of each card.
   * o: { a, b: {who, sub, title, html, settings, updatedAt, newer},
   *      picked: 'a' | 'b' | null, name (radio group), attrs(side),
   *      compact (a preview, cut short) }. */
  function versionCards(o) {
    var sync = S();
    var text = function (h) { return sync.htmlToText(sync.splitNote(h || '').html, true); };
    var diff = sync.wordDiff(text(o.a.html), text(o.b.html));
    var pairs = sync.settingsPairs(o.a.settings, o.b.settings);
    var titles = String(o.a.title || '') !== String(o.b.title || '');
    // The same edit time on both says nothing.
    var sameWhen = o.a.updatedAt && o.b.updatedAt && fmtWhen(o.a.updatedAt) === fmtWhen(o.b.updatedAt);
    var card = function (side, v, body) {
      var on = o.picked === side;
      return '<label class="cgp-ver' + (on ? ' is-picked' : '') + (o.compact ? ' cgp-ver--compact' : '') + '">' +
        '<input type="radio" class="cgp-ver__radio" name="' + esc(o.name) + '" ' + o.attrs(side) + (on ? ' checked' : '') +
        ' aria-label="' + esc('Use ' + v.who + '’s version' + (v.here ? ' (this class)' : '') + (v.newer ? ', the newer one' : '')) + '">' +
        '<span class="cgp-ver__head"><span class="cgp-ver__who">' + esc(v.who) + '</span>' +
        (v.here ? '<span class="cgp-ver__here">this class</span>' : '') +
        (v.newer ? '<span class="cgp-ver__newer">newer</span>' : '') +
        (v.updatedAt && !sameWhen ? '<span class="cgp-ver__when">edited ' + esc(fmtWhen(v.updatedAt)) + '</span>' : '') + '</span>' +
        (titles ? '<span class="cgp-ver__title">' + esc(v.title || '(untitled)') + '</span>' : '') +
        (pairs.length ? '<span class="cgp-ver__settings">' + pairs.map(function (p) {
          return '<span>' + esc(p.label) + ': <strong>' + esc(side === 'a' ? p.a : p.b) + '</strong></span>';
        }).join('') + '</span>' : '') +
        '<span class="cgp-ver__text" aria-hidden="true">' + (body || '<em>(no instructions)</em>') + '</span>' +
        '<span class="cgp-ver__pick" aria-hidden="true">' + (on ? '✓ Using this one' : 'Use this one') + '</span></label>';
    };
    return '<div class="cgp-vers" role="radiogroup" aria-label="' + esc(o.question || 'Which version?') + '">' +
      card('a', o.a, diff.a) + card('b', o.b, diff.b) + '</div>';
  }

  /* What differs between two versions, in words: what = ['points',
   * 'instructions'], and a line per setting that matters to grades
   * ("Points: none in Block 8, 6 in Block 6"), shown bold above the cards. */
  function versionDiff(a, b) {
    var sync = S();
    var text = function (h) { return sync.fingerprint(h || ''); };
    var pairs = sync.settingsPairs(a.settings, b.settings);
    var what = pairs.map(function (p) { return p.label.toLowerCase(); });
    if (String(a.title || '') !== String(b.title || '')) what.push('title');
    if (a.html !== undefined && b.html !== undefined && text(a.html) !== text(b.html)) what.push('instructions');
    var lines = pairs.map(function (p) { return p.label + ': ' + p.a + ' in ' + a.who + ', ' + p.b + ' in ' + b.who; });
    return { what: what, lines: lines };
  }

  /* --------------------------------------- one item, two classes: match */

  /* This item side by side with another class's version of it, and one
   * button each way: "Use this version in Block 6" / "Use Block 6’s
   * version here". ctx names the item as Canvas's copy records see it
   * ({origCourse, origRef, copyCourse, copyId}: the copy was made from the
   * original); which of the two is "here" is this controller's course.
   * prefer: 'there' (update the other class) or 'here' (update this one)
   * makes that button the primary one; null leaves both equal.
   *
   * Either way can be done, whichever was copied from which:
   *  - onto the original: its title and instructions (and an assignment's
   *    settings) are written onto it, with a backup for Undo
   *    (copier.applyBack);
   *  - onto the copy: Canvas's own course copy again, replacing it, with
   *    that class's own dates, note and publishing kept (matchCopy). */
  P.openMatch = function (ctx, prefer) {
    var self = this;
    this.close();
    var hereIsOrig = String(ctx.origCourse) === this.courseId;
    var st = this.state = {
      view: 'match', courses: null,
      match: { ctx: ctx, prefer: prefer || null, hereIsOrig: hereIsOrig, other: hereIsOrig ? String(ctx.copyCourse) : String(ctx.origCourse),
        plan: null, error: null, running: null, step: '', result: null }
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel cgp-sections__panel--match" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow"></div><h2 id="cgp-sections-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-sections__body"></div></div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.requestClose(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.requestClose(); });
    root.addEventListener('click', function (e) { self.onMatchClick(e); });
    root.addEventListener('change', function (e) {
      var side = e.target.getAttribute && e.target.getAttribute('data-match-pick');
      if (!side || !self.state || self.state.view !== 'match' || self.state.match.running) return;
      self.state.match.picked = side;
      self.renderMatch();
      var again = self.root && self.root.querySelector('[data-match-pick="' + side + '"]');
      if (again) { try { again.focus({ preventScroll: true }); } catch (er) { again.focus(); } }
    });
    this._onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); self.requestClose(); } };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    this.renderMatch();
    CGP.teachingCourseList(this.api).catch(function () { return []; }).then(function (courses) {
      if (self.state !== st) return null;
      st.courses = courses || [];
      self.renderMatch();
      return self.copier.planBack(ctx.origCourse, ctx.origRef, ctx.copyCourse, ctx.copyId);
    }).then(function (plan) {
      if (self.state !== st || !plan) return;
      st.match.plan = plan;
      self.renderMatch();
    }, function (err) {
      if (self.state !== st) return;
      st.match.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read both versions from Canvas' });
      self.renderMatch();
    });
  };

  /* Kept for callers that still say "bring back": the same screen. */
  P.openBack = function (ctx) { return this.openMatch(ctx, String(ctx.origCourse) === this.courseId ? 'here' : 'there'); };

  P.renderMatch = function () {
    if (!this.root || !this.state || this.state.view !== 'match') return;
    var m = this.state.match;
    var sync = S();
    var other = this.courseName(m.other);
    var here = this.courseName(this.courseId);
    this.root.querySelector('.cgp-stats__eyebrow').textContent = here + ' and ' + other;
    var body = this.root.querySelector('.cgp-sections__body');
    var plan = m.plan;
    this.root.querySelector('#cgp-sections-title').textContent = plan ? ((m.hereIsOrig ? plan.orig.title : plan.copy.title) || '(untitled)') : 'Compare';
    if (m.error) { body.innerHTML = '<p class="cgp-sections__err">' + esc(m.error) + '</p>'; return; }
    if (!plan) { body.innerHTML = '<p class="cgp-stats__note" role="status">Reading both versions…</p>'; return; }

    if (m.result) {
      var r = m.result;
      var target = r.dir === 'there' ? other : here;
      var winner = r.dir === 'there' ? here : other;
      body.innerHTML = '<section class="cgp-roster__section">' +
        (r.ok ? '<p class="cgp-sections__done"><span aria-hidden="true">✓</span> ' + esc(target) + ' now has ' + esc(winner) + '’s version.</p>'
          : '<p class="cgp-sections__err">Not updated. ' + esc(r.error || '') + '</p>') +
        (r.warnings && r.warnings.length ? '<ul class="cgp-sections__warnlist">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="cgp-roster__row cgp-roster__actions">' +
        '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="' + (r.ok && r.dir === 'here' ? 'reload' : 'close') + '">' +
        (r.ok && r.dir === 'here' ? 'Reload this page' : 'Done') + '</button>' +
        (r.ok && r.url && r.dir === 'there' ? '<a class="cgp-roster__btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open in ' + esc(target) + '</a>' : '') +
        (r.ok && r.undo ? '<button type="button" class="cgp-roster__btn" data-act="match-undo">Undo</button>' : '') +
        (r.ok && this.siblings().length > 1 ? '<button type="button" class="cgp-roster__btn" data-act="match-others">Copy to your other classes too…</button>' : '') +
        '</div></section>';
      return;
    }

    var mine = m.hereIsOrig ? plan.orig : plan.copy;
    var theirs = m.hereIsOrig ? plan.copy : plan.orig;
    // Which side is newer, when the copy records say.
    var newer = { copy: m.hereIsOrig ? 'there' : 'here', original: m.hereIsOrig ? 'here' : 'there' }[plan.side] || null;
    var same = sync.fingerprint(mine.html || '') === sync.fingerprint(theirs.html || '') && !plan.titleDiffers &&
      !sync.settingsPairs(mine.settings, theirs.settings).length;
    if (same) {
      body.innerHTML = '<section class="cgp-roster__section"><p class="cgp-sections__done"><span aria-hidden="true">✓</span> This is the same in both classes.</p>' +
        '<div class="cgp-roster__row cgp-roster__actions"><button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="close">Done</button></div></section>';
      return;
    }
    // The newer one starts picked (or the one the button that opened this
    // named); the teacher clicks the other to change it.
    if (m.picked === undefined) m.picked = m.prefer === 'there' ? 'a' : (m.prefer === 'here' ? 'b' : (newer === 'here' ? 'a' : (newer === 'there' ? 'b' : null)));
    var running = !!m.running;
    var label = m.picked === 'a' ? 'Update ' + other : (m.picked === 'b' ? 'Update this class' : 'Click the version to use');
    var backDir = m.hereIsOrig ? 'b' : 'a';
    body.innerHTML = '<section class="cgp-roster__section">' +
      '<p class="cgp-sections__lead">Which version should both classes have?</p>' +
      versionDiff({ who: here, settings: mine.settings }, { who: other, settings: theirs.settings }).lines.map(function (l) {
        return '<span class="cgp-sections__pickver-key">' + esc(l) + '</span>';
      }).join('') +
      versionCards({
        a: { who: here, here: true, title: mine.title, html: mine.html, settings: mine.settings, updatedAt: mine.updatedAt, newer: newer === 'here' },
        b: { who: other, title: theirs.title, html: theirs.html, settings: theirs.settings, updatedAt: theirs.updatedAt, newer: newer === 'there' },
        question: 'Which version should both classes have?',
        picked: m.picked, name: 'cgp-match-pick',
        attrs: function (side) { return 'data-match-pick="' + side + '" value="' + side + '"' + (running ? ' disabled' : ''); }
      }) +
      '<div class="cgp-roster__row cgp-roster__actions cgp-sections__match-go">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="match-go"' + (m.picked && !running ? '' : ' disabled') + '>' +
      esc(running ? (m.step || 'Updating…') : label) + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="close"' + (running ? ' disabled' : '') + '>Cancel</button>' +
      '<span class="cgp-stats__note">Dates and student work stay as they are.' +
      (plan.type === 'quiz' && m.picked === backDir ? ' Quiz questions aren’t changed.' : '') + '</span></div>' +
      '</section>';
  };

  P.onMatchClick = function (e) {
    var self = this;
    var st = this.state;
    if (!st || st.view !== 'match') return;
    var btn = e.target.closest && e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    var a = btn.getAttribute('data-act');
    var m = st.match;
    if (a === 'close') return this.close();
    if (a === 'reload') { this.close(); location.reload(); return; }
    if (a === 'match-go' && m.picked) a = m.picked === 'a' ? 'match-there' : 'match-here';
    if ((a === 'match-there' || a === 'match-here') && m.plan && !m.running) {
      var dir = a === 'match-there' ? 'there' : 'here';
      m.running = dir;
      m.step = 'Updating…';
      this.renderMatch();
      var onStep = function (step) { m.step = step; if (self.state === st) self.renderMatch(); };
      // The original is the one updated by writing onto it; the copy by
      // copying again.
      var ontoOrig = (dir === 'here') === m.hereIsOrig;
      var run = ontoOrig
        ? this.copier.applyBack(m.plan, { title: true, settings: true }, onStep).then(function (r) {
          r.undo = r.ok ? { origCourse: m.plan.origCourse, type: m.plan.type, origId: m.plan.origId } : null;
          return r;
        })
        : this.matchCopy(m.plan, onStep);
      run.then(function (r) {
        m.running = null;
        r.dir = dir;
        m.result = r;
        if (self.state === st) self.renderMatch();
        var target = dir === 'there' ? self.courseName(m.other) : self.courseName(self.courseId);
        if (r.ok) CGP.ui.toast('Updated ' + target + '.');
        else CGP.ui.error(r.error || 'Not updated.');
      });
      return;
    }
    if (a === 'match-undo' && m.result && m.result.undo) {
      btn.disabled = true;
      this.copier.undoBack(m.result.undo).then(function () {
        CGP.ui.toast('Undone.');
        if (m.result.dir === 'here') { self.close(); location.reload(); return; }
        self.close();
      }, function (err) {
        btn.disabled = false;
        CGP.ui.error('Couldn’t undo: ' + CGP.util.describeApiError(err, { fallback: String(err && err.message) }));
      });
      return;
    }
    if (a === 'match-others' && m.result) {
      // From the class whose version won, to the rest.
      var winCourse = m.result.dir === 'there' ? this.courseId : m.other;
      var winId = winCourse === String(m.plan.origCourse) ? m.plan.origId : m.plan.copyId;
      var ctl = winCourse === this.courseId ? this : new SectionCopyController({ api: this.api, courseId: winCourse, settings: this.settings });
      var loser = m.result.dir === 'there' ? m.other : this.courseId;
      this.close();
      ctl.open({ items: [{ type: m.plan.type, id: winId, title: (winCourse === String(m.plan.origCourse) ? m.plan.orig : m.plan.copy).title }],
        exclude: [loser] });
    }
  };

  /* The copy made again from its original, replacing it: Canvas's own
   * course copy, with that class's own dates, note and publishing kept.
   * Resolves a result like a copy's ({ok, error, warnings, url}). */
  P.matchCopy = function (plan, onStep) {
    var self = this;
    var sync = S();
    var item = Object.assign({}, plan.orig, { type: plan.type, id: plan.origId, htmlLoaded: true });
    var ctl = new SectionCopyController({ api: this.api, courseId: plan.origCourse, settings: this.settings });
    ctl.copier = this.copier;
    var key = itemKey(item);
    onStep('Checking ' + this.courseName(plan.copyCourse));
    var pageDates = item.type === 'page' ? ctl.loadDates(item) : Promise.resolve();
    return pageDates.then(function () {
      return self.copier.survey(plan.origCourse, [item], [plan.copyCourse], { placeInModules: false });
    }).then(function (sv) {
      var dest = sv.dests[0] || {};
      if (dest.error) return { ok: false, error: dest.error, warnings: [] };
      var info = (dest.items || {})[key] || {};
      var dates = {};
      if (info.destDates === null) item.noDates = true;
      sync.dateFields(item).forEach(function (f) { dates[f] = info.destDates && info.destDates[f] !== undefined ? info.destDates[f] : null; });
      var task = {
        srcCourseId: String(plan.origCourse), destCourseId: String(plan.copyCourse), destName: self.courseName(plan.copyCourse),
        // Canvas's copy brings the original's publishing along: put back
        // what that class had.
        item: item, mode: 'copy', dates: dates, children: [], note: info.note || '',
        publish: info.destPublished === undefined ? 'keep' : (info.destPublished ? 'published' : 'unpublished'),
        module: null, assignmentGroupId: null, destId: info.destId || String(plan.copyId), mapping: dest.mapping || {}, childNotes: {}
      };
      var out = null;
      return self.copier.runPlan([task], function (t, step) { onStep(step); }, function (t, r) { out = r; }).then(function () {
        return out || { ok: false, error: 'Something went wrong before it started.', warnings: [] };
      });
    }, function (err) {
      return { ok: false, error: CGP.util.describeApiError(err, { fallback: 'Couldn’t read that class from Canvas' }), warnings: [] };
    });
  };

  /* The item this page shows, as the dialog's item (null on other pages). */
  P.currentItem = function () {
    var api = this.api;
    var here = S().itemFromPath(location.pathname);
    if (!here || here.courseId !== this.courseId) return Promise.resolve(null);
    var read = here.type === 'page' ? api.pageBySlug(this.courseId, here.slug)
      : api.sectionItem(this.courseId, here.type === 'announcement' ? 'discussion' : here.type, here.id);
    return read.then(function (o) {
      if (!o) return null;
      var type = here.type;
      if (type === 'assignment') {
        // An assignment page can be a quiz's or a graded discussion's.
        if (o.quiz_id) return api.sectionItem(here.courseId, 'quiz', o.quiz_id).then(function (q) { return withMeta(S().toItem('quiz', q), q); });
        if (o.discussion_topic && o.discussion_topic.id) {
          return api.sectionItem(here.courseId, 'discussion', o.discussion_topic.id).then(function (t) { return withMeta(S().toItem('discussion', t), t); });
        }
      }
      if (type === 'discussion' && o.is_announcement) type = 'announcement';
      return withMeta(S().toItem(type === 'announcement' ? 'discussion' : type, o), o);
    }).catch(function () { return null; });
  };

  function withMeta(item, o) {
    if (!item) return null;
    item.createdAt = o.created_at || o.posted_at || null;
    item.htmlLoaded = true;
    return item;
  }

  /* -------------------------------------------------------------- dialog */

  /* opts.items: start with these instead of the page's item.
   * opts.dests: only these linked classes, ticked.
   * opts.exclude: every linked class but these.
   * opts.only: exactly these (item, class) pairs ticked (Compare classes),
   *   replacing a version that is different there (they were ticked to
   *   bring that class in line).
   * opts.pick: no item yet (course home, Modules): go to the picker.
   * Otherwise no class starts ticked: the teacher picks. */
  P.open = function (opts) {
    var self = this;
    opts = opts || {};
    this.close();
    this.state = {
      items: [], dests: [], courses: null, tz: null, survey: null, surveying: false, surveyError: null,
      cells: {}, seed: {}, notes: {}, include: {}, replace: {}, adjust: {}, expanded: {},
      publish: 'match', placeInModules: true, view: 'main', picker: { type: 'assignment', q: '', lists: {}, chosen: {} },
      running: false, results: null, wantPick: !!opts.pick,
      // From Compare classes: exactly these (item, class) pairs ticked.
      only: opts.only || null,
      tickDests: opts.dests ? opts.dests.map(String) : null
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow"></div><h2 id="cgp-sections-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-sections__body"></div>' +
      '</div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.requestClose(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.requestClose(); });
    root.addEventListener('click', function (e) { self.onClick(e); });
    root.addEventListener('change', function (e) { self.onChange(e); });
    root.addEventListener('input', function (e) { self.onInput(e); });
    this._onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.requestClose(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    this.render();

    var st = this.state;
    Promise.all([
      CGP.teachingCourseList(this.api).catch(function () { return []; }),
      this.api.profileTimeZone().catch(function () { return null; }),
      opts.items ? Promise.resolve(null) : this.currentItem()
    ]).then(function (r) {
      if (self.state !== st) return;
      st.courses = r[0] || [];
      st.tz = r[1] || (Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      if (opts.items) opts.items.forEach(function (it) { st.items.push(it); });
      else if (r[2]) st.items.push(r[2]);
      st.dests = self.siblings();
      if (opts.dests) st.dests = st.dests.filter(function (d) { return opts.dests.indexOf(String(d)) >= 0; });
      if (opts.exclude) st.dests = st.dests.filter(function (d) { return opts.exclude.indexOf(String(d)) < 0; });
      if (!st.dests.length && !opts.dests && !opts.exclude) st.view = 'link';
      else if (st.wantPick && !st.items.length) st.view = 'pick';
      self.render();
      self.resurvey();
    });
  };

  P.requestClose = function () {
    if (this.state && this.state.back && this.state.back.running) {
      CGP.ui.toast('Still updating in the background — stay on this page until the message saying it is done.');
    }
    if (this.state && this.state.running) {
      CGP.ui.toast('Copying carries on in the background — stay on this page until the message saying it is done.');
    }
    this.close();
  };

  P.close = function () {
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onKey = null;
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.state = null;
  };

  P.courseName = function (id) {
    var list = (this.state && this.state.courses) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i].name || ('Course ' + id);
    // The names saved with the linked sections, when the course list has
    // not been read on this page.
    var g = S().groupFor(this.settings.values.sectionGroups, this.origin, id);
    if (g && g.names && g.names[String(id)]) return g.names[String(id)];
    if (String(id) === this.courseId) {
      var crumb = document.querySelector('.cgp-crumb-link, #breadcrumbs a[href$="/courses/' + id + '"]');
      var t = crumb ? String(crumb.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t) return t;
    }
    return 'Course ' + id;
  };

  function itemKey(it) { return it.type + ':' + it.id; }
  function cellKey(it, dest) { return itemKey(it) + '>' + dest; }

  /* ------------------------------------------------------------- survey */

  P.resurvey = function () {
    var self = this;
    var st = this.state;
    if (!st || st.view !== 'main') return;
    st.survey = null;
    st.surveyError = null;
    if (!st.items.length || !st.dests.length) { this.render(); return; }
    st.surveying = true;
    this.render();
    var token = st.surveyToken = {};
    // A module's items are dated per section too; read them first.
    Promise.all(st.items.map(function (it) { return Promise.all([self.loadChildren(it), self.loadDates(it)]); })).then(function () {
      return self.copier.survey(self.courseId, st.items, st.dests, { placeInModules: st.placeInModules });
    }).then(function (survey) {
      if (self.state !== st || st.surveyToken !== token) return;
      st.surveying = false;
      st.survey = survey;
      self.seedCells();
      self.render();
    }, function (err) {
      if (self.state !== st || st.surveyToken !== token) return;
      st.surveying = false;
      st.surveyError = CGP.util.describeApiError(err, { fallback: 'Couldn’t read your other classes from Canvas' });
      self.render();
    });
  };

  P.loadChildren = function (item) {
    var self = this;
    if (item.type !== 'module' || item.children) return Promise.resolve();
    var read = item.items ? Promise.resolve(item.items)
      : this.api.modulesWithItems(this.courseId).then(function (mods) {
        var m = (mods || []).filter(function (x) { return String(x.id) === String(item.id); })[0];
        return (m && m.items) || [];
      });
    return read.then(function (mi) {
      item.moduleItems = mi;
      var kids = S().moduleChildren(mi);
      return Promise.all(kids.map(function (k) {
        return self.api.sectionItem(self.courseId, k.type, k.id).then(function (o) {
          var full = S().toItem(k.type, o);
          if (full) { k.title = full.title || k.title; k.dates = full.dates; k.graded = full.graded; k.html = full.html; k.settings = full.settings; }
          return k;
        }, function () { k.dates = {}; return k; });
      })).then(function (list) { item.children = list; });
    });
  };

  /* A page's availability dates live only in its Assign To data. A course
   * whose pages cannot have dates answers with an error: no date boxes. */
  P.loadDates = function (item) {
    if (item.type !== 'page' || item.datesLoaded) return Promise.resolve();
    return this.api.dateDetails(this.courseId, 'page', item.id).then(function (d) {
      item.dates = { unlock_at: (d && d.unlock_at) || null, lock_at: (d && d.lock_at) || null };
      item.datesLoaded = true;
      if (d && d.only_visible_to_overrides) item.hasOverrides = true;
    }, function () {
      item.noDates = true;
      item.datesLoaded = true;
    });
  };

  /* Starting values for every box: this section's dates, the include and
   * replace defaults the survey implies, and each section's existing note. */
  P.seedCells = function () {
    var st = this.state;
    var sync = S();
    st.items.forEach(function (it) {
      st.dests.forEach(function (d) {
        var k = cellKey(it, d);
        var info = surveyInfo(st, it, d);
        var no = blocked(st, it, d);
        if (!(k in st.include)) {
          st.include[k] = st.only ? !!st.only[k] && !no : (st.tickDests ? st.tickDests.indexOf(String(d)) >= 0 && !no : false);
        }
        if (!(k in st.replace)) {
          // The newer version starts picked; when nobody knows which is
          // newer, this class's (the teacher is copying from it). With the
          // cards, picking the other class's version brings it here too.
          st.replace[k] = st.only && st.only[k] ? true
            : (info && hasCards(it, info) ? info.status !== 'edited' : (info ? sync.defaultReplace(info.status) : true));
        }
        if (!(k in st.notes)) st.notes[k] = info && info.note ? info.note : '';
        dated(it).forEach(function (row) {
          var rk = k + '|' + itemKey(row);
          if (st.cells[rk]) return;
          st.seed[rk] = seedDates(it, row, info);
          st.cells[rk] = {};
          sync.dateFields(row).forEach(function (f) { st.cells[rk][f] = sync.isoToLocal(st.seed[rk][f], st.tz); });
        });
      });
    });
  };

  /* The dates a section's boxes start from: what its copy has now, when it
   * has one (updating a copy must not quietly reset that section's own
   * dates to this section's), else this section's. */
  function seedDates(it, row, info) {
    var existing = info && info.destId && info.status !== 'restore';
    var have = null;
    if (existing) have = row === it ? info.destDates : (info.childDates || {})[itemKey(row)];
    var src = row.dates || {};
    var out = {};
    S().dateFields(row).forEach(function (f) {
      out[f] = have && have[f] !== undefined ? have[f] : (src[f] || null);
    });
    return out;
  }

  function destOf(st, d) {
    var list = (st.survey && st.survey.dests) || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].courseId) === String(d)) return list[i];
    return null;
  }

  function surveyInfo(st, it, d) {
    var dest = destOf(st, d);
    return dest && dest.items ? dest.items[itemKey(it)] || null : null;
  }

  /** The rows that get dates for an item: itself, plus a module's items. */
  function dated(it) {
    var rows = [];
    if (S().dateFields(it).length) rows.push(it);
    (it.children || []).forEach(function (c) { if (S().dateFields(c).length) rows.push(c); });
    return rows;
  }

  /* -------------------------------------------------------------- render */

  /* Redraws the body, keeping the scroll positions and the focused control
   * (a ticked box in a long list must not throw the list back to the top). */
  var FOCUS_KEYS = ['data-link', 'data-pick', 'data-class', 'data-include', 'data-replace', 'data-pick-type', 'data-act', 'data-role'];

  P.render = function () {
    if (!this.root || !this.state) return;
    var body = this.root.querySelector('.cgp-sections__body');
    var panel = this.root.querySelector('.cgp-stats__panel');
    var list = body.querySelector('.cgp-sections__courses');
    var keep = { panel: panel ? panel.scrollTop : 0, list: list ? list.scrollTop : 0, focus: null };
    var active = document.activeElement;
    if (active && body.contains(active)) {
      for (var i = 0; i < FOCUS_KEYS.length; i++) {
        if (active.hasAttribute(FOCUS_KEYS[i])) {
          keep.focus = '[' + FOCUS_KEYS[i] + '="' + String(active.getAttribute(FOCUS_KEYS[i])).replace(/["\\]/g, '\\$&') + '"]' +
            (active.type === 'radio' ? '[value="' + active.value + '"]' : '');
          break;
        }
      }
    }
    var st = this.state;
    this.renderHead();
    if (!st.courses) body.innerHTML = '<p class="cgp-stats__note">Loading your classes…</p>';
    else if (st.view === 'link') body.innerHTML = this.renderLink();
    else if (st.view === 'pick') body.innerHTML = this.renderPicker();
    else body.innerHTML = this.renderMain();
    var list2 = body.querySelector('.cgp-sections__courses');
    if (list2) list2.scrollTop = keep.list;
    if (panel) panel.scrollTop = keep.panel;
    if (keep.focus) {
      var el = null;
      try { el = body.querySelector(keep.focus); } catch (e) { el = null; }
      if (el) { try { el.focus({ preventScroll: true }); } catch (e2) { el.focus(); } }
    }
  };

  /* "Copy from Block 6" over the item's title (or "3 items"). */
  P.renderHead = function () {
    var st = this.state;
    var eb = this.root && this.root.querySelector('.cgp-stats__eyebrow');
    var h = this.root && this.root.querySelector('#cgp-sections-title');
    if (!eb || !h) return;
    if (st.view === 'link') { eb.textContent = 'Your classes'; h.textContent = 'Link your classes'; return; }
    eb.textContent = 'Copy from ' + this.courseName(this.courseId);
    if (st.view === 'pick' || !st.items.length) { h.textContent = 'Copy to other classes'; return; }
    h.textContent = st.items.length === 1 ? (st.items[0].title || '(untitled)') : st.items.length + ' items';
  };

  P.renderLink = function () {
    var st = this.state;
    var sync = S();
    var current = null;
    st.courses.forEach(function (c) { if (String(c.id) === this.courseId) current = c; }, this);
    var linked = this.siblings();
    var suggested = sync.suggestSiblings(st.courses, current || { id: this.courseId, name: this.courseName(this.courseId) });
    if (!st.linkDraft) st.linkDraft = linked.length ? linked.slice() : suggested.slice();
    var self = this;
    var others = st.courses.filter(function (c) { return String(c.id) !== self.courseId; });
    // Suggestions first, then the rest by term and name.
    others.sort(function (a, b) {
      var sa = suggested.indexOf(String(a.id)) >= 0 ? 0 : 1, sb = suggested.indexOf(String(b.id)) >= 0 ? 0 : 1;
      return (sa - sb) || String((b.term && b.term.name) || '').localeCompare(String((a.term && a.term.name) || '')) ||
        String(a.name).localeCompare(String(b.name));
    });
    var q = String(st.linkFilter || '').toLowerCase();
    var rows = others.filter(function (c) {
      return !q || (String(c.name) + ' ' + ((c.term && c.term.name) || '')).toLowerCase().indexOf(q) >= 0;
    }).map(function (c) {
      var id = String(c.id);
      var on = st.linkDraft.indexOf(id) >= 0;
      var elsewhere = sync.groupFor(self.settings.values.sectionGroups, self.origin, id);
      var note = elsewhere && linked.indexOf(id) < 0 ? '<span class="cgp-sections__tag" title="Ticking it moves it into this group">in another group</span>' : '';
      return '<label class="cgp-sections__course"><input type="checkbox" data-link="' + esc(id) + '"' + (on ? ' checked' : '') + '> ' +
        '<span class="cgp-sections__course-name">' + esc(c.name) + '</span>' +
        (suggested.indexOf(id) >= 0 ? '<span class="cgp-sections__tag cgp-sections__tag--hint">suggested</span>' : '') + note +
        (c.term && c.term.name ? '<span class="cgp-sections__term">' + esc(c.term.name) + '</span>' : '') + '</label>';
    }).join('');
    var n = st.linkDraft.length;
    var go = n === 1 ? 'Use ' + this.courseName(st.linkDraft[0])
      : n ? 'Use these ' + n + ' classes'
        : (linked.length ? 'Unlink all' : 'Pick at least one class');
    return '<section class="cgp-roster__section">' +
      '<h3>Which of your classes are the same course as this one?</h3>' +
      '<p class="cgp-stats__note">Your other blocks or periods of it. You only choose once.</p>' +
      '<input type="search" class="cgp-sections__filter" data-role="link-filter" placeholder="Filter your classes…" value="' + esc(st.linkFilter || '') + '">' +
      '<div class="cgp-sections__courses">' + (rows || '<p class="cgp-stats__note">No other courses where you teach.</p>') + '</div>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="save-link"' + (n || linked.length ? '' : ' disabled') + '>' + esc(go) + '</button>' +
      (linked.length ? '<button type="button" class="cgp-roster__btn" data-act="cancel-link">Cancel</button>' : '') +
      '</div></section>';
  };

  P.renderPicker = function () {
    var st = this.state;
    var pk = st.picker;
    var sync = S();
    var tabs = PICK_TYPES.map(function (t) {
      return '<button type="button" class="cgp-sections__tab' + (pk.type === t ? ' is-on' : '') + '" data-pick-type="' + t + '">' +
        esc(sync.TYPES[t].plural) + '</button>';
    }).join('') +
      // External links in modules are copied on their own (link-copy.js).
      (this.openLinks ? '<button type="button" class="cgp-sections__tab" data-act="open-links" title="External links in this course’s modules">Links</button>' : '');
    var list = pk.lists[pk.type];
    var rows;
    if (list === undefined) { rows = '<p class="cgp-stats__note">Loading…</p>'; this.loadPickList(pk.type); }
    else if (list === null) rows = '<p class="cgp-stats__note">Couldn’t load these from Canvas.</p>';
    else {
      var q = String(pk.q || '').toLowerCase();
      var already = st.items.map(itemKey);
      var shown = list.filter(function (it) { return !q || String(it.title).toLowerCase().indexOf(q) >= 0; });
      rows = shown.length ? shown.slice(0, 300).map(function (it) {
        var k = itemKey(it);
        var dis = already.indexOf(k) >= 0;
        return '<label class="cgp-sections__course"><input type="checkbox" data-pick="' + esc(k) + '"' +
          ((pk.chosen[k] || dis) ? ' checked' : '') + (dis ? ' disabled' : '') + '> <span class="cgp-sections__course-name">' + esc(it.title || '(untitled)') + '</span>' +
          (it.published ? '' : '<span class="cgp-sections__tag">unpublished</span>') +
          (it.newQuiz ? '<span class="cgp-sections__tag">New Quiz</span>' : '') + '</label>';
      }).join('') : '<p class="cgp-stats__note">Nothing here.</p>';
    }
    var n = Object.keys(pk.chosen).filter(function (k) { return pk.chosen[k]; }).length;
    return '<section class="cgp-roster__section"><h3>What do you want to copy?</h3>' +
      '<div class="cgp-sections__tabs">' + tabs + '</div>' +
      '<input type="search" class="cgp-sections__filter" data-role="pick-filter" placeholder="Filter…" value="' + esc(pk.q || '') + '">' +
      '<div class="cgp-sections__courses">' + rows + '</div>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="pick-done"' + (n ? '' : ' disabled') + '>' +
      (n ? 'Next: choose classes (' + n + ')' : 'Tick what to copy') + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="pick-cancel">Cancel</button>' +
      '</div></section>';
  };

  P.loadPickList = function (type) {
    var self = this;
    var st = this.state;
    if (st.picker.loading === type) return;
    st.picker.loading = type;
    this.api.courseItems(this.courseId, type).then(function (list) {
      if (self.state !== st) return;
      st.picker.lists[type] = (list || []).map(function (o) { return S().toItem(type, o); }).filter(Boolean)
        .filter(function (it) { return it.type === type; });
      st.picker.loading = null;
      self.render();
    }, function () {
      if (self.state !== st) return;
      st.picker.lists[type] = null;
      st.picker.loading = null;
      self.render();
    });
  };

  /* The copy dialog: one row per class. Tick a class, check its due date,
   * press Copy. Each row says in a few words what is there now; only a
   * class whose version is different asks a question (replace it, or keep
   * it and change only its dates). Everything else (publishing, modules,
   * other dates, a note for one class) is folded away. */
  P.renderMain = function () {
    var st = this.state;
    var self = this;
    var sync = S();
    if (st.results) return this.renderResults();
    var multi = st.items.length !== 1;
    var html = '';
    if (multi) {
      html += '<div class="cgp-sections__chips">' + st.items.map(function (it) {
        return '<span class="cgp-sections__chip">' + esc(sync.TYPES[it.type].label) + ' · ' + esc(it.title || '(untitled)') +
          (st.running ? '' : ' <button type="button" class="cgp-sections__x" aria-label="Remove" data-remove="' + esc(itemKey(it)) + '">×</button>') + '</span>';
      }).join('') +
        (st.running ? '' : '<button type="button" class="cgp-board__link" data-act="pick">+ Add items</button>') + '</div>';
      if (!st.items.length) return html;
    }
    if (st.surveying) return html + '<p class="cgp-stats__note" role="status">Checking your other classes…</p>';
    if (st.surveyError) return html + '<p class="cgp-sections__err">' + esc(st.surveyError) + ' <button type="button" class="cgp-roster__btn" data-act="resurvey">Try again</button></p>';
    if (!st.survey) return html;

    html += '<div class="cgp-sections__classes">' + st.dests.map(function (d) { return self.renderClass(d); }).join('') + '</div>';

    var extra = [];
    st.items.forEach(function (it) {
      if (it.newQuiz) extra.push('“' + (it.title || '') + '” is a New Quiz: its questions take Canvas a few extra minutes.');
      if (it.hasOverrides) extra.push('“' + (it.title || '') + '” has dates for particular students here; copies get only the dates shown.');
    });
    if (extra.length) html += '<p class="cgp-stats__note">' + esc(extra.join(' ')) + '</p>';

    html += '<details class="cgp-sections__options"><summary>Options</summary><div class="cgp-sections__options-body">' +
      '<label class="cgp-roster__field">Publishing <select data-role="publish"' + (st.running ? ' disabled' : '') + '>' +
      [['match', 'Same as this class'], ['unpublished', 'Leave copies unpublished'], ['published', 'Publish copies']].map(function (o) {
        return '<option value="' + o[0] + '"' + (st.publish === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="cgp-roster__choice"><input type="checkbox" data-role="modules"' + (st.placeInModules ? ' checked' : '') + (st.running ? ' disabled' : '') +
      '> Put new copies in the same module</label>' +
      '<div class="cgp-roster__row">' +
      (multi ? '' : '<button type="button" class="cgp-roster__btn" data-act="pick"' + (st.running ? ' disabled' : '') + '>Add more items…</button>') +
      '<button type="button" class="cgp-roster__btn" data-act="edit-link"' + (st.running ? ' disabled' : '') + '>Change your classes…</button>' +
      (this.openBoard ? '<button type="button" class="cgp-roster__btn" data-act="compare"' + (st.running ? ' disabled' : '') + '>Compare all items…</button>' : '') +
      '</div><p class="cgp-stats__note">Times are in ' + esc(st.tz || 'your computer’s time zone') + '.</p></div></details>';

    var plan = this.planSummary();
    html += '<div class="cgp-roster__row cgp-roster__actions cgp-sections__go">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="run"' + (plan.count && !plan.errors.length && !st.running ? '' : ' disabled') + '>' +
      esc(plan.label) + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="close"' + (st.running ? ' disabled' : '') + '>Cancel</button>' +
      '<span class="cgp-stats__note" data-plan-text>' + esc(plan.errors.length ? plan.errors[0] : plan.text) + '</span></div>';
    return html;
  };

  /* What a class has now, in a few words, and how it looks. */
  function pill(info, it) {
    var s = info.status || 'new';
    if (info.lookalike && !info.destId) return { text: 'Has its own “' + info.lookalike.title + '”', tone: 'muted' };
    if (s === 'new') return { text: 'Not there yet', tone: 'miss' };
    if (s === 'restore') return { text: 'Deleted there', tone: 'miss' };
    if (s === 'same') return { text: 'Same', tone: 'ok' };
    if (it.type === 'module' && info.drift && info.drift.missing.length && s === 'stale') {
      return { text: 'Missing ' + info.drift.missing.length + (info.drift.missing.length === 1 ? ' item' : ' items'), tone: 'edit' };
    }
    // Older, newer or unknown: one word, and what differs when it is known.
    // Which is newer shows on the cards.
    if (info.destHtml !== undefined && it.html !== undefined) {
      var w = versionDiff({ html: it.html, title: it.title, settings: it.settings, who: '' },
        { html: info.destHtml, title: info.destTitle, settings: info.destSettings, who: '' }).what;
      if (w.length) return { text: 'Different: ' + w.join(', '), tone: 'edit' };
    }
    return { text: 'Different', tone: 'edit' };
  }

  /* Does this (item, class) choose by the two version cards? */
  function hasCards(it, info) {
    var t = S().TYPES[it.type];
    return !!(info && info.destId && info.status !== 'restore' && t && t.body && it.type !== 'module' && info.destHtml !== undefined &&
      (info.status === 'stale' || info.status === 'edited' || info.status === 'differs'));
  }

  /* Can this (item, class) be copied at all, and does it start ticked? */
  function blocked(st, it, d) {
    var info = surveyInfo(st, it, d);
    var dest = destOf(st, d);
    return !!((dest && dest.error) || (info && info.lookalike && !info.destId));
  }

  P.renderClass = function (d) {
    var st = this.state;
    var self = this;
    var name = this.courseName(d);
    var dest = destOf(st, d);
    if (dest && dest.error) {
      return '<div class="cgp-sections__class is-off"><div class="cgp-sections__class-head"><input type="checkbox" disabled> <strong>' + esc(name) + '</strong>' +
        '<span class="cgp-sections__err">' + esc(dest.error) + '</span></div></div>';
    }
    var multi = st.items.length > 1;
    var keys = st.items.map(function (it) { return cellKey(it, d); });
    var on = keys.filter(function (k) { return st.include[k]; }).length;
    var head = '<label class="cgp-sections__class-head"><input type="checkbox" data-class="' + esc(d) + '"' + (on ? ' checked' : '') + (st.running ? ' disabled' : '') +
      '> <strong>' + esc(name) + '</strong>';
    if (!multi) {
      var it = st.items[0];
      var p = pill(surveyInfo(st, it, d) || {}, it);
      return '<div class="cgp-sections__class' + (on ? '' : ' is-off') + '">' + head +
        '<span class="cgp-sections__pill is-' + p.tone + '">' + esc(p.text) + '</span></label>' +
        this.renderLine(it, d, false) + '</div>';
    }
    var adjust = '';
    var datedRows = 0;
    st.items.forEach(function (it) { datedRows += dated(it).length; });
    if (on && datedRows > 1) {
      var a = st.adjust[d] || {};
      adjust = '<details class="cgp-sections__more"><summary>Move all of ' + esc(name) + '’s dates</summary><div class="cgp-sections__adjust" data-dest="' + esc(d) + '">' +
        '<label>Shift <input type="number" step="1" class="cgp-sections__days" data-adjust="days" value="' + esc(a.days || '') + '" placeholder="0"> days</label>' +
        '<label>Due time <input type="text" class="cgp-sections__time" data-adjust="time" value="' + esc(a.time || '') + '" placeholder="e.g. 1:45 pm"></label>' +
        '<button type="button" class="cgp-roster__btn" data-act="adjust" data-dest="' + esc(d) + '">Apply</button>' +
        '<button type="button" class="cgp-roster__btn" data-act="reset" data-dest="' + esc(d) + '">Reset</button></div></details>';
    }
    return '<div class="cgp-sections__class' + (on ? '' : ' is-off') + '">' + head +
      '<span class="cgp-sections__pill is-muted">' + (on ? on + ' of ' + keys.length + ' items' : keys.length + ' items') + '</span></label>' +
      st.items.map(function (it) { return self.renderLine(it, d, true); }).join('') + adjust + '</div>';
  };

  /* One item in one class: (its own tick and status, when several items
   * are copied), the due date, and the question, if there is one. */
  P.renderLine = function (it, d, multi) {
    var st = this.state;
    var sync = S();
    var t = sync.TYPES[it.type];
    var info = surveyInfo(st, it, d) || {};
    var k = cellKey(it, d);
    var on = !!st.include[k];
    var existing = !!(info.destId && info.status !== 'restore');
    var head = '';
    if (multi) {
      var p = pill(info, it);
      head = '<label class="cgp-sections__line-head"><input type="checkbox" data-include="' + esc(k) + '"' + (on ? ' checked' : '') + (st.running ? ' disabled' : '') + '> ' +
        '<span class="cgp-sections__line-title">' + esc(it.title || '(untitled)') + '</span>' +
        '<span class="cgp-sections__pill is-' + p.tone + '">' + esc(p.text) + '</span></label>';
    }
    var notes = [];
    if (info.lookalike && !info.destId) notes.push('<span class="cgp-sections__warn">It wasn’t copied from here, so copying adds a second one.</span>');
    if (!on) return '<div class="cgp-sections__line is-off">' + head + (notes.length ? '<div class="cgp-sections__detail">' + notes.join(' ') + '</div>' : '') + '</div>';

    var different = existing && (info.status === 'edited' || info.status === 'differs');
    var rep = st.replace[k];
    // Shown inside the two versions instead, for a class that has its own.
    var cards = hasCards(it, info);
    if (info.diffs && info.diffs.length && !cards) notes.push(esc(info.diffs.join(' · ')) + '.');
    if (it.type === 'module' && info.drift && info.drift.missing.length && info.status === 'stale') {
      notes.push('Adds ' + esc(info.drift.missing.slice(0, 4).join(', ')) + (info.drift.missing.length > 4 ? '…' : '') + '.');
    }
    if (it.type === 'module' && info.changedChildren && info.changedChildren.length) {
      notes.push('Edited there: ' + esc(info.changedChildren.join(', ')) + '. Replacing the module replaces ' + (info.changedChildren.length === 1 ? 'it' : 'them') + '.');
    }
    if (info.origin && existing && (rep || !different) && info.status !== 'same' && !cards) {
      notes.push('Updates its title' + (it.type === 'assignment' ? ', instructions and settings' : ' and instructions') + '.');
    }
    if (!existing && info.moduleWanted && st.placeInModules && !info.module) {
      notes.push('<span class="cgp-sections__warn">There is no module “' + esc(info.moduleWanted) + '” there.</span>');
    }
    if (!existing && info.groupMissing) {
      notes.push('<span class="cgp-sections__warn">No “' + esc(info.groupMissing) + '” assignment group there; Canvas uses “Imported Assignments”.</span>');
    }
    var choice = '';
    if (cards) {
      // Both versions, side by side: click the one this class should have.
      var newerHere = info.status === 'stale', newerThere = info.status === 'edited';
      var va = { who: this.courseName(this.courseId), here: true, title: it.title, html: it.html, settings: it.settings, newer: newerHere };
      var vb = { who: this.courseName(d), title: info.destTitle, html: info.destHtml, settings: info.destSettings, updatedAt: info.destUpdatedAt, newer: newerThere };
      var vd = versionDiff(va, vb);
      choice = '<div class="cgp-sections__pickver"><span class="cgp-sections__pickver-q">Which version should both classes have?</span>' +
        vd.lines.map(function (l) { return '<span class="cgp-sections__pickver-key">' + esc(l) + '</span>'; }).join('') +
        versionCards({
          a: va, b: vb, question: 'Which version should both classes have?',
          picked: rep === null || rep === undefined ? null : (rep ? 'a' : 'b'), name: 'rep-' + k, compact: !(st.expanded && st.expanded[k]),
          attrs: function (side) { return 'data-replace="' + esc(k) + '" value="' + (side === 'a' ? '1' : '0') + '"' + (st.running ? ' disabled' : ''); }
        }) +
        '<button type="button" class="cgp-board__link" data-act="expand-ver" data-key="' + esc(k) + '">' + (st.expanded && st.expanded[k] ? 'Show less' : 'Show the full text') + '</button>' +
        '<span class="cgp-sections__reassure">Dates and student work stay as they are.</span></div>';
    } else if (different && !st.running) {
      choice = '<div class="cgp-sections__choice" role="radiogroup">' +
        '<label><input type="radio" name="rep-' + esc(k) + '" data-replace="' + esc(k) + '" value="1"' + (rep ? ' checked' : '') + '> Replace with this version</label>' +
        '<label><input type="radio" name="rep-' + esc(k) + '" data-replace="' + esc(k) + '" value="0"' + (rep ? '' : ' checked') + '> Keep theirs, change only the dates</label></div>';
    }
    // The first date of the item itself in view; the rest folded.
    var rows = dated(it);
    var first = '';
    var more = [];
    rows.forEach(function (row, i) {
      var rk = k + '|' + itemKey(row);
      var vals = st.cells[rk] || {};
      var fields = sync.dateFields(row).map(function (f) {
        return '<label class="cgp-sections__date"><span>' + esc(sync.DATE_LABELS[f]) + '</span>' +
          '<input type="datetime-local" data-cell="' + esc(rk) + '" data-field="' + f + '" value="' + esc(vals[f] || '') + '"' + (st.running ? ' disabled' : '') + '></label>';
      });
      var check = sync.checkDates(vals, st.tz);
      var err = '<span class="cgp-sections__err" data-row-err="' + esc(rk) + '">' + esc(check.errors.join('; ')) + '</span>';
      if (i === 0 && row === it) {
        first = '<div class="cgp-sections__daterow" data-row="' + esc(rk) + '">' + fields[0] + err + '</div>';
        if (fields.length > 1) more.push({ html: '<div class="cgp-sections__daterow">' + fields.slice(1).join('') + '</div>', open: !!check.errors.length });
      } else {
        more.push({ html: '<div class="cgp-sections__daterow" data-row="' + esc(rk) + '"><span class="cgp-sections__child">' + esc(row.title || '') + '</span>' + fields.join('') + err + '</div>', open: !!check.errors.length });
      }
    });
    if (t.body && !info.origin) {
      var nv = st.notes[k] || '';
      more.push({ html: '<label class="cgp-sections__note"><span>Note for this class only' + (nv ? '' : ' (optional)') + '</span>' +
        '<textarea rows="2" data-note="' + esc(k) + '" placeholder="Shown at the top of the instructions in this class only.">' + esc(nv) + '</textarea></label>', open: !!nv });
    }
    var withNote = !!(t.body && !info.origin);
    var moreDates = more.length - (withNote ? 1 : 0);
    var moreLabel = moreDates ? (first ? 'More dates' : 'Dates') + (withNote ? ' and a note' : '') : 'Add a note for this class';
    var moreHtml = more.length ? '<details class="cgp-sections__more"' + (more.some(function (x) { return x.open; }) ? ' open' : '') + '><summary>' + moreLabel + '</summary>' +
      more.map(function (x) { return x.html; }).join('') + '</details>' : '';
    return '<div class="cgp-sections__line">' + head +
      (notes.length ? '<div class="cgp-sections__detail">' + notes.join(' ') + '</div>' : '') +
      choice + '<div class="cgp-sections__dates">' + first + moreHtml + '</div></div>';
  };

  P.renderResults = function () {
    var st = this.state;
    var self = this;
    var lines = st.results.map(function (r, idx) {
      var res = r.result;
      var icon = !res ? '…' : (res.ok ? (res.warnings.length ? '!' : '✓') : (res.pending ? '…' : '×'));
      var cls = !res ? 'is-run' : (res.ok ? (res.warnings.length ? 'is-warn' : 'is-ok') : (res.pending ? 'is-run' : 'is-err'));
      // In the teacher's Canvas time zone, as the date boxes are.
      var due = r.task.dates && r.task.dates.due_at ? ', due ' + fmtWhen(r.task.dates.due_at, st.tz) : '';
      var detail = !res ? esc(r.step || 'Waiting') : (res.error ? esc(res.error) : (res.ok
        ? (r.task.pull ? 'both classes now have its version' + esc(due) : (r.task.mode === 'keep' ? 'dates updated' + esc(due) : 'copied' + esc(due))) : ''));
      var link = res && res.url ? ' <a href="' + esc(res.url) + '" target="_blank" rel="noopener">Open</a>' : '';
      if (res && res.ok && res.undo && !st.running) {
        link += ' <button type="button" class="cgp-board__link" data-act="undo-one" data-idx="' + idx + '"' + (r.undone ? ' disabled' : '') + '>' + (r.undone ? 'Undone' : 'Undo') + '</button>';
      }
      var warns = res && res.warnings.length ? '<ul>' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '';
      return '<li class="cgp-sections__result ' + cls + '"><span class="cgp-sections__icon">' + icon + '</span><div><strong>' +
        esc(self.courseName(r.task.destCourseId)) + '</strong>' + (st.items.length > 1 ? ' · ' + esc(r.task.item.title || '') : '') + ' — ' + detail + link + warns + '</div></li>';
    }).join('');
    var head = '';
    if (!st.running) {
      var bad = st.results.filter(function (r) { return !r.result || !r.result.ok; });
      var names = [];
      st.results.forEach(function (r) { var n = self.courseName(r.task.destCourseId); if (names.indexOf(n) < 0) names.push(n); });
      var list = names.length > 2 ? names.length + ' classes' : names.join(' and ');
      head = bad.length
        ? '<p class="cgp-sections__err cgp-sections__headline" role="status">' + (st.results.length - bad.length) + ' of ' + st.results.length + ' done. See below for what didn’t work.</p>'
        : '<p class="cgp-sections__done" role="status"><span aria-hidden="true">✓</span> Done. ' + esc(list) + (names.length === 1 ? ' is' : ' are') + ' up to date.</p>';
    }
    return '<section class="cgp-roster__section">' + head +
      (st.running ? '<p class="cgp-stats__note" role="status">Copying… Canvas takes a minute or so. You can close this; it keeps going while this page is open.</p>' : '') +
      '<ul class="cgp-sections__results">' + lines + '</ul>' +
      (st.running ? '' : '<div class="cgp-roster__row cgp-roster__actions"><button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="close">Done</button></div>') +
      '</section>';
  };

  /* ------------------------------------------------------------- events */

  P.onClick = function (e) {
    var st = this.state;
    if (!st) return;
    var t = e.target;
    var act = t.closest && t.closest('[data-act]');
    var typeBtn = t.closest && t.closest('[data-pick-type]');
    var rm = t.closest && t.closest('[data-remove]');
    if (typeBtn) { st.picker.type = typeBtn.getAttribute('data-pick-type'); this.render(); return; }
    if (rm && !st.running) {
      var key = rm.getAttribute('data-remove');
      st.items = st.items.filter(function (it) { return itemKey(it) !== key; });
      this.resurvey();
      return;
    }
    if (!act || act.disabled) return;
    var a = act.getAttribute('data-act');
    if (a === 'save-link') return this.saveLink();
    if (a === 'cancel-link') { st.view = 'main'; st.linkDraft = null; this.render(); return; }
    if (a === 'edit-link') { st.view = 'link'; st.linkDraft = null; this.render(); return; }
    if (a === 'pick') { st.view = 'pick'; st.picker.chosen = {}; this.render(); return; }
    if (a === 'pick-cancel') { st.view = 'main'; this.render(); return; }
    if (a === 'pick-done') return this.pickDone();
    if (a === 'open-links' && this.openLinks) return this.openLinks();
    if (a === 'resurvey') return this.resurvey();
    if (a === 'adjust') return this.applyAdjust(act.getAttribute('data-dest'));
    if (a === 'reset') return this.resetDest(act.getAttribute('data-dest'));
    if (a === 'run') return this.runAll();
    if (a === 'undo-one') {
      var ur = st.results && st.results[Number(act.getAttribute('data-idx'))];
      if (!ur || !ur.result || !ur.result.undo || ur.undone) return;
      act.disabled = true;
      var self2 = this;
      this.copier.undoBack(ur.result.undo).then(function () {
        ur.undone = true;
        CGP.ui.toast('Undone.');
        self2.render();
      }, function (err) {
        act.disabled = false;
        CGP.ui.error('Couldn’t undo: ' + CGP.util.describeApiError(err, { fallback: String(err && err.message) }));
      });
      return;
    }
    if (a === 'expand-ver') { st.expanded = st.expanded || {}; st.expanded[act.getAttribute('data-key')] = !st.expanded[act.getAttribute('data-key')]; this.render(); return; }
    if (a === 'compare-one') {
      var ck = act.getAttribute('data-item');
      var cd = act.getAttribute('data-dest');
      var ci = st.items.filter(function (x) { return itemKey(x) === ck; })[0];
      var cinfo = ci && surveyInfo(st, ci, cd);
      if (!ci || !cinfo || !cinfo.destId) return;
      if (cinfo.origin) return this.openMatch({ origCourse: cd, origRef: { type: ci.type, id: cinfo.origin.srcId }, copyCourse: this.courseId, copyId: ci.id }, null);
      return this.openMatch({ origCourse: this.courseId, origRef: ci, copyCourse: cd, copyId: cinfo.destId }, null);
    }
    if (a === 'compare') return this.openBoard();
    if (a === 'close') return this.close();
  };

  P.onChange = function (e) {
    var st = this.state;
    if (!st) return;
    var t = e.target;
    if (t.hasAttribute('data-link')) {
      var id = t.getAttribute('data-link');
      st.linkDraft = st.linkDraft.filter(function (x) { return x !== id; });
      if (t.checked) st.linkDraft.push(id);
      this.render();
      return;
    }
    if (t.hasAttribute('data-pick')) { st.picker.chosen[t.getAttribute('data-pick')] = !!t.checked; this.render(); return; }
    if (t.getAttribute('data-role') === 'publish') { st.publish = t.value; return; }
    if (t.getAttribute('data-role') === 'modules') { st.placeInModules = !!t.checked; this.resurvey(); return; }
    if (t.hasAttribute('data-class')) {
      var dc = t.getAttribute('data-class');
      var single = st.items.length === 1;
      st.items.forEach(function (it) {
        // One item: the class's tick is the item's. Several: a class's own
        // same-titled item is left for its own tick (it would be a second).
        st.include[cellKey(it, dc)] = !!t.checked && (single || !blocked(st, it, dc));
      });
      this.render();
      return;
    }
    if (t.hasAttribute('data-include')) { st.include[t.getAttribute('data-include')] = !!t.checked; this.render(); return; }
    if (t.hasAttribute('data-replace')) { st.replace[t.getAttribute('data-replace')] = t.value === '1'; this.render(); return; }
    if (t.hasAttribute('data-cell')) { this.setCell(t); this.refreshValidity(); return; }
  };

  P.onInput = function (e) {
    var st = this.state;
    if (!st) return;
    var t = e.target;
    if (t.hasAttribute('data-note')) { st.notes[t.getAttribute('data-note')] = t.value; return; }
    if (t.hasAttribute('data-cell')) { this.setCell(t); this.refreshValidity(); return; }
    if (t.hasAttribute('data-adjust')) {
      var d = t.closest('[data-dest]').getAttribute('data-dest');
      st.adjust[d] = st.adjust[d] || {};
      st.adjust[d][t.getAttribute('data-adjust')] = t.value;
      return;
    }
    var role = t.getAttribute('data-role');
    if (role === 'link-filter' || role === 'pick-filter') {
      if (role === 'link-filter') st.linkFilter = t.value; else st.picker.q = t.value;
      var pos = t.selectionStart;
      this.render();
      var again = this.root.querySelector('[data-role="' + role + '"]');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } }
    }
  };

  /* After a date box changes: that row's problems and the Copy button,
   * without redrawing (which would take the focus out of the box). */
  P.refreshValidity = function () {
    var st = this.state;
    if (!this.root || !st) return;
    var sync = S();
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-row-err]'), function (err) {
      err.textContent = sync.checkDates(st.cells[err.getAttribute('data-row-err')] || {}, st.tz).errors.join('; ');
    });
    var go = this.root.querySelector('.cgp-sections__go');
    if (!go) return;
    var plan = this.planSummary();
    var btn = go.querySelector('[data-act="run"]');
    if (btn) {
      btn.disabled = !(plan.count && !plan.errors.length && !st.running);
      btn.textContent = plan.label;
    }
    var note = go.querySelector('[data-plan-text]');
    if (note) note.textContent = plan.errors.length ? plan.errors[0] : plan.text;
  };

  P.setCell = function (input) {
    var rk = input.getAttribute('data-cell');
    var f = input.getAttribute('data-field');
    this.state.cells[rk] = this.state.cells[rk] || {};
    this.state.cells[rk][f] = input.value;
  };

  P.saveLink = function () {
    var self = this;
    var st = this.state;
    var ids = [this.courseId].concat(st.linkDraft);
    var names = {};
    ids.forEach(function (id) { names[id] = self.courseName(id); });
    var next = S().setGroup(this.settings.values.sectionGroups, this.origin, ids, names);
    this.settings.save({ sectionGroups: next }).then(function () {
      if (self.state !== st) return;
      st.dests = self.siblings();
      if (ids.length >= 2 && !st.dests.length) {
        CGP.ui.error('Those classes could not be saved: the list of class groups is full. Remove old ones in the options page.');
      }
      st.linkDraft = null;
      st.view = !st.dests.length ? 'link' : (st.wantPick && !st.items.length ? 'pick' : 'main');
      st.tickDests = null;
      st.cells = {}; st.seed = {}; st.include = {}; st.replace = {}; st.notes = {};
      self.render();
      self.resurvey();
    }, function (err) {
      CGP.ui.error('Couldn’t save your classes: ' + String(err && err.message));
    });
  };

  P.pickDone = function () {
    var st = this.state;
    var chosen = st.picker.chosen;
    Object.keys(st.picker.lists).forEach(function (type) {
      (st.picker.lists[type] || []).forEach(function (it) {
        if (chosen[itemKey(it)] && !st.items.some(function (x) { return itemKey(x) === itemKey(it); })) st.items.push(it);
      });
    });
    st.view = 'main';
    // Opened from Compare classes, only the pairs ticked there started
    // ticked; items added now start as they would anywhere else.
    st.only = null;
    this.resurvey();
  };

  P.applyAdjust = function (d) {
    var st = this.state;
    var sync = S();
    var a = st.adjust[d] || {};
    var days = Math.round(Number(a.days || 0)) || 0;
    var clock = a.time ? sync.parseClock(a.time) : null;
    if (a.time && !clock) { CGP.ui.error('“' + a.time + '” is not a time.'); return; }
    st.items.forEach(function (it) {
      dated(it).forEach(function (row) {
        var rk = cellKey(it, d) + '|' + itemKey(row);
        var base = {};
        sync.dateFields(row).forEach(function (f) { base[f] = sync.isoToLocal((row.dates || {})[f], st.tz); });
        var out = {};
        Object.keys(base).forEach(function (f) {
          var v = base[f];
          if (v && days) v = sync.shiftLocal(v, days);
          if (v && clock && (f === 'due_at' || (f === 'delayed_post_at'))) v = sync.withTime(v, clock);
          out[f] = v;
        });
        st.cells[rk] = out;
      });
    });
    this.render();
  };

  P.resetDest = function (d) {
    var st = this.state;
    st.adjust[d] = {};
    var sync = S();
    st.items.forEach(function (it) {
      dated(it).forEach(function (row) {
        var rk = cellKey(it, d) + '|' + itemKey(row);
        st.cells[rk] = {};
        sync.dateFields(row).forEach(function (f) { st.cells[rk][f] = sync.isoToLocal((st.seed[rk] || {})[f], st.tz); });
      });
    });
    this.render();
  };

  /* ------------------------------------------------------------ the run */

  /* Every (item, section) the teacher left ticked, as runner tasks - or the
   * first reason the set cannot run yet. */
  P.buildTasks = function () {
    var st = this.state;
    var sync = S();
    var self = this;
    var tasks = [];
    var errors = [];
    var pulled = {};
    st.items.forEach(function (it) {
      st.dests.forEach(function (d) {
        var dest = destOf(st, d);
        var k = cellKey(it, d);
        if (!dest || dest.error || !st.include[k]) return;
        var info = surveyInfo(st, it, d) || {};
        var existing = !!(info.destId && info.status !== 'restore');
        if (existing && st.replace[k] === null) {
          errors.push('Pick a version for ' + self.courseName(d) + (st.items.length > 1 ? ' (“' + (it.title || '') + '”)' : '') + '.');
        }
        var mode = existing && !st.replace[k] ? 'keep' : 'copy';
        // The other class's version picked on the cards: it stays there
        // (dates only), and this class gets it too, so both match.
        var pull = mode === 'keep' && hasCards(it, info) ? (info.origin
          ? { origCourse: String(d), origRef: { type: it.type, id: info.origin.srcId }, copyCourse: self.courseId, copyId: it.id }
          : { origCourse: self.courseId, origRef: it, copyCourse: String(d), copyId: info.destId }) : null;
        if (pull) {
          if (pulled[itemKey(it)]) errors.push('“' + (it.title || '') + '”: pick one class’s version to bring here, not two.');
          pulled[itemKey(it)] = true;
        }
        var dates = {};
        var children = [];
        dated(it).forEach(function (row) {
          var vals = st.cells[k + '|' + itemKey(row)] || {};
          var check = sync.checkDates(vals, st.tz);
          if (check.errors.length) errors.push(self.courseName(d) + ', “' + (row.title || '') + '”: ' + check.errors[0] + '.');
          var iso = {};
          var seed = st.seed[k + '|' + itemKey(row)] || {};
          sync.dateFields(row).forEach(function (f) {
            if (check.iso[f] === undefined || check.iso[f] === null) { iso[f] = null; return; }
            var kept = sync.localToIsoKeeping(vals[f], st.tz, seed[f]);
            if (kept === check.iso[f]) kept = sync.localToIsoKeeping(vals[f], st.tz, (row.dates || {})[f]);
            iso[f] = kept;
          });
          if (row === it) dates = iso;
          else children.push({ type: row.type, id: row.id, title: row.title, graded: !!row.graded, dates: iso });
        });
        var fresh = info.status === 'new' || !info.status;
        tasks.push({
          srcCourseId: self.courseId, destCourseId: String(d), destName: self.courseName(d),
          item: it, mode: mode, dates: dates, children: children,
          note: st.notes[k] || '', publish: st.publish,
          module: fresh && st.placeInModules ? info.module : null,
          assignmentGroupId: fresh ? info.assignmentGroupId : null,
          destId: info.destId || null,
          // That class has the item this one was copied from: it is updated
          // by writing onto it (copier.runBack), never copied back.
          origin: info.origin ? true : undefined,
          pull: pull || undefined,
          mapping: (dest && dest.mapping) || {},
          childNotes: info.childNotes || {}
        });
      });
    });
    return { tasks: tasks, errors: errors };
  };

  /* What the Copy button will do, in words, before it is pressed. */
  P.planSummary = function () {
    var st = this.state;
    var b = this.buildTasks();
    var kinds = { 'new': 0, restore: 0, replace: 0, keep: 0, pull: 0 };
    b.tasks.forEach(function (t) {
      var info = surveyInfo(st, t.item, t.destCourseId) || {};
      var k = t.pull ? 'pull' : t.mode === 'keep' ? 'keep' : (!t.destId || !info.status || info.status === 'new' ? 'new' : (info.status === 'restore' ? 'restore' : 'replace'));
      t.kind = k;
      kinds[k]++;
    });
    var classes = {};
    b.tasks.forEach(function (t) { classes[t.destCourseId] = true; });
    var ids = Object.keys(classes);
    var nc = ids.length;
    var target = nc === 1 ? this.courseName(ids[0]) : nc + ' classes';
    var text = '';
    if (b.tasks.length === 1) {
      var one = b.tasks[0];
      text = {
        'new': 'Adds it to ' + target + '.',
        restore: 'Puts it back in ' + target + '.',
        replace: 'Replaces ' + target + '’s version.',
        keep: target + ' keeps its version; only its dates change.',
        pull: 'Both classes get ' + target + '’s version.'
      }[one.kind];
    } else if (b.tasks.length) {
      var parts = [];
      if (kinds['new']) parts.push(kinds['new'] + ' new');
      if (kinds.restore) parts.push(kinds.restore + ' put back');
      if (kinds.replace) parts.push(kinds.replace + ' replaced');
      if (kinds.keep) parts.push(kinds.keep + ' kept (dates only)');
      if (kinds.pull) parts.push(kinds.pull + ' brought here');
      text = parts.join(' · ') + '.';
    }
    var onlyDates = b.tasks.length && kinds.keep === b.tasks.length;
    var unpicked = b.errors.some(function (e) { return e.indexOf('Pick a version') === 0; });
    return {
      count: b.tasks.length, errors: b.errors, text: text,
      label: unpicked ? 'Pick a version first'
        : (b.tasks.length === 1 && kinds.pull ? 'Use ' + target + '’s version in both'
          : (nc ? (onlyDates ? 'Update dates in ' : 'Copy to ') + target : 'Choose a class'))
    };
  };

  /* Another class's version written into this class (ctx as openMatch):
   * onto this class's item when it is the original (with a backup for
   * Undo), else by copying again from the class it was copied from. */
  P.pullHere = function (ctx, onStep) {
    var self = this;
    onStep('Bringing that version here');
    return this.copier.planBack(ctx.origCourse, ctx.origRef, ctx.copyCourse, ctx.copyId).then(function (plan) {
      if (String(ctx.origCourse) === self.courseId) {
        return self.copier.applyBack(plan, { title: true, settings: true }, onStep).then(function (r) {
          r.undo = r.ok ? { origCourse: plan.origCourse, type: plan.type, origId: plan.origId } : null;
          return r;
        });
      }
      return self.matchCopy(plan, onStep);
    }, function (err) {
      return { ok: false, warnings: [], error: CGP.util.describeApiError(err, { fallback: 'Couldn’t read both versions from Canvas' }) };
    });
  };

  P.runAll = function () {
    var self = this;
    var st = this.state;
    var b = this.buildTasks();
    if (b.errors.length || !b.tasks.length || st.running) return;
    st.running = true;
    st.results = b.tasks.map(function (t) { return { task: t, result: null, step: 'Waiting' }; });
    this.render();
    var byTask = new Map();
    st.results.forEach(function (r) { byTask.set(r.task, r); });
    var repaint = CGP.util.rafBatch(function () { if (self.state === st) self.render(); }, 'sections');
    // A version brought here comes first, so anything copied out after it
    // carries it.
    var pulls = b.tasks.filter(function (t) { return t.pull; }).reduce(function (p, t) {
      return p.then(function () {
        var r = byTask.get(t);
        return self.pullHere(t.pull, function (step) { r.step = step; repaint(); }).then(function (res) { r.pulled = res; });
      });
    }, Promise.resolve());
    // The runner groups them: one Canvas copy per class for everything that
    // can share one, so twenty items into a class is one job there.
    pulls.then(function () {
      return self.copier.runPlan(b.tasks, function (task, step) {
      var r = byTask.get(task);
      if (r) { r.step = step; repaint(); }
      }, function (task, res) {
        var r = byTask.get(task);
        if (!r) return;
        // A version brought here: its outcome is the result that matters.
        if (r.pulled) {
          res = Object.assign({}, res, { warnings: (r.pulled.warnings || []).concat(res.warnings || []), undo: r.pulled.undo || null });
          if (!r.pulled.ok) { res.ok = false; res.error = 'This class was not updated: ' + (r.pulled.error || 'Canvas refused') + '.'; }
        }
        r.result = res;
        repaint();
      });
    }).then(function () {
      st.running = false;
      st.results.forEach(function (r) {
        if (!r.result) r.result = { ok: false, warnings: [], error: 'Not done (something went wrong before it started).' };
      });
      if (self.state === st) self.render();
      var ok = st.results.filter(function (r) { return r.result && r.result.ok; }).length;
      var bad = st.results.length - ok;
      CGP.diag.bump('sections.copied', ok);
      if (bad) CGP.ui.error(ok + ' of ' + st.results.length + ' done. See the list for what needs attention.');
      else CGP.ui.toast('Copied to your other classes (' + ok + ').');
    });
  };

  /* --------------------------------------------- jobs left by a closed tab */

  P.resume = function () {
    var self = this;
    return this.copier.resumePending().then(function (done) {
      if (!done.length) return;
      var ok = done.filter(function (d) { return d.result.ok; });
      var first = done[0];
      if (ok.length === done.length) {
        CGP.ui.toast('Finished copying ' + (done.length === 1 ? '“' + first.job.task.item.title + '” to ' + (first.job.task.destName || 'a class')
          : done.length + ' items to your other classes') + '.');
      } else {
        var bad = done.filter(function (d) { return !d.result.ok; })[0];
        CGP.ui.error('Copying “' + bad.job.task.item.title + '” to ' + (bad.job.task.destName || 'a class') + ' did not finish: ' + (bad.result.error || 'unknown error'));
      }
      CGP.diag.log('sections.resumed', { count: done.length, ok: ok.length });
      self.lastResumed = done;
    });
  };

  CGP.SectionCopyController = SectionCopyController;
})();
