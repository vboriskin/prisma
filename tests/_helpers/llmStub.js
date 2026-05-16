'use strict';
/* ============================================================
   tests/_helpers/llmStub.js — Test infrastructure для LLM-routes.

   GigaChat / OpenAI вызовы — заглушаются для unit-тестов. Этот
   helper подменяет:
     · fetch() для /api/llm/chat и /api/llm/verify
     · `Services.LLMAssistant.sendFromInput` (через test-double)
     · SSE-стрим — синхронный return scripted-chunks
     · auto-token-refresh (401-retry) — controllable

   Использование:
     ```
     const stub = createLlmStub();
     stub.setNextResponse('Привет, я ассистент');
     // ... вызов sendFromInput()
     stub.assertCalled({ promptIncludes: 'Иванов' });
     stub.restore();
     ```

   Public API:
     createLlmStub(opts?)
       → { setNextResponse, setStructured, setError, setStreamChunks,
           assertCalled, getCalls, restore }

     mockFetch(routes)
       Подмена globalThis.fetch — карта { '/api/...': handler|response }

     mockState(stateOverrides)
       Подмена импортируемого state.js — для тестов context-builder'ов.

     resetAllChatStubs()
       Сброс ВСЕХ глобальных stub'ов между тестами.

   Контракты:
     · Stub НЕ зависит от UI / DOM — работает в Node.js контексте.
     · `restore()` обязателен после каждого теста (afterEach).
     · `assertCalled()` бросает с понятным сообщением при mismatch.
   ============================================================ */

/* ─────────────────────────────────────────────────────────────
   Fetch interceptor
   ───────────────────────────────────────────────────────────── */

let _origFetch = null;
let _fetchHistory = [];

export function mockFetch(routes) {
  if (_origFetch === null) _origFetch = globalThis.fetch;
  _fetchHistory = [];
  globalThis.fetch = async (url, opts) => {
    const reqUrl = String(url);
    const body = opts?.body ? _safeParse(opts.body) : null;
    _fetchHistory.push({ url: reqUrl, opts, body, ts: Date.now() });

    const handler = routes[reqUrl]
      || routes[_normalizeUrl(reqUrl)]
      || _findRouteByPrefix(routes, reqUrl)
      || routes['*'];

    if (!handler) {
      return _mockResponse(404, { error: `unmatched: ${reqUrl}` });
    }

    const result = typeof handler === 'function' ? await handler(body, opts) : handler;
    if (result && result._isMockResponse) return result;
    return _mockResponse(200, result);
  };
}

function _normalizeUrl(u) {
  try { return new URL(u, 'http://test').pathname; }
  catch (_) { return u; }
}

function _findRouteByPrefix(routes, url) {
  const path = _normalizeUrl(url);
  for (const key of Object.keys(routes)) {
    if (key.endsWith('*') && path.startsWith(key.slice(0, -1))) return routes[key];
    if (path === key) return routes[key];
  }
  return null;
}

function _safeParse(s) { try { return JSON.parse(s); } catch (_) { return s; } }

function _mockResponse(status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    _isMockResponse: true,
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => body,
    json: async () => (typeof data === 'string' ? _safeParse(data) : data),
    body: { getReader: () => _makeStringReader(body) },
  };
}

function _makeStringReader(text) {
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const bytes = enc ? enc.encode(text) : Buffer.from(text, 'utf-8');
  let sent = false;
  return {
    read: async () => {
      if (sent) return { value: undefined, done: true };
      sent = true;
      return { value: bytes, done: false };
    },
    cancel: async () => {},
  };
}

export function getFetchHistory() { return _fetchHistory.slice(); }
export function restoreFetch() {
  if (_origFetch !== null) {
    globalThis.fetch = _origFetch;
    _origFetch = null;
  }
  _fetchHistory = [];
}

/* ─────────────────────────────────────────────────────────────
   LLM stub — controllable scripted responses
   ───────────────────────────────────────────────────────────── */

/**
 * Создать LLM-стаб для одного теста.
 * @param {object} opts — { mode?: 'plain'|'sse'|'json', delay?: ms }
 */
