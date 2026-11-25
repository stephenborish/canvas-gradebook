/* Canvas Gradebook+ - Studio's class list, passed between frames of a tab.
 *
 * Studio (a frame on <school>.instructuremedia.com inside a Canvas page)
 * knows who watched a video but not who is in the class. The extension's
 * script in that frame (studio/content.js) asks here with
 * 'cgp.studio.roster'; this asks the Canvas page's own script in the same
 * tab's top frame (studio/canvas-relay.js), which reads the class with the
 * teacher's Canvas session, and passes its answer back.
 *
 * It used to go over window.postMessage, where any script on the Studio
 * page could send the question and read the answer: students' names and
 * emails. Extension messages can only come from the extension's own
 * scripts, so here the asker is checked (a frame, on a Studio site, in a
 * tab) and nothing passes through a page. Nothing is stored. Kept apart
 * from background.js so it can be tested with a fake chrome object. */

export const STUDIO_ROSTER = 'cgp.studio.roster';
export const STUDIO_ROSTER_ASK = 'cgp.studio.roster.ask';
const STUDIO_ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.instructuremedia\.com$/i;

export function createStudioRoster(chrome) {
  /* The extension's own script, in a frame (never the page itself) of a
   * tab, on a Canvas Studio site. */
  function isStudioFrame(sender) {
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || sender.tab.id === undefined || !sender.frameId) return false;
    try { return STUDIO_ORIGIN.test(new URL(sender.url).origin); } catch (e) { return false; }
  }

  /** chrome.runtime.onMessage handler: returns true when it will answer
   *  asynchronously, as onMessage expects. */
  function handle(msg, sender, respond) {
    if (!msg || msg.type !== STUDIO_ROSTER) return false;
    if (!isStudioFrame(sender)) { respond({ ok: false, error: 'refused' }); return false; }
    const ask = {
      type: STUDIO_ROSTER_ASK,
      courseName: String(msg.courseName || '').slice(0, 300),
      courseId: /^\d+$/.test(String(msg.courseId || '')) ? String(msg.courseId) : null
    };
    Promise.resolve()
      .then(() => chrome.tabs.sendMessage(sender.tab.id, ask, { frameId: 0 }))
      .then((answer) => respond(answer || { ok: false }), () => respond({ ok: false }));
    return true;
  }

  return { handle, isStudioFrame };
}
