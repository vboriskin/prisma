# Перенос интеграций Jira + Bitbucket + Confluence + LLM в другое приложение

> **Цель документа.** Дать другому LLM-агенту достаточно контекста и кода, чтобы построить тот же набор интеграций в любом другом приложении (Node.js + браузер) без чтения остального исходника. Все примеры — vanilla JS / Node built-ins, никаких npm-зависимостей.
>
> **Исходник, на который опирается guide.** Прод-проект Призма (`prisma_new_design_v2`) — внутренний планировщик Сбера. Все паттерны проверены боем (большая корп Jira / Bitbucket Server / Confluence Cloud+DC / GigaChat).
>
> **Что НЕ покрыто.** Sigma Jira (второй инстанс с goal-эпиками — отдельный edge-case), Jenkins, Zephyr, multi-tenant. Только базовый набор по запросу.

---

## 0. TL;DR — архитектура в одном экране

```
┌─────────────────────────────────────────────────────────────┐
│ Браузер (vanilla JS)                                        │
│                                                             │
│  Settings UI (password inputs) ──► localStorage             │
│         │              │                                    │
│         │              └─► fetch POST /api/jira/config      │
│         │                  (non-empty token guard!)         │
│         ▼                                                   │
│  proxyPost('/api/integrations/jira-issue', { key })  ──┐    │
│  proxyPost('/api/integrations/bitbucket-prs', ...)     │    │
│  proxyPost('/api/integrations/confluence-search', ...) │    │
│  fetch '/api/llm/chat' (SSE streaming)                 │    │
└────────────────────────────────────────────────────────┼────┘
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Node.js server (один процесс, http built-in)                │
│                                                             │
│  jira_config.json  ◄── source of truth для всех токенов     │
│         │                                                   │
│         ▼                                                   │
│  makeAuthHeader(cfg.<svc>Token) ──► Bearer / Basic          │
│         │                                                   │
│         ▼                                                   │
│  jiraForward({ targetUrl, headers, timeoutMs })             │
│    ├── SSRF guard (block 127.0.0.1 если не dev)             │
│    ├── circuit-breaker per-host (5 fails/min → 30s open)    │
│    ├── 429 rate-limit gate (shared, не feedback-loop)       │
│    ├── HTTP cache + ETag (GET-only, TTL 5 мин)              │
│    └── gzip / response cap 64MB                             │
│         │                                                   │
│         ▼                                                   │
│  Jira / Bitbucket / Confluence / GigaChat                   │
└─────────────────────────────────────────────────────────────┘
```

**3 железных правила:**
1. Токен **никогда** не возвращается в браузер. `GET /api/<...>/config` отдаёт `{ hasJiraToken: bool, jiraBaseUrl: '…' }`, не сам токен.
2. **Пустое поле токена при сохранении = сохранить существующий.** Иначе случайный «Save» с пустым полем стирает токен.
3. **Все error-paths** проходят через regex-redact (`Bearer ***`, `token: ***` и т.п.) перед записью в лог или отдачей пользователю. Некоторые корп-proxies echo'ят Authorization в body.

---

## 1. Конфиг — `jira_config.json`

Один файл рядом с `server.js`, JSON, атомарная запись (`fs.writeFileSync`).

```json
{
  "jiraBaseUrl": "https://company.atlassian.net",
  "jiraToken": "Bearer eyJh...",
  "jiraProjectKeys": "PAY, SBOF, KYC",

  "bitbucketBaseUrl": "https://bitbucket.company.com",
  "bitbucketToken": "BBpat-...",
  "bitbucketProjectKeys": "frontend, backend",

  "confluenceBaseUrl": "https://corp.atlassian.net",
  "confluenceToken": "Bearer ...",
  "confluenceSpaceKeys": "DEV, PAY",

  "allowInsecureTls": false,
  "sinceDate": "2025-01-01",
  "activityWindowHours": 72
}
```

**Форматы токенов** (один helper понимает все три):
- `Bearer eyJh...` → отправляется как есть
- `email@co:apiToken` (Atlassian Cloud Basic) → `Basic base64(email:token)`
- `pat-abc123` или любой не-Bearer → `Bearer <token>`

