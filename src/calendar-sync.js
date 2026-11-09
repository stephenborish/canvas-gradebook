/* Canvas Gradebook+ - fetching the teacher's class-schedule calendar.
 *
 * The Assign To schedule picker and the options page ask for the calendar
 * through a 'cgp.calendar.refresh' message; this fetches the feed (a content
 * script cannot: Google's iCal addresses do not allow cross-site reads, and
 * the extension may only read the one site the teacher granted on the
 * options page), keeps the class meetings for a window around today in
 * chrome.storage.local under 'cgp.calendar', and answers with a summary.
 * Pages read the meetings straight from storage and follow its changes.
 *
 * Stored: {url, ok, fetchedAt, lastOk, name, zone, from, to, events, occ,
 * error, code}. A failed refresh keeps the last good meetings for the same
 * address, so a blip offline does not empty the picker. */

import './core/course-calendar.js';

export const CALENDAR_KEY = 'cgp.calendar';
export const CALENDAR_REFRESH = 'cgp.calendar.refresh';
// A feed is fetched again once it is this old (schedules rarely change
// within a day); a failure is retried no sooner than RETRY_MS unless forced.
export const FRESH_MS = 6 * 60 * 60 * 1000;
export const RETRY_MS = 10 * 60 * 1000;
const MAX_CHARS = 8 * 1024 * 1024;
const PAST_DAYS = 45;
const FUTURE_DAYS = 400;

function coded(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return 'that site'; }
}

export function summarize(rec) {
  if (!rec) return { ok: false, empty: true };
  return {
    ok: !!rec.ok, url: rec.url, fetchedAt: rec.fetchedAt, lastOk: rec.lastOk || null,
    error: rec.error || null, code: rec.code || null, name: rec.name || '',
    events: rec.events || 0, count: Array.isArray(rec.occ) ? rec.occ.length : 0
  };
}

export function createCalendarSync(chrome, opts = {}) {
  const C = globalThis.CGP.courseCalendar;
  const doFetch = opts.fetch || ((...a) => fetch(...a));
  const now = opts.now || (() => Date.now());
  const inflight = new Map();
  // The address asked for most recently ('' once cleared): a slower read of
  // an address the teacher has since replaced must not overwrite the new
  // calendar's record when it finally finishes.
  let latest;

  async function read() {
    const got = await chrome.storage.local.get(CALENDAR_KEY);
    return (got && got[CALENDAR_KEY]) || null;
  }

  async function allowed(url) {
    if (!chrome.permissions || !chrome.permissions.contains) return true;
    try { return await chrome.permissions.contains({ origins: [C.originPattern(url)] }); } catch (e) { return false; }
  }

  async function load(url, cached) {
    let rec;
    try {
      if (!(await allowed(url))) {
        throw coded('permission', 'Gradebook+ has not been allowed to read ' + hostOf(url) +
          ' on this computer. Open Gradebook+ settings, Class Schedule, and click Connect.');
      }
      let res;
      try {
        res = await doFetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      } catch (e) {
        throw coded('network', 'Could not reach ' + hostOf(url) + '. Check the connection and try again.');
      }
      if (!res.ok) {
        const gone = res.status === 404 || res.status === 403 || res.status === 401 || res.status === 410;
        throw coded(gone ? 'notfound' : 'http', gone
          ? (C.isGooglePublic(url)
            ? 'Google says this calendar is not public. Use its “Secret address in iCal format” instead (Google Calendar, Settings, your calendar, Integrate calendar).'
            : 'That calendar address was refused (' + res.status + '). Copy it again from your calendar’s settings.')
          : hostOf(url) + ' answered with an error (' + res.status + '). Try again later.');
      }
      // Refused before downloading when the size is declared (a wrong link
      // to a large file); checked again after, for answers that do not say.
      const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
      if (declared > MAX_CHARS) throw coded('toolarge', 'That calendar is too large to read. Use a calendar that holds just your classes.');
      const text = await res.text();
      if (text.length > MAX_CHARS) throw coded('toolarge', 'That calendar is too large to read. Use a calendar that holds just your classes.');
      if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) {
        throw coded('notcalendar', 'That address did not return a calendar. Use the address that ends in .ics (in Google Calendar: Settings, your calendar, Integrate calendar, “Secret address in iCal format”).');
      }
      const cal = C.parseIcs(text);
      const today = C.today('', now());
      const from = C.addDays(today, -PAST_DAYS);
      const to = C.addDays(today, FUTURE_DAYS);
      rec = {
        url, ok: true, fetchedAt: now(), lastOk: now(), name: cal.name, zone: cal.zone,
        from, to, events: cal.events.length, occ: C.expand(cal, from, to)
      };
    } catch (e) {
      rec = { url, ok: false, fetchedAt: now(), error: String((e && e.message) || e), code: (e && e.code) || 'error' };
      if (cached && cached.url === url && Array.isArray(cached.occ)) {
        ['occ', 'name', 'zone', 'from', 'to', 'events', 'lastOk'].forEach((k) => { if (cached[k] !== undefined) rec[k] = cached[k]; });
      }
    }
    if (latest === undefined || latest === url) await chrome.storage.local.set({ [CALENDAR_KEY]: rec });
    return summarize(rec);
  }

  /** Fetches the feed at `input` unless what is stored for it is recent
   * enough (opts.force: always). A blank address clears what is stored. */
  async function refresh(input, o = {}) {
    if (!String(input || '').trim()) {
      latest = '';
      await chrome.storage.local.remove(CALENDAR_KEY);
      return { ok: true, empty: true };
    }
    const url = C.normalizeUrl(input);
    if (!url) return { ok: false, code: 'badurl', error: 'That is not a calendar address.' };
    latest = url;
    const cached = await read();
    if (!o.force && cached && cached.url === url) {
      const age = now() - Number(cached.fetchedAt || 0);
      if ((cached.ok && age < FRESH_MS) || (!cached.ok && age < RETRY_MS)) return summarize(cached);
    }
    if (inflight.has(url)) return inflight.get(url);
    const p = load(url, cached).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  return { refresh, read };
}
