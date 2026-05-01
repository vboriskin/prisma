'use strict';
/* ============================================================
   contractTest.js — V11 contract tests for /api/integrations.
   --
   Boots:
     · A FAKE Jira server (express-free, raw http) on a random port
       that returns canned responses for /rest/api/2/search and friends.
     · The REAL ./server.js, configured to point its Jira base URL at
       the fake one via /api/jira/config POST.
   Then exercises the integration endpoints and asserts the response
   shape (keys, types, no 5xx, no token leakage).

   Why these tests exist (audit recommendation):
     The integration glue is the most brittle part of the codebase —
     external API drift, auth mode mismatches, JSON shape changes.
     Without contract tests, a small Jira upgrade can silently break
     Portfolio Pulse and we'd find out only when a user reports it.

   No external deps. Run: node contractTest.js
   Exit: 0 on green, 1 on any failure.
   ============================================================ */

const { spawn } = require('child_process');
const http     = require('http');
const path     = require('path');

const FAKE_PORT = 19200;     // canned-response Jira
const APP_PORT  = 19201;     // real server.js under test

let appProc = null;
let fakeServer = null;
let passed = 0, failed = 0;
const failures = [];

const log  = (m) => process.stdout.write(m + '\n');
const pass = (n) => { passed++; log('  ✓ ' + n); };
const fail = (n, e) => { failed++; failures.push({ n, e }); log('  ✗ ' + n + '  ' + (e?.message || e)); };

/* ─── 1. Fake Jira server ─────────────────────────────────────────────── */

