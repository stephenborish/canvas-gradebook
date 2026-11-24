/* Canvas Gradebook+ - Hidden Gems: snow.
 *
 * Adapted from react-cinematic-snow by Khoa Ma
 * (https://github.com/khoama/react-cinematic-snow, MIT; see
 * src/assets/gems/LICENSES.txt): its three depth layers (a hazy far layer of
 * soft dots, a middle layer, and a near layer of large flakes drawn out of
 * focus, plus the rare "camera" flake passing right by the lens), its
 * particle model (size-correlated fall speed for parallax, primary and
 * secondary sway, per-flake wobble), its dynamic wind (slow, medium and
 * quick oscillations plus random gusts) and its WebGL point-sprite shaders
 * (soft discs far away, irregular polygon crystals up close), ported from
 * React/TypeScript to plain ES5.
 *
 * Performance techniques from snowfall-canvas by ux-ui-pro
 * (https://github.com/ux-ui-pro/snowfall-canvas, MIT): typed-array particle
 * storage, a capped pixel density, density scaled to the window's area, and
 * an adaptive step that sheds a quarter of the flakes when frames run slow.
 *
 * Only change to the look: on a white Canvas page white flakes would vanish,
 * so the page takes the light of a snowy day (a light, cool overcast, about
 * 12%), and the nearer layers carry a soft halo, as snow shows against a
 * bright sky.
 *
 * Loaded on demand by core/hidden-gems-ui.js; registers CGP.gemPlayers.snow. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  CGP.gemPlayers = CGP.gemPlayers || {};
  if (CGP.gemPlayers.snow) return;

  /* ---------------------------------- react-cinematic-snow: WebGLRenderer */

  var VERTEX_SHADER = [
    'attribute vec2 a_position;',
    'attribute float a_size;',
    'attribute float a_opacity;',
    'attribute float a_seed;',
    'attribute float a_rotation;',
    'uniform vec2 u_resolution;',
    'varying float v_opacity;',
    'varying float v_seed;',
    'varying float v_rotation;',
    'varying float v_size;',
    'void main() {',
    '  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;',
    '  clipSpace.y *= -1.0;',
    '  gl_Position = vec4(clipSpace, 0.0, 1.0);',
    '  gl_PointSize = a_size;',
    '  v_opacity = a_opacity;',
    '  v_seed = a_seed;',
    '  v_rotation = a_rotation;',
    '  v_size = a_size;',
    '}'
  ].join('\n');

  var FRAGMENT_SHADER = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    '  precision highp float;',
    '#else',
    '  precision mediump float;',
    '#endif',
    'uniform vec3 u_color;',
    'uniform float u_roughness;',
    'uniform float u_layer;',
    'uniform float u_pixel;',
    'varying float v_opacity;',
    'varying float v_seed;',
    'varying float v_rotation;',
    'varying float v_size;',
    'float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453123); }',
    'vec2 rotate2D(vec2 p, float angle) { float c = cos(angle); float s = sin(angle); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }',
    'vec2 getVertex(int i, int numPoints, float seed) {',
    '  float fi = float(i); float fn = float(numPoints);',
    '  float angle = (fi / fn) * 6.28318530718;',
    '  float randomVal = hash(seed + fi * 7.31);',
    '  float variance = 1.0 + (randomVal - 0.5) * u_roughness;',
    '  return vec2(cos(angle) * 0.38 * variance, sin(angle) * 0.38 * variance);',
    '}',
    'bool pointInPolygon(vec2 p, int numPoints, float seed) {',
    '  int crossings = 0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (i >= numPoints) break;',
    '    int nextI = i + 1; if (nextI >= numPoints) nextI = 0;',
    '    vec2 v1 = getVertex(i, numPoints, seed); vec2 v2 = getVertex(nextI, numPoints, seed);',
    '    if (((v1.y > p.y) != (v2.y > p.y)) && (p.x < (v2.x - v1.x) * (p.y - v1.y) / (v2.y - v1.y) + v1.x)) crossings++;',
    '  }',
    '  return mod(float(crossings), 2.0) > 0.5;',
    '}',
    'float distToPolygonEdge(vec2 p, int numPoints, float seed) {',
    '  float minDist = 1.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (i >= numPoints) break;',
    '    int nextI = i + 1; if (nextI >= numPoints) nextI = 0;',
    '    vec2 v1 = getVertex(i, numPoints, seed); vec2 v2 = getVertex(nextI, numPoints, seed);',
    '    vec2 edge = v2 - v1;',
    '    float t = clamp(dot(p - v1, edge) / dot(edge, edge), 0.0, 1.0);',
    '    minDist = min(minDist, length(p - (v1 + t * edge)));',
    '  }',
    '  return minDist;',
    '}',
    'void main() {',
    '  vec2 coord = gl_PointCoord - vec2(0.5);',
    '  float dist = length(coord);',
    '  if (u_layer < 0.5) {',
    '    float alpha = 1.0 - smoothstep(0.25, 0.5, dist);',
    '    if (alpha < 0.01) discard;',
    '    gl_FragColor = vec4(u_color * (alpha * v_opacity), alpha * v_opacity);',
    '    return;',
    '  }',
    '  if (v_size < 6.0 * u_pixel) {',
    '    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);',
    '    if (alpha < 0.01) discard;',
    '    gl_FragColor = vec4(u_color * (alpha * v_opacity), alpha * v_opacity);',
    '    return;',
    '  }',
    '  vec2 rotatedCoord = rotate2D(coord, v_rotation);',
    '  int numPoints = 5 + int(hash(v_seed * 3.7) * 4.0);',
    '  if (!pointInPolygon(rotatedCoord, numPoints, v_seed)) discard;',
    '  float edgeDist = distToPolygonEdge(rotatedCoord, numPoints, v_seed);',
    '  float alpha = smoothstep(0.0, 0.04, edgeDist);',
    '  gl_FragColor = vec4(u_color * (alpha * v_opacity), alpha * v_opacity);',
    '}'
  ].join('\n');

  function compileShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('snow shader: ' + gl.getShaderInfoLog(shader));
    return shader;
  }

  function initWebGL(canvas) {
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return null;
    var program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('snow program: ' + gl.getProgramInfoLog(program));
    return {
      gl: gl, program: program,
      buffers: { position: gl.createBuffer(), size: gl.createBuffer(), opacity: gl.createBuffer(), seed: gl.createBuffer(), rotation: gl.createBuffer() },
      loc: {
        position: gl.getAttribLocation(program, 'a_position'), size: gl.getAttribLocation(program, 'a_size'),
        opacity: gl.getAttribLocation(program, 'a_opacity'), seed: gl.getAttribLocation(program, 'a_seed'),
        rotation: gl.getAttribLocation(program, 'a_rotation'),
        resolution: gl.getUniformLocation(program, 'u_resolution'), color: gl.getUniformLocation(program, 'u_color'),
        roughness: gl.getUniformLocation(program, 'u_roughness'), layer: gl.getUniformLocation(program, 'u_layer'),
        pixel: gl.getUniformLocation(program, 'u_pixel')
      }
    };
  }

  function upload(gl, buffer, loc, data, n) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
  }

  /* renderWebGL(): one layer of flakes as point sprites. Sizes and opacity
   * boosts are the original's desktop values, scaled to device pixels. */
  function renderLayer(state, L, wPx, hPx, dpr, globalOpacity, layerOpacity, roughness, layer) {
    var gl = state.gl, loc = state.loc, n = L.count;
    gl.viewport(0, 0, wPx, hPx);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!n) return;
    gl.enable(gl.BLEND);
    // Premultiplied output and blending. (The original blended straight alpha
    // into an unpremultiplied canvas, which stores a white flake as grey.)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(state.program);
    gl.uniform2f(loc.resolution, wPx, hPx);
    gl.uniform3f(loc.color, 1, 1, 1);
    gl.uniform1f(loc.roughness, roughness);
    gl.uniform1f(loc.layer, layer);
    gl.uniform1f(loc.pixel, dpr);
    var pos = L.gpuPos, size = L.gpuSize, op = L.gpuOpacity, rot = L.gpuRot;
    for (var i = 0; i < n; i++) {
      var r = L.radius[i];
      pos[i * 2] = L.x[i] * dpr;
      pos[i * 2 + 1] = L.y[i] * dpr;
      var mult = r < 1.0 ? 5.5 : (r < 1.5 ? 4.5 : 3.5);
      size[i] = Math.max(5, r * mult) * dpr;
      var boost = r < 1.0 ? 2.2 : (r < 1.5 ? 1.8 : 1.4);
      op[i] = Math.min(1, L.opacity[i] * layerOpacity * globalOpacity * boost);
      rot[i] = Math.sin(L.wobble[i]);
    }
    upload(gl, state.buffers.position, loc.position, pos.subarray(0, n * 2), 2);
    upload(gl, state.buffers.size, loc.size, size.subarray(0, n), 1);
    upload(gl, state.buffers.opacity, loc.opacity, op.subarray(0, n), 1);
    upload(gl, state.buffers.seed, loc.seed, L.seed.subarray(0, n), 1);
    upload(gl, state.buffers.rotation, loc.rotation, rot.subarray(0, n), 1);
    gl.drawArrays(gl.POINTS, 0, n);
  }

  /* --------------------------------------- react-cinematic-snow: Snowfall */

  function random(min, max) { return Math.random() * (max - min) + min; }

  /* generateParticles(), in typed arrays (snowfall-canvas's layout). */
  function makeLayer(count, width, height, rMin, rMax, sMult, wMult) {
    var L = {
      count: count, capacity: count, wMult: wMult,
      x: new Float32Array(count), y: new Float32Array(count), radius: new Float32Array(count),
      opacity: new Float32Array(count), vx: new Float32Array(count), vy: new Float32Array(count),
      wobble: new Float32Array(count), wobbleSpeed: new Float32Array(count), sway: new Float32Array(count),
      seed: new Float32Array(count),
      gpuPos: new Float32Array(count * 2), gpuSize: new Float32Array(count), gpuOpacity: new Float32Array(count), gpuRot: new Float32Array(count)
    };
    for (var i = 0; i < count; i++) {
      var radius = random(rMin, rMax);
      var sizeFactor = (radius - rMin) / (rMax - rMin || 1);
      var opacity = Math.max(0.1, Math.min(1.0, 0.1 + (sizeFactor * 0.7) + (Math.random() * 0.6 - 0.3)));
      var sizeScale = Math.max(0.5, radius / 2.5);
      L.x[i] = Math.random() * width;
      L.y[i] = Math.random() * height;
      L.radius[i] = radius;
      L.opacity[i] = opacity;
      L.vx[i] = random(-0.1, 0.1) * sizeScale;
      L.vy[i] = (radius / 2.5) * sMult * random(0.85, 1.15);
      L.wobble[i] = Math.random() * Math.PI * 2;
      L.wobbleSpeed[i] = random(0.005, 0.03);
      L.sway[i] = random(0.3, 0.8) * sizeScale;
      L.seed[i] = Math.random() * 1000;
    }
    return L;
  }

  function appendLayer(a, b) {
    var out = makeLayer(a.count + b.count, 1, 1, 1, 1, 1, a.wMult);
    ['x', 'y', 'radius', 'opacity', 'vx', 'vy', 'wobble', 'wobbleSpeed', 'sway', 'seed'].forEach(function (k) {
      out[k].set(a[k].subarray(0, a.count), 0);
      out[k].set(b[k].subarray(0, b.count), a.count);
    });
    return out;
  }

  /* updateParticles(): sway, wind and fall per 60 Hz step, wrapping at the edges. */
  function updateLayer(L, width, height, speed, currentWind, steps) {
    for (var i = 0; i < L.count; i++) {
      L.wobble[i] += L.wobbleSpeed[i] * steps;
      var primarySway = Math.sin(L.wobble[i]) * L.sway[i];
      var secondarySway = Math.cos(L.wobble[i] * 1.8 + L.y[i] * 0.01) * (L.sway[i] * 0.2);
      L.x[i] += ((currentWind * L.wMult) + L.vx[i] + primarySway + secondarySway) * steps;
      L.y[i] += speed * L.vy[i] * steps;
      var r = L.radius[i];
      if (L.y[i] > height + r) { L.y[i] = -r; L.x[i] = Math.random() * width; }
      if (L.x[i] > width + r) L.x[i] = -r;
      else if (L.x[i] < -r) L.x[i] = width + r;
    }
  }

  /* getDynamicWind(): slow, medium and quick swells, plus random gusts. */
  function makeWind() {
    var s = { time: 0, gustTime: 0, gustStrength: 0, gustDirection: 1 };
    return function (baseWind, dt) {
      s.time += dt;
      var slowWave = Math.sin(s.time * 0.05) * 0.7;
      var mediumWave = Math.sin(s.time * 0.15) * 0.3;
      var quickWave = Math.sin(s.time * 0.8) * 0.1;
      s.gustTime -= dt;
      if (s.gustTime <= 0 && Math.random() < 0.0005 * (dt / 0.016)) {
        s.gustStrength = 0.5 + Math.random() * 1.5;
        s.gustDirection = Math.random() > 0.5 ? 1 : -1;
        s.gustTime = 2 + Math.random() * 3;
      }
      var gustFactor = s.gustTime > 0 ? Math.sin((s.gustTime / 3) * Math.PI) * s.gustStrength * s.gustDirection : 0;
      return baseWind * (1 + slowWave + mediumWave + quickWave + gustFactor);
    };
  }

  /* -------------------------------------------------------------- player */

  CGP.gemPlayers.snow = function (session, props) {
    var W = window.innerWidth, H = window.innerHeight;
    // snowfall-canvas: density relative to a 1920x1080 window, DPR capped.
    var areaFactor = Math.min(1.4, (W * H) / (1920 * 1080));
    var density = Math.round((props.heavy ? 2200 : 1500) * Math.max(0.5, areaFactor));
    var speed = props.heavy ? 1.35 : 1.15;
    var baseWind = (Math.random() < 0.5 ? -1 : 1) * (props.heavy ? 0.45 : 0.25);
    var minRadius = 0.2, maxRadius = 2.3, roughness = 0.9;
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);

    var layers = {
      back: makeLayer(Math.floor(density * 0.8), W, H, minRadius * 0.5, maxRadius * 0.6, 0.6, 0.5),
      mid: makeLayer(Math.floor(density * 0.5), W, H, minRadius, maxRadius, 1.0, 1.0),
      front: appendLayer(
        makeLayer(Math.max(5, Math.floor(density * 0.1)), W, H, Math.max(maxRadius, 2), maxRadius * 1.8, 1.4, 1.5),
        makeLayer(Math.max(2, Math.floor(density * 0.004)), W, H, maxRadius * 3.5, maxRadius * 5.5, 2.0, 1.5))
    };
    // A snowy day's light: a light, cool overcast over the page, a little
    // deeper at the corners, so white flakes show against it as they do
    // against a grey sky. It is the only shading, and it fades in and out.
    var overcast = document.createElement('div');
    overcast.className = 'cgp-gem-overcast';
    session.stage.appendChild(overcast);
    session.after(30, function () { overcast.classList.add('is-on'); });

    // The far layer is tiny dots: 1x is plenty. The near layer is drawn at a
    // third of the resolution and scaled up by the browser, which blurs it
    // the way the original's CSS blur(3px) did, without a full-screen filter
    // pass every frame.
    var canvases = {
      back: session.canvas({ dpr: 1, className: 'is-snow' }),
      mid: session.canvas({ dpr: dpr, className: 'is-snow' }),
      front: session.canvas({ dpr: 0.34, className: 'is-snow is-near' })
    };
    var gl = {};
    // Registered first, so contexts made before a failed one are released too.
    session.onDestroy(function () {
      ['back', 'mid', 'front'].forEach(function (k) {
        try { var e = gl[k] && gl[k].gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } catch (er) { /* ignore */ }
      });
    });
    ['back', 'mid', 'front'].forEach(function (k) {
      gl[k] = initWebGL(canvases[k].el);
      if (!gl[k]) throw new Error('no webgl');
    });

    var wind = makeWind();
    var frameAvg = 16, cooldown = 0;
    function px(k) { return [canvases[k].el.width, canvases[k].el.height, canvases[k].dpr]; }
    var size = { back: px('back'), mid: px('mid'), front: px('front') };

    session.loop(function (dt, t) {
      var steps = dt / (1 / 60);   // the original moves per 60 Hz frame
      var currentWind = wind(baseWind, dt);
      // Fade in over the first second; the far layer at 0.3, mid 0.6, near 0.8 (the original's layer opacities).
      var fade = Math.min(1, t / 1);
      updateLayer(layers.back, W, H, speed, currentWind, steps);
      renderLayer(gl.back, layers.back, size.back[0], size.back[1], size.back[2], fade, 0.3, roughness, 0);
      updateLayer(layers.mid, W, H, speed, currentWind, steps);
      renderLayer(gl.mid, layers.mid, size.mid[0], size.mid[1], size.mid[2], fade, 0.6, roughness, 1);
      updateLayer(layers.front, W, H, speed, currentWind, steps);
      renderLayer(gl.front, layers.front, size.front[0], size.front[1], size.front[2], fade, 0.8, roughness, 2);

      // snowfall-canvas maybeAdjustPerformance(): shed flakes when frames run slow.
      frameAvg = frameAvg * 0.9 + dt * 1000 * 0.1;
      if (cooldown > 0) cooldown--;
      else if (frameAvg > 22 && t > 1) {
        layers.back.count = Math.max(100, Math.floor(layers.back.count * 0.75));
        layers.mid.count = Math.max(60, Math.floor(layers.mid.count * 0.75));
        cooldown = 90;
      }
      return t < session.duration;
    });
  };
})();
