/* Canvas Gradebook+ - service worker.
 *
 * Deliberately tiny. It opens the options page from the
 * toolbar icon, registers the content scripts for self-hosted Canvas
 * domains the teacher has granted, applies Web Store updates promptly
 * (self-update.js), relays "this submission changed" announcements
 * between the open tabs of one course (live-sync.js) - ids only, never
 * stored - and checks this computer in through Chrome sync (settings-times.js). It
 * never reads or stores Canvas data itself. */

import { CONTENT_JS, CONTENT_CSS } from './script-manifest.js';
import { createSelfUpdater } from './self-update.js';
import { createLiveRelay, LIVE_SYNC_TYPE } from './live-relay.js';
import { createSettingsTimes } from './settings-times.js';

const DYNAMIC_ID = 'cgp-custom-domains';
const DYNAMIC_BRIDGE_ID = 'cgp-custom-domains-bridge';
const DYNAMIC_WATCH_ID = 'cgp-custom-domains-write-watch';

function toCoursesPattern(origin) {
  // "*://canvas.school.edu/*" -> "*://canvas.school.edu/courses/*"
  return origin.replace(/\/\*$/, '/courses/*');
}

function toGradebookPattern(origin) {
  // "*://canvas.school.edu/*" -> "*://canvas.school.edu/courses/*/gradebook*"
  return origin.replace(/\/\*$/, '/courses/*/gradebook*');
}

function toSpeedGraderPattern(origin) {
  // The gradebook pattern above also matches SpeedGrader's URL, which has no
  // grid for the page-world bridge to work on.
  return origin.replace(/\/\*$/, '/courses/*/gradebook/speed_grader*');
}

/* Registers with an optional key first and falls back without it: an
 * unknown key (an older Chrome) makes registerContentScripts reject the
 * whole call, which would leave the self-hosted domain with nothing. */
async function registerWithFallback(script, optionalKeys) {
  try {
    await chrome.scripting.registerContentScripts([script]);
  } catch (e) {
    const plain = Object.assign({}, script);
    optionalKeys.forEach((k) => { delete plain[k]; });
    await chrome.scripting.registerContentScripts([plain]);
  }
}

/* Self-hosted Canvas gets what *.instructure.com gets from the manifest:
 * the content scripts in every frame (comment frames need them for
 * snippets), and the page-context bridge in the MAIN world at
 * document_start on gradebook pages, so it can see Canvas's grid being
 * built rather than having to go looking for it afterwards. */
async function syncDynamicScripts() {
  try {
    const perms = await chrome.permissions.getAll();
    const origins = (perms.origins || []).filter((o) => !o.includes('instructure.com') && o !== '*://*/*');
    const ids = [DYNAMIC_ID, DYNAMIC_BRIDGE_ID, DYNAMIC_WATCH_ID];
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => []);
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    if (!origins.length) return { registered: 0 };
    await registerWithFallback({
      id: DYNAMIC_BRIDGE_ID,
      matches: origins.map(toGradebookPattern),
      excludeMatches: origins.map(toSpeedGraderPattern),
      js: ['src/page/env-bridge.js'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true
    }, []);
    // Canvas's own submission writes, on the gradebook and SpeedGrader both.
    await registerWithFallback({
      id: DYNAMIC_WATCH_ID,
      matches: origins.map(toGradebookPattern),
      js: ['src/page/write-watch.js'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true
    }, []);
    await registerWithFallback({
      id: DYNAMIC_ID,
      matches: origins.map(toCoursesPattern),
      js: CONTENT_JS,
      css: CONTENT_CSS,
      runAt: 'document_idle',
      // Real (same-URL-scheme) frames only: the scripting API's
      // matchOriginAsFallback, which would also reach about:blank frames,
      // only accepts a "/*" path, i.e. every page on the school's domain.
      allFrames: true,
      persistAcrossSessions: true
    }, []);
    return { registered: origins.length, matches: origins.map(toCoursesPattern) };
  } catch (e) {
    return { error: String(e && e.message) };
  }
}

// No settings are written here. Defaults need no storing (every reader fills
// them in), and writing them on a fresh install raced the teacher's real
// settings on their way in through Chrome sync.
chrome.runtime.onInstalled.addListener(async () => {
  await syncDynamicScripts();
});

chrome.runtime.onStartup.addListener(() => { syncDynamicScripts(); settingsTimes.checkIn(false).catch(() => 0); });

if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => { syncDynamicScripts(); });
  chrome.permissions.onRemoved.addListener(() => { syncDynamicScripts(); });
}

createSelfUpdater(chrome).start();
// This computer's Chrome sync check-in (shown on the options page).
const settingsTimes = createSettingsTimes(chrome);
settingsTimes.start();
const liveRelay = createLiveRelay(chrome);

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.type === LIVE_SYNC_TYPE) {
    liveRelay.relay(msg, sender).catch(() => 0);
    return false;
  }
  if (msg && msg.type === 'cgp.checkIn') {
    settingsTimes.checkIn(true).then(() => respond({ ok: true }), (e) => respond({ ok: false, error: String(e && e.message) }));
    return true;
  }
  if (!msg || msg.type !== 'cgp.syncDynamicScripts') return false;
  syncDynamicScripts().then(respond);
  return true; // async response
});
