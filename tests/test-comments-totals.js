/* The highest priority behaviour: "I left feedback here", never "has comments". */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

const ME = '555';        // logged in instructor
const OTHER_TEACHER = '556';
const STUDENT = '101';

const comment = (authorId, iso, extra) => Object.assign({
  id: String(Math.random()).slice(2),
  author_id: authorId,
  comment: 'text that is never logged',
  created_at: iso
}, extra || {});

suite('instructor comment matching', (test) => {
  const analyze = (comments) =>
    CGP.commentAnalysis.analyze(comments, { instructorId: ME, studentId: STUDENT });

  test('my own comment lights the indicator', () => {
    const r = analyze([comment(ME, '2026-09-01T12:00:00Z')]);
    a.eq(r.hasInstructorComment, true);
    a.eq(r.instructorCount, 1);
    a.eq(CGP.commentAnalysis.tooltip(r), 'You left feedback');
  });

  test('a student-only comment does NOT light the indicator', () => {
    const r = analyze([comment(STUDENT, '2026-09-01T12:00:00Z')]);
    a.eq(r.hasInstructorComment, false, 'has comments is not the same as I commented');
    a.eq(r.total, 1);
    a.eq(r.otherCount, 1);
    a.eq(CGP.commentAnalysis.tooltip(r), '');
  });

  test('another teacher\'s comment does NOT count as mine', () => {
    const r = analyze([comment(OTHER_TEACHER, '2026-09-01T12:00:00Z')]);
    a.eq(r.hasInstructorComment, false);
    a.eq(r.instructorCount, 0);
  });

  test('several of my comments are counted for the tooltip', () => {
    const r = analyze([
      comment(ME, '2026-09-01T12:00:00Z'),
      comment(STUDENT, '2026-09-02T12:00:00Z'),
      comment(ME, '2026-09-03T12:00:00Z')
    ]);
    a.eq(r.instructorCount, 2);
    a.eq(CGP.commentAnalysis.tooltip(r), '2 instructor comments');
  });

  test('a draft comment is not feedback yet and is ignored', () => {
    const r = analyze([comment(ME, '2026-09-01T12:00:00Z', { draft: true })]);
    a.eq(r.hasInstructorComment, false);
    a.eq(r.total, 0);
  });

  test('author id is read from either author_id or a nested author object', () => {
    a.eq(CGP.commentAnalysis.authorId({ author_id: 7 }), '7');
    a.eq(CGP.commentAnalysis.authorId({ author: { id: 8 } }), '8');
    a.eq(CGP.commentAnalysis.authorId({}), null);
    a.eq(CGP.commentAnalysis.authorId(null), null);
    // Numeric ids from the API must still match string ids from the DOM.
    const r = CGP.commentAnalysis.analyze([{ author_id: 555, created_at: '2026-09-01T12:00:00Z' }],
      { instructorId: 555, studentId: 101 });
    a.eq(r.hasInstructorComment, true);
  });

  test('a student reply after my last comment is flagged', () => {
    const r = analyze([
      comment(ME, '2026-09-01T12:00:00Z'),
      comment(STUDENT, '2026-09-02T12:00:00Z')
    ]);
    a.eq(r.studentRepliedAfter, true);
    a.eq(CGP.commentAnalysis.tooltip(r).includes('student replied since'), true);
  });

  test('my reply after the student clears the reply flag', () => {
    const r = analyze([
      comment(ME, '2026-09-01T12:00:00Z'),
      comment(STUDENT, '2026-09-02T12:00:00Z'),
      comment(ME, '2026-09-03T12:00:00Z')
    ]);
    a.eq(r.studentRepliedAfter, false);
  });

  test('no comments at all is a quiet, empty analysis', () => {
    const r = analyze([]);
    a.eq(r.total, 0);
    a.eq(r.hasInstructorComment, false);
    a.eq(r.lastInstructorAt, null);
    a.eq(CGP.commentAnalysis.analyze(null, {}).total, 0, 'a missing list must not throw');
  });

  test('with no instructor id nothing is claimed as mine', () => {
    const r = CGP.commentAnalysis.analyze([comment(ME, '2026-09-01T12:00:00Z')], { instructorId: null });
    a.eq(r.hasInstructorComment, false, 'better to show no bubble than a wrong one');
  });


  test('author_name can identify me when Canvas omits author_id', () => {
    const r = CGP.commentAnalysis.analyze([
      { id: '9', author_name: 'Stephen B', comment: 'Nice', created_at: '2026-09-09T12:00:00Z' }
    ], { instructorId: '121', instructorNames: ['Stephen B'], studentId: '77' });
    a.eq(r.hasInstructorComment, true);
    a.eq(r.instructorCount, 1);
  });

  test('another author_name still does not count as mine', () => {
    const r = CGP.commentAnalysis.analyze([
      { id: '10', author_name: 'Another Teacher', comment: 'Feedback', created_at: '2026-09-09T12:00:00Z' }
    ], { instructorId: '121', instructorNames: ['Stephen B'], studentId: '77' });
    a.eq(r.hasInstructorComment, false);
  });
});