**Почему файл, а не env.** Юзер меняет токены через UI в рантайме (Settings modal POST'ит на сервер). С env пришлось бы рестартить процесс.

**Какие поля персистятся через POST /api/jira/config:**

| Поле | Whitelist | Особенность |
|---|---|---|
| `jiraBaseUrl`, `bitbucketBaseUrl`, `confluenceBaseUrl` | string | trim, **пустое = preserve** |
| `jiraProjectKeys`, `bitbucketProjectKeys`, `confluenceSpaceKeys` | string | comma-separated |
| `jiraToken`, `bitbucketToken`, `confluenceToken` | string | **сохраняется ТОЛЬКО если non-empty** (см. §3) |
| `activityWindowHours` | number | clamp [1, 168] |
| `allowInsecureTls` | bool | для корп self-signed CA |
| `sinceDate` | YYYY-MM-DD | строгий regex |

---

## 2. Серверная часть

### 2.1. Файловая структура

Можно держать всё в одном `server.js` (наш прод так начинался) или разнести:

```
server.js                  ← bootstrap + routing
server/
  jira-config.js           ← read/write/sanitize jira_config.json
  upstream.js              ← jiraForward, circuit-breaker, rate-limit, cache
  auth-helpers.js          ← makeAuthHeader, redactSecrets, keyForAuthor
  integrations-api.js      ← /api/integrations/* handlers
  llm.js                   ← /api/llm/chat + GigaChat OAuth
  helpers.js               ← readBody, writeJson, isSameOriginRequest
```

### 2.2. Bootstrap server

```js
// server.js
'use strict';
const http = require('http');
const url  = require('url');
const fs   = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const MAX_BODY = 4 * 1024 * 1024;          // 4 MB запрос — больше не пускаем
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 60);

// ── helpers ────────────────────────────────────────────────────
function writeJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // Security headers
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function readBody(req, limitBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on('data', (c) => {
      received += c.length;
      if (received > limitBytes) {
        req.destroy();
        return reject(new Error('Payload too large'));
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// CSRF: cross-origin POST'ы блокируем (внешняя страница не должна писать
// в наш jira_config.json). GET — открыт. CSRF_DISABLED=1 для тестов.
function isSameOriginRequest(req) {
  if (process.env.CSRF_DISABLED === '1') return true;
  const origin  = req.headers.origin  || '';
  const referer = req.headers.referer || '';
  const host    = req.headers.host    || '';
  if (!origin && !referer) return true;
  try {
    const src = origin ? new URL(origin) : new URL(referer);
    return src.host === host;
  } catch { return false; }
}

// Простой rate-limit per-IP
const _rlBuckets = new Map();   // ip → { count, windowStart }
function checkRateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const b = _rlBuckets.get(ip) || { count: 0, windowStart: now };
  if (now - b.windowStart > 60_000) { b.count = 0; b.windowStart = now; }
  if (++b.count > RATE_LIMIT_PER_MIN) return false;
  _rlBuckets.set(ip, b);
  return true;
}

// ── wiring ─────────────────────────────────────────────────────
const upstream = require('./server/upstream.js');
const authH    = require('./server/auth-helpers.js');
const cfgApi   = require('./server/jira-config.js').create({ ROOT });

const integrations = require('./server/integrations-api.js').create({
  writeJson, readBody, isSameOriginRequest,
  jiraReadConfig: cfgApi.jiraReadConfig,
  jiraForward:    upstream.jiraForward,
  jiraRequest:    upstream.jiraRequest,
  jiraSearchAll:  upstream.jiraSearchAll,
  cfPathCascade:  upstream._cfPathCascade,
  makeAuthHeader: authH.makeAuthHeader,
});

const llm = require('./server/llm.js').create({ readBody, writeJson, MAX_BODY });

// ── HTTP server ────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  // Rate-limit только для /api/*
  if (pathname.startsWith('/api/')) {
    if (!checkRateLimit(req)) { writeJson(res, 429, { error: 'Rate limit' }); return; }
  }

  // Health probe
  if (pathname === '/health') { writeJson(res, 200, { ok: true, uptime: process.uptime() }); return; }

  // Config (GET/POST)
  if (pathname.startsWith('/api/jira/')) {
    cfgApi.handleJiraApi(req, res, pathname, { writeJson, readBody, isSameOriginRequest, upstream, authH });
    return;
  }

  // Интеграции
  if (pathname.startsWith('/api/integrations/')) {
    integrations.handleIntegrationsApi(req, res, pathname);
    return;
  }

  // LLM streaming
  if (req.method === 'POST' && pathname === '/api/llm/chat') {
    llm.proxyChat(req, res);
    return;
  }

  // Статика
  serveStatic(req, res, pathname);
}).listen(PORT, () => console.log(`Listening on ${PORT}`));
```

### 2.3. Auth helpers

```js
// server/auth-helpers.js
'use strict';

/** Bearer / Basic — поддерживает все 3 формата токена. */
function makeAuthHeader(token) {
  if (!token) return '';
  // Уже Bearer-префиксованный — отдаём как есть.
  if (/^Bearer /i.test(token)) return token;
  // `email:apiToken` (Atlassian Cloud Basic auth)
  if (token.includes(':')) return 'Basic ' + Buffer.from(token).toString('base64');
  // Сырой PAT / любой непрефиксованный
  return 'Bearer ' + token;
}

/** Redact secrets из error-сообщений до того, как они попадут в логи / UI.
 *  Некоторые корп-proxies echo'ят Authorization header в response body. */
function redactSecretsInText(text, maxLen = 200) {
  return String(text == null ? '' : text).slice(0, maxLen)
    .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
    .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
    .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***')
    // Внутренние идентификаторы тоже не светим (sessionId, accountId)
    .replace(/(sessionId|JSESSIONID|userKey|accountId|username)\s*[:=]\s*[^\s,;"&]+/gi, '$1: ***');
}

module.exports = { makeAuthHeader, redactSecretsInText };
```

### 2.4. Upstream HTTP — `jiraForward`

Это **центральная функция**. Все внешние HTTP-запросы (Jira + BB + CF + Zephyr + Jenkins) идут через неё.

```js
// server/upstream.js
'use strict';
const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const { URL } = require('url');

// keep-alive для всех outbound — корп Jira/BB обычно тысячи запросов
// в Pulse-pipeline'е, без keep-alive TLS handshake убивает throughput.
const _httpAgent  = new http.Agent({  keepAlive: true, maxSockets: 64 });
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
const _httpsInsecure = new https.Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: false });

const _MAX_RESPONSE_BYTES = 64 * 1024 * 1024;   // 64 MB cap — выше реальных API ответов

// ── SSRF guard ─────────────────────────────────────────────────
// Конфиг — пользовательский. Без guard'а атакующий мог бы указать
// `jiraBaseUrl=http://localhost:9200/secret-service` и server-proxy
// его достанет. Loopback + link-local блокируем всегда.
const _LOCAL_OVERRIDE = process.env.INTEGRATION_ALLOW_LOOPBACK === '1';   // tests
function _ssrfBlocked(hostname) {
  if (_LOCAL_OVERRIDE) return null;
  const h = String(hostname || '').toLowerCase();
  if (h === '::1' || h.startsWith('fe80:')) return 'IPv6 loopback';
  if (/^127\./.test(h) || h === 'localhost' || h === '0.0.0.0') return 'loopback';
  if (/^169\.254\./.test(h)) return 'link-local';
  return null;
}

// ── Circuit-breaker per-host ───────────────────────────────────
// Если у конкретного host'а за 60s было ≥5 ошибок (5xx / network) — open
// breaker на 30s: следующие jiraForward к нему возвращают 503 не выходя
// в сеть. Спасает от feedback-loop «Jira лежит → клиент бомбит → лежит ещё».
const _breakers = new Map();
const _BREAKER_WINDOW_MS = 60_000;
const _BREAKER_OPEN_MS   = 30_000;
const _BREAKER_THRESHOLD = 5;
function _breakerCheck(host) {
  const b = _breakers.get(host);
  if (!b) return { open: false };
  return b.openUntil > Date.now() ? { open: true, retryAfterMs: b.openUntil - Date.now() } : { open: false };
}
function _breakerFail(host) {
  const now = Date.now();
  const b = _breakers.get(host) || { failures: [], openUntil: 0 };
  b.failures = b.failures.filter(t => now - t < _BREAKER_WINDOW_MS);
  b.failures.push(now);
  if (b.failures.length >= _BREAKER_THRESHOLD) {
    b.openUntil = now + _BREAKER_OPEN_MS;
    b.failures = [];
  }
  _breakers.set(host, b);
}
function _breakerOk(host) {
  const b = _breakers.get(host);
  if (b) { b.failures = []; _breakers.set(host, b); }
}

// ── HTTP cache (LRU, ETag passthrough) ─────────────────────────
const _CACHE = new Map();    // cacheKey → { at, status, headers, text, etag, negative }
const _CACHE_TTL_MS = 5 * 60 * 1000;
const _CACHE_MAX = 500;
const _CACHE_BODY_CAP = 4 * 1024 * 1024;
function _cacheKey(method, url, insecureTls, authHeader) {
  // Включаем хэш Authorization в ключ — после rotate'а токена ответ
  // старого scope не должен возвращаться (cross-token leak).
  let h = 0;
  for (let i = 0; i < (authHeader || '').length; i++) h = ((h << 5) - h + authHeader.charCodeAt(i)) | 0;
  return `${method}|${(h >>> 0).toString(36)}|${insecureTls ? 'i|' : ''}${url}`;
}

// ── Confluence path-cascade (Cloud vs DC) ──────────────────────
// Atlassian Cloud монтирует API на /wiki/rest/..., DC/Server — на /rest/....
// Всегда пробуем Cloud первым. Хвостовой /wiki в baseUrl trim'им чтобы
// не получить ".../wiki/wiki/...".
function _cfBuildPathCascade(baseUrl, suffix) {
  const base = String(baseUrl || '').replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const sfx = suffix.startsWith('/') ? suffix : '/' + suffix;
  return [`${base}/wiki${sfx}`, `${base}${sfx}`];
}

/** Cascade fetch helper: пробует URL'ы по очереди.
 *  401/403 → bail с authError (везде, скорее всего, та же ошибка).
 *  2xx → return.
 *  404 / прочее → try next.
 */
async function _cfPathCascade(urls, opts = {}) {
  const tried = [];
  for (const u of urls) {
    const t0 = Date.now();
    const r = await jiraForward({ targetUrl: u, method: 'GET', headers: opts.headers || {}, allowInsecureTls: !!opts.allowInsecureTls, timeoutMs: opts.timeoutMs || 20000 })
      .catch(e => ({ status: 0, text: String(e?.message || e) }));
    tried.push({ url: u.replace(/\?.*$/, ''), status: r.status, ms: Date.now() - t0 });
    if (r.status === 401 || r.status === 403) return { ok: false, authError: r.status, tried };
    if (r.status >= 200 && r.status < 300) return { ok: true, text: r.text, headers: r.headers, tried };
  }
  return { ok: false, tried, error: 'no path matched' };
}

// ── Main HTTP forwarder ────────────────────────────────────────
function jiraForward({
  targetUrl, method = 'GET', headers = {}, body = null,
  allowInsecureTls = false, timeoutMs = 30000,
  maxResponseBytes = _MAX_RESPONSE_BYTES, useCache = null, skipBreaker = false,
}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch { return reject(new Error('Bad URL: ' + targetUrl)); }

    // SSRF
    const ssrf = _ssrfBlocked(parsed.hostname);
    if (ssrf) {
      const err = new Error(`Blocked outbound to ${parsed.hostname} (SSRF: ${ssrf})`);
      err.code = 'SSRF_BLOCKED';
      return reject(err);
    }

    // Circuit-breaker short-circuit
    if (!skipBreaker) {
      const bs = _breakerCheck(parsed.hostname);
      if (bs.open) {
        return resolve({ status: 503, headers: {}, text: JSON.stringify({ error: 'circuit-breaker open', host: parsed.hostname, retryAfterMs: bs.retryAfterMs }) });
      }
    }

    // Cache
    const cacheable = useCache !== false && (useCache === true || (method === 'GET' && body == null));
    const authH = headers.Authorization || headers.authorization || '';
    const cKey = cacheable ? _cacheKey(method, targetUrl, allowInsecureTls, authH) : null;
    let cachedEntry = null;
    if (cacheable) {
      const e = _CACHE.get(cKey);
      if (e && Date.now() - e.at <= _CACHE_TTL_MS) {
        cachedEntry = e;
        if (!e.etag) return resolve({ status: e.status, headers: e.headers, text: e.text, _cacheHit: true });
      } else if (e) _CACHE.delete(cKey);
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const agent = parsed.protocol === 'https:'
      ? (allowInsecureTls ? _httpsInsecure : _httpsAgent)
      : _httpAgent;

    const reqHeaders = {
      Accept: 'application/json',                       // Без него за SSO часто HTML
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'my-app/1.0',
      ...headers,
    };
    if (cachedEntry?.etag && !reqHeaders['If-None-Match']) reqHeaders['If-None-Match'] = cachedEntry.etag;

    const r = lib.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      headers: reqHeaders,
      rejectUnauthorized: !allowInsecureTls,
      agent,
    }, (resp) => {
      const chunks = [];
      let received = 0;
      const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
      let stream = resp;
      if (enc.includes('gzip')) stream = resp.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = resp.pipe(zlib.createInflate());

      stream.on('data', (c) => {
        received += c.length;
        if (received > maxResponseBytes) {
          try { resp.destroy(); } catch {}
          const err = new Error(`Response too large from ${parsed.hostname}`);
          err.code = 'RESPONSE_TOO_LARGE';
          return reject(err);
        }
        chunks.push(c);
      });
      stream.on('error', reject);
      stream.on('end', () => {
        const status = resp.statusCode || 0;
        const text = Buffer.concat(chunks).toString('utf-8');

        if (!skipBreaker) {
          if (status >= 500 || status === 0) _breakerFail(parsed.hostname);
          else _breakerOk(parsed.hostname);
        }

        if (cacheable) {
          if (status === 304 && cachedEntry) {
            cachedEntry.at = Date.now();
            return resolve({ status: cachedEntry.status, headers: cachedEntry.headers, text: cachedEntry.text, _cacheHit: true });
          }
          if (status >= 200 && status < 300 && text.length <= _CACHE_BODY_CAP) {
            if (_CACHE.size >= _CACHE_MAX) {
              // drop oldest 10%
              let i = 0; for (const k of _CACHE.keys()) { _CACHE.delete(k); if (++i >= _CACHE_MAX/10) break; }
            }
            _CACHE.set(cKey, { at: Date.now(), status, headers: resp.headers, text, etag: resp.headers.etag || '', negative: false });
          }
        }
        resolve({ status, headers: resp.headers, text });
      });
    });

    r.setTimeout(timeoutMs, () => r.destroy(new Error('Timeout ' + parsed.hostname)));
    r.on('error', (err) => { if (!skipBreaker) _breakerFail(parsed.hostname); reject(err); });

    if (body != null) {
      const pl = typeof body === 'string' ? body : JSON.stringify(body);
      r.setHeader('Content-Type', 'application/json');
      r.setHeader('Content-Length', Buffer.byteLength(pl));
      r.write(pl);
    }
    r.end();
  });
}

