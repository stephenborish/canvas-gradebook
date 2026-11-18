#!/usr/bin/env node
/* Canvas Gradebook+ - builds the zip to upload to the Chrome Web Store.
 *
 *   node scripts/package-extension.js
 *
 * Writes dist/canvas-gradebook-plus-<version>.zip (and the same files,
 * unzipped, in dist/package/), with manifest.json at the top of the zip as
 * the Web Store wants. Only what the extension runs is included:
 * manifest.json, icons/ and src/. Tests, docs and Mac .DS_Store files are not.
 *
 * Before zipping it checks, and stops with a plain message if not:
 *   - the version is the same in manifest.json, src/core/util.js and the
 *     options page (they are bumped together);
 *   - every file the extension loads exists: the manifest's scripts, styles,
 *     icons, options page and service worker, the options page's own
 *     scripts and styles, and every 'src/...' file named in the code
 *     (scripts added to a page later, e.g. the welcome tour).
 *
 * The "Package for Chrome Web Store" GitHub Action runs this (see
 * .github/workflows/package-extension.yml). */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'package');
const INCLUDE = ['manifest.json', 'icons', 'src'];
const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|\.git\w*)$|~$/;

const problems = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const exists = (r) => fs.existsSync(path.join(ROOT, r)) && fs.statSync(path.join(ROOT, r)).isFile();

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel(full);
    if (SKIP.test(r)) continue;
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------- checks */

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!/^\d+(\.\d+){0,3}$/.test(String(version || ''))) problems.push('manifest.json has no valid "version" (e.g. 1.33.0).');

const versionSpots = [
  ['src/core/util.js', /CGP\.VERSION\s*=\s*'([^']+)'/],
  ['src/options/options.html', /id="extensionVersion">([^<]+)</]
];
for (const [file, re] of versionSpots) {
  const m = re.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  if (!m) problems.push(`Couldn't find the version in ${file}.`);
  else if (m[1] !== version) problems.push(`${file} says version ${m[1]} but manifest.json says ${version}. Change them to match.`);
}

const needed = new Set();
const need = (r, from) => { if (r) needed.add(JSON.stringify([r.replace(/^\//, '').split(/[?#]/)[0], from])); };

// The manifest's own files.
Object.values(manifest.icons || {}).forEach((f) => need(f, 'manifest.json icons'));
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((f) => need(f, 'manifest.json action icon'));
if (manifest.background && manifest.background.service_worker) need(manifest.background.service_worker, 'manifest.json background');
if (manifest.options_ui && manifest.options_ui.page) need(manifest.options_ui.page, 'manifest.json options page');
(manifest.content_scripts || []).forEach((cs) => {
  (cs.js || []).forEach((f) => need(f, 'manifest.json content_scripts'));
  (cs.css || []).forEach((f) => need(f, 'manifest.json content_scripts'));
});
(manifest.web_accessible_resources || []).forEach((w) => (w.resources || []).forEach((f) => { if (!/[*]/.test(f)) need(f, 'manifest.json web_accessible_resources'); }));

const shipped = INCLUDE.flatMap((p) => {
  const full = path.join(ROOT, p);
  return fs.statSync(full).isDirectory() ? walk(full, []) : [p];
});

for (const file of shipped) {
  if (!/\.(js|html|css)$/.test(file)) continue;
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Pages: their scripts and styles, relative to the page.
  if (/\.html$/.test(file)) {
    const re = /<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/gi;
    let m;
    while ((m = re.exec(text))) {
      const ref = m[1];
      if (/^(https?:|data:|#|mailto:|chrome)/i.test(ref)) continue;
      need(path.posix.normalize(path.posix.join(path.posix.dirname(file), ref)), file);
    }
  }
  // Code: every 'src/...' file it names (injected later).
  const re = /['"`](src\/[\w./-]+\.(?:js|css|html))['"`]/g;
  let m;
  while ((m = re.exec(text))) need(m[1], file);
}

for (const item of needed) {
  const [r, from] = JSON.parse(item);
  if (!exists(r)) problems.push(`Missing file ${r} (needed by ${from}).`);
}

if (problems.length) {
  console.error('\nNot packaged. Fix these first:\n');
  problems.forEach((p) => console.error('  • ' + p));
  console.error('');
  process.exit(1);
}

/* ---------------------------------------------------------------- build */

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const r of shipped) {
  const to = path.join(STAGE, r);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, r), to);
}

const zipName = `canvas-gradebook-plus-${version}.zip`;
const zipPath = path.join(DIST, zipName);
try {
  // -X: no extra file attributes, so the same files give the same zip.
  execFileSync('zip', ['-q', '-r', '-X', zipPath, '.'], { cwd: STAGE, stdio: 'inherit' });
} catch (e) {
  console.error('\nCouldn\'t run "zip". The unzipped package is in dist/package/; zip its contents (not the folder) by hand.\n');
  process.exit(1);
}

const kb = Math.round(fs.statSync(zipPath).size / 1024);
console.log(`\nPackaged Canvas Gradebook+ ${version}: ${shipped.length} files, ${kb} KB`);
console.log(`  ${rel(zipPath)}`);
console.log(`  Checked ${needed.size} files the extension loads; all present.\n`);

// For the GitHub Action.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nzip=${rel(zipPath)}\nzip_name=${zipName}\nfiles=${shipped.length}\nkb=${kb}\n`);
}
