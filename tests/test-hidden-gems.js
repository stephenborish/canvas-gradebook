/* Hidden Gems: subject detection, per-subject touches, rarity & manifest parity. */
'use strict';

const fs = require('fs');
const path = require('path');
const { suite, assert: { ok, not, eq } } = require('./harness');

const ROOT = path.resolve(__dirname, '..');

suite('Hidden Gems: subject detection', (test) => {
  const hg = globalThis.CGP.hiddenGems;

  test('recognizes specific subjects from course names', () => {
    eq(hg.detectSubject('AP Chemistry - Period 3').id, 'chemistry');
    eq(hg.detectSubject('Honors Physics 101').id, 'physics');
    eq(hg.detectSubject('AP Biology').id, 'biology');
    eq(hg.detectSubject('AP Calculus BC').id, 'calculus');
    eq(hg.detectSubject('Mandarin Chinese II').id, 'chinese');
    eq(hg.detectSubject('中文 3').id, 'chinese');
    eq(hg.detectSubject('Español IV Honors').id, 'spanish');
    eq(hg.detectSubject('Catholic Theology 11').id, 'theology');
    eq(hg.detectSubject('World Religions & Ethics').id, 'theology');
    eq(hg.detectSubject('APUSH - Block B').id, 'history');
    eq(hg.detectSubject('World History').id, 'history');
    eq(hg.detectSubject('Algebra II').id, 'math');
    eq(hg.detectSubject('Earth Science 8').id, 'science');
    eq(hg.detectSubject('AP English Literature').id, 'literature');
    eq(hg.detectSubject('Concert Band').id, 'music');
    eq(hg.detectSubject('Studio Art & Ceramics').id, 'art');
    eq(hg.detectSubject('AP Computer Science A').id, 'cs');
    eq(hg.detectSubject('French III').id, 'french');
    eq(hg.detectSubject('Deutsch II').id, 'german');
    eq(hg.detectSubject('AP Latin').id, 'latin');
    eq(hg.detectSubject('Stagecraft & Theatre').id, 'drama');
    eq(hg.detectSubject('AP Macroeconomics').id, 'economics');
    eq(hg.detectSubject('AP Psychology').id, 'psychology');
    eq(hg.detectSubject('Physical Education 10').id, 'pe');
  });

  test('specific subjects win over broader ones', () => {
    eq(hg.detectSubject('Chemistry Science Lab').id, 'chemistry');
    eq(hg.detectSubject('Calculus Math 12').id, 'calculus');
    eq(hg.detectSubject('Environmental Science').id, 'biology');
  });

  test('falls back to most common subject across the teacher’s other courses', () => {
    const res = hg.detectSubject('Homeroom Advisory', [
      'Spanish I - Period 1',
      'Spanish II - Period 2',
      'Spanish III - Period 4',
      'Study Hall'
    ]);
    eq(res.id, 'spanish');
    eq(res.source, 'courses');
  });

  test('defaults cleanly to general when no course matches', () => {
    const res = hg.detectSubject('Advisory 2026', ['Homeroom', 'Faculty Lounge']);
    eq(res.id, 'general');
    eq(res.source, 'default');
  });
});

suite('Hidden Gems: the pieces', (test) => {
  const hg = globalThis.CGP.hiddenGems;

  test('gravity is the registered piece', () => {
    eq(hg.GEMS.join(','), 'gravity');
  });

  test('every piece gets a seed for every subject', () => {
    for (const subj of Object.keys(hg.SUBJECT_LABELS)) {
      for (const gem of hg.GEMS) {
        const props = hg.contentFor(gem, subj, () => 0.1);
        eq(props.subjectId, subj, `${gem} for ${subj}`);
        ok(Number.isInteger(props.seed) && props.seed >= 0, `${gem} seed for ${subj}`);
      }
    }
  });

  test('the seed changes from one sighting to the next', () => {
    ok(hg.contentFor('gravity', 'general', () => 0.12).seed !== hg.contentFor('gravity', 'general', () => 0.78).seed);
  });
});

suite('Hidden Gems: rarity, cooldown & non-repeat', (test) => {
  const hg = globalThis.CGP.hiddenGems;

  test('respects enabled=false and reducedMotion=true', () => {
    const now = 1_700_000_000_000;
    not(hg.shouldTrigger({}, now, { enabled: false }, () => 0.01));
    not(hg.shouldTrigger({}, now, { enabled: true, reducedMotion: true }, () => 0.01));
  });

  test('enforces 24-hour cooldown and 12% chance threshold', () => {
    const now = 1_700_000_000_000;
    eq(hg.DEFAULT_COOLDOWN_MS, 24 * 60 * 60 * 1000);
    eq(hg.DEFAULT_CHANCE, 0.12);
    not(hg.shouldTrigger({ lastShownAt: now - 12 * 60 * 60 * 1000 }, now, { enabled: true }, () => 0));
    ok(hg.shouldTrigger({ lastShownAt: now - hg.DEFAULT_COOLDOWN_MS - 1 }, now, { enabled: true }, () => 0.08));
    not(hg.shouldTrigger({ lastShownAt: now - hg.DEFAULT_COOLDOWN_MS - 1 }, now, { enabled: true }, () => 0.2));
  });

  test('pickGem always returns a registered piece, even from an old stored history', () => {
    for (let step = 0; step < 10; step++) {
      ok(hg.GEMS.includes(hg.pickGem(['washer', 'boat', 'crane', 'gravity'], () => step / 10)), 'registered piece');
      ok(hg.GEMS.includes(hg.pickGem(null, () => step / 10)), 'registered piece with no history');
    }
  });

  test('extractCachedCourseNames enforces origin, user id, and cache freshness', () => {
    const now = 1_700_000_000_000;
    const box = {
      origin: 'https://school.instructure.com',
      uid: '42',
      at: now - 5 * 60 * 1000,
      courses: [
        { name: 'AP Chemistry', course_code: 'CHEM-101' },
        { name: 'Honors Chemistry', course_code: 'CHEM-102' }
      ]
    };
    const valid = hg.extractCachedCourseNames(box, 'https://school.instructure.com', '42', now);
    ok(valid.includes('AP Chemistry') && valid.includes('CHEM-102'), 'reads valid cache');
    eq(hg.extractCachedCourseNames(box, 'https://other.instructure.com', '42', now).length, 0, 'rejects wrong origin');
    eq(hg.extractCachedCourseNames(box, 'https://school.instructure.com', '99', now).length, 0, 'rejects wrong uid');
    eq(hg.extractCachedCourseNames(box, 'https://school.instructure.com', null, now).length, 0, 'rejects missing uid');
    const stale = Object.assign({}, box, { at: now - 31 * 60 * 1000 });
    eq(hg.extractCachedCourseNames(stale, 'https://school.instructure.com', '42', now).length, 0, 'rejects stale cache');
  });

  test('isCooldownClear blocks playback when another window claimed the period', () => {
    const now = 1_700_000_000_000;
    ok(hg.isCooldownClear({}, now, { enabled: true }));
    not(hg.isCooldownClear({ lastShownAt: now - 5000 }, now, { enabled: true }));
    ok(hg.isCooldownClear({ lastShownAt: now - hg.DEFAULT_COOLDOWN_MS - 1 }, now, { enabled: true }));
  });

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
});

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