export function createLlmStub(opts = {}) {
  const state = {
    mode: opts.mode || 'plain',
    nextResponse: null,
    nextError: null,
    streamChunks: null,
    calls: [],
    delay: opts.delay || 0,
  };

  mockFetch({
    '/api/llm/chat': async (body) => {
      state.calls.push({ kind: 'chat', body, at: Date.now() });
      if (state.delay) await new Promise(r => setTimeout(r, state.delay));
      if (state.nextError) {
        return _mockResponse(state.nextError.status || 500, { error: state.nextError.message });
      }
      if (state.streamChunks) {
        // SSE-style stream
        const sseBody = state.streamChunks.map(c => {
          if (c === '[DONE]') return 'data: [DONE]\n\n';
          if (typeof c === 'string') {
            return `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;
          }
          return `data: ${JSON.stringify(c)}\n\n`;
        }).join('');
        return _mockResponse(200, sseBody);
      }
      const text = state.nextResponse || 'Stub-ответ';
      // Default: plain text (LLM-stream-без-JSON)
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return _mockResponse(200, sse);
    },
    '/api/llm/verify': async () => ({ ok: true, model: 'gigachat-stub' }),
    '/api/integrations/jira-fetch-all': async () => ({ issues: [] }),
    '/api/integrations/bitbucket-prs':  async () => ({ prs: [] }),
    '/api/integrations/confluence-search': async () => ({ results: [] }),
    '*': async () => ({}),
  });

  return {
    setNextResponse(text) { state.nextResponse = text; state.streamChunks = null; },
    setStructured(structuredObj) {
      // Эмуляция LLM возвращающего text + ```json {...}``` block
      const jsonBlock = '```json\n' + JSON.stringify(structuredObj, null, 2) + '\n```';
      state.nextResponse = (structuredObj.text || '') + '\n\n' + jsonBlock;
      state.streamChunks = null;
    },
    setError(err) { state.nextError = err; },
    setStreamChunks(chunks) { state.streamChunks = chunks; },
    getCalls() { return state.calls.slice(); },
    assertCalled(predicate = {}) {
      const calls = state.calls;
      if (!calls.length) {
        throw new Error('Expected LLM to be called, but it was not');
      }
      if (predicate.times != null && calls.length !== predicate.times) {
        throw new Error(`Expected ${predicate.times} LLM calls, got ${calls.length}`);
      }
      if (predicate.promptIncludes) {
        const allBodies = calls.map(c => JSON.stringify(c.body)).join('\n');
        if (!allBodies.includes(predicate.promptIncludes)) {
          throw new Error(`LLM was not called with prompt containing "${predicate.promptIncludes}"`);
        }
      }
      return true;
    },
    restore() { restoreFetch(); },
  };
}

/* ─────────────────────────────────────────────────────────────
   State mock — для тестов context-builder'ов / dispatcher'а
   ───────────────────────────────────────────────────────────── */

let _origState = null;
const _stateBackup = {};

export async function mockState(overrides) {
  const stateModule = await import('../../state.js');
  if (_origState === null) {
    _origState = stateModule.state;
    // Сохраняем оригинальные значения только для overridden ключей.
    for (const k of Object.keys(overrides)) {
      _stateBackup[k] = stateModule.state[k];
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    stateModule.state[k] = v;
  }
  return stateModule.state;
}

export async function restoreState() {
  if (_origState === null) return;
  const stateModule = await import('../../state.js');
  for (const [k, v] of Object.entries(_stateBackup)) {
    stateModule.state[k] = v;
  }
  for (const k of Object.keys(_stateBackup)) delete _stateBackup[k];
  _origState = null;
}

/* ─────────────────────────────────────────────────────────────
   Services mock
   ───────────────────────────────────────────────────────────── */

let _origServices = null;
const _servicesBackup = {};

export async function mockServices(overrides) {
  const m = await import('../../app/services.js');
  if (_origServices === null) _origServices = m.Services;
  // Services — frozen Proxy с register/get API. Используем register.
  for (const [k, v] of Object.entries(overrides)) {
    try {
      // Сохраняем оригинал если есть.
      _servicesBackup[k] = m.Services.get(k);
    } catch (_) {
      _servicesBackup[k] = undefined;
    }
    try { m.Services.register(k, v); } catch (_) {
      // fallback на window-level если register нельзя (тестовое окружение).
      if (typeof globalThis !== 'undefined') globalThis[k] = v;
    }
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Services = m.Services;
  }
  return m.Services;
}

export async function restoreServices() {
  if (_origServices === null) return;
  const m = await import('../../app/services.js');
  for (const [k, v] of Object.entries(_servicesBackup)) {
    try {
      if (v === undefined || v === null) {
        // Нет API «unregister» — перезаписываем noop'ом.
        m.Services.register(k, null);
      } else {
        m.Services.register(k, v);
      }
    } catch (_) {}
  }
  for (const k of Object.keys(_servicesBackup)) delete _servicesBackup[k];
  _origServices = null;
}

/* ─────────────────────────────────────────────────────────────
   Universal reset — call from afterEach
   ───────────────────────────────────────────────────────────── */

export async function resetAllChatStubs() {
  restoreFetch();
  await restoreState();
  await restoreServices();
  // Reset memo if exists
  try {
    const m = await import('../../chat/resolveTarget.js');
    m._clearTargetMemo?.();
  } catch (_) {}
}

/* ─────────────────────────────────────────────────────────────
   localStorage mock (для тестов snapshotsAggregator и т.п.)
   ───────────────────────────────────────────────────────────── */

let _origLS = null;

export function mockLocalStorage(initial = {}) {
  if (_origLS === null) _origLS = globalThis.localStorage;
  const store = { ...initial };
  globalThis.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
    key(i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; },
    _dump() { return { ...store }; },
  };
  return globalThis.localStorage;
}

export function restoreLocalStorage() {
  if (_origLS !== null) {
    globalThis.localStorage = _origLS;
    _origLS = null;
  }
}
