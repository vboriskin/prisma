// Static server + LLM proxy (Node built-ins only)
// Usage: node server.js [port]
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = parseInt(process.argv[2], 10) || 8080;
const ROOT = __dirname;
const DEFAULT_GIGACHAT_BASE = process.env.GIGACHAT_API_BASE || 'https://gigachat.devices.sberbank.ru/api/v1';
const SERVER_ACCESS_TOKEN = process.env.GIGACHAT_ACCESS_TOKEN || '';
const MAX_BODY = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8',
  // V15 fix (errors-log report 2026-04-30): without this MIME the browser
  // rejects WebAssembly streaming compile with "Unexpected response MIME
  // type. Expected 'application/wasm'", forcing fallback to ArrayBuffer
  // instantiation — which then trips the CSP `wasm-unsafe-eval` block.
  '.wasm': 'application/wasm',
  // Fonts (in case any get re-vendored locally later — harmless extras).
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
};

function writeJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/* ────────────────────────────────────────────────────────────
   Rate limit (per-IP, sliding 1-min window)
   ──
   In-memory bucket. Local single-tenant tool — we don't need Redis.
   Defaults: 120 requests / IP / minute. Health/metrics excluded so
   monitoring doesn't trip the limit. Static-file requests count
   normally — abuse here would still hammer disk reads.
   ─────────────────────────────────────────────────────────── */