// ── Shared 429 gate (Jira) ────────────────────────────────────
// Когда ОДИН запрос получил 429, ВСЕ остальные параллельные ждут
// до окончания cooldown. Иначе каждый чанк retry'ит независимо и
// множит нагрузку → перезапускает 429 в feedback-loop.
let _jiraGateUntil = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function _jiraGateWait() {
  const now = Date.now();
  return now >= _jiraGateUntil ? Promise.resolve() : sleep(_jiraGateUntil - now);
}
function _jiraGateClose(ms) {
  const until = Date.now() + ms;
  if (until > _jiraGateUntil) _jiraGateUntil = until;
}

/** Высокоуровневый Jira-call с retry на 429/5xx. */
async function jiraRequest(cfg, method, apiPath, body, maxGatewayRetries = 5) {
  const target = cfg.jiraBaseUrl.replace(/\/+$/, '') + apiPath;
  const tls = !!cfg.allowInsecureTls;
  const authH = cfg.jiraToken.includes(':')
    ? 'Basic ' + Buffer.from(cfg.jiraToken).toString('base64')
    : 'Bearer ' + cfg.jiraToken;

  const HARD_BUDGET_MS = Number(process.env.JIRA_HARD_BUDGET_MS) || 2 * 60 * 1000;   // 2 мин
  const RATE_LIMIT_MAX = Number(process.env.JIRA_RATE_LIMIT_RETRIES) || 12;
  const t0 = Date.now();
  let delay = 2000, rl429 = 0, gw5xx = 0;

  while (true) {
    if (Date.now() - t0 >= HARD_BUDGET_MS) {
      throw Object.assign(new Error(`Jira request budget exhausted (${rl429} 429s + ${gw5xx} 5xx)`), { status: 0 });
    }
    await _jiraGateWait();
    const resp = await jiraForward({ targetUrl: target, method, headers: { Authorization: authH }, body: body ?? null, allowInsecureTls: tls, timeoutMs: 60000, useCache: false });

    if (resp.status === 429) {
      if (++rl429 > RATE_LIMIT_MAX) throw Object.assign(new Error(`Jira 429 after ${RATE_LIMIT_MAX} retries`), { status: 429 });
      const retryAfterSec = parseInt(resp.headers['retry-after'] || '0', 10);
      const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec * 1000 : delay, 30000);
      _jiraGateClose(waitMs);
      await sleep(waitMs);
      delay = Math.min(delay * 2, 30000);
      continue;
    }
    if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
      if (++gw5xx > maxGatewayRetries) throw Object.assign(new Error(`Jira ${resp.status} gateway`), { status: resp.status });
      await sleep(Math.min(delay, 30000));
      delay = Math.min(delay * 2, 30000);
      continue;
    }
    // Parse
    if (resp.status < 200 || resp.status >= 300) {
      let msg = `Jira ${resp.status}`;
      try {
        const j = JSON.parse(resp.text);
        if (j.errorMessages?.length) msg += ': ' + j.errorMessages.join('; ');
        else if (j.message) msg += ': ' + j.message;
      } catch {}
      throw Object.assign(new Error(msg), { status: resp.status });
    }
    return resp.text ? JSON.parse(resp.text) : {};
  }
}

module.exports = {
  jiraForward, jiraRequest, _cfPathCascade, _cfBuildPathCascade,
  // Для тестов / debug:
  _breakers, _CACHE,
};
```

### 2.5. Config-handlers (`/api/jira/config`, `/api/jira/verify`)

```js
// server/jira-config.js
'use strict';
const path = require('path');
const fs   = require('fs');

const JIRA_DEFAULT_CONFIG = {
  jiraBaseUrl: '', jiraToken: '', jiraProjectKeys: '',
  bitbucketBaseUrl: '', bitbucketToken: '', bitbucketProjectKeys: '',
  confluenceBaseUrl: '', confluenceToken: '', confluenceSpaceKeys: '',
  allowInsecureTls: false,
  sinceDate: '2025-01-01',
  activityWindowHours: 72,
};

