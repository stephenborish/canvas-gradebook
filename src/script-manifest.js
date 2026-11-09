/* Canvas Gradebook+ - the ordered content-script list.
 * Kept in one place so the static manifest entry and the dynamic registration
 * used for self-hosted Canvas domains cannot drift apart.
 * If you edit this list, mirror it in manifest.json. */

export const CONTENT_JS = [
  'src/core/util.js',
  'src/core/canvas-api.js',
  'src/core/settings-mirror.js',
  'src/core/grade-ops.js',
  'src/core/post-ops.js',
  'src/core/clipboard-matrix.js',
  'src/core/comment-analysis.js',
  'src/core/grid-map.js',
  'src/core/totals.js',
  'src/core/score-stats.js',
  'src/core/student-insights.js',
  'src/core/studio-class.js',
  'src/core/roster-format.js',
  'src/core/snippets.js',
  'src/core/course-calendar.js',
  'src/core/section-sync.js',
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
  'src/gradebook/student-insights.js',
  'src/gradebook/studio-bridge.js',
  'src/gradebook/roster-export.js',
  'src/gradebook/comment-popover.js',
  'src/gradebook/bulk-comment.js',
  'src/gradebook/course-switcher.js',
  'src/gradebook/student-search.js',
  'src/gradebook/course-menu.js',
  'src/gradebook/tray-layout.js',
  'src/studio/canvas-relay.js',
  'src/assignments/course-schedule.js',
  'src/sections/sync-runner.js',
  'src/sections/sync-dialog.js',
  'src/sections/sync-board.js',
  'src/sections/inline-copy.js',
  'src/speedgrader/comment-layout.js',
  'src/speedgrader/sidebar-layout.js',
  'src/speedgrader/content.js',
  'src/tour/tour-state.js',
  'src/tour/tour-content.js',
  'src/tour/tour.js',
  'src/gradebook/content.js'
];

export const CONTENT_CSS = [
  'src/styles/gradebook.css',
  'src/styles/speedgrader.css'
];

/* Which granted host permissions are self-hosted Canvas domains. The
 * options page grants those as "*://host/*" (Course & Domains), and a
 * class-schedule calendar's site as "https://host/*" (calendar-sync.js), so
 * the pattern's scheme tells them apart; instructure.com is covered by the
 * manifest, and "*://*\/*" is the optional all-sites entry, not a domain.
 * src/options/options.js listDomains() applies the same rule (it cannot
 * import this module). */
export function isCustomCanvasOrigin(origin) {
  const o = String(origin || '');
  return o.startsWith('*://') && !o.includes('instructure.com') && o !== '*://*/*';
}
