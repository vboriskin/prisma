'use strict';
/* ============================================================
   chat/smartSuggestions.js — V22+ Phase 4 (K-K4)

   Авто-генерируемые quick-prompt chip'ы по текущему context'у фокуса
   (Focus.changed event). Когда тимлид открыл Сканнер на сотруднике —
   чат должен сразу показывать релевантные вопросы про него, без необходимости
   их формулировать.

   Public API:
     generateSuggestions(focus, opts?) → SuggestionChip[]
       · focus = {kind, id, period?, _emp?}
       · opts.limit = max chip count (default 6)
       · returns массив {label, prompt, kind} для UI

     bindFocusListener(onSuggestions)
       · подписаться на EventBus 'focus-changed'
       · автоматически вызывает onSuggestions(chips) при смене фокуса
       · returns unsubscribe-fn

   Виды focus и соответствующие suggestions:
     · employee → 4-6 prompt'ов про сотрудника (источники + период + cross-tab)
     · team     → 4-6 prompt'ов про команду (coverage, top, переносы)
     · epic     → 3-5 prompt'ов про эпик (кто работает, прогресс, блокеры)
     · release  → 3-5 prompt'ов про релиз (completion, переносы, овертайм)
     · goal     → Sigma-coverage, задачи цели
   ============================================================ */

import { state } from '../state.js';

/* ─────────────────────────────────────────────────────────────
   Per-kind builders
   ───────────────────────────────────────────────────────────── */

function _suggestionsForEmployee(focus) {
  const empLabel = _resolveEmpLabel(focus);
  if (!empLabel) return [];
  const period = focus.period || '7d';
  const periodLabel = _periodLabel(period);
  return [
    { label: `Что ${empLabel} делал в BB?`, prompt: `что ${empLabel} делал в Bitbucket ${periodLabel}`, kind: 'source' },
    { label: 'Блокеры сотрудника',           prompt: `блокеры ${empLabel}`,                              kind: 'blockers' },
    { label: 'За неделю',                     prompt: `${empLabel} за неделю`,                            kind: 'period' },
    { label: 'За квартал',                    prompt: `${empLabel} за квартал`,                           kind: 'period' },
    { label: 'Эпики в Реестре',               prompt: `эпики ${empLabel}`,                                kind: 'cross-tab' },
    { label: 'Review за период',              prompt: `review для ${empLabel} за квартал`,                kind: 'review' },
  ];
}

function _suggestionsForTeam(focus) {
  const teamName = focus.id || focus.team?.name;
  if (!teamName) return [];
  return [
    { label: `Что у команды ${teamName}?`,    prompt: `что у команды ${teamName} за неделю`, kind: 'overview' },
    { label: 'Кто перегружен',                prompt: `кто перегружен в ${teamName}`,        kind: 'load' },
    { label: 'Топ контрибьюторы',             prompt: `топ контрибьюторы ${teamName} за месяц`, kind: 'top' },
    { label: 'Sigma coverage',                prompt: `coverage по команде ${teamName}`,     kind: 'coverage' },
    { label: 'Переносы за релиз',             prompt: `сколько переносов в ${teamName} в 1.21`, kind: 'gantt' },
    { label: 'Овертайм',                      prompt: `овертайм в ${teamName}`,              kind: 'gantt' },
  ];
}

function _suggestionsForEpic(focus) {
  const epicId = focus.id;
  if (!epicId) return [];
  return [
    { label: `Кто работает над ${epicId}`,    prompt: `кто работает над ${epicId}`,          kind: 'people' },
    { label: 'Прогресс эпика',                prompt: `прогресс ${epicId}`,                  kind: 'progress' },
    { label: 'Блокеры эпика',                 prompt: `блокеры ${epicId}`,                   kind: 'blockers' },
    { label: 'История переносов',             prompt: `переносы ${epicId}`,                  kind: 'gantt' },
    // Если epic-id выглядит как Sigma GOAL — добавить coverage chip.
    ...(/^(GOAL|KPI|SIGMA)-\d+$/i.test(epicId)
      ? [{ label: 'Sigma cover', prompt: `${epicId} прогресс`, kind: 'sigma' }]
      : []),
  ];
}

