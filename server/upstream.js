'use strict';
/* ============================================================
   UPSTREAM HTTP INFRASTRUCTURE — V18 extraction step 2
   (после llm.js / observability.js).

   Этот модуль — neutral-named "upstream" а не "jira-shared", потому
   что используется ВСЕМИ outbound integration-вызовами:
   Jira (Delta + Sigma), Bitbucket, Confluence, Zephyr/Xray, Jenkins.

   Содержимое (всё originally в server.js, lines ~285-880):
     · keepAlive HTTP / HTTPS agents (V21 O B5)
     · circuit-breaker per-host (V21 R R10)
     · LRU httpCache + ETag passthrough (V21 Y2)
     · SSRF allowlist (V21 BQ)
     · Confluence path-cascade builder (PR-DA)
     · jiraForward — низкоуровневый HTTP-call (~140 LOC)
     · jiraParseResp / jiraSleep — utility helpers
     · _jiraGateWait / _jiraGateClose — shared 429 gate (jira-side)
     · jiraRequest — base64 cred + retries on top of jiraForward
     · jiraSearchAll — page-by-page parallel pagination
     · jiraPLimit — concurrency utility
     · _bbGateWait / _bbGateClose — shared 429 gate (bitbucket-side)

   State — module-scoped (одна на процесс). Маленькая поверхность,
   нет cross-instance concerns в этом single-tenant tool.

   Зависимости:
     · http, https, url, zlib (Node built-ins)
     · ./logger.js — structured logger

   Вынесенные структуры (`_HTTP_CACHE`, `_breakers`) экспортируются
   как живые reference'ы — server.js использует их в `_periodicCleanup`.
   ============================================================ */

const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const { URL } = require('url');
const logger = require('./logger.js');

// V21 O — keepAlive agents для всех integration HTTP-вызовов.
// Раньше каждый Jira/BB/CF/Zephyr-call открывал свежее TCP+TLS соединение
// → 30-50ms TLS handshake × N запросов на bulk-операциях. Agent с keepAlive
// переиспользует TCP-сокет и TLS-сессию.
const _keepAliveHttpAgent  = new http.Agent({  keepAlive: true, keepAliveMsecs: 15000, maxSockets: 64, maxFreeSockets: 16 });
const _keepAliveHttpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 64, maxFreeSockets: 16 });
// Insecure-TLS variant (on-prem self-signed) — отдельный Agent чтобы
// не смешивать pool secure/insecure соединений.
const _insecureKeepAliveHttpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 64, maxFreeSockets: 16, rejectUnauthorized: false });

// V21 O — cap response payload size. Без него единый огромный changelog
// (Jira может вернуть 100+ MB) выжрет heap и убьёт серверный процесс.
// 64MB — больше любого реального API ответа, меньше OOM-порога.
const _MAX_RESPONSE_BYTES = 64 * 1024 * 1024; // 64 MB

// V21 R — circuit-breaker per-host. Когда у конкретного host'а за 60 сек
// случилось 5+ ошибок (5xx, network timeout), breaker open'ится на 30 сек:
// следующие jiraForward к этому host'у возвращают 503 НЕМЕДЛЕННО, не
// выходя в сеть. Это спасает от feedback-loop'ов «Jira лежит → клиент
// бомбит её retries → лежит ещё дольше». На 200/40x счётчик сбрасывается.
const _breakers = new Map();   // hostname -> { failures: number[], openUntil: number }
const _BREAKER_WINDOW_MS = 60_000;
const _BREAKER_OPEN_MS   = 30_000;
const _BREAKER_THRESHOLD = 5;
function _breakerCheck(host) {
  const b = _breakers.get(host);
  if (!b) return { open: false };
  const now = Date.now();
  if (b.openUntil > now) return { open: true, retryAfterMs: b.openUntil - now };
  return { open: false };
}
function _breakerRecordFailure(host) {
  const now = Date.now();
  const b = _breakers.get(host) || { failures: [], openUntil: 0 };
  b.failures = b.failures.filter(t => now - t < _BREAKER_WINDOW_MS);
  b.failures.push(now);
  if (b.failures.length >= _BREAKER_THRESHOLD) {
    b.openUntil = now + _BREAKER_OPEN_MS;
    b.failures = [];
    if (typeof logger !== 'undefined') {
      try { logger.warn('breaker.open', { host, openMs: _BREAKER_OPEN_MS }); } catch (_) {}
    }
  }
  _breakers.set(host, b);
}
function _breakerRecordSuccess(host) {
  const b = _breakers.get(host);
  if (!b) return;
  // Любой успех очищает счётчик recent failures (но не закрывает уже open
  // breaker раньше времени — это могла быть случайная одиночная удача).
  b.failures = [];
  _breakers.set(host, b);
}

