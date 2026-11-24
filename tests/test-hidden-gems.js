/* Hidden Gems: the daily decision, the weather, and the wiring of the three effects. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: { ok, not, eq } } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const GEMS = ['snow', 'leaves', 'lights'];

suite('Hidden Gems: what plays today', (test) => {
  const hg = globalThis.CGP.hiddenGems;
  const now = new Date(2026, 10, 24, 11, 0);
  const today = hg.dayKey(now);

  test('exactly the three effects: no rain, no sunshine', () => {
    eq(hg.KINDS.join(','), GEMS.join(','));
    for (const gone of ['rain', 'sunshine']) {
      not(fs.existsSync(path.join(ROOT, 'src/gems', gone + '.js')), gone + '.js is removed');
    }
  });

  test('WMO snow codes are snow; rain, drizzle, storms, fog and clear skies are not', () => {
    eq(hg.snowKind([0, 3]), null, 'clear and overcast');
    eq(hg.snowKind([45, 48]), null, 'fog');
    eq(hg.snowKind([51, 61, 65, 80, 95]), null, 'drizzle, rain, showers and thunderstorms show nothing');
    eq(hg.snowKind([71, 0]).id, 'snow');
    ok(hg.snowKind([0, 75]).heavy, 'heavy snow in either place');
    ok(hg.snowKind([61, 86]).heavy, 'heavy snow showers');
    not(hg.snowKind([73]).heavy);
    eq(hg.snowKind(['junk']), null);
  });

  test('real snow always plays, whatever the date or the roll', () => {
    const d = hg.decide({}, new Date(2026, 11, 10, 10), { codes: [73, 73] }, () => 0.99);
    eq(d.pick.id, 'snow', 'snow beats Christmas lights');
    ok(hg.decide({}, new Date(2027, 1, 3, 10), { codes: [75, 0] }, () => 0.99).pick.opts.heavy);
  });

  test('a rainy day is an ordinary day', () => {
    const d = hg.decide({}, now, { codes: [63, 95] }, () => 0.1);
    eq(d.pick.id, 'leaves', 'the season, as on a dry day');
    eq(d.state.weatherDay, null);
    eq(hg.decide({}, now, { codes: [63, 95] }, () => 0.9).pick, null);
  });

  test('Christmas lights from 1 December to 6 January, on some days', () => {
    eq(hg.chooseGem(new Date(2026, 11, 1, 9), () => 0.1).id, 'lights');
    eq(hg.chooseGem(new Date(2027, 0, 6, 9), () => 0.1).id, 'lights');
    eq(hg.chooseGem(new Date(2026, 11, 15, 9), () => 0.9), null, 'most days nothing');
    not(hg.isChristmasSeason(new Date(2027, 0, 7)));
    not(hg.isChristmasSeason(new Date(2026, 10, 30)));
  });

  test('autumn leaves from 22 September to 30 November, on some days', () => {
    eq(hg.chooseGem(new Date(2026, 9, 14, 11), () => 0.1).id, 'leaves');
    eq(hg.chooseGem(new Date(2026, 8, 22, 11), () => 0.1).id, 'leaves');
    eq(hg.chooseGem(new Date(2026, 9, 14, 11), () => 0.5), null);
    not(hg.isAutumn(new Date(2026, 8, 21)));
  });

  test('nothing out of season', () => {
    eq(hg.chooseGem(new Date(2026, 4, 12, 13), () => 0.01), null, 'May');
    eq(hg.chooseGem(new Date(2026, 6, 4, 13), () => 0.01), null, 'July');
  });

  test('one decision a day', () => {
    ok(hg.rollDue({}, now));
    not(hg.rollDue({ rolledDay: today }, now), 'already decided today');
    ok(hg.rollDue({ rolledDay: '2026-11-23' }, now), 'a new day');
    not(hg.rollDue({}, now, { enabled: false }));
    not(hg.rollDue({}, now, { reducedMotion: true }));
    eq(hg.dayKey(new Date(2026, 0, 5)), '2026-01-05');
  });
});

suite('Hidden Gems: snow keeps its own day', (test) => {
  const hg = globalThis.CGP.hiddenGems;
  const now = new Date(2026, 10, 24, 11, 0);
  const today = hg.dayKey(now);
  const snowing = { codes: [73, 3] };

  test('snow that starts after the day was rolled still shows, once', () => {
    const rolledDry = { rolledDay: today, weatherDay: null };
    const d = hg.decide(rolledDry, now, snowing, () => 0.99);
    eq(d.pick.id, 'snow');
    eq(d.state.weatherDay, today);
    eq(hg.decide(d.state, now, snowing, () => 0.99), null, 'not twice the same day');
    ok(hg.decide({ rolledDay: today, weatherDay: '2026-11-23' }, now, snowing).pick.id === 'snow', 'snowing again the next day');
  });

  test('a failed weather lookup leaves snow free to show later', () => {
    const d = hg.decide({}, now, null, () => 0.1);
    eq(d.pick.id, 'leaves', 'the roll still happens, from the date alone');
    eq(d.state.rolledDay, today);
    eq(d.state.weatherDay, null, 'snow has not had its day');
    eq(hg.decide(d.state, now, snowing).pick.id, 'snow');
    eq(hg.decide(d.state, now, null), null, 'nothing more to decide without weather');
  });

  test('no request is needed once both have had their day', () => {
    not(hg.rollDue({ rolledDay: today, weatherDay: today }, now));
    not(hg.weatherDue({ rolledDay: today, weatherDay: today }, now));
    ok(hg.weatherDue({ rolledDay: today }, now));
  });
});

suite('Hidden Gems: the weather around Philadelphia', (test) => {
  const { pathToFileURL } = require('url');
  const WEATHER = pathToFileURL(path.join(ROOT, 'src', 'weather.js')).href;
  function fakeChrome() {
    const bag = {};
    return { bag, storage: { local: { get: async (k) => ({ [k]: bag[k] }), set: async (o) => Object.assign(bag, o) } } };
  }

  test('asks Open-Meteo for Malvern and Philadelphia in one request, and keeps it 20 minutes', async () => {
    const { createWeather } = await import(WEATHER);
    const calls = [];
    let clock = 1_700_000_000_000;
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ([{ current: { weather_code: 0 } }, { current: { weather_code: 73 } }]) };
    };
    const w = createWeather(fakeChrome(), fetch, () => clock);
    const first = await w.now();
    eq(first.codes.join(','), '0,73');
    eq(calls[0].url, 'https://api.open-meteo.com/v1/forecast?latitude=40.04,39.95&longitude=-75.51,-75.17&current=weather_code');
    eq(calls[0].init.credentials, 'omit', 'no cookies');
    clock += 10 * 60 * 1000;
    const again = await w.now();
    ok(again.cached && again.codes.join(',') === '0,73', 'from the cache');
    eq(calls.length, 1);
  });

  test('tabs asking at once share one request; failures play nothing', async () => {
    const { createWeather } = await import(WEATHER);
    let calls = 0;
    const fetch = async () => { calls++; return { ok: true, json: async () => ([{ current: { weather_code: 3 } }]) }; };
    const w = createWeather(fakeChrome(), fetch, () => 1_700_000_000_000);
    await Promise.all([w.now(), w.now(), w.now()]);
    eq(calls, 1);
    eq((await createWeather(fakeChrome(), async () => { throw new Error('offline'); }).now()).code, 'network');
    eq((await createWeather(fakeChrome(), async () => ({ ok: false, status: 503 })).now()).code, 'http');
  });
});

suite('Hidden Gems: starting and stopping an effect', (test) => {
  // A small fake page: enough DOM for a session's stage and listeners.
  function sandbox() {
    const nodes = [];
    function el(tag) {
      const e = {
        tagName: String(tag).toUpperCase(), style: {}, className: '', parentNode: null, children: [],
        setAttribute() {}, addEventListener() {}, removeEventListener() {},
        appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
        removeChild(c) { e.children.splice(e.children.indexOf(c), 1); c.parentNode = null; return c; }
      };
      nodes.push(e);
      return e;
    }
    const body = el('body');
    const loads = [];
    const injected = {}; // what the service worker would inject, by id
    const sb = {
      CGP: { hiddenGems: globalThis.CGP.hiddenGems },
      document: { body, hidden: false, activeElement: null, createElement: el, addEventListener() {}, removeEventListener() {} },
      window: { innerWidth: 1280, innerHeight: 760, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
      location: { hash: '' },
      performance: { now: () => Date.now() },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {},
      setTimeout, clearTimeout, Promise,
      chrome: { runtime: { sendMessage(msg, cb) { loads.push(() => { sb.CGP.gemPlayers[msg.id] = injected[msg.id]; cb({ ok: true }); }); }, getURL: (x) => x } }
    };
    sb.globalThis = sb;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/core/hidden-gems-ui.js'), 'utf8'), sb);
    const stages = () => body.children.filter((c) => c.className === 'cgp-gem-stage');
    return { sb, injected, loads, stages, ctl: new sb.CGP.HiddenGemsController({ settings: { values: {} } }) };
  }

  test('an effect that throws at once (no WebGL) leaves nothing on the page', async () => {
    const { sb, injected, loads, stages, ctl } = sandbox();
    injected.snow = (session) => { session.stage.appendChild(sb.document.createElement('div')); throw new Error('no webgl'); };
    const playing = ctl.play('snow', {});
    loads.shift()();
    eq(await playing, null, 'the play failed');
    eq(stages().length, 0, 'the stage is gone');
    eq(ctl._active, null);
  });

  test('stopping while the effect is still loading means it never starts', async () => {
    const { sb, injected, loads, stages, ctl } = sandbox();
    let started = 0;
    injected.leaves = () => { started++; };
    const playing = ctl.play('leaves', {});
    ctl.stop();
    loads.shift()();
    eq(await playing, null);
    eq(started, 0, 'the player was never called');
    eq(stages().length, 0, 'no stage was made');
  });

  test('the rain and sunshine preview codes no longer play anything', () => {
    const { sb, ctl } = sandbox();
    for (const h of ['#cgp-gem-rain', '#cgp-gem-rain-light', '#cgp-gem-rain-heavy', '#cgp-gem-rain-storm', '#cgp-gem-rain-thunder', '#cgp-gem-sunshine']) {
      sb.location.hash = h;
      not(ctl._checkHashPreview(), h);
    }
    for (const h of ['#cgp-gem-snow', '#cgp-gem-snow-heavy', '#cgp-gem-leaves', '#cgp-gem-lights']) {
      sb.location.hash = h;
      ok(ctl._checkHashPreview(), h);
    }
    ctl.stop();
  });

  test('a newer effect wins over one still loading', async () => {
    const { sb, injected, loads, stages, ctl } = sandbox();
    const ran = [];
    injected.leaves = () => { ran.push('leaves'); };
    injected.lights = () => { ran.push('lights'); };
    const first = ctl.play('leaves', {});
    const second = ctl.play('lights', {});
    loads.shift()(); loads.shift()();
    await first; await second;
    eq(ran.join(','), 'lights');
    eq(stages().length, 1, 'one stage');
    ctl.stop();
    eq(stages().length, 0);
  });
});

suite('Hidden Gems: wiring', (test) => {
  test('the core scripts and styles are content scripts; the effects are not', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const scriptManifest = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
    const entry = manifest.content_scripts.find((c) => (c.js || []).includes('src/core/hidden-gems.js'));
    ok(entry && entry.js.includes('src/core/hidden-gems-ui.js') && entry.css.includes('src/styles/hidden-gems.css'));
    ok(scriptManifest.includes("'src/core/hidden-gems.js'") && scriptManifest.includes("'src/core/hidden-gems-ui.js'"));
    const all = JSON.stringify(manifest.content_scripts) + scriptManifest;
    not(/src\/gems\//.test(all), 'effect code is injected only when an effect plays');
  });

  test('the service worker injects only the three effects, into the asking frame', () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    ok(bg.includes("msg.type === 'cgp.gems.load'"));
    ok(bg.includes("const GEMS = ['snow', 'leaves', 'lights'];") && bg.includes('GEMS.indexOf(msg.id) === -1'));
    ok(bg.includes("files: ['src/gems/' + msg.id + '.js']"));
  });

  test('the textures are web-accessible, with a dynamic URL; no new permission', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const war = manifest.web_accessible_resources || [];
    ok(war.some((w) => w.resources.includes('src/assets/gems/*') && w.use_dynamic_url === true));
    eq(manifest.permissions.join(','), 'storage,scripting,alarms');
  });

  test('each effect file registers its player and names only assets that exist', () => {
    for (const id of GEMS) {
      const file = path.join(ROOT, 'src/gems', id + '.js');
      const code = fs.readFileSync(file, 'utf8');
      const sandbox = { globalThis: null, CGP: undefined };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(code, sandbox, { filename: file });
      ok(sandbox.CGP && typeof sandbox.CGP.gemPlayers[id] === 'function', id + ' registers CGP.gemPlayers.' + id);
      const assets = code.match(/'[a-z0-9-]+\.(?:png|webp)'/g) || [];
      for (const a of assets) ok(fs.existsSync(path.join(ROOT, 'src/assets/gems', a.slice(1, -1))), id + ' uses ' + a);
    }
  });

  test('every bundled asset is credited in LICENSES.txt', () => {
    const lic = fs.readFileSync(path.join(ROOT, 'src/assets/gems/LICENSES.txt'), 'utf8');
    for (const f of fs.readdirSync(path.join(ROOT, 'src/assets/gems'))) {
      if (f === 'LICENSES.txt') continue;
      ok(lic.includes(f), f + ' is credited');
    }
    ok(lic.includes('Software License Agreement (BSD License)'), 'Snowstorm BSD text reproduced');
    ok(lic.includes('Copyright (c) 2024 phongdh'), 'MIT notices reproduced');
    not(/raindrop|codrops|sunlit/i.test(lic), 'no credits left for removed effects');
  });
});
