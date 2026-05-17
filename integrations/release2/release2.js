'use strict';
/* ============================================================
   integrations/release2/release2.js — V22+ (Release 2.0)

   Orchestrator подвкладки «Release 2.0» внутри Интеграции.

   Public API:
     Release2View.render(container) — точка входа из integrationsView.js
     Release2View.refresh()         — manual refetch
     Release2View.unmount()         — cleanup

   Жизненный цикл:
     1. render(container) → initial paint loader → fetch async
     2. fetchRelease2List(opts) → analysed
     3. _renderFull(analysed) → DOM update
     4. user-actions через delegation (refresh / expand / filter / preset / export)
     5. Lazy-load related при первом expand (cached в release2State)
   ============================================================ */

import { fetchRelease2List, fetchRelease2Related } from './release2Api.js';
import { renderRelease2View, escapeHtml } from './release2Renderer.js';
import { release2State } from './release2State.js';
import { diffRelease2Lists } from './release2Model.js';
import { Services } from '../../app/services.js';
import { Multiselect } from '../../components/multiselect.js';

/* ─────────────────────────────────────────────────────────────
   Loader / error / empty UI
   ───────────────────────────────────────────────────────────── */

function _renderLoader(container, message) {
  container.innerHTML = `
    <div class="r2-loader">
      <div class="r2-loader-spinner" aria-hidden="true"></div>
      <div class="r2-loader-text">${escapeHtml(message || 'Загружаю релизы из Jira…')}</div>
    </div>`;
}

function _renderError(container, err, onRetry) {
  container.innerHTML = `
    <div class="r2-error">
      <div class="r2-error-title">Не удалось загрузить</div>
      <div class="r2-error-msg">${escapeHtml(String(err?.message || err))}</div>
      <button class="r2-btn r2-btn-primary" data-r2-action="refresh">Повторить</button>
    </div>`;
}

