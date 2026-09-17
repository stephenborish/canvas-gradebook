/* Canvas Gradebook+ - test harness.
 *
 * The core modules are deliberately free of DOM and chrome.* access at load
 * time, so they can be loaded straight into this Node process with node:vm and
 * exercised as pure functions. No test framework is required.
 *
 * Run with:  node tests/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

const CORE_FILES = [
  'src/core/util.js',
  'src/core/canvas-api.js',
  'src/core/grade-ops.js',
  'src/core/post-ops.js',
  'src/core/clipboard-matrix.js',
  'src/core/comment-analysis.js',
  'src/core/grid-map.js',
  'src/core/totals.js',
  'src/core/snippets.js',
  'src/core/model.js'
];

function loadCore() {
  // No chrome, no document: the modules must tolerate both being absent.
  for (const rel of CORE_FILES) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    // Same realm as the tests so instanceof (Map, Array) behaves normally.
    vm.runInThisContext(code, { filename: rel });
  }
  if (!globalThis.CGP || !globalThis.CGP.gradeOps) {
    throw new Error('core modules did not register on globalThis.CGP');
  }
  return globalThis.CGP;
}

/* --------------------------------------------------------------- assertions */

class AssertionError extends Error {}

function fail(message) {
  throw new AssertionError(message);
}

function ok(value, message) {
  if (!value) fail(message || `expected truthy, got ${JSON.stringify(value)}`);
}

function not(value, message) {
  if (value) fail(message || `expected falsy, got ${JSON.stringify(value)}`);
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message ? message + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function deep(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${message ? message + ': ' : ''}expected ${b}, got ${a}`);
}

/** Assert an object contains exactly these keys/values (used for API form bodies). */
function form(actual, expected, message) {
  deep(Object.keys(actual || {}).sort(), Object.keys(expected).sort(), (message || 'form') + ' keys');
  Object.keys(expected).forEach((k) => eq(actual[k], expected[k], `${message || 'form'}.${k}`));
}

function hasKey(obj, key, message) {
  ok(obj && Object.prototype.hasOwnProperty.call(obj, key), message || `expected key ${key}`);
}

function lacksKey(obj, key, message) {
  not(obj && Object.prototype.hasOwnProperty.call(obj, key), message || `expected no key ${key}`);
}

/* ------------------------------------------------------------------ runner */

const suites = [];

function suite(name, fn) {
  suites.push({ name, fn });
}

/* Cases may return a promise (posting a column is an async sequence of
 * Canvas calls), so every case is awaited before the next one starts.
 * Without that, an async case's assertions land after run() has already
 * printed its result, and a failure surfaces as an unhandled rejection with
 * a green summary above it. */
async function run() {
  let pass = 0;
  const failures = [];
  const started = Date.now();

  for (const s of suites) {
    const cases = [];
    const test = (name, fn) => cases.push({ name, fn });
    s.fn(test);
    console.log(`\n${s.name}`);
    for (const c of cases) {
      try {
        await c.fn();
        pass++;
        console.log(`  ok   ${c.name}`);
      } catch (err) {
        failures.push({ suite: s.name, name: c.name, err });
        console.log(`  FAIL ${c.name}`);
        console.log(`       ${err && err.message}`);
        if (!(err instanceof AssertionError) && err && err.stack) {
          console.log('       ' + err.stack.split('\n').slice(1, 3).join('\n       '));
        }
      }
    }
  }

  const ms = Date.now() - started;
  console.log(`\n${pass} passed, ${failures.length} failed  (${ms}ms)`);
  if (failures.length) {
    process.exitCode = 1;
  }
  return failures.length === 0;
}

module.exports = {
  loadCore,
  suite,
  run,
  assert: { ok, not, eq, deep, form, hasKey, lacksKey, fail }
};