const FAKE_ISSUES = [
  {
    key: 'TEST-1',
    fields: {
      summary: 'Fix login flow',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Иван Иванов', name: 'i.ivanov', emailAddress: 'i.ivanov@test.ru' },
      reporter: { displayName: 'Петр Петров' },
      updated: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      created: '2026-04-25T10:00:00.000Z',
      priority: { name: 'High' },
      issuetype: { name: 'Story', subtask: false },
      labels: [], duedate: null,
      timetracking: {}, timeoriginalestimate: 0, aggregatetimespent: 0,
      worklog: { worklogs: [] }, comment: { comments: [] },
      parent: null, subtasks: [],
      resolution: null, resolutiondate: null,
      customfield_10020: [{ name: 'Sprint 42', state: 'active', startDate: '2026-04-20T00:00:00Z', endDate: '2026-05-04T00:00:00Z' }],
    },
    changelog: { histories: [
      { author: { displayName: 'Иван Иванов' }, created: new Date(Date.now() - 4*3600*1000).toISOString(),
        items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
    ]},
  },
];

// Counter so we can verify forceRefresh actually re-hits the fake endpoints.
let _fakeJiraServerInfoHits = 0;

function startFakeJira() {
  return new Promise((resolve, reject) => {
    fakeServer = http.createServer((req, res) => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = req.url || '';
      if (url.startsWith('/rest/api/2/myself'))     return send(200, { displayName: 'Test User', name: 'test.user', emailAddress: 'tu@test.ru', active: true });
      if (url.startsWith('/rest/api/2/search'))     return send(200, { issues: FAKE_ISSUES, total: FAKE_ISSUES.length, startAt: 0, maxResults: 100 });
      if (url.startsWith('/rest/api/2/issue/'))     return send(200, FAKE_ISSUES[0]);
      // ── Tech-info endpoints ────────────────────────────────────
      if (url.startsWith('/rest/api/2/serverInfo')) { _fakeJiraServerInfoHits++; return send(200, { version: '9.99.0', buildNumber: 999000, deploymentType: 'Server', serverTime: '2026-04-28T10:00:00Z', baseUrl: 'http://fake' }); }
      if (url.startsWith('/rest/api/2/project/TEST/statuses'))  return send(200, [{ id: '10000', name: 'Story', subtask: false, statuses: [{ id: '1', name: 'Open', statusCategory: { key: 'new' } }] }]);
      if (url.match(/^\/rest\/api\/2\/project\/[^/]+\/versions/))   return send(200, [{ id: 'v1', name: '1.0', released: true, archived: false }]);
      if (url.match(/^\/rest\/api\/2\/project\/[^/]+\/components/)) return send(200, [{ id: 'c1', name: 'Backend', description: '' }]);
      if (url.startsWith('/rest/api/2/project'))    return send(200, [{ id: '10001', key: 'TEST', name: 'Test Project', projectTypeKey: 'software', lead: { displayName: 'Lead' } }]);
      if (url.startsWith('/rest/api/2/issuetype'))  return send(200, [{ id: '1', name: 'Story', subtask: false, description: '' }]);
      if (url.startsWith('/rest/api/2/status'))     return send(200, [{ id: '1', name: 'Open', statusCategory: { key: 'new', name: 'To Do', colorName: 'blue-gray' } }]);
      if (url.startsWith('/rest/api/2/priority'))   return send(200, [{ id: '1', name: 'High',  iconUrl: 'http://fake/icon.png' }]);
      if (url.startsWith('/rest/api/2/resolution')) return send(200, [{ id: '1', name: 'Done',  description: 'Work resolved' }]);
      if (url.startsWith('/rest/api/2/field'))      return send(200, [
        { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
        { id: 'customfield_10001', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
      ]);
      if (url.startsWith('/rest/api/2/customField/')) return send(200, []);
      if (url.startsWith('/rest/agile/1.0/board/')) return send(200, { values: [] });
      if (url.startsWith('/rest/agile/1.0/board'))  return send(200, { values: [{ id: 1, name: 'TEST board', type: 'scrum' }] });
      send(404, { error: 'fake jira: not implemented ' + url });
    });
    fakeServer.listen(FAKE_PORT, '127.0.0.1', () => resolve());
    fakeServer.on('error', reject);
  });
}
function stopFakeJira() { if (fakeServer) try { fakeServer.close(); } catch(_) {} }

/* ─── 2. App server boot/teardown ─────────────────────────────────────── */

function startApp() {
  return new Promise((resolve, reject) => {
    appProc = spawn('node', [path.join(__dirname, 'server.js'), String(APP_PORT)], {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RATE_LIMIT_PER_MIN: '500' },
    });
    let booted = false;
    appProc.stdout.on('data', (d) => { if (!booted && /LISTENING:/.test(d.toString())) { booted = true; resolve(); } });
    appProc.stderr.on('data', () => {});
    appProc.on('exit', (code) => { if (!booted) reject(new Error('server exit ' + code)); });
    setTimeout(() => { if (!booted) reject(new Error('server boot timeout')); }, 5000);
  });
}
function stopApp() { if (appProc && !appProc.killed) try { appProc.kill('SIGTERM'); } catch(_) {} }

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port: APP_PORT, path: pathname, method,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const cs = []; res.on('data', c => cs.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString('utf8') }));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => r.destroy(new Error('req timeout')));
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
const j = (s) => { try { return JSON.parse(s); } catch(_) { return null; } };

/* ─── 3. Tests ────────────────────────────────────────────────────────── */

