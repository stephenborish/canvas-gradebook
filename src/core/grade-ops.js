/* Canvas Gradebook+ - pure grade semantics.
 *
 * Single source of truth for what M / E / L / 0 / blank mean, and for the exact
 * Canvas Submissions API parameters each one produces. No DOM, no network: this
 * file is unit tested directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.gradeOps) return;

  var KIND = {
    SKIP: 'skip',
    CLEAR: 'clear',
    NUMBER: 'number',
    PERCENT: 'percent',
    LETTER: 'letter',
    MISSING: 'missing',
    EXCUSED: 'excused',
    LATE: 'late',
    INVALID: 'invalid'
  };

  var LETTERISH = /^(letter_grade|gpa_scale)$/;

  /**
   * Parse one token (a keystroke, a clipboard cell, a typed value).
   * opts.gradingType - Canvas assignment grading_type; letter schemes keep A-F
   *                    as real letter grades instead of shortcut actions.
   * opts.missingScore - score written alongside Missing status (default 0).
   */
  function parseToken(raw, opts) {
    opts = opts || {};
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (s === '') return { kind: KIND.SKIP, raw: s };

    var up = s.toUpperCase();
    var letterish = LETTERISH.test(String(opts.gradingType || ''));

    if (up === '-' || up === '--' || up === 'CLEAR') return { kind: KIND.CLEAR, raw: s };

    // On letter-graded assignments a bare A-F is a grade, not a shortcut.
    var isLetterGradeToken = letterish && /^[A-F][+-]?$/.test(up);

    if (!isLetterGradeToken) {
      if (up === 'M' || up === 'MI' || up === 'MISSING') {
        var ms = opts.missingScore;
        return { kind: KIND.MISSING, raw: s, score: (ms === undefined || ms === null) ? 0 : Number(ms) };
      }
      if (up === 'E' || up === 'EX' || up === 'EXCUSE' || up === 'EXCUSED') return { kind: KIND.EXCUSED, raw: s };
      if (up === 'L' || up === 'LATE') return { kind: KIND.LATE, raw: s };
    }

    if (/^-?\d+(\.\d+)?%$/.test(s)) return { kind: KIND.PERCENT, raw: s, value: s };
    if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: KIND.NUMBER, raw: s, value: Number(s) };
    if (/^(pass|complete|fail|incomplete)$/i.test(s)) return { kind: KIND.LETTER, raw: s, value: s.toLowerCase() };
    if (/^[A-Z][+-]?$/.test(up)) return { kind: KIND.LETTER, raw: s, value: up };

    return { kind: KIND.INVALID, raw: s };
  }

  /* A real grade has just landed on a submission Canvas still flags Missing.
   * Missing always ends here; whether the submission is then flagged Late or
   * left with no status at all is opts.missingBecomesLate (default true). */
  function applyMissingResolution(form, patch, opts) {
    var toLate = opts.missingBecomesLate !== false;
    form['submission[late_policy_status]'] = toLate ? 'late' : 'none';
    patch.missing = false;
    patch.late = toLate;
    patch.latePolicyStatus = toLate ? 'late' : null;
  }

  /**
   * Canvas API form parameters + the optimistic local patch for a parsed token.
   * Returns null for SKIP / INVALID (callers must not write those).
   *
   * opts.wasMissing - true when the cell being written to is currently marked
   * Missing (an explicit late_policy_status, not merely a computed one). A
   * teacher who types a real grade means it, and Canvas does not clear a
   * manually-applied Missing status just because a grade showed up afterward -
   * it keeps showing the red "Missing" pill until something explicitly clears
   * it. So an ordinary grade write (NUMBER/PERCENT/LETTER) also resolves the
   * status here, once, instead of leaving it for the teacher to hunt down.
   *
   * What it resolves TO is the point: work that was Missing and has now been
   * graded was, by definition, handed in after it was due, so the honest
   * status is Late, not "no status at all". opts.missingBecomesLate (default
   * true) is what turns that on; set it false and the status is merely
   * cleared, which is what Canvas itself would leave behind.
   *
   * Every patch that changes a status also carries latePolicyStatus, not just
   * the derived missing/late booleans: that raw field is what decides the next
   * write's meaning (the L toggle reads it), so leaving it stale would make an
   * optimistic record contradict itself.
   *
   * opts.wasLate - true when the cell already carries an explicit Late status.
   * The L shortcut is a toggle, so on such a cell it REMOVES the status
   * instead of re-applying it; typing L twice leaves the submission exactly as
   * it started.
   *
   * opts.wasExplicitMissing - true when the cell already carries an explicit
   * Missing status. M is a toggle too: the second press turns Missing into
   * Late and takes the 0 back out, so the teacher can type a real grade.
   *
   * opts.currentScore - the score already on that cell, which decides whether
   * the M toggle may clear it. Only the score M itself writes (the
   * missingScore, 0 by default) is M's to remove; a real grade a teacher
   * entered on a submission Canvas had flagged Missing survives the toggle.
   *
   * EXCUSED is an explicit status command and is left alone.
   */
  function operationFor(parsed, opts) {
    if (!parsed) return null;
    opts = opts || {};
    switch (parsed.kind) {
      case KIND.MISSING: {
        // Second press on a cell that already carries an explicit Missing
        // status: M is a toggle, exactly like L. Missing gives way to Late -
        // the work is no longer being called "never handed in", it is being
        // called "handed in after the due date" - and the 0 that M itself
        // wrote is taken back out, leaving the cell empty and ready for
        // whatever grade the teacher wants to type into it.
        //
        // opts.wasExplicitMissing, not opts.wasMissing, is what decides this.
        // Canvas reports missing: true for anything simply past due and not
        // handed in, so keying off that would make the FIRST M on an overdue
        // cell behave like the second and toggle a status that was never
        // applied.
        if (opts.wasExplicitMissing) {
          // ...but only the score M itself puts there is M's to take away.
          // A submission can arrive from Canvas already flagged Missing AND
          // carrying a real grade - a teacher marked it Missing in the Grade
          // Detail Tray and graded it afterwards, which Canvas allows and
          // leaves standing. Deleting that grade would be destroying work
          // nobody asked to undo, so a non-zero score survives the toggle and
          // only the status changes. What M writes is the missingScore (0 by
          // default), so that is what a toggle is willing to clear.
          var held = opts.currentScore;
          var clearable = held === null || held === undefined || held === '' ||
            Number(held) === Number(parsed.score === undefined || parsed.score === null ? 0 : parsed.score);
          if (!clearable) {
            return {
              kind: parsed.kind,
              toggledOff: true,
              keptGrade: true,
              summary: 'Missing \u2192 Late (grade kept)',
              form: { 'submission[late_policy_status]': 'late' },
              patch: { missing: false, late: true, latePolicyStatus: 'late' },
              display: null // status only; the grade stays exactly as it is
            };
          }
          return {
            kind: parsed.kind,
            toggledOff: true,
            summary: 'Missing \u2192 Late',
            form: {
              'submission[posted_grade]': '',
              'submission[late_policy_status]': 'late'
            },
            patch: {
              score: null, enteredScore: null, grade: null,
              missing: false, late: true, excused: false,
              latePolicyStatus: 'late', workflowState: 'unsubmitted'
            },
            display: '\u2013'
          };
        }
        var score = (parsed.score === undefined || parsed.score === null) ? 0 : Number(parsed.score);
        return {
          kind: parsed.kind,
          summary: score + ' + Missing',
          form: {
            'submission[posted_grade]': String(score),
            'submission[late_policy_status]': 'missing'
          },
          patch: {
            score: score, enteredScore: score, grade: String(score),
            missing: true, late: false, excused: false, workflowState: 'graded',
            latePolicyStatus: 'missing'
          },
          display: String(score)
        };
      }
      case KIND.EXCUSED:
        return {
          kind: parsed.kind,
          summary: 'Excused',
          form: { 'submission[excuse]': 'true' },
          patch: { excused: true, missing: false, late: false, score: null, grade: 'EX', workflowState: 'graded' },
          display: 'EX'
        };
      case KIND.LATE:
        if (opts.wasLate) {
          return {
            kind: parsed.kind,
            toggledOff: true,
            summary: 'Late removed',
            form: { 'submission[late_policy_status]': 'none' },
            patch: { late: false, latePolicyStatus: null },
            display: null // status only; the grade text is unchanged
          };
        }
        return {
          kind: parsed.kind,
          summary: 'Late',
          form: { 'submission[late_policy_status]': 'late' },
          patch: { late: true, missing: false, latePolicyStatus: 'late' },
          display: null // status only; the grade text is unchanged
        };
      case KIND.CLEAR:
        return {
          kind: parsed.kind,
          summary: 'Cleared',
          form: { 'submission[posted_grade]': '', 'submission[late_policy_status]': 'none' },
          patch: { score: null, enteredScore: null, grade: null, missing: false, late: false, excused: false, latePolicyStatus: null, workflowState: 'unsubmitted' },
          display: '\u2013'
        };
      case KIND.NUMBER: {
        // Deliberately no late_policy_status by default: a plain 0 is an
        // ordinary zero, and an already-Late submission should stay Late
        // after grading. Missing is the one status a real grade always ends.
        var numberForm = { 'submission[posted_grade]': String(parsed.value) };
        var numberPatch = { score: Number(parsed.value), enteredScore: Number(parsed.value), grade: String(parsed.value), excused: false, workflowState: 'graded' };
        if (opts.wasMissing) applyMissingResolution(numberForm, numberPatch, opts);
        return { kind: parsed.kind, summary: String(parsed.value), form: numberForm, patch: numberPatch, display: String(parsed.value) };
      }
      case KIND.PERCENT:
      case KIND.LETTER: {
        var gradeForm = { 'submission[posted_grade]': String(parsed.value) };
        var gradePatch = { grade: String(parsed.value), excused: false, workflowState: 'graded' };
        if (opts.wasMissing) applyMissingResolution(gradeForm, gradePatch, opts);
        return { kind: parsed.kind, summary: String(parsed.value), form: gradeForm, patch: gradePatch, display: String(parsed.value) };
      }
      default:
        return null;
    }
  }

  function describe(kind) {
    switch (kind) {
      case KIND.MISSING: return 'Missing';
      case KIND.EXCUSED: return 'Excused';
      case KIND.LATE: return 'Late';
      case KIND.CLEAR: return 'cleared';
      default: return 'grade';
    }
  }

  /** Stable identity of one write, used to suppress duplicate submissions. */
  function opKey(target) {
    var p = target.parsed || {};
    var v = p.value === undefined ? (p.score === undefined ? '' : p.score) : p.value;
    return String(target.assignmentId) + ':' + String(target.userId) + ':' + p.kind + ':' + String(v);
  }

  /** Collapse repeated targets for the same cell; last one wins. */
  function dedupe(targets) {
    var map = new Map();
    var duplicates = 0;
    (targets || []).forEach(function (t) {
      if (!t || !t.assignmentId || !t.userId) return;
      var k = String(t.assignmentId) + ':' + String(t.userId);
      if (map.has(k)) duplicates++;
      map.set(k, t);
    });
    return { ops: Array.from(map.values()), duplicates: duplicates };
  }

  CGP.gradeOps = {
    KIND: KIND,
    parseToken: parseToken,
    operationFor: operationFor,
    describe: describe,
    opKey: opKey,
    dedupe: dedupe,
    /** Keyboard shortcut letter -> token, honouring the per-shortcut settings. */
    shortcutToken: function (key, settings) {
      var s = settings || {};
      var k = String(key || '').toLowerCase();
      if (k === 'm' && s.enableM !== false) return 'M';
      if (k === 'e' && s.enableE !== false) return 'E';
      if (k === 'l' && s.enableL !== false) return 'L';
      return null;
    }
  };
})();
