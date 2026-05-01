'use strict';
/* ============================================================
   ERRORS VIEW — V13 (added 2026-04)

   Renders the «Ошибки» sidebar section: a chronological list of
   every error/warning captured by ErrorsLog. Filterable by level
   and free-text search. Each row is a <details> that expands to
   show stack + raw details JSON.

   Header actions: clear all, export to JSON file.
   ============================================================ */

import { ErrorsLog } from '../errorsLog.js';

const LEVELS = ['all', 'error', 'warn', 'info'];

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _fmtTs(ts) {
  try {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return d.toLocaleTimeString('ru');
    return d.toLocaleString('ru');
  } catch (_) {
    return String(ts);
  }
}

function _levelLabel(lvl) {
  if (lvl === 'error') return 'ERROR';
  if (lvl === 'warn')  return 'WARN';
  return 'INFO';
}

function _renderRow(e) {
  const hasExtras = !!(e.stack || e.details);
  const extrasHtml = hasExtras
    ? `<div class="errlog-extras">${e.details ? `<div class="errlog-section"><div class="errlog-section-title">Детали</div><pre class="errlog-pre">${_esc(e.details)}</pre></div>` : ''}${e.stack ? `<div class="errlog-section"><div class="errlog-section-title">Stack</div><pre class="errlog-pre">${_esc(e.stack)}</pre></div>` : ''}</div>`
    : '';

  return `<details class="errlog-row errlog-row-${_esc(e.level)}">
    <summary class="errlog-summary">
      <span class="errlog-time">${_esc(_fmtTs(e.ts))}</span>
      <span class="errlog-badge errlog-badge-${_esc(e.level)}">${_esc(_levelLabel(e.level))}</span>
      <span class="errlog-source">${_esc(e.source || '—')}</span>
      <span class="errlog-msg">${_esc(e.message || '')}</span>
      ${hasExtras ? '<span class="errlog-chev">▸</span>' : ''}
    </summary>
    ${extrasHtml}
  </details>`;
}

export const ErrorsView = {
  _root: null,
  _filter: { level: 'all', search: '' },
  _unsub: null,

  render() {
    const root = document.getElementById('section-errors');
    if (!root) return;
    this._root = root;

    // Subscribe to live updates from ErrorsLog so the list refreshes
    // automatically as new errors come in. Detach previous handler if
    // re-rendering, no double-subscription.
    if (this._unsub) { this._unsub(); this._unsub = null; }
    this._unsub = ErrorsLog.onChange(() => {
      // Light update — only re-render if THIS section is currently visible.
      if (!root.classList.contains('hidden')) this._renderList();
    });

    const counts = ErrorsLog.counts();
    root.innerHTML = `
      <div class="errlog-root view-root">
        <div class="errlog-header">
          <div class="errlog-header-row">
            <h2 class="errlog-title">Ошибки</h2>
            <span class="errlog-counts">
              <span class="errlog-count-pill errlog-count-error">${counts.error || 0} ошибок</span>
              <span class="errlog-count-pill errlog-count-warn">${counts.warn || 0} предупреждений</span>
              <span class="errlog-count-pill errlog-count-info">${counts.info || 0} info</span>
            </span>
            <div class="errlog-header-actions">
              <button class="btn btn-sm btn-ghost" id="errlog-export">⤓ Экспорт JSON</button>
              <button class="btn btn-sm btn-danger" id="errlog-clear">🗑 Очистить</button>
            </div>
          </div>
          <div class="errlog-filters">
            <div class="errlog-tabs">
              ${LEVELS.map(l => `<button class="errlog-tab ${this._filter.level === l ? 'errlog-tab-active' : ''}" data-errlog-level="${l}">${l === 'all' ? 'Все' : _esc(l.toUpperCase())}</button>`).join('')}
            </div>
            <input type="text" class="errlog-search" id="errlog-search" placeholder="Поиск по тексту…" value="${_esc(this._filter.search)}">
          </div>
        </div>
        <div class="errlog-list" id="errlog-list"></div>
      </div>
    `;

    this._renderList();
    this._wire();
  },

  _renderList() {
    const list = document.getElementById('errlog-list');
    if (!list) return;
    const all = ErrorsLog.getAll();
    const f = this._filter;
    const filtered = all.filter(e => {
      if (f.level !== 'all' && e.level !== f.level) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        const hay = `${e.source} ${e.message} ${e.details || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!filtered.length) {
      list.innerHTML = `<div class="errlog-empty">${all.length ? 'Нет записей под фильтр.' : 'Записей пока нет — это хорошо ✨'}</div>`;
      return;
    }
    list.innerHTML = filtered.map(_renderRow).join('');
  },

  _wire() {
    if (!this._root) return;

    // Tabs (level filter)
    this._root.querySelectorAll('[data-errlog-level]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._filter.level = btn.dataset.errlogLevel;
        this._root.querySelectorAll('[data-errlog-level]').forEach(b =>
          b.classList.toggle('errlog-tab-active', b.dataset.errlogLevel === this._filter.level)
        );
        this._renderList();
      });
    });

    // Search input (debounced via input event)
    const searchEl = this._root.querySelector('#errlog-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        this._filter.search = searchEl.value || '';
        this._renderList();
      });
    }

    // Clear
    this._root.querySelector('#errlog-clear')?.addEventListener('click', () => {
      if (!confirm('Очистить весь журнал ошибок? Действие нельзя отменить.')) return;
      ErrorsLog.clear();
      this.render(); // re-render to refresh counts in header
    });

    // Export to JSON
    this._root.querySelector('#errlog-export')?.addEventListener('click', () => {
      const data = ErrorsLog.getAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `q2-errors-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  },
};
