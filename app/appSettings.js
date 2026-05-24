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
import { Icons }            from './icons.js';
import { Services }         from './services.js';
import { APP_VERSION, RELEASES } from './version.js';

/* ============================================================
   ВОЛНА 1 — Northstar IA: 17 разделов → 5 модулей.
   Источник: my_prisma-brand/BRAND_BOOK.md §5 + redesign-my-prisma/00-PLAN.md §5.
   --
   MODULES — главная структура. Group → sections.
   NAV_SECTIONS — derived flat list (через flatMap), нужен для
   backwards-compat с existing AppSettings.apply / sidebar drag-n-drop.
   --
   Системные разделы (`integrations`, `errors`, `diagnostics`) попали
   в модуль `links` пока не вынесли в Settings drawer (отдельная задача
   Волны 3 § PR редизайна).
   ============================================================ */
export const MODULES = [
  { key: 'course',  label: 'Курс',         icon: 'course.svg',  defaultSection: 'dashboard',
    sections: [
      { key: 'dashboard', label: 'Дашборд' },
      // П4-MS Wave 1: «Сводная» удалена, контент свёрнут в Дашборд.
      { key: 'metrics',   label: 'Метрики' },
      // V21 tabs-consolidation (вариант A): «Инсайты» свёрнуты в Дашборд
      // (room «Сигналы»). Маршрут #insights ремаппится в Nav.goTo.
    ],
  },
  { key: 'path',    label: 'След пути',    icon: 'path.svg',    defaultSection: 'registry',
    sections: [
      { key: 'registry',  label: 'Реестр' },
      { key: 'gantt',     label: 'Гант' },
      { key: 'gantt3',    label: 'Гант 3.0' },
      { key: 'kanban',    label: 'Канбан' },
      { key: 'timeline',  label: 'Таймлайн' },
      { key: 'podlozhka', label: 'Подложка' },
      { key: 'history',   label: 'История' },
    ],
  },
  { key: 'team',    label: 'Команда',      icon: 'team.svg',    defaultSection: 'employees',
    sections: [
      { key: 'employees',        label: 'Сотрудники' },
      { key: 'burnout',          label: 'Перегрузка' },
      { key: 'component-health', label: 'Здоровье компонентов' },
    ],
  },
  { key: 'goals',   label: 'Цели',         icon: 'goals.svg',   defaultSection: 'ai-ceo',
    sections: [
      { key: 'ai-ceo',   label: 'AI CEO' },
      // i3 (codebase-04 audit) — отдельный CEO-режим: 1 экран KPI, read-only.
      { key: 'exec',     label: 'CEO-режим' },
      { key: 'actions',  label: 'Действия' },
      { key: 'ai',       label: 'AI Анализ' },
    ],
  },
  { key: 'rituals', label: 'Ритуалы',      icon: 'rituals.svg', defaultSection: 'est-calibration',
    sections: [
      { key: 'est-calibration', label: 'Точность оценок' },
      { key: 'doc-debt',        label: 'Документация: долги' },
      { key: 'integrations',    label: 'Интеграции' },
      { key: 'diagnostics',     label: 'Диагностика' },
      { key: 'errors',          label: 'Ошибки' },
    ],
  },
];

/** Helper: по `sectionKey` найти ключ родительского модуля. Fallback на 'course'. */
export function getModuleForSection(sectionKey) {
  for (const m of MODULES) {
    if (m.sections.some(s => s.key === sectionKey)) return m.key;
  }
  return 'course';
}

/** Helper: по `moduleKey` найти label (для topbar-module-indicator). */
export function getModuleLabel(moduleKey) {
  return MODULES.find(m => m.key === moduleKey)?.label || '';
}

/** Helper: по `sectionKey` найти label раздела. Если не найден — возвращает sectionKey. */
export function getSectionLabel(sectionKey) {
  for (const m of MODULES) {
    const s = m.sections.find(s => s.key === sectionKey);
    if (s) return s.label;
  }
  return sectionKey;
}

/* Backwards-compat: derived flat list для existing AppSettings.apply,
   sidebar drag-n-drop, settings interface tab. Все existing места,
   итерирующие по `NAV_SECTIONS.map(s => s.key)`, продолжают работать. */
export const NAV_SECTIONS = MODULES.flatMap(m => m.sections);

/* Toggleable blocks per section. Каждый блок может быть задан через:
   · `id` — точный element-id (рендерится как `#<id>`)
   · `selector` — CSS-selector (используется как есть, поддерживает классы)
   Если оба — приоритет у `selector`. Скрытие через `<style>`-тег injection
   с правилом `display: none !important`. */
