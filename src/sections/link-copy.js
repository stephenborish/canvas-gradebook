/* Canvas Gradebook+ - copy external links from a module to the other
 * classes.
 *
 * An "External URL" item in a module (a link to a video, a simulation, a
 * reading) is not content Canvas's selective course copy can pick on its
 * own: only its whole module can be copied. This dialog adds the chosen
 * links to the matching module in each linked class instead, through the
 * Modules API (sync-runner.js planLinks / copyLinks):
 *
 *   - the module there is the copy of the link's module, else the one with
 *     the same name; the teacher can pick another;
 *   - the link goes right after the copy of the item it follows here, else at
 *     the end of that module, with the same title, address, new-tab setting,
 *     indent and published state;
 *   - a class that already has a link to the same address is left out, so a
 *     second press never adds a second copy.
 *
 * Opened from the Links tab of the item picker, and from the copy icon on
 * each external link on the Modules page (that link ticked). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (!CGP.SectionCopyController || CGP.SectionCopyController.prototype.openLinks) return;

  var P = CGP.SectionCopyController.prototype;
  var esc = function (s) { return CGP.util.escapeHtml(String(s == null ? '' : s)); };
  function S() { return CGP.sectionSync; }

  var GLYPH =
    '<svg class="cgp-copyto__glyph" viewBox="0 0 16 16" aria-hidden="true">' +
    '<rect x="1.5" y="4.5" width="8.5" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M6 2.5h6.4c.9 0 1.6.7 1.6 1.6v8.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  /* opts.linkIds: links to start ticked (module item ids). */
  P.openLinks = function (opts) {
    var self = this;
    opts = opts || {};
    var sibs = this.siblings();
    if (!sibs.length) return this.open({ pick: true });
    this.close();
    var chosen = {};
    (opts.linkIds || []).forEach(function (id) { chosen[String(id)] = true; });
    var destOn = {};
    sibs.forEach(function (d) { destOn[d] = true; });
    var st = this.state = {
      view: 'links', courses: null,
      lk: { links: null, srcModules: null, error: null, chosen: chosen, q: '', dests: sibs, destOn: destOn,
        plans: null, choice: {}, running: false, results: null }
    };
    var root = document.createElement('div');
    root.className = 'cgp-stats cgp-sections cgp-linkcopy';
    root.innerHTML =
      '<div class="cgp-stats__backdrop"></div>' +
      '<div class="cgp-stats__panel" role="dialog" aria-modal="true" aria-labelledby="cgp-sections-title" tabindex="-1">' +
      '<header><div><div class="cgp-stats__eyebrow">Copy links to other classes</div><h2 id="cgp-sections-title"></h2></div>' +
      '<button type="button" class="cgp-stats__close" aria-label="Close">×</button></header>' +
      '<div class="cgp-sections__body"></div></div>';
    root.querySelector('.cgp-stats__backdrop').addEventListener('click', function () { self.closeLinks(); });
    root.querySelector('.cgp-stats__close').addEventListener('click', function () { self.closeLinks(); });
    root.addEventListener('click', function (e) { self.onLinksClick(e); });
    root.addEventListener('change', function (e) { self.onLinksChange(e); });
    root.addEventListener('input', function (e) { self.onLinksInput(e); });
    this._onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); self.closeLinks(); } };
    document.addEventListener('keydown', this._onKey, true);
    document.body.appendChild(root);
    this.root = root;
    try { root.querySelector('.cgp-stats__panel').focus(); } catch (e) { /* ignore */ }
    this.renderLinks();
    Promise.all([
      CGP.teachingCourseList(this.api).catch(function () { return []; }),
      this.api.modulesWithItems(this.courseId)
    ]).then(function (r) {
      if (self.state !== st) return null;
      st.courses = r[0] || [];
      st.lk.srcModules = r[1] || [];
      st.lk.links = S().moduleLinks(st.lk.srcModules);
      self.root.querySelector('#cgp-sections-title').textContent = 'From ' + self.courseName(self.courseId);
      self.renderLinks();
      return self.copier.planLinks(self.courseId, st.lk.links, st.lk.srcModules, sibs).then(function (plans) {
        if (self.state !== st) return;
        st.lk.plans = plans;
        self.renderLinks();
      });
    }).catch(function (err) {
      if (self.state !== st) return;
      st.courses = st.courses || [];
      st.lk.error = CGP.util.describeApiError(err, { fallback: 'Couldn’t read this course’s modules from Canvas' });
      self.renderLinks();
    });
  };

  P.closeLinks = function () {
    if (this.state && this.state.lk && this.state.lk.running) {
      CGP.ui.toast('Adding links carries on in the background — stay on this page until it is done.');
    }
    this.close();
  };

  function chosenLinks(lk) {
    return (lk.links || []).filter(function (l) { return lk.chosen[l.id]; });
  }

  function planOf(lk, d) {
    return (lk.plans || []).filter(function (p) { return p.courseId === String(d); })[0] || null;
  }

  /* The modules the chosen links come from, in order: [{id, name}]. */
  function srcModulesOf(links) {
    var seen = {}, out = [];
    links.forEach(function (l) {
      if (seen[l.moduleId]) return;
      seen[l.moduleId] = true;
      out.push({ id: l.moduleId, name: l.moduleName });
    });
    return out;
  }

  /* The module a source module's links go to in one class: the teacher's
   * pick, else the planned one (from the first chosen link of it). */
  function targetModule(lk, d, srcModId, links) {
    var c = lk.choice[d] || {};
    if (c[srcModId]) return c[srcModId];
    var plan = planOf(lk, d);
    if (!plan) return '';
    for (var i = 0; i < links.length; i++) {
      if (links[i].moduleId !== srcModId) continue;
      var p = plan.plans[links[i].id];
      if (p && p.module) return p.module.id;
    }
    return '';
  }

  /* What one class would get: the links to add and the ones left out. */
  function destSummary(lk, d, links) {
    var plan = planOf(lk, d);
    var add = [], have = [], nowhere = [];
    if (!plan || plan.error) return { add: add, have: have, nowhere: nowhere };
    links.forEach(function (l) {
      var p = plan.plans[l.id] || {};
      if (p.already) have.push({ link: l, where: p.already.moduleName });
      else if (!targetModule(lk, d, l.moduleId, links)) nowhere.push(l);
      else add.push(l);
    });
    return { add: add, have: have, nowhere: nowhere };
  }

  P.renderLinks = function () {
    if (!this.root || !this.state || !this.state.lk) return;
    var body = this.root.querySelector('.cgp-sections__body');
    var list = body.querySelector('.cgp-sections__courses');
    var keep = list ? list.scrollTop : 0;
    var lk = this.state.lk;
    if (lk.error) body.innerHTML = '<p class="cgp-stats__note">' + esc(lk.error) + '</p>';
    else if (!lk.links) body.innerHTML = '<p class="cgp-stats__note">Loading this course’s modules…</p>';
    else if (lk.results) body.innerHTML = this.renderLinkResults();
    else body.innerHTML = this.renderLinkMain();
    var list2 = body.querySelector('.cgp-sections__courses');
    if (list2) list2.scrollTop = keep;
  };

  P.renderLinkMain = function () {
    var self = this;
    var lk = this.state.lk;
    if (!lk.links.length) {
      return '<p class="cgp-stats__note">This course’s modules have no external links. In Canvas, add one to a module with ' +
        '<b>+</b> → <b>External URL</b>, then copy it from here.</p>';
    }
    var q = String(lk.q || '').toLowerCase();
    var shown = lk.links.filter(function (l) {
      return !q || (l.title + ' ' + l.url + ' ' + l.moduleName).toLowerCase().indexOf(q) >= 0;
    });
    var lastMod = null;
    var rows = shown.length ? shown.map(function (l) {
      var head = '';
      if (l.moduleId !== lastMod) { lastMod = l.moduleId; head = '<div class="cgp-linkcopy__module">' + esc(l.moduleName || '(untitled module)') + '</div>'; }
      return head + '<label class="cgp-sections__course"><input type="checkbox" data-lk-pick="' + esc(l.id) + '"' +
        (lk.chosen[l.id] ? ' checked' : '') + (lk.running ? ' disabled' : '') + '> <span class="cgp-sections__course-name">' + esc(l.title) +
        ' <span class="cgp-linkcopy__url">' + esc(l.url) + '</span></span>' +
        (l.published ? '' : '<span class="cgp-sections__tag">unpublished</span>') + '</label>';
    }).join('') : '<p class="cgp-stats__note">Nothing matches.</p>';

    var links = chosenLinks(lk);
    var mods = srcModulesOf(links);
    var total = 0;
    var dests = lk.dests.map(function (d) {
      var plan = planOf(lk, d);
      var name = esc(self.courseName(d));
      var tick = '<label class="cgp-linkcopy__dest-name"><input type="checkbox" data-lk-dest="' + esc(d) + '"' +
        (lk.destOn[d] ? ' checked' : '') + (lk.running || (plan && plan.error) ? ' disabled' : '') + '> <strong>' + name + '</strong></label>';
      if (!lk.plans) return '<div class="cgp-linkcopy__dest">' + tick + '<p class="cgp-stats__note">Checking its modules…</p></div>';
      if (plan && plan.error) return '<div class="cgp-linkcopy__dest">' + tick + '<p class="cgp-stats__note">' + esc(plan.error) + '</p></div>';
      if (!links.length || !lk.destOn[d]) return '<div class="cgp-linkcopy__dest">' + tick + '</div>';
      var sum = destSummary(lk, d, links);
      total += sum.add.length;
      var selects = mods.map(function (m) {
        var cur = targetModule(lk, d, m.id, links);
        var opts = '<option value=""' + (cur ? '' : ' selected') + '>Choose a module…</option>' + plan.modules.map(function (dm) {
          return '<option value="' + esc(dm.id) + '"' + (String(dm.id) === String(cur) ? ' selected' : '') + '>' + esc(dm.name || '(untitled module)') + '</option>';
        }).join('');
        return '<div class="cgp-linkcopy__map">Links from <b>' + esc(m.name || '(untitled module)') + '</b> go in ' +
          '<select data-lk-mod="' + esc(d + '|' + m.id) + '"' + (lk.running ? ' disabled' : '') + '>' + opts + '</select></div>';
      }).join('');
      var notes = '';
      if (sum.have.length) {
        notes += '<p class="cgp-stats__note">Already there, left out: ' + sum.have.map(function (h) {
          return '“' + esc(h.link.title) + '”' + (h.where ? ' (in ' + esc(h.where) + ')' : '');
        }).join(', ') + '.</p>';
      }
      if (sum.nowhere.length) {
        notes += '<p class="cgp-stats__note cgp-linkcopy__warn">No module chosen for ' + sum.nowhere.map(function (l) { return '“' + esc(l.title) + '”'; }).join(', ') + ', so ' +
          (sum.nowhere.length === 1 ? 'it is' : 'they are') + ' not added.</p>';
      }
      if (!plan.modules.length) notes += '<p class="cgp-stats__note cgp-linkcopy__warn">This class has no modules yet. Copy the module itself with Copy to other classes.</p>';
      return '<div class="cgp-linkcopy__dest">' + tick + selects + notes + '</div>';
    }).join('');

    var btnLabel = total ? 'Add ' + total + ' link' + (total === 1 ? '' : 's') : 'Add links';
    return '<section class="cgp-roster__section"><h3>Links to copy</h3>' +
      '<input type="search" class="cgp-sections__filter" data-lk-role="filter" placeholder="Filter…" value="' + esc(lk.q || '') + '">' +
      '<div class="cgp-sections__courses">' + rows + '</div></section>' +
      '<section class="cgp-roster__section"><h3>Copy to</h3>' +
      (links.length ? '' : '<p class="cgp-stats__note">Tick the links to copy above.</p>') + dests + '</section>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-lk-act="run"' + (total && !lk.running ? '' : ' disabled') + '>' +
      (lk.running ? 'Adding…' : btnLabel) + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-lk-act="cancel">' + (lk.running ? 'Close' : 'Cancel') + '</button>' +
      '<button type="button" class="cgp-roster__btn" data-lk-act="items"' + (lk.running ? ' disabled' : '') + '>Copy other items…</button>' +
      '</div><p class="cgp-stats__note">Each link is added to that class’s module with the same title, address and settings. This class is not changed.</p>';
  };

  P.renderLinkResults = function () {
    var self = this;
    var lk = this.state.lk;
    var blocks = Object.keys(lk.results).map(function (d) {
      var lines = lk.results[d].map(function (r) {
        var icon = r.skipped ? '–' : (r.ok ? (r.warning ? '!' : '✓') : '×');
        var text = r.skipped ? 'already there, left as it was'
          : r.ok ? 'added' + (r.url ? ' (<a href="' + esc(r.url) + '" target="_blank" rel="noopener">open</a>)' : '') + (r.warning ? ' — ' + esc(r.warning) : '')
            : 'not added: ' + esc(r.error || 'Canvas refused');
        return '<div class="cgp-sections-notice__line"><span class="cgp-inline-banner__icon">' + icon + '</span> “' + esc(r.link.title) + '”: ' + text + '</div>';
      }).join('');
      return '<div class="cgp-linkcopy__dest"><strong>' + esc(self.courseName(d)) + '</strong>' + lines + '</div>';
    }).join('');
    return '<section class="cgp-roster__section"><h3>' + (lk.running ? 'Adding links…' : 'Done') + '</h3>' + blocks + '</section>' +
      '<div class="cgp-roster__row cgp-roster__actions">' +
      '<button type="button" class="cgp-roster__btn cgp-roster__btn--primary" data-lk-act="cancel"' + (lk.running ? ' disabled' : '') + '>Close</button>' +
      '<button type="button" class="cgp-roster__btn" data-lk-act="again"' + (lk.running ? ' disabled' : '') + '>Copy more links…</button></div>';
  };

  P.onLinksClick = function (e) {
    var st = this.state;
    if (!st || !st.lk) return;
    var b = e.target.closest && e.target.closest('[data-lk-act]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-lk-act');
    if (act === 'cancel') return this.closeLinks();
    if (act === 'items') return this.open({ pick: true });
    if (act === 'again') return this.openLinks();
    if (act === 'run') return this.runLinks();
  };

  P.onLinksChange = function (e) {
    var st = this.state;
    if (!st || !st.lk || st.lk.running) return;
    var t = e.target;
    var lk = st.lk;
    if (t.hasAttribute('data-lk-pick')) { lk.chosen[t.getAttribute('data-lk-pick')] = !!t.checked; this.renderLinks(); return; }
    if (t.hasAttribute('data-lk-dest')) { lk.destOn[t.getAttribute('data-lk-dest')] = !!t.checked; this.renderLinks(); return; }
    if (t.hasAttribute('data-lk-mod')) {
      var parts = t.getAttribute('data-lk-mod').split('|');
      (lk.choice[parts[0]] = lk.choice[parts[0]] || {})[parts[1]] = t.value || '';
      this.renderLinks();
    }
  };

  P.onLinksInput = function (e) {
    var st = this.state;
    if (!st || !st.lk) return;
    if (e.target.getAttribute('data-lk-role') !== 'filter') return;
    st.lk.q = e.target.value;
    this.renderLinks();
    var f = this.root && this.root.querySelector('[data-lk-role="filter"]');
    if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (er) { /* ignore */ } }
  };

  P.runLinks = function () {
    var self = this;
    var st = this.state;
    var lk = st.lk;
    var links = chosenLinks(lk);
    var dests = lk.dests.filter(function (d) {
      var p = planOf(lk, d);
      return lk.destOn[d] && p && !p.error && destSummary(lk, d, links).add.length;
    });
    if (!links.length || !dests.length) return null;
    lk.running = true;
    lk.results = {};
    dests.forEach(function (d) { lk.results[d] = []; });
    this.renderLinks();
    return Promise.all(dests.map(function (d) {
      var plan = planOf(lk, d);
      // Only the links that would be added: those without a module stay out.
      var choice = {};
      srcModulesOf(links).forEach(function (m) { var t = targetModule(lk, d, m.id, links); if (t) choice[m.id] = t; });
      var mine = links.filter(function (l) { return choice[l.moduleId]; });
      var picked = {};
      Object.keys(choice).forEach(function (k) { if ((lk.choice[d] || {})[k]) picked[k] = choice[k]; });
      return self.copier.copyLinks(self.courseId, mine, lk.srcModules, plan, picked).then(function (res) {
        if (self.state !== st) return;
        lk.results[d] = res;
        self.renderLinks();
      }, function (err) {
        if (self.state !== st) return;
        lk.results[d] = mine.map(function (l) { return { link: l, ok: false, error: CGP.util.describeApiError(err, { fallback: 'Canvas did not answer' }) }; });
        self.renderLinks();
      });
    })).then(function () {
      if (self.state !== st) return;
      lk.running = false;
      self.renderLinks();
      CGP.diag.log('sections.linksCopied', { links: links.length, classes: dests.length });
    });
  };

  /* ------------------------------------------- the Modules page rows */

  /* A copy icon on each external link of the Modules page, beside Canvas's
   * own row controls; it opens the dialog with that link ticked. Rows Canvas
   * draws later (a module expanded, an item added) get one too. */
  P.decorateLinkRows = function () {
    var self = this;
    var root = document.querySelector('#context_modules');
    if (!root) return;
    var run = function () {
      root.querySelectorAll('li.context_module_item.external_url').forEach(function (li) {
        if (li.querySelector('.cgp-copyto--link')) return;
        var m = /context_module_item_(\d+)/.exec(li.id || '');
        if (!m) return;
        var at = li.querySelector('.ig-admin') || li.querySelector('.ig-row');
        if (!at) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cgp-copyto cgp-copyto--link';
        btn.title = 'Copy this link to other classes';
        btn.setAttribute('aria-label', 'Copy this link to other classes');
        btn.innerHTML = GLYPH;
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          self.openLinks({ linkIds: [m[1]] });
        });
        at.insertBefore(btn, at.firstChild);
      });
    };
    run();
    if (this._linkObserver) this._linkObserver.disconnect();
    var pending = false;
    this._linkObserver = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; run(); }, 200);
    });
    this._linkObserver.observe(root, { childList: true, subtree: true });
  };
})();
