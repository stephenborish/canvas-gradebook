/* Airmail: the rare paper airplane. Rare by design - at most one a day, only
 * by luck, never when switched off - and a finished column counts only when
 * the teacher's own edit finishes it. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
for (const f of ['src/gems/airmail-state.js', 'src/gems/airmail-notes.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const AS = globalThis.CGP.AirmailState;
const NOTES = globalThis.CGP.AIRMAIL_NOTES;
const PILES = ['day', 'night', 'friday', 'golden', 'fall', 'winter', 'finale'].concat(AS.SUBJECTS.map((x) => x.id));

function memoryStorage(initial) {
  const bag = Object.assign({}, initial);
  return {
    bag,
    get: async (k) => (k in bag ? { [k]: bag[k] } : {}),
    set: async (o) => { Object.assign(bag, JSON.parse(JSON.stringify(o))); }
  };
}
const always = () => 0;          // every roll succeeds (and the plane is gold)
const never = () => 0.9999;      // every roll fails
const TUE_NOON = new Date(2026, 10, 17, 12, 0);

suite('Airmail: when a plane flies', (test) => {
  test('a lucky roll flies; an unlucky one does not', () => {
    a.ok(AS.decide({}, 'columnDone', TUE_NOON, always));
    a.eq(AS.decide({}, 'columnDone', TUE_NOON, never), null);
  });

  test('never more than one a day', () => {
    a.eq(AS.decide({ lastDay: AS.dayKey(TUE_NOON) }, 'posted', TUE_NOON, always), null);
    a.ok(AS.decide({ lastDay: '2026-11-16' }, 'posted', TUE_NOON, always));
  });

  test('switched off: nothing flies, except a summoned plane', () => {
    a.eq(AS.decide({ off: true }, 'idle', TUE_NOON, always), null);
    a.ok(AS.decide({ off: true, lastDay: AS.dayKey(TUE_NOON) }, 'summon', TUE_NOON, never));
  });

  test('an unknown trigger never flies', () => {
    a.eq(AS.decide({}, 'nonsense', TUE_NOON, always), null);
  });

  test('the odds are rare, and finishing a column is the luckiest', () => {
    a.ok(AS.ODDS.idle <= 0.02);
    a.ok(AS.ODDS.columnDone > AS.ODDS.posted && AS.ODDS.posted > AS.ODDS.idle);
    a.ok(AS.GOLDEN <= 0.1);
  });

  test('the note suits the hour', () => {
    a.eq(AS.flavor(new Date(2026, 10, 17, 23, 15)), 'night');
    a.eq(AS.flavor(new Date(2026, 10, 18, 2, 0)), 'night');
    a.eq(AS.flavor(new Date(2026, 10, 20, 14, 0)), 'friday');
    a.eq(AS.flavor(new Date(2026, 10, 20, 9, 0)), 'day');
    a.eq(AS.flavor(TUE_NOON), 'day');
  });

  test('the day is the local calendar day', () => {
    a.eq(AS.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});

suite('Airmail: the notes', (test) => {
  test('every note has a unique id, a pile, words and a sender', () => {
    const ids = new Set();
    for (const n of NOTES) {
      a.ok(n.id && !ids.has(n.id), 'unique id ' + n.id);
      ids.add(n.id);
      a.ok(PILES.includes(n.pile), n.id + ' pile ' + n.pile);
      a.ok(n.text && n.text.length > 10 && n.from, n.id + ' text/from');
    }
    for (const pile of PILES) a.ok(NOTES.filter((n) => n.pile === pile).length >= 3, pile + ' pile has at least three notes');
  });

  test('a gold plane carries a gold note; a night plane a night note', () => {
    a.eq(AS.pickNote(NOTES, {}, { golden: true, flavor: 'day' }, () => 0.5).pile, 'golden');
    a.eq(AS.pickNote(NOTES, {}, { golden: false, flavor: 'night' }, () => 0.5).pile, 'night');
    a.eq(AS.pickNote(NOTES, {}, { golden: true, subject: 'math' }, () => 0).pile, 'golden', 'gold beats the subject');
  });

  test('a note not yet caught comes first, so nothing repeats until the pile is done', () => {
    const fridays = NOTES.filter((n) => n.pile === 'friday');
    const caught = fridays.slice(0, -1).map((n) => ({ id: n.id, at: 1 }));
    const got = AS.pickNote(NOTES, { caught }, { flavor: 'friday' }, () => 0);
    a.eq(got.id, fridays[fridays.length - 1].id);
    const all = fridays.map((n) => ({ id: n.id, at: 1 }));
    a.eq(AS.pickNote(NOTES, { caught: all }, { flavor: 'friday' }, () => 0).pile, 'friday', 'then repeats from the same pile');
  });

  test('an empty pile falls back to the everyday notes', () => {
    const onlyDay = NOTES.filter((n) => n.pile === 'day');
    a.eq(AS.pickNote(onlyDay, {}, { golden: true }, () => 0).pile, 'day');
    a.eq(AS.pickNote([], {}, { flavor: 'day' }), null);
  });
});

suite('Airmail: notes about the subject being taught', (test) => {
  test('the course name names the subject', () => {
    const cases = {
      'Spanish II - Period 3': 'spanish', 'Español 4': 'spanish', 'French III': 'french', 'German 2': 'german',
      'Latin I': 'latin', 'Mandarin Chinese': 'chinese', 'AP Calculus BC': 'math', 'Algebra II Honors': 'math',
      'AP Statistics': 'math', 'Honors Chemistry': 'chemistry', 'AP Physics 1': 'physics', 'Biology 9': 'biology',
      'Earth Science': 'science', 'AP Computer Science A': 'cs', 'US History': 'history', 'Social Studies 7': 'history',
      'English 10: American Literature': 'english', 'English Language Arts': 'english',
      'Theology I: Hebrew Scriptures': 'theology', 'Morality & Social Justice': 'theology', 'Concert Band': 'music',
      'Chorus': 'music', 'Studio Art 2': 'art', 'Theatre Arts': 'drama', 'Health & PE': 'pe',
      'AP Macroeconomics': 'economics', 'AP Psychology': 'psychology'
    };
    for (const [name, want] of Object.entries(cases)) a.eq(AS.subjectOf(name), want, name);
    a.eq(AS.subjectOf('Homeroom'), null);
    a.eq(AS.subjectOf(''), null);
  });

  test('every subject has its own pile of notes and a postmark label', () => {
    for (const subj of AS.SUBJECTS) {
      a.ok(NOTES.filter((n) => n.pile === subj.id).length >= 3, subj.id);
      a.ok(AS.subjectLabel(subj.id), subj.id + ' label');
    }
  });

  test('a language class gets notes written in that language', () => {
    const spanish = NOTES.filter((n) => n.pile === 'spanish');
    a.ok(spanish.every((n) => /[áéíóúñ¡¿]/i.test(n.text + n.from)), 'Spanish notes are in Spanish');
    a.ok(NOTES.filter((n) => n.pile === 'french').every((n) => /[éèçàêù]|merci|vous/i.test(n.text)), 'French');
    a.ok(NOTES.filter((n) => n.pile === 'german').every((n) => /[äöüß]|danke|ich/i.test(n.text)), 'German');
    a.ok(NOTES.filter((n) => n.pile === 'chinese').every((n) => /[一-鿿]/.test(n.text)), 'Chinese');
  });

  test('a subject course lands a subject note more often than not, and a gold one beats it', () => {
    a.eq(AS.pileFor({ subject: 'spanish' }, () => 0.1), 'spanish');
    a.eq(AS.pileFor({ subject: 'spanish', flavor: 'night' }, () => 0.9), 'night', 'unlucky: the hour decides');
    a.eq(AS.pileFor({ subject: 'spanish', golden: true }, () => 0), 'golden');
    a.eq(AS.pileFor({ season: 'winter' }, () => 0.1), 'winter');
    a.eq(AS.pileFor({ season: 'winter' }, () => 0.9), 'day');
    a.eq(AS.pileFor({}, () => 0), 'day');
    a.ok(AS.SUBJECT_CHANCE > 0.5);
  });

  test('the decision carries the subject, the season and, rarely, a flock', () => {
    const spec = AS.decide({}, 'columnDone', new Date(2026, 11, 3, 10), always, 'music');
    a.eq(spec.subject, 'music');
    a.eq(spec.season, 'winter');
    a.eq(spec.flock, true);
    a.eq(AS.decide({}, 'columnDone', TUE_NOON, () => 0.1).flock, false);
    a.ok(AS.FLOCK < 0.1);
    a.eq(AS.season(new Date(2026, 8, 3)), 'fall');
    a.eq(AS.season(new Date(2026, 4, 20)), 'finale');
    a.eq(AS.season(new Date(2026, 2, 1)), null);
  });
});

suite('Airmail: the record', (test) => {
  test('a flight uses up the day; a catch goes in the Shoebox once', async () => {
    const store = memoryStorage();
    const s = new AS(store);
    await s.noteFlight(TUE_NOON);
    a.eq(store.bag[AS.KEY].lastDay, '2026-11-17');
    a.eq(store.bag[AS.KEY].flights, 1);
    const r1 = await s.keep('d01', 100);
    a.eq(r1.first, true, 'the very first note');
    const r2 = await s.keep('d01', 200);
    a.eq(r2.first, false);
    a.eq(store.bag[AS.KEY].caught.length, 1, 'caught again: still one card');
    a.eq(store.bag[AS.KEY].caught[0].at, 200);
    await s.miss();
    await s.miss();
    a.eq(store.bag[AS.KEY].missed, 2);
    await s.setOff(true);
    a.eq(store.bag[AS.KEY].off, true);
    a.eq(store.bag[AS.KEY].caught.length, 1, 'switching off keeps the notes');
  });

  test('storage that throws never breaks the page', async () => {
    const s = new AS({ get: () => { throw new Error('context invalidated'); }, set: () => Promise.reject(new Error('x')) });
    a.eq(JSON.stringify(await s.read()), '{}');
    await s.noteFlight(TUE_NOON);
    await s.keep('d01');
    await s.miss();
  });
});

suite('Airmail: a finished column', (test) => {
  const graded = { score: 9 };
  const blank = { score: null, grade: null };
  test('every student graded or excused is finished; one blank is not', () => {
    a.eq(AS.columnComplete([graded, { excused: true }, { grade: 'complete' }], 3), true);
    a.eq(AS.columnComplete([graded, blank, graded], 3), false);
    a.eq(AS.columnComplete([graded, { score: 0 }], 2), true, 'a zero is a grade');
  });

  test('not every submission loaded, or a class of one: can\'t tell', () => {
    a.eq(AS.columnComplete([graded, graded], 3), null);
    a.eq(AS.columnComplete([graded], 1), null);
  });

  test('only an edit that finishes an unfinished column counts', () => {
    const w = new AS.ColumnWatcher();
    a.not(w.observe('7', true, false), 'loaded already finished');
    a.not(w.observe('7', true, true), 'still finished');
    a.not(w.observe('8', false, false));
    a.not(w.observe('8', null, true), 'unknown changes nothing');
    a.ok(w.observe('8', true, true), 'the last grade typed');
    a.not(w.observe('9', true, true), 'never seen unfinished');
    a.not(w.observe('10', false, false));
    a.not(w.observe('10', true, false), 'finished by a re-read, not an edit');
  });
});

suite('Airmail: the plane\'s flight path', (test) => {
  test('a pass starts off the left edge and ends off the right, and back for the return', () => {
    globalThis.CGP.AirmailFlight = undefined;
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/gems/airmail.js'), 'utf8'), { filename: 'src/gems/airmail.js' });
    const pathAt = globalThis.CGP.AirmailFlight._pathAt;
    const geo = { w: 1000, h: 800, y0: 300, amp: 30, waves: 1, drift: 0, loopAt: 0.4, loopLen: 0.16, r: 50, reverse: false };
    a.ok(pathAt(0, geo).x < 0);
    a.ok(pathAt(1, geo).x > 1000);
    const back = Object.assign({}, geo, { reverse: true, loopLen: 0 });
    a.ok(pathAt(0, back).x > 1000);
    a.ok(pathAt(1, back).x < 0);
    // Half way round the loop the plane is upside down, a loop's height above.
    const top = pathAt(0.4 + 0.08, geo), entry = pathAt(0.4, geo);
    a.ok(Math.abs(entry.y - top.y - 100) < 0.01, 'the top of the loop is 2r above where it began');
  });
});
