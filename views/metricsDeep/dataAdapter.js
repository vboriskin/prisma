'use strict';
/* ============================================================
   METRICS DEEP — Data Adapter (V21 audit D1)

   Цель: унифицировать вход для chart extractors.

   Source priority:
     1. Scanner model (model.participants, model.spaces, model.sprintGoal)
        — приоритет, потому что подвкладка живёт в Сканнере команды
     2. main-app rows (window.state.rows) — fallback / дополнение
        (когда у пользователя есть task-registry помимо сканера)

   Output shape (передаётся в build({ rows, history, participants, scanner })):
     {
       rows:         row[]              — task-registry (RowFactory shape)
       participants: participant[]      — scanner participants
       scanner:      { sprintGoal, spaces, fetchedAt, jiraBaseUrl }
       history:      [...]              — metrics history (если есть)
       hasReal:      boolean            — true если хоть один источник дал данные
     }

   Chart builders теперь могут смотреть `data.hasReal` и решать:
   рисовать реальные данные или показать «недостаточно данных».
   ============================================================ */

/** Пустой defensive default. */
const EMPTY = Object.freeze({ rows: [], participants: [], scanner: {}, history: [], hasReal: false });

export function adaptModelToData(model) {
  // Scanner-модель приходит первым параметром mount'а — там лежат participants.
  const participants = (model && Array.isArray(model.participants)) ? model.participants : [];
  const scanner = {
    sprintGoal:   model?.sprintGoal   || null,
    spaces:       model?.spaces       || [],
    fetchedAt:    model?.fetchedAt    || null,
    jiraBaseUrl:  model?.jiraBaseUrl  || '',
  };

  // main-app rows / history — необязательны.
  const rows = (typeof window !== 'undefined' && Array.isArray(window.state?.rows))
    ? window.state.rows
    : [];
  let history = (typeof window !== 'undefined') ? window.state?.metricsHistory : null;
  if (!Array.isArray(history)) history = [];
  // AUDIT_SCANNER_METRICS F-DATA-2 — schema validate items.
  // Защита от corrupted snapshot'ов в localStorage: каждый item должен быть
  // объектом с timestamp `ts:number`. Иначе chart-builders падают на h.ts
  // или h.snapshot.foo, потому что reduce/sort уйдёт в NaN.
  history = history.filter(h => h && typeof h === 'object' && typeof h.ts === 'number');

  const hasReal = participants.length > 0 || rows.length > 0;
  if (!hasReal) return EMPTY;

  // F-NAV-3 — текущий выбранный период из selector'а (persisted в localStorage).
  // Default '30d'. Build'еры пока могут читать data.period (TODO: реактивная фильтрация).
  let period = '30d';
  try {
    if (typeof localStorage !== 'undefined') {
      period = localStorage.getItem('q2_metricsDeep_period') || '30d';
    }
  } catch (_) { /* ignore */ }

  return { rows, participants, scanner, history, hasReal, period };
}

/* ── Helpers для chart builders ────────────────────
   Стандартизированные агрегаты от participants/rows.
   Использовать в extractors вместо своих ad-hoc map'ов.
   ───────────────────────────────────────────────── */

/** Список команд из доступных источников. Пусто → null (caller сам решает). */
export function teamsFrom({ participants, rows }) {
  const set = new Set();
  for (const p of participants) {
    const t = p.teamKey || p.team;
    if (t) set.add(String(t));
  }
  for (const r of rows) {
    if (r.team) set.add(String(r.team));
  }
  return [...set].sort();
}

/** ФИО исполнителей. */
export function fiosFrom({ participants, rows }) {
  const set = new Set();
  for (const p of participants) {
    const f = p.label || p.name;
    if (f) set.add(String(f));
  }
  for (const r of rows) {
    const a = (r.assignee || '').trim();
    if (a) {
      // pipe-separated multi-assignee
      for (const part of a.split('|')) {
        const t = part.trim();
        if (t) set.add(t);
      }
    }
  }
  return [...set].sort();
}

/** Подсчёт «активных задач сейчас» для каждого ФИО. Используется WIP-чартами. */
export function wipByPerson({ participants, rows }) {
  const m = new Map();
  for (const p of participants) {
    const k = p.label || p.name;
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + ((p.issuesNow || []).length || p.activeIssuesCount || 0));
  }
  for (const r of rows) {
    if (r.isDone) continue;
    const a = (r.assignee || '').trim();
    if (!a) continue;
    for (const part of a.split('|')) {
      const t = part.trim();
      if (t) m.set(t, (m.get(t) || 0) + 1);
    }
  }
  return m;
}

/** Сумма блокеров по ФИО. */
export function blockersByPerson({ participants }) {
  const m = new Map();
  for (const p of participants) {
    const k = p.label || p.name;
    if (!k) continue;
    m.set(k, (p.blockers || []).length || p.blockedCount || 0);
  }
  return m;
}

/** Список релизов которые есть в данных (хотя бы одна задача в окне). */
export function releasesFrom({ rows }) {
  const out = [];
  if (rows.some(r => r.hasRelease120)) out.push({ key: 'r120', label: '1.20' });
  if (rows.some(r => r.hasRelease121)) out.push({ key: 'r121', label: '1.21' });
  if (rows.some(r => r.hasRelease122)) out.push({ key: 'r122', label: '1.22' });
  if (rows.some(r => r.hasOvertime))   out.push({ key: 'ot',   label: 'Овертайм' });
  return out;
}

/**
 * AUDIT_SCANNER_METRICS F-DATA-3 — per-chart `requiredFields` guard.
 *
 * Helper для chart build'еров: проверить, что в data есть обязательные поля,
 * прежде чем строить чарт. Если хоть одно поле null/undefined или массив
 * пустой — вернуть false, и категория пропустит чарт с placeholder.
 *
 * Поддерживает dot-paths: `'scanner.sprintGoal'` → `data.scanner.sprintGoal`.
 *
 * Пока НЕ интегрирован в build'еры (это требует rewrite каждого extractor'а).
 * Просто экспортируется для пошагового внедрения.
 *
 * TODO: использовать в категориях через
 *   `if (!hasRequiredFields(data, ['scanner.sprintGoal'])) return null;`
 * перед сборкой `option`. См. todo в `categories/quality.js`,
 * `categories/velocity.js` и т.д.
 *
 * @param {object} data — `{ rows, participants, scanner, history, ... }` из adaptModelToData
 * @param {string[]} fields — список dot-paths
 * @returns {boolean}
 */
export function hasRequiredFields(data, fields) {
  if (!data || !Array.isArray(fields)) return false;
  return fields.every(f => {
    const v = String(f).split('.').reduce((o, k) => o?.[k], data);
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}
