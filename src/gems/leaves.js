/* Canvas Gradebook+ - Hidden Gems: autumn leaves.
 *
 * Adapted from falling-animation by phongdh
 * (https://github.com/phong-baruby/falling-package, MIT; see
 * src/assets/gems/LICENSES.txt): its particle model (src/Particle.ts: speed
 * in px/ms, wind, size and opacity ranges, spin) and its motion presets
 * (src/animations/index.ts: flutter, tumble, swing, float and spiral), with
 * its spawn-rate / max-particles loop and image drawing
 * (src/CanvasRenderer.ts drawParticle), ported to plain ES5.
 *
 * The leaves are photographs: real scanned autumn leaves (sugar and red
 * maple, red and white oak, beech, birch, elm) cut from ambientCG's LeafSet
 * atlases (CC0, https://ambientcg.com) into src/assets/gems/leaves.webp.
 *
 * Added for realism: each leaf turns over as it falls (its width follows the
 * cosine of a flip angle, as a flat leaf seen edge-on); each casts a soft
 * shadow on the page, offset by how near it is; and, as in Joanna Qiao's
 * Autumn Playground (https://github.com/YIYUE-Joanna/autumn-playground,
 * which has no licence, so only the idea is used, not its code), a quick
 * pass of the pointer pushes the leaves near it away.
 *
 * Loaded on demand by core/hidden-gems-ui.js; registers CGP.gemPlayers.leaves. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  CGP.gemPlayers = CGP.gemPlayers || {};
  if (CGP.gemPlayers.leaves) return;

  // [x, y, w, h] of each leaf in leaves.webp (112 px on the long side).
  var LEAVES = [[0, 0, 112, 68], [114, 0, 112, 73], [228, 0, 112, 75], [342, 0, 112, 67], [456, 0, 112, 68], [570, 0, 112, 66], [684, 0, 112, 57], [798, 0, 112, 56], [912, 0, 112, 60], [0, 77, 112, 59], [114, 77, 112, 64], [228, 77, 112, 60], [342, 77, 112, 69], [456, 77, 112, 56], [570, 77, 112, 59], [684, 77, 112, 60], [798, 77, 90, 112], [890, 77, 99, 112], [0, 191, 90, 112], [92, 191, 89, 112], [183, 191, 103, 112], [288, 191, 85, 112], [375, 191, 76, 112], [453, 191, 87, 112], [542, 191, 82, 112], [626, 191, 112, 62], [740, 191, 112, 59], [854, 191, 112, 61], [0, 305, 112, 58], [114, 305, 112, 55], [228, 305, 112, 52], [342, 305, 112, 54], [456, 305, 112, 52], [570, 305, 112, 61], [684, 305, 112, 59], [798, 305, 112, 55], [912, 305, 112, 49], [0, 368, 112, 54], [114, 368, 112, 56], [228, 368, 112, 70], [342, 368, 112, 59], [456, 368, 98, 112], [556, 368, 100, 112], [658, 368, 58, 112], [718, 368, 73, 112], [793, 368, 76, 112], [871, 368, 85, 112], [0, 482, 87, 112], [89, 482, 77, 112], [168, 482, 49, 112], [219, 482, 47, 112], [268, 482, 49, 112], [319, 482, 50, 112], [371, 482, 56, 112], [429, 482, 63, 112], [494, 482, 112, 46], [608, 482, 112, 43], [722, 482, 112, 51], [836, 482, 112, 50], [0, 596, 112, 40], [114, 596, 112, 42], [228, 596, 112, 49], [342, 596, 112, 50], [456, 596, 112, 59], [570, 596, 112, 58], [684, 596, 112, 51], [798, 596, 112, 51], [912, 596, 112, 57], [0, 657, 112, 58]];

  /* ------------------------------------- falling-animation: animations */

  var SPEED_MULTIPLIER = 0.04;   // speed 1 = 40 px/s

  var ANIMATIONS = {
    swing: function (p, dt, elapsed) {
      var amp = 30, freq = 0.002;
      p.rotation = Math.sin((elapsed + p.phase) * freq) * 20 + p.baseRotation;
      p.y += p.vy * dt;
      p.x += p.vx * dt + Math.sin((elapsed + p.phase) * freq) * amp * 0.05;
    },
    flutter: function (p, dt, elapsed) {
      var freq = 0.005;
      p.rotation = Math.sin((elapsed + p.phase) * freq) * 30 + p.baseRotation;
      var flutter = Math.sin((elapsed + p.phase) * freq) * 40;
      p.x += p.vx * dt + flutter * 0.03;
      var wobble = Math.sin((elapsed + p.phase) * freq * 2) * 0.3;
      p.y += (p.vy + wobble * SPEED_MULTIPLIER) * dt;
    },
    spiral: function (p, dt, elapsed) {
      var angle = (elapsed + p.phase) * 0.003;
      p.rotation = angle * (180 / Math.PI);
      p.y += p.vy * dt;
      p.x += p.vx * dt + Math.cos(angle) * 25 * 0.02;
    },
    tumble: function (p, dt, elapsed) {
      p.rotation += p.data.tumbleSpeed * dt * 0.05;
      p.y += p.vy * dt;
      p.x += p.vx * dt + Math.sin((elapsed + p.phase) * p.data.wobbleX) * 20 * 0.02;
      p.y += Math.sin((elapsed + p.phase * 1.5) * p.data.wobbleY) * 0.5;
    },
    float: function (p, dt, elapsed) {
      var freq = 0.001;
      p.rotation = Math.sin((elapsed + p.phase) * freq) * 10 + p.baseRotation;
      var yWobble = Math.sin((elapsed + p.phase) * freq * 2) * 5;
      p.y += (p.vy * 0.5 + yWobble * 0.01 * SPEED_MULTIPLIER) * dt;
      p.x += p.vx * dt + Math.sin((elapsed + p.phase) * freq) * 20 * 0.01;
    }
  };
  // Leaves mostly flutter and tumble; some swing, float or spiral.
  var ANIMATION_WEIGHTS = [['flutter', 4], ['tumble', 3], ['swing', 2], ['float', 2], ['spiral', 1]];

  function randomRange(min, max) { return Math.random() * (max - min) + min; }
  function pickAnimation() {
    var total = 0, i;
    for (i = 0; i < ANIMATION_WEIGHTS.length; i++) total += ANIMATION_WEIGHTS[i][1];
    var r = Math.random() * total;
    for (i = 0; i < ANIMATION_WEIGHTS.length; i++) { r -= ANIMATION_WEIGHTS[i][1]; if (r <= 0) return ANIMATION_WEIGHTS[i][0]; }
    return 'flutter';
  }

  /* --------------------------------------- falling-animation: Particle */

  function Particle(opts, W, H, anywhere) {
    this.leaf = LEAVES[Math.floor(Math.random() * LEAVES.length)];
    this.depth = Math.pow(Math.random(), 1.3);           // 0 far .. 1 near
    this.size = randomRange(opts.size.min, opts.size.max) * (0.7 + this.depth * 0.6);
    this.x = randomRange(-50, W + 50);
    this.y = anywhere ? randomRange(-60, H * 0.85) : -60;
    this.vy = randomRange(opts.speed.min, opts.speed.max) * SPEED_MULTIPLIER * (0.75 + this.depth * 0.5);
    this.vx = opts.wind * SPEED_MULTIPLIER * randomRange(0.5, 1.5);
    this.opacity = randomRange(opts.opacity.min, opts.opacity.max);
    this.baseRotation = randomRange(0, 360);
    this.rotation = this.baseRotation;
    this.phase = Math.random() * Math.PI * 2 * 1000;
    this.animation = pickAnimation();
    this.data = { tumbleSpeed: randomRange(3, 8), wobbleX: randomRange(0.01, 0.03) * 0.1, wobbleY: randomRange(0.005, 0.015) * 0.1 };
    this.flip = Math.random() * Math.PI * 2;
    this.flipSpeed = randomRange(0.6, 2.4) * (this.animation === 'tumble' ? 1.6 : 1) * (Math.random() < 0.5 ? -1 : 1);
    this.pushX = 0; this.pushY = 0;
  }

  /* -------------------------------------------------------------- player */

  CGP.gemPlayers.leaves = function (session) {
    return session.loadImages(['leaves.webp']).then(function (img) {
      if (session.isDone()) return;
      var atlas = img[0];
      var cv = session.canvas({ dpr: Math.min(2, window.devicePixelRatio || 1) });
      var ctx = cv.el.getContext('2d');
      ctx.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      var W = cv.w, H = cv.h;
      var windDir = Math.random() < 0.5 ? -1 : 1;
      var opts = {
        speed: { min: 1.3, max: 2.4 },
        wind: windDir * randomRange(0.3, 0.7),
        size: { min: 44, max: 78 },
        opacity: { min: 0.92, max: 1 },
        spawnRate: 2.2,
        maxParticles: Math.round(Math.min(34, Math.max(18, W * H / 38000)))
      };
      // Already falling when it starts: a first handful spread over the page.
      var particles = [];
      for (var i = 0; i < Math.round(opts.maxParticles * 0.5); i++) particles.push(new Particle(opts, W, H, true));
      var lastSpawn = 0;

      session.loop(function (dtS, t) {
        var dt = Math.min(50, dtS * 1000), elapsed = t * 1000;
        var spawning = t < session.duration - 6;
        if (spawning && elapsed - lastSpawn >= 1000 / opts.spawnRate && particles.length < opts.maxParticles) {
          particles.push(new Particle(opts, W, H, false));
          lastSpawn = elapsed;
        }
        var p0 = session.pointer;
        var live = p0.seen && performance.now() - p0.at < 90;
        var pv = live ? Math.hypot(p0.vx, p0.vy) : 0;

        ctx.clearRect(0, 0, W, H);
        for (var k = particles.length - 1; k >= 0; k--) {
          var p = particles[k];
          ANIMATIONS[p.animation](p, dt, elapsed);
          p.flip += p.flipSpeed * dtS;
          // A quick pass of the pointer blows nearby leaves away.
          if (pv > 300) {
            var dx = p.x - p0.x, dy = p.y - p0.y, d = Math.hypot(dx, dy);
            if (d < 130) {
              var f = (1 - d / 130) * Math.min(1, pv / 1500);
              p.pushX += (dx / (d + 1) * 0.8 + p0.vx / (pv + 1) * 0.6) * f * 1.4;
              p.pushY += (dy / (d + 1) * 0.6 - 0.25) * f * 1.4;
              p.flipSpeed += (Math.random() - 0.5) * 6 * f;
            }
          }
          p.x += p.pushX * dt * 0.3; p.y += p.pushY * dt * 0.3;
          p.pushX *= Math.pow(0.05, dtS); p.pushY *= Math.pow(0.05, dtS);
          if (p.y > H + 100 || p.x < -140 || p.x > W + 140) { particles.splice(k, 1); continue; }

          // CanvasRenderer.drawParticle, for an image, plus the flip and shadow.
          var L = p.leaf, s = p.size / 112;
          var w = L[2] * s, h = L[3] * s;
          var flip = Math.cos(p.flip);
          ctx.save();
          ctx.globalAlpha = p.opacity;
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.scale(Math.abs(flip) < 0.08 ? 0.08 * (flip < 0 ? -1 : 1) : flip, 1);
          ctx.shadowColor = 'rgba(30, 20, 10, ' + (0.18 + p.depth * 0.14).toFixed(3) + ')';
          ctx.shadowBlur = 4 + p.depth * 8;
          ctx.shadowOffsetX = (3 + p.depth * 9) * cv.dpr;
          ctx.shadowOffsetY = (5 + p.depth * 13) * cv.dpr;
          ctx.drawImage(atlas, L[0], L[1], L[2], L[3], -w / 2, -h / 2, w, h);
          ctx.restore();
        }
        return t < session.duration && (spawning || particles.length > 0);
      });
    });
  };
})();
