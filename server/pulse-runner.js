'use strict';
/* ════════════════════════════════════════════════════════════
   server/pulse-runner.js — Portfolio Pulse orchestrator (V18 extraction).
   ────────────────────────────────────────────────────────────
   Extracted from server.js as part of structural-debt cleanup.

   Public surface (returned by `create({...})`):
     · _runPortfolioPulse        — full Pulse pipeline (Jira + BB + CF + Zephyr
                                   + 11 big-metrics fetchers, async-job-aware)
     · pulseCancelRegister       — register AbortController + cancelled flag
     · pulseCancelGet            — read cancel-state for a jobId
     · pulseCancelMark           — mark a job as cancelled, abort()
     · pulseAssertNotCancelled   — runner-side assert: throw if cancelled

   Live state:
     · _pulseCancelRegistry      — Map<jobId, {ctrl, cancelled}>

   Factory deps (wired through `create({...})`):
     ── Bitbucket fetchers (server/bitbucket.js) ──
     · ppFetchBitbucketActivity      — main BB activity collector
     · ppFetchBitbucketGovernance    — V21 AA: per-repo governance + PR sizes
     · _bbFetchWithRetry             — currently unused inside runner but
                                       kept in factory for future (and parity
                                       with extraction plan).
     ── Confluence fetchers (server/confluence.js) ──
     · ppFetchConfluenceActivity, ppFetchCfAuthorshipVelocity,
       ppFetchCfSpaceAcl, ppFetchRetroClosure, ppFetchCfHealthMetrics,
       ppFetchStaleConfluence
     ── Zephyr fetcher (server/zephyr.js) ──
     · ppFetchZephyrActivity
     ── Jira-helpers (server/jira-helpers.js) ──
     · jiraResolveSprintFieldId, jiraResolveProjectId,
       jiraBuildAreaReport, jiraInvalidateRecentCache
     ── Upstream / Jira HTTP (server/upstream.js) ──
     · jiraRequest, jiraSearchAll, jiraForward, jiraPLimit, _HTTP_CACHE
     ── Server.js–local pp* fetchers (NOT yet extracted) ──
     · ppFetchReopenRate, ppFetchSprintCommitVsDelivery,
       ppFetchStaleBranches, ppFetchHotFiles,
       ppFetchOnboardingHistory, ppFetchDevStatusForIssues,
       _ppMergeAuthorMaps
     ── Auth ──
     · _ppMakeAuthHeader            — currently unused inside runner; kept
                                      in factory for parity.
     ── jira-api ──
     · jiraSanitizeAreas            — fallback for empty body.projectKeys

   `logger` is `require()`-d directly (process-wide singleton, V19 E4).
   ──────────────────────────────────────────────────────────── */

const logger = require('./logger.js');

// ── factory-injected deps ───────────────────────────────────
let _ppFetchBitbucketActivity;
let _ppFetchBitbucketGovernance;
// eslint-disable-next-line no-unused-vars
let _bbFetchWithRetry;

let _ppFetchConfluenceActivity;
let _ppFetchCfAuthorshipVelocity;
let _ppFetchCfSpaceAcl;
let _ppFetchRetroClosure;
let _ppFetchCfHealthMetrics;
let _ppFetchStaleConfluence;

let _ppFetchZephyrActivity;

// eslint-disable-next-line no-unused-vars
let _jiraResolveSprintFieldId;
// eslint-disable-next-line no-unused-vars
let _jiraResolveProjectId;
let _jiraBuildAreaReport;
// eslint-disable-next-line no-unused-vars
let _jiraInvalidateRecentCache;

// eslint-disable-next-line no-unused-vars
let _jiraRequest;
// eslint-disable-next-line no-unused-vars
let _jiraSearchAll;
// eslint-disable-next-line no-unused-vars
let _jiraForward;
let _jiraPLimit;
let _HTTP_CACHE;

// server.js-local pp* fetchers (passed in via factory):
let _ppFetchReopenRate;
let _ppFetchSprintCommitVsDelivery;
let _ppFetchStaleBranches;
let _ppFetchHotFiles;
let _ppFetchOnboardingHistory;
let _ppFetchDevStatusForIssues;
let _ppMergeAuthorMaps;

