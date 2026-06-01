'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ORCHESTRATOR  (V18.1 P1, preview)

   ─── V20 S8 #19: STATE / TTL CHEAT-SHEET ──────────────────
   Truth раскидан по 5 контейнерам с разными TTL. Документировано
   тут чтобы дебаг при «вижу старые данные» не превращался в археологию.

     | Source                          | TTL             | Invalidated by                 |
     |---------------------------------|-----------------|---------------------------------|
     | this._model._fetchedAtMs       | 5 мин (stale)   | refresh() / new fetch           |
     | model.fetchedAt (server clock)  | persists        | new fetch (server timestamp)    |
     | this._detailCache (Map LRU=20)  | 5 мин per entry | unmount / refresh / TTL expire  |
     | localStorage 'snapshot:HASH'    | 24 ч            | _saveSnapshot per fetch         |
     | localStorage 'history:HASH[]'   | 30 days × 30 entries | saveDailySnapshot per fetch |
     | server _pulseCluster jobs       | 120 мин         | server expiry / new pulse       |

     Invariant: при `refresh()` — abort предыдущий fetch ДО reset state.
     Иначе старый fetch может вернуться через 8-54с и перезаписать _model.

     Public lifecycle:
       render(container) → fetch (если нет cache) → enrich → renderFull
       refresh()          → abort + clear + fetch
       unmount()          → cleanup escape handlers, keep cache
   ──────────────────────────────────────────────────────────

   PR-CL — НЕ использует Sigma Jira. Sigma (`sigmaJiraBaseUrl`,
   `sigmaJiraToken`, `sigmaGoalEpicKeys`) — отдельный инстанс
   Jira для квартальных эпиков-целей и обслуживается ИСКЛЮЧИТЕЛЬНО
   `blackDashboard.js` + endpoints `/api/integrations/sigma-*`.
   Сканнер 2.0 + portfolioPulse работают только с Delta Jira
   (`jiraBaseUrl` / `jiraToken` / `jiraProjectKeys`).
   ──────────────────────────────────────────────────────────

   Новая подвкладка «Сканнер команд 2.0». Живёт ПАРАЛЛЕЛЬНО v1
   (PortfolioPulse) — не заменяет его. v1 продолжает обслуживать
   рабочий поток; v2.0 — площадка для итерации UX согласно
   синтез-плану от panel'и (HR/руководитель/тимлид/SM/PO/full-stack/
   art-director/designer).

   P1-scope: scaffold tab с team-glance + per-person rows + click-
   to-expand детализация (заглушка). Использует те же данные что
   v1 (`fetchPulseData` + `analysePulse`). Сервер и model не
   изменяются. Расширения (heatmap, context-switches, blockers,
   /employee-detail endpoint) — фазы P2-P6.

   Public surface (mirror PortfolioPulse):
     TeamScanner2.render(container)
     TeamScanner2.refresh()
     TeamScanner2.isLoading()
   ============================================================ */

import { state as appState } from '../state.js';
// Backward-compat alias — старые сайты обращаются через `state` (модуль-
// уровень). Импорт V20 S4 переименован в appState чтобы не конфликтовать
// с локальной const state в _openDiagModal / _performExport (TDZ guard).
const state = appState;
// V20 S5.1 — auto-create employees из Jira participants.
import { EmployeeFactory } from '../rowFactory.js';
import { Utils } from '../utils.js';
import { Icons } from '../app/icons.js';
import { Reactive } from '../reactiveStore.js';
import { Storage } from '../dataStore.js';
import { resolveIdentitiesByEmail, mapResolveResultToIdentity } from './integrationsSync.js';
import { loadSettingsRaw } from './integrationsStore.js';
// V19 D3 — facade pulse/index.js consolidates 8-file API. Direct
// portfolio-pulse-* imports тоже работают (no breaking change), но facade
// читабельнее в high-touch consumers.
import {
  fetchPulseData, fetchEmployeeDetail,
  analysePulse,
  parseProjectKeys,
} from './pulse/index.js';
import {
  enrichForScanner2,
  // V20 S7 A4 + A5 — pure helper functions для UI: тренд спринта + аномалия Z-score.
  computeSprintGoalSlope, computeZScore, computeEmaWoW,
} from './teamScanner2Enrichment.js';
import {
  loadTeamConfig, saveTeamConfig, applyPreset, resetTeam,
  buildTeamThresholdsMap, PRESET_THRESHOLDS,
} from './teamScanner2Config.js';
// V19 C4 — telemetry events (понять как scanner2 реально используется).
import { emit as telemetryEmit } from './telemetry.js';
import { SCANNER_PHRASES, startPhraseRotator } from './loaderPhrases.js';
// V19 C2 — multi-day history (Anna PO + Dmitry pilot ask: «какие новости?»).
import {
  saveDailySnapshot, loadHistory, extractTrendSeries,
} from './teamScanner2History.js';
import {
  renderTopBar, renderTeamGlance, renderPersonRows, renderEmployeeDetailPanel,
  renderMultiTeamView, renderTeamConfigModal,
  // V20 S10.5 — persistent team-switcher (segmented tabs).
  renderTeamSwitcher,
  // V20 S11 Z7 — velocity comparison между командами.
  renderVelocityComparison,
  renderVelocityCompareModal,
  renderSkeleton, renderEmpty, renderError, setRenderContext,
  // V20 S1.4 — «Как считается» modal (PO request).
  renderHowCalculatedModal,
  // V20 S2.3 — Диагностика modal + disclaimer для raw-export.
  renderDiagnosticModal, renderDiagnosticDisclaimer,
  // V20 S3.1 / S3.2 — partial renderers для probe + sensitivity preview.
  renderProbeResults, renderSensitivityResults,
  // V20 S4 — Identity Auto-Resolve preview modal.
  renderIdentityResolvePreview,
  // V20 S8 #2 — CR drill-down modal.
  renderCrvDrilldownModal,
  // V20 S8.5 #20 — anomaly mini-chart modal.
  renderAnomalyMiniChart,
  // V21 Phase 3 E2 — anchor-scroll target highlight (.ts2-btn-flash 1s × 2).
  flashAnchorTarget,
  // V21 — 3-я подвкладка «Метрики» — нужно знать активный tab после render.
  getScannerTab,
  // AUDIT_SCANNER #01 — sub-tab registry DSL (shim, см. renderer).
  registerScannerSubTab, getScannerSubTabRegistry,
} from './teamScanner2Renderer.js';
// AUDIT_SCANNER #01 — re-export shim API на уровне orchestrator'а; пока никто
// не вызывает, просто чтобы будущие интеграции имели публичный entrypoint.
export { registerScannerSubTab, getScannerSubTabRegistry };
// V20 S2.2 / S3.1-3 — Diagnostic state gathering + JSON export +
// connection probe + threshold sensitivity (single source of truth).
import {
  gatherDiagnosticState, prepareDiagnosticExport, logExport, readAuditLog,
  runConnectionProbe, simulateThresholds,
  // V20 S8.5 #19 — счётчик known-issues для badge на топбаре.
  countKnownIssues,
} from './teamScanner2Diagnostic.js';
// Standalone HTML-бриф для команды (доступен из kebab «Выгрузить бриф»).
import { exportTeamBrief } from './teamScanner2BriefExport.js';
// Бриф v2.0 — decision artefact с TL;DR / attention queue / KPI band / etc.
import { exportTeamBriefV2 } from './teamScanner2BriefExportV2.js';
// LLM-ассистент: «Сводка ассистента» секция в модалке сотрудника.
import {
  generateSummary as _llmGenerateSummary,
  generatePlanHypothesis as _llmGeneratePlanHypothesis,
  readLLMConfig as _llmReadConfig,
  hasLLMCredentials as _llmHasCredentials,
} from './teamScanner2AssistantLLM.js';
// V21 π5 — demo-fixture (10 участников × 2 команды × sprint goal × risks).
// TECH 17.9 — динамический импорт: 937 LOC fixture не нужны если пользователь
// никогда не открывает demo-режим. Раньше eager static-import — fixture
// парсился на каждый mount (cold start). Теперь — lazy import в loadDemo()
// (см. ниже), нулевой cost при normal flow. См. audit-2026-05-04/06-scanner-demo-mode.md.
// V21 Phase 4 F2 — invalidate WeakMap-cache classifier'а при refresh().
// classifyPerson используется ~3× на одного participant за рендер (renderer +
// insights + history). Без epoch-bump'а cache живёт между рендерами;
// при refresh() participant'ы могут быть заменены, но кэш чистится
// автоматически — bump эквивалентен «next render = full recompute».
import { bumpClassifyEpoch } from './teamScanner2Classifier.js';
// V21 — 3-я подвкладка «Метрики» с ECharts-дашбордом.
import * as MetricsDeep from '../views/metricsDeep/index.js';
import { Services } from '../app/services.js';

/* ── V21 Phase 4 F1 — debounce + memoize search ─────────────
   Аудит F6: full _renderFull на каждый search keystroke (109 participants
   × 20+ insights helpers без memoize). 200ms debounce даёт latency-feedback
   без re-render шторма; memoize кэширует filtered-participants по query.

   Cache invalidation: dataKey = participants.length + first.id.
   Хеш меняется при refresh() / новой fetch'е → cache очищается. */
function _debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
const _searchCache = new Map();   // query → filteredParticipants[]
let   _searchCacheKey = null;     // dataKey hash для invalidation
const _SEARCH_CACHE_MAX = 20;

function _filterParticipantsByQueryImpl(participants, query) {
  const q = query.toLowerCase().trim();
  return (participants || []).filter(p =>
    (p.label || p.key || '').toLowerCase().includes(q),
  );
}

function _filterParticipantsByQuery(participants, query) {
  const list = participants || [];
  // 2026-05-11 — стронгер shape-check: length + first.key + last.key + count of
  // distinct labels. Раньше length + first было uncomplete: shape мог
  // измениться (новый member заменил другого) без invalidation.
  const first = list[0];
  const last = list[list.length - 1];
  const dataKey = list.length + ':' + (first?.key || first?.label || first?.id || '') +
                  ':' + (last?.key || last?.label || last?.id || '');
  if (dataKey !== _searchCacheKey) {
    _searchCache.clear();
    _searchCacheKey = dataKey;
  }
  if (_searchCache.has(query)) return _searchCache.get(query);
  const result = _filterParticipantsByQueryImpl(list, query);
  _searchCache.set(query, result);
  // LRU-style eviction по oldest-key (Map сохраняет insertion order).
  if (_searchCache.size > _SEARCH_CACHE_MAX) {
    const firstKey = _searchCache.keys().next().value;
    _searchCache.delete(firstKey);
  }
  return result;
}

function _resetSearchCache() {
  _searchCache.clear();
  _searchCacheKey = null;
}