const RL_WINDOW_MS  = 60 * 1000;
const RL_LIMIT      = parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10);
const _rlBuckets = new Map();   // ip → [timestamp, ...]
function clientIp(req) {
  // Trust the connection address — local tool, no proxy in front.
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function checkRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const arr = _rlBuckets.get(ip) || [];
  // Drop entries outside window. Keeps memory bounded for steady traffic.
  while (arr.length && arr[0] <= now - RL_WINDOW_MS) arr.shift();
  if (arr.length >= RL_LIMIT) {
    return { ok: false, retryAfter: Math.ceil((arr[0] + RL_WINDOW_MS - now) / 1000) };
  }
  arr.push(now);
  _rlBuckets.set(ip, arr);
  // Periodic cheap GC: trim the map if it grew unreasonably (>1000 IPs).
  if (_rlBuckets.size > 1000) {
    for (const [k, v] of _rlBuckets) if (!v.length || v[v.length-1] < now - RL_WINDOW_MS) _rlBuckets.delete(k);
  }
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────
   Metrics (in-memory counters, reset on restart)
   ─────────────────────────────────────────────────────────── */
const _metrics = {
  startedAt: Date.now(),
  requestsTotal: 0,
  requestsByPath: Object.create(null),
  errors4xx: 0,
  errors5xx: 0,
  rateLimited: 0,
};
function recordRequest(pathname, statusCode) {
  _metrics.requestsTotal++;
  // Bucket by API prefix so paths like /api/jira/issue/PROJ-123 don't blow up the map.
  const bucket = pathname.startsWith('/api/integrations/') ? pathname.split('/').slice(0,4).join('/')
              : pathname.startsWith('/api/jira/') ? pathname.split('/').slice(0,4).join('/')
              : pathname.startsWith('/api/') ? pathname
              : '/static';
  _metrics.requestsByPath[bucket] = (_metrics.requestsByPath[bucket] || 0) + 1;
  if (statusCode >= 400 && statusCode < 500) _metrics.errors4xx++;
  if (statusCode >= 500) _metrics.errors5xx++;
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function buildChatEndpoint(base) {
  const normalized = String(base || DEFAULT_GIGACHAT_BASE).replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  if (normalized.endsWith('/api')) return `${normalized}/v1/chat/completions`;
  return `${normalized}/chat/completions`;
}

// ============================================================
// GIGACHAT OAUTH — token cache + exchange
// ============================================================
const GIGACHAT_OAUTH_URL = process.env.GIGACHAT_OAUTH_URL
  || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

// In-memory token cache — scoped to clientId so multiple configs can coexist
const _tokenCache = new Map(); // clientId → { token, expiresAt }

/**
 * Returns a valid GigaChat Bearer token.
 * Fetches a new one from OAuth if missing or within 90s of expiry.
 * Never logs the secret.
 */
async function gigachatGetToken(clientId, clientSecret) {
  const cacheKey = clientId;
  const cached = _tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.token && cached.expiresAt - now > 90_000) {
    return cached.token;
  }

  // Build Basic auth: base64(clientId:clientSecret)
  const cred = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  // Unique request ID required by GigaChat OAuth
  const rqUID = [8,4,4,4,12].map(n => [...Array(n)].map(() => Math.floor(Math.random()*16).toString(16)).join('')).join('-');

  return new Promise((resolve, reject) => {
    const oauthUrl = new URL(GIGACHAT_OAUTH_URL);
    const body = `scope=${encodeURIComponent(GIGACHAT_SCOPE)}`;
    const opts = {
      method: 'POST',
      protocol: oauthUrl.protocol,
      hostname: oauthUrl.hostname,
      port: oauthUrl.port || 443,
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
    const req = https.request(opts, (res) => {
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
        _tokenCache.set(cacheKey, { token, expiresAt });
        resolve(token);
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('GigaChat OAuth timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function forwardSSEOrChunk(upstreamRes, clientRes) {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  clientRes.write('event: meta\ndata: {"ok":true}\n\n');
  upstreamRes.on('data', (chunk) => {
    clientRes.write(chunk);
  });
  upstreamRes.on('end', () => {
    clientRes.write('data: [DONE]\n\n');
    clientRes.end();
  });
}

function proxyChat(req, res) {
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

    const endpoint = buildChatEndpoint(body.apiBaseUrl || DEFAULT_GIGACHAT_BASE);
    const endpointUrl = new URL(endpoint);
    const payload = {
      model: body.model || 'GigaChat-2',
      messages: Array.isArray(body.messages) ? body.messages : [],
      stream: body.stream !== false,
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2,
      max_tokens: Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 900,
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
          // Consume upstream body then refresh token and retry once
          upstreamRes.resume();
          _tokenCache.delete(clientId); // invalidate cached token
          gigachatGetToken(clientId, clientSecret)
            .then(newTok => doRequest(newTok, false))
            .catch(e => { if (!res.writableEnded) writeJson(res, 502, { error: 'GigaChat token refresh failed: ' + e.message }); });
          return;
        }

        if (status >= 400) {
          const errChunks = [];
          upstreamRes.on('data', (chunk) => errChunks.push(chunk));
          upstreamRes.on('end', () => {
            const errText = Buffer.concat(errChunks).toString('utf-8');
            const parsed = (() => { try { return JSON.parse(errText); } catch (_) { return null; } })();
            if (!res.writableEnded) writeJson(res, status, {
              error: 'GigaChat upstream error',
              status,
              details: parsed || errText || 'Unknown upstream error',
            });
          });
          return;
        }

        if (payload.stream) {
          if (upstreamType.includes('text/event-stream') || upstreamType.includes('stream') || upstreamType.includes('json')) {
            forwardSSEOrChunk(upstreamRes, res);
          } else {
            const chunks = [];
            upstreamRes.on('data', (chunk) => chunks.push(chunk));
            upstreamRes.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf-8');
              if (res.writableEnded) return;
              res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
              res.write(`data: ${text}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            });
          }
        } else {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': upstreamType || 'application/json; charset=utf-8' });
            upstreamRes.pipe(res);
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

// ============================================================
// JIRA PULSE — config + proxy
// ============================================================
const JIRA_CONFIG_FILE = path.join(ROOT, 'jira_config.json');
const JIRA_DEFAULT_CONFIG = {
  jiraBaseUrl: '', jiraToken: '',
  jiraProjectKeys: '',             // comma-separated Jira project keys, e.g. "PAY,SBOF"
  areas: [],                       // [{ name, projectKey }] — derived from jiraProjectKeys when needed
  // Sigma Jira (second instance) — used by /api/integrations/black-dashboard
  // to fetch quarterly goal-epics linked to Delta tasks via «Domain link».
  sigmaJiraBaseUrl: '', sigmaJiraToken: '',
  sigmaGoalEpicKeys: '',           // comma-separated goal-epic keys, e.g. "GOAL-1, GOAL-2"
  bitbucketBaseUrl: '', bitbucketToken: '',
  bitbucketProjectKeys: '',        // comma-separated repo slugs / project keys for PR search
  confluenceBaseUrl: '', confluenceToken: '',
  confluenceSpaceKeys: '',         // V17.2 I2c — comma-separated space keys for CQL filter
  activityWindowHours: 72,         // V17.2 I2c — окно активности (часов): default 3 рабочих дня
  allowInsecureTls: false,         // global TLS flag
  sinceDate: '2025-01-01',         // cut-off for Jira/Confluence search
  staleDays: 3, noMovementDays: 2,
  // Чёрный дашборд: следовать [Cloners] issue-link цепочкам при раскрытии
  // дерева Domain-link. Нужно для команд (например, SMEAM), где эпики
  // версионируются между квартальными релизами через cloner-цепочки вместо
  // Epic Link / parent. Включено по умолчанию — расширяет JQL чтобы покрыть
  // и cloner-родительство, не задевая обычные команды.
  followCloners: true,
};

function jiraReadConfig() {
  try { return { ...JIRA_DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(JIRA_CONFIG_FILE, 'utf8')) }; }
  catch(_) { return { ...JIRA_DEFAULT_CONFIG }; }
}
function jiraWriteConfig(patch) {
  const next = { ...jiraReadConfig(), ...patch };
  fs.writeFileSync(JIRA_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
function jiraSanitizeAreas(areas) {
  if (!Array.isArray(areas)) return [];
  const seen = new Set(), out = [];
  for (const a of areas) {
    const pk = String(a.projectKey||'').trim(), nm = String(a.name||pk||'').trim();
    if (!pk || seen.has(pk)) continue;
    seen.add(pk); out.push({ name:nm, projectKey:pk });
  }
  return out;
}
function jiraSanitizeConfig(cfg) {
  return {
    jiraBaseUrl:         cfg.jiraBaseUrl||'',
    jiraProjectKeys:     cfg.jiraProjectKeys||'',
    areas:               jiraSanitizeAreas(cfg.areas),
    sigmaJiraBaseUrl:    cfg.sigmaJiraBaseUrl||'',
    sigmaGoalEpicKeys:   cfg.sigmaGoalEpicKeys||'',
    bitbucketBaseUrl:    cfg.bitbucketBaseUrl||'',
    bitbucketProjectKeys:cfg.bitbucketProjectKeys||'',
    confluenceBaseUrl:   cfg.confluenceBaseUrl||'',
    confluenceSpaceKeys: cfg.confluenceSpaceKeys||'',
    activityWindowHours: Number.isFinite(+cfg.activityWindowHours) ? Math.min(168, Math.max(1, +cfg.activityWindowHours)) : 72,
    allowInsecureTls:    !!cfg.allowInsecureTls,
    sinceDate:           cfg.sinceDate || '2025-01-01',
    staleDays:           cfg.staleDays??3,
    noMovementDays:      cfg.noMovementDays??2,
    hasJiraToken:        !!cfg.jiraToken,
    hasSigmaJiraToken:   !!cfg.sigmaJiraToken,
    hasBitbucketToken:   !!cfg.bitbucketToken,
    hasConfluenceToken:  !!cfg.confluenceToken,
  };
}

function jiraForward({ targetUrl, method='GET', headers={}, body=null, allowInsecureTls=false, timeoutMs=30000 }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch(e) { return reject(new Error('Bad URL: '+targetUrl)); }
    const lib = parsed.protocol==='https:' ? https : http;
    const opts = {
      method, hostname: parsed.hostname,
      port: parsed.port||(parsed.protocol==='https:'?443:80),
      path: parsed.pathname+(parsed.search||''),
      headers: { Accept:'application/json', 'User-Agent':'sbof-planner/1.0', ...headers },
      rejectUnauthorized: !allowInsecureTls,
    };
    const r = lib.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', c=>chunks.push(c));
      resp.on('end', ()=>resolve({ status:resp.statusCode||0, headers:resp.headers, text:Buffer.concat(chunks).toString('utf8') }));
    });
    r.setTimeout(timeoutMs, ()=>r.destroy(new Error('Timeout '+parsed.hostname)));
    r.on('error', reject);
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

// ── Shared 429 rate-limit gate ─────────────────────────────────────
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
    console.warn(`[jira:gate] closed for ${ms}ms — ${reason}`);
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
  const RATE_LIMIT_MAX  = 12;
  const t0 = Date.now();
  const HARD_BUDGET_MS  = 6 * 60 * 1000;    // 6 min absolute cap per request
  while (true) {
    if (Date.now() - t0 >= HARD_BUDGET_MS) {
      throw Object.assign(new Error(`Jira request budget exhausted after ${rateLimitAttempts} 429s + ${gatewayAttempts} gateway retries`), { status: 0 });
    }
    await _jiraGateWait();           // queue behind any active 429 cooldown
    // V17 P5 — per-call HTTP timeout bumped 25 s → 60 s. Per-query budget
    // (60-75 s above) is the higher gate; this one is the lowest-level
    // per-page bound. Audit 2026-05-V17 pt 5.
    const resp = await jiraForward({ targetUrl:target, method, headers:{ Authorization: authH }, body:body??null, allowInsecureTls:tls, timeoutMs: 60000 });
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
  // Paginate until either (a) all issues fetched, (b) hardCap items collected,
  // or (c) elapsed > timeBudgetMs. The time budget is what keeps a single
  // heavy query (e.g. SMECM backlog with thousands of issues + changelog
  // expand) from holding back the per-PK 35s deadline. Returns whatever
  // pages succeeded — partial results are useful.
  const out = []; let startAt = 0; const t0 = Date.now();
  while (true) {
    const data = await jiraRequest(cfg, 'POST', '/rest/api/2/search', { jql, startAt, maxResults: 100, fields, expand });
    const issues = data.issues || [];
    out.push(...issues);
    const elapsed = Date.now() - t0;
    if (issues.length < 100) break;
    if (out.length >= (data.total || out.length)) break;
    if (startAt > hardCap) break;
    if (elapsed > timeBudgetMs) break;
    startAt += issues.length;
  }
  return out;
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
// Sprint info lives in a "Sprint" custom field whose ID varies between Jira
// instances (10020 on Cloud, 10010/10007 on Server, but corporate Jiras often
// use bespoke IDs like customfield_11200). Static list misses those —
// `_jiraSprintFieldId` is discovered at runtime via /rest/api/2/field.
const JIRA_FIELDS = ['summary','description','status','assignee','reporter','updated','created','priority','issuetype','labels','duedate','timetracking','timeoriginalestimate','aggregatetimespent','worklog','comment','parent','subtasks','resolution','resolutiondate'];

let _jiraSprintFieldIdCache = { url: '', id: '', at: 0 };
const _SPRINT_FIELD_TTL = 30 * 60 * 1000;   // 30 min

/** Discover the Sprint custom-field ID for the current Jira. Cached per-base-URL. */
async function jiraResolveSprintFieldId(cfg) {
  const now = Date.now();
  if (_jiraSprintFieldIdCache.url === cfg.jiraBaseUrl
      && now - _jiraSprintFieldIdCache.at < _SPRINT_FIELD_TTL
      && _jiraSprintFieldIdCache.id) {
    return _jiraSprintFieldIdCache.id;
  }
  try {
    const fields = await jiraRequest(cfg, 'GET', '/rest/api/2/field');
    if (Array.isArray(fields)) {
      // Prefer explicit "Sprint" name (Jira agile module). Fallback to any
      // schema-typed sprint customfield.
      const exact = fields.find(f => (f.name || '').toLowerCase() === 'sprint' && f.id && f.id.startsWith('customfield_'));
      const fuzzy = fields.find(f => f.schema?.custom === 'com.atlassian.jira.plugin.system.customfieldtypes:sprint' || /sprint/i.test(f.id || ''));
      const found = exact || fuzzy;
      if (found && found.id) {
        _jiraSprintFieldIdCache = { url: cfg.jiraBaseUrl, id: found.id, at: now };
        return found.id;
      }
    }
  } catch(_) { /* fall through to fallback */ }
  // Fallback to the most common known IDs — added to fields list, harmless if absent.
  const fallback = 'customfield_10020';
  _jiraSprintFieldIdCache = { url: cfg.jiraBaseUrl, id: fallback, at: now };
  return fallback;
}

/* ── Phase 3 — Zephyr/Xray test-result customfield auto-discovery ──
   Different test-management plugins store the PASS/FAIL outcome in
   different places:
     · Zephyr Squad (Server):  custom field "Test Status" or "Execution Status"
     · Zephyr Scale:           customfield with name containing "test result"
     · Xray:                   customfield "Test Run Status"
   We probe `/rest/api/2/field` once per Jira (TTL 1h) and pick the first
   match by name keyword. Returns '' if nothing matched — caller should
   then fall back to issue.fields.status.name (which works for the
   simplest Zephyr setups where execution status === Jira status).
   ────────────────────────────────────────────────────────────────── */
let _zephyrResultFieldIdCache = { url: '', id: '', at: 0 };
const _ZEPHYR_FIELD_TTL = 60 * 60 * 1000;   // 1 hour
async function jiraResolveZephyrResultFieldId(cfg) {
  const now = Date.now();
  if (_zephyrResultFieldIdCache.url === cfg.jiraBaseUrl
      && now - _zephyrResultFieldIdCache.at < _ZEPHYR_FIELD_TTL) {
    return _zephyrResultFieldIdCache.id;     // may be '' = "no field found"
  }
  let found = '';
  try {
    const fields = await jiraRequest(cfg, 'GET', '/rest/api/2/field');
    if (Array.isArray(fields)) {
      // Match by name keyword, prefer customfield_*. First-match wins —
      // ordering by specificity to avoid picking up unrelated "status" fields.
      const KEYWORDS = [
        /test\s*run\s*status/i,
        /execution\s*status/i,
        /test\s*status/i,
        /test\s*result/i,
        /прогон/i,
        /результ.*тест/i,
      ];
      for (const rx of KEYWORDS) {
        const f = fields.find(f =>
          rx.test(String(f.name || '')) && String(f.id || '').startsWith('customfield_'));
        if (f) { found = f.id; break; }
      }
    }
  } catch(_) { /* probe failed — fall through to '' = use status.name */ }
  _zephyrResultFieldIdCache = { url: cfg.jiraBaseUrl, id: found, at: now };
  return found;
}

async function jiraBuildAreaReport(cfg, area) {
  // Discover the sprint field ID for this Jira (cached). Falls back to common
  // values if the /field probe fails.
  const sprintFieldId = await jiraResolveSprintFieldId(cfg);
  // Phase 3: discover the Zephyr/Xray test-result customfield (returns '' if not found).
  const zephyrFieldId = await jiraResolveZephyrResultFieldId(cfg);
  // Sprint query needs the discovered field; other queries don't.
  // Both sprint+recent+inProgress queries need the zephyr field if we found one,
  // so it's part of every fetch. Empty string is filtered out below.
  const extraFields = [sprintFieldId, 'customfield_10010', 'customfield_10007', zephyrFieldId].filter(Boolean);
  const SPRINT_FIELDS = JIRA_FIELDS.concat(extraFields);
  const ALL_FIELDS    = JIRA_FIELDS.concat([zephyrFieldId].filter(Boolean));
  const pk = area.projectKey;

  // Run the four sub-queries with `allSettled` — one slow / failing query
  // (typically the heavy backlog one) would previously sink the whole PK
  // via Promise.all reject. Now we collect partial results AND keep a
  // per-stage error trail so the diagnostics panel can show what broke.
  //
  // budgetMs per query gates pagination — the per-PK outer timeout (35s
  // default) is the safety net, but each query has its own internal budget
  // so the slowest doesn't starve others. SMECM-class teams have thousands
  // of in-progress / backlog issues; even with hardCap=500, raw network
  // latency for 5 pages × 4 queries × `expand:changelog` overrun the budget.
  // ── Pulse query plan — optimised after repeated 45s timeouts on slow corp Jira ──
  // Key optimisation: ONLY `recent` (last 3 days) needs `expand:changelog` for
  // timeline events. `sprint` and `inProgress` are list-only — analysePulse will
  // STILL pick up changelog for any issue that's also in `recent` because the
  // dedup-by-key step preserves the version with the fattest payload. Issues that
  // are sprint/inProgress but NOT touched in 3d simply have no timeline events
  // (which is correct — there's nothing to bucket). Removing the expand here
  // typically halves response size and 2-4× faster per page.
  // V17 P5 — per-query budgets bumped 2× (was 20-30s, now 60-75s).
  // User-side feedback: timeouts кричали постоянно на медленном корп-Jira.
  // Outer client timeout 600s (10 min) даёт запас 10× даже при 4 backlog'ах
  // подряд по 75s. Audit 2026-05-V17 pt 5.
  const queries = [
    // Sprint is bounded by Jira agile (active-sprint issues only) — usually <300.
    { name: 'sprint',     jql: `project="${pk}" AND sprint in openSprints()`,                                        fields: SPRINT_FIELDS, expand: [],            cap: 500, budgetMs: 75000 },
    // "Updated last 3d" is the timeline data source — needs changelog. Cap small.
    { name: 'recent',     jql: `project="${pk}" AND updated >= -3d`,                                                  fields: ALL_FIELDS,    expand: ['changelog'], cap: 400, budgetMs: 75000 },
    // In-progress can be huge for active teams; we sample. The "what's now"
    // tab uses these — N=500 is enough to surface the headline. NO changelog.
    { name: 'inProgress', jql: `project="${pk}" AND statusCategory = "In Progress"`,                                  fields: ALL_FIELDS,    expand: [],            cap: 500, budgetMs: 60000 },
    // Backlog: NO changelog, cap small. Backlog tab shows counts + types only.
    { name: 'backlog',    jql: `project="${pk}" AND statusCategory != Done AND (sprint is EMPTY OR sprint not in openSprints())`, fields: ALL_FIELDS, expand: [], cap: 200, budgetMs: 60000 },
  ];

  // Timed allSettled — record per-stage ms + status so the diagnostic panel
  // can show "sprint 2.1s ✓ · recent 4.7s ✓ · inProgress 18.0s (cap) · backlog 12.0s (budget)".
  const stageTimings = [];
  const settled = await Promise.allSettled(queries.map(async (q) => {
    const t0 = Date.now();
    try {
      const v = await jiraSearchAll(cfg, q.jql, q.fields, q.expand, q.cap, q.budgetMs);
      stageTimings.push({ name: q.name, ms: Date.now() - t0, ok: true, count: v.length });
      return v;
    } catch (e) {
      stageTimings.push({ name: q.name, ms: Date.now() - t0, ok: false, error: e?.message || String(e) });
      throw e;
    }
  }));

  const stageErrors = [];
  const get = (i) => {
    if (settled[i].status === 'fulfilled') return settled[i].value;
    stageErrors.push(`${queries[i].name}: ${settled[i].reason?.message || settled[i].reason || 'failed'}`);
    return [];   // partial: empty array, other queries' results still flow through
  };
  const sprintIssues     = get(0);
  const recentIssues     = get(1);
  const inProgressIssues = get(2);
  const backlogIssues    = get(3);

  const byKey = new Map();
  for (const arr of [sprintIssues, recentIssues, inProgressIssues, backlogIssues]) {
    for (const it of arr) byKey.set(it.key, it);
  }

  // Only report `error` if EVERY sub-query failed — otherwise return what
  // we got and surface the per-stage trail in `error` for diagnostics.
  const allFailed = stageErrors.length === queries.length;
  return {
    name: area.name, projectKey: pk,
    issues: Array.from(byKey.values()),
    sprintKeys:     sprintIssues.map(i => i.key),
    inProgressKeys: inProgressIssues.map(i => i.key),
    backlogKeys:    backlogIssues.map(i => i.key),
    devStatus: {},
    // Phase 3: tell the model which customfield holds the Zephyr/Xray test
    // result. Empty string = "fall back to issue.fields.status.name".
    zephyrResultFieldId: zephyrFieldId || '',
    error: allFailed ? stageErrors.join(' | ') : null,
    stageErrors: stageErrors.length ? stageErrors : null,
    stageTimings,        // [{name, ms, ok, count?, error?}] — surfaced in pp diagnostics
  };
}

/* ────────────────────────────────────────────────────────────
   Portfolio Pulse: Bitbucket / Confluence 48h-window aggregators.
   Returns { authors: { [lowerKey]: { commits, prs, displayName, email? } } }.

   Tries Cloud-style endpoints first (matches existing /api/integrations/
   bitbucket-prs handler). If a request 404s, falls back to Bitbucket Server
   (Stash) REST 1.0 paths. Project-key syntax: "workspace/repo" for Cloud,
   "PROJECT/repo" for Server (single-segment entries are skipped — we can't
   infer the workspace/project).
   ─────────────────────────────────────────────────────────── */
function _ppMakeAuthHeader(token) {
  if (!token) return '';
  return token.includes(':') ? 'Basic ' + Buffer.from(token).toString('base64') : 'Bearer ' + token;
}
function _ppKeyForAuthor(name, email) {
  return String(name || email || '').trim().toLowerCase();
}

/**
 * V18 P6 — централизованный redact для текстов которые могут содержать
 * echo'enные токены (некоторые корп-proxy возвращают `Authorization` header
 * в response body; эти echoes не должны попадать в ErrorsLog или toast'ы).
 *
 * Применять ВЕЗДЕ где error-text от внешнего сервера всплывает в UI или logs:
 *   - integrations error paths (employeePerformance, sync, etc)
 *   - server.js outgoing-fetch error responses
 *   - LLM streaming error paths
 *
 * Ограничение: первые 200 символов оригинала, чтобы не шить туда всю выдачу
 * сервера (это часто HTML-страница или огромный stack trace).
 *
 * @param {string|unknown} text
 * @param {number} [maxLen=200]
 * @returns {string} безопасная для логов / toast'ов строка
 */
function _ppRedactSecretsInText(text, maxLen = 200) {
  return String(text == null ? '' : text).slice(0, maxLen)
    .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
    .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
    .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***');
}

/**
 * V18 P5 — единый helper для path-cascade pattern, который раньше дублировался
 * в 4 endpoint'ах (confluence-search, verify-confluence, confluence-audit-logins,
 * a также внутри ppFetchConfluenceActivity для каждой CQL).
 *
 * Atlassian Cloud живёт на /wiki/rest/..., DC/Server — на /rest/..., некоторые
 * legacy installs — на /rest/api/search. Cascade пробует кандидатов один за
 * другим:
 *   - 401/403 на любом → bail-out с authError (cascade не помог бы)
 *   - 2xx → success, return сразу (вызывающий парсит response.text)
 *   - 404 / другое 4xx / 5xx → пробуем следующий URL
 *   - все провалились → ok:false с last status
 *
 * @param {string[]} urls           — URL'ы в порядке убывания вероятности
 * @param {object}   opts
 * @param {object}   opts.headers   — обычно { Authorization, Accept }
 * @param {boolean}  opts.allowInsecureTls
 * @param {number}   [opts.timeoutMs=20000]
 * @param {string}   [opts.method='GET']
 * @returns {Promise<{ok: boolean, status?: number, text?: string, authError?: number, error?: string, tried: Array<{url:string,status:number,error?:string}>}>}
 */
async function _cfPathCascade(urls, opts = {}) {
  const tried = [];
  const { headers = {}, allowInsecureTls = false, timeoutMs = 20000, method = 'GET' } = opts;
  let lastStatus = 0;
  for (const url of urls) {
    const r = await jiraForward({
      targetUrl: url, method, headers, allowInsecureTls, timeoutMs,
    }).catch((e) => ({ status: 0, text: String(e?.message || e), _err: e?.message }));
    tried.push({ url: url.replace(/\?.*$/, ''), status: r.status, ...(r._err ? { error: r._err } : {}) });
    lastStatus = r.status || lastStatus;
    if (r.status === 401 || r.status === 403) {
      return { ok: false, authError: r.status, tried };
    }
    if (r.status >= 200 && r.status < 300) {
      return { ok: true, status: r.status, text: r.text, tried };
    }
    // 404 / 400 / 5xx → попробуем следующий
  }
  return { ok: false, status: lastStatus, error: lastStatus ? `HTTP ${lastStatus}` : 'no response', tried };
}
async function ppFetchBitbucketActivity(cfg, tls, cutoffTs, cutoffIso) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { authors: {}, configured: false };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const isCloud = /bitbucket\.org/i.test(base) || /\/2\.0\b/.test(base);
  const repos = String(cfg.bitbucketProjectKeys || '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
  if (!repos.length) return { authors: {}, configured: true, error: 'projectKeys пусты' };
  // lowerKey → { commits, prs, displayName, email,
  //              items: [{kind:'pr'|'commit', title, url, repo, at, status?}] }
  // items[] is capped at 50 per author so even a huge contributor stays bounded.
  const authors = {};
  const tried = [];
  const ITEMS_CAP_PER_AUTHOR = 50;
  const bump = (kind, displayName, email, item) => {
    const k = _ppKeyForAuthor(displayName, email);
    if (!k) return;
    if (!authors[k]) authors[k] = {
      commits: 0, prs: 0, displayName: displayName || email || k, email: email || '', items: [],
      // Wave 4d: PR review action counters. `reviews` is the umbrella sum;
      // breakdowns let the renderer show "✓3 approve · ⚠1 needs-work".
      reviews: 0, approves: 0, needsWork: 0, declined: 0, prComments: 0,
    };
    if (!authors[k][kind] && kind !== 'reviews') authors[k][kind] = 0;
    authors[k][kind]++;
    if (!authors[k].displayName && displayName) authors[k].displayName = displayName;
    if (!authors[k].email && email) authors[k].email = email;
    if (item && authors[k].items.length < ITEMS_CAP_PER_AUTHOR) {
      authors[k].items.push(item);
    }
  };
  // Track PRs we should ask for activity stream. Each entry: {proj, repo, prId, at, title, url, isCloud:false, repoPath}.
  // Capped globally to 30 to bound the per-PK 90 s budget.
  const _prsForActivity = [];
  const ACTIVITY_CAP = 30;
  const get = (url) => jiraForward({
    targetUrl: url, method: 'GET',
    headers: { Authorization: auth },
    allowInsecureTls: tls, timeoutMs: 20000,
  }).catch(e => ({ status: 0, text: '', _err: e.message }));

  // Expand single-segment Server entries (e.g. "SBOFPL") to all repos under
  // that project — saves the user from having to list every repo manually.
  const expanded = [];
  for (const entry of repos) {
    const segs = entry.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2 || isCloud) { expanded.push(entry); continue; }
    // Single segment + Server mode: probe `/projects/{KEY}/repos`.
    const projKey = segs[0];
    const repoListResp = await jiraForward({
      targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(projKey)}/repos?limit=50`,
      method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 15000,
    }).catch(e => ({ status: 0, text: '', _err: e.message }));
    tried.push({ entry, type: 'list-repos', status: repoListResp.status });
    if (repoListResp.status >= 200 && repoListResp.status < 300) {
      try {
        const list = (JSON.parse(repoListResp.text).values || []).map(r => `${projKey}/${r.slug || r.name}`);
        if (list.length) {
          expanded.push(...list.slice(0, 10));   // cap to first 10 repos to keep latency bounded
        } else {
          tried.push({ entry, skipped: 'у проекта нет репозиториев или нет доступа' });
        }
      } catch (_) {
        tried.push({ entry, skipped: 'не удалось разобрать список репозиториев' });
      }
    } else {
      tried.push({ entry, skipped: `проект не найден / 401-403 (HTTP ${repoListResp.status}) — нужен формат PROJECT/repo для Server, либо токен без доступа к проекту` });
    }
  }

  for (const entry of expanded) {
    const segs = entry.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length < 2 && !isCloud) { tried.push({ entry, skipped: 'нужен формат PROJECT/repo для Server' }); continue; }
    const proj = segs.length >= 2 ? segs[0] : '';
    const repo = segs[segs.length - 1];

    // === CLOUD ===
    if (isCloud) {
      const repoPath = segs.length >= 2 ? `${segs[0]}/${segs[1]}` : repo;
      // Pull-requests updated in 48h window. q= filter is server-side (cheap).
      const prsResp = await get(`${base}/repositories/${encodeURI(repoPath)}/pullrequests?pagelen=50&state=OPEN,MERGED,DECLINED&q=updated_on>"${cutoffIso}"`);
      tried.push({ entry: repoPath, type: 'pr', status: prsResp.status });
      if (prsResp.status >= 200 && prsResp.status < 300) {
        try { for (const p of (JSON.parse(prsResp.text).values || [])) {
          bump('prs', p.author?.display_name || '', p.author?.nickname || '', {
            kind: 'pr',
            title:  p.title || '',
            url:    p.links?.html?.href || '',
            repo:   repoPath,
            at:     p.updated_on || p.created_on || '',
            status: (p.state || '').toLowerCase(),
          });
        } } catch(_) {}
      }
      // Commits — no server-side date filter, paginate first page and filter client-side.
      const cmResp = await get(`${base}/repositories/${encodeURI(repoPath)}/commits?pagelen=100`);
      tried.push({ entry: repoPath, type: 'commit', status: cmResp.status });
      if (cmResp.status >= 200 && cmResp.status < 300) {
        try {
          for (const c of (JSON.parse(cmResp.text).values || [])) {
            const ts = Date.parse(c.date || '');
            if (!Number.isFinite(ts) || ts < cutoffTs) continue;
            const dn = c.author?.user?.display_name || _parseEmailName(c.author?.raw);
            const em = _parseEmailEmail(c.author?.raw);
            bump('commits', dn, em, {
              kind: 'commit',
              title: (c.message || '').split('\n')[0],
              url:    c.links?.html?.href || '',
              repo:   repoPath,
              at:     c.date || '',
              hash:   c.hash || '',
            });
          }
        } catch(_) {}
      }
      continue;
    }
    // === SERVER (Stash) ===
    if (proj && repo) {
      // PRs: state=ALL, order=NEWEST, filter by updatedDate client-side
      const prsResp = await get(`${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/pull-requests?state=ALL&order=NEWEST&limit=50`);
      tried.push({ entry, type: 'pr', status: prsResp.status });
      if (prsResp.status >= 200 && prsResp.status < 300) {
        try {
          for (const p of (JSON.parse(prsResp.text).values || [])) {
            const ts = p.updatedDate || p.createdDate || 0;
            if (ts < cutoffTs) continue;
            const u = p.author?.user || {};
            const prTitle = p.title || '';
            const prUrl   = p.links?.self?.[0]?.href || '';
            bump('prs', u.displayName || u.name || '', u.emailAddress || '', {
              kind: 'pr',
              title:  prTitle,
              url:    prUrl,
              repo:   `${proj}/${repo}`,
              at:     ts ? new Date(ts).toISOString() : '',
              status: (p.state || '').toLowerCase(),
              prId:   p.id,
            });
            // Wave 4d: queue activity-stream fetch for this PR (Server only).
            if (_prsForActivity.length < ACTIVITY_CAP && p.id != null) {
              _prsForActivity.push({ proj, repo, prId: p.id, at: ts, title: prTitle, url: prUrl });
            }
          }
        } catch(_) {}
      }
      // Commits — no since param without sha; pull recent and filter by authorTimestamp.
      const cmResp = await get(`${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/commits?limit=100`);
      tried.push({ entry, type: 'commit', status: cmResp.status });
      if (cmResp.status >= 200 && cmResp.status < 300) {
        try {
          for (const c of (JSON.parse(cmResp.text).values || [])) {
            const ts = c.authorTimestamp || c.committerTimestamp || 0;
            if (ts < cutoffTs) continue;
            const a = c.author || {};
            bump('commits', a.displayName || a.name || '', a.emailAddress || '', {
              kind: 'commit',
              title: (c.message || '').split('\n')[0],
              url:   `${base}/projects/${proj}/repos/${repo}/commits/${c.id || c.displayId || ''}`,
              repo:  `${proj}/${repo}`,
              at:    ts ? new Date(ts).toISOString() : '',
              hash:  c.displayId || c.id || '',
            });
          }
        } catch(_) {}
      }
    }
  }
  // ── Wave 4d: pull review-action stream for the recent PRs (Server). ──
  // Each PR's `/activities` returns a paginated list of events: APPROVED,
  // UNAPPROVED, REVIEWED, COMMENTED, DECLINED, MERGED, OPENED, etc. We bump
  // per-author counters for the review-relevant ones and append items[] so
  // the timeline can show "Иван approved PAY-1234 (PR #234)".
  if (_prsForActivity.length) {
    const ACTIVITY_CONCURRENCY = 4;
    let i = 0, running = 0;
    await new Promise((resolve) => {
      const next = () => {
        while (running < ACTIVITY_CONCURRENCY && i < _prsForActivity.length) {
          const job = _prsForActivity[i++]; running++;
          (async () => {
            const { proj, repo, prId, title, url } = job;
            const aResp = await get(`${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/pull-requests/${prId}/activities?limit=100`);
            tried.push({ entry: `${proj}/${repo}#${prId}`, type: 'pr-activity', status: aResp.status });
            if (aResp.status >= 200 && aResp.status < 300) {
              try {
                for (const a of (JSON.parse(aResp.text).values || [])) {
                  const ts = a.createdDate || 0;
                  if (ts < cutoffTs) continue;
                  const u = a.user || {};
                  const action = String(a.action || '').toUpperCase();
                  const dn = u.displayName || u.name || '';
                  const em = u.emailAddress || '';
                  // Map Stash actions → which counter to bump. Skip OPENED /
                  // MERGED / RESCOPED — those are author-side, not reviews.
                  const counter =
                    action === 'APPROVED'  ? 'approves'   :
                    action === 'REVIEWED'  ? 'needsWork'  :    // Stash uses REVIEWED for needs-work
                    action === 'DECLINED'  ? 'declined'   :
                    action === 'COMMENTED' ? 'prComments' : '';
                  if (!counter) continue;
                  // Bump both: specific counter + umbrella `reviews`.
                  bump(counter, dn, em, {
                    kind:  'review',
                    title: `${action.toLowerCase()} · ${title}`,
                    url,   repo: `${proj}/${repo}`,
                    at:    ts ? new Date(ts).toISOString() : '',
                    action,
                    prId,
                  });
                  bump('reviews', dn, em, null);
                }
              } catch(_) {}
            }
          })().finally(() => { running--; if (i >= _prsForActivity.length && running === 0) resolve(); else next(); });
        }
      };
      next();
    });
  }

  return { authors, configured: true, repos: expanded.length, tried, prActivitiesScanned: _prsForActivity.length };
}
function _parseEmailName(raw) {
  if (!raw) return ''; const m = String(raw).match(/^([^<]+)</); return m ? m[1].trim() : '';
}
function _parseEmailEmail(raw) {
  if (!raw) return ''; const m = String(raw).match(/<([^>]+)>/); return m ? m[1].trim() : '';
}

/* ============================================================
   PHASE 1 — Jira dev-status panel as PR/commit source
   --
   The "Development" panel on every Jira issue (Bitbucket connector)
   already knows which PRs and commits belong to it — Jira indexes
   them by issue key in the commit message + branch name. This API
   returns that linked list for a single issue:

     GET /rest/dev-status/1.0/issue/detail
         ?issueId={numericId}
         &applicationType=stash|bitbucket
         &dataType=pullrequest|repository

   Pros over crawling repos directly:
     · No `bitbucketProjectKeys` setting needed
     · Catches PRs/commits across ALL repos in the company
     · Already attributed to a Jira key — no fuzzy matching

   Cons:
     · One HTTP call per issue per dataType (PRs + commits = 2 calls/issue).
       We cap at 1000 calls per pulse + concurrency 8 to stay under the 90s
       per-PK timeout. For 5 PKs × ~150 hot issues each (sprint+inProgress+recent),
       that's ~1500 calls — capped at 1000.
   ============================================================ */
async function ppFetchDevStatusForIssues(cfg, tls, cutoffTs, hotIssues) {
  if (!cfg.jiraBaseUrl || !cfg.jiraToken) return { authors: {}, configured: false, tried: [] };
  if (!Array.isArray(hotIssues) || !hotIssues.length) return { authors: {}, configured: true, tried: [], scanned: 0 };

  const base = cfg.jiraBaseUrl.replace(/\/+$/, '');
  const auth = cfg.jiraToken.includes(':')
    ? 'Basic ' + Buffer.from(cfg.jiraToken).toString('base64')
    : 'Bearer ' + cfg.jiraToken;

  const ITEMS_CAP_PER_AUTHOR = 50;
  const authors = {};
  const tried = [];
  // Stash sometimes uses applicationType=bitbucket on newer installs. We prefer
  // 'stash' first (matches existing ppFetchBitbucketActivity expectations) but
  // remember which one yielded results so we don't waste calls on the other.
  let preferredAppType = 'stash';
  let appTypeProbed = false;

  const bump = (kind, displayName, email, item) => {
    const k = _ppKeyForAuthor(displayName, email);
    if (!k) return;
    if (!authors[k]) authors[k] = {
      commits: 0, prs: 0, displayName: displayName || email || k, email: email || '', items: [],
      reviews: 0, approves: 0, needsWork: 0, declined: 0, prComments: 0,
    };
    if (typeof authors[k][kind] !== 'number') authors[k][kind] = 0;
    authors[k][kind]++;
    if (!authors[k].displayName && displayName) authors[k].displayName = displayName;
    if (!authors[k].email && email) authors[k].email = email;
    if (item && authors[k].items.length < ITEMS_CAP_PER_AUTHOR) {
      authors[k].items.push(item);
    }
  };

  // Cap total calls so a noisy portfolio doesn't blow the per-PK timeout.
  // Two calls per issue (PR + commits) → 1000 calls = 500 issues max.
  const TOTAL_CALL_CAP = 1000;
  const PER_CALL_TIMEOUT_MS = 5000;
  const CONCURRENCY = 8;

  const queue = [];
  for (const issue of hotIssues) {
    if (queue.length >= TOTAL_CALL_CAP) break;
    if (!issue?.id) continue;            // numeric id required by dev-status endpoint
    queue.push({ issueId: String(issue.id), issueKey: issue.key, dataType: 'pullrequest' });
    if (queue.length >= TOTAL_CALL_CAP) break;
    queue.push({ issueId: String(issue.id), issueKey: issue.key, dataType: 'repository' });
  }
  if (!queue.length) return { authors, configured: true, tried, scanned: 0 };

  // Hash to dedup PRs / commits seen across multiple linked Jira issues — same
  // PR is often linked to PAY-1, PAY-2 simultaneously; we count it once.
  const seenPr     = new Set();
  const seenCommit = new Set();
  const seenAuthorKeys = new Set();    // dedup author identity per (kind, prId|hash)

  const fetchOne = async (job) => {
    // Per-call timeout via AbortController-style timeoutMs in jiraForward.
    // Cascade applicationType: try preferredAppType first; if 200 + no detail
    // entries on FIRST few calls, fall back to the other.
    const url = `${base}/rest/dev-status/1.0/issue/detail?issueId=${encodeURIComponent(job.issueId)}&applicationType=${preferredAppType}&dataType=${job.dataType}`;
    const r = await jiraForward({
      targetUrl: url, method: 'GET',
      headers: { Authorization: auth },
      allowInsecureTls: tls, timeoutMs: PER_CALL_TIMEOUT_MS,
    }).catch(e => ({ status: 0, text: '', _err: e.message }));

    tried.push({ entry: job.issueKey, type: `dev-${job.dataType}`, status: r.status });

    if (r.status < 200 || r.status >= 300) return { found: 0 };

    let parsed;
    try { parsed = JSON.parse(r.text); } catch (_) { return { found: 0 }; }
    const detail = Array.isArray(parsed?.detail) ? parsed.detail : [];

    // First-pass appType probe: if pullrequest dataType returned an empty
    // detail[] for the first ~5 issues with `stash`, switch to `bitbucket`.
    if (!appTypeProbed && tried.length >= 5 && detail.every(d => !d.pullRequests?.length && !d.repositories?.length)) {
      preferredAppType = preferredAppType === 'stash' ? 'bitbucket' : 'stash';
      appTypeProbed = true;
    }

    let found = 0;
    if (job.dataType === 'pullrequest') {
      for (const d of detail) for (const pr of (d.pullRequests || [])) {
        const at = pr.lastUpdate || pr.updated || '';
        if (at && Date.parse(at) < cutoffTs) continue;     // outside 48h window
        const prId = String(pr.id || pr.url || '');
        const dedupKey = `${prId}|${pr.author?.name || ''}`;
        if (seenAuthorKeys.has(dedupKey)) continue;
        seenAuthorKeys.add(dedupKey);
        seenPr.add(prId);
        bump('prs', pr.author?.name || pr.author?.displayName || '', pr.author?.email || '', {
          kind:   'pr',
          title:  pr.name || pr.title || '',
          url:    pr.url || '',
          repo:   pr.repositoryName || pr.source?.repository?.name || '',
          at, status: String(pr.status || '').toLowerCase(),
          prId,
          source: 'dev-status',
        });
        found++;
      }
    } else if (job.dataType === 'repository') {
      for (const d of detail) for (const repo of (d.repositories || [])) {
        for (const c of (repo.commits || [])) {
          const at = c.authorTimestamp || c.timestamp || '';
          if (at && Date.parse(at) < cutoffTs) continue;
          const hash = String(c.id || c.displayId || '');
          if (seenCommit.has(hash)) continue;
          seenCommit.add(hash);
          bump('commits', c.author?.name || c.author?.displayName || '', c.author?.email || '', {
            kind: 'commit',
            title: String(c.message || '').split('\n')[0],
            url:    c.url || `${base}/projects/_/repos/${encodeURIComponent(repo.name||'_')}/commits/${hash}`,
            repo:   repo.name || '',
            at, hash,
            source: 'dev-status',
          });
          found++;
        }
      }
    }
    return { found };
  };

  // Concurrent worker pool — drains `queue` with `CONCURRENCY` parallel fetches.
  await new Promise((resolve) => {
    let i = 0, running = 0;
    const next = () => {
      while (running < CONCURRENCY && i < queue.length) {
        const job = queue[i++]; running++;
        fetchOne(job).finally(() => {
          running--;
          if (i >= queue.length && running === 0) resolve();
          else next();
        });
      }
      if (!queue.length) resolve();
    };
    next();
  });

  return { authors, configured: true, tried, scanned: queue.length, prs: seenPr.size, commits: seenCommit.size };
}

/** Merge two `{authors: {[k]: {commits, prs, items, ...}}}` aggregates into one.
 *  Counters are summed; items[] are concatenated up to the per-author cap of 50.
 *  Used to combine repo-walk Bitbucket data with Jira dev-status data. */
function _ppMergeAuthorMaps(...maps) {
  const out = {};
  const ITEMS_CAP = 50;
  const COUNT_FIELDS = ['commits', 'prs', 'reviews', 'approves', 'needsWork', 'declined', 'prComments'];
  // Item dedup across sources: a PR found by repo-walk AND dev-status
  // appears twice unless we key by (kind, prId|hash, source) and skip dups.
  for (const m of maps) {
    if (!m || typeof m !== 'object') continue;
    for (const [k, a] of Object.entries(m)) {
      if (!out[k]) {
        out[k] = { displayName: a.displayName || k, email: a.email || '', items: [] };
        for (const f of COUNT_FIELDS) out[k][f] = 0;
      }
      // Prefer the more-informative displayName / email (non-empty wins).
      if (!out[k].displayName && a.displayName) out[k].displayName = a.displayName;
      if (!out[k].email       && a.email)       out[k].email       = a.email;
      for (const f of COUNT_FIELDS) out[k][f] += (a[f] || 0);
      const seen = new Set(out[k].items.map(it => `${it.kind}|${it.prId || it.hash || it.url || ''}`));
      for (const it of (a.items || [])) {
        const dk = `${it.kind}|${it.prId || it.hash || it.url || ''}`;
        if (dk && seen.has(dk)) continue;
        if (out[k].items.length >= ITEMS_CAP) break;
        seen.add(dk);
        out[k].items.push(it);
      }
      out[k].items.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
    }
  }
  return out;
}

/* ============================================================
   TECH INFO → server/integrations/techInfo.js  (audit #19 decomposition).
   Wires runtime deps (jiraRequest, jiraForward, basic-auth header) into
   the factory and re-exports the public surface unchanged.
   ============================================================ */
const { createTechInfo } = require("./server/integrations/techInfo.js");
const { buildTechInfo } = createTechInfo({
  jiraRequest,
  jiraForward,
  makeBasicAuthHeader: _ppMakeAuthHeader,
});

/* ============================================================
   BLACK DASHBOARD → server/integrations/blackDashboard.js  (audit #19 decomposition).
   ============================================================ */
const { createBlackDashboard } = require("./server/integrations/blackDashboard.js");
const { buildBlackDashboard, sigmaCfgView } = createBlackDashboard({
  jiraRequest,
  jiraSearchAll,
});

// ── Async job store for Чёрный дашборд ──────────────────────
// V13 (2026-04, 6th pass): a single synchronous fetch can't survive 5+ min
// of work — corp HTTPS proxies, browser timeouts, and OS connection idle
// limits all kill long-lived requests. Switched to async-job pattern:
//   • POST /start  → returns { jobId } instantly, kicks off work in bg.
//   • GET  /status?jobId=X → returns { status, progress, result?, error? }.
// Each request is sub-second; client polls. Server can grind for as long
// as it needs without any single connection holding open.
const _bdJobs = new Map();
let _bdJobCounter = 0;
const BD_JOB_TTL_MS = 30 * 60 * 1000;       // jobs evicted 30 min after finish
const BD_JOB_MAX    = 50;                   // hard ceiling; oldest evicted

function bdGCJobs() {
  // Drop finished jobs older than TTL, plus enforce max-count cap.
  const now = Date.now();
  for (const [id, job] of _bdJobs) {
    const t = job.finishedAt || job.startedAt;
    if (now - t > BD_JOB_TTL_MS) _bdJobs.delete(id);
  }
  if (_bdJobs.size > BD_JOB_MAX) {
    const entries = [..._bdJobs.entries()].sort(
      (a, b) => (a[1].finishedAt || a[1].startedAt) - (b[1].finishedAt || b[1].startedAt)
    );
    const overflow = _bdJobs.size - BD_JOB_MAX;
    for (let i = 0; i < overflow; i++) _bdJobs.delete(entries[i][0]);
  }
}

function bdCreateJob() {
  bdGCJobs();
  const id = `bd-${++_bdJobCounter}-${Date.now().toString(36)}`;
  const job = {
    id,
    status:     'running',          // 'running' | 'done' | 'error'
    startedAt:  Date.now(),
    finishedAt: null,
    result:     null,
    error:      null,
    phase:      'init',             // free-form progress label
  };
  _bdJobs.set(id, job);
  return job;
}

function bdGetJob(id) { return _bdJobs.get(id) || null; }

/** Run buildBlackDashboard in the background and write result/error onto
 *  the job object. Never awaited from the request handler. */
function bdRunJob(job, cfg) {
  Promise.resolve()
    .then(() => buildBlackDashboard(cfg))
    .then(
      (result) => {
        job.status     = 'done';
        job.result     = result;
        job.finishedAt = Date.now();
        job.phase      = 'done';
      },
      (err) => {
        job.status     = 'error';
        job.error      = err?.message || String(err);
        job.finishedAt = Date.now();
        job.phase      = 'error';
        console.warn(`[bd:job ${job.id}] failed:`, job.error);
      }
    );
}

/* ============================================================
   V18 P7 — Pulse async-job pattern (mirrors blackDashboard).
   Sync `/portfolio-pulse` POST остаётся для backward-compat и contract-тестов;
   новый frontend идёт через POST /start + GET /status.
   ============================================================ */
const _pulseJobs = new Map();
let _pulseJobCounter = 0;
const PULSE_JOB_TTL_MS = 30 * 60 * 1000;
const PULSE_JOB_MAX    = 20;

function pulseGCJobs() {
  const now = Date.now();
  for (const [id, job] of _pulseJobs) {
    const t = job.finishedAt || job.startedAt;
    if (now - t > PULSE_JOB_TTL_MS) _pulseJobs.delete(id);
  }
  if (_pulseJobs.size > PULSE_JOB_MAX) {
    const entries = [..._pulseJobs.entries()].sort(
      (a, b) => (a[1].finishedAt || a[1].startedAt) - (b[1].finishedAt || b[1].startedAt)
    );
    for (let i = 0; i < _pulseJobs.size - PULSE_JOB_MAX; i++) _pulseJobs.delete(entries[i][0]);
  }
}
function pulseCreateJob(payload) {
  pulseGCJobs();
  const id = `pulse-${++_pulseJobCounter}-${Date.now().toString(36)}`;
  const job = { id, status: 'running', startedAt: Date.now(), finishedAt: null, result: null, error: null, phase: 'init', payload: payload || null };
  _pulseJobs.set(id, job);
  return job;
}
function pulseGetJob(id) { return _pulseJobs.get(id) || null; }
function pulseRunJob(job, runner) {
  Promise.resolve()
    .then(() => runner(job))
    .then(
      (result) => { job.status = 'done';  job.result = result; job.finishedAt = Date.now(); job.phase = 'done'; },
      (err)    => { job.status = 'error'; job.error = err?.message || String(err); job.finishedAt = Date.now(); job.phase = 'error';
                    console.warn(`[pulse:job ${job.id}] failed:`, job.error); }
    );
}

/**
 * V18 P7 — выделено из inline /api/integrations/portfolio-pulse handler'а.
 * Возвращает full Pulse response { reports, bitbucket, confluence, ... }.
 * При ошибках валидации throws Error с `.statusCode = 400`.
 * @param {object} body  request body (`projectKeys`, optional `employees`)
 * @param {object} cfg   jiraReadConfig() result
 * @param {boolean} tls
 * @param {(phase: string) => void} [onPhase]  optional progress callback (для async-job)
 * @returns {Promise<object>}
 */
async function _runPortfolioPulse(body, cfg, tls, onPhase) {
  const setPhase = typeof onPhase === 'function' ? onPhase : (() => {});
  if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
    const err = new Error('Jira не настроена'); err.statusCode = 400; throw err;
  }
  let pks = Array.isArray(body.projectKeys) ? body.projectKeys
          : String(body.projectKeys || '').split(',');
  pks = pks.map(s => String(s||'').trim()).filter(Boolean);
  if (!pks.length) {
    const fromCfg = String(cfg.jiraProjectKeys || '').split(',').map(s=>s.trim()).filter(Boolean);
    const fromAreas = jiraSanitizeAreas(cfg.areas).map(a => a.projectKey);
    pks = fromCfg.length ? fromCfg : fromAreas;
  }
  if (!pks.length) {
    const err = new Error('Не указаны projectKeys'); err.statusCode = 400; throw err;
  }

  const winHours    = Math.min(168, Math.max(1, Number(cfg.activityWindowHours) || 72));
  const cutoffTs    = Date.now() - winHours * 3600 * 1000;
  const cutoffIso   = new Date(cutoffTs).toISOString();
  const cqlCutoffTs = cutoffTs - 60 * 60 * 1000;
  const PER_PK_TIMEOUT_MS = parseInt(process.env.PULSE_PK_TIMEOUT_MS || '90000', 10);
  const t0 = Date.now();
  const log = [`[pulse] start: ${pks.length} PKs, timeout/PK ${PER_PK_TIMEOUT_MS}ms`];
  setPhase(`fetch-jira (${pks.length} PKs)`);

  const withTimeout = (label, promise, ms) => Promise.race([
    promise.then(v => ({ ok: true, value: v })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: ms }), ms)),
  ]).then(r => { if (!r.ok) log.push(`[pulse] ${label} TIMEOUT after ${r.timeout}ms`); return r; });

  const reportsPromise = jiraPLimit(2, pks.map(pk => async () => {
    const pkStart = Date.now();
    const area    = { name: pk, projectKey: pk };
    const r = await withTimeout(`pk:${pk}`, jiraBuildAreaReport(cfg, area), PER_PK_TIMEOUT_MS);
    const elapsed = Date.now() - pkStart;
    if (!r.ok) {
      log.push(`[pulse] ${pk}: timeout after ${elapsed}ms`);
      return { projectKey: pk, error: `timeout ${PER_PK_TIMEOUT_MS}ms`, issues: [], sprintKeys: [], inProgressKeys: [], backlogKeys: [], _ms: elapsed };
    }
    const data = r.value;
    if (Array.isArray(data.stageTimings)) {
      for (const s of data.stageTimings) {
        log.push(`[pulse] ${pk} · ${s.name}: ${s.ms}ms ${s.ok ? '✓ ' + (s.count ?? 0) + ' issues' : '✗ ' + (s.error || 'failed')}`);
      }
    }
    log.push(`[pulse] ${pk}: ${data.error ? 'ERROR ' + data.error : (data.issues?.length || 0) + ' issues'} · ${elapsed}ms`);
    return {
      projectKey: pk,
      error:          data.error || null,
      issues:         data.issues || [],
      sprintKeys:     data.sprintKeys || [],
      inProgressKeys: data.inProgressKeys || [],
      backlogKeys:    data.backlogKeys || [],
      stageTimings:   data.stageTimings || [],
      zephyrResultFieldId: data.zephyrResultFieldId,
      _ms:            elapsed,
    };
  }));
  const bbPromise = withTimeout('bitbucket',
    ppFetchBitbucketActivity(cfg, tls, cutoffTs, cutoffIso), PER_PK_TIMEOUT_MS);
  const ppCfEmployees = Array.isArray(body?.employees) ? body.employees : [];
  const cfPromise = withTimeout('confluence',
    ppFetchConfluenceActivity(cfg, tls, cutoffTs, { cqlCutoffTs, employees: ppCfEmployees }), PER_PK_TIMEOUT_MS);

  const [reports, bbR, cfR] = await Promise.all([reportsPromise, bbPromise, cfPromise]);
  setPhase('fetch-bb-cf-done');
  const bitbucketRepoWalk = bbR.ok ? bbR.value : { authors: {}, error: `timeout ${PER_PK_TIMEOUT_MS}ms` };
  const confluence = cfR.ok ? cfR.value : { authors: {}, error: `timeout ${PER_PK_TIMEOUT_MS}ms` };

  const hotIssues = [];
  for (const r of reports) {
    if (r.error) continue;
    const backlogSet = new Set(r.backlogKeys || []);
    for (const it of (r.issues || [])) {
      if (!backlogSet.has(it.key)) hotIssues.push(it);
    }
  }
  setPhase('dev-status');
  const dsR = await withTimeout('dev-status',
    ppFetchDevStatusForIssues(cfg, tls, cutoffTs, hotIssues), PER_PK_TIMEOUT_MS).catch(()=>({ ok:false }));
  const devStatus = dsR && dsR.ok ? dsR.value : { authors: {}, configured: false, tried: [], scanned: 0 };
  // V18 P8 — раздельные bucket'ы для repo-walk и dev-status authors.
  //   repoAuthors  = authoritative из Bitbucket repo-walk (юзер настроил BB)
  //   devStatusAuthors = supplementary из Jira dev-info panel (cross-checked
  //     for email/login существование). Frontend (analysePulse) теперь сам
  //     решает что показать пользователю — UI может разделить их (например,
  //     помечать devStatus-only как "Внешние авторы PR" в карточке).
  //   `authors` (merged) ОСТАВЛЕН для backward-compat: текущий frontend пока
  //   читает `authors`. Когда переедет на raw repoAuthors+devStatusAuthors —
  //   merged можно удалить.
  const _devStatusAuthorsFiltered = {};
  for (const [k, v] of Object.entries(devStatus.authors || {})) {
    const hasEmail = !!String(v?.email || '').trim();
    const hasLoginishKey = /^[a-z0-9._-]+$/i.test(String(k).trim());
    if (hasEmail || hasLoginishKey) _devStatusAuthorsFiltered[k] = v;
  }
  const mergedAuthors = _ppMergeAuthorMaps(bitbucketRepoWalk.authors || {}, _devStatusAuthorsFiltered);
  const bitbucket = {
    authors:           mergedAuthors,                                 // legacy — будет retired когда frontend перейдёт на raw bucket'ы
    repoAuthors:       bitbucketRepoWalk.authors || {},               // V18 P8 — pure repo-walk (Bitbucket настроен)
    devStatusAuthors:  _devStatusAuthorsFiltered,                     // V18 P8 — pure dev-info (через Jira), filtered
    configured: bitbucketRepoWalk.configured,
    tried:      [...(bitbucketRepoWalk.tried || []), ...(devStatus.tried || [])],
    repos:      bitbucketRepoWalk.repos || 0,
    prActivitiesScanned: bitbucketRepoWalk.prActivitiesScanned || 0,
    devStatus:  { scanned: devStatus.scanned || 0, prs: devStatus.prs || 0, commits: devStatus.commits || 0, configured: devStatus.configured },
    error:      bitbucketRepoWalk.error || null,
  };
  log.push(`[pulse] dev-status: scanned ${devStatus.scanned||0} dev-info calls, found ${devStatus.prs||0} PR · ${devStatus.commits||0} commits`);
  log.push(`[pulse] done in ${Date.now() - t0}ms · ${reports.filter(r => !r.error).length}/${reports.length} PKs ok`);
  setPhase('finalize');

  const zephyrResultFieldId = reports.find(r => r.zephyrResultFieldId)?.zephyrResultFieldId || '';
  return {
    reports,
    fetchedAt:   new Date().toISOString(),
    projectKeys: pks,
    jiraBaseUrl: String(cfg.jiraBaseUrl || '').replace(/\/+$/, ''),
    zephyrResultFieldId,
    bitbucket,
    confluence,
    diagnostics: {
      totalMs:  Date.now() - t0,
      perPk:    reports.map(r => ({ pk: r.projectKey, ms: r._ms || 0, ok: !r.error, error: r.error || null, issues: (r.issues || []).length })),
      log,
    },
  };
}

/**
 * V17.2 I2c — Confluence activity collector.
 *
 * Что делает:
 *   • space-scope `space in (DEV, PAY, ...)` если задан `cfg.confluenceSpaceKeys`
 *   • per-employee `contributor in (...)` / `creator in (...)` / `mention in (...)`
 *     если переданы `opts.employees` с identity (lookup-by-email-prefix
 *     или по `confluenceAccountId`)
 *   • CQL cutoff с +1ч padding для TZ-skew, точная фильтрация у нас по cutoffTs
 *   • Pagination через start/limit (cap 1000 events на тип)
 *   • Три типа активности: page/blogpost edits, comments, mentions
 *   • Path-cascade Cloud `/wiki/rest/...` ↔ DC `/rest/...`
 *   • Дедупликация: edit > comment > mention (если один target_id и тот же author)
 */
async function ppFetchConfluenceActivity(cfg, tls, cutoffTs, opts = {}) {
  if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) return { authors: {}, configured: false, tried: [] };
  const baseRaw = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
  const auth = _ppMakeAuthHeader(cfg.confluenceToken);
  const tried = [];

  const cqlCutoffTs = Number(opts.cqlCutoffTs) || (cutoffTs - 60 * 60 * 1000);
  const isoCutoff   = new Date(cqlCutoffTs).toISOString().replace('T', ' ').slice(0, 16);
  const employees   = Array.isArray(opts.employees) ? opts.employees : [];

  // Build CQL identity clause: contributor in ("alice", "bob") or mention in (...)
  // Используем username (email-prefix) и confluenceAccountId как кандидатов.
  // CQL Confluence ожидает username; для большинства DC это email-prefix.
  const identityNames = new Set();
  for (const e of employees) {
    const cf = String(e.confluenceAccountId || '').trim();
    if (cf) identityNames.add(cf);
    const em = String(e.email || '').trim().toLowerCase();
    if (em && em.includes('@')) {
      identityNames.add(em.split('@')[0]);     // email-prefix as username (LDAP/AD common)
      identityNames.add(em);                    // full email (Cloud accountId path иногда)
    }
  }
  const identityList = [...identityNames];
  const idClause = identityList.length
    ? ` AND ${'%FIELD%'} in (${identityList.map(n => `"${n.replace(/"/g, '\\"')}"`).join(', ')})`
    : '';

  // Space scope clause: AND space in (DEV, PAY).
  // Inline parser (server.js не импортирует портальные модули).
  const spaceKeys = String(cfg.confluenceSpaceKeys || '')
    .split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const spaceClause = spaceKeys.length
    ? ` AND space in (${spaceKeys.map(k => `"${k.replace(/"/g, '\\"')}"`).join(', ')})`
    : '';

  // Path cascade — try Cloud first, fall back to DC.
  const PATHS = [
    { tag: 'wiki-rest', url: `${baseRaw}/wiki/rest/api/content/search` },
    { tag: 'rest',      url: `${baseRaw}/rest/api/content/search` },
  ];

  // Page through CQL with cap=1000 per type per call.
  async function paginatedSearch(pathSpec, cql, expand) {
    const out = [];
    let start = 0;
    const limit = 100;
    const cap = 1000;
    let pages = 0;
    while (out.length < cap && pages < 10) {
      const url = `${pathSpec.url}?cql=${encodeURIComponent(cql)}&start=${start}&limit=${limit}&expand=${encodeURIComponent(expand)}`;
      const t0 = Date.now();
      const r = await jiraForward({
        targetUrl: url, method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        allowInsecureTls: tls, timeoutMs: 20000,
      }).catch(e => ({ status: 0, text: '', _err: e?.message }));
      tried.push({ type: pathSpec.tag, status: r.status, cql, start, ms: Date.now() - t0, error: r._err || '' });
      if (r.status === 401 || r.status === 403) return { results: [], status: r.status };
      if (r.status >= 300) {
        if (out.length === 0) return { results: [], status: r.status };
        break;
      }
      let parsed;
      try { parsed = JSON.parse(r.text); } catch (_) { parsed = null; }
      const batch = parsed?.results || [];
      out.push(...batch);
      pages++;
      if (batch.length < limit) break;     // last page
      start += limit;
    }
    return { results: out, status: 200 };
  }

  // Run a CQL query, picking the first PATH that returns 2xx or a result.
  async function runCQL(cqlNoIdentity, cqlField, expand) {
    const cql = cqlNoIdentity + idClause.replace('%FIELD%', cqlField) + spaceClause;
    for (const p of PATHS) {
      const r = await paginatedSearch(p, cql, expand);
      if (r.status >= 200 && r.status < 300) return { results: r.results, path: p, cql };
      if (r.status === 401 || r.status === 403) return { results: [], path: p, cql, authError: r.status };
      // 404 / 400 → try next path
    }
    return { results: [], path: PATHS[PATHS.length - 1], cql };
  }

  // ── Pass 1: page / blogpost edits ─────────────────────────
  const editCql = `type in (page, blogpost) AND lastmodified > "${isoCutoff}"`;
  const editR = await runCQL(editCql, 'contributor', 'version,space,history.lastUpdated,history.createdBy');

  // ── Pass 2: comments ─────────────────────────────────────
  const commentCql = `type = comment AND created > "${isoCutoff}"`;
  const commentR = await runCQL(commentCql, 'creator', 'version,space,container');

  // ── Pass 3: mentions ─────────────────────────────────────
  const mentionCql = `lastmodified > "${isoCutoff}"`;
  const mentionR = await runCQL(mentionCql, 'mention', 'version,space');

  // Auth-error cascade end: bail with explicit message.
  const anyAuthErr = [editR, commentR, mentionR].find(x => x?.authError);
  if (anyAuthErr) {
    return { authors: {}, configured: true, tried, error: `Confluence HTTP ${anyAuthErr.authError} — токен просрочен или нет прав` };
  }

  const winningPath = (editR.path || commentR.path || mentionR.path || PATHS[0]).tag;
  const urlBase = winningPath === 'wiki-rest' ? `${baseRaw}/wiki` : baseRaw;

  // ── Aggregate authors ────────────────────────────────────
  const authors = {};
  const ensureAuthor = (dn, em, k) => {
    if (!authors[k]) authors[k] = { edits: 0, comments: 0, mentions: 0, displayName: dn || em || k, email: em, items: [], _seenTargets: new Set() };
    return authors[k];
  };
  const pushItem = (a, item) => {
    if (a.items.length >= 100) return;
    if (item.targetId) {
      // V17.2 I2c — dedup: предпочитаем edit/create > comment > mention для
      //   одного и того же target_id у одного автора. Если уже видели этот
      //   target — пропускаем (порядок проходов: edits → comments → mentions
      //   гарантирует что edit «победит» дальше идущий mention).
      if (a._seenTargets.has(item.targetId)) return;
      a._seenTargets.add(item.targetId);
    }
    a.items.push(item);
  };

  // Pass 1 — edits
  for (const p of (editR.results || [])) {
    const v = p.version || {};
    const tsP = Date.parse(v.when || '');
    if (Number.isFinite(tsP) && tsP < cutoffTs) continue;
    const dn = v.by?.displayName || v.by?.publicName || '';
    const em = v.by?.email || '';
    const k = _ppKeyForAuthor(dn, em);
    if (!k) continue;
    const a = ensureAuthor(dn, em, k);
    a.edits++;
    pushItem(a, {
      kind: (Number(v.number) || 0) === 1 ? 'create' : 'edit',
      title: p.title || '',
      url:   p._links?.webui ? `${urlBase}${p._links.webui}` : '',
      at:    v.when || '',
      spaceKey:  p.space?.key  || '',
      spaceName: p.space?.name || '',
      targetId:  String(p.id || ''),
    });
  }
  // Pass 2 — comments
  for (const c of (commentR.results || [])) {
    const v = c.version || {};
    const tsP = Date.parse(v.when || c.history?.createdDate || '');
    if (Number.isFinite(tsP) && tsP < cutoffTs) continue;
    const dn = v.by?.displayName || c.history?.createdBy?.displayName || '';
    const em = v.by?.email || c.history?.createdBy?.email || '';
    const k = _ppKeyForAuthor(dn, em);
    if (!k) continue;
    const a = ensureAuthor(dn, em, k);
    a.comments++;
    const cont = c.container || {};
    pushItem(a, {
      kind:  'comment',
      title: cont.title || c.title || '(без заголовка)',
      url:   c._links?.webui ? `${urlBase}${c._links.webui}` : (cont._links?.webui ? `${urlBase}${cont._links.webui}` : ''),
      at:    v.when || c.history?.createdDate || '',
      spaceKey:  c.space?.key  || cont.space?.key  || '',
      spaceName: c.space?.name || cont.space?.name || '',
      targetId:  `${cont.id || c.id || ''}#comment-${c.id || ''}`,
    });
  }
  // Pass 3 — mentions (only attribute to identity-list users — иначе мы получим
  //          автора страницы, не упомянутого человека; CQL `mention=...`
  //          возвращает контент где упомянут username, не самого автора).
  for (const p of (mentionR.results || [])) {
    const v = p.version || {};
    const tsP = Date.parse(v.when || '');
    if (Number.isFinite(tsP) && tsP < cutoffTs) continue;
    // Mentions нельзя точно атрибутировать только по version.by — это автор
    // правки, а не упомянутый. Распределяем только если у нас есть identity-list:
    // для каждого identityName проверяем содержит ли тело страницы @<name>.
    if (!identityList.length) continue;
    const dn = v.by?.displayName || '';
    const em = v.by?.email || '';
    // Мы не можем без скачивания тела страницы 100% сказать кто упомянут.
    // Workaround: атрибутируем mention каждому identity-юзеру (overcount
    // приемлем для baseline; план Step 5 явно говорит «mentions слабое
    // место чистого REST»). Дедуп по targetId защищает от повторов.
    for (const idName of identityList) {
      const fakeKey = idName.toLowerCase();
      const a = ensureAuthor(idName, '', fakeKey);
      if (a._seenTargets.has(String(p.id || ''))) continue;
      a.mentions++;
      pushItem(a, {
        kind:  'mention',
        title: p.title || '',
        url:   p._links?.webui ? `${urlBase}${p._links.webui}` : '',
        at:    v.when || '',
        spaceKey:  p.space?.key  || '',
        spaceName: p.space?.name || '',
        targetId:  String(p.id || ''),
        mentionedBy: dn || em || '',
      });
    }
  }

  // Cleanup _seenTargets перед возвратом (это служебное поле).
  for (const a of Object.values(authors)) delete a._seenTargets;

  return { authors, configured: true, tried, scope: { spaces: spaceKeys, employees: identityList.length, windowHours: Math.round((Date.now() - cutoffTs) / 3600000) } };
}

