/* Canvas Gradebook+ - Hidden Gems (pure logic): snow and rain on real days.
 *
 * When it is really snowing or raining around Philadelphia and Malvern, it
 * snows or rains on the teacher's Canvas page too (core/hidden-gems-ui.js
 * draws it; weather.js in the service worker asks Open-Meteo what is
 * falling). This module only reads the weather codes and decides when the
 * weather may show again. Nothing is saved except when it last showed.
 *
 * Pure JS: no DOM and no chrome.* access at load time, so Node unit tests
 * can load and exercise this module directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.hiddenGems) return;

  var KINDS = ['snow', 'rain'];

  // While the weather lasts, it shows at most once every three hours.
  var WEATHER_EVERY_MS = 3 * 60 * 60 * 1000;

  /* One WMO weather code (as Open-Meteo reports it) to what is falling. */
  function kindOf(c) {
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { id: 'snow', heavy: c === 75 || c === 86, thunder: false };
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) {
      return { id: 'rain', heavy: c === 65 || c === 67 || c === 82 || c >= 95, thunder: c >= 95 };
    }
    return null;
  }

  /* The weather codes for the Philadelphia / Malvern area (one per place)
   * to { id: 'snow' | 'rain', heavy, thunder }, or null when nothing is
   * falling. Snow anywhere wins over rain anywhere; within a kind, the
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

  /* May the weather show now? Never while the teacher has turned it off or
   * asked for reduced motion, and at most once every three hours. */
  function weatherDue(state, now, opts) {
    var o = opts || {};
    if (o.enabled === false || o.reducedMotion) return false;
    var ts = typeof now === 'number' ? now : Date.now();
    var last = state && typeof state.weatherShownAt === 'number' ? state.weatherShownAt : 0;
    return !last || ts - last >= WEATHER_EVERY_MS;
  }

  CGP.hiddenGems = {
    KINDS: KINDS,
    WEATHER_EVERY_MS: WEATHER_EVERY_MS,
    weatherKind: weatherKind,
    weatherDue: weatherDue
  };
})();
