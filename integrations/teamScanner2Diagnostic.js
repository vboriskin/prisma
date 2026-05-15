'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — DIAGNOSTIC EXPORT (V20 S2)

   User finding (4 piloting тимлидов):
   «нет артефактов из BB / Conf — почему? Понять без обращения
    к разработчику невозможно».

   Решение — кнопка «Диагностика» в topbar → modal с 5+ секциями
   + 2-button JSON export (B3 consent flow):
     · 📋 Безопасный экспорт — scrubbed по умолчанию
     · ⚠️ Полный экспорт      — с disclaimer-модалкой + audit log

   Scrub contract (docs/integrations/auth-and-secrets.md):
     · tokens         → Utils.redactSecretsInText (Bearer, Authorization, …)
     · email          → Utils.maskEmail (i***@sber.ru)
     · accountId      → Utils.hashAccountId (h:7c3a91, per-export salt)
     · summary/title  → Utils.truncateSummary (30 chars)
     · description    → omitted entirely
     · raw URLs       → preserved (identify by ID, not content)

   Single source of truth: prepareDiagnosticExport(state, mode).
   Все consumers (UI download, "copy to clipboard" в будущем,
   contract-test) идут через эту функцию — гарантирует scrub-инвариант.

   Audit log:
     localStorage['q2_diag_export_log'] = JSON.stringify([
       { ts: 1714668800000, mode: 'safe' | 'raw', sizeBytes: 4321, ... },
       ... (last 50)
     ])
   ============================================================ */

import { Utils } from '../utils.js';
import { loadSettingsRaw } from './integrationsStore.js';
import { loadHistory, diagnostics as historyDiag } from './teamScanner2History.js';
import { EmployeeFactory } from '../rowFactory.js';
// V20 S8 #15 — single source of truth для классификации.
import { classifyPerson } from './teamScanner2Classifier.js';
// V20 S3.1 — re-use существующих verify-endpoints для probe matrix.
import { verifyJira, verifyBitbucket, verifyConfluence } from './integrationsSync.js';

const AUDIT_KEY = 'q2_diag_export_log';
const AUDIT_MAX_ENTRIES = 50;
const SCHEMA_VERSION = 1;

/**
 * Собрать diagnostic state из orchestrator'а + model'и + storage'а.
 * Чистая функция — никаких side-effects, никаких fetch'ей.
 *
 * @param {object} ctx — orchestrator state:
 *   { model, prevSnapshot, jobId, cacheAgeMs, fetchLatencyMs?, rawDiag? }
 * @returns {object} structured diagnostic state (UI читает напрямую)
 */