async function run() {
  log('\nContract tests — /api/integrations + Portfolio Pulse');
  log('────────────────────────────────────────────────────');

  // Configure the running app to use the fake Jira (no token at first → 400 expected later).
  await req('POST', '/api/jira/config', {
    jiraBaseUrl:    `http://127.0.0.1:${FAKE_PORT}`,
    jiraToken:      'fake-token-for-tests',
    jiraProjectKeys: 'TEST',
  });

  /* T1: GET /api/jira/config sanitises tokens */
  try {
    const r = await req('GET', '/api/jira/config');
    const cfg = j(r.body);
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status);
    if (cfg.jiraToken || cfg.bitbucketToken || cfg.confluenceToken) throw new Error('TOKEN LEAKED!');
    if (!cfg.jiraBaseUrl) throw new Error('jiraBaseUrl missing');
    if (cfg.hasJiraToken !== true) throw new Error('hasJiraToken should be true after we set one');
    pass('config GET sanitises tokens, exposes hasJiraToken');
  } catch (e) { fail('config sanitisation', e); }

  /* T2: /api/jira/verify hits fake Jira and returns ok */
  try {
    const r = await req('POST', '/api/jira/verify', {});
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status + ' body=' + r.body);
    const data = j(r.body);
    if (!data.ok) throw new Error('verify said ok=false: ' + r.body);
    if (data.who !== 'Test User') throw new Error('expected fake user "Test User", got ' + data.who);
    pass('jira/verify connects to fake Jira and returns ok');
  } catch (e) { fail('jira/verify', e); }

  /* T3: /api/integrations/portfolio-pulse returns expected shape */
  try {
    const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: ['TEST'] });
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status + ' body=' + r.body);
    const data = j(r.body);
    if (!Array.isArray(data.reports)) throw new Error('reports[] missing');
    if (data.reports.length !== 1) throw new Error('expected 1 report, got ' + data.reports.length);
    if (!data.fetchedAt) throw new Error('fetchedAt missing');
    if (!Array.isArray(data.projectKeys)) throw new Error('projectKeys[] missing');
    if (typeof data.bitbucket  !== 'object') throw new Error('bitbucket block missing');
    if (typeof data.confluence !== 'object') throw new Error('confluence block missing');
    const rep = data.reports[0];
    if (rep.projectKey !== 'TEST') throw new Error('projectKey mismatch');
    if (!Array.isArray(rep.issues)) throw new Error('issues[] missing');
    if (!rep.issues.length || rep.issues[0].key !== 'TEST-1') throw new Error('expected TEST-1');
    pass('portfolio-pulse: shape correct (reports + bb + cf), 1 issue echoed');
  } catch (e) { fail('portfolio-pulse shape', e); }

  /* T4: portfolio-pulse propagates per-PK error without 5xx */
  try {
    // Misuse: empty PK should produce 400, not 500.
    const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: [] });
    if (r.status >= 500) throw new Error('expected 4xx, got ' + r.status);
    pass('portfolio-pulse: empty projectKeys → 4xx (no 5xx)');
  } catch (e) { fail('portfolio-pulse empty pk', e); }

  /* T5: bitbucket-prs without config → 400 (no 5xx) */
  try {
    const r = await req('POST', '/api/integrations/bitbucket-prs', { jiraKey: 'TEST-1' });
    if (r.status >= 500) throw new Error('expected 4xx, got ' + r.status);
    pass('bitbucket-prs without config → 4xx');
  } catch (e) { fail('bitbucket-prs unconfigured', e); }

  /* T6: jira-issue with missing key → 4xx, with key from fake Jira → echoed */
  try {
    const rNoKey = await req('POST', '/api/integrations/jira-issue', {});
    if (rNoKey.status >= 500) throw new Error('expected 4xx for missing key, got ' + rNoKey.status);
    const rKey = await req('POST', '/api/integrations/jira-issue', { key: 'TEST-1' });
    if (rKey.status !== 200) throw new Error('expected 200, got ' + rKey.status);
    const data = j(rKey.body);
    if (data.key !== 'TEST-1') throw new Error('key roundtrip failed');
    if (!data.assignee || !data.status) throw new Error('jira-issue missing fields: ' + rKey.body);
    pass('jira-issue: missing-key → 4xx; valid key → enriched');
  } catch (e) { fail('jira-issue', e); }

  /* T7: model.bitbucket / .confluence have configured=false on bare Jira-only setup */
  try {
    const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: ['TEST'] });
    const data = j(r.body);
    if (data.bitbucket.configured  !== false) throw new Error('expected bitbucket.configured=false');
    if (data.confluence.configured !== false) throw new Error('expected confluence.configured=false');
    pass('portfolio-pulse: bb/cf configured=false when not set');
  } catch (e) { fail('bb/cf default state', e); }

  /* T8: tech-info shape — Jira section populated, BB/CF report errors, top-level keys present. */
  try {
    const before = _fakeJiraServerInfoHits;
    const r = await req('POST', '/api/integrations/tech-info', { source: 'all' });
    if (r.status !== 200) throw new Error('expected 200, got ' + r.status + ' body=' + r.body);
    const data = j(r.body);
    for (const k of ['jira', 'bitbucket', 'confluence', 'fetchedAt', 'errors', 'stale', 'cache']) {
      if (!(k in data)) throw new Error('missing top-level key: ' + k);
    }
    if (!data.jira || !data.jira.serverInfo || data.jira.serverInfo.version !== '9.99.0') throw new Error('jira.serverInfo.version not echoed');
    if (data.jira.projects.length !== 1 || data.jira.projects[0].key !== 'TEST') throw new Error('jira.projects mismatch');
    // Bitbucket/Confluence not configured → errors recorded, no data.
    if (!data.errors.bitbucket  || !/настроен/i.test(data.errors.bitbucket))  throw new Error('expected bitbucket error mentioning "не настроен"');
    if (!data.errors.confluence || !/настроен/i.test(data.errors.confluence)) throw new Error('expected confluence error mentioning "не настроен"');
    if (_fakeJiraServerInfoHits <= before) throw new Error('fake serverInfo was never hit');
    pass('tech-info: shape correct, bb/cf surface errors, jira data echoed');
  } catch (e) { fail('tech-info shape', e); }

  /* T9: tech-info — no token leakage. The whole response body must NOT contain
   * the Jira token we configured at boot ('fake-token-for-tests'). */
  try {
    const r = await req('POST', '/api/integrations/tech-info', { source: 'all' });
    if (/fake-token-for-tests/.test(r.body)) throw new Error('TOKEN LEAKED in tech-info response');
    if (/jiraToken|sigmaJiraToken|bitbucketToken|confluenceToken/.test(r.body)) {
      throw new Error('token field name leaked in tech-info response');
    }
    pass('tech-info: no token / token-field-name leakage in response');
  } catch (e) { fail('tech-info token leak', e); }

  /* T10: tech-info — partial failure of one source doesn't kill the rest. */
  try {
    const r = await req('POST', '/api/integrations/tech-info', { source: 'all' });
    const data = j(r.body);
    // Even with bb/cf in errors, jira section is still populated.
    if (!data.jira || !data.jira.serverInfo) throw new Error('jira section dropped despite bb/cf failures');
    pass('tech-info: source error does not cascade');
  } catch (e) { fail('tech-info partial failure', e); }

  /* T11: forceRefresh: true bypasses the cache and hits the fake again. */
  try {
    // Prime the cache.
    await req('POST', '/api/integrations/tech-info', { source: 'all' });
    const beforeRefresh = _fakeJiraServerInfoHits;
    // Without forceRefresh — should NOT increment (10-min cache).
    await req('POST', '/api/integrations/tech-info', { source: 'all' });
    if (_fakeJiraServerInfoHits !== beforeRefresh) {
      throw new Error('cache miss when expected hit (count went ' + beforeRefresh + ' → ' + _fakeJiraServerInfoHits + ')');
    }
    // With forceRefresh — must increment.
    await req('POST', '/api/integrations/tech-info', { source: 'all', forceRefresh: true });
    if (_fakeJiraServerInfoHits === beforeRefresh) {
      throw new Error('forceRefresh did not bypass cache (count stayed at ' + beforeRefresh + ')');
    }
    pass('tech-info: forceRefresh bypasses 10-min cache');
  } catch (e) { fail('tech-info cache + forceRefresh', e); }
}

(async () => {
  try { await startFakeJira(); } catch (e) { log('Fake Jira boot failed: ' + e.message); process.exit(1); }
  try { await startApp(); }      catch (e) { log('App boot failed: ' + e.message); stopFakeJira(); process.exit(1); }
  // Wait one tick for /health to be reachable.
  await new Promise(r => setTimeout(r, 200));
  try { await run(); } finally { stopApp(); stopFakeJira(); }

  log('────────────────────────────────────────────────────');
  log(`Contract: ${passed} passed, ${failed} failed`);
  if (failed) {
    log('Failures:');
    failures.forEach(f => log('  • ' + f.n + ' — ' + (f.e?.message || f.e)));
  }
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('Fatal: ' + (e.stack || e.message || e));
  stopApp(); stopFakeJira();
  process.exit(1);
});
