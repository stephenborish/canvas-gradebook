/* Canvas Gradebook+ - test entry point.
 *   node tests/run.js
 * Exits non-zero if anything fails, so it can gate a release. */
'use strict';

const harness = require('./harness');

harness.loadCore();

require('./test-grade-ops');
require('./test-clipboard-mapping');
require('./test-comments-totals');
require('./test-post-status');
require('./test-model-staleness');
require('./test-post-reporting');
require('./test-grading-period');
require('./test-model-init-parallel');
require('./test-load-speed');
require('./test-dom-adapter-panes');
require('./test-frozen-total-geometry');
require('./test-hide-test-student');
require('./test-pane-scroll-identity');
require('./test-layout-column-sizing');
require('./test-page-grid-bridge');
require('./test-native-writes');
require('./test-live-sync');
require('./test-scrolled-column-resolution');
require('./test-canvas-cell-classes');
require('./test-course-menu');
require('./test-selection');
require('./test-course-switcher');
require('./test-tray-layout');
require('./test-speedgrader-layout');
require('./test-speedgrader-sidebar');
require('./test-write-safety');
require('./test-comments-ui');
require('./test-grid-reliability');
require('./test-test-student');
require('./test-course-calendar');
require('./test-score-stats');
require('./test-student-insights');
require('./test-studio-class');
require('./test-roster-format');
require('./test-settings-sync');
require('./test-settings-gear-totals');
require('./test-self-update');
require('./test-section-sync');
require('./test-quick-copy');
require('./test-settings-mirror');
require('./test-tour-state');
require('./test-dossier-loading');

// run() awaits each case, so the process must not exit before it settles.
harness.run().then((okAll) => {
  process.exit(okAll ? 0 : 1);
});