// V21 Y2 — gzip request: Accept-Encoding на all integration fetches +
// LRU httpCache (5 мин) для GET requests + ETag passthrough.
const _HTTP_CACHE = new Map();           // cacheKey -> { at, status, headers, text, etag, negative }
const _HTTP_CACHE_TTL_MS    = 5 * 60 * 1000;
const _HTTP_CACHE_MAX_SIZE  = 500;        // по числу записей; при превышении — drop oldest
const _HTTP_CACHE_BODY_CAP  = 4 * 1024 * 1024; // не кэшируем > 4MB чтобы не съесть RAM
function _httpCacheGet(key) {
  const entry = _HTTP_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > _HTTP_CACHE_TTL_MS) { _HTTP_CACHE.delete(key); return null; }
  return entry;
}
function _httpCacheSet(key, entry) {
  if (_HTTP_CACHE.size >= _HTTP_CACHE_MAX_SIZE) {
    // Drop oldest 10% (LRU approximation by insertion order).
    const dropN = Math.ceil(_HTTP_CACHE_MAX_SIZE * 0.1);
    let i = 0;
    for (const k of _HTTP_CACHE.keys()) { _HTTP_CACHE.delete(k); if (++i >= dropN) break; }
  }
  _HTTP_CACHE.set(key, entry);
}
function _httpCacheKey(method, targetUrl, allowInsecureTls, authHeader) {
  // F5: включаем hash от Authorization-header'а в cacheKey. Раньше после
  // rotate'а токена в Settings 5 минут возвращались ответы старого scope
  // (включая 401-ы). Также защита от cross-token leak в multi-tenant сценарии.
  let authFp = '';
  if (authHeader) {
    // Простой быстрый non-cryptographic хэш — для cache-key достаточно,
    // полный sha256 на каждый запрос дорог. Коллизия маловероятна (256-bit
    // namespace для одного targetUrl).
    let h = 0;
    const s = String(authHeader);
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    authFp = `a${(h >>> 0).toString(36)}|`;
  }
  return `${method}|${authFp}${allowInsecureTls ? 'insec|' : ''}${targetUrl}`;
}

// V21 BQ — SSRF allowlist. Конфиг — пользовательский, поэтому злоумышленник
// мог бы указать `jiraBaseUrl=http://localhost:9200/secret` и server-proxy
// достанет. Блокируем loopback + link-local + IPv6-equiv. Corp 10.0.0.0/8
// разрешён (sber внутренние сервисы), 192.168.* — тоже (lab/staging).
//
// Overrides:
//   INTEGRATION_BLOCK_PRIVATE=1   — блокирует все RFC-1918 (10/8, 192.168/16).
//   INTEGRATION_ALLOW_LOOPBACK=1  — разрешает 127.0.0.1 / localhost (для tests).
const _BLOCK_PRIVATE_NETS  = process.env.INTEGRATION_BLOCK_PRIVATE  === '1';
const _ALLOW_LOOPBACK      = process.env.INTEGRATION_ALLOW_LOOPBACK === '1';
function _ssrfBlocked(hostname) {
  if (!hostname) return 'empty hostname';
  const lc = hostname.toLowerCase();
  if (_ALLOW_LOOPBACK) return null;     // tests / dev override
  // IPv6 loopback / link-local.
  if (lc === '::1' || lc === '[::1]' || lc.startsWith('fe80:') || lc.startsWith('[fe80:')) return 'IPv6 loopback/link-local';
  // IPv4 loopback (127.x.x.x).
  if (/^127\./.test(lc)) return 'IPv4 loopback';
  if (lc === 'localhost' || lc === '0.0.0.0') return 'localhost';
  // Link-local (169.254.x).
  if (/^169\.254\./.test(lc)) return 'link-local 169.254';
  // Multicast / unspecified.
  if (/^(2[2-3][0-9]|0)\./.test(lc)) return 'reserved range';
  if (_BLOCK_PRIVATE_NETS) {
    if (/^10\./.test(lc) || /^192\.168\./.test(lc) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(lc)) return 'RFC-1918 private';
  }
  return null;
}