function create({ ROOT }) {
  const CONFIG_FILE = path.join(ROOT, 'jira_config.json');

  function jiraReadConfig() {
    try { return { ...JIRA_DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) }; }
    catch { return { ...JIRA_DEFAULT_CONFIG }; }
  }
  function jiraWriteConfig(patch) {
    const next = { ...jiraReadConfig(), ...patch };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }
  /** Стрипает токены, оставляет только has<Svc>Token: bool. */
  function jiraSanitizeConfig(cfg) {
    return {
      jiraBaseUrl: cfg.jiraBaseUrl || '',
      jiraProjectKeys: cfg.jiraProjectKeys || '',
      bitbucketBaseUrl: cfg.bitbucketBaseUrl || '',
      bitbucketProjectKeys: cfg.bitbucketProjectKeys || '',
      confluenceBaseUrl: cfg.confluenceBaseUrl || '',
      confluenceSpaceKeys: cfg.confluenceSpaceKeys || '',
      allowInsecureTls: !!cfg.allowInsecureTls,
      sinceDate: cfg.sinceDate || '2025-01-01',
      activityWindowHours: Number(cfg.activityWindowHours) || 72,
      hasJiraToken:        !!cfg.jiraToken,
      hasBitbucketToken:   !!cfg.bitbucketToken,
      hasConfluenceToken:  !!cfg.confluenceToken,
    };
  }

  async function handleJiraApi(req, res, pathname, helpers) {
    const { writeJson, readBody, isSameOriginRequest, upstream } = helpers;
    try {
      if (req.method === 'POST' && !isSameOriginRequest(req)) {
        return writeJson(res, 403, { error: 'Cross-origin POST запрещён' });
      }

      // ── GET /api/jira/config ────────────────────────────────
      if (pathname === '/api/jira/config' && req.method === 'GET') {
        return writeJson(res, 200, jiraSanitizeConfig(jiraReadConfig()));
      }

      // ── POST /api/jira/config ───────────────────────────────
      if (pathname === '/api/jira/config' && req.method === 'POST') {
        const raw = await readBody(req, 512 * 1024);
        const body = raw ? JSON.parse(raw) : {};
        const patch = {};
        // Whitelist string-полей. Пустое поле = preserve (мы НЕ пишем '').
        for (const k of ['jiraBaseUrl','jiraProjectKeys','bitbucketBaseUrl','bitbucketProjectKeys','confluenceBaseUrl','confluenceSpaceKeys']) {
          if (typeof body[k] === 'string') patch[k] = body[k].trim();
        }
        if (Number.isFinite(+body.activityWindowHours)) {
          patch.activityWindowHours = Math.min(168, Math.max(1, Math.round(+body.activityWindowHours)));
        }
        if (typeof body.allowInsecureTls === 'boolean') patch.allowInsecureTls = body.allowInsecureTls;
        if (typeof body.sinceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.sinceDate.trim())) {
          patch.sinceDate = body.sinceDate.trim();
        }
        // ⚠ Токены: ТОЛЬКО при non-empty значении. Пустое = preserve существующий.
        if (typeof body.jiraToken === 'string' && body.jiraToken)        patch.jiraToken = body.jiraToken;
        if (typeof body.bitbucketToken === 'string' && body.bitbucketToken)   patch.bitbucketToken = body.bitbucketToken;
        if (typeof body.confluenceToken === 'string' && body.confluenceToken) patch.confluenceToken = body.confluenceToken;
        const next = jiraWriteConfig(patch);
        return writeJson(res, 200, jiraSanitizeConfig(next));
      }

      // ── POST /api/jira/verify ───────────────────────────────
      if (pathname === '/api/jira/verify' && req.method === 'POST') {
        const cfg = jiraReadConfig();
        if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
          return writeJson(res, 400, { ok: false, error: 'Нет jiraBaseUrl или токена' });
        }
        try {
          const me = await upstream.jiraRequest(cfg, 'GET', '/rest/api/2/myself');
          return writeJson(res, 200, { ok: true, who: me.displayName || me.name || '?' });
        } catch (e) {
          return writeJson(res, 200, { ok: false, error: e.message });
        }
      }

      writeJson(res, 404, { error: 'Unknown jira API' });
    } catch (e) {
      writeJson(res, e.status && e.status >= 400 ? e.status : 500, { error: e.message });
    }
  }

  return { jiraReadConfig, jiraWriteConfig, jiraSanitizeConfig, handleJiraApi };
}

