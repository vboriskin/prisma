'use strict';
/* ============================================================
   chat/linkTo.js — V22+ Week 1 (I-03, DL-1..DL-6)

   Универсальная фабрика deep-link action-chip'ов. Каждый осмысленный
   ответ чата должен предлагать «следующий шаг» — открыть нужную
   вкладку с pre-set фокусом.

   Public API:
     linkTo(target, opts) → ActionChip[]
       · target = { kind, id, label?, section?, ... }
       · opts:  { primary?: boolean, label?: string, external?: boolean }
     buildDefaultLinks(resolvedTarget) → ActionChip[]
       · собирает action'ы для всех непустых полей resolveTarget

   Возвращаемый ActionChip формат — совместим с
   `chat/chatUIRenderer.js:_VALID_ACTION_TYPES`:

   {
     type:    'set_focus' | 'apply_filter' | 'navigate' | 'open_url',
     label:   string,      // человеко-читаемое
     payload: object,
     primary?: boolean,
   }

   Контракты:
     · Не выбрасывает — на неизвестный kind возвращает [].
     · НЕ зовёт DOM/Services — pure-фабрика. Caller вставляет в
       structured.actions[].
     · Inline-pill'ы (DL-6) рендерятся отдельно в chatUIRenderer
       (cite-pill уже есть). Здесь только action-chip'ы.
   ============================================================ */

import { state } from '../state.js';

// ── Иконки для разных kinds (через текстовые префиксы из spine-pill — без emoji) ──
const KIND_PREFIX = Object.freeze({
  employee: '→',  // → (стрелка)
  team:     '→',
  epic:     '→',
  release:  '→',
  goal:     '→',
  external: '↗',  // ↗ (внешняя ссылка)
});

/* ─────────────────────────────────────────────────────────────
   Per-kind builders
   ───────────────────────────────────────────────────────────── */

function _employeeLink(target, opts = {}) {
  const emp = target.employee || target;
  const id = emp.id || emp.email || emp.jiraAccountId || emp.key;
  const label = opts.label || `${KIND_PREFIX.employee} Сканнер: ${emp.label || id}`;
  return {
    type:  'set_focus',
    label,
    payload: { kind: 'employee', id, period: opts.period },
    primary: !!opts.primary,
  };
}

function _teamLink(target, opts = {}) {
  const team = target.team || target;
  const teamName = team.name || team.id || team;
  const section = opts.section || 'scanner2';
  // В Сканнер: через set_focus(team). В Реестр/Гант: через apply_filter.
  if (section === 'scanner2') {
    return {
      type:  'set_focus',
      label: opts.label || `${KIND_PREFIX.team} Сканнер: ${teamName}`,
      payload: { kind: 'team', id: teamName, period: opts.period },
      primary: !!opts.primary,
    };
  }
  if (section === 'gantt') {
    return {
      type:  'apply_filter',
      label: opts.label || `${KIND_PREFIX.team} Гант: ${teamName}`,
      payload: { team: teamName, _section: 'gantt' },
      primary: !!opts.primary,
    };
  }
  return {
    type:  'apply_filter',
    label: opts.label || `${KIND_PREFIX.team} Реестр: ${teamName}`,
    payload: { team: teamName },
    primary: !!opts.primary,
  };
}

function _epicLink(target, opts = {}) {
  const epic = target.epic || target;
  const id = epic.id || epic.key || epic;
  return {
    type:  'set_focus',
    label: opts.label || `${KIND_PREFIX.epic} Гант: ${id}`,
    payload: { kind: 'epic', id },
    primary: !!opts.primary,
  };
}

function _releaseLink(target, opts = {}) {
  const rel = target.release || target;
  const id = rel.id || rel;
  const section = opts.section || 'gantt';
  if (section === 'gantt') {
    return {
      type:  'set_focus',
      label: opts.label || `${KIND_PREFIX.release} Гант: ${id}`,
      payload: { kind: 'release', id },
      primary: !!opts.primary,
    };
  }
  return {
    type:  'apply_filter',
    label: opts.label || `${KIND_PREFIX.release} Реестр: ${id}`,
    payload: { release: id },
    primary: !!opts.primary,
  };
}

