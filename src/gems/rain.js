/* Canvas Gradebook+ - Hidden Gems: rain on the glass.
 *
 * Adapted from two projects (see src/assets/gems/LICENSES.txt):
 *   - "Rain & Water Effect Experiments" by Lucas Bebber for Codrops
 *     (https://github.com/codrops/RainEffect, Codrops licence): the drop
 *     simulation (src/raindrops.js), its drop textures (drop-alpha.png,
 *     drop-color.png, drop-shine.png) and the water shader
 *     (src/shaders/water.frag), ported to plain ES5 below.
 *   - raindrop-fx by SardineFish (https://github.com/SardineFish/raindrop-fx,
 *     MIT): the lighting model of its compose shader (normal-mapped diffuse
 *     light, Blinn-Phong highlight, smoothstep drop mask), folded into the
 *     water shader.
 *
 * The one real change: the original paints a photo behind the glass and
 * bends that photo through the drops. Here the glass is over a live Canvas
 * page, so the shader is fully transparent outside the drops (the page
 * shows untouched), and inside a drop it bends a quick low-resolution sketch
 * of the page itself (its backgrounds, borders and runs of text), read once
 * when the rain starts. Each drop shows a small upside-down view of what is
 * behind it, as water on a window does.
 *
 * Loaded on demand by core/hidden-gems-ui.js; registers CGP.gemPlayers.rain. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  CGP.gemPlayers = CGP.gemPlayers || {};
  if (CGP.gemPlayers.rain) return;

  /* ------------------------------------------------ Codrops: raindrops.js */

  function random(from, to, interpolation) {
    if (from == null) { from = 0; to = 1; } else if (to == null) { to = from; from = 0; }
    var delta = to - from;
    var n = Math.random();
    return from + (interpolation ? interpolation(n) : n) * delta;
  }
  function chance(c) { return random() <= c; }
  function createCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  var DROP_SIZE = 64;
  var DEFAULTS = {
    minR: 10, maxR: 40, maxDrops: 900, rainChance: 0.3, rainLimit: 3, dropletsRate: 50,
    dropletsSize: [2, 4], dropletsCleaningRadiusMultiplier: 0.43, raining: true, globalTimeScale: 1,
    trailRate: 1, autoShrink: true, spawnArea: [-0.1, 0.95], trailScaleRange: [0.2, 0.5],
    collisionRadius: 0.65, collisionRadiusIncrease: 0.01, dropFallMultiplier: 1,
    collisionBoostMultiplier: 0.05, collisionBoost: 1
  };

  function Raindrops(width, height, scale, dropAlpha, dropColor, options) {
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.dropAlpha = dropAlpha;
    this.dropColor = dropColor;
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.dropletsPixelDensity = 1;
    this.dropletsCounter = 0;
    this.textureCleaningIterations = 0;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.droplets = createCanvas(width * this.dropletsPixelDensity, height * this.dropletsPixelDensity);
    this.dropletsCtx = this.droplets.getContext('2d');
    this.drops = [];
    this.dropsGfx = [];
    this.renderDropsGfx();
  }
  Raindrops.prototype = {
    deltaR: function () { return this.options.maxR - this.options.minR; },
    areaMultiplier: function () { return Math.sqrt(((this.width * this.height) / this.scale) / (1024 * 768)); },
    newDrop: function (o) {
      return Object.assign({ x: 0, y: 0, r: 0, spreadX: 0, spreadY: 0, momentum: 0, momentumX: 0, lastSpawn: 0,
        nextSpawn: 0, parent: null, isNew: true, killed: false, shrink: 0 }, o);
    },
    drawDroplet: function (x, y, r) {
      this.drawDrop(this.dropletsCtx, this.newDrop({ x: x * this.dropletsPixelDensity, y: y * this.dropletsPixelDensity, r: r * this.dropletsPixelDensity }));
    },
    // Pre-renders 255 drop sprites, each tinted with its "thickness" in the
    // blue channel, from the colour (normal) map masked by the alpha map.
    renderDropsGfx: function () {
      var buf = createCanvas(DROP_SIZE, DROP_SIZE);
      var bctx = buf.getContext('2d');
      for (var i = 0; i < 255; i++) {
        var drop = createCanvas(DROP_SIZE, DROP_SIZE);
        var dctx = drop.getContext('2d');
        bctx.clearRect(0, 0, DROP_SIZE, DROP_SIZE);
        bctx.globalCompositeOperation = 'source-over';
        bctx.drawImage(this.dropColor, 0, 0, DROP_SIZE, DROP_SIZE);
        bctx.globalCompositeOperation = 'screen';
        bctx.fillStyle = 'rgba(0,0,' + i + ',1)';
        bctx.fillRect(0, 0, DROP_SIZE, DROP_SIZE);
        dctx.globalCompositeOperation = 'source-over';
        dctx.drawImage(this.dropAlpha, 0, 0, DROP_SIZE, DROP_SIZE);
        dctx.globalCompositeOperation = 'source-in';
        dctx.drawImage(buf, 0, 0, DROP_SIZE, DROP_SIZE);
        this.dropsGfx.push(drop);
      }
      this.clearDropletsGfx = createCanvas(128, 128);
      var cctx = this.clearDropletsGfx.getContext('2d');
      cctx.fillStyle = '#000';
      cctx.beginPath(); cctx.arc(64, 64, 64, 0, Math.PI * 2); cctx.fill();
    },
    drawDrop: function (ctx, drop) {
      if (!this.dropsGfx.length) return;
      var x = drop.x, y = drop.y, r = drop.r, spreadX = drop.spreadX, spreadY = drop.spreadY;
      var scaleX = 1, scaleY = 1.5;
      var d = Math.max(0, Math.min(1, ((r - this.options.minR) / this.deltaR()) * 0.9));
      d *= 1 / (((drop.spreadX + drop.spreadY) * 0.5) + 1);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      d = Math.floor(d * (this.dropsGfx.length - 1));
      ctx.drawImage(this.dropsGfx[d],
        (x - (r * scaleX * (spreadX + 1))) * this.scale,
        (y - (r * scaleY * (spreadY + 1))) * this.scale,
        (r * 2 * scaleX * (spreadX + 1)) * this.scale,
        (r * 2 * scaleY * (spreadY + 1)) * this.scale);
    },
    clearDroplets: function (x, y, r) {
      var ctx = this.dropletsCtx;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.clearDropletsGfx,
        (x - r) * this.dropletsPixelDensity * this.scale,
        (y - r) * this.dropletsPixelDensity * this.scale,
        (r * 2) * this.dropletsPixelDensity * this.scale,
        (r * 2) * this.dropletsPixelDensity * this.scale * 1.5);
    },
    updateRain: function (timeScale) {
      var rainDrops = [];
      if (this.options.raining) {
        var limit = this.options.rainLimit * timeScale * this.areaMultiplier();
        var count = 0;
        while (chance(this.options.rainChance * timeScale * this.areaMultiplier()) && count < limit) {
          count++;
          var r = random(this.options.minR, this.options.maxR, function (n) { return Math.pow(n, 3); });
          rainDrops.push(this.newDrop({
            x: random(this.width / this.scale),
            y: random((this.height / this.scale) * this.options.spawnArea[0], (this.height / this.scale) * this.options.spawnArea[1]),
            r: r,
            momentum: 1 + ((r - this.options.minR) * 0.1) + random(2),
            spreadX: 1.5,
            spreadY: 1.5
          }));
        }
      }
      return rainDrops;
    },
    updateDroplets: function (timeScale) {
      if (this.textureCleaningIterations > 0) {
        this.textureCleaningIterations -= timeScale;
        this.dropletsCtx.globalCompositeOperation = 'destination-out';
        this.dropletsCtx.fillStyle = 'rgba(0,0,0,' + (0.05 * timeScale) + ')';
        this.dropletsCtx.fillRect(0, 0, this.width * this.dropletsPixelDensity, this.height * this.dropletsPixelDensity);
      }
      if (this.options.raining) {
        this.dropletsCounter += this.options.dropletsRate * timeScale * this.areaMultiplier();
        while (this.dropletsCounter >= 1) {
          this.dropletsCounter--;
          this.drawDroplet(
            random(this.width / this.scale),
            random(this.height / this.scale),
            random(this.options.dropletsSize[0], this.options.dropletsSize[1], function (n) { return n * n; }));
        }
      }
      this.ctx.drawImage(this.droplets, 0, 0, this.width, this.height);
    },
    updateDrops: function (timeScale) {
      var newDrops = [];
      this.updateDroplets(timeScale);
      newDrops = newDrops.concat(this.updateRain(timeScale));
      var self = this, o = this.options;
      var rowW = this.width / this.scale;
      this.drops.sort(function (a, b) {
        var va = (a.y * rowW) + a.x, vb = (b.y * rowW) + b.x;
        return va > vb ? 1 : (va === vb ? 0 : -1);
      });
      this.drops.forEach(function (drop, i) {
        if (drop.killed) return;
        // Chance of a drop "creeping down".
        if (chance((drop.r - (o.minR * o.dropFallMultiplier)) * (0.1 / self.deltaR()) * timeScale)) {
          drop.momentum += random((drop.r / o.maxR) * 4);
        }
        if (o.autoShrink && drop.r <= o.minR && chance(0.05 * timeScale)) drop.shrink += 0.01;
        drop.r -= drop.shrink * timeScale;
        if (drop.r <= 0) drop.killed = true;
        // Trails.
        if (o.raining) {
          drop.lastSpawn += drop.momentum * timeScale * o.trailRate;
          if (drop.lastSpawn > drop.nextSpawn) {
            var trailDrop = self.newDrop({
              x: drop.x + (random(-drop.r, drop.r) * 0.1),
              y: drop.y - (drop.r * 0.01),
              r: drop.r * random(o.trailScaleRange[0], o.trailScaleRange[1]),
              spreadY: drop.momentum * 0.1,
              parent: drop
            });
            newDrops.push(trailDrop);
            drop.r *= Math.pow(0.97, timeScale);
            drop.lastSpawn = 0;
            drop.nextSpawn = random(o.minR, o.maxR) - (drop.momentum * 2 * o.trailRate) + (o.maxR - drop.r);
          }
        }
        drop.spreadX *= Math.pow(0.4, timeScale);
        drop.spreadY *= Math.pow(0.7, timeScale);
        var moved = drop.momentum > 0;
        if (moved && !drop.killed) {
          drop.y += drop.momentum * o.globalTimeScale;
          drop.x += drop.momentumX * o.globalTimeScale;
          if (drop.y > (self.height / self.scale) + drop.r) drop.killed = true;
        }
        // Collisions: a running drop swallows the drops in its path.
        var check = (moved || drop.isNew) && !drop.killed;
        drop.isNew = false;
        if (check) {
          self.drops.slice(i + 1, i + 70).forEach(function (drop2) {
            if (drop !== drop2 && drop.r > drop2.r && drop.parent !== drop2 && drop2.parent !== drop && !drop2.killed) {
              var dx = drop2.x - drop.x, dy = drop2.y - drop.y;
              var dd = Math.sqrt((dx * dx) + (dy * dy));
              if (dd < (drop.r + drop2.r) * (o.collisionRadius + (drop.momentum * o.collisionRadiusIncrease * timeScale))) {
                var a1 = Math.PI * (drop.r * drop.r), a2 = Math.PI * (drop2.r * drop2.r);
                var targetR = Math.min(Math.sqrt((a1 + (a2 * 0.8)) / Math.PI), o.maxR * 1.6);
                drop.r = targetR;
                drop.momentumX += dx * 0.1;
                drop.spreadX = 0;
                drop.spreadY = 0;
                drop2.killed = true;
                drop.momentum = Math.max(drop2.momentum, Math.min(40, drop.momentum + (targetR * o.collisionBoostMultiplier) + o.collisionBoost));
              }
            }
          });
        }
        drop.momentum -= Math.max(1, (o.minR * 0.5) - drop.momentum) * 0.1 * timeScale;
        if (drop.momentum < 0) drop.momentum = 0;
        drop.momentumX *= Math.pow(0.7, timeScale);
        if (!drop.killed) {
          newDrops.push(drop);
          if (moved && o.dropletsRate > 0) self.clearDroplets(drop.x, drop.y, drop.r * o.dropletsCleaningRadiusMultiplier);
          self.drawDrop(self.ctx, drop);
        }
      });
      this.drops = newDrops;
    },
    // One step; the original ran this from its own requestAnimationFrame.
    step: function (dt) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      var timeScale = Math.min(1.1, dt / (1 / 60)) * this.options.globalTimeScale;
      this.updateDrops(timeScale);
    },
    // Fills the glass at once, as if it had been raining a while.
    prewarm: function (steps) {
      for (var i = 0; i < steps; i++) {
        this.updateDroplets(1);
        var nd = this.updateRain(1);
        for (var k = 0; k < nd.length; k++) { nd[k].spreadX = 0; nd[k].spreadY = 0; this.drops.push(nd[k]); }
      }
    }
  };

  /* -------------------- Codrops water.frag + raindrop-fx compose lighting */

  var VERT = 'precision mediump float;\nattribute vec2 a_position;\nvoid main(){ gl_Position = vec4(a_position, 0.0, 1.0); }';
  var FRAG = [
    'precision mediump float;',
    'uniform sampler2D u_waterMap;',
    'uniform sampler2D u_textureShine;',
    'uniform sampler2D u_textureFg;',     // the page, sketched: what the drops bend
    'uniform vec2 u_resolution;',
    'uniform float u_minRefraction;',
    'uniform float u_refractionDelta;',
    'uniform float u_brightness;',
    'uniform float u_alphaMultiply;',
    'uniform float u_alphaSubtract;',
    'uniform vec4 u_lightPos;',           // raindrop-fx: (x, y, z, w)
    'uniform vec4 u_diffuse;',            // raindrop-fx: (color.rgb, shadowOffset)
    'uniform vec4 u_specular;',           // raindrop-fx: (color.rgb, exponent)
    'uniform float u_flash;',
    'vec4 blend(vec4 bg, vec4 fg){',
    '  vec3 bgm = bg.rgb * bg.a; vec3 fgm = fg.rgb * fg.a; float ia = 1.0 - fg.a;',
    '  float a = fg.a + bg.a * ia; vec3 rgb = a != 0.0 ? (fgm + bgm * ia) / a : vec3(0.0);',
    '  return vec4(rgb, a);',
    '}',
    'vec2 pixel(){ return vec2(1.0, 1.0) / u_resolution; }',
    'vec2 texCoord(){ return vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_resolution; }',
    'vec4 water(float x, float y){ return texture2D(u_waterMap, texCoord() + pixel() * vec2(x, y)); }',
    'void main(){',
    '  vec4 cur = water(0.0, 0.0);',
    '  float d = cur.b;',                       // thickness
    '  float x = cur.g;',
    '  float y = cur.r;',
    '  float a = clamp(cur.a * u_alphaMultiply - u_alphaSubtract, 0.0, 1.0);',
    '  vec2 refraction = (vec2(x, y) - 0.5) * 2.0;',
    '  vec2 refractionPos = texCoord() + pixel() * refraction * (u_minRefraction + d * u_refractionDelta);',
    '  vec4 tex = texture2D(u_textureFg, refractionPos);',
    // raindrop-fx compose.glsl: light the drop as a little lens.
    '  vec3 normal = normalize(vec3(refraction * vec2(1.0, -1.0), 1.0));',
    '  vec2 uv = texCoord();',
    '  vec3 lightDir = u_lightPos.xyz - u_lightPos.w * vec3(uv, 0.0);',
    '  vec3 halfDir = normalize(normalize(lightDir) + vec3(0.0, 0.0, 1.0));',
    '  float lambert = clamp(dot(normalize(lightDir), normal), 0.0, 1.0);',
    '  float blinn = pow(max(dot(normal, halfDir), 0.0), u_specular.a);',
    '  tex.rgb += (lambert - u_diffuse.a) * u_diffuse.rgb;',
    // A drop is darkest at its rim, where it bends light from far away.
    '  float rim = smoothstep(0.45, 1.0, length(refraction));',
    '  tex.rgb *= 1.0 - 0.5 * rim;',
    '  tex.rgb *= vec3(0.96, 0.97, 0.99);',
    '  tex.rgb += blinn * u_specular.rgb;',
    // Codrops: the bright window reflection on each drop.
    '  float maxShine = 490.0; float minShine = maxShine * 0.18;',
    '  vec2 shinePos = vec2(0.5, 0.5) + ((1.0 / 512.0) * refraction) * -(minShine + ((maxShine - minShine) * d));',
    '  tex = blend(tex, texture2D(u_textureShine, shinePos));',
    '  tex.rgb += u_flash * 0.5;',
    '  vec4 fg = vec4(tex.rgb * u_brightness, a);',
    // Codrops renderShadow: the soft shadow each drop throws below itself.
    '  float borderAlpha = water(0.0, -(d * 6.0)).a;',
    '  borderAlpha = clamp(borderAlpha * u_alphaMultiply - (u_alphaSubtract + 0.5), 0.0, 1.0) * 0.3;',
    '  gl_FragColor = blend(vec4(0.0, 0.0, 0.0, borderAlpha), fg);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('rain shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  function RainRenderer(canvas, waterMap, pageSketch, shine, opts) {
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    this.canvas = canvas;
    this.waterMap = waterMap;
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('rain program: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = function (type, name) {
      var args = Array.prototype.slice.call(arguments, 2);
      var l = gl.getUniformLocation(prog, 'u_' + name);
      gl['uniform' + type].apply(gl, [l].concat(args));
    };
    this.u('2f', 'resolution', canvas.width, canvas.height);
    this.u('1f', 'minRefraction', opts.minRefraction);
    this.u('1f', 'refractionDelta', opts.maxRefraction - opts.minRefraction);
    this.u('1f', 'brightness', opts.brightness);
    this.u('1f', 'alphaMultiply', opts.alphaMultiply);
    this.u('1f', 'alphaSubtract', opts.alphaSubtract);
    this.u('4f', 'lightPos', -1, 1, 2, 0);
    this.u('4f', 'diffuse', 0.28, 0.28, 0.3, 0.7);
    this.u('4f', 'specular', 0.85, 0.85, 0.9, 40);
    this.u('1f', 'flash', 0);
    this.textures = [];
    this.texture(0, 'waterMap', waterMap);
    this.texture(1, 'textureShine', shine);
    this.texture(2, 'textureFg', pageSketch);
  }
  RainRenderer.prototype = {
    texture: function (unit, name, source) {
      var gl = this.gl;
      var tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.u('1i', name, unit);
      this.textures[unit] = tex;
    },
    update: function (unit, source) {
      var gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    draw: function (flash) {
      var gl = this.gl;
      this.update(0, this.waterMap);
      this.u('1f', 'flash', flash || 0);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose: function () {
      try { var ext = this.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* ignore */ }
    }
  };

  /* ------------------------------- the page behind the glass, sketched */

  function opaque(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return false;
    var p = m[1].split(',');
    return p.length < 4 || parseFloat(p[3]) > 0.3;
  }

  /* A coarse picture of the page on screen: background boxes, borders and
   * runs of text as blocks of their colour. Drops shrink and invert what is
   * behind them, so at that size this reads as the page itself. */
  function sketchPage(stage, w, h, scale) {
    var c = createCanvas(w * scale, h * scale);
    var g = c.getContext('2d');
    g.scale(scale, scale);
    var bodyBg = getComputedStyle(document.body).backgroundColor;
    g.fillStyle = opaque(bodyBg) ? bodyBg : '#fff';
    g.fillRect(0, 0, w, h);
    var visited = 0;
    // Read the page in at most ~25 ms (a big gradebook has thousands of
    // cells): whatever is not reached stays the page's background colour.
    var until = performance.now() + 25;
    var range = document.createRange();
    (function walk(el) {
      for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
        if (++visited > 4000 || (visited % 64 === 0 && performance.now() > until)) { visited = Infinity; return; }
        if (ch.nodeType === 3) {
          if (!/\S/.test(ch.nodeValue)) continue;
          range.selectNodeContents(ch);
          var rects = range.getClientRects();
          var col = getComputedStyle(el).color;
          g.fillStyle = col;
          g.globalAlpha = 0.55;
          for (var k = 0; k < rects.length && k < 40; k++) {
            var rr = rects[k];
            if (rr.bottom < 0 || rr.top > h || rr.right < 0 || rr.left > w) continue;
            g.fillRect(rr.left, rr.top + rr.height * 0.28, rr.width, rr.height * 0.44);
          }
          g.globalAlpha = 1;
          continue;
        }
        if (ch.nodeType !== 1 || ch === stage) continue;
        var tag = ch.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
        var cs = getComputedStyle(ch);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        var r = ch.getBoundingClientRect();
        if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) { if (r.width || r.height) continue; }
        if (opaque(cs.backgroundColor)) { g.fillStyle = cs.backgroundColor; g.fillRect(r.left, r.top, r.width, r.height); }
        if (tag === 'IMG' || tag === 'svg' || tag === 'VIDEO' || tag === 'CANVAS') {
          g.fillStyle = 'rgba(120,128,138,0.6)'; g.fillRect(r.left, r.top, r.width, r.height);
          continue;
        }
        if (parseFloat(cs.borderBottomWidth) > 0 && opaque(cs.borderBottomColor)) {
          g.fillStyle = cs.borderBottomColor; g.fillRect(r.left, r.bottom - 1, r.width, 1);
        }
        if (parseFloat(cs.borderTopWidth) > 0 && opaque(cs.borderTopColor)) {
          g.fillStyle = cs.borderTopColor; g.fillRect(r.left, r.top, r.width, 1);
        }
        // A grid or table cell is drawn as its box and one run of its text;
        // its insides are not walked.
        if (tag === 'TD' || tag === 'TH' || ch.getAttribute('role') === 'gridcell') {
          if (/\S/.test(ch.textContent || '')) {
            g.fillStyle = cs.color; g.globalAlpha = 0.55;
            var lh = Math.min(r.height, parseFloat(cs.fontSize) || 14);
            g.fillRect(r.left + 4, r.top + (r.height - lh) / 2 + lh * 0.28, Math.max(0, Math.min(r.width - 8, (ch.textContent.trim().length) * lh * 0.5)), lh * 0.44);
            g.globalAlpha = 1;
          }
          continue;
        }
        walk(ch);
      }
    })(document.body);
    return c;
  }

  /* -------------------------------------------------------------- player */

  // The Codrops demo's weather presets, tuned for a page instead of a photo.
  var PRESETS = {
    drizzle: { minR: 10, maxR: 40, rainChance: 0.15, rainLimit: 2, dropletsRate: 10, dropletsSize: [3.5, 6], trailRate: 1, trailScaleRange: [0.25, 0.35], collisionRadiusIncrease: 0.0002 },
    rain: { minR: 20, maxR: 50, rainChance: 0.35, rainLimit: 6, dropletsRate: 50, dropletsSize: [3, 5.5], trailRate: 1, trailScaleRange: [0.25, 0.35], collisionRadiusIncrease: 0.0002 },
    storm: { minR: 20, maxR: 55, rainChance: 0.4, rainLimit: 6, dropletsRate: 80, dropletsSize: [3, 5.5], trailRate: 2.5, trailScaleRange: [0.25, 0.4], collisionRadiusIncrease: 0.0002 }
  };

  CGP.gemPlayers.rain = function (session, props) {
    var kind = props.thunder ? 'storm' : (props.heavy ? 'rain' : (props.light ? 'drizzle' : 'rain'));
    var preset = PRESETS[kind];
    return session.loadImages(['rain-drop-alpha.png', 'rain-drop-color.png', 'rain-drop-shine.png']).then(function (img) {
      if (session.isDone()) return;
      var W = window.innerWidth, H = window.innerHeight;
      var dpr = Math.min(1.25, window.devicePixelRatio || 1);
      // The water map is simulated at half CSS-pixel scale: drops are tens of
      // pixels across and smooth, so the GPU's linear filtering loses nothing,
      // and drawing and uploading it costs a quarter. The glass is drawn at up
      // to 1.25x.
      var mapScale = Math.min(0.5, 720 / W);
      var raindrops = new Raindrops(W * mapScale, H * mapScale, mapScale, img[0], img[1], Object.assign({
        trailRate: 1, trailScaleRange: [0.2, 0.45], collisionRadius: 0.45, dropletsCleaningRadiusMultiplier: 0.28
      }, preset));
      raindrops.prewarm(kind === 'drizzle' ? 120 : 70);
      var glass = session.canvas({ dpr: dpr });
      // Until the page has been read, the glass bends a plain sheet of the
      // page's own background colour.
      var plain = createCanvas(16, 16);
      var pg = plain.getContext('2d');
      var bodyBg = getComputedStyle(document.body).backgroundColor;
      pg.fillStyle = opaque(bodyBg) ? bodyBg : '#fff';
      pg.fillRect(0, 0, 16, 16);
      var renderer = new RainRenderer(glass.el, raindrops.canvas, plain, img[2], {
        minRefraction: 22 * dpr, maxRefraction: 64 * dpr, brightness: 1.0, alphaMultiply: 6, alphaSubtract: 3
      });
      session.onDestroy(function () { renderer.dispose(); });
      session.after(60, function () {
        try { renderer.update(2, sketchPage(session.stage, W, H, 0.5)); } catch (e) { /* keep the plain sheet */ }
      });

      // Storms: a lightning flash now and then (the Codrops demo's flash,
      // here a brief brightening of the drops and a faint flicker of light).
      var flashAt = props.thunder ? [2.5 + Math.random() * 3, 11 + Math.random() * 6] : [];
      var flashEl = null;
      if (flashAt.length) {
        flashEl = document.createElement('div');
        flashEl.className = 'cgp-gem-flash';
        session.stage.appendChild(flashEl);
      }
      function flashLevel(t) {
        for (var i = 0; i < flashAt.length; i++) {
          var ft = t - flashAt[i];
          if (ft < 0 || ft > 1) continue;
          if (ft < 0.05) return 1;
          if (ft < 0.11) return 0.15;
          if (ft < 0.18) return 0.75;
          return Math.max(0, 0.75 - (ft - 0.18) * 1.2);
        }
        return 0;
      }

      session.loop(function (dt, t) {
        raindrops.options.raining = t < session.duration - 3;
        raindrops.step(dt);
        var f = flashLevel(t);
        renderer.draw(f);
        if (flashEl) flashEl.style.opacity = (f * 0.18).toFixed(3);
        return t < session.duration;
      });
    });
  };
})();