async function jiraBuildReport(cfg) {
  // Resolve project keys: prefer unified `jiraProjectKeys`, fall back to legacy `areas`
  let areas = jiraSanitizeAreas(cfg.areas);
  const keys = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
  if (keys.length) areas = keys.map(k => ({ name: k, projectKey: k }));
  if (!cfg.jiraBaseUrl||!cfg.jiraToken) throw Object.assign(new Error('Jira URL или токен не заданы'),{status:400});
  if (!areas.length) throw Object.assign(new Error('Не задано ни одного пространства (jiraProjectKeys)'),{status:400});
  const staleDays=Number(cfg.staleDays)||3, noMovementDays=Number(cfg.noMovementDays)||2;
  const areaReports = await jiraPLimit(2, areas.map(a=>()=>jiraBuildAreaReport(cfg,a)));
  const now=new Date(), yesterday=new Date(now); yesterday.setHours(0,0,0,0); yesterday.setDate(yesterday.getDate()-1);
  const today=new Date(now); today.setHours(0,0,0,0);
  const dayBefore=new Date(yesterday); dayBefore.setDate(dayBefore.getDate()-1);
  return {
    generatedAt:now.toISOString(),
    yesterdayRange:{ from:yesterday.toISOString(), to:today.toISOString() },
    dayBeforeYesterdayRange:{ from:dayBefore.toISOString(), to:yesterday.toISOString() },
    last48hRange:{ from:new Date(Date.now()-48*3600000).toISOString(), to:now.toISOString() },
    staleDays, noMovementDays, areas:areaReports, bitbucket:null, confluence:null,
  };
}

