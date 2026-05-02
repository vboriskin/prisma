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
  // P5 source filters — toggle pill'ы J/B/C/Z в panel'е. Persist'ятся
  // между переоткрытиями panel'и в одной сессии.
  _panelFilters: { j: true, b: true, c: true, z: true },
  // V18.1 P4 — captured jobId (из callback fetchPulseData → onJobId)
  // используется для lazy server-side drill-down. Истекает через
  // 30 мин по TTL `_pulseJobs` cluster'а на сервере.
  _jobId: '',
  // Per-employee server-fetched detail cache. Ключ — employeeKey.
  // P4 опциональный: сейчас НЕ заменяет local enrichment, добавлен для
  // P5+ side-panel (где может потребоваться refresh с другим dwellHours).
  _detailCache: new Map(),

  isLoading() { return this._loading; },

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
    // Cache hit: re-paint без сети.
    if (this._model) { this._renderFull(); return; }
    await this._fetchAndRender();
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
      // V18.1 P7-S2.3 — browser TZ offset для consistent heatmap. Сохраняем
      // в orchestrator state чтобы потом передать в /employee-detail (server
      // должен пересчитать heatmap в browser-TZ, иначе drill-down съедет).
      this._tzOffsetMin = new Date().getTimezoneOffset();
      this._model = enrichForScanner2(baseModel, raw, {
        dwellHours: 24,
        tzOffsetMin: this._tzOffsetMin,
      });
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
    const html = `
      <div class="ts2-root">
        ${renderTopBar(m)}
        ${renderTeamGlance(m)}
        ${renderPersonRows(m, { expandedKey: this._expandedKey })}
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
