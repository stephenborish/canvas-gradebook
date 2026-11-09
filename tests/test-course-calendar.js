/* Class schedule from the teacher's calendar (replaces Time Shortcuts).
 *   - settings: defaults, cleaning, the address kept out of the Canvas copy
 *   - addresses: Google secret/public/embed/share links, webcal, other feeds
 *   - iCal parsing and repeats: weekly/daily/monthly rules, UNTIL, COUNT,
 *     EXDATE, moved and cancelled meetings, daylight-saving changes
 *   - one day's view in the teacher's Canvas time zone, course matching
 *   - the service worker's fetch-and-store (calendar-sync.js)
 *   - the Assign To picker: finding the boxes, putting in the time and day */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { suite, assert: a } = require('./harness');

const CGP = globalThis.CGP;
const ROOT = path.resolve(__dirname, '..');
const Cal = () => CGP.courseCalendar;
const SYNC_MODULE = pathToFileURL(path.join(ROOT, 'src', 'calendar-sync.js')).href;

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Borish Classes',
  'X-WR-TIMEZONE:America/New_York',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  // Mon/Tue/Thu, 8:55-9:50, the school year; no class on Thanksgiving.
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20260908T085500',
  'DTEND;TZID=America/New_York:20260908T095000',
  'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20270605T035959Z;BYDAY=MO,TU,TH',
  'EXDATE;TZID=America/New_York:20261126T085500',
  'UID:bio1@google.com',
  'SUMMARY:AP Biology P1',
  'LOCATION:Room 204',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'SUMMARY:not the title',
  'END:VALARM',
  'END:VEVENT',
  // One meeting moved, one cancelled.
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20261110T100000',
  'DTEND;TZID=America/New_York:20261110T105500',
  'RECURRENCE-ID;TZID=America/New_York:20261110T085500',
  'UID:bio1@google.com',
  'SUMMARY:AP Biology P1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20261112T085500',
  'RECURRENCE-ID;TZID=America/New_York:20261112T085500',
  'STATUS:CANCELLED',
  'UID:bio1@google.com',
  'SUMMARY:AP Biology P1',
  'END:VEVENT',
  // A one-off in UTC, a folded and escaped title, and a duration.
  'BEGIN:VEVENT',
  'DTSTART:20261109T183000Z',
  'DURATION:PT55M',
  'UID:chem@google.com',
  'SUMMARY:Honors Chemistry\\, Peri',
  ' od 4',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261109',
  'DTEND;VALUE=DATE:20261110',
  'UID:aday@google.com',
  'SUMMARY:A Day',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

suite('class schedule settings', (test) => {
  test('on by default, with no calendar and the start time on a click', () => {
    const s = CGP.sanitizeSettings({});
    a.eq(s.courseScheduleEnabled, true);
    a.eq(s.courseCalendarUrl, '');
    a.eq(s.courseScheduleTime, 'start');
  });

  test('the old time shortcuts are gone', () => {
    const s = CGP.sanitizeSettings({ timeShortcutsEnabled: true, timeShortcuts: [{ key: '1', time: '08:55' }] });
    a.eq('timeShortcuts' in s, false);
    a.eq('timeShortcutsEnabled' in s, false);
  });

  test('only a feed address is kept, and the time choice is start or end', () => {
    const url = 'https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-abc/basic.ics';
    a.eq(CGP.sanitizeSettings({ courseCalendarUrl: '  ' + url + ' ' }).courseCalendarUrl, url);
    a.eq(CGP.sanitizeSettings({ courseCalendarUrl: 'webcal://example.org/cal.ics' }).courseCalendarUrl, 'webcal://example.org/cal.ics');
    a.eq(CGP.sanitizeSettings({ courseCalendarUrl: 'me@school.org' }).courseCalendarUrl, 'me@school.org');
    a.eq(CGP.sanitizeSettings({ courseCalendarUrl: 'javascript:alert(1)' }).courseCalendarUrl, '');
    a.eq(CGP.sanitizeSettings({ courseCalendarUrl: { href: url } }).courseCalendarUrl, '');
    a.eq(CGP.sanitizeSettings({ courseCalendarUrl: 'https://x.org/' + 'a'.repeat(3000) }).courseCalendarUrl, '');
    a.eq(CGP.sanitizeSettings({ courseScheduleTime: 'end' }).courseScheduleTime, 'end');
    a.eq(CGP.sanitizeSettings({ courseScheduleTime: 'middle' }).courseScheduleTime, 'start');
  });

  test('the calendar address is never copied into the Canvas account', () => {
    a.eq(CGP.settingsMirror.isMirrored('cgp.setting.courseCalendarUrl'), false);
    a.eq(CGP.settingsMirror.isMirrored('cgp.setting.courseScheduleTime'), true);
  });
});