// eslint-disable-next-line no-unused-vars
let _ppMakeAuthHeader;
let _jiraSanitizeAreas;

// ── Cancel registry ─────────────────────────────────────────
// TECH 17.2 — cancel-registry для активных pulse-job'ов. Когда клиент
// abort'ит fetch на frontend (AbortController), мы хотим прервать и
// server-side BFS/Jira/BB-pipeline, а не позволить ему домолотить и записать
// результат в jobs Map (memory leak + потерянная работа). Pattern: на /start
// регистрируем `{ ctrl: AbortController, cancelled: bool }`, runner читает
// флаг между этапами и кидает specific error. /cancel/:jobId выставляет
// флаг и abort'ит controller — runner пропустит оставшиеся этапы, статус
// перейдёт в 'error' с message='cancelled'.
const _pulseCancelRegistry = new Map(); // jobId → { ctrl: AbortController, cancelled: bool }

function pulseCancelRegister(jobId) {
  const entry = { ctrl: (typeof AbortController !== 'undefined') ? new AbortController() : null, cancelled: false };
  _pulseCancelRegistry.set(jobId, entry);
  // Auto-cleanup через 130 мин (>TTL job'а) чтобы registry не утекало.
  setTimeout(() => { _pulseCancelRegistry.delete(jobId); }, 130 * 60 * 1000).unref?.();
  return entry;
}

function pulseCancelGet(jobId)  { return _pulseCancelRegistry.get(jobId) || null; }

function pulseCancelMark(jobId) {
  const e = _pulseCancelRegistry.get(jobId);
  if (!e) return false;
  e.cancelled = true;
  try { e.ctrl?.abort(); } catch (_) {}
  return true;
}

/** Helper для runner'а: бросить ошибку если job был cancel'нут. */
function pulseAssertNotCancelled(jobId) {
  const e = _pulseCancelRegistry.get(jobId);
  if (e && e.cancelled) {
    throw Object.assign(new Error('Pulse job cancelled by client'), { _cancelled: true });
  }
}

