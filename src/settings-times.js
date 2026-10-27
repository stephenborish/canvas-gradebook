/* Canvas Gradebook+ - which computers Chrome sync reaches.
 *
 * Settings live in chrome.storage.sync, which Chrome carries to every
 * computer signed in to the same Google account with sync on (and
 * Extensions included). Whether that is actually happening is otherwise
 * invisible, so each computer checks in through it now and then
 * ('cgp.device.<id>' = {at, label}): the options page lists the other
 * computers whose check-ins have arrived, and says what to look at when
 * none have. (When each setting changed is kept beside the setting itself,
 * see CGP.settingsTimes in core/util.js.) Runs in the service worker. */

export const DEVICE_PREFIX = 'cgp.device.';
const DEVICE_ID_KEY = 'cgp.deviceId';
const DEVICE_SEEN_KEY = 'cgp.deviceSeenAt';
const CHECK_IN_MS = 6 * 3600 * 1000;
const FORGET_DEVICE_MS = 120 * 86400 * 1000;

function platformLabel() {
  try {
    const p = (globalThis.navigator && (navigator.userAgentData && navigator.userAgentData.platform || navigator.platform)) || '';
    if (/mac/i.test(p)) return 'Mac';
    if (/win/i.test(p)) return 'Windows';
    if (/cros|chrome ?os/i.test(p)) return 'Chromebook';
    if (/linux/i.test(p)) return 'Linux';
    return p || 'Computer';
  } catch (e) { return 'Computer'; }
}

export function createSettingsTimes(chrome, now = () => Date.now()) {
  /* This computer's check-in, at most every few hours; computers not seen
   * for months are forgotten. */
  async function checkIn(force) {
    const got = await chrome.storage.local.get([DEVICE_ID_KEY, DEVICE_SEEN_KEY]).catch(() => ({}));
    let id = got[DEVICE_ID_KEY];
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + now().toString(36);
      await chrome.storage.local.set({ [DEVICE_ID_KEY]: id }).catch(() => 0);
    }
    if (!force && got[DEVICE_SEEN_KEY] && now() - got[DEVICE_SEEN_KEY] < CHECK_IN_MS) return false;
    await chrome.storage.sync.set({ [DEVICE_PREFIX + id]: { at: now(), label: platformLabel() } });
    await chrome.storage.local.set({ [DEVICE_SEEN_KEY]: now() }).catch(() => 0);
    const all = await chrome.storage.sync.get(null).catch(() => ({}));
    const old = Object.keys(all).filter((k) => k.indexOf(DEVICE_PREFIX) === 0 && now() - Number((all[k] || {}).at || 0) > FORGET_DEVICE_MS);
    if (old.length) await chrome.storage.sync.remove(old).catch(() => 0);
    return true;
  }

  return {
    checkIn,
    start() { checkIn(false).catch(() => 0); }
  };
}