export function gatherDiagnosticState(ctx = {}) {
  const m = ctx.model || null;
  const settings = _safeLoadSettings();
  const projectKeys = (m?.projectKeys) || [];

  // 2026-05-11 — Robustness fix: каждая секция оборачивается в _safeStep чтобы
  // partial failure (TypeError в одной ветке) не зануляло весь export.
  // Раньше: TypeError в jenkins-attribution → throw → весь return объект
  // не строится → renderer падает или пишет null поверх state.
  // Теперь: каждая секция возвращает fallback с error-field; export не теряется.
  const _safeStep = (label, fn, fallback) => {
    try { return fn(); }
    catch (err) {
      try {
        const logger = (typeof console !== 'undefined' && console.warn)
          ? console : null;
        logger?.warn?.('[diag.gather_partial_fail]', { step: label, err: err?.message || String(err) });
      } catch (_) { /* ignore */ }
      // Включаем поле _err в fallback для post-mortem диагностики экспорта.
      if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
        return { ...fallback, _err: String(err?.message || err) };
      }
      return fallback;
    }
  };

  // ── 1. Header / environment ─────────────────────────────
  const header = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt:   new Date().toISOString(),
    appBuild:      _getAppBuild(),
    userAgent:     (typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 200) : ''),
    locale:        (typeof navigator !== 'undefined' ? navigator.language : ''),
    tzOffsetMin:   (new Date()).getTimezoneOffset(),
    pageUrl:       (typeof location !== 'undefined' ? String(location.pathname) : ''),
  };

  // ── 2. Configuration snapshot ──────────────────────────
  const config = {
    projectKeys: projectKeys.slice(),
    spaceKeys:   _splitCsv(settings.confluenceSpaceKeys),
    bbProjectKeys: _splitCsv(settings.bitbucketProjectKeys),
    sigmaGoalEpicKeys: _splitCsv(settings.sigmaGoalEpicKeys),
    activityWindowHours: Number(settings.activityWindowHours) || 72,
    sinceDate:   settings.sinceDate || '',
    allowInsecureTls: !!settings.allowInsecureTls,
    // Token presence (boolean) — token VALUE никогда не выходит за пределы
    // localStorage. Безопасно показывать «настроен ли токен».
    hasJiraToken:       !!settings.jiraToken,
    hasSigmaJiraToken:  !!settings.sigmaJiraToken,
    hasBitbucketToken:  !!settings.bitbucketToken,
    hasConfluenceToken: !!settings.confluenceToken,
    jiraBaseUrl:        settings.jiraBaseUrl || '',
    bitbucketBaseUrl:   settings.bitbucketBaseUrl || '',
    confluenceBaseUrl:  settings.confluenceBaseUrl || '',
  };

  // ── 3. Connection / fetch state ────────────────────────
  // Если model есть — fetch уже отрабатывал, latency / cache можно показать.
  // Если нет — diagnostic открыт ДО первого fetch (lazy mode), показываем
  // только config + identity-coverage без runtime fetch info.
  // V20 S7 B11 + V20 S8 #13 — jobId expiration. Server-side TTL = 120 мин.
  // Раньше было 30 мин — пилот в diag раз в 2 недели всегда видел протух.
  const JOB_TTL_MS = 120 * 60 * 1000;
  const cacheAgeMsNum = Number.isFinite(ctx.cacheAgeMs) ? ctx.cacheAgeMs : null;
  const jobExpiresInMs = (ctx.jobId && cacheAgeMsNum != null) ? Math.max(0, JOB_TTL_MS - cacheAgeMsNum) : null;
  const connection = {
    fetchPerformed: !!m,
    fetchedAt:      m?.fetchedAt || null,
    cacheAgeMs:     cacheAgeMsNum,
    fetchLatencyMs: Number.isFinite(ctx.fetchLatencyMs) ? ctx.fetchLatencyMs : null,
    jobId:          ctx.jobId ? String(ctx.jobId).slice(0, 32) : null,
    jobExpiresInMs,
    jobExpired:     jobExpiresInMs != null && jobExpiresInMs <= 0,
    perPkErrors:    (m?.errors || []).map(e => ({
      projectKey: String(e.projectKey || ''),
      // redactSecretsInText на случай если в ошибке утёк токен из URL.
      error: Utils.redactSecretsInText(e.error || '', 200),
    })),
  };

  // ── 4. Per-source artifact counts ──────────────────────
  // Покажем СЫРЫЕ counts перед классификацией — отвечает на главный
  // вопрос «BB вернул 0 коммутов или 0 после identity-фильтрации?».
  // 2026-05-11 — _gatherSourceCounts получает settings для fallback'а
  // zephyrConfigured (если rawDiag null — берём из settings).
  const sources = _safeStep('sources',
    () => _gatherSourceCounts(m, ctx.rawDiag, settings),
    { jira: null, bitbucket: null, confluence: null, zephyr: null });

  // ── 5. Identity coverage ───────────────────────────────
  // Сколько % сотрудников имеют заполнен email / jiraAccountId /
  // bitbucketLogin / confluenceAccountId. Низкое coverage = главная
  // причина «нет данных» (V17.2 I1c identity-deterministic attribution).
  //
  // V20 S4 fix — coverage считается через lookup в state.employees,
  // НЕ из p.bitbucketLogin (которого на participants не существует).
  // Раньше coverage по bb/cf всегда был 0% — баг в S2, нашли пилотом.
  const identity = _safeStep('identity',
    () => _gatherIdentityCoverage(m, ctx.employees || []),
    { teamSize: 0, coverage: {} });

  // ── 6. Threshold + window snapshot ─────────────────────
  const thresholds = _safeStep('thresholds',
    () => _gatherThresholds(m),
    { defaultDwell: { codeReview: 8, qa: 16, inProgress: 48, todo: 72, default: 24 }, perTeam: null });

  // ── 7. Snapshot delta vs yesterday ─────────────────────
  // V20 S7 A6 — EMA + WoW + Z-score в diagnostic state. Помогают тимлиду
  // увидеть «устойчивые тренды» вместо daily noise.
  const snapshot = _safeStep('snapshot', () => {
    const histArr = (typeof loadHistory === 'function') ? loadHistory(projectKeys, 30) : [];
    const stopSeries     = histArr.map(h => h?.counts?.stop || 0);
    const movingSeries   = histArr.map(h => h?.counts?.moving || 0);
    const progressSeries = histArr.map(h => h?.sprintGoal?.aggregateProgress || 0);
    return {
      prev: ctx.prevSnapshot ? {
        ts:      ctx.prevSnapshot.ts,
        ageHours: ctx.prevSnapshot.ts ? Math.round((Date.now() - ctx.prevSnapshot.ts) / 3600000) : null,
        counts:  ctx.prevSnapshot.counts || {},
      } : null,
      current: m ? {
        counts: _countsFromModel(m),
        teamSize: (m.participants || []).length,
      } : null,
      history: (typeof historyDiag === 'function') ? historyDiag(projectKeys) : null,
      // V20 S7 A6 — trend signals (EMA, WoW, anomalies).
      trends: {
        stopEma:    _emaWoW(stopSeries),
        movingEma:  _emaWoW(movingSeries),
        progressEma: _emaWoW(progressSeries),
        stopAnomaly:    _zScore(stopSeries),
        movingAnomaly:  _zScore(movingSeries),
      },
    };
  }, { prev: null, current: null, history: null, trends: {} });

  // ── 8. Pulse model summary (counts only, no PII) ───────
  const modelSummary = _safeStep('modelSummary', () => m ? {
    participantsCount: (m.participants || []).length,
    activeSprintsCount: (m.summary?.activeSprints || []).length,
    spaceKeys: Object.keys(m.spaces || {}),
    risks: {
      totalOrphans:     m.scannerV2?.risks?.totalOrphans     || 0,
      totalOutOfSprint: m.scannerV2?.risks?.totalOutOfSprint || 0,
      outOfSprintRatio: m.scannerV2?.risks?.outOfSprintRatio || 0,
      // PR-CJ — две разные метрики, не сравнимы напрямую:
      // - totalOrphans: задачи без assignee (включая бэклог).
      // - totalOutOfSprint / Ratio: timeline-events участников, чья задача
      //   не в активном спринте (basis = unique keys, S6.2.3).
      _help: 'totalOrphans считает unassigned issues (включая бэклог). totalOutOfSprint — timeline events участников по задачам вне активного спринта. Не сравнивайте напрямую.',
    },
    sprintGoal: {
      aggregateTotal:    m.scannerV2?.sprintGoal?.aggregateTotal    || 0,
      aggregateProgress: m.scannerV2?.sprintGoal?.aggregateProgress || 0,
      aggregatePace:     m.scannerV2?.sprintGoal?.aggregatePace     || 'no-data',
      sprintsCount:      (m.scannerV2?.sprintGoal?.sprints || []).length,
    },
  } : null, null);

  // ── 9. TZ skew (V20 S3.3) ──────────────────────────────
  const tzSkew = _safeStep('tzSkew', () => computeTzSkew(m), { available: false });

  // ── 10. Service accounts filtered out (V20 S4) ────────
  const botsFilteredOut = _safeStep('botsFilteredOut', () => m?.botsFilteredOut || [], []);

  // ── 11. Per-employee BB/CF attribution details ─────────
  // Помогает диагностировать «20 коммитов в сводной, но только 1 человек
  // с меткой»: показывает для каждого сотрудника источник матча и counts.
  const bbCfAttribution = _safeStep('bbCfAttribution',
    () => _gatherBbCfAttribution(m, ctx.employees || []),
    null);

  // v22 — surface rawDiag целиком на top-level state, чтобы renderer мог
  // показать tried-summary chips (cfTriedSummary / bbTriedSummary) и блок
  // «RAW counts» в UI диагностики.
  // 2026-05-11 — раньше rawDiag мутировался (statusHistogram присваивался
  // прямо на input.bbTriedSummary), что:
  //  · ломало повторные вызовы (frozen object → throw)
  //  · сайд-эффект на caller'е (this._lastRawDiag меняется)
  // Теперь — shallow-clone tried-summary'ев перед добавлением histogram'а.
  let rawDiag = ctx.rawDiag || null;
  let bbHist = { ok: 0, redirect: 0, auth: 0, throttle: 0, network: 0, server_err: 0, client_err: 0, unknown: 0 };
  let cfHist = { ...bbHist };
  let devHist = { ...bbHist };
  try {
    const _classifyStatus = (s) => {
      const n = Number(s);
      if (n === 0) return 'network';
      if (n >= 200 && n < 300) return 'ok';
      if (n >= 300 && n < 400) return 'redirect';
      if (n === 401 || n === 403) return 'auth';
      if (n === 429) return 'throttle';
      if (n >= 500) return 'server_err';
      if (n >= 400) return 'client_err';
      return 'unknown';
    };
    const _buildHistogram = (byStatus) => {
      const out = { ok: 0, redirect: 0, auth: 0, throttle: 0, network: 0, server_err: 0, client_err: 0, unknown: 0 };
      if (!byStatus) return out;
      for (const [k, v] of Object.entries(byStatus)) {
        out[_classifyStatus(k)] += Number(v) || 0;
      }
      return out;
    };
    bbHist = _buildHistogram(rawDiag?.bbTriedSummary?.byStatus);
    cfHist = _buildHistogram(rawDiag?.cfTriedSummary?.byStatus);
    devHist = _buildHistogram(rawDiag?.devStatusTriedSummary?.byStatus);
    // Clone-then-mutate — НЕ мутируем input. Раньше: ctx.rawDiag заражался
    // statusHistogram'ом, при повторном gatherDiagnosticState() с тем же
    // ctx — frozen-object error или дубликат.
    if (rawDiag && typeof rawDiag === 'object') {
      rawDiag = { ...rawDiag };
      if (rawDiag.bbTriedSummary)        rawDiag.bbTriedSummary        = { ...rawDiag.bbTriedSummary,        statusHistogram: bbHist };
      if (rawDiag.cfTriedSummary)        rawDiag.cfTriedSummary        = { ...rawDiag.cfTriedSummary,        statusHistogram: cfHist };
      if (rawDiag.devStatusTriedSummary) rawDiag.devStatusTriedSummary = { ...rawDiag.devStatusTriedSummary, statusHistogram: devHist };
    }
  } catch (err) {
    try { console?.warn?.('[diag.gather_partial_fail]', { step: 'statusHistogram', err: err?.message }); } catch (_) {}
  }

  // V21 O4 — alerts[] derived. Top-level массив проблем с severity + suggestion.
  // UI должен показать первые 3 как баннер, остальные раскрыть по клику.
  // 2026-05-11 — весь блок alerts+regressions обёрнут в outer try/catch:
  // одна криво вычисленная alert не должна занулять весь export.
  const alerts = [];
  const regressions = [];
  try {
  const bbAuthorsCount = rawDiag?.bbAuthorsCount || 0;
  // eslint-disable-next-line no-unused-vars
  const cfAuthorsCount = rawDiag?.cfAuthorsCount || 0;
  const cfMentionsUnattributed = rawDiag?.cfMentionsUnattributed || 0;
  // BB attribution полная пропажа.
  if (bbCfAttribution && bbCfAttribution.bbMatched === 0 && bbAuthorsCount > 0) {
    alerts.push({
      id: 'bb_attribution_zero',
      severity: 'crit',
      msg: `BB-attribution = 0 при ${bbAuthorsCount} authors в raw данных`,
      suggestedFix: 'Проверьте identity-fields (bbLogin) у employees + не сломан ли последний deploy enrichment-логики',
    });
  }
  // CF attribution полная пропажа.
  if (bbCfAttribution && bbCfAttribution.cfMatched === 0 && cfMentionsUnattributed > 50) {
    alerts.push({
      id: 'cf_attribution_zero',
      severity: 'crit',
      msg: `CF-attribution = 0 при ${cfMentionsUnattributed} mentions в raw данных`,
      suggestedFix: 'Запустите Identity Auto-Resolve (см. inline-banner в team-glance)',
    });
  }
  // CF SSO suspicion (если ранее cfTriedSummary не имел suspectedSso, добавляем тут).
  if (rawDiag?.cfTriedSummary?.suspectedSso) {
    alerts.push({
      id: 'cf_sso_intercept',
      severity: 'warn',
      msg: `Confluence: подозрение на SSO/прокси перехват (${rawDiag.cfTriedSummary.ssoSignal || 'redirect'})`,
      suggestedFix: 'Проверьте network access к Confluence + действителен ли token',
    });
  }
  // BB throttle.
  if (bbHist.throttle > 0 && (bbHist.throttle / Math.max(1, bbHist.ok + bbHist.throttle)) > 0.3) {
    alerts.push({
      id: 'bb_rate_limited',
      severity: 'warn',
      msg: `Bitbucket throttle: ${bbHist.throttle}/${bbHist.throttle + bbHist.ok} (${Math.round(bbHist.throttle / (bbHist.throttle + bbHist.ok) * 100)}%) запросов 429`,
      suggestedFix: 'BB-shared-gate уже есть; если повторяется — увеличить timeout или поговорить с BB-админом',
    });
  }
  // Identity coverage low.
  if (identity?.coverage?.cfId?.pct < 50 && identity.teamSize >= 10) {
    alerts.push({
      id: 'cf_identity_low',
      severity: 'warn',
      msg: `Confluence identity coverage ${identity.coverage.cfId.pct}% — у ${identity.teamSize - identity.coverage.cfId.count} из ${identity.teamSize} нет cfAccountId`,
      suggestedFix: 'Запустите bulk Auto-Resolve в team-glance Сканнера',
    });
  }
  if (identity?.coverage?.bbLogin?.pct < 60 && identity.teamSize >= 10) {
    alerts.push({
      id: 'bb_identity_low',
      severity: 'warn',
      msg: `Bitbucket identity coverage ${identity.coverage.bbLogin.pct}%`,
      suggestedFix: 'Запустите bulk Auto-Resolve в team-glance Сканнера',
    });
  }
  // Zephyr scanned but zero matched.
  if (rawDiag?.zephyrConfigured && (rawDiag?.zephyrTestCasesScanned || 0) > 0
      && sources?.zephyr && (sources.zephyr.testsCreated || 0) === 0 && (sources.zephyr.testsExecuted || 0) === 0) {
    alerts.push({
      id: 'zephyr_attribution_zero',
      severity: 'crit',
      msg: `Zephyr: scanned ${rawDiag.zephyrTestCasesScanned} test cases, ${rawDiag.zephyrAuthorsCount || 0} authors, но 0 attributed`,
      suggestedFix: 'Проверьте формат jiraAccountId в employees vs Zephyr userKey (JIRAUSER-номер vs username)',
    });
  }
  // Big metrics timeouts.
  if (rawDiag?.bigMetricsTimeouts && Object.keys(rawDiag.bigMetricsTimeouts).length > 0) {
    alerts.push({
      id: 'metrics_timeout',
      severity: 'warn',
      msg: `Метрики не сосчитаны (timeout): ${Object.keys(rawDiag.bigMetricsTimeouts).join(', ')}`,
      suggestedFix: 'Увеличить timeout (env PULSE_PK_TIMEOUT_MS) или раздробить query',
    });
  }

  // V21 O3 — regressions vs prev session-snapshot из localStorage.
  // Хранится client-side, не в state → читаем здесь, сравниваем ключевые
  // метрики, surface если drop > 30% (warn) или > 80% (crit).
  try {
    const prevRaw = (typeof localStorage !== 'undefined') ? localStorage.getItem('q2_last_diag_snapshot') : null;
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      const checkDrop = (metric, currVal, prevVal, threshold = 0.3) => {
        if (typeof currVal !== 'number' || typeof prevVal !== 'number' || prevVal === 0) return;
        const drop = (prevVal - currVal) / prevVal;
        if (drop > threshold) {
          regressions.push({
            metric,
            from: prevVal, to: currVal,
            ratio: -Math.round(drop * 100) / 100,
            severity: drop > 0.8 ? 'crit' : 'warn',
          });
        }
      };
      checkDrop('bbCfAttribution.bbMatched', bbCfAttribution?.bbMatched ?? 0, prev?.bbMatched ?? 0);
      checkDrop('bbCfAttribution.cfMatched', bbCfAttribution?.cfMatched ?? 0, prev?.cfMatched ?? 0);
      checkDrop('sources.bitbucket.totalItems', sources?.bitbucket?.totalItems ?? 0, prev?.bbTotal ?? 0);
      checkDrop('sources.confluence.totalItems', sources?.confluence?.totalItems ?? 0, prev?.cfTotal ?? 0);
      checkDrop('sources.zephyr.testsCreated', sources?.zephyr?.testsCreated ?? 0, prev?.zephyrCreated ?? 0);
      checkDrop('identity.coverage.bbLogin.pct', identity?.coverage?.bbLogin?.pct ?? 0, prev?.bbLoginPct ?? 0);
    }
    // Save current snapshot for next time.
    if (typeof localStorage !== 'undefined') {
      const snap = {
        at: Date.now(),
        bbMatched: bbCfAttribution?.bbMatched,
        cfMatched: bbCfAttribution?.cfMatched,
        bbTotal: sources?.bitbucket?.totalItems,
        cfTotal: sources?.confluence?.totalItems,
        zephyrCreated: sources?.zephyr?.testsCreated,
        bbLoginPct: identity?.coverage?.bbLogin?.pct,
      };
      try { localStorage.setItem('q2_last_diag_snapshot', JSON.stringify(snap)); } catch (_) {}
    }
  } catch (_) {}

  // Convert regressions to alerts.
  for (const r of regressions) {
    alerts.push({
      id: `regression_${r.metric.replace(/\W+/g, '_')}`,
      severity: r.severity,
      msg: `Регрессия ${r.metric}: ${r.from} → ${r.to} (${r.ratio > 0 ? '+' : ''}${Math.round(r.ratio * 100)}%)`,
      suggestedFix: 'Сравните с предыдущим diagnostic — возможно недавний deploy сломал что-то',
    });
  }
  } catch (err) {
    try { console?.warn?.('[diag.gather_partial_fail]', { step: 'alerts/regressions', err: err?.message }); } catch (_) {}
  }

  const health = {
    alerts,
    regressions,
    statusHistograms: { bb: bbHist, cf: cfHist, devStatus: devHist },
  };

  // Phase-1 Jenkins MVP (2026-05-10) — surface jenkins snapshot для UI-секции.
  // Если Jenkins не настроен / unreachable → объект с error: '...' (renderer
  // покажет «Подключено: нет»).
  // 2026-05-11 — when m.jenkins absent in model (fetch не вызывался / runtime
  // error в jenkins_attach), всё равно пишем поле jenkins:{error:'not-fetched'}
  // в диагностику. Без этого пилот видит «нет ключа jenkins в JSON» и не
  // может отличить «не настроено» от «runtime crash».
  // Весь блок — в _safeStep, чтобы TypeError в любом optional-chain
  // (например на нестандартной форме rawJ.perAuthor) не зануляло export.
  let jenkinsAttributed = 0;
  const jenkins = _safeStep('jenkins', () => {
    const rawJ = m?.jenkins || null;
    if (rawJ && rawJ.perAuthor && typeof rawJ.perAuthor === 'object' && Array.isArray(m?.participants)) {
      const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const knownAuthors = new Set(Object.keys(rawJ.perAuthor).map(norm));
      for (const p of m.participants) {
        const cands = [p?.label, p?.fullName, p?.displayName, p?.email].filter(Boolean);
        if (cands.some(c => knownAuthors.has(norm(c)))) jenkinsAttributed++;
      }
    }
    return rawJ ? {
      folder:                rawJ.folder || null,
      fetchedAt:             rawJ.fetchedAt || null,
      scannedJobs:           rawJ.scannedJobs || 0,
      totalJobs:             rawJ.totalJobs || 0,
      summary:               rawJ.summary || {},
      errors:                Array.isArray(rawJ.errors) ? rawJ.errors.slice(0, 10) : [],
      error:                 rawJ.error || null,
      perAuthorCount:        rawJ.perAuthor && typeof rawJ.perAuthor === 'object' ? Object.keys(rawJ.perAuthor).length : 0,
      perJobCount:           Array.isArray(rawJ.perJob) ? rawJ.perJob.length : 0,
      authorAttributedCount: Array.isArray(m?.participants)
        ? m.participants.filter(p => (p.jenkinsBuilds48h || 0) > 0).length
        : 0,
    } : { error: 'not-fetched' };
  }, { error: 'export-failed' });

  // 2026-05-11 — bulk-resolve report from last Auto-Resolve run.
  // Contains: aggregate counts (client-side), per-integration breakdown
  // (matched/notFound/ambiguous/apiError/...) from server, AND sampled
  // failures (max 10 per integration) with hashed keys for diagnostics.
  // Null if Auto-Resolve wasn't run in this session.
  const resolveReport = _safeStep('resolveReport', () => {
    const rr = ctx.resolveReport;
    if (!rr) return null;
    const server = rr.server || {};
    const _mapFailures = (arr) => (Array.isArray(arr) ? arr : []).map(s => ({
      keyHash:     _shortHash(s.key || ''),
      reason:      s.reason || null,
      error:       s.error || null,
      matchedBy:   s.matchedBy || null,
      via:         s.via || null,
      matchedStep: s.matchedStep || null,
    }));
    return {
      ts:           rr.ts || null,
      ageMs:        rr.ts ? (Date.now() - rr.ts) : null,
      appliedCount: rr.appliedCount || 0,
      client:       rr.client || null,
      totals: {
        total:           server.total ?? null,
        bbResolved:      server.bbResolved ?? null,
        cfResolved:      server.cfResolved ?? null,
        jenkinsResolved: server.jenkinsResolved ?? null,
        noEmail:         server.noEmail ?? null,
        cfFallbackBySearch:  server.cfFallbackBySearch ?? null,
        cfFallbackByBbLogin: server.cfFallbackByBbLogin ?? null,
      },
      bbBreakdown:      server.bbBreakdown      || null,
      cfBreakdown:      server.cfBreakdown      || null,
      jenkinsBreakdown: server.jenkinsBreakdown || null,
      bbFailures:      _mapFailures(server.bbFailureSamples),
      cfFailures:      _mapFailures(server.cfFailureSamples),
      jenkinsFailures: _mapFailures(server.jenkinsFailureSamples),
    };
  }, null);

  return { header, config, connection, sources, identity, thresholds, snapshot, modelSummary, tzSkew, botsFilteredOut, bbCfAttribution, rawDiag, resolveReport, health, jenkins, jenkinsAttributed };
}

