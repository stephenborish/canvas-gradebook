/* Hidden Gems: the daily decision, the weather, and the wiring of the five effects. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: { ok, not, eq } } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const GEMS = ['rain', 'snow', 'leaves', 'sunshine', 'lights'];

suite('Hidden Gems: what plays today', (test) => {
  const hg = globalThis.CGP.hiddenGems;
  const clear = { codes: [0, 1], isDay: [1, 1] };
  const overcast = { codes: [3, 3], isDay: [1, 1] };

  test('exactly the five effects', () => {
    eq(hg.KINDS.join(','), GEMS.join(','));
  });

  test('WMO codes map to snow and rain; snow anywhere wins', () => {
    eq(hg.weatherKind([0, 3]), null, 'clear and overcast');
    eq(hg.weatherKind([45, 48]), null, 'fog');
    eq(hg.weatherKind([71, 0]).id, 'snow');
    ok(hg.weatherKind([0, 75]).heavy, 'heavy snow in either place');
    eq(hg.weatherKind([61, 73]).id, 'snow', 'snow in Malvern beats rain in the city');
    ok(hg.weatherKind([51]).light, 'drizzle is light rain');
    const storm = hg.weatherKind([95, 61]);
    ok(storm.id === 'rain' && storm.thunder && storm.heavy, 'thunderstorm');
    eq(hg.weatherKind(['junk']), null);
  });

  test('real rain or snow always plays, whatever the date or the roll', () => {
    const july = new Date(2026, 6, 10, 10);
    eq(hg.chooseGem(july, { codes: [63, 0] }, () => 0.99).id, 'rain');
    eq(hg.chooseGem(new Date(2026, 11, 10, 10), { codes: [73, 73] }, () => 0.99).id, 'snow', 'snow beats Christmas lights');
    ok(hg.chooseGem(july, { codes: [95, 0] }, () => 0.5).opts.thunder);
  });

  test('Christmas lights from 1 December to 6 January, on some days', () => {
    eq(hg.chooseGem(new Date(2026, 11, 1, 9), overcast, () => 0.1).id, 'lights');
    eq(hg.chooseGem(new Date(2027, 0, 6, 9), clear, () => 0.1).id, 'lights');
    eq(hg.chooseGem(new Date(2026, 11, 15, 9), clear, () => 0.9), null, 'most days nothing');
    not(hg.isChristmasSeason(new Date(2027, 0, 7)));
    not(hg.isChristmasSeason(new Date(2026, 10, 30)));
  });

  test('autumn leaves from 22 September to 30 November; sunshine on a clear autumn day otherwise', () => {
    eq(hg.chooseGem(new Date(2026, 9, 14, 11), overcast, () => 0.1).id, 'leaves');
    eq(hg.chooseGem(new Date(2026, 8, 22, 11), overcast, () => 0.1).id, 'leaves');
    eq(hg.chooseGem(new Date(2026, 9, 14, 11), clear, () => 0.5).id, 'sunshine');
    eq(hg.chooseGem(new Date(2026, 9, 14, 11), overcast, () => 0.5), null);
    not(hg.isAutumn(new Date(2026, 8, 21)));
  });

  test('sunshine only on a clear day, by day, and only some days', () => {
    const may = new Date(2026, 4, 12, 13);
    eq(hg.chooseGem(may, clear, () => 0.1).id, 'sunshine');
    eq(hg.chooseGem(may, clear, () => 0.5), null);
    eq(hg.chooseGem(may, overcast, () => 0.1), null, 'not when overcast');
    eq(hg.chooseGem(may, { codes: [0, 0], isDay: [0, 0] }, () => 0.1), null, 'not at night');
    eq(hg.chooseGem(may, null, () => 0.1), null, 'not when the weather is unknown');
  });

  test('one decision a day', () => {
    const now = new Date(2026, 10, 24, 9, 30);
    ok(hg.rollDue({}, now));
    not(hg.rollDue({ rolledDay: hg.dayKey(now) }, now), 'already decided today');
    ok(hg.rollDue({ rolledDay: '2026-11-23' }, now), 'a new day');
    not(hg.rollDue({}, now, { enabled: false }));
    not(hg.rollDue({}, now, { reducedMotion: true }));
    eq(hg.dayKey(new Date(2026, 0, 5)), '2026-01-05');
  });
});

suite('Hidden Gems: the weather around Philadelphia', (test) => {
  const { pathToFileURL } = require('url');
  const WEATHER = pathToFileURL(path.join(ROOT, 'src', 'weather.js')).href;
  function fakeChrome() {
    const bag = {};
    return { bag, storage: { local: { get: async (k) => ({ [k]: bag[k] }), set: async (o) => Object.assign(bag, o) } } };
  }

  test('asks Open-Meteo for Malvern and Philadelphia in one request, with day or night, and keeps it 20 minutes', async () => {
    const { createWeather } = await import(WEATHER);
    const calls = [];
    let clock = 1_700_000_000_000;
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ([{ current: { weather_code: 0, is_day: 1 } }, { current: { weather_code: 61, is_day: 0 } }]) };
    };
    const w = createWeather(fakeChrome(), fetch, () => clock);
    const first = await w.now();
    eq(first.codes.join(','), '0,61');
    eq(first.isDay.join(','), '1,0');
    eq(calls[0].url, 'https://api.open-meteo.com/v1/forecast?latitude=40.04,39.95&longitude=-75.51,-75.17&current=weather_code,is_day');
    eq(calls[0].init.credentials, 'omit', 'no cookies');
    clock += 10 * 60 * 1000;
    const again = await w.now();
    ok(again.cached && again.isDay.join(',') === '1,0', 'from the cache');
    eq(calls.length, 1);
  });

  test('tabs asking at once share one request; failures play nothing', async () => {
    const { createWeather } = await import(WEATHER);
    let calls = 0;
    const fetch = async () => { calls++; return { ok: true, json: async () => ([{ current: { weather_code: 3, is_day: 1 } }]) }; };
    const w = createWeather(fakeChrome(), fetch, () => 1_700_000_000_000);
    await Promise.all([w.now(), w.now(), w.now()]);
    eq(calls, 1);
    eq((await createWeather(fakeChrome(), async () => { throw new Error('offline'); }).now()).code, 'network');
    eq((await createWeather(fakeChrome(), async () => ({ ok: false, status: 503 })).now()).code, 'http');
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

  test('the service worker injects only the five effects, into the asking frame', () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    ok(bg.includes("msg.type === 'cgp.gems.load'"));
    ok(bg.includes("const GEMS = ['rain', 'snow', 'leaves', 'sunshine', 'lights'];") && bg.includes('GEMS.indexOf(msg.id) === -1'));
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
    ok(lic.includes('Copyright (c) 2021 SardineFish') && lic.includes('Copyright (c) 2024 phongdh'), 'MIT notices reproduced');
  });
});