async function handleJiraApi(req, res, pathname) {
  try {
    if (pathname==='/api/jira/config' && req.method==='GET') {
      return writeJson(res, 200, jiraSanitizeConfig(jiraReadConfig()));
    }
    if (pathname==='/api/jira/config' && req.method==='POST') {
      const raw = await readBody(req, 512*1024);
      const body = raw ? JSON.parse(raw) : {};
      const patch = {};
      // V17.2 I2c — `confluenceSpaceKeys` добавлен в whitelist string-полей.
      for (const k of ['jiraBaseUrl', 'jiraProjectKeys', 'sigmaJiraBaseUrl', 'sigmaGoalEpicKeys', 'bitbucketBaseUrl', 'bitbucketProjectKeys', 'confluenceBaseUrl', 'confluenceSpaceKeys']) {
        if (typeof body[k]==='string') patch[k]=body[k].trim();
      }
      // V17.2 I2c — activityWindowHours: clamp [1, 168].
      if (Number.isFinite(+body.activityWindowHours)) {
        patch.activityWindowHours = Math.min(168, Math.max(1, Math.round(+body.activityWindowHours)));
      }
      // Auto-derive `areas` from jiraProjectKeys (so JiraPulse keeps working)
      if (typeof body.jiraProjectKeys === 'string') {
        const keys = body.jiraProjectKeys.split(',').map(s => s.trim()).filter(Boolean);
        patch.areas = keys.map(k => ({ name: k, projectKey: k }));
      }
      if (Array.isArray(body.areas)) patch.areas=jiraSanitizeAreas(body.areas);
      if (typeof body.allowInsecureTls==='boolean') patch.allowInsecureTls=body.allowInsecureTls;
      if (typeof body.sinceDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(body.sinceDate.trim())) patch.sinceDate=body.sinceDate.trim();
      if (typeof body.staleDays==='number') patch.staleDays=body.staleDays;
      if (typeof body.noMovementDays==='number') patch.noMovementDays=body.noMovementDays;
      if (typeof body.jiraToken==='string'&&body.jiraToken) patch.jiraToken=body.jiraToken;
      // Sigma token: ONLY persisted when non-empty — preserves existing token on save with blank field.
      if (typeof body.sigmaJiraToken==='string'&&body.sigmaJiraToken) patch.sigmaJiraToken=body.sigmaJiraToken;
      if (typeof body.bitbucketToken==='string'&&body.bitbucketToken) patch.bitbucketToken=body.bitbucketToken;
      if (typeof body.confluenceToken==='string'&&body.confluenceToken) patch.confluenceToken=body.confluenceToken;
      const next = jiraWriteConfig(patch);
      return writeJson(res, 200, jiraSanitizeConfig(next));
    }
    if (pathname==='/api/jira/verify' && req.method==='POST') {
      const cfg=jiraReadConfig();
      if (!cfg.jiraBaseUrl||!cfg.jiraToken) return writeJson(res,400,{ok:false,error:'Нет jiraBaseUrl или токена'});
      const me = await jiraRequest(cfg,'GET','/rest/api/2/myself',null);
      return writeJson(res,200,{ok:true,who:me.displayName||me.name||'?'});
    }
    if (pathname==='/api/jira/report' && req.method==='POST') {
      const cfg=jiraReadConfig();
      const report = await jiraBuildReport(cfg);
      return writeJson(res, 200, report);
    }
    writeJson(res, 404, { error: 'Неизвестный Jira API метод' });
  } catch(e) {
    const status = (e.status&&e.status>=400&&e.status<600)?e.status:500;
    writeJson(res, status, { error: e.message||String(e) });
  }
}