/**
 * Подготовить JSON export. Single source of truth — ВСЕ consumers
 * (UI download, copy-to-clipboard, contract-test) должны идти через
 * эту функцию. Гарантирует scrub-инвариант для mode='safe'.
 *
 * @param {object} state — output of gatherDiagnosticState()
 * @param {'safe'|'raw'} mode
 * @returns {{ json: string, sizeBytes: number, mode: string, salt: string }}
 */
export function prepareDiagnosticExport(state, mode = 'safe') {
  const m = mode === 'raw' ? 'raw' : 'safe';
  const salt = (m === 'safe') ? Utils.newExportSalt() : '';

  // CRITICAL: scrub'ить ТОЛЬКО payload (state), не metadata (_exportMode /
  // _scrubContract). Metadata содержит keys-описание ('tokens', 'email',
  // 'password' etc.) которые сами matched scrub-pattern'ами — попадание
  // их в _scrubInPlace портит описание контракта в выводе.
  // Решение: deep-clone state, scrub clone, потом attach metadata.
  //
  // V20 S6.1 fix — circular-ref + non-serializable guard. Раньше
  // JSON.parse(JSON.stringify(state)) падал TypeError на real data
  // (orchestrator может пробрасывать assigneeIndex с back-references,
  // или Date-объекты в timeline events). Теперь — replacer с WeakSet.
  const payload = _safeDeepClone(state);

  if (m === 'safe') {
    _scrubInPlace(payload, salt);
  } else {
    // Raw mode: still scrub tokens (defense-in-depth: НИКОГДА не показывать
    // tokens в JSON, даже если user явно выбрал «полный экспорт»).
    _scrubTokensOnly(payload);
  }

  const out = {
    _exportMode: m,
    _scrubContract: m === 'safe' ? {
      tokens: 'redacted',
      email: 'masked (n***@domain)',
      accountId: 'hashed (per-export salt, anti-correlation)',
      summary: 'truncated to 30 chars',
      description: 'omitted',
      saltPrefix: salt.slice(0, 4) + '…',
    } : {
      tokens: 'redacted (always)',
      email: 'NOT MASKED — full visible',
      accountId: 'NOT HASHED — full visible',
      summary: 'NOT TRUNCATED',
      description: 'NOT included (still omitted)',
      warning: 'Содержит PII — отправлять только доверенному разработчику',
    },
    ...payload,
  };

  const json = JSON.stringify(out, null, 2);
  return { json, sizeBytes: json.length, mode: m, salt };
}

