/* Canvas Gradebook+ - service worker.
 *
 * Deliberately tiny. It seeds default settings, opens the options page from the
 * toolbar icon, and registers the content scripts for self-hosted Canvas
 * domains the teacher has granted. It never touches Canvas data. */

import { CONTENT_JS, CONTENT_CSS } from './script-manifest.js';

const SETTINGS_KEY = 'cgp.settings';
const DYNAMIC_ID = 'cgp-custom-domains';

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

async function syncDynamicScripts() {
  try {
    const perms = await chrome.permissions.getAll();
    const origins = (perms.origins || []).filter((o) => !o.includes('instructure.com') && o !== '*://*/*');
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_ID] }).catch(() => []);
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_ID] });
    if (!origins.length) return { registered: 0 };
    await chrome.scripting.registerContentScripts([{
      id: DYNAMIC_ID,
      matches: origins.map(toCoursesPattern),
      js: CONTENT_JS,
      css: CONTENT_CSS,
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true
    }]);
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