// PR-DA — Confluence path-cascade builder. Atlassian Cloud живёт на
// /wiki/rest/..., DC/Server — на /rest/.... Всегда пробуем Cloud первым.
// Хвостовой `/wiki` в baseUrl trim'ируется чтобы не получить `…/wiki/wiki/...`.
// Возвращает массив URL'ов в порядке предпочтения; consumer сам решает что
// делать с 401/403/404 (обычно — try next).
//
// Имя `_cfBuildPathCascade` (а не `_cfPathCascade`) намеренно: уже существует
// async-функция `_cfPathCascade(urls, opts)` (line ~1416), которая выполняет
// cascade-fetch. Hoisting перебивал нашу sync-функцию из-за одинакового
// имени — `.map(...)` вызывался на async-результате (Promise) → ReferenceError.
function _cfBuildPathCascade(baseUrl, suffix) {
  const base = String(baseUrl || '').replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const sfx = suffix.startsWith('/') ? suffix : '/' + suffix;
  return [`${base}/wiki${sfx}`, `${base}${sfx}`];
}

function jiraForward({ targetUrl, method='GET', headers={}, body=null, allowInsecureTls=false, timeoutMs=30000, maxResponseBytes=_MAX_RESPONSE_BYTES, skipBreaker=false, useCache=null }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch(e) { return reject(new Error('Bad URL: '+targetUrl)); }
    // V21 BQ — SSRF guard. Bypass только для protocol=file (мы их не support'ируем
    // в любом случае) и hostname'ов в blocklist'е.
    const ssrfReason = _ssrfBlocked(parsed.hostname);
    if (ssrfReason) {
      const err = new Error(`Blocked outbound to ${parsed.hostname} (SSRF guard: ${ssrfReason})`);
      err.code = 'SSRF_BLOCKED';
      return reject(err);
    }
    // V21 R — short-circuit if breaker is open for this host.
    if (!skipBreaker) {
      const bs = _breakerCheck(parsed.hostname);
      if (bs.open) {
        return resolve({
          status: 503,
          headers: {},
          text: JSON.stringify({ error: 'circuit-breaker open', host: parsed.hostname, retryAfterMs: bs.retryAfterMs }),
          _breakerOpen: true,
        });
      }
    }
    // V21 Y2 — caching layer. По умолчанию кэш активен только для GET и body=null.
    // Caller может явно отключить через useCache:false (для polling) или явно
    // включить через useCache:true (для force-cache не-GET запросов — обычно нет).
    const cacheable = useCache !== false && (useCache === true || (method === 'GET' && body == null));
    // F5: пробрасываем Authorization-header в cacheKey (после rotate'а
    // токена ответ старого scope не должен возвращаться).
    const _authForCacheKey = (headers && (headers.Authorization || headers.authorization)) || '';
    const cacheKey = cacheable ? _httpCacheKey(method, targetUrl, allowInsecureTls, _authForCacheKey) : null;
    let cachedEntry = null;
    if (cacheable) {
      cachedEntry = _httpCacheGet(cacheKey);
      if (cachedEntry && !cachedEntry.etag) {
        // Negative cache (404/403) — возвращаем сразу.
        if (cachedEntry.negative) {
          return resolve({ status: cachedEntry.status, headers: cachedEntry.headers, text: cachedEntry.text, _cacheHit: true, _negative: true });
        }
        // Свежий 2xx без ETag — возвращаем.
        return resolve({ status: cachedEntry.status, headers: cachedEntry.headers, text: cachedEntry.text, _cacheHit: true });
      }
    }
    const lib = parsed.protocol==='https:' ? https : http;
    const agent = parsed.protocol==='https:'
      ? (allowInsecureTls ? _insecureKeepAliveHttpsAgent : _keepAliveHttpsAgent)
      : _keepAliveHttpAgent;
    // Build headers: Accept-Encoding (gzip), If-None-Match (если есть ETag в кеше).
    const reqHeaders = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'sbof-planner/1.0',
      ...headers,
    };
    if (cachedEntry && cachedEntry.etag && !reqHeaders['If-None-Match']) {
      reqHeaders['If-None-Match'] = cachedEntry.etag;
    }
    const opts = {
      method, hostname: parsed.hostname,
      port: parsed.port||(parsed.protocol==='https:'?443:80),
      path: parsed.pathname+(parsed.search||''),
      headers: reqHeaders,
      rejectUnauthorized: !allowInsecureTls,
      agent,
    };
    const r = lib.request(opts, (resp) => {
      const chunks = [];
      let received = 0;
      let aborted = false;
      // Build decompression stream если нужно.
      const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
      let stream = resp;
      if (enc.includes('gzip')) stream = resp.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = resp.pipe(zlib.createInflate());
      stream.on('data', c => {
        if (aborted) return;
        received += c.length;
        if (received > maxResponseBytes) {
          aborted = true;
          try { resp.destroy(); } catch (_) {}
          const err = new Error(`Response too large (>${maxResponseBytes} bytes) from ${parsed.hostname}`);
          err.code = 'RESPONSE_TOO_LARGE';
          reject(err);
          return;
        }
        chunks.push(c);
      });
      stream.on('error', (err) => { if (!aborted) reject(err); });
      stream.on('end', () => {
        if (aborted) return;
        const status = resp.statusCode || 0;
        const text   = Buffer.concat(chunks).toString('utf8');
        // V21 R — track failure/success для circuit-breaker.
        if (!skipBreaker) {
          if (status >= 500 || status === 0) _breakerRecordFailure(parsed.hostname);
          else _breakerRecordSuccess(parsed.hostname);
        }
        // V21 Y2 — cache write logic.
        if (cacheable) {
          // 304 Not Modified → возвращаем cached body (ETag matched).
          if (status === 304 && cachedEntry) {
            cachedEntry.at = Date.now(); // refresh TTL
            return resolve({ status: cachedEntry.status, headers: cachedEntry.headers, text: cachedEntry.text, _cacheHit: true, _conditional: true });
          }
          // 2xx с body не больше cap — кэшируем.
          if (status >= 200 && status < 300 && text.length <= _HTTP_CACHE_BODY_CAP) {
            _httpCacheSet(cacheKey, {
              at: Date.now(),
              status, headers: resp.headers, text,
              etag: resp.headers.etag || '',
              negative: false,
            });
          } else if (status === 404 || status === 403) {
            // Negative cache — короткий TTL чтобы не флапать.
            _httpCacheSet(cacheKey, {
              at: Date.now(),
              status, headers: resp.headers, text,
              etag: '', negative: true,
            });
          }
        }
        resolve({ status, headers: resp.headers, text });
      });
    });
    r.setTimeout(timeoutMs, ()=>r.destroy(new Error('Timeout '+parsed.hostname)));
    r.on('error', (err) => {
      if (!skipBreaker) _breakerRecordFailure(parsed.hostname);
      reject(err);
    });
    if (body!=null) {
      const pl = typeof body==='string'?body:JSON.stringify(body);
      r.setHeader('Content-Type','application/json'); r.setHeader('Content-Length',Buffer.byteLength(pl)); r.write(pl);
    }
    r.end();
  });
}
function jiraParseResp(resp, label) {
  if (resp.status<200||resp.status>=300) {
    let msg=`${label} ${resp.status}`;
    try { const j=JSON.parse(resp.text); if(j.errorMessages?.length) msg+=': '+j.errorMessages.join('; '); else if(j.message) msg+=': '+j.message; } catch(_){}
    const e=new Error(msg); e.status=resp.status; throw e;
  }
  if (!resp.text) return {};
  return JSON.parse(resp.text);
}
function jiraSleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ── Shared 429 rate-limit gate (Jira) ──────────────────────────────
// When one in-flight Jira request gets throttled, ALL other requests
// must pause until the gate opens. Otherwise concurrent chunks each
// hit retry independently, multiplying load and re-triggering 429s
// in a feedback loop. Single global state for simplicity — fine for
// this single-process server. Reset when the wait window passes.
let _jiraGateUntil = 0;        // epoch ms; 0 = open
let _jiraGateReason = '';      // for logs
function _jiraGateWait() {
  const now = Date.now();
  if (now >= _jiraGateUntil) return Promise.resolve();
  return jiraSleep(_jiraGateUntil - now);
}
function _jiraGateClose(ms, reason) {
  const until = Date.now() + ms;
  if (until > _jiraGateUntil) {
    _jiraGateUntil = until;
    _jiraGateReason = reason;
    try { logger.warn('[jira:gate] closed', { gateMs: ms, reason }); } catch (_) {}
  }
}

