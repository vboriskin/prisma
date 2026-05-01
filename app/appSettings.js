'use strict';
/* ============================================================
   APP SETTINGS — V18.1 P9 extracted from app.js (lines 463-1007)
   --
   The Settings modal (sections list / blocks visibility / topbar order /
   debug-mode toggle / LLM form / integrations form host / storage settings).

   Includes 4 module-level constants:
     NAV_SECTIONS         — sidebar nav-section registry (key + default label)
     BLOCKS_PER_SECTION   — toggleable blocks per section (id + label)
     APP_SETTINGS_KEY     — localStorage key for persistence
     TOPBAR_ITEMS         — topbar icon registry (id + label + icon)

   Used externally only by app.js. window.AppSettings re-export kept for
   backward compat (some external code references it).

   Dependencies:
     - Utils (escapeHtml) — direct import
     - state, Storage, HistoryLog, notify — direct imports
     - StorageSettings, AppDataStore — direct imports
     - LLMAssistant / IntegrationsLoad/Render/BindModal — via window globals
       (defined in app.js → loaded after AppSettings, used inside lazy callbacks)
     - closeModal, showToast — via window (defined in app.js)
     - App.renderActive — via window (App is the orchestrator in app.js)
   ============================================================ */

import { Utils }            from '../utils.js';
import { state, notify }    from '../state.js';
import { Storage }          from '../dataStore.js';
import { HistoryLog }       from '../historyLog.js';
import { AppDataStore }     from '../appDataStore.js';
import { StorageSettings }  from './storageSettings.js';

export const NAV_SECTIONS = [
  { key:'dashboard',   label:'Дашборд' },   { key:'registry',    label:'Реестр' },
  { key:'gantt',       label:'Гант' },
  { key:'kanban',      label:'Канбан' },      { key:'timeline',    label:'Таймлайн' },
  { key:'podlozhka',   label:'Подложка' },    { key:'employees',   label:'Сотрудники' },
  { key:'summary',     label:'Сводная' },     { key:'metrics',     label:'Метрики' },
  { key:'insights',    label:'Инсайты' },     { key:'diagnostics', label:'Диагностика' },
  { key:'actions',     label:'Action Layer' },
  { key:'ai',          label:'AI Анализ' },   { key:'integrations',label:'Интеграции' },
  { key:'ai-ceo',      label:'AI CEO' },      { key:'history',     label:'История' },
  { key:'errors',      label:'Ошибки' },
];

/* Toggleable blocks per section. The `id` attribute matches the DOM element ID
   so we can hide it via CSS class without touching the renderers. */
export const BLOCKS_PER_SECTION = {
  dashboard: [
    { id:'dashboard-legend',        label:'Легенда дашборда' },
    { id:'dashboard-kpi',           label:'KPI карточки' },
    { id:'dashboard-progress',      label:'Прогресс по релизам' },
    { id:'risks-panel',             label:'Риски и блокеры' },
    { id:'blocking-detail-card',    label:'Деталь блокеров' },
    { id:'release-breakdown',       label:'Разбивка по релизам' },
    { id:'teams-summary-wrap',      label:'Сводка по командам' },
    { id:'no-release-wrap',         label:'Задачи без релиза' },
    { id:'needs-confirm-wrap',      label:'Требуют подтверждения' },
  ],
  registry: [
    { id:'registry-legend',         label:'Легенда реестра' },
    { id:'col-toggle-panel',        label:'Панель столбцов' },
    { id:'registry-settings-panel', label:'Панель настроек реестра' },
    { id:'bulk-panel',              label:'Панель массовых действий' },
  ],
  gantt: [
    { id:'gantt-filters',           label:'Фильтры ганта' },
    { id:'gantt-legend-extra',      label:'Легенда ганта' },
  ],
  kanban: [
    { id:'kanban-legend',           label:'Легенда канбана' },
  ],
  timeline: [
    { id:'timeline-legend-extra',   label:'Легенда таймлайна' },
  ],
  podlozhka: [
    { id:'podlozhka-legend',        label:'Легенда подложки' },
  ],
  employees: [
    { id:'employees-legend',        label:'Легенда сотрудников' },
    { id:'employees-summary-cards', label:'Сводные карточки сотрудников' },
  ],
  summary: [
    { id:'summary-legend',          label:'Легенда сводной' },
  ],
  metrics: [
    { id:'metrics-legend',          label:'Легенда метрик' },
  ],
  insights: [
    { id:'insights-legend',         label:'Легенда инсайтов' },
  ],
  // V17.1 J2 — все label'ы переведены на русский (англицизмы убраны).
  ai: [
    { id:'ai-block-health',             label:'Здоровье проекта' },
    { id:'ai-block-forecast',           label:'Прогноз релизов' },
    { id:'ai-block-if_nothing_changes', label:'Если ничего не менять' },
    { id:'ai-block-dashboard',          label:'Сгенерированный дашборд' },
    { id:'ai-block-quality',            label:'Качество плана' },
    { id:'ai-block-bottlenecks',        label:'Узкие места' },
    { id:'ai-block-anomalies',          label:'Поиск аномалий' },
    { id:'ai-block-risk_narrative',     label:'Описание рисков' },
    { id:'ai-block-second_opinion',     label:'Второе мнение' },
    { id:'ai-block-prioritization',     label:'Приоритизация задач' },
    { id:'ai-block-dependency',         label:'Анализ зависимостей' },
    { id:'ai-block-replanning',         label:'Сценарии перепланирования' },
    { id:'ai-block-recommendations',    label:'Рекомендации' },
  ],
};

