'use strict';
/* ============================================================
   SETTINGS VIEW — AUDIT_HOLISTIC F12 (Workspace settings 2.0)
   --
   Единый settings-экран взамен разбросанных диалогов:
     · AppSettings modal (#app-settings-modal)
     · IntegrationsRenderer.renderSettingsModal (int-settings-modal)
     · PromptsEditor (внутри LLM-таба)
     · ThemeUI / SimMode toggles (topbar)
     · Mascot section (mascotMood + obsidianMascot)
     · NotifyCenter preview-toggle (F4)
     · Storage migrations (O2)

   Архитектура — shell + секции. Sidebar (140-180px) держит CAPS-eyebrow
   список секций; правая панель монтирует HTML текущей секции и привязывает
   обработчики. Сами тяжёлые фичи (integrations form, prompts-editor) НЕ
   дублируются — F12 даёт ссылки-кнопки в существующие модалки.

   Spine-pill контракт (CLAUDE.md / docs/spine-pill.md):
     · active sidebar item = bottom 3px stripe-left (`--prizma-information`)
     · НЕТ filled background, НЕТ gradients
     · CAPS eyebrow 9-10px, letter-spacing .6px

   Persistence:
     localStorage['prizma.settings.activeTab'] (default 'general').
     Без Storage.save — это чистый UI-state, и settingsView грузится
     до Storage hydrate.
   ============================================================ */

import { Utils } from '../utils.js';
import { Services } from '../app/services.js';

/* ── Константы ─────────────────────────────────────────────── */
export const SETTINGS_TAB_KEY = 'prizma.settings.activeTab';
export const SETTINGS_DEFAULT_TAB = 'general';

/** Секции settings-экрана. Порядок = порядок в sidebar. */
export const SETTINGS_SECTIONS = Object.freeze([
  { key: 'general',       label: 'Общее',             eyebrow: 'НАСТРОЙКИ' },
  { key: 'theme',         label: 'Тема и брендинг',   eyebrow: 'ОФОРМЛЕНИЕ' },
  { key: 'mascot',        label: 'Маскот',            eyebrow: 'ПАРТНЁР' },
  { key: 'integrations',  label: 'Интеграции',        eyebrow: 'СВЯЗИ' },
  { key: 'prompts',       label: 'AI промпты',        eyebrow: 'AI' },
  { key: 'notifications', label: 'Уведомления',       eyebrow: 'СИГНАЛЫ' },
  { key: 'storage',       label: 'Хранилище',         eyebrow: 'ДАННЫЕ' },
  { key: 'experiments',   label: 'Эксперименты',      eyebrow: 'FLAGS' },
]);

const _esc = (v) => Utils.escapeHtml(String(v ?? ''));

/* ── Persistence (localStorage) ────────────────────────────── */
function _safeGetTab() {
  try {
    if (typeof localStorage === 'undefined') return SETTINGS_DEFAULT_TAB;
    const v = localStorage.getItem(SETTINGS_TAB_KEY);
    if (!v) return SETTINGS_DEFAULT_TAB;
    return SETTINGS_SECTIONS.some(s => s.key === v) ? v : SETTINGS_DEFAULT_TAB;
  } catch (_) {
    return SETTINGS_DEFAULT_TAB;
  }
}

function _safeSetTab(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_TAB_KEY, String(key || SETTINGS_DEFAULT_TAB));
    }
  } catch (_) { /* private mode / storage full — best-effort */ }
}

/* ── Shell render ──────────────────────────────────────────── */

/**
 * Возвращает HTML shell'а: page-header + sidebar + правая панель.
 * Правая панель — пустой контейнер, заполняется через `renderSection`.
 */
export function renderShell(activeTab = _safeGetTab()) {
  const sidebarItems = SETTINGS_SECTIONS.map(s => {
    const active = s.key === activeTab;
    return `
      <button type="button"
              class="prizma-settings-tab${active ? ' is-active' : ''}"
              data-settings-tab="${_esc(s.key)}"
              role="tab"
              aria-selected="${active ? 'true' : 'false'}">
        <span class="prizma-settings-tab-eyebrow">${_esc(s.eyebrow)}</span>
        <span class="prizma-settings-tab-label">${_esc(s.label)}</span>
      </button>`;
  }).join('');

  return `
    <div class="prizma-page-header">
      <div class="prizma-page-eyebrow">НАСТРОЙКИ · WORKSPACE 2.0</div>
      <h1 class="prizma-page-h1">Настройки</h1>
      <div class="prizma-page-sub">Один экран вместо россыпи диалогов. Уважает ваше время — все рычаги под рукой.</div>
      <div class="prizma-page-hairline"></div>
    </div>
    <div class="prizma-settings-shell" data-settings-shell>
      <aside class="prizma-settings-sidebar" role="tablist" aria-label="Разделы настроек">
        ${sidebarItems}
      </aside>
      <section class="prizma-settings-panel" data-settings-panel role="tabpanel" aria-live="polite"></section>
    </div>
  `;
}

