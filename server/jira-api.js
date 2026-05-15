'use strict';
/* ============================================================
   server/jira-api.js — V18 extraction (from server.js)

   Jira API surface (config + report builder + main handler).
   Low-level helpers (jiraForward, jiraSearchAll, jiraRequest,
   jiraPLimit, jiraBuildAreaReport, jiraInvalidateRecentCache,
   _breaker / _HTTP_CACHE / _ssrf, etc.) remain in server.js for
   now — they are passed in via the factory.

   Public surface (returned by `create({...})`):
     • handleJiraApi(req, res, pathname)  — /api/jira/* router
     • jiraReadConfig()                   — read jira_config.json
     • jiraWriteConfig(patch)             — merge + write
     • jiraSanitizeAreas(areas)           — areas[] sanitizer
     • jiraSanitizeConfig(cfg)            — strips secret tokens
     • jiraBuildReport(cfg)               — multi-area report

   Usage in server.js:

       const jiraApi = require('./server/jira-api.js').create({
         ROOT, writeJson, readBody, isSameOriginRequest,
         jiraSearchAll, jiraRequest, jiraBuildAreaReport,
         jiraInvalidateRecentCache,
       });
       // backward-compat aliases for in-file callsites:
       const { jiraReadConfig, jiraWriteConfig,
               jiraSanitizeConfig, jiraSanitizeAreas } = jiraApi;
       // route:
       if (pathname.startsWith('/api/jira/')) {
         jiraApi.handleJiraApi(req, res, pathname); return;
       }
   ============================================================ */

const path = require('path');
const fs   = require('fs');
const logger = require('./logger.js');

// ── factory-injected deps (set by create({...})) ────────────
let _ROOT;
let _writeJson;
let _readBody;
let _isSameOriginRequest;
let _jiraSearchAll;            // reserved for future use; kept for parity
let _jiraRequest;
let _jiraBuildAreaReport;
let _jiraInvalidateRecentCache; // reserved for future use; kept for parity
let _jiraPLimit;

let JIRA_CONFIG_FILE;          // computed from _ROOT in create()

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
  // V21 Jenkins — CI integration. Pilot: SBOF Платформа использует
  // Sber DREAM Jenkins shard `sbof.ci.jenkins.sberbank.ru/job/sbof`.
  // Folder-key обычно совпадает с верхним path-сегментом (`sbof`).
  // Prod-deploy на отдельном Jenkins-инстансе вне доступа Призмы;
  // мы тянем CI-merges-to-main как proxy для «команда работает».
  jenkinsBaseUrl: '', jenkinsToken: '',
  jenkinsFolder: '',               // верхний folder для SBOF-команды (e.g. "sbof")
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
  // AUDIT_SCANNER #46 — конфигурируемый список «in-progress» статусов вместо
  // statusCategory = "In Progress". Корп-Jira переименовывают категории
  // («In progress» / «In Development» / «Code Review» — все в категории
  // In Progress, но категория иногда фильтруется по локали и пропускает
  // часть). Явный список status="X" OR status="Y" — детерминирован.
  inProgressStatuses: ['In Progress', 'In Development', 'Code Review'],
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
    jenkinsBaseUrl:      cfg.jenkinsBaseUrl||'',
    jenkinsFolder:       cfg.jenkinsFolder||'',
    activityWindowHours: Number.isFinite(+cfg.activityWindowHours) ? Math.min(168, Math.max(1, +cfg.activityWindowHours)) : 72,
    allowInsecureTls:    !!cfg.allowInsecureTls,
    sinceDate:           cfg.sinceDate || '2025-01-01',
    staleDays:           cfg.staleDays??3,
    noMovementDays:      cfg.noMovementDays??2,
    hasJiraToken:        !!cfg.jiraToken,
    hasSigmaJiraToken:   !!cfg.sigmaJiraToken,
    hasBitbucketToken:   !!cfg.bitbucketToken,
    hasConfluenceToken:  !!cfg.confluenceToken,
    hasJenkinsToken:     !!cfg.jenkinsToken,
  };
}

