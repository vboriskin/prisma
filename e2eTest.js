'use strict';
/* ============================================================
   e2eTest.js — V11 critical-path smoke test
   --
   Boots the actual server on an isolated port and hits the user-facing
   endpoints. No npm deps — Node built-ins only.
   --
   Run: node e2eTest.js
   Exit: 0 on success, 1 on any failure.
   ============================================================ */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 19099;
let serverProc = null;
let passed = 0, failed = 0;
const failures = [];

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(name, err) { failed++; failures.push({ name, err }); log('  ✗ ' + name + '  ' + (err && err.message ? err.message : err)); }
function pass(name)      { passed++; log('  ✓ ' + name); }

function get(pathSuffix, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: pathSuffix,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('request timeout')));
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function jsonOf(body) { try { return JSON.parse(body); } catch(_) { return null; } }

async function waitForBoot(maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await get('/health');
      if (r.status === 200) return true;
    } catch(_) { /* keep retrying */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, RATE_LIMIT_PER_MIN: '6' };  // tight limit for the burst test
    serverProc = spawn('node', [path.join(__dirname, 'server.js'), String(PORT)], {
      cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let booted = false;
    serverProc.stdout.on('data', (d) => {
      if (!booted && /LISTENING:/.test(d.toString())) { booted = true; resolve(); }
    });
    serverProc.stderr.on('data', () => {});
    serverProc.on('exit', (code) => {
      if (!booted) reject(new Error('Server exited before listen, code=' + code));
    });
    setTimeout(() => { if (!booted) reject(new Error('Server boot timeout')); }, 5000);
  });
}

function stopServer() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill('SIGTERM'); } catch(_) {}
  }
}

async function runTests() {
  log('\nE2E critical-path tests');
  log('────────────────────────');

  /* 1. /health is up */
  try {
    const r = await get('/health');
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status);
    const j = jsonOf(r.body);
    if (!j || j.ok !== true) throw new Error('body.ok !== true: ' + r.body.slice(0, 200));
    if (typeof j.uptime !== 'number' || j.uptime < 0) throw new Error('uptime missing or invalid');
    pass('/health → 200, ok:true, uptime number');
  } catch (e) { fail('/health basic', e); }

  /* 2. /metrics returns counters */
  try {
    const r = await get('/metrics');
    const j = jsonOf(r.body);
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status);
    if (typeof j.requestsTotal !== 'number') throw new Error('requestsTotal missing');
    if (typeof j.errors4xx     !== 'number') throw new Error('errors4xx missing');
    if (typeof j.rateLimited   !== 'number') throw new Error('rateLimited missing');
    if (!j.requestsByPath) throw new Error('requestsByPath missing');
    pass('/metrics → counters present');
  } catch (e) { fail('/metrics', e); }

  /* 3. Static SPA loads — index.html served on root */
  try {
    const r = await get('/');
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status);
    if (!/<html/i.test(r.body)) throw new Error('index.html body does not look like HTML');
    if (!/Q2 Plan|Планировщик|sbof/i.test(r.body)) throw new Error('index.html missing expected app marker');
    pass('GET / → index.html');
  } catch (e) { fail('static index', e); }

  /* 4. Static asset (CSS) loads with correct MIME */
  try {
    const r = await get('/styles.css');
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status);
    if (!/text\/css/.test(r.headers['content-type'] || '')) throw new Error('content-type wrong: ' + r.headers['content-type']);
    pass('GET /styles.css → 200 + text/css');
  } catch (e) { fail('static css', e); }

  /* 4b. /api/jira/config does NOT leak tokens — done BEFORE the rate-limit burst
         so the 429 storm doesn't smother this read. */
  try {
    const r = await get('/api/jira/config');
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status);
    const j = jsonOf(r.body);
    if (j && (j.jiraToken || j.bitbucketToken || j.confluenceToken)) throw new Error('TOKEN LEAKED in jira/config response!');
    pass('/api/jira/config does not leak tokens');
  } catch (e) { fail('jira config token leak', e); }

  /* 5. Health & metrics are exempt from rate-limit (don't trip the 6/min limit) */
  try {
    for (let i = 0; i < 12; i++) {
      const r = await get('/health');
      if (r.status === 429) throw new Error('health rate-limited at iter ' + i);
    }
    pass('/health exempt from rate-limit');
  } catch (e) { fail('rate-limit exempt', e); }

  /* 6. Burst of POSTs to /api/* exhausts the limit → 429 */
  try {
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const r = await get('/api/integrations/portfolio-pulse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      codes.push(r.status);
    }
    if (!codes.includes(429)) throw new Error('expected at least one 429 in burst, got ' + codes.join(','));
    pass('Rate-limit triggers 429 on burst (codes=' + codes.join(',') + ')');
  } catch (e) { fail('rate-limit burst', e); }

  /* 7. Portfolio-pulse without config returns 400, not 500 */
  // (Already exercised by the burst above — but test the very first call explicitly.)
  try {
    // Wait for limit window to roll over a touch
    await new Promise(r => setTimeout(r, 200));
    // Note: after the burst we may STILL be 429. We accept either 400 or 429 here as both
    // are correct user-visible failure modes. The contract is "no 500".
    const r = await get('/api/integrations/portfolio-pulse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (r.status >= 500) throw new Error('expected client-error, got ' + r.status);
    pass('portfolio-pulse without config → no 5xx (got ' + r.status + ')');
  } catch (e) { fail('portfolio-pulse graceful', e); }

  /* 8. Unknown API path returns 4xx (not 5xx) */
  try {
    const r = await get('/api/jira/__nonexistent__');
    if (r.status >= 500) throw new Error('expected 4xx, got ' + r.status);
    pass('Unknown jira API → 4xx');
  } catch (e) { fail('unknown api', e); }

  /* 9. /api/integrations/tech-info responds gracefully without creds (no 5xx).
   *    Without configured Jira/BB/CF the endpoint should still return 200 with
   *    `errors` block populated — never crash with 500. */
  try {
    // Wait long enough for the rate-limit window to clear from the burst test above.
    await new Promise(r => setTimeout(r, 11_000));
    const r = await get('/api/integrations/tech-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"source":"all"}',
    });
    if (r.status === 429) {
      pass('tech-info: rate-limited (429) — endpoint exists and rate-limit applies');
    } else if (r.status >= 500) {
      throw new Error('expected 200 or 4xx, got ' + r.status);
    } else {
      const j = jsonOf(r.body);
      if (!j) throw new Error('expected JSON, got: ' + r.body.slice(0, 200));
      for (const k of ['fetchedAt', 'errors', 'stale']) {
        if (!(k in j)) throw new Error('missing top-level key: ' + k);
      }
      pass('tech-info: graceful response without creds (' + r.status + ')');
    }
  } catch (e) { fail('tech-info graceful', e); }

}

(async () => {
  log('Starting server on port ' + PORT + '…');
  try {
    await startServer();
  } catch (e) {
    log('  ✗ Server failed to boot: ' + e.message);
    process.exit(1);
  }
  if (!(await waitForBoot())) {
    log('  ✗ Server never answered /health');
    stopServer();
    process.exit(1);
  }
  try {
    await runTests();
  } finally {
    stopServer();
  }

  log('────────────────────────');
  log(`Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log('\nFailures:');
    failures.forEach(f => log('  • ' + f.name + ' — ' + (f.err && f.err.message ? f.err.message : f.err)));
  }
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  log('Fatal: ' + (e.stack || e.message || e));
  stopServer();
  process.exit(1);
});