module.exports = { create };
```

### 2.6. Endpoints интеграций — `/api/integrations/*`

```js
// server/integrations-api.js
'use strict';

function create(deps) {
  const {
    writeJson, readBody, isSameOriginRequest,
    jiraReadConfig, jiraForward, jiraRequest, cfPathCascade, makeAuthHeader,
  } = deps;

  async function handleIntegrationsApi(req, res, pathname) {
    if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST required' });
    if (!isSameOriginRequest(req)) return writeJson(res, 403, { error: 'Cross-origin запрещён' });

    try {
      const raw = await readBody(req, 256 * 1024);
      const body = raw ? JSON.parse(raw) : {};
      const cfg = jiraReadConfig();
      const tls = !!cfg.allowInsecureTls;

      // ── Jira: одна задача ──────────────────────────────────
      if (pathname === '/api/integrations/jira-issue') {
        const key = String(body.key || '').trim();
        if (!key) return writeJson(res, 400, { error: 'Missing key' });
        if (!cfg.jiraBaseUrl || !cfg.jiraToken) return writeJson(res, 400, { error: 'Jira не настроена' });
        const issue = await jiraRequest(cfg, 'GET',
          `/rest/api/2/issue/${encodeURIComponent(key)}?fields=status,assignee,updated,priority,issuetype,labels&expand=names`);
        return writeJson(res, 200, {
          key,
          status:    issue.fields?.status?.name || '',
          assignee:  issue.fields?.assignee?.displayName || '',
          updatedAt: issue.fields?.updated || '',
          priority:  issue.fields?.priority?.name || '',
          issuetype: issue.fields?.issuetype?.name || '',
          labels:    issue.fields?.labels || [],
        });
      }

      // ── Jira: все задачи по configured projects ────────────
      if (pathname === '/api/integrations/jira-fetch-all') {
        if (!cfg.jiraBaseUrl || !cfg.jiraToken) return writeJson(res, 400, { error: 'Jira не настроена' });
        const keys = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!keys.length) return writeJson(res, 400, { error: 'jiraProjectKeys пустой' });
        const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.sinceDate || '')) ? body.sinceDate : (cfg.sinceDate || '2025-01-01');
        const jql = `project in (${keys.map(k => `"${k}"`).join(',')}) AND updated >= "${since}" ORDER BY updated DESC`;

        // Простая sequential pagination (для прода см. jiraSearchAll с параллелизмом).
        const fields = ['summary','status','assignee','updated','priority','issuetype','labels','duedate'];
        const out = [];
        let startAt = 0;
        const PAGE_SIZE = 100, HARD_CAP = 1500;
        while (out.length < HARD_CAP) {
          const page = await jiraRequest(cfg, 'POST', '/rest/api/2/search',
            { jql, startAt, maxResults: PAGE_SIZE, fields });
          const issues = page.issues || [];
          out.push(...issues);
          if (issues.length < PAGE_SIZE) break;
          startAt += PAGE_SIZE;
        }
        const flat = out.slice(0, HARD_CAP).map(it => ({
          key: it.key,
          summary:   it.fields?.summary || '',
          status:    it.fields?.status?.name || '',
          assignee:  it.fields?.assignee?.displayName || '',
          updatedAt: it.fields?.updated || '',
          priority:  it.fields?.priority?.name || '',
          labels:    it.fields?.labels || [],
          issuetype: it.fields?.issuetype?.name || '',
          dueDate:   it.fields?.duedate || '',
        }));
        return writeJson(res, 200, { issues: flat, jql, count: flat.length });
      }

      // ── Bitbucket: PR'ы по Jira-ключу ──────────────────────
      // Поддерживает Cloud (/repositories/.../pullrequests) и Server (/rest/api/1.0/...).
      // Здесь приведён Cloud-вариант — для Server заменить URL и pagination shape.
      if (pathname === '/api/integrations/bitbucket-prs') {
        const jiraKey = String(body.jiraKey || '').trim();
        if (!jiraKey) return writeJson(res, 400, { error: 'Missing jiraKey' });
        if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return writeJson(res, 400, { error: 'Bitbucket не настроен' });

        const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
        const auth = makeAuthHeader(cfg.bitbucketToken);
        const repos = String(cfg.bitbucketProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
        const targets = repos.length ? repos : ['_'];
        const prs = [];

        for (const proj of targets.slice(0, 5)) {                          // cap 5 проектов
          try {
            const url = proj === '_'
              ? `${base}/pullrequests?q=title~"${encodeURIComponent(jiraKey)}"&pagelen=10`
              : `${base}/repositories/${encodeURIComponent(proj)}/pullrequests?q=title~"${encodeURIComponent(jiraKey)}"&pagelen=10`;
            const resp = await jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls });
            if (resp.status < 300) {
              const data = JSON.parse(resp.text);
              for (const pr of (data.values || [])) {
                prs.push({
                  url:       pr.links?.html?.href || '',
                  status:    String(pr.state || '').toLowerCase(),
                  title:     pr.title || '',
                  updatedAt: pr.updated_on || '',
                  reviewers: (pr.reviewers || []).length,
                });
              }
            }
          } catch {}
        }
        return writeJson(res, 200, { prs, jiraKey });
      }

      // ── Bitbucket: verify ─────────────────────────────────
      if (pathname === '/api/integrations/verify-bitbucket') {
        if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) {
          return writeJson(res, 200, { ok: false, error: 'Bitbucket не настроен' });
        }
        const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
        const auth = makeAuthHeader(cfg.bitbucketToken);
        const fwd = (url) => jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls }).catch(() => null);
        // Сначала Server-style endpoint, потом Cloud
        const sr = await fwd(`${base}/rest/api/1.0/profile/recent/repos?limit=1`);
        if (sr && sr.status < 300) return writeJson(res, 200, { ok: true });
        if (sr && sr.status === 401) return writeJson(res, 200, { ok: false, error: 'Неверный токен (401)' });
        const cr = await fwd(`${base}/user`);
        if (cr && cr.status < 300) {
          const d = JSON.parse(cr.text || '{}');
          return writeJson(res, 200, { ok: true, who: d.display_name || d.username || '?' });
        }
        if (cr && cr.status === 401) return writeJson(res, 200, { ok: false, error: 'Неверный токен (401)' });
        return writeJson(res, 200, { ok: false, error: `HTTP ${cr?.status ?? 'нет ответа'}` });
      }

      // ── Confluence: search через CQL + path-cascade ───────
      if (pathname === '/api/integrations/confluence-search') {
        const query = String(body.query || '').trim();
        if (!query) return writeJson(res, 400, { error: 'Missing query' });
        if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return writeJson(res, 400, { error: 'Confluence не настроена' });

        const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
        const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.sinceDate || '')) ? body.sinceDate : (cfg.sinceDate || '2025-01-01');
        const spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        const spaceClause = spaceKeys.length ? ` AND space in (${spaceKeys.map(k => `"${k.replace(/"/g, '\\"')}"`).join(', ')})` : '';
        const cql = `(title ~ "${query.replace(/"/g, '\\"')}" OR text ~ "${query.replace(/"/g, '\\"')}") AND type = page${spaceClause} ORDER BY lastModified DESC`;

        const tryPaths = [
          `${base}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20&expand=version,history.lastUpdated`,
          `${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20&expand=version,history.lastUpdated`,
          // Legacy Server fallback (на старых DC `/content/search` может не быть)
          `${base}/wiki/rest/api/content?type=page&title=${encodeURIComponent(query)}&limit=20&expand=version`,
          `${base}/rest/api/content?type=page&title=${encodeURIComponent(query)}&limit=20&expand=version`,
        ];
        const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
        const cascade = await cfPathCascade(tryPaths, { headers, allowInsecureTls: tls });
        if (cascade.authError) {
          return writeJson(res, 200, { pages: [], query, error: `Confluence ${cascade.authError}: токен просрочен или нет прав`, tried: cascade.tried });
        }
        const pages = [];
        if (cascade.ok) {
          let data;
          try { data = JSON.parse(cascade.text); }
          catch { return writeJson(res, 200, { pages: [], query, error: 'Confluence вернул не-JSON (SSO/HTML)', tried: cascade.tried }); }
          const sinceTs = Date.parse(since + 'T00:00:00Z');
          for (const p of (data.results || [])) {
            const lastMod = p.version?.when || p.history?.lastUpdated?.when || '';
            if (lastMod && Number.isFinite(sinceTs) && Date.parse(lastMod) < sinceTs) continue;
            const webLink = p._links?.base && p._links?.webui ? p._links.base + p._links.webui : '';
            pages.push({ title: p.title || '', url: webLink, lastModified: lastMod });
            if (pages.length >= 5) break;
          }
        }
        return writeJson(res, 200, { pages, query, ...(cascade.ok ? {} : { error: cascade.error || 'недоступен', tried: cascade.tried }) });
      }

      // ── Confluence: verify ─────────────────────────────────
      if (pathname === '/api/integrations/verify-confluence') {
        if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) {
          return writeJson(res, 200, { ok: false, error: 'Confluence не настроена' });
        }
        const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
        const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
        const cascade = await cfPathCascade([
          `${base}/wiki/rest/api/user/current`,
          `${base}/rest/api/user/current`,
          `${base}/wiki/rest/api/space?limit=1`,
          `${base}/rest/api/space?limit=1`,
        ], { headers, allowInsecureTls: tls });
        if (cascade.authError) return writeJson(res, 200, { ok: false, error: `HTTP ${cascade.authError}: токен просрочен или нет прав`, tried: cascade.tried });
        if (cascade.ok) {
          let who = '?';
          try { const d = JSON.parse(cascade.text); who = d.displayName || d.username || (Array.isArray(d.results) ? `${d.results.length} space(s)` : '?'); } catch {}
          return writeJson(res, 200, { ok: true, who, tried: cascade.tried });
        }
        return writeJson(res, 200, { ok: false, error: 'Confluence недоступен', tried: cascade.tried });
      }

      return writeJson(res, 404, { error: 'Unknown integrations endpoint' });
    } catch (e) {
      writeJson(res, 500, { error: e.message });
    }
  }

  return { handleIntegrationsApi };
}

module.exports = { create };
```

### 2.7. LLM proxy — `/api/llm/chat` (GigaChat + OpenAI-compat + SSE)

Это самая нетривиальная часть. Что делает:
1. Принимает OpenAI-compat payload `{ model, messages, stream, temperature, max_tokens }` + (опц.) `apiBaseUrl`, `token` ИЛИ `clientId+clientSecret` (для GigaChat OAuth).
2. Если есть `clientId+clientSecret` — обменивает их на Bearer через OAuth, кэширует токен (TTL ≈ 29 мин), single-flight refresh.
3. Прокидывает запрос upstream, форвардит SSE-стрим клиенту с heartbeat'ом (corp proxy режут idle через 60s).
4. На 401 — один retry с обновлённым токеном.
5. Whitelist хостов для `apiBaseUrl` (защита от token-exfil через подставной хост).
6. Per-user budget cap (по `X-Client-Id` header или IP).

```js
// server/llm.js
'use strict';
const http  = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_BASE  = process.env.GIGACHAT_API_BASE || 'https://gigachat.devices.sberbank.ru/api/v1';
const OAUTH_URL     = process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const OAUTH_SCOPE   = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
const BUDGET_PER_USER = parseInt(process.env.LLM_BUDGET_PER_USER || '300', 10);    // в день

const _tokenCache    = new Map();   // clientId → { token, expiresAt }
const _tokenInflight = new Map();   // clientId → Promise — single-flight
const _budgetPerUser = new Map();   // cid → { count, windowStart }

const _LOCAL = new Set(['localhost','127.0.0.1','0.0.0.0','::1','host.docker.internal']);
function _allowedHosts() {
  const set = new Set();
  try { set.add(new URL(DEFAULT_BASE).host.toLowerCase()); } catch {}
  try { set.add(new URL(OAUTH_URL).host.toLowerCase()); } catch {}
  for (const h of String(process.env.LLM_ALLOWED_HOSTS || '').split(',')) {
    if (h.trim()) set.add(h.trim().toLowerCase());
  }
  return set;
}
function _resolveSafeBase(rawBase) {
  if (!rawBase) return DEFAULT_BASE;
  let host;
  try { host = new URL(rawBase).host.toLowerCase(); } catch { return DEFAULT_BASE; }
  const bare = host.split(':')[0];
  if (_LOCAL.has(bare)) return rawBase;
  if (_allowedHosts().has(host)) return rawBase;
  return DEFAULT_BASE;   // silent fallback на дефолт (а не утечка токена)
}
function _buildEndpoint(base) {
  const n = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  if (n.endsWith('/chat/completions')) return n;
  if (n.endsWith('/v1')) return `${n}/chat/completions`;
  return `${n}/v1/chat/completions`;
}

function isSameOrigin(req) {
  if (process.env.CSRF_DISABLED === '1') return true;
  const o = req.headers.origin || '', r = req.headers.referer || '', host = req.headers.host || '';
  if (!o && !r) return true;
  try { return (o ? new URL(o) : new URL(r)).host === host; } catch { return false; }
}

// ── OAuth (GigaChat) ────────────────────────────────────────
async function gigachatGetToken(clientId, clientSecret) {
  const cached = _tokenCache.get(clientId);
  if (cached && cached.expiresAt - Date.now() > 90_000) return cached.token;

  // Single-flight: если уже летит — присоединяемся.
  const inflight = _tokenInflight.get(clientId);
  if (inflight) return inflight;

  const cred = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const rqUID = [8,4,4,4,12].map(n => Array.from({length:n}, () => Math.floor(Math.random()*16).toString(16)).join('')).join('-');

  const p = new Promise((resolve, reject) => {
    const u = new URL(OAUTH_URL);
    const body = `scope=${encodeURIComponent(OAUTH_SCOPE)}`;
    const transport = u.protocol === 'http:' ? http : https;
    const req = transport.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      headers: {
        Authorization: `Basic ${cred}`,
        RqUID: rqUID,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
      rejectUnauthorized: false,    // Sber internal CA
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 400) return reject(new Error(`OAuth ${res.statusCode}: ${text.slice(0,200)}`));
        let parsed;
        try { parsed = JSON.parse(text); } catch { return reject(new Error('OAuth: invalid JSON')); }
        const token = parsed.access_token;
        if (!token) return reject(new Error('OAuth: no access_token'));
        const expiresAt = typeof parsed.expires_at === 'number' ? parsed.expires_at : (Date.now() + 29*60*1000);
        _tokenCache.set(clientId, { token, expiresAt });
        resolve(token);
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('OAuth timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
  _tokenInflight.set(clientId, p);
  p.finally(() => { if (_tokenInflight.get(clientId) === p) _tokenInflight.delete(clientId); });
  return p;
}

// ── Budget ─────────────────────────────────────────────────
function _checkBudget(req) {
  const cid = (req.headers['x-client-id'] || req.socket.remoteAddress || '?').slice(0, 64);
  const now = Date.now();
  const u = _budgetPerUser.get(cid) || { count: 0, windowStart: now };
  if (now - u.windowStart > 24*3600*1000) { u.count = 0; u.windowStart = now; }
  if (u.count >= BUDGET_PER_USER) return { ok: false, used: u.count, limit: BUDGET_PER_USER, cid };
  u.count++; _budgetPerUser.set(cid, u);
  return { ok: true };
}

// ── SSE forward с heartbeat ────────────────────────────────
function _forwardSSE(upstreamRes, clientRes) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  clientRes.write('event: meta\ndata: {"ok":true}\n\n');
  // Heartbeat — corp proxies режут idle через 60s
  const hb = setInterval(() => {
    try { if (!clientRes.writableEnded) clientRes.write(': ping\n\n'); } catch {}
  }, 25_000);
  const cleanup = () => clearInterval(hb);
  clientRes.on('close', cleanup);
  clientRes.on('error', cleanup);
  upstreamRes.on('data', c => { try { clientRes.write(c); } catch {} });
  upstreamRes.on('end', () => {
    cleanup();
    try { clientRes.write('data: [DONE]\n\n'); clientRes.end(); } catch {}
  });
  upstreamRes.on('error', cleanup);
}

// ── Main handler ───────────────────────────────────────────
function create({ readBody, writeJson, MAX_BODY }) {
  function proxyChat(req, res) {
    if (!isSameOrigin(req)) return writeJson(res, 403, { error: 'Cross-origin запрещён' });
    const budget = _checkBudget(req);
    if (!budget.ok) return writeJson(res, 429, { error: `LLM-бюджет: ${budget.used}/${budget.limit} запросов / 24ч` });

    readBody(req, MAX_BODY).then(async (raw) => {
      const body = raw ? JSON.parse(raw) : {};
      const clientId     = String(body.clientId     || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      let   token        = String(body.token        || '').trim() || process.env.GIGACHAT_ACCESS_TOKEN || '';

      // Если переданы clientId+clientSecret — обмениваем на Bearer
      if (clientId && clientSecret) {
        try { token = await gigachatGetToken(clientId, clientSecret); }
        catch (e) { return writeJson(res, 502, { error: 'OAuth failed: ' + e.message }); }
      }
      if (!token) return writeJson(res, 400, { error: 'Нет токена. Укажите token или clientId+clientSecret.' });

      const safeBase = _resolveSafeBase(body.apiBaseUrl);
      const endpoint = _buildEndpoint(safeBase);
      const u = new URL(endpoint);

      const payload = {
        model:       body.model || 'GigaChat-2',
        messages:    Array.isArray(body.messages) ? body.messages : [],
        stream:      body.stream !== false,
        temperature: Number.isFinite(+body.temperature) ? +body.temperature : 0.2,
        max_tokens:  Number.isFinite(+body.max_tokens)  ? +body.max_tokens  : 900,
      };
      const payloadRaw = JSON.stringify(payload);

      const doReq = (bearer, retryOn401) => {
        const transport = u.protocol === 'http:' ? http : https;
        const upstreamReq = transport.request({
          method: 'POST',
          hostname: u.hostname,
          port: u.port || (u.protocol === 'http:' ? 80 : 443),
          path: u.pathname + u.search,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bearer}`,
            Accept: payload.stream ? 'text/event-stream' : 'application/json',
            'Content-Length': Buffer.byteLength(payloadRaw),
          },
          rejectUnauthorized: false,
        }, (upstream) => {
          const status = upstream.statusCode || 500;
          // 401 → один retry с refreshed-token
          if (status === 401 && retryOn401 && clientId && clientSecret) {
            const errChunks = [];
            upstream.on('data', c => errChunks.push(c));
            upstream.on('end', () => {
              _tokenCache.delete(clientId);
              gigachatGetToken(clientId, clientSecret)
                .then(nt => doReq(nt, false))
                .catch(e => { if (!res.writableEnded) writeJson(res, 502, { error: 'token refresh failed: ' + e.message }); });
            });
            return;
          }
          if (status >= 400) {
            const errChunks = [];
            upstream.on('data', c => errChunks.push(c));
            upstream.on('end', () => {
              const text = Buffer.concat(errChunks).toString('utf-8');
              let parsed; try { parsed = JSON.parse(text); } catch {}
              if (!res.writableEnded) writeJson(res, status, { error: 'LLM upstream error', status, details: parsed || text });
            });
            return;
          }
          if (payload.stream) _forwardSSE(upstream, res);
          else {
            const chunks = [];
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            upstream.on('data', c => { chunks.push(c); res.write(c); });
            upstream.on('end', () => res.end());
          }
        });
        req.on('close', () => { if (!res.writableEnded) upstreamReq.destroy(); });
        upstreamReq.on('error', err => {
          if (!res.writableEnded) writeJson(res, 502, { error: 'Proxy failed: ' + err.message });
        });
        upstreamReq.write(payloadRaw); upstreamReq.end();
      };
      doReq(token, true);
    }).catch(err => writeJson(res, 400, { error: 'Invalid body: ' + err.message }));
  }
  return { proxyChat };
}

module.exports = { create };
```

---

## 3. Браузерная часть

### 3.1. localStorage shape

```js
// q2_integrations_v1 — единственный ключ для всех настроек
{
  jiraBaseUrl: 'https://...',
  jiraProjectKeys: 'PAY, SBOF',
  jiraToken: 'Bearer ...',                 // raw — НЕ отдаём в LLM payload
  bitbucketBaseUrl: '...', bitbucketProjectKeys: '...', bitbucketToken: '...',
  confluenceBaseUrl: '...', confluenceSpaceKeys: '...', confluenceToken: '...',
  allowInsecureTls: false,
  sinceDate: '2025-01-01',
  lastSync: null,
}
```

### 3.2. Store с server-truth fallback

Главный момент — **server-side `jira_config.json` source of truth**, localStorage — кэш для UI. Если юзер открыл fresh browser, токенов в localStorage нет, но `GET /api/jira/config` вернёт `hasJiraToken: true` — мы знаем что API-вызов сработает.

```js
// integrationsStore.js
const KEY = 'q2_integrations_v1';
const DEFAULTS = {
  jiraBaseUrl: '', jiraProjectKeys: '',
  bitbucketBaseUrl: '', bitbucketProjectKeys: '',
  confluenceBaseUrl: '', confluenceSpaceKeys: '',
  allowInsecureTls: false, sinceDate: '2025-01-01', lastSync: null,
};

let _serverState = null;   // null = not hydrated

export function loadSettingsRaw() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

/** Для UI: токены замаскированы в has<Svc>Token: bool */
export function loadSettings() {
  const raw = loadSettingsRaw();
  const srv = _serverState || {};
  return {
    jiraBaseUrl: raw.jiraBaseUrl || srv.jira?.baseUrl || '',
    hasJiraToken: !!raw.jiraToken || !!srv.jira?.hasToken,
    bitbucketBaseUrl: raw.bitbucketBaseUrl || srv.bitbucket?.baseUrl || '',
    hasBitbucketToken: !!raw.bitbucketToken || !!srv.bitbucket?.hasToken,
    confluenceBaseUrl: raw.confluenceBaseUrl || srv.confluence?.baseUrl || '',
    hasConfluenceToken: !!raw.confluenceToken || !!srv.confluence?.hasToken,
    sinceDate: raw.sinceDate, allowInsecureTls: raw.allowInsecureTls,
  };
}

