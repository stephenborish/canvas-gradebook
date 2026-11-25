/* Loads the DOM-dependent gradebook/*.js controllers (never exercised by
 * plain `harness.loadCore()`, which deliberately never touches `document` -
 * see its own header comment) against the fake DOM in domshim.js, so the
 * frozen-Total / Test-Student-row bugs can be reproduced and asserted on
 * without a real browser. Call once per process, after harness.loadCore(). */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const domshim = require('./domshim');

const ROOT = path.resolve(__dirname, '..');

const GRADEBOOK_FILES = [
  'src/gradebook/dom-adapter.js',
  'src/gradebook/layout.js',
  'src/gradebook/frozen-total.js',
  'src/gradebook/indicators.js',
  'src/gradebook/course-menu.js',
  'src/gradebook/bulk-comment.js',
  'src/gradebook/selection.js',
  'src/gradebook/keyboard.js',
  'src/gradebook/course-switcher.js',
  'src/gradebook/student-search.js',
  'src/gradebook/tray-layout.js'
];

let loaded = false;

function loadGradebookDom() {
  domshim.install();
  if (loaded) return globalThis.CGP;
  loaded = true;
  for (const rel of GRADEBOOK_FILES) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInThisContext(code, { filename: rel });
  }
  if (!globalThis.CGP || !globalThis.CGP.GradebookDomAdapter) {
    throw new Error('gradebook DOM modules did not register on globalThis.CGP');
  }
  // The grid editor's follow-up re-reads (keyboard.js), on the same
  // schedule ten times faster, so a case waits ~0.1 s instead of 1.3 s.
  globalThis.CGP.KeyboardGradingController.RECONCILE_DELAYS = RECONCILE_DELAYS_FAST;
  return globalThis.CGP;
}

const RECONCILE_DELAYS_FAST = [120, 300, 800];
// Past the first follow-up, short of the second.
const FOLLOW_UP_WAIT_MS = 130;
const followUpRan = () => new Promise((r) => setTimeout(r, FOLLOW_UP_WAIT_MS));

module.exports = { loadGradebookDom, domshim, followUpRan, FOLLOW_UP_WAIT_MS };
