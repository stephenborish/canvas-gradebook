/* Canvas Gradebook+ - picking up a new Web Store version promptly.
 *
 * Chrome checks the Web Store for updates every few hours on its own. This
 * asks sooner (when Chrome starts, and when a Canvas course page loads, at
 * most once an hour) and, once Chrome has downloaded a new version, reloads
 * the extension so it takes effect right away instead of at the next browser
 * restart.
 *
 * Reloading orphans the content scripts already running in open tabs: they
 * lose chrome.storage and every other extension API until the page is
 * reloaded. So a downloaded update waits until no Canvas course page is open
 * - closing or navigating away from the last one applies it. The pending flag
 * lives in chrome.storage.session, which survives the service worker being
 * stopped between events and is cleared by the reload itself. */

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LAST_CHECK_KEY = 'cgp.lastUpdateCheck';
const PENDING_KEY = 'cgp.updatePending';
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

  /** Reload into the downloaded version if no Canvas page would be orphaned. */
  async function applyIfIdle() {
    try {
      const got = await chrome.storage.session.get(PENDING_KEY);
      if (!got || !got[PENDING_KEY]) return false;
      // Chrome ignores the url filter for hosts the extension has lost access
      // to (site access set to "on click") and returns every tab, which
      // only errs toward waiting for the next browser restart.
      const tabs = await chrome.tabs.query({ url: await canvasPatterns(chrome) });
      if (tabs && tabs.length) return false;
      chrome.runtime.reload();
      return true;
    } catch (e) {
      return false;
    }
  }

  async function onUpdateAvailable(details) {
    try {
      await chrome.storage.session.set({ [PENDING_KEY]: (details && details.version) || true });
    } catch (e) { /* applyIfIdle then finds nothing pending; restart applies it */ }
    return applyIfIdle();
  }

  async function onTabUpdated(tabId, changeInfo, tab) {
    if (!changeInfo || changeInfo.status !== 'complete') return;
    // A tab that just left Canvas may have been the last one holding an
    // update back. Keyed on status, not url: Chrome only reports a tab's URL
    // for sites this extension has host access to, so a tab navigating from
    // Canvas to anywhere else never reports its new one.
    if (await applyIfIdle()) return;
    if (tab && isCanvasCourseUrl(tab.url, await canvasPatterns(chrome))) await checkForUpdate();
  }

  /** Listeners at the service worker's top level, so their events wake it. */
  function start() {
    chrome.runtime.onUpdateAvailable.addListener(onUpdateAvailable);
    chrome.runtime.onStartup.addListener(() => { checkForUpdate(); });
    chrome.tabs.onRemoved.addListener(() => { applyIfIdle(); });
    chrome.tabs.onUpdated.addListener(onTabUpdated);
  }

  return { start, checkForUpdate, applyIfIdle, onUpdateAvailable, onTabUpdated };
}

export const _test = { isCanvasCourseUrl };