function _suggestionsForRelease(focus) {
  const releaseId = focus.id;
  if (!releaseId) return [];
  return [
    { label: `Готовность ${releaseId}`,       prompt: `сколько завершено в ${releaseId}`,    kind: 'completion' },
    { label: `Переносы в ${releaseId}`,       prompt: `сколько переносов в ${releaseId}`,    kind: 'gantt' },
    { label: 'Овертайм',                      prompt: `овертайм`,                            kind: 'gantt' },
    { label: 'Топ команд по переносам',       prompt: `топ команд по переносам за ${releaseId}`, kind: 'gantt' },
    { label: 'Coverage целей',                prompt: `coverage целей на ${releaseId}`,      kind: 'sigma' },
  ];
}

function _suggestionsForGoal(focus) {
  const goalId = focus.id;
  if (!goalId) return [];
  return [
    { label: `Прогресс ${goalId}`,            prompt: `прогресс ${goalId}`,                  kind: 'sigma' },
    { label: 'Задачи цели',                   prompt: `какие задачи у ${goalId}`,            kind: 'sigma' },
    { label: 'Что не закрыто',                prompt: `${goalId} что не закрыто`,            kind: 'sigma' },
  ];
}

/* ─────────────────────────────────────────────────────────────
   Main generator
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} focus — {kind, id, period?, ...}
 * @param {object} opts — { limit?: number }
 * @returns {Array<{label, prompt, kind}>}
 */
export function generateSuggestions(focus, opts = {}) {
  if (!focus || !focus.kind || !focus.id) return [];
  const limit = opts.limit || 6;

  let chips;
  switch (focus.kind) {
    case 'employee':   chips = _suggestionsForEmployee(focus); break;
    case 'team':       chips = _suggestionsForTeam(focus); break;
    case 'epic':       chips = _suggestionsForEpic(focus); break;
    case 'release':    chips = _suggestionsForRelease(focus); break;
    case 'goal':
    case 'block-id':   chips = _suggestionsForGoal(focus); break;
    default:           chips = [];
  }
  return chips.slice(0, limit);
}

/* ─────────────────────────────────────────────────────────────
   EventBus listener
   ───────────────────────────────────────────────────────────── */

/**
 * Подписаться на 'focus-changed' и автоматически генерировать chip'ы
 * при смене focus'а.
 *
 * @param {Function} onSuggestions — callback(chips, focus)
 * @param {object} opts — { limit? }
 * @returns {Function} unsubscribe
 */
export function bindFocusListener(onSuggestions, opts = {}) {
  const bus = (typeof globalThis !== 'undefined') ? globalThis.EventBus : null;
  if (!bus || typeof bus.on !== 'function') {
    return () => {};   // graceful no-op если EventBus не доступен
  }
  const handler = (focus) => {
    try {
      const chips = focus ? generateSuggestions(focus, opts) : [];
      onSuggestions(chips, focus);
    } catch (e) {
      console.warn('[smartSuggestions] handler threw:', e);
    }
  };
  bus.on('focus-changed', handler);
  return () => {
    try { bus.off?.('focus-changed', handler); } catch (_) {}
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _resolveEmpLabel(focus) {
  if (focus.label) return focus.label;
  // Identity-resolve через state.employees если в focus только email/id.
  if (focus.id && (state?.employees || []).length) {
    const id = String(focus.id).toLowerCase();
    const found = (state.employees || []).find(e =>
      String(e.email || '').toLowerCase() === id
      || String(e.jiraAccountId || '') === focus.id
    );
    if (found) return found.fio || found.name || focus.id;
  }
  return focus.id || '';
}

function _periodLabel(period) {
  const map = { '7d': 'за неделю', '14d': 'за 2 недели', '30d': 'за месяц', 'q': 'за квартал', 'all': 'за всё время' };
  return map[period] || 'за неделю';
}