/**
 * Записать audit-log в localStorage. Хранит последние AUDIT_MAX_ENTRIES
 * экспортов: timestamp, режим, размер. НЕ хранит сам контент экспорта.
 *
 * Цель — answer вопросу «когда я последний раз раскрыл PII в экспорте?».
 * Если HR-аудит запросит — список доступен.
 */
export function logExport({ mode, sizeBytes, projectKeys = [], consentGiven, disclaimerVersion, consentSource }) {
  try {
    const entry = {
      ts: Date.now(),
      mode: String(mode || 'safe'),
      sizeBytes: Number(sizeBytes) || 0,
      pkCount: (projectKeys || []).length,
      // V20 S7 B6 + S8 #6 — compliance metadata. Для raw-mode — consent attestation.
      consentGiven: !!consentGiven,
      disclaimerVersion: disclaimerVersion || null,
      consentSource: consentSource || null,
    };
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(AUDIT_KEY) : null;
    let arr = [];
    try { arr = raw ? JSON.parse(raw) : []; } catch (_) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(entry);
    if (arr.length > AUDIT_MAX_ENTRIES) arr = arr.slice(arr.length - AUDIT_MAX_ENTRIES);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(arr));
    }
    return entry;
  } catch (_) { return null; }
}

/* ────────────────────────────────────────────────────────────
   V20 S3.1 — CONNECTION PROBE MATRIX
   ──────────────────────────────────────────────────────────
   Цель: за один клик прогнать все 3 интеграции (Jira/BB/Conf) и
   ответить на вопрос «какая именно отвалилась?». Использует
   существующие /api/integrations/verify-* endpoints — никакого
   server-side кода добавлять не нужно.

   Latency измеряется client-side (network + server-side проверка
   в одном измерении — это достаточно для диагностики).

   Returns { jira, bitbucket, confluence }, каждый { ok, latencyMs,
   error?, who? }. Параллельный запуск через Promise.all (max ~3-5s
   total если все 10s timeout уложатся в один из них).
   ──────────────────────────────────────────────────────── */

export async function runConnectionProbe() {
  const probe = async (label, fn) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      return {
        source: label,
        ok: !!r.ok,
        latencyMs: Date.now() - t0,
        who: r.who || null,
        error: r.ok ? null : (Utils.redactSecretsInText(r.error || 'unknown', 200)),
      };
    } catch (e) {
      return {
        source: label,
        ok: false,
        latencyMs: Date.now() - t0,
        error: Utils.redactSecretsInText(e?.message || 'thrown', 200),
      };
    }
  };
  // Параллельный запуск — все 3 проверки одновременно.
  const [jira, bitbucket, confluence] = await Promise.all([
    probe('jira',       verifyJira),
    probe('bitbucket',  verifyBitbucket),
    probe('confluence', verifyConfluence),
  ]);
  return { jira, bitbucket, confluence, generatedAt: new Date().toISOString() };
}

