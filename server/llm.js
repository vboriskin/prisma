'use strict';
/* ============================================================
   server/llm.js — V18 pilot extraction (from server.js)

   GigaChat / LLM proxy domain. Everything that was inline in
   server.js (constants, OAuth, SSE forwarding, budget cap,
   proxyChat handler) lives here now. server.js keeps only the
   route registration:

       const llm = require('./server/llm.js').create({
         readBody, writeJson, MAX_BODY,
       });
       // ... later:
       if (req.method === 'POST' && pathname === '/api/llm/chat') {
         llm.proxyChat(req, res); return;
       }

   Public surface (returned by `create({...})`):
     • proxyChat(req, res)        — main /api/llm/chat handler
     • llmBudgetUserCount()       — getter for /metrics endpoint
                                    (replaces direct _llmBudgetPerUser.size
                                     access from server.js)

   Pre-existing bug preserved: in proxyChat the `payload` object is
   referenced inside `llmTelemetry = { model: payload.model, ... }`
   before its `const payload = {...}` declaration (TDZ). This is a
   verbatim port — fix is out of scope for the pilot extraction.

   Why factory? readBody/writeJson/MAX_BODY remain in server.js
   (still used by other handlers). Passing them in keeps llm.js
   free of cross-imports.
   ============================================================ */

const http  = require('http');
const https = require('https');
const { URL } = require('url');
const logger = require('./logger.js');

// ── Constants ───────────────────────────────────────────────
const DEFAULT_GIGACHAT_BASE = process.env.GIGACHAT_API_BASE || 'https://gigachat.devices.sberbank.ru/api/v1';
const SERVER_ACCESS_TOKEN   = process.env.GIGACHAT_ACCESS_TOKEN || '';

const GIGACHAT_OAUTH_URL = process.env.GIGACHAT_OAUTH_URL
  || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

// QA AS.10 — без cap'а Map рос бесконечно: процесс с uptime год + ротация
// тысяч clientId → постоянный leak. FIFO eviction по insertion-order +
// TTL sweep удаляет долго-просроченные.
const TOKEN_CACHE_MAX    = Number(process.env.TOKEN_CACHE_MAX) || 200;
const TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h after expiresAt

// V21 V4 / BI — LLM budget cap (24h rolling window).
const LLM_BUDGET_LIMIT          = parseInt(process.env.LLM_BUDGET_PER_DAY  || '5000', 10); // legacy global
const LLM_BUDGET_PER_USER_LIMIT = parseInt(process.env.LLM_BUDGET_PER_USER || '300',  10); // per-user/day

// ── Module-scope state (was server.js-scope) ────────────────
const _tokenCache    = new Map(); // clientId → { token, expiresAt }
const _tokenInflight = new Map(); // cacheKey -> Promise<token>  (V21 O — single-flight refresh)

const _llmBudget        = { count: 0, windowStart: Date.now() };
const _llmBudgetPerUser = new Map(); // clientId -> { count, windowStart }

// ── Helpers ─────────────────────────────────────────────────

// QA A16.5 — same-origin guard для мутирующих POST. Дублируется здесь и
// в server.js (server.js использует тот же helper для /api/jira/config).
// CSRF_DISABLED=1 — runtime-escape для интеграционных тестов.
function isSameOriginRequest(req) {
  if (process.env.CSRF_DISABLED === '1') return true;
  const origin  = req.headers.origin  || '';
  const referer = req.headers.referer || '';
  const host    = req.headers.host    || '';
  if (!origin && !referer) return true;
  try {
    const src = origin ? new URL(origin) : new URL(referer);
    return src.host === host;
  } catch (_) { return false; }
}