/* ── Секции — pure HTML ───────────────────────────────────── */

function _section_general() {
  return `
    <div class="prizma-settings-section" data-section-key="general">
      <h2 class="prizma-settings-section-title">Общее</h2>
      <div class="prizma-settings-row">
        <label class="prizma-settings-row-label" for="prizma-settings-theme-mode">Тема</label>
        <select id="prizma-settings-theme-mode" class="prizma-settings-select" data-settings-control="theme-mode">
          <option value="auto">Авто (по системе)</option>
          <option value="dark">Тёмная</option>
          <option value="light">Светлая</option>
        </select>
      </div>
      <div class="prizma-settings-row">
        <label class="prizma-settings-row-label" for="prizma-settings-locale">Язык</label>
        <select id="prizma-settings-locale" class="prizma-settings-select" data-settings-control="locale" disabled>
          <option value="ru" selected>Русский</option>
          <option value="en">English (скоро)</option>
        </select>
        <span class="prizma-settings-row-hint">Английская локаль будет добавлена в следующих волнах.</span>
      </div>
    </div>
  `;
}

function _section_theme() {
  return `
    <div class="prizma-settings-section" data-section-key="theme">
      <h2 class="prizma-settings-section-title">Тема и брендинг</h2>
      <div class="prizma-settings-row">
        <button type="button" class="btn btn-outline btn-sm" data-settings-action="open-app-settings-interface">
          Открыть настройки интерфейса (легаси)
        </button>
        <span class="prizma-settings-row-hint">Порядок разделов, видимость блоков, реордер кнопок топбара.</span>
      </div>
      <p class="prizma-settings-help">
        Брендбук §7: «уважает время, как партнёр». Все опции собраны — без поиска по углам интерфейса.
      </p>
    </div>
  `;
}

function _section_mascot() {
  // Текущее состояние читаем из window.ObsidianMascot если доступен;
  // иначе — fallback к localStorage напрямую.
  const moodDisabled = (() => {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem('q2_mascot_mood_disabled') === '1';
    } catch (_) { return false; }
  })();
  return `
    <div class="prizma-settings-section" data-section-key="mascot">
      <h2 class="prizma-settings-section-title">Маскот</h2>
      <label class="prizma-settings-toggle-row">
        <input type="checkbox"
               id="prizma-settings-mascot-mood"
               data-settings-control="mascot-mood"
               ${moodDisabled ? '' : 'checked'}>
        <span>
          <strong>Mood-ring</strong>
          <small>Цвет ауры маскота повторяет состояние курса (on-course / drift / off-course).</small>
        </span>
      </label>
      <label class="prizma-settings-toggle-row">
        <input type="checkbox"
               id="prizma-settings-mascot-fab"
               data-settings-control="mascot-fab" checked>
        <span>
          <strong>FAB-маскот</strong>
          <small>Плавающая кнопка справа-снизу для быстрого доступа к чату.</small>
        </span>
      </label>
      <div class="prizma-settings-row">
        <label class="prizma-settings-row-label" for="prizma-settings-mascot-opacity">Прозрачность</label>
        <input type="range"
               id="prizma-settings-mascot-opacity"
               data-settings-control="mascot-opacity"
               min="40" max="100" step="5" value="100">
      </div>
    </div>
  `;
}

function _section_integrations() {
  return `
    <div class="prizma-settings-section" data-section-key="integrations">
      <h2 class="prizma-settings-section-title">Интеграции</h2>
      <p class="prizma-settings-help">
        Jira (Delta + Sigma), Bitbucket, Confluence, Jenkins. Identity-deterministic
        — без fuzzy-name matches.
      </p>
      <div class="prizma-settings-row">
        <button type="button" class="btn btn-primary btn-sm" data-settings-action="open-integrations">
          Открыть настройки интеграций
        </button>
      </div>
    </div>
  `;
}