export const TeamScanner2 = {
  _model: null,
  _container: null,
  // V21 AO — public read accessor для других views (teamHealthDashboards и т.д.).
  // Не trigger'ит fetch — просто отдаёт уже загруженный model. Caller должен
  // быть готов к null если pulse ещё не запускался.
  getModel() { return this._model; },
  _abort: null,
  // TECH 17.3 — единый AbortController для всех global document/window
  // listener'ов (Esc, /, focus-bridge, EventBus). До этого: 88 addEventListener
  // в orchestrator'е, removeEventListener вручную в unmount() покрывал лишь
  // 2-3 (escHandler, slashHandler) — остальные leaked. Теперь — все
  // listener'ы регистрируются с `{signal: this._globalAbortCtrl.signal}`,
  // unmount/refresh делает один abort() и ре-инициализирует controller.
  // ВАЖНО: НЕ затрагивает уже работающий _kebabAbort (он short-lived
  // per-открытие; _globalAbortCtrl покрывает long-lived global listener'ы).
  _globalAbortCtrl: null,
  _reqId: 0,
  _loading: false,
  _loadingMsg: '',
  // Sticky terminal-state markers (mirror v1 lifecycle so reactive auto-flush
  // не триггерит cold fetch на каждом refreshAll).
  _cancelled: false,
  _errorMsg: '',
  // V18.1 P5 — open key для slide-in side-panel (480px справа).
  // Раньше (P1-P3) был inline-expand под строкой — теперь полноценный
  // slide-in. Закрытие по: ✕, click-on-row-again, Esc.
  _expandedKey: '',
  // P5 source filters — toggle pill'ы в panel'е. V18.3 A2: Zephyr split на
  // Zc (created) и Ze (executed). 5 источников total.
  _panelFilters: { j: true, b: true, c: true, zc: true, ze: true },
  // V18.1 P7-S4.1 — multi-team view toggle. 'team' = single (legacy),
  // 'multi' = aggregate per-team table. Pilot Dmitry blocker fix.
  _activeView: 'team',
  // V18.3 A5b — фильтр по project key. Click team-row в multi-view →
  // переключает в team-view и фильтрует participants по `projects[]`.
  // Empty string = no filter (default).
  _activePkFilter: '',
  // V20 S12 U9 — search by name. Применяется на rendering (после
  // _applyPkFilter), не делает re-fetch. Не persistится в localStorage —
  // ephemeral per-session.
  _searchQuery: '',
  // V18.1 P4 — captured jobId (из callback fetchPulseData → onJobId)
  // используется для lazy server-side drill-down. Истекает через
  // 30 мин по TTL `_pulseJobs` cluster'а на сервере.
  _jobId: '',
  // Per-employee server-fetched detail cache. Ключ — employeeKey.
  // P4 опциональный: сейчас НЕ заменяет local enrichment, добавлен для
  // P5+ side-panel (где может потребоваться refresh с другим dwellHours).
  _detailCache: new Map(),

  // 2026-06-01 — кэш LLM-сводок «Сводка ассистента» (panel section).
  // Map<personKey, { summary: {ok,html,error,raw}, plan: {…}, ts }>.
  // Чистится в refresh(). Параллельно — _assistantInflight отслеживает
  // активные AbortController'ы, чтобы можно было abort'нуть при
  // закрытии модалки / refresh().
  _assistantCache:    new Map(),
  _assistantInflight: new Map(),

  // V21 π5 — demo-режим. Загружает локальный fixture без fetch'а в Jira/BB/CF.
  // Активируется тремя путями (см. CTA в renderEmpty / URL hash / Debug toggle).
  // В demoMode: live-actions отключены (drill-down, probe, save snapshot),
  // banner показывает «синтетические данные», export префиксован `demo:true`.
  _demoMode: false,

  isLoading() { return this._loading; },

  /* ── V20 S8.5 #22 — PUBLIC LIFECYCLE API ─────────────────
     Tech Lead F2 audit: «view дёргает _container, _renderFull напрямую —
     любая внутренняя реорганизация ломает view». Решение: публичный
     `attach/paint/detach` контракт. Privates остаются (back-compat),
     но новые consumer'ы должны использовать ТОЛЬКО эти методы.

     attach(container) — связать orchestrator с DOM container'ом + repaint state
     paint()           — re-render текущее состояние без fetch'а (cache hit)
     detach()          — cleanup listeners + opt'ов, сохраняет _model для re-attach

     Behaviour:
       - attach() = старый render() + repaint текущего sticky-state.
       - paint()  = старый _renderFull(), без fetch'а.
       - detach() = старый unmount(). */

  attach(container) {
    this._container = container;
    if (this.isLoading()) { this._showLoader(); return; }
    if (this._cancelled) { this._paintCancelled(); return; }
    if (this._errorMsg)  { this._paintError(this._errorMsg); return; }
    if (this._model)     { this._renderFull(); return; }
    return this.render(container);
  },

  paint() {
    if (this._model && this._container) this._renderFull();
  },

  detach() {
    if (typeof this.unmount === 'function') this.unmount();
  },
  /* ── end public lifecycle API ──────────────────────────── */

  /**
   * TECH 17.3 — гарантированно возвращает живой `_globalAbortCtrl.signal`.
   * Если controller'а нет или он уже abort'нут — создаёт новый.
   * Все consumer'ы (addEventListener) должны брать signal через этот helper,
   * а не через прямое чтение `_globalAbortCtrl.signal` — иначе race window'ы
   * между unmount() и привязкой нового handler'а оставят orphan listener'ы.
   */
  _getGlobalAbortSignal() {
    if (typeof AbortController === 'undefined') return undefined;
    if (!this._globalAbortCtrl || this._globalAbortCtrl.signal.aborted) {
      this._globalAbortCtrl = new AbortController();
    }
    return this._globalAbortCtrl.signal;
  },


  /* ── V20 S1.1 — Lazy + cache hybrid (5-min TTL) ────────
     User finding: «вкладка не должна загружаться сразу при входе или
      нажатии F5 — загружаться данные должны начинаться когда
      пользователь нажал кнопку».
     PO panel: Дмитрий-руководитель «1-2 мин на dashboard» — строгий
      lazy-load заставит его ждать 8s каждый визит. Решение — гибрид:
      — нет cache → empty-hero с CTA, ZERO traffic on F5
      — cache ≤ 5min → мгновенный re-paint (fresh)
      — cache > 5min → re-paint + stale-banner с кнопкой «обновить»
     Cache живёт в `_model._fetchedAtMs` (timestamp клиентского fetch'а,
     отличается от `model.fetchedAt` который ставит сервер). */
  _FRESH_TTL_MS: 5 * 60 * 1000,

  _cacheAgeMs() {
    if (!this._model || !this._model._fetchedAtMs) return Infinity;
    return Date.now() - this._model._fetchedAtMs;
  },
  // D3: config-fingerprint hash. QF3 fix: убран `empCount` — каждый
  // refresh сам же инкрементировал empCount через `_syncEmployeesFromParticipants`,
  // следующий load пробивал кэш зря (false-positive invalidation).
  // Влияющие на pulse-result поля: projectKeys / bbProjectKeys / spaceKeys /
  // activityWindowHours. Изменения в реестре сотрудников НЕ инвалидируют
  // pulse cache — identity-резолв применяется при render'е, не при fetch'е.
  _configFingerprint() {
    try {
      const settings = (typeof loadSettingsRaw === 'function' ? loadSettingsRaw() : {}) || {};
      const fp = JSON.stringify({
        pks: String(settings.jiraProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean).sort(),
        bbPks: String(settings.bitbucketProjectKeys || '').split(',').map(s => s.trim()).filter(Boolean).sort(),
        cfSp: String(settings.confluenceSpaceKeys || '').split(',').map(s => s.trim()).filter(Boolean).sort(),
        win: Number(settings.activityWindowHours) || 72,
      });
      return fp;
    } catch (_) { return ''; }
  },
  _isCacheStale() {
    if (this._cacheAgeMs() > this._FRESH_TTL_MS) return true;
    // D3: config-change → invalidate.
    const fp = this._configFingerprint();
    if (this._model && this._model._configFp && fp && this._model._configFp !== fp) return true;
    return false;
  },

  /* ── V18.1 P7-S4.2 — Trend snapshot N vs N-1 ───────────
     Pilot finding (Anna PO + Dmitry руководитель):
     «8 out-of-sprint без anchor'а — нужна базовая линия».
     «Какие новости? — не закрыто. Нужно сравнение «вчера было лучше
      или хуже»».
     Решение: persistent snapshot в localStorage 24h TTL.
     Перед каждым новым fetch → readPrevSnapshot, после успеха → save. */
  _SNAPSHOT_TTL_MS: 24 * 3600 * 1000,
  _SNAPSHOT_KEY_PREFIX: 'q2_scanner2_snapshot:',

  _hashProjectKeys(keys) {
    // Стабильный детерминистичный hash — sort + join.
    return [...(keys || [])].sort().join(',');
  },
  _snapshotKey() {
    const { projectKeys } = this._readConfig();
    return this._SNAPSHOT_KEY_PREFIX + this._hashProjectKeys(projectKeys);
  },
  _extractSnapshot(model) {
    if (!model) return null;
    const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
    // Reuse renderer's classifier import indirectly через direct count:
    // делаем простой count здесь чтобы не тащить classifyPerson сюда.
    for (const p of (model.participants || [])) {
      const today = (p.timelineToday || []).length;
      const yest  = (p.timelineYesterday || []).length;
      const wip   = (p.issuesNow || []).length;
      const stuck = (p.blockers?.length ?? p.stale?.length ?? 0);
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
      ts: Date.now(),
      counts,
      risks: {
        totalOrphans:     model.scannerV2?.risks?.totalOrphans     || 0,
        totalOutOfSprint: model.scannerV2?.risks?.totalOutOfSprint || 0,
        outOfSprintRatio: model.scannerV2?.risks?.outOfSprintRatio || 0,
      },
      sprintGoal: {
        aggregateProgress: model.scannerV2?.sprintGoal?.aggregateProgress || 0,
        aggregatePace:     model.scannerV2?.sprintGoal?.aggregatePace     || 'no-data',
      },
    };
  },
  _readPrevSnapshot() {
    try {
      const raw = localStorage.getItem(this._snapshotKey());
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || !snap.ts) return null;
      // TTL 24h: старее — игнорируем (не «вчера», а «давно»).
      if (Date.now() - snap.ts > this._SNAPSHOT_TTL_MS) return null;
      // Тоже не показываем дельту если snap слишком свежий (<5 мин — это
      // тот же fetch с retry, не реальное «прошлое»).
      if (Date.now() - snap.ts < 5 * 60 * 1000) return null;
      return snap;
    } catch (_) { return null; }
  },
  _saveSnapshot(model) {
    try {
      const snap = this._extractSnapshot(model);
      if (!snap) return;
      const json = JSON.stringify(snap);
      // V22 S-09 (audit-experts-2026-05-15 Kravchenko S0-2) — quota-bomb
      // guard. Раньше: setItem(massiveJSON) → QuotaExceededError → silent
      // telemetry, но всё дальнейшее save'ы тоже падали. У команды на 80+
      // людей snapshot мог быть >2MB. localStorage суммарно ~5MB; если
      // user работает с 3-4 quartal-snapshots'ами, OOQ гарантирован.
      //
      // Стратегия (в порядке нарастания agresivности):
      //  1. Размер < 1MB — пишем как есть.
      //  2. 1–3MB — сначала вычищаем старые snapshot-ключи, повторяем.
      //  3. > 3MB — снимаем поля высокой плотности (participants.events,
      //     blockers.dwellSamples — оставляем только агрегаты), повторяем.
      //  4. Если ВСЁ ЕЩЁ exceeded — silent + явная telemetry с size.
      const SOFT_LIMIT = 1024 * 1024;        // 1MB — комфорт
      const HARD_LIMIT = 3 * 1024 * 1024;    // 3MB — сжимаем агрессивно
      let payload = json;
      let level = 'full';
      if (payload.length > HARD_LIMIT) {
        // Срезаем дорогие поля (если snapshot их содержит).
        const compact = this._compactSnapshotForStorage(snap);
        payload = JSON.stringify(compact);
        level = 'compacted';
      }
      if (payload.length > SOFT_LIMIT) {
        // Освобождаем пространство в localStorage перед записью.
        this._cleanupStaleSnapshots();
      }
      try {
        localStorage.setItem(this._snapshotKey(), payload);
      } catch (e1) {
        // Quota — попытка №2: очень агрессивный compact.
        try { this._cleanupStaleSnapshots(); } catch (_) {}
        try {
          const compact = this._compactSnapshotForStorage(snap);
          localStorage.setItem(this._snapshotKey(), JSON.stringify(compact));
          level = 'compacted-retry';
        } catch (e2) {
          // Уже точно не помещается — лог + skip (не падаем).
          try {
            telemetryEmit('scanner2.snapshot_quota_exceeded', {
              size: payload.length,
              err: String(e2?.message || e2).slice(0, 100),
            });
          } catch (_) {}
          return;
        }
      }
      if (level !== 'full') {
        try { telemetryEmit('scanner2.snapshot_compacted', { level, originalBytes: json.length, savedBytes: payload.length }); } catch (_) {}
      }
      // V20 S7 B2 — cleanup старых snapshot-ключей. Делаем ПОСЛЕ успешного
      // save, чтобы не оставить пустоту при exception на самом write.
      this._cleanupStaleSnapshots();
    } catch (e) {
      // V20 S8.5 #5 — quota exceeded больше не silent. Pилот «нет тренда» — увидим причину.
      try { telemetryEmit('scanner2.silent_error', { where: '_saveSnapshot', msg: String(e?.message || e).slice(0, 100) }); } catch (_) {}
    }
  },

  /**
   * V22 S-09 — извлекает только тяжёлые-агрегаты для snapshot'а. Удаляет:
   *   · participants[].events (raw timeline) — самое дорогое поле
   *   · participants[].dwellSamples
   *   · blockers[].timeline
   *   · subtasks[] детализация (оставляем counters)
   * Сохраняет: aggregateCounters, derived metrics, top-N lists.
   */
  _compactSnapshotForStorage(snap) {
    if (!snap || typeof snap !== 'object') return snap;
    const compact = { ...snap, _compacted: true };
    if (Array.isArray(compact.participants)) {
      compact.participants = compact.participants.map(p => {
        if (!p || typeof p !== 'object') return p;
        const { events, dwellSamples, rawIssues, ...rest } = p;
        // events count сохраняем, сами события — нет.
        return { ...rest, eventsCount: Array.isArray(events) ? events.length : 0 };
      });
    }
    if (Array.isArray(compact.blockers)) {
      compact.blockers = compact.blockers.map(b => {
        if (!b || typeof b !== 'object') return b;
        const { timeline, history, ...rest } = b;
        return rest;
      });
    }
    return compact;
  },

  /** V20 S7 B2 — очистка snapshot-ключей старше 7 дней. Работает только
   *  для ключей с префиксом `q2_scanner2_snapshot:`. */
  _cleanupStaleSnapshots() {
    try {
      const cutoffMs = Date.now() - 7 * 24 * 3600 * 1000;
      const keysToDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(this._SNAPSHOT_KEY_PREFIX)) continue;
        try {
          const v = JSON.parse(localStorage.getItem(k) || '{}');
          if (!v.ts || v.ts < cutoffMs) keysToDelete.push(k);
        } catch (_) { keysToDelete.push(k); }     // corrupt — удаляем
      }
      for (const k of keysToDelete) localStorage.removeItem(k);
    } catch (_) { /* defensive — никогда не должна падать */ }
  },

  _readConfig() {
    let cfg = {};
    try { cfg = loadSettingsRaw(); } catch (_) {}
    // V18.1 P6.1 fix — поле в localStorage называется `jiraProjectKeys`,
    // не `projectKeys` (см. integrationsStore.js, defaults + loadSettings).
    // До этого фикса v2 ВСЕГДА видел пустые ключи → renderEmpty → у этого
    // состояния нет refresh-кнопки → жалоба «настройки заполнены, кнопки нет».
    // v1 PortfolioPulse читает то же поле — теперь оба сканера согласованы.
    return {
      projectKeys: parseProjectKeys(cfg.jiraProjectKeys || ''),
      staleDays:   Number(cfg.pulseStaleDays || 7),
    };
  },

  /* ── Public entry ──────────────────────────────────── */
  async render(container) {
    this._container = container;
    // V22+ Phase 5.2 — body.ts2-active для mascot-hide + sticky-aware contexts.
    // Guarded: document.body может отсутствовать в test-shim'ах.
    if (typeof document !== 'undefined' && document.body?.classList) {
      document.body.classList.add('ts2-active');
    }
    // V21 π5 — demo URL hash (`#scanner2/demo`) — высший приоритет, идёт ДО
    // projectKeys-проверки. Также если _demoMode уже включён (toggle / reload
    // в demo) — рендерим demo-fixture без обращения в Jira.
    const demoHash = (typeof location !== 'undefined' && /^#scanner2\/demo\b/.test(location.hash || ''));
    if (demoHash || this._demoMode) {
      // TECH 17.9 — await loadDemo чтобы caller'ы render() (например attach())
      // получали DOM-ready promise. Без await: если кто-то делает
      // `await TeamScanner2.render(...)` и сразу проверяет container.querySelector,
      // получит null т.к. lazy-import ещё не отдал fixture.
      await this.loadDemo();
      return;
    }
    const { projectKeys } = this._readConfig();
    if (!projectKeys.length) {
      container.innerHTML = renderEmpty('no-config');
      this._bindEmptyButtons();
      return;
    }
    if (this._cancelled) { this._paintCancelled(); return; }
    if (this._errorMsg)  { this._paintError(this._errorMsg); return; }
    // V18.3 A4 — share-link: при первом mount считываем URL hash и
    // авто-открываем panel если matches participant key.
    this._consumeShareLink();
    // V20 S8.5 #11 — flush server audit queue на mount (compliance retry).
    try { this._flushServerAuditQueue(); } catch (_) {}
    // V19 C4 — telemetry: scanner2 mount event (понимаем DAU/sessions).
    telemetryEmit('scanner2.mount', {
      pkCount: projectKeys.length,
      cacheHit: !!this._model,
      cacheAgeMs: this._model ? this._cacheAgeMs() : -1,
      hasShareLink: !!this._pendingShareKey,
    });
    // V20 S1.1 — Lazy + cache hybrid:
    //   · нет cache → empty-hero с CTA «Загрузить данные» (ZERO traffic).
    //   · есть cache (любая давность) → re-paint, banner покажет staleness.
    //     User жмёт «обновить» в banner → triggers refresh.
    // Если есть pendingShareKey без cache — fetch all-таки нужен иначе
    // share-link не отработает; UX: «вы открыли ссылку → грузим данные».
    if (this._model) {
      this._renderFull();
      return;
    }
    if (this._pendingShareKey) {
      // Share-link is an explicit user action equivalent.
      await this._fetchAndRender();
      return;
    }
    this._paintEmptyHero();
  },

  /** V20 S1.1 — empty-hero render (data not loaded yet). Single primary
   *  CTA «Загрузить данные команды». ZERO network traffic.
   *  V20 fix — secondary actions «Как считается» / «Диагностика» доступны
   *  ДО первой загрузки. Диагностика особенно полезна когда «нет данных»:
   *  пользователь хочет понять почему БЕЗ необходимости делать первый
   *  fetch (который тоже может зависнуть на той же ошибке). */
  _paintEmptyHero() {
    if (!this._container) return;
    this._container.innerHTML = renderEmpty('no-data');
    this._bindEmptyButtons();
  },

  /** V21 π5 — wire empty-state кнопок (initial-load + how + diag + demo).
   *  Выделено в helper чтобы привязка работала для обоих режимов
   *  (`renderEmpty('no-config')` и `renderEmpty('no-data')`) — раньше
   *  «Посмотреть демо» в no-config-варианте не получала handler. */
  _bindEmptyButtons() {
    if (!this._container) return;
    this._container.querySelector('#ts2-load-initial')?.addEventListener('click', () => {
      telemetryEmit('scanner2.initial_load_click', {});
      this._fetchAndRender();
    });
    // Secondary buttons — доступны без model. Modals самодостаточны
    // (gatherDiagnosticState корректно работает при model=null).
    this._container.querySelector('#ts2-empty-how-btn')?.addEventListener('click', () => {
      telemetryEmit('scanner2.how_open', { from: 'empty' });
      this._openHowModal();
    });
    this._container.querySelector('#ts2-empty-diag-btn')?.addEventListener('click', () => {
      telemetryEmit('scanner2.diag_open', { from: 'empty', hasModel: false });
      this._openDiagModal();
    });
    // V21 π5 — «Посмотреть демо» CTA. Activates demo-mode и грузит fixture.
    this._container.querySelector('#ts2-load-demo')?.addEventListener('click', () => {
      telemetryEmit('scanner2.demo_load_click', { from: 'empty' });
      this.loadDemo();
    });
  },

  /** V21 π5 — load synthetic demo-fixture (10 участников × 2 команды).
   *  Не делает fetch в Jira/BB/CF. Идемпотентен: повторный вызов
   *  перезагружает свежую копию fixture (полезно для «обновить» в banner).
   *  Sets `_demoMode = true` → Renders banner + disables drill-down /
   *  probe / save-snapshot (см. _isDemoBlocked guards).
   *
   *  TECH 17.9 — async из-за lazy-import demo-fixture (937 LOC). Cold-start
   *  cost demo'а = 1 dynamic-import (~50ms на нормальном железе). В normal
   *  flow fixture никогда не парсится — экономия ~ 0.4-0.7s на mount. */
  async loadDemo() {
    this._demoMode  = true;
    this._cancelled = false;
    this._errorMsg  = '';
    // QF4: сбрасываем pending-share-key при переходе в demo, иначе stale-key
    // из предыдущей реал-сессии может не найтись в demo-fixture и юзер
    // получит ложный тост «такого сотрудника нет» применительно к demo.
    this._pendingShareKey = '';
    // _jobId = '' гарантирует что fetchDetail() кинет «No jobId» при попытке
    // drill-down (sane fallback если кто-то всё-таки вызовет).
    this._jobId = '';
    this._detailCache.clear();
    // Сброс pk-filter: demo-участники не имеют поля `projects`, поэтому
    // любой сохранённый pk-фильтр выдаёт пустой список. Multi-view показывает
    // сводку по командам — удобная точка входа в демо.
    // _initialTeamApplied = true предотвращает _applyPersistedTeamSelection()
    // от перезаписи наших demo-defaults в первом _renderFull().
    this._activeView         = 'multi';
    this._activePkFilter     = '';
    this._initialTeamApplied = true;
    // TECH 17.9 — lazy import: 937 LOC fixture тянем только при первом
    // включении demo. Network не идёт (locally-bundled module), но parse-cost
    // в cold-path устраняется. Кэшируем на orchestrator'е чтобы повторные
    // вызовы loadDemo() (например, «обновить» в banner) не делали повторный
    // dynamic-import (browser кэширует, но микро-overhead на await есть).
    let m;
    try {
      if (!this._demoFixtureLoader) {
        this._demoFixtureLoader = import('./teamScanner2DemoFixture.js');
      }
      const mod = await this._demoFixtureLoader;
      m = mod.getScanner2DemoModel();
    } catch (e) {
      // Catastrophic: модуль не подгрузился (локальный network sandbox / file://).
      // Откатываемся в no-data state — лучше пустой экран, чем UI-зависание.
      this._demoFixtureLoader = null;
      this._demoMode = false;
      this._errorMsg = 'Не удалось загрузить демо-данные: ' + (e?.message || String(e)).slice(0, 100);
      if (this._container) this._paintError(this._errorMsg);
      return;
    }
    m._fetchedAtMs = Date.now();
    // V22 fix #10 (2026-05-09) — demo тоже проходит через enrichForScanner2,
    // иначе toggle «только активный спринт» не работал (демо-fixture
    // приходила с готовым scannerV2, минуя enrichment, и activeSprintFilter
    // meta не создавался → _applyActiveSprintFilter не вызывался).
    let _activeSprintOnly = true;
    try { if (localStorage.getItem('q2_scanner_active_sprint_only') === '0') _activeSprintOnly = false; }
    catch (_) { /* ignore */ }
    try {
      m = enrichForScanner2(m, null, { activeSprintOnly: _activeSprintOnly });
    } catch (e) {
      // demo enrichment не критичен — fallback на raw demo model.
      try { console.warn('[scanner2] demo enrichment failed', e?.message); } catch (_) { /* ignore */ }
    }
    this._model    = m;
    telemetryEmit('scanner2.demo_load', {
      participants: (m.participants || []).length,
      teams:        (m.scannerV2?.teams || []).length,
      activeSprintOnly: _activeSprintOnly,
    });
    // V21 π5 — pin demo-mode в URL чтобы reload оставался в demo, и шарить
    // ссылку. Hash перезаписывает любой существующий (в т.ч. employee-share).
    try {
      if (typeof history !== 'undefined' && typeof location !== 'undefined') {
        const url = location.pathname + location.search + '#scanner2/demo';
        history.replaceState(null, '', url);
      }
    } catch (_) { /* no-op */ }
    if (this._container) this._renderFull();
  },

  /** V21 π5 — exit demo-mode → возврат к empty-hero. Очищает model + hash
   *  и снимает _demoMode flag. После этого пользователь может либо запустить
   *  настоящий fetch, либо снова войти в demo. */
  exitDemo() {
    this._demoMode = false;
    this._model    = null;
    this._jobId    = '';
    this._expandedKey = '';
    // QF4: clear pending-share-key + lastRawDiag (QF8) при выходе из demo.
    this._pendingShareKey = '';
    this._lastRawDiag = null;
    this._detailCache.clear();
    try {
      if (typeof history !== 'undefined' && typeof location !== 'undefined') {
        const url = location.pathname + location.search;
        history.replaceState(null, '', url);
      }
    } catch (_) { /* no-op */ }
    telemetryEmit('scanner2.demo_exit', {});
    if (this._container) this.render(this._container);
  },

  /** V21 π5 — guard для live-actions в demo-mode. Используется в
   *  fetchDetail / probe / saveDailySnapshot чтобы не шарашить в реальный Jira
   *  и не записывать demo-данные в historyлог snapshot'ов. */
  _isDemoBlocked(actionName) {
    if (!this._demoMode) return false;
    telemetryEmit('scanner2.demo_blocked_action', { action: String(actionName || '') });
    return true;
  },

  /**
   * V18.3 A4 — parse URL hash в формате `#scanner2/employee/<key>`.
   * Если hash present и participant с таким key есть в model — auto-open
   * panel. Pilot finding (Maksim, async-команда):
   * «scanner → async-pin → результат, без discussion-overhead. Это мой
   * workflow. Сейчас только через копирование URL вручную».
   */
  _consumeShareLink() {
    const m = (typeof location !== 'undefined' ? location.hash : '') || '';
    const match = m.match(/^#scanner2\/employee\/(.+)$/);
    if (!match) return;
    // QF6: нормализуем whitespace — после F1 regex принимает пробелы,
    // но «иванов  и.и.» (двойной пробел) не совпадёт с participant.key
    // (single-spaced). Юзер копировал ссылку с лишним пробелом.
    const key = decodeURIComponent(match[1]).replace(/\s+/g, ' ').trim();
    if (!key) return;
    // V20 S7 B4 — Sanity guard against XSS via crafted share-link.
    // F1: раньше regex `^[A-Za-z0-9._-]{1,64}$` отвергал русские ключи —
    // `participant.key` для Russian-only Stash-профилей = lowercased ФИО
    // («иванов и.и.»), share-link для них молча no-op'ил для ~70% людей.
    // Используем Unicode-совместимый regex: буквы/цифры/пробелы/.-_@ —
    // достаточно для XSS-guard'а (никаких <>/'"&{}() нет в whitelist'е).
    if (!/^[\p{L}\p{N}\s._@-]{1,128}$/u.test(key)) {
      console.warn('[scanner2] share-link key rejected (bad chars):', key);
      return;
    }
    // Если model уже загружен — open immediately. Если нет — выставим
    // pending key, который сработает после _fetchAndRender'а в _renderFull.
    if (this._model && (this._model.participants || []).some(p => p.key === key)) {
      this._expandedKey = key;
    } else {
      // _pendingShareKey — будет применён в _renderFull() после fetch.
      this._pendingShareKey = key;
    }
  },

  /**
   * AUDIT_HOLISTIC §5.1 «Утро тимлида» — применить focus-context к текущему
   * model'у. Для focus.kind === 'employee' делаем preselect по email/key/login.
   * Identity-deterministic resolve: email > jiraAccountId > участник.key.
   * Безопасно вызывать ДО загрузки model: setting'ит pending-share-key.
   * @param {{kind:string,id:string,period?:string}|null} focus
   */
  applyFocus(focus) {
    if (!focus || focus.kind !== 'employee' || !focus.id) return;
    const id = String(focus.id).trim();
    if (!id) return;
    if (this._model && Array.isArray(this._model.participants)) {
      // Identity-resolve: email > jiraAccountId > key (lowercased ФИО).
      const idLc = id.toLowerCase();
      const found = this._model.participants.find(p =>
        (p.email && p.email.toLowerCase() === idLc) ||
        (p.jiraAccountId && String(p.jiraAccountId) === id) ||
        (p.key && String(p.key).toLowerCase() === idLc),
      );
      if (found) {
        this._expandedKey = found.key;
        if (this._container) this._renderFull();
        return;
      }
      // Не нашли — silent. Тимлид увидит сам список.
      return;
    }
    // Model ещё не загружен — pendingShareKey применится в _renderFull.
    this._pendingShareKey = id;
  },

  /** V22 X-03 (audit-experts-2026-05-15 Selvadurai #3) — переехало на
   *  канонический Router-формат `#scanner2?focusKind=employee&focusId=<key>`.
   *  Раньше был свой `#scanner2/employee/<key>` — два формата URL в одном
   *  продукте. Теперь — один формат через app/router.js. Legacy parse
   *  оставлен (parse() в Router'е принимает оба формата), но генерим только
   *  новый. */
  _updateShareLinkHash() {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    try {
      const newHash = this._expandedKey
        ? `#scanner2?focusKind=employee&focusId=${encodeURIComponent(this._expandedKey)}`
        : '#scanner2';
      // Сравним с текущим чтобы не пушить лишние replaceState.
      if (location.hash !== newHash) {
        const url = location.pathname + location.search + (newHash || '');
        history.replaceState(null, '', url);
      }
    } catch (_) { /* безопасный no-op */ }
  },

  async refresh() {
    // V20 S6.1 — abort предыдущего fetch'а ДО сброса state. Раньше старый
    // fetch мог завершиться через 8-54с после refresh() и перезаписать
    // _model. reqId-guard защищал от paint, но не от мутации.
    // V20 S8.5 #5 — abort failures → telemetry (race window F4 invariant).
    try { this._abort?.abort(); }
    catch (e) { try { telemetryEmit('scanner2.silent_error', { where: 'refresh_abort', msg: String(e?.message || e).slice(0, 100) }); } catch (_) {} }
    // TECH 17.2 — server-side cancel предыдущего job'а. Капчуим _jobId до
    // сброса (ниже зануляется). Если null — graceful no-op.
    const _prevJobIdForCancel = this._jobId;
    this._cancelled = false;
    this._errorMsg  = '';
    this._model     = null;
    this._expandedKey = '';
    this._jobId     = '';
    // Шлём cancel после reset'а state'а — race-safe (новый fetch
    // получит свой jobId, старый умрёт на сервере).
    this._postCancelToServer(_prevJobIdForCancel);
    this._detailCache.clear();
    // 2026-06-01 — кэш LLM-сводок жил до refresh(); новые participant'ы
    // могут иметь другую активность, старые ответы устарели.
    try { for (const ctrl of this._assistantInflight.values()) ctrl.abort?.(); } catch (_) {}
    this._assistantInflight.clear();
    this._assistantCache.clear();
    // V21 Phase 4 F1 — поскольку участники сейчас могут быть полностью
    // заменены новой fetch'ей, чистим search-cache явно (на случай если
    // dataKey hash не зацепит smaller delta — defensive).
    _resetSearchCache();
    // V21 Phase 4 F2 — invalidate classifier cache (новые participant'ы
    // могут получить ту же ссылку при partial-replay; epoch это покрывает).
    bumpClassifyEpoch();
    // V21 Phase 4 F3 — закрываем kebab если открыт; abort снимет listener'ы.
    try { this._kebabAbort?.abort(); } catch (_) { /* ignore */ }
    this._kebabAbort = null;
    if (this._container) await this._fetchAndRender();
  },

  /**
   * V18.1 P4 — lazy fetch per-employee detail с сервера. Возвращает
   * server-enriched payload (или throws). Cache hit = no network.
   * Используется P5+ side-panel'ом, в P4 не вызывается из UI.
   */
  // V20 S7 B1 — TTL для _detailCache. Раньше Map хранил payload вечно
  // (до unmount или refresh). Server-side jobId истекал за 30 мин,
  // но клиент держал PII в heap + давал stale данные при долгих сессиях.
  _DETAIL_CACHE_TTL_MS: 5 * 60 * 1000,
  _DETAIL_CACHE_MAX_ENTRIES: 20,

  // V22 S-12 (audit-experts-2026-05-15 Kravchenko S1-5) — registry активных
  // detail-запросов. Когда панель сотрудника закрывается / меняется на
  // другого сотрудника, прежний запрос отменяется. Раньше: запрос летел в
  // фон, прилетал через 30+ сек и перезаписывал уже закрытую (или другую)
  // панель. Иногда — данными чужого сотрудника.
  _detailAbortControllers: new Map(), // key: employeeKey → AbortController
  abortDetail(employeeKey) {
    if (!employeeKey) return;
    const ctrl = this._detailAbortControllers.get(employeeKey);
    if (ctrl) {
      try { ctrl.abort(new DOMException('Detail panel closed', 'AbortError')); } catch (_) {}
      this._detailAbortControllers.delete(employeeKey);
    }
  },
  abortAllDetails() {
    for (const [k, ctrl] of this._detailAbortControllers) {
      try { ctrl.abort(new DOMException('All details aborted', 'AbortError')); } catch (_) {}
    }
    this._detailAbortControllers.clear();
  },
  async fetchDetail(employeeKey, opts = {}) {
    if (!employeeKey) throw new Error('employeeKey required');
    // V21 π5 — drill-down в demo-mode недоступен (нет jobId / нет real-server).
    // Caller (side-panel render) должен disabled'ить кнопку при isDemo.
    if (this._isDemoBlocked('fetchDetail')) {
      throw new Error('Demo-режим: drill-down недоступен');
    }
    const cacheKey = `${employeeKey}|${opts.dwellHours || 24}`;
    if (!opts.bypassCache && this._detailCache.has(cacheKey)) {
      const entry = this._detailCache.get(cacheKey);
      // Проверка TTL — если протух, удаляем и идём на сервер.
      if (entry && (Date.now() - entry._cachedAt) <= this._DETAIL_CACHE_TTL_MS) {
        return entry.detail;
      }
      this._detailCache.delete(cacheKey);
    }
    if (!this._jobId) throw new Error('No jobId — fresh pulse не запускался в этой сессии');
    // V22 S-12 — отменяем предыдущий запрос для ТОГО ЖЕ сотрудника (если
    // пользователь нажал «Обновить» 2 раза подряд). Не отменяем запросы
    // других сотрудников — несколько панелей могут жить параллельно.
    this.abortDetail(employeeKey);
    const ctrl = new AbortController();
    this._detailAbortControllers.set(employeeKey, ctrl);
    // Compose external opts.signal (caller может передать свой) с нашим.
    let composedSignal = ctrl.signal;
    if (opts.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      composedSignal = AbortSignal.any([ctrl.signal, opts.signal]);
    } else if (opts.signal) {
      // Polyfill: если внешний signal abort — abort'им и наш.
      if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal.reason), { once: true });
    }
    let detail;
    try {
      detail = await fetchEmployeeDetail({
        jobId:       this._jobId,
        employeeKey,
        dwellHours:  opts.dwellHours,
        // V18.1 P7-S2.3 — пробрасываем browser TZ для consistent heatmap.
        tzOffsetMin: this._tzOffsetMin ?? new Date().getTimezoneOffset(),
        timeoutMs:   opts.timeoutMs || 30000,
        signal:      composedSignal,
      });
    } finally {
      // Cleanup только если это всё ещё НАШ controller (могла прилететь
      // новая попытка для того же employeeKey и заменить запись).
      if (this._detailAbortControllers.get(employeeKey) === ctrl) {
        this._detailAbortControllers.delete(employeeKey);
      }
    }
    // 2026-05-11 — lazy-prune expired entries при каждом .set(). Раньше
    // stale entries сидели в Map до LRU eviction'а (когда size hit cap=20).
    // Если юзер открыл 5 detail-панелей и оставил — 5 entries оставались
    // навсегда, занимая memory + risk stale-hits на reopen после TTL.
    const now = Date.now();
    const ttl = this._DETAIL_CACHE_TTL_MS;
    for (const [k, v] of this._detailCache) {
      if (now - (v?._cachedAt || 0) > ttl) this._detailCache.delete(k);
    }
    // LRU-style eviction если превысили maxEntries.
    if (this._detailCache.size >= this._DETAIL_CACHE_MAX_ENTRIES) {
      const firstKey = this._detailCache.keys().next().value;
      if (firstKey) this._detailCache.delete(firstKey);
    }
    this._detailCache.set(cacheKey, { detail, _cachedAt: now });
    return detail;
  },

  /* ── Sticky-state painters ─────────────────────────── */
  _paintCancelled() {
    if (!this._container) return;
    this._container.innerHTML = renderError('Запрос отменён', true);
    this._bindRetry();
  },
  _paintError(msg) {
    if (!this._container) return;
    // QF4: при ошибке сбрасываем pending-share-key, иначе он остаётся и
    // на следующем navigate'е (например в demo) выдаст ложное «нет такого».
    this._pendingShareKey = '';
    this._container.innerHTML = renderError(msg, true);
    this._bindRetry();
  },
  _bindRetry() {
    this._container?.querySelector('#ts2-retry-btn')?.addEventListener('click', () => this.refresh());
  },

  /**
   * TECH 17.2 — proxy frontend abort на server-side cancel.
   * AbortController на fetch'е разрывает только TCP-connection — server
   * продолжает молотить BFS+Jira+BB+CF pipeline (10-30 сек), и потом ещё
   * 30+ мин держит готовый result в памяти + пишет в jobs persist-file.
   * Решение: POST /cancel/:jobId на abort. Fire-and-forget — нам не важен
   * ответ (404 = jobId не зарегистрирован/протух — graceful skip).
   */
  _postCancelToServer(jobId) {
    if (!jobId || typeof fetch === 'undefined') return;
    try {
      fetch(`/api/integrations/portfolio-pulse/cancel/${encodeURIComponent(jobId)}`, {
        method: 'POST',
        // Короткий таймаут чтобы не висеть если сервер тоже умер.
        // Без signal — если страница уходит из view (закрытие вкладки),
        // browser сам обрубит fetch и наш registry job auto-cleanup'нется
        // через 130 мин TTL.
      }).catch(() => { /* swallow — сетевая ошибка не блокирует client UI */ });
    } catch (_) {
      // Old browser / SSR — ignore.
    }
  },

  _showLoader() {
    if (!this._container) return;
    const initialMsg = this._loadingMsg
      || `Запрашиваю ${this._readConfig().projectKeys.length} проект(а/ов) из Jira…`;
    this._container.innerHTML = renderSkeleton(initialMsg);
    this._container.querySelector('#ts2-skel-cancel')?.addEventListener('click', () => {
      try { this._abort?.abort(); } catch (_) {}
      // TECH 17.2 — также шлём cancel на сервер чтобы прервать background
      // job. Без этого: client-side abort обрывал TCP, но server продолжал
      // 10-30 сек домолачивать BFS, BB, CF — потерянная работа +
      // memory hold (jobs Map хранил result 30 мин в памяти впустую).
      this._postCancelToServer(this._jobId);
      this._loading   = false;
      this._cancelled = true;
      this._stopPhraseRotator();
      this._paintCancelled();
    });
    this._stopPhraseRotator();
    this._phraseTimer = startPhraseRotator('ts2-skel-phrase', SCANNER_PHRASES);
  },

  _stopPhraseRotator() {
    if (this._phraseTimer) { clearInterval(this._phraseTimer); this._phraseTimer = null; }
  },

  /* ── Fetch + analyse + render ──────────────────────── */
  async _fetchAndRender() {
    const container = this._container;
    if (!container) return;
    const { projectKeys, staleDays } = this._readConfig();
    const reqId = (this._reqId = (this._reqId || 0) + 1);

    this._loading = true;
    this._loadingMsg = `Запрашиваю ${projectKeys.length} проект(а/ов) из Jira…`;
    this._showLoader();
    // V19 C4 — pulse fetch latency telemetry.
    const fetchStart = Date.now();

    try {
      if (this._abort) this._abort.abort();
      // TECH 17.2 — параллельно шлём cancel на сервер для предыдущего jobId
      // если он ещё running. Capture до создания нового AbortController.
      const _prevJobIdForCancel2 = this._jobId;
      this._abort = new AbortController();
      if (_prevJobIdForCancel2) this._postCancelToServer(_prevJobIdForCancel2);
      // Phase-1 Jenkins MVP (2026-05-10) — параллельно с pulse fetch шлём
      // /api/integrations/jenkins-scan. Errors не валят основной Сканнер:
      // если Jenkins недоступен → model.jenkins = { error: ... } и chip
      // отрисуется как «J ⚠» (graceful warn state).
      // 2026-05-11 — Promise.race c 8s таймаутом, чтобы повисший Jenkins
      // (SSO redirect / network stall) не задерживал refresh на 2.5 минуты
      // (общий fetchPulseData timeout). Pulse мы ждём нормально,
      // а Jenkins — best-effort fail-open.
      const JENKINS_TIMEOUT_MS = 8000;
      const jenkinsPromise = (async () => {
        // 2026-05-11 — `AbortSignal.timeout` вместо custom Promise.race с
        // setTimeout. Раньше после успешного fetch'а orphan setTimeout(8s)
        // продолжал тикать, потом fire'ил unhandled rejection → event-loop
        // pressure + memory churn на каждом refresh'е.
        const combinedSignal = AbortSignal.any
          ? AbortSignal.any([this._abort.signal, AbortSignal.timeout(JENKINS_TIMEOUT_MS)])
          : this._abort.signal;
        try {
          const r = await fetch('/api/integrations/jenkins-scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            signal: combinedSignal,
          });
          if (!r.ok) return { error: `HTTP ${r.status}`, perAuthor: {}, perJob: [], summary: {} };
          // 2026-05-11 — content-type validation: BB/CF/Jenkins под SSO-proxy
          // могут вернуть 200 OK с HTML login-page. JSON.parse тогда падает
          // тихо. Проверяем content-type перед parse.
          const ctype = String(r.headers.get('content-type') || '').toLowerCase();
          if (!ctype.includes('application/json')) {
            return { error: `non-json response (ctype: ${ctype.slice(0,50)})`, perAuthor: {}, perJob: [], summary: {} };
          }
          const j = await r.json().catch(() => null);
          return j || { error: 'empty', perAuthor: {}, perJob: [], summary: {} };
        } catch (e) {
          if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
            return { error: e.name === 'TimeoutError' ? `timeout ${JENKINS_TIMEOUT_MS / 1000}s` : 'aborted', perAuthor: {}, perJob: [], summary: {} };
          }
          return { error: String(e?.message || e).slice(0, 120), perAuthor: {}, perJob: [], summary: {} };
        }
      })();

      const raw = await fetchPulseData({
        projectKeys,
        signal: this._abort.signal,
        timeoutMs: 600000,
        employees: state.employees || [],
        // V18.1 P4 — capture jobId для последующего drill-down.
        // sync-fallback не передаст jobId → drill-down будет недоступен
        // (graceful: TeamScanner2.fetchDetail() throws «No jobId»).
        // 2026-05-11 — reqId-guard: при двойном refresh callback от старого
        // fetch'а может перезаписать _jobId от нового → drill-down 404'ит.
        // Если reqId уже сменился (новый refresh запустился) — игнорируем.
        onJobId: (id) => {
          if (reqId !== this._reqId) return;
          this._jobId = id;
          this._detailCache.clear();
        },
      });
      if (reqId !== this._reqId) return;
      // Await Jenkins (уже параллельно крутится с pulse) — после pulse fetch
      // завершён, чтобы не блокировать его ход.
      const jenkinsData = await jenkinsPromise;
      // V19 C4 — pulse fetch выполнен → emit latency event.
      const fetchLatencyMs = Date.now() - fetchStart;
      telemetryEmit('scanner2.fetch_done', {
        pkCount: projectKeys.length,
        latencyMs: fetchLatencyMs,
        reportsCount: (raw?.reports || []).length,
      });
      // V20 S2 — capture latency для diagnostic export'а.
      this._lastFetchLatencyMs = fetchLatencyMs;
      // V20 S7 B13 — capture per-PK raw counts (до identity-attribution),
      // чтобы тимлид мог отличить «BB не отдал» от «у нас identity gap».
      this._lastRawDiag = {
        reportsCount: (raw?.reports || []).length,
        bbAuthorsCount: Object.keys(raw?.bitbucket?.authors || {}).length,
        bbItemsTotal: Object.values(raw?.bitbucket?.authors || {}).reduce((s, a) => s + (a?.items?.length || 0), 0),
        bbAuthorSlugs: Object.keys(raw?.bitbucket?.authors || {}),
        cfAuthorsCount: Object.keys(raw?.confluence?.authors || {}).length,
        cfItemsTotal: Object.values(raw?.confluence?.authors || {}).reduce((s, a) => s + (a?.items?.length || 0), 0),
        // V20 S9 — Real Zephyr fetch counts.
        zephyrConfigured: !!(raw?.zephyr?.configured),
        zephyrAuthorsCount: Object.keys(raw?.zephyr?.authors || {}).length,
        zephyrTestCasesScanned: raw?.zephyr?.summary?.testCasesScanned || 0,
        zephyrTestRunsScanned: raw?.zephyr?.summary?.testRunsScanned || 0,
        zephyrProjectsResolved: raw?.zephyr?.summary?.projectsResolved || 0,
        // QD15: какой fetcher отработал (scale / testsdc / jql-fallback / scale→jql-fallback).
        // Поможет UI отличить «Scale OK» от «Scale упал, спасает JQL».
        zephyrMode: raw?.zephyr?.mode || raw?.zephyr?.summary?.mode || null,
        // PR-CG: surface HTTP attempts so silent-failure («0 тестов» при
        // configured=true и projectsResolved>0) можно отдиагностировать
        // прямо из safe-export. Группируем по статусу (200/400/401/404…).
        zephyrTriedSummary: (() => {
          const t = Array.isArray(raw?.zephyr?.tried) ? raw.zephyr.tried : [];
          const byStatus = {};
          const byType = {};
          const lastErrors = [];
          for (const e of t) {
            const s = String(e?.status ?? '0');
            byStatus[s] = (byStatus[s] || 0) + 1;
            const ty = String(e?.type || 'unknown');
            byType[ty] = (byType[ty] || 0) + 1;
            // 2026-05-11 — capture last 5 non-200 для диагностики silent-failure.
            const isErr = e?.status == null || e.status < 200 || e.status >= 300;
            if (isErr && lastErrors.length < 5) {
              lastErrors.push({
                url:    String(e?.url || '').slice(0, 200),
                status: e?.status ?? null,
                type:   ty,
                error:  e?.error ? String(e.error).slice(0, 200) : null,
              });
            }
          }
          return { total: t.length, byStatus, byType, lastErrors, error: raw?.zephyr?.error || null };
        })(),
        // D4: аналог для BB / CF / dev-status. Раньше только Zephyr surface'ил
        // tried[] — у остальных fetcher'ов skipped/HTTP-status невидим в
        // safe-export (зашит в сыром tried[] который не попадает в diagnostic).
        bbTriedSummary: (() => {
          const t = Array.isArray(raw?.bitbucket?.tried) ? raw.bitbucket.tried : [];
          const byStatus = {}; const byType = {};
          const lastErrors = [];
          for (const e of t) {
            const s = String(e?.status ?? '0');
            if (e?.status != null) byStatus[s] = (byStatus[s] || 0) + 1;
            // QD10: было `e?.type || e?.skipped ? 'skipped' : 'unknown'` —
            // operator precedence: `(e.type || e.skipped) ? 'skipped' : 'unknown'`
            // → даже при наличии `type='pr'` всё falls into 'skipped'.
            // Правильно: явные скобки.
            const ty = e?.type ? String(e.type) : (e?.skipped ? 'skipped' : 'unknown');
            byType[ty] = (byType[ty] || 0) + 1;
            // 2026-05-11 — last 5 non-ok для диагностики.
            const isErr = e?.status != null && (e.status < 200 || e.status >= 300);
            if (isErr && lastErrors.length < 5) {
              lastErrors.push({
                url:    String(e?.url || '').slice(0, 200),
                status: e?.status ?? null,
                type:   ty,
                error:  e?.error ? String(e.error).slice(0, 200) : null,
              });
            }
          }
          return { total: t.length, byStatus, byType, lastErrors, truncated: !!raw?.bitbucket?.triedTruncated };
        })(),
        cfTriedSummary: (() => {
          const t = Array.isArray(raw?.confluence?.tried) ? raw.confluence.tried : [];
          const byStatus = {}; const byType = {};
          let htmlBodyCount = 0;
          // V22 C2 — собираем pathname'ы первых 5 редиректнутых эндпоинтов
          // (status 301/302). Источник — `tried[].url` который server
          // (`server/confluence.js`) уже отдал без query-string. Дедуп через
          // Set, чтобы 3 одинаковых /rest/api/audit не съели весь cap.
          const redirectedSet = new Set();
          // 2026-05-11 — lastErrors[] для прямой диагностики silent-failure.
          const lastErrors = [];
          for (const e of t) {
            const s = String(e?.status ?? '0');
            if (e?.status != null) byStatus[s] = (byStatus[s] || 0) + 1;
            const ty = e?.type ? String(e.type) : 'unknown';
            byType[ty] = (byType[ty] || 0) + 1;
            if (e?.htmlBody) htmlBodyCount++;
            if ((e?.status === 301 || e?.status === 302) && e?.url && redirectedSet.size < 5) {
              redirectedSet.add(String(e.url).slice(0, 200));
            }
            const isErr = e?.status != null && (e.status < 200 || e.status >= 300);
            if (isErr && lastErrors.length < 5) {
              lastErrors.push({
                url:    String(e?.url || '').slice(0, 200),
                status: e?.status ?? null,
                type:   ty,
                htmlBody: !!e?.htmlBody,
                error:  e?.error ? String(e.error).slice(0, 200) : null,
              });
            }
          }
          // V21 CF2 — suspectedSso flag. Любой 302 → SSO redirect; HTML body
          // → silent SSO; 200 + 0 items → возможный SSO. Помогает UI быстро
          // понять «это пустой результат или прокси-перехват».
          // 2026-05-11 — exclude probe-* type'ы из SSO detection. Наш path-probe
          // (server/confluence.js) намеренно пробует оба endpoint'а — wiki-rest
          // обычно 302 на DC-инсталляциях, это ожидаемо и нормально. Без этого
          // exclude'а probe-302 ложно триггерил suspectedSso=true даже когда
          // probe правильно определил winner и все production-запросы прошли 200.
          const nonProbe302 = t.filter(e =>
            (e?.status === 301 || e?.status === 302) &&
            !String(e?.type || '').startsWith('probe-')
          ).length;
          const has302 = nonProbe302 > 0;
          // 2026-05-11 — check both `items` AND `authors`. Старая проверка
          // на `raw.confluence.items` давала false-positive: items может быть
          // пустым (data структурирована per-author), а authors содержать
          // 8 сотрудников с 54 правками. Поэтому fall-back на authors.
          const okItemsCount = Array.isArray(raw?.confluence?.items) ? raw.confluence.items.length : 0;
          const okAuthorsCount = raw?.confluence?.authors && typeof raw.confluence.authors === 'object'
            ? Object.keys(raw.confluence.authors).length : 0;
          const has200ButEmpty = (byStatus['200'] || 0) > 0 && okItemsCount === 0 && okAuthorsCount === 0;
          const suspectedSso = has302 || htmlBodyCount > 0 || has200ButEmpty;
          return {
            total: t.length, byStatus, byType,
            htmlBodyCount,
            suspectedSso,
            ssoSignal: has302 ? 'redirect' : (htmlBodyCount > 0 ? 'html-200' : (has200ButEmpty ? 'empty-200' : null)),
            // V22 C2 — sample редиректнутых pathname'ов (max 5, deduped, без query).
            // Видно в Diagnostic-modal под секцией «Попытки CQL».
            redirectedSamples: [...redirectedSet],
            lastErrors,
          };
        })(),
        devStatusTriedSummary: (() => {
          const t = Array.isArray(raw?.bitbucket?.devStatus?.tried) ? raw.bitbucket.devStatus.tried : [];
          const byStatus = {}; const byType = {};
          for (const e of t) {
            const s = String(e?.status ?? '0');
            if (e?.status != null) byStatus[s] = (byStatus[s] || 0) + 1;
            const ty = e?.type ? String(e.type) : 'unknown';
            byType[ty] = (byType[ty] || 0) + 1;
          }
          return { total: t.length, byStatus, byType };
        })(),
        // 2026-05-11 — Jenkins block. До этого fix'а `rawDiag` не включал
        // Jenkins вообще — silent-failure («jkName.count: 0», 0 авторов)
        // нельзя было отдиагностировать из safe-export. Теперь surface'им:
        //   - configured (URL + token present)
        //   - totals (jobs/builds/authors)
        //   - per-call tried[] histogram (status / scope / kind)
        //   - scope-level errors[] (sampled, до 10)
        //   - top-level error (auth/timeout/network)
        //   - SSO heuristic counter
        //   - elapsed ms
        jenkinsConfigured: (() => {
          try {
            const s = loadSettingsRaw();
            return !!(s?.jenkinsBaseUrl && s?.jenkinsToken);
          } catch (_) { return false; }
        })(),
        jenkinsFolder:        String(jenkinsData?.folder || ''),
        jenkinsJobsTotal:     Number(jenkinsData?.totalJobs || 0),
        jenkinsJobsScanned:   Number(jenkinsData?.scannedJobs || 0),
        jenkinsAuthorsCount:  Object.keys(jenkinsData?.perAuthor || {}).length,
        jenkinsBuilds7d:      Number(jenkinsData?.summary?.totalBuilds7d || 0),
        jenkinsFailures7d:    Number(jenkinsData?.summary?.failures7d || 0),
        jenkinsLastError:     jenkinsData?.error || null,
        jenkinsSsoRedirects:  Number(jenkinsData?.ssoRedirectCount || 0),
        jenkinsElapsedMs:     Number(jenkinsData?.elapsedMs || 0),
        // Scope-level errors (cap 10): `{ scope: "jobs-list" | "job:foo" |
        //   "auth", message: "auth: HTTP 403" | "network: …" | … }`
        jenkinsErrors: Array.isArray(jenkinsData?.errors) ? jenkinsData.errors.slice(0, 10) : [],
        // Per-HTTP-call histogram (mirror of bb/cf/zephyr pattern).
        // `byStatus`: { "200": 5, "401": 1, … }
        // `byKind`:   { "ok": 5, "auth-fail-401": 1, "sso-redirect": 0, "network": 0, … }
        // `byScope`:  { "jobs-list": 1, "job:foo": 4, … }
        // `lastErrors`: last 5 non-ok entries с path-only URL + status + scope + error.
        jenkinsTriedSummary: (() => {
          const t = Array.isArray(jenkinsData?.tried) ? jenkinsData.tried : [];
          const byStatus = {}; const byKind = {}; const byScope = {};
          const lastErrors = [];
          for (const e of t) {
            const s = String(e?.status ?? '0');
            byStatus[s] = (byStatus[s] || 0) + 1;
            const k = String(e?.kind || 'unknown');
            byKind[k] = (byKind[k] || 0) + 1;
            const sc = String(e?.scope || 'unknown');
            byScope[sc] = (byScope[sc] || 0) + 1;
            // Capture last 5 non-ok с safe-fields (url path-only, no body).
            if (k !== 'ok' && lastErrors.length < 5) {
              lastErrors.push({
                url:    String(e.url || '').slice(0, 200),
                status: e.status,
                kind:   k,
                scope:  sc,
                error:  e.error ? String(e.error).slice(0, 200) : null,
              });
            }
          }
          return { total: t.length, byStatus, byKind, byScope, lastErrors };
        })(),
        perPk: (raw?.reports || []).map(r => ({
          pk: r.projectKey,
          issuesCount: (r.issues || []).length,
          sprintCount: (r.sprintKeys || []).length,
          hasError: !!r.error,
          error: r.error || null,
        })),
        // M3: какие big-metrics fetcher'ы зафиксировали timeout. Раньше
        // `_timeout:true` markers были в raw.bigMetrics, но в diagnostic'е
        // не surfaced'ились — UI показывал «не настроено» вместо «timeout».
        bigMetricsTimeouts: (() => {
          const bm = raw?.bigMetrics || {};
          const out = {};
          for (const [k, v] of Object.entries(bm)) {
            if (v && v._timeout) out[k] = true;
          }
          return out;
        })(),
        // M4: количество BB-PR/коммитов, отсеянных allowlist'ом dev-status
        // fetcher'а — раньше счётчик возвращался, но не агрегировался.
        bbDroppedOutOfAllowlist: Number(raw?.bitbucket?.devStatus?.droppedOutOfAllowlist || raw?.bitbucket?.droppedOutOfAllowlist || 0),
        // E1 — sampled list of dropped-by-allowlist items (server cap 10).
        // UI рендерит таблицу: автор · repo · kind · ago. Хелпает увидеть
        // «команда контрибутит в чужой repo» вместо голого числа.
        bbDroppedSamples: Array.isArray(raw?.bitbucket?.devStatus?.droppedSamples)
          ? raw.bitbucket.devStatus.droppedSamples.slice(0, 10)
          : (Array.isArray(raw?.bitbucket?.droppedSamples) ? raw.bitbucket.droppedSamples.slice(0, 10) : []),
        // E2/E3 — список BB-авторов без identity-mapping. Берём raw authors
        // (из repoAuthors + devStatusAuthors), исключаем тех, у кого slug или
        // email находится среди state.employees.{bitbucketLogin, email}, и
        // отдаём UI с eventCount = (commits + prs) per author.
        // Frontend-fallback: считается клиентом — для нескольких десятков
        // авторов это ms-операция; server slow-path не трогаем.
        bbUnattributedAuthors: (() => {
          try {
            const repoAuthors = raw?.bitbucket?.repoAuthors || {};
            const devAuthors  = raw?.bitbucket?.devStatusAuthors || {};
            const knownLogins = new Set();
            const knownEmails = new Set();
            for (const e of (state.employees || [])) {
              const bbl = String(e?.bitbucketLogin || '').toLowerCase().trim();
              if (bbl) knownLogins.add(bbl);
              const em  = String(e?.email || '').toLowerCase().trim();
              if (em) knownEmails.add(em);
            }
            const merged = {};
            for (const [k, v] of Object.entries(repoAuthors)) merged[k] = { ...(v || {}) };
            for (const [k, v] of Object.entries(devAuthors)) {
              if (!merged[k]) merged[k] = { ...(v || {}) };
              else {
                merged[k].commits = (merged[k].commits || 0) + (v?.commits || 0);
                merged[k].prs     = (merged[k].prs || 0)     + (v?.prs || 0);
                if (!merged[k].slug && v?.slug) merged[k].slug = v.slug;
                if (!merged[k].email && v?.email) merged[k].email = v.email;
                if (!merged[k].displayName && v?.displayName) merged[k].displayName = v.displayName;
              }
            }
            const out = [];
            for (const [k, v] of Object.entries(merged)) {
              const slug = String(v?.slug || k || '').toLowerCase().trim();
              const em   = String(v?.email || '').toLowerCase().trim();
              const inRegistry = (slug && knownLogins.has(slug)) || (em && knownEmails.has(em));
              if (inRegistry) continue;
              const eventCount = (v?.commits || 0) + (v?.prs || 0);
              if (eventCount === 0) continue;
              out.push({
                slug:        v?.slug || k,
                displayName: v?.displayName || v?.email || k,
                email:       v?.email || '',
                eventCount,
                commits:     v?.commits || 0,
                prs:         v?.prs || 0,
              });
            }
            out.sort((a, b) => b.eventCount - a.eventCount);
            return out.slice(0, 30);
          } catch (_) {
            return [];
          }
        })(),
        // CF: общий счётчик упоминаний без авторства (H4).
        cfMentionsUnattributed: Number(raw?.confluence?.mentionsUnattributed || 0),
        // BD: ошибки sigma chunk-fetch (H7).
        // D1: filter был только `delta-batch`, не покрывал другие sigma-scope'ы
        // (sigma-fetch / goals-batch / etc).
        sigmaErrorsCount: (() => {
          const errs = raw?.errors || [];
          return errs.filter(e => {
            const sc = String(e?.scope || '');
            return sc === 'delta' || sc.startsWith('delta-') || sc.startsWith('sigma');
          }).length;
        })(),
      };
      // V18.1 P3 — после стандартного анализа применяем v2.0-специфический
      // enrichment: heatmap[3][24], contextSwitches, timeline72h, blockers
      // (с server-local-TZ часами и единым 24h dwell-threshold). v1 НЕ
      // запускает enrichment — нулевой impact для PortfolioPulse.
      const baseModel = analysePulse(raw, { staleDays, employees: state.employees || [] });
      // V20 S5.1 + S6.1 fix — auto-sync participants → state.employees.
      // Pulse находит 110 человек по Jira-задачам, но в registry могут быть
      // только те, кого добавили вручную. Это ломает identity-resolve.
      // Решение: создать заглушку-employee для каждого Jira participant'а
      // ПОСЛЕ analysePulse (TDZ guard — baseModel должен быть объявлен).
      try {
        this._syncEmployeesFromParticipants(baseModel);
      } catch (e) {
        console.warn('[scanner2] auto-sync employees failed:', e);
      }
      // V18.1 P7-S2.3 — browser TZ offset для consistent heatmap.
      this._tzOffsetMin = new Date().getTimezoneOffset();
      // V18.3 A1 — per-team thresholds override из user-config (Olga ML pilot).
      const teamThresholds = buildTeamThresholdsMap();
      // V20 S10.1 — `[X]` deactivated filter. Default OFF (=скрыты).
      // Toggle: localStorage.q2_scanner_show_blocked = '1' → показывать
      // заблокированных (для аудита/handover).
      let includeDeactivated = false;
      try { includeDeactivated = localStorage.getItem('q2_scanner_show_blocked') === '1'; }
      catch (_) { /* ignore */ }
      // V20 S10.6 — Active Sprint Only filter. Default ON (PM decision:
      // «90% случаев тимлид смотрит активный спринт»). Storage:
      //   '0'   → explicit OFF
      //   '1'   → explicit ON
      //   absent→ default ON
      let activeSprintOnly = true;
      try {
        const v = localStorage.getItem('q2_scanner_active_sprint_only');
        if (v === '0') activeSprintOnly = false;
      } catch (_) { /* ignore */ }
      this._model = enrichForScanner2(baseModel, raw, {
        dwellHours: 24,
        tzOffsetMin: this._tzOffsetMin,
        teamThresholds,
        includeDeactivated,
        activeSprintOnly,
      });
      // V21 S1 — smoke-test после enrichment. Ловит регрессии типа моего
      // sprint-filter sprint-strict-mode, который выкинул bbItems/cfItems
      // у всех participants → bbMatched=0 при rawFetched=351. Без этого
      // assertion'а проблема всплывает только когда user приносит diagnostic.
      try {
        const rawBb = raw?.bitbucket?.authors ? Object.keys(raw.bitbucket.authors).length : 0;
        const rawCf = raw?.confluence?.authors ? Object.keys(raw.confluence.authors).length : 0;
        const enrichedBbItems = (this._model?.participants || [])
          .reduce((s, p) => s + ((p.bbItems || []).length), 0);
        const enrichedCfItems = (this._model?.participants || [])
          .reduce((s, p) => s + ((p.cfItems || []).length), 0);
        const warnings = [];
        if (rawBb > 5 && enrichedBbItems === 0) {
          warnings.push({ id: 'enrichment_bb_lost_all', msg: `BB raw=${rawBb} authors → enriched 0 items. Возможно identity-фильтр или sprint-filter слишком строгий.` });
        }
        if (rawCf > 5 && enrichedCfItems === 0) {
          warnings.push({ id: 'enrichment_cf_lost_all', msg: `CF raw=${rawCf} authors → enriched 0 items. Возможно identity-фильтр слишком строгий.` });
        }
        if (warnings.length) {
          this._model._smokeTestWarnings = warnings;
          for (const w of warnings) {
            console.warn(`[scanner2] smoke-test failed: ${w.id} — ${w.msg}`);
            telemetryEmit('scanner2.smoke_test_fail', { id: w.id });
          }
        }
      } catch (e) {
        telemetryEmit('scanner2.silent_error', { where: 'smoke_test', msg: String(e?.message || e).slice(0, 100) });
      }
      // Phase-1 Jenkins MVP (2026-05-10) — attach jenkins-data + identity-map.
      // Match: точный case-insensitive whitespace-trim по participant.label
      // или email vs perAuthor key (Jenkins userName / fullName). Никаких
      // fuzzy без явного Auto-Resolve (CLAUDE.md контракт #2).
      try {
        this._model.jenkins = jenkinsData || null;
        const perAuthor = jenkinsData?.perAuthor || {};
        // Build lookup-индекс из perAuthor: норм-имя → record.
        const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const byName = new Map();
        for (const [name, rec] of Object.entries(perAuthor)) {
          const k = norm(name);
          if (k) byName.set(k, rec);
        }
        for (const p of (this._model.participants || [])) {
          const candidates = [
            p?.label, p?.fullName, p?.displayName, p?.name,
            p?.email,
          ].filter(Boolean);
          let rec = null;
          for (const c of candidates) {
            const r = byName.get(norm(c));
            if (r) { rec = r; break; }
          }
          if (rec) {
            p.jenkinsBuilds48h    = rec.builds48h    || 0;
            p.jenkinsFailures48h  = rec.failures48h  || 0;
            p.jenkinsLastBuildAt  = rec.lastBuildAt  || 0;
          } else {
            p.jenkinsBuilds48h   = 0;
            p.jenkinsFailures48h = 0;
            p.jenkinsLastBuildAt = 0;
          }
          // 2026-05-11 — propagate jenkins error в каждый participant, чтобы
          // renderRow (без model в scope) мог показать J⚠ chip.
          p.jenkinsError = jenkinsData?.error ? String(jenkinsData.error).slice(0, 80) : '';
        }
      } catch (e) {
        telemetryEmit('scanner2.silent_error', { where: 'jenkins_attach', msg: String(e?.message || e).slice(0, 100) });
      }
      // V20 S1.1 — client-side timestamp для cache-age TTL (5 мин hybrid).
      // Отличается от model.fetchedAt (server-side timestamp): фиксирует
      // момент когда orchestrator получил данные, а не когда сервер их
      // собрал. Используется в _isCacheStale() и в stale-banner UI.
      this._model._fetchedAtMs = Date.now();
      // D3: фиксируем config-fingerprint вместе с моделью.
      this._model._configFp = this._configFingerprint();
      // V22 C1 — surface cfTriedSummary прямо в model.diagnostics, чтобы
      // renderTeamGlance мог показать SSO-redirect баннер без доступа к
      // window.TeamScanner2._lastRawDiag (race-safe + testable). Других
      // полей в diagnostics нет — это narrowed read для inline-баннера.
      try {
        const cf = this._lastRawDiag?.cfTriedSummary;
        if (cf && typeof cf === 'object') {
          this._model.diagnostics = Object.assign({}, this._model.diagnostics || {}, { cfTriedSummary: cf });
        }
      } catch (_) { /* diagnostics никогда не должны валить рендер */ }
      // V18.1 P7-S4.2 — read prev snapshot ДО save'а нового, чтобы дельта
      // считалась относительно вчерашнего, а не этого же fetch'а.
      this._prevSnapshot = this._readPrevSnapshot();
      this._saveSnapshot(this._model);
      // V19 C2 — persist multi-day history (1 snapshot/день, deduped).
      // Используется для 14-day sparkline trend в team-glance.
      // V20 S8 #16 — silent error → telemetry. Раньше quota-exceeded /
      // corrupt JSON проглатывались — пилот видит «нет тренда» без сигнала.
      try { saveDailySnapshot(this._model, projectKeys); }
      catch (e) { telemetryEmit('scanner2.silent_error', { where: 'saveDailySnapshot', msg: String(e?.message || e).slice(0, 100) }); }
      this._cancelled = false;
      this._errorMsg  = '';
      this._renderFull();
    } catch (e) {
      if (reqId !== this._reqId) return;
      if (e?.name === 'AbortError') return;
      const isTimeout = e?.name === 'TimeoutError' || /timeout|abort/i.test(String(e?.message || ''));
      const msg = isTimeout
        ? 'Запрос занял слишком много времени. Попробуйте уменьшить число проектных ключей.'
        : (e?.message || 'Ошибка запроса');
      console.warn('[TeamScanner2] fetch failed:', e);
      // V22 — typed integration failure (codebase-04 audit §6).
      try {
        const m = String(e?.message || '');
        const errType =
          isTimeout                       ? 'timeout' :
          /401|403|unauth/i.test(m)       ? 'auth' :
          /network|net::|fetch failed/i.test(m) ? 'network' :
          /5\d\d/.test(m)                 ? 'http_5xx' :
          /4\d\d/.test(m)                 ? 'http_4xx' :
                                            'unknown';
        telemetryEmit('integration.failure', { source: 'scanner2', errorType: errType, pks: projectKeys.slice(0, 12) });
      } catch (_) {}
      this._errorMsg = msg;
      this._paintError(msg);
    } finally {
      this._loading = false;
      this._loadingMsg = '';
      this._stopPhraseRotator();
    }
  },

  /**
   * V20 S5.1 — Auto-sync participants → state.employees.
   *
   * Проходит по `baseModel.participants` (ДО enrichForScanner2 → bot-filter,
   * чтобы боты тоже регистрировались с флагом isServiceAccount=true).
   * Для каждого user'а:
   *   · Skip если уже есть в registry по jiraAccountId (deterministic key).
   *   · Skip если у participant нет jiraAccountId (legacy / bad data).
   *   · Иначе создаёт через EmployeeFactory.create(...) с минимальным набором:
   *      - jiraAccountId (определённый ID)
   *      - email          (из Jira user object)
   *      - fio            (= participant.label = displayName из Jira)
   *      - sourceType: 'jira-auto'  (отличает от ручных)
   *   · Save через Reactive.silent (CLAUDE.md mass-mutation contract).
   *
   * После S5.1 Identity Auto-Resolve работает на ВСЕХ 110 participants,
   * не только на 17 ручных.
   */
  // F10: re-entry guard. Если pulse-callback re-entry'нется во время
  // sync (например через Storage.save → reactive flush → render → trigger
  // pulse refresh), вторая итерация попадёт в push без silent-block →
  // infinite loop. Простой mutex через флаг на singleton'е.
  _syncInFlight: false,
  // V22 S-10 (audit-experts-2026-05-15 Kravchenko S1-1) — раньше `_autoSyncDisabled`
  // ставился true при первой quota-ошибке и НИКОГДА не сбрасывался до
  // перезагрузки страницы. У тимлида с большой командой это значило: одна
  // ошибка → авто-синк мёртв до завтра. Теперь — exponential backoff:
  //   1) первая ошибка → блок на 30 секунд
  //   2) вторая подряд → 2 минуты
  //   3) третья → 8 минут
  //   4) max 1 час
  // После успешного sync счётчик сбрасывается. UI-кнопка «Повторить»
  // вызывает `_resetAutoSyncBackoff()` чтобы попробовать сразу.
  _autoSyncDisabledUntil: 0,
  _autoSyncFailureStreak: 0,
  _AUTO_SYNC_BACKOFF_MS: [30_000, 120_000, 480_000, 3_600_000],
  _isAutoSyncBlocked() {
    return Date.now() < this._autoSyncDisabledUntil;
  },
  _markAutoSyncFailure() {
    const streak = this._autoSyncFailureStreak;
    const idx = Math.min(streak, this._AUTO_SYNC_BACKOFF_MS.length - 1);
    const delay = this._AUTO_SYNC_BACKOFF_MS[idx];
    this._autoSyncDisabledUntil = Date.now() + delay;
    this._autoSyncFailureStreak = streak + 1;
    try {
      telemetryEmit('scanner2.auto_sync_backoff', { streak: this._autoSyncFailureStreak, delayMs: delay });
    } catch (_) {}
  },
  _resetAutoSyncBackoff() {
    this._autoSyncDisabledUntil = 0;
    this._autoSyncFailureStreak = 0;
  },
  _syncEmployeesFromParticipants(model) {
    if (!model || !Array.isArray(model.participants)) return;
    if (this._syncInFlight) {
      console.warn('[scanner2] sync re-entry detected, skipping');
      return;
    }
    if (this._isAutoSyncBlocked()) {
      // S-10: тихо пропускаем — backoff активен. UI может показать
      // «следующая попытка через Xs» через telemetry.
      return;
    }
    const ps = model.participants;
    if (!ps.length) return;

    // QF1: было `this._syncInFlight = true` ДО early-return на `!toCreate.length`.
    // Когда toCreate пустой (нечего создавать), функция возвращалась без сброса
    // флага → mutex deadlock. Теперь устанавливаем флаг ТОЛЬКО когда реально
    // собираемся мутировать state, и оборачиваем mutation в try/finally.
    // Index existing employees by jiraAccountId (lowercase trim).
    const empByJiraId = new Map();
    for (const e of (appState.employees || [])) {
      if (e.jiraAccountId) empByJiraId.set(String(e.jiraAccountId).toLowerCase().trim(), e);
    }

    const toCreate = [];
    for (const p of ps) {
      const ji = String(p.jiraAccountId || '').toLowerCase().trim();
      if (!ji) continue;            // нет identity — skip
      if (empByJiraId.has(ji)) continue;  // уже есть — skip
      toCreate.push({
        jiraAccountId: p.jiraAccountId,
        email:         String(p.email || '').toLowerCase().trim(),
        fio:           String(p.label || '').trim(),
        sourceType:    'jira-auto',
        jiraKey:       p.key || '',
      });
    }
    if (!toCreate.length) return;
    this._syncInFlight = true;

    // Mass-mutation в Reactive.silent — CLAUDE.md контракт #1.
    // V20 S7 B3 — Storage.save() вынесен ЗА silent-block. Внутри silent
    // _silentDepth>0; если save throws (quota exceeded) при счётчике > 0,
    // catch обрабатывает и silent-block корректно завершается. Внутри
    // silent логи storage.save могут заглушать listeners.
    // QF5: snapshot length до push'а, чтобы при QuotaExceededError откатить
    // диff (state в памяти не должен расходиться с диском). Раньше:
    // Reactive.silent() выполнял push'ы → save() падал → push'ы оставались
    // в памяти → следующий save() снова падал → infinite warn-loop +
    // diverged state.
    const _empLenBefore = (appState.employees || []).length;
    try {
      Reactive.silent(() => {
        for (const seed of toCreate) {
          const emp = EmployeeFactory.create(seed);
          delete emp.jiraKey;
          appState.employees.push(emp);
        }
      });
      try {
        Storage.save?.();
        // V22 S-10 — success! Сбрасываем backoff (если был).
        this._resetAutoSyncBackoff();
      } catch (e) {
        console.warn('[scanner2] storage.save failed, rolling back auto-created:', e);
        // QF5: rollback push'ей. V22 S-10: блокировка теперь временная
        // (exponential backoff), не permanent.
        Reactive.silent(() => {
          if (Array.isArray(appState.employees) && appState.employees.length > _empLenBefore) {
            appState.employees.length = _empLenBefore;
          }
        });
        this._markAutoSyncFailure();
        try { telemetryEmit('scanner2.auto_create_quota_exceeded', { count: toCreate.length, streak: this._autoSyncFailureStreak }); } catch (_) {}
        return; /* не считаем неудачную попытку успехом */
      }
      telemetryEmit('scanner2.auto_create_employees', {
        count: toCreate.length,
        totalParticipants: ps.length,
      });
      console.info(`[scanner2] auto-created ${toCreate.length} employees from Jira participants`);
    } finally {
      // F10: всегда сбрасываем mutex, даже при exception в push/save.
      this._syncInFlight = false;
    }
  },

  /* ── Render dashboard ──────────────────────────────── */
  _renderFull() {
    if (!this._container || !this._model) return;
    // V21 Phase 4 F2 — bump epoch для classifier-cache. Гарантирует:
    //   а) внутри одного _renderFull классификация для одного participant
    //      считается единожды (3 caller'а → 1 compute + 2 cache hit);
    //   б) при следующем _renderFull (после refresh / поменялся model)
    //      кэш считается «протухшим» через epoch increment.
    bumpClassifyEpoch();
    const m = this._model;
    // V18.3 A4 — apply pending share-link если model только что загружен.
    if (this._pendingShareKey) {
      const exists = (m.participants || []).some(p => p.key === this._pendingShareKey);
      if (exists) {
        this._expandedKey = this._pendingShareKey;
      } else if (typeof window !== 'undefined') {
        // V21 Phase 3 D3 — share-link на удалённого: вместо silent no-op показываем toast.
        // AUDIT_HOLISTIC Идея 14 — Toast.warn (canonical, закрывает legacy 'warn' vs 'warning').
        if (Services.Toast?.warn) Services.Toast.warn('Сотрудник по этой ссылке больше не работает в команде', { timeoutMs: 4000 });
        else window.showToast?.('Сотрудник по этой ссылке больше не работает в команде', 'warn', 4000);
      }
      this._pendingShareKey = '';
    }
    // Sync URL hash с current expandedKey.
    this._updateShareLinkHash();
    // V18.1 P7-S1.4 — push render-context (jiraBaseUrl) для построения
    // кликабельных issue.key links в blockers list + events feed.
    // Re-asserted на каждом render (settings могут поменяться).
    setRenderContext({ jiraBaseUrl: m.jiraBaseUrl || '' });
    // V18.1 P5 — side-panel рендерится КАК БРАТ root'а (position:fixed),
    // чтобы перекрывать всю область viewport, а не сидеть в content-area.
    const panelHtml = this._expandedKey
      ? renderEmployeeDetailPanel(m, this._expandedKey, { filters: this._panelFilters })
      : '';
    // V18.1 P7-S3.1 — aria-live region для panel open/close announcements.
    // V18.1 P7-S4.2 — prev snapshot для trend-deltas (если есть и не stale).
    const prev = this._prevSnapshot || null;
    // V19 C2 — multi-day history для sparkline (PO ask «какие новости?»).
    const { projectKeys } = this._readConfig();
    const history = (this._activeView !== 'multi') ? loadHistory(projectKeys, 14) : [];
    // V18.1 P7-S4.1 — multi-team view (Dmitry blocker). В режиме multi
    // — render table сводок по командам вместо per-person rows.
    // V18.3 A5b — pk-filter применяется к team-view (single).
    let filteredModel = (this._activePkFilter && this._activeView === 'team')
      ? this._applyPkFilter(m, this._activePkFilter)
      : m;
    // V20 S12 U9 — поверх pk-filter применяем search-by-name (case-insensitive
    // substring match по label).
    // V21 Phase 4 F1 — memoize filteredParticipants по (data-shape, query).
    // Cache очищается при refresh()/unmount() и автоматически при смене shape
    // (через dataKey hash). Логика filter'а не меняется — только обёртка.
    if (this._searchQuery && this._searchQuery.length >= 1) {
      filteredModel = {
        ...filteredModel,
        participants: _filterParticipantsByQuery(
          filteredModel.participants,
          this._searchQuery,
        ),
      };
    }
    // V20 S8.5 fix — TDZ guard: все ctx-переменные должны быть declared
    // ДО построения bodyHtml/html template literals. Раньше anomalies +
    // sprintGoalSlope использовались в bodyHtml, но declared после — ReferenceError.
    // V20 S1.1 + S1.5 — cache age telemetry для stale-banner.
    const cacheAgeMs = this._cacheAgeMs();
    const isStale    = this._isCacheStale();
    // V20 S7 A4 — slope для топбара, считается на лету из history.
    const sprintGoalSlope = history.length >= 3 ? computeSprintGoalSlope(history) : null;
    // V20 S8.5 #19 — known-issues count для badge на «📋 Диагностика».
    const lightDiagState = gatherDiagnosticState({
      model:           m,
      cacheAgeMs:      this._cacheAgeMs(),
      employees:       appState.employees || [],
    });
    const knownIssuesCount = countKnownIssues(lightDiagState);
    // V20 S7 A5 — Z-score per group для anomaly badges. Минимум 4 точки.
    const anomalies = (() => {
      if (history.length < 4) return null;
      const ser = (path) => history.map(h => path.split('.').reduce((acc, k) => acc?.[k], h) || 0);
      return {
        stop:   computeZScore(ser('counts.stop')),
        watch:  computeZScore(ser('counts.watch')),
        moving: computeZScore(ser('counts.moving')),
        idle:   computeZScore(ser('counts.idle')),
      };
    })();
    const bodyHtml = this._activeView === 'multi'
      ? renderMultiTeamView(m)
      : `
        ${renderTeamGlance(filteredModel, { prev, pkFilter: this._activePkFilter, history, anomalies, sprintGoalSlope })}
        ${renderPersonRows(filteredModel, { expandedKey: this._expandedKey, prev })}`;
    // V20 S10.1 — текущее состояние toggle и сколько `[X]`-юзеров
    // отфильтровано (для подсказки в menu-item).
    let showBlocked = false;
    try { showBlocked = localStorage.getItem('q2_scanner_show_blocked') === '1'; }
    catch (_) { /* ignore */ }
    const deactivatedCount = (m.deactivatedFilteredOut || []).length;
    // V20 S10.6 — текущее состояние active-sprint toggle (default ON).
    let activeSprintOnly = true;
    try {
      const v = localStorage.getItem('q2_scanner_active_sprint_only');
      if (v === '0') activeSprintOnly = false;
    } catch (_) { /* ignore */ }
    const sprintFilter = m.scannerV2?.activeSprintFilter || {};
    // PR-CC — comparison переехал в модалку, inline-render убран.
    // Toggle в kebab открывает модалку через _openVelocityCompareModal.
    const velocityCompareOn = false;
    // V20 S10.5 — apply persisted team selection при первом рендере (если
    // user не делал явный switch в этой сессии). _initialTeamApplied
    // одноразовый флаг чтобы не затирать ручной выбор.
    if (!this._initialTeamApplied) {
      this._applyPersistedTeamSelection(m);
      this._initialTeamApplied = true;
    }
    const html = `
      <div class="ts2-root${this._demoMode ? ' ts2-root-demo' : ''}">
        ${renderTopBar(m, { prev, activeView: this._activeView, cacheAgeMs, isStale, sprintGoalSlope, knownIssuesCount, showBlocked, deactivatedCount, activeSprintOnly, sprintFilter, velocityCompareOn, isDemo: this._demoMode })}
        ${renderTeamSwitcher(m, { activeView: this._activeView, activePkFilter: this._activePkFilter, sprintFilter, searchQuery: this._searchQuery || '' })}
        ${bodyHtml}
      </div>
      <div class="ts2-aria-live" aria-live="polite" aria-atomic="true" id="ts2-aria-live"></div>
      ${this._expandedKey ? `<div class="ts2-panel-backdrop" id="ts2-panel-backdrop"></div>${panelHtml}` : ''}
    `;
    // V21 audit A1 — снимаем старые ECharts instance'ы ДО innerHTML rewrite,
    // иначе ~60 чартов остаются «висеть» в памяти при каждом scanner re-paint
    // (search keystroke, refresh, switch team). На длинной сессии — десятки
    // зомби-instance'ов и animation loops.
    // F-PERF-2 — dispose+remount только когда реально перерисовываем metrics tab.
    // На search/refresh/non-metrics переключатели (glance/people/...) — skip,
    // там нет metrics-scaffold'а, unmount просто чистит global listeners впустую
    // и тормозит scanner re-paint.
    if (getScannerTab() === 'metrics') {
      try { MetricsDeep.unmount(this._container); } catch (_) {}
    }
    this._container.innerHTML = html;
    this._bindEvents();
    this._promoteTitlesToTooltips();
    // 2026-05-17 — synchronize body class с актуальным состоянием DOM.
    // _renderFull вызывается из refresh / team-switch / active-sprint-toggle
    // и т.д. — после rewrite container'а нужно подтянуть body-class на
    // случай если есть открытые модалки (panel/diag/how/etc.). Helper
    // проверяет DOM а не флаг — drift-safe.
    this._syncModalClass();
    // V21 — если активна вкладка «Метрики», инжектируем scaffold + монтируем
    // ECharts. Renderer оставил пустой `#ts2-metrics-mount` — заполняем его
    // здесь (а не внутри renderer'а), потому что mount требует реального DOM.
    if (getScannerTab() === 'metrics') {
      const mountEl = this._container.querySelector('#ts2-metrics-mount');
      if (mountEl) {
        // V21 audit P3/R4 — вместо хрупкого `data-needs-charts` флага: проверяем
        // наличие scaffold'а и instance'ов. Re-mount триггерится автоматически
        // когда scanner перерисовался и canvas-div'ы свежие (без instance'ов).
        const needScaffold = !mountEl.querySelector('.md-deep');
        if (needScaffold) {
          mountEl.innerHTML = MetricsDeep.renderHtml(m);
        }
        if (needScaffold || MetricsDeep.needsMount(mountEl)) {
          // mount() async (await import ECharts, ~1MB lazy-load). Не блокируем paint().
          Promise.resolve().then(() => MetricsDeep.mount(mountEl, m)).catch(e => {
            try { console.warn('[scanner] metrics mount failed:', e); } catch (_) {}
          });
        }
      }
    }
    // V18.1 P7-S3.1 — focus management + announcement при открытии panel.
    if (this._expandedKey) {
      const panel = this._container.querySelector('#ts2-panel-main');
      // Async чтобы DOM закончил commit перед focus.
      if (panel) requestAnimationFrame(() => panel.focus());
      const p = (m.participants || []).find(x => x.key === this._expandedKey);
      this._announce(`Открыта детализация по сотруднику ${p?.label || ''}`);
    }
  },

  /**
   * V18.3 A5b — клонирует model с отфильтрованными participants.
   * Filter: оставить только тех у кого pk in p.projects. Sprint-goal,
   * risks и spaces НЕ фильтруются — они per-pk сами по себе.
   */
  _applyPkFilter(model, pk) {
    if (!model || !pk) return model;
    const filteredParticipants = (model.participants || []).filter(
      p => Array.isArray(p.projects) && p.projects.includes(pk),
    );
    // UX feedback 2026-05-10 (Sc2) — topbar values «↗ +X%/день», «CR Yч»,
    // «MTTR …» рендерились из global aggregates (`scannerV2.codeReviewVelocity`
    // / `prThroughput`) которые keyed по всем участникам всех команд. После
    // переключения команды цифры не менялись. Решение: per-PK filter aggregate
    // maps по allowed participant keys (тот же набор что в filteredParticipants).
    const allowedKeys = new Set(filteredParticipants.map(p => p.key).filter(Boolean));
    const sV2 = model.scannerV2 || {};
    const filterByKey = (map) => {
      if (!map || typeof map !== 'object') return map;
      const out = {};
      for (const k of Object.keys(map)) {
        if (allowedKeys.has(k)) out[k] = map[k];
      }
      return out;
    };
    return {
      ...model,
      participants: filteredParticipants,
      scannerV2: {
        ...sV2,
        codeReviewVelocity: filterByKey(sV2.codeReviewVelocity),
        prThroughput:       filterByKey(sV2.prThroughput),
      },
    };
  },

  /* ── V20 S10.5 — Persistent team selection ───────────────
   * `localStorage.q2_scanner2_selectedTeam` хранит выбор:
   *   '__all__'         → multi-team aggregate view
   *   '<pk>' (e.g. CORE) → single-team view с фильтром по pk
   *   '' / null         → fallback на первый pk alphabetical
   *
   * При смене → telemetry + persist + repaint (без re-fetch). */
  _LS_SELECTED_TEAM_KEY: 'q2_scanner2_selectedTeam',

  _readSelectedTeamFromStorage() {
    // V20 S11.1 BUG-3 — robust corruption guards:
    // localStorage может вернуть string 'undefined' / 'null' (старый bug
    // в JSON.stringify(undefined)) → нужно явно отфильтровать; также
    // гарантируем что результат — строка простого формата без \n / spaces.
    try {
      const raw = localStorage.getItem(this._LS_SELECTED_TEAM_KEY);
      if (typeof raw !== 'string' || raw === '') return '';
      const trimmed = raw.trim();
      if (trimmed === 'undefined' || trimmed === 'null' || trimmed === 'NaN') return '';
      // Допускаем только: '__all__' OR alphanumeric pk (Jira project keys
      // могут быть до 10 chars, [A-Z0-9_]). Всё остальное = corrupted → '' .
      if (trimmed === '__all__') return '__all__';
      if (/^[A-Z0-9_]{1,32}$/i.test(trimmed)) return trimmed;
      return '';
    } catch (_) { return ''; }
  },

  _persistSelectedTeam(value) {
    try {
      // Защита от записи мусора: only validated values.
      const safe = (typeof value === 'string') ? value : '';
      localStorage.setItem(this._LS_SELECTED_TEAM_KEY, safe);
    } catch (_) { /* ignore quota / disabled storage */ }
  },

  /** Применить сохранённый выбор команды при первом рендере. Если selected pk
   *  больше нет в model.projectKeys — fallback на первый pk. */
  _applyPersistedTeamSelection(model) {
    const stored = this._readSelectedTeamFromStorage();
    const pks = (model?.projectKeys || []).slice().sort();
    if (stored === '__all__') {
      this._activeView = 'multi';
      this._activePkFilter = '';
      return;
    }
    if (stored && pks.includes(stored)) {
      this._activeView = 'team';
      this._activePkFilter = stored;
      return;
    }
    // Storage пуст, либо команда исчезла — fallback на первую (alphabetical).
    if (pks.length > 1) {
      this._activeView = 'team';
      this._activePkFilter = pks[0];
    }
    // pks.length <= 1 → ничего не меняем (для 1 команды switcher скрыт).
  },

  _setSelectedTeam(pk) {
    this._activeView = 'team';
    this._activePkFilter = String(pk || '');
    this._persistSelectedTeam(this._activePkFilter);
    telemetryEmit('scanner2.team_switch', { pk: this._activePkFilter });
    // 2026-05-17 — раньше тут был `_closePanel()` с комментарием "closePanel
    // вызывает _renderFull". После рефакторинга _closePanel стал partial
    // (без _renderFull) — команды перестали переключаться визуально (state
    // менялся, но dashboard оставался прежним → пользователь видел только
    // "мерцание" удаляемой панели). Теперь явно: сброс expandedKey + body
    // class + полный re-render.
    this._expandedKey = '';
    document.body.classList.remove('is-ts2-modal-open');
    this._renderFull();
  },

  _setMultiView() {
    this._activeView = 'multi';
    this._activePkFilter = '';
    this._persistSelectedTeam('__all__');
    telemetryEmit('scanner2.team_switch', { pk: '__all__' });
    this._expandedKey = '';
    document.body.classList.remove('is-ts2-modal-open');
    this._renderFull();
  },

  /**
   * PR-CM — переносит атрибут `title` в `data-tip`, чтобы кастомный
   * CSS-tooltip срабатывал быстро (60 мс задержки) и красиво (spine-pill
   * стиль, многострочный, с тенью). Браузерный default ждёт ~700 мс.
   * SVG-`<title>` элементы внутри Sankey не трогаются (они работают
   * иначе — это child-нода SVG, не атрибут).
   */
  _promoteTitlesToTooltips() {
    if (!this._container) return;
    this._container.querySelectorAll('[title]').forEach(el => {
      // SVG <title> — это дочерний элемент, не атрибут; не наш кейс.
      if (el.tagName === 'title') return;
      const t = el.getAttribute('title');
      if (!t) return;
      el.setAttribute('data-tip', t);
      el.removeAttribute('title');
    });
  },

  /**
   * 2026-05-17 — single source of truth для body.is-ts2-modal-open class.
   * Раньше каждая модалка (panel/diag/how/anomaly/resolve/crv/config/velocity)
   * имела свой open/close handler без синхронизации body-класса. CSS-rule'ы
   * жили через `html:has(...)` — root-level recompute на каждый модал.
   *
   * Теперь: вызываем `_syncModalClass()` после каждого open/close. Метод
   * проверяет наличие ЛЮБОЙ ts2-модалки в DOM и toggle'ит class. Идемпотентно,
   * не зависит от counter'ов (drift-safe).
   *
   * Используется CSS-rule'ом `body.is-ts2-modal-open .app-section { transform:
   * none; ... }` для отмены containing block у .app-section (иначе fixed-modal
   * позиционируется относительно секции, а не viewport).
   */
  _syncModalClass() {
    if (typeof document === 'undefined') return;
    const hasModal = !!document.querySelector(
      '.ts2-panel, .ts2-panel-backdrop, ' +
      '.ts2-diag-modal-overlay, .ts2-how-modal-overlay, ' +
      '.ts2-anomaly-modal-overlay, .ts2-resolve-modal-overlay, ' +
      '.ts2-crv-modal-overlay, .ts2-velocity-compare-modal-overlay, ' +
      '#ts2-config-modal'
    );
    document.body.classList.toggle('is-ts2-modal-open', hasModal);
  },

  /** V18.1 P7-S3.1 — text announcement для SR'а через aria-live polite. */
  _announce(msg) {
    const el = this._container?.querySelector('#ts2-aria-live');
    if (!el) return;
    el.textContent = '';   // force re-announce при том же текст
    requestAnimationFrame(() => { el.textContent = String(msg || ''); });
  },

  /**
   * V18.1 P7-S2.4 — split events на dashboard-events (row clicks, refresh)
   * и panel-events (close, filters, esc). Это позволяет filter-pill click
   * перерендеривать ТОЛЬКО panel (~700 nodes) вместо full dashboard
   * (~2200 nodes). Re-render с 150мс → 30-40мс.
   */
  _bindEvents() {
    this._bindDashboardEvents();
    this._bindPanelEvents();
  },

  _bindDashboardEvents() {
    const root = this._container;
    if (!root) return;
    // QF2: in-flight guard. Раньше двойной клик во время загрузки = два
    // параллельных fetch'а + race на jobId. Согласовано с тогглами [X]/active-sprint
    // (1468, 1483) которые имеют такой же guard.
    root.querySelector('#ts2-refresh-btn')?.addEventListener('click', () => {
      if (this._loading) return;
      this.refresh();
    });
    // V22 C1 — SSO-banner CTA. Открывает settings-modal на табе Confluence
    // через существующий glоbal `window.openIntegrationsSettings(tab)`. Если
    // функция не зарегистрирована (e.g. Сканнер открыт до bootstrap'а app.js)
    // — graceful no-op.
    root.querySelectorAll('[data-ts2-open-settings]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-ts2-open-settings') || 'confluence';
        try { window.openIntegrationsSettings?.(tab); }
        catch (e) { console.warn('[scanner2] openIntegrationsSettings failed', e); }
      });
    });
    // V21 identity-banner CTA — открывает Diagnostic-modal и сразу триггерит
    // _runIdentityResolve (existing flow в S4). Inline-кнопка делает Auto-
    // Resolve видимым в основном UI Сканнера, не только в Diagnostic.
    // 2026-05-17 (D2/D3 fix) — переключили на _runBulkIdentityResolve
    // (без preview-modal) — пользователь хочет «починить identity» одним
    // кликом, preview-flow требовал лишних 3 кликов в Diagnostic.
    root.querySelector('#ts2-glance-resolve-btn')?.addEventListener('click', () => {
      this._openDiagModal();
      // Дать modal'у отрендериться — потом найти bulk-resolve-btn внутри и кликнуть.
      setTimeout(() => {
        const overlay = document.getElementById('ts2-diag-modal');
        if (!overlay) return;
        const btn = overlay.querySelector('#ts2-diag-bulk-resolve-btn')
                 || overlay.querySelector('#ts2-diag-resolve-btn');
        if (btn) btn.click();
      }, 80);
    });
    // 2026-05-17 (D2/D3 fix) — dismiss identity-coverage banner на 7 дней.
    root.querySelector('#ts2-id-banner-dismiss')?.addEventListener('click', (e) => {
      e.stopPropagation();
      try { localStorage.setItem('q2_id_banner_dismissed_at', String(Date.now())); }
      catch (_) { /* ignore quota */ }
      const banner = e.currentTarget.closest('.ts2-id-banner');
      if (banner) banner.remove();
    });
    // V21 π5 — exit-demo handler. Только присутствует если model.isDemo.
    root.querySelector('#ts2-demo-exit')?.addEventListener('click', () => this.exitDemo());
    // V20 S8 #5 — Kebab toggle. Click-outside / Esc — закрывает меню.
    // V21 Phase 4 F3 — AbortController для всех listener'ов на document
    // и .ts2-kebab-item. Аудит F5: каждое open kebab подписывало handler'ы
    // (`outsideClick`, `escKebab`), при close removeEventListener срабатывал
    // только для тех замыканий, что хранили closure. Пере-bind в _renderFull
    // сохранял orphan handler'ы — листер leaked.
    // Решение: единый AbortController per «открытие», abort() на close
    // снимает all-at-once. unmount() abort'ит финальный.
    const kebabBtn = root.querySelector('#ts2-kebab-btn');
    const kebabMenu = root.querySelector('#ts2-kebab-menu');
    if (kebabBtn && kebabMenu) {
      const closeKebab = () => {
        kebabMenu.hidden = true;
        kebabBtn.setAttribute('aria-expanded', 'false');
        // Снимаем outside-click + esc + per-item handler'ы одним abort'ом.
        try { this._kebabAbort?.abort(); } catch (_) { /* ignore */ }
        this._kebabAbort = null;
      };
      kebabBtn.addEventListener('click', () => {
        const open = kebabMenu.hidden;
        kebabMenu.hidden = !open;
        kebabBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          // Создаём новый AbortController на каждое открытие; signal
          // привязывается ко всем listener'ам этого «жизненного цикла».
          // Защитимся от утечки — если уже есть pending abort, abort'им его.
          try { this._kebabAbort?.abort(); } catch (_) { /* ignore */ }
          this._kebabAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const signal = this._kebabAbort?.signal;
          const opts = signal ? { signal } : false;
          const outsideClick = (ev) => {
            if (!kebabMenu.contains(ev.target) && ev.target !== kebabBtn) closeKebab();
          };
          const escKebab = (ev) => { if (ev.key === 'Escape') closeKebab(); };
          // Регистрация click-outside нужна в setTimeout чтобы текущий click не закрыл сразу.
          setTimeout(() => {
            // Возможно за время setTimeout уже abort'нули (быстрое 2-е toggle).
            if (signal && signal.aborted) return;
            document.addEventListener('click', outsideClick, opts);
            document.addEventListener('keydown', escKebab, opts);
          }, 0);
          // Auto-close kebab при click-on-item (chooser-pattern). Listener'ы
          // на .ts2-kebab-item теперь signaled — снимаются вместе с outside/esc.
          kebabMenu.querySelectorAll('.ts2-kebab-item').forEach(item => {
            item.addEventListener('click', () => closeKebab(), opts);
          });
        } else {
          // Закрытие через сам toggle-button — снимаем listener'ы того же
          // life-cycle через abort. Без этого outsideClick/escKebab оставались
          // подписанными до следующего close.
          try { this._kebabAbort?.abort(); } catch (_) { /* ignore */ }
          this._kebabAbort = null;
        }
      });
    }
    // V18.1 P7-S4.1 — view toggle (team ↔ multi). Дублирует функциональность
    // segmented-tabs (S10.5) но остаётся как backward-compat для рабочего
    // потока «kebab → По командам» (некоторые тимлиды уже привыкли).
    root.querySelector('#ts2-view-toggle')?.addEventListener('click', () => {
      if (this._activeView === 'multi') {
        // Возврат в team-view — берём last-selected из localStorage или первый pk.
        this._applyPersistedTeamSelection(this._model);
        if (this._activeView === 'multi') this._activeView = 'team'; // safety
      } else {
        this._setMultiView();
        return;
      }
      telemetryEmit('scanner2.view_change', { mode: this._activeView });
      this._closePanel();
    });
    // V20 S10.5 — segmented team-switcher tabs.
    root.querySelectorAll('[data-switch-team]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pk = btn.dataset.switchTeam || '';
        if (pk === '__all__') this._setMultiView();
        else                  this._setSelectedTeam(pk);
      });
    });
    // V20 S12 U9 — search by name input. Debounced чтобы не re-render
    // на каждый keystroke.
    // V21 Phase 4 F1 — debounce поднят с 150ms до 200ms (per audit code-perf
    // F6 — full _renderFull на 109 participants × 20+ insights helpers
    // слишком тяжёл при 150ms; 200ms всё ещё ощущается responsive).
    // Лениво создаём debounced handler один раз и переиспользуем — clearTimeout
    // на свежем замыкании каждый rebind разоряет логику. Хранится на orchestrator'е.
    const searchEl = root.querySelector('#ts2-search-input');
    if (searchEl) {
      if (!this._searchInputHandler) {
        this._searchInputHandler = _debounce((value) => {
          this._searchQuery = value || '';
          this._renderFull();
          // После re-render фокус на поле теряется — восстанавливаем.
          const newEl = this._container?.querySelector('#ts2-search-input');
          if (newEl) {
            newEl.focus();
            const len = newEl.value.length;
            try { newEl.setSelectionRange(len, len); } catch (_) {}
          }
        }, 200);
      }
      searchEl.addEventListener('input', (e) => {
        this._searchInputHandler(e.target.value || '');
      });
      searchEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchEl.value = '';
          this._searchQuery = '';
          this._renderFull();
        }
      });
    }
    // V20 S12 U9 — global `/` shortcut → focus search.
    if (!this._slashHandler) {
      this._slashHandler = (e) => {
        if (e.key !== '/') return;
        // Пропускаем когда курсор уже в input/textarea/contenteditable.
        const t = e.target;
        const tag = (t?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
        // Пропускаем когда сканер не виден.
        const input = this._container?.querySelector('#ts2-search-input');
        if (!input) return;
        e.preventDefault();
        input.focus();
        input.select();
      };
      // TECH 17.3 — привязка через global AbortController. unmount() делает
      // один abort() и снимает листенер скопом.
      const _slashSignal = this._getGlobalAbortSignal();
      document.addEventListener('keydown', this._slashHandler, _slashSignal ? { signal: _slashSignal } : false);
    }
    // V20 S10.1 — toggle «Показать заблокированных» ([X]-юзеры).
    // V20 S11.1 BUG-4 — guard от race при быстрых кликах: если уже идёт
    // refresh — игнорируем последующие клики (debounce by in-flight flag).
    // Это лучше debounce-таймера: пользователь сразу видит что toggle
    // не реагирует, не висит «хм, кликнул, ничего не произошло».
    root.querySelector('#ts2-show-blocked-toggle')?.addEventListener('click', () => {
      if (this._loading) {
        telemetryEmit('scanner2.toggle_blocked_during_load', {});
        return;
      }
      let curr = false;
      try { curr = localStorage.getItem('q2_scanner_show_blocked') === '1'; } catch (_) { /* ignore */ }
      const next = !curr;
      try { localStorage.setItem('q2_scanner_show_blocked', next ? '1' : '0'); } catch (_) { /* ignore */ }
      telemetryEmit('scanner2.show_blocked_toggle', { value: next });
      this.refresh();
    });
    // V20 S10.6 — toggle «Только активный спринт». Default ON → '0' OFF.
    // Filter применяется на enrichment-stage (затрагивает classifier counts),
    // нужен fresh fetch для корректного re-build heatmap/blockers/sparkline.
    root.querySelector('#ts2-active-sprint-toggle')?.addEventListener('click', () => {
      if (this._loading) {
        telemetryEmit('scanner2.toggle_blocked_during_load', {});
        return;
      }
      // Default ON, читаем «инверсно»: storage===0 → currently OFF.
      let currOn = true;
      try { if (localStorage.getItem('q2_scanner_active_sprint_only') === '0') currOn = false; }
      catch (_) { /* ignore */ }
      const nextOn = !currOn;
      try { localStorage.setItem('q2_scanner_active_sprint_only', nextOn ? '1' : '0'); }
      catch (_) { /* ignore */ }
      telemetryEmit('scanner2.active_sprint_toggle', { value: nextOn });
      // V22 fix #10 (2026-05-09) — в demo-режиме refresh() ходит в реальный
      // API; нужно перезагрузить fixture и пропустить через enrichment.
      if (this._demoMode) {
        this.loadDemo();
      } else {
        this.refresh();
      }
    });
    // PR-CC — «Сравнение команд» теперь открывается модалкой, не inline-блок.
    root.querySelector('#ts2-velocity-compare-toggle')?.addEventListener('click', () => {
      telemetryEmit('scanner2.velocity_compare_open', {});
      this._openVelocityCompareModal();
    });
    // PR-DD — tabbed-tiles. Click по tab-btn → меняем data-sd-active-tab,
    // persist в localStorage. Ничего не пере-рендерит — CSS скрывает не-active.
    const tabBlock = root.querySelector('.ts2-sd-block[data-sd-active-tab]');
    const tabBtns  = root.querySelectorAll('.ts2-sd-tab-btn[data-sd-tab]');
    if (tabBlock && tabBtns.length) {
      let savedTab = 'all';
      try { savedTab = localStorage.getItem('q2_scanner_sd_tab') || 'all'; } catch (_) { /* ignore */ }
      // Применить сохранённую вкладку при первом рендере.
      const applyTab = (tab) => {
        tabBlock.dataset.sdActiveTab = tab;
        tabBtns.forEach(b => b.classList.toggle('ts2-sd-tab-active', b.dataset.sdTab === tab));
      };
      applyTab(savedTab);
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.sdTab || 'all';
          applyTab(tab);
          try { localStorage.setItem('q2_scanner_sd_tab', tab); } catch (_) { /* ignore */ }
          telemetryEmit('scanner2.sd_tab_switch', { tab });
        });
      });
    }
    // V20 S13 N2 — copy narrative markdown в clipboard для 1:1 в TG/Slack.
    root.querySelectorAll('.ts2-narrative-copy[data-narrative-md]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const md = btn.dataset.narrativeMd || '';
        if (!md) return;
        try {
          await navigator.clipboard.writeText(md);
          const orig = btn.textContent;
          btn.textContent = 'Скопировано';
          setTimeout(() => { btn.textContent = orig; }, 1500);
          telemetryEmit('scanner2.narrative_copy', { len: md.length });
        } catch (e) {
          telemetryEmit('scanner2.silent_error', { where: 'narrative_copy', msg: String(e?.message || e).slice(0, 100) });
        }
      });
    });
    // V20 S11 Z7 — переключение режима внутри velocity comparison
    // (bar / leaderboard / trend).
    root.querySelectorAll('[data-velocity-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.velocityView;
        if (mode !== 'bar' && mode !== 'leaderboard' && mode !== 'trend') return;
        try { localStorage.setItem('q2_scanner_velocity_view', mode); }
        catch (_) { /* ignore */ }
        telemetryEmit('scanner2.velocity_view_change', { mode });
        this._renderFull();
      });
    });
    // V18.3 A1 — gear button → open team-config modal.
    root.querySelector('#ts2-config-btn')?.addEventListener('click', () => {
      this._openConfigModal();
    });
    // V20 S1.4 — «Как считается» modal: открывается из topbar.
    root.querySelector('#ts2-how-btn')?.addEventListener('click', () => {
      telemetryEmit('scanner2.how_open', {});
      this._openHowModal();
    });
    // V20 S2.3 — «Диагностика» modal: per-source counts + identity-coverage
    // + JSON export. Доступна даже без cache (показывает «fetch не запускался»).
    root.querySelector('#ts2-diag-btn')?.addEventListener('click', () => {
      telemetryEmit('scanner2.diag_open', { hasModel: !!this._model });
      this._openDiagModal();
    });
    // Standalone HTML-бриф выбранной команды: тот же список людей, что в
    // Сканнере, но каждая строка раскрывается в полную карточку (контент
    // detail-panel'и). Только в single-team view — kebab-item рендерится
    // только когда ctx.activeView !== 'multi'.
    root.querySelector('#ts2-brief-export-btn')?.addEventListener('click', () => {
      this._exportBrief();
    });
    root.querySelector('#ts2-brief-export-v2-btn')?.addEventListener('click', () => {
      this._exportBriefV2();
    });
    // V20 S1.5 — stale-banner refresh button (cache > 5min).
    root.querySelector('#ts2-stale-refresh')?.addEventListener('click', () => {
      telemetryEmit('scanner2.stale_refresh_click', { ageMs: this._cacheAgeMs() });
      this.refresh();
    });
    // 2026-05-12 — History date-picker handler. Onchange — загружаем
    // snapshot на выбранную дату через loadHistoryAtDate + repaint.
    root.querySelectorAll('[data-ts2-history-date]').forEach(input => {
      input.addEventListener('change', async (ev) => {
        const isoDate = ev.target?.value;
        if (!isoDate) return;
        try {
          const { loadHistoryAtDate } = await import('./teamScanner2History.js');
          const cfg = this._readConfig();
          const snap = loadHistoryAtDate(cfg.projectKeys || [], isoDate);
          if (snap) {
            this._historyOverride = snap;
            this._renderFull?.();
            try { window.showToast?.(`History: ${isoDate} loaded`, 'success', 3000); } catch (_) {}
          } else {
            try { window.showToast?.(`Нет snapshot'а на ${isoDate}`, 'warn', 3000); } catch (_) {}
          }
        } catch (e) {
          console.warn('[scanner2] history date-picker:', e?.message || e);
        }
      });
    });
    // V18.3 A5a — group-jump: click по counter в team-glance → scroll
    // к соответствующей группе rows. Anna PO finding.
    root.querySelectorAll('.ts2-glance-jump[data-jump-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = root.querySelector(`[data-group-anchor="${btn.dataset.jumpGroup}"]`);
        if (!target) return;
        // Если target — <details> и closed — открыть.
        if (target.tagName === 'DETAILS' && !target.open) target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // V21 Phase 3 E2 — flash target после scroll (готовый класс .ts2-btn-flash).
        flashAnchorTarget(target);
      });
    });
    // V20 S8 #3 — triage-pill click → открыть карточку участника (как row click).
    // V20 S10.7 — также reuse для .ts2-lag-person-link (Top stuck в drill-down).
    root.querySelectorAll('.ts2-triage-pill-item[data-jump-key], .ts2-lag-person-link[data-jump-key], .ts2-glance-help-item[data-jump-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.jumpKey;
        if (!key) return;
        this._expandedKey = key;
        telemetryEmit('scanner2.triage_jump', { source: btn.classList.contains('ts2-lag-person-link') ? 'sprint_lag' : 'triage_pill' });
        this._renderFull();
      });
    });
    // V20 S8.5 #18 — inline «💬 1:1» в pill: copy talking-points сразу из glance.
    root.querySelectorAll('.ts2-triage-pill-1on1[data-1on1-key]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();     // не triggerим jump-to-card
        const key = btn.dataset['1on1Key'] || btn.getAttribute('data-1on1-key');
        if (!key || !this._model) return;
        const p = (this._model.participants || []).find(x => x.key === key);
        if (!p) return;
        const blockers = (p.blockers || []).slice(0, 3);
        const lines = [
          `1:1 talking points — ${p.label || p.key}`,
          `Сегодня: ${(p.timelineToday || []).length} событий · WIP ${(p.issuesNow || []).length}`,
          // AUDIT_ARTDIRECTION #35 / AUDIT_COPY #40 — без эмодзи в production
          // (брендбук §1 spine-pill ban). Текст без украшений; renderer-сторона
          // при необходимости подставит SVG-иконку (Icons.get('alert-octagon')).
          ...(blockers.length ? ['Блокеры:'] : []),
          ...blockers.map(b => `  · ${b.key} «${(b.summary || '').slice(0, 50)}» — ▌${b.dwellHours || 0}ч`),
          '',
          'Что обсудить:',
          '· Что мешает закрыть зависшие задачи?',
          '· Чем могу помочь?',
          '· Реалистичные сроки на этот спринт?',
        ];
        try {
          await navigator.clipboard.writeText(lines.join('\n'));
          const orig = btn.textContent;
          btn.textContent = 'OK';
          setTimeout(() => { btn.textContent = orig; }, 1200);
          telemetryEmit('scanner2.triage_1on1', {});
        } catch (e) { console.warn('[scanner2] 1on1 from pill failed:', e); }
      });
    });
    // V20 S8 #2 — CR-bar click → drill-down modal со списком долгих ревью.
    root.querySelector('#ts2-glance-crv-drilldown')?.addEventListener('click', () => {
      telemetryEmit('scanner2.crv_drilldown_open', {});
      this._openCrvDrilldown();
    });
    // V20 S8.5 #20 — anomaly badge click → mini-chart modal.
    root.querySelectorAll('[data-anomaly-metric]').forEach(btn => {
      btn.addEventListener('click', () => {
        const metricLabel = btn.dataset.anomalyMetric || '';
        telemetryEmit('scanner2.anomaly_drilldown_open', { metric: metricLabel });
        this._openAnomalyChart(metricLabel);
      });
    });
    // V18.1 P7-S4.1 + V18.3 A5b — click по team-row в multi-view →
    // переключает в team-view + фильтрует participants по этой pk.
    // Anna PO finding: «click team-row в multi-view → реальный фильтр
    // participants по pk (сейчас просто toggle вида)».
    root.querySelectorAll('.ts2-team-row[data-team-pk]').forEach(el => {
      el.addEventListener('click', () => {
        // V20 S10.5 — переиспользуем _setSelectedTeam чтобы выбор
        // персистился в localStorage (раньше click из multi-view не сохранялся).
        this._setSelectedTeam(el.dataset.teamPk || '');
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    });
    // V18.3 A5b — clear pk-filter button.
    root.querySelector('#ts2-pk-filter-clear')?.addEventListener('click', () => {
      this._activePkFilter = '';
      this._renderFull();
    });
    // Click по строке → открыть/закрыть side-panel.
    // V18.1 P7-S1.5 — keyboard activation Enter/Space (WCAG 2.1.1).
    // 2026-05-17 — заменили `_renderFull()` (~2200 nodes innerHTML rewrite)
    // на partial-update: переключаем `.ts2-row-expanded` class руками +
    // вставляем/убираем panel через `_renderPanelOnly()` / `_closePanel()`.
    // Раньше пользователь видел «2 jerk'а экрана»: 1) полный rebuild
    // dashboard'а, 2) slide-in модалки. Теперь только slide-in.
    root.querySelectorAll('.ts2-row[data-key]').forEach(el => {
      const activate = (e) => {
        if (e.target.closest('a, button')) return;
        const key = el.dataset.key;
        const opening = (this._expandedKey !== key);
        const wasExpanded = !!this._expandedKey;
        this._expandedKey = opening ? key : '';
        // V19 C4 — telemetry: detail-panel open/close (понимаем drill-down rate).
        if (opening) telemetryEmit('scanner2.detail_open', { mode: this._activeView });
        else         telemetryEmit('scanner2.detail_close', { trigger: 'row_toggle' });
        // V22 X-02 / K-03 (audit-experts-2026-05-15 Selvadurai #1) —
        // production call-site #3: при клике на participant ставим Focus
        // на сотрудника. Реестр / Гант / Чат подхватят через EventBus.
        // identity-deterministic: предпочитаем email > jiraAccountId > key.
        // Не вызываем при collapse (opening===false) — закрытие не
        // меняет «активный» контекст.
        if (opening) {
          try {
            const p = (this._model?.participants || []).find(x => x.key === key);
            const focusId = p?.email || p?.jiraAccountId || key;
            if (focusId) {
              (Services.Focus || globalThis.Focus)?.set?.({
                kind: 'employee', id: focusId, source: 'scanner',
              });
            }
          } catch (_) { /* defensive */ }
        }
        // Snap dashboard row state: убираем `ts2-row-expanded` со всех
        // строк, ставим на текущую если opening. Только class-toggle,
        // НЕ полный re-render.
        root.querySelectorAll('.ts2-row.ts2-row-expanded').forEach(r => {
          r.classList.remove('ts2-row-expanded');
          r.setAttribute('aria-expanded', 'false');
        });
        if (opening) {
          el.classList.add('ts2-row-expanded');
          el.setAttribute('aria-expanded', 'true');
          // ПОРЯДОК ВАЖЕН: сначала добавляем body-class (CSS прогружает
          // .app-section'у transform:none → containing block снимается ДО
          // вставки модалки), потом вставляем модалку (она сразу
          // позиционируется относительно viewport, без репозиции = без
          // jerk'а). Раньше класс добавлялся ПОСЛЕ — модалка успевала
          // быть отрисована относительно .app-section, потом перепрыгивала
          // к viewport'у.
          document.body.classList.add('is-ts2-modal-open');
          this._renderPanelOnly();
          this._syncModalClass();
        } else if (wasExpanded) {
          this._closePanel();
        }
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(e);
        }
      });
    });
  },

  _bindPanelEvents() {
    const root = this._container;
    if (!root) return;
    // V18.1 P5 — close: ✕ button, backdrop click, Esc key.
    root.querySelector('#ts2-detail-close')?.addEventListener('click', () => this._closePanel());
    root.querySelector('#ts2-panel-backdrop')?.addEventListener('click', () => this._closePanel());
    if (this._expandedKey) {
      if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
      // V18.1 P7-S3.1 — single keydown handler делает 2 вещи:
      //   - Escape → закрыть panel
      //   - Tab при focus вне panel → focus-trap, возврат внутрь panel
      // Tab между focusable элементами panel'и работает естественно
      // (browser default), но при выходе за её пределы — мы перехватываем.
      this._escHandler = (e) => {
        if (e.key === 'Escape') { this._closePanel(); return; }
        if (e.key !== 'Tab') return;
        const panel = root.querySelector('#ts2-panel-main');
        if (!panel) return;
        // Если active focus уже вне panel'и — fight-back inside.
        const active = document.activeElement;
        if (!panel.contains(active)) {
          e.preventDefault();
          panel.focus();
        }
      };
      // TECH 17.3 — привязываем escHandler через global AbortController.
      // unmount() ниже всё ещё removeEventListener (back-compat), но abort()
      // снимет повторно — idempotent.
      const _escSignal = this._getGlobalAbortSignal();
      document.addEventListener('keydown', this._escHandler, _escSignal ? { signal: _escSignal } : false);
    }
    // V18.1 P7-S2.4 — filter pill click → partial re-render только panel'и,
    // dashboard за ним остаётся нетронутым (нет flash, scroll сохраняется).
    root.querySelectorAll('.ts2-filter-pill[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        this._panelFilters = { ...this._panelFilters, [f]: !this._panelFilters[f] };
        this._renderPanelOnly();
      });
    });
    // V22 (2026-05-10 UX) — click-to-expand для событий в Events Feed.
    // Делегированный listener на ul.ts2-recent-feed чтобы не плодить per-li
    // handler'ы (в активных командах могут быть сотни событий за 72ч).
    // Click срабатывает только если li имеет .ts2-recent-expandable (т.е.
    // в нём есть .ts2-recent-detail). Игнорируем clicks по ссылкам/кнопкам
    // внутри li — они обрабатываются нативно (jiraIssueLink, BB url).
    root.querySelectorAll('.ts2-recent-feed').forEach(ul => {
      ul.addEventListener('click', (ev) => {
        if (ev.target.closest('a, button')) return;   // не интерферируем с нативными ссылками
        const li = ev.target.closest('li.ts2-recent-expandable');
        if (!li || !ul.contains(li)) return;
        const detail = li.querySelector('.ts2-recent-detail');
        if (!detail) return;
        const opening = detail.hasAttribute('hidden');
        if (opening) {
          detail.removeAttribute('hidden');
          li.classList.add('is-expanded');
        } else {
          detail.setAttribute('hidden', '');
          li.classList.remove('is-expanded');
        }
      });
    });
    // V22 (2026-05-09 UX) — email-masking убран, кликов больше нет (mailto-ссылка).

    // V22 (2026-05-09 UX) — chip click → формула.
    // UX feedback 2026-05-10 (Sc5) — заменили Toast на inline-popover внутри
    // модалки. Toast рендерился в body (фиксированный z-index), а модалка
    // имеет более высокий z-index → toast не был виден. Inline-popover внутри
    // модалки решает это: z-index наследуется, видно сразу, закрывается по
    // click outside / Esc / повторный клик.
    root.querySelectorAll('.ts2-pm-chip').forEach(chip => {
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const formula = chip.getAttribute('data-pm-formula')
                     || chip.getAttribute('data-tip')
                     || chip.getAttribute('title')
                     || '';
        if (!formula) return;
        const keyEl = chip.querySelector('.ts2-pm-chip-key');
        const heading = (keyEl?.textContent || 'Метрика').replace(/▌/g, '').trim();
        // Закрыть любой существующий popover (toggle behavior).
        const existing = root.querySelector('.ts2-pm-chip-popover');
        const wasOnThisChip = existing && existing.previousElementSibling === chip;
        if (existing) existing.remove();
        if (wasOnThisChip) return; // toggle off
        const pop = document.createElement('div');
        pop.className = 'ts2-pm-chip-popover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', heading);
        const titleSafe  = String(heading).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const bodySafe   = String(formula).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        pop.innerHTML = `<div class="ts2-pm-chip-popover-title">${titleSafe}</div><div class="ts2-pm-chip-popover-body">${bodySafe}</div><button type="button" class="ts2-pm-chip-popover-close" aria-label="Закрыть">×</button>`;
        // Insert just after the chip so CSS positioning anchors to it.
        chip.insertAdjacentElement('afterend', pop);
        const closeBtn = pop.querySelector('.ts2-pm-chip-popover-close');
        if (closeBtn) closeBtn.addEventListener('click', () => pop.remove());
        // Click outside closes (capture phase to beat document listeners).
        const onDocClick = (ev) => {
          if (!pop.contains(ev.target) && ev.target !== chip && !chip.contains(ev.target)) {
            pop.remove();
            document.removeEventListener('click', onDocClick, true);
            document.removeEventListener('keydown', onEsc, true);
          }
        };
        const onEsc = (ev) => {
          if (ev.key === 'Escape') {
            pop.remove();
            document.removeEventListener('click', onDocClick, true);
            document.removeEventListener('keydown', onEsc, true);
          }
        };
        // Defer to skip current click event.
        setTimeout(() => {
          document.addEventListener('click', onDocClick, true);
          document.addEventListener('keydown', onEsc, true);
        }, 0);
      });
    });
    // V20 S8 #23 — Spawn-1on1 button: контекст для разговора в TG.
    // Доступен когда PR throughput у человека = overload.
    root.querySelector('#ts2-detail-spawn-1on1')?.addEventListener('click', async () => {
      const btn = root.querySelector('#ts2-detail-spawn-1on1');
      if (!btn || !this._model || !this._expandedKey) return;
      const p = (this._model.participants || []).find(x => x.key === this._expandedKey);
      if (!p) return;
      const prT = this._model.scannerV2?.prThroughput?.[p.key];
      const lines = [
        `1:1 talking points — ${p.label || p.key}`,
        `PR throughput: ${prT?.opened || 0} opened · ${prT?.merged || 0} merged · ${Math.round((prT?.mergeRate || 0) * 100)}% merge-rate`,
        `Flag: ${prT?.flag || 'unknown'}`,
        '',
        'Возможные темы для разговора:',
        `· ${prT?.flag === 'overload' ? 'PR throughput overloaded — какие PR блокируют? Нужны ли ревьюеры?' : 'Текущая загрузка'}`,
        `· Что мешает? Чем могу помочь?`,
        `· План на спринт — реалистичный?`,
      ];
      const text = lines.join('\n');
      try {
        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = 'Скопировано';
        setTimeout(() => { btn.textContent = orig; }, 1500);
        telemetryEmit('scanner2.spawn_1on1', {});
        this._announce('Контекст для 1:1 скопирован — вставьте в TG/Slack');
      } catch (e) { console.warn('[scanner2] 1on1 copy failed:', e); }
    });
    // V20 S8 #7 — Copy-for-TG button: 5-7 plain-text строк для Telegram-чата.
    root.querySelector('#ts2-detail-tgcopy')?.addEventListener('click', async () => {
      const btn = root.querySelector('#ts2-detail-tgcopy');
      if (!btn || !this._model || !this._expandedKey) return;
      const p = (this._model.participants || []).find(x => x.key === this._expandedKey);
      if (!p) return;
      // Compose summary plain-text.
      // AUDIT_COPY #40 — без эмодзи в production (брендбук §1).
      const lines = [`Сотрудник: ${p.label || p.key}`];
      const todayN = (p.timelineToday || []).length;
      const yestN  = (p.timelineYesterday || []).length;
      const wipN   = (p.issuesNow || []).length;
      lines.push(`События: сегодня ${todayN} · вчера ${yestN} · WIP ${wipN}`);
      const blockers = (p.blockers || []).slice(0, 3);
      if (blockers.length) {
        // AUDIT_ARTDIRECTION #35 — убран эмодзи 🚫 (см. line 1728).
        lines.push('Топ блокеры:');
        for (const b of blockers) {
          lines.push(`  · ${b.key} «${(b.summary || '').slice(0, 50)}» — ▌${b.dwellHours || 0}ч в "${b.status || '?'}"`);
        }
      }
      const com48 = p.badges?.commits48h || 0;
      const pr48  = p.badges?.pr48h || 0;
      const cf48  = p.badges?.conf48h || 0;
      if (com48 || pr48 || cf48) lines.push(`За 48ч: ${com48} коммитов · ${pr48} PR · ${cf48} CF-правок`);
      // Permalink.
      try {
        const url = (typeof location !== 'undefined' ? location.href : '');
        if (url) lines.push(`Ссылка: ${url}`);
      } catch (_) {}
      const text = lines.join('\n');
      try {
        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
        }
        const orig = btn.textContent;
        btn.textContent = 'Скопировано';
        setTimeout(() => { btn.textContent = orig; }, 1500);
        telemetryEmit('scanner2.tg_copy', {});
        this._announce('Сводка скопирована в буфер для Telegram');
      } catch (e) {
        console.warn('[scanner2] TG copy failed:', e);
      }
    });
    // V18.3 A4 — Share-link button: copies current URL with hash to clipboard.
    root.querySelector('#ts2-detail-share')?.addEventListener('click', async () => {
      const btn = root.querySelector('#ts2-detail-share');
      if (!btn) return;
      try {
        const url = (typeof location !== 'undefined' ? location.href : '');
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          // Fallback для старых браузеров: temp textarea + execCommand.
          const ta = document.createElement('textarea');
          ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
        }
        // V22 Brand B1 — храним innerHTML, чтобы при возврате восстановить SVG-иконку link-2.
        const orig = btn.innerHTML;
        btn.textContent = 'OK';
        btn.classList.add('ts2-panel-share-copied');
        setTimeout(() => {
          btn.innerHTML = orig;
          btn.classList.remove('ts2-panel-share-copied');
        }, 1500);
        this._announce('Ссылка скопирована в буфер обмена');
      } catch (e) {
        console.warn('[scanner2] share-link copy failed:', e);
        const orig = btn.innerHTML;
        btn.textContent = 'Ошибка';
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
      }
    });
    // 2026-06-01 — «Сводка ассистента». Lazy LLM-fetch при первом раскрытии
    // секции. Кэш живёт до refresh().
    this._bindAssistantSection(root);
  },

  /* ── Сводка ассистента (LLM, lazy-load) ──────────────────── */

  _bindAssistantSection(root) {
    const section = root.querySelector('.ts2-assistant-section');
    if (!section) return;
    const key = section.dataset.assistantKey || this._expandedKey || '';
    if (!key) return;
    // При первом маунте — если в кэше есть готовый ответ, отрисовываем без сети.
    const cached = this._assistantCache.get(key);
    if (cached) {
      this._fillAssistantBlocks(section, cached);
    }
    section.addEventListener('toggle', () => {
      if (!section.open) return;
      const body = section.querySelector('.ts2-assistant-body');
      if (!body) return;
      if (body.dataset.assistantLoaded === '1') return;
      if (body.dataset.assistantLoading === '1') return;
      if (this._assistantCache.has(key)) {
        this._fillAssistantBlocks(section, this._assistantCache.get(key));
        return;
      }
      this._runAssistantFetch(section, key);
    });
    // Retry-кнопки делегируем через section: тыкают на «Повторить».
    section.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.ts2-assistant-retry[data-retry]');
      if (!btn) return;
      const which = btn.dataset.retry;  // 'summary' | 'plan' | 'both'
      this._runAssistantFetch(section, key, which === 'both' ? null : which);
    });
  },

  _runAssistantFetch(section, key, only = null) {
    const model = this._model;
    const p = (model?.participants || []).find(x => x.key === key);
    if (!p) return;
    const body = section.querySelector('.ts2-assistant-body');
    if (!body) return;
    body.dataset.assistantLoading = '1';
    body.dataset.assistantLoaded = '0';
    // skeleton по обоим блокам (или одному при retry)
    const setSkeleton = (which) => {
      const block = section.querySelector(`[data-assistant-block="${which}"] .ts2-assistant-block-content`);
      if (block) block.innerHTML = `<div class="ts2-assistant-skeleton" aria-busy="true"><div class="ts2-assistant-skeleton-line"></div><div class="ts2-assistant-skeleton-line"></div><div class="ts2-assistant-skeleton-line"></div></div>`;
    };
    if (!only || only === 'summary') setSkeleton('summary');
    if (!only || only === 'plan')    setSkeleton('plan');

    // abort предыдущий fetch на этом сотруднике (если был).
    try { this._assistantInflight.get(key)?.abort?.(); } catch (_) {}
    const ctrl = new AbortController();
    this._assistantInflight.set(key, ctrl);
    const cfg = _llmReadConfig();
    if (!_llmHasCredentials(cfg)) {
      const noToken = {
        ok: false, error: 'LLM не настроен',
        html: `<div class="ts2-assistant-error">LLM не настроен: Настройки → LLM → введите token или clientId+clientSecret.</div>`,
      };
      const fake = { summary: noToken, plan: noToken, ts: Date.now() };
      this._assistantCache.set(key, fake);
      this._fillAssistantBlocks(section, fake);
      body.dataset.assistantLoading = '0';
      body.dataset.assistantLoaded = '1';
      this._assistantInflight.delete(key);
      return;
    }
    // Параллель — каждая Promise самостоятельно отрисовывает свой блок.
    const tasks = [];
    const existing = this._assistantCache.get(key) || { ts: Date.now() };
    if (!only || only === 'summary') {
      tasks.push(_llmGenerateSummary(p, model, { signal: ctrl.signal, cfg }).then(r => {
        if (ctrl.signal.aborted) return;
        existing.summary = r;
        this._renderAssistantBlock(section, 'summary', r);
      }));
    }
    if (!only || only === 'plan') {
      tasks.push(_llmGeneratePlanHypothesis(p, model, { signal: ctrl.signal, cfg }).then(r => {
        if (ctrl.signal.aborted) return;
        existing.plan = r;
        this._renderAssistantBlock(section, 'plan', r);
      }));
    }
    Promise.allSettled(tasks).then(() => {
      if (ctrl.signal.aborted) return;
      existing.ts = Date.now();
      this._assistantCache.set(key, existing);
      body.dataset.assistantLoading = '0';
      body.dataset.assistantLoaded = '1';
      if (this._assistantInflight.get(key) === ctrl) this._assistantInflight.delete(key);
      try { telemetryEmit('scanner2.assistant_fetched', { hasSummary: !!existing.summary?.ok, hasPlan: !!existing.plan?.ok }); } catch (_) {}
    });
  },

  _fillAssistantBlocks(section, cache) {
    if (cache?.summary) this._renderAssistantBlock(section, 'summary', cache.summary);
    if (cache?.plan)    this._renderAssistantBlock(section, 'plan',    cache.plan);
    const body = section.querySelector('.ts2-assistant-body');
    if (body) { body.dataset.assistantLoaded = '1'; body.dataset.assistantLoading = '0'; }
  },

  _renderAssistantBlock(section, which, result) {
    const block = section.querySelector(`[data-assistant-block="${which}"] .ts2-assistant-block-content`);
    if (!block) return;
    if (result?.ok && result.html) {
      block.innerHTML = result.html;
    } else {
      const errHtml = result?.html || `<div class="ts2-assistant-error">LLM-сводка не получилась.</div>`;
      block.innerHTML = `${errHtml}<button type="button" class="ts2-assistant-retry" data-retry="${which}">Повторить</button>`;
    }
  },

  /**
   * V18.1 P7-S2.4 — partial rebuild только side-panel + backdrop, без
   * dashboard. Удаляет старые .ts2-panel + .ts2-panel-backdrop,
   * вставляет новые. Re-bind'ит ТОЛЬКО panel events.
   */
  _renderPanelOnly() {
    if (!this._container || !this._model || !this._expandedKey) return;
    const m = this._model;
    // Удаляем старые panel + backdrop.
    this._container.querySelector('#ts2-panel-backdrop')?.remove();
    this._container.querySelector('.ts2-panel')?.remove();
    // Вставляем новые в конец container'а (sibling rooty).
    const panelHtml = renderEmployeeDetailPanel(m, this._expandedKey, { filters: this._panelFilters });
    this._container.insertAdjacentHTML(
      'beforeend',
      `<div class="ts2-panel-backdrop" id="ts2-panel-backdrop"></div>${panelHtml}`,
    );
    // Re-bind только panel events (dashboard события на старых nodes
    // остаются валидными — мы их не трогали).
    this._bindPanelEvents();
  },

  /**
   * V18.3 A1 — Per-team config modal. Olga (ML pilot) override workflow.
   * Modal живёт в document.body (не в container), чтобы overlay перекрывал
   * весь viewport. State хранится в localStorage через teamScanner2Config.
   */
  _openConfigModal() {
    if (!this._model) return;
    const currentConfig = loadTeamConfig();
    const html = renderTeamConfigModal(this._model, currentConfig, PRESET_THRESHOLDS);
    document.body.classList.add('is-ts2-modal-open');
    document.getElementById('ts2-config-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('ts2-config-modal');
    // V20 S6.1 — bind escape handler с reference чтобы removeEventListener
    // отрабатывал при close-by-backdrop тоже (иначе copies handler копится).
    const onEsc = (ev) => {
      if (ev.key === 'Escape') close();
    };
    const close = () => {
      overlay?.remove();
      document.removeEventListener('keydown', onEsc);
      this._syncModalClass();
    };
    overlay?.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', onEsc);
    // Preset selector — обновляет inputs к preset values.
    overlay.querySelectorAll('.ts2-config-preset').forEach(sel => {
      sel.addEventListener('change', () => {
        const pk = sel.dataset.pk;
        const presetName = sel.value;
        const preset = PRESET_THRESHOLDS[presetName] || PRESET_THRESHOLDS.default;
        overlay.querySelectorAll(`.ts2-config-input[data-pk="${pk}"]`).forEach(input => {
          input.value = preset[input.dataset.field] ?? preset.default;
        });
      });
    });
    // Reset button per team.
    overlay.querySelectorAll('.ts2-config-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const pk = btn.dataset.pk;
        resetTeam(pk);
        close();
        this._openConfigModal();   // re-open чтобы UI обновился
      });
    });
    // Save button — собираем все inputs → applyPreset/manual save.
    overlay.querySelector('#ts2-config-save')?.addEventListener('click', () => {
      const newConfig = loadTeamConfig();
      const pks = new Set();
      overlay.querySelectorAll('.ts2-config-input').forEach(input => pks.add(input.dataset.pk));
      const modesUsed = {};
      for (const pk of pks) {
        const presetSel = overlay.querySelector(`.ts2-config-preset[data-pk="${pk}"]`);
        const mode = presetSel?.value || 'default';
        modesUsed[mode] = (modesUsed[mode] || 0) + 1;
        const dwellHours = {};
        overlay.querySelectorAll(`.ts2-config-input[data-pk="${pk}"]`).forEach(input => {
          const v = Number(input.value);
          if (Number.isFinite(v) && v > 0) dwellHours[input.dataset.field] = v;
        });
        newConfig[pk] = { mode, dwellHours };
      }
      saveTeamConfig(newConfig);
      // V19 C4 — telemetry: config save с агрегатом modes (Olga ML adoption).
      telemetryEmit('scanner2.config_save', {
        teamCount: pks.size,
        modes: JSON.stringify(modesUsed),   // server-side stringify limited to 200 chars
      });
      close();
      // Re-enrich model с новыми порогами без re-fetch'а данных.
      this._reEnrichWithNewConfig();
      this._announce('Настройки команд сохранены, blockers пересчитаны');
    });
  },

  /**
   * V20 S8.5 #11 — Server audit queue helpers. Compliance backup для случаев
   * когда POST /diag-audit падает (network / 5xx). Очередь живёт в localStorage,
   * retry на mount + после успешных flush'ей.
   */
  _AUDIT_QUEUE_KEY: 'q2_diag_audit_outbox',
  _AUDIT_QUEUE_MAX: 50,

  _enqueueServerAudit(entry) {
    try {
      const raw = localStorage.getItem(this._AUDIT_QUEUE_KEY);
      let queue = [];
      try { queue = raw ? JSON.parse(raw) : []; } catch (_) {}
      if (!Array.isArray(queue)) queue = [];
      queue.push(entry);
      if (queue.length > this._AUDIT_QUEUE_MAX) queue = queue.slice(-this._AUDIT_QUEUE_MAX);
      localStorage.setItem(this._AUDIT_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      try { telemetryEmit('scanner2.silent_error', { where: 'audit_enqueue', msg: String(e?.message || e).slice(0, 100) }); } catch (_) {}
    }
  },

  async _flushServerAuditQueue() {
    let queue = [];
    try {
      const raw = localStorage.getItem(this._AUDIT_QUEUE_KEY);
      queue = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(queue) || !queue.length) return;
    } catch (_) { return; }
    const remaining = [];
    for (const entry of queue) {
      try {
        const resp = await fetch('/api/integrations/diag-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
        if (!resp.ok) remaining.push(entry);     // server вернул 5xx → keep
      } catch (_) {
        remaining.push(entry);                    // network failure → keep
      }
    }
    try { localStorage.setItem(this._AUDIT_QUEUE_KEY, JSON.stringify(remaining)); } catch (_) {}
    if (remaining.length < queue.length) {
      telemetryEmit('scanner2.audit_flushed', { sent: queue.length - remaining.length, queued: remaining.length });
    }
  },

  /**
   * V20 S8.5 #20 — Anomaly drill-down modal. Sparkline за 14 дней с baseline.
   * label: 'movается' / 'стоп' / 'наблюдение' / 'без активности'.
   */
  _openAnomalyChart(label) {
    const { projectKeys } = this._readConfig();
    const history = loadHistory(projectKeys, 14) || [];
    // Map label → metric key.
    const metricMap = {
      'движется': 'moving', 'наблюдение': 'watch',
      'стоп': 'stop', 'без активности': 'idle',
    };
    // Извлекаем правильный ключ через свободный match.
    let metric = 'stop';
    for (const k of Object.keys(metricMap)) {
      if (label.toLowerCase().includes(k.toLowerCase())) { metric = metricMap[k]; break; }
    }
    // На самом деле data-anomaly-metric содержит human label («×4 от нормы»),
    // не имя метрики. Нам нужно computeZScore + подходящая series.
    // Берём текущие anomalies и пытаемся выбрать «не-zero» metric.
    // Fallback: используем stop как самый частый сценарий аномалии.
    const series = history.map(h => h?.counts?.[metric] || 0);
    const z = computeZScore(series);
    // 2026-05-17 — body.is-ts2-modal-open ДО insertAdjacentHTML, чтобы
    // .app-section успел сбросить containing block до отрисовки overlay'я.
    document.body.classList.add('is-ts2-modal-open');
    document.getElementById('ts2-anomaly-modal')?.remove();
    const html = renderAnomalyMiniChart(series, z, metric);
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('ts2-anomaly-modal');
    if (!overlay) return;
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); this._syncModalClass(); };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', onEsc);
  },

  /**
   * V20 S8 #2 — CR drill-down modal. Открывает список топ-15 ревьюеров
   * с их median'ами. Pилот feedback: «6ч медиана не actionable, нужны имена».
   */
  _openCrvDrilldown() {
    if (!this._model) return;
    document.body.classList.add('is-ts2-modal-open');
    document.getElementById('ts2-crv-drilldown')?.remove();
    const html = renderCrvDrilldownModal(
      this._model.scannerV2?.codeReviewVelocity || {},
      appState.employees || [],
    );
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('ts2-crv-drilldown');
    if (!overlay) return;
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
      this._syncModalClass();
    };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', onEsc);
  },

  /**
   * V20 S1.4 — «Как считается» modal. Объясняет PO/тимлидам как
   * считаются метрики (counts groups, sprintGoal, risks, blockers).
   * Чистый клон pattern'а из portfolioPulseRenderer.js renderHowModal.
   * Pure-static html (no model dep) — открывается даже без cache.
   */
  _openHowModal() {
    document.body.classList.add('is-ts2-modal-open');
    document.getElementById('ts2-how-modal')?.remove();
    const html = renderHowCalculatedModal();
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('ts2-how-modal');
    if (!overlay) return;
    // V20 S6.1 — listener cleanup независимо от пути закрытия.
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
      this._syncModalClass();
    };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', onEsc);
    // Простая accordion-навигация: клик по section-head раскрывает body.
    overlay.querySelectorAll('.ts2-how-section').forEach(sec => {
      const head = sec.querySelector('.ts2-how-section-head');
      head?.addEventListener('click', () => sec.classList.toggle('ts2-how-section-open'));
    });
  },

  /** PR-CC — Сравнение команд в модалке.
   *  V21 fix — переключение Гистограмма/Лидерборд/Тренд раньше не работало:
   *  bar/leaderboard/trend handler bind'ился в _attachHandlers через `root`
   *  (this._container), а modal рендерится в document.body — selector не
   *  находил кнопок. Теперь bind'им handler здесь, после insertAdjacentHTML,
   *  и на click пере-рендерим саму модалку (не _renderFull, который не
   *  трогает overlay вне root). */
  _openVelocityCompareModal() {
    document.getElementById('ts2-velocity-modal')?.remove();
    let viewMode = 'bar';
    try {
      const v = localStorage.getItem('q2_scanner_velocity_view');
      if (v === 'leaderboard' || v === 'trend' || v === 'bar') viewMode = v;
    } catch (_) { /* ignore */ }
    const renderInto = (mode) => {
      document.getElementById('ts2-velocity-modal')?.remove();
      const html = renderVelocityCompareModal(this._model, this._history || [], { viewMode: mode });
      document.body.insertAdjacentHTML('beforeend', html);
      const ov = document.getElementById('ts2-velocity-modal');
      if (!ov) return null;
      ov.addEventListener('click', (ev) => {
        if (ev.target === ov || ev.target.closest?.('[data-close-modal]')) close();
      });
      // Re-bind tab-switch на каждом re-render (новые DOM-узлы).
      ov.querySelectorAll('[data-velocity-view]').forEach(btn => {
        btn.addEventListener('click', () => {
          const next = btn.dataset.velocityView;
          if (next !== 'bar' && next !== 'leaderboard' && next !== 'trend') return;
          if (next === viewMode) return;
          viewMode = next;
          try { localStorage.setItem('q2_scanner_velocity_view', next); } catch (_) { /* ignore */ }
          telemetryEmit('scanner2.velocity_view_change', { mode: next });
          renderInto(next);
        });
      });
      // 2026-05-11 — V23 Compare-tabs (velocity / benchmarks). Toggle pane
      // визуально (active class + hidden) без перерисовки modal'а.
      ov.querySelectorAll('[data-compare-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.compareTab;
          if (target !== 'velocity' && target !== 'benchmarks') return;
          ov.querySelectorAll('[data-compare-tab]').forEach(b => {
            const isActive = b.dataset.compareTab === target;
            b.classList.toggle('is-active', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
          ov.querySelectorAll('[data-compare-pane]').forEach(pane => {
            const isActive = pane.dataset.comparePane === target;
            pane.classList.toggle('is-active', isActive);
            if (isActive) pane.removeAttribute('hidden'); else pane.setAttribute('hidden', '');
          });
          try { telemetryEmit('scanner2.compare_tab_switch', { target }); } catch (_) {}
        });
      });
      return ov;
    };
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => {
      document.getElementById('ts2-velocity-modal')?.remove();
      document.removeEventListener('keydown', onEsc);
      this._syncModalClass();
    };
    // 2026-05-17 — body-class ДО renderInto (вставляет overlay в body).
    document.body.classList.add('is-ts2-modal-open');
    if (!renderInto(viewMode)) {
      // renderInto fail → откатываем класс если других модалок нет.
      this._syncModalClass();
      return;
    }
    document.addEventListener('keydown', onEsc);
  },

  /**
   * V20 S2 — открыть диагностический modal. Single source of truth —
   * gatherDiagnosticState() + prepareDiagnosticExport() из
   * teamScanner2Diagnostic.js. UI только рендерит и привязывает 3 button:
   *   📋 Безопасный экспорт  → mode='safe' download
   *   ⚠️ Полный экспорт PII  → disclaimer-modal → confirm → mode='raw' download
   *   ✕ Закрыть              → remove modal
   */
  _openDiagModal() {
    // V21 — переименовано из локального `state` в `diagState` чтобы не shadow'ить
    // module-level Proxy `state` в Sensitivity Preview (delta-row baseline
    // brался с пустого diag-snapshot вместо текущего state).
    const diagState = gatherDiagnosticState({
      model:           this._model,
      prevSnapshot:    this._prevSnapshot,
      jobId:           this._jobId,
      cacheAgeMs:      this._cacheAgeMs(),
      fetchLatencyMs:  this._lastFetchLatencyMs,
      // V20 S4 fix — передаём state.employees для правильного coverage.
      // Без этого bbLogin/cfId всегда показывались как 0% (поля не на participant).
      employees:       appState.employees || [],
      // V20 S7 B13 — raw fetch counts (до identity-attribution).
      rawDiag:         this._lastRawDiag || null,
      // 2026-05-11 — last bulk-resolve report (если был запущен в этой сессии).
      resolveReport:   this._lastResolveReport || null,
    });
    document.body.classList.add('is-ts2-modal-open');
    document.getElementById('ts2-diag-modal')?.remove();
    const auditEntries = readAuditLog();
    const html = renderDiagnosticModal(diagState, { auditEntries });
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('ts2-diag-modal');
    if (!overlay) return;
    // V20 S6.1 — listener cleanup на любом пути закрытия.
    const onEsc = (ev) => {
      if (ev.key !== 'Escape') return;
      // Disclaimer modal перекрывает diag → Esc закрывает только его.
      const disc = document.getElementById('ts2-diag-disclaimer');
      if (disc) { disc.remove(); return; }
      close();
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
      this._syncModalClass();
    };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', onEsc);
    // Accordion navigation.
    overlay.querySelectorAll('.ts2-diag-section').forEach(sec => {
      const head = sec.querySelector('.ts2-diag-section-head');
      head?.addEventListener('click', () => sec.classList.toggle('ts2-diag-section-open'));
    });
    // 2026-05-11 — на клик re-evaluate diagState чтобы подхватить
    // `_lastResolveReport` который мог появиться ПОСЛЕ открытия modal'а
    // (юзер открыл diag, потом нажал Auto-Resolve, потом Export — без этого
    // re-eval'а resolveReport в JSON остаётся null). Closure-capture diagState
    // — снапшот на момент _openDiagModal, не актуален на момент Export click.
    const _freshDiagState = () => gatherDiagnosticState({
      model:           this._model,
      prevSnapshot:    this._prevSnapshot,
      jobId:           this._jobId,
      cacheAgeMs:      this._cacheAgeMs(),
      fetchLatencyMs:  this._lastFetchLatencyMs,
      employees:       appState.employees || [],
      rawDiag:         this._lastRawDiag || null,
      resolveReport:   this._lastResolveReport || null,
      // 2026-06-01 — кэш LLM-сводок «Сводка ассистента» добавляется в
      // diagnostic snapshot (см. gatherDiagnosticState → llmAssistant).
      // Map сериализуется в plain object {personKey: {summary, plan, ts}}.
      assistantCache:  this._assistantCache,
    });
    // Safe export — instant download.
    overlay.querySelector('#ts2-diag-export-safe')?.addEventListener('click', () => {
      this._performExport(_freshDiagState(), 'safe');
    });
    // Raw export — disclaimer first.
    overlay.querySelector('#ts2-diag-export-raw')?.addEventListener('click', () => {
      this._openDiagDisclaimer(_freshDiagState());
    });
    // V20 S3.1 — connection probe button.
    overlay.querySelector('#ts2-diag-probe-run')?.addEventListener('click', async () => {
      const btn = overlay.querySelector('#ts2-diag-probe-run');
      const out = overlay.querySelector('#ts2-diag-probe-results');
      if (!out || !btn) return;
      // V21 π5 — в demo-режиме probe бессмысленен (нет реальной сети).
      // Показываем informative-сообщение вместо запуска fetch'ей.
      if (this._isDemoBlocked('probe')) {
        out.innerHTML = '<div class="ts2-diag-empty">Демо-режим: подключение не проверяется. Выйдите из демо чтобы запустить probe.</div>';
        return;
      }
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = 'Прогон…';
      out.innerHTML = '<div class="ts2-diag-empty">Прогон 3 интеграций параллельно (до 10 сек на каждую)…</div>';
      try {
        const probe = await runConnectionProbe();
        out.innerHTML = renderProbeResults(probe);
        telemetryEmit('scanner2.diag_probe', {
          jiraOk: !!probe.jira.ok, bbOk: !!probe.bitbucket.ok, cfOk: !!probe.confluence.ok,
        });
      } catch (e) {
        // V20 S6.1 — XSS guard: error может содержать HTML из proxy / injected baseUrl.
        out.innerHTML = `<div class="ts2-diag-empty">Probe failed: ${Utils.escapeHtml(e?.message || 'unknown')}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
    // V20 S4 — Identity Auto-Resolve (preview-flow).
    overlay.querySelector('#ts2-diag-resolve-btn')?.addEventListener('click', () => {
      this._runIdentityResolve(overlay);
    });
    // V22 B1+B2 — Bulk Auto-Resolve (skip preview, fill пустые поля).
    overlay.querySelector('#ts2-diag-bulk-resolve-btn')?.addEventListener('click', () => {
      this._runBulkIdentityResolve(overlay);
    });
    // V22 P-bind — inline-dropdown «Привязать BB-slug → ФИО».
    // Event-delegation чтобы не вешать N listener'ов на N <select>'ов.
    // Change-event срабатывает только на bb-bind-select. Reset-в-default
    // option('') = no-op, чтобы пользователь мог отменить случайный выбор.
    overlay.addEventListener('change', (ev) => {
      const sel = ev.target?.closest?.('.ts2-diag-bb-bind-select');
      if (!sel) return;
      const slug = String(sel.dataset.bbBindSlug || '').trim();
      const empKey = String(sel.value || '').trim();
      if (!slug || !empKey) return;
      this._bindBbAuthorToEmployee(slug, empKey);
    });
    // V20 S3.2 — threshold sensitivity preview.
    overlay.querySelector('#ts2-diag-sens-run')?.addEventListener('click', () => {
      const out = overlay.querySelector('#ts2-diag-sens-results');
      if (!out) return;
      if (!this._model) {
        out.innerHTML = '<div class="ts2-diag-empty">Нет загруженных данных — сначала загрузите команду.</div>';
        return;
      }
      const hypo = {};
      overlay.querySelectorAll('[data-sens-field]').forEach(input => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v > 0) hypo[input.dataset.sensField] = v;
      });
      const sim = simulateThresholds(this._model, hypo);
      const currentCounts = diagState.snapshot?.current?.counts || {};
      out.innerHTML = renderSensitivityResults(sim, currentCounts);
      telemetryEmit('scanner2.diag_sensitivity', {
        codeReview: hypo.codeReview, qa: hypo.qa, inProgress: hypo.inProgress, todo: hypo.todo,
      });
    });
  },

  /**
   * V20 S2 — disclaimer-modal перед raw-экспортом (B3 consent flow).
   * Перекрывает diag-modal. Esc / cancel закрывают только disclaimer.
   * V20 S8 #6 — если consent уже дан в эту сессию (24h TTL) — не показываем
   * modal, сразу делаем raw export. Pилот feedback: «consent блокирует
   * срочный сценарий».
   */
  _openDiagDisclaimer(state) {
    // V20 S8 #6 — check remembered consent.
    // V20 S8.5 #5 — telemetry на consent_read failure (раньше silent).
    try {
      const until = Number(localStorage.getItem('q2_diag_consent_until') || 0);
      if (until > Date.now()) {
        // Auto-bypass с remembered consent.
        telemetryEmit('scanner2.diag_consent_bypass', { remainingMin: Math.round((until - Date.now()) / 60000) });
        this._performExport(state, 'raw', {
          consentGiven: true,
          disclaimerVersion: 'v1.2026-05-02',
          consentSource: 'remembered-24h',
        });
        return;
      }
    } catch (e) {
      // V20 S8.5 #5 — consent-read failure → telemetry (раньше silent).
      try { telemetryEmit('scanner2.silent_error', { where: 'consent_read', msg: String(e?.message || e).slice(0, 100) }); } catch (_) {}
    }
    document.getElementById('ts2-diag-disclaimer')?.remove();
    document.body.insertAdjacentHTML('beforeend', renderDiagnosticDisclaimer());
    const disc = document.getElementById('ts2-diag-disclaimer');
    if (!disc) return;
    const closeDisc = () => disc.remove();
    disc.addEventListener('click', (ev) => {
      if (ev.target === disc || ev.target.closest?.('[data-close-modal]')) closeDisc();
    });
    // V20 S8.5 #21 — показ оставшегося времени consent (если был remember).
    try {
      const untilCheck = Number(localStorage.getItem('q2_diag_consent_until') || 0);
      if (untilCheck > Date.now()) {
        const counter = disc.querySelector('#ts2-diag-consent-counter');
        if (counter) {
          const hoursLeft = Math.round((untilCheck - Date.now()) / 3600000);
          counter.style.display = '';
          counter.textContent = `ℹ️ У вас активен «запомнить consent» ещё ${hoursLeft} ${hoursLeft === 1 ? 'час' : (hoursLeft < 5 ? 'часа' : 'часов')}. Этот modal появится снова после истечения.`;
        }
      }
    } catch (_) {}
    // V20 S7 B6 — checkbox-driven enable. Без чекбокса — confirm заблокирован.
    const consent = disc.querySelector('#ts2-diag-disclaimer-consent');
    const confirmBtn = disc.querySelector('#ts2-diag-disclaimer-confirm');
    consent?.addEventListener('change', () => {
      if (confirmBtn) confirmBtn.disabled = !consent.checked;
    });
    confirmBtn?.addEventListener('click', () => {
      if (!consent?.checked) return;     // double-guard
      // V20 S8 #6 — remember consent на 24h если checkbox.
      const remember = disc.querySelector('#ts2-diag-disclaimer-remember');
      if (remember?.checked) {
        try {
          localStorage.setItem('q2_diag_consent_until', String(Date.now() + 24 * 60 * 60 * 1000));
        } catch (_) {}
      }
      closeDisc();
      this._performExport(state, 'raw', {
        consentGiven: true,
        disclaimerVersion: 'v1.2026-05-02',
        consentSource: remember?.checked ? 'explicit-remember' : 'explicit-once',
      });
    });
  },

  /**
   * V22 P-bind — manual binding BB-slug → employee из dropdown'а в diag-modal.
   *
   * Шаги:
   *   1) Найти employee по key (id | jiraKey | email | fio fallback).
   *   2) Записать `employee.bitbucketLogin = slug` (без overwrite-warning'а:
   *      пользователь явно выбрал этот вариант).
   *   3) Storage.save() через обычный mutate (одно поле — НЕ mass-mutation,
   *      Reactive.silent не нужен; см. CLAUDE.md контракт #1).
   *   4) telemetryEmit + toast «Привязано: slug → ФИО».
   *   5) Refresh Сканнера (next tick) — diag-modal закрывать не надо,
   *      пользователь может продолжать привязывать другие slug'и.
   */
  _bindBbAuthorToEmployee(slug, empKey) {
    const slugN = String(slug || '').trim();
    const keyN  = String(empKey || '').trim();
    if (!slugN || !keyN) return;
    const list = appState.employees || [];
    const emp = list.find(e =>
      String(e?.id || '') === keyN ||
      String(e?.jiraKey || '') === keyN ||
      String(e?.email || '') === keyN ||
      String(e?.fio || '') === keyN,
    );
    if (!emp) {
      window.showToast?.(`Сотрудник не найден: ${keyN}`, 'error', 3000);
      return;
    }
    const prev = String(emp.bitbucketLogin || '').trim();
    if (prev && prev.toLowerCase() === slugN.toLowerCase()) {
      window.showToast?.(`Уже привязан: ${emp.fio}`, 'info', 2500);
      return;
    }
    // Single-field mutation — обычный proxy-write (не mass).
    emp.bitbucketLogin = slugN;
    emp.updatedAt = new Date().toISOString();
    try { Storage.save?.(); } catch (e) { console.warn('[scanner2] save после bb-bind failed:', e?.message || e); }
    try {
      telemetryEmit('scanner2.bb_author_bound', {
        slugLen: slugN.length,
        empHadBb: !!prev,
        overwritten: !!prev,
      });
    } catch (_) {}
    window.showToast?.(`Привязано: ${slugN} → ${emp.fio}`, 'success', 3000);
    // Refresh Сканнера — заново посчитает unattributed authors.
    // RAF чтобы текущий event-loop не тормозил toast.
    requestAnimationFrame(() => {
      try { this.refresh(); } catch (e) { console.warn('[scanner2] refresh после bb-bind failed:', e?.message || e); }
    });
  },

  /**
   * V20 S4 — Identity Auto-Resolve.
   *
   * Шаги:
   *   1) Собрать сотрудников у кого есть email НО пусто bbLogin или cfId.
   *   2) Добавить сотрудников у которых ВСЁ заполнено — для validation
   *      (re-resolve может найти что текущий bbLogin устарел). Skipped
   *      в S4.0 — только incomplete'ы для скорости.
   *   3) Server-side parallel batch (по 5 одновременно) → diff.
   *   4) Open preview modal → user reviews → save.
   *
   * Preview modal сам отвечает за save'ы через handler ts2-resolve-save.
   */
  async _runIdentityResolve(diagOverlay) {
    const btn = diagOverlay.querySelector('#ts2-diag-resolve-btn');
    const out = diagOverlay.querySelector('#ts2-diag-resolve-results');
    if (!btn || !out) return;
    // Собираем кандидатов — incomplete identity AND has email.
    const candidates = (state.employees || []).filter(emp =>
      emp.email
      && !emp.isServiceAccount
      && (!emp.bitbucketLogin || !emp.confluenceAccountId),
    );
    if (!candidates.length) {
      out.innerHTML = '<div class="ts2-diag-empty">Нет кандидатов: все сотрудники с email уже имеют bbLogin и cfAccountId.</div>';
      return;
    }
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = `Резолв ${candidates.length} сотрудников…`;
    out.innerHTML = `<div class="ts2-diag-empty">Параллельный API-lookup в BB и Confluence (concurrency 5). Может занять ${Math.ceil(candidates.length / 5 * 8)} сек…</div>`;
    try {
      const items = candidates.map(emp => ({
        key: emp.id || emp.jiraKey || emp.email,
        email: emp.email,
        fullname: emp.fio || '',
      }));
      const resp = await resolveIdentitiesByEmail(items);
      if (resp.error) {
        out.innerHTML = `<div class="ts2-diag-empty">Ошибка: ${Utils.escapeHtml(resp.error)}</div>`;
        return;
      }
      // Build diff — match results back to employees by key.
      // V22 B1+B2 — mapping вынесен в pure mapResolveResultToIdentity (см. test).
      const empByKey = new Map(candidates.map(e => [String(e.id || e.jiraKey || e.email), e]));
      const diff = resp.results.map(r => {
        const emp = empByKey.get(String(r.key));
        if (!emp) return null;
        const m = mapResolveResultToIdentity(r);
        const before = { bb: emp.bitbucketLogin || '', cf: emp.confluenceAccountId || '' };
        const after  = {
          bb: m.bb.ok ? m.bb.slug      : before.bb,
          cf: m.cf.ok ? m.cf.accountId : before.cf,
        };
        const isChange = (before.bb !== after.bb) || (before.cf !== after.cf);
        // 2026-05-11 — отдельный статус 'ambiguous-cf' если server вернул
        // несколько тёзок (ambiguousCandidates). Раньше попадало в 'failed'
        // и юзер не знал что можно выбрать. Status приоритет:
        //   no-email > ambiguous-cf > failed (если обе не ok) > change > unchanged
        const hasAmbig = Array.isArray(m.cf.ambiguousCandidates) && m.cf.ambiguousCandidates.length > 0;
        const status = !r.email ? 'no-email'
                     : hasAmbig ? 'ambiguous-cf'
                     : (!m.bb.ok && !m.cf.ok) ? 'failed'
                     : isChange ? 'change'
                     : 'unchanged';
        return {
          empKey:   emp.id || emp.jiraKey || emp.email,
          fio:      emp.fio || emp.email,
          email:    r.email,
          before, after,
          status,
          bbError:  m.bb.error,
          cfError:  m.cf.error,
          // 2026-05-11 — для preview-dropdown.
          cfAmbiguousCandidates: m.cf.ambiguousCandidates || null,
        };
      }).filter(Boolean);
      // Show summary inline.
      out.innerHTML = `<div class="ts2-diag-ok">${Icons.get('check', { cls: 'btn-icon', size: 12 })} Получены данные: ${resp.summary.bbResolved} BB, ${resp.summary.cfResolved} CF из ${resp.summary.total}. Открываю preview…</div>`;
      // Open preview modal. Save'ы происходят там.
      this._openIdentityResolvePreview(diff, resp.summary);
      telemetryEmit('scanner2.identity_resolve', {
        total: resp.summary.total,
        bbResolved: resp.summary.bbResolved,
        cfResolved: resp.summary.cfResolved,
      });
    } catch (e) {
      out.innerHTML = `<div class="ts2-diag-empty">Не удалось: ${Utils.escapeHtml(e?.message || 'unknown')}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  },

  /**
   * V20 S4 — Preview-modal с diff'ом → save в state.employees через
   * Reactive.silent (mass-mutation contract — без silent infinite loop).
   */
  _openIdentityResolvePreview(diff, summary) {
    document.body.classList.add('is-ts2-modal-open');
    document.getElementById('ts2-resolve-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', renderIdentityResolvePreview(diff, summary));
    const overlay = document.getElementById('ts2-resolve-modal');
    if (!overlay) return;
    // V20 S6.1 — listener cleanup на любом пути закрытия.
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
      this._syncModalClass();
    };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || ev.target.closest?.('[data-close-modal]')) close();
    });
    document.addEventListener('keydown', onEsc);
    const saveBtn = overlay.querySelector('#ts2-resolve-save');
    saveBtn?.addEventListener('click', () => {
      // V20 S6.1 — guard от double-click. После disable повторный click —
      // no-op, отменяет race condition с уже выполненным save'ом.
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохраняю…';
      const changes = diff.filter(d => d.status === 'change');
      // 2026-05-11 — собираем выбранные тёзки из dropdown'ов (status='ambiguous-cf').
      // Каждая <select data-empkey="…"> с непустым value → выбрал юзер.
      const ambigPicks = [];
      overlay.querySelectorAll('.ts2-resolve-ambig-select').forEach(sel => {
        const username = String(sel.value || '').trim();
        if (!username) return;  // skip "не выбран"
        ambigPicks.push({ empKey: sel.dataset.empkey, cfAccountId: username });
      });
      if (!changes.length && !ambigPicks.length) { close(); return; }
      // CRITICAL: mass-mutation в Reactive.silent чтобы не триггерить
      // infinite loop (CLAUDE.md контракт #1).
      const empByKey = new Map((state.employees || []).map(e =>
        [String(e.id || e.jiraKey || e.email), e]));
      let updated = 0;
      let ambigApplied = 0;
      // V20 S7 B3 — Storage.save вне silent (см. _syncEmployeesFromParticipants).
      Reactive.silent(() => {
        for (const d of changes) {
          const emp = empByKey.get(String(d.empKey));
          if (!emp) continue;
          if (d.after.bb && d.after.bb !== emp.bitbucketLogin) {
            emp.bitbucketLogin = d.after.bb;
            updated++;
          }
          if (d.after.cf && d.after.cf !== emp.confluenceAccountId) {
            emp.confluenceAccountId = d.after.cf;
            updated++;
          }
          emp.updatedAt = new Date().toISOString();
        }
        // 2026-05-11 — применяем тёзки-picks.
        for (const p of ambigPicks) {
          const emp = empByKey.get(String(p.empKey));
          if (!emp) continue;
          if (emp.confluenceAccountId) continue;  // safety: не перезаписываем
          emp.confluenceAccountId = p.cfAccountId;
          emp.updatedAt = new Date().toISOString();
          ambigApplied++;
        }
      });
      try { Storage.save?.(); } catch (e) { console.warn('[scanner2] save после resolve failed:', e); }
      telemetryEmit('scanner2.identity_resolve_save', {
        changesCount: changes.length,
        fieldsUpdated: updated,
        ambigPicked: ambigApplied,
      });
      close();
      // V20 S6.1 — re-render diag-modal с свежим coverage (раньше остались
      // stale показатели). Закрываем старый, открываем новый.
      const stillOpen = document.getElementById('ts2-diag-modal');
      if (stillOpen) {
        stillOpen.remove();
        // Чтобы document.removeEventListener для escape тоже отработал —
        // явно вызовем _openDiagModal заново, он переподпишет всё.
        requestAnimationFrame(() => this._openDiagModal());
      }
      // Уведомление + предложение перезагрузить данные.
      const ambigTxt = ambigApplied ? ` + ${ambigApplied} тёзок выбрано` : '';
      this._announce(`Identity заполнен: ${updated} полей у ${changes.length} сотрудников${ambigTxt}. Нажмите кнопку «Обновить» чтобы пересчитать с новой identity.`);
      try { window.showToast?.(`Identity обновлён: ${updated} полей${ambigTxt}`, 'success', 5000); } catch (_) {}
    });
  },

  /**
   * V22 B1+B2 — Bulk auto-resolve без preview-modal'а.
   *
   * Отличие от `_runIdentityResolve`:
   *   · НЕ открывает preview — сразу применяет все unambiguous изменения
   *   · Применяет ТОЛЬКО bb.slug если у emp.bitbucketLogin пусто
   *     (bulk-режим = заполняем дыры, не перезаписываем существующее)
   *   · То же для cf.accountId
   *   · Ambiguous (несколько тёзок с одним ФИО) — пропускаются
   *   · Результат — toast «Найдено: N cfId, M bbLogin, K не найдены, L ошибки»
   *   · Telemetry-event scanner2.bulk_resolve_completed
   *
   * Зачем отдельный метод (а не флаг в `_runIdentityResolve`):
   * preview-flow в S4 — ручной review каждого изменения перед save.
   * Bulk-flow — для случая «у меня 75 человек без cfId, я доверяю
   * email-match'у, заполни всех скопом». Семантика разная — две точки
   * входа в UI лучше одной с modifier'ом.
   *
   * State-mutation в Reactive.silent (контракт #1 в CLAUDE.md). Логи
   * не содержат email/токенов (scrub-policy).
   */
  async _runBulkIdentityResolve(diagOverlay) {
    const btn = diagOverlay.querySelector('#ts2-diag-bulk-resolve-btn');
    const out = diagOverlay.querySelector('#ts2-diag-resolve-results');
    if (!btn || !out) return;
    if (this._isDemoBlocked('bulk_resolve')) {
      out.innerHTML = '<div class="ts2-diag-empty">Демо-режим: bulk-resolve недоступен (нет реальных API).</div>';
      return;
    }
    // Отдельные подсчёты для cf, bb и jenkins — для счётчика в кнопке и UX-feedback'а.
    // Phase-2 (2026-05-10) — Jenkins добавлен как 3-й identity-канал.
    const candidatesCf = (state.employees || []).filter(emp =>
      emp.email && !emp.isServiceAccount && !emp.confluenceAccountId);
    const candidatesBb = (state.employees || []).filter(emp =>
      emp.email && !emp.isServiceAccount && !emp.bitbucketLogin);
    const candidatesJk = (state.employees || []).filter(emp =>
      emp.email && !emp.isServiceAccount && !emp.jenkinsUserName);
    // Union: dedup, чтобы один emp не уходил дважды на сервер.
    const unionMap = new Map();
    for (const e of [...candidatesCf, ...candidatesBb, ...candidatesJk]) {
      const k = e.id || e.jiraKey || e.email;
      if (!unionMap.has(k)) unionMap.set(k, e);
    }
    const candidates = [...unionMap.values()];
    if (!candidates.length) {
      out.innerHTML = '<div class="ts2-diag-ok">Все сотрудники с email уже имеют bbLogin / cfAccountId / jenkinsUserName. Bulk-resolve не нужен.</div>';
      return;
    }
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = `Bulk-резолв ${candidates.length}…`;
    out.innerHTML = `<div class="ts2-diag-empty">Параллельный API-lookup в BB, Confluence и Jenkins. Ожидаемое время: ~${Math.ceil(candidates.length / 12 * 10)} сек. Confluence DC может тормозить — concurrency 12 на сервере.</div>`;
    try {
      const items = candidates.map(emp => ({
        key: emp.id || emp.jiraKey || emp.email,
        email: emp.email,
        fullname: emp.fio || '',
      }));
      const resp = await resolveIdentitiesByEmail(items);
      if (resp.error) {
        out.innerHTML = `<div class="ts2-diag-empty">Ошибка: ${Utils.escapeHtml(resp.error)}</div>`;
        try { telemetryEmit('scanner2.bulk_resolve_completed', { ok: false, total: candidates.length, error: String(resp.error).slice(0, 80) }); } catch (_) {}
        return;
      }
      // Build mutation plan через pure mapper.
      const empByKey = new Map(candidates.map(e => [String(e.id || e.jiraKey || e.email), e]));
      let cfFilled = 0, bbFilled = 0, jkFilled = 0;
      let cfNotFound = 0, bbNotFound = 0, jkNotFound = 0;
      let errors = 0, ambiguous = 0;
      const plan = []; // { emp, bbSlug?, cfAccountId?, jkName? }
      for (const r of resp.results) {
        const emp = empByKey.get(String(r.key));
        if (!emp) continue;
        const m = mapResolveResultToIdentity(r);
        const ambig = !!(r.cf && r.cf.ambiguousCandidates);
        if (ambig) ambiguous++;
        const action = { emp };
        // BB: заполняем только если у emp пусто.
        if (!emp.bitbucketLogin) {
          if (m.bb.ok && m.bb.slug) action.bbSlug = m.bb.slug;
          else if (m.bb.error === 'BB не настроен' || m.bb.error === 'нет email') {
            // не считаем как not-found — это конфигурация, не lookup-fail
          } else if (m.bb.ok === false) bbNotFound++;
        }
        // CF: то же.
        if (!emp.confluenceAccountId) {
          if (m.cf.ok && m.cf.accountId) action.cfAccountId = m.cf.accountId;
          else if (m.cf.error === 'CF не настроен') {
            // skip
          } else if (m.cf.ok === false && !ambig) cfNotFound++;
        }
        // Jenkins: точное name-match по fullName (case-insensitive,
        // whitespace-trim — server делает это в _loadJenkinsPeople).
        // Никаких fuzzy — identity-deterministic per CLAUDE.md контракт #2.
        if (!emp.jenkinsUserName) {
          if (m.jenkins.ok && m.jenkins.name) action.jkName = m.jenkins.name;
          else if (m.jenkins.error === 'Jenkins не настроен' || m.jenkins.error === 'нет email и fio') {
            // skip конфигурационные ошибки
          } else if (m.jenkins.ok === false) jkNotFound++;
        }
        if (action.bbSlug || action.cfAccountId || action.jkName) plan.push(action);
        // Жёсткая ошибка типа HTTP 5xx — отдельный счётчик.
        if (m.bb.error && /^HTTP [45]\d\d/.test(m.bb.error)) errors++;
        if (m.cf.error && /^HTTP [45]\d\d/.test(m.cf.error)) errors++;
        if (m.jenkins.error && /^HTTP [45]\d\d/.test(m.jenkins.error)) errors++;
      }
      // Mass-mutation в Reactive.silent (контракт #1).
      if (plan.length) {
        Reactive.silent(() => {
          for (const a of plan) {
            if (a.bbSlug && !a.emp.bitbucketLogin) {
              a.emp.bitbucketLogin = a.bbSlug;
              bbFilled++;
            }
            if (a.cfAccountId && !a.emp.confluenceAccountId) {
              a.emp.confluenceAccountId = a.cfAccountId;
              cfFilled++;
            }
            if (a.jkName && !a.emp.jenkinsUserName) {
              a.emp.jenkinsUserName = a.jkName;
              jkFilled++;
            }
            a.emp.updatedAt = new Date().toISOString();
          }
        });
        // 2026-05-11 — user-visible toast при QuotaExceededError. Раньше
        // ошибка глоталась в console.warn → юзер думал «привязки сохранены»,
        // потом reload → всё потеряно. Теперь toast + telemetry.
        try {
          Storage.save?.();
        } catch (e) {
          const msg = String(e?.message || e);
          const isQuota = e?.name === 'QuotaExceededError' || /quota/i.test(msg);
          console.warn('[scanner2] save после bulk-resolve failed:', msg);
          try {
            const userMsg = isQuota
              ? `Привязки сохранены в памяти, но хранилище браузера переполнено — после перезагрузки часть может потеряться. Очистите историю снимков (Настройки → Storage).`
              : `Не удалось сохранить привязки: ${msg.slice(0, 80)}`;
            window.showToast?.(userMsg, 'warn', 8000);
          } catch (_) {}
          try { telemetryEmit('scanner2.silent_error', { where: 'bulkResolveSave', isQuota, msg: msg.slice(0, 100) }); } catch (_) {}
        }
      }
      const summary = {
        total: candidates.length,
        cfFilled, bbFilled, jenkinsFilled: jkFilled,
        cfNotFound, bbNotFound, jenkinsNotFound: jkNotFound,
        errors, ambiguous,
      };
      // 2026-05-11 — capture last resolve report для diagnostic export'а.
      // Хранит aggregate counts, server breakdowns (matched/notFound/
      // ambiguous/apiError/...) и failure samples (anonymized в diagnostic'е).
      this._lastResolveReport = {
        ts: Date.now(),
        client: summary,
        server: resp.summary || null,
        appliedCount: plan.length,
      };
      // Telemetry — БЕЗ raw email/fio, только counts.
      try { telemetryEmit('scanner2.bulk_resolve_completed', { ok: true, ...summary }); } catch (_) {}
      // Inline-summary в diag.
      const parts = [];
      if (cfFilled)   parts.push(`<b>${cfFilled}</b> cfId`);
      if (bbFilled)   parts.push(`<b>${bbFilled}</b> bbLogin`);
      if (jkFilled)   parts.push(`<b>${jkFilled}</b> jenkinsUserName`);
      const notFoundParts = [];
      if (cfNotFound) notFoundParts.push(`${cfNotFound} cf`);
      if (bbNotFound) notFoundParts.push(`${bbNotFound} bb`);
      if (jkNotFound) notFoundParts.push(`${jkNotFound} jenkins`);
      const summaryHtml = `<div class="ts2-diag-ok">
        ${Icons.get('check', { cls: 'btn-icon', size: 12 })}
        Найдено: ${parts.length ? parts.join(' · ') : '0 полей'}.
        ${notFoundParts.length ? `Не найдены: ${notFoundParts.join(', ')}.` : ''}
        ${ambiguous ? `Тёзки (требуют preview): ${ambiguous}.` : ''}
        ${errors ? `Ошибки сервера: ${errors}.` : ''}
      </div>`;
      out.innerHTML = summaryHtml;
      // Toast с тем же breakdown'ом.
      const toastMsg = `Bulk-resolve: найдено ${cfFilled} cfId · ${bbFilled} bbLogin · ${jkFilled} jenkinsUserName · не найдено ${cfNotFound + bbNotFound + jkNotFound} · ошибок ${errors}`;
      try { window.showToast?.(toastMsg, (cfFilled + bbFilled + jkFilled) > 0 ? 'success' : 'warn', 6000); } catch (_) {}
      this._announce(toastMsg + '. Нажмите «Обновить» чтобы пересчитать coverage с новой identity.');
      // Re-render diag-modal с свежим coverage.
      const stillOpen = document.getElementById('ts2-diag-modal');
      if (stillOpen && (cfFilled + bbFilled + jkFilled) > 0) {
        stillOpen.remove();
        requestAnimationFrame(() => this._openDiagModal());
      }
    } catch (e) {
      // Scrub: e.message может содержать URL с email-параметром — обрезаем
      // до 80 символов и проходим через redactSecretsInText.
      const safeMsg = String(e?.message || 'unknown').slice(0, 100);
      out.innerHTML = `<div class="ts2-diag-empty">Bulk-resolve failed: ${Utils.escapeHtml(safeMsg)}</div>`;
      try { telemetryEmit('scanner2.bulk_resolve_completed', { ok: false, total: candidates.length, error: safeMsg.slice(0, 80) }); } catch (_) {}
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  },

  /**
   * V20 S2 — выполнить экспорт. Скачивает JSON file через Blob + a-tag,
   * audit-логирует факт, telemetry-emit'ит для аналитики.
   * V20 S7 B6 — для raw-mode принимает consentGiven + disclaimerVersion
   * (записываются в audit-log).
   */
  _performExport(state, mode, consentMeta = {}) {
    try {
      const { json, sizeBytes } = prepareDiagnosticExport(state, mode);
      const filename = `scanner2-diagnostic-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
      // Blob + a[download] — стандартный no-dependency способ.
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // RevokeObjectURL после небольшого delay — некоторые браузеры
      // запускают download асинхронно.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      // Audit log + telemetry.
      logExport({
        mode, sizeBytes, projectKeys: this._readConfig().projectKeys,
        // V20 S7 B6 + S8 #6 — compliance attestation.
        consentGiven:      !!consentMeta.consentGiven,
        disclaimerVersion: consentMeta.disclaimerVersion || null,
        consentSource:     consentMeta.consentSource || null,     // explicit-once / explicit-remember / remembered-24h
      });
      // V20 S8 #14 + S8.5 #11 — server-side audit log с retry queue.
      // Раньше fire-and-forget — при 5xx / network failure записи терялись.
      // HR-аудит мог увидеть дыру в trail. Теперь queue в localStorage,
      // retry на следующем mount или после успешного fetch'а.
      try {
        const pkCount = (this._readConfig().projectKeys || []).length;
        const auditEntry = {
          ts: Date.now(),
          mode, sizeBytes, pkCount,
          consentGiven:      !!consentMeta.consentGiven,
          consentSource:     consentMeta.consentSource || null,
          disclaimerVersion: consentMeta.disclaimerVersion || null,
        };
        this._enqueueServerAudit(auditEntry);
        this._flushServerAuditQueue();
      } catch (_) {}
      telemetryEmit('scanner2.diag_export', { mode, sizeBytes, consentGiven: !!consentMeta.consentGiven });
      this._announce(mode === 'safe'
        ? `Безопасный экспорт сохранён (${Math.round(sizeBytes / 1024)} КБ). Можно отправить разработчику.`
        : `Полный экспорт сохранён (${Math.round(sizeBytes / 1024)} КБ). ОСТОРОЖНО: содержит PII.`);
    } catch (e) {
      console.warn('[scanner2] diagnostic export failed:', e);
      this._announce('Не удалось создать экспорт: ' + (e?.message || 'неизвестная ошибка'));
    }
  },

  /**
   * Выгрузка standalone HTML-брифа выбранной команды. Берёт текущий
   * `_model`, применяет тот же pk-filter, что и `_renderFull()` в single-team
   * view, передаёт в `exportTeamBrief()`. В multi-view kebab-item не
   * рендерится — но всё равно гардим на случай прямого вызова.
   *
   * 2026-06-01 — sync. LLM-сводка вынесена в live-модалку (lazy fetch
   * при раскрытии «Сводки ассистента»), бриф снова мгновенный.
   */
  _exportBrief() {
    if (!this._model) {
      this._announce('Нет данных — сначала обновите Сканнер.');
      return;
    }
    if (this._activeView === 'multi') {
      this._announce('Бриф выгружается для одной команды. Выберите команду в переключателе.');
      return;
    }
    try {
      const filteredModel = (this._activePkFilter && this._activeView === 'team')
        ? this._applyPkFilter(this._model, this._activePkFilter)
        : this._model;
      const teamLabel = this._activePkFilter || (filteredModel.projectKeys || []).join(', ') || 'команда';
      exportTeamBrief(filteredModel, { teamLabel });
      this._announce(`Бриф команды ${teamLabel} сохранён.`);
    } catch (e) {
      console.warn('[scanner2] brief export failed:', e);
      this._announce('Не удалось создать бриф: ' + (e?.message || 'неизвестная ошибка'));
    }
  },

  /**
   * Бриф v2.0 — decision artefact с TL;DR, attention queue, KPI band,
   * Idle/Stop секцией, PR queue, roster с дельтами и чек-боксами,
   * audience-mode, анонимизацией, print-стилями и copy-MD для чата.
   * Реализует рекомендации экспертной панели (workflow brief-html-utility-audit).
   */
  _exportBriefV2() {
    if (!this._model) {
      this._announce('Нет данных — сначала обновите Сканнер.');
      return;
    }
    if (this._activeView === 'multi') {
      this._announce('Бриф выгружается для одной команды. Выберите команду в переключателе.');
      return;
    }
    try {
      const filteredModel = (this._activePkFilter && this._activeView === 'team')
        ? this._applyPkFilter(this._model, this._activePkFilter)
        : this._model;
      const teamLabel = this._activePkFilter || (filteredModel.projectKeys || []).join(', ') || 'команда';
      const userEmail = (typeof window !== 'undefined' && window.userEmail) ? window.userEmail : '';
      exportTeamBriefV2(filteredModel, {
        teamLabel,
        context: {
          history: this._historyOverride || null,
          prev: this._prevSnapshot || null,
          employees: appState.employees || [],
          userEmail,
        },
      });
      this._announce(`Бриф v2.0 команды ${teamLabel} сохранён.`);
    } catch (e) {
      console.warn('[scanner2] brief v2 export failed:', e);
      this._announce('Не удалось создать бриф v2.0: ' + (e?.message || 'неизвестная ошибка'));
    }
  },

  /**
   * V18.3 A1 — пересчитать enrichment с новой config'ой. Поскольку
   * blockers требуют raw assigneeIndex (которым model owner is not),
   * самый простой вариант — refresh всего pulse'а с новыми порогами.
   * 5-15 сек на re-fetch это accepted price для UX «save → instant
   * pересчёт». Альтернатива — кэшировать rawReports в orchestrator'е,
   * но это удваивает memory footprint (raw + model хранятся вместе).
   */
  _reEnrichWithNewConfig() {
    // Trigger полный refresh — берёт teamThresholds через
    // buildTeamThresholdsMap() в _fetchAndRender автоматически.
    this.refresh();
  },

  _closePanel() {
    // V18.1 P7-S3.1 — сохранили key до сброса, чтобы restore focus
    // на row после закрытия panel'и.
    // 2026-05-17 — заменили `_renderFull()` (full rebuild ~2200 nodes) на
    // partial DOM-update: удаляем panel + backdrop, снимаем
    // `ts2-row-expanded` руками. Раньше закрытие модалки = «jerk экрана»
    // как при открытии. Теперь — только slide-out панели.
    const focusKey = this._expandedKey;
    // 2026-06-01 — abort активный LLM-fetch для этого сотрудника, чтобы он
    // не отрисовал результат в detached DOM. Кэш НЕ чистим — следующее
    // открытие модалки заберёт готовый ответ (если успел).
    try { this._assistantInflight.get(focusKey)?.abort?.(); } catch (_) {}
    this._assistantInflight.delete(focusKey);
    this._expandedKey = '';
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._container) {
      this._container.querySelector('#ts2-panel-backdrop')?.remove();
      this._container.querySelector('.ts2-panel')?.remove();
      this._container.querySelectorAll('.ts2-row.ts2-row-expanded').forEach(r => {
        r.classList.remove('ts2-row-expanded');
        r.setAttribute('aria-expanded', 'false');
      });
    }
    // Снимаем body-class «модалка открыта» — FAB снова видим.
    // (Через _syncModalClass на случай если параллельно открыт diag-modal.)
    this._syncModalClass();
    // Restore focus на row из которого открыли panel.
    if (focusKey && this._container) {
      const row = this._container.querySelector(`.ts2-row[data-key="${focusKey}"]`);
      if (row) requestAnimationFrame(() => row.focus());
    }
    this._announce('Панель детализации закрыта');
  },

  /**
   * V18.1 P7-S1.1 — unmount lifecycle hook. Вызывается из IntegrationsView
   * когда пользователь переключается с subtab'а scanner2 на другой
   * (pulse/black/perf/overview).
   *
   * Зачем: `_escHandler` живёт на `document` (global), а не на нашем
   * container'е. Без unmount при смене subtab handler копится — каждое
   * открытие panel'и + переключение subtab оставляет orphan listener.
   * Через 5 повторений Esc в чужом subtab'е дёргает несуществующую
   * panel в скрытом scanner2 → race + DOM operations on detached node.
   *
   * unmount НЕ сбрасывает `_model` / `_jobId` / `_detailCache` — они
   * нужны при возврате на subtab (cache hit без re-fetch).
   */
  unmount() {
    // V22+ Phase 5.2 — restore mascot для других вкладок (guarded для test-shim'ов)
    // 2026-05-17 — также снимаем `is-ts2-modal-open` если уходим с открытой
    // модалкой (например, click на nav.Реестр пока модалка сотрудника висит).
    // Иначе body-class leak'ает на другие вкладки и FAB остаётся скрытым.
    if (typeof document !== 'undefined' && document.body?.classList) {
      document.body.classList.remove('ts2-active');
      document.body.classList.remove('is-ts2-modal-open');
    }
    // QF8: clear lastRawDiag + pending-share-key при unmount, чтобы
    // следующий mount не показал stale-данные предыдущей сессии.
    this._lastRawDiag = null;
    this._pendingShareKey = '';
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    // V20 S12 U9 — снять global `/` handler.
    if (this._slashHandler) {
      document.removeEventListener('keydown', this._slashHandler);
      this._slashHandler = null;
    }
    // V21 Phase 4 F3 — abort kebab AbortController (снимает outside-click,
    // esc, и per-item handler'ы за один вызов). Без этого orphan listener'ы
    // на document жили после смены subtab'а — listener-leak.
    try { this._kebabAbort?.abort(); } catch (_) { /* ignore */ }
    this._kebabAbort = null;
    // TECH 17.3 — снимаем все global document/window listener'ы (slash, esc,
    // focus-bridge, EventBus) одним abort'ом. Дублирует removeEventListener
    // выше для обратной совместимости (handler можно явно nullify, abort()
    // дополнительно подстрахует — idempotent). Создаём новый controller на
    // случай если orchestrator переиспользуют без detach/attach pair'а.
    try { this._globalAbortCtrl?.abort(); } catch (_) { /* ignore */ }
    this._globalAbortCtrl = null;
    // V21 Phase 4 F1 — search-cache чистим чтобы heap не держал участников
    // прошлой сессии (особенно когда subtab закрыт надолго).
    _resetSearchCache();
    // Закрываем panel чтобы не сохранять её состояние в скрытом subtab'е.
    this._expandedKey = '';
    // V20 S11.1 BUG-2 — сброс one-time флага «применили persisted team из
    // localStorage». При re-attach на subtab → _renderFull снова прочитает
    // localStorage и применит выбор. Без сброса: пользователь меняет
    // команду в other-tab (другая вкладка браузера), возвращается — видит
    // stale выбор с прошлого attach.
    this._initialTeamApplied = false;
    // Сбросим search query чтобы при возврате на subtab был чистый список.
    this._searchQuery = '';
    // V21 Phase 4 F1 — debounced search-handler привязан к старому _renderFull
    // closure'у через `this`; при unmount чистим чтобы рекреировать на attach
    // (новый container = другие DOM-ноды, иначе на следующем bind handler'е
    // живой setTimeout мог дёрнуть `_renderFull` на размонтированном subtab'е).
    this._searchInputHandler = null;
  },
};

// AUDIT_HOLISTIC §5.1 — global exposure for cross-module focus-bridge
// (app.js subscribes EventBus.on('focus-changed') → TeamScanner2.applyFocus).
Services.register('TeamScanner2', TeamScanner2);
if (typeof window !== 'undefined') window.TeamScanner2 = TeamScanner2;
