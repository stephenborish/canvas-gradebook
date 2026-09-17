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
   * Missing and Late are independent, instant status flags, each a toggle in
   * exactly the same shape: never touching the grade in either direction, and
   * never touching each other. Entering an ordinary grade (NUMBER / PERCENT /
   * LETTER) never changes either status - a teacher who wants Missing or Late
   * off presses M or L themselves. That is a deliberate choice: Canvas's own
   * behaviour of quietly flipping a manually-applied Missing status to Late
   * the moment a grade showed up was a surprise, not a convenience, so nothing
   * here does that automatically any more.
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
      case KIND.CLEAR:
        return {
          kind: parsed.kind,
          summary: 'Cleared',
          form: { 'submission[posted_grade]': '', 'submission[late_policy_status]': 'none' },
          patch: { score: null, enteredScore: null, grade: null, missing: false, late: false, excused: false, latePolicyStatus: null, workflowState: 'unsubmitted' },
          display: '\u2013'
        };
      case KIND.NUMBER: {
        // No late_policy_status, ever: a grade never touches Missing or Late
        // in either direction. A plain 0 is an ordinary zero, and a Missing or
        // Late submission keeps that status after grading until the teacher
        // presses M or L themselves to remove it.
        var numberForm = { 'submission[posted_grade]': String(parsed.value) };
        var numberPatch = { score: Number(parsed.value), enteredScore: Number(parsed.value), grade: String(parsed.value), excused: false, workflowState: 'graded' };
        return { kind: parsed.kind, summary: String(parsed.value), form: numberForm, patch: numberPatch, display: String(parsed.value) };
      }
      case KIND.PERCENT:
      case KIND.LETTER: {
        var gradeForm = { 'submission[posted_grade]': String(parsed.value) };
        var gradePatch = { grade: String(parsed.value), excused: false, workflowState: 'graded' };
        return { kind: parsed.kind, summary: String(parsed.value), form: gradeForm, patch: gradePatch, display: String(parsed.value) };
      }
      default:
        return null;
    }
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
   * Excused wins over everything: Canvas shows an excused submission as
   * excused even when it also arrived late. Both the raw late_policy_status
   * and Canvas's derived booleans are consulted, because a submission handed
   * in after its due date is late (late: true) with no explicit status at all.
   */
  function cellStatus(rec) {
    if (!rec) return null;
    var explicit = rec.latePolicyStatus || null;
    if (rec.excused) return 'excused';
    if (explicit && explicit !== 'none' && explicit !== 'missing' && explicit !== 'late') return explicit;
    if (rec.missing || explicit === 'missing') return 'missing';
    if (rec.late || explicit === 'late') return 'late';
    return 'none';
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
    cellStatus: cellStatus,
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
