'use strict';
/* ============================================================
   Contract tests for LLM proxy — PR-DB.
   --
   Поднимаем fake-LLM upstream + fake-GigaChat-OAuth upstream + реальный
   server.js. Проверяем:
     · happy-path: 200 + JSON ответ
     · 401 с успешным retry через refresh OAuth-токена
     · 401 после retry → 502/upstream-error с hint про scope/clientId
     · budget exceeded (per-user) → 429

   Использует _setup.js (FAKE_PORT/APP_PORT) только для startApp/req helpers.
   FAKE_LLM_PORT и FAKE_OAUTH_PORT — отдельные локальные сервера, поднимаются
   и закрываются в before/after.
   ============================================================ */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const FAKE_LLM_PORT   = 19210;
const FAKE_OAUTH_PORT = 19211;
const APP_PORT        = 19212;

let llmServer = null;
let oauthServer = null;
let appProc = null;

// Mutable state — переключается тестами для проверки разных сценариев.
const state = {
  llmStatus: 200,           // что вернёт fake LLM
  llmBody: null,            // body для ответа
  llmCallCount: 0,          // сколько раз был вызван /chat/completions
  // 401-retry сценарий: первый раз — 401, второй (after refresh) — 200.
  llm401Then200: false,
  oauthCallCount: 0,
  // Каждый refresh выдаёт уникальный access_token чтобы server.js не переиспользовал кэш.
  oauthTokenCounter: 0,
};