function _section_prompts() {
  return `
    <div class="prizma-settings-section" data-section-key="prompts">
      <h2 class="prizma-settings-section-title">AI промпты</h2>
      <p class="prizma-settings-help">
        Системные и пользовательские промпты по категориям (Анализ, Прогноз, Риски и т.д.).
        Свои правки сохраняются локально, можно сбросить к дефолтам.
      </p>
      <div class="prizma-settings-row">
        <button type="button" class="btn btn-primary btn-sm" data-settings-action="open-prompts">
          Открыть редактор промптов
        </button>
      </div>
    </div>
  `;
}

function _section_notifications() {
  return `
    <div class="prizma-settings-section" data-section-key="notifications">
      <h2 class="prizma-settings-section-title">Уведомления</h2>
      <label class="prizma-settings-toggle-row">
        <input type="checkbox"
               id="prizma-settings-notify-center"
               data-settings-control="notify-center" checked>
        <span>
          <strong>Центр уведомлений</strong>
          <small>Persistent-inbox: тимлид, отошедший на 30 минут, ничего не теряет.</small>
        </span>
      </label>
      <label class="prizma-settings-toggle-row">
        <input type="checkbox"
               id="prizma-settings-notify-toast"
               data-settings-control="notify-toast" checked>
        <span>
          <strong>Toast-превью</strong>
          <small>Кратковременный toast в углу при входящем событии.</small>
        </span>
      </label>
    </div>
  `;
}

function _section_storage() {
  let kindLabel = 'localStorage';
  try {
    if (typeof window !== 'undefined') {
      const k = window.Storage?.kind || Services.AppDataStore?.mode;
      if (k) kindLabel = k;
    }
  } catch (_) {}
  return `
    <div class="prizma-settings-section" data-section-key="storage">
      <h2 class="prizma-settings-section-title">Хранилище</h2>
      <div class="prizma-settings-row">
        <span class="prizma-settings-row-label">Текущий backend</span>
        <code class="prizma-settings-kbd" data-settings-storage-kind>${_esc(kindLabel)}</code>
      </div>
      <div class="prizma-settings-row prizma-settings-row-actions">
        <button type="button"
                class="btn btn-outline btn-sm"
                data-settings-action="migrate-to-sqlite">
          localStorage → SQLite
        </button>
        <button type="button"
                class="btn btn-outline btn-sm"
                data-settings-action="migrate-to-local">
          SQLite → localStorage
        </button>
      </div>
      <p class="prizma-settings-help">
        Двусторонняя миграция через <code>app/migrations.js</code>. Перед запуском
        откроется диалог подтверждения.
      </p>
    </div>
  `;
}

function _section_experiments() {
  // AUDIT_HOLISTIC P1 / Идея 10 — пример callsite на Pz design-system
  // (pz-card / pz-chip / pz-badge). Демо-альтернатива existing *-card
  // классам; existing prizma-settings-* классы продолжают работать
  // в остальных секциях. См. docs/pz-design-system.md.
  return `
    <div class="prizma-settings-section" data-section-key="experiments">
      <h2 class="prizma-settings-section-title">Эксперименты</h2>
      <p class="prizma-settings-help">
        Экспериментальные feature-flags появятся в следующих волнах. Сейчас — пусто
        по дизайну (брендбук §7: «партнёр не перегружает рычагами»).
      </p>

      <div class="pz-card" data-elevation="1" data-state="insight" style="margin-top: 16px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span class="pz-chip" data-tone="information">Beta</span>
          <span class="pz-badge" data-tone="information">3</span>
          <strong style="font-size:13px;">Pz design-system v1</strong>
        </div>
        <p class="prizma-settings-help" style="margin:0;">
          Базовые классы <code>pz-card</code> / <code>pz-chip</code> / <code>pz-badge</code> /
          <code>pz-modal</code> с data-attr вариантами. Альтернатива поверх 120+
          существующих <code>*-card</code> — постепенная миграция, не destructive.
        </p>
      </div>

      <div class="pz-card" data-elevation="1" data-state="success" data-density="compact" style="margin-top:8px;">
        <span class="pz-chip" data-tone="on-course" data-active="true">Token coverage</span>
        <span style="margin-left:8px; font-size:12px; color: var(--prizma-text-secondary);">
          npm run audit:tokens
        </span>
      </div>
    </div>
  `;
}

const _SECTION_RENDERERS = {
  general:       _section_general,
  theme:         _section_theme,
  mascot:        _section_mascot,
  integrations:  _section_integrations,
  prompts:       _section_prompts,
  notifications: _section_notifications,
  storage:       _section_storage,
  experiments:   _section_experiments,
};

/** Возвращает HTML секции по ключу. Pure — для тестов. */
export function renderSection(sectionKey) {
  const fn = _SECTION_RENDERERS[sectionKey] || _SECTION_RENDERERS[SETTINGS_DEFAULT_TAB];
  return fn();
}

