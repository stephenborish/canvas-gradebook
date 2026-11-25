/* Canvas Gradebook+ - service worker.
 *
 * Deliberately tiny. It opens the options page from the
 * toolbar icon, registers the content scripts for self-hosted Canvas
 * domains the teacher has granted, applies Web Store updates promptly
 * (self-update.js), relays "this submission changed" announcements
 * between the open tabs of one course (live-sync.js) - ids only, never
 * stored - checks this computer in through Chrome sync (settings-times.js),
 * fetches the teacher's class-schedule calendar (calendar-sync.js), passes
 * Studio's request for a class list to the Canvas page in the same tab
 * (studio-roster.js), and asks
 * whether it is snowing or raining around Philadelphia (weather.js). It
 * never reads or stores Canvas data itself. */

import { COMMON_JS, GRADING_JS, BOOT_JS, CONTENT_CSS, GRADING_CSS, FRAME_JS, isCustomCanvasOrigin } from './script-manifest.js';
import { createSelfUpdater, CHECK_NOW } from './self-update.js';
import { createLiveRelay, LIVE_SYNC_TYPE } from './live-relay.js';
import { createSettingsTimes } from './settings-times.js';
import { createCalendarSync, CALENDAR_REFRESH, CALENDAR_ADOPT } from './calendar-sync.js';
import { createWeather, WEATHER_NOW } from './weather.js';
import { createStudioRoster, STUDIO_ROSTER } from './studio-roster.js';
// The welcome tour's record (a plain script that adds CGP.TourState to
// globalThis), so its shape is defined in one place.
import './tour/tour-state.js';
// What a frame inside a course page gets (frame-gate.js), likewise.
import './frame-gate.js';

const TourState = globalThis.CGP.TourState;
const FrameGate = globalThis.CGP.FrameGate;

const DYNAMIC_ID = 'cgp-custom-domains';
const DYNAMIC_BRIDGE_ID = 'cgp-custom-domains-bridge';
const DYNAMIC_WATCH_ID = 'cgp-custom-domains-write-watch';
const DYNAMIC_FRAME_ID = 'cgp-custom-domains-frames';
const DYNAMIC_GRADING_ID = 'cgp-custom-domains-grading';
const DYNAMIC_BOOT_ID = 'cgp-custom-domains-boot';

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
 * the content scripts in the course page, the small frame gate in every
 * frame inside it (comment frames need snippets), and the page-context bridge in the MAIN world at
 * document_start on gradebook pages, so it can see Canvas's grid being
 * built rather than having to go looking for it afterwards. */
