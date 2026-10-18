/* Canvas Gradebook+ - picking up a new Web Store version promptly.
 *
 * Chrome checks the Web Store for updates every few hours on its own. This
 * asks sooner: when Chrome starts, and when a Canvas course page loads, at
 * most once an hour. Once Chrome has downloaded a new version it reloads the
 * extension straight away.
 *
 * Chrome installs a downloaded update as soon as the service worker goes
 * idle, and open content scripts do not count as activity, so an update
 * cannot usefully be held back while a gradebook is open; reloading at once
 * only saves the idle wait. A page that was already open when the update
 * landed keeps working (its writes go straight to Canvas) but loses
 * chrome.storage until it is reloaded. */

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LAST_CHECK_KEY = 'cgp.lastUpdateCheck';
const CANVAS_PATTERN = '*://*.instructure.com/courses/*';

/* Course pages on instructure.com plus any self-hosted Canvas domain the
 * teacher has granted: everywhere the content scripts run. */
async function canvasPatterns(chrome) {
  const patterns = [CANVAS_PATTERN];
  try {
    const perms = await chrome.permissions.getAll();
    (perms.origins || []).forEach((o) => {
      if (o.includes('instructure.com') || o === '*://*/*') return;
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

export function createSelfUpdater(chrome, now = () => Date.now()) {
  /** Ask the Web Store for a newer version, at most once per interval. */
  async function checkForUpdate() {
    try {
      const got = await chrome.storage.local.get(LAST_CHECK_KEY);
      const last = (got && got[LAST_CHECK_KEY]) || 0;
      if (now() - last < CHECK_INTERVAL_MS) return 'skipped';
      await chrome.storage.local.set({ [LAST_CHECK_KEY]: now() });
      // An update found here arrives through onUpdateAvailable once Chrome
      // has downloaded it. Unpacked copies answer "no_update".
      const res = await chrome.runtime.requestUpdateCheck();
      return (res && res.status) || 'checked';
    } catch (e) {
      return 'error';
    }
  }

  function onUpdateAvailable() {
    chrome.runtime.reload();
  }

  async function onTabUpdated(tabId, changeInfo, tab) {
    if (!changeInfo || changeInfo.status !== 'complete') return;
    // tab.url is only visible for hosts this extension has access to, which
    // is every Canvas host it runs on.
    if (tab && isCanvasCourseUrl(tab.url, await canvasPatterns(chrome))) await checkForUpdate();
  }

  /** Listeners at the service worker's top level, so their events wake it. */
  function start() {
    chrome.runtime.onUpdateAvailable.addListener(onUpdateAvailable);
    chrome.runtime.onStartup.addListener(() => { checkForUpdate(); });
    chrome.tabs.onUpdated.addListener(onTabUpdated);
  }

  return { start, checkForUpdate, onUpdateAvailable, onTabUpdated };
}
