'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ORCHESTRATOR  (V18.1 P1, preview)

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

import { state } from '../state.js';
import { loadSettingsRaw } from './integrationsStore.js';
import { fetchPulseData, fetchEmployeeDetail } from './portfolioPulseApi.js';
import { analysePulse } from './portfolioPulseModel.js';
import { enrichForScanner2 } from './teamScanner2Enrichment.js';
import { parseProjectKeys } from './portfolioPulseUtils.js';
import {
  renderTopBar, renderTeamGlance, renderPersonRows, renderEmployeeDetailPanel,
  renderMultiTeamView,
  renderSkeleton, renderEmpty, renderError, setRenderContext,
} from './teamScanner2Renderer.js';

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
    } catch (_) { /* quota exceeded — ничего не делаем */ }
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
    if (!projectKeys.length) { container.innerHTML = renderEmpty(); return; }
    if (this._cancelled) { this._paintCancelled(); return; }
    if (this._errorMsg)  { this._paintError(this._errorMsg); return; }
    // V18.3 A4 — share-link: при первом mount считываем URL hash и
    // авто-открываем panel если matches participant key.
    this._consumeShareLink();
    // Cache hit: re-paint без сети.
    if (this._model) { this._renderFull(); return; }
    await this._fetchAndRender();
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
  async fetchDetail(employeeKey, opts = {}) {
    if (!employeeKey) throw new Error('employeeKey required');
    const cacheKey = `${employeeKey}|${opts.dwellHours || 24}`;
    if (!opts.bypassCache && this._detailCache.has(cacheKey)) {
      return this._detailCache.get(cacheKey);
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
    this._detailCache.set(cacheKey, detail);
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
      // V18.1 P3 — после стандартного анализа применяем v2.0-специфический
      // enrichment: heatmap[3][24], contextSwitches, timeline72h, blockers
      // (с server-local-TZ часами и единым 24h dwell-threshold). v1 НЕ
      // запускает enrichment — нулевой impact для PortfolioPulse.
      const baseModel = analysePulse(raw, { staleDays, employees: state.employees || [] });
      // V18.1 P7-S2.3 — browser TZ offset для consistent heatmap.
      this._tzOffsetMin = new Date().getTimezoneOffset();
      this._model = enrichForScanner2(baseModel, raw, {
        dwellHours: 24,
        tzOffsetMin: this._tzOffsetMin,
      });
      // V18.1 P7-S4.2 — read prev snapshot ДО save'а нового, чтобы дельта
      // считалась относительно вчерашнего, а не этого же fetch'а.
      this._prevSnapshot = this._readPrevSnapshot();
      this._saveSnapshot(this._model);
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
    // V18.1 P7-S4.1 — multi-team view (Dmitry blocker). В режиме multi
    // — render table сводок по командам вместо per-person rows.
    // V18.3 A5b — pk-filter применяется к team-view (single).
    const filteredModel = (this._activePkFilter && this._activeView === 'team')
      ? this._applyPkFilter(m, this._activePkFilter)
      : m;
    const bodyHtml = this._activeView === 'multi'
      ? renderMultiTeamView(m)
      : `
        ${renderTeamGlance(filteredModel, { prev, pkFilter: this._activePkFilter })}
        ${renderPersonRows(filteredModel, { expandedKey: this._expandedKey })}`;
    const html = `
      <div class="ts2-root">
        ${renderTopBar(m, { prev, activeView: this._activeView })}
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
    // V18.1 P7-S4.1 — view toggle (team ↔ multi).
    root.querySelector('#ts2-view-toggle')?.addEventListener('click', () => {
      this._activeView = this._activeView === 'multi' ? 'team' : 'multi';
      this._closePanel();   // closes any open detail panel + does _renderFull
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
        this._expandedKey = (this._expandedKey === key) ? '' : key;
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
