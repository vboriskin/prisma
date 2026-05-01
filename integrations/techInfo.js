'use strict';
/* ============================================================
   TECH INFO — ORCHESTRATOR
   --
   Owns the «🔧 Техническая информация» modal:
     · mounts overlay HTML to <body>
     · fetches /api/integrations/tech-info on open
     · holds local state (activeTab, query, loading, data)
     · wires search / tab-switch / copy / refresh / close

   Public surface:
     TechInfo.open()
     TechInfo.close()
   ============================================================ */

import { fetchTechInfo } from './techInfoApi.js';
import { renderTechInfoModal } from './techInfoRenderer.js';

const OVERLAY_ID = 'ti-modal-overlay';

export const TechInfo = {
  _state: null,    // { activeTab, query, loading, data, errorMsg }
  _abort: null,
  _onKey: null,    // bound keyboard handler for Escape
  _toastTimer: null,

  /** Open the modal — idempotent. Re-opens fresh state each time. */
  async open() {
    this.close();   // ensure no duplicates
    this._state = {
      activeTab: 'jira',
      query: '',
      loading: true,
      data: null,
      errorMsg: '',
    };
    this._mount();
    this._wireGlobalKeys();
    await this._fetch({ forceRefresh: false });
  },

  close() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    if (this._onKey) {
      document.removeEventListener('keydown', this._onKey);
      this._onKey = null;
    }
    if (this._abort) {
      try { this._abort.abort(); } catch {}
      this._abort = null;
    }
  },

  _mount() {
    const html = String(renderTechInfoModal(this._state));
    document.body.insertAdjacentHTML('beforeend', html);
    this._wireOverlay();
    this._applySearchFilter();
  },

  _remount() {
    // Re-render in place: replace innerHTML of #ti-modal-overlay's child (.ti-modal).
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.outerHTML = String(renderTechInfoModal(this._state));
    this._wireOverlay();
    this._applySearchFilter();
  },

  async _fetch({ forceRefresh = false } = {}) {
    this._state.loading = true;
    this._state.errorMsg = '';
    this._remount();

    if (this._abort) try { this._abort.abort(); } catch {}
    this._abort = new AbortController();
    try {
      const data = await fetchTechInfo({
        signal: this._abort.signal,
        timeoutMs: 60000,
        source: 'all',
        forceRefresh,
      });
      this._state.data = data;
      this._state.loading = false;
      this._remount();
    } catch (e) {
      if (e?.name === 'AbortError') return;
      this._state.loading = false;
      this._state.errorMsg = e?.message || 'Ошибка загрузки';
      this._remount();
    }
  },

  /* ── Wiring ──────────────────────────────────── */

  _wireGlobalKeys() {
    this._onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    document.addEventListener('keydown', this._onKey);
  },

  _wireOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    // V17.2 I4 — единый делегированный click-handler на overlay вместо
    //   двух отдельных (close-on-overlay + close-on-btn-x ниже + copy-btn
    //   ниже). Раньше каждый _remount накапливал ДВА click-listener'а на
    //   одном и том же DOM-узле; в долгом сеансе модалка дёргалась N раз
    //   на каждый клик. Теперь — ровно один.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { this.close(); return; }
      if (e.target.closest('#ti-close')) { this.close(); return; }
      const copyBtn = e.target.closest('[data-ti-copy]');
      if (copyBtn) {
        const value = copyBtn.getAttribute('data-ti-copy') || '';
        this._copy(value);
        return;
      }
    });

    // Refresh button — force re-fetch (resets server cache too).
    overlay.querySelector('#ti-refresh')?.addEventListener('click', () => {
      this._fetch({ forceRefresh: true });
    });

    // Export JSON — downloads the full payload currently displayed in the
    // modal. Useful when the user wants to share the diagnostic snapshot
    // (versions / fields / projects / boards / repos / spaces) — the whole
    // thing is a single self-contained JSON. Server data + a couple of
    // client-side metadata fields (which tab is active, when it was fetched).
    overlay.querySelector('#ti-export-json')?.addEventListener('click', () => {
      this._exportJson();
    });

    // Tab switcher — re-render with new activeTab. NO refetch (data is the same).
    overlay.querySelectorAll('[data-ti-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-ti-tab');
        if (next && next !== this._state.activeTab) {
          this._state.activeTab = next;
          this._remount();
        }
      });
    });

    // Search — debounced via input event. Filters client-side via [data-ti-search].
    const search = overlay.querySelector('#ti-search');
    if (search) {
      search.addEventListener('input', () => {
        this._state.query = search.value || '';
        this._applySearchFilter();
      });
      // Refocus on each remount so user keeps typing without click.
      try { search.focus({ preventScroll: true }); } catch { search.focus(); }
      // Move caret to end.
      const v = search.value; search.setSelectionRange?.(v.length, v.length);
    }

    // V17.2 I4 — copy-button delegation moved into the unified click-handler
    //   above to prevent listener stacking on remount.
  },

  _applySearchFilter() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const q = String(this._state.query || '').toLowerCase().trim();
    overlay.querySelectorAll('[data-ti-search]').forEach(el => {
      if (!q) { el.style.display = ''; return; }
      const tokens = el.getAttribute('data-ti-search') || '';
      el.style.display = tokens.includes(q) ? '' : 'none';
    });
  },

  _exportJson() {
    const data = this._state?.data;
    if (!data) {
      try { window.showToast?.('Нет данных для выгрузки', 'info'); } catch {}
      return;
    }
    const fetchedIso = data.fetchedAt || new Date().toISOString();
    const datePart   = fetchedIso.slice(0, 10);                     // YYYY-MM-DD
    const payload = {
      _meta: {
        exportedAt: new Date().toISOString(),
        fetchedAt:  fetchedIso,
        source:     'q2-tech-info-modal',
        version:    1,
      },
      jira:       data.jira       || null,
      bitbucket:  data.bitbucket  || null,
      confluence: data.confluence || null,
      errors:     data.errors     || {},
      stale:      data.stale      || {},
      cache:      data.cache      || {},
    };
    try {
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `q2_tech_info_${datePart}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke — Safari sometimes drops the download if URL revokes too fast.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      try { window.showToast?.(`Сохранено: ${a.download}`); } catch {}
    } catch (e) {
      try { window.showToast?.('Не удалось выгрузить JSON: ' + (e?.message || 'unknown'), 'error', 4000); } catch {}
    }
  },

  _copy(value) {
    if (!value) return;
    const done = () => {
      try { window.showToast?.(`Скопировано: ${value}`); } catch {}
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => this._copyFallback(value, done));
    } else {
      this._copyFallback(value, done);
    }
  },

  _copyFallback(value, done) {
    // Fallback for older browsers / non-secure contexts.
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done?.();
    } catch { /* swallow — best-effort */ }
  },
};

if (typeof window !== 'undefined') window.TechInfo = TechInfo;
