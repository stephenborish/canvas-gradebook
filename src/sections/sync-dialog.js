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
 *     time - a period shortcut such as "3" works - apply to a whole section),
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
    spot.at.insertAdjacentElement(spot.where, btn);
    this.button = btn;
    var self2 = this;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self2.open(spot.kind === 'item' ? null : { pick: true });
    });
    if (spot.kind === 'item' && this.settings.values.sectionCopyNudge) this.checkPage();
  };

  P.unmount = function () {
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

  /* On an item's own page in a linked course, say what the teacher needs to
   * know about its copies, both ways, and offer the fix:
   *  - this item is a copy, and was changed here: bring the change back to
   *    the section it came from;
   *  - the section it came from has a newer version: update this one;
   *  - this item is the original, and a section changed its copy: review
   *    that change and bring it here;
   *  - a section still has the earlier version: copy the new one there;
   *  - a new item (last few hours) is in no other section yet.
   * Reads only, after the page has settled; writes nothing. */
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
          rel.from.forEach(function (r) {
            checks.push(self.copier.compare(r.courseId, { type: item.type, id: r.srcId }, self.courseId, item.id).then(function (c) {
              if (!c.side || c.side === 'same') return;
              notes.push({ kind: 'from', side: c.side, course: r.courseId, srcId: r.srcId, cmp: c });
            }));
          });
          rel.to.forEach(function (r) {
            checks.push(self.copier.compare(self.courseId, item, r.courseId, r.destId).then(function (c) {
              if (!c.side || c.side === 'same') return;
              notes.push({ kind: 'to', side: c.side, course: r.courseId, destId: r.destId, cmp: c });
            }));
          });
          return Promise.all(checks).then(function () {
            var copiedTo = rel.to.map(function (r) { return r.courseId; });
            var missing = sibs.filter(function (d) { return copiedTo.indexOf(String(d)) < 0 && (rel.unreadable || []).indexOf(String(d)) < 0; });
            var fresh = item.createdAt && Date.now() - Date.parse(item.createdAt) <= NUDGE_WINDOW_MS;
            if (fresh && !rel.from.length && missing.length) notes.push({ kind: 'new', courses: missing });
            return self.copier.backups(self.courseId, item.type, item.id).then(function (list) {
              var last = list[0];
              if (last && Date.now() - Number(last.at || 0) < 7 * 86400000) notes.push({ kind: 'undo', course: last.from, backup: last });
              if (notes.length) self.showNotice(item, notes);
            });
          });
        });
      }).catch(function (e) { CGP.diag.warn('sections.checkFailed', { message: String(e && e.message) }); });
    }, 1200);
  };

  function fmtWhen(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    try { return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  P.noticeLine = function (item, n, idx) {
    var name = esc(this.courseName(n.course));
    var thing = esc(S().TYPES[item.type].label.toLowerCase());
    var btn = function (act, label) { return '<button type="button" class="cgp-roster__btn" data-notice="' + act + '" data-idx="' + idx + '">' + label + '</button>'; };
    if (n.kind === 'undo') {
      return '<div class="cgp-sections-notice__line">You brought <strong>' + name + '</strong>’s version here on ' + esc(fmtWhen(new Date(n.backup.at).toISOString())) + '. ' +
        btn('undo', 'Undo that') + '</div>';
    }
    if (n.kind === 'new') {
      return '<div class="cgp-sections-notice__line">This new ' + thing + ' is not in ' + n.courses.length +
        (n.courses.length === 1 ? ' of your other classes' : ' of your other classes') + ' yet. ' +
        '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-notice="copy-new">Copy to other classes…</button></div>';
    }
    var when = n.cmp && n.cmp.orig && n.cmp.copy
      ? ' <span class="cgp-sections-notice__when">(last changed: ' + (n.kind === 'from'
        ? 'here ' + esc(fmtWhen(n.cmp.copy.updatedAt)) + ', in ' + name + ' ' + esc(fmtWhen(n.cmp.orig.updatedAt))
        : 'here ' + esc(fmtWhen(n.cmp.orig.updatedAt)) + ', in ' + name + ' ' + esc(fmtWhen(n.cmp.copy.updatedAt))) + ')</span>'
      : '';
    if (n.kind === 'from') {
      if (n.side === 'copy') return '<div class="cgp-sections-notice__line">You changed this ' + thing + ' here after it was copied from <strong>' + name +
        '</strong>, which still has the earlier version. ' + btn('back-from', 'Review and update ' + name + '…') + '</div>';
      if (n.side === 'original') return '<div class="cgp-sections-notice__line"><strong>' + name + '</strong>, where this was copied from, has a newer version. ' +
        btn('forward-from', 'Update this one from ' + name + '…') + '</div>';
      return '<div class="cgp-sections-notice__line">This ' + thing + ' and <strong>' + name + '</strong>’s version (where it was copied from) differ' +
        (n.side === 'both' ? ': both were changed since it was copied.' : ', and there is no record of which one changed.') + when + ' ' +
        btn('back-from', 'Compare, and update ' + name + '…') + ' ' + btn('forward-from', 'Update this one from ' + name + '…') + '</div>';
    }
    if (n.side === 'copy') return '<div class="cgp-sections-notice__line"><strong>' + name + '</strong> changed its copy of this ' + thing + '. ' +
      btn('back-to', 'Review ' + name + '’s changes…') + '</div>';
    if (n.side === 'original') return '<div class="cgp-sections-notice__line"><strong>' + name + '</strong> still has the earlier version of this ' + thing + '. ' +
      btn('forward-to', 'Copy this version to ' + name + '…') + '</div>';
    return '<div class="cgp-sections-notice__line"><strong>' + name + '</strong>’s copy of this ' + thing + ' differs from this one' +
      (n.side === 'both' ? ': both were changed since it was copied.' : ', and there is no record of which one changed.') + when + ' ' +
      btn('back-to', 'Compare, and bring ' + name + '’s version here…') + ' ' + btn('forward-to', 'Copy this version to ' + name + '…') + '</div>';
  };

  /* The notice sits at the top of the page's content until dismissed. A
   * dismissal lasts until something changes again (it is keyed by what was
   * seen), and only on this computer. */
  P.showNotice = function (item, notes) {
    var self = this;
    var sig = notes.map(function (n) {
      return n.kind + ':' + (n.course || '') + ':' + (n.side || '') + ':' + (n.cmp ? S().fingerprint(n.cmp.orig.html) + S().fingerprint(n.cmp.copy.html) : '') +
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
      var course = n.course;
      if (act === 'dismiss') {
        try { localStorage.setItem(dkey, sig); } catch (er) { /* ignore */ }
        box.remove();
        return;
      }
      if (act === 'copy-new') return self.open({ items: [item] });
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
      if (act === 'forward-to') return self.open({ items: [item], dests: [course] });
      if (act === 'back-to') return self.openBack({ origCourse: self.courseId, origRef: item, copyCourse: course, copyId: n.destId });
      if (act === 'back-from') return self.openBack({ origCourse: course, origRef: { type: item.type, id: n.srcId }, copyCourse: self.courseId, copyId: item.id });
      if (act === 'forward-from') {
        var ctl = new SectionCopyController({ api: self.api, courseId: course, settings: self.settings });
        var src = Object.assign({}, n.cmp.orig, { htmlLoaded: true });
        return ctl.open({ items: [src], dests: [self.courseId] });
      }
    });
  };

  /* -------------------------------------------- bringing a change back */

  /* Review the copy's version against the original's and, on the teacher's
   * say-so, write it onto the original (sync-runner.js applyBack). */
  P.openBack = function (ctx) {
    var self = this;
    this.close();
    var st = this.state = { view: 'back', back: { ctx: ctx, plan: null, error: null, running: false, result: null, step: '', title: false }, courses: null };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Bring a class’s changes back</div><h2 id="cgp-sections-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-sections__body"></div></div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.requestClose(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.requestClose(); });
    root.addEventListener('click', function (e) { self.onBackClick(e); });
    root.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-role') === 'back-title') st.back.title = !!e.target.checked;
    });
    this._onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); self.requestClose(); } };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    this.renderBack();
    CGP.teachingCourseList(this.api).catch(function () { return []; }).then(function (courses) {
      if (self.state !== st) return null;
      st.courses = courses || [];
      self.renderBack();
      return self.copier.planBack(ctx.origCourse, ctx.origRef, ctx.copyCourse, ctx.copyId);
    }).then(function (plan) {
      if (self.state !== st || !plan) return;
      st.back.plan = plan;
      self.renderBack();
    }, function (err) {
      if (self.state !== st) return;
      st.back.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read both versions from Canvas' });
      self.renderBack();
    });
  };

  P.renderBack = function () {
    if (!this.root || !this.state || this.state.view !== 'back') return;
    var b = this.state.back;
    var ctx = b.ctx;
    var from = this.courseName(ctx.copyCourse);
    var to = this.courseName(ctx.origCourse);
    this.root.querySelector('#cgp-sections-title').textContent = from + ' → ' + to;
    var body = this.root.querySelector('.cgp-sections__body');
    if (b.error) { body.innerHTML = '<p class="cgp-sections__err">' + esc(b.error) + '</p>'; return; }
    var plan = b.plan;
    if (!plan) { body.innerHTML = '<p class="cgp-stats__note">Reading both versions…</p>'; return; }
    var sync = S();
    if (b.result) {
      var r = b.result;
      body.innerHTML = '<section class="cgp-roster__section"><h3>' + (r.ok ? 'Updated ' + esc(to) : 'Not updated') + '</h3>' +
        (r.error ? '<p class="cgp-sections__err">' + esc(r.error) + '</p>' : '') +
        (r.warnings.length ? '<ul class="cgp-sections__warnlist">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
        (r.ok ? '<p class="cgp-stats__note">' + esc(to) + ' now has ' + esc(from) + '’s version. Your other classes still have the earlier one until you copy it to them.</p>' : '') +
        '<div class="cgp-roster__row cgp-roster__actions">' +
        (r.ok ? '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="back-forward">Copy it to your other classes…</button>' +
          '<a class="cgp-roster__btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open in ' + esc(to) + '</a>' +
          '<button type="button" class="cgp-roster__btn" data-act="back-undo">Undo</button>' : '') +
        '<button type="button" class="cgp-roster__btn" data-act="close">Close</button></div></section>';
      return;
    }
    var warn = [];
    if (plan.side === 'original' || plan.side === 'both') {
      warn.push(esc(to) + '’s version was also changed since it was copied. Those changes will be replaced (you can undo).');
    } else if (plan.side === 'unknown') {
      warn.push('There is no record of which version changed. Read both before replacing ' + esc(to) + '’s.');
    }
    if (plan.side === 'same' && !plan.titleDiffers) warn.push('The instructions are already the same.');
    var info = ['Links to files, pages and other items are changed to ' + esc(to) + '’s own.'];
    if (plan.missingFiles.length) info.push(plan.missingFiles.length + (plan.missingFiles.length === 1 ? ' file' : ' files') + ' only ' + esc(from) + ' has will be copied into ' + esc(to) + '.');
    if (plan.missingLinks.length) info.push(plan.missingLinks.length + (plan.missingLinks.length === 1 ? ' link points' : ' links point') + ' to something only ' + esc(from) + ' has; ' + (plan.missingLinks.length === 1 ? 'it keeps' : 'they keep') + ' pointing there.');
    if (plan.origNote) info.push(esc(to) + '’s own class note stays; ' + esc(from) + '’s note (if any) does not come along.');
    if (plan.pointsDiffer) info.push('Points differ (' + esc(plan.orig.pointsPossible) + ' in ' + esc(to) + ', ' + esc(plan.copy.pointsPossible) + ' in ' + esc(from) + '). Points are not brought back; change them in ' + esc(to) + ' if needed.');
    info.push('Only the instructions' + (plan.titleDiffers ? ' and title' : '') + ' come back. Settings, rubric and quiz questions changed in ' + esc(from) + ' are not brought back.');
    var text = function (h) { return esc(sync.htmlToText(sync.splitNote(h || '').html, true)) || '<em>(empty)</em>'; };
    body.innerHTML = '<section class="cgp-roster__section">' +
      '<h3>' + esc(sync.TYPES[plan.type].label) + ': ' + esc(plan.orig.title || '') + '</h3>' +
      (warn.length ? '<p class="cgp-sections__warn">' + warn.join(' ') + '</p>' : '') +
      '<div class="cgp-sections__compare">' +
      '<div><div class="cgp-sections__compare-head">' + esc(to) + ' now' + (plan.orig.updatedAt ? ' · ' + esc(fmtWhen(plan.orig.updatedAt)) : '') + '</div><div class="cgp-sections__compare-text">' + text(plan.orig.html) + '</div></div>' +
      '<div><div class="cgp-sections__compare-head">' + esc(from) + '’s version' + (plan.copy.updatedAt ? ' · ' + esc(fmtWhen(plan.copy.updatedAt)) : '') + '</div><div class="cgp-sections__compare-text">' + text(plan.copy.html) + '</div></div>' +
      '</div>' +
      (plan.titleDiffers ? '<label class="cgp-roster__choice"><input type="checkbox" data-role="back-title"' + (b.title ? ' checked' : '') + '> Also change the title to “' + esc(plan.copy.title) + '”</label>' : '') +
      '<ul class="cgp-sections__infolist">' + info.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
      '<p class="cgp-stats__note">A backup of ' + esc(to) + '’s current version is kept on this computer, for Undo.</p>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="back-apply"' + (b.running ? ' disabled' : '') + '>' +
      (b.running ? esc(b.step || 'Working…') : 'Update ' + esc(to) + ' with this version') + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="close"' + (b.running ? ' disabled' : '') + '>Cancel</button></div></section>';
  };

  P.onBackClick = function (e) {
    var self = this;
    var st = this.state;
    if (!st || st.view !== 'back') return;
    var btn = e.target.closest && e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    var a = btn.getAttribute('data-act');
    var b = st.back;
    if (a === 'close') return this.close();
    if (a === 'back-apply' && b.plan && !b.running) {
      b.running = true;
      this.renderBack();
      this.copier.applyBack(b.plan, { title: b.title }, function (step) { b.step = step; self.renderBack(); }).then(function (r) {
        b.running = false;
        b.result = r;
        if (self.state === st) self.renderBack();
        if (r.ok) CGP.ui.toast('Updated ' + self.courseName(b.ctx.origCourse) + '.');
        else CGP.ui.error(r.error || 'Not updated.');
      });
      return;
    }
    if (a === 'back-undo' && b.plan) {
      btn.disabled = true;
      this.copier.undoBack(b.plan).then(function () {
        CGP.ui.toast('Undone: ' + self.courseName(b.ctx.origCourse) + ' is back to its earlier version.');
        self.close();
      }, function (err) {
        btn.disabled = false;
        CGP.ui.error('Couldn’t undo: ' + CGP.util.describeApiError(err, { fallback: String(err && err.message) }));
      });
      return;
    }
    if (a === 'back-forward' && b.plan) {
      var orig = Object.assign({}, b.plan.orig, { type: b.plan.type, id: b.plan.origId, htmlLoaded: false });
      var ctl = b.ctx.origCourse === this.courseId ? this : new SectionCopyController({ api: this.api, courseId: b.ctx.origCourse, settings: this.settings });
      this.close();
      ctl.open({ items: [orig] });
    }
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
   * opts.dests: only these linked sections.
   * opts.pick: no item yet (course home, Modules): go to the picker. */
  P.open = function (opts) {
    var self = this;
    opts = opts || {};
    this.close();
    this.state = {
      items: [], dests: [], courses: null, tz: null, survey: null, surveying: false, surveyError: null,
      cells: {}, seed: {}, notes: {}, include: {}, replace: {}, adjust: {},
      publish: 'match', placeInModules: true, view: 'main', picker: { type: 'assignment', q: '', lists: {}, chosen: {} },
      running: false, results: null, wantPick: !!opts.pick
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Copy to other classes</div><h2 id="cgp-sections-title"></h2></div>' +
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
    this.root.querySelector('#cgp-sections-title').textContent = 'From ' + this.courseName(this.courseId);
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
      st.quick = !st.wantPick && st.items.length === 1 && st.items[0].type === 'assignment';
      if (!st.dests.length) st.view = 'link';
      else if (st.wantPick && !st.items.length) st.view = 'pick';
      self.root.querySelector('#cgp-sections-title').textContent = 'From ' + self.courseName(self.courseId);
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
      var kids = S().moduleChildren(mi);
      return Promise.all(kids.map(function (k) {
        return self.api.sectionItem(self.courseId, k.type, k.id).then(function (o) {
          var full = S().toItem(k.type, o);
          if (full) { k.title = full.title || k.title; k.dates = full.dates; k.graded = full.graded; k.html = full.html; }
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
        if (!(k in st.include)) st.include[k] = !st.quick && !(info && info.lookalike) && !(destOf(st, d) && destOf(st, d).error);
        if (!(k in st.replace)) st.replace[k] = info ? sync.defaultReplace(info.status) : true;
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
  var FOCUS_KEYS = ['data-link', 'data-pick', 'data-include', 'data-replace', 'data-pick-type', 'data-act', 'data-role'];

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
    if (!st.courses) body.innerHTML = '<p class="cgp-stats__note">Loading your courses…</p>';
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
    // First time: what this does (and doesn't) before any choice, and a
    // two-step frame so the list reads as setup, not as the copy itself.
    var first = !linked.length;
    var n = st.linkDraft.length;
    var go = n === 1 ? 'Continue with ' + this.courseName(st.linkDraft[0])
      : n ? 'Continue with these ' + n + ' classes'
        : (linked.length ? 'Stop copying between these classes' : 'Pick at least one class');
    return (first ? this.renderAbout(true) : '') +
      '<section class="cgp-roster__section">' +
      (first ? '<div class="cgp-sections__step">Step 1 of 2</div>' : '') +
      '<h3>Which of your classes are the same course as this one?</h3>' +
      '<p class="cgp-stats__note">Usually your other periods or blocks of it. You choose once; it’s remembered for all of them.</p>' +
      '<input type="search" class="cgp-sections__filter" data-role="link-filter" placeholder="Filter your classes…" value="' + esc(st.linkFilter || '') + '">' +
      '<div class="cgp-sections__courses">' + (rows || '<p class="cgp-stats__note">No other courses where you teach.</p>') + '</div>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="save-link"' + (n || linked.length ? '' : ' disabled') + '>' + esc(go) + '</button>' +
      (linked.length ? '<button type="button" class="cgp-roster__btn" data-act="cancel-link">Cancel</button>' : '') +
      '<span class="cgp-stats__note">Nothing is copied yet.</span>' +
      '</div></section>';
  };

  /* What Copy to other classes does and does not do, in four lines a
   * teacher can check against what they expect: shown open the first time,
   * folded away (one click) after that. */
  P.renderAbout = function (open) {
    var lines = [
      ['yes', 'Makes a copy of what you pick in each class you choose, with that class’s own dates.'],
      ['yes', 'Shows what will happen in each class first. Nothing changes until you press Copy.'],
      ['no', 'Doesn’t copy students, grades or submissions, and doesn’t change this class.'],
      ['no', 'Doesn’t keep copies in sync: a later edit stays in the class where you make it.']
    ];
    var list = '<ul class="cgp-sections__about-list">' + lines.map(function (l) {
      return '<li class="is-' + l[0] + '"><span class="cgp-sections__about-mark" aria-hidden="true">' + (l[0] === 'yes' ? '✓' : '✕') + '</span>' +
        '<span><span class="cgp-sections__sr">' + (l[0] === 'yes' ? 'Does: ' : 'Does not: ') + '</span>' + esc(l[1]) + '</span></li>';
    }).join('') + '</ul>';
    if (open) return '<div class="cgp-sections__about">' + list + '</div>';
    return '<details class="cgp-sections__about cgp-sections__about--folded"><summary>What this does — and doesn’t</summary>' + list + '</details>';
  };

  P.renderPicker = function () {
    var st = this.state;
    var pk = st.picker;
    var sync = S();
    var tabs = PICK_TYPES.map(function (t) {
      return '<button type="button" class="cgp-sections__tab' + (pk.type === t ? ' is-on' : '') + '" data-pick-type="' + t + '">' +
        esc(sync.TYPES[t].plural) + '</button>';
    }).join('');
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
    return '<section class="cgp-roster__section"><h3>Add items to copy</h3>' +
      '<div class="cgp-sections__tabs">' + tabs + '</div>' +
      '<input type="search" class="cgp-sections__filter" data-role="pick-filter" placeholder="Filter…" value="' + esc(pk.q || '') + '">' +
      '<div class="cgp-sections__courses">' + rows + '</div>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="pick-done"' + (n ? '' : ' disabled') + '>Add ' + (n || '') + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="pick-cancel">Cancel</button></div></section>';
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

  P.renderMain = function () {
    var st = this.state;
    var self = this;
    var sync = S();
    if (st.results) return this.renderResults();
    if (st.quick && st.items.length === 1) return this.renderQuick();

    var items = st.items.map(function (it) {
      return '<span class="cgp-sections__chip">' + esc(sync.TYPES[it.type].label) + ' · ' + esc(it.title || '(untitled)') +
        (st.running ? '' : ' <button type="button" class="cgp-sections__x" aria-label="Remove" data-remove="' + esc(itemKey(it)) + '">×</button>') + '</span>';
    }).join('');
    var dests = st.dests.map(function (d) {
      return '<span class="cgp-sections__chip cgp-sections__chip--to">' + esc(self.courseName(d)) + '</span>';
    }).join('');

    var html = this.renderAbout(false) +
      '<section class="cgp-roster__section"><h3>What to copy</h3>' +
      '<div class="cgp-sections__chips">' + (items || '<span class="cgp-stats__note">Nothing chosen yet.</span>') + '</div>' +
      '<div class="cgp-roster__row"><button type="button" class="cgp-roster__btn" data-act="pick"' + (st.running ? ' disabled' : '') + '>Add items…</button></div></section>' +
      '<section class="cgp-roster__section"><h3>Into</h3>' +
      '<div class="cgp-sections__flow"><span class="cgp-sections__chip cgp-sections__chip--from" title="Stays as it is">' + esc(this.courseName(this.courseId)) +
      '</span><span class="cgp-sections__arrow" aria-label="copied into">→</span><div class="cgp-sections__chips">' + dests + '</div></div>' +
      '<div class="cgp-roster__row"><button type="button" class="cgp-roster__btn" data-act="edit-link"' + (st.running ? ' disabled' : '') + '>Change classes…</button>' +
      '<label class="cgp-roster__field">Publishing <select data-role="publish"' + (st.running ? ' disabled' : '') + '>' +
      [['match', 'Same as here'], ['unpublished', 'Leave copies unpublished'], ['published', 'Publish copies']].map(function (o) {
        return '<option value="' + o[0] + '"' + (st.publish === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="cgp-roster__choice"><input type="checkbox" data-role="modules"' + (st.placeInModules ? ' checked' : '') + (st.running ? ' disabled' : '') +
      '> Put new copies in the matching module</label></div></section>';

    if (!st.items.length) return html;
    if (st.surveying) return html + '<p class="cgp-stats__note cgp-sections__busy">Checking your sections…</p>';
    if (st.surveyError) return html + '<p class="cgp-stats__note cgp-sections__err">' + esc(st.surveyError) + ' <button type="button" class="cgp-roster__btn" data-act="resurvey">Try again</button></p>';
    if (!st.survey) return html;

    html += '<section class="cgp-roster__section"><h3>Dates in each class</h3>' +
      '<p class="cgp-stats__note">Times are in ' + esc(st.tz || 'your computer’s time zone') + ', as Canvas shows them. ' +
      'Each class starts with the dates this one has. To move a whole class, shift its dates by days or set its due time ' +
      '(a time, or one of your period shortcuts such as 1–4).</p>' +
      st.dests.map(function (d) { return self.renderAdjust(d); }).join('') + '</section>';

    html += st.items.map(function (it) { return self.renderItem(it); }).join('');

    var plan = this.planSummary();
    html += '<div class="cgp-roster__row cgp-roster__actions cgp-sections__go">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="run"' + (plan.count && !plan.errors.length && !st.running ? '' : ' disabled') + '>' +
      esc(plan.label) + '</button>' +
      '<span class="cgp-stats__note">' + esc(plan.errors.length ? plan.errors[0] : plan.text) + '</span></div>';
    return html;
  };

  /* A saved assignment needs a destination, not the bulk-copy workspace.
   * Reuse the surveyed rows and task builder: compact presentation must not
   * bypass changed-copy checks, existing dates, or duplicate protection. */
  P.renderQuick = function () {
    var st = this.state;
    var html = '<p class="cgp-stats__note">Choose the class to receive this assignment. Adjust its due date if needed.</p>' +
      '<div class="cgp-roster__row"><button type="button" class="cgp-roster__btn" data-act="edit-link">Change classes…</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="advanced-copy">More options…</button></div>';
    if (st.surveying) return html + '<p class="cgp-stats__note" role="status">Checking existing copies…</p>';
    if (st.surveyError) return html + '<p class="cgp-sections__err">' + esc(st.surveyError) +
      ' <button type="button" class="cgp-roster__btn" data-act="resurvey">Try again</button></p>';
    if (!st.survey) return html;
    html += '<p class="cgp-stats__note">Times: ' + esc(st.tz || 'your computer’s time zone') + '</p>' + this.renderItem(st.items[0]);
    // Failed destinations remain visible even though they have no editable row.
    st.dests.forEach(function (d) {
      var dest = destOf(st, d);
      if (dest && dest.error) html += '<p class="cgp-sections__err">' + esc(this.courseName(d)) + ': ' + esc(dest.error) + '</p>';
    }, this);
    var plan = this.planSummary();
    return html + '<div class="cgp-roster__row cgp-roster__actions cgp-sections__go">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="run"' +
      (plan.count && !plan.errors.length && !st.running ? '' : ' disabled') + '>' + esc(plan.label) + '</button>' +
      '<span class="cgp-stats__note">' + esc(plan.errors.length ? plan.errors[0] : (plan.count ? plan.text : 'Choose a destination class.')) + '</span></div>';
  };

  P.renderAdjust = function (d) {
    var a = this.state.adjust[d] || {};
    var dest = destOf(this.state, d);
    if (dest && dest.error) {
      return '<div class="cgp-sections__adjust"><strong>' + esc(this.courseName(d)) + '</strong> <span class="cgp-sections__err">' + esc(dest.error) + '</span></div>';
    }
    return '<div class="cgp-sections__adjust" data-dest="' + esc(d) + '"><strong>' + esc(this.courseName(d)) + '</strong>' +
      '<label>Shift <input type="number" step="1" class="cgp-sections__days" data-adjust="days" value="' + esc(a.days || '') + '" placeholder="0"> days from here</label>' +
      '<label>Due time <input type="text" class="cgp-sections__time" data-adjust="time" value="' + esc(a.time || '') + '" placeholder="e.g. 3 or 1:45 pm"></label>' +
      '<button type="button" class="cgp-roster__btn" data-act="adjust" data-dest="' + esc(d) + '">Apply</button>' +
      '<button type="button" class="cgp-roster__btn" data-act="reset" data-dest="' + esc(d) + '" title="Back to the dates the boxes started with">Reset</button></div>';
  };

  var STATUS_TEXT = {
    'new': 'Not there yet — a copy will be made.',
    restore: 'It was deleted there — copying brings it back.',
    same: 'Already there with the same instructions — its copy is updated, not duplicated.',
    stale: 'Already there, from an earlier version — its copy is updated, not duplicated.',
    edited: 'Already there, and someone changed its instructions there since it was copied.',
    differs: 'Already there, with different instructions from the ones here.'
  };

  P.renderItem = function (it) {
    var st = this.state;
    var self = this;
    var sync = S();
    var t = sync.TYPES[it.type];
    var rows = st.dests.map(function (d) {
      var dest = destOf(st, d);
      if (dest && dest.error) return '';
      var info = surveyInfo(st, it, d) || {};
      var k = cellKey(it, d);
      var on = !!st.include[k];
      var existing = info.destId && info.status !== 'restore';
      var status = STATUS_TEXT[info.status || 'new'] || '';
      if (!on && (info.status || 'new') === 'new') status = 'Not there yet. Skipped.';
      if (existing && dated(it).length) status += ' Its dates below are the ones it has there now.';
      if (it.type === 'module' && info.changedChildren && info.changedChildren.length) {
        status = 'Already there. Copying the module again also replaces everything in it, and these were changed there: ' +
          info.changedChildren.join(', ') + '.';
      }
      var bits = [];
      if (info.lookalike && !info.destId) {
        bits.push('<span class="cgp-sections__warn">This section already has “' + esc(info.lookalike.title) + '”, which was not copied from here ' +
          '(it may have come from another course). Copying would add a second one, so it is unticked.</span>');
      }
      if (!existing && info.moduleWanted && st.placeInModules) {
        bits.push(info.module ? 'Goes in module “' + esc(info.module.name) + '”.'
          : '<span class="cgp-sections__warn">No module “' + esc(info.moduleWanted) + '” here; the copy will not be in a module.</span>');
      }
      if (!existing && info.groupMissing) {
        bits.push('<span class="cgp-sections__warn">No assignment group “' + esc(info.groupMissing) + '” here; Canvas will put it in “Imported Assignments”.</span>');
      }
      var choice = '';
      if (existing && (info.status === 'edited' || info.status === 'differs' || info.status === 'stale')) {
        var rep = !!st.replace[k];
        choice = '<div class="cgp-sections__choice">' +
          '<label><input type="radio" name="rep-' + esc(k) + '" data-replace="' + esc(k) + '" value="1"' + (rep ? ' checked' : '') + '> Replace with the version here</label>' +
          '<label><input type="radio" name="rep-' + esc(k) + '" data-replace="' + esc(k) + '" value="0"' + (rep ? '' : ' checked') + '> Keep that class’s own version (only dates' + (t.body ? ' and note' : '') + ' change)</label>' +
          (t.body && it.type !== 'module' && !st.running ? '<button type="button" class="cgp-roster__btn cgp-sections__back" data-act="back" data-dest="' + esc(d) + '" data-item="' + esc(itemKey(it)) + '">Bring that class’s version here instead…</button>' : '') +
          '</div>';
      }
      var dateRows = dated(it).map(function (row) {
        var rk = k + '|' + itemKey(row);
        var vals = st.cells[rk] || {};
        var fields = sync.dateFields(row).map(function (f) {
          return '<label class="cgp-sections__date"><span>' + esc(sync.DATE_LABELS[f]) + '</span>' +
            '<input type="datetime-local" data-cell="' + esc(rk) + '" data-field="' + f + '" value="' + esc(vals[f] || '') + '"' + (on ? '' : ' disabled') + '></label>';
        });
        var check = sync.checkDates(vals, st.tz);
        if (st.quick && sync.dateFields(row)[0] === 'due_at') {
          fields = fields[0] + '<details' + (check.errors.length ? ' open' : '') +
            '><summary>Availability dates</summary>' + fields.slice(1).join('') + '</details>';
        } else fields = fields.join('');
        return '<div class="cgp-sections__daterow" data-row="' + esc(rk) + '">' + (row !== it ? '<span class="cgp-sections__child">' + esc(row.title || '') + '</span>' : '') +
          fields + '<span class="cgp-sections__err" data-row-err>' + esc(check.errors.join('; ')) + '</span></div>';
      }).join('');
      var note = '';
      if (t.body && !st.quick) {
        var nv = st.notes[k] || '';
        note = '<details class="cgp-sections__note"' + (nv ? ' open' : '') + '><summary>Note for this class only' + (nv ? ' (has one)' : '') + '</summary>' +
          '<textarea rows="2" data-note="' + esc(k) + '" placeholder="Shown at the top of the instructions in this class only."' + (on ? '' : ' disabled') + '>' + esc(nv) + '</textarea></details>';
      }
      return '<div class="cgp-sections__dest' + (on ? '' : ' is-off') + '">' +
        '<label class="cgp-sections__dest-head"><input type="checkbox" data-include="' + esc(k) + '"' + (on ? ' checked' : '') + '> <strong>' + esc(self.courseName(d)) + '</strong></label>' +
        '<div class="cgp-stats__note">' + esc(status) + '</div>' +
        (bits.length ? '<div class="cgp-stats__note">' + bits.join(' ') + '</div>' : '') +
        choice + dateRows + note + '</div>';
    }).join('');
    var extra = [];
    if (it.hasOverrides) extra.push('It has dates for particular students or sections in this course; copies get only the dates set below.');
    if (it.newQuiz) extra.push('A New Quiz: Canvas copies its questions in a second step, so it can take a few minutes.');
    if (it.type === 'module') extra.push('Copies the module and everything in it. Dates for the module’s items can be set for each class below.');
    if (it.type === 'page' && !dated(it).length) extra.push('Pages have no dates to set.');
    if (it.type === 'announcement') extra.push('Announcements are not published or unpublished; each class’s copy posts at its own Post at date (blank: as soon as it is copied).');
    if (it.type === 'module' && st.publish !== 'match') extra.push('Publishing or unpublishing the module does the same to its items, as on the Modules page.');
    return '<section class="cgp-roster__section cgp-sections__item"><h3>' + esc(t.label) + ': ' + esc(it.title || '(untitled)') + '</h3>' +
      (extra.length ? '<p class="cgp-stats__note">' + esc(extra.join(' ')) + '</p>' : '') + rows + '</section>';
  };

  P.renderResults = function () {
    var st = this.state;
    var self = this;
    var lines = st.results.map(function (r) {
      var res = r.result;
      var icon = !res ? '…' : (res.ok ? (res.warnings.length ? '!' : '✓') : (res.pending ? '…' : '×'));
      var cls = !res ? 'is-run' : (res.ok ? (res.warnings.length ? 'is-warn' : 'is-ok') : (res.pending ? 'is-run' : 'is-err'));
      var detail = !res ? esc(r.step || 'Waiting') : (res.error ? esc(res.error) : (res.ok ? (r.task.mode === 'keep' ? 'Dates updated.' : 'Copied.') : ''));
      var link = res && res.url ? ' <a href="' + esc(res.url) + '" target="_blank" rel="noopener">Open</a>' : '';
      var warns = res && res.warnings.length ? '<ul>' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '';
      return '<li class="cgp-sections__result ' + cls + '"><span class="cgp-sections__icon">' + icon + '</span><div><strong>' +
        esc(self.courseName(r.task.destCourseId)) + '</strong> · ' + esc(r.task.item.title || '') + ' — ' + detail + link + warns + '</div></li>';
    }).join('');
    return '<section class="cgp-roster__section"><h3>' + (st.running ? 'Copying…' : 'Done') + '</h3>' +
      (st.running ? '<p class="cgp-stats__note">Canvas copies one item at a time into each class; this can take a minute or two.</p>' : '') +
      '<ul class="cgp-sections__results">' + lines + '</ul>' +
      (st.running ? '' : '<div class="cgp-roster__row cgp-roster__actions"><button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-act="close">Close</button>' +
        '<button type="button" class="cgp-roster__btn" data-act="again">Copy something else</button></div>') + '</section>';
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
    if (a === 'advanced-copy') { st.quick = false; this.render(); return; }
    if (a === 'save-link') return this.saveLink();
    if (a === 'cancel-link') { st.view = 'main'; st.linkDraft = null; this.render(); return; }
    if (a === 'edit-link') { st.view = 'link'; st.linkDraft = null; this.render(); return; }
    if (a === 'pick') { st.view = 'pick'; st.picker.chosen = {}; this.render(); return; }
    if (a === 'pick-cancel') { st.view = 'main'; this.render(); return; }
    if (a === 'pick-done') return this.pickDone();
    if (a === 'resurvey') return this.resurvey();
    if (a === 'adjust') return this.applyAdjust(act.getAttribute('data-dest'));
    if (a === 'reset') return this.resetDest(act.getAttribute('data-dest'));
    if (a === 'run') return this.runAll();
    if (a === 'back') {
      var bk = act.getAttribute('data-item');
      var bi = st.items.filter(function (x) { return itemKey(x) === bk; })[0];
      var binfo = bi && surveyInfo(st, bi, act.getAttribute('data-dest'));
      if (bi && binfo && binfo.destId) return this.openBack({ origCourse: this.courseId, origRef: bi, copyCourse: act.getAttribute('data-dest'), copyId: binfo.destId });
      return;
    }
    if (a === 'close') return this.close();
    if (a === 'again') { st.results = null; st.items = []; st.survey = null; st.cells = {}; st.seed = {}; st.include = {}; st.replace = {}; st.notes = {}; this.render(); return; }
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
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-row]'), function (row) {
      var err = row.querySelector('[data-row-err]');
      if (err) err.textContent = sync.checkDates(st.cells[row.getAttribute('data-row')] || {}, st.tz).errors.join('; ');
    });
    var go = this.root.querySelector('.cgp-sections__go');
    if (!go) return;
    var plan = this.planSummary();
    var btn = go.querySelector('[data-act="run"]');
    if (btn) {
      btn.disabled = !(plan.count && !plan.errors.length && !st.running);
      btn.textContent = plan.label;
    }
    var note = go.querySelector('.cgp-stats__note');
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
    this.resurvey();
  };

  P.applyAdjust = function (d) {
    var st = this.state;
    var sync = S();
    var a = st.adjust[d] || {};
    var days = Math.round(Number(a.days || 0)) || 0;
    var clock = a.time ? sync.parseClock(a.time, this.settings.values.timeShortcuts) : null;
    if (a.time && !clock) { CGP.ui.error('“' + a.time + '” is not a time or one of your period shortcuts.'); return; }
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
    st.items.forEach(function (it) {
      st.dests.forEach(function (d) {
        var dest = destOf(st, d);
        var k = cellKey(it, d);
        if (!dest || dest.error || !st.include[k]) return;
        var info = surveyInfo(st, it, d) || {};
        var existing = !!(info.destId && info.status !== 'restore');
        var mode = existing && !st.replace[k] ? 'keep' : 'copy';
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
          mapping: (dest && dest.mapping) || {},
          childNotes: info.childNotes || {}
        });
      });
    });
    return { tasks: tasks, errors: errors };
  };

  P.planSummary = function () {
    var b = this.buildTasks();
    var made = b.tasks.filter(function (t) { return t.mode === 'copy' && !t.destId; }).length;
    var updated = b.tasks.filter(function (t) { return t.mode === 'copy' && t.destId; }).length;
    var keeps = b.tasks.length - made - updated;
    var classes = {};
    b.tasks.forEach(function (t) { classes[t.destCourseId] = true; });
    var nc = Object.keys(classes).length;
    var parts = [];
    if (made) parts.push(made === 1 ? '1 new copy' : made + ' new copies');
    if (updated) parts.push(updated === 1 ? '1 copy updated' : updated + ' copies updated');
    if (keeps) parts.push(keeps + (keeps === 1 ? ' date-only update' : ' date-only updates'));
    // Says what the button will do before it is pressed, and what it won't.
    var text = parts.length ? parts.join(', ') + '. ' + this.courseName(this.courseId) + ' itself is not changed.' : '';
    return {
      count: b.tasks.length, errors: b.errors, text: text,
      label: nc ? 'Copy to ' + (nc === 1 ? this.courseName(Object.keys(classes)[0]) : nc + ' classes') : 'Nothing to copy'
    };
  };

  P.runAll = function () {
    var self = this;
    var st = this.state;
    var b = this.buildTasks();
    if (b.errors.length || !b.tasks.length || st.running) return;
    st.running = true;
    st.results = b.tasks.map(function (t) { return { task: t, result: null, step: 'Waiting' }; });
    this.render();
    // One section at a time per course (Canvas queues copies into a course
    // behind each other anyway); up to three sections at once.
    var byDest = {};
    st.results.forEach(function (r) { (byDest[r.task.destCourseId] = byDest[r.task.destCourseId] || []).push(r); });
    var gate = CGP.util.pool(3);
    var repaint = CGP.util.rafBatch(function () { if (self.state === st) self.render(); }, 'sections');
    Promise.all(Object.keys(byDest).map(function (d) {
      return gate(function () {
        return byDest[d].reduce(function (p, r) {
          return p.then(function () {
            return self.copier.run(r.task, function (step) { r.step = step; repaint(); }).then(function (res) {
              r.result = res;
              repaint();
            }, function (err) {
              r.result = { ok: false, warnings: [], error: 'Something went wrong: ' + String(err && err.message) };
              repaint();
            });
          });
        }, Promise.resolve());
      });
    })).then(null, function (err) {
      CGP.diag.error('sections.runFailed', { message: String(err && err.message) });
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