export function saveSettings(patch) {
  const raw = loadSettingsRaw();
  const ALLOWED = [
    'jiraBaseUrl','jiraProjectKeys','jiraToken',
    'bitbucketBaseUrl','bitbucketProjectKeys','bitbucketToken',
    'confluenceBaseUrl','confluenceSpaceKeys','confluenceToken',
    'sinceDate',
  ];
  const next = { ...raw };
  for (const k of ALLOWED) {
    if (k in patch && typeof patch[k] === 'string') next[k] = patch[k];
  }
  if ('allowInsecureTls' in patch) next.allowInsecureTls = !!patch.allowInsecureTls;
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch (e) { /* QuotaExceeded — server-side всё равно сохранил */ }
  return loadSettings();
}

/** Boot: вытягиваем server-truth (без токенов). */
export async function hydrateFromServer() {
  try {
    const r = await fetch('/api/jira/config', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const cfg = await r.json();
    _serverState = {
      jira:       { hasToken: !!cfg.hasJiraToken,       baseUrl: cfg.jiraBaseUrl       || '' },
      bitbucket:  { hasToken: !!cfg.hasBitbucketToken,  baseUrl: cfg.bitbucketBaseUrl  || '' },
      confluence: { hasToken: !!cfg.hasConfluenceToken, baseUrl: cfg.confluenceBaseUrl || '' },
    };
    return cfg;
  } catch { return null; }
}

export function isConfigured(service) {
  const raw = loadSettingsRaw();
  const map = {
    jira:       { url: 'jiraBaseUrl',       tok: 'jiraToken' },
    bitbucket:  { url: 'bitbucketBaseUrl',  tok: 'bitbucketToken' },
    confluence: { url: 'confluenceBaseUrl', tok: 'confluenceToken' },
  };
  const m = map[service];
  const srv = _serverState?.[service];
  return !!(raw[m.url] || srv?.baseUrl) && !!(raw[m.tok] || srv?.hasToken);
}

/** Сохранение на сервер. Пустой токен НЕ отправляем — preserve existing. */
export async function postServerConfig(patch) {
  // Нормализация: если поле токена в patch — отправляем; иначе нет.
  // Сервер сам игнорит пустые строки токенов, но мы тоже не шлём ненужное.
  const r = await fetch('/api/jira/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
```

### 3.3. proxyPost — общий helper для интеграций

```js
// integrationsSync.js
import { Utils } from './utils.js';

/** 90s timeout — корп Jira может тянуть Pulse дольше дефолта. */
async function proxyPost(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg;
    try {
      const parsed = JSON.parse(text);
      errMsg = parsed.error || `HTTP ${res.status}`;
    } catch {
      errMsg = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    }
    throw new Error(errMsg);
  }
  return res.json();
}

export async function syncJiraRow(row) {
  if (!row.jiraKey) return null;
  try {
    const d = await proxyPost('/api/integrations/jira-issue', { key: row.jiraKey });
    return { id: row.id, jiraStatus: d.status, jiraAssignee: d.assignee, jiraUpdatedAt: d.updatedAt };
  } catch (e) { console.warn('[Jira sync]', row.jiraKey, e.message); return null; }
}

export async function syncBitbucketRow(row) {
  if (!row.jiraKey) return null;
  try {
    const d = await proxyPost('/api/integrations/bitbucket-prs', { jiraKey: row.jiraKey });
    const pr = d.prs?.[0]; if (!pr) return null;
    return { id: row.id, prUrl: pr.url, prStatus: pr.status, prUpdatedAt: pr.updatedAt };
  } catch (e) { console.warn('[BB sync]', row.jiraKey, e.message); return null; }
}

export async function syncConfluenceRow(row, { sinceDate } = {}) {
  const q = row.jiraKey || row.epic || '';
  if (!q) return null;
  try {
    const d = await proxyPost('/api/integrations/confluence-search', { query: q, ...(sinceDate ? { sinceDate } : {}) });
    const page = d.pages?.[0]; if (!page) return null;
    return { id: row.id, docUrl: page.url, docTitle: page.title };
  } catch (e) { console.warn('[CF sync]', q, e.message); return null; }
}

export async function verifyJira()       { try { return await proxyPost('/api/jira/verify', {}); }                   catch (e) { return { ok: false, error: e.message }; } }
export async function verifyBitbucket()  { try { return await proxyPost('/api/integrations/verify-bitbucket', {}); } catch (e) { return { ok: false, error: e.message }; } }
export async function verifyConfluence() { try { return await proxyPost('/api/integrations/verify-confluence', {}); } catch (e) { return { ok: false, error: e.message }; } }
```

### 3.4. LLM streaming client

```js
// llmClient.js — frontend
async function callLLMStream(messages, settings, onDelta, abortSignal) {
  // settings: { apiMode: 'proxy'|'direct', apiBaseUrl, model, temperature, maxTokens, token?, clientId?, clientSecret? }
  const proxyEndpoint = '/api/llm/chat';
  const body = {
    model: settings.model || 'GigaChat-2',
    temperature: Number(settings.temperature ?? 0.2),
    max_tokens: Math.max(64, Number(settings.maxTokens) || 900),
    stream: true,
    messages,
    apiBaseUrl: settings.apiBaseUrl || '',
    // ⚠ Передаём ИЛИ token, ИЛИ пару clientId+clientSecret — никогда не оба.
    ...(settings.clientId && settings.clientSecret
      ? { clientId: settings.clientId, clientSecret: settings.clientSecret }
      : { token: settings.token || '' }),
  };
  const res = await fetch(proxyEndpoint, {
    method: 'POST',
    signal: abortSignal,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': settings.clientId || 'anonymous',         // для budget per-user
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  // Parse SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trim = line.trim();
      if (!trim || trim.startsWith(':')) continue;             // heartbeat ': ping'
      if (!trim.startsWith('data:')) continue;
      const data = trim.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const obj = JSON.parse(data);
        const delta = obj.choices?.[0]?.delta?.content || obj.choices?.[0]?.message?.content || '';
        if (delta) onDelta(delta);
      } catch {}
    }
  }
}
```

---

## 4. Контракты безопасности (Чек-лист)

Перед merge'ом любой новой интеграции:

- [ ] Токен **не возвращается** из server → frontend. Только `has<Svc>Token: bool`.
- [ ] **Empty token field** в UI = preserve existing на сервере (`if (body.tok) patch.tok = body.tok`).
- [ ] Empty URL field в UI = preserve (тот же паттерн).
- [ ] Все outbound — через `makeAuthHeader` (никаких inline `Bearer ${token}`).
- [ ] Error-paths имеют **token-redact regex** перед throw / log.
- [ ] **SSRF guard** в `jiraForward` блокирует 127.0.0.1 / link-local (override через env для тестов).
- [ ] **CSRF**: `isSameOriginRequest` на всех мутирующих POST (`/api/jira/config`, `/api/llm/chat`, `/api/integrations/*`).
- [ ] Whitelist хостов для `apiBaseUrl` в LLM (атакующий мог бы подставить evil.com).
- [ ] LLM payload **никогда не содержит** raw tokens / passwords / accountIds. Перед отправкой в LLM прогнать через `_scrubSecrets`.
- [ ] HTML insert в DOM — только через `escapeHtml`.
- [ ] CSV export — все ячейки через `escapeCSV` (ZWSP-prefix для значений начинающихся с `= + - @ \t \r` — formula injection guard).
- [ ] Rate-limit `/api/*` (default 60 req/min/IP).
- [ ] Response cap 64 MB на `jiraForward` (защита от OOM на огромных changelog'ах).

---

## 5. Гранат-гранки (типичные подводные камни)

| Что | Почему ломается | Решение |
|---|---|---|
| Confluence path | Cloud на `/wiki/rest/...`, DC на `/rest/...` | Path-cascade: пробовать оба, `Accept: application/json` обязателен |
| Jira 429 storms | Per-chunk retry без координации → feedback-loop | **Shared gate**: один 429 — все остальные ждут (`_jiraGateClose / _jiraGateWait`) |
| Long Pulse запрос | Frontend timeout 15s, server per-PK budget 90s → orphan | Frontend `AbortSignal.timeout(90000)` matching server |
| Corp proxy режет SSE | Idle timeout 60s — стрим обрывается | **Heartbeat** `: ping\n\n` каждые 25s |
| GigaChat OAuth race | 2 параллельных запроса → 2 OAuth-fetch → второй перетёр первый | **Single-flight** `_tokenInflight.get/set` |
| F5 после clean storage | Токены в `jira_config.json` есть, но `localStorage` пустой → UI «не настроено» | `hydrateFromServer()` на boot, `isConfigured()` смотрит ОБА источника |
| CSV `=HYPERLINK("evil")` | Excel выполнит формулу при открытии | `escapeCSV` префиксует ZWSP `​` для опасных лидов |
| Jira changelog 100 MB | OOM на сервере | `maxResponseBytes: 64 * 1024 * 1024` в `jiraForward` |
| Echo'ed Authorization | Некоторые proxies возвращают header в body → попадает в логи | `redactSecretsInText` на всех error-paths |
| `_buildEndpoint('http://x/v1/chat/completions')` | Двойной суффикс `/chat/completions/chat/completions` | Idempotent check: `if (n.endsWith('/chat/completions')) return n` |

---

## 6. Порядок имплементации (от простого к сложному)

1. **Минимум жизнеспособного**: `server.js` + `jira_config.json` + `GET/POST /api/jira/config` + `POST /api/jira/verify`. Frontend: Settings modal + `hydrateFromServer`. Тест: положить `jiraBaseUrl` + `jiraToken` через UI, нажать «Проверить» → `who: 'Иванов И.'`.
2. **Jira sync**: `/api/integrations/jira-issue` + `jiraForward` + `jiraRequest` (без circuit-breaker и cache — добавятся после). `proxyPost` + `syncJiraRow` на фронте. Тест: одна задача синхронизируется.
3. **Bitbucket**: `/api/integrations/bitbucket-prs` + `/verify-bitbucket`. Заметь Server vs Cloud разница в URL.
4. **Confluence**: `/api/integrations/confluence-search` + `/verify-confluence` + path-cascade helper.
5. **Resilience**: circuit-breaker, HTTP cache, shared 429 gate. Тесты — fake-сервер возвращает 429 / 5xx / 200 в разных пропорциях.
6. **Bulk fetch**: `/api/integrations/jira-fetch-all` с pagination. Для прода — параллельная pagination (см. `jiraSearchAll` в исходнике, ×2.5 throughput).
7. **LLM**: `/api/llm/chat` с GigaChat OAuth + SSE forwarding + heartbeat + 401-retry. Frontend: `callLLMStream` с SSE-parser'ом.

---

## 7. Что вынесено за скобки (если потребуется потом)

| Возможность | Где смотреть в исходнике |
|---|---|
| **Sigma Jira** (второй инстанс с goal-эпиками + Domain link expansion) | `server/integrations/blackDashboard.js`, async-job pattern |
| **Pulse pipeline** (Jira+BB+CF aggregated per-team, identity-deterministic attribution) | `integrations/portfolioPulseModel.js` (analyse) + `server/pulse-runner.js` (fetch) |
| **Jenkins CI integration** (builds, culprits, deploy frequency) | `server/jenkins.js`, `docs/integrations/jenkins.md` |
| **Zephyr/Xray Tests** | `server/zephyr.js` + `jiraResolveZephyrResultFieldId` |
| **Identity-deterministic attribution** (employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId} → BB/CF lookup без fuzzy-name match) | `integrations/portfolioPulseModel.js` § `_byEmail/_byJiraId/_byBbLogin/_byCfId` |
| **Bulk identity resolver** (по email массово найти BB-slug и CF-accountId) | `server/integrations-api.js` `/resolve-identities` |
| **Differential JQL cache** (при тёплом cache берём delta `updated >= lastFetched - 3h`, потом union) | `server/jira-helpers.js` `_recentBucketCache` |
| **Adaptive page-size** (на 429 storm понижаем 100 → 50 → 25, sticky) | `server/upstream.js` `jiraSearchAll` `PAGE_SIZE_LADDER` |
| **Confluence audit log** (`/rest/api/audit` — кто логинился последние 72h) | `/api/integrations/confluence-audit-logins` endpoint |
| **TechInfo diagnostic** (live-check всех 3 интеграций + version-probe) | `server/integrations/techInfo.js` |

---

## 8. Минимальные тесты

Положить в `tests/` (node:test):

```js
// tests/auth-helpers.test.js
const test = require('node:test');
const assert = require('node:assert');
const { makeAuthHeader, redactSecretsInText } = require('../server/auth-helpers.js');

test('makeAuthHeader: Bearer prefix preserved', () => {
  assert.equal(makeAuthHeader('Bearer abc'), 'Bearer abc');
});
test('makeAuthHeader: email:token → Basic', () => {
  const h = makeAuthHeader('user@co:pat-123');
  assert.match(h, /^Basic /);
  assert.equal(Buffer.from(h.slice(6), 'base64').toString(), 'user@co:pat-123');
});
test('makeAuthHeader: raw PAT → Bearer prefix added', () => {
  assert.equal(makeAuthHeader('pat-abc'), 'Bearer pat-abc');
});
test('makeAuthHeader: empty → empty string', () => {
  assert.equal(makeAuthHeader(''), '');
});

test('redactSecretsInText: Bearer scrubbed', () => {
  const safe = redactSecretsInText('Failed: Bearer eyJh-secret-token-here');
  assert.match(safe, /Bearer \*\*\*/);
  assert.ok(!safe.includes('eyJh'));
});
test('redactSecretsInText: token= scrubbed', () => {
  assert.match(redactSecretsInText('error token=abc123'), /token: \*\*\*/);
});
```

```js
// tests/config-leak.test.js — токен НЕ возвращается через GET /api/jira/config
const test = require('node:test');
const assert = require('node:assert');
const { jiraSanitizeConfig } = require('../server/jira-config.js').create({ ROOT: __dirname });

