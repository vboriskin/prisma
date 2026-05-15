'use strict';
/* ============================================================
   HISTORY VIEW — v10_0
   Renders the global change log with filters and export.
   ============================================================ */

import { state }              from '../state.js';
import { Utils }              from '../utils.js';
import { clearHistoryLog, exportHistoryAsCSV } from '../historyLog.js';
import { ConfirmDialog } from '../app/uxKit.js';
import { renderPageHeader, prizmaEmptyGlyph } from '../app/prizmaUI.js';
import { Icons } from '../app/icons.js';
import { Services } from '../app/services.js';

const esc = s => Utils.escapeHtml(String(s ?? ''));

// V21 Wave-3 — emoji-icons → Lucide-style line-glyph через Icons.get(name).
// Семантика категорий теперь в `iconKey` (а не в emoji-символе).
// AUDIT-ART #14 — десемантизация цветов категорий. Раньше data/ai/view/system
// получали отдельные signal-токены (information / insight / on-course / drift).
// Брендбук §3 — signal-цвета зарезервированы за статусом курса. История —
// нейтральный системный экран; все категории теперь нейтральный grey-icon
// (`--prizma-text-secondary`). Активная/выделенная категория получает синий
// `--prizma-information` («информация про действие») через CSS-селектор
// `[data-hist-active="true"]` + 3px stripe-left.
const NEUTRAL_CATEGORY_COLOR = 'var(--prizma-text-secondary)';
const ACTIVE_CATEGORY_COLOR  = 'var(--prizma-information)';
const CATEGORY_META = {
  data:         { iconKey: 'bar-chart',      label: 'Данные',     color: NEUTRAL_CATEGORY_COLOR },
  ai:           { iconKey: 'sparkles',       label: 'AI',         color: NEUTRAL_CATEGORY_COLOR },
  integrations: { iconKey: 'cpu',            label: 'Интеграции', color: NEUTRAL_CATEGORY_COLOR },
  settings:     { iconKey: 'settings',       label: 'Настройки',  color: NEUTRAL_CATEGORY_COLOR },
  view:         { iconKey: 'eye',            label: 'Навигация',  color: NEUTRAL_CATEGORY_COLOR },
  system:       { iconKey: 'wrench',         label: 'Система',    color: NEUTRAL_CATEGORY_COLOR },
};

/* AUDIT-ART #14 — runtime style-инжект для истории.
   styles.css не правится (параллельные агенты конфликтуют).
   Идемпотентно: повторные вызовы no-op. */
function injectHistoryAuditArtStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-history-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-history-style';
  style.textContent = `
/* AUDIT-ART #14 — нейтральные категории. Active/selected = синий
   (information) + 3px stripe-left, не filled. */
.hist-stat-card[data-hist-active="true"] {
  --stat-color: ${ACTIVE_CATEGORY_COLOR};
  color: ${ACTIVE_CATEGORY_COLOR};
  border-left: 3px solid ${ACTIVE_CATEGORY_COLOR};
  background: transparent;
}
.hist-stat-card[data-hist-active="true"] .hist-stat-icon {
  color: ${ACTIVE_CATEGORY_COLOR};
}
.hist-stat-card[data-hist-active="true"] .hist-stat-count,
.hist-stat-card[data-hist-active="true"] .hist-stat-label {
  color: ${ACTIVE_CATEGORY_COLOR};
}
/* hist-entry — выделенная (по совпадению с активной категорией) строка
   получает synodic 3px stripe-left information. tabular-nums на счётчиках. */
.hist-entry[data-hist-highlighted="true"] {
  border-left: 3px solid ${ACTIVE_CATEGORY_COLOR};
  padding-left: 9px;
}
.hist-entry-count,
.hist-entry-time-rel,
.hist-entry-time-abs {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
}
`;
  document.head.appendChild(style);
}

// V21 π9 — локальные `fmtDateTime` и `fmtRelative` свёрнуты на единые
// `Utils.fmtDateTime` / `Utils.fmtRelTime` (audit-2026-05-04 §2).
function fmtDateTime(iso) { return Utils.fmtDateTime(iso); }
function fmtRelative(iso) { return Utils.fmtRelTime(iso); }

