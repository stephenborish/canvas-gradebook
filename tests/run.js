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

// run() awaits each case, so the process must not exit before it settles.
harness.run().then((okAll) => {
  if (!okAll) process.exitCode = 1;
});
