/* Canvas Gradebook+ - the ordered content-script list.
 * Kept in one place so the static manifest entry and the dynamic registration
 * used for self-hosted Canvas domains cannot drift apart.
 * If you edit this list, mirror it in manifest.json. */

export const CONTENT_JS = [
  'src/core/util.js',
  'src/core/canvas-api.js',
  'src/core/grade-ops.js',
  'src/core/post-ops.js',
  'src/core/clipboard-matrix.js',
  'src/core/comment-analysis.js',
  'src/core/grid-map.js',
  'src/core/totals.js',
  'src/core/score-stats.js',
  'src/core/roster-format.js',
  'src/core/snippets.js',
  'src/core/time-shortcuts.js',
  'src/core/ui.js',
  'src/core/model.js',
  'src/gradebook/dom-adapter.js',
  'src/gradebook/cell-registry.js',
  'src/gradebook/indicators.js',
  'src/gradebook/canvas-store.js',
  'src/gradebook/live-sync.js',
  'src/gradebook/writer.js',
  'src/gradebook/selection.js',
  'src/gradebook/cell-actions.js',
  'src/gradebook/test-student-guard.js',
  'src/gradebook/keyboard.js',
  'src/gradebook/bulk-paste.js',
  'src/gradebook/frozen-total.js',
  'src/gradebook/layout.js',
  'src/gradebook/post-grades.js',
  'src/gradebook/score-analysis.js',
  'src/gradebook/roster-export.js',
  'src/gradebook/comment-popover.js',
  'src/gradebook/bulk-comment.js',
  'src/gradebook/course-switcher.js',
  'src/gradebook/student-search.js',
  'src/gradebook/course-menu.js',
  'src/assignments/time-shortcuts.js',
  'src/speedgrader/content.js',
  'src/gradebook/content.js'
];

export const CONTENT_CSS = [
  'src/styles/gradebook.css',
  'src/styles/speedgrader.css'
];