function _renderNotConfigured(container) {
  container.innerHTML = `
    <div class="r2-empty">
      Не настроены проектные области в Jira-конфиге.<br>
      Откройте <strong>Настройки → Интеграции → Jira</strong>, заполните <code>jiraProjectKeys</code>, затем обновите эту вкладку.
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   Bottleneck detector (Доп предложение #5)
   ───────────────────────────────────────────────────────────── */

function _computeBottlenecks(releases) {
  // Группируем по статусу, считаем медиану дней «в статусе» через updated.
  const now = Date.now();
  const byStatus = new Map();
  for (const r of releases) {
    const ts = Date.parse(r.updated || '');
    if (!Number.isFinite(ts)) continue;
    const daysInStatus = (now - ts) / 86400_000;
    const arr = byStatus.get(r.status) || [];
    arr.push({ key: r.key, days: daysInStatus });
    byStatus.set(r.status, arr);
  }
  const result = [];
  for (const [status, items] of byStatus) {
    if (items.length < 2) continue;
    const sortedDays = items.map(i => i.days).sort((a, b) => a - b);
    const median = sortedDays[Math.floor(sortedDays.length / 2)];
    // Outliers — те у кого days > 1.5 × median + median ≥ 5 дней
    if (median < 5) continue;
    const outliers = items.filter(i => i.days > median * 1.5);
    if (!outliers.length) continue;
    result.push({ status, median, outliers });
  }
  return result;
}

/* ─────────────────────────────────────────────────────────────
   Markdown export (Доп предложение #8)
   ───────────────────────────────────────────────────────────── */

function _exportMarkdown(analysed, state) {
  const lines = [];
  lines.push(`# Release 2.0 — Сводка`);
  lines.push(`_Обновлено: ${analysed.fetchedAt}_`);
  lines.push('');
  const s = analysed.stats;
  lines.push(`**Всего:** ${s.total} · Готов к ПРОМ: ${s.byPhase.deploy || 0} · ППСИ: ${s.byPhase.approve || 0} · ПСИ: ${s.byPhase.uat || 0} · В работе: ${(s.byPhase.creation || 0) + (s.byPhase.stabilize || 0)}`);
  if (s.upcomingUAT) lines.push(`⚠ Скоро ПСИ: ${s.upcomingUAT}`);
  if (s.upcomingProd) lines.push(`⚠ Скоро ПРОМ: ${s.upcomingProd}`);
  lines.push('');

  // Group-by project (default — наиболее полезный для отчёта)
  for (const [project, items] of analysed.byProject) {
    lines.push(`## ${project} (${items.length})`);
    lines.push('');
    lines.push('| Ключ | Тема | Статус | Приоритет | КЭ | План ПРОМ |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of items) {
      const ke = (r.configElement || []).map(c => c.value).join(', ') || '—';
      const planProd = r.dates?.planProdEnd ? r.dates.planProdEnd.slice(0, 10) : '—';
      lines.push(`| ${r.key} | ${(r.summary || '').replace(/\|/g, '\\|')} | ${r.status} | ${r.priority || '—'} | ${ke.replace(/\|/g, '\\|')} | ${planProd} |`);
    }
    lines.push('');
  }

  // Bottlenecks (Доп. #5)
  const bottlenecks = _computeBottlenecks(analysed.releases);
  if (bottlenecks.length) {
    lines.push('## Bottlenecks');
    for (const b of bottlenecks) {
      lines.push(`- **${b.status}**: медиана ${Math.round(b.median)}д, outliers (${b.outliers.length}):`);
      for (const o of b.outliers.slice(0, 5)) {
        lines.push(`  - ${o.key}: ${Math.round(o.days)}д`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function _downloadFile(content, filename, mime = 'text/markdown') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

/* ─────────────────────────────────────────────────────────────
   Main view
   ───────────────────────────────────────────────────────────── */

export const Release2View = {
  _container: null,
  _bound: false,

  async render(container) {
    if (!container) return;
    this._container = container;

    // Если уже есть кэшированный результат — рендерим сразу.
    // (Проверка конфига идёт на сервере — он единственный источник правды;
    // фронт раньше читал state.integrations.jira которого нет — всегда давало
    // ложно-позитивное «не настроено».)
    if (release2State.lastList) {
      this._renderFull();
      this._bindOnce(container);
      return;
    }

    // Иначе — стартуем fetch. Сервер сам вернёт 400 если конфиг неполный.
    await this.refresh();
  },

  async refresh() {
    if (!this._container) return;
    _renderLoader(this._container, 'Загружаю релизы из Jira…');
    const signal = release2State.startLoading();
    try {
      const result = await fetchRelease2List({ signal });
      // Phase 5.1 (Доп #22) — append diff to history sparkline.
      // Считаем diff до finishLoading (там prevList → lastList).
      const prevList = release2State.lastList?.releases;
      if (prevList && result.releases && result.fetchedAt) {
        const d = diffRelease2Lists(prevList, result.releases);
        release2State.appendDiffHistory(d, result.fetchedAt);
      }
      release2State.finishLoading(result);
      this._renderFull();
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;   // отменили — не показываем error
      }
      release2State.failLoading(err);
      // Если сервер прямо сказал что конфиг неполный — показываем targeted
      // подсказку; иначе обычный error UI.
      const msg = String(err?.message || '');
      if (/Jira не настроена|jiraProjectKeys|jiraProjectKeys в jira_config|Не настроено ни одного пространства/i.test(msg)) {
        _renderNotConfigured(this._container);
      } else {
        _renderError(this._container, err);
      }
    }
    this._bindOnce(this._container);
  },

  unmount() {
    release2State.cancelLoading();
    if (this._container) {
      this._container.innerHTML = '';
      this._bound = false;
    }
    this._container = null;
    // V22+ Phase 5.2 — restore mascot for other tabs.
    if (typeof document !== 'undefined') {
      document.body.classList.remove('r2-active');
    }
  },

  _renderFull() {
    if (!this._container) return;
    const analysed = release2State.lastList;
    if (!analysed) return;

    // V22+ Phase 5 (Доп #9) — diff banner.
    // Считаем diff если есть prevList И юзер не закрыл banner для этого fetched-at.
    let prevDiff = null;
    const prev = release2State.prevList?.releases;
    if (prev && analysed.releases && analysed.fetchedAt
        && !release2State.isDiffDismissedFor(analysed.fetchedAt)) {
      prevDiff = diffRelease2Lists(prev, analysed.releases);
    }

    // Phase 5.1 — preserve scroll-position + active element (search-input focus)
    // перед innerHTML='...'. Иначе при каждом refresh скролл уходит вверх,
    // фокус из search-input теряется (юзер не может печатать с debounce).
    const scrollY = this._container.scrollTop;
    const active = document.activeElement;
    const restoreFocus = (active && this._container.contains(active))
      ? { tag: active.tagName, data: active.dataset?.r2Search, value: active.value,
          selStart: active.selectionStart, selEnd: active.selectionEnd }
      : null;

    // jiraBaseUrl: сервер прокидывает его внутрь analysed (через release2-fetch),
    // если нет — пусто, ссылки на Jira просто не рендерятся (escapeHtml safe).
    const html = renderRelease2View(analysed, _stateForRenderer(), {
      jiraBaseUrl: analysed.jiraBaseUrl || '',
      prevList: prev,
      prevDiff,
      diffHistory: release2State.getDiffHistory(),
    });
    this._container.innerHTML = html;

    // V22+ Phase 5.2 — Mount Multiselect components в placeholder-slots.
    this._mountMultiselects();

    // V22+ Phase 5.2 — Hide global mascot on Release 2.0 tab (Brand #29).
    if (typeof document !== 'undefined') {
      document.body.classList.add('r2-active');
    }

    // Restore scroll + focus
    this._container.scrollTop = scrollY;
    if (restoreFocus?.data !== undefined) {
      const newSearch = this._container.querySelector('[data-r2-search]');
      if (newSearch) {
        newSearch.focus();
        if (restoreFocus.value !== undefined) newSearch.value = restoreFocus.value;
        try { newSearch.setSelectionRange(restoreFocus.selStart || 0, restoreFocus.selEnd || 0); } catch (_) {}
      }
    }
  },

  /**
   * V22+ Phase 5.2 — Mount V21 Multiselect компоненты в placeholder-slot'ы
   * `<div data-r2-multiselect="…" data-r2-ms-options="…" data-r2-ms-selected="…">`.
   * Multiselect.create() возвращает DOM-узел; вставляем его внутрь slot'а.
   */
  _mountMultiselects() {
    if (!this._container) return;
    const slots = this._container.querySelectorAll('[data-r2-multiselect]');
    slots.forEach(slot => {
      const filterKey = slot.dataset.r2Multiselect;
      let options = [];
      let selected = [];
      try { options = JSON.parse(slot.dataset.r2MsOptions || '[]'); } catch (_) {}
      try { selected = JSON.parse(slot.dataset.r2MsSelected || '[]'); } catch (_) {}
      const label = slot.dataset.r2MsLabel || '';

      // Multiselect mutates `selected` массив — для каждого slot создаём
      // свежий массив (state.filters не должен mutate-ся напрямую).
      const localSelected = selected.slice();
      const node = Multiselect.create(localSelected, (newValues) => {
        release2State.setFilter(filterKey, newValues);
        this._renderFull();
      }, options);

      // Маркируем для CSS-стилизации
      node.classList.add('r2-ms-mount');
      node.setAttribute('data-r2-ms-key', filterKey);
      node.setAttribute('data-r2-ms-label', label);

      slot.replaceWith(node);
    });
  },

  _bindOnce(container) {
    if (this._bound) return;
    if (!container) return;
    this._bound = true;

    container.addEventListener('click', (e) => this._onClick(e));
    container.addEventListener('change', (e) => this._onChange(e));
    container.addEventListener('input', (e) => this._onInput(e));
  },

  _onClick(e) {
    const target = e.target;

    // Refresh
    if (target.closest('[data-r2-action="refresh"]')) {
      this.refresh();
      return;
    }
    // Export MD
    if (target.closest('[data-r2-action="export-md"]')) {
      const analysed = release2State.lastList;
      if (!analysed) return;
      const md = _exportMarkdown(analysed, release2State);
      const fname = `release2-${new Date().toISOString().slice(0, 10)}.md`;
      _downloadFile(md, fname);
      return;
    }
    // Filters reset
    if (target.closest('[data-r2-action="filters-reset"]')) {
      release2State.resetFilters();
      this._renderFull();
      return;
    }
    // V22+ Phase 5 (Доп #9) — dismiss diff banner
    if (target.closest('[data-r2-action="diff-dismiss"]')) {
      const fetchedAt = release2State.lastList?.fetchedAt;
      if (fetchedAt) release2State.dismissDiffFor(fetchedAt);
      this._renderFull();
      return;
    }
    // Lazy related
    const relatedBtn = target.closest('[data-r2-action="related-load"]');
    if (relatedBtn) {
      const key = relatedBtn.dataset.r2Key;
      this._loadRelated(key);
      return;
    }
    // Group-by chip
    const gb = target.closest('[data-r2-groupby]');
    if (gb) {
      release2State.setGroupBy(gb.dataset.r2Groupby);
      this._renderFull();
      return;
    }
    // V22+ Phase 5.1 — phase filter (из phase-bar / stat-cards).
    // Toggle-семантика: повторный клик на ту же фазу снимает фильтр.
    const statChip = target.closest('[data-r2-filter-phase]');
    if (statChip) {
      const ph = statChip.dataset.r2FilterPhase || '';
      const cur = release2State.filters.phase || '';
      release2State.setFilter('phase', cur === ph ? '' : ph);
      this._renderFull();
      return;
    }
    // V22+ Phase 5.2 (Vrba U2) — clear-filter chip из breadcrumb
    const clearChip = target.closest('[data-r2-clear-filter]');
    if (clearChip) {
      const key = clearChip.dataset.r2ClearFilter;
      const value = clearChip.dataset.r2Value;
      const cur = release2State.filters[key];
      if (Array.isArray(cur) && value !== undefined) {
        release2State.setFilter(key, cur.filter(v => v !== value));
      } else if (key === 'searchText') {
        release2State.setFilter('searchText', '');
      } else if (key === 'phase') {
        release2State.setFilter('phase', '');
      } else {
        release2State.setFilter(key, Array.isArray(cur) ? [] : '');
      }
      this._renderFull();
      return;
    }
    // Row toggle
    const toggle = target.closest('[data-r2-toggle]');
    if (toggle) {
      // Не toggle если кликнули внутри expand-body или на ссылку
      if (target.closest('.r2-row-body')) return;
      if (target.tagName === 'A') return;
      const key = toggle.dataset.r2Toggle;
      release2State.toggleExpand(key);
      this._renderFull();
      // Lazy-load related если только что развернули и кэша нет
      if (release2State.isExpanded(key) && !release2State.getRelated(key)) {
        // Триггерим без блокировки UI
        setTimeout(() => this._loadRelated(key), 0);
      }
      return;
    }
    // Tab switch inside expand
    const tabBtn = target.closest('[data-r2-tab]');
    if (tabBtn) {
      const key = tabBtn.dataset.r2Key;
      const tab = tabBtn.dataset.r2Tab;
      release2State.setExpandedTab(key, tab);
      this._renderFull();
      return;
    }
  },

  _onChange(_e) {
    // V22+ Phase 5.2 — native <select> removed; filters теперь идут через
    // Multiselect.onChange callback (см. _mountMultiselects). Handler оставлен
    // как no-op для backward-compat если где-то ещё кликают по <select>.
  },

  _onInput(e) {
    const search = e.target.closest('[data-r2-search]');
    if (search) {
      // Debounce 250ms
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        release2State.setFilter('searchText', search.value || '');
        this._renderFull();
      }, 250);
    }
  },

  async _loadRelated(key) {
    if (!key) return;
    const releases = release2State.lastList?.releases || [];
    const r = releases.find(x => x.key === key);
    if (!r) return;
    const allKeys = [
      ...(r._links?.partOf || []).map(i => i.key),
      ...(r._links?.bugs || []).map(i => i.key),
      ...(r._subtasks || []).map(s => s.key),
    ].filter(Boolean);
    if (!allKeys.length) return;
    try {
      const items = await fetchRelease2Related(allKeys);
      release2State.setRelated(key, items);
      this._renderFull();
    } catch (e) {
      console.warn('[Release2] related-load failed:', e);
    }
  },
};

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

// _getJiraConfig() retired — клиент не имеет доступа к jira_config.json,
// проверка конфига теперь делается на сервере (release2-fetch возвращает
// 400 с targeted-сообщением, фронт reactively показывает _renderNotConfigured).

function _stateForRenderer() {
  // Передаём в renderer тот же state-объект, но даём ему доступ к
  // методам которые renderer использует (getExpandedTab, getRelated).
  return {
    groupBy: release2State.groupBy,
    sort: release2State.sort,
    filters: release2State.filters,
    expandedKeys: release2State.expandedKeys,
    getExpandedTab: (k) => release2State.getExpandedTab(k),
    getRelated:     (k) => release2State.getRelated(k),
  };
}

/* ─────────────────────────────────────────────────────────────
   Services registration
   ───────────────────────────────────────────────────────────── */

try { Services.register('Release2View', Release2View); } catch (_) { /* hot reload */ }
if (typeof window !== 'undefined') window.Release2View = Release2View;
