/* Canvas Gradebook+ - is it snowing or raining around Philadelphia?
 *
 * Used only by Hidden Gems: on a day it really snows or rains in the
 * Philadelphia / Malvern area, it snows or rains on the teacher's Canvas
 * pages, and on a clear day the sun may come through. Asks Open-Meteo (free, no account, no key) for the current weather
 * at two fixed points, Malvern and Center City Philadelphia, in one request.
 * Nothing about the teacher, their classes or Canvas is sent, and the
 * teacher sets nothing. Open-Meteo allows requests from any site, so no
 * extra Chrome permission is needed. Answers are kept for 20 minutes in
 * chrome.storage.local, so a day of page loads costs a few requests. */

export const WEATHER_NOW = 'cgp.weather.now';
export const PLACES = [
  { name: 'Malvern', lat: 40.04, lon: -75.51 },
  { name: 'Philadelphia', lat: 39.95, lon: -75.17 }
];
export const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' +
  PLACES.map((p) => p.lat).join(',') + '&longitude=' + PLACES.map((p) => p.lon).join(',') + '&current=weather_code,is_day';
const CACHE_KEY = 'cgp.weather.cache';
const FRESH_MS = 20 * 60 * 1000;

export function createWeather(chrome, fetchImpl, nowFn) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const clock = nowFn || (() => Date.now());

  /* Resolves { ok: true, codes: [code per place] } or { ok: false, code }.
   * Tabs that ask at the same moment (a restored window of Canvas tabs)
   * share one answer, and so one request. */
  let pending = null;
  function now() {
    if (!pending) pending = ask().finally(() => { pending = null; });
    return pending;
  }

  async function ask() {
    const box = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
    // An answer from the future (the clock was set back) is not fresh.
    const age = box ? clock() - box.at : NaN;
    // An answer saved before day/night was asked for is fetched again.
    if (box && Array.isArray(box.codes) && Array.isArray(box.isDay) && age >= 0 && age < FRESH_MS) return { ok: true, codes: box.codes, isDay: box.isDay, cached: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await doFetch(WEATHER_URL, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return { ok: false, code: 'http', status: res.status };
      const body = await res.json();
      const list = Array.isArray(body) ? body : [body];
      const good = list.filter((b) => b && b.current && isFinite(Number(b.current.weather_code)));
      if (!good.length) return { ok: false, code: 'shape' };
      const codes = good.map((b) => Number(b.current.weather_code));
      const isDay = good.map((b) => (Number(b.current.is_day) === 0 ? 0 : 1));
      await chrome.storage.local.set({ [CACHE_KEY]: { at: clock(), codes, isDay } });
      return { ok: true, codes, isDay };
    } catch (e) {
      return { ok: false, code: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return { now };
}
