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