test('sanitize: tokens stripped, has<Svc>Token bool emitted', () => {
  const cfg = { jiraBaseUrl: 'https://x', jiraToken: 'SECRET-XYZ', bitbucketToken: '' };
  const out = jiraSanitizeConfig(cfg);
  assert.equal(out.jiraBaseUrl, 'https://x');
  assert.equal(out.hasJiraToken, true);
  assert.equal(out.hasBitbucketToken, false);
  assert.equal(out.jiraToken, undefined);
  // Финальная проверка: stringified output не содержит 'SECRET-XYZ'
  assert.ok(!JSON.stringify(out).includes('SECRET-XYZ'));
});
```

---

## 9. Финальный sanity check

После того как всё построено, проверь:

```bash
# 1. Конфиг — токен не возвращается
curl -s http://localhost:8080/api/jira/config | jq '.jiraToken'
# Должно быть null / отсутствовать
curl -s http://localhost:8080/api/jira/config | jq '.hasJiraToken'
# true

# 2. Пустой токен при сохранении — НЕ стирает существующий
curl -s -X POST http://localhost:8080/api/jira/config \
  -H 'Content-Type: application/json' \
  -d '{"jiraBaseUrl":"https://new"}'
cat jira_config.json | jq '.jiraToken'        # должен остаться прежним

