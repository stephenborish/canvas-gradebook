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

  /**
   * Canvas API form parameters + the optimistic local patch for a parsed token.
   * Returns null for SKIP / INVALID (callers must not write those).
   *
   * opts.wasMissing - true when the cell being written to is currently marked
   * Missing (an explicit late_policy_status, not merely a computed one). A
   * teacher who types a real grade means it, and Canvas does not clear a
   * manually-applied Missing status just because a grade showed up afterward -
   * it keeps showing the red "Missing" pill until something explicitly clears
   * it. So an ordinary grade write (NUMBER/PERCENT/LETTER) also clears the
   * status here, once, instead of leaving it for the teacher to hunt down.
   * MISSING/EXCUSED/LATE are explicit status commands and are left alone.
   */
  function operationFor(parsed, opts) {
    if (!parsed) return null;
    opts = opts || {};
    switch (parsed.kind) {
      case KIND.MISSING: {
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
            missing: true, late: false, excused: false, workflowState: 'graded'
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
        return {
          kind: parsed.kind,
          summary: 'Late',
          form: { 'submission[late_policy_status]': 'late' },
          patch: { late: true, missing: false },
          display: null // status only; the grade text is unchanged
        };
      case KIND.CLEAR:
        return {
          kind: parsed.kind,
          summary: 'Cleared',
          form: { 'submission[posted_grade]': '', 'submission[late_policy_status]': 'none' },
          patch: { score: null, enteredScore: null, grade: null, missing: false, late: false, excused: false, workflowState: 'unsubmitted' },
          display: '\u2013'
        };
      case KIND.NUMBER: {
        // Deliberately no late_policy_status by default: a plain 0 is an
        // ordinary zero, and an already-Late submission should stay Late
        // after grading. Missing is the one status a real grade always ends.
        var numberForm = { 'submission[posted_grade]': String(parsed.value) };
        var numberPatch = { score: Number(parsed.value), enteredScore: Number(parsed.value), grade: String(parsed.value), excused: false, workflowState: 'graded' };
        if (opts.wasMissing) { numberForm['submission[late_policy_status]'] = 'none'; numberPatch.missing = false; }
        return { kind: parsed.kind, summary: String(parsed.value), form: numberForm, patch: numberPatch, display: String(parsed.value) };
      }
      case KIND.PERCENT:
      case KIND.LETTER: {
        var gradeForm = { 'submission[posted_grade]': String(parsed.value) };
        var gradePatch = { grade: String(parsed.value), excused: false, workflowState: 'graded' };
        if (opts.wasMissing) { gradeForm['submission[late_policy_status]'] = 'none'; gradePatch.missing = false; }
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
