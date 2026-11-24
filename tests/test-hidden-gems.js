/* Hidden Gems: snow and rain on real snowy and rainy days around Philadelphia. */
'use strict';

const fs = require('fs');
const path = require('path');
const { suite, assert: { ok, not, eq } } = require('./harness');

const ROOT = path.resolve(__dirname, '..');

suite('Hidden Gems: snow and rain on real snowy and rainy days', (test) => {
  const hg = globalThis.CGP.hiddenGems;

  test('WMO codes map to snow, rain and thunder; snow anywhere wins', () => {
    eq(hg.weatherKind([0, 3]), null, 'clear and overcast');
    eq(hg.weatherKind([45, 48]), null, 'fog');
    eq(hg.weatherKind([71, 0]).id, 'snow');
    eq(hg.weatherKind([0, 75]).heavy, true, 'heavy snow in either place');
    eq(hg.weatherKind([86]).id, 'snow', 'snow showers');
    eq(hg.weatherKind([53, 0]).id, 'rain', 'drizzle');
    eq(hg.weatherKind([61, 61]).heavy, false);
    eq(hg.weatherKind([61, 73]).id, 'snow', 'snow in Malvern beats rain in the city');
    const storm = hg.weatherKind([95, 61]);
    ok(storm.id === 'rain' && storm.thunder && storm.heavy, 'thunderstorm');
    eq(hg.weatherKind(['junk']), null);
    eq(hg.weatherKind([]), null);
  });

  test('weather shows at most once every three hours, and never when off', () => {
    const now = 1_700_000_000_000;
    ok(hg.weatherDue({}, now, { enabled: true }));
    not(hg.weatherDue({ weatherShownAt: now - 60 * 60 * 1000 }, now, { enabled: true }));
    ok(hg.weatherDue({ weatherShownAt: now - hg.WEATHER_EVERY_MS }, now, { enabled: true }));
    not(hg.weatherDue({}, now, { enabled: false }));
    not(hg.weatherDue({}, now, { enabled: true, reducedMotion: true }));
  });

  const { pathToFileURL } = require('url');
  const WEATHER = pathToFileURL(path.join(ROOT, 'src', 'weather.js')).href;
  function fakeChrome() {
    const bag = {};
    return { bag, storage: { local: { get: async (k) => ({ [k]: bag[k] }), set: async (o) => Object.assign(bag, o) } } };
  }

  test('asks Open-Meteo for Malvern and Philadelphia in one request, and keeps the answer 20 minutes', async () => {
    const { createWeather } = await import(WEATHER);
    const calls = [];
    let clock = 1_700_000_000_000;
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ([{ current: { weather_code: 73 } }, { current: { weather_code: 61 } }]) };
    };
    const w = createWeather(fakeChrome(), fetch, () => clock);
    const first = await w.now();
    ok(first.ok, 'answered');
    eq(first.codes.join(','), '73,61');
    eq(calls.length, 1);
    eq(calls[0].url, 'https://api.open-meteo.com/v1/forecast?latitude=40.04,39.95&longitude=-75.51,-75.17&current=weather_code');
    eq(calls[0].init.credentials, 'omit', 'no cookies');
    clock += 10 * 60 * 1000;
    ok((await w.now()).cached, 'ten minutes later: from the cache');
    eq(calls.length, 1);
    clock += 15 * 60 * 1000;
    await w.now();
    eq(calls.length, 2, 'after 20 minutes: asked again');
  });

  test('a failed or odd answer plays nothing', async () => {
    const { createWeather } = await import(WEATHER);
    eq((await createWeather(fakeChrome(), async () => ({ ok: true, json: async () => ({}) })).now()).code, 'shape');
    eq((await createWeather(fakeChrome(), async () => { throw new Error('offline'); }).now()).code, 'network');
    eq((await createWeather(fakeChrome(), async () => ({ ok: false, status: 503 })).now()).code, 'http');
  });

  test('the service worker answers the weather question', () => {
    const bg = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');
    ok(bg.includes("from './weather.js'") && bg.includes('WEATHER_NOW'), 'background.js wires weather.js');
    const ui = fs.readFileSync(path.join(ROOT, 'src/core/hidden-gems-ui.js'), 'utf8');
    ok(ui.includes("'cgp.weather.now'"), 'the controller asks with the same message type');
  });
});

suite('Hidden Gems: wiring', (test) => {
  test('manifest.json and script-manifest.js both list hidden-gems assets', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const scriptManifest = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
    const courseEntry = manifest.content_scripts.find((c) => (c.js || []).includes('src/core/hidden-gems.js'));
    ok(courseEntry, 'manifest.json loads src/core/hidden-gems.js');
    ok(courseEntry.js.includes('src/core/hidden-gems-ui.js'), 'manifest.json loads src/core/hidden-gems-ui.js');
    ok(courseEntry.css.includes('src/styles/hidden-gems.css'), 'manifest.json loads src/styles/hidden-gems.css');
    ok(scriptManifest.includes("'src/core/hidden-gems.js'"), 'script-manifest.js lists hidden-gems.js');
    ok(scriptManifest.includes("'src/core/hidden-gems-ui.js'"), 'script-manifest.js lists hidden-gems-ui.js');
    ok(scriptManifest.includes("'src/styles/hidden-gems.css'"), 'script-manifest.js lists hidden-gems.css');
  });

  test('only snow and rain are left', () => {
    const hg = globalThis.CGP.hiddenGems;
    eq(hg.KINDS.join(','), 'snow,rain');
    const ui = fs.readFileSync(path.join(ROOT, 'src/core/hidden-gems-ui.js'), 'utf8');
    ok(/PLAYERS\.snow = /.test(ui) && /PLAYERS\.rain = /.test(ui), 'both are drawn');
    not(/PLAYERS\.(gravity|murmuration|crane|blossom)/.test(ui), 'the earlier pieces are gone');
  });
});
