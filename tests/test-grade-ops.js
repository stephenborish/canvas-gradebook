/* Grading semantics: the shortcuts that must be exactly right, every time. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

suite('grade shortcuts (M / E / L / 0)', (test) => {
  const ops = () => CGP.gradeOps;

  test('M parses as Missing and sets the status only - no grade at all', () => {
    const parsed = ops().parseToken('M');
    a.eq(parsed.kind, ops().KIND.MISSING);
    const op = ops().operationFor(parsed);
    a.form(op.form, { 'submission[late_policy_status]': 'missing' }, 'M form');
    a.lacksKey(op.form, 'submission[posted_grade]', 'Missing must never write a grade');
    a.eq(op.patch.missing, true, 'optimistic missing flag');
    a.eq(op.patch.latePolicyStatus, 'missing');
    a.eq(op.display, null, 'no display override for a status-only write');
  });

  test('m, mi and missing are all the Missing shortcut', () => {
    ['m', 'MI', 'missing', 'Missing'].forEach((token) => {
      a.eq(ops().parseToken(token).kind, ops().KIND.MISSING, token);
    });
  });

  test('M again on an explicitly Missing cell removes the status and leaves the grade alone', () => {
    const op = ops().operationFor(ops().parseToken('M'), { wasExplicitMissing: true });
    a.form(op.form, { 'submission[late_policy_status]': 'none' }, 'M toggle-off form');
    a.lacksKey(op.form, 'submission[posted_grade]', 'un-marking Missing must not change the grade');
    a.eq(op.toggledOff, true);
    a.eq(op.patch.missing, false, 'Missing is gone');
    a.eq(op.patch.latePolicyStatus, null, 'the raw status the next toggle reads must not stay stale');
    a.eq(op.display, null, 'the grade text is left exactly as it is');
  });

  test('M on a cell Canvas merely computes as missing still APPLIES the status', () => {
    // Canvas reports missing: true for anything past due and not handed in.
    // Only a status somebody actually applied is a thing M can toggle off.
    const op = ops().operationFor(ops().parseToken('M'), {});
    a.form(op.form, { 'submission[late_policy_status]': 'missing' }, 'first M form');
    a.eq(op.patch.missing, true);
  });

  test('M round trip: apply, remove, apply again leaves the same status each time', () => {
    const applied = ops().operationFor(ops().parseToken('M'), {});
    a.eq(applied.patch.latePolicyStatus, 'missing');
    const removed = ops().operationFor(ops().parseToken('M'), { wasExplicitMissing: true });
    a.eq(removed.patch.latePolicyStatus, null);
    a.eq(removed.patch.missing, false);
    // Missing and Late are independent - removing Missing never applies Late.
    a.eq(removed.patch.late, undefined);
  });

  test('E excuses the submission and never sends a score', () => {
    const op = ops().operationFor(ops().parseToken('E'));
    a.form(op.form, { 'submission[excuse]': 'true' }, 'E form');
    a.lacksKey(op.form, 'submission[posted_grade]', 'excusing must not post a grade');
    a.eq(op.patch.excused, true);
    a.eq(op.display, 'EX');
  });

  test('L sets late status only and leaves the grade untouched', () => {
    const op = ops().operationFor(ops().parseToken('L'));
    a.form(op.form, { 'submission[late_policy_status]': 'late' }, 'L form');
    a.lacksKey(op.form, 'submission[posted_grade]', 'late must not change the grade');
    a.eq(op.patch.late, true);
    a.eq(op.patch.latePolicyStatus, 'late');
    a.eq(op.display, null, 'no display override for a status-only write');
  });

  test('L on a submission already marked Late removes the status instead', () => {
    const op = ops().operationFor(ops().parseToken('L'), { wasLate: true });
    a.form(op.form, { 'submission[late_policy_status]': 'none' }, 'L toggle-off form');
    a.lacksKey(op.form, 'submission[posted_grade]', 'un-marking Late must not change the grade');
    a.eq(op.patch.late, false);
    a.eq(op.toggledOff, true);
    a.eq(op.patch.latePolicyStatus, null, 'the raw status the next toggle reads must not stay stale');
    // ...and the round trip leaves the submission exactly as it started.
    a.eq(ops().operationFor(ops().parseToken('L'), { wasLate: false }).patch.late, true);
  });

  test('grading a Missing (or Late) submission never touches its status', () => {
    // Entering a grade must never flip Missing to Late, or clear either
    // status - only the teacher's own M/L press does that.
    const op = ops().operationFor(ops().parseToken('7'), { wasExplicitMissing: true });
    a.form(op.form, { 'submission[posted_grade]': '7' }, 'graded-while-missing form');
    a.lacksKey(op.form, 'submission[late_policy_status]', 'a grade must not restate or change any status');
    a.eq(op.patch.missing, undefined, 'the patch says nothing about Missing either way');

    // Letter and percent grades take the same route.
    a.lacksKey(ops().operationFor(ops().parseToken('B+'), { wasExplicitMissing: true }).form,
      'submission[late_policy_status]');
    a.lacksKey(ops().operationFor(ops().parseToken('80%'), { wasLate: true }).form,
      'submission[late_policy_status]');
  });

  test('a grade on a submission that was never Missing leaves late policy alone', () => {
    const op = ops().operationFor(ops().parseToken('7'), {});
    a.lacksKey(op.form, 'submission[late_policy_status]',
      'an ordinary grade must not restate a status Canvas already holds');
  });

  test('a plain 0 is an ordinary zero, NOT missing', () => {
    const parsed = ops().parseToken('0');
    a.eq(parsed.kind, ops().KIND.NUMBER);
    const op = ops().operationFor(parsed);
    a.form(op.form, { 'submission[posted_grade]': '0' }, '0 form');
    a.lacksKey(op.form, 'submission[late_policy_status]', 'plain zero must not touch late policy');
    a.eq(op.patch.score, 0);
    a.not(op.patch.missing, 'plain zero must not set missing');
  });

  test('decimals, percents and pass/fail survive parsing', () => {
    a.eq(ops().parseToken('8.5').value, 8.5);
    a.eq(ops().parseToken('92%').kind, ops().KIND.PERCENT);
    a.eq(ops().operationFor(ops().parseToken('92%')).form['submission[posted_grade]'], '92%');
    a.eq(ops().parseToken('pass').value, 'pass');
  });

  test('dash clears the cell and resets status', () => {
    const op = ops().operationFor(ops().parseToken('--'));
    a.form(op.form, {
      'submission[posted_grade]': '',
      'submission[late_policy_status]': 'none'
    }, 'clear form');
    a.eq(op.patch.missing, false);
    a.eq(op.patch.late, false);
  });

  test('on a letter-graded assignment, E is the grade E and not Excused', () => {
    a.eq(ops().parseToken('E', { gradingType: 'letter_grade' }).kind, ops().KIND.LETTER);
    a.eq(ops().parseToken('E', { gradingType: 'letter_grade' }).value, 'E');
    a.eq(ops().parseToken('F', { gradingType: 'gpa_scale' }).kind, ops().KIND.LETTER);
    // ...and on a points assignment it is still the Excused shortcut.
    a.eq(ops().parseToken('E', { gradingType: 'points' }).kind, ops().KIND.EXCUSED);
    // The long forms stay available where the single letter is a real grade.
    a.eq(ops().parseToken('EX', { gradingType: 'letter_grade' }).kind, ops().KIND.EXCUSED);
    a.eq(ops().parseToken('MISSING', { gradingType: 'letter_grade' }).kind, ops().KIND.MISSING);
    // M is not part of any Canvas letter scheme, so it keeps its meaning.
    a.eq(ops().parseToken('M', { gradingType: 'letter_grade' }).kind, ops().KIND.MISSING);
  });

  test('empty is skipped and nonsense is invalid; neither produces a write', () => {
    a.eq(ops().parseToken('   ').kind, ops().KIND.SKIP);
    a.eq(ops().operationFor(ops().parseToken('   ')), null);
    a.eq(ops().parseToken('grade me!!').kind, ops().KIND.INVALID);
    a.eq(ops().operationFor(ops().parseToken('grade me!!')), null);
  });

  test('shortcut keys honour the per-shortcut settings', () => {
    a.eq(ops().shortcutToken('m', { enableM: true }), 'M');
    a.eq(ops().shortcutToken('M', { enableM: false }), null);
    a.eq(ops().shortcutToken('e', { enableE: true }), 'E');
    a.eq(ops().shortcutToken('l', { enableL: false }), null);
    a.eq(ops().shortcutToken('x', {}), null);
  });
});

suite('bulk write deduplication', (test) => {
  const t = (assignmentId, userId, token) => ({
    assignmentId,
    userId,
    parsed: CGP.gradeOps.parseToken(token)
  });

  test('repeated cells collapse to one write and the last value wins', () => {
    const out = CGP.gradeOps.dedupe([
      t('1', '10', '5'),
      t('1', '11', '6'),
      t('1', '10', 'M') // same cell again
    ]);
    a.eq(out.ops.length, 2, 'one write per cell');
    a.eq(out.duplicates, 1);
    const cell = out.ops.find((o) => o.userId === '10');
    a.eq(cell.parsed.kind, CGP.gradeOps.KIND.MISSING, 'last value wins');
  });

  test('targets missing an id are dropped rather than written blindly', () => {
    const out = CGP.gradeOps.dedupe([
      t('1', '10', '5'),
      { assignmentId: null, userId: '11', parsed: CGP.gradeOps.parseToken('5') },
      { assignmentId: '1', userId: null, parsed: CGP.gradeOps.parseToken('5') }
    ]);
    a.eq(out.ops.length, 1);
  });

  test('op keys distinguish value changes on the same cell', () => {
    a.eq(CGP.gradeOps.opKey(t('1', '10', '5')) === CGP.gradeOps.opKey(t('1', '10', '5')), true);
    a.eq(CGP.gradeOps.opKey(t('1', '10', '5')) === CGP.gradeOps.opKey(t('1', '10', '6')), false);
  });
});

suite('settings sanitizing', (test) => {
  test('defaults fill in for anything absent', () => {
    const s = CGP.sanitizeSettings(undefined);
    a.eq(s.enableM, true);
    a.eq(s.assignmentColumnWidth, CGP.DEFAULTS.assignmentColumnWidth);
    a.eq(s.diagnostics, false);
  });

  test('out-of-range numbers are clamped, not trusted', () => {
    a.eq(CGP.sanitizeSettings({ assignmentColumnWidth: 5 }).assignmentColumnWidth, 70);
    a.eq(CGP.sanitizeSettings({ assignmentColumnWidth: 9999 }).assignmentColumnWidth, 260);
    a.eq(CGP.sanitizeSettings({ studentColumnWidth: 'wide' }).studentColumnWidth, CGP.DEFAULTS.studentColumnWidth);
    a.eq(CGP.sanitizeSettings({ bulkConfirmThreshold: 0 }).bulkConfirmThreshold, 1);
  });

  test('snippets are cleaned and incomplete ones dropped', () => {
    const s = CGP.sanitizeSettings({
      snippets: [
        { trigger: '/ev idence!', text: 'Tie it to evidence.' },
        { trigger: 'units', text: '' },
        { trigger: '', text: 'orphan' }
      ]
    });
    a.eq(s.snippets.length, 1);
    a.eq(s.snippets[0].trigger, 'evidence', 'slash and punctuation stripped');
  });

  test('a corrupted snippets value falls back to the real defaults, not an empty library', () => {
    // Every other field falls back to its default when the stored value is
    // unusable; snippets used to be the one exception, silently coercing
    // null/an object/a string to [] and wiping the built-in defaults too.
    a.deep(CGP.sanitizeSettings({ snippets: null }).snippets, CGP.DEFAULTS.snippets);
    a.deep(CGP.sanitizeSettings({ snippets: {} }).snippets, CGP.DEFAULTS.snippets);
    a.deep(CGP.sanitizeSettings({ snippets: 'oops' }).snippets, CGP.DEFAULTS.snippets);
  });

  test('snippets are capped well under chrome.storage.sync’s per-item quota', () => {
    const many = [];
    for (let i = 0; i < 100; i++) many.push({ trigger: 't' + i, text: 'x'.repeat(4000) });
    const s = CGP.sanitizeSettings({ snippets: many });
    a.eq(s.snippets.length <= 15, true, 'snippet count is capped');
    a.eq(s.snippets[0].text.length <= 280, true, 'snippet text length is capped');
  });
});

suite('describing a failed Canvas request', (test) => {
  test('a 401 is always a session expiry, worded so the teacher knows to log back in', () => {
    a.eq(CGP.util.isSessionExpiredError({ status: 401 }), true);
    a.ok(/log back in/i.test(CGP.util.describeApiError({ status: 401 })));
  });

  test('other statuses are not mistaken for a session expiry', () => {
    [403, 429, 500, undefined].forEach((status) => {
      a.eq(CGP.util.isSessionExpiredError({ status }), false, 'status ' + status);
    });
    a.eq(CGP.util.isSessionExpiredError(null), false);
  });

  test('a network failure and a rate limit each get their own specific wording', () => {
    a.ok(/network/i.test(CGP.util.describeApiError({ network: true })));
    a.ok(/slow down|rate limit/i.test(CGP.util.describeApiError({ status: 429 })));
  });

  test('anything else falls back to the caller’s own message, with the status folded in', () => {
    const msg = CGP.util.describeApiError({ status: 422 }, { fallback: 'Could not save this' });
    a.eq(msg, 'Could not save this (Canvas 422).');
    const noStatus = CGP.util.describeApiError({ message: 'boom' }, { fallback: 'Could not save this' });
    a.eq(noStatus, 'Could not save this: boom.');
    a.eq(CGP.util.describeApiError(null), 'Canvas rejected this request.');
  });
});