# 3. Verify
curl -s -X POST http://localhost:8080/api/jira/verify
# {"ok":true,"who":"..."}

# 4. SSRF guard
curl -s -X POST http://localhost:8080/api/jira/config \
  -H 'Content-Type: application/json' \
  -d '{"jiraBaseUrl":"http://127.0.0.1:9200"}'
curl -s -X POST http://localhost:8080/api/jira/verify
# error: "Blocked outbound to 127.0.0.1 (SSRF: loopback)"

# 5. Rate limit
for i in {1..80}; do curl -s http://localhost:8080/api/jira/config >/dev/null; done
# Последние ~20 должны вернуть 429
```

---

## 10. Файлы для копирования

Если другой агент будет переносить — конкретные файлы прода (на которые опирается guide):

- `server.js` — bootstrap (~1.8k LOC, можно сильно ужать для нового проекта)
- `server/upstream.js` — `jiraForward` + cache + breaker (~610 LOC)
- `server/auth-helpers.js` — было `server/integrations/authHelpers.js` (~50 LOC)
- `server/jira-api.js` — config + verify (~260 LOC)
- `server/integrations-api.js` — route handlers (~1400 LOC, для базового набора нужно ~400)
- `server/llm.js` — GigaChat proxy (~560 LOC)
- `integrations/integrationsStore.js` — frontend store (~235 LOC)
- `integrations/integrationsSync.js` — frontend proxyPost + sync helpers (~360 LOC)
- `app/llmAssistant.js` — frontend LLM client (большой, ~1700 LOC; для базы нужна функция `callGigaChatStream` ~50 LOC)

**Без чего точно не обойтись:**
1. `makeAuthHeader` (5 строк, но критично — три формата токена)
2. `jiraForward` (~100 строк) — низкоуровневый HTTP с SSRF + breaker + cache
3. Path-cascade для Confluence (~20 строк) — иначе 50/50 что не заработает
4. CSRF + non-empty token guard на POST /api/jira/config (~10 строк) — без них можно случайно стереть токен или принять cross-origin patch
5. Heartbeat в SSE forwarder (~3 строки `setInterval`) — без него corp-proxies режут стрим

Всё остальное — нюансы которые добавятся по мере надобности.
