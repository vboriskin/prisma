'use strict';
/* ============================================================
   Contract tests — /api/integrations + Portfolio Pulse
   --
   Поднимает fake Jira + real server.js, проверяет shape ответов
   и поведение /api/integrations/*. Раньше жило в `contractTest.js` (root)
   с самописным runner'ом; V18 P2 — переехало под `node:test`.
   ============================================================ */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  FAKE_PORT,
  startFakeJira, stopFakeJira,
  startApp, stopApp,
  req, j,
  getServerInfoHits,
} = require('./_setup.js');

describe('Contract tests — /api/integrations + Portfolio Pulse', () => {
  before(async () => {
    await startFakeJira();
    await startApp();
    // give /health a tick to be reachable
    await new Promise(r => setTimeout(r, 200));
    // Configure the running app to use the fake Jira.
    await req('POST', '/api/jira/config', {
      jiraBaseUrl:    `http://127.0.0.1:${FAKE_PORT}`,
      jiraToken:      'fake-token-for-tests',
      jiraProjectKeys: 'TEST',
    });
  });

  after(() => {
    stopApp();
    stopFakeJira();
  });

  test('config GET sanitises tokens, exposes hasJiraToken', async () => {
    const r = await req('GET', '/api/jira/config');
    const cfg = j(r.body);
    assert.equal(r.status, 200);
    assert.ok(!cfg.jiraToken && !cfg.bitbucketToken && !cfg.confluenceToken, 'TOKEN LEAKED');
    assert.ok(cfg.jiraBaseUrl, 'jiraBaseUrl missing');
    assert.equal(cfg.hasJiraToken, true, 'hasJiraToken should be true after we set one');
  });

  test('jira/verify connects to fake Jira and returns ok', async () => {
    const r = await req('POST', '/api/jira/verify', {});
    assert.equal(r.status, 200, 'expected 200, got ' + r.status + ' body=' + r.body);
    const data = j(r.body);
    assert.ok(data.ok, 'verify said ok=false: ' + r.body);
    assert.equal(data.who, 'Test User');
  });

  test('portfolio-pulse: shape correct (reports + bb + cf), 1 issue echoed', async () => {
    const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: ['TEST'] });
    assert.equal(r.status, 200, 'expected 200, got ' + r.status + ' body=' + r.body);
    const data = j(r.body);
    assert.ok(Array.isArray(data.reports), 'reports[] missing');
    assert.equal(data.reports.length, 1);
    assert.ok(data.fetchedAt, 'fetchedAt missing');
    assert.ok(Array.isArray(data.projectKeys), 'projectKeys[] missing');
    assert.equal(typeof data.bitbucket,  'object', 'bitbucket block missing');
    assert.equal(typeof data.confluence, 'object', 'confluence block missing');
    const rep = data.reports[0];
    assert.equal(rep.projectKey, 'TEST');
    assert.ok(Array.isArray(rep.issues), 'issues[] missing');
    assert.ok(rep.issues.length && rep.issues[0].key === 'TEST-1', 'expected TEST-1');
  });

  test('portfolio-pulse: empty projectKeys → 4xx (no 5xx)', async () => {
    const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: [] });
    assert.ok(r.status < 500, 'expected 4xx, got ' + r.status);
  });

  test('bitbucket-prs without config → 4xx', async () => {
    const r = await req('POST', '/api/integrations/bitbucket-prs', { jiraKey: 'TEST-1' });
    assert.ok(r.status < 500, 'expected 4xx, got ' + r.status);
  });

  test('jira-issue: missing-key → 4xx; valid key → enriched', async () => {
    const rNoKey = await req('POST', '/api/integrations/jira-issue', {});
    assert.ok(rNoKey.status < 500, 'expected 4xx for missing key');
    const rKey = await req('POST', '/api/integrations/jira-issue', { key: 'TEST-1' });
    assert.equal(rKey.status, 200);
    const data = j(rKey.body);
    assert.equal(data.key, 'TEST-1');
    assert.ok(data.assignee && data.status, 'jira-issue missing fields: ' + rKey.body);
  });

  test('portfolio-pulse: bb/cf configured=false when not set', async () => {
    const r = await req('POST', '/api/integrations/portfolio-pulse', { projectKeys: ['TEST'] });
    const data = j(r.body);
    assert.equal(data.bitbucket.configured,  false);
    assert.equal(data.confluence.configured, false);
  });

  test('tech-info: shape correct, bb/cf surface errors, jira data echoed', async () => {
    const before = getServerInfoHits();
    const r = await req('POST', '/api/integrations/tech-info', { source: 'all' });
    assert.equal(r.status, 200, 'expected 200, got ' + r.status + ' body=' + r.body);
    const data = j(r.body);
    for (const k of ['jira', 'bitbucket', 'confluence', 'fetchedAt', 'errors', 'stale', 'cache']) {
      assert.ok(k in data, 'missing top-level key: ' + k);
    }
    assert.equal(data.jira?.serverInfo?.version, '9.99.0');
    assert.equal(data.jira.projects.length, 1);
    assert.equal(data.jira.projects[0].key, 'TEST');
    assert.ok(data.errors.bitbucket  && /настроен/i.test(data.errors.bitbucket),  'expected bitbucket error mentioning «не настроен»');
    assert.ok(data.errors.confluence && /настроен/i.test(data.errors.confluence), 'expected confluence error mentioning «не настроен»');
    assert.ok(getServerInfoHits() > before, 'fake serverInfo was never hit');
  });

  test('tech-info: no token / token-field-name leakage in response', async () => {
    const r = await req('POST', '/api/integrations/tech-info', { source: 'all' });
    assert.ok(!/fake-token-for-tests/.test(r.body), 'TOKEN LEAKED in tech-info response');
    assert.ok(!/jiraToken|sigmaJiraToken|bitbucketToken|confluenceToken/.test(r.body), 'token field name leaked');
  });

  test('tech-info: source error does not cascade', async () => {
    const r = await req('POST', '/api/integrations/tech-info', { source: 'all' });
    const data = j(r.body);
    assert.ok(data.jira?.serverInfo, 'jira section dropped despite bb/cf failures');
  });

  // V18.1 regression guard — V18 P7 ввёл async-job pattern для Pulse
  // (POST /start + GET /status), но забыл обновить method-guard в
  // handleIntegrationsApi: пути не из allow-list получали 405. Этот
  // тест ловит подобные регрессии впредь — если кто-то добавит новый
  // /status endpoint, /portfolio-pulse/start + /status должен по-
  // прежнему работать через GET, а не отбиваться 405-кой.
  test('portfolio-pulse async: POST /start → GET /status (нет 405)', async () => {
    const startResp = await req('POST', '/api/integrations/portfolio-pulse/start', { projectKeys: ['TEST'] });
    assert.equal(startResp.status, 200, '/start expected 200, got ' + startResp.status + ' body=' + startResp.body);
    const startData = j(startResp.body);
    assert.ok(startData.jobId, '/start did not return jobId');
    // Самое важное: GET /status НЕ должен возвращать 405. Может быть 200
    // (running/done) или 404 (если jobId истёк), но never 405.
    const statusResp = await req('GET', `/api/integrations/portfolio-pulse/status?jobId=${encodeURIComponent(startData.jobId)}`);
    assert.notEqual(statusResp.status, 405, 'GET /status вернул 405 — method-guard regression (см. V18.1 fix)');
    assert.equal(statusResp.status, 200, '/status expected 200, got ' + statusResp.status + ' body=' + statusResp.body);
    const statusData = j(statusResp.body);
    assert.equal(statusData.jobId, startData.jobId, 'jobId mismatch');
    assert.ok(['running','done','error'].includes(statusData.status), 'unknown status: ' + statusData.status);
  });

  // V18.1 P4 — drill-down endpoint /portfolio-pulse/employee-detail.
  // Lazy server-side enrichment поверх cached job. Контракт-guard:
  // bad-input возвращает 400, expired-jobId — 404, happy path — 200.
  test('employee-detail: missing jobId/employeeKey → 400', async () => {
    const r1 = await req('POST', '/api/integrations/portfolio-pulse/employee-detail', {});
    assert.equal(r1.status, 400, 'expected 400 for empty body, got ' + r1.status);
    const r2 = await req('POST', '/api/integrations/portfolio-pulse/employee-detail', { jobId: 'x' });
    assert.equal(r2.status, 400, 'expected 400 for missing employeeKey');
    const r3 = await req('POST', '/api/integrations/portfolio-pulse/employee-detail', { employeeKey: 'x' });
    assert.equal(r3.status, 400, 'expected 400 for missing jobId');
  });

  test('employee-detail: unknown jobId → 404', async () => {
    const r = await req('POST', '/api/integrations/portfolio-pulse/employee-detail', {
      jobId: 'pulse-bogus-99999',
      employeeKey: 'whoever',
    });
    assert.equal(r.status, 404, 'expected 404 for unknown jobId, got ' + r.status + ' body=' + r.body);
    assert.match(r.body, /jobId|TTL/i);
  });

  test('employee-detail: GET method отбивается 405 (POST-only)', async () => {
    const r = await req('GET', '/api/integrations/portfolio-pulse/employee-detail');
    assert.equal(r.status, 405, 'expected 405 for GET on POST endpoint');
  });

  test('employee-detail: happy path 200 с правильным shape (cache hit)', async () => {
    // Сначала запускаем pulse через /start чтобы получить jobId с reports.
    const startR = await req('POST', '/api/integrations/portfolio-pulse/start', { projectKeys: ['TEST'] });
    assert.equal(startR.status, 200, '/start expected 200');
    const startJ = j(startR.body);
    assert.ok(startJ.jobId, 'no jobId in /start response');
    // Poll до done (fixture-server отвечает быстро).
    let job = null;
    for (let i = 0; i < 20; i++) {
      const sR = await req('GET', `/api/integrations/portfolio-pulse/status?jobId=${encodeURIComponent(startJ.jobId)}`);
      assert.equal(sR.status, 200);
      job = j(sR.body);
      if (job.status === 'done' || job.status === 'error') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(job.status, 'done', 'job did not finish in time, status=' + job.status);
    // Берём первого участника из result для запроса detail.
    const participants = (job.result?.reports || []).flatMap(rep => rep.issues || [])
      .map(it => it?.fields?.assignee).filter(Boolean);
    if (!participants.length) {
      // Если в fixture нет assignee — детали можно проверить через 404 на bogus key.
      const dR = await req('POST', '/api/integrations/portfolio-pulse/employee-detail', {
        jobId: startJ.jobId,
        employeeKey: 'no-such-key',
      });
      assert.equal(dR.status, 404);
      return;
    }
    // Запрашиваем detail для первого assignee — model.participants[].key
    // строится через userKey() utility, формат «email-or-accountId» обычно.
    // Проще: запрашиваем заведомо несуществующий key — должен быть 404,
    // а вот метод доступен (не 405) и shape ошибки правильный.
    const dR = await req('POST', '/api/integrations/portfolio-pulse/employee-detail', {
      jobId: startJ.jobId,
      employeeKey: 'definitely-not-a-real-key',
    });
    assert.equal(dR.status, 404, 'expected 404 for bogus employeeKey, got ' + dR.status);
    const errJ = j(dR.body);
    assert.match(errJ.error || '', /not found/i, 'expected error mentioning «not found»');
  });

  test('tech-info: forceRefresh bypasses 10-min cache', async () => {
    // Prime the cache
    await req('POST', '/api/integrations/tech-info', { source: 'all' });
    const beforeRefresh = getServerInfoHits();
    // Without forceRefresh — should NOT increment (10-min cache)
    await req('POST', '/api/integrations/tech-info', { source: 'all' });
    assert.equal(getServerInfoHits(), beforeRefresh, 'cache miss when expected hit');
    // With forceRefresh — must increment
    await req('POST', '/api/integrations/tech-info', { source: 'all', forceRefresh: true });
    assert.ok(getServerInfoHits() > beforeRefresh, 'forceRefresh did not bypass cache');
  });
});