/* ────────────────────────────────────────────────────────────
   V20 S3.2 — THRESHOLD SENSITIVITY PREVIEW
   ──────────────────────────────────────────────────────────
   Цель: «если я поменяю codeReview порог с 8 на 16, насколько
    blockers станет меньше?». Tech-lead не должен делать это вслепую.

   Pure client-side: re-classifies существующих participants с гипо-
   тетическим thresholds-set, считает counts по 4 группам. Использует
   model.scannerV2._teamThresholds + новый override.
   ──────────────────────────────────────────────────────── */

const DEFAULT_DWELL = { codeReview: 8, qa: 16, inProgress: 48, todo: 72, default: 24 };

/**
 * Re-классифицировать сотрудников с гипотетическими thresholds. NOT
 * mutates исходный model. Возвращает counts по 4 группам и diff vs
 * текущему состоянию.
 *
 * @param {object} model
 * @param {object} hypoThresholds — { codeReview, qa, inProgress, todo, default }
 * @returns {{ counts, blockersTotal, deltaVs }}
 */
export function simulateThresholds(model, hypoThresholds = {}) {
  if (!model || !Array.isArray(model.participants)) {
    return { counts: { stop: 0, watch: 0, moving: 0, idle: 0 }, blockersTotal: 0, deltaVs: null };
  }
  const t = { ...DEFAULT_DWELL, ...(hypoThresholds || {}) };
  // Re-compute blockers per-participant: stale[] уже несёт dwellHours,
  // отфильтруем по новым порогам.
  // ASSUMPTION: enrichment записал в каждом stale-item .dwellHours и .statusBucket
  // (codeReview / qa / inProgress / todo / default). Если нет — fallback на
  // существующий blockers.length / stale.length.
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  let blockersTotal = 0;
  // V20 S6.2.6 — track сколько участников пошли по fallback'у (без raw dwellHours).
  // Tech-lead finding: если у participant'а нет .dwellHours/.statusBucket
  // в stale-items — гипотезы silently не применяются. Юзер крутит порог
  // и видит ту же цифру → думает что сломано. Теперь считаем и возвращаем.
  let unsupportedCount = 0;
  for (const p of model.participants) {
    const today = (p.timelineToday || []).length;
    const yest  = (p.timelineYesterday || []).length;
    const wip   = (p.issuesNow || []).length;
    // Re-eval blockers с гипотетическими порогами.
    let stuck = 0;
    let usedFallback = false;
    if (Array.isArray(p.stale) && p.stale.length) {
      // Проверяем что хотя бы у одного есть raw dwell — иначе это fallback.
      const hasRawDwell = p.stale.some(s => Number.isFinite(Number(s?.dwellHours)));
      if (hasRawDwell) {
        for (const s of p.stale) {
          const bucket = s.statusBucket || 'default';
          const threshold = t[bucket] != null ? t[bucket] : t.default;
          const dwell = Number(s.dwellHours) || 0;
          if (dwell >= threshold) stuck++;
        }
      } else {
        stuck = (p.blockers?.length ?? p.stale?.length ?? 0);
        usedFallback = true;
      }
    } else {
      // Fallback: enrichment не дал raw dwellHours — используем существующий count
      // (== результат с default порогами; гипотезы тогда проигнорированы).
      stuck = (p.blockers?.length ?? p.stale?.length ?? 0);
      if ((p.stale || []).length || (p.blockers || []).length) usedFallback = true;
    }
    if (usedFallback) unsupportedCount++;
    blockersTotal += stuck;
    // Re-classify по тем же правилам что в гл. модели.
    const reviewSig = (p.badges?.reviews || 0) + (p.badges?.approves || 0);
    const cfN = (p.cfItems || []).length;
    const bbN = (p.bbItems || []).length;
    const prs = p.badges?.pr48h || 0;
    const com = p.badges?.commits48h || 0;
    const zN = (p.zephyrTestsCreatedRecent || []).length + (p.zephyrTestsExecutedRecent || []).length;
    const anyOther = reviewSig > 0 || cfN > 0 || bbN > 0 || zN > 0;
    let cls;
    if (today === 0 && yest === 0 && wip === 0 && stuck === 0 && prs === 0 && com === 0 && !anyOther) cls = 'idle';
    else if (stuck > 0 && today === 0) cls = 'stop';
    else if (wip >= 3 || (stuck > 0 && today > 0) || (today === 0 && yest > 0)) cls = 'watch';
    else cls = 'moving';
    counts[cls]++;
  }
  return {
    counts, blockersTotal, thresholds: t,
    // V20 S6.2.6 — coverage info: сколько participants пошли по fallback'у.
    // UI должен показать warning bar если unsupportedCount > 0.
    unsupportedCount,
    totalParticipants: model.participants.length,
    coverageInfo: unsupportedCount > 0
      ? `Точность ограничена: ${unsupportedCount}/${model.participants.length} сотрудников без raw dwell данных`
      : null,
  };
}

/* ────────────────────────────────────────────────────────────
   V20 S3.3 — TZ SKEW CHECK
   ──────────────────────────────────────────────────────────
   Pilot ML-пилот Olga: «время событий смещается на 2-3 часа когда
    смотрю с дому через VPN». Causes:
      · browser TZ != server TZ (DST changes, VPN routing)
      · system clock drift на client'е
      · server clock drift на host'е
   Diagnostic: вычисляем разницу между browser-now и server.fetchedAt.
   Если |skew| > 5 минут — флаг.
   ──────────────────────────────────────────────────────── */

export function computeTzSkew(model) {
  if (!model?.fetchedAt) {
    return { available: false };
  }
  const serverTs = Date.parse(model.fetchedAt);
  if (!Number.isFinite(serverTs)) return { available: false };
  const browserNow = Date.now();
  const ageMs = browserNow - serverTs;
  const browserOffsetMin = (new Date()).getTimezoneOffset();
  // PR-CJ — старый расчёт `skewSeconds = ageMs / 1000` ошибочно равнял возраст
  // кэша (32 мин) и реальное расхождение clock'ов. Если кэш старше 60 секунд
  // — расхождение нечем мерить (нужен freshly-fetched server-time). В этом
  // случае возвращаем cacheAgeMs отдельно, а skew — unmeasurable.
  const FRESH_THRESHOLD_MS = 60_000;
  if (ageMs > FRESH_THRESHOLD_MS) {
    return {
      available: true,
      unmeasurable: true,
      reason: 'cache старше 60 сек — нужен свежий fetch для замера clock-skew',
      serverTs:        model.fetchedAt,
      browserNow:      new Date(browserNow).toISOString(),
      cacheAgeMs:      ageMs,
      browserTzOffsetMin: browserOffsetMin,
      browserTzLabel: _formatTzOffset(browserOffsetMin),
    };
  }
  // Кэш свежий — skew ≈ ageMs (latency сети + clock drift).
  // Если ageMs < 60 сек, превышение обычной latency (~10-20s) указывает на drift.
  const skewSeconds = Math.round(ageMs / 1000);
  return {
    available: true,
    serverTs:        model.fetchedAt,
    browserNow:      new Date(browserNow).toISOString(),
    cacheAgeMs:      ageMs,
    skewSeconds,
    skewSuspicious:  Math.abs(skewSeconds) > 60,
    browserTzOffsetMin: browserOffsetMin,
    browserTzLabel: _formatTzOffset(browserOffsetMin),
  };
}

