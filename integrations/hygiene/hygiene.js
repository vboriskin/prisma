'use strict';
/* ============================================================
   integrations/hygiene/hygiene.js — V22+ (2026-05-17)

   Orchestrator подвкладки «Гигиена» внутри Интеграций.

   Public API:
     HygieneView.render(container)   — mount entry-point
     HygieneView.refresh()           — re-paint + ensure data
     HygieneView.unmount()           — cleanup

   Lifecycle:
     1. render(container) → sync paint:
        · isLoading? → loader
        · model null? → empty-CTA «Загрузить»
        · иначе → renderHygieneSubTab
     2. click delegation на container (paint обновляет inner HTML)
     3. polling-once на focus / на «load-data» — дёргаем Scanner.refresh
   ============================================================ */

import { renderHygieneSubTab, renderHygieneEmpty, escapeHtml } from './hygieneRenderer.js';
import { hygieneState } from './hygieneState.js';
import { listHygieneRules } from '../jiraHygiene.js';
import { Services } from '../../app/services.js';
import { TeamScanner2 } from '../teamScanner2.js';
import { loadSettings as _loadIntegrationsSettings } from '../integrationsStore.js';

/* ─────────────────────────────────────────────────────────────
   Data source helpers
   ───────────────────────────────────────────────────────────── */

function _getModel() {
  try {
    if (TeamScanner2 && typeof TeamScanner2.getModel === 'function') {
      return TeamScanner2.getModel();
    }
    return TeamScanner2?._model || null;
  } catch (_) { return null; }
}

function _isLoading() {
  try {
    if (typeof TeamScanner2?.isLoading === 'function') return !!TeamScanner2.isLoading();
    return !!TeamScanner2?._isLoading;
  } catch (_) { return false; }
}

function _getJiraBaseUrl() {
  try {
    const cfg = _loadIntegrationsSettings() || {};
    return cfg.jiraBaseUrl || '';
  } catch (_) { return ''; }
}

function _hasJiraConfig() {
  try {
    const cfg = _loadIntegrationsSettings() || {};
    return !!(cfg.hasJiraToken && cfg.jiraBaseUrl);
  } catch (_) { return false; }
}

/* ─────────────────────────────────────────────────────────────
   Main view
   ───────────────────────────────────────────────────────────── */

export const HygieneView = {
  _container: null,
  _bound: false,
  _boundContainer: null,
  _scannerPoller: null,
  _lastFetchedAt: 0,

  render(container) {
    if (!container) return;
    this._container = container;
    this._paint();
    this._bindOnce(container);
    this._startScannerPoller();
  },

  refresh() {
    if (!this._container) return;
    this._paint();
  },

  unmount() {
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._stopScannerPoller();
    this._container = null;
    // bound listeners живут на container'е — он вот-вот будет удалён
    // (integrationsView делает root.innerHTML='…'), reset _bound для re-bind при next mount.
    this._bound = false;
    this._boundContainer = null;
  },

  /* ── render pipeline ──────────────────────────────────────── */

  _paint() {
    if (!this._container) return;

    // 1. Если нет Jira-конфига — show empty-config CTA.
    if (!_hasJiraConfig()) {
      this._container.innerHTML = renderHygieneEmpty('no-config');
      return;
    }
    // 2. Если Scanner грузит — loader.
    if (_isLoading()) {
      this._container.innerHTML = renderHygieneEmpty('loading');
      return;
    }
    // 3. Если model нет — empty-CTA с кнопкой «Загрузить».
    const model = _getModel();
    if (!model) {
      this._container.innerHTML = renderHygieneEmpty('no-data');
      return;
    }
    // 4. Норма — рендерим гигиену.
    this._container.innerHTML = renderHygieneSubTab(model, hygieneState, {
      jiraBaseUrl: _getJiraBaseUrl(),
      allRules: listHygieneRules(),
    });
    this._lastFetchedAt = Number(model._fetchedAtMs || model.fetchedAt || 0);
  },

  /* ── event delegation ─────────────────────────────────────── */

  _bindOnce(container) {
    if (!container) return;
    if (this._bound && this._boundContainer === container) return;
    this._bound = true;
    this._boundContainer = container;

    container.addEventListener('click', (e) => this._onClick(e));
  },

  _onClick(e) {
    const target = e.target;

    // Team-switcher
    const teamBtn = target.closest('[data-hyg-team]');
    if (teamBtn) {
      const team = teamBtn.dataset.hygTeam || '__all__';
      hygieneState.setActiveTeam(team);
      this._paint();
      return;
    }

    // Toggle rule (hide / restore)
    const toggleBtn = target.closest('[data-hyg-action="toggle-rule"]');
    if (toggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = toggleBtn.dataset.hygRuleId || '';
      if (id) {
        hygieneState.toggleRule(id);
        this._paint();
      }
      return;
    }

    // Load data — trigger Scanner refresh
    const loadBtn = target.closest('[data-hyg-action="load-data"]');
    if (loadBtn) {
      this._triggerScannerLoad();
      return;
    }
  },

  async _triggerScannerLoad() {
    try {
      // Показываем loader сразу
      this._container.innerHTML = renderHygieneEmpty('loading');
      // Scanner.refresh — single-flight через свой _reqId guard
      if (typeof TeamScanner2?.refresh === 'function') {
        await TeamScanner2.refresh();
      } else if (typeof TeamScanner2?.render === 'function') {
        // fallback: спрятанный контейнер не нужен — Scanner сам ведает своим UI
        await TeamScanner2.render(TeamScanner2._container || null);
      }
      // После завершения — repaint
      this._paint();
    } catch (err) {
      this._container.innerHTML = `<div class="hyg-state hyg-state-empty">
        <div class="hyg-state-title">Не удалось загрузить</div>
        <div class="hyg-state-text">${escapeHtml(err?.message || err)}</div>
        <button class="hyg-btn hyg-btn-primary" type="button" data-hyg-action="load-data">Повторить</button>
      </div>`;
    }
  },

  /* ── Scanner polling (детектим completion fetch'а) ────────── */

  _startScannerPoller() {
    this._stopScannerPoller();
    // Проверяем _fetchedAtMs каждые 1500ms. Если изменился — repaint.
    this._scannerPoller = setInterval(() => {
      if (!this._container) return this._stopScannerPoller();
      const m = _getModel();
      const ts = Number(m?._fetchedAtMs || m?.fetchedAt || 0);
      if (ts > 0 && ts !== this._lastFetchedAt) {
        this._lastFetchedAt = ts;
        this._paint();
      }
    }, 1500);
  },

  _stopScannerPoller() {
    if (this._scannerPoller) {
      clearInterval(this._scannerPoller);
      this._scannerPoller = null;
    }
  },
};

try { Services.register('HygieneView', HygieneView); } catch (_) { /* hot reload */ }
if (typeof window !== 'undefined') window.HygieneView = HygieneView;
