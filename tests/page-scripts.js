/* The page's content-script groups, read from manifest.json and from
 * src/script-manifest.js (the self-hosted Canvas registration), for the
 * tests that check what loads where. See script-manifest.js. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOT = 'src/gradebook/content.js';

function listFrom(src, name) {
  const m = new RegExp('export const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(src);
  if (!m) throw new Error(name + ' not found in script-manifest.js');
  return (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
}

function pageScripts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const src = fs.readFileSync(path.join(ROOT, 'src/script-manifest.js'), 'utf8');
  const lists = {
    common: listFrom(src, 'COMMON_JS'),
    grading: listFrom(src, 'GRADING_JS'),
    boot: listFrom(src, 'BOOT_JS'),
    css: listFrom(src, 'CONTENT_CSS'),
    gradingCss: listFrom(src, 'GRADING_CSS')
  };
  const has = (f) => (cs) => (cs.js || []).indexOf(f) >= 0;
  const entries = {
    common: manifest.content_scripts.find((cs) => has(lists.common[0])(cs) && !cs.all_frames && cs.world !== 'MAIN' && (cs.js || []).length > 3),
    grading: manifest.content_scripts.find(has(lists.grading[0])),
    boot: manifest.content_scripts.find(has(BOOT))
  };
  const order = ['common', 'grading', 'boot'].map((k) => manifest.content_scripts.indexOf(entries[k]));
  // Everything a grading page's top frame gets, in order.
  const all = lists.common.concat(lists.grading, lists.boot);
  return { manifest, lists, entries, order, all };
}

module.exports = { pageScripts, BOOT };
