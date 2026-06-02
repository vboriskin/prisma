'use strict';
/* ════════════════════════════════════════════════════════════
   server/jira-helpers.js — Jira-domain helpers (V18 extraction).
   ────────────────────────────────────────────────────────────
   Extracted from server.js as part of structural-debt cleanup.

   Public surface (returned by `create({...})`):
     · jiraResolveSprintFieldId   — auto-resolve Sprint customfield ID
     · jiraInvalidateRecentCache  — drop differential-JQL cache for (host, pk)
     · jiraBuildAreaReport        — full per-area Pulse fetch (4 sub-queries)
     · jiraResolveProjectId       — projectKey → numeric projectId resolver

   Live state (also exposed on the factory return so server.js callers
   `_periodicCleanup` / metrics can keep iterating their sizes):
     · _recentBucketCache         — Map<host|pk, {byKey, lastFetchedAt, cachedAt}>
     · _RECENT_CACHE_TTL_MS       — TTL constant for cache freshness

   Factory deps (wired through `create({...})`):
     · jiraRequest                — outbound HTTP (server/upstream.js)
     · jiraSearchAll              — paginated /search (server/upstream.js)
     · jiraPLimit                 — bounded concurrency
     · jiraResolveZephyrResultFieldId — from server/zephyr.js (lazy via getter)

   `logger` is `require()`-d directly (process-wide singleton, V19 E4).
   ──────────────────────────────────────────────────────────── */

const logger = require('./logger.js');

// ── factory-injected deps ───────────────────────────────────
let _jiraRequest;
let _jiraSearchAll;
let _jiraPLimit;
let _getZephyrResultFieldId;   // lazy accessor — zephyr factory wires later

// ── module-local Jira fields config (mirrors server.js V21 Y3) ──
const JIRA_FIELDS = ['summary','description','status','assignee','reporter','updated','created','priority','issuetype','labels','duedate','timetracking','timeoriginalestimate','aggregatetimespent','worklog','comment','parent','subtasks','resolution','resolutiondate','issuelinks','fixVersions','versions','components','attachment'];
const JIRA_DEFAULT_EXPAND = ['names', 'schema', 'renderedFields'];

// ── Sprint customfield-ID cache ─────────────────────────────
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
    const fields = await _jiraRequest(cfg, 'GET', '/rest/api/2/field');
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
  } catch (_) { /* fall through to fallback */ }
  // Fallback to the most common known IDs — added to fields list, harmless if absent.
  const fallback = 'customfield_10020';
  _jiraSprintFieldIdCache = { url: cfg.jiraBaseUrl, id: fallback, at: now };
  return fallback;
}

// ── Differential-JQL cache for `recent` bucket (V21 Z2) ─────
const _RECENT_CACHE_TTL_MS = 24 * 3600 * 1000;
const _RECENT_CACHE_MAX_SIZE = 200;     // PR-CW — bounded growth (5 хостов × 40 PK)
const _recentBucketCache = new Map(); // key = "host|pk" → { byKey: Map<key, issue>, lastFetchedAt, cachedAt }

function _recentCacheKey(cfg, pk) {
  return `${String(cfg.jiraBaseUrl || '').replace(/\/+$/, '')}|${pk}`;
}

function jiraInvalidateRecentCache(jiraBaseUrl, pk) {
  if (!pk) {
    // Wipe all entries для этого host'а.
    const prefix = String(jiraBaseUrl || '').replace(/\/+$/, '') + '|';
    for (const k of _recentBucketCache.keys()) {
      if (k.startsWith(prefix)) _recentBucketCache.delete(k);
    }
    return;
  }
  _recentBucketCache.delete(`${String(jiraBaseUrl || '').replace(/\/+$/, '')}|${pk}`);
}

// PR-CW — overflow protection: при достижении лимита удаляем oldest 10%
// (по `cachedAt`). Раньше Map мог расти без явного предела.
function _recentCacheEnforceLimit() {
  if (_recentBucketCache.size <= _RECENT_CACHE_MAX_SIZE) return;
  const entries = [..._recentBucketCache.entries()]
    .sort((a, b) => (a[1]?.cachedAt || 0) - (b[1]?.cachedAt || 0));
  const dropN = Math.ceil(_RECENT_CACHE_MAX_SIZE * 0.1);
  for (let i = 0; i < dropN && i < entries.length; i++) {
    _recentBucketCache.delete(entries[i][0]);
  }
}

