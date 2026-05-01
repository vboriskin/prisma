'use strict';
/* ============================================================
   CHAT TEMPLATES — v10_0
   Generates dynamic quick-prompt buttons based on current data state.
   ============================================================ */

import { state } from '../state.js';

/* ── Helpers ─────────────────────────────────────────────── */

function getRows() { return state.rows || []; }
function getFiltered() {
  try { return window.FilterEngine?.getFiltered() || state.rows; } catch(_) { return state.rows; }
}

/* ── Template definitions ────────────────────────────────── */

// Each template: { prompt, context, category, condition? }
// condition(rows) — if returns false, template is excluded.

const ALWAYS = [
  { prompt: 'Сделай краткую сводку статуса проекта (CEO-update).', context: 'summary', category: 'overview' },
  { prompt: 'Какие главные риски и блокеры сейчас?', context: 'summary', category: 'risks' },
];

const BY_DATA = [
  {
    prompt: 'Покажи статус по релизу 1.20 — что готово, что нет.',
    context: 'summary', category: 'release',
    condition: rows => rows.some(r => r.hasRelease120),
  },
  {
    prompt: 'Покажи статус по релизу 1.21 — что готово, что нет.',
    context: 'summary', category: 'release',
    condition: rows => rows.some(r => r.hasRelease121),
  },
  {
    prompt: 'Покажи статус по релизу 1.22 — что готово, что нет.',
    context: 'summary', category: 'release',
    condition: rows => rows.some(r => r.hasRelease122),
  },
  {
    prompt: 'Кто из исполнителей перегружен сейчас?',
    context: 'summary', category: 'capacity',
    condition: rows => rows.some(r => r.assignee),
  },
  {
    prompt: 'Сформируй план действий на ближайшие 2 недели.',
    context: 'summary', category: 'plan',
    condition: rows => rows.length > 5,
  },
  {
    prompt: 'Подготовь повестку для груминга.',
    context: 'summary', category: 'meeting',
    condition: rows => rows.some(r => !r.isDone && r.isUnassigned),
  },
  {
    prompt: 'Подготовь повестку для демо спринта.',
    context: 'summary', category: 'meeting',
    condition: rows => rows.some(r => r.isDone),
  },
  {
    prompt: 'Сгенерируй release notes для следующего выпуска.',
    context: 'summary', category: 'release',
    condition: rows => rows.some(r => r.isDone),
  },
  {
    prompt: 'Покажи задачи в бэклоге без релиза (in scope).',
    context: 'summary', category: 'backlog',
    condition: rows => rows.some(r => r.isUnassigned && r.scopeStatus === 'Да'),
  },
  {
    prompt: 'Перечисли все команды и их текущий статус.',
    context: 'summary', category: 'teams',
    condition: rows => new Set(rows.map(r => r.team).filter(Boolean)).size > 1,
  },
  {
    prompt: 'Посмотри на данные как CEO — что вызывает наибольшие вопросы?',
    context: 'summary', category: 'review',
    condition: rows => rows.length > 10,
  },
  {
    prompt: 'Оцени риски как Risk Officer — что критично?',
    context: 'summary', category: 'review',
    condition: rows => rows.some(r => (r.riskFlags || []).length > 0),
  },
];

// Per-section overrides — shown when user is on a specific tab
const BY_SECTION = {
  registry: [
    { prompt: 'Проверь данные реестра: где дубли или пустые критичные поля?', context: 'currentView', category: 'data' },
    { prompt: 'Какие строки самые рискованные в текущем реестре?', context: 'currentView', category: 'risks' },
    { prompt: 'Что поправить в реестре в первую очередь?', context: 'currentView', category: 'plan' },
  ],
  gantt: [
    { prompt: 'Покажи критический путь по текущим задачам.', context: 'currentView', category: 'release' },
    { prompt: 'Где самая плотная нагрузка по релизным окнам?', context: 'summary', category: 'capacity' },
    { prompt: 'Какие зависимости выглядят конфликтными по срокам?', context: 'currentView', category: 'risks' },
  ],
  kanban: [
    { prompt: 'Какие карточки застряли и почему?', context: 'currentView', category: 'risks' },
    { prompt: 'Какие команды сейчас перегружены по канбану?', context: 'summary', category: 'capacity' },
  ],
  timeline: [
    { prompt: 'Какие релизы выглядят самыми рискованными?', context: 'summary', category: 'risks' },
    { prompt: 'Дай прогноз узких мест по таймлайну.', context: 'summary', category: 'plan' },
  ],
  employees: [
    { prompt: 'У кого максимальная загрузка и риски?', context: 'currentView', category: 'capacity' },
    { prompt: 'Кого можно подключить в овертайм в первую очередь?', context: 'currentView', category: 'capacity' },
  ],
  summary: [
    { prompt: 'Сделай CEO-апдейт на 6 пунктов.', context: 'summary', category: 'overview' },
    { prompt: 'Дай три сценария: оптимистичный, базовый, рисковый.', context: 'summary', category: 'plan' },
  ],
  metrics: [
    { prompt: 'Какие метрики сейчас самые тревожные?', context: 'summary', category: 'risks' },
    { prompt: 'Что улучшить за 2 недели, чтобы заметно поднять картину?', context: 'summary', category: 'plan' },
  ],
  insights: [
    { prompt: 'Сформируй топ инсайтов по приоритету действий.', context: 'currentView', category: 'plan' },
    { prompt: 'Какие сигналы могут перейти в инцидент?', context: 'currentView', category: 'risks' },
  ],
  dashboard: [
    { prompt: 'Объясни текущую картину на дашборде.', context: 'summary', category: 'overview' },
    { prompt: 'Что самое срочное сегодня?', context: 'summary', category: 'plan' },
  ],
};

/* ── Public API ──────────────────────────────────────────── */

/**
 * Get dynamic quick prompts for current state.
 * @returns {Array<{ prompt, context, category }>}
 */
export function getQuickPrompts() {
  const rows = getRows();
  const section = state.activeSection || 'dashboard';

  // Start with always-on prompts
  const result = [...ALWAYS];

  // Add data-driven prompts that pass their condition
  for (const t of BY_DATA) {
    if (!t.condition || t.condition(rows)) result.push(t);
    if (result.length >= 12) break;
  }

  // Prepend section-specific prompts (higher relevance)
  const sectionPrompts = BY_SECTION[section] || [];
  const merged = [...sectionPrompts, ...result];

  // Deduplicate by prompt text, cap at 8
  const seen = new Set();
  return merged.filter(p => {
    if (seen.has(p.prompt)) return false;
    seen.add(p.prompt);
    return true;
  }).slice(0, 8);
}

/**
 * Render quick-prompt buttons HTML.
 */
export function renderQuickPromptsHTML(prompts) {
  if (!Array.isArray(prompts) || !prompts.length) return '';
  return prompts.map((p, i) => {
    const ctx  = p.context ? ` data-context="${p.context}"` : '';
    const cat  = p.category ? ` data-category="${p.category}"` : '';
    const text = p.prompt.length > 62 ? p.prompt.slice(0, 60) + '…' : p.prompt;
    // Escape for HTML attribute
    const promptAttr = p.prompt.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const textEsc = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<button class="assistant-quick-btn" data-prompt="${promptAttr}"${ctx}${cat} style="--i:${i}">${textEsc}</button>`;
  }).join('');
}
