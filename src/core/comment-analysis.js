/* Canvas Gradebook+ - pure comment analysis.
 *
 * The gradebook indicator must mean "I left feedback here", never "this
 * submission has comments". Every decision is made by comparing each comment's
 * author id against the currently logged in instructor's id. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.commentAnalysis) return;

  function authorId(c) {
    if (!c) return null;
    if (c.author_id !== undefined && c.author_id !== null) return String(c.author_id);
    if (c.author && c.author.id !== undefined && c.author.id !== null) return String(c.author.id);
    return null;
  }

  function normName(v) {
    return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function commentAuthorName(c) {
    if (!c) return '';
    return c.author_name || (c.author && (c.author.display_name || c.author.name)) || '';
  }

  function stamp(c) {
    var t = Date.parse((c && (c.created_at || c.edited_at)) || '');
    return isFinite(t) ? t : 0;
  }

  /**
   * analyze(comments, {instructorId, studentId})
   *   instructorCount        - comments authored by the logged in instructor
   *   hasInstructorComment   - drives the cell indicator
   *   studentRepliedAfter    - student replied after the instructor's last word
   */
  function analyze(comments, opts) {
    opts = opts || {};
    var instructorId = opts.instructorId === undefined || opts.instructorId === null ? null : String(opts.instructorId);
    var studentId = opts.studentId === undefined || opts.studentId === null ? null : String(opts.studentId);
    var instructorNames = new Set((opts.instructorNames || []).map(normName).filter(Boolean));

    var list = Array.isArray(comments) ? comments.filter(function (c) { return c && c.draft !== true; }) : [];
    var instructorCount = 0;
    var lastInstructorAt = null;
    var lastStudentAt = null;
    var otherCount = 0;

    list.forEach(function (c) {
      var a = authorId(c);
      var t = stamp(c);
      var byId = instructorId !== null && a === instructorId;
      var byName = instructorNames.size > 0 && instructorNames.has(normName(commentAuthorName(c)));
      if (byId || byName) {
        instructorCount++;
        if (lastInstructorAt === null || t > lastInstructorAt) lastInstructorAt = t;
      } else {
        otherCount++;
        if (studentId !== null && a === studentId) {
          if (lastStudentAt === null || t > lastStudentAt) lastStudentAt = t;
        }
      }
    });

    return {
      total: list.length,
      instructorCount: instructorCount,
      otherCount: otherCount,
      hasInstructorComment: instructorCount > 0,
      lastInstructorAt: lastInstructorAt,
      lastStudentAt: lastStudentAt,
      studentRepliedAfter: !!(instructorCount > 0 && lastStudentAt !== null &&
        lastInstructorAt !== null && lastStudentAt > lastInstructorAt)
    };
  }

  function tooltip(a) {
    if (!a || !a.instructorCount) return '';
    var base = a.instructorCount === 1 ? 'You left feedback' : a.instructorCount + ' instructor comments';
    if (a.studentRepliedAfter) base += ' \u00b7 student replied since';
    return base;
  }

  /** Fold a newly saved comment into a cached comment list + analysis. */
  function applyNewComment(cached, comment, opts) {
    var list = Array.isArray(cached) ? cached.slice() : [];
    if (comment) {
      var id = comment.id === undefined ? null : String(comment.id);
      var exists = id !== null && list.some(function (c) { return String(c && c.id) === id; });
      if (!exists) list.push(comment);
    }
    return { comments: list, analysis: analyze(list, opts) };
  }

  CGP.commentAnalysis = {
    authorId: authorId,
    commentAuthorName: commentAuthorName,
    analyze: analyze,
    tooltip: tooltip,
    applyNewComment: applyNewComment
  };
})();
