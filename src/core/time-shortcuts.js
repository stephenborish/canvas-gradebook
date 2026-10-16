/* Canvas Gradebook+ - pure time-shortcut logic.
 * A teacher types a short key (1, 2, 3, 4 = school periods) into one of
 * Canvas's "Time" boxes and the key is swapped for that period's start time.
 * Shortcut lists are cleaned by CGP.sanitizeSettings; this module only looks
 * keys up and renders a stored "HH:MM" the way Canvas displays times. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.timeShortcuts) return;

  /** The shortcut whose key is exactly `text` (case-insensitive), or null. */
  function lookup(text, list) {
    var key = CGP.normalizeTimeKey(text);
    // normalizeTimeKey strips characters, so "1:00" would become "100" - only
    // a box holding nothing but a key may match.
    if (!key || key !== String(text == null ? '' : text).trim().toLowerCase()) return null;
    var rows = Array.isArray(list) ? list : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && CGP.normalizeTimeKey(rows[i].key) === key && CGP.normalizeClock(rows[i].time)) return rows[i];
    }
    return null;
  }

  /** "13:45" -> "1:45 PM" (12-hour) or "13:45" (24-hour). Plain ASCII spaces:
   * Canvas's time parser does not accept the narrow no-break space newer
   * Intl builds put before AM/PM. */
  function format(clock, opts) {
    var c = CGP.normalizeClock(clock);
    if (!c) return '';
    var h = Number(c.slice(0, 2)), mm = c.slice(3);
    if (opts && opts.hour12 === false) return c;
    return (h % 12 || 12) + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  /** Whether `locale` shows clock times with AM/PM. */
  function uses12Hour(locale) {
    try {
      var o = new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric' }).resolvedOptions();
      if (typeof o.hour12 === 'boolean') return o.hour12;
      return /h1[12]/.test(o.hourCycle || '');
    } catch (e) { return true; }
  }

  CGP.timeShortcuts = { lookup: lookup, format: format, uses12Hour: uses12Hour };
})();