function _formatTzOffset(offsetMin) {
  // offsetMin: getTimezoneOffset() возвращает минуты ОТ UTC, инверс знака.
  // Москва = -180 (UTC+3). Конвертим к читаемому «UTC+3».
  const sign = offsetMin <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/**
 * V20 S8.5 #19 — Подсчёт known-issues для badge на кнопке Диагностика.
 * Дублирует логику _diagSectionKnownIssues из renderer'а (cycle-break).
 * Возвращает count проблем чтобы показать badge без открытия modal'а.
 */
export function countKnownIssues(state) {
  if (!state) return 0;
  const i = state.identity || {};
  const c = state.config || {};
  const conn = state.connection || {};
  const tz = state.tzSkew || {};
  let count = 0;
  if ((i.coverage?.cfId?.pct || 0) === 0 && (i.teamSize || 0) > 0) count++;
  if ((i.coverage?.bbLogin?.pct || 100) < 30 && c.hasBitbucketToken) count++;
  const sinceMs = c.sinceDate ? Date.parse(c.sinceDate) : NaN;
  if (Number.isFinite(sinceMs) && (Date.now() - sinceMs) > 365 * 86400 * 1000) count++;
  if (tz?.skewSuspicious) count++;
  if (conn?.jobExpired) count++;
  if (!c.projectKeys?.length) count++;
  return count;
}

/** Read audit log (для UI «последние экспорты»). */
export function readAuditLog() {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(AUDIT_KEY) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

/* ────────────────────────────────────────────────────────────
   PRIVATE HELPERS
   ──────────────────────────────────────────────────────────── */

/**
 * V20 S6.1 — Safe deep-clone для diagnostic state.
 *
 * JSON.stringify падает TypeError на:
 *   · Circular references (A.b = B; B.a = A)
 *   · BigInt / Function / Symbol values
 *   · DOM nodes / Map / Set
 *
 * Используется WeakSet для cycle detection. Cycles записываются как
 * '[Circular]'. Map/Set/Date — конвертируются в простые типы.
 */
function _safeDeepClone(obj) {
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return undefined;
    if (typeof value === 'symbol') return undefined;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) return Object.fromEntries(value);
    if (value instanceof Set) return Array.from(value);
    if (typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  }));
}

/**
 * V20 S7 A6 — простые статистические хелперы. Дублирование с
 * teamScanner2Enrichment.js (computeZScore / computeEmaWoW) намеренное:
 * избегаем cycle-import'ов между diagnostic и enrichment.
 * При изменении одной — синхронизируйте обе.
 */
function _zScore(series) {
  if (!Array.isArray(series) || series.length < 4) return { z: 0, anomalous: false };
  const today = series[series.length - 1];
  const past = series.slice(0, -1);
  const mean = past.reduce((s, x) => s + x, 0) / past.length;
  const variance = past.reduce((s, x) => s + (x - mean) ** 2, 0) / past.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (today - mean) / std : 0;
  return {
    today, mean: Math.round(mean * 10) / 10, std: Math.round(std * 100) / 100,
    z: Math.round(z * 100) / 100, anomalous: Math.abs(z) > 2,
  };
}

function _emaWoW(series, alpha = 0.3) {
  // V21 trends-guard — null'и для WoW когда история < 8 точек.
  // Параллель с computeEmaWoW в teamScanner2Enrichment.js.
  if (!Array.isArray(series) || series.length < 8) {
    return {
      emaToday: series?.[series.length - 1] ?? 0,
      emaLastWeek: null,
      wowDelta: null,
      insufficientHistory: true,
      pointsAvailable: series?.length ?? 0,
    };
  }
  const ema = [series[0]];
  for (let i = 1; i < series.length; i++) ema[i] = alpha * series[i] + (1 - alpha) * ema[i - 1];
  return {
    emaToday: Math.round(ema[ema.length - 1] * 10) / 10,
    emaLastWeek: Math.round(ema[ema.length - 8] * 10) / 10,
    wowDelta: Math.round((ema[ema.length - 1] - ema[ema.length - 8]) * 10) / 10,
  };
}

function _safeLoadSettings() {
  try { return loadSettingsRaw(); } catch (_) { return {}; }
}

function _getAppBuild() {
  // Best-effort: meta tag if present, else 'dev'.
  try {
    if (typeof document === 'undefined') return 'unknown';
    const m = document.querySelector('meta[name="app-build"]');
    return m?.content || 'dev';
  } catch (_) { return 'unknown'; }
}

function _splitCsv(s) {
  return String(s || '').split(/[,\s]+/).filter(Boolean);
}

/**
 * Per-employee BB/CF attribution summary — помогает диагностировать
 * «много коммитов в сводной, но почти никто не attributed».
 * Имена не включаются в safe-mode (только индекс + ключ-хеш).
 */
function _gatherBbCfAttribution(m, employees) {
  if (!m) return null;
  const ps = m.participants || [];
  if (!ps.length) return { total: 0, bbMatched: 0, cfMatched: 0, unmatched: [], rows: [], blockedExcluded: 0, ghostExcluded: 0 };

  // Заблокированные [Х]/[X] исключаются из активных employees при матчинге —
  // их данные не должны портить attribution-метрики (см. memory feedback).
  // R5: используем EmployeeFactory.detectBlocked — единый источник regex'а.
  const _isBlocked = (e) => !!e?.isBlocked || EmployeeFactory.detectBlocked(e || {});
  // V21 ghost-filter (diagnostic 2026-05-07: 6 призраков label==key, без
  // identity-полей). Ghosts тоже исключаются из активного registry —
  // они auto-created, не настоящие сотрудники.
  const _isGhost = (e) => EmployeeFactory.detectGhost(e || {});
  // 2026-05-11 — single-pass classify вместо 3× filter. Экономит ~30%
  // CPU на 100-person team'ах (modal-open hot path).
  const blockedEmployees = [];
  const ghostEmployees = [];
  const activeEmployees = [];
  for (const e of (employees || [])) {
    if (_isBlocked(e)) blockedEmployees.push(e);
    else if (_isGhost(e)) ghostEmployees.push(e);
    else activeEmployees.push(e);
  }
  const blockedExcluded  = blockedEmployees.length;
  const ghostExcluded    = ghostEmployees.length;

  const empByEmail  = new Map();
  const empByJiraId = new Map();
  for (const e of activeEmployees) {
    if (e.email)         empByEmail .set(String(e.email).toLowerCase().trim(), e);
    if (e.jiraAccountId) empByJiraId.set(String(e.jiraAccountId).toLowerCase().trim(), e);
  }
  const findEmp = (p) => {
    const em = String(p.email || '').toLowerCase().trim();
    if (em && empByEmail.has(em))  return empByEmail.get(em);
    const ji = String(p.jiraAccountId || '').toLowerCase().trim();
    if (ji && empByJiraId.has(ji)) return empByJiraId.get(ji);
    return null;
  };

  let bbMatched = 0, cfMatched = 0;
  const rows = [];
  for (const p of ps) {
    const emp = findEmp(p);
    const bbOk  = (p.badges?.commits48h || 0) > 0 || (p.badges?.pr48h || 0) > 0;
    const cfOk  = (p.badges?.conf48h || 0) > 0;
    if (bbOk) bbMatched++;
    if (cfOk) cfMatched++;
    rows.push({
      // Имя не включаем — только anonymised key для safe export.
      keyHash:       _shortHash(p.key || ''),
      inRegistry:    !!emp,
      hasBbLogin:    !!(emp?.bitbucketLogin),
      hasCfId:       !!(emp?.confluenceAccountId),
      hasEmail:      !!(p.email),
      bbSource:      p.bbSource || null,   // 'repo'|'devStatus'|'merged'|null
      bbCommits48h:  p.badges?.commits48h || 0,
      bbPrs48h:      p.badges?.pr48h || 0,
      bbItemsCount:  (p.bbItems || []).length,
      cfEdits48h:    p.badges?.conf48h || 0,
      cfItemsCount:  (p.cfItems || []).length,
      // «Коммиты без транзишенов» anti-pattern: badge > 0 but items empty.
      bbBadgeItemsMismatch: (p.badges?.commits48h || 0) > 0 && (p.bbItems || []).length === 0,
    });
  }

  const mismatches = rows.filter(r => r.bbBadgeItemsMismatch);
  const unmatched  = rows.filter(r => !r.inRegistry);
  return {
    total:       ps.length,
    bbMatched,
    cfMatched,
    mismatchCount: mismatches.length,
    unmatchedRegistryCount: unmatched.length,
    blockedExcluded,
    ghostExcluded,
    rows,
  };
}

function _shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).slice(0, 6);
}

