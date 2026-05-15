// Static server + LLM proxy (Node built-ins only)
// Usage: node server.js [port]
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');
// V19 E4 — structured logger вместо ad-hoc console.* calls.
// JSON output по умолчанию (для ELK ingestion), levels via LOG_LEVEL env.
const logger = require('./server/logger.js');
// V18 — Observability + operational endpoints (rate-limit, /health, /ready,
// /metrics, /metrics/prom, /api/telemetry, /api/client-error) вынесены
// в отдельный модуль. `_metrics` остаётся в этом файле (используется
// LLM-budget code), передаётся в фабрику createObservability ниже.
const { createObservability } = require('./server/observability.js');

const PORT = parseInt(process.argv[2], 10) || 8080;
const ROOT = __dirname;

// V22 Stage 8 — bootstrap helpers + static handler extracted to small
// dedicated modules. Destructured names preserve the existing call-site
// shape (writeJson/readBody/isSameOriginRequest/MAX_BODY) — keeps every
// in-file usage unchanged.
const { writeJson, readBody, isSameOriginRequest, MAX_BODY } = require('./server/helpers.js');
const { serveStatic } = require('./server/static.js');

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
const _rlBuckets = new Map();   // bucketKey → [timestamp, ...]
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
  // V21 U (audit-2026-05-03 §E R7) — реальные observability-метрики:
  // p95 latency через ring-buffer последних 1000 latencies, DAU через
  // X-Client-Id за последние 24ч, client-error rate.
  latencies: [],          // ring-buffer (последние 1000 ms)
  latenciesIdx: 0,
  daus: new Map(),        // clientId -> last seen epoch ms
  clientErrors: 0,        // total client-side errors reported (R6)
  clientErrorsRecent: [], // [{at, msg}] — последние 50 для quick view
};
const _LATENCY_BUFFER = 1000;
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
function _quantile(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
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

// ============================================================
// LLM / GigaChat — extracted to server/llm.js (V18 pilot)
// Constants, OAuth, SSE forwarding, budget cap and the proxyChat
// handler all live in server/llm.js now. Keep this factory call
// here so server.js retains only the route registration below
// (search for '/api/llm/chat').
// ============================================================
const llm = require('./server/llm.js').create({ readBody, writeJson, MAX_BODY });

// ============================================================
// JIRA PULSE — config + proxy
// ----------------------------------------------------------------
// V18 extraction — config block (JIRA_CONFIG_FILE / JIRA_DEFAULT_CONFIG /
// jiraReadConfig / jiraWriteConfig / jiraSanitizeAreas / jiraSanitizeConfig)
// + jiraBuildReport + handleJiraApi moved to server/jira-api.js. The
// low-level helpers (jiraRequest, jiraSearchAll, jiraPLimit,
// jiraBuildAreaReport, jiraInvalidateRecentCache, etc.) STAY here —
// they are wired into the module via the factory below.
//
// The factory call lives near the route registration further down
// (search "require('./server/jira-api.js')") because it needs
// `jiraRequest` / `jiraSearchAll` / `jiraBuildAreaReport` /
// `jiraInvalidateRecentCache` / `jiraPLimit` — all defined later in
// this file. After the require, we destructure backward-compat
// aliases so existing in-file callsites
// (jiraResolveSprintFieldId / jiraBuildAreaReport / etc.) keep
// using `jiraReadConfig()` / `jiraSanitizeAreas()` unchanged.
// ============================================================

// V18 extraction step 2 — keepAlive agents, circuit-breaker, httpCache,
// SSRF guard, jiraForward / jiraRequest / jiraSearchAll / jiraPLimit /
// _jiraGate* / _bbGate* и связанные helpers вынесены в server/upstream.js.
// Это shared HTTP-инфраструктура для ВСЕХ outbound integration-вызовов
// (Jira, Bitbucket, Confluence, Zephyr, Jenkins) — не jira-only, отсюда
// нейтральное имя модуля. Backward-compat aliases ниже — все existing
// callsite'ы внутри server.js продолжают работать без изменений.
const upstream = require('./server/upstream.js');
const {
  jiraForward, jiraParseResp, jiraSleep,
  jiraRequest, jiraSearchAll, jiraPLimit,
  _breakerCheck, _breakerRecordFailure, _breakerRecordSuccess,
  _httpCacheGet, _httpCacheSet, _httpCacheKey,
  _ssrfBlocked, _cfBuildPathCascade,
  _jiraGateWait, _jiraGateClose,
  _bbGateWait, _bbGateClose,
  _MAX_RESPONSE_BYTES, _HTTP_CACHE_TTL_MS,
  // Live state Maps — _periodicCleanup ниже в этом файле проходит по ним
  // (reference-equal с upstream.js — один и тот же объект на оба модуля).
  _HTTP_CACHE, _breakers,
} = upstream;

// V18 extraction — Jira-domain helpers (jiraResolveSprintFieldId /
// jiraInvalidateRecentCache / jiraBuildAreaReport / jiraResolveProjectId)
// + recent-bucket cache state вынесены в server/jira-helpers.js. Factory
// wired here EARLY so `_recentBucketCache` / `_RECENT_CACHE_TTL_MS` aliases
// are bound before `_periodicCleanup` ever fires (setInterval'ed below).
// Zephyr's `jiraResolveZephyrResultFieldId` is wired LATE through
// `setZephyrResultFieldIdResolver(...)` after the zephyr factory boots.
const _jiraHelpers = require('./server/jira-helpers.js').create({
  jiraRequest, jiraSearchAll, jiraPLimit,
});
const {
  jiraResolveSprintFieldId,
  jiraInvalidateRecentCache,
  jiraBuildAreaReport,
  jiraResolveProjectId,
  _recentBucketCache,
  _RECENT_CACHE_TTL_MS,
} = _jiraHelpers;

// PR-CW — периодический GC всех in-memory структур. Раньше cleanup происходил
// только on-access (`_httpCacheGet` проверяет TTL только при чтении), и при
// низком трафике entries скапливались часами. Теперь sweep раз в 5 мин:
//   · _HTTP_CACHE: drop entries старше 5 мин
//   · _recentBucketCache: drop entries старше 24h
//   · _metrics.daus: drop clients > 24h неактивные
//   · _breakers: drop hosts > 7д без открытий (стабилизировались)
//   · _llmBudgetPerUser (now in server/llm.js): drop entries > 48h (in-place GC)
const _CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
function _periodicCleanup() {
  const now = Date.now();
  // _HTTP_CACHE
  let httpDropped = 0;
  for (const [k, v] of _HTTP_CACHE) {
    if (now - v.at > _HTTP_CACHE_TTL_MS) { _HTTP_CACHE.delete(k); httpDropped++; }
  }
  // _recentBucketCache
  let recentDropped = 0;
  for (const [k, v] of _recentBucketCache) {
    if (now - (v.cachedAt || 0) > _RECENT_CACHE_TTL_MS) { _recentBucketCache.delete(k); recentDropped++; }
  }
  // _metrics.daus (24h)
  let dausDropped = 0;
  const dauCutoff = now - 24 * 3600 * 1000;
  for (const [k, t] of _metrics.daus) {
    if (t < dauCutoff) { _metrics.daus.delete(k); dausDropped++; }
  }
  // _breakers — stable hosts (closed, openUntil=0, и failures старше 7д) — drop
  let breakersDropped = 0;
  const breakerStaleMs = 7 * 24 * 3600 * 1000;
  for (const [host, b] of _breakers) {
    if (!b) { _breakers.delete(host); breakersDropped++; continue; }
    const stillBlocked = b.openUntil && now < b.openUntil;
    const recentFailure = (b.failures || []).some(t => now - t < breakerStaleMs);
    if (!stillBlocked && !recentFailure) { _breakers.delete(host); breakersDropped++; }
  }
  if (httpDropped + recentDropped + dausDropped + breakersDropped > 0) {
    try {
      logger?.debug?.('memory cleanup', {
        httpDropped, recentDropped, dausDropped, breakersDropped,
        httpSize: _HTTP_CACHE.size, recentSize: _recentBucketCache.size,
        dausSize: _metrics.daus.size, breakersSize: _breakers.size,
      });
    } catch (_) { /* logger может быть не готов на boot */ }
  }
}
const _cleanupTimer = setInterval(_periodicCleanup, _CLEANUP_INTERVAL_MS);
if (_cleanupTimer.unref) _cleanupTimer.unref();   // не блокируем graceful shutdown

// V18 extraction step 2 — _ssrfBlocked, _cfBuildPathCascade,
// jiraForward, jiraParseResp, jiraSleep, _jiraGate*, jiraRequest,
// jiraSearchAll, jiraPLimit вынесены в server/upstream.js (см.
// require + destructure возле LLM-extraction в начале файла).
// Здесь стоял блок ~440 LOC; теперь все callsite'ы используют
// функции через destructured backward-compat aliases.

// V18 extraction — Jira-domain helpers (jiraResolveSprintFieldId /
// jiraInvalidateRecentCache / jiraBuildAreaReport / jiraResolveProjectId)
// + JIRA_FIELDS / JIRA_DEFAULT_EXPAND constants + recent-bucket cache
// state вынесены в server/jira-helpers.js. Factory wired EARLY (right
// after upstream destructure) — see top of file. Here стоял блок ~240 LOC.

/* ────────────────────────────────────────────────────────────
   Portfolio Pulse: Bitbucket / Confluence 48h-window aggregators.
   Returns { authors: { [lowerKey]: { commits, prs, displayName, email? } } }.

   Tries Cloud-style endpoints first (matches existing /api/integrations/
   bitbucket-prs handler). If a request 404s, falls back to Bitbucket Server
   (Stash) REST 1.0 paths. Project-key syntax: "workspace/repo" for Cloud,
   "PROJECT/repo" for Server (single-segment entries are skipped — we can't
   infer the workspace/project).
   ─────────────────────────────────────────────────────────── */
// V18.1 P10 — pure auth helpers extracted to server/integrations/authHelpers.js
// (mirrors the frontend Utils.redactSecretsInText, V18 P6).
const _authHelpers = require('./server/integrations/authHelpers.js');
const _ppMakeAuthHeader      = _authHelpers.makeAuthHeader;
const _ppKeyForAuthor        = _authHelpers.keyForAuthor;
const _ppRedactSecretsInText = _authHelpers.redactSecretsInText;

// V18 extraction — Confluence fetchers вынесены в server/confluence.js
// (ppFetchConfluenceActivity + 5 cf-helpers + private _ppCfAuditAugment).
// Factory wires runtime deps (upstream HTTP / concurrency / path-cascade /
// auth helpers). Backward-compat aliases ниже — все callsite'ы внутри
// server.js (и _runPortfolioPulse в particular) продолжают работать без
// изменений.
const _confluence = require('./server/confluence.js').create({
  jiraForward,
  jiraPLimit,
  _cfBuildPathCascade,
  _ppMakeAuthHeader,
  _ppKeyForAuthor,
  _ppRedactSecretsInText,
});
const {
  ppFetchConfluenceActivity,
  ppFetchCfAuthorshipVelocity,
  ppFetchCfSpaceAcl,
  ppFetchRetroClosure,
  ppFetchCfHealthMetrics,
  ppFetchStaleConfluence,
} = _confluence;

// V18 extraction — Zephyr / test-management вынесены в server/zephyr.js
// (jiraResolveZephyrResultFieldId + 5 helpers + ppFetchZephyrActivity).
// `jiraResolveProjectId` теперь живёт в server/jira-helpers.js — фабрика
// получает его прямой ссылкой (вместо прежнего wrapper-arrow на hoisted
// function declaration).
const _zephyr = require('./server/zephyr.js').create({
  jiraRequest,
  jiraForward,
  jiraPLimit,
  jiraResolveProjectId,
  ppMakeAuthHeader: _ppMakeAuthHeader,
});
const {
  jiraResolveZephyrResultFieldId,
  ppFetchZephyrActivity,
} = _zephyr;
// V18 extraction — late-bind Zephyr field-id resolver into jira-helpers
// (chicken/egg: jiraBuildAreaReport вызывает jiraResolveZephyrResultFieldId,
// который определён в zephyr factory — но jira-helpers wired ВЫШЕ, чтобы
// `_recentBucketCache` был доступен `_periodicCleanup`. Поэтому setter).
_jiraHelpers.setZephyrResultFieldIdResolver(jiraResolveZephyrResultFieldId);

// V18 extraction — Jenkins verify endpoint вынесен в server/jenkins.js
// (handleJenkinsVerify). Маршрут остаётся в handleIntegrationsApi — просто
// delegate'ит в модульный handler.
const _jenkins = require('./server/jenkins.js').create({
  jiraForward,
  writeJson,
  ppMakeAuthHeader: _ppMakeAuthHeader,
});
const { handleJenkinsVerify, handleJenkinsScan } = _jenkins;

/**
 * API5: нормализация Stash-timestamp'а. Atlassian возвращает миллисекунды
 * (13 цифр), но Sber-доки в примерах показывают секунды (10 цифр). Если
 * стенд однажды вернёт seconds-encoded ts — все 48ч/72ч окна молча empty
 * (`ts < cutoffTs` всегда true для 1970-х дат). Guard: если ts < 10^10 —
 * умножаем на 1000.
 */
function _ppNormalizeBbTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 10_000_000_000 ? n * 1000 : n;
}

