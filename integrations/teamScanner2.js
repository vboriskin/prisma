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
import { fetchPulseData } from './portfolioPulseApi.js';
import { analysePulse } from './portfolioPulseModel.js';
import { enrichForScanner2 } from './teamScanner2Enrichment.js';
import { parseProjectKeys } from './portfolioPulseUtils.js';
import {
  renderTopBar, renderTeamGlance, renderPersonRows, renderDetailStub,
  renderSkeleton, renderEmpty, renderError,
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
  // P1 detail-panel: которая строка раскрыта (key участника) — заглушка
  // под будущий 72h side-panel из P5.
  _expandedKey: '',

  isLoading() { return this._loading; },

  _readConfig() {
    let cfg = {};
    try { cfg = loadSettingsRaw(); } catch (_) {}
    return {
      projectKeys: parseProjectKeys(cfg.projectKeys || ''),
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
    if (this._container) await this._fetchAndRender();
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
      });
      if (reqId !== this._reqId) return;
      // V18.1 P3 — после стандартного анализа применяем v2.0-специфический
      // enrichment: heatmap[3][24], contextSwitches, timeline72h, blockers
      // (с server-local-TZ часами и единым 24h dwell-threshold). v1 НЕ
      // запускает enrichment — нулевой impact для PortfolioPulse.
      const baseModel = analysePulse(raw, { staleDays, employees: state.employees || [] });
      this._model = enrichForScanner2(baseModel, raw, { dwellHours: 24 });
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
    const html = `
      <div class="ts2-root">
        ${renderTopBar(m)}
        ${renderTeamGlance(m)}
        ${renderPersonRows(m, { expandedKey: this._expandedKey })}
        ${this._expandedKey ? renderDetailStub(m, this._expandedKey) : ''}
      </div>
    `;
    this._container.innerHTML = html;
    this._bindEvents();
  },

  _bindEvents() {
    const root = this._container;
    if (!root) return;
    root.querySelector('#ts2-refresh-btn')?.addEventListener('click', () => this.refresh());
    // Click по строке → toggle expanded.
    root.querySelectorAll('.ts2-row[data-key]').forEach(el => {
      el.addEventListener('click', (e) => {
        // Игнорируем клики по ссылкам внутри строки.
        if (e.target.closest('a, button')) return;
        const key = el.dataset.key;
        this._expandedKey = (this._expandedKey === key) ? '' : key;
        this._renderFull();
      });
    });
    root.querySelector('#ts2-detail-close')?.addEventListener('click', () => {
      this._expandedKey = '';
      this._renderFull();
    });
  },
};
