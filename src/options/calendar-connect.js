/* Canvas Gradebook+ - connecting the class-schedule calendar, as one action.
 *
 * Connect calendar (options page, Class Schedule) does everything in one
 * click, and says "Connected" only when every step worked:
 *   1. the link is a calendar link (core/course-calendar.js normalizeUrl:
 *      Google's secret or public iCal address, its Public URL or share link,
 *      a webcal:// or other .ics subscription link a school provides);
 *   2. Chrome's permission to read that calendar's site, asked from the
 *      click itself (Chrome allows the question only from a click);
 *   3. the calendar is read (a probe: calendar-sync.js stores nothing yet);
 *   4. the link is saved in the settings - that one setting, on top of what
 *      is stored, so other unsaved edits on the page stay as they are;
 *   5. what was read is stored for Canvas pages (calendar-sync.js adopt).
 * A link that fails at any step changes nothing: the calendar connected
 * before, and the meetings read from it, stay exactly as they were.
 *
 * On a computer the link arrived at through Chrome sync, Chrome has not
 * allowed the site here yet: authorize() does steps 2, 3 and 5 for the saved
 * link, without asking for it again.
 *
 * The link itself is never put in a message or a diagnostic: a secret iCal
 * address is a password to the teacher's calendar.
 *
 * deps: {
 *   request(origins) -> Promise<bool>   chrome.permissions.request
 *   probe(url)       -> Promise<{ok, code, error, rec}>
 *   adopt(rec)       -> Promise<{ok}>
 *   saveUrl(url)     -> Promise          the one setting, on top of what is stored
 *   now()            -> ms
 *   locale           -> for dates and times
 * } */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.calendarConnect) return;

  function C() { return CGP.courseCalendar; }

  var USE_IN_CANVAS = 'In Canvas, click any Due, Available from or Until date under Assign To, then click a class to put in its time.';

  var GUIDE = { id: 'guide', label: 'Show me where to find my link' };
  var RETRY = { id: 'connect', label: 'Try again' };
  var SAVE = { id: 'save', label: 'Try saving again' };

  /* What a probe's failure means for the teacher, and what they can do. */
  function unreadable(res, url) {
    var code = (res && res.code) || 'error';
    var msg;
    var actions = [RETRY];
    if (code === 'notfound' && C().isGooglePublic(url)) {
      // Never "make it public": a school calendar stays as the school set it.
      msg = 'Google won’t share this calendar through its public link. Paste the calendar’s “Secret address in iCal format” instead, ' +
        'or a subscription link your school gives you.';
      actions = [GUIDE];
    } else if (code === 'notfound') {
      msg = 'That calendar link was refused. Copy it again from your calendar’s settings, or ask your school for its current subscription link.';
      actions = [GUIDE, RETRY];
    } else if (code === 'notcalendar' || code === 'toolarge') {
      msg = code === 'toolarge'
        ? 'That link leads to something too large to be a class calendar. Use the link of the calendar that holds just your classes.'
        : 'That link didn’t lead to a calendar. Copy the calendar link from “Integrate calendar”, not the address of the Google Calendar page.';
      actions = [GUIDE];
    } else if (code === 'network') {
      msg = 'Couldn’t reach the calendar. Check your internet connection, then try again.';
    } else if (code === 'permission') {
      msg = 'Chrome hasn’t allowed Gradebook+ to read that calendar’s site.';
    } else {
      msg = 'The calendar couldn’t be read' + (res && res.error ? ': ' + C().scrub(res.error, url) : '.');
    }
    return { msg: C().scrub(msg, url), actions: actions, code: code };
  }

  /* What a connected calendar shows: its name, the next class meeting with
   * its day, time and time zone, and where to use it in Canvas. */
  function describe(rec, nowMs, locale) {
    var cal = C();
    var name = rec && rec.name ? '“' + rec.name + '”' : 'your calendar';
    var zone = rec && rec.zone && cal.validZone(rec.zone) ? rec.zone : cal.localZone();
    var next = rec ? cal.nextMeeting(rec.occ, nowMs, zone) : null;
    if (!next) {
      return {
        empty: true, name: name, next: null,
        text: 'Connected to ' + name + '. It has no upcoming class meetings with a time, so there is nothing to pick in Canvas yet. ' +
          'Add your class periods (with start and end times) to that calendar, or connect the calendar that has them. Until then, type dates and times in Canvas as usual.'
      };
    }
    var h12 = cal.uses12Hour(locale);
    var thisYear = cal.today(zone, nowMs).slice(0, 4);
    var when = cal.formatDay(next.date, locale, thisYear) + ' at ' + cal.formatClock(next.start, { hour12: h12 }) + ' ' + cal.zoneName(zone, next.at);
    return {
      empty: false, name: name, next: next, when: when,
      text: 'Connected to ' + name + '. Next class: ' + next.title + ', ' + when + '. ' + USE_IN_CANVAS
    };
  }

  function create(deps) {
    var now = deps.now || function () { return Date.now(); };
    var self = {
      inflight: null,
      pending: null,       // {url, rec}: read, not yet saved (a failed save)
      connect: connect,
      authorize: authorize,
      retrySave: retrySave,
      describe: function (rec) { return describe(rec, now(), deps.locale); }
    };

    function done(kind, extra) { return Object.assign({ ok: kind === 'connected' || kind === 'connected-empty', kind: kind }, extra || {}); }
    function diag(kind, code) {
      // Only what happened, never the link.
      try { if (CGP.diag && CGP.diag.log) CGP.diag.log('calendar.connect', { result: kind, code: code || null }); } catch (e) { /* ignore */ }
    }

    function finish(url, rec, save) {
      var step = save ? Promise.resolve(deps.saveUrl(url)) : Promise.resolve();
      return step.then(function () {
        self.pending = null;
        return Promise.resolve(deps.adopt(rec)).catch(function () { return null; }).then(function () {
          var view = describe(rec, now(), deps.locale);
          var r = done(view.empty ? 'connected-empty' : 'connected', { url: url, rec: rec, view: view, message: view.text, actions: [] });
          diag(r.kind);
          return r;
        });
      }, function (err) {
        self.pending = { url: url, rec: rec };
        var why = err && err.message ? C().scrub(err.message, url) : 'Chrome storage refused it';
        diag('save-failed');
        return done('save-failed', {
          url: url,
          message: 'Your calendar was read, but its link couldn’t be saved (' + why + '). Nothing else changed, and the calendar you had before is still connected.',
          actions: [SAVE]
        });
      });
    }

    /* opts.savedUrl: the link in the settings now. Must be called from the
     * click: Chrome's permission is asked before anything else waits. */
    function connect(input, opts) {
      opts = opts || {};
      if (self.inflight) return self.inflight;
      var raw = String(input == null ? '' : input).trim();
      var savedUrl = C().normalizeUrl(opts.savedUrl || '') || '';
      var keep = savedUrl ? ' The calendar you had before is still connected.' : '';
      if (!raw) return Promise.resolve(done('empty', { message: 'Paste your calendar link first.', actions: [GUIDE] }));
      var url = C().normalizeUrl(raw);
      if (!url) {
        diag('invalid');
        return Promise.resolve(done('invalid', {
          message: 'That isn’t a calendar link. In Google Calendar, open Settings, select the calendar with your classes, choose Integrate calendar, and copy its iCal address.' + keep,
          actions: [GUIDE]
        }));
      }
      var saving = !opts.authorize && url !== savedUrl;
      var asked;
      try { asked = Promise.resolve(deps.request([C().originPattern(url)])); } catch (e) { asked = Promise.reject(e); }
      var p = asked.then(function (granted) {
        if (!granted) {
          diag('denied');
          return done('denied', {
            url: url,
            message: 'Chrome didn’t allow Gradebook+ to read your calendar, so nothing was connected. Click Try again and choose Allow.' + keep,
            actions: [RETRY]
          });
        }
        return Promise.resolve(deps.probe(url)).then(function (res) {
          if (!res || !res.ok || !res.rec) {
            var u = unreadable(res, url);
            diag('unreadable', u.code);
            return done('unreadable', { url: url, code: u.code, message: u.msg + keep, actions: u.actions });
          }
          return finish(url, res.rec, saving);
        }, function () {
          diag('unreadable', 'error');
          return done('unreadable', { url: url, code: 'error', message: 'The calendar couldn’t be read. Try again.' + keep, actions: [RETRY] });
        });
      }, function () {
        diag('denied');
        return done('denied', { url: url, message: 'Chrome didn’t ask for permission. Click Try again.' + keep, actions: [RETRY] });
      });
      // A second click while this runs gets this same answer.
      self.inflight = p.then(function (r) { self.inflight = null; return r; });
      return self.inflight;
    }

    /* The saved link, on a computer Chrome has not allowed its site on. */
    function authorize(savedUrl) {
      return connect(savedUrl, { savedUrl: savedUrl, authorize: true });
    }

    /* After a failed save: save what was already read, without reading again. */
    function retrySave() {
      if (self.inflight) return self.inflight;
      if (!self.pending) return Promise.resolve(done('empty', { message: 'Click Connect calendar first.', actions: [] }));
      var pend = self.pending;
      self.inflight = finish(pend.url, pend.rec, true).then(function (r) { self.inflight = null; return r; });
      return self.inflight;
    }

    return self;
  }

  CGP.calendarConnect = { create: create, describe: describe, unreadable: unreadable, USE_IN_CANVAS: USE_IN_CANVAS };
})();