/**
 * V18 P7 — выделено из inline /api/integrations/portfolio-pulse handler'а.
 * Возвращает full Pulse response { reports, bitbucket, confluence, ... }.
 * При ошибках валидации throws Error с `.statusCode = 400`.
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
    const fromAreas = (typeof _jiraSanitizeAreas === 'function' ? _jiraSanitizeAreas(cfg.areas) : []).map(a => a.projectKey);
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
  // QD6: cache invalidation на старте pulse'а. HTTP-кэш 5 мин сохраняет
  // bodies прошлого pulse'а, но cutoffTs пересчитывается заново — события
  // могут «пропадать» при повторных запусках pulse в окне TTL.
  if (cfg?.pulseFreshCache !== false) {
    try { _HTTP_CACHE && _HTTP_CACHE.clear(); } catch (_) { /* ignore */ }
  }
  const log = [`[pulse] start: ${pks.length} PKs, timeout/PK ${PER_PK_TIMEOUT_MS}ms`];
  setPhase(`fetch-jira (${pks.length} PKs)`);

  const withTimeout = (label, promise, ms) => Promise.race([
    promise.then(v => ({ ok: true, value: v })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: ms }), ms)),
  ]).then(r => { if (!r.ok) log.push(`[pulse] ${label} TIMEOUT after ${r.timeout}ms`); return r; });

  const reportsPromise = _jiraPLimit(2, pks.map(pk => async () => {
    const pkStart = Date.now();
    const area    = { name: pk, projectKey: pk };
    const r = await withTimeout(`pk:${pk}`, _jiraBuildAreaReport(cfg, area), PER_PK_TIMEOUT_MS);
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
    _ppFetchBitbucketActivity(cfg, tls, cutoffTs, cutoffIso), PER_PK_TIMEOUT_MS);
  const ppCfEmployees = Array.isArray(body?.employees) ? body.employees : [];
  const cfPromise = withTimeout('confluence',
    _ppFetchConfluenceActivity(cfg, tls, cutoffTs, { cqlCutoffTs, employees: ppCfEmployees }), PER_PK_TIMEOUT_MS);
  // V20 S9 — Real Zephyr fetch (parallel with BB/CF).
  const zephyrPromise = withTimeout('zephyr',
    _ppFetchZephyrActivity(cfg, tls, cutoffTs), PER_PK_TIMEOUT_MS);
  // V21 Y4 (audit-09 §G/§K) — big metrics параллельно с пацклой остальных.
  const reopenPromise        = withTimeout('reopen-rate',  _ppFetchReopenRate(cfg, pks),                       PER_PK_TIMEOUT_MS);
  // V21 sprint-commit-fix: 6 PK × 6 sprints + Jira 429-retry = >90s wallclock.
  const sprintCommitPromise  = withTimeout('sprint-commit', _ppFetchSprintCommitVsDelivery(cfg, pks),          PER_PK_TIMEOUT_MS * 2);
  const staleBranchesPromise = withTimeout('stale-branches', _ppFetchStaleBranches(cfg, tls),                  PER_PK_TIMEOUT_MS);
  const staleCfPromise       = withTimeout('stale-cf',     _ppFetchStaleConfluence(cfg, tls),                  PER_PK_TIMEOUT_MS);
  // V21 Z3 — Hot-files + Bus-factor.
  const hotFilesEnabled = process.env.ENABLE_HOT_FILES !== '0';
  const hotFilesPromise = hotFilesEnabled
    ? withTimeout('hot-files', _ppFetchHotFiles(cfg, tls), PER_PK_TIMEOUT_MS * 2)
    : Promise.resolve({ ok: true, value: { configured: false, hotFiles: [], busFactor: [], tried: [{ type: 'hot-files', skipped: true }] } });
  // V21 Z6 — CF health metrics (orphan/DoD/cadence/post-mortem).
  const cfHealthPromise = withTimeout('cf-health', _ppFetchCfHealthMetrics(cfg, tls), PER_PK_TIMEOUT_MS);
  // V21 AA — BB governance + PR-size distribution.
  const bbGovEnabled = process.env.ENABLE_BB_GOV !== '0';
  const bbGovPromise = bbGovEnabled
    ? withTimeout('bb-gov', _ppFetchBitbucketGovernance(cfg, tls), PER_PK_TIMEOUT_MS)
    : Promise.resolve({ ok: true, value: { configured: false, perRepo: {}, prSizes: [], tried: [{ type: 'bb-gov', skipped: true }] } });
  // V21 AQ — Retro closure (CF retro pages).
  const retroPromise = withTimeout('retro-closure', _ppFetchRetroClosure(cfg, tls), PER_PK_TIMEOUT_MS);
  // V21 AR — CF space-level ACL audit.
  const cfAclPromise = withTimeout('cf-space-acl', _ppFetchCfSpaceAcl(cfg, tls), PER_PK_TIMEOUT_MS);
  // V21 AS — Onboarding precise (BB historical commit scan).
  const onboardEnabled = process.env.ENABLE_ONBOARD_HISTORY !== '0';
  const onboardPromise = onboardEnabled
    ? withTimeout('onboard-history', _ppFetchOnboardingHistory(cfg, tls), PER_PK_TIMEOUT_MS * 2)
    : Promise.resolve({ ok: true, value: { configured: false, perAuthor: {}, recentlyJoined: [], tried: [{ type: 'onboard', skipped: true }] } });
  // V21 AZ — CF authorship velocity.
  const cfVelocityPromise = withTimeout('cf-velocity', _ppFetchCfAuthorshipVelocity(cfg, tls), PER_PK_TIMEOUT_MS);

  const [reports, bbR, cfR, zR, reopenR, sprintCommitR, staleBR, staleCfR, hotR, cfHealthR, bbGovR, retroR, cfAclR, onboardR, cfVelR] = await Promise.all([
    reportsPromise, bbPromise, cfPromise, zephyrPromise,
    reopenPromise, sprintCommitPromise, staleBranchesPromise, staleCfPromise,
    hotFilesPromise, cfHealthPromise, bbGovPromise, retroPromise, cfAclPromise, onboardPromise, cfVelocityPromise,
  ]);
  setPhase('fetch-bb-cf-done');
  const bitbucketRepoWalk = bbR.ok ? bbR.value : { authors: {}, error: `timeout ${PER_PK_TIMEOUT_MS}ms` };
  const confluence = cfR.ok ? cfR.value : { authors: {}, error: `timeout ${PER_PK_TIMEOUT_MS}ms` };
  const zephyr = zR.ok ? zR.value : { authors: {}, error: `timeout ${PER_PK_TIMEOUT_MS}ms`, configured: false };

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
    _ppFetchDevStatusForIssues(cfg, tls, cutoffTs, hotIssues), PER_PK_TIMEOUT_MS).catch(()=>({ ok:false }));
  const devStatus = dsR && dsR.ok ? dsR.value : { authors: {}, configured: false, tried: [], scanned: 0 };
  // V18 P8 — раздельные bucket'ы для repo-walk и dev-status authors.
  const _devStatusAuthorsFiltered = {};
  for (const [k, v] of Object.entries(devStatus.authors || {})) {
    const hasEmail = !!String(v?.email || '').trim();
    const hasLoginishKey = /^[a-z0-9._-]+$/i.test(String(k).trim());
    if (hasEmail || hasLoginishKey) _devStatusAuthorsFiltered[k] = v;
  }
  const mergedAuthors = _ppMergeAuthorMaps(bitbucketRepoWalk.authors || {}, _devStatusAuthorsFiltered);
  const bitbucket = {
    authors:           mergedAuthors,                                 // legacy
    repoAuthors:       bitbucketRepoWalk.authors || {},               // V18 P8 — pure repo-walk
    devStatusAuthors:  _devStatusAuthorsFiltered,                     // V18 P8 — pure dev-info
    configured: bitbucketRepoWalk.configured,
    tried:      [...(bitbucketRepoWalk.tried || []), ...(devStatus.tried || [])],
    repos:      bitbucketRepoWalk.repos || 0,
    prActivitiesScanned: bitbucketRepoWalk.prActivitiesScanned || 0,
    devStatus:  { scanned: devStatus.scanned || 0, prs: devStatus.prs || 0, commits: devStatus.commits || 0, configured: devStatus.configured, tried: devStatus.tried || [], droppedOutOfAllowlist: devStatus.droppedOutOfAllowlist || 0, droppedSamples: devStatus.droppedSamples || [] },
    error:      bitbucketRepoWalk.error || null,
  };
  log.push(`[pulse] dev-status: scanned ${devStatus.scanned||0} dev-info calls, found ${devStatus.prs||0} PR · ${devStatus.commits||0} commits`);
  log.push(`[pulse] done in ${Date.now() - t0}ms · ${reports.filter(r => !r.error).length}/${reports.length} PKs ok`);
  setPhase('finalize');

  const zephyrResultFieldId = reports.find(r => r.zephyrResultFieldId)?.zephyrResultFieldId || '';
  // V21 Y4/Z3 — big metrics envelope.
  const bigMetrics = {
    reopenRate:    reopenR.ok        ? reopenR.value        : { configured: false, byPk: {}, tried: [], _timeout: true },
    sprintCommit:  sprintCommitR.ok  ? sprintCommitR.value  : { configured: false, byPk: {}, tried: [], _timeout: true },
    staleBranches: staleBR.ok        ? staleBR.value        : { configured: false, byRepo: {}, tried: [], _timeout: true },
    staleConfluence: staleCfR.ok     ? staleCfR.value       : { configured: false, bySpace: {}, tried: [], _timeout: true },
    hotFiles:      hotR.ok           ? hotR.value           : { configured: false, hotFiles: [], busFactor: [], tried: [], _timeout: true },
    cfHealth:      cfHealthR.ok      ? cfHealthR.value      : { configured: false, bySpace: {}, tried: [], _timeout: true },
    bbGovernance:  bbGovR.ok         ? bbGovR.value         : { configured: false, perRepo: {}, prSizes: [], tried: [], _timeout: true },
    retroClosure:  retroR.ok         ? retroR.value         : { configured: false, perPage: [], summary: { totalPages: 0, totalItems: 0, closed: 0 }, tried: [], _timeout: true },
    cfSpaceAcl:    cfAclR.ok         ? cfAclR.value         : { configured: false, bySpace: {}, tried: [], _timeout: true },
    onboarding:    onboardR.ok       ? onboardR.value       : { configured: false, perAuthor: {}, recentlyJoined: [], tried: [], _timeout: true },
    cfVelocity:    cfVelR.ok         ? cfVelR.value         : { configured: false, perAuthor: {}, tried: [], _timeout: true },
  };
  log.push(`[pulse] bigMetrics: reopen=${Object.keys(bigMetrics.reopenRate.byPk||{}).length}pk · sprint-commit=${Object.keys(bigMetrics.sprintCommit.byPk||{}).length}pk · stale-branches=${Object.keys(bigMetrics.staleBranches.byRepo||{}).length}repo · stale-cf=${Object.keys(bigMetrics.staleConfluence.bySpace||{}).length}sp · hot-files=${(bigMetrics.hotFiles.hotFiles||[]).length} · bus-factor=${(bigMetrics.hotFiles.busFactor||[]).length}`);

  return {
    reports,
    fetchedAt:   new Date().toISOString(),
    projectKeys: pks,
    jiraBaseUrl: String(cfg.jiraBaseUrl || '').replace(/\/+$/, ''),
    zephyrResultFieldId,
    bitbucket,
    confluence,
    zephyr,
    bigMetrics,
    diagnostics: {
      totalMs:  Date.now() - t0,
      perPk:    reports.map(r => ({ pk: r.projectKey, ms: r._ms || 0, ok: !r.error, error: r.error || null, issues: (r.issues || []).length })),
      log,
    },
  };
}

