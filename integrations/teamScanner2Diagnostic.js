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
  // вопрос «BB вернул 0 коммитов или 0 после identity-фильтрации?».
  const sources = _gatherSourceCounts(m, ctx.rawDiag);

  // ── 5. Identity coverage ───────────────────────────────
  // Сколько % сотрудников имеют заполнен email / jiraAccountId /
  // bitbucketLogin / confluenceAccountId. Низкое coverage = главная
  // причина «нет данных» (V17.2 I1c identity-deterministic attribution).
  //
  // V20 S4 fix — coverage считается через lookup в state.employees,
  // НЕ из p.bitbucketLogin (которого на participants не существует).
  // Раньше coverage по bb/cf всегда был 0% — баг в S2, нашли пилотом.
  const identity = _gatherIdentityCoverage(m, ctx.employees || []);

  // ── 6. Threshold + window snapshot ─────────────────────
  const thresholds = _gatherThresholds(m);

  // ── 7. Snapshot delta vs yesterday ─────────────────────
  // V20 S7 A6 — EMA + WoW + Z-score в diagnostic state. Помогают тимлиду
  // увидеть «устойчивые тренды» вместо daily noise.
  const histArr = (typeof loadHistory === 'function') ? loadHistory(projectKeys, 30) : [];
  const stopSeries     = histArr.map(h => h?.counts?.stop || 0);
  const movingSeries   = histArr.map(h => h?.counts?.moving || 0);
  const progressSeries = histArr.map(h => h?.sprintGoal?.aggregateProgress || 0);
  const snapshot = {
    prev: ctx.prevSnapshot ? {
      ts:      ctx.prevSnapshot.ts,
      ageHours: ctx.prevSnapshot.ts ? Math.round((Date.now() - ctx.prevSnapshot.ts) / 3600000) : null,
      counts:  ctx.prevSnapshot.counts || {},
    } : null,
    current: m ? {
      counts: _countsFromModel(m),
      teamSize: (m.participants || []).length,
    } : null,
    history: historyDiag(projectKeys),
    // V20 S7 A6 — trend signals (EMA, WoW, anomalies).
    trends: {
      stopEma:    _emaWoW(stopSeries),
      movingEma:  _emaWoW(movingSeries),
      progressEma: _emaWoW(progressSeries),
      stopAnomaly:    _zScore(stopSeries),
      movingAnomaly:  _zScore(movingSeries),
    },
  };

  // ── 8. Pulse model summary (counts only, no PII) ───────
  const modelSummary = m ? {
    participantsCount: (m.participants || []).length,
    activeSprintsCount: (m.summary?.activeSprints || []).length,
    spaceKeys: Object.keys(m.spaces || {}),
    risks: {
      totalOrphans:     m.scannerV2?.risks?.totalOrphans     || 0,
      totalOutOfSprint: m.scannerV2?.risks?.totalOutOfSprint || 0,
      outOfSprintRatio: m.scannerV2?.risks?.outOfSprintRatio || 0,
    },
    sprintGoal: {
      aggregateTotal:    m.scannerV2?.sprintGoal?.aggregateTotal    || 0,
      aggregateProgress: m.scannerV2?.sprintGoal?.aggregateProgress || 0,
      aggregatePace:     m.scannerV2?.sprintGoal?.aggregatePace     || 'no-data',
      sprintsCount:      (m.scannerV2?.sprintGoal?.sprints || []).length,
    },
  } : null;

  // ── 9. TZ skew (V20 S3.3) ──────────────────────────────
  const tzSkew = computeTzSkew(m);

  // ── 10. Service accounts filtered out (V20 S4) ────────
  const botsFilteredOut = m?.botsFilteredOut || [];

  return { header, config, connection, sources, identity, thresholds, snapshot, modelSummary, tzSkew, botsFilteredOut };
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
  // ageMs ожидаемо положительный (server timestamp в прошлом).
  // Skew = разница между ожидаемым возрастом и реальным "сейчас".
  // Если model только что получен (latencyMs < 30s) — skew должен быть
  // меньше latency. Если skew >> latency — clock drift.
  const skewSeconds = Math.round(ageMs / 1000);
  const browserOffsetMin = (new Date()).getTimezoneOffset();
  return {
    available: true,
    serverTs:        model.fetchedAt,
    browserNow:      new Date(browserNow).toISOString(),
    ageMs,
    skewSeconds,
    skewSuspicious:  Math.abs(skewSeconds) > 300,        // > 5 мин
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
  if (!Array.isArray(series) || series.length < 8) {
    return { emaToday: series?.[series.length - 1] ?? 0, emaLastWeek: 0, wowDelta: 0 };
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

function _gatherSourceCounts(m, rawDiag) {
  if (!m && !rawDiag) {
    return { jira: null, bitbucket: null, confluence: null, zephyr: null };
  }
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
    },
    confluence: {
      totalItems: cfItems,
    },
    zephyr: {
      testsCreated:  zephyrCreated,
      testsExecuted: zephyrExecuted,
    },
    rawDiag: rawDiag || null,    // optional: per-pk fetch counts если orchestrator capture'ил
  };
}

function _gatherIdentityCoverage(m, employees) {
  if (!m) return { teamSize: 0, coverage: {} };
  const ps = m.participants || [];
  const total = ps.length;
  if (!total) return { teamSize: 0, coverage: {} };

  // V20 S4 fix — Lookup из state.employees. participant.bitbucketLogin /
  // confluenceAccountId никогда не устанавливаются — поля живут в реестре.
  // Сначала строим maps; потом для каждого participant находим emp.
  const empByEmail  = new Map();
  const empByJiraId = new Map();
  for (const e of (employees || [])) {
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

  let withEmail = 0, withJiraId = 0, withBbLogin = 0, withCfId = 0;
  const incomplete = [];
  for (const p of ps) {
    const emp = findEmp(p);
    // email/jiraId — берём напрямую с participant (Jira authoritative source).
    // bbLogin/cfId — только из реестра (V17.2 I1c).
    const has = {
      email:   !!p.email,
      jiraId:  !!p.jiraAccountId,
      bbLogin: !!(emp?.bitbucketLogin),
      cfId:    !!(emp?.confluenceAccountId),
    };
    if (has.email)   withEmail++;
    if (has.jiraId)  withJiraId++;
    if (has.bbLogin) withBbLogin++;
    if (has.cfId)    withCfId++;
    if (!(has.email && has.jiraId && has.bbLogin && has.cfId)) {
      incomplete.push({
        label: p.label || p.key || '',     // potentially PII — scrub при export
        key:   p.key || '',
        missing: [
          !has.email   && 'email',
          !has.jiraId  && 'jiraAccountId',
          !has.bbLogin && 'bitbucketLogin',
          !has.cfId    && 'confluenceAccountId',
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
    perTeam: m?.scannerV2?._teamThresholds || null,
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