const HistoryView = {
  _filter: { category: '', search: '', simOnly: false },

  render() {
    const root = document.getElementById('section-history');
    if (!root) return;

    // AUDIT-ART #14 — runtime style-инжект (idempotent).
    injectHistoryAuditArtStyles();

    const log = Array.isArray(state.actionLog) ? state.actionLog : [];
    const filtered = HistoryView._applyFilters(log);
    const activeCat = HistoryView._filter.category || '';

    // Stats by category
    const stats = {};
    log.forEach(e => { stats[e.category] = (stats[e.category] || 0) + 1; });

    root.innerHTML = `
      ${renderPageHeader('history', { sub: 'След пути назад: что и когда менялось.' })}
      <div class="hist-page">
        <div class="hist-header">
          <div>
            <h2 class="hist-title">История изменений</h2>
            <p class="hist-subtitle">Всего записей: <b>${log.length}</b> · Показано: <b>${filtered.length}</b></p>
          </div>
          <div class="hist-actions">
            <button class="btn btn-outline btn-sm" id="hist-export-csv" data-icon="download" data-icon-size="14" aria-label="Экспорт истории в CSV">Экспорт CSV</button>
            <button class="btn btn-ghost btn-sm" id="hist-clear" data-icon="trash" data-icon-size="14" aria-label="Очистить весь журнал" title="Очистить весь журнал">Очистить</button>
          </div>
        </div>

        <div class="hist-filters">
          <input type="text" id="hist-search" class="filter-input" placeholder="Поиск по описанию / типу / цели…" value="${esc(HistoryView._filter.search)}">
          <select id="hist-category" class="filter-select">
            <option value="">Все категории</option>
            ${Object.entries(CATEGORY_META).map(([k,v]) =>
              `<option value="${esc(k)}" ${HistoryView._filter.category === k ? 'selected' : ''}>${v.label} ${stats[k] ? `(${stats[k]})` : ''}</option>`
            ).join('')}
          </select>
          <label class="hist-check">
            <input type="checkbox" id="hist-sim-only" ${HistoryView._filter.simOnly ? 'checked' : ''}>
            Только симуляция
          </label>
        </div>

        <div class="hist-stats">
          ${Object.entries(CATEGORY_META).map(([k,v]) => {
            // AUDIT-ART #14 — active card = синий information + stripe-left
            // через `data-hist-active`. Inactive — нейтральный grey.
            const isActive = activeCat === k;
            const color = isActive ? ACTIVE_CATEGORY_COLOR : v.color;
            return `
            <button class="hist-stat-card" data-hist-category="${esc(k)}" data-hist-active="${isActive ? 'true' : 'false'}" style="--stat-color:${color}">
              <span class="hist-stat-icon" style="color:${color}">${Icons.get(v.iconKey, { size: 16 })}</span>
              <span class="hist-stat-count">${stats[k] || 0}</span>
              <span class="hist-stat-label">${esc(v.label)}</span>
            </button>
          `;}).join('')}
        </div>

        <div class="hist-list-wrap">
          ${filtered.length ? HistoryView._renderList(filtered) : `
            <div class="hist-empty">
              ${prizmaEmptyGlyph()}
              <div class="hist-empty-title">${log.length ? 'Нет записей по фильтру' : 'Журнал пуст'}</div>
              <div class="hist-empty-sub">${log.length ? 'Попробуйте сбросить фильтры выше.' : 'Здесь появятся изменения данных, AI-запросы и синхронизации.'}</div>
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
    const meta = CATEGORY_META[e.category] || { iconKey: 'tag', label: e.category, color: NEUTRAL_CATEGORY_COLOR };
    // AUDIT_LAYOUT #15 — data-state даёт Spine-pill хук для визуальной
    // иерархии (важное / обычное / отменённое). Категория сама уже
    // диктует tone — пробрасываем её и в data-state для CSS-селекторов.
    const stateAttr = e.simMode ? 'sim' : (e.category || 'default');
    // AUDIT-ART #14 — иконка категории в нейтральном grey. Если категория
    // совпадает с активным фильтром — highlight stripe-left + information-color
    // через атрибут (CSS-инжект, никаких filled-фонов).
    const isHighlighted = HistoryView._filter.category && HistoryView._filter.category === e.category;
    const iconColor = isHighlighted ? ACTIVE_CATEGORY_COLOR : meta.color;
    return `
      <div class="hist-entry${e.simMode ? ' hist-entry-sim' : ''}" data-hist-id="${esc(e.id)}" data-state="${esc(stateAttr)}" data-hist-highlighted="${isHighlighted ? 'true' : 'false'}">
        <div class="hist-entry-icon" style="background: color-mix(in srgb, ${iconColor} 12%, transparent); color: ${iconColor}">${Icons.get(meta.iconKey, { size: 14 })}</div>
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

    root.querySelector('#hist-clear')?.addEventListener('click', async () => {
      // V21 Q — ConfirmDialog (danger). История действий не имеет undo.
      const ok = await ConfirmDialog.show({
        title: 'Удалить журнал истории?',
        message: 'Все записи о действиях пользователя будут удалены. Это действие необратимо.',
        confirmLabel: 'Удалить',
        danger: true,
      });
      if (!ok) return;
      clearHistoryLog();
      window.showToast?.('Журнал очищен');
      HistoryView.render();
    });
  },
};

Services.register('HistoryView', HistoryView);
if (typeof window !== 'undefined') window.HistoryView = HistoryView;
export { HistoryView };
