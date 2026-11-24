/* Canvas Gradebook+ - Hidden Gems: sunshine.
 *
 * Late sun through a window falls across one corner of the page: warm
 * light, the soft shadows of window blinds, and the shadows of a leafy
 * branch outside, stirring in the wind.
 *
 * The technique follows sunlit by Jacky Zhao (https://github.com/jackyzha0/sunlit,
 * and its write-up in that repository's README): the shadows are plain
 * layers seen in perspective; a feTurbulence + feDisplacementMap SVG filter,
 * with its noise frequency and displacement slowly animated, makes the
 * leaves billow; small rotations and scales add the sway of the branch; and
 * the shadow is blurred progressively, sharper where it is nearer the
 * window. sunlit has no licence, and its leaf picture is an Adobe Stock
 * photo, so neither its code nor its image is used: this is an independent
 * implementation, and the branch silhouette (src/assets/gems/foliage.webp)
 * is our own, composed from the outlines of ambientCG's CC0 leaf scans.
 *
 * The light darkens the page only where it is shaded (multiply), never adds
 * a film over it, and covers one corner, fading out toward the rest.
 *
 * Loaded on demand by core/hidden-gems-ui.js; registers CGP.gemPlayers.sunshine. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  CGP.gemPlayers = CGP.gemPlayers || {};
  if (CGP.gemPlayers.sunshine) return;

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  CGP.gemPlayers.sunshine = function (session) {
    return session.loadImages(['foliage.webp']).then(function () {
      if (session.isDone()) return;
      var id = 'cgp-gem-wind-' + Math.random().toString(36).slice(2, 8);
      var left = Math.random() < 0.5;

      // The light must darken the page itself (multiply), so it lives outside
      // the stage, whose own stacking context would only blend with itself.
      var root = el('div', 'cgp-gem-sun' + (left ? ' is-left' : ''));
      root.setAttribute('aria-hidden', 'true');
      document.body.appendChild(root);
      session.onDestroy(function () { if (root.parentNode) root.parentNode.removeChild(root); });

      // The wind: fractal noise displacing the leaves, its frequency and
      // strength drifting slowly so no two gusts are alike.
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'cgp-gem-sun-svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.innerHTML =
        '<filter id="' + id + '" x="-20%" y="-20%" width="140%" height="140%">' +
          '<feTurbulence type="fractalNoise" numOctaves="2" seed="' + Math.floor(Math.random() * 99) + '" baseFrequency="0.007 0.005">' +
            '<animate attributeName="baseFrequency" dur="17s" keyTimes="0;0.35;0.7;1" ' +
              'values="0.007 0.005;0.011 0.008;0.008 0.004;0.007 0.005" repeatCount="indefinite"/>' +
          '</feTurbulence>' +
          '<feDisplacementMap in="SourceGraphic" scale="40" xChannelSelector="R" yChannelSelector="G">' +
            '<animate attributeName="scale" dur="13s" keyTimes="0;0.3;0.6;1" values="34;52;44;34" repeatCount="indefinite"/>' +
          '</feDisplacementMap>' +
        '</filter>';
      root.appendChild(svg);

      el('div', 'cgp-gem-sun-warm', root);
      var scene = el('div', 'cgp-gem-sun-scene', root);
      // The blinds: slats and a frame bar, blurred as a shadow cast from a
      // little way off.
      var blinds = el('div', 'cgp-gem-sun-blinds', scene);
      el('div', 'cgp-gem-sun-bar', blinds);
      // The branch: twice, sharp near the window and soft farther from it.
      var url = 'url("' + session.assetUrl('foliage.webp') + '")';
      // Only the sharp, near shadows run the wind filter every frame; the
      // soft far ones (where it would hardly show under the blur) sway as
      // one cached layer.
      ['is-near', 'is-far'].forEach(function (k) {
        var wrap = el('div', 'cgp-gem-sun-branch ' + k, scene);
        var leaves = el('div', 'cgp-gem-sun-leaves', wrap);
        leaves.style.backgroundImage = url;
        if (k === 'is-near') leaves.style.filter = 'url(#' + id + ')';
      });

      session.after(30, function () { root.classList.add('is-on'); });
      session.onDestroy(function () { root.classList.remove('is-on'); });
      // The stage fade on leaving does not reach this layer; fade it too.
      var endFade = session.end;
      session.end = function (ms) {
        root.style.transition = 'opacity ' + Math.max(200, ms || 0) + 'ms ease';
        root.classList.remove('is-on');
        endFade(ms);
      };

      session.loop(function (dt, t) {
        // The sun moves a little while you watch.
        scene.style.setProperty('--cgp-sun-drift', (t * 0.9).toFixed(2) + 'px');
        if (t > session.duration - 2.5 && root.classList.contains('is-on')) {
          root.style.transition = 'opacity 2.5s ease';
          root.classList.remove('is-on');
        }
        return t < session.duration;
      });
    });
  };
})();