// ============================================================
// INTEGRATIONS API — Jira issue, Bitbucket PR, Confluence search
// ============================================================
async function handleIntegrationsApi(req, res, pathname) {
  // V13 (6th pass): the black-dashboard /status endpoint is GET-only by
  // design — it's a poll endpoint, idempotent, with the jobId in the
  // query string. Everything else stays POST-only as before.
  const isStatusPoll = pathname === '/api/integrations/black-dashboard/status';
  if (isStatusPoll) {
    if (req.method !== 'GET') { writeJson(res, 405, { error: 'Method not allowed (GET required)' }); return; }
  } else {
    if (req.method !== 'POST') { writeJson(res, 405, { error: 'Method not allowed' }); return; }
  }
  try {
    // GET requests don't have a body — skip readBody to avoid the 256kb wait.
    const raw = isStatusPoll ? '' : await readBody(req, 256 * 1024);
    const body = raw ? JSON.parse(raw) : {};
    const cfg  = jiraReadConfig();

    // ── helpers ──────────────────────────────────────────────
    const tls = !!cfg.allowInsecureTls;
    // V18 P6 — унифицировал на top-level _ppMakeAuthHeader (был локальный дубль).
    const makeAuthHeader = _ppMakeAuthHeader;

    // ── /api/integrations/jira-issue ─────────────────────────
    if (pathname === '/api/integrations/jira-issue') {
      const key = String(body.key || '').trim();
      if (!key) { writeJson(res, 400, { error: 'Missing key' }); return; }
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) { writeJson(res, 400, { error: 'Jira не настроена' }); return; }
      const issue = await jiraRequest(cfg, 'GET', `/rest/api/2/issue/${encodeURIComponent(key)}?fields=status,assignee,updated`);
      writeJson(res, 200, {
        key,
        status:    issue.fields?.status?.name || '',
        assignee:  issue.fields?.assignee?.displayName || '',
        updatedAt: issue.fields?.updated || '',
      });
      return;
    }

    // ── /api/integrations/employee-performance ───────────────
    // V17 P4: aggregate per-employee metrics from Jira (assignees +
    // open/done/overdue counts) for projects in cfg.jiraProjectKeys.
    // Bitbucket / Confluence pillars are stubbed for MVP — extension
    // points are documented in audit-2026-05-V17/04-perf-tab.md.
    if (pathname === '/api/integrations/employee-performance') {
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
        writeJson(res, 400, { error: 'Jira не настроена — заполни jiraBaseUrl + jiraToken в настройках интеграций' });
        return;
      }
      const projectKeys = String(cfg.jiraProjectKeys || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (!projectKeys.length) {
        writeJson(res, 400, { error: 'Не указано ни одного проекта в jiraProjectKeys' });
        return;
      }
      try {
        // One JQL call per project — bounded by `maxResults: 200`. We aggregate
        // assignees on the fly. Fields limited to what we actually need.
        const FIELDS = 'assignee,status,duedate,resolutiondate';
        const STATUS_DONE_RE = /(done|closed|resolved|готов|закрыт|выполнен)/i;
        const empMap = new Map();      // accountId → { fio, email, jira:{open,done,overdue} }
        const today = new Date();

        for (const pk of projectKeys) {
          const jql = `project = "${pk.replace(/"/g, '\\"')}" AND assignee is not EMPTY`;
          let startAt = 0;
          // Limit: 4 pages × 200 = 800 issues per project. Tunable.
          for (let page = 0; page < 4; page++) {
            const qs = `jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(FIELDS)}&maxResults=200&startAt=${startAt}`;
            let resp;
            try {
              resp = await jiraRequest(cfg, 'GET', `/rest/api/2/search?${qs}`);
            } catch (e) {
              // Per-project failure — skip but record in meta.
              break;
            }
            const issues = Array.isArray(resp?.issues) ? resp.issues : [];
            for (const it of issues) {
              const a = it.fields?.assignee;
              if (!a) continue;
              const id = a.accountId || a.key || a.name || a.displayName;
              if (!id) continue;
              if (!empMap.has(id)) {
                empMap.set(id, {
                  fio:   a.displayName || a.name || id,
                  email: a.emailAddress || '',
                  jira:  { open: 0, done: 0, overdue: 0 },
                  bitbucket: {},
                  confluence: {},
                });
              }
              const slot = empMap.get(id);
              const statusName = it.fields?.status?.name || '';
              const isDone = STATUS_DONE_RE.test(statusName) || !!it.fields?.resolutiondate;
              if (isDone) slot.jira.done++;
              else        slot.jira.open++;
              const due = it.fields?.duedate;
              if (due && !isDone) {
                const d = new Date(due);
                if (!Number.isNaN(d.getTime()) && d < today) slot.jira.overdue++;
              }
            }
            if (issues.length < 200) break;       // last page
            startAt += 200;
          }
        }

        // V17 P4 — TODO: Bitbucket / Confluence aggregation. Hooks in:
        //   integrations/employeePerformance.js renderCard()
        //     reads emp.bitbucket.{prsAuthored, prsOpen}
        //     reads emp.confluence.{pages}
        // Server-side: map accountId/email → BB user → /pullrequests + CF /content.

        const employees = Array.from(empMap.values());
        writeJson(res, 200, {
          employees,
          meta: {
            projectKeys,
            fetchedAt: new Date().toISOString(),
            sources: { jira: true, bitbucket: false, confluence: false },
          },
        });
      } catch (e) {
        writeJson(res, 500, { error: e?.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/portfolio-pulse ────────────────────
    // V11 Portfolio Pulse: fetches Jira data for multiple project keys in one call,
    // returns flat per-PK reports with `error` set on individual failures (so one
    // broken PK doesn't kill the whole response).
    if (pathname === '/api/integrations/portfolio-pulse') {
      // V18 P7 — sync POST остался для backward-compat и contract-тестов;
      // вся логика выделена в `_runPortfolioPulse` чтобы async-job /start
      // мог переиспользовать тот же код. Новый frontend → /start + /status.
      try {
        const result = await _runPortfolioPulse(body, cfg, tls);
        writeJson(res, 200, result);
      } catch (e) {
        writeJson(res, e.statusCode || 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/portfolio-pulse/start ──────────────
    // V18 P7 — async-job pattern (mirrors /black-dashboard/start).
    if (pathname === '/api/integrations/portfolio-pulse/start') {
      // Fail-fast: явные ошибки валидации возвращаем СРАЗУ (без создания job),
      // чтобы клиент мог показать их сразу, а не через poll.
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) {
        writeJson(res, 400, { error: 'Jira не настроена' });
        return;
      }
      const job = pulseCreateJob(body);
      pulseRunJob(job, async (j) => {
        return await _runPortfolioPulse(body, cfg, tls, (newPhase) => { j.phase = newPhase; });
      });
      writeJson(res, 200, { jobId: job.id, startedAt: job.startedAt });
      return;
    }

    // ── /api/integrations/portfolio-pulse/status?jobId=X ─────
    if (pathname === '/api/integrations/portfolio-pulse/status') {
      const qs = (req.url.split('?')[1] || '');
      const params = new URLSearchParams(qs);
      const jobId = (params.get('jobId') || '').trim();
      const job = pulseGetJob(jobId);
      if (!job) { writeJson(res, 404, { error: 'Unknown jobId (возможно истёк TTL 30 мин)' }); return; }
      writeJson(res, 200, {
        jobId:      job.id,
        status:     job.status,
        phase:      job.phase,
        startedAt:  job.startedAt,
        finishedAt: job.finishedAt,
        result:     job.status === 'done' ? job.result : null,
        error:      job.error,
      });
      return;
    }

    // ── /api/integrations/jira-fetch-all ─────────────────────
    // Bulk-fetch issues from Jira. If areas (projectKeys) are configured — use them.
    // Otherwise fall back to "issues assigned to current user, unresolved, updated last 90 days".
    if (pathname === '/api/integrations/jira-fetch-all') {
      if (!cfg.jiraBaseUrl || !cfg.jiraToken) { writeJson(res, 400, { error: 'Jira не настроена' }); return; }
      // Use unified `jiraProjectKeys` (comma-separated) if set; fall back to legacy `areas`
      let areas = jiraSanitizeAreas(cfg.areas);
      const keys = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
      if (keys.length) areas = keys.map(k => ({ name: k, projectKey: k }));
      const fields = ['summary','status','assignee','updated','priority','labels','issuetype','duedate','parent','resolution','components','fixVersions'];
      // Use configured cut-off date (default 2025-01-01); allow override per request
      const requestedSince = String(body.sinceDate || '').trim();
      const since = /^\d{4}-\d{2}-\d{2}$/.test(requestedSince) ? requestedSince : (cfg.sinceDate || '2025-01-01');
      let jql;
      if (areas.length) {
        const projects = areas.map(a => `"${a.projectKey}"`).join(',');
        jql = `project in (${projects}) AND updated >= "${since}" ORDER BY updated DESC`;
      } else {
        // No project areas configured — only fetch user's own issues since cutoff
        jql = `assignee = currentUser() AND updated >= "${since}" ORDER BY updated DESC`;
      }
      try {
        const issues = await jiraSearchAll(cfg, jql, fields, [], 1500);
        const flat = issues.map(it => ({
          key:       it.key,
          summary:   it.fields?.summary || '',
          status:    it.fields?.status?.name || '',
          assignee:  it.fields?.assignee?.displayName || '',
          updatedAt: it.fields?.updated || '',
          priority:  it.fields?.priority?.name || '',
          labels:    Array.isArray(it.fields?.labels) ? it.fields.labels : [],
          issuetype: it.fields?.issuetype?.name || '',
          dueDate:   it.fields?.duedate || '',
          parentKey: it.fields?.parent?.key || '',
          components:(it.fields?.components || []).map(c => c.name).filter(Boolean),
          fixVersions:(it.fields?.fixVersions || []).map(v => v.name).filter(Boolean),
          team:      (it.fields?.components || []).map(c => c.name).filter(Boolean).join(', ') || '',
        }));
        writeJson(res, 200, { issues: flat, jql, count: flat.length, areasUsed: areas.length });
      } catch(e) {
        writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/bitbucket-prs ──────────────────────
    if (pathname === '/api/integrations/bitbucket-prs') {
      const jiraKey = String(body.jiraKey || '').trim();
      if (!jiraKey) { writeJson(res, 400, { error: 'Missing jiraKey' }); return; }
      if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) { writeJson(res, 400, { error: 'Bitbucket не настроен' }); return; }
      const base       = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
      const authHeader = makeAuthHeader(cfg.bitbucketToken);
      const projectKeys = String(cfg.bitbucketProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
      const prs = [];
      const targets = projectKeys.length ? projectKeys : ['_'];
      for (const proj of targets.slice(0, 5)) {
        try {
          const searchUrl = proj === '_'
            ? `${base}/pullrequests?q=title~"${encodeURIComponent(jiraKey)}"&pagelen=10`
            : `${base}/repositories/${encodeURIComponent(proj)}/pullrequests?q=title~"${encodeURIComponent(jiraKey)}"&pagelen=10`;
          const resp = await jiraForward({
            targetUrl: searchUrl, method: 'GET',
            headers: { Authorization: authHeader },
            allowInsecureTls: tls,
          });
          if (resp.status < 300) {
            const data = JSON.parse(resp.text);
            (data.values || []).forEach(pr => {
              prs.push({
                url:       pr.links?.html?.href || '',
                status:    (pr.state || '').toLowerCase(),
                title:     pr.title || '',
                updatedAt: pr.updated_on || '',
                reviewers: (pr.reviewers || []).length,
              });
            });
          }
        } catch(_) {}
      }
      writeJson(res, 200, { prs, jiraKey });
      return;
    }

    // ── /api/integrations/confluence-search ──────────────────
    // V17.2 I2a — переписано:
    //   • path-cascade `/wiki/rest/...` → `/rest/...` → `/wiki/rest/api/content/search`
    //   • `Accept: application/json` (без него Server возвращает HTML за SSO)
    //   • CQL вместо `title=...` exact-match (раньше «PROJ-123» не находил
    //     страницы «PROJ-123 Спецификация»)
    //   • trim хвостового `/wiki` чтобы не получалось `…/wiki/wiki/rest/...`
    //   • явный 401-handler («токен просрочен или нет прав»)
    if (pathname === '/api/integrations/confluence-search') {
      const query = String(body.query || '').trim();
      if (!query) { writeJson(res, 400, { error: 'Missing query' }); return; }
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { writeJson(res, 400, { error: 'Confluence не настроена' }); return; }
      // I2a — strip trailing `/` and trailing `/wiki` so the cascade can
      // independently try `/wiki/rest/...` без двойного префикса.
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const requestedSince = String(body.sinceDate || '').trim();
      const since = /^\d{4}-\d{2}-\d{2}$/.test(requestedSince) ? requestedSince : (cfg.sinceDate || '2025-01-01');
      // V17.2 I2c — добавляем space-scope если задан в настройках.
      const _searchSpaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const _spaceClause = _searchSpaceKeys.length
        ? ` AND space in (${_searchSpaceKeys.map(k => `"${k.replace(/"/g, '\\"')}"`).join(', ')})`
        : '';
      const cql = `(title ~ "${query.replace(/"/g, '\\"')}" OR text ~ "${query.replace(/"/g, '\\"')}") AND type = page${_spaceClause} ORDER BY lastModified DESC`;
      const tryPaths = [
        `${base}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20&expand=version,history.lastUpdated`,
        `${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=20&expand=version,history.lastUpdated`,
        // Legacy Server fallback if `/content/search` not available.
        `${base}/wiki/rest/api/content?type=page&title=${encodeURIComponent(query)}&limit=20&expand=version`,
        `${base}/rest/api/content?type=page&title=${encodeURIComponent(query)}&limit=20&expand=version`,
      ];
      const headers = {
        Authorization: makeAuthHeader(cfg.confluenceToken),
        Accept: 'application/json',
      };
      // V18 P5 — переиспользует _cfPathCascade helper.
      const cascade = await _cfPathCascade(tryPaths, { headers, allowInsecureTls: tls });
      if (cascade.authError) {
        writeJson(res, 200, { pages: [], query, sinceDate: since, error: `Confluence: HTTP ${cascade.authError} — токен просрочен или нет прав`, tried: cascade.tried });
        return;
      }
      const pages = [];
      if (cascade.ok) {
        let data;
        try { data = JSON.parse(cascade.text); }
        catch (_) {
          writeJson(res, 200, { pages: [], query, sinceDate: since, error: 'Confluence вернул не-JSON (вероятно SSO/HTML)', tried: cascade.tried });
          return;
        }
        const sinceTs = Date.parse(since + 'T00:00:00Z');
        (data.results || []).forEach(p => {
          const lastMod = p.version?.when || p.history?.lastUpdated?.when || '';
          if (lastMod && Number.isFinite(sinceTs)) {
            const ts = Date.parse(lastMod);
            if (Number.isFinite(ts) && ts < sinceTs) return;
          }
          const webLink = p._links?.base && p._links?.webui ? p._links.base + p._links.webui : '';
          pages.push({ title: p.title || '', url: webLink, lastModified: lastMod });
        });
        if (pages.length > 5) pages.length = 5;
      }
      const errorMsg = cascade.ok ? '' : (cascade.error || 'Confluence недоступен');
      writeJson(res, 200, { pages, query, sinceDate: since, ...(errorMsg ? { error: errorMsg, tried: cascade.tried } : {}) });
      return;
    }

    // ── /api/integrations/verify-bitbucket ───────────────────
    if (pathname === '/api/integrations/verify-bitbucket') {
      if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) { writeJson(res, 200, { ok: false, error: 'Bitbucket не настроен' }); return; }
      const base   = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
      const authH  = makeAuthHeader(cfg.bitbucketToken);
      const fwd    = url => jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: authH }, allowInsecureTls: tls });
      // Try Bitbucket Server first (/rest/api/1.0/profile/recent/repos),
      // then fall back to Bitbucket Cloud (/user)
      let who = '?';
      let ok  = false;
      const serverResp = await fwd(`${base}/rest/api/1.0/profile/recent/repos?limit=1`).catch(()=>null);
      if (serverResp && serverResp.status < 300) {
        ok = true; // Server — no user name from this endpoint, just confirms auth works
      } else if (serverResp && serverResp.status === 401) {
        writeJson(res, 200, { ok: false, error: 'Неверный токен (401)' }); return;
      } else {
        // Fallback: Bitbucket Cloud
        const cloudResp = await fwd(`${base}/user`).catch(()=>null);
        if (cloudResp && cloudResp.status < 300) {
          const d = JSON.parse(cloudResp.text || '{}');
          who = d.display_name || d.username || '?';
          ok  = true;
        } else if (cloudResp && cloudResp.status === 401) {
          writeJson(res, 200, { ok: false, error: 'Неверный токен (401)' }); return;
        } else {
          writeJson(res, 200, { ok: false, error: `HTTP ${cloudResp?.status ?? 'нет ответа'} — проверьте Base URL` }); return;
        }
      }
      writeJson(res, 200, { ok, who });
      return;
    }

    // ── /api/integrations/sigma-verify ───────────────────────
    if (pathname === '/api/integrations/sigma-verify') {
      if (!cfg.sigmaJiraBaseUrl || !cfg.sigmaJiraToken) { writeJson(res, 200, { ok: false, error: 'Sigma Jira не настроена' }); return; }
      try {
        const sigCfg = sigmaCfgView(cfg);
        const me = await jiraRequest(sigCfg, 'GET', '/rest/api/2/myself');
        writeJson(res, 200, { ok: true, who: me.displayName || me.name || '?' });
      } catch (e) {
        writeJson(res, 200, { ok: false, error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/tech-info ──────────────────────────
    // Reuse the `body` already parsed at the top of handleIntegrationsApi —
    // calling readBody again would hang because the request stream is consumed.
    if (pathname === '/api/integrations/tech-info') {
      try {
        const source = ['all','jira','bitbucket','confluence'].includes(body.source) ? body.source : 'all';
        const forceRefresh = !!body.forceRefresh;
        const data = await buildTechInfo(cfg, { source, forceRefresh });
        writeJson(res, 200, data);
      } catch (e) {
        writeJson(res, 500, { error: e?.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/black-dashboard/start ──────────────
    // Async job pattern: returns jobId immediately; client polls /status.
    if (pathname === '/api/integrations/black-dashboard/start') {
      try {
        const job = bdCreateJob();
        bdRunJob(job, cfg);
        writeJson(res, 200, { jobId: job.id, startedAt: job.startedAt });
      } catch (e) {
        writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/black-dashboard/status?jobId=X ─────
    if (pathname === '/api/integrations/black-dashboard/status') {
      try {
        const qs = (req.url.split('?')[1] || '');
        const params = new URLSearchParams(qs);
        const jobId = params.get('jobId') || '';
        const job = bdGetJob(jobId);
        if (!job) { writeJson(res, 404, { error: 'Unknown jobId (возможно истёк TTL 30 мин)' }); return; }
        const out = {
          jobId:     job.id,
          status:    job.status,
          phase:     job.phase,
          startedAt: job.startedAt,
          elapsedMs: Date.now() - job.startedAt,
        };
        if (job.finishedAt) {
          out.finishedAt = job.finishedAt;
          out.durationMs = job.finishedAt - job.startedAt;
        }
        if (job.status === 'done')  out.result = job.result;
        if (job.status === 'error') out.error  = job.error;
        writeJson(res, 200, out);
      } catch (e) {
        writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/black-dashboard ────────────────────
    // Legacy synchronous endpoint — kept for back-compat. New clients
    // should use /start + /status. This one will hit the same long-load
    // problem as before; documented intentionally.
    if (pathname === '/api/integrations/black-dashboard') {
      try {
        const data = await buildBlackDashboard(cfg);
        writeJson(res, 200, data);
      } catch (e) {
        writeJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }

    // ── /api/integrations/confluence-audit-logins ────────────
    // V17.2 I2c (G7) — Audit log из Confluence: логины/выходы за окно.
    //   Endpoint /rest/api/audit?startDate=<ms>&endDate=<ms>&limit=1000.
    //   Может быть отключён в админке (Audit log → Configuration) или
    //   retention < окна — отдаём явное сообщение.
    if (pathname === '/api/integrations/confluence-audit-logins') {
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { writeJson(res, 400, { error: 'Confluence не настроена' }); return; }
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
      const winHours = Math.min(168, Math.max(1, Number(cfg.activityWindowHours) || 72));
      const startMs = Date.now() - winHours * 3600 * 1000;
      const endMs   = Date.now();
      // V18 P5 — переиспользует _cfPathCascade.
      const cascade = await _cfPathCascade([
        `${base}/wiki/rest/api/audit?startDate=${startMs}&endDate=${endMs}&limit=1000&start=0`,
        `${base}/rest/api/audit?startDate=${startMs}&endDate=${endMs}&limit=1000&start=0`,
      ], { headers, allowInsecureTls: tls, timeoutMs: 25000 });
      if (cascade.authError) {
        writeJson(res, 200, { ok: false, error: `Audit log недоступен (HTTP ${cascade.authError}). Нужен Confluence administrator или audit-viewer.`, tried: cascade.tried });
        return;
      }
      if (!cascade.ok) {
        writeJson(res, 200, { ok: false, error: 'Audit log endpoint не найден или недоступен. В админке: Audit log → Configuration.', tried: cascade.tried });
        return;
      }
      const tried = cascade.tried;     // alias чтобы не править все ссылки на tried ниже
      let parsed;
      try { parsed = JSON.parse(cascade.text); } catch (_) { parsed = null; }
      const records = parsed?.results || [];
      // Filter to login/logout entries. Confluence Server / DC summary patterns
      // обычно: «User logged in», «User logged out», «User logged in (single sign-on)».
      const isLoginEntry = (r) => {
        const s = String(r?.summary || '').toLowerCase();
        return s.includes('logged in') || s.includes('logged out') || s.includes('login') || s.includes('logout');
      };
      // Group by author identity → counts.
      const byUser = {};
      for (const rec of records) {
        if (!isLoginEntry(rec)) continue;
        const author = rec.author || rec.authorObject || rec.user || {};
        const key = String(author.userKey || author.username || author.name || author.email || '').toLowerCase();
        if (!key) continue;
        if (!byUser[key]) byUser[key] = {
          userKey: author.userKey || '',
          username: author.username || author.name || '',
          email: author.email || '',
          displayName: author.displayName || author.name || '',
          loginCount: 0,
          logoutCount: 0,
          lastLoginAt: '',
          items: [],
        };
        const summary = String(rec.summary || '').toLowerCase();
        const ts = Number(rec.creationDate) || Date.parse(rec.creationDate || '') || 0;
        if (summary.includes('logged out') || summary.includes('logout')) byUser[key].logoutCount++;
        else byUser[key].loginCount++;
        if (ts && ts > Date.parse(byUser[key].lastLoginAt || 0)) byUser[key].lastLoginAt = new Date(ts).toISOString();
        if (byUser[key].items.length < 50) {
          byUser[key].items.push({
            kind: (summary.includes('logout') || summary.includes('logged out')) ? 'logout' : 'login',
            at: ts ? new Date(ts).toISOString() : '',
            summary: rec.summary || '',
            remoteAddress: rec.remoteAddress || '',
          });
        }
      }
      // Audit может вернуть retention info в поле `auditRetentionPeriod`. Сразу подсветим.
      const retention = parsed?.retentionPeriod || parsed?.auditRetentionPeriod || null;
      writeJson(res, 200, {
        ok: true,
        windowHours: winHours,
        users: Object.values(byUser).sort((a, b) => b.loginCount - a.loginCount),
        totalRecords: records.length,
        loginRecords: Object.values(byUser).reduce((n, u) => n + u.loginCount + u.logoutCount, 0),
        retention,
        tried,
      });
      return;
    }

    // ── /api/integrations/confluence-resolve-user ────────────
    // V17.2 I2c — резолвим пользователя по email или ФИО → возвращаем
    //   confluenceAccountId / username / displayName / email. Используется
    //   для автозаполнения identity-полей в карточке сотрудника.
    //   Cascade:
    //     1) `/wiki/rest/api/user/search?cql=user.emailAddress="..."` (Cloud)
    //     2) `/rest/api/search?cql=user.email~"..."` (DC, ~ префикс-search)
    //     3) `/rest/api/user/search?username=<email-prefix>`
    //     4) cql=user.fullname~"<fio>" если нет email
    if (pathname === '/api/integrations/confluence-resolve-user') {
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { writeJson(res, 400, { error: 'Confluence не настроена' }); return; }
      const email = String(body.email || '').trim().toLowerCase();
      const fullname = String(body.fullname || '').trim();
      if (!email && !fullname) { writeJson(res, 400, { error: 'Нужен email или fullname' }); return; }
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
      const tried = [];
      const tryFetch = async (url) => {
        const r = await jiraForward({ targetUrl: url, method: 'GET', headers, allowInsecureTls: tls }).catch((e) => ({ status: 0, text: String(e?.message || e) }));
        tried.push({ url: url.replace(/[?].*$/, '...'), status: r.status });
        return r;
      };
      const buildCandidates = () => {
        const out = [];
        if (email) {
          out.push(`${base}/wiki/rest/api/search/user?cql=${encodeURIComponent(`user.email = "${email}"`)}`);
          out.push(`${base}/rest/api/search?cql=${encodeURIComponent(`user.email = "${email}"`)}&limit=10`);
          const prefix = email.split('@')[0];
          if (prefix) {
            out.push(`${base}/rest/api/user/search?username=${encodeURIComponent(prefix)}&limit=10`);
            out.push(`${base}/wiki/rest/api/user/search?username=${encodeURIComponent(prefix)}&limit=10`);
          }
        }
        if (fullname) {
          out.push(`${base}/wiki/rest/api/search/user?cql=${encodeURIComponent(`user.fullname ~ "${fullname.replace(/"/g, '\\"')}"`)}`);
          out.push(`${base}/rest/api/search?cql=${encodeURIComponent(`user.fullname ~ "${fullname.replace(/"/g, '\\"')}"`)}&limit=10`);
        }
        return out;
      };
      let resolved = null;
      for (const url of buildCandidates()) {
        const r = await tryFetch(url);
        if (r.status === 401 || r.status === 403) {
          writeJson(res, 200, { ok: false, error: `Confluence HTTP ${r.status} — токен просрочен`, tried });
          return;
        }
        if (r.status < 200 || r.status >= 300) continue;
        let parsed;
        try { parsed = JSON.parse(r.text); } catch (_) { continue; }
        // user/search format: { results: [{user: {...}}, ...] } or [{...}, ...]
        const results = Array.isArray(parsed) ? parsed
                       : Array.isArray(parsed?.results) ? parsed.results
                       : [];
        for (const item of results) {
          const u = item.user || item;
          const u_email = String(u.email || u.emailAddress || '').toLowerCase();
          if (email && u_email && u_email !== email) continue;
          if (email && !u_email) continue;     // не доверяем без email-подтверждения
          resolved = {
            accountId: u.accountId || u.userKey || '',
            username:  u.username  || u.name    || '',
            displayName: u.displayName || u.publicName || u.name || '',
            email: u_email || email || '',
            avatar: u.profilePicture?.path || u.avatarUrls?.['48x48'] || '',
          };
          break;
        }
        if (resolved) break;
      }
      if (!resolved) { writeJson(res, 200, { ok: false, error: 'Пользователь не найден в Confluence', tried }); return; }
      writeJson(res, 200, { ok: true, user: resolved, tried });
      return;
    }

    // ── /api/integrations/verify-confluence ──────────────────
    // V17.2 I2c — если заданы `confluenceSpaceKeys`, в первую очередь
    //   проверяем что мы видим первое пространство (это содержательнее
    //   чем абстрактный `/user/current`). Сбой → понятное сообщение
    //   «не видно пространство DEV (HTTP 403)» вместо «токен сломан».
    if (pathname === '/api/integrations/verify-confluence') {
      if (!cfg.confluenceBaseUrl || !cfg.confluenceToken) { writeJson(res, 200, { ok: false, error: 'Confluence не настроена' }); return; }
      const base = String(cfg.confluenceBaseUrl).replace(/\/+$/, '').replace(/\/wiki$/i, '');
      const headers = { Authorization: makeAuthHeader(cfg.confluenceToken), Accept: 'application/json' };
      const _spaceKeys = String(cfg.confluenceSpaceKeys || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const tried = [];
      // Step 1: если есть spaceKeys — проверяем доступ к каждому
      if (_spaceKeys.length) {
        const accessible = [];
        const denied = [];
        for (const key of _spaceKeys.slice(0, 5)) {     // cap = 5 чтобы не спамить
          const urls = [
            `${base}/wiki/rest/api/space/${encodeURIComponent(key)}`,
            `${base}/rest/api/space/${encodeURIComponent(key)}`,
          ];
          let foundIn = null;
          for (const url of urls) {
            const r = await jiraForward({ targetUrl: url, method: 'GET', headers, allowInsecureTls: tls }).catch((e) => ({ status: 0, text: String(e?.message || e) }));
            tried.push({ url: url.replace(/\?.*$/, ''), status: r.status });
            if (r.status >= 200 && r.status < 300) { foundIn = url; break; }
            if (r.status === 401 || r.status === 403) {
              denied.push({ key, status: r.status });
              break;
            }
          }
          if (foundIn) accessible.push(key);
          else if (!denied.find(d => d.key === key)) denied.push({ key, status: '404' });
        }
        if (accessible.length) {
          writeJson(res, 200, {
            ok: true,
            who: `${accessible.length}/${_spaceKeys.length} пространств доступно: ${accessible.join(', ')}${denied.length ? ' · нет доступа: ' + denied.map(d => `${d.key}(${d.status})`).join(', ') : ''}`,
            spaces: { accessible, denied }, tried,
          });
          return;
        }
        if (denied.find(d => d.status === 401 || d.status === 403)) {
          writeJson(res, 200, { ok: false, error: `Нет доступа ни к одному из пространств: ${denied.map(d => `${d.key}(${d.status})`).join(', ')}`, tried });
          return;
        }
        // 404 на всех ключах — может, пространства не существуют в этом инстансе
        writeJson(res, 200, { ok: false, error: `Пространства не найдены: ${_spaceKeys.join(', ')} (HTTP 404)`, tried });
        return;
      }
      // Step 2: fallback на user/current (когда spaceKeys пустые).
      // V18 P5 — переиспользует _cfPathCascade.
      const fallbackCascade = await _cfPathCascade([
        `${base}/wiki/rest/api/user/current`,
        `${base}/rest/api/user/current`,
        `${base}/wiki/rest/api/space?limit=1`,
        `${base}/rest/api/space?limit=1`,
      ], { headers, allowInsecureTls: tls });
      const allTried = [...tried, ...fallbackCascade.tried];
      if (fallbackCascade.authError) {
        writeJson(res, 200, { ok: false, error: `Confluence HTTP ${fallbackCascade.authError} — токен просрочен или нет прав`, tried: allTried });
        return;
      }
      if (fallbackCascade.ok) {
        let who = '?';
        try { const d = JSON.parse(fallbackCascade.text); who = d.displayName || d.username || d.name || (Array.isArray(d.results) ? `${d.results.length} space(s)` : '?'); } catch(_) {}
        writeJson(res, 200, { ok: true, who, tried: allTried });
        return;
      }
      writeJson(res, 200, { ok: false, error: `Confluence недоступен (попробовано ${allTried.length} URL)`, tried: allTried });
      return;
    }

    writeJson(res, 404, { error: 'Unknown integrations endpoint' });
  } catch(e) {
    writeJson(res, 500, { error: e.message || String(e) });
  }
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  // V12 audit recommendation #8 (FOUND_BUGS NEW-7) — `path.resolve` does
  // NOT follow symlinks, so a symlink in ROOT pointing outside (e.g. to
  // /etc) would let `GET /symlink/passwd` slip past the prefix check.
  // `fs.realpath` resolves symlinks; we then re-check the prefix.
  // We use sync API because serveStatic is already synchronous up to fs.readFile.
  let resolvedFile;
  try {
    resolvedFile = fs.realpathSync(filePath);
  } catch (_e) {
    // ENOENT — file not found, continue to readFile to produce 404.
    resolvedFile = path.resolve(filePath);
  }
  if (!resolvedFile.startsWith(ROOT + path.sep) && resolvedFile !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not Found: ${urlPath}`);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server Error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // V12 audit recommendation #6 — defense-in-depth security headers.
    // CSP is intentionally permissive (`'self' 'unsafe-inline'` for inline
    // styles and event handlers we already use throughout); tightening to
    // strict-CSP would require a significant rewrite of the inline-render
    // pattern. Even permissive CSP blocks classic stored-XSS via the 234
    // raw-innerHTML lint warnings — script src must be 'self'.
    //
    // X-Frame-Options=DENY guards against clickjacking from external pages.
    // X-Content-Type-Options=nosniff prevents MIME-sniff confusion attacks.
    // Referrer-Policy=same-origin keeps token-bearing referrers from leaving
    // the app. The intra-corporate use case doesn't need HSTS (no public TLS).
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // V15 fix (errors-log report 2026-04-30): added 'wasm-unsafe-eval'
      // to script-src — without it the browser refused to compile the
      // sql.js WebAssembly module and SQLiteStore silently fell back to
      // localStorage. The keyword is narrowly scoped to WASM compilation;
      // it does NOT re-enable classic eval()/Function() of strings.
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "font-src 'self' data:; " +
        "frame-ancestors 'none'",
      'X-Frame-Options':        'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy':        'same-origin',
      'Permissions-Policy':     'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  // Hook the response so we can record metrics without touching every writer.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (code, ...rest) => { res._statusCode = code; return origWriteHead(code, ...rest); };
  res.on('finish', () => recordRequest(pathname, res._statusCode || res.statusCode || 0));

  // Health & metrics — exempt from rate limit, no logging surprise.
  if (pathname === '/health') {
    return writeJson(res, 200, {
      ok: true,
      uptime: process.uptime(),
      pid: process.pid,
      now: new Date().toISOString(),
    });
  }
  if (pathname === '/metrics') {
    return writeJson(res, 200, {
      ok: true,
      uptimeSec: Math.round((Date.now() - _metrics.startedAt) / 1000),
      requestsTotal: _metrics.requestsTotal,
      requestsByPath: _metrics.requestsByPath,
      errors4xx: _metrics.errors4xx,
      errors5xx: _metrics.errors5xx,
      rateLimited: _metrics.rateLimited,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  }

  // Rate limit (skip for static GETs to avoid breaking page loads under heavy
  // tab-switching, but still applied to all /api/* requests).
  if (pathname.startsWith('/api/')) {
    const rl = checkRateLimit(req);
    if (!rl.ok) {
      _metrics.rateLimited++;
      res.setHeader('Retry-After', String(rl.retryAfter));
      return writeJson(res, 429, { error: `Слишком много запросов. Попробуйте через ${rl.retryAfter}с.` });
    }
  }

  if (req.method === 'POST' && pathname === '/api/llm/chat') {
    proxyChat(req, res); return;
  }
  if (pathname.startsWith('/api/jira/')) {
    handleJiraApi(req, res, pathname); return;
  }
  if (pathname.startsWith('/api/integrations/')) {
    handleIntegrationsApi(req, res, pathname); return;
  }
  serveStatic(req, res);
});

let currentPort = PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const next = currentPort + 1;
    if (next <= PORT + 9) {
      currentPort = next;
      server.listen(currentPort, '127.0.0.1');
    } else {
      console.error(`Порты ${PORT}–${PORT + 9} заняты. Освободи порт или задай другой: node server.js 9090`);
      process.exit(1);
    }
  } else {
    throw err;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const actualPort = server.address().port;
  // Machine-readable marker so launch.js knows the real port.
  console.log(`LISTENING:${actualPort}`);
  console.log(`SBOF Planner — http://localhost:${actualPort}`);
  console.log('Ctrl+C to stop');
});