export const BLOCKS_PER_SECTION = {
  dashboard: [
    { id:'dashboard-legend',        label:'Легенда дашборда' },
    { id:'dashboard-signals',       label:'Сигналы (бывшая вкладка «Инсайты»)' },
    { id:'dashboard-kpi',           label:'KPI карточки' },
    { id:'dashboard-progress',      label:'Прогресс по релизам' },
    { id:'risks-panel',             label:'Риски и блокеры' },
    { id:'blocking-detail-card',    label:'Деталь блокеров' },
    { id:'release-breakdown',       label:'Разбивка по релизам' },
    { id:'teams-summary-wrap',      label:'Сводка по командам' },
    { id:'no-release-wrap',         label:'Задачи без релиза' },
    { id:'needs-confirm-wrap',      label:'Требуют подтверждения' },
    // V21 — расширенное покрытие.
    { selector:'#section-dashboard .prizma-hero',                  label:'Hero-блок (приветствие)' },
    { selector:'#section-dashboard .dash-action-block',            label:'Action-блок (действия дня)' },
    { selector:'#section-dashboard .dash-weekly-progress',         label:'Прогресс недели' },
    { selector:'#section-dashboard .dash-overload-block',          label:'Перегрузка / нагрузка' },
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
    // V21 — добавлены блоки гант.
    { selector:'#section-gantt .gantt-team-header',                label:'Шапки команд (group rows)' },
    { selector:'#section-gantt .gantt-row-trail',                  label:'Trail-стрелки между релизами' },
    { selector:'#section-gantt .gantt-legend',                     label:'Легенда внизу ганта' },
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
    // V21 — расширенное покрытие.
    { selector:'#employees-teams-summary',                         label:'Сводка по командам внизу' },
    { selector:'#section-employees .employees-load-summary',       label:'Сводка нагрузки' },
  ],
  // V21 — новые секции.
  integrations: [
    { selector:'.ts2-glance-identity-banner',                      label:'Сканнер: баннер identity-coverage' },
    { selector:'.ts2-glance-line',                                 label:'Сканнер: главная строка glance (counts)' },
    { selector:'.ts2-glance-velocity-row',                         label:'Сканнер: velocity row (CRV/PR/slope)' },
    { selector:'.ts2-glance-help-row',                             label:'Сканнер: «Кому помочь сегодня»' },
    { selector:'.ts2-today-pane',                                  label:'Сканнер: панель «Сегодня»' },
    { selector:'.ts2-section-trends',                              label:'Сканнер: блок трендов' },
    { selector:'.ts2-triage-pill',                                 label:'Сканнер: triage-pill (топ блокеров)' },
    { selector:'.ts2-rows .ts2-group-idle, .ts2-rows .ts2-group[data-group-anchor="idle"]', label:'Сканнер: группа Idle (без активности)' },
    { selector:'.ts2-row-badges',                                  label:'Сканнер: badges в person-row (CRV/PR/dwell)' },
    { selector:'.ts2-row-src-chips',                               label:'Сканнер: B/C/Z source-chips в person-row' },
    { selector:'.ts2-counters',                                    label:'Сканнер: counters справа (WIP / PR / задач / часов)' },
    { selector:'.ts2-narrative-section',                           label:'Сканнер: per-person narrative в detail-panel' },
    { selector:'.ts2-pm-section',                                  label:'Сканнер: метрики сотрудника в detail-panel' },
    // Portfolio Pulse / Black Dashboard / Tech Info — sub-tabs внутри integrations.
    { selector:'.pp-block',                                        label:'Portfolio Pulse: главные блоки' },
    { selector:'.bd-section',                                      label:'Чёрный дашборд: секции' },
    { selector:'.ti-block',                                        label:'TechInfo: главные блоки' },
  ],
  // П4-MS Wave 1: BLOCKS_PER_SECTION.summary удалён вместе с разделом.
  metrics: [
    { id:'metrics-legend',          label:'Легенда метрик' },
  ],
  // V21 tabs-consolidation (вариант A) — `insights` retired,
  // блок «Сигналы» теперь живёт в Дашборде (см. dashboard-signals).
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
// V21 Wave-3 — `iconKey` указывает имя из Icons.get(); legacy `icon`
// (emoji-строка) сохранён для backward-compat если кто-то рендерит inline,
// но canonical-источник — это `iconKey`.
export const TOPBAR_ITEMS = [
  { id: 'save',       label: 'Сохранить',     iconKey: 'check' },
  { id: 'files',      label: 'Файлы',         iconKey: 'folder' },
  { id: 'sim',        label: 'Симуляция',     iconKey: 'zap' },
  // AUDIT_HOLISTIC AI1 — explain-mode toggle (hotkey `?`).
  { id: 'explain',    label: 'Объясни экран', iconKey: 'help-circle' },
  { id: 'theme',      label: 'Тема',          iconKey: 'moon' },
  { id: 'settings',   label: 'Настройки',     iconKey: 'settings' },
  { id: 'onboarding', label: 'Обучение',      iconKey: 'lightbulb' },
];

// Helper getters for `closeModal` / `showToast` (defined in app.js so we
// pull them through window globals to keep the dependency direction
// app.js → appSettings.js, not back).
const _closeModal = (...a) => window.closeModal && window.closeModal(...a);
// AUDIT_HOLISTIC паттерн 9 / Идея 14 — _showToast делегирует в чистый Toast.*.
// Сохраняет legacy сигнатуру `(msg, type, ms)`; type 'warn' нормализуется.
const _AS_TYPE_MAP = { success:'success', ok:'success', error:'error', err:'error',
                       info:'info', warn:'warn', warning:'warn', loading:'loading' };
const _showToast = (msg, type, ms) => {
  try {
    const T = Services.Toast;
    if (T && typeof T.success === 'function') {
      const m = T[_AS_TYPE_MAP[type] || 'success'];
      const opts = {};
      if (ms != null) opts.timeoutMs = ms;
      return m(msg, opts);
    }
  } catch (_) {}
  return window.showToast && window.showToast(msg, type, ms);
};

export const AppSettings = {
  defaults() {
    return {
      hiddenSections: [],
      sectionOrder:   [],          // [] = use NAV_SECTIONS order
      sectionLabels:  {},          // { key: 'Custom name' }
      // V21 tabs-consolidation (вариант A) — `insights` retired; сохранено в
      // строке `dividerAfter` пользователей в localStorage становится no-op,
      // т.к. resolveOrder фильтрует по NAV_SECTIONS.
      dividerAfter:   ['diagnostics','actions','ai','ai-ceo'], // legacy default
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

    // Волна 1 — Northstar IA: 5 модулей × подразделы. Если sidebar собран
    // в module-секциях (`<section class="sidebar-module">`), перетаскивать
    // nav-items на верхний уровень нельзя — это вытолкнет их из своих модулей.
    // В этом режиме ограничиваемся hide/show + label override.
    const inModularMode = sidebar.querySelector('.sidebar-module') !== null;

    // 1) Reorder nav items in DOM, hide/show, update labels.
    //    В flat-режиме (legacy) — appendChild перемещает nav-button в конец
    //    .sidebar-nav для глобального reorder. В modular-режиме (Волна 1) —
    //    только обновляем класс/label, structure остаётся.
    ordered.forEach((s) => {
      const navBtn = sidebar.querySelector(`.nav-item[data-section="${s.key}"]`);
      if (!navBtn) return;
      navBtn.classList.toggle('nav-item-hidden', cfg.hiddenSections.includes(s.key));
      const labelSpan = navBtn.querySelector('.nav-label');
      if (labelSpan) labelSpan.textContent = s.label;
      if (!inModularMode) {
        // Move to end-of-nav-host in order
        navHost.appendChild(navBtn);
      }
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

    // 3) Block visibility — два механизма параллельно:
    //    a) class на существующем элементе (live, мгновенно для уже отрендеренного).
    //    b) <style> с правилом по id/selector — переживает перерисовки секций
    //       (innerHTML) и работает для блоков, которые рендерятся лениво.
    //    V21 — добавлена поддержка `selector` (CSS-селектор, не только id).
    //    Это покрывает блоки которые рендерятся через классы (Сканнер команд,
    //    Pulse, Black Dashboard, Tech Info), не имеют стабильных id'ов.
    const allBlockDefs = Object.values(BLOCKS_PER_SECTION).flat();
    // Map от blockKey (id или selector) → объекту block для lookup.
    const blockByKey = new Map();
    for (const b of allBlockDefs) {
      const key = b.selector || b.id;
      if (key) blockByKey.set(key, b);
    }
    // Live-class только для блоков с id (id-based селектор имеет смысл).
    allBlockDefs.forEach(b => {
      if (!b.id) return;
      const el = document.getElementById(b.id);
      if (el) el.classList.toggle('app-block-hidden', cfg.hiddenBlocks.includes(b.id));
    });
    // <style> injection — поддерживает и `#id`, и raw CSS-селектор.
    let styleTag = document.getElementById('app-block-hidden-style');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'app-block-hidden-style';
      document.head.appendChild(styleTag);
    }
    const selectors = [];
    for (const key of (cfg.hiddenBlocks || [])) {
      const def = blockByKey.get(key);
      if (def?.selector) {
        selectors.push(def.selector);
      } else if (typeof key === 'string' && /^[a-zA-Z][\w-]*$/.test(key)) {
        // Backward-compat: raw id key without explicit definition (legacy users).
        selectors.push('#' + key);
      } else if (def?.id) {
        selectors.push('#' + def.id);
      }
    }
    styleTag.textContent = selectors.length
      ? selectors.join(',\n') + ' { display: none !important; }'
      : '';

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
      // AUDIT_MASCOT 7.2 / 7.3 — UI для размера и сонного режима маскота.
      // Host инжектится в Interface-таб (index.html не редактируем).
      AppSettings.renderMascotSection(modal);
      // V1.0.1 — версия + release-notes trigger в шапке (заменяет footer).
      AppSettings.renderVersionHeader(modal);
      modal.querySelectorAll('.app-settings-tab').forEach((t,i) => t.classList.toggle('active', i===0));
      modal.querySelectorAll('.app-settings-tab-content').forEach((c,i) => c.classList.toggle('hidden', i!==0));
      modal.classList.remove('hidden');
      // Pre-render integrations form (so the user can switch into the tab without delay)
      AppSettings._renderInlineIntegrations?.();
      // Sync LLM form values (LLM form was moved into the settings modal)
      Services.LLMAssistant?.syncSettingsUI?.();
    });
    modal.querySelectorAll('.app-settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.app-settings-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.app-settings-tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        modal.querySelector(`.app-settings-tab-content[data-tab-content="${tab.dataset.tab}"]`)?.classList.remove('hidden');
      });
    });
    // ── Inline LLM form: move .llm-settings-grid + .llm-prompts-section
    //    from the (legacy) standalone modal into the LLM tab content of the
    //    app-settings modal. Original IDs stay so existing LLMAssistant event
    //    handlers still work.
    //
    //    2026-05-04 — single-Save consolidation: legacy `.modal-actions.llm-actions`
    //    держал две кнопки (Очистить + Сохранить), которые дублировали глобальный
    //    footer модалки. Глобальный Save уже вызывает `LLMAssistant.saveSettingsFromUI()`
    //    (см. saveBtn handler ниже), поэтому inline-Save избыточен. Теперь:
    //      • `#llm-save-settings` физически удаляется из DOM (handler в
    //        llmAssistant.js использует `?.addEventListener` — null-safe).
    //      • `#llm-clear-saved` остаётся (это destructive operation, не Save) —
    //        выделяется в отдельную danger-zone в конце LLM-таба.
    const llmHost = document.getElementById('app-settings-llm-host');
    const oldLlmModal = document.getElementById('llm-settings-modal');
    if (llmHost && oldLlmModal && !llmHost.dataset.populated) {
      const grid    = oldLlmModal.querySelector('.llm-settings-grid');
      const prompts = oldLlmModal.querySelector('.llm-prompts-section');
      const clearBtn = oldLlmModal.querySelector('#llm-clear-saved');
      const oldSaveBtn = oldLlmModal.querySelector('#llm-save-settings');
      if (grid)    llmHost.appendChild(grid);
      if (prompts) llmHost.appendChild(prompts);
      if (clearBtn) {
        const dangerZone = document.createElement('div');
        dangerZone.className = 'app-settings-section app-settings-danger-zone';
        const note = document.createElement('div');
        note.className = 'app-settings-danger-zone-note';
        note.textContent = 'Сбросит сохранённые токен, модель и промпты. Текущий чат не затрагивается.';
        dangerZone.appendChild(clearBtn);
        dangerZone.appendChild(note);
        llmHost.appendChild(dangerZone);
      }
      if (oldSaveBtn) oldSaveBtn.remove();
      llmHost.dataset.populated = '1';
      // Hide the now-empty standalone modal forever
      oldLlmModal.classList.add('hidden');
      oldLlmModal.style.display = 'none';
    }

    // ── Inline integrations: lazy-render the form into the integrations tab host ──
    const intHost = document.getElementById('app-settings-integrations-host');
    const renderInlineIntegrations = () => {
      if (!intHost) return;
      const loadFn = Services.IntegrationsLoadSettings;
      const renderFn = Services.IntegrationsRenderModal;
      const bindFn = Services.IntegrationsBindModal;
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
      try { Services.LLMAssistant?.saveSettingsFromUI?.(); } catch(_) {}
      // 3) Integrations have their own per-tab Save buttons (Jira/BB/CF) and a separate
      //    server-side flow, so we deliberately do NOT auto-save them here to avoid
      //    accidentally writing partial form state.
      _closeModal(modal);
      _showToast('Курс сверен');
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
          <button class="app-nav-reset-label" title="Сбросить название" aria-label="Сбросить название к умолчанию" ${isCustom ? '' : 'disabled'}>${Icons.get('rotate-ccw', { size: 12 })}</button>
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
          <span class="app-tb-icon" aria-hidden="true">${Icons.get(it.iconKey || 'tag', { size: 14 })}</span>
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

  /* Render the block-visibility list (grouped per section).
     V21 — поддержка `selector`-блоков (CSS-селектор вместо id). Ключ для
     checkbox = `selector || id`. */
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
            ${blocks.map(b => {
              const key = b.selector || b.id;
              return `
              <label class="app-settings-toggle-row">
                <input type="checkbox" class="app-block-toggle" data-block-id="${esc(key)}" ${cfg.hiddenBlocks.includes(key) ? '' : 'checked'}>
                <span>${esc(b.label)}</span>
              </label>`;
            }).join('')}
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

  /* V1.0.1 — версия + release-notes trigger в шапке модалки настроек.
     Заменяет удалённый footer-блок. Источник истины — app/version.js. */
  renderVersionHeader(modal) {
    if (!modal) return;
    const host = modal.querySelector('[data-app-settings-version]');
    if (!host) return;
    const dateStr = (RELEASES && RELEASES[0] && RELEASES[0].date) || '';
    const datePretty = dateStr
      ? dateStr.split('-').reverse().join('.')
      : '';
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    host.innerHTML = `
      <span class="app-settings-version-text">
        Призма ${esc(APP_VERSION)} <span class="app-settings-version-sep">·</span> ${esc(datePretty)}
      </span>
      <button type="button"
              class="app-settings-version-btn"
              data-app-settings-whats-new
              aria-label="Что нового"
              title="Что нового">
        <span class="app-settings-version-btn-icon" aria-hidden="true">i</span>
        <span class="app-settings-version-btn-label">Что нового</span>
      </button>
    `;
    const btn = host.querySelector('[data-app-settings-whats-new]');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      AppSettings.openReleaseNotes(modal);
    });
  },

  /* V1.0.1 — release-notes sub-modal. */
  openReleaseNotes(modal) {
    if (!modal) return;
    const overlay = modal.querySelector('[data-release-notes-overlay]');
    const body = modal.querySelector('[data-release-notes-body]');
    if (!overlay || !body) return;
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    const TYPE_LABEL = {
      major:   'КРИТИЧЕСКОЕ',
      feature: 'ФИЧА',
      fix:     'ПРАВКА',
      chore:   'СЛУЖЕБНОЕ',
    };
    const entriesHtml = (Array.isArray(RELEASES) ? RELEASES : []).map((r) => {
      const datePretty = (r.date || '').split('-').reverse().join('.');
      const items = (Array.isArray(r.notes) ? r.notes : []).map((n) => {
        const t = (n && n.type) || 'chore';
        const tag = TYPE_LABEL[t] || TYPE_LABEL.chore;
        return `
          <li class="release-item release-item-${esc(t)}">
            <span class="release-item-tag">${esc(tag)}</span>
            <span class="release-item-text">${esc(n && n.text)}</span>
          </li>`;
      }).join('');
      return `
        <article class="release-entry">
          <header class="release-eyebrow">${esc(r.version)} <span class="release-eyebrow-sep">·</span> ${esc(datePretty)}</header>
          <h3 class="release-title">${esc(r.title)}</h3>
          <ul class="release-list">${items}</ul>
        </article>`;
    }).join('');
    body.innerHTML = `<div class="release-notes">${entriesHtml}</div>`;
    overlay.classList.remove('hidden');

    // Close handlers (idempotent — replace по data-flag).
    if (!overlay.dataset.wired) {
      overlay.dataset.wired = '1';
      const close = () => overlay.classList.add('hidden');
      overlay.querySelector('[data-release-notes-close]')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }
  },

  /* AUDIT_MASCOT 7.2 / 7.3 — секция «Маскот» в Interface-табе.
     Host инжектится в `[data-tab-content="interface"]` (index.html не
     редактируется). Persist напрямую в localStorage через ObsidianMascot API
     — без global Save (size/hibernate работают мгновенно). */
  renderMascotSection(modal) {
    if (!modal) return;
    const ifaceTab = modal.querySelector('.app-settings-tab-content[data-tab-content="interface"]');
    if (!ifaceTab) return;
    let host = ifaceTab.querySelector('#app-settings-mascot-section');
    if (!host) {
      host = document.createElement('div');
      host.id = 'app-settings-mascot-section';
      host.className = 'app-settings-section';
      ifaceTab.appendChild(host);
    }
    const om = Services.ObsidianMascot;
    const currentSize = om?.getMascotSize?.() || 'auto';
    const hibernateOn = !(om?.isHibernateDisabled?.() === true);
    const esc = (v) => Utils.escapeHtml(String(v ?? ''));
    host.innerHTML = `
      <div class="app-settings-section-title">Маскот</div>
      <div class="app-settings-toggle-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label for="app-settings-mascot-size" style="min-width:160px;">Размер маскота:</label>
        <select id="app-settings-mascot-size" class="app-settings-select">
          <option value="auto" ${currentSize==='auto'?'selected':''}>Авто (по экрану)</option>
          <option value="sm"   ${currentSize==='sm'  ?'selected':''}>Маленький (96)</option>
          <option value="md"   ${currentSize==='md'  ?'selected':''}>Обычный (144)</option>
          <option value="lg"   ${currentSize==='lg'  ?'selected':''}>Большой (160)</option>
        </select>
      </div>
      <label class="app-settings-toggle-row" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px;">
        <input type="checkbox" id="app-settings-mascot-hibernate" ${hibernateOn?'checked':''}>
        <span>Спящий режим через 5 минут</span>
      </label>
    `;
    host.querySelector('#app-settings-mascot-size')?.addEventListener('change', (e) => {
      try { Services.ObsidianMascot?.setMascotSize?.(e.target.value); } catch (_) {}
    });
    host.querySelector('#app-settings-mascot-hibernate')?.addEventListener('change', (e) => {
      // hibernate ON  → localStorage = '1'; OFF → '0'.
      try { localStorage.setItem('q2_mascot_hibernate', e.target.checked ? '1' : '0'); } catch (_) {}
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
        <button class="btn btn-outline btn-sm" id="app-settings-mig-ls-to-sql" data-icon="rotate-cw" data-icon-size="14" aria-label="localStorage в SQLite">localStorage → SQLite</button>
        <button class="btn btn-outline btn-sm" id="app-settings-mig-sql-to-ls" data-icon="rotate-ccw" data-icon-size="14" aria-label="SQLite в localStorage">SQLite → localStorage</button>
      </div>
    `;
    host.querySelector('#app-settings-mig-ls-to-sql')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Перенос…';
      const res = await Services.AppDataStore?.migrateFromLocalStorage?.();
      btn.disabled = false; btn.textContent = 'localStorage → SQLite'; btn.dataset.icon = 'rotate-cw'; btn.dataset.iconSize = '14'; delete btn.dataset.iconHydrated; Icons.hydrate(btn.parentElement);
      if (res?.ok) _showToast(`Перенесено ${res.rowsCount} строк в SQLite`);
      else         _showToast('Не удалось мигрировать: ' + (res?.error || 'unknown'), 'error', window.ToastDuration?.LONG ?? 4000);
    });
    host.querySelector('#app-settings-mig-sql-to-ls')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Перенос…';
      const res = await Services.AppDataStore?.migrateToLocalStorage?.();
      btn.disabled = false; btn.textContent = 'SQLite → localStorage'; btn.dataset.icon = 'rotate-ccw'; btn.dataset.iconSize = '14'; delete btn.dataset.iconHydrated; Icons.hydrate(btn.parentElement);
      if (res?.ok) {
        try { Storage.save(); } catch(_) {}
        try { Services.App?.renderActive?.(); } catch(_) {}
        _showToast(`Перенесено ${res.rowsCount} строк из SQLite в localStorage`);
      } else {
        _showToast('Не удалось мигрировать: ' + (res?.error || 'unknown'), 'error', window.ToastDuration?.LONG ?? 4000);
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
