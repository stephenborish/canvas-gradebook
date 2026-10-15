/* Canvas Gradebook+ - service worker.
 *
 * Deliberately tiny. It seeds default settings, opens the options page from the
 * toolbar icon, and registers the content scripts for self-hosted Canvas
 * domains the teacher has granted. It never touches Canvas data. */

import { CONTENT_JS, CONTENT_CSS } from './script-manifest.js';

const SETTINGS_KEY = 'cgp.settings';
const DYNAMIC_ID = 'cgp-custom-domains';
const DYNAMIC_BRIDGE_ID = 'cgp-custom-domains-bridge';

async function seedDefaults() {
  const got = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!got || !got[SETTINGS_KEY]) {
    // An empty object is fine: the content scripts sanitize and fill defaults.
    await chrome.storage.sync.set({ [SETTINGS_KEY]: {} });
  }
}

function toCoursesPattern(origin) {
  // "*://canvas.school.edu/*" -> "*://canvas.school.edu/courses/*"
  return origin.replace(/\/\*$/, '/courses/*');
}

function toGradebookPattern(origin) {
  // "*://canvas.school.edu/*" -> "*://canvas.school.edu/courses/*/gradebook*"
  return origin.replace(/\/\*$/, '/courses/*/gradebook*');
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
    const ids = [DYNAMIC_ID, DYNAMIC_BRIDGE_ID];
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => []);
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    if (!origins.length) return { registered: 0 };
    await registerWithFallback({
      id: DYNAMIC_BRIDGE_ID,
      matches: origins.map(toGradebookPattern),
      js: ['src/page/env-bridge.js'],
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

chrome.runtime.onInstalled.addListener(async () => {
  await seedDefaults();
  await syncDynamicScripts();
});

chrome.runtime.onStartup.addListener(() => { syncDynamicScripts(); });

if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => { syncDynamicScripts(); });
  chrome.permissions.onRemoved.addListener(() => { syncDynamicScripts(); });
}

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.type !== 'cgp.syncDynamicScripts') return false;
  syncDynamicScripts().then(respond);
  return true; // async response
});