suite('class schedule: calendar addresses', (test) => {
  const ical = (id) => 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(id) + '/public/basic.ics';

  test('a Google secret or public iCal address is used as it is', () => {
    const secret = 'https://calendar.google.com/calendar/ical/me%40school.org/private-0123abcd/basic.ics';
    a.eq(Cal().normalizeUrl(secret), secret);
    a.eq(Cal().normalizeUrl(ical('me@school.org')), ical('me@school.org'));
  });

  test('the Public URL, a share link and a bare calendar ID become its iCal address', () => {
    a.eq(Cal().normalizeUrl('https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com&ctz=America%2FNew_York'), ical('abc@group.calendar.google.com'));
    a.eq(Cal().normalizeUrl('https://calendar.google.com/calendar/u/0?cid=' + Buffer.from('me@school.org').toString('base64').replace(/=+$/, '')), ical('me@school.org'));
    a.eq(Cal().normalizeUrl('abc@group.calendar.google.com'), ical('abc@group.calendar.google.com'));
  });

  test('webcal and other feeds are read over https; non-feeds are refused', () => {
    a.eq(Cal().normalizeUrl('webcal://p01-calendars.icloud.com/published/2/xyz'), 'https://p01-calendars.icloud.com/published/2/xyz');
    a.eq(Cal().normalizeUrl('http://school.org/bell.ics'), 'https://school.org/bell.ics');
    a.eq(Cal().normalizeUrl('https://calendar.google.com/calendar/u/0/r'), null, 'Google Calendar’s own page is not a calendar address');
    a.eq(Cal().normalizeUrl('not a url'), null);
    a.eq(Cal().normalizeUrl(''), null);
  });

  test('the permission asked for is the feed’s site alone, over https', () => {
    a.eq(Cal().originPattern('https://calendar.google.com/calendar/ical/x/public/basic.ics'), 'https://calendar.google.com/*');
  });
});

