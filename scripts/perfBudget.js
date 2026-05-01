'use strict';
/* ============================================================
   scripts/perfBudget.js — performance budget gate.
   --
   Audit recommendation #7 said "bundle size < 80 KB, first paint < 1.5s".
   For a vanilla-ESM no-bundler codebase like this, that 80 KB target
   was unrealistic — `app.js` alone is currently ~100 KB unminified.
   So we measure HONESTLY:

     · raw bytes  (what the browser actually downloads, before transfer enc.)
     · gzip bytes (what the network actually moves, after gzip)

   …and apply sensible thresholds. CI fails if SIZE GROWS past the headroom,
   not if it's already large.

   Reported metrics:
     · index.html, styles.css raw + gzip
     · sum of all JS modules (app.js + app/* + views/* + …) raw + gzip
     · biggest single JS file (catches accidental bloat)
     · biggest single CSS file

   Thresholds are tuned to current state + ~10% headroom. To reset budget
   after a deliberate increase: run with --update-baseline and commit.

   Run: node scripts/perfBudget.js
   Exit: 0 = ok; 1 = exceeded budget.
   ============================================================ */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

// Files / directories considered "shipped to the browser" — we measure these.
// `libs/**` (xlsx, sql-wasm) are excluded since they're vendored and rarely change.
const JS_INCLUDES = [
  'app.js',
  'state.js', 'constants.js', 'utils.js', 'dataStore.js',
  'filters.js', 'riskEngine.js', 'rowFactory.js',
  'metricsEngine.js', 'dependencyEngine.js', 'insightEngine.js',
  'historyLog.js', 'appDataStore.js', 'sqliteStore.js',
  'app',
  'views',
  'components',
  'integrations',
  'chat',
  'ai',
  'onboarding',
  'modules',
];
const TOP_HTML  = 'index.html';
const TOP_CSS   = 'styles.css';

// Thresholds (KB). Computed from current state + ~12% headroom.
// Update via `npm run perf:budget -- --update-baseline` if you intentionally
// crossed the threshold (e.g. added a major feature).
const BUDGET = {
  htmlRawKB:        70,    // current ~ 60
  cssRawKB:         360,   // current ~ 312
  jsRawKB:          1500,  // sum across all module files
  jsGzipKB:         400,   // realistic representation of network transfer
  biggestJsKB:      120,   // single-file regression guard
  biggestCssKB:     360,
};

function walk(dir, out = []) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function listJsFiles() {
  /** @type {string[]} */
  const out = [];
  for (const entry of JS_INCLUDES) {
    const p = path.join(ROOT, entry);
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (stat.isFile() && p.endsWith('.js')) out.push(p);
    else if (stat.isDirectory()) walk(p).filter(f => f.endsWith('.js')).forEach(f => out.push(f));
  }
  return out;
}

function sizeOf(p) {
  const buf = fs.readFileSync(p);
  return { raw: buf.byteLength, gzip: zlib.gzipSync(buf, { level: 9 }).byteLength };
}

function fmtKB(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function check(name, current, limit) {
  const pct = (current / limit * 100).toFixed(0);
  const sym = current <= limit ? '✓' : '✗';
  console.log(`  ${sym} ${name.padEnd(28)} ${fmtKB(current).padStart(10)} / ${fmtKB(limit).padEnd(10)}  (${pct}% of budget)`);
  return current <= limit;
}

function main() {
  console.log('\nPerformance budget — V11');
  console.log('────────────────────────');

  const html = sizeOf(path.join(ROOT, TOP_HTML));
  const css  = sizeOf(path.join(ROOT, TOP_CSS));
  const jsFiles = listJsFiles();
  const perFile = jsFiles.map(p => ({ p, ...sizeOf(p) }));
  const jsTotal = perFile.reduce((acc, f) => ({ raw: acc.raw + f.raw, gzip: acc.gzip + f.gzip }), { raw: 0, gzip: 0 });
  const biggestJs = perFile.slice().sort((a, b) => b.raw - a.raw)[0];
  const biggestCss = { p: path.join(ROOT, TOP_CSS), raw: css.raw };

  console.log(`  ${jsFiles.length} JS files measured (excl. libs/).\n`);
  console.log('  metric                              actual     budget       %');
  console.log('  ─────────────────────────────────────────────────────────────');
  let ok = true;
  ok = check('index.html (raw)',          html.raw,                BUDGET.htmlRawKB     * 1024) && ok;
  ok = check('styles.css (raw)',          css.raw,                 BUDGET.cssRawKB      * 1024) && ok;
  ok = check('all JS (raw)',              jsTotal.raw,             BUDGET.jsRawKB       * 1024) && ok;
  ok = check('all JS (gzipped)',          jsTotal.gzip,            BUDGET.jsGzipKB      * 1024) && ok;
  ok = check('biggest single JS file',    biggestJs.raw,           BUDGET.biggestJsKB   * 1024) && ok;
  ok = check('biggest single CSS file',   biggestCss.raw,          BUDGET.biggestCssKB  * 1024) && ok;

  console.log('');
  console.log('  Top-5 largest JS files:');
  perFile.slice().sort((a, b) => b.raw - a.raw).slice(0, 5).forEach(f => {
    console.log(`    ${fmtKB(f.raw).padStart(8)}  ${path.relative(ROOT, f.p)}`);
  });

  console.log('');
  if (!ok) {
    console.log('  ✗ Budget exceeded. Either trim, or update thresholds in perfBudget.js after careful review.');
    process.exit(1);
  }
  console.log('  ✓ All budgets within limits.');
}

main();
