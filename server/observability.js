// V18 — Observability + operational endpoints (extracted from server.js).
// Hosts: rate-limit infra, latency/DAU metrics, /health /ready /metrics
// /metrics/prom /api/telemetry /api/client-error endpoints.
//
// Factory pattern: shared `_metrics` lives in server.js (also used by
// LLM-budget code), so caller injects it. Other shared deps (writeJson,
// readBody, jiraReadConfig, breakers, caches) are also passed in.
'use strict';

const fs = require('fs');
const _pathLib = require('path');
const logger = require('./logger.js');

/* ────────────────────────────────────────────────────────────
   Rate limit (per-IP / per-X-Client-Id, sliding 1-min window)
   ──
   In-memory bucket. Local single-tenant tool — we don't need Redis.
   Defaults: 120 requests / IP / minute. Health/metrics excluded so
   monitoring doesn't trip the limit. Static-file requests count
   normally — abuse here would still hammer disk reads.
   ─────────────────────────────────────────────────────────── */
const RL_WINDOW_MS = 60 * 1000;
const RL_LIMIT     = parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10);
const _rlBuckets   = new Map(); // bucketKey → [timestamp, ...]

function clientIp(req) {
  // Trust the connection address — local tool, no proxy in front.
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// V21 R (audit-2026-05-03 §C B10) — per-user rate-limit вместо чисто
// per-IP. За корпоративным NAT все юзеры режут друг друга. Теперь
// бэкэнд сначала смотрит на X-Client-Id (HTTP-заголовок, который
// фронт отправляет с каждым запросом — UUID per-tab из localStorage),
// и фолбэчится на IP только если идентификатора нет.
function clientBucketKey(req) {
  const cid = req.headers && (req.headers['x-client-id'] || req.headers['x-user-id']);
  if (cid && typeof cid === 'string') return 'cid:' + cid.slice(0, 64);
  return 'ip:' + clientIp(req);
}

function checkRateLimit(req) {
  const key = clientBucketKey(req);
  const now = Date.now();
  const arr = _rlBuckets.get(key) || [];
  // Drop entries outside window. Keeps memory bounded for steady traffic.
  while (arr.length && arr[0] <= now - RL_WINDOW_MS) arr.shift();
  if (arr.length >= RL_LIMIT) {
    return { ok: false, retryAfter: Math.ceil((arr[0] + RL_WINDOW_MS - now) / 1000) };
  }
  arr.push(now);
  _rlBuckets.set(key, arr);
  // Periodic cheap GC: trim the map if it grew unreasonably (>1000 ключей).
  if (_rlBuckets.size > 1000) {
    for (const [k, v] of _rlBuckets) if (!v.length || v[v.length-1] < now - RL_WINDOW_MS) _rlBuckets.delete(k);
  }
  return { ok: true };
}

const _LATENCY_BUFFER = 1000;

function _quantile(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

/**
 * Factory: builds observability handlers around the shared `_metrics`
 * object (still owned by server.js so LLM-budget code can read it).
 *
 * @param {object} deps
 * @param {Function} deps.writeJson         (res, code, data) => void
 * @param {Function} deps.readBody          (req, limitBytes) => Promise<string>
 * @param {number}   deps.MAX_BODY          max body bytes for /api/client-error
 * @param {object}   deps.metrics           shared mutable counters object
 * @param {Function} [deps.jiraReadConfig]  for /ready depth-check (jira config)
 * @param {string}   [deps.JOBS_PERSIST_BASE] dir checked in /ready
 * @param {Map}      [deps.breakers]        host→breaker map (for /metrics)
 * @param {Map}      [deps.httpCache]       HTTP-cache map (for cacheSizes)
 * @param {Map}      [deps.recentBucketCache] (for cacheSizes)
 * @param {Function} [deps.llmBudgetUserCount] () => number — current size of the
 *                   per-user LLM-budget map (now lives in server/llm.js).
 */
function createObservability(deps) {
  const {
    writeJson,
    readBody,
    MAX_BODY,
    metrics: _metrics,
    jiraReadConfig,
    JOBS_PERSIST_BASE,
    breakers: _breakers,
    httpCache: _HTTP_CACHE,
    recentBucketCache: _recentBucketCache,
    llmBudgetUserCount,
  } = deps;

  /* ────────────────────────────────────────────────────────────
     Metrics recorders
     ─────────────────────────────────────────────────────────── */
  function recordRequest(pathname, statusCode, latencyMs) {
    _metrics.requestsTotal++;
    // Bucket by API prefix so paths like /api/jira/issue/PROJ-123 don't blow up the map.
    const bucket = pathname.startsWith('/api/integrations/') ? pathname.split('/').slice(0,4).join('/')
                : pathname.startsWith('/api/jira/') ? pathname.split('/').slice(0,4).join('/')
                : pathname.startsWith('/api/') ? pathname
                : '/static';
    _metrics.requestsByPath[bucket] = (_metrics.requestsByPath[bucket] || 0) + 1;
    if (statusCode >= 400 && statusCode < 500) _metrics.errors4xx++;
    if (statusCode >= 500) _metrics.errors5xx++;
    if (Number.isFinite(latencyMs)) {
      _metrics.latencies[_metrics.latenciesIdx % _LATENCY_BUFFER] = latencyMs;
      _metrics.latenciesIdx++;
    }
  }

  function recordClientSeen(req) {
    // V21 U — DAU. X-Client-Id переживает рестарт клиента, поэтому уникален.
    const cid = req.headers && (req.headers['x-client-id'] || req.headers['x-user-id']);
    if (!cid) return;
    _metrics.daus.set(String(cid).slice(0, 64), Date.now());
  }

  function _activeDaus() {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    let n = 0;
    for (const [k, t] of _metrics.daus) {
      if (t < cutoff) _metrics.daus.delete(k);
      else n++;
    }
    return n;
  }

  /* ────────────────────────────────────────────────────────────
     Telemetry (V19 C4) — frontend usage events → structured log.
     ─────────────────────────────────────────────────────────── */
  /** Sanitize телеметрии payload: primitives + flat object, max 1KB JSON. */
  function _sanitizeTelemetryData(data) {
    if (data == null || typeof data !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      // Whitelist key chars + max 40-char keys.
      if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue;
      // Primitives only at top level. Nested objects coerced to JSON-string
      // truncated 200 chars (visibility, не storage).
      if (v == null) continue;
      if (typeof v === 'string')   { out[k] = v.slice(0, 200); continue; }
      if (typeof v === 'number')   { out[k] = Number.isFinite(v) ? v : 0; continue; }
      if (typeof v === 'boolean')  { out[k] = v; continue; }
      if (Array.isArray(v))        { out[k] = v.slice(0, 20).join(','); continue; }
      // Fallback: stringify nested object (truncated).
      try { out[k] = JSON.stringify(v).slice(0, 200); } catch (_) { /* skip */ }
    }
    return out;
  }

  /**
   * V19 C4 — telemetry endpoint handler.
   * Принимает single event или batch events от frontend, emit'ит через
   * logger.event() в structured log. Side-effect: только log entry,
   * никакой DB.
   *
   * Безопасность:
   *   - whitelist event-name regex (защита от arbitrary string flood)
   *   - max-batch 50 events / req
   *   - rate-limit уже применён upstream
   *   - сами data поля sanitized: only primitives + plain objects, depth ≤ 3
   *
   * Frontend usage:
   *   navigator.sendBeacon('/api/telemetry', JSON.stringify({event, data}))
   *   — fire-and-forget, не блокирует UI.
   */
  async function handleTelemetry(req, res) {
    try {
      const raw = await readBody(req, 64 * 1024);
      const body = raw ? JSON.parse(raw) : {};
      const events = Array.isArray(body.events)
        ? body.events
        : (body.event ? [body] : []);
      if (!events.length) { writeJson(res, 400, { error: 'event[s] required' }); return; }
      if (events.length > 50) { writeJson(res, 400, { error: 'max 50 events per request' }); return; }
      let accepted = 0;
      for (const e of events) {
        const name = String(e?.event || '').trim();
        // Whitelist: <namespace>.<action> — alphanumeric + dot, max 80 chars.
        if (!/^[a-z][a-z0-9_]{0,30}\.[a-z][a-z0-9_]{0,40}$/.test(name)) continue;
        const data = _sanitizeTelemetryData(e?.data);
        logger.event(name, { ...data, src: 'browser' });
        accepted++;
      }
      writeJson(res, 200, { ok: true, accepted, total: events.length });
    } catch (err) {
      logger.warn('[telemetry] handler error', { err: err?.message || String(err) });
      writeJson(res, 400, { error: 'Invalid telemetry payload' });
    }
  }

  /* ────────────────────────────────────────────────────────────
     /api/client-error — V21 U R6: frontend → server error reporter.
     Body: { errors: [{ msg, source, level, at }] } batches.
     Pushes ring-buffer (50) into _metrics + warn-log.
     ─────────────────────────────────────────────────────────── */
  function handleClientError(req, res) {
    readBody(req, MAX_BODY).then((raw) => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      const errors = Array.isArray(body.errors) ? body.errors : (body.msg ? [body] : []);
      for (const e of errors.slice(0, 20)) {
        const msg = String(e?.msg || e?.message || '').slice(0, 500);
        if (!msg) continue;
        _metrics.clientErrors++;
        _metrics.clientErrorsRecent.push({
          at:    e?.at || new Date().toISOString(),
          msg,
          level: String(e?.level  || 'error').slice(0, 16),
          src:   String(e?.source || '').slice(0, 80),
        });
        if (_metrics.clientErrorsRecent.length > 50) _metrics.clientErrorsRecent.shift();
        try { logger.warn('client.error', { msg, level: e?.level, src: e?.source }); } catch (_) {}
      }
      writeJson(res, 200, { ok: true, accepted: errors.length });
    }).catch((e) => writeJson(res, 400, { error: e.message || String(e) }));
  }

  /* ────────────────────────────────────────────────────────────
     /health — cheap liveness probe.
     ─────────────────────────────────────────────────────────── */
  function handleHealth(req, res) {
    return writeJson(res, 200, {
      ok: true,
      uptime: process.uptime(),
      pid: process.pid,
      now: new Date().toISOString(),
    });
  }

  /* ────────────────────────────────────────────────────────────
     /ready — V21 BT (audit-05 §E #6) depth-check.
     Проверяет что сервер ГОТОВ обслуживать запросы. 503 если any check fails.
     ─────────────────────────────────────────────────────────── */
  function handleReady(req, res) {
    const checks = {};
    let allOk = true;
    // Check 1: jira_config.json readable (или absent).
    try {
      const cfg = jiraReadConfig ? jiraReadConfig() : {};
      checks.config = { ok: true, hasJira: !!cfg.jiraBaseUrl };
    } catch (e) {
      checks.config = { ok: false, error: String(e?.message || e).slice(0, 80) };
      allOk = false;
    }
    // Check 2: persistence dir writable.
    try {
      if (JOBS_PERSIST_BASE) {
        const testFile = _pathLib.join(JOBS_PERSIST_BASE, '.ready-probe');
        try { fs.mkdirSync(JOBS_PERSIST_BASE, { recursive: true }); } catch (_) {}
        fs.writeFileSync(testFile, String(Date.now()));
        fs.unlinkSync(testFile);
        checks.persistence = { ok: true, dir: JOBS_PERSIST_BASE };
      } else {
        checks.persistence = { ok: true, dir: null };
      }
    } catch (e) {
      checks.persistence = { ok: false, error: String(e?.message || e).slice(0, 80) };
      allOk = false;
    }
    // Check 3: in-memory metrics не сломались.
    try {
      checks.memory = { ok: true, mb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
    } catch (e) {
      checks.memory = { ok: false };
      allOk = false;
    }
    // Check 4: circuit-breaker map size — много open breaker'ов = degraded.
    let openBreakers = 0;
    try {
      if (_breakers) for (const [, b] of _breakers) if (b.openUntil > Date.now()) openBreakers++;
    } catch (_) {}
    checks.breakers = { ok: openBreakers < 3, openCount: openBreakers };
    if (!checks.breakers.ok) allOk = false;
    return writeJson(res, allOk ? 200 : 503, {
      ready: allOk,
      checks,
      now: new Date().toISOString(),
    });
  }

  /* ────────────────────────────────────────────────────────────
     /metrics + /metrics/prom — V21 U + PR-CX:
     p50/p95/p99 latency, error-rate, DAU, recent client errors,
     circuit-breaker state per-host, cache sizes.
     ─────────────────────────────────────────────────────────── */
  function handleMetrics(req, res, pathname) {
    const lat = _metrics.latencies.filter(Number.isFinite);
    const totalReqs = _metrics.requestsTotal || 1;
    const now = Date.now();
    // PR-CX — собираем breaker state per-host (open/closed + recent failures + openUntil).
    const breakers = {};
    if (_breakers) {
      for (const [host, b] of _breakers) {
        if (!b) continue;
        const recentFailures = (b.failures || []).filter(t => now - t < 60_000).length;
        breakers[host] = {
          open: !!(b.openUntil && now < b.openUntil),
          openUntil: b.openUntil > 0 ? new Date(b.openUntil).toISOString() : null,
          failuresLastMin: recentFailures,
          totalFailureRecords: (b.failures || []).length,
        };
      }
    }
    const cacheSizes = {
      http: _HTTP_CACHE ? _HTTP_CACHE.size : 0,
      recentBucket: _recentBucketCache ? _recentBucketCache.size : 0,
      llmBudgetUsers: typeof llmBudgetUserCount === 'function' ? (llmBudgetUserCount() || 0) : 0,
    };
    const dau = _activeDaus();
    const json = {
      ok: true,
      uptimeSec: Math.round((now - _metrics.startedAt) / 1000),
      requestsTotal: _metrics.requestsTotal,
      requestsByPath: _metrics.requestsByPath,
      errors4xx: _metrics.errors4xx,
      errors5xx: _metrics.errors5xx,
      errorRate: ((_metrics.errors4xx + _metrics.errors5xx) / totalReqs).toFixed(4),
      rateLimited: _metrics.rateLimited,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      latencyMs: {
        sampleSize: lat.length,
        p50: _quantile(lat, 0.50),
        p95: _quantile(lat, 0.95),
        p99: _quantile(lat, 0.99),
      },
      dau24h: dau,
      clientErrorsTotal: _metrics.clientErrors,
      clientErrorsRecent: _metrics.clientErrorsRecent.slice(-10),
      breakers,
      cacheSizes,
    };
    if (pathname === '/metrics/prom') {
      // PR-CX — Prometheus text exposition format.
      // Любой scrape (Prometheus / VictoriaMetrics / OpenTelemetry) понимает.
      const escLabel = (v) => String(v).replace(/[\\"\n]/g, c => c === '\n' ? '\\n' : '\\' + c);
      const lines = [];
      const push = (name, help, type, value, labels = '') => {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
        lines.push(`${name}${labels} ${value}`);
      };
      const counter = (name, help, value, labels = '') => push(name, help, 'counter', value, labels);
      const gauge   = (name, help, value, labels = '') => push(name, help, 'gauge',   value, labels);
      counter('prisma_requests_total', 'Total HTTP requests', _metrics.requestsTotal);
      counter('prisma_errors_4xx_total', '4xx responses count', _metrics.errors4xx);
      counter('prisma_errors_5xx_total', '5xx responses count', _metrics.errors5xx);
      counter('prisma_rate_limited_total', 'Rate-limited requests', _metrics.rateLimited);
      counter('prisma_client_errors_total', 'Frontend errors reported', _metrics.clientErrors);
      gauge('prisma_uptime_seconds', 'Process uptime in seconds', json.uptimeSec);
      gauge('prisma_memory_mb', 'Process RSS in MB', json.memoryMB);
      gauge('prisma_dau_24h', 'Distinct clients seen in 24h', dau);
      gauge('prisma_latency_ms', 'Latency p50', json.latencyMs.p50, '{quantile="0.5"}');
      gauge('prisma_latency_ms', 'Latency p95', json.latencyMs.p95, '{quantile="0.95"}');
      gauge('prisma_latency_ms', 'Latency p99', json.latencyMs.p99, '{quantile="0.99"}');
      gauge('prisma_cache_size', 'In-memory cache size', cacheSizes.http,         '{name="http"}');
      gauge('prisma_cache_size', 'In-memory cache size', cacheSizes.recentBucket, '{name="recent_bucket"}');
      gauge('prisma_cache_size', 'In-memory cache size', cacheSizes.llmBudgetUsers, '{name="llm_budget_users"}');
      // Per-host circuit-breaker.
      for (const [host, b] of Object.entries(breakers)) {
        const lbl = `{host="${escLabel(host)}"}`;
        gauge('prisma_circuit_breaker_open', '1 if breaker is open, 0 if closed', b.open ? 1 : 0, lbl);
        gauge('prisma_circuit_breaker_failures_last_min', 'Recent failures (60s window)', b.failuresLastMin, lbl);
      }
      const body = lines.join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(body);
      return;
    }
    return writeJson(res, 200, json);
  }

  return {
    // Rate limit
    checkRateLimit,
    clientIp,
    clientBucketKey,
    // Metric recorders (called from request lifecycle hooks)
    recordRequest,
    recordClientSeen,
    // Endpoint handlers
    handleHealth,
    handleReady,
    handleMetrics,
    handleTelemetry,
    handleClientError,
  };
}

module.exports = {
  createObservability,
  // Constants exported for visibility / tests.
  RL_WINDOW_MS,
  RL_LIMIT,
};
