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
require('./test-dom-adapter-panes');
require('./test-frozen-total-geometry');
require('./test-hide-test-student');
require('./test-pane-scroll-identity');
require('./test-layout-column-sizing');
require('./test-page-grid-bridge');
require('./test-scrolled-column-resolution');

// run() awaits each case, so the process must not exit before it settles.
harness.run().then((okAll) => {
  process.exit(okAll ? 0 : 1);
});
