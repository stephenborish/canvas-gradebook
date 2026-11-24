/* Canvas Gradebook+ - Hidden Gems (pure logic): which effect, if any, today.
 *
 * Three rare effects over the Canvas page (drawn by core/hidden-gems-ui.js
 * and src/gems/*.js): snow when it is really snowing around Philadelphia
 * and Malvern (weather.js asks Open-Meteo), Christmas lights in the
 * Christmas season, and autumn leaves in autumn. Real snow shows once on
 * any day it is falling; otherwise one decision a day, made on the first
 * Canvas page of the day, and most days nothing shows.
 *
 * Pure JS: no DOM and no chrome.* access at load time, so Node unit tests
 * can load and exercise this module directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.hiddenGems) return;

  var KINDS = ['snow', 'leaves', 'lights'];

  // On a day without snow, the chance that the day's one roll shows the
  // season's effect (lights or leaves).
  var SEASON_CHANCE = 0.4;

  /* The WMO weather codes for the Philadelphia / Malvern area (one per
   * place, as Open-Meteo reports them) to { id: 'snow', heavy }, or null
   * when no snow is falling. Snow in either place counts; the heavier
   * reading wins. */
  function snowKind(codes) {
    var list = Array.isArray(codes) ? codes : [codes];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var c = Number(list[i]);
      if (!isFinite(c)) continue;
      if (!((c >= 71 && c <= 77) || c === 85 || c === 86)) continue;
      var heavy = c === 75 || c === 86;
      if (!best || (heavy && !best.heavy)) best = { id: 'snow', heavy: heavy };
    }
    return best;
  }

  function dayKey(d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
  }

  // Christmas season: 1 December to 6 January. Autumn: 22 September to 30 November.
  function isChristmasSeason(d) {
    var m = d.getMonth(), day = d.getDate();
    return m === 11 || (m === 0 && day <= 6);
  }
  function isAutumn(d) {
    var m = d.getMonth(), day = d.getDate();
    return (m === 8 && day >= 22) || m === 9 || m === 10;
  }

  /* Has today's one roll not been made yet? */
  function rollDue(state, now, opts) {
    var o = opts || {};
    if (o.enabled === false || o.reducedMotion) return false;
    return !state || state.rolledDay !== dayKey(now || new Date());
  }

  /* Has real snow not shown yet today? Snow keeps its own day apart from
   * the roll, so snow that starts after the day's first page still shows,
   * and a failed weather lookup costs nothing. */
  function weatherDue(state, now) {
    return !state || state.weatherDay !== dayKey(now || new Date());
  }

  /* The day's roll: the season's effect on some days, else nothing. */
  function chooseGem(now, rng) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var r = typeof rng === 'function' ? rng() : Math.random();
    if (r >= SEASON_CHANCE) return null;
    if (isChristmasSeason(d)) return { id: 'lights', opts: {} };
    if (isAutumn(d)) return { id: 'leaves', opts: {} };
    return null;
  }

  /* What to play now, given the saved state and the weather (null when it
   * could not be read): { pick: { id, opts } | null, state } to save, or
   * null when there is nothing to decide. */
  function decide(state, now, weather, rng) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var today = dayKey(d);
    var snow = weather ? snowKind(weather.codes) : null;
    if (snow && weatherDue(state, d)) {
      return { pick: { id: 'snow', opts: { heavy: snow.heavy } }, state: { rolledDay: today, weatherDay: today } };
    }
    if (!rollDue(state, d)) return null;
    // Snow that already showed today is not rolled for again.
    return { pick: snow ? null : chooseGem(d, rng), state: { rolledDay: today, weatherDay: (state && state.weatherDay) || null } };
  }

  CGP.hiddenGems = {
    KINDS: KINDS,
    SEASON_CHANCE: SEASON_CHANCE,
    snowKind: snowKind,
    dayKey: dayKey,
    isChristmasSeason: isChristmasSeason,
    isAutumn: isAutumn,
    rollDue: rollDue,
    weatherDue: weatherDue,
    chooseGem: chooseGem,
    decide: decide
  };
})();
