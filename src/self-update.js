/* Canvas Gradebook+ - picking up a new Web Store version promptly.
 *
 * What Chrome allows: it checks the Web Store for every extension about every
 * five hours on its own, and chrome.runtime.requestUpdateCheck() can ask
 * sooner, but only once per such interval - Chromium counts every completed
 * check against the extension (only an actual update resets it), and a call
 * in between answers "throttled" without asking the Web Store at all. So no
 * extension can pick up a new version within minutes; the most it can do is
 * make sure it spends its one check as soon as Chrome allows it, rather than
 * hours later. Hence:
 *
 *   - a try when Chrome starts, when a Canvas course page loads, and on a
 *     20-minute alarm (so a teacher who keeps one gradebook tab open all day
 *     still gets checked), at most once per 20 minutes; a throttled try costs
 *     nothing and does not push the next real check back;
 *   - a downloaded update is installed at once (chrome.runtime.reload()),
 *     instead of whenever the service worker next goes idle;
 *   - after an update, the Canvas tabs that were already open - which keep
 *     running the old version until they are reloaded, and look "not
 *     updated" - are told so, with a Reload button;
 *   - every try is recorded, and the options page shows it and offers
 *     "Check for updates now". */

import { isCustomCanvasOrigin } from './script-manifest.js';

export const CHECK_INTERVAL_MS = 20 * 60 * 1000;
// Chromium's own interval between real update checks (kDefaultUpdateFrequency).
export const CHROME_CHECK_INTERVAL_MS = 5 * 60 * 60 * 1000;
export const UPDATE_STATE_KEY = 'cgp.update';
export const CHECK_NOW = 'cgp.checkForUpdate';
const ALARM = 'cgp.updateCheck';
const LAST_CHECK_KEY = 'cgp.lastUpdateCheck';
const CANVAS_PATTERN = '*://*.instructure.com/courses/*';

/* Course pages on instructure.com plus any self-hosted Canvas domain the
 * teacher has granted: everywhere the content scripts run. */
async function canvasPatterns(chrome) {
  const patterns = [CANVAS_PATTERN];
  try {
    const perms = await chrome.permissions.getAll();
    (perms.origins || []).forEach((o) => {
      if (!isCustomCanvasOrigin(o)) return;   // a calendar's site, or instructure.com
      patterns.push(o.replace(/\/\*$/, '/courses/*'));
    });
  } catch (e) { /* instructure.com alone */ }
  return patterns;
}

function isCanvasCourseUrl(url, patterns) {
  if (!url) return false;
  return patterns.some((p) => {
    const m = /^\*:\/\/(\*\.)?([^/]+)(\/.*)$/.exec(p);
    if (!m) return false;
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    const hostOk = m[1] ? (u.hostname === m[2] || u.hostname.endsWith('.' + m[2])) : u.hostname === m[2];
    return hostOk && u.pathname.startsWith(m[3].replace(/\*$/, ''));
  });
}

/* Runs inside an open Canvas tab after an update (chrome.scripting, isolated
 * world): a small notice that this tab still runs the old version. Self-
 * contained - it is serialized into the page. */
export function showUpdatedNotice(version) {
  try {
    if (window.top !== window || document.querySelector('[data-cgp-updated]')) return;
    const host = document.createElement('div');
    host.setAttribute('data-cgp-updated', '');
    host.className = 'cgp-updated-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.n{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:12px;max-width:min(460px,calc(100vw - 40px));' +
      'padding:12px 12px 12px 16px;border-radius:14px;background:#14202c;color:#fff;box-shadow:0 14px 40px -10px rgba(9,16,29,.55);' +
      'font:500 13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:in .45s cubic-bezier(.22,1,.36,1) both}' +
      '@keyframes in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}' +
      '.t b{display:block;font-weight:700}.t span{color:#b9c4cf}' +
      'button{all:unset;cursor:pointer;border-radius:9px;padding:8px 12px;font-weight:650;white-space:nowrap}' +
      '.go{background:linear-gradient(135deg,#0374b5,#4f46d8);color:#fff}.go:hover{filter:brightness(1.1)}' +
      '.x{color:#b9c4cf;padding:8px}.x:hover{color:#fff}' +
      'button:focus-visible{box-shadow:0 0 0 3px rgba(94,194,255,.5)}' +
      '@media (prefers-reduced-motion:reduce){.n{animation:none}}' +
      '</style>' +
      '<div class="n" role="status"><div class="t"><b>Gradebook+ was updated' + (version ? ' to ' + String(version).replace(/[^0-9.]/g, '') : '') + '</b>' +
      '<span>This tab is still running the old version. Finish what you’re typing, then reload.</span></div>' +
      '<button class="go" type="button">Reload</button><button class="x" type="button" aria-label="Dismiss">✕</button></div>';
    root.querySelector('.go').addEventListener('click', () => location.reload());
    root.querySelector('.x').addEventListener('click', () => host.remove());
    (document.body || document.documentElement).appendChild(host);
  } catch (e) { /* never break the page */ }
}

