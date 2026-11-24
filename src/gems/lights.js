/* Canvas Gradebook+ - Hidden Gems: Christmas lights.
 *
 * Adapted from Scott Schiller's "Christmas Light Smashfest" (XLSF), part of
 * Snowstorm (https://github.com/scottschiller/Snowstorm, lights/; BSD
 * licence, see src/assets/gems/LICENSES.txt): its glossy bulb sprites
 * (lights/image/bulbs-96x96-top.png: four colours, each lit, unlit and
 * broken), its layout (a row of bulbs along the top, in groups of three of a
 * colour: nType = parseInt(j / 3) % 4), its lit/unlit sprite offsets
 * (setLight), and its two sequences: rotateLights, used here once to light
 * the string up from one end, then randomLights, toggling one bulb every
 * half second. Ported to plain ES5 with no YUI or SoundManager, and no
 * smashing: the lights only shine, and never take a click.
 *
 * Added for realism: the bulbs hang from a dark green wire draped in swags
 * along the top of the page, each bulb tilting a little where it hangs.
 *
 * Loaded on demand by core/hidden-gems-ui.js; registers CGP.gemPlayers.lights. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  CGP.gemPlayers = CGP.gemPlayers || {};
  if (CGP.gemPlayers.lights) return;

  var NS = 'http://www.w3.org/2000/svg';
  var SPRITE = 96;   // bulbs-96x96-top.png: 3 columns (lit, unlit, broken) x 4 rows (colours)

  CGP.gemPlayers.lights = function (session) {
    return session.loadImages(['lights-bulbs-96.png']).then(function () {
      if (session.isDone()) return;
      var W = window.innerWidth;
      // XLSF: lightClass 'small' (64) on wide screens, here 'tiny' (50) otherwise.
      var size = W > 1800 ? 64 : 50;
      var spacing = size * 0.92;
      var url = 'url("' + session.assetUrl('lights-bulbs-96.png') + '")';

      // The wire: swags between hooks along the top.
      var swags = Math.max(2, Math.round(W / 420));
      var hookY = -3, sag = Math.round(size * 0.55);
      function wireAt(x) {
        var seg = W / swags;
        var u = (x % seg) / seg;
        return { y: hookY + sag * 4 * u * (1 - u), slope: sag * 4 * (1 - 2 * u) / seg };
      }
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'cgp-gem-lights-wire');
      svg.setAttribute('width', String(W));
      svg.setAttribute('height', String(sag + 12));
      var d = '';
      for (var s = 0; s < swags; s++) {
        var x0 = s * W / swags, x1 = (s + 1) * W / swags;
        d += 'M' + x0.toFixed(1) + ' ' + hookY + ' Q' + ((x0 + x1) / 2).toFixed(1) + ' ' + (hookY + sag * 2) + ' ' + x1.toFixed(1) + ' ' + hookY + ' ';
      }
      svg.innerHTML = '<path d="' + d + '" fill="none" stroke="#15301c" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="' + d + '" fill="none" stroke="#3f6b48" stroke-width="0.8" stroke-linecap="round" transform="translate(0,-0.6)"/>';
      session.stage.appendChild(svg);

      // XLSF Light(): one sprite per bulb, lit or unlit by background offset.
      var lights = [];
      var count = Math.floor((W - 16) / spacing);
      if (count < 1) { session.end(0); return; }   // too narrow for a single bulb
      var offsetX = (W - (count - 1) * spacing) / 2;
      for (var j = 0; j < count; j++) {
        var x = offsetX + j * spacing;
        var at = wireAt(x);
        var o = document.createElement('div');
        o.className = 'cgp-gem-light';
        o.style.width = size + 'px';
        o.style.height = size + 'px';
        o.style.backgroundImage = url;
        o.style.backgroundSize = (size * 3) + 'px ' + (size * 4) + 'px';
        // Hangs from the wire, tilting a little with it.
        var tilt = Math.atan(at.slope) * 180 / Math.PI * 0.6 + (Math.random() - 0.5) * 10;
        o.style.transform = 'translate(' + (x - size / 2).toFixed(1) + 'px,' + (at.y - size * 0.08).toFixed(1) + 'px) rotate(' + tilt.toFixed(1) + 'deg)';
        session.stage.appendChild(o);
        lights.push({ o: o, nType: Math.floor(j / 3) % 4, state: null });
      }
      // setLight(): column 0 lit, column 1 unlit; row = colour.
      function setLight(L, on) {
        if (L.state === on) return;
        L.state = on;
        L.o.style.backgroundPosition = (-(on ? 0 : 1) * size) + 'px ' + (-L.nType * size) + 'px';
      }
      lights.forEach(function (L) { setLight(L, false); });

      // rotateLights, once: the string lights up from one end.
      var fromLeft = Math.random() < 0.5;
      var lit = 0;
      var sweepEvery = Math.max(25, 900 / count);
      var interval = 500;   // XLSF lightInterval
      var nextToggle = 0;
      session.loop(function (dt, t) {
        var ms = t * 1000;
        while (lit < lights.length && ms >= lit * sweepEvery) {
          setLight(lights[fromLeft ? lit : lights.length - 1 - lit], true);
          lit++;
        }
        // randomLights: toggle one bulb at a time, every half second.
        if (lit >= lights.length && ms >= nextToggle) {
          var L = lights[Math.floor(Math.random() * lights.length)];
          setLight(L, !L.state);
          // ...and bring back any that have been off a while, so the string stays mostly lit.
          var offs = lights.filter(function (x) { return !x.state; });
          if (offs.length > lights.length * 0.25) setLight(offs[Math.floor(Math.random() * offs.length)], true);
          nextToggle = ms + interval;
        }
        return t < session.duration;
      });
    });
  };
})();
