/* Canvas Gradebook+ - test entry point.
 *   node tests/run.js
 * Exits non-zero if anything fails, so it can gate a release. */
'use strict';

const harness = require('./harness');

harness.loadCore();

require('./test-grade-ops');
require('./test-clipboard-mapping');
require('./test-comments-totals');

harness.run();