/* ── Section action wiring ─────────────────────────────────── */
function _wireSectionActions(panel) {
  if (!panel || typeof panel.querySelectorAll !== 'function') return;

  panel.querySelectorAll('[data-settings-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-settings-action');
      switch (action) {
        case 'open-app-settings-interface': {
          const trigger = typeof document !== 'undefined'
            ? document.getElementById('btn-app-settings')
            : null;
          trigger?.click?.();
          break;
        }
        case 'open-integrations': {
          // Существующий integrations modal живёт внутри app-settings (inline).
          // Открываем app-settings и переключаем таб «Интеграции».
          const trigger = typeof document !== 'undefined'
            ? document.getElementById('btn-app-settings')
            : null;
          trigger?.click?.();
          try {
            const tab = document?.querySelector('.app-settings-tab[data-tab="integrations"]');
            tab?.click?.();
          } catch (_) {}
          break;
        }
        case 'open-prompts': {
          const trigger = typeof document !== 'undefined'
            ? document.getElementById('btn-app-settings')
            : null;
          trigger?.click?.();
          try {
            const tab = document?.querySelector('.app-settings-tab[data-tab="llm"]');
            tab?.click?.();
          } catch (_) {}
          break;
        }
        case 'migrate-to-sqlite': {
          const m = (typeof window !== 'undefined' && Services.Migrations) || null;
          m?.migrateLocalToSqlite?.();
          break;
        }
        case 'migrate-to-local': {
          const m = (typeof window !== 'undefined' && Services.Migrations) || null;
          m?.migrateSqliteToLocal?.();
          break;
        }
        default: /* unknown action — no-op */ break;
      }
    });
  });

  // Mascot mood-ring toggle — пишем напрямую в localStorage, как F11-агент.
  const moodCb = panel.querySelector('[data-settings-control="mascot-mood"]');
  moodCb?.addEventListener('change', () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('q2_mascot_mood_disabled', moodCb.checked ? '0' : '1');
      }
    } catch (_) {}
  });
}

/* ── Public API ────────────────────────────────────────────── */

/**
 * Активная секция (для внешнего read-only доступа).
 */
export function getActiveTab() { return _safeGetTab(); }

/**
 * Программное переключение активной секции. Используется тестами,
 * клавиатурными шорткатами, deep-links.
 */
export function setActiveTab(key, host) {
  if (!SETTINGS_SECTIONS.some(s => s.key === key)) return false;
  _safeSetTab(key);
  if (host) _renderActiveInto(host, key);
  return true;
}

function _renderActiveInto(host, activeTab) {
  if (!host) return;
  // Sidebar: подсветить active tab.
  host.querySelectorAll('[data-settings-tab]').forEach(btn => {
    const isActive = btn.getAttribute('data-settings-tab') === activeTab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // Правая панель: монтируем HTML и привязываем обработчики.
  const panel = host.querySelector('[data-settings-panel]');
  if (panel) {
    panel.innerHTML = renderSection(activeTab);
    _wireSectionActions(panel);
  }
}

/**
 * Главный entry-point. Рендерит весь settings-экран в `host` и привязывает
 * обработчики (sidebar tabs + section actions). Идемпотентен.
 *
 * @param {HTMLElement} host  Контейнер (e.g. `#section-settings`)
 * @returns {{ setTab: (k:string)=>boolean, getTab: ()=>string }} controller
 */
export function render(host) {
  if (!host) return { setTab: () => false, getTab: _safeGetTab };
  const activeTab = _safeGetTab();
  host.innerHTML = renderShell(activeTab);
  _renderActiveInto(host, activeTab);

  // Sidebar wiring — переключение секций.
  host.querySelectorAll('[data-settings-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-settings-tab');
      if (!SETTINGS_SECTIONS.some(s => s.key === key)) return;
      _safeSetTab(key);
      _renderActiveInto(host, key);
    });
  });

  return {
    setTab: (k) => setActiveTab(k, host),
    getTab: _safeGetTab,
  };
}

/* SettingsView — namespaced экспорт (паттерн EmployeesView / NavView). */
export const SettingsView = {
  SECTIONS:      SETTINGS_SECTIONS,
  TAB_KEY:       SETTINGS_TAB_KEY,
  DEFAULT_TAB:   SETTINGS_DEFAULT_TAB,
  render,
  renderShell,
  renderSection,
  getActiveTab,
  setActiveTab,
};

Services.register('SettingsView', SettingsView);
if (typeof window !== 'undefined') window.SettingsView = SettingsView;
