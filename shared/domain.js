'use strict';
/* ============================================================
   shared/domain.js — V22 X-04 (audit-experts-2026-05-15 Selvadurai)

   Typed domain-contract для cross-tab disambiguation. Раньше «эпик»,
   «задача», «команда», «релиз», «блокер» имели разный смысл в Реестре /
   Ганте / Сканнере / Чате. PM-у показывали 4 цифры health-score из
   разных источников без единой шкалы.

   Этот модуль — single source of truth для:
     · набора допустимых значений (enum-like Object.freeze)
     · helper'ов resolveX() которые принимают «грязный» вход и возвращают
       нормализованную identity-таблицу (см. CLAUDE.md контракт #2)
     · marker'ов source для cross-source merging (например, BLOCKER_SOURCE
       помечает «откуда пришёл блокер: Registry или Scanner»)

   Это НЕ runtime-validation library — оно даёт код на котором подписчики
   могут договориться. Все Object.freeze — статичные.
   ============================================================ */

// ── Сущности ─────────────────────────────────────────────────

/**
 * Виды фокусируемых сущностей (Focus.set kind).
 * Совпадает с focusManager.js VALID_KINDS.
 */
export const ENTITY = Object.freeze({
  EMPLOYEE: 'employee',
  EPIC:     'epic',
  TEAM:     'team',
  RELEASE:  'release',
  BLOCK_ID: 'block-id',
});

export const ENTITY_LIST = Object.freeze(Object.values(ENTITY));

// ── Источники блокеров ───────────────────────────────────────

/**
 * V22 X-04 (Compound-3) — два разных понятия «блокер» в продукте:
 *   REGISTRY: ручная отметка `row.blockingDependency === true` (без Jira-link)
 *   SCANNER : real Jira-issue-blocker-link с dwellHours (`participant.blockers[]`)
 *
 * Mergers (например, buildRisksContext) ОБЯЗАНЫ маркировать каждый блокер
 * через `_blockerSource`, чтобы юзер видел разницу и health-score не
 * объединял несовместимые величины.
 */
export const BLOCKER_SOURCE = Object.freeze({
  REGISTRY: 'registry',
  SCANNER:  'scanner',
});

// ── Релизные окна ────────────────────────────────────────────

/**
 * Окна планирования в Призме — НЕ Jira fixVersion (это разные сущности!).
 * Реестр/Гант оперируют этими окнами; Сканнер — Jira fixVersion'ом (другая
 * единица). Здесь — канонические идентификаторы для UI и для chat-engine'а.
 */
export const RELEASE_WINDOW = Object.freeze({
  R120:     '1.20',
  R121:     '1.21',
  R122:     '1.22',
  OVERTIME: 'overtime',
  BACKLOG:  'backlog',
});

export const RELEASE_WINDOW_LIST = Object.freeze(Object.values(RELEASE_WINDOW));

// ── Workтипы (типы работ) ────────────────────────────────────

/**
 * «N задач» в Ганте/Реестре = N типов работ (BE/FE/QA/...), а НЕ N Jira-
 * тикетов. См. V22 G-10 (audit Vrba S0-2) и CLAUDE.md «Доменный словарь».
 *
 * Используется в UI plural'ах: pl(N, TASK_FORMS) → «N типов работ».
 */
export const WORK_TYPE_FORMS = Object.freeze(['тип работ', 'типа работ', 'типов работ']);

/**
 * Plural-forms для Jira-issue (когда говорим именно про real ticket'ы —
 * например, в Сканнере или в активити-handler'е).
 */
export const ISSUE_FORMS = Object.freeze(['задача', 'задачи', 'задач']);

// ── Identity helpers ─────────────────────────────────────────

/**
 * Identity-deterministic resolve сотрудника по любому ID. Возвращает
 * employee-объект из state.employees или null. Никакой fuzzy-name match —
 * только email / jiraAccountId / bitbucketLogin / confluenceAccountId.
 * См. CLAUDE.md контракт #2.
 *
 * @param {Array} employees - state.employees
 * @param {string|object} ref - email, jiraAccountId или {email, jiraAccountId}
 * @returns {object|null}
 */
export function resolveEmployee(employees, ref) {
  if (!Array.isArray(employees) || !ref) return null;
  // Извлекаем все возможные ID из ref.
  const refStr = typeof ref === 'string' ? ref.trim() : '';
  const refLc  = refStr.toLowerCase();
  const refObj = typeof ref === 'object' ? ref : {};
  const email  = String(refObj.email || (refStr.includes('@') ? refStr : '')).toLowerCase().trim();
  const jaid   = String(refObj.jiraAccountId || (refStr && !refStr.includes('@') ? refStr : '')).trim();
  const bbLog  = String(refObj.bitbucketLogin || '').toLowerCase().trim();
  const cfAcc  = String(refObj.confluenceAccountId || '').trim();
  for (const e of employees) {
    if (!e) continue;
    if (email && String(e.email || '').toLowerCase() === email) return e;
    if (jaid && String(e.jiraAccountId || '') === jaid) return e;
    if (bbLog && String(e.bitbucketLogin || '').toLowerCase() === bbLog) return e;
    if (cfAcc && String(e.confluenceAccountId || '') === cfAcc) return e;
    // Fallback: ref как «email или jiraAccountId» — пробуем оба поля.
    if (refLc && String(e.email || '').toLowerCase() === refLc) return e;
    if (refStr && String(e.jiraAccountId || '') === refStr) return e;
  }
  return null;
}

/**
 * Identity-deterministic resolve строки Реестра по эпик-ключу. Эпик-ключ
 * может быть Jira-key («BIK-1234») или text-name (legacy строки). Сначала
 * матчим по точному jiraKey/epic, потом fallback на tasks.
 *
 * @param {Array} rows - state.rows
 * @param {string} ref
 * @returns {object|null}
 */
export function resolveEpic(rows, ref) {
  if (!Array.isArray(rows) || !ref) return null;
  const refStr = String(ref).trim();
  if (!refStr) return null;
  for (const r of rows) {
    if (!r) continue;
    if (r.id && String(r.id) === refStr) return r;
    if (r.epic && String(r.epic) === refStr) return r;
    if (r.tasks && String(r.tasks) === refStr) return r;
  }
  return null;
}

// ── Source-merger ────────────────────────────────────────────

/**
 * Маркирует список items'ов меткой source. Используется в context-builder'ах
 * когда нужно слить данные из нескольких источников (Registry+Scanner) и
 * сохранить trace для UI.
 *
 * @param {Array} items
 * @param {string} source - один из BLOCKER_SOURCE.*
 * @param {string} markerField - имя поля для метки (default '_blockerSource')
 * @returns {Array}
 */
export function tagSource(items, source, markerField = '_blockerSource') {
  if (!Array.isArray(items)) return [];
  return items.map(it => (it && typeof it === 'object') ? { ...it, [markerField]: source } : it);
}
