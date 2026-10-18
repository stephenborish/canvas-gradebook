'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

function stats() { return globalThis.CGP.scoreStats; }

const SCALE = [
  { letter: 'A', min: 89.5 }, { letter: 'B', min: 79.5 }, { letter: 'C', min: 69.5 },
  { letter: 'D', min: 59.5 }, { letter: 'F', min: 0 }
];

function e(name, score, extra) { return Object.assign({ userId: name, name: name, score: score }, extra || {}); }

suite('score analysis: column statistics', (test) => {
  test('mean, median, population SD, range and percentages', () => {
    const s = stats().analyze([e('A', 40), e('B', 50), e('C', 60), e('D', 70)], 80, SCALE);
    a.eq(s.count, 4);
    a.eq(s.mean, 55);
    a.eq(s.median, 55, 'even count averages the middle two');
    a.eq(Math.round(s.sd * 1000) / 1000, 11.18);
    a.eq(s.min, 40);
    a.eq(s.max, 70);
    a.eq(s.meanPercent, 68.75);
  });

  test('blanks and excused are counted but never treated as zeros', () => {
    const s = stats().analyze([e('A', 10), e('B', null), e('C', 0), e('D', 8, { excused: true })], 10, SCALE);
    a.eq(s.count, 2);
    a.eq(s.ungraded, 1);
    a.eq(s.excused, 1);
    a.eq(s.mean, 5, 'an entered 0 is a real score');
  });

  test('histogram buckets follow the grading-scale cutoffs with Total-column rounding', () => {
    // 89.46% rounds to 89.5 -> A, exactly like the Total column's letter.
    const s = stats().analyze([e('A', 89.46), e('B', 89.4), e('C', 59), e('D', 100)], 100, SCALE);
    const counts = {};
    s.buckets.forEach((b) => { counts[b.letter] = b.count; });
    a.deep(counts, { A: 2, B: 1, C: 0, D: 0, F: 1 });
    a.eq(s.buckets[0].max, null, 'top bucket is open-ended');
    a.eq(s.buckets[1].max, 89.5);
    a.eq(s.buckets[4].min, 0);
  });

  test('highest / lowest lists keep ties at the cut-off together', () => {
    const s = stats().analyze([e('A', 9), e('B', 8), e('C', 8), e('D', 7), e('E', 1)], 10, SCALE, 2);
    a.deep(s.highest.map((g) => g.name), ['A', 'B', 'C']);
    a.deep(s.lowest.map((g) => g.name), ['E', 'D']);
  });

  test('no points possible: statistics in points, no letter buckets', () => {
    const s = stats().analyze([e('A', 3), e('B', 5)], 0, SCALE);
    a.eq(s.mean, 4);
    a.eq(s.buckets, null);
    a.eq(s.meanPercent, null);
  });

  test('the panel renders every figure, escapes names, and draws one bar per letter', () => {
    vm.runInThisContext(fs.readFileSync(path.resolve(__dirname, '../src/gradebook/score-analysis.js'), 'utf8'));
    const ctrl = new globalThis.CGP.ScoreAnalysisController({ model: {}, adapter: {}, settings: { values: {} } });
    const s = stats().analyze([e('<b>x</b>', 95), e('B', 85), e('C', 85)], 100, SCALE);
    const html = ctrl.render(s);
    a.ok(html.indexOf('&lt;b&gt;x&lt;/b&gt;') >= 0, 'student names are escaped');
    a.ok(/Mean/.test(html) && /Median/.test(html) && /Std\. deviation/.test(html));
    a.eq((html.match(/class="cgp-stats__bar"/g) || []).length, 2, 'a bar for each non-empty bucket');
    a.eq((html.match(/cgp-stats__letter/g) || []).length, 5, 'a label for every letter');
    a.ok(/No graded scores/.test(ctrl.render(stats().analyze([], 10, SCALE))));
  });
});