function clientIp(req) {
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

function buildChatEndpoint(base) {
  const normalized = String(base || DEFAULT_GIGACHAT_BASE).replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  if (normalized.endsWith('/api')) return `${normalized}/v1/chat/completions`;
  return `${normalized}/chat/completions`;
}

// QA AX.7 — whitelist хостов для LLM proxy. Без него body.apiBaseUrl
// принимался без проверок: атакующий может прислать `apiBaseUrl=evil.com`
// и токен с Authorization-header утечёт на их хост.
//
// V22 fix (2026-05-10) — localhost / 127.0.0.1 / host.docker.internal
// разрешены ALWAYS (типичный case: локальный gpt2giga proxy на :3000).
// + При несовпадении — НЕ silently fallback, а warn-log с явным URL и
// возврат rawBase=DEFAULT (чтобы поведение не изменилось — но юзер увидит
// в логах причину). Override через LLM_ALLOWED_HOSTS env остаётся.
const _LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', '::1']);
function _llmAllowedHosts() {
  const set = new Set();
  try { set.add(new URL(DEFAULT_GIGACHAT_BASE).host.toLowerCase()); } catch (_) {}
  try { set.add(new URL(GIGACHAT_OAUTH_URL).host.toLowerCase()); } catch (_) {}
  for (const h of String(process.env.LLM_ALLOWED_HOSTS || '').split(',')) {
    const t = h.trim().toLowerCase();
    if (t) set.add(t);
  }
  return set;
}
function _isLocalHost(host) {
  // Поддержка `localhost:3000`, `127.0.0.1:8080` и т.п.
  const bare = String(host || '').toLowerCase().split(':')[0];
  return _LOCAL_HOSTS.has(bare);
}
function _resolveSafeLlmBase(rawBase) {
  if (!rawBase) return DEFAULT_GIGACHAT_BASE;
  let host;
  try { host = new URL(rawBase).host.toLowerCase(); } catch (_) { return DEFAULT_GIGACHAT_BASE; }
  if (_isLocalHost(host)) return rawBase;
  if (_llmAllowedHosts().has(host)) return rawBase;
  try { logger.warn?.('llm.base_not_allowed', { requested: rawBase, host, hint: 'Add to LLM_ALLOWED_HOSTS env or use localhost' }); } catch (_) {}
  return DEFAULT_GIGACHAT_BASE;
}

// ── Token cache + OAuth ─────────────────────────────────────
function _tokenCacheSet(key, value) {
  const cutoff = Date.now() - TOKEN_CACHE_TTL_MS;
  for (const [k, v] of _tokenCache) {
    if (v?.expiresAt && v.expiresAt < cutoff) _tokenCache.delete(k);
  }
  while (_tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldestKey = _tokenCache.keys().next().value;
    if (oldestKey === undefined) break;
    _tokenCache.delete(oldestKey);
  }
  _tokenCache.set(key, value);
}

/**
 * Returns a valid GigaChat Bearer token.
 * Fetches a new one from OAuth if missing or within 90s of expiry.
 * Never logs the secret.
 */
// V21 O (audit-2026-05-03 §C B9) — in-flight refresh deduplication
// (single-flight). Раньше конкурентные вызовы могли запускать
// параллельные OAuth-fetch'и и перетирать токен друг друга.
async function gigachatGetToken(clientId, clientSecret) {
  const cacheKey = clientId;
  const cached = _tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.token && cached.expiresAt - now > 90_000) {
    return cached.token;
  }
  const inflight = _tokenInflight.get(cacheKey);
  if (inflight) return inflight;

  const cred = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const rqUID = [8,4,4,4,12].map(n => [...Array(n)].map(() => Math.floor(Math.random()*16).toString(16)).join('')).join('-');

  const fetchPromise = new Promise((resolve, reject) => {
    const oauthUrl = new URL(GIGACHAT_OAUTH_URL);
    const body = `scope=${encodeURIComponent(GIGACHAT_SCOPE)}`;
    // PR-DB — выбор транспорта по протоколу (http-fake'и в contract-тестах).
    const transport = oauthUrl.protocol === 'http:' ? http : https;
    const opts = {
      method: 'POST',
      protocol: oauthUrl.protocol,
      hostname: oauthUrl.hostname,
      port: oauthUrl.port || (oauthUrl.protocol === 'http:' ? 80 : 443),
      path: oauthUrl.pathname + (oauthUrl.search || ''),
      headers: {
        'Authorization': `Basic ${cred}`,
        'RqUID': rqUID,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
      // GigaChat OAuth endpoint uses Sberbank internal CA — allow insecure for on-prem
      rejectUnauthorized: false,
    };
    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 400) {
          return reject(new Error(`GigaChat OAuth ${res.statusCode}: ${text.slice(0, 200)}`));
        }
        let parsed;
        try { parsed = JSON.parse(text); } catch(_) { return reject(new Error('GigaChat OAuth: invalid JSON')); }
        const token = parsed.access_token;
        if (!token) return reject(new Error('GigaChat OAuth: no access_token in response'));
        // expires_at is ms since epoch (GigaChat v2 API)
        const expiresAt = typeof parsed.expires_at === 'number'
          ? parsed.expires_at
          : (Date.now() + 29 * 60 * 1000); // fallback: 29 min
        _tokenCacheSet(cacheKey, { token, expiresAt });
        resolve(token);
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('GigaChat OAuth timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  _tokenInflight.set(cacheKey, fetchPromise);
  fetchPromise.finally(() => {
    if (_tokenInflight.get(cacheKey) === fetchPromise) _tokenInflight.delete(cacheKey);
  });
  return fetchPromise;
}

// ── SSE / Usage extraction ──────────────────────────────────

// QA AUDIT_LLM C6 — token-usage extraction из SSE-стрима GigaChat. Финальный
// data-frame обычно содержит `{"usage":{"prompt_tokens","completion_tokens","total_tokens"}}`
// (опционально и в delta-фреймах для streaming-усреднения). Сканируем
// последний ~16KB буфер на строки `data: {...}` и пытаемся вытащить usage.
function _extractUsageFromTail(tail) {
  if (!tail || typeof tail !== 'string') return null;
  const lines = tail.split('\n').slice(-30).filter(l => l.startsWith('data:'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw);
      const u = obj.usage || obj?.choices?.[0]?.usage;
      if (u && (Number.isFinite(u.prompt_tokens) || Number.isFinite(u.total_tokens))) {
        return {
          prompt_tokens:     Number(u.prompt_tokens)     || 0,
          completion_tokens: Number(u.completion_tokens) || 0,
          total_tokens:      Number(u.total_tokens)      || (Number(u.prompt_tokens)||0) + (Number(u.completion_tokens)||0),
        };
      }
    } catch (_) {}
  }
  return null;
}

function forwardSSEOrChunk(upstreamRes, clientRes, telemetry, upstreamReq) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  clientRes.write('event: meta\ndata: {"ok":true}\n\n');
  // V22 C-10 (audit-experts-2026-05-15 Anastasov S0-5) — primer-ping сразу
  // после writeHead. Если upstream «думает» 25+ сек до первого delta,
  // первый интервальный ping выстрелит только через 25с — corp-proxy с
  // idle=30s может разорвать connection в окне [25–30s]. Primer гарантирует
  // что connection «зашевелится» немедленно.
  try { clientRes.write(': ping\n\n'); } catch (_) {}
  // V21 BJ (audit-04 §G #6) — SSE heartbeat. Corp proxy с idle-timeout 60с
  // молча обрывал длинные ответы. Шлём `: ping` каждые 20с (раньше 25с —
  // ужесточили до 20с, поскольку часть corp-proxy идёт по 30с idle, не 60).
  const heartbeat = setInterval(() => {
    try { if (!clientRes.writableEnded) clientRes.write(': ping\n\n'); } catch (_) {}
  }, 20_000);
  // V22 C-10 (audit-experts-2026-05-15 Anastasov S0-5) — leak guard.
  // Раньше cleanup был привязан только к (clientRes close/error,
  // upstreamRes end/error). НО — при TCP RST upstream'а:
  //   · upstreamReq получает 'close' / 'aborted' / 'error', но
  //   · upstreamRes может вообще не выстрелить 'end'/'error',
  //   · clientRes остаётся валидным.
  // Без cleanup на upstreamReq → heartbeat-interval живёт до thread-pool
  // exhaustion. На 1000 broken соединений за час — заметная утечка.
  // Делаем cleanup идемпотентным + добавляем 4 новых hook'а на upstreamReq.
  let _cleaned = false;
  const _cleanup = () => {
    if (_cleaned) return;
    _cleaned = true;
    try { clearInterval(heartbeat); } catch (_) {}
  };
  clientRes.on('close', _cleanup);
  clientRes.on('error', _cleanup);
  if (upstreamReq) {
    upstreamReq.on('close',   _cleanup);
    upstreamReq.on('aborted', _cleanup);
    upstreamReq.on('error',   _cleanup);
    upstreamReq.on('timeout', _cleanup);
  }
  // QA AUDIT_LLM C6 — храним rolling-tail (~16KB), чтобы на end() выдернуть usage.
  const TAIL_MAX = 16 * 1024;
  let tail = '';
  upstreamRes.on('data', (chunk) => {
    try { clientRes.write(chunk); } catch (_) {}
    if (telemetry) {
      tail += chunk.toString('utf-8');
      if (tail.length > TAIL_MAX) tail = tail.slice(-TAIL_MAX);
    }
  });
  upstreamRes.on('end', () => {
    _cleanup();
    if (telemetry) {
      try {
        const usage = _extractUsageFromTail(tail);
        const ms = Date.now() - (telemetry.startTs || Date.now());
        if (usage) {
          try { clientRes.write(`event: usage\ndata: ${JSON.stringify({ ...usage, ms, model: telemetry.model || '' })}\n\n`); } catch (_) {}
          try { logger.event?.('llm.completed', { model: telemetry.model, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, ms, cid: telemetry.cid }); } catch (_) {}
        } else {
          try { logger.event?.('llm.completed', { model: telemetry.model, ms, cid: telemetry.cid, no_usage: true }); } catch (_) {}
        }
      } catch (_) {}
    }
    try {
      clientRes.write('data: [DONE]\n\n');
      clientRes.end();
    } catch (_) {}
  });
  upstreamRes.on('error', _cleanup);
}

// ── LLM Budget ──────────────────────────────────────────────
function _checkLlmBudget(req) {
  const now = Date.now();
  // Global window (legacy).
  if (now - _llmBudget.windowStart > 24 * 3600 * 1000) {
    _llmBudget.count = 0;
    _llmBudget.windowStart = now;
  }
  if (_llmBudget.count >= LLM_BUDGET_LIMIT) {
    return { ok: false, used: _llmBudget.count, limit: LLM_BUDGET_LIMIT, scope: 'global' };
  }
  // Per-user window. clientId — из X-Client-Id или fallback на IP.
  const cid = (req?.headers?.['x-client-id'] || req?.headers?.['x-user-id'] || clientIp(req) || '?').slice(0, 64);
  const u = _llmBudgetPerUser.get(cid) || { count: 0, windowStart: now };
  if (now - u.windowStart > 24 * 3600 * 1000) {
    u.count = 0;
    u.windowStart = now;
  }
  if (u.count >= LLM_BUDGET_PER_USER_LIMIT) {
    return { ok: false, used: u.count, limit: LLM_BUDGET_PER_USER_LIMIT, scope: 'user', cid };
  }
  u.count++;
  _llmBudgetPerUser.set(cid, u);
  // GC entries старше 48ч.
  if (_llmBudgetPerUser.size > 1000) {
    for (const [k, v] of _llmBudgetPerUser) {
      if (now - v.windowStart > 48 * 3600 * 1000) _llmBudgetPerUser.delete(k);
    }
  }
  _llmBudget.count++;
  return { ok: true, used: _llmBudget.count, limit: LLM_BUDGET_LIMIT };
}

// ── Main handler factory ────────────────────────────────────
/**
 * @param {{
 *   readBody: (req: any, limitBytes: number) => Promise<string>,
 *   writeJson: (res: any, code: number, data: any) => void,
 *   MAX_BODY: number
 * }} deps
 */
function create(deps) {
  if (!deps || typeof deps.readBody !== 'function' || typeof deps.writeJson !== 'function' || !Number.isFinite(deps.MAX_BODY)) {
    throw new Error('llm.create: requires { readBody, writeJson, MAX_BODY }');
  }
  const { readBody, writeJson, MAX_BODY } = deps;

  function proxyChat(req, res) {
    // QA A16.5 — same-origin guard перед расходом LLM-budget'а.
    if (!isSameOriginRequest(req)) {
      try { logger.warn?.('csrf.blocked', { path: '/api/llm/chat', origin: req.headers.origin || '', referer: req.headers.referer || '', host: req.headers.host || '' }); } catch (_) {}
      writeJson(res, 403, { error: 'Cross-origin POST запрещён' });
      return;
    }
    // V21 V4 / BI — budget check ДО readBody (cheap fail-fast).
    const budget = _checkLlmBudget(req);
    if (!budget.ok) {
      logger.warn('llm.budget_exceeded', { used: budget.used, limit: budget.limit, scope: budget.scope, cid: budget.cid });
      const msg = budget.scope === 'user'
        ? `LLM-бюджет на пользователя исчерпан (${budget.used}/${budget.limit} запросов за 24ч). Подождите или повысьте LLM_BUDGET_PER_USER env.`
        : `LLM-бюджет исчерпан (${budget.used}/${budget.limit} запросов за 24ч). Проверьте автоматизации или повысьте LLM_BUDGET_PER_DAY env.`;
      writeJson(res, 429, { error: msg, scope: budget.scope });
      return;
    }
    readBody(req, MAX_BODY).then(async (raw) => {
      const body = raw ? JSON.parse(raw) : {};
      const clientId     = String(body.clientId     || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      let   token        = String(body.token        || '').trim() || SERVER_ACCESS_TOKEN;

      // ── GigaChat OAuth: exchange clientId+clientSecret for Bearer token ──
      if (clientId && clientSecret) {
        try {
          token = await gigachatGetToken(clientId, clientSecret);
        } catch (e) {
          writeJson(res, 502, { error: 'GigaChat OAuth failed: ' + e.message });
          return;
        }
      }

      if (!token) {
        writeJson(res, 400, { error: 'Нет токена. Укажите token или пару clientId + clientSecret в настройках LLM.' });
        return;
      }

      // QA AX.7 — apiBaseUrl whitelist.
      const safeBase = _resolveSafeLlmBase(body.apiBaseUrl);
      if (body.apiBaseUrl && safeBase !== body.apiBaseUrl) {
        try { logger.warn?.('llm.base_rejected', { requested: String(body.apiBaseUrl).slice(0, 200) }); } catch (_) {}
      }
      const endpoint = buildChatEndpoint(safeBase);
      const endpointUrl = new URL(endpoint);
      // V22 fix (2026-05-09) — устранён TDZ bug: payload объявлен ДО
      // llmTelemetry который ссылается на payload.model. Раньше каждый
      // POST /api/llm/chat падал с «Cannot access 'payload' before initialization»
      // → 400 «Invalid request body» на клиенте.
      const payload = {
        model: body.model || 'GigaChat-2',
        messages: Array.isArray(body.messages) ? body.messages : [],
        stream: body.stream !== false,
        temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2,
        max_tokens: Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 900,
      };
      // QA AUDIT_LLM C6 — telemetry context для forwardSSEOrChunk.
      const llmTelemetry = {
        model: payload.model,
        cid: String(req.headers['x-client-id'] || '').slice(0, 64),
        startTs: Date.now(),
      };

      // ── Perform the upstream chat request (with one 401-retry) ──
      const doRequest = (bearerToken, retryOnUnauth) => {
        const payloadRaw = JSON.stringify(payload);
        const transport = endpointUrl.protocol === 'http:' ? http : https;
        const upstreamReq = transport.request({
          protocol: endpointUrl.protocol,
          hostname: endpointUrl.hostname,
          port: endpointUrl.port || (endpointUrl.protocol === 'http:' ? 80 : 443),
          path: endpointUrl.pathname + endpointUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bearerToken}`,
            Accept: payload.stream ? 'text/event-stream' : 'application/json',
            'Content-Length': Buffer.byteLength(payloadRaw),
          },
          // Allow Sberbank internal CA (same as OAuth call)
          rejectUnauthorized: false,
        }, (upstreamRes) => {
          const status = upstreamRes.statusCode || 500;
          const upstreamType = (upstreamRes.headers['content-type'] || '').toLowerCase();

          if (status === 401 && retryOnUnauth && clientId && clientSecret) {
            // PR-CI — детальный лог 401 (body + WWW-Authenticate header) до retry.
            const errChunks = [];
            upstreamRes.on('data', (chunk) => errChunks.push(chunk));
            upstreamRes.on('end', () => {
              const errText = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
              const wwwAuth = upstreamRes.headers['www-authenticate'] || '';
              try { logger.warn?.('gigachat 401 — refreshing token', { wwwAuth, body: errText.replace(/Bearer\s+\S+/g, 'Bearer [redacted]') }); } catch(_) {}
              _tokenCache.delete(clientId); // invalidate cached token
              gigachatGetToken(clientId, clientSecret)
                .then(newTok => doRequest(newTok, false))
                .catch(e => {
                  // L7 fix: failed refresh — добавляем тот же hint про PERS/CORP scope.
                  const refreshErrMsg = String(e?.message || e || 'unknown');
                  const hint = /401|forbidden|invalid|scope/i.test(refreshErrMsg)
                    ? 'Токен не обновился. Проверьте: (1) clientSecret не истёк/не отозван, (2) scope в настройках LLM (PERS/CORP) совпадает с тем что закреплён за clientId, (3) аккаунт активен в личном кабинете GigaChat.'
                    : 'Токен не обновился — проверьте сетевую доступность OAuth-эндпоинта GigaChat.';
                  if (!res.writableEnded) writeJson(res, 502, {
                    error: 'GigaChat token refresh failed: ' + refreshErrMsg,
                    hint,
                  });
                });
            });
            return;
          }

          if (status >= 400) {
            const errChunks = [];
            upstreamRes.on('data', (chunk) => errChunks.push(chunk));
            upstreamRes.on('end', () => {
              const errText = Buffer.concat(errChunks).toString('utf-8');
              const parsed = (() => { try { return JSON.parse(errText); } catch (_) { return null; } })();
              const wwwAuth = upstreamRes.headers['www-authenticate'] || '';
              const hint = status === 401
                ? 'GigaChat вернул 401 после обновления токена. Проверьте: (1) scope в настройках LLM (PERS/CORP), (2) активность clientId в личном кабинете GigaChat, (3) права аккаунта на выбранную модель.'
                : '';
              if (!res.writableEnded) writeJson(res, status, {
                error: 'GigaChat upstream error',
                status,
                details: parsed || errText || 'Unknown upstream error',
                wwwAuthenticate: wwwAuth || undefined,
                hint: hint || undefined,
              });
            });
            return;
          }

          if (payload.stream) {
            if (upstreamType.includes('text/event-stream') || upstreamType.includes('stream') || upstreamType.includes('json')) {
              // V22 C-10 — пробрасываем upstreamReq для cleanup-hooks.
              forwardSSEOrChunk(upstreamRes, res, llmTelemetry, upstreamReq);
            } else {
              const chunks = [];
              upstreamRes.on('data', (chunk) => chunks.push(chunk));
              upstreamRes.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                if (res.writableEnded) return;
                res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
                res.write(`data: ${text}\n\n`);
                // QA AUDIT_LLM C6 — fallback non-stream-but-streamed path.
                try {
                  const parsed = JSON.parse(text);
                  const u = parsed?.usage || parsed?.choices?.[0]?.usage;
                  const ms = Date.now() - llmTelemetry.startTs;
                  if (u) {
                    res.write(`event: usage\ndata: ${JSON.stringify({ prompt_tokens: u.prompt_tokens||0, completion_tokens: u.completion_tokens||0, total_tokens: u.total_tokens||0, ms, model: llmTelemetry.model })}\n\n`);
                    try { logger.event?.('llm.completed', { model: llmTelemetry.model, prompt_tokens: u.prompt_tokens||0, completion_tokens: u.completion_tokens||0, total_tokens: u.total_tokens||0, ms, cid: llmTelemetry.cid }); } catch (_) {}
                  } else {
                    try { logger.event?.('llm.completed', { model: llmTelemetry.model, ms, cid: llmTelemetry.cid, no_usage: true }); } catch (_) {}
                  }
                } catch (_) {}
                res.write('data: [DONE]\n\n');
                res.end();
              });
            }
          } else {
            if (!res.writableEnded) {
              // QA AUDIT_LLM C6 — non-stream путь: интерсептим body для usage.
              const chunks = [];
              res.writeHead(200, { 'Content-Type': upstreamType || 'application/json; charset=utf-8' });
              upstreamRes.on('data', (chunk) => { chunks.push(chunk); res.write(chunk); });
              upstreamRes.on('end', () => {
                try {
                  const text = Buffer.concat(chunks).toString('utf-8');
                  const parsed = JSON.parse(text);
                  const u = parsed?.usage || parsed?.choices?.[0]?.usage;
                  const ms = Date.now() - llmTelemetry.startTs;
                  if (u) { try { logger.event?.('llm.completed', { model: llmTelemetry.model, prompt_tokens: u.prompt_tokens||0, completion_tokens: u.completion_tokens||0, total_tokens: u.total_tokens||0, ms, cid: llmTelemetry.cid }); } catch (_) {} }
                  else   { try { logger.event?.('llm.completed', { model: llmTelemetry.model, ms, cid: llmTelemetry.cid, no_usage: true }); } catch (_) {} }
                } catch (_) {}
                try { res.end(); } catch (_) {}
              });
            }
          }
        });

        req.on('close', () => { if (!res.writableEnded) upstreamReq.destroy(new Error('Client disconnected')); });
        upstreamReq.on('error', (err) => {
          if (res.writableEnded) return;
          writeJson(res, 502, { error: 'Proxy request failed', details: String(err && err.message ? err.message : err) });
        });
        upstreamReq.write(payloadRaw);
        upstreamReq.end();
      };

      doRequest(token, true);

    }).catch((err) => {
      writeJson(res, /Payload too large/.test(String(err)) ? 413 : 400, {
        error: 'Invalid request body',
        details: String(err && err.message ? err.message : err),
      });
    });
  }

  return {
    proxyChat,
    // For /metrics endpoint in server.js (was: _llmBudgetPerUser.size).
    llmBudgetUserCount: () => _llmBudgetPerUser.size,
  };
}

module.exports = {
  create,
  // Re-exported for any test that wants to inspect helpers directly.
  // Not used by server.js.
  _internal: {
    isSameOriginRequest,
    buildChatEndpoint,
    _llmAllowedHosts,
    _resolveSafeLlmBase,
    _extractUsageFromTail,
  },
};
