/* Canvas Gradebook+ - relays "this submission changed" between course tabs.
 *
 * A tab that saved a submission (live-sync.js) sends {type, courseId,
 * cells: [{assignmentId, userId}]} to the service worker; this passes it on
 * to the other open tabs of the same course on the same Canvas site, so an
 * open gradebook and an open SpeedGrader can each re-read what changed.
 *
 * Only a tab whose URL the extension may read (its own Canvas hosts) is
 * ever addressed, only its top frame, and only ids are passed on. Nothing is
 * stored. Kept apart from background.js so it can be tested with a fake
 * chrome object. */

export const LIVE_SYNC_TYPE = 'cgp.live.changed';
const MAX_CELLS = 200;

function isId(v) {
  return /^\d+$/.test(String(v === undefined || v === null ? '' : v));
}

export function createLiveRelay(chrome) {
  async function relay(msg, sender) {
    if (!msg || msg.type !== LIVE_SYNC_TYPE) return 0;
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || !isId(msg.courseId) || !Array.isArray(msg.cells)) return 0;
    let origin;
    try { origin = new URL(sender.url || sender.tab.url).origin; } catch (e) { return 0; }
    const cells = msg.cells.filter((c) => c && isId(c.assignmentId)).slice(0, MAX_CELLS)
      .map((c) => ({ assignmentId: String(c.assignmentId), userId: isId(c.userId) ? String(c.userId) : null }));
    if (!cells.length) return 0;
    const out = { type: LIVE_SYNC_TYPE, courseId: String(msg.courseId), cells, commentsOnly: !!msg.commentsOnly };
    const prefix = origin + '/courses/' + out.courseId + '/';
    const tabs = await chrome.tabs.query({});
    let sent = 0;
    (tabs || []).forEach((tab) => {
      if (!tab || tab.id === undefined || tab.id === sender.tab.id || !tab.url || !tab.url.startsWith(prefix)) return;
      sent++;
      try {
        const done = chrome.tabs.sendMessage(tab.id, out, { frameId: 0 });
        if (done && typeof done.catch === 'function') done.catch(() => { /* a tab without our script */ });
      } catch (e) { /* the tab went away */ }
    });
    return sent;
  }
  return { relay };
}