async function jiraBuildReport(cfg) {
  // Resolve project keys: prefer unified `jiraProjectKeys`, fall back to legacy `areas`
  let areas = jiraSanitizeAreas(cfg.areas);
  const keys = String(cfg.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean);
  if (keys.length) areas = keys.map(k => ({ name: k, projectKey: k }));
  if (!cfg.jiraBaseUrl||!cfg.jiraToken) throw Object.assign(new Error('Jira URL или токен не заданы'),{status:400});
  if (!areas.length) throw Object.assign(new Error('Не задано ни одного пространства (jiraProjectKeys)'),{status:400});
  const staleDays=Number(cfg.staleDays)||3, noMovementDays=Number(cfg.noMovementDays)||2;
  const areaReports = await _jiraPLimit(2, areas.map(a=>()=>_jiraBuildAreaReport(cfg,a)));
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
    // QA A16.5 — CSRF guard для мутирующих методов. GET остаётся открытым
    // (только sanitized booleans/URL). Verify/report — write-effect минимальный
    // (RPC к Jira с уже сохранённым токеном), но всё равно блокируем
    // cross-origin триггер.
    if (req.method === 'POST' && !_isSameOriginRequest(req)) {
      try { logger.warn?.('csrf.blocked', { path: pathname, origin: req.headers.origin || '', referer: req.headers.referer || '', host: req.headers.host || '' }); } catch (_) {}
      return _writeJson(res, 403, { error: 'Cross-origin POST запрещён' });
    }
    if (pathname==='/api/jira/config' && req.method==='GET') {
      return _writeJson(res, 200, jiraSanitizeConfig(jiraReadConfig()));
    }
    if (pathname==='/api/jira/config' && req.method==='POST') {
      const raw = await _readBody(req, 512*1024);
      const body = raw ? JSON.parse(raw) : {};
      const patch = {};
      // V17.2 I2c — `confluenceSpaceKeys` добавлен в whitelist string-полей.
      // V21 — добавлены jenkinsBaseUrl + jenkinsFolder.
      for (const k of ['jiraBaseUrl', 'jiraProjectKeys', 'sigmaJiraBaseUrl', 'sigmaGoalEpicKeys', 'bitbucketBaseUrl', 'bitbucketProjectKeys', 'confluenceBaseUrl', 'confluenceSpaceKeys', 'jenkinsBaseUrl', 'jenkinsFolder']) {
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
      if (typeof body.jenkinsToken==='string'&&body.jenkinsToken) patch.jenkinsToken=body.jenkinsToken;
      const next = jiraWriteConfig(patch);
      return _writeJson(res, 200, jiraSanitizeConfig(next));
    }
    if (pathname==='/api/jira/verify' && req.method==='POST') {
      const cfg=jiraReadConfig();
      if (!cfg.jiraBaseUrl||!cfg.jiraToken) return _writeJson(res,400,{ok:false,error:'Нет jiraBaseUrl или токена'});
      const me = await _jiraRequest(cfg,'GET','/rest/api/2/myself',null);
      return _writeJson(res,200,{ok:true,who:me.displayName||me.name||'?'});
    }
    if (pathname==='/api/jira/report' && req.method==='POST') {
      const cfg=jiraReadConfig();
      const report = await jiraBuildReport(cfg);
      return _writeJson(res, 200, report);
    }
    _writeJson(res, 404, { error: 'Неизвестный Jira API метод' });
  } catch(e) {
    const status = (e.status&&e.status>=400&&e.status<600)?e.status:500;
    _writeJson(res, status, { error: e.message||String(e) });
  }
}

function create({
  ROOT,
  writeJson,
  readBody,
  isSameOriginRequest,
  jiraSearchAll,
  jiraRequest,
  jiraBuildAreaReport,
  jiraInvalidateRecentCache,
  jiraPLimit,
}) {
  _ROOT = ROOT;
  _writeJson = writeJson;
  _readBody = readBody;
  _isSameOriginRequest = isSameOriginRequest;
  _jiraSearchAll = jiraSearchAll;
  _jiraRequest = jiraRequest;
  _jiraBuildAreaReport = jiraBuildAreaReport;
  _jiraInvalidateRecentCache = jiraInvalidateRecentCache;
  // jiraPLimit lives in server.js (low-level helper). If caller forgot
  // to pass it, fall back to a serial executor so the module still works
  // for unit-smoke (single-area reports). Real prod always wires it in.
  _jiraPLimit = typeof jiraPLimit === 'function'
    ? jiraPLimit
    : async (_concurrency, tasks) => {
      const out = [];
      for (const t of tasks) out.push(await t());
      return out;
    };
  JIRA_CONFIG_FILE = path.join(_ROOT, 'jira_config.json');
  return {
    handleJiraApi,
    jiraReadConfig,
    jiraWriteConfig,
    jiraBuildReport,
    jiraSanitizeConfig,
    jiraSanitizeAreas,
  };
}

module.exports = {
  create,
  // Re-exported for tests that want to inspect the default config shape
  // without instantiating the module.
  _internal: { JIRA_DEFAULT_CONFIG },
};