function create(deps) {
  // BB
  _ppFetchBitbucketActivity   = deps.ppFetchBitbucketActivity;
  _ppFetchBitbucketGovernance = deps.ppFetchBitbucketGovernance;
  _bbFetchWithRetry           = deps._bbFetchWithRetry;
  // CF
  _ppFetchConfluenceActivity     = deps.ppFetchConfluenceActivity;
  _ppFetchCfAuthorshipVelocity   = deps.ppFetchCfAuthorshipVelocity;
  _ppFetchCfSpaceAcl             = deps.ppFetchCfSpaceAcl;
  _ppFetchRetroClosure           = deps.ppFetchRetroClosure;
  _ppFetchCfHealthMetrics        = deps.ppFetchCfHealthMetrics;
  _ppFetchStaleConfluence        = deps.ppFetchStaleConfluence;
  // Zephyr
  _ppFetchZephyrActivity         = deps.ppFetchZephyrActivity;
  // Jira-helpers
  _jiraResolveSprintFieldId      = deps.jiraResolveSprintFieldId;
  _jiraResolveProjectId          = deps.jiraResolveProjectId;
  _jiraBuildAreaReport           = deps.jiraBuildAreaReport;
  _jiraInvalidateRecentCache     = deps.jiraInvalidateRecentCache;
  // Upstream
  _jiraRequest    = deps.jiraRequest;
  _jiraSearchAll  = deps.jiraSearchAll;
  _jiraForward    = deps.jiraForward;
  _jiraPLimit     = deps.jiraPLimit;
  _HTTP_CACHE     = deps._HTTP_CACHE;
  // server.js-local pp* fetchers
  _ppFetchReopenRate              = deps.ppFetchReopenRate;
  _ppFetchSprintCommitVsDelivery  = deps.ppFetchSprintCommitVsDelivery;
  _ppFetchStaleBranches           = deps.ppFetchStaleBranches;
  _ppFetchHotFiles                = deps.ppFetchHotFiles;
  _ppFetchOnboardingHistory       = deps.ppFetchOnboardingHistory;
  _ppFetchDevStatusForIssues      = deps.ppFetchDevStatusForIssues;
  _ppMergeAuthorMaps              = deps._ppMergeAuthorMaps;
  // Auth + jira-api
  _ppMakeAuthHeader = deps._ppMakeAuthHeader;
  _jiraSanitizeAreas = deps.jiraSanitizeAreas;
  return {
    _runPortfolioPulse,
    pulseCancelRegister,
    pulseCancelGet,
    pulseCancelMark,
    pulseAssertNotCancelled,
    // Live state — surfaced for parity / future diagnostics.
    _pulseCancelRegistry,
  };
}

module.exports = { create };