function _gatherSourceCounts(m, rawDiag, settings) {
  if (!m && !rawDiag) {
    return { jira: null, bitbucket: null, confluence: null, zephyr: null };
  }
  // 2026-05-11 — fallback для zephyr.configured если rawDiag не пришёл.
  // settings.zephyrEnabled / settings.zephyrApiUrl / settings.zephyrProjectKey
  // указывают что toggle настроен пользователем. Раньше при rawDiag=null
  // показывалось configured=false даже когда фича включена в settings.
  const _zephyrSettingsConfigured = !!(
    settings && (
      settings.zephyrEnabled ||
      settings.zephyrApiUrl ||
      settings.zephyrProjectKey ||
      settings.zephyrToken
    )
  );
  // Counts из enriched model'и — они уже идентичны тому что показано в UI.
  let jiraIssues = 0, jiraTimelineEvents = 0, jiraComments = 0;
  let bbItems = 0, bbCommits = 0, bbPrs = 0, bbReviews = 0;
  let cfItems = 0;
  let zephyrCreated = 0, zephyrExecuted = 0;

  for (const p of (m?.participants || [])) {
    jiraIssues += (p.issuesNow || []).length;
    jiraTimelineEvents += (p.timelineToday || []).length + (p.timelineYesterday || []).length + (p.timelinePrev || []).length;
    jiraComments += (p.commentsRecent || []).length;
    cfItems += (p.cfItems || []).length;
    const items = p.bbItems || [];
    bbItems += items.length;
    for (const it of items) {
      if (it.kind === 'pr')      bbPrs++;
      else if (it.kind === 'review') bbReviews++;
      else                            bbCommits++;
    }
    zephyrCreated  += (p.zephyrTestsCreatedRecent  || []).length;
    zephyrExecuted += (p.zephyrTestsExecutedRecent || []).length;
  }

  // PR-CJ — BB/CF summary mismatch с rawDiag: после `[X]`-фильтра + identity
  // mismatch'ей model'ные counts могут быть < raw fetched. Показываем оба
  // числа + разницу, чтобы тимлид понимал «BB не пуст, но 16 items потерялось
  // на attribution-этапе».
  const filteredOut = {
    bitbucket: rawDiag?.bbItemsTotal != null ? Math.max(0, rawDiag.bbItemsTotal - bbItems) : null,
    confluence: rawDiag?.cfItemsTotal != null ? Math.max(0, rawDiag.cfItemsTotal - cfItems) : null,
  };
  return {
    jira: {
      issuesAssignedNow: jiraIssues,
      timelineEvents72h: jiraTimelineEvents,
      commentsRecent:    jiraComments,
      perPkSpaces:       Object.keys(m?.spaces || {}).length,
    },
    bitbucket: {
      totalItems: bbItems,
      commits:    bbCommits,
      prs:        bbPrs,
      reviews:    bbReviews,
      rawFetched: rawDiag?.bbItemsTotal ?? null,
      filteredOutOrUnattributed: filteredOut.bitbucket,
      // PR-CV — диагностика reviewer'ов: пустой overload объясняется через
      // эти поля. См. server.js:reviewerStats.
      reviewerStats: m?.bitbucket?.reviewerStats ? {
        formalAssignmentsCount: m.bitbucket.reviewerStats.formalAssignmentsCount ?? null,
        activityReviewersCount: m.bitbucket.reviewerStats.activityReviewersCount ?? null,
        overloadCount: (m.bitbucket.reviewerStats.overload || []).length,
        idleCount:     (m.bitbucket.reviewerStats.idle || []).length,
        note:          m.bitbucket.reviewerStats.note ?? null,
      } : null,
    },
    confluence: {
      totalItems: cfItems,
      rawFetched: rawDiag?.cfItemsTotal ?? null,
      filteredOutOrUnattributed: filteredOut.confluence,
    },
    // 2026-05-11 — Jenkins block. Раньше `sources.jenkins` не существовал в
    // экспорте — silent-failure диагностировался только через жалобы
    // пользователя. Теперь поднимаем:
    //   configured · jobsTotal · jobsScanned · authorsCount · builds7d
    //   failures7d · ssoRedirects · elapsedMs · errors (scope-level) ·
    //   triedSummary (per-HTTP histogram + lastErrors) · error · folder
    jenkins: {
      configured:   !!rawDiag?.jenkinsConfigured,
      folder:       rawDiag?.jenkinsFolder ?? null,
      jobsTotal:    rawDiag?.jenkinsJobsTotal ?? null,
      jobsScanned:  rawDiag?.jenkinsJobsScanned ?? null,
      authorsCount: rawDiag?.jenkinsAuthorsCount ?? null,
      builds7d:     rawDiag?.jenkinsBuilds7d ?? null,
      failures7d:   rawDiag?.jenkinsFailures7d ?? null,
      ssoRedirects: rawDiag?.jenkinsSsoRedirects ?? null,
      elapsedMs:    rawDiag?.jenkinsElapsedMs ?? null,
      error:        rawDiag?.jenkinsLastError ?? null,
      // 2026-05-11 — clone arrays/objects to avoid `[Circular]` markers
      // in rawDiag.jenkinsErrors / rawDiag.jenkinsTriedSummary when the
      // serializer sees the same reference twice (once here, once in rawDiag).
      errors:       Array.isArray(rawDiag?.jenkinsErrors) ? rawDiag.jenkinsErrors.map(e => ({ ...e })) : [],
      triedSummary: rawDiag?.jenkinsTriedSummary ? JSON.parse(JSON.stringify(rawDiag.jenkinsTriedSummary)) : null,
      warning: (() => {
        if (!rawDiag?.jenkinsConfigured) return 'Jenkins не настроен (нет URL/token в Настройках → Jenkins).';
        if (rawDiag?.jenkinsLastError) return `Jenkins scan error: ${rawDiag.jenkinsLastError}`;
        if ((rawDiag?.jenkinsSsoRedirects || 0) >= 2) return 'Подозрение на SSO redirect — токен может быть cookie, а не API token.';
        if ((rawDiag?.jenkinsJobsTotal || 0) === 0) return 'Jenkins вернул 0 jobs — проверьте folder в Настройках (текущий: ' + (rawDiag?.jenkinsFolder || 'пусто') + ') и права токена.';
        if ((rawDiag?.jenkinsAuthorsCount || 0) === 0 && (rawDiag?.jenkinsBuilds7d || 0) > 0) return 'Jenkins вернул builds но 0 авторов — Auto-Resolve identity не привязал jenkinsUserName к employees.';
        return null;
      })(),
    },
    zephyr: {
      testsCreated:  zephyrCreated,
      testsExecuted: zephyrExecuted,
      // 2026-05-11 — surface raw scan totals at top-level. testsCreated/Executed
      // считают только 72h-активность (атрибутируется участникам), но это вводит
      // в заблуждение когда сканирование само по себе работает (3487 кейсов
      // найдено), просто за 3 дня не было новых. Лифтим из rawDiag.
      testCasesScannedTotal: rawDiag?.zephyrTestCasesScanned ?? null,
      testRunsScannedTotal:  rawDiag?.zephyrTestRunsScanned ?? null,
      authorsCount:          rawDiag?.zephyrAuthorsCount ?? null,
      projectsResolved:      rawDiag?.zephyrProjectsResolved ?? null,
      mode:                  rawDiag?.zephyrMode ?? null,
      // 2026-05-11 — fallback на settings если rawDiag отсутствует. Раньше
      // configured=false показывалось когда rawDiag=null даже при включенном
      // toggle.
      configured: !!(rawDiag?.zephyrConfigured ?? _zephyrSettingsConfigured),
      // D2: surface `raw.zephyr.error` (`all-zql-variants-failed (statuses: 403)` и т.п.)
      // в человеческое сообщение вместо generic warning. Если есть точная причина —
      // показываем её, иначе fallback на старую подсказку.
      error: rawDiag?.zephyrTriedSummary?.error || null,
      warning: (() => {
        const err = rawDiag?.zephyrTriedSummary?.error;
        if (err) {
          if (/403/.test(err)) return 'Zephyr вернул 403 на все запросы — у токена нет прав на Zephyr API. Запросите у Jira-админа: какой плагин (Squad/Scale/Tests DC) установлен и какая роль нужна (Test Browser / Tests:View).';
          if (/404/.test(err)) return 'Zephyr endpoint вернул 404 — установленный плагин использует другой path (`/rest/atm/1.0/...` для Scale vs `/rest/tests/1.0/...` для Tests DC). Уточните у админа.';
          if (/all-zql-variants-failed/.test(err)) return `Zephyr: ${err}. Все 3 query-варианта упали — endpoint доступен, но ZQL отвергается. Возможно нужен другой синтаксис или scope токена.`;
          return `Zephyr error: ${err}`;
        }
        // 2026-05-11 — fix false-positive warning: scan может работать (3487
        // кейсов отсканировано), просто за 72h не было новых created/executed.
        // Warning'уем только если scan тоже пустой.
        const scanEmpty = !rawDiag?.zephyrTestCasesScanned && !rawDiag?.zephyrTestRunsScanned;
        if (rawDiag?.zephyrConfigured && scanEmpty && zephyrCreated === 0 && zephyrExecuted === 0) {
          return 'Zephyr настроен но 0 тест-кейсов / запусков отсканировано — проверьте проект-ID, права токена, корректность Zephyr Squad/Scale endpoint.';
        }
        return null;
      })(),
    },
    rawDiag: rawDiag || null,    // optional: per-pk fetch counts если orchestrator capture'ил
  };
}

