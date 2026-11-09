/* Canvas Gradebook+ - the class schedule beside Canvas's date and time boxes.
 *
 * Click into a Due / Available from / Until date or time box in the Assign
 * To card (new/edit assignment page, and the same card on quizzes,
 * discussions and modules) - or a time box in "Also post to your other
 * classes" - and a panel opens beside it with that day's classes from the
 * teacher's own calendar (options page, Class Schedule). Click a class and
 * its start time (or its end time, with the smaller button; which is which
 * is a setting) goes into the time box. Step to another day with the arrows
 * and the day goes into the date box too. Classes named like the Canvas
 * course being edited are marked "This course".
 *
 * Canvas's boxes are React-controlled: a value goes in through the native
 * value setter plus an `input` event, so React sees it as typed, and the box
 * is then left (blur), which is when Canvas reads and commits what is in it
 * - exactly what happens when a teacher types a time and clicks away. The
 * panel keeps the focus in the box while it is clicked (mousedown is
 * cancelled), so Canvas's own dropdown and the box stay as they were until a
 * class is picked.
 *
 * The calendar's classes come from chrome.storage.local ('cgp.calendar'),
 * kept there by the service worker (calendar-sync.js); a stale or missing
 * copy is refreshed in the background when the panel opens. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});

  var CAL_KEY = 'cgp.calendar';
  var REFRESH = 'cgp.calendar.refresh';
  var STALE_MS = 6 * 60 * 60 * 1000;
  var PANEL_W = 320;

  var TIME_WORD = /(^|[^a-z])time([^a-z]|$)/i;
  var DATE_WORD = /(^|[^a-z])date([^a-z]|$)/i;

  function C() { return CGP.courseCalendar; }

  function esc(s) { return CGP.util.escapeHtml(s); }

  /* ------------------------------------------------------ finding boxes */

  /** Labels the way Canvas names a box: <label>, aria-label(ledby), and the
   * data-testid on the field ("due_time_input" and friends). */
  function describe(input) {
    var parts = [input.getAttribute('aria-label') || '', input.getAttribute('data-testid') || ''];
    var by = input.getAttribute('aria-labelledby');
    if (by) {
      by.split(/\s+/).forEach(function (id) {
        var el = id && document.getElementById(id);
        if (el) parts.push(el.textContent || '');
      });
    }
    var labels = input.labels || [];
    for (var i = 0; i < labels.length; i++) parts.push(labels[i].textContent || '');
    var wrap = input.closest && input.closest('[data-testid]');
    if (wrap) parts.push(wrap.getAttribute('data-testid') || '');
    return parts.join(' ');
  }

  function isTextInput(el) {
    return !!el && el.tagName === 'INPUT' && String(el.getAttribute('type') || 'text').toLowerCase() === 'text';
  }

  /** One of Canvas's time boxes (an InstUI time combobox labelled "Time"). */
  function isTimeInput(el) {
    if (!isTextInput(el)) return false;
    if (el.getAttribute('role') !== 'combobox') return false;
    return TIME_WORD.test(describe(el));
  }

  /** One of Canvas's date boxes (a text box labelled "… Date"). */
  function isDateInput(el) {
    if (!isTextInput(el) || isTimeInput(el)) return false;
    return DATE_WORD.test(describe(el));
  }

  function hasClass(el, c) { return !!(el && el.classList && el.classList.contains(c)); }

  /** The nearest box `test` accepts that shares an ancestor with `el`: the
   * first ancestor holding one is the pair's own (one date-and-time pair,
   * not the next). InstUI nests the two boxes deeply - 13 levels apart in
   * some versions - so the search goes well past that. */
  function partner(el, test) {
    var n = el.parentElement;
    for (var depth = 0; n && depth < 20; depth++, n = n.parentElement) {
      var all = Array.prototype.slice.call(n.querySelectorAll('input'));
      var found = all.filter(function (x) { return x !== el && test(x); });
      if (found.length) {
        // Of several, the one beside el in the page's order.
        var at = all.indexOf(el);
        found.sort(function (a, b) { return Math.abs(all.indexOf(a) - at) - Math.abs(all.indexOf(b) - at); });
        return { input: found[0], box: n };
      }
    }
    return null;
  }

  /** Which date the time box is for, for the panel's footer. */
  function fieldLabel(timeInput, kind, dateInput) {
    if (kind === 'inline') {
      var f = timeInput.getAttribute('data-f');
      var labels = (CGP.sectionSync && CGP.sectionSync.DATE_LABELS) || {};
      return labels[f] || 'Due';
    }
    var d = describe(timeInput) + ' ' + (dateInput ? describe(dateInput) : '');
    if (/until|lock/i.test(d)) return 'Until';
    if (/avail|unlock|from/i.test(d)) return 'Available from';
    if (/due/i.test(d)) return 'Due';
    return '';
  }

  /** The date-and-time pair `el` belongs to, or null. */
  function groupFor(el) {
    if (!el || el.tagName !== 'INPUT') return null;
    var label = el.closest && el.closest('.cgp-inline__date');
    if (label && (hasClass(el, 'cgp-inline__time') || el.getAttribute('type') === 'date')) {
      var time = label.querySelector('.cgp-inline__time');
      if (!time) return null;
      var row = el.closest('.cgp-inline__row');
      var name = row && row.querySelector('.cgp-inline__name');
      return {
        kind: 'inline', time: time, date: label.querySelector('input[type="date"]'), box: label,
        names: name ? [String(name.textContent || '').trim()] : [], label: fieldLabel(time, 'inline')
      };
    }
    if (isTimeInput(el)) {
      var d = partner(el, isDateInput);
      return { kind: 'canvas', time: el, date: d ? d.input : null, box: d ? d.box : el, label: fieldLabel(el, 'canvas', d && d.input) };
    }
    if (isDateInput(el)) {
      var t = partner(el, isTimeInput);
      if (!t) return null;
      return { kind: 'canvas', time: t.input, date: el, box: t.box, label: fieldLabel(t.input, 'canvas', el) };
    }
    return null;
  }

  function setNativeValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pageLang() {
    return (document.documentElement && document.documentElement.lang) || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en-US';
  }

  /* --------------------------------------------------------- controller */

  function CanvasCourseSchedule(opts) {
    this.settings = opts.settings;
    this.api = opts.api || null;
    this.courseId = opts.courseId || null;
    this.group = null;
    this.panel = null;
    this.view = null;          // a day the teacher stepped to, or null: the date box's
    this.cache = null;
    this.cacheLoaded = false;
    this.tz = null;
    this.courseNames = null;
    this.lastView = null;
    this._picking = false;
    this._closeTimer = null;
    this._poll = null;
    this._lastBox = null;
    this._asked = {};
    this._started = false;
  }

  var P = CanvasCourseSchedule.prototype;

  P.enabled = function () {
    var v = this.settings.values;
    return !!(v.courseScheduleEnabled && v.courseCalendarUrl);
  };

  P.start = function () {
    if (this._started) return;
    this._started = true;
    var self = this;
    document.addEventListener('focusin', function (e) { self.onFocusIn(e.target); }, true);
    document.addEventListener('focusout', function (e) { self.onFocusOut(e.relatedTarget); }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.group) self.close();
    }, true);
    document.addEventListener('mousedown', function (e) {
      if (!self.group) return;
      var t = e.target;
      if (self.inPanel(t) || self.inGroup(t)) return;
      self.close();
    }, true);
    // Picking a day in Canvas's own calendar (a click outside the panel,
    // which closes it) leaves the focus in the date box, so no focusin
    // follows; nor does clicking into a box that already has the focus.
    // After any click, a closed panel opens again for the focused box -
    // except a click in the panel itself (Close, or picking a class), which
    // closes it on purpose while the focus stays in the box.
    document.addEventListener('click', function (e) {
      if (self.inPanel(e.target)) return;
      setTimeout(function () {
        if (!self.group && !self._picking && document.activeElement) self.onFocusIn(document.activeElement);
      }, 0);
    }, true);
    var place = function () { if (self.group) self.place(); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[CAL_KEY]) return;
        self.cache = changes[CAL_KEY].newValue || null;
        self.cacheLoaded = true;
        if (self.group) self.render();
      });
    } catch (e) { /* no storage: the panel says it cannot read the calendar */ }
  };

  P.inPanel = function (el) { return !!(el && this.panel && this.panel.contains(el)); };

  P.inGroup = function (el) {
    var g = this.group;
    return !!(el && g && (el === g.time || el === g.date || (g.box && g.box.contains && g.box.contains(el))));
  };

  P.onFocusIn = function (el) {
    if (this._picking) return;
    if (this.inPanel(el)) { this.cancelClose(); return; }
    if (!this.enabled()) return;
    var g = groupFor(el);
    if (!g) return;
    this.cancelClose();
    if (this.group && this.group.time === g.time) return;
    this.open(g);
  };

  P.onFocusOut = function (to) {
    if (!this.group || this._picking) return;
    if (to && (this.inPanel(to) || this.inGroup(to))) return;
    var self = this;
    this.cancelClose();
    // Focus may be on its way to the panel or the other box of the pair.
    this._closeTimer = setTimeout(function () {
      self._closeTimer = null;
      var a = document.activeElement;
      if (self.inPanel(a) || self.inGroup(a)) return;
      self.close();
    }, 150);
  };

  P.cancelClose = function () {
    if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
  };

  P.open = function (g) {
    var self = this;
    this.group = g;
    this.view = null;
    this._lastBox = this.boxDate();
    this.ensurePanel();
    this.loadData(false);
    this.loadZone();
    this.loadNames();
    this.render();
    this.panel.hidden = false;
    this.place();
    if (this._poll) clearInterval(this._poll);
    // Canvas's own calendar picker changes the date box without focusing
    // it, and Canvas may unmount the card: both are noticed here.
    this._poll = setInterval(function () {
      if (!self.group) return;
      if (!document.documentElement.contains(self.group.time)) { self.close(); return; }
      var now = self.boxDate();
      if (now !== self._lastBox) {
        self._lastBox = now;
        self.view = null;
        self.render();
      }
      self.place();
    }, 400);
    CGP.diag && CGP.diag.bump && CGP.diag.bump('courseSchedule.opened');
  };

  P.close = function () {
    this.cancelClose();
    if (this._poll) { clearInterval(this._poll); this._poll = null; }
    this.group = null;
    this.view = null;
    if (this.panel) this.panel.hidden = true;
  };

  /* ------------------------------------------------------------- data */

  P.calendarUrl = function () {
    return C().normalizeUrl(this.settings.values.courseCalendarUrl);
  };

  /** The stored calendar if it is this address's and has classes read
   * from it (a failed first read has none), else null. */
  P.data = function () {
    var url = this.calendarUrl();
    return this.cache && url && this.cache.url === url && Array.isArray(this.cache.occ) ? this.cache : null;
  };

  P.loadData = function (force) {
    var self = this;
    var url = this.calendarUrl();
    if (!url) return;
    var ask = function () {
      var c = self.data();
      var stale = !c || (Date.now() - Number(c.fetchedAt || 0) > STALE_MS);
      if (!force && !stale) return;
      // Once per address per page unless forced: the service worker keeps
      // its own clock for retries.
      if (!force && self._asked[url]) return;
      self._asked[url] = true;
      self.refreshing = true;
      if (self.group) self.render();
      try {
        chrome.runtime.sendMessage({ type: REFRESH, url: self.settings.values.courseCalendarUrl, force: !!force }, function (res) {
          void (chrome.runtime && chrome.runtime.lastError);
          self.refreshing = false;
          self.lastResult = res || null;
          if (self.group) self.render();
        });
      } catch (e) {
        self.refreshing = false;
        self.lastResult = { ok: false, error: 'Reload this page to use your class schedule (Gradebook+ was updated).' };
        if (self.group) self.render();
      }
    };
    if (this.cacheLoaded) { ask(); return; }
    try {
      chrome.storage.local.get(CAL_KEY).then(function (got) {
        self.cache = (got && got[CAL_KEY]) || null;
        self.cacheLoaded = true;
        if (self.group) self.render();
        ask();
      }, function () { self.cacheLoaded = true; ask(); });
    } catch (e) { this.cacheLoaded = true; ask(); }
  };

  P.loadZone = function () {
    var self = this;
    if (this.tz || this._zoneAsked) return;
    this._zoneAsked = true;
    if (!this.api || !this.api.profileTimeZone) return;
    this.api.profileTimeZone().then(function (z) {
      if (z && C().validZone(z)) { self.tz = z; if (self.group) self.render(); }
    }, function () { /* this computer's zone */ });
  };

  /** Canvas's time zone for the teacher (what its boxes mean), else this computer's. */
  P.zone = function () { return this.tz || C().localZone(); };

  P.loadNames = function () {
    var self = this;
    if (this.courseNames || this._namesAsked) return;
    this._namesAsked = true;
    var crumbs = function () {
      var el = document.querySelector('#breadcrumbs li:nth-child(2) .ellipsible, #breadcrumbs li:nth-child(2) a');
      return el ? [String(el.textContent || '').trim()] : [];
    };
    if (!this.api || !this.api.course || !this.courseId) { this.courseNames = crumbs(); return; }
    this.api.course(this.courseId).then(function (c) {
      self.courseNames = [c && c.name, c && c.course_code].filter(Boolean);
      if (!self.courseNames.length) self.courseNames = crumbs();
      if (self.group) self.render();
    }, function () { self.courseNames = crumbs(); });
  };

  /** What the date box says, as 'YYYY-MM-DD', or null. */
  P.boxDate = function () {
    var g = this.group;
    if (!g || !g.date) return null;
    return C().parseDateText(g.date.value);
  };

  /** A blank class date in "Also post to your other classes" means this
   * class's own date: Canvas's Due date box on the page, if it has one. */
  P.pageDueDate = function () {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (isDateInput(inputs[i]) && /due/i.test(describe(inputs[i]))) {
        var d = C().parseDateText(inputs[i].value);
        if (d) return d;
      }
    }
    return null;
  };

  /** Whether picking a class on `day` also puts `day` in the date box.
   * Always when the teacher chose the day here (stepped to it, or the end
   * of a meeting that runs past midnight). Otherwise only an empty date
   * box is filled - Canvas's own, or a class's in "Also post to your other
   * classes" (so the teacher sees the day the time belongs to): a date
   * this cannot read (another language's format) is left as it was. */
  P.writesDay = function (day, chose) {
    var g = this.group;
    if (!g || !g.date) return false;
    var boxDay = this.boxDate();
    if (boxDay === day) return false;
    if (chose || this.view) return true;
    return boxDay === null && !String(g.date.value || '').trim();
  };

  P.currentDay = function () {
    return this.view || this.boxDate() || (this.group && this.group.kind === 'inline' ? this.pageDueDate() : null) || C().today(this.zone());
  };

  /* ------------------------------------------------------------ panel */

  P.ensurePanel = function () {
    if (this.panel && document.body.contains(this.panel)) return;
    var self = this;
    var el = document.createElement('div');
    el.className = 'cgp-sched';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Your class schedule');
    el.hidden = true;
    // Keeps the focus (and Canvas's state) in the date or time box.
    el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || !el.contains(b)) return;
      e.preventDefault();
      e.stopPropagation();
      self.onButton(b);
    });
    document.body.appendChild(el);
    this.panel = el;
  };

  P.onButton = function (b) {
    var act = b.getAttribute('data-act');
    var day = this.currentDay();
    if (act === 'prev' || act === 'next') this.view = C().addDays(day, act === 'prev' ? -1 : 1);
    else if (act === 'today') this.view = C().today(this.zone());
    else if (act === 'jump') this.view = b.getAttribute('data-day');
    else if (act === 'close') { this.close(); return; }
    else if (act === 'refresh') { this.loadData(true); return; }
    else if (act === 'settings') {
      try { chrome.runtime.sendMessage({ type: 'cgp.openOptions' }); } catch (e) { /* reload needed */ }
      return;
    } else if (act === 'pick') { this.pick(Number(b.getAttribute('data-i')), b.getAttribute('data-which')); return; }
    this.render();
  };

  P.render = function () {
    if (!this.panel || !this.group) return;
    var cal = C();
    var g = this.group;
    var tz = this.zone();
    var day = this.currentDay();
    var today = cal.today(tz);
    var lang = pageLang();
    var h12 = cal.uses12Hour(lang);
    var primary = this.settings.values.courseScheduleTime === 'end' ? 'end' : 'start';
    var alt = primary === 'end' ? 'start' : 'end';
    var data = this.data();
    var names = g.kind === 'inline' ? g.names : (this.courseNames || []);
    var html = '<div class="cgp-sched__head">' +
      '<button type="button" class="cgp-sched__nav" data-act="prev" aria-label="Previous day" title="Previous day">&lsaquo;</button>' +
      '<div class="cgp-sched__day">' + esc(cal.formatDay(day, lang, today.slice(0, 4))) +
      (day === today ? ' <span class="cgp-sched__today-tag">Today</span>' : '') + '</div>' +
      '<button type="button" class="cgp-sched__nav" data-act="next" aria-label="Next day" title="Next day">&rsaquo;</button>' +
      (day !== today ? '<button type="button" class="cgp-sched__link" data-act="today">Today</button>' : '') +
      '<button type="button" class="cgp-sched__x" data-act="close" aria-label="Close" title="Close (Esc)">&times;</button>' +
      '</div>';
    this.lastView = null;
    if (!data) {
      var failed = (this.cache && this.cache.url === this.calendarUrl() && !this.cache.ok && this.cache) ||
        (this.lastResult && !this.lastResult.ok && this.lastResult) || null;
      var err = failed && failed.error;
      // The address came here through Chrome sync, but Chrome asks for the
      // calendar site's permission on each computer: one click on the
      // options page, which then fills this panel in.
      if (failed && failed.code === 'permission') {
        html += '<p class="cgp-sched__msg">Your class schedule came with your settings, but this computer has not been ' +
          'allowed to read your calendar yet. Click below, then <strong>Connect</strong> &ndash; once per computer.</p>' +
          '<div class="cgp-sched__foot"><button type="button" class="cgp-sched__cta" data-act="settings">Allow on this computer</button></div>';
        this.panel.innerHTML = html;
        return;
      }
      html += err
        ? '<p class="cgp-sched__msg cgp-sched__msg--err">' + esc(err) + '</p>' +
          '<div class="cgp-sched__foot"><button type="button" class="cgp-sched__link" data-act="refresh">Try again</button>' +
          '<button type="button" class="cgp-sched__link" data-act="settings">Class Schedule settings</button></div>'
        : '<p class="cgp-sched__msg">Loading your calendar&hellip;</p>';
      this.panel.innerHTML = html;
      return;
    }
    var view = this.lastView = cal.dayView(data.occ, day, tz);
    if (view.allDay.length) {
      html += '<div class="cgp-sched__tags">' + view.allDay.map(function (t) {
        return '<span class="cgp-sched__tag">' + esc(t) + '</span>';
      }).join('') + '</div>';
    }
    if (!view.classes.length) {
      var nextDay = cal.nextClassDay(data.occ, day, tz, 1, 21);
      html += '<p class="cgp-sched__msg">No classes on your calendar this day.</p>' +
        (nextDay ? '<div class="cgp-sched__foot"><button type="button" class="cgp-sched__link" data-act="jump" data-day="' + esc(nextDay) + '">Next class day: ' +
          esc(cal.formatDay(nextDay, lang, today.slice(0, 4))) + ' &rsaquo;</button></div>' : '');
    } else {
      var anyMatch = names.length && view.classes.some(function (c) { return cal.matches(c.title, names); });
      html += '<ul class="cgp-sched__list">' + view.classes.map(function (c, i) {
        var match = anyMatch && cal.matches(c.title, names);
        var main = cal.formatClock(c[primary], { hour12: h12 });
        var other = cal.formatClock(c[alt], { hour12: h12 });
        var sameTimes = c.start === c.end;
        return '<li class="cgp-sched__row' + (match ? ' is-match' : '') + '">' +
          '<button type="button" class="cgp-sched__pick" data-act="pick" data-i="' + i + '" data-which="' + primary + '"' +
          ' title="Use ' + esc(main) + ' (' + primary + ')" aria-label="' + esc(c.title + ', ' + primary + ' time ' + main) + '">' +
          '<span class="cgp-sched__title">' + esc(c.title) + (match ? ' <span class="cgp-sched__badge">This course</span>' : '') + '</span>' +
          '<span class="cgp-sched__time">' + esc(cal.formatRange(c.start, c.end, { hour12: h12 })) +
          (c.loc ? ' &middot; ' + esc(c.loc) : '') + '</span></button>' +
          (sameTimes ? '' : '<button type="button" class="cgp-sched__alt" data-act="pick" data-i="' + i + '" data-which="' + alt + '"' +
            ' title="Use ' + esc(other) + ' (' + alt + ')" aria-label="' + esc(c.title + ', ' + alt + ' time ' + other) + '">' + (alt === 'end' ? 'End' : 'Start') + '</button>') +
          '</li>';
      }).join('') + '</ul>';
    }
    var where = g.label ? '“' + esc(g.label) + '”' : 'the time box';
    var dateNote = this.writesDay(day, false) ? ' and this day' : '';
    var stale = !data.ok && data.error;
    html += '<div class="cgp-sched__foot">' +
      (view.classes.length ? '<span>Click a class to put its ' + primary + ' time' + dateNote + ' in ' + where + '.</span>' : '') +
      (stale ? '<span class="cgp-sched__warn" title="' + esc(data.error) + '">Could not update the calendar; showing what was read ' + esc(ago(data.lastOk)) + '.</span>' : '') +
      '<button type="button" class="cgp-sched__link" data-act="refresh">' + (this.refreshing ? 'Updating&hellip;' : 'Refresh') + '</button>' +
      '</div>';
    this.panel.innerHTML = html;
  };

  function ago(ms) {
    var m = Math.round((Date.now() - Number(ms || 0)) / 60000);
    if (!ms || !isFinite(m)) return 'earlier';
    if (m < 2) return 'just now';
    if (m < 90) return m + ' minutes ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + ' hours ago';
    return Math.round(h / 24) + ' days ago';
  }

  /** Beside the pair of boxes: to the right if it fits, else the left, else
   * above (Canvas's time list opens below the box). */
  P.place = function () {
    var g = this.group, el = this.panel;
    if (!g || !el || el.hidden) return;
    var rects = [g.time, g.date, g.box].filter(Boolean).map(function (x) { return x.getBoundingClientRect(); })
      .filter(function (r) { return r.width || r.height; });
    if (!rects.length) return;
    var r = {
      left: Math.min.apply(null, rects.slice(0, 2).map(function (x) { return x.left; })),
      right: Math.max.apply(null, rects.slice(0, 2).map(function (x) { return x.right; })),
      top: Math.min.apply(null, rects.slice(0, 2).map(function (x) { return x.top; })),
      bottom: Math.max.apply(null, rects.slice(0, 2).map(function (x) { return x.bottom; }))
    };
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var w = Math.min(PANEL_W, vw - 16);
    el.style.width = w + 'px';
    var h = el.offsetHeight || 240;
    var left, top;
    if (r.right + 10 + w <= vw - 8) { left = r.right + 10; top = r.top - 8; }
    else if (r.left - 10 - w >= 8) { left = r.left - 10 - w; top = r.top - 8; }
    else {
      left = Math.max(8, Math.min(r.left, vw - w - 8));
      top = r.top - 8 - h >= 8 ? r.top - 8 - h : r.bottom + 8;
    }
    top = Math.max(8, Math.min(top, vh - h - 8));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  };

  /* ------------------------------------------------------------- pick */

  /* Canvas commits a date in steps, each a turn after the focus leaves the
   * date box: InstUI's DateTimeInput re-reads the box when its calendar
   * closes (setTimeout), hands Canvas the change (another setTimeout), and
   * Canvas applies one made by leaving the box on the next turn again -
   * filling in the course's default due time when the date had no time,
   * and putting back the time InstUI remembered. A class time typed into
   * the time box before those land is overwritten by them (the teacher
   * picks 10:10 and gets the default 8:00 AM). So the date is let settle
   * first, and the time box is checked once more afterwards. */
  var SETTLE_MS = 150;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** What a time box shows, as "HH:MM" (Canvas writes "10:10 AM"). */
  function clockOf(text) {
    var S = CGP.sectionSync;
    return S && S.parseClock ? S.parseClock(text) : String(text || '').trim();
  }

  /** Puts the class's time (and, when it should, its day) into the boxes.
   * Resolves with {date, time} once Canvas holds them. */
  P.pick = function (i, which) {
    var g = this.group;
    var cls = this.lastView && this.lastView.classes[i];
    if (!g || !cls) return Promise.resolve(null);
    var self = this;
    var clock = which === 'end' ? cls.end : cls.start;
    // A meeting that runs past midnight ends on the next day.
    var shown = this.currentDay();
    var overnight = which === 'end' && !!cls.endDate && cls.endDate !== shown;
    var day = overnight ? cls.endDate : shown;
    var setDay = this.writesDay(day, overnight);
    var result = { date: setDay ? day : null, time: clock };
    var fromDateBox = typeof document !== 'undefined' && document.activeElement === g.date;
    this.close();
    CGP.diag && CGP.diag.bump && CGP.diag.bump('courseSchedule.picked');

    if (g.kind === 'inline') {
      // Our own boxes: plain inputs, read on input/change.
      var put = function (input, v) {
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (setDay) put(g.date, day);
      put(g.time, C().formatClock(clock, { hour12: true }));
      return Promise.resolve(result);
    }

    var text = C().formatClock(clock, { hour12: C().uses12Hour(pageLang()) });
    var settle = typeof this.settleMs === 'number' ? this.settleMs : SETTLE_MS;
    // The teacher's own next move (typing another time, clicking elsewhere)
    // ends the watch below: a time that differs then is theirs, not one
    // Canvas put back, and the focus is theirs too. Our own writes are
    // untrusted events, so only real ones count.
    var userActed = false;
    var USER_EVENTS = ['keydown', 'mousedown', 'pointerdown', 'input'];
    var onUser = function (e) { if (e && e.isTrusted) userActed = true; };
    USER_EVENTS.forEach(function (t) { document.addEventListener(t, onUser, true); });
    var stopWatching = function () {
      USER_EVENTS.forEach(function (t) { document.removeEventListener(t, onUser, true); });
    };
    var putTime = function () {
      g.time.focus();
      setNativeValue(g.time, text);
      g.time.blur();    // when Canvas reads and commits a typed time
    };
    this._picking = true;   // our own focus moves must not reopen the panel
    var run = Promise.resolve();
    if (setDay || fromDateBox) {
      run = run.then(function () {
        if (setDay) {
          // ISO is the one date form every Canvas date box reads, in every
          // language; Canvas shows it its own way once the box is left.
          g.date.focus();
          setNativeValue(g.date, day);
        }
        g.time.focus();   // leaves the date box: Canvas starts committing the date
        return wait(settle);
      });
    }
    // Then the time, watched for a few more turns in case Canvas's own
    // update still lands afterwards (a busy page delays it): put back, at
    // most twice, if something replaced it.
    var retries = 0;
    var watch = function (left) {
      return wait(settle).then(function () {
        if (userActed) return null;
        if (clockOf(g.time.value) !== clock && retries < 2) {
          retries++;
          CGP.diag && CGP.diag.bump && CGP.diag.bump('courseSchedule.retried');
          putTime();
        }
        return left > 1 ? watch(left - 1) : null;
      });
    };
    return run.then(function () {
      // A move of the teacher's while the date settled: leave the boxes to them.
      if (userActed) return null;
      putTime();
      return watch(4);
    }).then(function () {
      stopWatching();
      self._picking = false;
      return result;
    }, function (e) {
      stopWatching();
      self._picking = false;
      throw e;
    });
  };

  CGP.CanvasCourseSchedule = CanvasCourseSchedule;
  CGP.courseScheduleBoxes = { isTimeInput: isTimeInput, isDateInput: isDateInput, groupFor: groupFor, describe: describe };
})();