suite('comment cache updates after a new comment', (test) => {
  test('saving a comment lights the indicator without a page reload', () => {
    const before = CGP.commentAnalysis.analyze([], { instructorId: ME, studentId: STUDENT });
    a.eq(before.hasInstructorComment, false);

    const after = CGP.commentAnalysis.applyNewComment(
      [],
      { id: '9001', author_id: ME, created_at: '2026-09-04T12:00:00Z', comment: 'x' },
      { instructorId: ME, studentId: STUDENT }
    );
    a.eq(after.comments.length, 1);
    a.eq(after.analysis.hasInstructorComment, true);
    a.eq(after.analysis.instructorCount, 1);
  });

  test('the same comment arriving twice is not counted twice', () => {
    const c = { id: '9001', author_id: ME, created_at: '2026-09-04T12:00:00Z' };
    const once = CGP.commentAnalysis.applyNewComment([], c, { instructorId: ME });
    const twice = CGP.commentAnalysis.applyNewComment(once.comments, c, { instructorId: ME });
    a.eq(twice.comments.length, 1);
    a.eq(twice.analysis.instructorCount, 1);
  });

  test('an existing thread is preserved when I add to it', () => {
    const existing = [comment(STUDENT, '2026-09-01T12:00:00Z')];
    const out = CGP.commentAnalysis.applyNewComment(
      existing,
      { id: '9002', author_id: ME, created_at: '2026-09-02T12:00:00Z' },
      { instructorId: ME, studentId: STUDENT }
    );
    a.eq(out.comments.length, 2);
    a.eq(out.analysis.otherCount, 1);
    a.eq(out.analysis.instructorCount, 1);
    a.eq(out.analysis.studentRepliedAfter, false);
    a.eq(existing.length, 1, 'the cached array must not be mutated in place');
  });
});

suite('frozen Total column synchronization', (test) => {
  test('Canvas percentages are formatted, never recomputed', () => {
    a.eq(CGP.totals.formatTotal({ currentScore: 87.456 }).text, '87.46%');
    a.eq(CGP.totals.formatTotal({ currentScore: 90 }).text, '90%');
    a.eq(CGP.totals.formatTotal({ currentScore: 0 }).text, '0%', 'a real zero is not "no grade"');
  });

  test('a student with no graded work shows a dash, not a fake 0%', () => {
    a.eq(CGP.totals.formatTotal({ currentScore: null }).text, '\u2014');
    a.eq(CGP.totals.formatTotal({}).text, '\u2014');
    a.eq(CGP.totals.formatTotal(null).text, '\u2014');
  });

  test('the letter grade rides along in the tooltip', () => {
    const f = CGP.totals.formatTotal({ currentScore: 91.5, currentGrade: 'A-' });
    a.eq(f.title, 'Total 91.5% (A-)');
    a.eq(f.letter, 'A-');
  });

  test('total cells inherit their geometry from the rendered rows', () => {
    const rows = [
      { rowIndex: 0, top: 0, height: 35, studentId: '101' },
      { rowIndex: 1, top: 35, height: 35, studentId: '102' },
      { rowIndex: 2, top: 70, height: 35, studentId: '999' } // student not loaded yet
    ];
    const byId = new Map([
      ['101', { currentScore: 88, currentGrade: 'B+' }],
      ['102', { currentScore: null }]
    ]);
    const out = CGP.totals.buildTotalRows(rows, byId);
    a.eq(out.length, 3);
    a.eq(out[0].text, '88%');
    a.eq(out[0].top, 0);
    a.eq(out[1].height, 35);
    a.eq(out[1].resolved, false, 'no score yet is not a resolved total');
    a.eq(out[2].text, '\u2014');
    a.eq(out[2].title, 'Total unavailable', 'an unknown student never borrows another row\'s total');
  });

  test('a plain object lookup works as well as a Map', () => {
    const out = CGP.totals.buildTotalRows(
      [{ rowIndex: 0, top: 0, height: 35, studentId: '101' }],
      { 101: { currentScore: 75 } }
    );
    a.eq(out[0].text, '75%');
  });
});

suite('comment snippets', (test) => {
  const snips = [{ trigger: 'evidence', text: 'Tie it back to your data.' }];

  test('/trigger then Tab expands in place', () => {
    const text = 'Nice start. /evidence';
    const out = CGP.snippets.expand(text, text.length, snips);
    a.eq(out.text, 'Nice start. Tie it back to your data.');
    a.eq(out.caret, out.text.length);
  });

  test('an unknown trigger is left alone so Tab still means Tab', () => {
    const text = 'hello /nope';
    a.eq(CGP.snippets.expand(text, text.length, snips), null);
    a.eq(CGP.snippets.expand('no trigger here', 5, snips), null);
  });

  test('text after the caret is preserved', () => {
    const text = '/evidence and keep going';
    const out = CGP.snippets.expand(text, 9, snips);
    a.eq(out.text, 'Tie it back to your data. and keep going');
  });
});