export function createSelfUpdater(chrome, now = () => Date.now()) {
  async function readState() {
    try {
      const got = await chrome.storage.local.get(UPDATE_STATE_KEY);
      return (got && got[UPDATE_STATE_KEY]) || {};
    } catch (e) { return {}; }
  }
  async function writeState(patch) {
    try {
      const cur = await readState();
      await chrome.storage.local.set({ [UPDATE_STATE_KEY]: Object.assign(cur, patch) });
    } catch (e) { /* only a record */ }
  }

  /** Ask the Web Store for a newer version. At most once per
   *  CHECK_INTERVAL_MS unless opts.force (the options page's button).
   *  Resolves { status, version?, checkedAt?, nextCheckAt? }. */
  async function checkForUpdate(opts) {
    const force = !!(opts && opts.force);
    try {
      if (!force) {
        const got = await chrome.storage.local.get(LAST_CHECK_KEY);
        const last = (got && got[LAST_CHECK_KEY]) || 0;
        if (now() - last < CHECK_INTERVAL_MS) return { status: 'skipped' };
      }
      await chrome.storage.local.set({ [LAST_CHECK_KEY]: now() });
      // Unpacked copies answer "no_update". An update found arrives through
      // onUpdateAvailable once Chrome has downloaded it.
      const res = (await chrome.runtime.requestUpdateCheck()) || {};
      const status = res.status || 'checked';
      const patch = { lastTryAt: now(), lastStatus: status };
      if (status !== 'throttled') patch.lastCheckedAt = now();
      if (status === 'update_available') { patch.foundVersion = res.version || null; patch.foundAt = now(); }
      await writeState(patch);
      const state = await readState();
      return {
        status, version: res.version || null,
        checkedAt: state.lastCheckedAt || null,
        // Chrome's next real check, as far as this extension can tell.
        nextCheckAt: state.lastCheckedAt ? state.lastCheckedAt + CHROME_CHECK_INTERVAL_MS : null
      };
    } catch (e) {
      await writeState({ lastTryAt: now(), lastStatus: 'error', lastError: String(e && e.message) });
      return { status: 'error', error: String(e && e.message) };
    }
  }

  async function onUpdateAvailable(details) {
    await writeState({ foundVersion: (details && details.version) || null, foundAt: now() });
    chrome.runtime.reload();
  }

  async function onTabUpdated(tabId, changeInfo, tab) {
    if (!changeInfo || changeInfo.status !== 'complete') return;
    // tab.url is only visible for hosts this extension has access to, which
    // is every Canvas host it runs on.
    if (tab && isCanvasCourseUrl(tab.url, await canvasPatterns(chrome))) await checkForUpdate();
  }

  /** After an update: record it, and tell the Canvas tabs still running the
   *  old version. Returns how many tabs were told. */
  async function afterUpdate(details) {
    const version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    const previous = (details && details.previousVersion) || null;
    if (previous && previous === version) return 0;   // a reload, not an update
    await writeState({ updatedFrom: previous, updatedTo: version, updatedAt: now() });
    if (!chrome.tabs || !chrome.tabs.query || !chrome.scripting) return 0;
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: await canvasPatterns(chrome) }); } catch (e) { return 0; }
    let told = 0;
    await Promise.all(tabs.map(async (t) => {
      try {
        await chrome.scripting.executeScript({ target: { tabId: t.id }, func: showUpdatedNotice, args: [version] });
        told++;
      } catch (e) { /* a tab Chrome won't script (discarded, an error page) */ }
    }));
    return told;
  }

  /** Listeners at the service worker's top level, so their events wake it. */
  function start() {
    chrome.runtime.onUpdateAvailable.addListener(onUpdateAvailable);
    chrome.runtime.onStartup.addListener(() => { checkForUpdate(); });
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    if (chrome.alarms) {
      chrome.alarms.onAlarm.addListener((alarm) => { if (alarm && alarm.name === ALARM) checkForUpdate(); });
      // Created once; re-creating would restart its timer on every wake.
      Promise.resolve(chrome.alarms.get(ALARM)).then((existing) => {
        if (!existing) chrome.alarms.create(ALARM, { periodInMinutes: CHECK_INTERVAL_MS / 60000 });
      }).catch(() => {});
    }
  }

  return { start, checkForUpdate, onUpdateAvailable, onTabUpdated, afterUpdate, readState };
}