function startFakeLlm() {
  return new Promise((resolve, reject) => {
    llmServer = http.createServer((req, res) => {
      state.llmCallCount++;
      if (state.llm401Then200 && state.llmCallCount === 1) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="GigaChat"' });
        res.end(JSON.stringify({ error: 'unauthorized — token expired' }));
        return;
      }
      const body = state.llmBody || {
        choices: [{ message: { role: 'assistant', content: 'hello from fake LLM' } }],
      };
      res.writeHead(state.llmStatus, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    llmServer.listen(FAKE_LLM_PORT, '127.0.0.1', () => resolve());
    llmServer.on('error', reject);
  });
}

function startFakeOauth() {
  return new Promise((resolve, reject) => {
    oauthServer = http.createServer((req, res) => {
      state.oauthCallCount++;
      state.oauthTokenCounter++;
      // Имитируем GigaChat OAuth response: { access_token, expires_at }
      const body = {
        access_token: `fake-token-${state.oauthTokenCounter}`,
        expires_at: Date.now() + 30 * 60 * 1000,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    oauthServer.listen(FAKE_OAUTH_PORT, '127.0.0.1', () => resolve());
    oauthServer.on('error', reject);
  });
}

function startApp() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(__dirname, '..', '..');
    appProc = spawn('node', [path.join(root, 'server.js'), String(APP_PORT)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        RATE_LIMIT_PER_MIN: '500',
        INTEGRATION_ALLOW_LOOPBACK: '1',
        // Перенаправляем GigaChat OAuth на fake.
        GIGACHAT_OAUTH_URL: `http://127.0.0.1:${FAKE_OAUTH_PORT}/oauth/token`,
        // Маленький per-user budget для теста budget-exceeded.
        LLM_BUDGET_PER_USER: '3',
        LLM_BUDGET_PER_DAY: '100',
      },
    });
    let booted = false;
    appProc.stdout.on('data', (d) => {
      if (!booted && /LISTENING:/.test(d.toString())) { booted = true; resolve(); }
    });
    appProc.stderr.on('data', () => {});
    appProc.on('exit', (code) => { if (!booted) reject(new Error('server exit ' + code)); });
    setTimeout(() => { if (!booted) reject(new Error('server boot timeout')); }, 5000);
  });
}

function stopAll() {
  try { llmServer?.close(); } catch (_) {}
  try { oauthServer?.close(); } catch (_) {}
  if (appProc && !appProc.killed) try { appProc.kill('SIGTERM'); } catch (_) {}
}

function req(method, pathname, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port: APP_PORT, path: pathname, method,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
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
const j = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };

function resetState({ status = 200, body = null, retry401 = false } = {}) {
  state.llmStatus = status;
  state.llmBody = body;
  state.llmCallCount = 0;
  state.llm401Then200 = retry401;
  state.oauthCallCount = 0;
}

const baseLlmPayload = {
  apiBaseUrl: `http://127.0.0.1:${FAKE_LLM_PORT}`,
  model: 'GigaChat-2',
  messages: [{ role: 'user', content: 'hi' }],
  stream: false,
  temperature: 0.2,
  max_tokens: 100,
};

describe('LLM proxy — contract tests (PR-DB)', () => {
  before(async () => {
    await Promise.all([startFakeLlm(), startFakeOauth()]);
    await startApp();
  });
  after(() => stopAll());

  test('happy-path: 200 + JSON body, токен напрямую без OAuth', async () => {
    resetState({ body: { choices: [{ message: { content: 'hello' } }] } });
    const r = await req('POST', '/api/llm/chat', { ...baseLlmPayload, token: 'static-token' }, {
      'X-Client-Id': 'test-happy',
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.body.slice(0, 200)}`);
    const data = j(r.body);
    assert.ok(data, 'response is JSON');
    assert.equal(state.llmCallCount, 1, 'fake LLM был вызван ровно один раз');
    assert.equal(state.oauthCallCount, 0, 'OAuth не вызывался (был статический токен)');
  });

  test('401 → refresh OAuth → retry → 200 (clientId/secret path)', async () => {
    resetState({ retry401: true, body: { choices: [{ message: { content: 'after refresh' } }] } });
    const r = await req('POST', '/api/llm/chat', {
      ...baseLlmPayload,
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
    }, { 'X-Client-Id': 'test-retry-ok' });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.body.slice(0, 200)}`);
    assert.equal(state.llmCallCount, 2, 'fake LLM вызван дважды (первый 401, второй 200)');
    assert.ok(state.oauthCallCount >= 1, 'OAuth вызван для refresh');
  });

  test('401 после retry — структурированный hint про scope/clientId', async () => {
    // Постоянный 401 (retry не помог).
    resetState({ status: 401, body: { error: 'still unauthorized' } });
    const r = await req('POST', '/api/llm/chat', {
      ...baseLlmPayload,
      clientId: 'fake-client-2',
      clientSecret: 'fake-secret-2',
    }, { 'X-Client-Id': 'test-retry-fail' });
    assert.equal(r.status, 401, `expected 401, got ${r.status}: ${r.body.slice(0, 200)}`);
    const data = j(r.body);
    assert.ok(data, 'response is JSON');
    assert.match(String(data.hint || ''), /scope|clientId|GigaChat/i, 'hint содержит подсказку про scope/clientId');
  });

  test('budget exceeded per-user → 429 после превышения лимита', async () => {
    resetState({ body: { choices: [{ message: { content: 'ok' } }] } });
    const cid = 'test-budget-overflow';
    // LLM_BUDGET_PER_USER=3 (env), но global counter уже мог быть инкрементирован
    // в предыдущих тестах. Для надёжности шлём 5 запросов и проверяем что в какой-то
    // момент сервер ответил 429.
    let saw429 = false;
    for (let i = 0; i < 8; i++) {
      const r = await req('POST', '/api/llm/chat',
        { ...baseLlmPayload, token: 'static-token' },
        { 'X-Client-Id': cid });
      if (r.status === 429) { saw429 = true; break; }
    }
    assert.ok(saw429, '429 должен быть после превышения LLM_BUDGET_PER_USER=3');
  });

  test('нет токена → 400 "Нет токена"', async () => {
    resetState();
    const r = await req('POST', '/api/llm/chat', { ...baseLlmPayload }, {
      'X-Client-Id': 'test-no-token',
    });
    assert.equal(r.status, 400);
    const data = j(r.body);
    assert.match(String(data?.error || ''), /токен/i);
  });
});
