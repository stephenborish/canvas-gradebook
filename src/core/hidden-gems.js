/* Canvas Gradebook+ - Hidden Gems (pure logic): which effect, if any, today.
 *
 * Five rare effects over the Canvas page (drawn by core/hidden-gems-ui.js
 * and src/gems/*.js): rain and snow when it is really raining or snowing
 * around Philadelphia and Malvern (weather.js asks Open-Meteo), Christmas
 * lights in the Christmas season, autumn leaves in autumn, and sunshine on
 * a clear day. One decision a day, made on the first Canvas page of the
 * day: real rain or snow always shows; otherwise most days nothing does.
 *
 * Pure JS: no DOM and no chrome.* access at load time, so Node unit tests
 * can load and exercise this module directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.hiddenGems) return;

  var KINDS = ['rain', 'snow', 'leaves', 'sunshine', 'lights'];

  // On a day without rain or snow, the chance that the day's one roll shows
  // the season's effect (lights or leaves), and sunshine on a clear day.
  var SEASON_CHANCE = 0.4;
  var SUNSHINE_CHANCE = 0.25;

  /* One WMO weather code (as Open-Meteo reports it) to what is falling. */
  function kindOf(c) {
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { id: 'snow', heavy: c === 75 || c === 86, thunder: false, light: c === 71 || c === 77 };
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) {
      return { id: 'rain', heavy: c === 65 || c === 67 || c === 82 || c >= 95, thunder: c >= 95, light: c >= 51 && c <= 57 };
    }
    return null;
  }

  /* The weather codes for the Philadelphia / Malvern area (one per place)
   * to { id: 'snow' | 'rain', heavy, thunder, light }, or null when nothing
   * is falling. Snow anywhere wins over rain anywhere; within a kind, the
   * heavier or stormier reading wins. */
  function weatherKind(codes) {
    var list = Array.isArray(codes) ? codes : [codes];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var c = Number(list[i]);
      if (!isFinite(c)) continue;
      var k = kindOf(c);
      if (!k) continue;
      if (!best || (k.id === 'snow' && best.id !== 'snow') ||
          (k.id === best.id && ((k.heavy && !best.heavy) || (k.thunder && !best.thunder)))) best = k;
    }
    return best;
  }

  /* Clear or mainly clear (WMO 0 or 1) somewhere in the area, by day. */
  function sunnyNow(weather) {
    if (!weather || !Array.isArray(weather.codes)) return false;
    for (var i = 0; i < weather.codes.length; i++) {
      var day = !Array.isArray(weather.isDay) || Number(weather.isDay[i]) === 1;
      if ((Number(weather.codes[i]) === 0 || Number(weather.codes[i]) === 1) && day) return true;
    }
    return false;
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

  /* Has today's one decision not been made yet? */
  function rollDue(state, now, opts) {
    var o = opts || {};
    if (o.enabled === false || o.reducedMotion) return false;
    return !state || state.rolledDay !== dayKey(now || new Date());
  }

  /* Today's effect: { id, opts } or null. Real rain or snow always shows;
   * otherwise the season's effect or sunshine, on some days only. */
  function chooseGem(now, weather, rng) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var r = typeof rng === 'function' ? rng() : Math.random();
    var falling = weather ? weatherKind(weather.codes) : null;
    if (falling) return { id: falling.id, opts: { heavy: falling.heavy, thunder: falling.thunder, light: falling.light } };
    if (isChristmasSeason(d)) return r < SEASON_CHANCE ? { id: 'lights', opts: {} } : null;
    var sunny = sunnyNow(weather);
    if (isAutumn(d)) {
      if (r < SEASON_CHANCE) return { id: 'leaves', opts: {} };
      return sunny && r < SEASON_CHANCE + SUNSHINE_CHANCE ? { id: 'sunshine', opts: {} } : null;
    }
    return sunny && r < SUNSHINE_CHANCE ? { id: 'sunshine', opts: {} } : null;
  }

  /* Has real rain or snow not shown yet today? Weather keeps its own day
   * apart from the roll, so rain that starts after the day's first page
   * still shows, and a failed weather lookup costs nothing. */
  function weatherDue(state, now) {
    return !state || state.weatherDay !== dayKey(now || new Date());
  }

  /* What to play now, given the saved state and the weather (null when it
   * could not be read): { pick: { id, opts } | null, state } to save, or
   * null when there is nothing to decide. Real rain or snow plays once a
   * day whenever it is falling; otherwise the day's one roll. */
  function decide(state, now, weather, rng) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var today = dayKey(d);
    var falling = weather ? weatherKind(weather.codes) : null;
    var weatherDay = (state && state.weatherDay) || null;
    if (falling && weatherDue(state, d)) {
      return { pick: { id: falling.id, opts: { heavy: falling.heavy, thunder: falling.thunder, light: falling.light } },
        state: { rolledDay: today, weatherDay: today } };
    }
    if (!rollDue(state, d)) return null;
    // Rain or snow that already showed today is not rolled for again.
    return { pick: falling ? null : chooseGem(d, weather, rng), state: { rolledDay: today, weatherDay: weatherDay } };
  }

  CGP.hiddenGems = {
    KINDS: KINDS,
    weatherDue: weatherDue,
    decide: decide,
    SEASON_CHANCE: SEASON_CHANCE,
    SUNSHINE_CHANCE: SUNSHINE_CHANCE,
    weatherKind: weatherKind,
    sunnyNow: sunnyNow,
    dayKey: dayKey,
    isChristmasSeason: isChristmasSeason,
    isAutumn: isAutumn,
    rollDue: rollDue,
    chooseGem: chooseGem
  };
})();
