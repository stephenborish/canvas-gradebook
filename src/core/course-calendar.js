/* Canvas Gradebook+ - the teacher's class schedule, read from a calendar.
 *
 * The teacher gives the address of a calendar (a Google Calendar's iCal
 * address, or any other .ics feed) that holds their classes. The service
 * worker fetches it and stores the class meetings ("occurrences") for a
 * window around today; the Assign To schedule picker
 * (assignments/course-schedule.js) shows one day of them at a time, and a
 * click puts that class's start or end time (and the day) into Canvas.
 *
 * Pure: no DOM, no chrome.*, so the service worker can load it as well as
 * the content scripts and options page, and the tests can run it in Node.
 *
 * An occurrence is stored small, in the wall-clock time of the event's own
 * time zone:
 *   {d: 'YYYY-MM-DD', s: 'HH:MM', e: 'HH:MM', z: 'America/New_York', t: title, l: location}
 *   {d: 'YYYY-MM-DD', t: title, a: 1}          an all-day event (e.g. "A Day")
 * and converted to the teacher's Canvas time zone only when shown (localize),
 * since the service worker does not know that zone. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.courseCalendar) return;

  var DAY_MS = 86400000;
  var MAX_OCCURRENCES = 20000;
  var MAX_PERIODS = 20000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------ dates */

  /** 'YYYY-MM-DD' -> days since 1970-01-01 (UTC), or NaN. */
  function dayNum(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return NaN;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }

  function dayKey(n) {
    var t = new Date(n * DAY_MS);
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }

  function addDays(key, days) { return dayKey(dayNum(key) + Number(days || 0)); }

  /** 0 = Sunday ... 6 = Saturday. */
  function weekday(key) { return ((dayNum(key) + 4) % 7 + 7) % 7; }

  function ymd(y, m, d) {
    // m is 1-based and may run past 12 (rolls into later years).
    return dayKey(Math.round(Date.UTC(y, m - 1, d) / DAY_MS));
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function clockToMin(c) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(c || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }

  function minToClock(min) {
    var v = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad(Math.floor(v / 60)) + ':' + pad(v % 60);
  }

  /* -------------------------------------------------------- time zones */

  var fmtCache = Object.create(null);
  function zoneFormatter(tz) {
    if (!(tz in fmtCache)) {
      try {
        fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      } catch (e) { fmtCache[tz] = null; }
    }
    return fmtCache[tz];
  }

  function validZone(tz) { return !!(tz && zoneFormatter(tz)); }

  /** An instant -> {date: 'YYYY-MM-DD', time: 'HH:MM'} on tz's wall clock. */
  function zoneParts(ms, tz) {
    var f = zoneFormatter(tz);
    if (!f) return null;
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var h = Number(p.hour) % 24;
    return { date: p.year + '-' + p.month + '-' + p.day, time: pad(h) + ':' + p.minute };
  }

  function offsetAt(ms, tz) {
    var p = zoneParts(ms, tz);
    if (!p) return 0;
    var asUtc = dayNum(p.date) * DAY_MS + clockToMin(p.time) * 60000;
    return asUtc - Math.floor(ms / 60000) * 60000;
  }

  /** A wall-clock date and time in tz -> the instant (ms). */
  function wallToMs(date, clock, tz) {
    var guess = dayNum(date) * DAY_MS + clockToMin(clock) * 60000;
    if (!validZone(tz)) return guess;
    var ms = guess - offsetAt(guess, tz);
    var again = guess - offsetAt(ms, tz);
    return again === ms ? ms : again;
  }

  /** This computer's own time zone, or ''. */
  function localZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /** Today's date on tz's wall clock (this computer's clock and zone if none). */
  function today(tz, nowMs) {
    var ms = typeof nowMs === 'number' ? nowMs : Date.now();
    var p = validZone(tz) ? zoneParts(ms, tz) : null;
    if (p) return p.date;
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ------------------------------------------------------------ address */

  function googleIcs(id) {
    return 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(id) + '/public/basic.ics';
  }

  function looksLikeCalendarId(s) {
    return /^[^\s\/:@?#]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s || ''));
  }

  function decodeCid(cid) {
    var s = String(cid || '').trim();
    if (looksLikeCalendarId(s)) return s;
    try {
      var b = s.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var out = typeof atob === 'function' ? atob(b) : '';
      return looksLikeCalendarId(out) ? out : null;
    } catch (e) { return null; }
  }

  /** What a teacher pastes -> the address of an iCal feed, or null.
   * Accepts a Google Calendar's "Secret address in iCal format" or "Public
   * address in iCal format", its "Public URL" (…/embed?src=…), a share link
   * (…?cid=…), a bare calendar ID, webcal:// links, and any other https .ics
   * feed (Outlook, Apple, a school's scheduling system). */
  function normalizeUrl(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return null;
    if (looksLikeCalendarId(s)) return googleIcs(s);
    s = s.replace(/^webcals?:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(s)) return null;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    u.protocol = 'https:';
    var host = u.hostname.toLowerCase();
    if (host === 'calendar.google.com' || host === 'www.google.com') {
      if (/\/calendar\/ical\/[^/]+\/[^/]+\/[^/]+\.ics$/i.test(u.pathname)) {
        u.hostname = 'calendar.google.com';
        u.hash = '';
        return u.href;
      }
      var src = u.searchParams.get('src');
      if (src && looksLikeCalendarId(src)) return googleIcs(src);
      var cid = u.searchParams.get('cid');
      var id = cid && decodeCid(cid);
      if (id) return googleIcs(id);
      // A Google Calendar page that is not one calendar's address (the
      // calendar's own web page, say): there is nothing there to read.
      return null;
    }
    u.hash = '';
    return u.href;
  }

  /** The host permission pattern a feed address needs: "https://host/*". */
  function originPattern(url) {
    try { return 'https://' + new URL(url).hostname + '/*'; } catch (e) { return null; }
  }

  function isGooglePublic(url) {
    return /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/public\//i.test(String(url || ''));
  }

  /** A Google feed address with its secret token hidden, for showing. */
  function redact(url) {
    return String(url || '').replace(/\/private-[^/]+\//, '/private-…/');
  }

  /* ------------------------------------------------------------ parsing */

  function unescapeText(v) {
    return String(v || '').replace(/\\([\\;,nN])/g, function (_, c) { return c === 'n' || c === 'N' ? '\n' : c; });
  }

  function parseLine(line) {
    var inQ = false, i;
    for (i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') inQ = !inQ;
      else if (c === ':' && !inQ) break;
    }
    if (i >= line.length) return null;
    var head = line.slice(0, i);
    var parts = head.split(';');
    var params = {};
    for (var j = 1; j < parts.length; j++) {
      var eq = parts[j].indexOf('=');
      if (eq > 0) params[parts[j].slice(0, eq).toUpperCase()] = parts[j].slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: parts[0].toUpperCase(), params: params, value: line.slice(i + 1) };
  }

  /** A TZID as written ("America/New_York", "/mozilla.org/…/Europe/London")
   * -> an IANA name, or '' (a zone Intl does not know - Outlook's "Eastern
   * Standard Time" - is read as the teacher's own). */
  function cleanZone(tzid) {
    var s = String(tzid || '').trim();
    if (!s) return '';
    if (validZone(s)) return s;
    var m = /([A-Za-z]+\/[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)?)$/.exec(s);
    return m && validZone(m[1]) ? m[1] : '';
  }

  /** A DTSTART-style value -> {date, time|null, zone}. zone: 'UTC' for a Z
   * time, the TZID, else '' (floating: the teacher's own zone). */
  function parseDateValue(value, params, calZone) {
    var v = String(value || '').trim();
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
    if (!m) return null;
    var date = m[1] + '-' + m[2] + '-' + m[3];
    if (!m[4] || (params && String(params.VALUE || '').toUpperCase() === 'DATE')) return { date: date, time: null, zone: '' };
    var zone = m[7] ? 'UTC' : cleanZone(params && params.TZID) || cleanZone(calZone);
    return { date: date, time: m[4] + ':' + m[5], zone: zone };
  }

  /** 'PT50M', 'PT1H5M', 'P1D', '-PT5M' -> minutes. */
  function parseDuration(v) {
    var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
    if (!m) return null;
    var min = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0));
    return m[1] === '-' ? -min : min;
  }

  var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  function parseRrule(v, calZone) {
    var r = { freq: '', interval: 1, count: 0, until: null, byday: null, bymonthday: null, bymonth: null, bysetpos: null, wkst: 1 };
    String(v || '').split(';').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq < 0) return;
      var k = part.slice(0, eq).toUpperCase(), val = part.slice(eq + 1);
      var nums = function () {
        return val.split(',').map(Number).filter(function (n) { return isFinite(n) && n !== 0; });
      };
      if (k === 'FREQ') r.freq = val.toUpperCase();
      else if (k === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
      else if (k === 'COUNT') r.count = Math.max(0, parseInt(val, 10) || 0);
      else if (k === 'UNTIL') r.until = parseDateValue(val, {}, calZone);
      else if (k === 'BYDAY') {
        r.byday = val.split(',').map(function (x) {
          var m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim());
          return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] } : null;
        }).filter(Boolean);
      } else if (k === 'BYMONTHDAY') r.bymonthday = nums();
      else if (k === 'BYMONTH') r.bymonth = nums();
      else if (k === 'BYSETPOS') r.bysetpos = nums();
      else if (k === 'WKST' && WD[val.toUpperCase()] !== undefined) r.wkst = WD[val.toUpperCase()];
    });
    return r.freq ? r : null;
  }

  /** The text of an .ics file -> {name, zone, events: [...]}. An event:
   * {uid, title, loc, start: {date, time, zone}, dur (minutes, timed) or
   * days (all-day), rrule, exdates: [{date,time,zone}], rdates, recurrenceId,
   * cancelled}. */
  function parseIcs(text) {
    var src = String(text == null ? '' : text).replace(/^﻿/, '');
    var lines = src.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    var cal = { name: '', zone: '', events: [] };
    var stack = [];
    var raw = null;
    var raws = [];
    lines.forEach(function (line) {
      if (!line) return;
      var p = parseLine(line);
      if (!p) return;
      if (p.name === 'BEGIN') {
        stack.push(p.value.toUpperCase());
        if (p.value.toUpperCase() === 'VEVENT' && stack.length <= 2) { raw = { props: [] }; raws.push(raw); }
        return;
      }
      if (p.name === 'END') {
        var top = stack.pop();
        if (top === 'VEVENT') raw = null;
        return;
      }
      var cur = stack[stack.length - 1];
      if (cur === 'VCALENDAR') {
        if (p.name === 'X-WR-CALNAME') cal.name = unescapeText(p.value).slice(0, 120);
        else if (p.name === 'X-WR-TIMEZONE') cal.zone = cleanZone(p.value);
      } else if (cur === 'VEVENT' && raw) raw.props.push(p);
    });
    raws.forEach(function (r) {
      var ev = { uid: '', title: '', loc: '', start: null, end: null, dur: null, rrule: null, exdates: [], rdates: [], recurrenceId: null, cancelled: false };
      var durText = null;
      r.props.forEach(function (p) {
        switch (p.name) {
          case 'UID': ev.uid = p.value; break;
          case 'SUMMARY': ev.title = unescapeText(p.value).trim().slice(0, 200); break;
          case 'LOCATION': ev.loc = unescapeText(p.value).trim().slice(0, 120); break;
          case 'DTSTART': ev.start = parseDateValue(p.value, p.params, cal.zone); break;
          case 'DTEND': ev.end = parseDateValue(p.value, p.params, cal.zone); break;
          case 'DURATION': durText = p.value; break;
          case 'RRULE': ev.rrule = parseRrule(p.value, cal.zone); break;
          case 'EXDATE':
          case 'RDATE':
            p.value.split(',').forEach(function (v) {
              var d = parseDateValue(v, p.params, cal.zone);
              if (d) (p.name === 'EXDATE' ? ev.exdates : ev.rdates).push(d);
            });
            break;
          case 'RECURRENCE-ID': ev.recurrenceId = parseDateValue(p.value, p.params, cal.zone); break;
          case 'STATUS': ev.cancelled = String(p.value).trim().toUpperCase() === 'CANCELLED'; break;
        }
      });
      if (!ev.start) return;
      ev.allDay = !ev.start.time;
      if (ev.allDay) {
        var days = ev.end && !ev.end.time ? dayNum(ev.end.date) - dayNum(ev.start.date) : null;
        if (days == null && durText) { var dm = parseDuration(durText); days = dm == null ? null : Math.round(dm / 1440); }
        ev.days = Math.max(1, Math.min(31, days || 1));
      } else {
        var dur = null;
        if (ev.end && ev.end.time) {
          dur = Math.round((wallToMs(ev.end.date, ev.end.time, ev.end.zone) - wallToMs(ev.start.date, ev.start.time, ev.start.zone)) / 60000);
        } else if (durText) dur = parseDuration(durText);
        ev.dur = Math.max(0, Math.min(1440, dur || 0));
      }
      delete ev.end;
      cal.events.push(ev);
    });
    return cal;
  }

  /* --------------------------------------------------------- recurrence */

  /** A date-time from the feed, put on `zone`'s wall clock (a UTC time on a
   * zoned event, or the reverse). */
  function inZone(dt, zone) {
    if (!dt || !dt.time || !dt.zone || dt.zone === zone || !validZone(zone) || !validZone(dt.zone)) return dt;
    var p = zoneParts(wallToMs(dt.date, dt.time, dt.zone), zone);
    return { date: p.date, time: p.time, zone: zone };
  }

  /** The dates an RRULE gives, in order, from `start` up to `toKey`. */
  function ruleDates(rule, start, startTime, toKey, untilKey) {
    var out = [];
    var produced = 0;
    var startN = dayNum(start);
    var toN = dayNum(toKey);
    var sy = +start.slice(0, 4), sm = +start.slice(5, 7), sd = +start.slice(8, 10);
    var swd = weekday(start);
    var interval = rule.interval || 1;
    var stop = false;

    function bydayHas(key) {
      if (!rule.byday || !rule.byday.length) return true;
      var w = weekday(key);
      return rule.byday.some(function (b) { return b.wd === w; });
    }
    function monthOk(key) { return !rule.bymonth || rule.bymonth.indexOf(+key.slice(5, 7)) >= 0; }
    function monthDayOk(key) {
      if (!rule.bymonthday) return true;
      var y = +key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10), dim = daysInMonth(y, m);
      return rule.bymonthday.some(function (n) { return n > 0 ? n === d : dim + n + 1 === d; });
    }
    /** Dates in month (y, m) the BY* parts pick, sorted. */
    function monthDates(y, m) {
      var dim = daysInMonth(y, m);
      var set = [];
      if (rule.byday && rule.byday.length) {
        rule.byday.forEach(function (b) {
          var all = [];
          for (var d = 1; d <= dim; d++) if (weekday(ymd(y, m, d)) === b.wd) all.push(d);
          if (!b.n) set = set.concat(all);
          else {
            var pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
            if (pick) set.push(pick);
          }
        });
        if (rule.bymonthday) set = set.filter(function (d) { return monthDayOk(ymd(y, m, d)); });
      } else if (rule.bymonthday) {
        rule.bymonthday.forEach(function (n) {
          var d = n > 0 ? n : dim + n + 1;
          if (d >= 1 && d <= dim) set.push(d);
        });
      } else if (sd <= dim) set.push(sd);
      set = set.filter(function (d, i, arr) { return arr.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
      return set.map(function (d) { return ymd(y, m, d); });
    }
    function setpos(list) {
      if (!rule.bysetpos || !list.length) return list;
      var keep = [];
      rule.bysetpos.forEach(function (n) {
        var v = n > 0 ? list[n - 1] : list[list.length + n];
        if (v && keep.indexOf(v) < 0) keep.push(v);
      });
      return keep.sort();
    }
    function emit(list) {
      for (var i = 0; i < list.length; i++) {
        var k = list[i];
        var n = dayNum(k);
        if (n < startN) continue;
        if (n > toN) { stop = true; return; }
        if (untilKey && (k + 'T' + (startTime || '00:00')) > untilKey) { stop = true; return; }
        if (rule.count && produced >= rule.count) { stop = true; return; }
        produced++;
        out.push(k);
      }
      if (rule.count && produced >= rule.count) stop = true;
    }

    for (var p = 0; p < MAX_PERIODS && !stop; p++) {
      var list = [];
      if (rule.freq === 'DAILY') {
        if (startN + p * interval > toN) break;
        var k = dayKey(startN + p * interval);
        if (bydayHas(k) && monthOk(k) && monthDayOk(k)) list.push(k);
      } else if (rule.freq === 'WEEKLY') {
        var weekStart = startN - ((swd - rule.wkst + 7) % 7) + p * 7 * interval;
        if (weekStart > toN) break;
        var days = rule.byday && rule.byday.length ? rule.byday.map(function (b) { return b.wd; }) : [swd];
        days.forEach(function (w) {
          var key = dayKey(weekStart + ((w - rule.wkst + 7) % 7));
          if (monthOk(key) && list.indexOf(key) < 0) list.push(key);
        });
        list.sort();
        list = setpos(list);
      } else if (rule.freq === 'MONTHLY') {
        var mm = sm + p * interval;
        var y = sy + Math.floor((mm - 1) / 12), m = ((mm - 1) % 12) + 1;
        if (dayNum(ymd(y, m, 1)) > toN) break;
        if (!rule.bymonth || rule.bymonth.indexOf(m) >= 0) list = setpos(monthDates(y, m));
      } else if (rule.freq === 'YEARLY') {
        var yy = sy + p * interval;
        if (dayNum(ymd(yy, 1, 1)) > toN) break;
        var months = rule.bymonth && rule.bymonth.length ? rule.bymonth.slice().sort(function (a, b) { return a - b; }) : [sm];
        months.forEach(function (mo) {
          if (!rule.byday && !rule.bymonthday) { if (sd <= daysInMonth(yy, mo)) list.push(ymd(yy, mo, sd)); }
          else list = list.concat(monthDates(yy, mo));
        });
        list = setpos(list);
      } else break;
      emit(list);
    }
    return out;
  }

  /** Events -> occurrences (see the header) whose day falls in
   * [fromKey, toKey], in each event's own zone, sorted by day and time. */
  function expand(cal, fromKey, toKey) {
    var events = (cal && cal.events) || [];
    var fromN = dayNum(fromKey), toN = dayNum(toKey);
    var out = [];
    var byUid = Object.create(null);
    events.forEach(function (ev) { if (ev.recurrenceId && ev.uid) (byUid[ev.uid] = byUid[ev.uid] || []).push(ev); });

    function push(ev, date, time, zone) {
      if (out.length >= MAX_OCCURRENCES) return;
      if (ev.allDay) {
        for (var i = 0; i < ev.days; i++) {
          var n = dayNum(date) + i;
          if (n >= fromN && n <= toN) out.push({ d: dayKey(n), t: ev.title, a: 1 });
        }
        return;
      }
      var n2 = dayNum(date);
      if (n2 < fromN || n2 > toN) return;
      var o = { d: date, s: time, e: minToClock(clockToMin(time) + ev.dur), t: ev.title };
      if (zone) o.z = zone;
      if (ev.loc) o.l = ev.loc;
      out.push(o);
    }

    events.forEach(function (ev) {
      if (ev.cancelled) return;
      if (ev.recurrenceId) { push(ev, ev.start.date, ev.start.time, ev.start.zone); return; }
      if (!ev.rrule && !ev.rdates.length) { push(ev, ev.start.date, ev.start.time, ev.start.zone); return; }
      // Repeats are worked out on the wall clock of the event's own zone, so
      // a class at 8:55 New York time stays at 8:55 across a daylight-saving
      // change. One written in UTC repeats at the same UTC moment (RFC 5545,
      // and how the teacher's own calendar shows it); it is put on the
      // teacher's clock only when shown (localize).
      var start = ev.start;
      var zone = ev.allDay ? '' : start.zone;
      // Skipped (EXDATE) and moved or cancelled (RECURRENCE-ID) meetings, by
      // day and time - or by day alone when given without a time.
      var skip = Object.create(null);
      var mark = function (x) {
        var z = inZone(x, zone) || x;
        skip[z.time ? z.date + 'T' + z.time : z.date] = true;
      };
      ev.exdates.forEach(mark);
      (byUid[ev.uid] || []).forEach(function (o) { mark(o.recurrenceId); });
      var untilKey = null;
      if (ev.rrule && ev.rrule.until) {
        var u = inZone(ev.rrule.until, zone) || ev.rrule.until;
        untilKey = u.date + 'T' + (u.time || '23:59');
      }
      // Each meeting with its own time: the rule's at DTSTART's, an extra
      // date (RDATE) at the time it gives, if any.
      var meetings = [];
      var seen = Object.create(null);
      var add = function (d, t) {
        var k = d + 'T' + (t || '');
        if (seen[k]) return;
        seen[k] = true;
        meetings.push({ date: d, time: t });
      };
      (ev.rrule ? ruleDates(ev.rrule, start.date, start.time, addDays(toKey, 1), untilKey) : [start.date])
        .forEach(function (d) { add(d, start.time); });
      ev.rdates.forEach(function (r) {
        var rz = inZone(r, zone) || r;
        add(rz.date, ev.allDay ? null : (rz.time || start.time));
      });
      meetings.forEach(function (m) {
        if (skip[m.date] || (m.time && skip[m.date + 'T' + m.time])) return;
        push(ev, m.date, m.time, zone);
      });
    });
    out.sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.s || '') < (b.s || '') ? -1 : (a.s || '') > (b.s || '') ? 1 : 0;
    });
    return out;
  }

  /* ------------------------------------------------------------ showing */

  /** One timed occurrence on tz's wall clock: {date, start, end, endDate}
   * (endDate is the next day for a meeting that runs past midnight). */
  function localize(o, tz) {
    if (!o || o.a) return { date: o && o.d, start: null, end: null, endDate: o && o.d };
    if (!o.z || o.z === tz || !validZone(o.z) || !validZone(tz)) {
      return { date: o.d, start: o.s, end: o.e, endDate: clockToMin(o.e) < clockToMin(o.s) ? addDays(o.d, 1) : o.d };
    }
    var s = zoneParts(wallToMs(o.d, o.s, o.z), tz);
    var len = clockToMin(o.e) - clockToMin(o.s);
    if (len < 0) len += 1440;
    var e = zoneParts(wallToMs(o.d, o.s, o.z) + len * 60000, tz);
    return { date: s.date, start: s.time, end: e.time, endDate: e.date };
  }

  /** One day of the schedule on tz's wall clock:
   * {allDay: [title], classes: [{title, start, end, endDate, loc}]} sorted by time. */
  function dayView(occ, dateKey, tz) {
    var list = Array.isArray(occ) ? occ : [];
    var n = dayNum(dateKey);
    var allDay = [], classes = [], seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !o.d) continue;
      var dn = dayNum(o.d);
      if (dn < n - 1 || dn > n + 1) continue;   // a zone change moves a time by at most a day
      if (o.a) {
        if (dn === n && allDay.indexOf(o.t) < 0) allDay.push(o.t);
        continue;
      }
      var l = localize(o, tz);
      if (l.date !== dateKey) continue;
      var key = o.t + '|' + l.start + '|' + l.end;
      if (seen[key]) continue;
      seen[key] = true;
      classes.push({ title: o.t || '(untitled)', start: l.start, end: l.end, endDate: l.endDate, loc: o.l || '' });
    }
    classes.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.title < b.title ? -1 : 1; });
    return { allDay: allDay, classes: classes };
  }

  /** The nearest day after (step 1) or before (step -1) dateKey with any
   * class on it, within `limit` days, or null. */
  function nextClassDay(occ, dateKey, tz, step, limit) {
    var dir = step < 0 ? -1 : 1;
    for (var i = 1; i <= (limit || 30); i++) {
      var k = addDays(dateKey, dir * i);
      if (dayView(occ, k, tz).classes.length) return k;
    }
    return null;
  }

  /* --------------------------------------------------- matching courses */

  var STOP = { the: 1, and: 1, of: 1, a: 1, an: 1, to: 1, in: 1, for: 1, with: 1, period: 1, per: 1, section: 1, sec: 1, class: 1, block: 1, course: 1 };

  function words(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w && !STOP[w]; });
  }

  function wordHit(w, set) {
    for (var i = 0; i < set.length; i++) {
      var x = set[i];
      if (x === w) return true;
      // "bio" is "biology"; numbers must match exactly ("p1" is not "p12").
      if (w.length >= 3 && x.length >= 3 && !/\d/.test(w + x) && (x.indexOf(w) === 0 || w.indexOf(x) === 0)) return true;
    }
    return false;
  }

  function hasDigit(w) { return /\d/.test(w); }
  function isYear(w) { return /^(19|20)\d\d$/.test(w); }

  /** How well a calendar event's title names one of `names` (the Canvas
   * course's name and code): 0..1, by the shorter side's words found in the
   * other. Numbers tell sections apart, so when both sides have them the
   * title's must all be found. "AP Bio P1" names "AP Biology - P1
   * (2026-27)"; "Chem 3" does not name "Chemistry 2". */
  function matchScore(title, names) {
    var tw = words(title);
    if (!tw.length) return 0;
    var best = 0;
    (Array.isArray(names) ? names : [names]).forEach(function (n) {
      var nw = words(n);
      if (!nw.length) return;
      var tNums = tw.filter(function (w) { return hasDigit(w) && !isYear(w); });
      var nNums = nw.filter(function (w) { return hasDigit(w) && !isYear(w); });
      if (tNums.length && nNums.length && !tNums.every(function (w) { return wordHit(w, nw); })) return;
      var hits = tw.filter(function (w) { return wordHit(w, nw); }).length;
      var back = nw.filter(function (w) { return wordHit(w, tw); }).length;
      var score = tw.length <= nw.length ? hits / tw.length : back / nw.length;
      if (score > best) best = score;
    });
    return best;
  }

  function matches(title, names) { return matchScore(title, names) >= 0.66; }

  /* ---------------------------------------------------------- formatting */

  /** "13:45" -> "1:45 PM" (12-hour) or "13:45" (24-hour). Plain ASCII
   * spaces: Canvas's time parser does not accept the narrow no-break space
   * newer Intl builds put before AM/PM. */
  function formatClock(clock, opts) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(clock == null ? '' : clock));
    if (!m || +m[1] > 23 || +m[2] > 59) return '';
    var h = Number(m[1]);
    if (opts && opts.hour12 === false) return pad(h) + ':' + m[2];
    return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  /** Whether `locale` shows clock times with AM/PM. */
  function uses12Hour(locale) {
    try {
      var o = new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric' }).resolvedOptions();
      if (typeof o.hour12 === 'boolean') return o.hour12;
      return /h1[12]/.test(o.hourCycle || '');
    } catch (e) { return true; }
  }

  /** "8:55 – 9:50 AM" style range for the picker. */
  function formatRange(start, end, opts) {
    var a = formatClock(start, opts), b = formatClock(end, opts);
    if (!b || start === end) return a;
    if (opts && opts.hour12 === false) return a + ' – ' + b;
    var sameHalf = (clockToMin(start) < 720) === (clockToMin(end) < 720);
    return (sameHalf ? a.replace(/ [AP]M$/, '') : a) + ' – ' + b;
  }

  /** 'YYYY-MM-DD' -> "Mon, Nov 9" (with the year when it is not `thisYear`). */
  function formatDay(key, locale, thisYear) {
    var n = dayNum(key);
    if (!isFinite(n)) return '';
    var opts = { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' };
    if (thisYear && key.slice(0, 4) !== String(thisYear)) opts.year = 'numeric';
    try { return new Intl.DateTimeFormat(locale || undefined, opts).format(new Date(n * DAY_MS)); } catch (e) { return key; }
  }

  /** What a date box shows -> 'YYYY-MM-DD' or null. Reads ISO, "Nov 9, 2026",
   * "Mon, Nov 9, 2026", "11/9/2026" (month first) and "9 Nov 2026". */
  function parseDateText(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
    var t = Date.parse(s.replace(/^[A-Za-z]+,\s*(?=[A-Za-z])/, ''));
    if (!isFinite(t)) t = Date.parse(s);
    if (!isFinite(t)) return null;
    var d = new Date(t);
    return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
    function valid(y, mo, d) {
      if (!(y > 1900 && y < 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo))) return null;
      return y + '-' + pad(mo) + '-' + pad(d);
    }
  }

  CGP.courseCalendar = {
    normalizeUrl: normalizeUrl,
    originPattern: originPattern,
    isGooglePublic: isGooglePublic,
    redact: redact,
    parseIcs: parseIcs,
    parseRrule: parseRrule,
    expand: expand,
    localize: localize,
    dayView: dayView,
    nextClassDay: nextClassDay,
    matchScore: matchScore,
    matches: matches,
    formatClock: formatClock,
    formatRange: formatRange,
    formatDay: formatDay,
    uses12Hour: uses12Hour,
    parseDateText: parseDateText,
    today: today,
    addDays: addDays,
    weekday: weekday,
    validZone: validZone,
    localZone: localZone,
    wallToMs: wallToMs,
    zoneParts: zoneParts
  };
})();
