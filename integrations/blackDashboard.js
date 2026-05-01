'use strict';
/* ============================================================
   BLACK DASHBOARD — ORCHESTRATOR
   Wires the modular pieces together and manages the three sub-tabs:
   🎯 Цели · 🔗 Покрытие · 📈 Метрики.

   Public surface:
     BlackDashboard.render(container)
     BlackDashboard.refresh()
     BlackDashboard.invalidate()  — drops cache, used after settings save
     BlackDashboard.isLoading()
   ============================================================ */

import { loadSettingsRaw } from './integrationsStore.js';
import { fetchBlackDashboard } from './blackDashboardApi.js';
import { analyseBlackDashboard } from './blackDashboardModel.js';
import { ErrorsLog } from '../errorsLog.js';
import { makePhraseFeeder } from './loaderPhrases.js';
import {
  renderTopHeader, renderGoalsTab, renderCoverageTab, renderMetricsTab,
  renderNotConfigured, renderNotLoaded, renderLoader, renderError,
} from './blackDashboardRenderer.js';

export const BlackDashboard = {
  _model: null,
  _activeTab: 'goals',     // 'goals' | 'coverage' | 'metrics'
  _container: null,
  _abort: null,
  _reqId: 0,
  _loading: false,
  _loadingMsg: '',

  isLoading() { return this._loading; },

  /** Drop cache — called from settings save so next view triggers a fresh fetch. */
  invalidate() { this._model = null; },

  _isSigmaConfigured() {
    try {
      const cfg = loadSettingsRaw();
      return !!(cfg.sigmaJiraBaseUrl && cfg.sigmaJiraToken);
    } catch (_) { return false; }
  },

  /** Public entrypoint — called when the user opens the «Чёрный дашборд» sub-tab. */
  render(container) {
    this._container = container;
    if (!this._isSigmaConfigured()) {
      container.innerHTML = renderNotConfigured();
      this._wireStateButtons();
      return;
    }
    if (this._loading) {
      this._showLoader();
      return;
    }
    if (this._model) {
      this._renderFull();
      return;
    }
    container.innerHTML = renderNotLoaded();
    this._wireStateButtons();
  },

  async refresh() {
    if (this._container && this._isSigmaConfigured()) await this._fetchAndRender();
  },

  _showLoader() {
    if (!this._container) return;
    this._container.innerHTML = renderLoader();

    // V13 (11th pass): rotate humorous phrases every ~2.6s to signal aliveness
    // during the long-running fetch. Stops on terminal state (success/error/
    // cancel) to avoid leaking the interval. Idempotent — re-entry clears any
    // existing timer first (e.g., user navigated away and back during fetch).
    this._stopPhraseRotator();
    const feed = makePhraseFeeder();
    const tick = () => {
      const el = this._container?.querySelector('#bd-loader-phrase');
      if (!el) return;
      // Re-trigger CSS fade-in animation on every phrase swap.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      el.textContent = feed();
    };
    tick();                                     // paint first phrase immediately
    this._phraseTimer = setInterval(tick, 2600);

    // Cancel button — abort the in-flight fetch and repaint the not-loaded
    // state so the user can retry. Mirrors PP's cancel UX.
    this._container.querySelector('#bd-loader-cancel')?.addEventListener('click', () => {
      try { this._abort?.abort(); } catch (_) {}
      this._loading = false;
      this._stopPhraseRotator();
      if (this._container) {
        this._container.innerHTML = renderNotLoaded();
        this._wireStateButtons();
      }
    });
  },

  _stopPhraseRotator() {
    if (this._phraseTimer) {
      clearInterval(this._phraseTimer);
      this._phraseTimer = null;
    }
  },

  async _fetchAndRender() {
    if (!this._container) return;
    const reqId = (this._reqId = (this._reqId || 0) + 1);
    this._loading = true;
    this._loadingMsg = 'Запрашиваю Sigma + Delta…';
    this._showLoader();

    try {
      if (this._abort) this._abort.abort();
      this._abort = new AbortController();
      // Async-job pattern: server returns jobId immediately, we poll
      // /status every 2s. onProgress updates the loader's status line
      // (functional info) WITHOUT re-painting the whole loader — that
      // would reset the rotating phrase mid-cycle. The fun phrase has
      // its own setInterval (`_phraseTimer`) that runs independently.
      const raw = await fetchBlackDashboard({
        signal: this._abort.signal,
        onProgress: ({ elapsedMs }) => {
          if (reqId !== this._reqId) return;
          const sec = Math.round((elapsedMs || 0) / 1000);
          const status = this._container?.querySelector('#bd-loader-status');
          if (status) {
            status.textContent = sec > 3
              ? `Идёт запрос к Sigma + Delta · ${sec} с`
              : 'Идёт запрос к Sigma + Delta…';
          }
        },
      });
      if (reqId !== this._reqId) return;
      this._model = analyseBlackDashboard(raw);
      // Surface server-side errors[] from the response into the global log,
      // so the «Ошибки» tab catches expand failures, sigma not-configured,
      // 429-storms etc. — not just front-end exceptions.
      try {
        for (const errEntry of (raw?.errors || [])) {
          ErrorsLog.add({
            level:   'warn',
            source:  `BlackDashboard:${errEntry.scope || 'server'}`,
            message: errEntry.message || 'Unknown server-reported error',
            details: { scope: errEntry.scope, expand: raw?.diagnostics?.expand },
          });
        }
      } catch (_) {}
      this._renderFull();
    } catch (e) {
      if (reqId !== this._reqId) return;
      if (e?.name === 'AbortError') return;
      const msg = e?.message || 'Ошибка запроса';
      console.warn('[BlackDashboard] fetch failed:', e);
      try {
        ErrorsLog.add({
          level:   'error',
          source:  'BlackDashboard',
          message: msg,
          stack:   e?.stack,
        });
      } catch (_) {}
      if (this._container) {
        this._container.innerHTML = renderError(msg);
        this._wireStateButtons();
      }
    } finally {
      this._loading = false;
      this._loadingMsg = '';
      this._stopPhraseRotator();
    }
  },

  _renderFull() {
    if (!this._container || !this._model) return;
    const fetchedAtLabel = (() => {
      try { return new Date(this._model.fetchedAt).toLocaleString('ru'); } catch (_) { return '—'; }
    })();
    const html = `
      ${renderTopHeader(this._model, this._activeTab, fetchedAtLabel)}
      <div class="bd-tab-body">${this._renderActiveTab()}</div>
    `;
    this._container.innerHTML = html;
    this._wire();
  },

  _renderActiveTab() {
    switch (this._activeTab) {
      case 'goals':    return renderGoalsTab(this._model);
      case 'coverage': return renderCoverageTab(this._model);
      case 'metrics':  return renderMetricsTab(this._model);
      default:         return renderGoalsTab(this._model);
    }
  },

  _wire() {
    const root = this._container;
    if (!root) return;
    root.querySelectorAll('.bd-tab[data-bd-tab]').forEach(b => {
      b.addEventListener('click', () => {
        this._activeTab = b.dataset.bdTab;
        this._renderFull();
      });
    });
    root.querySelector('#bd-refresh-btn')?.addEventListener('click', () => this.refresh());
  },

  _wireStateButtons() {
    const root = this._container;
    if (!root) return;
    root.querySelector('#bd-load-btn')?.addEventListener('click', () => this.refresh());
    root.querySelector('#bd-retry-btn')?.addEventListener('click', () => this.refresh());
    root.querySelector('#bd-open-settings')?.addEventListener('click', () => {
      // Defer to the existing settings entrypoint (modal). Stored under window for reach.
      try {
        if (typeof window.openIntegrationsSettings === 'function') {
          window.openIntegrationsSettings('jira');
        } else {
          // Fallback — emit a custom event the IntegrationsView already listens to.
          window.dispatchEvent(new CustomEvent('q2:open-integrations-settings', { detail: { tab: 'jira' } }));
        }
      } catch (_) {}
    });
  },
};

if (typeof window !== 'undefined') window.BlackDashboard = BlackDashboard;
