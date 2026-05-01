'use strict';
/* ============================================================
   HISTORY VIEW — v10_0
   Renders the global change log with filters and export.
   ============================================================ */

import { state }              from '../state.js';
import { Utils }              from '../utils.js';
import { clearHistoryLog, exportHistoryAsCSV } from '../historyLog.js';

const esc = s => Utils.escapeHtml(String(s ?? ''));

const CATEGORY_META = {
  data:         { icon: '📊', label: 'Данные',     color: '#4f46e5' },
  ai:           { icon: '🤖', label: 'AI',         color: '#7c3aed' },
  integrations: { icon: '🔗', label: 'Интеграции', color: '#0284c7' },
  settings:     { icon: '⚙️', label: 'Настройки',  color: '#6b7280' },
  view:         { icon: '👁',  label: 'Навигация',  color: '#10b981' },
  system:       { icon: '🛠',  label: 'Система',    color: '#f59e0b' },
};

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  } catch(_) { return iso; }
}

function fmtRelative(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso); if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} ч назад`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} дн назад`;
  return '';
}

const HistoryView = {
  _filter: { category: '', search: '', simOnly: false },

  render() {
    const root = document.getElementById('section-history');
    if (!root) return;

    const log = Array.isArray(state.actionLog) ? state.actionLog : [];
    const filtered = HistoryView._applyFilters(log);

    // Stats by category
    const stats = {};
    log.forEach(e => { stats[e.category] = (stats[e.category] || 0) + 1; });

    root.innerHTML = `
      <div class="hist-page">
        <div class="hist-header">
          <div>
            <h2 class="hist-title">📜 История изменений</h2>
            <p class="hist-subtitle">Всего записей: <b>${log.length}</b> · Показано: <b>${filtered.length}</b></p>
          </div>
          <div class="hist-actions">
            <button class="btn btn-outline btn-sm" id="hist-export-csv">⤓ Экспорт CSV</button>
            <button class="btn btn-ghost btn-sm" id="hist-clear" title="Очистить весь журнал">🗑 Очистить</button>
          </div>
        </div>

        <div class="hist-filters">
          <input type="text" id="hist-search" class="filter-input" placeholder="Поиск по описанию / типу / цели…" value="${esc(HistoryView._filter.search)}">
          <select id="hist-category" class="filter-select">
            <option value="">Все категории</option>
            ${Object.entries(CATEGORY_META).map(([k,v]) =>
              `<option value="${esc(k)}" ${HistoryView._filter.category === k ? 'selected' : ''}>${v.icon} ${v.label} ${stats[k] ? `(${stats[k]})` : ''}</option>`
            ).join('')}
          </select>
          <label class="hist-check">
            <input type="checkbox" id="hist-sim-only" ${HistoryView._filter.simOnly ? 'checked' : ''}>
            Только симуляция
          </label>
        </div>

        <div class="hist-stats">
          ${Object.entries(CATEGORY_META).map(([k,v]) => `
            <button class="hist-stat-card" data-hist-category="${esc(k)}" style="--stat-color:${v.color}">
              <span class="hist-stat-icon">${v.icon}</span>
              <span class="hist-stat-count">${stats[k] || 0}</span>
              <span class="hist-stat-label">${esc(v.label)}</span>
            </button>
          `).join('')}
        </div>

        <div class="hist-list-wrap">
          ${filtered.length ? HistoryView._renderList(filtered) : `
            <div class="hist-empty">
              <div class="hist-empty-icon">📭</div>
              <div class="hist-empty-title">${log.length ? 'Нет записей по фильтру' : 'Журнал пуст'}</div>
              <div class="hist-empty-sub">${log.length ? 'Попробуйте сбросить фильтры выше.' : 'Любые изменения данных, AI-запросы, синки интеграций будут отображаться здесь.'}</div>
            </div>
          `}
        </div>
      </div>
    `;

    HistoryView._bindEvents(root);
  },

  _applyFilters(log) {
    const f = HistoryView._filter;
    const search = String(f.search || '').toLowerCase().trim();
    return log.filter(e => {
      if (f.category && e.category !== f.category) return false;
      if (f.simOnly && !e.simMode) return false;
      if (search) {
        const hay = `${e.type} ${e.label} ${e.target || ''} ${e.details || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  },

  _renderList(entries) {
    const groups = {};
    entries.forEach(e => {
      const dayKey = (e.at || '').slice(0, 10);
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(e);
    });

    return Object.entries(groups).map(([day, list]) => `
      <div class="hist-group">
        <div class="hist-group-header">${HistoryView._formatDay(day)}</div>
        ${list.map(e => HistoryView._renderEntry(e)).join('')}
      </div>
    `).join('');
  },

  _formatDay(day) {
    if (!day) return 'Без даты';
    const today = new Date().toISOString().slice(0,10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0,10);
    if (day === today) return 'Сегодня';
    if (day === yesterday) return 'Вчера';
    try {
      return new Date(day + 'T00:00:00Z').toLocaleDateString('ru', { day:'numeric', month:'long', year:'numeric' });
    } catch(_) { return day; }
  },

  _renderEntry(e) {
    const meta = CATEGORY_META[e.category] || { icon: '·', label: e.category, color: '#9ca3af' };
    return `
      <div class="hist-entry${e.simMode ? ' hist-entry-sim' : ''}" data-hist-id="${esc(e.id)}">
        <div class="hist-entry-icon" style="background: color-mix(in srgb, ${meta.color} 18%, transparent); color: ${meta.color}">${meta.icon}</div>
        <div class="hist-entry-body">
          <div class="hist-entry-title">
            ${esc(e.label)}
            ${e.count > 1 ? `<span class="hist-entry-count">×${e.count}</span>` : ''}
            ${e.simMode ? '<span class="hist-entry-tag hist-entry-tag-sim">SIM</span>' : ''}
          </div>
          <div class="hist-entry-meta">
            <span class="hist-entry-type">${esc(e.type)}</span>
            ${e.target ? `<span class="hist-entry-target">→ ${esc(e.target)}</span>` : ''}
            ${e.source ? `<span class="hist-entry-source">${esc(e.source)}</span>` : ''}
          </div>
          ${e.details ? `<div class="hist-entry-details">${esc(e.details)}</div>` : ''}
        </div>
        <div class="hist-entry-time" title="${esc(fmtDateTime(e.at))}">
          <div class="hist-entry-time-rel">${fmtRelative(e.at)}</div>
          <div class="hist-entry-time-abs">${(e.at || '').slice(11, 19)}</div>
        </div>
      </div>
    `;
  },

  _bindEvents(root) {
    const search   = root.querySelector('#hist-search');
    const category = root.querySelector('#hist-category');
    const simOnly  = root.querySelector('#hist-sim-only');

    let searchTimer;
    search?.addEventListener('input', e => {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => { HistoryView._filter.search = v; HistoryView.render(); }, 200);
    });
    category?.addEventListener('change', e => { HistoryView._filter.category = e.target.value; HistoryView.render(); });
    simOnly?.addEventListener('change', e => { HistoryView._filter.simOnly = e.target.checked; HistoryView.render(); });

    root.querySelectorAll('[data-hist-category]').forEach(card => {
      card.addEventListener('click', () => {
        const cat = card.dataset.histCategory;
        HistoryView._filter.category = HistoryView._filter.category === cat ? '' : cat;
        HistoryView.render();
      });
    });

    root.querySelector('#hist-export-csv')?.addEventListener('click', () => {
      exportHistoryAsCSV();
      window.showToast?.('История экспортирована в CSV');
    });

    root.querySelector('#hist-clear')?.addEventListener('click', () => {
      if (!confirm('Удалить весь журнал истории? Это действие необратимо.')) return;
      clearHistoryLog();
      window.showToast?.('Журнал очищен');
      HistoryView.render();
    });
  },
};

if (typeof window !== 'undefined') window.HistoryView = HistoryView;
export { HistoryView };