function _gatherIdentityCoverage(m, employees) {
  if (!m) return { teamSize: 0, coverage: {} };
  const ps = m.participants || [];
  const total = ps.length;
  if (!total) return { teamSize: 0, coverage: {} };

  // Заблокированные [Х]/[X] исключаются — иначе уволенные люди без bbLogin/cfId
  // портят метрики «coverage» (появляются как «у 14 человек нет bbLogin»,
  // тогда как реально 8 из них — мёртвые души).
  // R5: используем EmployeeFactory.detectBlocked — единый источник regex'а.
  const _isBlocked = (e) => !!e?.isBlocked || EmployeeFactory.detectBlocked(e || {});
  const activeEmployees = (employees || []).filter(e => !_isBlocked(e));

  // V20 S4 fix — Lookup из state.employees. participant.bitbucketLogin /
  // confluenceAccountId никогда не устанавливаются — поля живут в реестре.
  const empByEmail  = new Map();
  const empByJiraId = new Map();
  for (const e of activeEmployees) {
    if (e.email)         empByEmail .set(String(e.email).toLowerCase().trim(), e);
    if (e.jiraAccountId) empByJiraId.set(String(e.jiraAccountId).toLowerCase().trim(), e);
  }
  const findEmp = (p) => {
    const em = String(p.email || '').toLowerCase().trim();
    if (em && empByEmail.has(em)) return empByEmail.get(em);
    const ji = String(p.jiraAccountId || '').toLowerCase().trim();
    if (ji && empByJiraId.has(ji)) return empByJiraId.get(ji);
    return null;
  };

  let withEmail = 0, withJiraId = 0, withBbLogin = 0, withCfId = 0, withJkName = 0;
  const incomplete = [];
  for (const p of ps) {
    const emp = findEmp(p);
    // email/jiraId — берём напрямую с participant (Jira authoritative source).
    // bbLogin/cfId/jkName — только из реестра (V17.2 I1c).
    // Phase-2 (2026-05-10) — jenkinsUserName добавлен как 5-й identity-канал.
    const has = {
      email:   !!p.email,
      jiraId:  !!p.jiraAccountId,
      bbLogin: !!(emp?.bitbucketLogin),
      cfId:    !!(emp?.confluenceAccountId),
      jkName:  !!(emp?.jenkinsUserName),
    };
    if (has.email)   withEmail++;
    if (has.jiraId)  withJiraId++;
    if (has.bbLogin) withBbLogin++;
    if (has.cfId)    withCfId++;
    if (has.jkName)  withJkName++;
    if (!(has.email && has.jiraId && has.bbLogin && has.cfId && has.jkName)) {
      incomplete.push({
        label: p.label || p.key || '',     // potentially PII — scrub при export
        key:   p.key || '',
        missing: [
          !has.email   && 'email',
          !has.jiraId  && 'jiraAccountId',
          !has.bbLogin && 'bitbucketLogin',
          !has.cfId    && 'confluenceAccountId',
          !has.jkName  && 'jenkinsUserName',
        ].filter(Boolean),
        // V20 S4 — вспом info: «есть ли в реестре вообще»
        inRegistry: !!emp,
      });
    }
  }
  const pct = (n) => Math.round((n / total) * 100);
  return {
    teamSize: total,
    coverage: {
      email:   { count: withEmail,   pct: pct(withEmail) },
      jiraId:  { count: withJiraId,  pct: pct(withJiraId) },
      bbLogin: { count: withBbLogin, pct: pct(withBbLogin) },
      cfId:    { count: withCfId,    pct: pct(withCfId) },
      jkName:  { count: withJkName,  pct: pct(withJkName) },
    },
    incomplete,
  };
}

function _gatherThresholds(m) {
  // Default thresholds импортить отсюда нельзя без cycle — model уже
  // несёт overridden копию в м.scannerV2._thresholds (если так делал
  // enrichment), иначе зашьем известные default'ы.
  const DEFAULT_DWELL = { codeReview: 8, qa: 16, inProgress: 48, todo: 72, default: 24 };
  return {
    defaultDwell:  DEFAULT_DWELL,
    perTeam: m?.scannerV2?.teamThresholds || null,
  };
}

function _countsFromModel(m) {
  // V20 S8 #15 — единственный source of truth для класификации (был inline copy).
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  for (const p of (m?.participants || [])) {
    counts[classifyPerson(p)]++;
  }
  return counts;
}

/* ── Scrub functions ────────────────────────────────────────── */

/**
 * Apply full safe-mode scrub: tokens + email + accountId + summary.
 * Mutates `obj` in place (recursive). Используется только для mode='safe'.
 */
function _scrubInPlace(obj, salt) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) _scrubInPlace(item, salt);
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    // QD9: arrays of strings под PII-ключами (bbAuthorSlugs, authorSlugs).
    // Scrub'ит каждую строку через hashAccountId. Раньше эти массивы
    // обходились в Array.isArray-ветке, но строковые элементы не
    // matched потому что recursive call с typeof 'string' возвращался
    // на line 870. Теперь явная обработка.
    if (Array.isArray(v) && /^(bbAuthorSlugs|cfAuthorSlugs|authorSlugs|slugs)$/i.test(k)) {
      obj[k] = v.map(s => typeof s === 'string' ? Utils.hashAccountId(s, salt) : s);
      continue;
    }
    if (typeof v === 'string') {
      // Field-name-driven scrub.
      // V20 S6.2.5 — расширен regex: добавлены username, userKey, key
      // (после S5.2 CF resolve пишет numeric LDAP в username — это identifier).
      if (/^email$/i.test(k))                        obj[k] = Utils.maskEmail(v);
      else if (/(accountId|bitbucketLogin|userKey|userName)$/i.test(k)) obj[k] = Utils.hashAccountId(v, salt);
      else if (/^username$/i.test(k))                 obj[k] = Utils.hashAccountId(v, salt);
      else if (/^(label|displayName|name|fullName|fio)$/i.test(k)) {
        // Replace user labels with hash — диагностика «у кого пусто» полезна,
        // но имя не нужно для дебага.
        obj[k] = Utils.hashAccountId(v, salt);
      }
      else if (/^key$/i.test(k))                      obj[k] = Utils.hashAccountId(v, salt);
      else if (/^(summary|title|pageTitle)$/i.test(k)) obj[k] = Utils.truncateSummary(v, 30);
      else if (/^(description|body|content|comment)$/i.test(k)) obj[k] = '';   // omit fully
      else if (/(error|message|errorMsg)$/i.test(k))   obj[k] = Utils.redactSecretsInText(v, 200);
      else if (/(token|apiKey|authKey|secret|password)/i.test(k)) obj[k] = '***';
    } else if (v && typeof v === 'object') {
      _scrubInPlace(v, salt);
    }
  }
}

/**
 * Raw mode: scrub только tokens (паранойя — никогда не показываем токен
 * в JSON, даже в «полном» экспорте). Email / accountId / summary остаются
 * без изменений (на это получено явное consent + audit log).
 */
function _scrubTokensOnly(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) _scrubTokensOnly(item);
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') {
      if (/(token|apiKey|authKey|secret|password)/i.test(k)) obj[k] = '***';
      else if (/(error|message|errorMsg)$/i.test(k))         obj[k] = Utils.redactSecretsInText(v, 500);
    } else if (v && typeof v === 'object') {
      _scrubTokensOnly(v);
    }
  }
}
