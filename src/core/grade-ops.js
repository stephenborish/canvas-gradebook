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
    // Internal only, never produced by parseToken: hands an explicitly
    // applied Missing back to Canvas's own rules once Canvas has committed a
    // grade typed through its own editor (see keyboard.js reconcile).
    LIFT_MISSING: 'lift_missing',
    INVALID: 'invalid'
  };

  var LETTERISH = /^(letter_grade|gpa_scale)$/;

  /**
   * Parse one token (a keystroke, a clipboard cell, a typed value).
   * opts.gradingType - Canvas assignment grading_type; letter schemes keep A-F
   *                    as real letter grades instead of shortcut actions.
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
      if (up === 'M' || up === 'MI' || up === 'MISSING') return { kind: KIND.MISSING, raw: s };
      if (up === 'E' || up === 'EX' || up === 'EXCUSE' || up === 'EXCUSED') return { kind: KIND.EXCUSED, raw: s };
      if (up === 'L' || up === 'LATE') return { kind: KIND.LATE, raw: s };
    }

    if (/^-?\d+(\.\d+)?%$/.test(s)) return { kind: KIND.PERCENT, raw: s, value: s };
    if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: KIND.NUMBER, raw: s, value: Number(s) };
    if (/^(pass|complete|fail|incomplete)$/i.test(s)) return { kind: KIND.LETTER, raw: s, value: s.toLowerCase() };
    if (/^[A-Z][+-]?$/.test(up)) return { kind: KIND.LETTER, raw: s, value: up };

    return { kind: KIND.INVALID, raw: s };
  }

  /**
   * Canvas API form parameters + the optimistic local patch for a parsed token.
   * Returns null for SKIP / INVALID (callers must not write those).
   *
   * Missing and Late are independent, instant status flags, and a grade is
   * only a grade: entering one never adds a status. Canvas's own rules then
   * apply exactly as they do in its own editor (Submission#missing? / late?):
   * its automatic Missing goes away the moment anything is graded, a zero
   * included, while a status somebody applied stays until somebody removes
   * it. The one exception is opt-in (opts.liftMissing): a grade that earns
   * credit over an APPLIED Missing hands the status back to Canvas, which
   * then marks the work Late only if it was really submitted after its due
   * date - never on paper or no-submission work. See liftedStatus.
   *
   * opts.liftMissing - the "a real grade takes Missing off" setting is on.
   * opts.liftMissingTo - force the status a grade write leaves ('none', when
   * a grade was typed and M pressed to say "not missing").
   * opts.latePolicyStatus - the cell's current raw status, carried through
   * unchanged into the optimistic patch when this write does not touch it.
   * opts.wasExcused - CLEAR also has to un-excuse explicitly.
   *
   * Every patch that changes a status also carries latePolicyStatus, not just
   * the derived missing/late booleans: that raw field is what decides the next
   * write's meaning (the M/L toggles read it), so leaving it stale would make
   * an optimistic record contradict itself.
   *
   * opts.wasLate - true when the cell already carries an explicit Late status.
   * opts.wasExplicitMissing - true when the cell already carries an explicit
   * Missing status. Both shortcuts are toggles built on this: pressing one on
   * a cell that already carries that exact status removes it; pressing it on
   * a cell that does not adds it. Canvas also reports missing/late as
   * COMPUTED booleans for anything simply past due, whether or not anyone
   * applied a status - keying the toggle off wasExplicitMissing/wasLate
   * instead of those computed flags is what makes the FIRST press on such a
   * cell always APPLY the status rather than mistake it for a second press.
   *
   * EXCUSED is an explicit status command and is left alone.
   */
  /* Does this grade mean the work came in? A zero (or fail / incomplete) is
   * how a teacher records the missing work itself, so it never lifts an
   * applied Missing; anything that earns credit can. */
  function gradeEarnsCredit(parsed) {
    if (!parsed) return false;
    if (parsed.kind === KIND.NUMBER) return Number(parsed.value) > 0;
    if (parsed.kind === KIND.PERCENT) return parseFloat(String(parsed.value)) > 0;
    if (parsed.kind === KIND.LETTER) return !/^(fail|incomplete)$/i.test(String(parsed.value));
    return false;
  }

  /* What a grade write does to the status:
   *   undefined - leaves it alone (the default, and what Canvas's editor does)
   *   null      - hands an applied Missing back to Canvas's automatic rules
   *   'none'    - pins "no status" (opts.liftMissingTo)
   * Only an APPLIED Missing is ever lifted: Canvas's computed one already
   * goes away by itself once the cell is graded. */
  function liftedStatus(parsed, opts) {
    if (opts.liftMissingTo) return opts.liftMissingTo;
    if (opts.liftMissing && opts.wasExplicitMissing && gradeEarnsCredit(parsed)) return null;
    return undefined;
  }

  /* Optimistic status fields for a grade write. */
  function gradeStatusPatch(patch, opts, lifted) {
    if (lifted === undefined) {
      var kept = opts.latePolicyStatus !== undefined ? (opts.latePolicyStatus || null)
        : (opts.wasExplicitMissing ? 'missing' : (opts.wasLate ? 'late' : null));
      patch.latePolicyStatus = kept;
      // An applied Missing survives grading; Canvas's own does not.
      patch.missing = kept === 'missing';
      return patch;
    }
    patch.latePolicyStatus = lifted;
    patch.missing = false;
    // Handed back (null), Canvas decides Late from the submission itself.
    if (lifted === 'none') patch.late = false;
    return patch;
  }

  function operationFor(parsed, opts) {
    if (!parsed) return null;
    opts = opts || {};
    switch (parsed.kind) {
      case KIND.MISSING:
        if (opts.wasExplicitMissing) {
          return {
            kind: parsed.kind,
            toggledOff: true,
            summary: 'Missing removed',
            form: { 'submission[late_policy_status]': 'none' },
            patch: { missing: false, latePolicyStatus: null },
            display: null // status only; the grade is never touched
          };
        }
        return {
          kind: parsed.kind,
          summary: 'Missing',
          form: { 'submission[late_policy_status]': 'missing' },
          patch: { missing: true, latePolicyStatus: 'missing' },
          display: null // status only; the grade is never touched
        };
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
      case KIND.LIFT_MISSING:
        // Canvas has saved a grade typed over an applied Missing: the status
        // goes back to Canvas, which marks Late only for work that was
        // actually submitted after its due date.
        return {
          kind: parsed.kind,
          summary: 'Missing removed after grading',
          form: { 'submission[late_policy_status]': null },
          patch: { missing: false, latePolicyStatus: null },
          display: null
        };
      case KIND.CLEAR: {
        var clearForm = { 'submission[posted_grade]': '', 'submission[late_policy_status]': 'none' };
        // An empty posted_grade does not un-excuse a submission: Canvas keeps
        // it excused unless told otherwise, while the cell would read as
        // cleared here until the next reload.
        if (opts.wasExcused) clearForm['submission[excuse]'] = 'false';
        return {
          kind: parsed.kind,
          summary: 'Cleared',
          form: clearForm,
          patch: { score: null, enteredScore: null, grade: null, missing: false, late: false, excused: false, latePolicyStatus: null, workflowState: 'unsubmitted' },
          display: '\u2013'
        };
      }
      case KIND.NUMBER: {
        var numberForm = { 'submission[posted_grade]': String(parsed.value) };
        // late_policy_status is left out unless an applied Missing is being
        // lifted (see liftedStatus): restating it would pin the submission
        // to that status and switch off the course's automatic late/missing
        // policy for it.
        var numberLift = liftedStatus(parsed, opts);
        if (numberLift !== undefined) numberForm['submission[late_policy_status]'] = numberLift;
        var numberPatch = gradeStatusPatch({
          score: Number(parsed.value),
          enteredScore: Number(parsed.value),
          grade: String(parsed.value),
          excused: false,
          workflowState: 'graded'
        }, opts, numberLift);
        return { kind: parsed.kind, summary: String(parsed.value), form: numberForm, patch: numberPatch, display: String(parsed.value) };
      }
      case KIND.PERCENT:
      case KIND.LETTER: {
        var gradeForm = { 'submission[posted_grade]': String(parsed.value) };
        var gradeLift = liftedStatus(parsed, opts);
        if (gradeLift !== undefined) gradeForm['submission[late_policy_status]'] = gradeLift;
        var gradePatch = gradeStatusPatch({
          grade: String(parsed.value),
          excused: false,
          workflowState: 'graded'
        }, opts, gradeLift);
        return { kind: parsed.kind, summary: String(parsed.value), form: gradeForm, patch: gradePatch, display: String(parsed.value) };
      }
      default:
        return null;
    }
  }

  /* Did this record earn any credit? A zero is not credit; neither is an
   * incomplete. A complete/pass counts even on a zero-point column, where
   * its score is 0. */
  function earnedCredit(rec) {
    var g = rec.grade;
    if (g !== null && g !== undefined && /^\s*(complete|pass)\s*$/i.test(String(g))) return true;
    var scores = [rec.score, rec.enteredScore].filter(function (v) { return v !== null && v !== undefined && v !== ''; });
    if (scores.length) return scores.some(function (v) { return Number(v) > 0; });
    if (g === null || g === undefined || g === '' || g === '-') return false;
    var n = parseFloat(String(g));
    return isNaN(n) ? true : n > 0;
  }

  /* The one status a grade cell is currently in, as this extension understands
   * it, derived from the record the model holds right now - including a record
   * an optimistic write has only just patched.
   *
   * This is what lets M and L show their designation the instant they are
   * pressed. Canvas paints late/missing/excused colours from its OWN in-page
   * store, which our API write never touches, so without a status of our own
   * the cell keeps whatever colour Canvas last rendered until the page is
   * reloaded - the reported "M and L do nothing until I refresh".
   *
   * Returns:
   *   'excused' | 'missing' | 'late'  - a status we manage and paint
   *   'none'                          - we know there is no status
   *   'extended' or any other string  - a status Canvas knows and we do not;
   *                                     callers leave those cells alone
   *   null                            - nothing is known about this cell yet
   *
   * It mirrors Canvas's own Submission#missing? / late?, never second-guesses
   * them: the Grade Detail Tray, SpeedGrader and the student's grades page
   * all show what Canvas computes, so a cell that decided differently (as
   * this once did from the grade) would be the one place telling the teacher
   * something else. Canvas already knows the submission type - its automatic
   * Missing never applies to on-paper or no-submission work, and its
   * automatic Late only to work actually submitted after the due date.
   *
   * Excused wins over everything, then a custom grade status (Canvas reports
   * neither missing nor late under one), then the raw late_policy_status
   * somebody applied, then Canvas's derived booleans - because a submission
   * handed in after its due date is late (late: true) with no explicit
   * status at all.
   */
  function cellStatus(rec) {
    if (!rec) return null;
    var explicit = rec.latePolicyStatus || null;
    if (rec.excused) return 'excused';
    if (rec.customStatusId) return 'custom';
    if (explicit) return explicit;
    if (rec.missing) return 'missing';
    if (rec.late) return 'late';
    return 'none';
  }

  /* Did the student hand in new work after it was graded? Canvas's own
   * Submission#resubmitted?: it needs grading (a real student submission -
   * submission_type set - that is submitted, graded or pending review) AND
   * grade_matches_current_submission is false, which Canvas only sets when a
   * student submits over an existing score. On-paper and no-submission work
   * has no student submission, so it can never read as resubmitted. */
  function resubmitted(rec) {
    if (!rec || rec.excused || !rec.submissionType || rec.gradeMatchesCurrent !== false) return false;
    return ['submitted', 'graded', 'pending_review'].indexOf(String(rec.workflowState || '')) >= 0;
  }

  /* Does this assignment's grading type accept this parsed token?
   *
   * parseToken deliberately understands every shape a teacher might type;
   * whether Canvas will take it depends on the column. A letter on a points
   * or percent column is converted (or refused) through whatever grading
   * scheme Canvas happens to find, and pass/complete words only mean
   * something on a complete/incomplete column - so both are refused up front,
   * before anything is written, rather than left to come back as a partly
   * applied paste. Statuses, clears and numbers fit every gradable column. */
  function acceptsToken(parsed, gradingType) {
    if (!parsed) return false;
    var type = String(gradingType || 'points');
    if (type === 'not_graded') return false;
    if (parsed.kind !== KIND.LETTER) return true;
    var word = /^(pass|complete|fail|incomplete)$/i.test(String(parsed.value || ''));
    if (type === 'pass_fail') return word;
    if (LETTERISH.test(type)) return !word;
    return false;
  }

  function describe(kind) {
    switch (kind) {
      case KIND.MISSING: return 'Missing';
      case KIND.EXCUSED: return 'Excused';
      case KIND.LATE: return 'Late';
      case KIND.CLEAR: return 'cleared';
      case KIND.LIFT_MISSING: return 'Missing removed';
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
    earnedCredit: earnedCredit,
    cellStatus: cellStatus,
    resubmitted: resubmitted,
    acceptsToken: acceptsToken,
    /* The statuses this extension is willing to paint and to correct on a
     * cell. Anything else Canvas renders (dropped, extended, resubmitted) is
     * Canvas's business and is never touched. */
    PAINTED_STATUSES: ['missing', 'late', 'excused'],
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