/**
 * Возвращает Set допустимых BB project-keys в lowercase из cfg.bitbucketProjectKeys.
 * Поддерживает форматы "PROJECT" и "PROJECT/repo" (берёт первый сегмент).
 * Пустой allowlist (нет настройки) → пустой Set, и вызывающий код должен сам
 * решать, что делать (обычно — fallback на listProjects).
 */
function _ppBbAllowedProjects(cfg) {
  return new Set(
    String(cfg?.bitbucketProjectKeys || '')
      .split(',')
      .map(s => (s.trim().split('/')[0] || '').trim().toLowerCase())
      .filter(Boolean)
  );
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
// V18 extraction step 5 — ppFetchBitbucketActivity вынесена в server/bitbucket.js.
// Здесь стоял блок ~565 LOC; теперь все callsite'ы используют функцию через
// destructured backward-compat alias возле `require('./server/bitbucket.js').create`.
function _parseEmailName(raw) {
  if (!raw) return ''; const m = String(raw).match(/^([^<]+)</); return m ? m[1].trim() : '';
}
function _parseEmailEmail(raw) {
  if (!raw) return ''; const m = String(raw).match(/<([^>]+)>/); return m ? m[1].trim() : '';
}

// V18 extraction step 5 — Bitbucket fetcher'ы (Activity / Governance /
// _bbFetchWithRetry) вынесены в server/bitbucket.js. Factory получает уже
// резолвенные deps (jiraForward / _bbGate* / jiraPLimit / pp-helpers) и
// возвращает три функции с теми же сигнатурами, что были раньше — все
// existing callsite'ы (`_runPortfolioPulse`, `ppFetchDevStatusForIssues`)
// продолжают работать без изменений.
const bitbucket = require('./server/bitbucket.js').create({
  jiraForward, jiraSleep,
  _bbGateWait, _bbGateClose,
  jiraPLimit,
  _ppMakeAuthHeader, _ppKeyForAuthor,
  _parseEmailName, _parseEmailEmail,
  _ppNormalizeBbTs, _ppBbAllowedProjects,
});
const { ppFetchBitbucketActivity, ppFetchBitbucketGovernance, _bbFetchWithRetry } = bitbucket;

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

  // BUGFIX: dev-status API возвращает PR/коммиты из ВСЕХ BB-проектов,
  // привязанных к Jira-задаче — даже из тех, что отсутствуют в
  // bitbucketProjectKeys. Раньше комментарий сверху явно говорил «No
  // bitbucketProjectKeys setting needed», но пользователь хочет чтобы
  // активность считалась только из настроенных проектов. Допустимые
  // PROJECT-keys собираем из bitbucketProjectKeys (формат "PROJECT/repo"
  // или "PROJECT"); пустой allowlist = пропускаем фильтр (legacy-режим).
  const _bbAllowedProjectKeys = new Set(
    String(cfg.bitbucketProjectKeys || '')
      .split(',')
      .map(s => (s.trim().split('/')[0] || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const _bbExtractProjectKey = (url) => {
    if (!url) return '';
    const m = String(url).match(/\/projects\/([^/]+)\/repos\//i);
    return m ? m[1].toLowerCase() : '';
  };
  const _bbAllow = (url) => {
    if (!_bbAllowedProjectKeys.size) return true;       // backward-compat: no filter
    const pk = _bbExtractProjectKey(url);
    if (!pk) return false;                              // не смогли разобрать → отбрасываем
    return _bbAllowedProjectKeys.has(pk);
  };

  const ITEMS_CAP_PER_AUTHOR = 50;
  const authors = {};
  const tried = [];
  let _bbDroppedOutOfAllowlist = 0;
  // E1: keep up to 10 example items dropped by allowlist so UI may show
  // «команда контрибутит во внешний repo» insight instead of opaque count.
  const _bbDroppedSamples = [];
  const DROPPED_SAMPLES_CAP = 10;
  const _pushDroppedSample = (kind, item) => {
    if (_bbDroppedSamples.length >= DROPPED_SAMPLES_CAP) return;
    _bbDroppedSamples.push({
      kind,
      author: String(item.author || '').slice(0, 80),
      authorSlug: String(item.authorSlug || '').slice(0, 80),
      project: String(item.project || ''),
      repo: String(item.repo || ''),
      // Title truncated to 60 chars (constraint — no commit body / PR description).
      title: String(item.title || '').split('\n')[0].slice(0, 60),
      url: String(item.url || ''),
      at: item.at || '',
    });
  };
  // Stash sometimes uses applicationType=bitbucket on newer installs. We prefer
  // 'stash' first (matches existing ppFetchBitbucketActivity expectations) but
  // remember which one yielded results so we don't waste calls on the other.
  let preferredAppType = 'stash';
  let appTypeProbed = false;
  let appTypeEmptyResponses = 0;   // M7: счётчик именно пустых, не всех попыток

  // R6: signature унифицирован с repo-walk bump (line 1488) — пятый параметр
  // slug. Раньше repo-walk хранил key=slug (latin), dev-status key=displayName
  // (русский) → один человек = два bucket'а в `authors`, merge их не слепливал.
  // Теперь оба пути идут через одинаковый `_ppKeyForAuthor(displayName||slug, email)`.
  const bump = (kind, displayName, email, item, slug) => {
    const k = _ppKeyForAuthor(displayName || slug, email);
    if (!k) return;
    if (!authors[k]) authors[k] = {
      commits: 0, prs: 0, displayName: displayName || email || k, email: email || '', items: [],
      reviews: 0, approves: 0, needsWork: 0, declined: 0, prComments: 0,
    };
    if (typeof authors[k][kind] !== 'number') authors[k][kind] = 0;
    authors[k][kind]++;
    if (!authors[k].displayName && displayName) authors[k].displayName = displayName;
    if (!authors[k].email && email) authors[k].email = email;
    const sl = String(slug || '').toLowerCase().trim();
    if (sl && !authors[k].slug) authors[k].slug = sl;
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

  // R2: extract `PROJECT/repo` из URL вида `…/projects/PROJ/repos/REPO/…`,
  // чтобы dev-status и repo-walk использовали идентичный repo-формат для
  // dedup-key в `_ppMergeAuthorMaps`. Раньше repo-walk → 'PROJ/repo',
  // dev-status → '' либо `repositoryName` (без проекта) → ключи не совпадали,
  // PR двоился либо терялся.
  const _extractRepoPath = (url) => {
    if (!url) return '';
    const m = String(url).match(/\/projects\/([^/]+)\/repos\/([^/?#]+)/i);
    return m ? `${m[1]}/${m[2]}` : '';
  };

  const fetchOne = async (job) => {
    // Per-call timeout via AbortController-style timeoutMs in jiraForward.
    // Cascade applicationType: try preferredAppType first; if 200 + no detail
    // entries on FIRST few calls, fall back to the other.
    const url = `${base}/rest/dev-status/1.0/issue/detail?issueId=${encodeURIComponent(job.issueId)}&applicationType=${preferredAppType}&dataType=${job.dataType}`;
    // V21 BB-RL fix — retry с shared _bbGate. Раньше прямой jiraForward ловил
    // 429 (80% запросов!) и молча возвращал {found:0} — теряли BB-attribution
    // для сотен PR. Теперь до 4 попыток с honor-Retry-After. tried.push
    // ниже как было — пишет финальный исход (200 если retry помог).
    const r = await _bbFetchWithRetry({
      targetUrl: url, method: 'GET',
      headers: { Authorization: auth },
      allowInsecureTls: tls, timeoutMs: PER_CALL_TIMEOUT_MS,
    });

    tried.push({ entry: job.issueKey, type: `dev-${job.dataType}`, status: r.status });

    if (r.status < 200 || r.status >= 300) return { found: 0 };

    let parsed;
    try { parsed = JSON.parse(r.text); } catch (e) {
      // M1: было `catch(_) { return ... }` — JSON-parse failure терял
      // дев-статус целой задачи без записи в tried[].
      tried.push({ entry: job.issueKey, type: `dev-${job.dataType}-parse`, error: String(e?.message || e).slice(0, 100) });
      return { found: 0 };
    }
    const detail = Array.isArray(parsed?.detail) ? parsed.detail : [];

    // R3: was «после 10 пустых ответов swap». При CONCURRENCY=8 восемь
    // параллельных fetchOne стартуют ДО прихода первого результата —
    // если все 8 случайно пустые (норма для onboarding), счётчик прыгнет
    // к 8 до того как любой ответ установит appTypeProbed=true → ложный
    // swap. Считаем порог × 3 (24 пустых до swap'а), и используем
    // counter+early-out atomically: одна проверка делает swap+probe.
    if (!appTypeProbed) {
      const isEmpty = detail.length === 0 || detail.every(d => !d.pullRequests?.length && !d.repositories?.length);
      if (isEmpty) {
        const cnt = ++appTypeEmptyResponses;
        if (cnt >= CONCURRENCY * 3 && !appTypeProbed) {
          preferredAppType = preferredAppType === 'stash' ? 'bitbucket' : 'stash';
          appTypeProbed = true;
        }
      } else {
        appTypeProbed = true; // первый реальный ответ — фиксируем правильный appType
      }
    }

    let found = 0;
    if (job.dataType === 'pullrequest') {
      for (const d of detail) for (const pr of (d.pullRequests || [])) {
        const at = pr.lastUpdate || pr.updated || '';
        if (at && Date.parse(at) < cutoffTs) continue;     // outside 48h window
        // PR-CG: отбрасываем PR из BB-проектов вне bitbucketProjectKeys.
        if (!_bbAllow(pr.url)) {
          _bbDroppedOutOfAllowlist++;
          _pushDroppedSample('pr', {
            author: pr.author?.displayName || pr.author?.name || '',
            authorSlug: pr.author?.name || pr.author?.slug || '',
            project: _bbExtractProjectKey(pr.url),
            repo: _extractRepoPath(pr.url) || pr.repositoryName || '',
            title: pr.name || pr.title || '',
            url: pr.url || '',
            at: pr.lastUpdate || pr.updated || '',
          });
          continue;
        }
        const prId = String(pr.id || pr.url || '');
        const dedupKey = `${prId}|${pr.author?.name || ''}`;
        if (seenAuthorKeys.has(dedupKey)) continue;
        seenAuthorKeys.add(dedupKey);
        seenPr.add(prId);
        // R2: repo в формате `PROJECT/repo` (как в repo-walk) для dedup-консистентности.
        const repoPath = _extractRepoPath(pr.url) || pr.repositoryName || pr.source?.repository?.name || '';
        // R6: bump-signature consistent с repo-walk — передаём slug пятым
        // аргументом (dev-status `bump` сейчас имеет арность 4, slug
        // игнорируется без crash, но при будущей унификации подхватится).
        bump('prs', pr.author?.name || pr.author?.displayName || '', pr.author?.email || '', {
          kind:   'pr',
          title:  pr.name || pr.title || '',
          url:    pr.url || '',
          repo:   repoPath,
          at, status: String(pr.status || '').toLowerCase(),
          prId,
          source: 'dev-status',
        }, pr.author?.name || pr.author?.slug || '');
        found++;
      }
    } else if (job.dataType === 'repository') {
      for (const d of detail) for (const repo of (d.repositories || [])) {
        // PR-CG: отбрасываем целиком репозиторий, если его проект не в allowlist.
        // У repo.url обычно есть `/projects/PROJECT/repos/...`. Если url нет, но
        // у первого коммита есть — пробуем по нему.
        const repoUrl = repo.url || (repo.commits && repo.commits[0] && repo.commits[0].url) || '';
        if (!_bbAllow(repoUrl)) {
          _bbDroppedOutOfAllowlist += (repo.commits || []).length;
          // Take first commit as sample (rest of repo collapses into the count).
          const firstC = (repo.commits || [])[0];
          if (firstC) {
            _pushDroppedSample('commit', {
              author: firstC.author?.displayName || firstC.author?.name || '',
              authorSlug: firstC.author?.name || '',
              project: _bbExtractProjectKey(repoUrl),
              repo: _extractRepoPath(repoUrl) || repo.name || '',
              title: String(firstC.message || '').split('\n')[0],
              url: firstC.url || repoUrl,
              at: firstC.authorTimestamp || firstC.timestamp || '',
            });
          }
          continue;
        }
        // R2: repo в формате `PROJECT/repo` для dedup-консистентности.
        const repoPath = _extractRepoPath(repoUrl) || repo.name || '';
        for (const c of (repo.commits || [])) {
          const at = c.authorTimestamp || c.timestamp || '';
          if (at && Date.parse(at) < cutoffTs) continue;
          const hash = String(c.id || c.displayId || '');
          if (seenCommit.has(hash)) continue;
          seenCommit.add(hash);
          bump('commits', c.author?.displayName || c.author?.name || '', c.author?.email || '', {
            kind: 'commit',
            title: String(c.message || '').split('\n')[0],
            url:    c.url || `${base}/projects/_/repos/${encodeURIComponent(repo.name||'_')}/commits/${hash}`,
            repo:   repoPath,
            at, hash,
            source: 'dev-status',
          }, c.author?.name || '');
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

  return {
    authors, configured: true, tried, scanned: queue.length,
    prs: seenPr.size, commits: seenCommit.size,
    droppedOutOfAllowlist: _bbDroppedOutOfAllowlist,
    // E1 — first 10 dropped items (sampled). Provides «команда контрибутит
    // во внешний repo» visibility instead of opaque count.
    droppedSamples: _bbDroppedSamples,
    allowedProjectKeys: [..._bbAllowedProjectKeys],
  };
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
      // H9: ключ дедупа `${kind}|${repo}|${prId}` — Stash auto-increments
      // prId per-repo (PR #1 в RepoA и PR #1 в RepoB совпадают), один из
      // двух терялся при `${kind}|${prId}` без repo.
      // R2: если repo пустой хотя бы с одной стороны (старый dev-status формат
      // или partial fixture), полагаемся на url (он глобально уникален) —
      // иначе один и тот же PR попадёт двумя записями в items.
      const dedupKey = (it) => {
        const id = it.prId || it.hash || '';
        if (it.repo && id) return `${it.kind}|${it.repo}|${id}`;
        // fallback: глобально-уникальный url, либо kind+id если url пуст
        return `${it.kind}|${it.url || id || ''}`;
      };
      const seen = new Set(out[k].items.map(dedupKey));
      for (const it of (a.items || [])) {
        const dk = dedupKey(it);
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

// ── Async job clusters (Black Dashboard + Portfolio Pulse) ───
// V13 P12 BD / V18 P7 Pulse: single synchronous fetch can't survive 5+ min
// of work — corp HTTPS proxies, browser timeouts, and OS connection idle
// limits all kill long-lived requests. Switched to async-job pattern:
//   • POST /start  → returns { jobId } instantly, kicks off work in bg.
//   • GET  /status?jobId=X → returns { status, progress, result?, error? }.
//
// V18.1 P10 — обе кластера теперь через единый factory `createJobsCluster`
// в server/integrations/jobs.js (раньше — два почти идентичных inline-куска).
const { createJobsCluster } = require('./server/integrations/jobs.js');

// V21 Q (audit-2026-05-03 §E R1) — persist async-jobs на диск, чтобы
// перезапуск сервера НЕ оставлял клиентов с вечным 404 polling. Папку
// делаем в `os.tmpdir/sbof-jobs` чтобы не засорять рабочее дерево; на
// production можно переопределить `JOBS_PERSIST_DIR` env переменной.
const _osTmp  = require('os').tmpdir();
const _pathLib = require('path');
const JOBS_PERSIST_BASE = process.env.JOBS_PERSIST_DIR || _pathLib.join(_osTmp, 'sbof-jobs');

const _bdCluster = createJobsCluster({ prefix: 'bd',    ttlMs: 30 * 60 * 1000, maxCount: 50, label: 'bd',
  persistDir: _pathLib.join(JOBS_PERSIST_BASE, 'bd') });
function bdCreateJob() { return _bdCluster.create(); }
function bdGetJob(id)  { return _bdCluster.get(id); }
function bdRunJob(job, cfg) {
  // BD-runner закреплён за `buildBlackDashboard(cfg)` — это специфический
  // handler. Pulse делает иначе (передаёт runner inline через `pulseRunJob`).
  _bdCluster.run(job, () => buildBlackDashboard(cfg));
}

// V20 S8 #13 — pulse job TTL 30 → 120 мин. Pилот feedback: «захожу в diag
// раз в 2 недели — jobId протух всегда». 120 мин покрывает большинство
// сценариев + сберегает память (jobs ≤ 20, не существенно).
const _pulseCluster = createJobsCluster({ prefix: 'pulse', ttlMs: 120 * 60 * 1000, maxCount: 20, label: 'pulse',
  persistDir: _pathLib.join(JOBS_PERSIST_BASE, 'pulse') });
function pulseCreateJob(payload) { return _pulseCluster.create(payload); }
function pulseGetJob(id)         { return _pulseCluster.get(id); }
function pulseRunJob(job, runner){ return _pulseCluster.run(job, runner); }

// V18 extraction — TECH 17.2 cancel-registry + pulseCancelRegister/Get/Mark/
// AssertNotCancelled вынесены в server/pulse-runner.js. Aliases destructure'ятся
// после wire-up factory ниже (после `jiraApi` factory — там есть jiraSanitizeAreas).

/* ──────────────────────────────────────────────────────────
   V18.1 P7-S1.2 — rate-limit + result cache для /employee-detail.
   Sliding window 60s, max 30 req per jobId. Дополнительно
   результат-cache по (jobId, employeeKey, dwellHours) с TTL 5 мин —
   повторный запрос мгновенный, без re-running analysePulse.

   Без этих двух механизмов был DoS-vector: знающий jobId клиент
   мог в while-loop'е валить server через тяжёлую analysePulse logic.
   ────────────────────────────────────────────────────────── */
const PULSE_DETAIL_RATE_WINDOW_MS = 60 * 1000;
const PULSE_DETAIL_RATE_MAX       = 30;
const PULSE_DETAIL_CACHE_TTL_MS   = 5 * 60 * 1000;
const _pulseDetailRate  = new Map();   // jobId → { count, windowStartMs }
const _pulseDetailCache = new Map();   // `${jobId}|${employeeKey}|${dwellHours}` → { result, atMs }

/** Returns true if request allowed; false if rate-limit exceeded. */
function pulseDetailRateAllow(jobId) {
  const now = Date.now();
  const entry = _pulseDetailRate.get(jobId);
  if (!entry || now - entry.windowStartMs >= PULSE_DETAIL_RATE_WINDOW_MS) {
    _pulseDetailRate.set(jobId, { count: 1, windowStartMs: now });
    return true;
  }
  if (entry.count >= PULSE_DETAIL_RATE_MAX) return false;
  entry.count++;
  return true;
}

// V18.1 P7-S2.3 — tzOffsetMin part of cache key: разные TZ → разные heatmap.
function _pulseDetailCacheKey(jobId, employeeKey, dwellHours, tzOffsetMin) {
  return `${jobId}|${employeeKey}|${dwellHours}|${tzOffsetMin ?? 'srv'}`;
}
function pulseDetailCacheGet(jobId, employeeKey, dwellHours, tzOffsetMin) {
  const key = _pulseDetailCacheKey(jobId, employeeKey, dwellHours, tzOffsetMin);
  const entry = _pulseDetailCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.atMs >= PULSE_DETAIL_CACHE_TTL_MS) {
    _pulseDetailCache.delete(key);
    return null;
  }
  return entry.result;
}

function pulseDetailCacheSet(jobId, employeeKey, dwellHours, tzOffsetMin, result) {
  const key = _pulseDetailCacheKey(jobId, employeeKey, dwellHours, tzOffsetMin);
  _pulseDetailCache.set(key, { result, atMs: Date.now() });
  // GC старых entries: если cache > 100 — выкидываем самые старые.
  if (_pulseDetailCache.size > 100) {
    const oldest = [..._pulseDetailCache.entries()].sort((a, b) => a[1].atMs - b[1].atMs)[0];
    if (oldest) _pulseDetailCache.delete(oldest[0]);
  }
}

// V18 extraction — _runPortfolioPulse (Pulse orchestrator, ~210 LOC) вынесен
// в server/pulse-runner.js. Factory wired ниже (после jiraApi factory),
// и alias destructure возвращает _runPortfolioPulse + cancel-helpers.


/* ════════════════════════════════════════════════════════════
   Jira project-id resolver (V18 extraction).
   `jiraResolveProjectId` теперь в server/jira-helpers.js — фабрика
   wired EARLY (после upstream destructure) + alias destructure'ится
   обратно в server.js, прокидывается в zephyr factory.
   ──────────────────────────────────────────────────────────── */

// V18 extraction — `_zephyrNormalizeUserKey` (Z3 user-key normalizer)
// вынесен в server/zephyr.js вместе с `ppFetchZephyrActivity` и всеми
// retry/probe/Scale/JQL fallback'ами. См. require/destructure возле
// _confluence в начале файла.

// V18 extraction step 2 — _bbGateWait/_bbGateClose вынесены в
// server/upstream.js. Caller _bbFetchWithRetry ниже использует их
// через destructured aliases в начале файла.
/**
 * BB fetch с retry на 429/502-504/network. До 4 попыток, exp backoff
 * c jitter, honors Retry-After header. shared-gate _bbGate* блокирует
 * остальные параллельные запросы пока 429-cooldown не пройдёт.
 * Pure: не пишет в tried — caller продолжает push'ить как до фикса
 * (запись в tried только финальный исход — 200 если retry помог, 429
 * если все попытки exhausted).
 * Returns {status, text, headers} like jiraForward.
 */
// V18 extraction step 5 — _bbFetchWithRetry вынесена в server/bitbucket.js.
// Здесь стоял блок ~23 LOC; теперь все callsite'ы (включая ppFetchDevStatusForIssues)
// используют функцию через destructured alias из bitbucket.create({...}) factory.

// V18 extraction — Zephyr probe + Tests DC + Scale + JQL fallback +
// orchestrator (~680 LOC) вынесены в server/zephyr.js. Backward-compat
// alias `ppFetchZephyrActivity` импортирован выше через
// `const { ... ppFetchZephyrActivity } = _zephyr;`. Здесь стоял блок:
//   _zephyrFetchWithRetry, _zephyrFetchTestsDc_LEGACY, _zephyrProbe,
//   _zephyrFetchScale, _zephyrFetchJqlFallback, ppFetchZephyrActivity.

/* ════════════════════════════════════════════════════════════
   V21 Y4 (audit-09 §G #1, #3, §K #8, §K #10) — Big metrics fetch
   ────────────────────────────────────────────────────────────
   Все 4 fetcher'а возвращают «частичные данные если интеграция не
   настроена», `tried[]` для diagnostics. Вызываются в parallel из
   _runPortfolioPulse в новой promise-пачке `bigMetrics`.
   ──────────────────────────────────────────────────────────── */

// Y4-1: Reopen rate — JQL count «status changed FROM Done TO X AFTER -90d».
// Дёшево: один search-by-jql на PK с maxResults=0 (только total).
async function ppFetchReopenRate(cfg, projectKeys) {
  if (!cfg.jiraBaseUrl || !cfg.jiraToken || !projectKeys.length) {
    return { configured: false, byPk: {}, tried: [] };
  }
  const tried = [];
  const byPk = {};
  await jiraPLimit(3, projectKeys.map(pk => async () => {
    try {
      // Reopens (status changed FROM Done back) за 90 дней.
      const reopenJql = `project="${pk}" AND status changed FROM "Done" AFTER -90d`;
      const re = await jiraRequest(cfg, 'POST', '/rest/api/2/search', { jql: reopenJql, startAt: 0, maxResults: 0 });
      // Done за тот же период — для нормализации.
      const doneJql   = `project="${pk}" AND status changed TO "Done" AFTER -90d`;
      const dn = await jiraRequest(cfg, 'POST', '/rest/api/2/search', { jql: doneJql, startAt: 0, maxResults: 0 });
      const reopenCount = Number(re?.total) || 0;
      const doneCount   = Number(dn?.total) || 0;
      byPk[pk] = {
        reopens: reopenCount,
        dones:   doneCount,
        rate:    doneCount > 0 ? (reopenCount / doneCount) : 0,
        windowDays: 90,
      };
      tried.push({ type: 'reopen-rate', pk, status: 200, reopens: reopenCount, dones: doneCount });
    } catch (e) {
      tried.push({ type: 'reopen-rate', pk, status: e?.status || 0, error: String(e?.message || e).slice(0, 100) });
    }
  }));
  return { configured: true, byPk, tried };
}

// V21 Z5 (audit-09 §C #13) — Stale tags fetcher (release cadence).
// Возвращает per repo последние 5 tags + age последнего release tag.
async function ppFetchStaleTags(cfg, tls, knownRepos = []) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { configured: false, byRepo: {}, tried: [] };
  if (!knownRepos.length) return { configured: true, byRepo: {}, tried: [] };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const tried = [];
  const byRepo = {};
  await jiraPLimit(4, knownRepos.map(({ proj, repo }) => async () => {
    try {
      const url = `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/tags?orderBy=MODIFICATION&limit=10`;
      const r = await jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
      tried.push({ type: 'stale-tags', proj, repo, status: r.status });
      if (r.status < 200 || r.status >= 300) return;
      const tags = JSON.parse(r.text || '{}').values || [];
      const lastTag = tags[0];
      if (!lastTag) {
        byRepo[`${proj}/${repo}`] = { lastTagName: null, daysSinceLastTag: null, totalTags: 0 };
        return;
      }
      // Age based on latest tag's commit. Stash returns tag.metadata['com.atlassian...'] sometimes.
      // Fallback: try latestCommit hash + separate /commits/{sha} call (skip — too expensive).
      // Instead: use display name + count.
      byRepo[`${proj}/${repo}`] = {
        lastTagName: lastTag.displayId || lastTag.id || '',
        totalTags: tags.length,
      };
    } catch (e) { tried.push({ type: 'stale-tags', proj, repo, error: String(e?.message || e).slice(0, 100) }); }
  }));
  return { configured: true, byRepo, tried };
}

// V21 AS (audit-09 §H #80/#39) — Onboarding precise.
// Для каждого autor'а в BB определяем earliest commit timestamp (=когда впервые
// появился в репо). Используем pagination commits sorted=oldest-first, cap=5 repos × 5 страниц × 200 commit'ов.
//
// Outcome: { perAuthor: { [name]: firstSeenTs }, recentlyJoined: [...], tried: [] }
// recentlyJoined — кто появился < 90 дней назад (новенькие).
async function ppFetchOnboardingHistory(cfg, tls) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { configured: false, perAuthor: {}, recentlyJoined: [], tried: [] };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const tried = [];

  // Reuse repo discovery (top-5).
  const repos = [];
  try {
    // C5: env-параметризуем cap репозиториев для onboarding (был жёстко 1/проект).
    const ONBOARD_REPO_CAP_PER_PROJ = Math.max(1, Math.min(20, Number(process.env.PULSE_BB_ONBOARD_REPOS_PER_PROJECT) || 5));
    const ONBOARD_REPO_LIMIT = Math.max(5, Math.min(100, Number(process.env.PULSE_BB_ONBOARD_REPO_LIMIT) || 30));
    const projsR = await jiraForward({ targetUrl: `${base}/rest/api/1.0/projects?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
    if (projsR.status >= 200 && projsR.status < 300) {
      let projs = JSON.parse(projsR.text || '{}').values || [];
      // PR-CG: фильтруем проекты по bitbucketProjectKeys allowlist.
      const allow = _ppBbAllowedProjects(cfg);
      if (allow.size) projs = projs.filter(p => allow.has(String(p.key || '').toLowerCase()));
      for (const p of projs) {
        if (repos.length >= ONBOARD_REPO_LIMIT) break;
        const reposR = await jiraForward({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(p.key)}/repos?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
        if (reposR.status >= 200 && reposR.status < 300) {
          const list = JSON.parse(reposR.text || '{}').values || [];
          // M9 revert: sort by id desc оказался регрессивным (свежие репо
          // ≠ активные). Используем исходный порядок Stash (по имени).
          for (const r of list.slice(0, ONBOARD_REPO_CAP_PER_PROJ)) {
            repos.push({ proj: p.key, repo: r.slug });
            if (repos.length >= ONBOARD_REPO_LIMIT) break;
          }
        }
      }
    }
  } catch (e) { tried.push({ type: 'onboard-discover', error: String(e?.message || e).slice(0, 100) }); }
  if (!repos.length) return { configured: true, perAuthor: {}, recentlyJoined: [], tried, error: 'no-repos' };

  // Per-author earliest timestamp.
  const perAuthor = new Map();
  await jiraPLimit(3, repos.map(({ proj, repo }) => async () => {
    let start = 0;
    const PAGE_SIZE = 200;
    const PAGES_CAP = 5;     // 5 × 200 = 1000 commits per repo
    for (let pg = 0; pg < PAGES_CAP; pg++) {
      try {
        const url = `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/commits?limit=${PAGE_SIZE}&start=${start}`;
        const r = await jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 12000 });
        tried.push({ type: 'onboard-commits', proj, repo, page: pg, status: r.status });
        if (r.status < 200 || r.status >= 300) break;
        const data = JSON.parse(r.text || '{}');
        const commits = data.values || [];
        for (const c of commits) {
          const ts = _ppNormalizeBbTs(c.authorTimestamp || c.committerTimestamp || 0);
          if (!ts) continue;
          // H3: identity-deterministic key (раньше использовался первый
          // непустой из displayName/name/email — один человек с разным git
          // user.name в разных репо двоился как два author'а).
          const dn = c.author?.displayName || c.author?.name || '';
          const em = c.author?.emailAddress || '';
          const key = _ppKeyForAuthor(dn, em);
          if (!key) continue;
          const prev = perAuthor.get(key);
          if (!prev || ts < prev.ts) perAuthor.set(key, { ts, displayName: dn || em || key, email: em, slug: c.author?.name || '' });
        }
        // API10: было `data.isLastPage || commits.length < PAGE_SIZE` —
        // тот же anti-pattern что чинили для CF. Stash может вернуть
        // полную страницу при isLastPage=true. Полагаемся только на
        // `isLastPage` (per контракт). Если `nextPageStart=null` при
        // isLastPage=false — defensively break (защита от infinite loop).
        if (data.isLastPage === true) break;
        if (commits.length === 0) break;
        if (data.nextPageStart == null && data.isLastPage !== false) break;
        start = data.nextPageStart || (start + PAGE_SIZE);
      } catch (e) { tried.push({ type: 'onboard-commits', proj, repo, error: String(e?.message || e).slice(0, 100) }); break; }
    }
  }));

  // Build summary.
  const cutoff90d = Date.now() - 90 * 24 * 3600 * 1000;
  const cutoff30d = Date.now() - 30 * 24 * 3600 * 1000;
  const perAuthorObj = {};
  const recentlyJoined = [];
  for (const [key, info] of perAuthor) {
    const ts = info?.ts ?? info;        // backward-compat если value просто timestamp
    const displayName = info?.displayName || key;
    perAuthorObj[key] = ts;
    if (ts > cutoff90d) {
      recentlyJoined.push({
        name: displayName,
        key,
        email: info?.email || '',
        slug: info?.slug || '',
        firstSeenTs: ts,
        firstSeenIso: new Date(ts).toISOString().slice(0, 10),
        daysActive: Math.floor((Date.now() - ts) / 86400000),
        veryNew: ts > cutoff30d,
      });
    }
  }
  recentlyJoined.sort((a, b) => a.firstSeenTs - b.firstSeenTs); // newest at top via slice in UI

  return {
    configured: true,
    perAuthor: perAuthorObj,
    recentlyJoined,
    tried,
    summary: {
      totalAuthorsSeen: perAuthor.size,
      recentJoinersCount: recentlyJoined.length,
      veryNewCount: recentlyJoined.filter(r => r.veryNew).length,
    },
  };
}


// V21 AA (audit-09 §C #9, #14, #15) — BB governance + PR-size aggregator.
// Один fetcher: per-repo ACL + hooks + sample PR-size distribution.
// ACL/hooks — 1 call/repo каждый; PR-size — 1 call/PR cap=20 PR глобально.
// V18 extraction step 5 — ppFetchBitbucketGovernance вынесена в server/bitbucket.js.
// Здесь стоял блок ~152 LOC; теперь все callsite'ы используют функцию через
// destructured backward-compat alias возле `require('./server/bitbucket.js').create`.

// Y4-2: Stale branches — BB `/branches?orderBy=MODIFICATION&details=true&limit=100`.
// Per repo top-N stale (>30d no commits). Cap 5 repos на pulse чтобы не разогнать timeout.
async function ppFetchStaleBranches(cfg, tls) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { configured: false, byRepo: {}, tried: [] };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const tried = [];
  const byRepo = {};
  // Берём список проектов, в каждом — 5 первых repos.
  let repos = [];
  try {
    // C5: env-параметризация для stale-branches.
    const STALE_REPOS_PER_PROJ = Math.max(1, Math.min(50, Number(process.env.PULSE_BB_STALE_REPOS_PER_PROJECT) || 20));
    const STALE_REPO_LIMIT = Math.max(5, Math.min(200, Number(process.env.PULSE_BB_STALE_REPO_LIMIT) || 80));
    const projsR = await jiraForward({ targetUrl: `${base}/rest/api/1.0/projects?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
    if (projsR.status >= 200 && projsR.status < 300) {
      let projs = JSON.parse(projsR.text || '{}').values || [];
      const allow = _ppBbAllowedProjects(cfg);
      if (allow.size) projs = projs.filter(p => allow.has(String(p.key || '').toLowerCase()));
      for (const p of projs) {
        if (repos.length >= STALE_REPO_LIMIT) break;
        const reposR = await jiraForward({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(p.key)}/repos?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
        if (reposR.status >= 200 && reposR.status < 300) {
          const list = JSON.parse(reposR.text || '{}').values || [];
          // M9 revert: исходный Stash-порядок (алфавитно).
          for (const r of list.slice(0, STALE_REPOS_PER_PROJ)) {
            repos.push({ proj: p.key, repo: r.slug });
            if (repos.length >= STALE_REPO_LIMIT) break;
          }
        }
      }
    }
  } catch (e) { tried.push({ type: 'stale-branches-discover', error: String(e?.message || e).slice(0, 100) }); }
  if (!repos.length) return { configured: true, byRepo: {}, tried, error: 'no-repos-discovered' };

  const cutoffTs = Date.now() - 30 * 24 * 3600 * 1000;
  await jiraPLimit(4, repos.map(({ proj, repo }) => async () => {
    try {
      const url = `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/branches?orderBy=MODIFICATION&details=true&limit=100`;
      const r = await jiraForward({ targetUrl: url, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 12000 });
      tried.push({ type: 'stale-branches', proj, repo, status: r.status });
      if (r.status < 200 || r.status >= 300) return;
      const branches = JSON.parse(r.text || '{}').values || [];
      const stale = branches
        .map(b => ({
          name: b.displayId || b.id || '',
          lastCommitTs: _ppNormalizeBbTs(b.metadata?.['com.atlassian.bitbucket.server.bitbucket-branch:latest-commit-metadata']?.committerTimestamp || 0),
        }))
        .filter(b => b.name && b.lastCommitTs && b.lastCommitTs < cutoffTs)
        .map(b => ({ ...b, daysIdle: Math.floor((Date.now() - b.lastCommitTs) / 86400000) }))
        .sort((a, b) => a.lastCommitTs - b.lastCommitTs)
        .slice(0, 20);
      byRepo[`${proj}/${repo}`] = { staleCount: stale.length, top: stale };
    } catch (e) { tried.push({ type: 'stale-branches', proj, repo, status: 0, error: String(e?.message || e).slice(0, 100) }); }
  }));

  // V21 Z5 (audit-09 §C #13) — также собираем stale tags для тех же repos.
  const tagsResult = await ppFetchStaleTags(cfg, tls, repos);
  for (const [repoKey, tagInfo] of Object.entries(tagsResult.byRepo)) {
    if (!byRepo[repoKey]) byRepo[repoKey] = { staleCount: 0, top: [] };
    byRepo[repoKey].lastTag = tagInfo.lastTagName;
    byRepo[repoKey].totalTags = tagInfo.totalTags;
  }
  for (const t of tagsResult.tried) tried.push(t);

  return { configured: true, byRepo, tried, _repos: repos };
}



// Y4/Z3 — Hot-files top-20 + Bus-factor per file (audit-09 §G #20-#21, §K #9).
// Алгоритм: per repo берём последние 200 коммитов за 30 дней; для каждого commit
// берём /changes — list файлов. Агрегируем file → totalChanges + byAuthor map.
// Top-20 hot files. Bus-factor: если 1 author > 80% changes на файл → bf=1.
//
// Cost guard: TOTAL_CHANGES_CALL_CAP=1500 на pulse чтобы не заклинило BB.
// Concurrency=8 через jiraPLimit. Repos cap = 5 per pulse (top-discovered).
async function ppFetchHotFiles(cfg, tls) {
  if (!cfg.bitbucketBaseUrl || !cfg.bitbucketToken) return { configured: false, hotFiles: [], busFactor: [], tried: [] };
  const base = cfg.bitbucketBaseUrl.replace(/\/+$/, '');
  const auth = _ppMakeAuthHeader(cfg.bitbucketToken);
  const tried = [];
  // PR-CZ — окно расширено 30→90 дней, cap 200→1000 commits/repo. Пилот-feedback:
  // «у big-repo 200 commits = 5 дней, stale-branches > 30д не обнаруживаются».
  // Параметризовано через env для тонкой настройки.
  const HOT_FILES_DAYS              = Math.max(1, Math.min(180, Number(process.env.HOT_FILES_DAYS) || 90));
  const COMMITS_PER_REPO_CAP        = Math.max(50, Math.min(1000, Number(process.env.HOT_FILES_COMMITS_PER_REPO) || 1000));
  const TOTAL_CALL_CAP              = Math.max(500, Math.min(5000, Number(process.env.HOT_FILES_TOTAL_CALL_CAP) || 2000));
  const REPOS_CAP                   = 5;
  const cutoffTs = Date.now() - HOT_FILES_DAYS * 24 * 3600 * 1000;
  let callsUsed = 0;

  // Step 1: discover repos (re-using стиль из ppFetchStaleBranches).
  const repos = [];
  try {
    // C5: env-параметризация для hot-files. REPOS_CAP уже env-конфигурируется
    // выше; добавляем env для per-project cap.
    const HOT_REPOS_PER_PROJ = Math.max(1, Math.min(20, Number(process.env.PULSE_BB_HOT_REPOS_PER_PROJECT) || 5));
    const projsR = await jiraForward({ targetUrl: `${base}/rest/api/1.0/projects?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
    if (projsR.status >= 200 && projsR.status < 300) {
      let projs = JSON.parse(projsR.text || '{}').values || [];
      const allow = _ppBbAllowedProjects(cfg);
      if (allow.size) projs = projs.filter(p => allow.has(String(p.key || '').toLowerCase()));
      for (const p of projs) {
        if (repos.length >= REPOS_CAP) break;
        const reposR = await jiraForward({ targetUrl: `${base}/rest/api/1.0/projects/${encodeURIComponent(p.key)}/repos?limit=50`, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
        if (reposR.status >= 200 && reposR.status < 300) {
          const list = JSON.parse(reposR.text || '{}').values || [];
          // M9 revert: исходный Stash-порядок (алфавитно).
          for (const r of list.slice(0, HOT_REPOS_PER_PROJ)) {
            repos.push({ proj: p.key, repo: r.slug });
            if (repos.length >= REPOS_CAP) break;
          }
        }
      }
    }
  } catch (e) { tried.push({ type: 'hot-files-discover', error: String(e?.message || e).slice(0, 100) }); }
  if (!repos.length) return { configured: true, hotFiles: [], busFactor: [], tried, error: 'no-repos-discovered' };

  // Step 2: per repo — fetch commits + changes per commit, aggregate file → counts.
  const fileStats = new Map(); // path → { changes, byAuthor: Map<authorName, count>, repos: Set<string> }
  // V21 BC (audit-09 §H Sprint #18) — per-commit churn (lines added/removed).
  const commitChurn = []; // { at, additions, deletions, repo, author }
  for (const { proj, repo } of repos) {
    if (callsUsed >= TOTAL_CALL_CAP) break;
    try {
      // Get recent commits.
      const cmUrl = `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/commits?limit=${COMMITS_PER_REPO_CAP}`;
      const cmR = await jiraForward({ targetUrl: cmUrl, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 12000 });
      callsUsed++;
      tried.push({ type: 'hot-files-commits', proj, repo, status: cmR.status });
      if (cmR.status < 200 || cmR.status >= 300) continue;
      const commits = (JSON.parse(cmR.text || '{}').values || [])
        .filter(c => _ppNormalizeBbTs(c.authorTimestamp || c.committerTimestamp || 0) >= cutoffTs);
      if (!commits.length) continue;

      // Fetch /changes per commit с concurrency.
      const changesTasks = commits.slice(0, COMMITS_PER_REPO_CAP).map(c => async () => {
        if (callsUsed >= TOTAL_CALL_CAP) return null;
        const sha = c.id || c.displayId || '';
        if (!sha) return null;
        try {
          const chUrl = `${base}/rest/api/1.0/projects/${encodeURIComponent(proj)}/repos/${encodeURIComponent(repo)}/commits/${sha}/changes?limit=200`;
          const chR = await jiraForward({ targetUrl: chUrl, method: 'GET', headers: { Authorization: auth }, allowInsecureTls: tls, timeoutMs: 8000 });
          callsUsed++;
          if (chR.status < 200 || chR.status >= 300) return null;
          const changes = (JSON.parse(chR.text || '{}').values || []);
          const author = c.author?.displayName || c.author?.name || c.author?.emailAddress || 'unknown';
          // V21 BC — accumulate per-commit lines added/deleted.
          let commitAdditions = 0, commitDeletions = 0;
          for (const ch of changes) {
            // C6: `ch.path?.toString` truthy ВСЕГДА (toString есть на любом
            // Object) — ветка попадает на любой объект, агрегируя под пустыми
            // ключами. Корректный extract: явно проверяем shape.
            let path = '';
            if (typeof ch.path === 'string') path = ch.path;
            else if (ch.path && typeof ch.path === 'object') {
              const parent = ch.path.parent ? `${ch.path.parent}/` : '';
              const name = ch.path.name || '';
              path = `${parent}${name}`;
            }
            if (!path) continue;
            const e = fileStats.get(path) || { changes: 0, byAuthor: new Map(), repos: new Set() };
            e.changes++;
            e.byAuthor.set(author, (e.byAuthor.get(author) || 0) + 1);
            e.repos.add(`${proj}/${repo}`);
            fileStats.set(path, e);
            commitAdditions += Number(ch.linesAdded) || 0;
            commitDeletions += Number(ch.linesRemoved) || 0;
          }
          if (commitAdditions + commitDeletions > 0) {
            commitChurn.push({
              at:        _ppNormalizeBbTs(c.authorTimestamp || c.committerTimestamp || 0),
              additions: commitAdditions,
              deletions: commitDeletions,
              repo:      `${proj}/${repo}`,
              author,
            });
          }
        } catch (e) { /* skip individual commit */ }
      });
      // jiraPLimit(8, ...) — параллельно 8 changes-call'ов.
      await jiraPLimit(8, changesTasks);
    } catch (e) { tried.push({ type: 'hot-files-walk', proj, repo, error: String(e?.message || e).slice(0, 100) }); }
  }

  // Step 3: build top-20 hot files + bus-factor.
  const hotFiles = [...fileStats.entries()]
    .map(([path, stats]) => {
      // Bus-factor: minimum N authors covering 80% of changes.
      const authorCounts = [...stats.byAuthor.entries()].sort((a, b) => b[1] - a[1]);
      const total = stats.changes;
      let cum = 0;
      let bf = 0;
      for (const [, cnt] of authorCounts) {
        cum += cnt;
        bf++;
        if (cum / total >= 0.8) break;
      }
      const topAuthor = authorCounts[0] || ['', 0];
      return {
        path,
        changes: stats.changes,
        repos: [...stats.repos],
        authors: authorCounts.length,
        topAuthor:    topAuthor[0],
        topAuthorPct: total ? Math.round(topAuthor[1] / total * 100) : 0,
        busFactor:    bf,
      };
    })
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 20);

  // Bus-factor list: файлы где bf=1 + 80%+ концентрация — критичные.
  const busFactor = hotFiles.filter(f => f.busFactor === 1 && f.topAuthorPct >= 80);

  return { configured: true, hotFiles, busFactor, tried, callsUsed, commitChurn };
}

// Y4-4: Sprint commitment vs delivery — главный gap по audit value.
// Шаги: discover boardId per project → fetch closed sprints → fetch end-state issues.
// Cap = 6 sprints per project (последние). Считаем ratio committed_count / delivered_count
// по completed status.
async function ppFetchSprintCommitVsDelivery(cfg, projectKeys) {
  if (!cfg.jiraBaseUrl || !cfg.jiraToken || !projectKeys.length) {
    return { configured: false, byPk: {}, tried: [] };
  }
  const tried = [];
  const byPk = {};
  await jiraPLimit(2, projectKeys.map(pk => async () => {
    try {
      // Step 1: find board for this project. /rest/agile/1.0/board?projectKeyOrId=PK
      const boardData = await jiraRequest(cfg, 'GET', `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(pk)}`);
      const boards = boardData?.values || [];
      if (!boards.length) { tried.push({ type: 'sprint-commit', pk, status: 0, error: 'no-board' }); return; }
      const boardId = boards[0].id;
      // Step 2: last 6 closed sprints, newest first.
      const sprintsData = await jiraRequest(cfg, 'GET', `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=6`);
      const sprints = (sprintsData?.values || []).slice(-6); // последние 6
      if (!sprints.length) { tried.push({ type: 'sprint-commit', pk, status: 0, error: 'no-closed-sprints' }); return; }
      // V21 sprint-commit-fix — параллелим sprints внутри pk (jiraPLimit 3).
      // Раньше: sequential for-loop = 6 × ~3-5с = 18-30с per PK + Jira-429-retry =
      // легко улетает в 90с-timeout. Теперь: 3 параллельно × 2 batches ≈ 8-12с.
      // jiraPLimit + _jiraGate координируют 429-throttling между чанками.
      const sprintTasks = sprints.map(s => async () => {
        try {
          // Step 3: issues at sprint end-state. V21 AD — добавили SP fields для estimation accuracy.
          const issuesData = await jiraRequest(cfg, 'GET', `/rest/agile/1.0/sprint/${s.id}/issue?fields=status,resolution,resolutiondate,customfield_10004,customfield_10100,timetracking,aggregatetimespent&maxResults=200`);
          const issues = issuesData?.issues || [];
          const total = issues.length;
          const done  = issues.filter(i => i.fields?.status?.statusCategory?.key === 'done').length;
          const spillover = total - done;
          let plannedSp = 0, actualHrs = 0;
          for (const i of issues) {
            const f = i.fields || {};
            const sp = Number(f.customfield_10004) || 0;
            if (sp > 0) plannedSp += sp;
            const ts = Number(f.aggregatetimespent) || 0;
            actualHrs += ts / 3600;
          }
          const hoursPerSp = plannedSp > 0 ? +(actualHrs / plannedSp).toFixed(1) : null;
          return {
            id: s.id,
            name: s.name || `Sprint ${s.id}`,
            startDate:    s.startDate || '',
            endDate:      s.endDate   || '',
            completeDate: s.completeDate || '',
            committed: total,
            delivered: done,
            spillover,
            ratio:     total > 0 ? done / total : 0,
            plannedSp,
            actualHrs: +actualHrs.toFixed(1),
            hoursPerSp,
          };
        } catch (e) {
          tried.push({ type: 'sprint-commit-issues', pk, sprint: s.id, error: String(e?.message || e).slice(0, 100) });
          return null;
        }
      });
      const sprintRecords = (await jiraPLimit(3, sprintTasks)).filter(Boolean);
      // V21 AD — aggregate spillover + estimation accuracy.
      const totalSpillover = sprintRecords.reduce((s, r) => s + r.spillover, 0);
      const hpsValues = sprintRecords.map(r => r.hoursPerSp).filter(n => n != null && n > 0);
      const hpsAvg = hpsValues.length ? hpsValues.reduce((s, n) => s + n, 0) / hpsValues.length : null;
      const hpsCoV = (hpsValues.length >= 2 && hpsAvg)
        ? Math.sqrt(hpsValues.reduce((s, n) => s + (n - hpsAvg) ** 2, 0) / hpsValues.length) / hpsAvg
        : null;
      byPk[pk] = {
        boardId,
        sprints: sprintRecords,
        velocityTrend: sprintRecords.map(r => r.delivered),
        avgDeliveryRatio: sprintRecords.length
          ? sprintRecords.reduce((s, r) => s + r.ratio, 0) / sprintRecords.length
          : 0,
        // V21 AD — точные spillover + estimation summary.
        spilloverTotal: totalSpillover,
        spilloverAvg:   sprintRecords.length ? +(totalSpillover / sprintRecords.length).toFixed(1) : 0,
        estimationAccuracy: hpsAvg != null ? {
          avgHoursPerSp: +hpsAvg.toFixed(1),
          coV:           hpsCoV != null ? +hpsCoV.toFixed(2) : null,
          n:             hpsValues.length,
        } : null,
      };
      tried.push({ type: 'sprint-commit', pk, status: 200, sprints: sprintRecords.length });
    } catch (e) {
      tried.push({ type: 'sprint-commit', pk, status: e?.status || 0, error: String(e?.message || e).slice(0, 100) });
    }
  }));
  return { configured: true, byPk, tried };
}

// ============================================================
// V18 extraction — wire up server/jira-api.js. All deps below are
// defined earlier in this file (low-level helpers stay here per
// the extraction plan). The destructure on the next line restores
// in-file aliases so existing callsites
// (jiraResolveSprintFieldId, jiraBuildAreaReport, _runPortfolioPulse,
// etc.) keep using `jiraReadConfig()` / `jiraSanitizeAreas()` /
// `jiraSanitizeConfig()` / `jiraWriteConfig()` unchanged.
// ============================================================
const jiraApi = require('./server/jira-api.js').create({
  ROOT,
  writeJson,
  readBody,
  isSameOriginRequest,
  jiraSearchAll,
  jiraRequest,
  jiraBuildAreaReport,
  jiraInvalidateRecentCache,
  jiraPLimit,
});
const {
  jiraReadConfig,
  jiraWriteConfig,
  jiraSanitizeConfig,
  jiraSanitizeAreas,
  jiraBuildReport,
} = jiraApi;

// V18 extraction — Portfolio Pulse orchestrator (_runPortfolioPulse + cancel
// registry helpers) вынесены в server/pulse-runner.js. Wired здесь, потому
// что нужны:
//   · jira-helpers (jiraResolveSprintFieldId, jiraResolveProjectId,
//     jiraBuildAreaReport, jiraInvalidateRecentCache) — wired ВЫШЕ
//   · jira-api (jiraSanitizeAreas) — wired только что
//   · pp* fetcher'ы (ppFetchReopenRate / ppFetchSprintCommitVsDelivery /
//     ppFetchStaleBranches / ppFetchHotFiles / ppFetchOnboardingHistory /
//     ppFetchDevStatusForIssues / _ppMergeAuthorMaps) — async function
//     declarations (hoisted), reference-safe.
//   · _HTTP_CACHE / jiraPLimit / jiraRequest / jiraSearchAll / jiraForward
//     — из upstream (тоже wired ВЫШЕ).
const _pulseRunner = require('./server/pulse-runner.js').create({
  // BB
  ppFetchBitbucketActivity, ppFetchBitbucketGovernance, _bbFetchWithRetry,
  // CF
  ppFetchConfluenceActivity, ppFetchCfAuthorshipVelocity, ppFetchCfSpaceAcl,
  ppFetchRetroClosure, ppFetchCfHealthMetrics, ppFetchStaleConfluence,
  // Zephyr
  ppFetchZephyrActivity,
  // Jira-helpers
  jiraResolveSprintFieldId, jiraResolveProjectId, jiraBuildAreaReport, jiraInvalidateRecentCache,
  // Upstream
  jiraRequest, jiraSearchAll, jiraForward, jiraPLimit, _HTTP_CACHE,
  // server.js-local pp* fetchers (function declarations — hoisted)
  ppFetchReopenRate, ppFetchSprintCommitVsDelivery, ppFetchStaleBranches,
  ppFetchHotFiles, ppFetchOnboardingHistory, ppFetchDevStatusForIssues,
  _ppMergeAuthorMaps,
  // Auth + jira-api
  _ppMakeAuthHeader,
  jiraSanitizeAreas,
});
const {
  _runPortfolioPulse,
  pulseCancelRegister,
  pulseCancelGet,
  pulseCancelMark,
  pulseAssertNotCancelled,
} = _pulseRunner;

// ============================================================
// INTEGRATIONS API — V18 extraction (./server/integrations-api.js)
// ============================================================
// Большой switch по `/api/integrations/*` (~1045 LOC, 22 endpoints)
// вынесен в отдельный модуль. Wired здесь, потому что зависит от
// _pulseRunner (выше), jira-api, BD/TechInfo/Jenkins-helpers, и
// upstream-helpers — всё пробрасывается через factory.
const _integrationsApi = require("./server/integrations-api.js").create({
  // Core io
  writeJson, readBody,
  // Jira config + helpers
  jiraReadConfig, jiraSanitizeAreas,
  jiraRequest, jiraSearchAll, jiraForward,
  // Confluence path-cascade helper (server.js-local)
  cfPathCascade: _cfPathCascade,
  // Auth helpers
  ppMakeAuthHeader: _ppMakeAuthHeader,
  ppRedactSecretsInText: _ppRedactSecretsInText,
  // Pulse runner (./pulse-runner.js)
  runPortfolioPulse: _runPortfolioPulse,
  pulseCreateJob, pulseGetJob, pulseRunJob,
  pulseCancelRegister, pulseCancelMark, pulseAssertNotCancelled,
  pulseDetailRateAllow, pulseDetailCacheGet, pulseDetailCacheSet,
  PULSE_DETAIL_RATE_WINDOW_MS,
  // Black-Dashboard
  bdCreateJob, bdGetJob, bdRunJob,
  buildBlackDashboard, sigmaCfgView,
  // TechInfo
  buildTechInfo,
  // Jenkins probe + Phase-1 scan
  handleJenkinsVerify,
  handleJenkinsScan,
});
const { handleIntegrationsApi } = _integrationsApi;

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  const _reqStartedAt = Date.now();

  // V21 U — DAU tracking: каждый запрос с X-Client-Id обновляет last-seen.
  recordClientSeen(req);

  // Hook the response so we can record metrics without touching every writer.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (code, ...rest) => { res._statusCode = code; return origWriteHead(code, ...rest); };
  res.on('finish', () => recordRequest(pathname, res._statusCode || res.statusCode || 0, Date.now() - _reqStartedAt));

  // Health & metrics — exempt from rate limit, no logging surprise.
  if (pathname === '/health') {
    return writeJson(res, 200, {
      ok: true,
      uptime: process.uptime(),
      pid: process.pid,
      now: new Date().toISOString(),
    });
  }
  // V21 BT (audit-05 §E #6) — /ready depth-check.
  // Проверяет что сервер ГОТОВ обслуживать запросы:
  //  · jira_config.json читается (ENOENT == ok если defaults)
  //  · jobs persistence dir доступен
  //  · LLM token cache в памяти не corrupted
  // Возвращает 503 если хоть одна depth-check fail'нула — k8s/load-balancer
  // выведет под из rotation.
  if (pathname === '/ready') {
    const checks = {};
    let allOk = true;
    // Check 1: jira_config.json readable (или absent).
    try {
      const cfg = jiraReadConfig();
      checks.config = { ok: true, hasJira: !!cfg.jiraBaseUrl };
    } catch (e) {
      checks.config = { ok: false, error: String(e?.message || e).slice(0, 80) };
      allOk = false;
    }
    // Check 2: persistence dir writable.
    try {
      const testFile = _pathLib.join(JOBS_PERSIST_BASE, '.ready-probe');
      try { fs.mkdirSync(JOBS_PERSIST_BASE, { recursive: true }); } catch (_) {}
      fs.writeFileSync(testFile, String(Date.now()));
      fs.unlinkSync(testFile);
      checks.persistence = { ok: true, dir: JOBS_PERSIST_BASE };
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
      for (const [, b] of _breakers) if (b.openUntil > Date.now()) openBreakers++;
    } catch (_) {}
    checks.breakers = { ok: openBreakers < 3, openCount: openBreakers };
    if (!checks.breakers.ok) allOk = false;
    return writeJson(res, allOk ? 200 : 503, {
      ready: allOk,
      checks,
      now: new Date().toISOString(),
    });
  }
  if (pathname === '/metrics' || pathname === '/metrics/prom') {
    // V21 U + PR-CX — реальные метрики:
    // p50/p95/p99 latency, error-rate, DAU, recent client errors,
    // circuit-breaker state per-host, cache sizes.
    const lat = _metrics.latencies.filter(Number.isFinite);
    const totalReqs = _metrics.requestsTotal || 1;
    const now = Date.now();
    // PR-CX — собираем breaker state per-host (open/closed + recent failures + openUntil).
    const breakers = {};
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
    const cacheSizes = {
      http: _HTTP_CACHE.size,
      recentBucket: _recentBucketCache.size,
      llmBudgetUsers: llm.llmBudgetUserCount(),
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

  // V19 C4 — telemetry endpoint. Frontend POST'ит usage events,
  // server logger.event() emits как structured log entry для ELK.
  // Body: { event: string, data?: object } | { events: [{event, data}, ...] }
  // Защищён rate-limit'ом (выше). Никаких side-effects кроме log entry.
  // POST-Stage 8 fix — `handleTelemetry` ранее ссылался на missing function
  // (pre-existing bug от observability extraction Stage 1 — модуль создан,
  // но не wire'нут). Inline-implementation восстанавливает работу.
  // TODO: после полной wiring `createObservability` factory — заменить
  // на `obs.handleTelemetry(req, res)`.
  if (req.method === 'POST' && pathname === '/api/telemetry') {
    readBody(req, MAX_BODY).then((raw) => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
      const events = Array.isArray(body.events) ? body.events : (body.event ? [body] : []);
      for (const e of events.slice(0, 50)) {
        const evt = String(e?.event || '').slice(0, 80).replace(/[^a-z0-9._-]/gi, '');
        if (!evt) continue;
        const data = (e?.data && typeof e.data === 'object') ? e.data : {};
        try { logger.event?.(evt, { ...data, src: 'browser' }); } catch (_) {}
      }
      writeJson(res, 200, { ok: true, accepted: events.length });
    }).catch(() => writeJson(res, 400, { error: 'Invalid telemetry payload' }));
    return;
  }
  // V21 U (audit-2026-05-03 §E R6) — client→server error reporter.
  // Frontend posts { errors: [{ msg, source, level, at }] } batches.
  // Сохраняем ring-buffer 50 последних в _metrics + warn-log.
  if (req.method === 'POST' && pathname === '/api/client-error') {
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
    return;
  }
  if (req.method === 'POST' && pathname === '/api/llm/chat') {
    llm.proxyChat(req, res); return;
  }
  if (pathname.startsWith('/api/jira/')) {
    jiraApi.handleJiraApi(req, res, pathname); return;
  }
  if (pathname.startsWith('/api/integrations/')) {
    handleIntegrationsApi(req, res, pathname); return;
  }
  serveStatic(req, res, ROOT);
});

let currentPort = PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const next = currentPort + 1;
    if (next <= PORT + 9) {
      currentPort = next;
      server.listen(currentPort, '127.0.0.1');
    } else {
      logger.error('Все порты заняты, не могу стартовать', { tried: `${PORT}-${PORT + 9}`, hint: 'Освободи порт или задай другой: node server.js 9090' });
      process.exit(1);
    }
  } else {
    throw err;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const actualPort = server.address().port;
  console.log(`LISTENING:${actualPort}`);
  logger.info('Prisma started', { port: actualPort, url: `http://localhost:${actualPort}` });
});

// V22 — `--profile` режим (codebase-04 audit §5 tooling).
// launch.js шлёт SIGUSR2 каждые 30s; сервер пишет heap-snapshot в .profile/.
// PRIZMA_PROFILE=1 выставляется родителем; вне profile-режима hook молчит.
if (process.env.PRIZMA_PROFILE === '1') {
  try {
    const v8 = require('v8');
    const fs = require('fs');
    const path = require('path');
    const profDir = path.join(__dirname, '.profile');
    try { fs.mkdirSync(profDir, { recursive: true }); } catch (_) {}
    let snapSeq = 0;
    process.on('SIGUSR2', () => {
      try {
        snapSeq++;
        const file = path.join(profDir, `heap-snapshot-${snapSeq}.heapsnapshot`);
        v8.writeHeapSnapshot(file);
        logger.info('heap-snapshot written', { file, seq: snapSeq });
      } catch (e) {
        logger.warn('heap-snapshot failed', { err: String(e?.message || e) });
      }
    });
    logger.info('profile mode enabled', { dir: profDir });
  } catch (e) {
    logger.warn('profile mode setup failed', { err: String(e?.message || e) });
  }
}
