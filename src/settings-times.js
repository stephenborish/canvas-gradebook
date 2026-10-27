/* Canvas Gradebook+ - when each setting last changed, and which computers
 * Chrome sync reaches.
 *
 * Settings live in chrome.storage.sync, which Chrome carries to every
 * computer signed in to the same Google account with sync on. The extension
 * ALSO keeps a copy in the teacher's own Canvas account (core/settings-
 * mirror.js), for the computers Chrome sync does not reach - a school can
 * turn Chrome sync off for its accounts, and many do. Merging the two needs
 * to know, setting by setting, which change is newer, so this records the
 * time each settings item last changed on this computer:
 *   chrome.storage.local 'cgp.st.<sync key>' = {at, h, del}
 * h is a hash of the value: a change that only puts back the value already
 * recorded (the mirror applying a newer value it has just recorded) is not
 * a new change. Runs in the service worker, the one place every write -
 * options page, Canvas tabs, Chrome sync itself - is seen exactly once.
 *
 * It also has each computer check in through Chrome sync now and then
 * ('cgp.device.<id>' = {at, label}), so the options page can say whether
 * Chrome sync is carrying anything between this teacher's computers. */

export const TIME_PREFIX = 'cgp.st.';
export const DEVICE_PREFIX = 'cgp.device.';
const DEVICE_ID_KEY = 'cgp.deviceId';
const DEVICE_SEEN_KEY = 'cgp.deviceSeenAt';
const CHECK_IN_MS = 6 * 3600 * 1000;
const FORGET_DEVICE_MS = 120 * 86400 * 1000;

export function isSettingsKey(k) {
  k = String(k);
  return k === 'cgp.snippetStore' || k.indexOf('cgp.setting.') === 0 || k.indexOf('cgp.snippet.') === 0;
}

/** FNV-1a of the value's JSON: equal values, equal hashes. */
export function valueHash(v) {
  const s = v === undefined ? 'u' : JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

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
  /* The times for the settings items in one chrome.storage.onChanged. */
  async function onChanged(changes, area) {
    if (area !== 'sync') return 0;
    const keys = Object.keys(changes || {}).filter(isSettingsKey);
    if (!keys.length) return 0;
    const tk = keys.map((k) => TIME_PREFIX + k);
    const known = await chrome.storage.local.get(tk).catch(() => ({}));
    const write = {};
    keys.forEach((k) => {
      const removed = !Object.prototype.hasOwnProperty.call(changes[k], 'newValue');
      const h = removed ? 'deleted' : valueHash(changes[k].newValue);
      const had = known[TIME_PREFIX + k];
      if (had && had.h === h) return;
      write[TIME_PREFIX + k] = removed ? { at: now(), h, del: true } : { at: now(), h };
    });
    const n = Object.keys(write).length;
    if (n) await chrome.storage.local.set(write).catch(() => 0);
    return n;
  }

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
    onChanged,
    checkIn,
    start() {
      chrome.storage.onChanged.addListener((changes, area) => { onChanged(changes, area).catch(() => 0); });
      checkIn(false).catch(() => 0);
    }
  };
}