export const APP_SETTINGS_KEY = 'sbof_app_settings_v1';

// Topbar icon-button registry. Order in this array is the DEFAULT order in the
// topbar (left-to-right, after the Filters button). User can drag to reorder
// in Settings → Interface. Each entry has the data-tb attribute that ties
// the settings list to the actual DOM element.
export const TOPBAR_ITEMS = [
  { id: 'save',       label: 'Сохранить',     icon: '💾' },
  { id: 'files',      label: 'Файлы',         icon: '📂' },
  { id: 'sim',        label: 'Симуляция',     icon: '⚡' },
  { id: 'theme',      label: 'Тема',          icon: '🌙' },
  { id: 'settings',   label: 'Настройки',     icon: '⚙' },
  { id: 'onboarding', label: 'Обучение',      icon: '?' },
];

// Helper getters for `closeModal` / `showToast` (defined in app.js so we
// pull them through window globals to keep the dependency direction
// app.js → appSettings.js, not back).
const _closeModal = (...a) => window.closeModal && window.closeModal(...a);
const _showToast  = (...a) => window.showToast  && window.showToast(...a);

export const AppSettings = {
  defaults() {
    return {
      hiddenSections: [],
      sectionOrder:   [],          // [] = use NAV_SECTIONS order
      sectionLabels:  {},          // { key: 'Custom name' }
      dividerAfter:   ['insights','diagnostics','actions','ai','ai-ceo'], // legacy default
      hiddenBlocks:   [],          // [blockId, ...]
      topbarOrder:    [],          // [] = use TOPBAR_ITEMS order; otherwise array of data-tb ids
      // Debug mode — when off, dev-only sections («Подложка», «Диагностика»)
      // are hidden from the sidebar AND their interface-tab toggles are not
      // shown. Enabled via Settings → Debug.
      debugMode: false,
    };
  },
  load() {
    try {
      const merged = { ...AppSettings.defaults(), ...JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') };
      // Normalise possibly-missing fields after upgrades
      if (!Array.isArray(merged.hiddenSections)) merged.hiddenSections = [];
      if (!Array.isArray(merged.sectionOrder))   merged.sectionOrder   = [];
      if (!merged.sectionLabels || typeof merged.sectionLabels !== 'object') merged.sectionLabels = {};
      if (!Array.isArray(merged.dividerAfter))   merged.dividerAfter   = AppSettings.defaults().dividerAfter;
      if (!Array.isArray(merged.hiddenBlocks))   merged.hiddenBlocks   = [];
      if (!Array.isArray(merged.topbarOrder))    merged.topbarOrder    = [];
      if (typeof merged.debugMode !== 'boolean')  merged.debugMode      = false;
      return merged;
    } catch(_) { return AppSettings.defaults(); }
  },
  save(cfg) { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(cfg)); },

  /* Returns NAV_SECTIONS in user-configured order (with custom labels merged) */
  resolveOrder(cfg) {
    const known = new Set(NAV_SECTIONS.map(s => s.key));
    const order = (cfg.sectionOrder || []).filter(k => known.has(k));
    const seen  = new Set(order);
    NAV_SECTIONS.forEach(s => { if (!seen.has(s.key)) order.push(s.key); });
    return order.map(k => {
      const base = NAV_SECTIONS.find(s => s.key === k);
      const customLabel = cfg.sectionLabels?.[k];
      return { key: k, label: customLabel || base.label, defaultLabel: base.label };
    });
  },

  /** Sections that only show up in "Debug" mode. Even if the user explicitly
   *  un-hides them via Interface tab, they remain hidden when debugMode=false. */
  _DEBUG_ONLY_SECTIONS: ['podlozhka', 'diagnostics'],

  apply(cfg) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    // V18.1 — nav-items live inside .sidebar-nav wrapper (sibling of the
    // footer chevron-button). Reordering must append into the wrapper, not
    // the sidebar itself — otherwise items get pushed AFTER the chevron and
    // an empty .sidebar-nav (flex:1) eats all space, leaving items pinned
    // to the bottom of the sidebar. Fallback to #sidebar for forward-compat.
    const navHost = sidebar.querySelector('.sidebar-nav') || sidebar;
    const ordered = AppSettings.resolveOrder(cfg);
    const dividerAfterSet = new Set(cfg.dividerAfter || []);
    document.body.classList.toggle('app-debug-off', !cfg.debugMode);
    // Force-hide dev-only sections (sidebar buttons + section bodies) when debug is off.
    AppSettings._DEBUG_ONLY_SECTIONS.forEach(key => {
      const navBtn = sidebar.querySelector(`.nav-item[data-section="${key}"]`);
      const sect   = document.getElementById(`section-${key}`);
      if (navBtn) navBtn.classList.toggle('nav-item-debug-hidden', !cfg.debugMode);
      if (sect)   sect.classList.toggle('section-debug-hidden',   !cfg.debugMode);
    });

    // 1) Reorder nav items in DOM, hide/show, update labels.
    //    We walk the configured order and append each existing nav button to
    //    the .sidebar-nav wrapper (appendChild moves the node, preserving
    //    event listeners). This guarantees items stay above the footer chevron.
    ordered.forEach((s) => {
      const navBtn = sidebar.querySelector(`.nav-item[data-section="${s.key}"]`);
      if (!navBtn) return;
      navBtn.classList.toggle('nav-item-hidden', cfg.hiddenSections.includes(s.key));
      const labelSpan = navBtn.querySelector('.nav-label');
      if (labelSpan) labelSpan.textContent = s.label;
      // Move to end-of-nav-host in order
      navHost.appendChild(navBtn);
    });

    // 2) Strip ALL existing nav-divider elements, then insert per cfg.dividerAfter.
    sidebar.querySelectorAll('.nav-divider').forEach(d => d.remove());
    ordered.forEach(s => {
      if (cfg.hiddenSections.includes(s.key)) return;       // don't insert divider after hidden item
      if (!dividerAfterSet.has(s.key)) return;
      const navBtn = sidebar.querySelector(`.nav-item[data-section="${s.key}"]`);
      if (!navBtn) return;
      const div = document.createElement('div');
      div.className = 'nav-divider';
      navBtn.after(div);
    });

    // 3) Block visibility — toggle a class on each block element
    const allBlocks = Object.values(BLOCKS_PER_SECTION).flat().map(b => b.id);
    allBlocks.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('app-block-hidden', cfg.hiddenBlocks.includes(id));
    });

    // 4) Topbar icon order — reorder children of .topbar-actions to match
    //    cfg.topbarOrder. Items not in cfg.topbarOrder fall back to TOPBAR_ITEMS
    //    default order. We use appendChild() to MOVE existing nodes (preserves
    //    event listeners), so this is safe to call any time.
    AppSettings.applyTopbarOrder(cfg);
  },

  applyTopbarOrder(cfg) {
    const host = document.querySelector('.topbar-actions');
    if (!host) return;
    const known = new Set(TOPBAR_ITEMS.map(i => i.id));
    const order = (cfg.topbarOrder || []).filter(id => known.has(id));
    const seen  = new Set(order);
    TOPBAR_ITEMS.forEach(it => { if (!seen.has(it.id)) order.push(it.id); });
    // Move each tracked element to the end of the host in the configured order.
    // Untracked elements (Filters button, demo badges) keep their absolute
    // positions because we don't touch them.
    order.forEach(id => {
      const el = host.querySelector(`[data-tb="${id}"]`);
      if (el) host.appendChild(el);
    });
  },
  init() {
    const cfg = AppSettings.load(); AppSettings.apply(cfg);
    const openBtn = document.getElementById('btn-app-settings');
    const modal   = document.getElementById('app-settings-modal');
    const closeBtn = document.getElementById('app-settings-close');
    const saveBtn  = document.getElementById('app-settings-save');
    const resetBtn = document.getElementById('app-settings-reset');
    const togglesWrap = document.getElementById('app-settings-nav-toggles');
    const blocksWrap = document.getElementById('app-settings-blocks-toggles');
    const topbarWrap = document.getElementById('app-settings-topbar-order');
    const storageHost = document.getElementById('app-settings-storage-host');
    if (!openBtn || !modal) return;
    openBtn.addEventListener('click', () => {
      const cfg = AppSettings.load();
      AppSettings.renderToggles(togglesWrap, cfg);
      AppSettings.renderBlockToggles(blocksWrap, cfg);
      AppSettings.renderTopbarOrder(topbarWrap, cfg);
      StorageSettings.render(storageHost, { AppDataStore, Storage, state, HistoryLog, notify });
      AppSettings.renderDebugTab(document.getElementById('app-settings-debug-host'), cfg);
      modal.querySelectorAll('.app-settings-tab').forEach((t,i) => t.classList.toggle('active', i===0));
      modal.querySelectorAll('.app-settings-tab-content').forEach((c,i) => c.classList.toggle('hidden', i!==0));
      modal.classList.remove('hidden');
      // Pre-render integrations form (so the user can switch into the tab without delay)
      AppSettings._renderInlineIntegrations?.();
      // Sync LLM form values (LLM form was moved into the settings modal)
      window.LLMAssistant?.syncSettingsUI?.();
    });
    modal.querySelectorAll('.app-settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.app-settings-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.app-settings-tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        modal.querySelector(`.app-settings-tab-content[data-tab-content="${tab.dataset.tab}"]`)?.classList.remove('hidden');
      });
    });
    // ── Inline LLM form: move .llm-settings-grid + .llm-prompts-section + .modal-actions
    //    from the (legacy) standalone modal into the LLM tab content of the app-settings modal.
    //    Original IDs stay so existing LLMAssistant event handlers still work.
    const llmHost = document.getElementById('app-settings-llm-host');
    const oldLlmModal = document.getElementById('llm-settings-modal');
    if (llmHost && oldLlmModal && !llmHost.dataset.populated) {
      const grid    = oldLlmModal.querySelector('.llm-settings-grid');
      const prompts = oldLlmModal.querySelector('.llm-prompts-section');
      const acts    = oldLlmModal.querySelector('.modal-actions.llm-actions');
      if (grid)    llmHost.appendChild(grid);
      if (prompts) llmHost.appendChild(prompts);
      if (acts)    llmHost.appendChild(acts);
      llmHost.dataset.populated = '1';
      // Hide the now-empty standalone modal forever
      oldLlmModal.classList.add('hidden');
      oldLlmModal.style.display = 'none';
    }

    // ── Inline integrations: lazy-render the form into the integrations tab host ──
    const intHost = document.getElementById('app-settings-integrations-host');
    const renderInlineIntegrations = () => {
      if (!intHost) return;
      const loadFn = window.IntegrationsLoadSettings;
      const renderFn = window.IntegrationsRenderModal;
      const bindFn = window.IntegrationsBindModal;
      if (!loadFn || !renderFn || !bindFn) return;
      intHost.innerHTML = renderFn(loadFn(), { inline: true });
      bindFn();
    };

    // Re-render integrations form when its tab becomes active
    modal.querySelectorAll('.app-settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'integrations') renderInlineIntegrations();
      });
    });
    // Also render once if integrations tab is active when modal opens
    AppSettings._renderInlineIntegrations = renderInlineIntegrations;
    closeBtn?.addEventListener('click', () => _closeModal(modal));
    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(modal); });
    saveBtn?.addEventListener('click', () => {
      // 1) Interface settings — sections (order, labels, visibility, dividers) + blocks
      const ifaceCfg = AppSettings.collect(togglesWrap, blocksWrap, topbarWrap);
      // Pull the Debug-tab toggle into the same settings object so the bottom
      // Save button persists it. If the Debug tab was never opened, fall back
      // to the previously saved value rather than defaulting to false (which
      // would silently disable debug mode on every save).
      const debugTgl = document.getElementById('app-settings-debug-toggle');
      ifaceCfg.debugMode = debugTgl ? !!debugTgl.checked : !!AppSettings.load().debugMode;
      AppSettings.save(ifaceCfg);
      AppSettings.apply(ifaceCfg);
      // 2) LLM settings — fields live inside this modal, so save them too.
      //    This makes the bottom "Сохранить" button persist the LLM token, model, etc.
      try { window.LLMAssistant?.saveSettingsFromUI?.(); } catch(_) {}
      // 3) Integrations have their own per-tab Save buttons (Jira/BB/CF) and a separate
      //    server-side flow, so we deliberately do NOT auto-save them here to avoid
      //    accidentally writing partial form state.
      _closeModal(modal);
      _showToast('Настройки сохранены');
    });
    resetBtn?.addEventListener('click', () => {
      localStorage.removeItem(APP_SETTINGS_KEY);
      const def = AppSettings.defaults();
      AppSettings.apply(def);
      AppSettings.renderToggles(togglesWrap, def);
      AppSettings.renderBlockToggles(blocksWrap, def);
      AppSettings.renderTopbarOrder(topbarWrap, def);
      AppSettings.renderDebugTab(document.getElementById('app-settings-debug-host'), def);
      _showToast('Настройки сброшены');
    });
  },
  /* Render the sortable list of nav sections (rename + divider + show/hide). */
  renderToggles(wrap, cfg) {
    if (!wrap) return;
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    const ordered = AppSettings.resolveOrder(cfg);
    const dividerAfter = new Set(cfg.dividerAfter || []);
    wrap.innerHTML = ordered.map(s => {
      const visible  = !cfg.hiddenSections.includes(s.key);
      const showDiv  = dividerAfter.has(s.key);
      const isCustom = !!cfg.sectionLabels?.[s.key];
      return `
        <div class="app-nav-row" draggable="true" data-section="${s.key}">
          <span class="app-nav-handle" title="Перетащить, чтобы поменять порядок">⋮⋮</span>
          <input type="text" class="app-nav-label-input" value="${esc(s.label)}" placeholder="${esc(s.defaultLabel)}" data-default-label="${esc(s.defaultLabel)}">
          <button class="app-nav-reset-label" title="Сбросить название" ${isCustom ? '' : 'disabled'}>↺</button>
          <label class="app-nav-toggle" title="Показать в боковом меню">
            <input type="checkbox" class="app-nav-visible" ${visible ? 'checked' : ''}>
            <span>видна</span>
          </label>
          <label class="app-nav-toggle" title="Разделитель после этой вкладки">
            <input type="checkbox" class="app-nav-divider" ${showDiv ? 'checked' : ''}>
            <span>— разделитель</span>
          </label>
        </div>`;
    }).join('');
    AppSettings._wireSortable(wrap);
    AppSettings._wireRowControls(wrap);
  },

  /* Render the sortable list of topbar icon buttons. Drag-and-drop reorders;
     the bottom Save button persists into cfg.topbarOrder. */
  renderTopbarOrder(wrap, cfg) {
    if (!wrap) return;
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    const known = new Set(TOPBAR_ITEMS.map(i => i.id));
    const order = (cfg.topbarOrder || []).filter(id => known.has(id));
    const seen  = new Set(order);
    TOPBAR_ITEMS.forEach(it => { if (!seen.has(it.id)) order.push(it.id); });
    wrap.innerHTML = order.map(id => {
      const it = TOPBAR_ITEMS.find(t => t.id === id);
      if (!it) return '';
      return `
        <div class="app-nav-row" draggable="true" data-tb-id="${esc(it.id)}">
          <span class="app-nav-handle" title="Перетащить">⋮⋮</span>
          <span class="app-tb-icon" aria-hidden="true">${esc(it.icon)}</span>
          <span class="app-tb-label">${esc(it.label)}</span>
        </div>`;
    }).join('');
    AppSettings._wireSortableTopbar(wrap);
  },

  /* Same DnD machinery as _wireSortable but binds to data-tb-id rows.
     Kept separate so we can evolve the topbar UX independently. */
  _wireSortableTopbar(wrap) {
    let dragging = null;
    wrap.querySelectorAll('.app-nav-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragging = row;
        row.classList.add('app-nav-row-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.tbId); } catch(_) {}
      });
      row.addEventListener('dragend', () => {
        if (dragging) dragging.classList.remove('app-nav-row-dragging');
        wrap.querySelectorAll('.app-nav-row-drop-before').forEach(r => r.classList.remove('app-nav-row-drop-before'));
        dragging = null;
      });
      row.addEventListener('dragover', e => {
        if (!dragging || dragging === row) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        wrap.querySelectorAll('.app-nav-row-drop-before').forEach(r => r.classList.remove('app-nav-row-drop-before'));
        row.classList.add('app-nav-row-drop-before');
      });
      row.addEventListener('drop', e => {
        if (!dragging || dragging === row) return;
        e.preventDefault();
        wrap.insertBefore(dragging, row);
        wrap.querySelectorAll('.app-nav-row-drop-before').forEach(r => r.classList.remove('app-nav-row-drop-before'));
      });
    });
  },

  /* Render the block-visibility list (grouped per section). */
  renderBlockToggles(wrap, cfg) {
    if (!wrap) return;
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    const sectionLabel = key => (NAV_SECTIONS.find(s => s.key === key)?.label || key);
    const html = Object.entries(BLOCKS_PER_SECTION).map(([sectionKey, blocks]) => {
      const customSectionLabel = cfg.sectionLabels?.[sectionKey] || sectionLabel(sectionKey);
      return `
        <div class="app-blocks-group">
          <div class="app-blocks-group-title">${esc(customSectionLabel)}</div>
          <div class="app-blocks-list">
            ${blocks.map(b => `
              <label class="app-settings-toggle-row">
                <input type="checkbox" class="app-block-toggle" data-block-id="${esc(b.id)}" ${cfg.hiddenBlocks.includes(b.id) ? '' : 'checked'}>
                <span>${esc(b.label)}</span>
              </label>`).join('')}
          </div>
        </div>`;
    }).join('');
    wrap.innerHTML = html || '<div class="app-blocks-empty">Нет настраиваемых блоков.</div>';
  },

  /* Wire HTML5 drag-and-drop on the nav rows (reorder via dragging the handle). */
  _wireSortable(wrap) {
    let draggingRow = null;
    wrap.querySelectorAll('.app-nav-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        // Only allow drag from the handle area (anywhere on row works since draggable=true)
        draggingRow = row;
        row.classList.add('app-nav-row-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.section); } catch(_) {}
      });
      row.addEventListener('dragend', () => {
        if (draggingRow) draggingRow.classList.remove('app-nav-row-dragging');
        wrap.querySelectorAll('.app-nav-row-drop-before').forEach(r => r.classList.remove('app-nav-row-drop-before'));
        draggingRow = null;
      });
      row.addEventListener('dragover', e => {
        if (!draggingRow || draggingRow === row) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        wrap.querySelectorAll('.app-nav-row-drop-before').forEach(r => r.classList.remove('app-nav-row-drop-before'));
        row.classList.add('app-nav-row-drop-before');
      });
      row.addEventListener('drop', e => {
        if (!draggingRow || draggingRow === row) return;
        e.preventDefault();
        wrap.insertBefore(draggingRow, row);
        wrap.querySelectorAll('.app-nav-row-drop-before').forEach(r => r.classList.remove('app-nav-row-drop-before'));
      });
    });
  },

  /* Wire the per-row control buttons (reset-label). */
  _wireRowControls(wrap) {
    wrap.querySelectorAll('.app-nav-row').forEach(row => {
      const labelInp = row.querySelector('.app-nav-label-input');
      const resetBtn = row.querySelector('.app-nav-reset-label');
      labelInp?.addEventListener('input', () => {
        const isDefault = (labelInp.value || '').trim() === labelInp.dataset.defaultLabel;
        if (resetBtn) resetBtn.disabled = isDefault;
      });
      resetBtn?.addEventListener('click', () => {
        if (!labelInp) return;
        labelInp.value = labelInp.dataset.defaultLabel || '';
        resetBtn.disabled = true;
      });
    });
  },

  /* Render the Debug tab (debug-mode toggle + dev-only utilities). */
  renderDebugTab(host, cfg) {
    if (!host) return;
    host.innerHTML = `
      <div class="app-storage-row">
        <label class="app-storage-radio" style="cursor:pointer">
          <input type="checkbox" id="app-settings-debug-toggle" ${cfg.debugMode ? 'checked' : ''}>
          <div>
            <div class="app-storage-radio-title">Включить Debug-режим</div>
            <div class="app-storage-radio-sub">Показывает разделы «Подложка» и «Диагностика» в боковом меню. Выключайте для презентаций — они служебные.</div>
          </div>
        </label>
      </div>

      <div class="app-storage-section-divider"></div>

      <div class="app-storage-row">
        <div class="app-storage-info">
          <div class="app-storage-info-title">Двусторонняя миграция SQLite ↔ localStorage</div>
          <div class="app-storage-info-sub">Перенос строк строго между бэкендами. Обратная (SQLite → localStorage) удобна, если вы хотите вернуться на legacy-режим без потери данных, введённых в SQLite.</div>
        </div>
      </div>
      <div class="app-storage-actions">
        <button class="btn btn-outline btn-sm" id="app-settings-mig-ls-to-sql">↻ localStorage → SQLite</button>
        <button class="btn btn-outline btn-sm" id="app-settings-mig-sql-to-ls">↺ SQLite → localStorage</button>
      </div>
    `;
    host.querySelector('#app-settings-mig-ls-to-sql')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '⏳ Перенос…';
      const res = await window.AppDataStore?.migrateFromLocalStorage?.();
      btn.disabled = false; btn.textContent = '↻ localStorage → SQLite';
      if (res?.ok) _showToast(`Перенесено ${res.rowsCount} строк в SQLite`);
      else         _showToast('Не удалось мигрировать: ' + (res?.error || 'unknown'), 'error', 4000);
    });
    host.querySelector('#app-settings-mig-sql-to-ls')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '⏳ Перенос…';
      const res = await window.AppDataStore?.migrateToLocalStorage?.();
      btn.disabled = false; btn.textContent = '↺ SQLite → localStorage';
      if (res?.ok) {
        try { Storage.save(); } catch(_) {}
        try { window.App?.renderActive?.(); } catch(_) {}
        _showToast(`Перенесено ${res.rowsCount} строк из SQLite в localStorage`);
      } else {
        _showToast('Не удалось мигрировать: ' + (res?.error || 'unknown'), 'error', 4000);
      }
    });
  },

  /* Read the form back into a settings object. */
  collect(wrap, blocksWrap, topbarWrap) {
    const sectionOrder  = [];
    const sectionLabels = {};
    const hiddenSections = [];
    const dividerAfter   = [];
    wrap?.querySelectorAll('.app-nav-row').forEach(row => {
      const key = row.dataset.section;
      if (!key) return;     // topbar rows live in a different host but use the same class — guard
      sectionOrder.push(key);
      const labelInp = row.querySelector('.app-nav-label-input');
      const customLabel = (labelInp?.value || '').trim();
      const defaultLabel = labelInp?.dataset.defaultLabel || '';
      if (customLabel && customLabel !== defaultLabel) sectionLabels[key] = customLabel;
      const visible = !!row.querySelector('.app-nav-visible')?.checked;
      if (!visible) hiddenSections.push(key);
      const showDiv = !!row.querySelector('.app-nav-divider')?.checked;
      if (showDiv) dividerAfter.push(key);
    });
    const hiddenBlocks = [];
    blocksWrap?.querySelectorAll('.app-block-toggle').forEach(cb => {
      if (!cb.checked) hiddenBlocks.push(cb.dataset.blockId);
    });
    const topbarOrder = [];
    topbarWrap?.querySelectorAll('.app-nav-row').forEach(row => {
      const tbId = row.dataset.tbId;
      if (tbId) topbarOrder.push(tbId);
    });
    return { sectionOrder, sectionLabels, hiddenSections, dividerAfter, hiddenBlocks, topbarOrder };
  },
};
