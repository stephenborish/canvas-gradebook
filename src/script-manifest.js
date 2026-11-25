/* Canvas Gradebook+ - the ordered content-script lists.
 * Kept in one place so the static manifest entries and the dynamic
 * registration used for self-hosted Canvas domains cannot drift apart.
 * If you edit these lists, mirror them in manifest.json (a test checks).
 *
 * The page itself (the top frame) gets three groups, injected in this order:
 *   COMMON_JS  - every course page: settings, the Canvas client, Switch
 *                course / Find student, Copy to other classes, Make groups,
 *                the class schedule, Hidden Gems, the tour's record.
 *   GRADING_JS - the gradebook and SpeedGrader only (their URLs start
 *                /courses/<id>/gradebook): the grid, grading, the student
 *                overview, SpeedGrader's layouts. Most of the code, so
 *                other course pages (modules, pages, discussions) no longer
 *                load and compile it.
 *   BOOT_JS    - every course page, last: decides what to start.
 * A COMMON_JS file never relies on a GRADING_JS one (a test checks), and
 * the boot waits briefly should the grading scripts arrive after it. */

export const COMMON_JS = [
  'src/core/util.js',
  'src/core/canvas-api.js',
  'src/core/settings-mirror.js',
  'src/core/course-calendar.js',
  'src/core/section-sync.js',
  'src/core/group-builder.js',
  'src/core/hidden-gems.js',
  'src/core/hidden-gems-ui.js',
  'src/core/ui.js',
  'src/gradebook/course-switcher.js',
  'src/gradebook/student-search.js',
  'src/studio/canvas-relay.js',
  'src/assignments/course-schedule.js',
  'src/sections/sync-runner.js',
  'src/sections/sync-dialog.js',
  'src/sections/sync-board.js',
  'src/sections/inline-copy.js',
  'src/sections/link-copy.js',
  'src/groups/group-builder.js',
  'src/tour/tour-state.js'
];

export const GRADING_JS = [
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
  'src/gradebook/course-menu.js',
  'src/gradebook/tray-layout.js',
  'src/speedgrader/comment-layout.js',
  'src/speedgrader/sidebar-layout.js',
  'src/speedgrader/content.js'
];

export const BOOT_JS = [
  'src/gradebook/content.js'
];

/* The course page itself gets the groups above (and CONTENT_CSS, plus
 * GRADING_CSS on grading pages); every frame inside
 * it gets only this (see frame-gate.js), which adds what a comment editor's
 * frame needs on demand. Mirrored in manifest.json too. */
export const FRAME_JS = [
  'src/frame-gate.js'
];

export const CONTENT_CSS = [
  'src/styles/gradebook.css',
  'src/styles/hidden-gems.css'
];

// SpeedGrader's styles (all scoped to html.cgp-speedgrader), grading pages only.
export const GRADING_CSS = [
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