suite('class schedule: reading the calendar', (test) => {
  const cal = Cal().parseIcs(ICS);
  const occ = Cal().expand(cal, '2026-09-01', '2027-07-01');
  const NY = 'America/New_York';
  const day = (d, tz) => Cal().dayView(occ, d, tz || NY);

  test('reads the calendar’s name, zone and events (alarms and folded lines included)', () => {
    a.eq(cal.name, 'Borish Classes');
    a.eq(cal.zone, NY);
    a.eq(cal.events.length, 5);
    a.eq(cal.events[0].title, 'AP Biology P1', 'an alarm’s SUMMARY is not the event’s');
    a.eq(cal.events[3].title, 'Honors Chemistry, Period 4');
    a.eq(cal.events[3].dur, 55);
  });

  test('a weekly class repeats on its days, at its time, with its room', () => {
    a.deep(day('2026-11-16').classes, [{ title: 'AP Biology P1', start: '08:55', end: '09:50', endDate: '2026-11-16', loc: 'Room 204' }]);
    a.eq(day('2026-11-18').classes.length, 0, 'not on Wednesdays');
    a.eq(day('2026-11-19').classes[0].start, '08:55');
  });

  test('a skipped, a moved and a cancelled meeting', () => {
    a.eq(day('2026-11-26').classes.length, 0, 'EXDATE');
    a.deep(day('2026-11-10').classes.map((c) => c.start + '-' + c.end), ['10:00-10:55'], 'moved, and only once');
    a.eq(day('2026-11-12').classes.length, 0, 'cancelled');
  });

  test('stays at 8:55 across the daylight-saving change, and stops at UNTIL', () => {
    a.eq(day('2026-11-02').classes[0].start, '08:55');
    a.eq(day('2027-03-15').classes[0].start, '08:55');
    a.eq(day('2027-06-03').classes.length, 1);
    a.eq(day('2027-06-07').classes.length, 0);
  });

  test('a day shows its all-day events and its classes in time order', () => {
    const v = day('2026-11-09');
    a.deep(v.allDay, ['A Day']);
    a.deep(v.classes.map((c) => c.title + ' ' + c.start), ['AP Biology P1 08:55', 'Honors Chemistry, Period 4 13:30']);
  });

  test('times are shown on the teacher’s Canvas time zone', () => {
    const v = day('2026-11-09', 'America/Chicago');
    a.deep(v.classes.map((c) => c.start + '-' + c.end), ['07:55-08:50', '12:30-13:25']);
    // 8:55 in New York is 22:55 in Tokyo, still the 9th; 13:30 is 3:30 on the 10th there.
    a.deep(day('2026-11-09', 'Asia/Tokyo').classes.map((c) => c.title + ' ' + c.start), ['AP Biology P1 22:55']);
    a.deep(day('2026-11-10', 'Asia/Tokyo').classes.map((c) => c.title + ' ' + c.start), ['Honors Chemistry, Period 4 03:30']);
  });

  test('the next day with any class', () => {
    a.eq(Cal().nextClassDay(occ, '2026-11-20', NY, 1, 30), '2026-11-23');
    a.eq(Cal().nextClassDay(occ, '2026-11-23', NY, -1, 30), '2026-11-19');
  });

  test('COUNT, daily on weekdays, monthly by weekday and repeats written in UTC', () => {
    const c = Cal().parseIcs([
      'BEGIN:VCALENDAR', 'X-WR-TIMEZONE:America/New_York',
      'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Lab', 'DTSTART;TZID=America/New_York:20261102T130000', 'DTEND;TZID=America/New_York:20261102T140000',
      'RRULE:FREQ=WEEKLY;COUNT=3', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Homeroom', 'DTSTART;TZID=America/New_York:20261102T080000', 'DTEND;TZID=America/New_York:20261102T081500',
      'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261113T235959Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Faculty meeting', 'DTSTART;TZID=America/New_York:20260901T150000', 'DTEND;TZID=America/New_York:20260901T160000',
      'RRULE:FREQ=MONTHLY;BYDAY=1TU', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Advisory', 'DTSTART:20261021T140000Z', 'DTEND:20261021T143000Z',
      'RRULE:FREQ=WEEKLY', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n'));
    const o = Cal().expand(c, '2026-09-01', '2027-01-31');
    const titles = (t) => o.filter((x) => x.t === t).map((x) => x.d);
    a.deep(titles('Lab'), ['2026-11-02', '2026-11-09', '2026-11-16']);
    a.eq(titles('Homeroom').length, 10, 'two school weeks');
    a.eq(titles('Homeroom').indexOf('2026-11-07'), -1, 'no Saturdays');
    a.deep(titles('Faculty meeting'), ['2026-09-01', '2026-10-06', '2026-11-03', '2026-12-01', '2027-01-05']);
    // Written in UTC, it repeats at 14:00 UTC (RFC 5545): 10:00 EDT in
    // October, 9:00 EST once the clocks change - as the calendar shows it.
    a.eq(Cal().dayView(o, '2026-10-21', 'America/New_York').classes[0].start, '10:00');
    a.eq(Cal().dayView(o, '2026-11-11', 'America/New_York').classes.find((x) => x.title === 'Advisory').start, '09:00');
    a.ok(o.filter((x) => x.t === 'Advisory').every((x) => x.z === 'UTC' && x.s === '14:00'), 'kept in UTC until shown');
  });

  test('an extra date (RDATE) keeps its own time, beside the regular meeting on that day', () => {
    const c = Cal().parseIcs([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:r', 'SUMMARY:Review session', 'DTSTART:20261103T140000Z', 'DTEND:20261103T150000Z',
      'RRULE:FREQ=WEEKLY;COUNT=2', 'RDATE:20261110T160000Z', 'RDATE:20261112T140000Z', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n'));
    const o = Cal().expand(c, '2026-11-01', '2026-11-30');
    a.deep(o.map((x) => x.d + ' ' + x.s + '-' + x.e), [
      '2026-11-03 14:00-15:00', '2026-11-10 14:00-15:00', '2026-11-10 16:00-17:00', '2026-11-12 14:00-15:00'
    ]);
  });

  test('a skipped meeting is matched by its time, leaving another one that day', () => {
    const c = Cal().parseIcs([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:x', 'SUMMARY:Lab', 'DTSTART;TZID=America/New_York:20261102T090000', 'DTEND;TZID=America/New_York:20261102T100000',
      'RRULE:FREQ=WEEKLY;COUNT=2', 'RDATE;TZID=America/New_York:20261109T130000',
      'EXDATE;TZID=America/New_York:20261109T090000', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n'));
    a.deep(Cal().expand(c, '2026-11-01', '2026-11-30').map((x) => x.d + ' ' + x.s), ['2026-11-02 09:00', '2026-11-09 13:00']);
  });

  test('a meeting across a daylight-saving change ends at the right time', () => {
    // US clocks go back at 2:00 on Nov 1, 2026: 00:30 EDT to 02:30 EST is three hours.
    const c = Cal().parseIcs([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:dst', 'SUMMARY:Overnight lab',
      'DTSTART;TZID=America/New_York:20261101T003000', 'DTEND;TZID=America/New_York:20261101T023000', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:spring', 'SUMMARY:Spring lab',
      'DTSTART;TZID=America/New_York:20270314T013000', 'DTEND;TZID=America/New_York:20270314T033000', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n'));
    a.eq(c.events[0].dur, 180);
    const o = Cal().expand(c, '2026-10-01', '2027-04-01');
    a.eq(o[0].e, '02:30', 'stored end');
    a.eq(Cal().dayView(o, '2026-11-01', 'America/New_York').classes[0].end, '02:30', 'shown in the same zone');
    // In Chicago it starts at 23:30 on Oct 31 and ends at 01:30 CST on Nov 1.
    const chi = Cal().dayView(o, '2026-10-31', 'America/Chicago').classes[0];
    a.deep([chi.start, chi.end, chi.endDate], ['23:30', '01:30', '2026-11-01'], 'converted');
    a.eq(o[1].e, '03:30', 'spring forward: 01:30 EST plus one hour is 03:30 EDT');
    // Chicago moves its clocks an hour after New York, so 03:30 EDT is still 01:30 CST there:
    // an hour after the 00:30 CST start, as it should be.
    const spring = Cal().dayView(o, '2027-03-14', 'America/Chicago').classes[0];
    a.deep([spring.start, spring.end], ['00:30', '01:30']);
  });

  test('a meeting that runs past midnight ends on the next day', () => {
    const occ = [{ d: '2026-11-09', s: '23:30', e: '00:30', t: 'Night lab', z: 'America/New_York' }];
    const c = Cal().dayView(occ, '2026-11-09', 'America/New_York').classes[0];
    a.eq(c.end, '00:30');
    a.eq(c.endDate, '2026-11-10');
    a.eq(Cal().dayView(occ, '2026-11-09', 'America/Chicago').classes[0].endDate, '2026-11-09', 'in Chicago it ends at 23:30 the same day');
    a.eq(day('2026-11-16').classes[0].endDate, '2026-11-16');
  });

  test('a day is read from its own meetings, even in a large calendar', () => {
    const big = [];
    for (let i = 0; i < 15000; i++) big.push({ d: Cal().addDays('2026-01-01', i % 365), s: '07:00', e: '07:30', t: 'Filler ' + (i % 7), z: 'America/New_York' });
    big.push({ d: '2026-11-09', s: '08:55', e: '09:50', t: 'AP Biology P1', z: 'America/New_York' });
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) Cal().dayView(big, Cal().addDays('2026-11-01', i), 'America/New_York');
    a.ok(Date.now() - t0 < 1000, '50 days shown in ' + (Date.now() - t0) + 'ms');
    a.ok(Cal().dayView(big, '2026-11-09', 'America/New_York').classes.some((c) => c.title === 'AP Biology P1'));
  });

  test('a calendar with no events, or not a calendar at all, gives nothing', () => {
    a.deep(Cal().expand(Cal().parseIcs('BEGIN:VCALENDAR\nEND:VCALENDAR'), '2026-01-01', '2026-12-31'), []);
    a.deep(Cal().expand(Cal().parseIcs('<html>login</html>'), '2026-01-01', '2026-12-31'), []);
  });
});

suite('class schedule: matching and formatting', (test) => {
  test('a class named like the Canvas course is that course', () => {
    a.ok(Cal().matches('AP Biology P1', ['AP Biology - P1 (2026-27)', 'APBIO-1']));
    a.ok(Cal().matches('AP Bio P1', ['AP Biology - P1 (2026-27)']));
    a.ok(Cal().matches('Honors Chemistry, Period 4', ['Honors Chemistry 4']));
    a.not(Cal().matches('Chemistry 3', ['Honors Chemistry Period 2']), 'another section');
    a.not(Cal().matches('AP Biology P1', ['AP Biology P12']));
    a.not(Cal().matches('Lunch duty', ['AP Biology']));
    a.not(Cal().matches('', ['AP Biology']));
  });

  test('times are written the way Canvas reads them', () => {
    a.eq(Cal().formatClock('08:55'), '8:55 AM');
    a.eq(Cal().formatClock('12:30'), '12:30 PM');
    a.eq(Cal().formatClock('13:45'), '1:45 PM');
    a.eq(Cal().formatClock('00:05'), '12:05 AM');
    a.eq(Cal().formatClock('13:45', { hour12: false }), '13:45');
    a.eq(Cal().formatClock('nope'), '');
    a.eq(Cal().formatRange('08:55', '09:50'), '8:55 – 9:50 AM');
    a.eq(Cal().formatRange('11:30', '12:20'), '11:30 AM – 12:20 PM');
    a.eq(Cal().uses12Hour('en-US'), true);
    a.eq(Cal().uses12Hour('de-DE'), false);
  });

  test('reads what Canvas’s date boxes show', () => {
    ['2026-11-09', 'Nov 9, 2026', 'Mon, Nov 9, 2026', 'November 9, 2026', '11/9/2026'].forEach((t) => {
      a.eq(Cal().parseDateText(t), '2026-11-09', t);
    });
    a.eq(Cal().parseDateText(''), null);
    a.eq(Cal().parseDateText('soon'), null);
    a.eq(Cal().parseDateText('2026-02-30'), null);
  });
});

/* --------------------------------------------------- the service worker */

function fakeChrome(opts) {
  const o = Object.assign({ granted: true }, opts);
  const bag = {};
  return {
    bag,
    storage: {
      local: {
        get: async (k) => (k in bag ? { [k]: bag[k] } : {}),
        set: async (obj) => { Object.assign(bag, JSON.parse(JSON.stringify(obj))); },
        remove: async (k) => { delete bag[k]; }
      }
    },
    permissions: { contains: async () => o.granted }
  };
}

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

suite('class schedule: fetching the calendar (service worker)', (test) => {
  const SECRET = 'https://calendar.google.com/calendar/ical/me%40school.org/private-abc/basic.ics';
  const PUBLIC = 'https://calendar.google.com/calendar/ical/me%40school.org/public/basic.ics';
  const NOW = Date.UTC(2026, 10, 8, 15, 0);

  test('reads the feed and keeps its class meetings in local storage', async () => {
    const { createCalendarSync, CALENDAR_KEY } = await import(SYNC_MODULE);
    const chrome = fakeChrome();
    const fetch = fakeFetch([{ status: 200, body: ICS }]);
    const res = await createCalendarSync(chrome, { fetch, now: () => NOW }).refresh(SECRET);
    a.eq(res.ok, true);
    a.eq(res.name, 'Borish Classes');
    const rec = chrome.bag[CALENDAR_KEY];
    a.eq(rec.url, SECRET);
    a.ok(rec.occ.length > 50, 'a school year of meetings');
    a.ok(rec.occ.every((x) => x.d >= rec.from && x.d <= rec.to));
    a.deep(fetch.calls, [SECRET]);
  });

  test('a recent copy is not fetched again unless forced', async () => {
    const { createCalendarSync } = await import(SYNC_MODULE);
    const chrome = fakeChrome();
    const fetch = fakeFetch([{ status: 200, body: ICS }, { status: 200, body: ICS }]);
    let t = NOW;
    const sync = createCalendarSync(chrome, { fetch, now: () => t });
    await sync.refresh(SECRET);
    await sync.refresh(SECRET);
    a.eq(fetch.calls.length, 1);
    await sync.refresh(SECRET, { force: true });
    a.eq(fetch.calls.length, 2);
  });

  test('without the site’s permission nothing is fetched, and the teacher is told what to do', async () => {
    const { createCalendarSync } = await import(SYNC_MODULE);
    const fetch = fakeFetch([]);
    const res = await createCalendarSync(fakeChrome({ granted: false }), { fetch, now: () => NOW }).refresh(SECRET);
    a.eq(res.ok, false);
    a.eq(res.code, 'permission');
    a.ok(/Connect/.test(res.error));
    a.eq(fetch.calls.length, 0);
  });

  test('a calendar that is not public, or a page that is not a calendar, is explained', async () => {
    const { createCalendarSync } = await import(SYNC_MODULE);
    const notPublic = await createCalendarSync(fakeChrome(), { fetch: fakeFetch([{ status: 404, body: '' }]), now: () => NOW }).refresh(PUBLIC);
    a.eq(notPublic.code, 'notfound');
    a.ok(/Secret address/.test(notPublic.error));
    const page = await createCalendarSync(fakeChrome(), { fetch: fakeFetch([{ status: 200, body: '<!doctype html><title>Sign in</title>' }]), now: () => NOW }).refresh(SECRET);
    a.eq(page.code, 'notcalendar');
  });

  test('a failed refresh keeps the last good meetings for the same address', async () => {
    const { createCalendarSync, CALENDAR_KEY, FRESH_MS } = await import(SYNC_MODULE);
    const chrome = fakeChrome();
    let t = NOW;
    const sync = createCalendarSync(chrome, { fetch: fakeFetch([{ status: 200, body: ICS }, new TypeError('offline')]), now: () => t });
    await sync.refresh(SECRET);
    const good = chrome.bag[CALENDAR_KEY].occ.length;
    t += FRESH_MS + 1;
    const res = await sync.refresh(SECRET);
    a.eq(res.ok, false);
    a.eq(res.code, 'network');
    a.eq(chrome.bag[CALENDAR_KEY].occ.length, good);
    a.eq(chrome.bag[CALENDAR_KEY].lastOk, NOW);
  });

  test('a slower read of a replaced address does not overwrite the new calendar', async () => {
    const { createCalendarSync, CALENDAR_KEY } = await import(SYNC_MODULE);
    const chrome = fakeChrome();
    let release;
    const slow = new Promise((r) => { release = r; });
    const fetch = async (url) => {
      if (url === PUBLIC) await slow;
      return { ok: true, status: 200, text: async () => ICS };
    };
    const sync = createCalendarSync(chrome, { fetch, now: () => NOW });
    const old = sync.refresh(PUBLIC, { force: true });
    await sync.refresh(SECRET, { force: true });
    release();
    await old;
    a.eq(chrome.bag[CALENDAR_KEY].url, SECRET);
  });

  test('a file declared too large is refused before it is downloaded', async () => {
    const { createCalendarSync } = await import(SYNC_MODULE);
    let read = false;
    const fetch = async () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-length' ? String(200 * 1024 * 1024) : null) }, text: async () => { read = true; return ICS; } });
    const res = await createCalendarSync(fakeChrome(), { fetch, now: () => NOW }).refresh(SECRET);
    a.eq(res.code, 'toolarge');
    a.eq(read, false);
  });

  test('a blank address clears what is stored; junk is refused', async () => {
    const { createCalendarSync, CALENDAR_KEY } = await import(SYNC_MODULE);
    const chrome = fakeChrome();
    chrome.bag[CALENDAR_KEY] = { url: SECRET, ok: true, occ: [] };
    const sync = createCalendarSync(chrome, { fetch: fakeFetch([]), now: () => NOW });
    a.eq((await sync.refresh('')).empty, true);
    a.eq(CALENDAR_KEY in chrome.bag, false);
    a.eq((await sync.refresh('nope')).code, 'badurl');
  });
});

/* ------------------------------------------------- the Assign To picker */

class Node {
  constructor(tag, attrs, text) {
    this.tagName = tag.toUpperCase();
    this.attrs = Object.assign({}, attrs);
    this.children = [];
    this.parentElement = null;
    this.textContent = text || '';
    this.labels = [];
    this.classList = { contains: (c) => String(this.attrs.class || '').split(/\s+/).indexOf(c) >= 0 };
  }
  add(...kids) { kids.forEach((k) => { k.parentElement = this; this.children.push(k); }); return this; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  descendants() { return this.children.reduce((all, c) => all.concat([c], c.descendants()), []); }
  matches(sel) {
    if (sel === 'input') return this.tagName === 'INPUT';
    if (sel === '[data-testid]') return 'data-testid' in this.attrs;
    if (sel === 'input[type="date"]') return this.tagName === 'INPUT' && this.attrs.type === 'date';
    if (sel.charAt(0) === '.') return this.classList.contains(sel.slice(1));
    return false;
  }
  querySelectorAll(sel) { return this.descendants().filter((n) => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches && n.matches(sel)) return n; return null; }
  contains(el) { for (let n = el; n; n = n.parentElement) if (n === this) return true; return false; }
  getBoundingClientRect() { return { left: 600, right: 900, top: 200, bottom: 240, width: 300, height: 40 }; }
}

class FakeInput extends Node {
  constructor(attrs, label) {
    super('input', Object.assign({ type: 'text' }, attrs));
    if (label) this.labels = [{ textContent: label }];
    this._v = '';
    this.log = [];
  }
  get value() { return this._v; }
  set value(v) { this._v = String(v); }
  dispatchEvent(ev) { this.log.push(ev.type); return true; }
  focus() { this.log.push('focus'); }
  blur() { this.log.push('blur'); }
}

function bootPicker(cache, values) {
  const handlers = {};
  const root = new Node('div');
  const body = new Node('body');
  const sent = [];
  const document = {
    documentElement: { lang: 'en-US', contains: () => true, clientWidth: 1200, clientHeight: 800 },
    body: Object.assign(body, { appendChild: (el) => body.add(el) }),
    activeElement: null,
    addEventListener(type, fn) { handlers[type] = fn; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    createElement: (tag) => {
      const el = new Node(tag);
      el.style = {};
      el.addEventListener = () => {};
      el.offsetHeight = 200;
      return el;
    }
  };
  const sandbox = {
    document,
    window: { innerWidth: 1200, innerHeight: 800, addEventListener() {} },
    navigator: { language: 'en-US' },
    Event: class { constructor(type) { this.type = type; } },
    HTMLInputElement: FakeInput,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, Intl,
    chrome: {
      storage: { local: { get: async () => ({ 'cgp.calendar': cache }) }, onChanged: { addListener() {} } },
      runtime: { sendMessage: (msg, cb) => { sent.push(msg); if (cb) cb({ ok: true }); }, lastError: null }
    },
    CGP
  };
  const code = fs.readFileSync(path.join(ROOT, 'src/assignments/course-schedule.js'), 'utf8');
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'assignments/course-schedule.js' });
  const settings = { values: Object.assign({}, CGP.DEFAULTS, values) };
  const api = {
    profileTimeZone: async () => 'America/New_York',
    course: async () => ({ name: 'AP Biology - P1 (2026-27)', course_code: 'APBIO-1' })
  };
  const ctrl = new CGP.CanvasCourseSchedule({ settings, api, courseId: '7' });
  ctrl.settleMs = 1;   // Canvas's turns, shortened for the tests
  ctrl.start();
  return { ctrl, handlers, root, sent, settings, document };
}

/** One Due date-and-time pair the way Canvas's Assign To card lays it out. */
function duePair(dateText) {
  const date = new FakeInput({ 'data-testid': 'due_date_input' }, 'Due Date');
  date.value = dateText || '';
  const time = new FakeInput({ role: 'combobox', 'data-testid': 'due_time_input' }, 'Time');
  const until = new FakeInput({ 'data-testid': 'until_date_input' }, 'Until Date');
  const untilTime = new FakeInput({ role: 'combobox', 'data-testid': 'until_time_input' }, 'Time');
  const card = new Node('div').add(
    new Node('fieldset').add(new Node('span').add(date), new Node('span').add(time)),
    new Node('fieldset').add(new Node('span').add(until), new Node('span').add(untilTime))
  );
  return { card, date, time, until, untilTime };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

suite('class schedule: the Assign To picker', (test) => {
  const URL_ = 'https://calendar.google.com/calendar/ical/me%40school.org/private-abc/basic.ics';
  const cal = Cal().parseIcs(ICS);
  const cache = { url: URL_, ok: true, fetchedAt: Date.now(), occ: Cal().expand(cal, '2026-09-01', '2027-07-01') };

  test('finds each time box’s own date box, not the next pair’s', () => {
    const { card, date, time, until, untilTime } = duePair();
    void card;
    const B = (bootPicker(cache, { courseCalendarUrl: URL_ }), CGP.courseScheduleBoxes);
    a.ok(B.isTimeInput(time));
    a.ok(B.isDateInput(date));
    a.not(B.isDateInput(time));
    a.eq(B.groupFor(time).date, date);
    a.eq(B.groupFor(date).time, time);
    a.eq(B.groupFor(untilTime).date, until);
    a.eq(B.groupFor(untilTime).label, 'Until');
    a.eq(B.groupFor(time).label, 'Due');
  });

  test('pairs the boxes even when InstUI nests them deeply (13 levels apart)', () => {
    bootPicker(cache, { courseCalendarUrl: URL_ });
    const B = CGP.courseScheduleBoxes;
    const date = new FakeInput({ role: 'combobox' }, 'Due Date');
    const time = new FakeInput({ role: 'combobox' }, 'Time');
    const wrap = (el, levels) => { let n = el; for (let i = 0; i < levels; i++) n = new Node('span').add(n); return n; };
    new Node('div').add(wrap(date, 12), wrap(time, 12));
    a.eq(B.isDateInput(date), true, 'InstUI’s date box is a combobox too');
    a.eq(B.groupFor(date).time, time);
    a.eq(B.groupFor(time).date, date);
  });

  test('after a day is picked in Canvas’s calendar (focus still in the date box), the panel comes back', async () => {
    const { ctrl, handlers, root, document } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('Nov 9, 2026');
    root.add(pair.card);
    handlers.focusin({ target: pair.date });
    a.ok(ctrl.group);
    handlers.mousedown({ target: new Node('button') });   // a day in Canvas's calendar
    a.eq(ctrl.group, null);
    document.activeElement = pair.date;
    handlers.click({});
    await new Promise((r) => setTimeout(r, 5));
    a.ok(ctrl.group && ctrl.group.date === pair.date, 'open again for the date box');
  });

  test('stays out of the way until a calendar is connected', async () => {
    const { ctrl, handlers } = bootPicker(cache, { courseCalendarUrl: '' });
    const { time } = duePair('Nov 9, 2026');
    handlers.focusin({ target: time });
    a.eq(ctrl.group, null);
  });

  test('clicking a class puts its start time in the box and leaves it, as typing does', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('Mon, Nov 9, 2026');
    root.add(pair.card);
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    a.ok(ctrl.group, 'the panel opened');
    a.eq(ctrl.currentDay(), '2026-11-09', 'the date box’s day');
    a.deep(ctrl.lastView.classes.map((c) => c.title), ['AP Biology P1', 'Honors Chemistry, Period 4']);
    a.ok(/This course/.test(ctrl.panel.innerHTML), 'the Canvas course’s own class is marked');
    const res = await ctrl.pick(1, 'start');
    a.eq(pair.time.value, '1:30 PM');
    a.deep(pair.time.log, ['focus', 'input', 'blur']);
    a.eq(pair.date.log.length, 0, 'the date was already right');
    a.eq(res.date, null);
    a.eq(ctrl.group, null, 'and the panel closes');
  });

  test('the end time, and another day: the day goes into the date box first', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('Nov 9, 2026');
    root.add(pair.card);
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    ctrl.onButton({ getAttribute: (k) => (k === 'data-act' ? 'next' : null) });
    a.eq(ctrl.currentDay(), '2026-11-10');
    await ctrl.pick(0, 'end');
    a.eq(pair.date.value, '2026-11-10');
    a.deep(pair.date.log, ['focus', 'input']);
    a.eq(pair.time.value, '10:55 AM', 'the moved meeting’s end');
  });

  test('the end of a meeting that runs past midnight goes in with the next day', async () => {
    const night = { url: URL_, ok: true, fetchedAt: Date.now(), occ: [{ d: '2026-11-09', s: '23:30', e: '00:30', t: 'Night lab', z: 'America/New_York' }] };
    const { ctrl, handlers, root } = bootPicker(night, { courseCalendarUrl: URL_ });
    const pair = duePair('Nov 9, 2026');
    root.add(pair.card);
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    await ctrl.pick(0, 'end');
    a.eq(pair.date.value, '2026-11-10');
    a.eq(pair.time.value, '12:30 AM');
  });

  test('a date box this cannot read is left as the teacher set it', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('lun, 9 nov 2026');
    root.add(pair.card);
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    await ctrl.pick(0, 'start');
    a.eq(pair.date.value, 'lun, 9 nov 2026', 'not replaced with the day shown');
    a.eq(pair.date.log.length, 0);
    a.ok(pair.time.value, 'the time still goes in');
  });

  test('an empty Canvas date box gets the day shown', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('');
    root.add(pair.card);
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    ctrl.view = '2026-11-09';
    ctrl.render();
    await ctrl.pick(0, 'start');
    a.eq(pair.date.value, '2026-11-09');
  });

  test('“Also post to your other classes”: a blank class date stays blank (this class’s day) unless another day is chosen', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const page = duePair('Mon, Nov 9, 2026');          // this class's own Due date
    const date = new FakeInput({ type: 'date', 'data-f': 'due_at' });
    const time = new FakeInput({ class: 'cgp-inline__time', 'data-f': 'due_at' });
    const row = new Node('div', { class: 'cgp-inline__row' }).add(
      new Node('label', { class: 'cgp-inline__name' }, 'Honors Chemistry 4'),
      new Node('label', { class: 'cgp-inline__date' }).add(date, time));
    root.add(page.card, row);
    handlers.focusin({ target: time });
    await tick(); await tick();
    a.eq(ctrl.currentDay(), '2026-11-09', 'opens on this class’s Due date');
    a.ok(/This course/.test(ctrl.panel.innerHTML), 'the row’s own class is marked');
    await ctrl.pick(1, 'start');
    a.eq(time.value, '1:30 PM');
    a.eq(date.value, '', 'still “same as this class”');
    handlers.focusin({ target: time });
    ctrl.onButton({ getAttribute: (k) => (k === 'data-act' ? 'next' : null) });
    await ctrl.pick(0, 'start');
    a.eq(date.value, '2026-11-10', 'a day stepped to goes in');
  });

  test('picked from the date box, the class time survives Canvas putting its default due time back', async () => {
    // What Canvas does: leaving the date box closes its calendar and commits
    // the date a few turns later, putting back the time it had - the course's
    // default due time (8:00 AM) - over anything typed meanwhile.
    const { ctrl, handlers, root, document } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('Nov 10, 2026');
    pair.time.value = '8:00 AM';
    pair.date.focus = function () { this.log.push('focus'); document.activeElement = this; };
    pair.time.focus = function () {
      this.log.push('focus');
      if (document.activeElement === pair.date) {
        setTimeout(() => setTimeout(() => setTimeout(() => { pair.time.value = '8:00 AM'; }, 0), 0), 0);
      }
      document.activeElement = this;
    };
    root.add(pair.card);
    pair.date.focus();
    handlers.focusin({ target: pair.date });
    await tick(); await tick();
    const res = await ctrl.pick(0, 'start');   // the moved AP Biology meeting, 10:00
    await new Promise((r) => setTimeout(r, 20));
    a.eq(pair.time.value, '10:00 AM', 'not the default due time');
    a.eq(pair.date.value, 'Nov 10, 2026', 'the date as the teacher set it');
    a.deep(res, { date: null, time: '10:00' });
    a.eq(ctrl._picking, false);
  });

  test('if Canvas still puts another time back, the class time goes in once more', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_ });
    const pair = duePair('Nov 9, 2026');
    root.add(pair.card);
    let blurs = 0;
    pair.time.blur = function () {
      this.log.push('blur');
      if (++blurs === 1) setTimeout(() => { pair.time.value = '8:00 AM'; }, 0);
    };
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    await ctrl.pick(0, 'start');
    a.eq(pair.time.value, '8:55 AM');
    a.eq(blurs, 2);
  });

  test('a click on the end setting makes the end the main choice', async () => {
    const { ctrl, handlers, root } = bootPicker(cache, { courseCalendarUrl: URL_, courseScheduleTime: 'end' });
    const pair = duePair('Nov 16, 2026');
    root.add(pair.card);
    handlers.focusin({ target: pair.date });
    await tick(); await tick();
    a.ok(/data-which="end"[^>]*class|class="cgp-sched__pick"[^>]*data-which="end"/.test(ctrl.panel.innerHTML));
  });

  test('on a computer not yet allowed to read the calendar, the panel says so and offers the one step', async () => {
    const denied = { url: URL_, ok: false, code: 'permission', fetchedAt: Date.now(), error: 'not allowed' };
    const { ctrl, handlers, sent } = bootPicker(denied, { courseCalendarUrl: URL_ });
    handlers.focusin({ target: duePair('Nov 9, 2026').time });
    await tick(); await tick();
    a.ok(/came with your settings/.test(ctrl.panel.innerHTML));
    a.ok(/data-act="settings"[^>]*>Allow on this computer/.test(ctrl.panel.innerHTML));
    ctrl.onButton({ getAttribute: (k) => (k === 'data-act' ? 'settings' : null) });
    a.eq(sent[sent.length - 1].type, 'cgp.openOptions');
  });

  test('a calendar not read yet asks the service worker once, and says it is loading', async () => {
    const { ctrl, handlers, sent } = bootPicker(null, { courseCalendarUrl: URL_ });
    const pair = duePair('Nov 9, 2026');
    handlers.focusin({ target: pair.time });
    await tick(); await tick();
    a.deep(sent.map((m) => m.type), ['cgp.calendar.refresh']);
    a.ok(/Loading your calendar/.test(ctrl.panel.innerHTML));
    handlers.keydown({ key: 'Escape' });
    a.eq(ctrl.group, null);
  });
});