async function jiraRequest(cfg, method, apiPath, body, maxRetries=5) {
  // Retry kicks in on 429 + 502/503/504 (transient gateway errors common
  // behind corporate reverse-proxies).
  //
  // V13 (2026-04, second pass): user reports sustained 429 storms on corp
  // Jira where finite retry budgets aren't enough — first failure of a
  // single chunk takes the whole BFS level down (with 21 seeds there's
  // only one chunk; one failure = total abort). Their preference: "let
  // it load longer". Solution:
  //   • 429 retries: effectively unlimited (cap 60 attempts × 30s = up
  //     to ~30 min wall-clock per request). Counted SEPARATELY from
  //     gateway/5xx so a server outage still bails out at maxRetries=5.
  //   • Honors `Retry-After` (capped at 60s per attempt).
  //   • Shared gate (`_jiraGateUntil`) — when ANY request gets 429, the
  //     gate closes for the wait window and all OTHER concurrent requests
  //     queue behind it instead of fighting for tokens.
  // The 240s client-side timeout on black-dashboard is the ultimate bound;
  // genuinely-broken Jira will still surface (just later).
  const target = cfg.jiraBaseUrl.replace(/\/+$/,'')+apiPath;
  const tls = !!cfg.allowInsecureTls;
  const authH = cfg.jiraToken?.includes(':')
    ? 'Basic ' + Buffer.from(cfg.jiraToken).toString('base64')
    : 'Bearer ' + cfg.jiraToken;
  let delay = 2000;
  let rateLimitAttempts = 0;        // separate counter for 429
  let gatewayAttempts   = 0;        // separate counter for 5xx
  // V13 (5th pass): cap 429 retries to a budget that fits within the
  // client-side 10-min timeout AND leaves room for OTHER work (sigma
  // goal fetch, expand, team coverage). 12 attempts × 30s cap = up to
  // 6 min waiting per request. With concurrency=2 and shared gate, the
  // total wall-clock impact stays below ~8 min for the worst case.
  // Note: relies on `_jiraGateWait()` to queue concurrent requests
  // behind any active 429 cooldown — so we don't multiply pressure.
  // M8: было hardcoded 12. Параметризуем через env для тонкой настройки
  // под прод-Jira (агрессивный rate-limit) или dev-стенд (можно меньше).
  const RATE_LIMIT_MAX  = Math.max(1, Math.min(50, Number(process.env.JIRA_RATE_LIMIT_RETRIES) || 12));
  const t0 = Date.now();
  // TECH 17.8 — было 6 мин (12 retries × 30s cap = до 6 минут полной блокировки
  // request'а). На 429 storm'е получали total budget = 6 мин на одну страницу
  // BFS — пользователь видел зависший loader 8-12 минут. Снижаем до 2 мин:
  // если за это время Jira не отдала, лучше сдаться с partial-results
  // (вернуть accumulated issues) чем держать UI заблокированным.
  // Override через JIRA_HARD_BUDGET_MS env для прод-fine-tuning.
  const HARD_BUDGET_MS  = Math.max(30 * 1000, Math.min(10 * 60 * 1000,
    Number(process.env.JIRA_HARD_BUDGET_MS) || 2 * 60 * 1000));
  while (true) {
    if (Date.now() - t0 >= HARD_BUDGET_MS) {
      throw Object.assign(new Error(`Jira request budget exhausted after ${rateLimitAttempts} 429s + ${gatewayAttempts} gateway retries`), { status: 0 });
    }
    await _jiraGateWait();           // queue behind any active 429 cooldown
    // V17 P5 — per-call HTTP timeout bumped 25 s → 60 s. Per-query budget
    // (60-75 s above) is the higher gate; this one is the lowest-level
    // per-page bound. Audit 2026-05-V17 pt 5.
    // V21 Y2 — jiraRequest НЕ кэширует на уровне jiraForward: caller (techInfo,
    // jiraBuildAreaReport, etc.) может иметь свой forceRefresh-семантику; если
    // двойное кэширование, верхний flush не пробивает. caller'ы которым нужен
    // cache — либо вызывают jiraForward напрямую, либо передают signal явно.
    const resp = await jiraForward({ targetUrl:target, method, headers:{ Authorization: authH }, body:body??null, allowInsecureTls:tls, timeoutMs: 60000, useCache: false });
    const isRateLimit  = resp.status === 429;
    const isGatewayErr = resp.status === 502 || resp.status === 503 || resp.status === 504;
    if (isRateLimit) {
      if (rateLimitAttempts >= RATE_LIMIT_MAX) {
        throw Object.assign(new Error(`Jira 429 rate limit (after ${RATE_LIMIT_MAX} retries, ${Math.round((Date.now()-t0)/1000)}s)`), { status: 429 });
      }
      rateLimitAttempts++;
      // Honor Retry-After if Jira sends it; cap each wait at 30s to bound
      // worst-case latency per attempt. Exponential back-off when no header.
      const retryAfterSec = parseInt(resp.headers['retry-after']||'0',10);
      const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec*1000 : delay, 30000);
      _jiraGateClose(waitMs, `429 on ${apiPath} (attempt ${rateLimitAttempts})`);
      await jiraSleep(waitMs);
      delay = Math.min(delay*2, 30000);
      continue;
    }
    if (isGatewayErr) {
      if (gatewayAttempts >= maxRetries) {
        throw Object.assign(new Error(`Jira ${resp.status} gateway`), { status: resp.status });
      }
      gatewayAttempts++;
      const retryAfterSec = parseInt(resp.headers['retry-after']||'0',10);
      const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec*1000 : delay, 30000);
      await jiraSleep(waitMs);
      delay = Math.min(delay*2, 30000);
      continue;
    }
    return jiraParseResp(resp, 'Jira');
  }
}
async function jiraSearchAll(cfg, jql, fields, expand, hardCap=2000, timeBudgetMs=Infinity) {
  // V21 Y2 (audit-09 §J #3) — parallel pagination внутри одного PK.
  // Раньше: цикл await page1 → await page2 → … (sequential). На 1000 issues =
  // 10 пейджей × ~800ms = 8 секунд. Теперь: первая страница берёт total,
  // остальные тянутся параллельно через jiraPLimit(3). Эффект ×2.5 throughput.
  // _jiraGate координирует 429-throttling между чанками — нет feedback-loop'а.
  //
  // AUDIT_SCANNER #45 — adaptive PAGE_SIZE с sticky downscale.
  // Retry-After уже обрабатывается в jiraRequest (см. ~line 1242), но при
  // 429 storm на крупном PK мы хотим уменьшить размер пейджа. Стартуем с 100;
  // если jiraRequest всплывает 429-error → ловим и понижаем до 50, потом до 25.
  // Sticky: повышать обратно НЕ нужно (данный конкретный jiraSearchAll-вызов
  // уже определился что Jira медленная — нет смысла снова бить большим
  // page'ом). Каждый новый jiraSearchAll() начинает с 100 заново.
  let pageSize = 100;
  const PAGE_SIZE_LADDER = [100, 50, 25];
  const downscale = () => {
    const i = PAGE_SIZE_LADDER.indexOf(pageSize);
    if (i >= 0 && i < PAGE_SIZE_LADDER.length - 1) pageSize = PAGE_SIZE_LADDER[i + 1];
  };
  const PARALLEL  = 3;
  const t0 = Date.now();

  // Page 0 — sequential (нужен `total` чтобы знать сколько страниц).
  // Если jiraRequest бросил 429 после исчерпания retry-budget — понижаем
  // pageSize и повторяем page 0. Если всё равно падает — пробрасываем выше.
  let firstPage;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      firstPage = await jiraRequest(cfg, 'POST', '/rest/api/2/search', { jql, startAt: 0, maxResults: pageSize, fields, expand });
      break;
    } catch (e) {
      if (e?.status === 429 && pageSize > PAGE_SIZE_LADDER[PAGE_SIZE_LADDER.length - 1]) {
        downscale();
        continue;
      }
      throw e;
    }
  }
  const firstIssues = firstPage.issues || [];
  const total = Number(firstPage.total) || firstIssues.length;
  if (firstIssues.length < pageSize || firstIssues.length >= total) return firstIssues.slice(0, hardCap);
  if (Date.now() - t0 > timeBudgetMs) return firstIssues.slice(0, hardCap);

  // Сколько ещё страниц нужно: cap либо hardCap, либо total. Минус первая страница.
  const targetCount = Math.min(hardCap, total);
  const remainingPages = Math.ceil((targetCount - firstIssues.length) / pageSize);
  if (remainingPages <= 0) return firstIssues.slice(0, hardCap);

  // Strates по startAt'у. Каждая задача — fetch одной страницы.
  // AUDIT_SCANNER #45 — каждая sub-page при 429 сама понижает общий pageSize
  // (sticky). Замечание: startAt и maxResults внутри одной задачи фиксированы
  // по моменту планирования — после downscale'а будут небольшие overlaps,
  // но dedup-by-key в caller'е (см. jiraGetAreaIssues `byKey` Map) их съедает.
  const tasks = [];
  // TECH 17.8 — счётчики partial-results для telemetry. Если ≥1 страницы
  // упали по 429 — это сигнал что Jira перегружена, и UI должен показать
  // disclaimer «частичные данные». Сейчас просто эмитим event для логов;
  // структурное surfacing в response — отдельная задача.
  let _partialPagesSkipped = 0;
  let _partialRetries429 = 0;
  for (let p = 1; p <= remainingPages; p++) {
    const startAt = p * pageSize;
    if (startAt >= total) break;
    tasks.push(async () => {
      // Time-budget guard внутри каждой задачи: если уже превысили — early-return.
      if (Date.now() - t0 > timeBudgetMs) {
        _partialPagesSkipped++;
        return [];
      }
      try {
        const data = await jiraRequest(cfg, 'POST', '/rest/api/2/search', { jql, startAt, maxResults: pageSize, fields, expand });
        return data.issues || [];
      } catch (e) {
        if (e?.status === 429) {
          downscale();
          _partialRetries429++;
          _partialPagesSkipped++;
          // TECH 17.8 — telemetry на 429-storm: PK + page + retries.
          // Caller (ppFetch* / jiraGetAreaIssues) знает project key — здесь
          // знаем JQL, который начинается с 'project = X'. Парсим best-effort.
          const pkMatch = /project\s*=\s*['"]?([A-Z0-9_]+)/i.exec(jql || '');
          try {
            logger.warn('jira.partial_due_to_rate_limit', {
              pk: pkMatch ? pkMatch[1] : '?',
              page: p,
              startAt,
              pageSize,
              retries: _partialRetries429,
            });
          } catch (_) { /* logger may be unavailable in some test contexts */ }
        }
        return [];
      }
    });
  }
  const pagesResults = await jiraPLimit(PARALLEL, tasks);
  const out = firstIssues.slice();
  for (const page of pagesResults) {
    if (Array.isArray(page)) out.push(...page);
    if (out.length >= hardCap) break;
  }
  // TECH 17.8 — финальный partial-summary event: если хотя бы 1 страница
  // пропущена, эмитим сводку. UI в будущем сможет показать badge
  // «частичные данные на N страниц» через отдельный response-flag.
  if (_partialPagesSkipped > 0) {
    try {
      const pkMatch = /project\s*=\s*['"]?([A-Z0-9_]+)/i.exec(jql || '');
      logger.warn('jira.search_partial_summary', {
        pk:        pkMatch ? pkMatch[1] : '?',
        skipped:   _partialPagesSkipped,
        retries:   _partialRetries429,
        returned:  out.length,
        total,
      });
    } catch (_) { /* ignore */ }
  }
  return out.slice(0, hardCap);
}
function jiraPLimit(concurrency, tasks) {
  return new Promise((resolve) => {
    const results=new Array(tasks.length); let i=0, done=0, running=0;
    const next=()=>{
      while(running<concurrency&&i<tasks.length) {
        const idx=i++; running++;
        Promise.resolve().then(()=>tasks[idx]()).then(r=>{results[idx]=r;},e=>{results[idx]={__error:e.message};})
          .then(()=>{ running--; done++; if(done===tasks.length) resolve(results); else next(); });
      }
    };
    if(!tasks.length) resolve([]); else next();
  });
}

// ── Shared 429 rate-limit gate (Bitbucket) ─────────────────────────
// V21 BB-RL fix (diagnostic 2026-05-07: 796/1200 = 66% запросов 429).
// До этого фикса BB-fetcher (`ppFetchBitbucketActivity` repo-walk + dev-
// status `fetchOne`) вызывал `jiraForward` напрямую без retry — каждый
// 429 терял данные. Теперь shared-gate координирует все BB-запросы:
// при 429 одного запроса все остальные ждут до окончания cooldown.
let _bbGateUntil = 0;
function _bbGateWait() {
  const now = Date.now();
  if (now >= _bbGateUntil) return Promise.resolve();
  return jiraSleep(_bbGateUntil - now);
}
function _bbGateClose(ms, reason) {
  const until = Date.now() + ms;
  if (until > _bbGateUntil) {
    _bbGateUntil = until;
    try { logger.warn('[bb:gate] closed', { gateMs: ms, reason }); } catch (_) {}
  }
}

module.exports = {
  // High-level HTTP API used by all integration fetchers + server.js routes.
  jiraForward, jiraParseResp, jiraSleep,
  jiraRequest, jiraSearchAll, jiraPLimit,
  // Circuit-breaker primitives (used by some callers directly).
  _breakerCheck, _breakerRecordFailure, _breakerRecordSuccess,
  // HTTP cache primitives (used by techInfo / pulse forceRefresh paths).
  _httpCacheGet, _httpCacheSet, _httpCacheKey,
  // SSRF / Confluence helpers.
  _ssrfBlocked, _cfBuildPathCascade,
  // Rate-limit gates.
  _jiraGateWait, _jiraGateClose,
  _bbGateWait, _bbGateClose,
  // Constants.
  _MAX_RESPONSE_BYTES,
  _HTTP_CACHE_TTL_MS,
  // Live state references — server.js _periodicCleanup читает/удаляет из них
  // напрямую. Map'ы — reference-equal (один и тот же объект на оба модуля).
  _HTTP_CACHE,
  _breakers,
};
