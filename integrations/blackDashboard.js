'use strict';
/* ============================================================
   BLACK DASHBOARD — ORCHESTRATOR
   Wires the modular pieces together and manages the three sub-tabs:
   Goals · Coverage · Metrics.  (V22 Brand pass — без эмодзи в UI.)

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
import { BD_PHRASES, startPhraseRotator } from './loaderPhrases.js';
import {
  renderTopHeader, renderGoalsTab, renderCoverageTab, renderMetricsTab,
  renderNotConfigured, renderNotLoaded, renderLoader, renderError,
  renderBdDiagModal, prepareBdDiagSafeJson,
} from './blackDashboardRenderer.js';
import { Services } from '../app/services.js';

/* Phase 3 D2 — человекочитаемые HTTP-ошибки в error-state Чёрного дашборда.
   Раньше пользователь видел raw `HTTP 500` / `HTTP 401` в `bd-state-error`.
   Подход совпадает с views/integrationsView.js _humanHttp (тот же словарь),
   но локальный helper, чтобы blackDashboard.js не зависел от views/. */
function _bdHumanHttp(src) {
  if (!src) return 'связь прервана';
  let text = '';
  let status = 0;
  if (typeof src === 'string')               text = src;
  else if (src instanceof Error)             text = src.message || '';
  else if (typeof src === 'object') {
    text = src.error || src.message || '';
    if (typeof src.status === 'number')      status = src.status;
  }
  if (!status) {
    const m = /HTTP\s*(\d{3})/i.exec(text);
    if (m) status = parseInt(m[1], 10);
  }
  switch (status) {
    case 401: return 'Sigma не пускает (нужен новый токен)';
    case 403: return 'Sigma закрыла доступ';
    case 404: return 'Sigma не нашла адрес — проверьте URL в настройках';
    case 408: return 'Sigma не ответила вовремя — попробуйте ещё раз';
    case 429: return 'Sigma просит притормозить';
    case 500: case 502: case 503: case 504: return 'Sigma не отвечает — повторите позже';
  }
  if (!text || /^сеть$/i.test(text)) return 'связь прервана';
  return text;
}

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
    // V21 J #62 — abort предыдущего fetch (защита от double-click race).
    try { this._abort?.abort(); } catch (_) { /* defensive */ }
    if (this._container && this._isSigmaConfigured()) await this._fetchAndRender();
  },

  _showLoader() {
    if (!this._container) return;
    this._container.innerHTML = renderLoader();
    this._stopPhraseRotator();
    this._phraseTimer = startPhraseRotator('bd-loader-phrase', BD_PHRASES);
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
    if (this._phraseTimer) { clearInterval(this._phraseTimer); this._phraseTimer = null; }
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
        // Phase 3 D2 — _bdHumanHttp оборачивает «HTTP 401/500/etc» в человеческую
        // фразу. ErrorsLog.add выше получает raw msg для технического диагноза;
        // в UI рендерим человеческую копию.
        this._container.innerHTML = renderError(_bdHumanHttp(e));
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
    root.querySelector('#bd-diag-btn')?.addEventListener('click', () => this._openDiagModal());
    // V22 C1 — SSO-banner CTA в BD-header. Открывает settings-modal на табе
    // Confluence через global `window.openIntegrationsSettings(tab)`. graceful no-op
    // если функция не зарегистрирована (например, BD загружен standalone).
    root.querySelectorAll('[data-bd-open-settings]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-bd-open-settings') || 'confluence';
        try { window.openIntegrationsSettings?.(tab); }
        catch (e) { console.warn('[bd] openIntegrationsSettings failed', e); }
      });
    });
    // V22 fix #16 (2026-05-09 UX) — HTML export dropdown.
    const exportBtn  = root.querySelector('#bd-export-btn');
    const exportMenu = root.querySelector('#bd-export-menu');
    if (exportBtn && exportMenu) {
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = exportMenu.hasAttribute('hidden');
        exportMenu.toggleAttribute('hidden');
        if (wasHidden) {
          // Закрываем по клику вне меню.
          const closeOnOutside = (ev) => {
            if (!exportMenu.contains(ev.target) && ev.target !== exportBtn) {
              exportMenu.setAttribute('hidden', '');
              document.removeEventListener('click', closeOnOutside);
            }
          };
          setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
        }
      });
      exportMenu.querySelectorAll('[data-bd-export]').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          const kind = item.dataset.bdExport;
          exportMenu.setAttribute('hidden', '');
          if (!this._model) return;
          try {
            const mod = await import('./blackDashboardExport.js');
            mod.downloadBlackDashboardExport(this._model, kind);
          } catch (err) {
            try { console.error('[BD export]', err); } catch (_) {}
          }
        });
      });
    }
  },

  _openDiagModal() {
    if (!this._model) return;
    // Remove any stale modal first.
    document.getElementById('bd-diag-modal-overlay')?.remove();
    const div = document.createElement('div');
    div.innerHTML = renderBdDiagModal(this._model);
    const overlay = div.firstElementChild;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#bd-diag-modal-close')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    }, { once: false });

    overlay.querySelector('#bd-diag-export-btn')?.addEventListener('click', () => {
      try {
        const json = prepareBdDiagSafeJson(this._model);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const ts   = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
        a.href     = url;
        a.download = `bd-diagnostic-safe-${ts}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('[BD diag export]', e);
      }
    });
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

Services.register('BlackDashboard', BlackDashboard);
if (typeof window !== 'undefined') window.BlackDashboard = BlackDashboard;
