/* The Total column's hover tooltip: "pts" only on a real points figure, and
 * Canvas's unposted-grades note kept as its own (wrapping) line. */
'use strict';

const fs = require('fs');
const path = require('path');
const { suite, assert: a } = require('./harness');
const { loadGradebookDom } = require('./domharness');

suite('Total tooltip text', (test) => {
  const NOTE = 'This grade may differ from the student’s view of the grade because some assignment grades are not yet posted';

  test('a points figure gets "pts"', () => {
    const CGP = loadGradebookDom();
    const r = CGP.splitTotalTip('45/60');
    a.eq(r.points, '45 / 60');
    a.eq(r.note, '');
  });

  test('a bare points value (with or without pts) keeps its points line', () => {
    const CGP = loadGradebookDom();
    a.eq(CGP.splitTotalTip('45').points, '45');
    a.eq(CGP.splitTotalTip('45 pts').points, '45');
    a.eq(CGP.splitTotalTip('45 pts').note, '');
  });

  test('the unposted-grades note never gets "pts" appended', () => {
    const CGP = loadGradebookDom();
    const r = CGP.splitTotalTip(NOTE);
    a.eq(r.points, '');
    a.eq(r.note, NOTE);
  });

  test('points and the note together are split into separate lines', () => {
    const CGP = loadGradebookDom();
    const r = CGP.splitTotalTip('12.5 / 80 pts ' + NOTE);
    a.eq(r.points, '12.5 / 80');
    a.eq(r.note, NOTE);
  });

  test('the tooltip wraps long text instead of one endless line', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'gradebook.css'), 'utf8');
    const block = /html\.cgp-on \.cgp-total-tip \{[^}]*\}/.exec(css)[0];
    a.ok(/max-width:\s*\d+px/.test(block), 'tooltip has a max width');
    a.ok(!/white-space:\s*nowrap/.test(block), 'tooltip box is not nowrap');
  });
});