function _goalLink(target, opts = {}) {
  const goal = target.goal || target;
  const id = goal.id || goal;
  return {
    type:  'navigate',
    label: opts.label || `${KIND_PREFIX.goal} Чёрный: ${id}`,
    payload: { section: 'black-dashboard', goalId: id },
    primary: !!opts.primary,
  };
}

function _externalLink(target, opts = {}) {
  const url = target.url || opts.url;
  if (!url) return null;
  return {
    type:  'open_url',
    label: opts.label || `${KIND_PREFIX.external} ${target.label || 'Открыть'}`,
    payload: { url, external: true },
    primary: !!opts.primary,
  };
}

/* ─────────────────────────────────────────────────────────────
   Main factory — единая точка входа
   ───────────────────────────────────────────────────────────── */

/**
 * Построить action-chip для одного target'а.
 * @param {object} target — { kind:'employee|team|epic|release|goal|external', id, ... }
 * @param {object} opts   — { primary, label, section, external, url }
 * @returns {object|null} ActionChip — для structured.actions[]
 */
export function linkTo(target, opts = {}) {
  if (!target) return null;
  const kind = target.kind || (target.employee && 'employee') || (target.team && 'team')
            || (target.epic && 'epic') || (target.release && 'release') || null;
  if (!kind) return null;
  switch (kind) {
    case 'employee':  return _employeeLink(target, opts);
    case 'team':      return _teamLink(target, opts);
    case 'epic':      return _epicLink(target, opts);
    case 'release':   return _releaseLink(target, opts);
    case 'goal':      return _goalLink(target, opts);
    case 'external':  return _externalLink(target, opts);
    default:
      console.warn('[linkTo] Unknown kind:', kind, target);
      return null;
  }
}

/**
 * Построить N action-chip'ов для всех непустых полей resolveTarget.
 * Удобный shortcut: caller вызывает один раз вместо 4 ручных linkTo.
 *
 * @param {object} resolved — output от resolveTarget()
 * @param {object} opts     — { primaryKind?: 'employee'|'team'|... }
 * @returns {Array<ActionChip>}
 */
export function buildDefaultLinks(resolved, opts = {}) {
  if (!resolved) return [];
  const chips = [];
  const primaryKind = opts.primaryKind || null;
  const period = resolved.period || null;

  if (resolved.employee) {
    chips.push(_employeeLink(
      { employee: resolved.employee, kind: 'employee' },
      { primary: primaryKind === 'employee', period }
    ));
  }
  if (resolved.team) {
    chips.push(_teamLink(
      { team: resolved.team, kind: 'team' },
      { primary: primaryKind === 'team', section: 'scanner2', period }
    ));
    // Дополнительно для team — link в Гант (если есть переносы) и Реестр.
    chips.push(_teamLink(
      { team: resolved.team, kind: 'team' },
      { section: 'gantt', label: `${KIND_PREFIX.team} Гант: ${resolved.team.name}` }
    ));
  }
  if (resolved.epic) {
    chips.push(_epicLink({ epic: resolved.epic, kind: 'epic' }, { primary: primaryKind === 'epic' }));
  }
  if (resolved.release) {
    chips.push(_releaseLink({ release: resolved.release, kind: 'release' }, { primary: primaryKind === 'release' }));
  }

  return chips.filter(Boolean);
}

/**
 * Построить external-link на Jira-key (для inline-pill).
 * Caller использует чтобы добавить «🔗 Открыть BIK-1234 в Jira» secondary-action.
 *
 * @param {string} jiraKey
 * @returns {object|null} action chip или null если jiraBaseUrl не настроен
 */
export function externalJiraLink(jiraKey) {
  if (!jiraKey) return null;
  const cfg = (state && state.integrations && state.integrations.jira) || {};
  const base = cfg.baseUrl || '';
  if (!base) return null;
  const url = `${base.replace(/\/$/, '')}/browse/${encodeURIComponent(jiraKey)}`;
  return _externalLink({ url, label: jiraKey }, { label: `${KIND_PREFIX.external} ${jiraKey} в Jira` });
}
