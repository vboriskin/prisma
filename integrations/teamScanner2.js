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
import { Reactive } from '../reactiveStore.js';
import { Storage } from '../dataStore.js';
import { resolveIdentitiesByEmail } from './integrationsSync.js';
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
// V19 C2 — multi-day history (Anna PO + Dmitry pilot ask: «какие новости?»).
import {
  saveDailySnapshot, loadHistory, extractTrendSeries,
} from './teamScanner2History.js';
import {
  renderTopBar, renderTeamGlance, renderPersonRows, renderEmployeeDetailPanel,
  renderMultiTeamView, renderTeamConfigModal,
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
} from './teamScanner2Renderer.js';
// V20 S2.2 / S3.1-3 — Diagnostic state gathering + JSON export +
// connection probe + threshold sensitivity (single source of truth).
import {
  gatherDiagnosticState, prepareDiagnosticExport, logExport, readAuditLog,
  runConnectionProbe, simulateThresholds,
  // V20 S8.5 #19 — счётчик known-issues для badge на топбаре.
  countKnownIssues,
} from './teamScanner2Diagnostic.js';

export const TeamScanner2 = {
  _model: null,
  _container: null,
  _abort: null,
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
  // V18.1 P4 — captured jobId (из callback fetchPulseData → onJobId)
  // используется для lazy server-side drill-down. Истекает через
  // 30 мин по TTL `_pulseJobs` cluster'а на сервере.
  _jobId: '',
  // Per-employee server-fetched detail cache. Ключ — employeeKey.
  // P4 опциональный: сейчас НЕ заменяет local enrichment, добавлен для
  // P5+ side-panel (где может потребоваться refresh с другим dwellHours).
  _detailCache: new Map(),

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
  _isCacheStale() {
    return this._cacheAgeMs() > this._FRESH_TTL_MS;
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
      localStorage.setItem(this._snapshotKey(), JSON.stringify(snap));
      // V20 S7 B2 — cleanup старых snapshot-ключей, чтобы избежать quota
      // exceeded. У тимлида с rotated проектами за год накопится много
      // ключей q2_scanner2_snapshot:HASH — каждый ~250B, но десятками
      // могут начать съедать localStorage.
      this._cleanupStaleSnapshots();
    } catch (e) {
      // V20 S8.5 #5 — quota exceeded больше не silent. Pилот «нет тренда» — увидим причину.
      try { telemetryEmit('scanner2.silent_error', { where: '_saveSnapshot', msg: String(e?.message || e).slice(0, 100) }); } catch (_) {}
    }
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
    const { projectKeys } = this._readConfig();
    if (!projectKeys.length) {
      container.innerHTML = renderEmpty('no-config');
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
    const key = decodeURIComponent(match[1]);
    if (!key) return;
    // V20 S7 B4 — Sanity guard against XSS via crafted share-link.
    // Allowed: letters/digits/._-/numbers (Jira user keys typically `jirauser123`,
    // `cab-sa-jira0008`, `ivanov.ii`, `08350318`).
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
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

  /** V18.3 A4 — записать current expandedKey в URL hash (replaceState
   *  чтобы не плодить history entries). При close — очищаем. */
  _updateShareLinkHash() {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    try {
      const newHash = this._expandedKey
        ? `#scanner2/employee/${encodeURIComponent(this._expandedKey)}`
        : '';
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
    this._cancelled = false;
    this._errorMsg  = '';
    this._model     = null;
    this._expandedKey = '';
    this._jobId     = '';
    this._detailCache.clear();
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

  async fetchDetail(employeeKey, opts = {}) {
    if (!employeeKey) throw new Error('employeeKey required');
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
    const detail = await fetchEmployeeDetail({
      jobId:       this._jobId,
      employeeKey,
      dwellHours:  opts.dwellHours,
      // V18.1 P7-S2.3 — пробрасываем browser TZ для consistent heatmap.
      tzOffsetMin: this._tzOffsetMin ?? new Date().getTimezoneOffset(),
      timeoutMs:   opts.timeoutMs || 30000,
    });
    // LRU-style eviction если превысили maxEntries.
    if (this._detailCache.size >= this._DETAIL_CACHE_MAX_ENTRIES) {
      const firstKey = this._detailCache.keys().next().value;
      if (firstKey) this._detailCache.delete(firstKey);
    }
    this._detailCache.set(cacheKey, { detail, _cachedAt: Date.now() });
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
    this._container.innerHTML = renderError(msg, true);
    this._bindRetry();
  },
  _bindRetry() {
    this._container?.querySelector('#ts2-retry-btn')?.addEventListener('click', () => this.refresh());
  },

  _showLoader() {
    if (!this._container) return;
    const initialMsg = this._loadingMsg
      || `Запрашиваю ${this._readConfig().projectKeys.length} проект(а/ов) из Jira…`;
    this._container.innerHTML = renderSkeleton(initialMsg);
    this._container.querySelector('#ts2-skel-cancel')?.addEventListener('click', () => {
      try { this._abort?.abort(); } catch (_) {}
      this._loading   = false;
      this._cancelled = true;
      this._paintCancelled();
    });
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
      this._abort = new AbortController();
      const raw = await fetchPulseData({
        projectKeys,
        signal: this._abort.signal,
        timeoutMs: 600000,
        employees: state.employees || [],
        // V18.1 P4 — capture jobId для последующего drill-down.
        // sync-fallback не передаст jobId → drill-down будет недоступен
        // (graceful: TeamScanner2.fetchDetail() throws «No jobId»).
        onJobId: (id) => { this._jobId = id; this._detailCache.clear(); },
      });
      if (reqId !== this._reqId) return;
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
        cfAuthorsCount: Object.keys(raw?.confluence?.authors || {}).length,
        cfItemsTotal: Object.values(raw?.confluence?.authors || {}).reduce((s, a) => s + (a?.items?.length || 0), 0),
        // V20 S9 — Real Zephyr fetch counts.
        zephyrConfigured: !!(raw?.zephyr?.configured),
        zephyrAuthorsCount: Object.keys(raw?.zephyr?.authors || {}).length,
        zephyrTestCasesScanned: raw?.zephyr?.summary?.testCasesScanned || 0,
        zephyrTestRunsScanned: raw?.zephyr?.summary?.testRunsScanned || 0,
        zephyrProjectsResolved: raw?.zephyr?.summary?.projectsResolved || 0,
        perPk: (raw?.reports || []).map(r => ({
          pk: r.projectKey,
          issuesCount: (r.issues || []).length,
          sprintCount: (r.sprintKeys || []).length,
          hasError: !!r.error,
          error: r.error || null,
        })),
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
      this._model = enrichForScanner2(baseModel, raw, {
        dwellHours: 24,
        tzOffsetMin: this._tzOffsetMin,
        teamThresholds,
      });
      // V20 S1.1 — client-side timestamp для cache-age TTL (5 мин hybrid).
      // Отличается от model.fetchedAt (server-side timestamp): фиксирует
      // момент когда orchestrator получил данные, а не когда сервер их
      // собрал. Используется в _isCacheStale() и в stale-banner UI.
      this._model._fetchedAtMs = Date.now();
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
      this._errorMsg = msg;
      this._paintError(msg);
    } finally {
      this._loading = false;
      this._loadingMsg = '';
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
  _syncEmployeesFromParticipants(model) {
    if (!model || !Array.isArray(model.participants)) return;
    const ps = model.participants;
    if (!ps.length) return;

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
        // V20 S4 — auto-detect by participant.key (cab-sa-*, sbt-*, out-*).
        // Если detect=true → bot будет автомат. помечен. Передаём явный
        // флаг чтобы normalize не перезаписал на "false" если key сложный.
        sourceType:    'jira-auto',
        // jiraKey используем для service-account auto-detect в normalize().
        jiraKey:       p.key || '',
      });
    }
    if (!toCreate.length) return;

    // Mass-mutation в Reactive.silent — CLAUDE.md контракт #1.
    // V20 S7 B3 — Storage.save() вынесен ЗА silent-block. Внутри silent
    // _silentDepth>0; если save throws (quota exceeded) при счётчике > 0,
    // catch обрабатывает и silent-block корректно завершается. Внутри
    // silent логи storage.save могут заглушать listeners.
    Reactive.silent(() => {
      for (const seed of toCreate) {
        const emp = EmployeeFactory.create(seed);
        // Удалим временный jiraKey (не наше поле в registry).
        delete emp.jiraKey;
        appState.employees.push(emp);
      }
    });
    try { Storage.save?.(); } catch (e) { console.warn('[scanner2] storage.save failed:', e); }
    telemetryEmit('scanner2.auto_create_employees', {
      count: toCreate.length,
      totalParticipants: ps.length,
    });
    // Mute: Pulse внутреннее изменение — не показываем toast (визуально
    // тихо, только видно что counts стали корректнее).
    console.info(`[scanner2] auto-created ${toCreate.length} employees from Jira participants`);
  },

  /* ── Render dashboard ──────────────────────────────── */
  _renderFull() {
    if (!this._container || !this._model) return;
    const m = this._model;
    // V18.3 A4 — apply pending share-link если model только что загружен.
    if (this._pendingShareKey) {
      const exists = (m.participants || []).some(p => p.key === this._pendingShareKey);
      if (exists) this._expandedKey = this._pendingShareKey;
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
    const filteredModel = (this._activePkFilter && this._activeView === 'team')
      ? this._applyPkFilter(m, this._activePkFilter)
      : m;
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
        ${renderPersonRows(filteredModel, { expandedKey: this._expandedKey })}`;
    const html = `
      <div class="ts2-root">
        ${renderTopBar(m, { prev, activeView: this._activeView, cacheAgeMs, isStale, sprintGoalSlope, knownIssuesCount })}
        ${bodyHtml}
      </div>
      <div class="ts2-aria-live" aria-live="polite" aria-atomic="true" id="ts2-aria-live"></div>
      ${this._expandedKey ? `<div class="ts2-panel-backdrop" id="ts2-panel-backdrop"></div>${panelHtml}` : ''}
    `;
    this._container.innerHTML = html;
    this._bindEvents();
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
    return {
      ...model,
      participants: (model.participants || []).filter(
        p => Array.isArray(p.projects) && p.projects.includes(pk),
      ),
    };
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
    root.querySelector('#ts2-refresh-btn')?.addEventListener('click', () => this.refresh());
    // V20 S8 #5 — Kebab toggle. Click-outside / Esc — закрывает меню.
    const kebabBtn = root.querySelector('#ts2-kebab-btn');
    const kebabMenu = root.querySelector('#ts2-kebab-menu');
    if (kebabBtn && kebabMenu) {
      const closeKebab = () => {
        kebabMenu.hidden = true;
        kebabBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', outsideClick);
        document.removeEventListener('keydown', escKebab);
      };
      const outsideClick = (ev) => { if (!kebabMenu.contains(ev.target) && ev.target !== kebabBtn) closeKebab(); };
      const escKebab = (ev) => { if (ev.key === 'Escape') closeKebab(); };
      kebabBtn.addEventListener('click', () => {
        const open = kebabMenu.hidden;
        kebabMenu.hidden = !open;
        kebabBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          // Регистрация click-outside нужно в setTimeout чтобы текущий click не закрыл сразу.
          setTimeout(() => {
            document.addEventListener('click', outsideClick);
            document.addEventListener('keydown', escKebab);
          }, 0);
        } else {
          document.removeEventListener('click', outsideClick);
          document.removeEventListener('keydown', escKebab);
        }
      });
      // Auto-close kebab при click-on-item (chooser-pattern).
      kebabMenu.querySelectorAll('.ts2-kebab-item').forEach(item => {
        item.addEventListener('click', () => closeKebab());
      });
    }
    // V18.1 P7-S4.1 — view toggle (team ↔ multi).
    root.querySelector('#ts2-view-toggle')?.addEventListener('click', () => {
      this._activeView = this._activeView === 'multi' ? 'team' : 'multi';
      // V19 C4 — telemetry: view-mode usage (Dmitry multi-team feature uptake).
      telemetryEmit('scanner2.view_change', { mode: this._activeView });
      this._closePanel();   // closes any open detail panel + does _renderFull
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
    // V20 S1.5 — stale-banner refresh button (cache > 5min).
    root.querySelector('#ts2-stale-refresh')?.addEventListener('click', () => {
      telemetryEmit('scanner2.stale_refresh_click', { ageMs: this._cacheAgeMs() });
      this.refresh();
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
      });
    });
    // V20 S8 #3 — triage-pill click → открыть карточку участника (как row click).
    root.querySelectorAll('.ts2-triage-pill-item[data-jump-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.jumpKey;
        if (!key) return;
        this._expandedKey = key;
        telemetryEmit('scanner2.triage_jump', {});
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
          `🗣 1:1 talking points с ${p.label || p.key}`,
          `📊 Сегодня: ${(p.timelineToday || []).length} событий · WIP ${(p.issuesNow || []).length}`,
          ...(blockers.length ? ['🚫 Блокеры:'] : []),
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
          btn.textContent = '✓';
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
        this._activeView = 'team';
        this._activePkFilter = el.dataset.teamPk || '';
        this._renderFull();
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
    root.querySelectorAll('.ts2-row[data-key]').forEach(el => {
      const activate = (e) => {
        if (e.target.closest('a, button')) return;
        const key = el.dataset.key;
        const opening = (this._expandedKey !== key);
        this._expandedKey = opening ? key : '';
        // V19 C4 — telemetry: detail-panel open/close (понимаем drill-down rate).
        if (opening) telemetryEmit('scanner2.detail_open', { mode: this._activeView });
        else         telemetryEmit('scanner2.detail_close', { trigger: 'row_toggle' });
        this._renderFull();   // полный rebuild — меняется и dashboard (highlight active row)
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
      document.addEventListener('keydown', this._escHandler);
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
    // V18.1 P7-S3.5 — email reveal toggle. Click переключает masked ↔ full.
    root.querySelectorAll('[data-email-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const isMasked = btn.textContent.includes('*');
        btn.textContent = isMasked ? btn.dataset.emailFull : btn.dataset.emailMasked;
        btn.setAttribute('aria-label', isMasked
          ? 'Email сотрудника показан целиком, нажать чтобы скрыть'
          : 'Email сотрудника, нажать чтобы показать целиком');
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
        `🗣 1:1 talking points с ${p.label || p.key}`,
        `📊 PR throughput: ${prT?.opened || 0} opened · ${prT?.merged || 0} merged · ${Math.round((prT?.mergeRate || 0) * 100)}% merge-rate`,
        `⚠ Flag: ${prT?.flag || 'unknown'}`,
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
        btn.textContent = '✓ скопировано';
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
      const lines = [`👤 ${p.label || p.key}`];
      const todayN = (p.timelineToday || []).length;
      const yestN  = (p.timelineYesterday || []).length;
      const wipN   = (p.issuesNow || []).length;
      lines.push(`📊 События: сегодня ${todayN} · вчера ${yestN} · WIP ${wipN}`);
      const blockers = (p.blockers || []).slice(0, 3);
      if (blockers.length) {
        lines.push('🚫 Топ блокеры:');
        for (const b of blockers) {
          lines.push(`  · ${b.key} «${(b.summary || '').slice(0, 50)}» — ▌${b.dwellHours || 0}ч в "${b.status || '?'}"`);
        }
      }
      const com48 = p.badges?.commits48h || 0;
      const pr48  = p.badges?.pr48h || 0;
      const cf48  = p.badges?.conf48h || 0;
      if (com48 || pr48 || cf48) lines.push(`🔧 За 48ч: ${com48} коммитов · ${pr48} PR · ${cf48} CF-правок`);
      // Permalink.
      try {
        const url = (typeof location !== 'undefined' ? location.href : '');
        if (url) lines.push(`🔗 ${url}`);
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
        btn.textContent = '✓ скопировано';
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
        const orig = btn.textContent;
        btn.textContent = '✓';
        btn.classList.add('ts2-panel-share-copied');
        setTimeout(() => {
          btn.textContent = orig;
          btn.classList.remove('ts2-panel-share-copied');
        }, 1500);
        this._announce('Ссылка скопирована в буфер обмена');
      } catch (e) {
        console.warn('[scanner2] share-link copy failed:', e);
        btn.textContent = '✕';
        setTimeout(() => { btn.textContent = '🔗'; }, 1500);
      }
    });
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
    document.getElementById('ts2-anomaly-modal')?.remove();
    const html = renderAnomalyMiniChart(series, z, metric);
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('ts2-anomaly-modal');
    if (!overlay) return;
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
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

  /**
   * V20 S2 — открыть диагностический modal. Single source of truth —
   * gatherDiagnosticState() + prepareDiagnosticExport() из
   * teamScanner2Diagnostic.js. UI только рендерит и привязывает 3 button:
   *   📋 Безопасный экспорт  → mode='safe' download
   *   ⚠️ Полный экспорт PII  → disclaimer-modal → confirm → mode='raw' download
   *   ✕ Закрыть              → remove modal
   */
  _openDiagModal() {
    const state = gatherDiagnosticState({
      model:           this._model,
      prevSnapshot:    this._prevSnapshot,
      jobId:           this._jobId,
      cacheAgeMs:      this._cacheAgeMs(),
      fetchLatencyMs:  this._lastFetchLatencyMs,
      // V20 S4 fix — передаём state.employees для правильного coverage.
      // Без этого bbLogin/cfId всегда показывались как 0% (поля не на participant).
      // Используем appState (alias) т.к. локальная const state ниже shadows импорт.
      employees:       appState.employees || [],
      // V20 S7 B13 — raw fetch counts (до identity-attribution).
      rawDiag:         this._lastRawDiag || null,
    });
    document.getElementById('ts2-diag-modal')?.remove();
    const auditEntries = readAuditLog();
    const html = renderDiagnosticModal(state, { auditEntries });
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
    // Safe export — instant download.
    overlay.querySelector('#ts2-diag-export-safe')?.addEventListener('click', () => {
      this._performExport(state, 'safe');
    });
    // Raw export — disclaimer first.
    overlay.querySelector('#ts2-diag-export-raw')?.addEventListener('click', () => {
      this._openDiagDisclaimer(state);
    });
    // V20 S3.1 — connection probe button.
    overlay.querySelector('#ts2-diag-probe-run')?.addEventListener('click', async () => {
      const btn = overlay.querySelector('#ts2-diag-probe-run');
      const out = overlay.querySelector('#ts2-diag-probe-results');
      if (!out || !btn) return;
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = '⏳ Прогон…';
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
    // V20 S4 — Identity Auto-Resolve.
    overlay.querySelector('#ts2-diag-resolve-btn')?.addEventListener('click', () => {
      this._runIdentityResolve(overlay);
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
      const currentCounts = state.snapshot?.current?.counts || {};
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
    btn.textContent = `⏳ Резолв ${candidates.length} сотрудников…`;
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
      const empByKey = new Map(candidates.map(e => [String(e.id || e.jiraKey || e.email), e]));
      const diff = resp.results.map(r => {
        const emp = empByKey.get(String(r.key));
        if (!emp) return null;
        const before = { bb: emp.bitbucketLogin || '', cf: emp.confluenceAccountId || '' };
        const after  = {
          bb: r.bb?.ok ? (r.bb.slug || '') : before.bb,
          cf: r.cf?.ok ? (r.cf.accountId || '') : before.cf,
        };
        const isChange = (before.bb !== after.bb) || (before.cf !== after.cf);
        const status = !r.email ? 'no-email'
                     : (!r.bb?.ok && !r.cf?.ok) ? 'failed'
                     : isChange ? 'change'
                     : 'unchanged';
        return {
          empKey:   emp.id || emp.jiraKey || emp.email,
          fio:      emp.fio || emp.email,
          email:    r.email,
          before, after,
          status,
          bbError:  r.bb?.ok ? null : (r.bb?.error || null),
          cfError:  r.cf?.ok ? null : (r.cf?.error || null),
        };
      }).filter(Boolean);
      // Show summary inline.
      out.innerHTML = `<div class="ts2-diag-ok">✓ Получены данные: ${resp.summary.bbResolved} BB, ${resp.summary.cfResolved} CF из ${resp.summary.total}. Открываю preview…</div>`;
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
    document.getElementById('ts2-resolve-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', renderIdentityResolvePreview(diff, summary));
    const overlay = document.getElementById('ts2-resolve-modal');
    if (!overlay) return;
    // V20 S6.1 — listener cleanup на любом пути закрытия.
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
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
      saveBtn.textContent = '⏳ Сохраняю…';
      const changes = diff.filter(d => d.status === 'change');
      if (!changes.length) { close(); return; }
      // CRITICAL: mass-mutation в Reactive.silent чтобы не триггерить
      // infinite loop (CLAUDE.md контракт #1).
      const empByKey = new Map((state.employees || []).map(e =>
        [String(e.id || e.jiraKey || e.email), e]));
      let updated = 0;
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
      });
      try { Storage.save?.(); } catch (e) { console.warn('[scanner2] save после resolve failed:', e); }
      telemetryEmit('scanner2.identity_resolve_save', { changesCount: changes.length, fieldsUpdated: updated });
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
      this._announce(`Identity заполнен: ${updated} полей у ${changes.length} сотрудников. Нажмите ↻ Обновить чтобы пересчитать с новой identity.`);
      try { window.showToast?.(`Identity обновлён: ${updated} полей у ${changes.length} сотрудников`, 'success', 5000); } catch (_) {}
    });
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
    // на row после rebuild'а dashboard.
    const focusKey = this._expandedKey;
    this._expandedKey = '';
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    this._renderFull();
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
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    // Закрываем panel чтобы не сохранять её состояние в скрытом subtab'е.
    this._expandedKey = '';
  },
};
