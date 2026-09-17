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
  'src/gradebook/frozen-total.js'
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
  return globalThis.CGP;
}

module.exports = { loadGradebookDom, domshim };