async function syncDynamicScripts() {
  try {
    const perms = await chrome.permissions.getAll();
    // A class-schedule calendar's site is granted too, and gets no scripts.
    const origins = (perms.origins || []).filter(isCustomCanvasOrigin);
    const ids = [DYNAMIC_ID, DYNAMIC_GRADING_ID, DYNAMIC_BOOT_ID, DYNAMIC_BRIDGE_ID, DYNAMIC_WATCH_ID, DYNAMIC_FRAME_ID];
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
    // The page's scripts in three groups, as in manifest.json (see
    // script-manifest.js): every course page, grading pages only, then the
    // boot. One call, so they are registered - and injected - in order.
    const page = { runAt: 'document_idle', allFrames: false, persistAcrossSessions: true };   // frames get the gate below
    await chrome.scripting.registerContentScripts([
      Object.assign({ id: DYNAMIC_ID, matches: origins.map(toCoursesPattern), js: COMMON_JS, css: CONTENT_CSS }, page),
      Object.assign({ id: DYNAMIC_GRADING_ID, matches: origins.map(toGradebookPattern), js: GRADING_JS, css: GRADING_CSS }, page),
      Object.assign({ id: DYNAMIC_BOOT_ID, matches: origins.map(toCoursesPattern), js: BOOT_JS }, page)
    ]);
    await registerWithFallback({
      id: DYNAMIC_FRAME_ID,
      matches: origins.map(toCoursesPattern),
      js: FRAME_JS,
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
//
// The one exception is the welcome tour (src/tour/): a fresh install - never
// an update - marks it due on this computer, and the first gradebook that
// shows it clears the mark again. chrome.storage.local, so it is per install.
chrome.runtime.onInstalled.addListener(async (details) => {
  // A fresh install marks it due; an update leaves the record as it was
  // (finished, skipped or part-way). write() swallows storage errors: the
  // tour never blocks setup.
  if (details) await new TourState(chrome.storage.local).handleInstalled(details.reason);
  // A new version: the Canvas tabs already open still run the old one until
  // they are reloaded, so they are told (self-update.js).
  if (details && details.reason === 'update') await selfUpdater.afterUpdate(details);
  await syncDynamicScripts();
});

// The check-in needs no listener of its own: settingsTimes.start() below runs
// on every service-worker start, browser startup included.
chrome.runtime.onStartup.addListener(() => { syncDynamicScripts(); });

if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => { syncDynamicScripts(); });
  chrome.permissions.onRemoved.addListener(() => { syncDynamicScripts(); });
}

const selfUpdater = createSelfUpdater(chrome);
selfUpdater.start();
// This computer's Chrome sync check-in (shown on the options page).
const settingsTimes = createSettingsTimes(chrome);
settingsTimes.start();
const liveRelay = createLiveRelay(chrome);
const calendarSync = createCalendarSync(chrome);
const weather = createWeather(chrome);
const studioRoster = createStudioRoster(chrome);

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.type === LIVE_SYNC_TYPE) {
    liveRelay.relay(msg, sender).catch(() => 0);
    return false;
  }
  if (msg && msg.type === CALENDAR_REFRESH) {
    calendarSync.refresh(msg.url, { force: !!msg.force, probe: !!msg.probe })
      .then(respond, (e) => respond({ ok: false, error: String(e && e.message) }));
    return true;
  }
  // Only the options page (an extension page, no tab) may store a probed calendar.
  if (msg && msg.type === CALENDAR_ADOPT) {
    const fromOptions = sender && sender.id === chrome.runtime.id && String(sender.url || '').indexOf(chrome.runtime.getURL('src/options/')) === 0;
    if (!fromOptions) { respond({ ok: false, code: 'refused' }); return false; }
    calendarSync.adopt(msg.rec).then(respond, () => respond({ ok: false, code: 'store' }));
    return true;
  }
  // Hidden Gems: an effect's code goes into the asking frame only when that
  // effect is about to play, never on every page.
  if (msg && msg.type === 'cgp.gems.load') {
    const GEMS = ['snow', 'leaves', 'lights'];
    if (!sender || !sender.tab || sender.tab.id === undefined || GEMS.indexOf(msg.id) === -1) { respond({ ok: false }); return false; }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
      files: ['src/gems/' + msg.id + '.js']
    }).then(() => respond({ ok: true }), (e) => respond({ ok: false, error: String(e && e.message) }));
    return true;
  }
  // Studio's class list (studio/content.js in a Studio frame -> the Canvas
  // page's canvas-relay.js in the same tab). Only the extension's own
  // script in a frame on a Studio site may ask, and only its own tab's top
  // frame is asked; the answer goes back the same way, never through the
  // page, so no page script can request or read the roster.
  if (msg && msg.type === STUDIO_ROSTER) return studioRoster.handle(msg, sender, respond);
  // Hidden Gems on a course page: is it snowing or raining around Philadelphia?
  if (msg && msg.type === WEATHER_NOW) {
    weather.now().then(respond, () => respond({ ok: false, code: 'error' }));
    return true;
  }
  if (msg && msg.type === 'cgp.openOptions') {
    const tab = typeof msg.hash === 'string' && /^[a-z]+(-tour)?$/.test(msg.hash) ? msg.hash : 'schedule';
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#' + tab) });
    return false;
  }
  // A course page that wants the welcome tour (tour-state.js decided): the
  // tour itself goes into that frame only now, never on every page.
  if (msg && msg.type === TourState.INJECT) {
    if (sender && sender.tab && sender.tab.id !== undefined) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
        files: TourState.FILES
      }).catch(() => 0);
    }
    return false;
  }
  // A comment editor's frame in the gradebook or SpeedGrader (frame-gate.js):
  // the scripts that expand snippets, into that frame only. Answered once
  // they have run, so the frame can then load the teacher's settings.
  if (msg && msg.type === FrameGate.MESSAGE) {
    if (!sender || !sender.tab || sender.tab.id === undefined || !sender.frameId) return false;
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
      files: FrameGate.FILES
    }).then(() => respond({ ok: true }), (e) => respond({ ok: false, error: String(e && e.message) }));
    return true;
  }
  // The options page's "Check for updates now".
  if (msg && msg.type === CHECK_NOW) {
    selfUpdater.checkForUpdate({ force: true }).then(respond, (e) => respond({ status: 'error', error: String(e && e.message) }));
    return true;
  }
  if (msg && msg.type === 'cgp.checkIn') {
    settingsTimes.checkIn(true).then(() => respond({ ok: true }), (e) => respond({ ok: false, error: String(e && e.message) }));
    return true;
  }
  if (!msg || msg.type !== 'cgp.syncDynamicScripts') return false;
  syncDynamicScripts().then(respond);
  return true; // async response
});