async function jiraBuildAreaReport(cfg, area) {
  // Discover the sprint field ID for this Jira (cached). Falls back to common
  // values if the /field probe fails.
  const sprintFieldId = await jiraResolveSprintFieldId(cfg);
  // Phase 3: discover the Zephyr/Xray test-result customfield (returns '' if not found).
  const zephyrFieldId = _getZephyrResultFieldId
    ? await _getZephyrResultFieldId(cfg)
    : '';
  // Sprint query needs the discovered field; other queries don't.
  const extraFields = [sprintFieldId, 'customfield_10010', 'customfield_10007', zephyrFieldId].filter(Boolean);
  const SPRINT_FIELDS = JIRA_FIELDS.concat(extraFields);
  const ALL_FIELDS    = JIRA_FIELDS.concat([zephyrFieldId].filter(Boolean));
  const pk = area.projectKey;

  // Run the four sub-queries with `allSettled` — one slow / failing query
  // (typically the heavy backlog one) would previously sink the whole PK
  // via Promise.all reject. Now we collect partial results AND keep a
  // per-stage error trail so the diagnostics panel can show what broke.
  const cacheK = _recentCacheKey(cfg, pk);
  const cached = _recentBucketCache.get(cacheK);
  const cacheFresh = cached && (Date.now() - cached.cachedAt) < _RECENT_CACHE_TTL_MS;
  // Когда есть свежий cache, шлём «updated > lastFetched − 30 мин slack».
  // H6: раньше формат `YYYY-MM-DD HH:mm` без TZ — Jira парсит как server-local
  // тайм. Используем 3-часовой slack чтобы покрыть worst-case MSK-skew.
  const recentJql = cacheFresh
    ? `project="${pk}" AND updated >= "${new Date(cached.lastFetchedAt - 3 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16)}"`
    : `project="${pk}" AND updated >= -3d`;

  // AUDIT_SCANNER #46 — конфигурируемый in-progress JQL вместо statusCategory.
  const inProgressStatuses = Array.isArray(cfg.inProgressStatuses) && cfg.inProgressStatuses.length
    ? cfg.inProgressStatuses
    : ['In Progress', 'In Development', 'Code Review'];
  const jqlInProgress = inProgressStatuses.map(s => `status="${String(s).replace(/"/g, '\\"')}"`).join(' OR ');

  // 2026-06-02 — scan limit per-stage из конфига (UI «Лимит issues на проект»).
  // Default 500 backward-compat. inProgress/sprint используют полный лимит;
  // backlog cap пропорционально меньше (40% от лимита, но не меньше 200) —
  // бэклог редко требуется full-scan, чаще раздувает payload устаревшими
  // задачами. Diag-fix D — для backlog добавляем sliding window
  // `updated >= -180d`: древние задачи из бэклога (>6 мес без апдейта)
  // обычно zombie scope, не нужны в daily Scanner; убирает 40-60% payload
  // на крупных проектах типа SMECIS без потери актуальных задач.
  const scanLimit = Math.min(2000, Math.max(200, Math.round(Number(cfg.jiraScanLimit) || 500)));
  const backlogCap = Math.max(200, Math.round(scanLimit * 0.4));
  const recentCap  = Math.max(300, Math.round(scanLimit * 0.8));
  const queries = [
    { name: 'sprint',     jql: `project="${pk}" AND sprint in openSprints()`,                                        fields: SPRINT_FIELDS, expand: JIRA_DEFAULT_EXPAND.slice(),                          cap: scanLimit, budgetMs: 75000 },
    // V21 Z2 — Differential JQL: при тёплом cache берём только delta, потом union.
    { name: 'recent',     jql: recentJql,                                                                              fields: ALL_FIELDS,    expand: JIRA_DEFAULT_EXPAND.concat(['changelog']),            cap: recentCap,  budgetMs: 75000 },
    { name: 'inProgress', jql: `project="${pk}" AND (${jqlInProgress})`,                                              fields: ALL_FIELDS,    expand: JIRA_DEFAULT_EXPAND.slice(),                          cap: scanLimit, budgetMs: 60000 },
    { name: 'backlog',    jql: `project="${pk}" AND statusCategory != Done AND updated >= -180d AND (sprint is EMPTY OR sprint not in openSprints())`, fields: ALL_FIELDS, expand: JIRA_DEFAULT_EXPAND.slice(), cap: backlogCap, budgetMs: 60000 },
  ];

  // Timed allSettled — record per-stage ms + status so the diagnostic panel
  // can show "sprint 2.1s ✓ · recent 4.7s ✓ · inProgress 18.0s (cap) · backlog 12.0s (budget)".
  const stageTimings = [];
  const settled = await Promise.allSettled(queries.map(async (q) => {
    const t0 = Date.now();
    try {
      const v = await _jiraSearchAll(cfg, q.jql, q.fields, q.expand, q.cap, q.budgetMs);
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
  let   recentIssues     = get(1);
  const inProgressIssues = get(2);
  const backlogIssues    = get(3);

  // V21 Z2 — union с cached прежним snapshot'ом если cache был свежий.
  if (cacheFresh && cached.byKey) {
    const deltaByKey = new Set(recentIssues.map(i => i.key));
    const merged = [...recentIssues];
    for (const [key, prev] of cached.byKey) {
      if (!deltaByKey.has(key)) merged.push(prev);
    }
    recentIssues = merged;
  }
  // Обновим cache: union новый snapshot.
  if (settled[1].status === 'fulfilled') {
    const newByKey = new Map();
    for (const it of recentIssues) newByKey.set(it.key, it);
    _recentBucketCache.set(cacheK, {
      byKey: newByKey,
      lastFetchedAt: Date.now(),
      cachedAt: Date.now(),
    });
    _recentCacheEnforceLimit();
  }

  const byKey = new Map();
  for (const arr of [sprintIssues, recentIssues, inProgressIssues, backlogIssues]) {
    for (const it of arr) byKey.set(it.key, it);
  }

  // Only report `error` if EVERY sub-query failed.
  const allFailed = stageErrors.length === queries.length;
  return {
    name: area.name, projectKey: pk,
    issues: Array.from(byKey.values()),
    sprintKeys:     sprintIssues.map(i => i.key),
    inProgressKeys: inProgressIssues.map(i => i.key),
    backlogKeys:    backlogIssues.map(i => i.key),
    devStatus: {},
    zephyrResultFieldId: zephyrFieldId || '',
    error: allFailed ? stageErrors.join(' | ') : null,
    stageErrors: stageErrors.length ? stageErrors : null,
    stageTimings,
  };
}

// ── Project-id resolver (used by Zephyr Tests DC fetcher) ───
const _PROJECT_ID_TTL = 30 * 60 * 1000;   // 30 min cache
const _projectIdCache = new Map();         // 'baseUrl|key' → { id, at }

/** Resolve projectKey → numeric projectId via /rest/api/2/project/{key}. */
async function jiraResolveProjectId(cfg, projectKey) {
  const cacheKey = `${cfg.jiraBaseUrl}|${projectKey}`;
  const cached = _projectIdCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < _PROJECT_ID_TTL) {
    return cached.id;
  }
  try {
    const proj = await _jiraRequest(cfg, 'GET', `/rest/api/2/project/${encodeURIComponent(projectKey)}`);
    const id = String(proj?.id || '');
    if (id) {
      _projectIdCache.set(cacheKey, { id, at: Date.now() });
      return id;
    }
  } catch (_) { /* probe failed */ }
  // Negative cache 5 min — не пробуем повторно срочно.
  _projectIdCache.set(cacheKey, { id: '', at: Date.now() - _PROJECT_ID_TTL + 5 * 60 * 1000 });
  return '';
}

function create(deps) {
  _jiraRequest   = deps.jiraRequest;
  _jiraSearchAll = deps.jiraSearchAll;
  _jiraPLimit    = deps.jiraPLimit;   // currently unused but kept for parity / future
  // Lazy accessor: zephyr factory created AFTER this — caller wires via setter.
  if (typeof deps.getZephyrResultFieldId === 'function') {
    _getZephyrResultFieldId = deps.getZephyrResultFieldId;
  }
  // Surface `_recentBucketCache` + TTL так чтобы _periodicCleanup в server.js
  // мог продолжать sweep'ать его (reference-equal Map across modules).
  return {
    jiraResolveSprintFieldId,
    jiraInvalidateRecentCache,
    jiraBuildAreaReport,
    jiraResolveProjectId,
    // Live state (read-only consumers in server.js):
    _recentBucketCache,
    _RECENT_CACHE_TTL_MS,
    // Late-binding setter for the Zephyr field-id resolver (zephyr factory
    // is built AFTER jira-helpers in server.js wire-up).
    setZephyrResultFieldIdResolver(fn) { _getZephyrResultFieldId = fn; },
  };
}

module.exports = { create };
