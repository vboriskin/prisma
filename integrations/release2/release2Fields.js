'use strict';
/* ============================================================
   integrations/release2/release2Fields.js — V22+ (Release 2.0)

   Custom-field mapping для объекта «Release 2.0» (Delta Jira).
   Источник: реальный sample SMECM-22526 (release_2_0.json).

   Контракты:
     · ID custom-field'ов в Delta Jira стабильны (см. JSON dump).
     · Каждый field имеет:
         id    — customfield_XXXXX (то что Jira возвращает в payload)
         key   — внутреннее имя для нашего model'я (camelCase)
         label — человекочитаемое название (для UI)
         kind  — тип значения для нормализации:
                'string' | 'date' | 'datetime' | 'option' | 'options[]'
                | 'user' | 'users[]' | 'distrib[]' | 'kg[]'
                | 'service[]' | 'rich' (textarea)
     · NORMALIZE helper'ы превращают raw payload в чистые values.

   ── ВНИМАНИЕ ──────────────────────────────────────────────────
   Если в проекте появятся новые поля Release 2.0 — добавлять сюда.
   Поля которые не описаны здесь, в model'е попадут в `_unknownFields`
   для diagnostics, не теряются.
   ============================================================ */

/* ─────────────────────────────────────────────────────────────
   Field registry
   ───────────────────────────────────────────────────────────── */

export const RELEASE2_FIELDS = Object.freeze([
  // ── Раздел "Основные" ──────────────────────────────────────
  { id: 'customfield_28700', key: 'type',            label: 'Тип релиза',                                kind: 'option',     section: 'main',     critical: true },
  { id: 'customfield_31800', key: 'canaryKind',      label: 'Вид канареечного релиза',                   kind: 'option',     section: 'main' },
  { id: 'customfield_39800', key: 'securityPatch',   label: 'Релиз Security Patch',                      kind: 'option',     section: 'main' },
  { id: 'customfield_32600', key: 'noDeploy',        label: 'Релиз без внедрения',                       kind: 'option',     section: 'main' },
  { id: 'customfield_36600', key: 'modelRelease',    label: 'Модельный релиз',                           kind: 'option',     section: 'main' },
  { id: 'customfield_34000', key: 'omniRelease',     label: 'Омни-релиз',                                kind: 'option',     section: 'main' },

  // ── Раздел "Общая информация" ──────────────────────────────
  { id: 'customfield_22200', key: 'configElement',   label: 'КЭ',                                        kind: 'kg[]',       section: 'general',  critical: true },
  { id: 'customfield_27011', key: 'distribCE',       label: 'КЭ дистрибутива',                           kind: 'distrib[]',  section: 'general',  critical: true },
  { id: 'customfield_27012', key: 'distribUrl',      label: 'Ссылка на дистрибутив',                     kind: 'string',     section: 'general' },
  { id: 'customfield_27601', key: 'service',         label: 'ИТ-услуга',                                 kind: 'service[]',  section: 'general',  critical: true },
  { id: 'customfield_22901', key: 'polygonUAT',      label: 'Полигон ПСИ',                               kind: 'option',     section: 'general',  critical: true },
  { id: 'customfield_23000', key: 'polygonIFT',      label: 'Полигон ИФТ',                               kind: 'option',     section: 'general' },
  { id: 'customfield_27600', key: 'distribDecomm',   label: 'Дистрибутивы, выводимые из эксплуатации',   kind: 'options[]',  section: 'general' },
  { id: 'customfield_31903', key: 'configElement2',  label: 'Конфигурационный элемент (КЭ) — duplicate', kind: 'kg[]',       section: 'general' },

  // ── Раздел "Результаты тестирования" ───────────────────────
  { id: 'customfield_21800', key: 'regressNeeded',   label: 'Требуется регресс',                         kind: 'option',     section: 'testing' },
  { id: 'customfield_25101', key: 'iftConclusion',   label: 'Заключение по итогам функционального тестирования', kind: 'option', section: 'testing' },
  { id: 'customfield_18201', key: 'ntRequired',      label: 'Требуется НТ',                              kind: 'option',     section: 'testing' },
  { id: 'customfield_27900', key: 'ntConclusion',    label: 'Заключение по итогам нагрузочного тестирования',    kind: 'option', section: 'testing' },
  { id: 'customfield_25102', key: 'nonFuncConcl',    label: 'Заключение по итогам нефункционального тестирования', kind: 'option', section: 'testing' },
  { id: 'customfield_33300', key: 'iftReportExt',    label: 'Внешний отчет ИФТ',                         kind: 'string',     section: 'testing' },
  { id: 'customfield_32900', key: 'iftRecommend',    label: 'Рекомендация по отчету ИФТ',                kind: 'option',     section: 'testing' },
  { id: 'customfield_37100', key: 'tsodtRecomm',     label: 'Рекомендация ЦОНТ',                         kind: 'string',     section: 'testing' },

  // ── Раздел "ППСИ" ──────────────────────────────────────────
  { id: 'customfield_27005', key: 'uatOrganizer',    label: 'Организатор ПСИ',                           kind: 'user',       section: 'ppsi',     critical: true },
  { id: 'customfield_27007', key: 'approver',        label: 'Утверждающий',                              kind: 'user',       section: 'ppsi',     critical: true },
  { id: 'customfield_27004', key: 'uatInvited',      label: 'Извещение о ПСИ направлять',                kind: 'users[]',    section: 'ppsi' },
  { id: 'customfield_27006', key: 'standLocation',   label: 'Место проведения испытания (стенд)',        kind: 'string',     section: 'ppsi' },
  { id: 'customfield_27009', key: 'tsAndSpo',        label: 'Состав ТС и СПО',                           kind: 'rich',       section: 'ppsi' },
  { id: 'customfield_27010', key: 'specialConditions', label: 'Особые условия и ограничения',            kind: 'rich',       section: 'ppsi' },
  { id: 'customfield_33200', key: 'operationCond',   label: 'Условия эксплуатации ИТ-услуги',            kind: 'rich',       section: 'ppsi' },
  { id: 'customfield_27017', key: 'uatGoal',         label: 'Цель проведения ПСИ',                       kind: 'string',     section: 'ppsi' },
  { id: 'customfield_27014', key: 'uatResult',       label: 'Результат ПСИ',                             kind: 'option',     section: 'ppsi' },
  { id: 'customfield_27008', key: 'ppsiComment',     label: 'Комментарий к ППСИ',                        kind: 'rich',       section: 'ppsi' },
  { id: 'customfield_27013', key: 'ppsiApprovedAt',  label: 'Дата утверждения протокола ПСИ',            kind: 'datetime',   section: 'ppsi' },
  { id: 'customfield_34300', key: 'critIssues',      label: 'Критичные замечания',                       kind: 'string',     section: 'ppsi' },
  { id: 'customfield_34301', key: 'nonCritIssues',   label: 'Некритичные замечания',                     kind: 'string',     section: 'ppsi' },
  { id: 'customfield_33401', key: 'uatScenario',     label: 'Сценарий ПСИ',                              kind: 'string',     section: 'ppsi' },

  // ── Раздел "ФПД" ───────────────────────────────────────────
  { id: 'customfield_24101', key: 'fpdProcessed',    label: 'Обработан в ФПД',                           kind: 'option',     section: 'fpd' },
  { id: 'customfield_24100', key: 'fpdComment',      label: 'Комментарий ФПД',                           kind: 'rich',       section: 'fpd' },

  // ── Раздел "Риск" ──────────────────────────────────────────
  { id: 'customfield_30400', key: 'riskAuto',        label: 'Автоматически рассчитанный риск внедрения', kind: 'option',     section: 'risk' },
  { id: 'customfield_15010', key: 'riskLevel',       label: 'Степень риска',                             kind: 'option',     section: 'risk' },

  // ── Раздел "Даты-план" ─────────────────────────────────────
  { id: 'customfield_23200', key: 'planFixation',    label: 'Фиксация релиза',                           kind: 'datetime',   section: 'dates' },
  { id: 'customfield_23101', key: 'planIFTStart',    label: 'Начало ИФТ (план)',                         kind: 'datetime',   section: 'dates' },
  { id: 'customfield_23703', key: 'planIFTEnd',      label: 'Окончание ИФТ (план)',                      kind: 'datetime',   section: 'dates' },
  { id: 'customfield_24500', key: 'planNTStart',     label: 'НТ начало (план)',                          kind: 'datetime',   section: 'dates' },
  { id: 'customfield_24501', key: 'planNTEnd',       label: 'НТ окончание (план)',                       kind: 'datetime',   section: 'dates' },
  { id: 'customfield_22900', key: 'planRegression',  label: 'Начало регресса (план)',                    kind: 'datetime',   section: 'dates' },
  { id: 'customfield_29500', key: 'planUATStart',    label: 'Начало ПСИ (план)',                         kind: 'datetime',   section: 'dates',   critical: true },
  { id: 'customfield_29501', key: 'planUATEnd',      label: 'Окончание ПСИ (план)',                      kind: 'datetime',   section: 'dates' },
  { id: 'customfield_22702', key: 'planDeployStart', label: 'Начало внедрения (план)',                   kind: 'datetime',   section: 'dates' },
  { id: 'customfield_24300', key: 'planProdEnd',     label: 'Дата завершения установки в ПРОМ (план)',   kind: 'date',       section: 'dates',   critical: true },

  // ── Раздел "Даты-факт" ─────────────────────────────────────
  { id: 'customfield_27001', key: 'factUATStart',    label: 'Дата начала ПСИ (факт)',                    kind: 'datetime',   section: 'dates' },
  { id: 'customfield_27002', key: 'factUATEnd',      label: 'Дата окончания ПСИ (факт)',                 kind: 'datetime',   section: 'dates' },
  { id: 'customfield_22601', key: 'factProdDate',    label: 'Дата установки в ПРОМ',                     kind: 'datetime',   section: 'dates' },
  { id: 'customfield_22600', key: 'prodStatus',      label: 'Статус в ПРОМ',                             kind: 'option',     section: 'dates' },
]);

/* ─────────────────────────────────────────────────────────────
   Map shortcuts
   ───────────────────────────────────────────────────────────── */

/** id → field-meta */
export const FIELD_BY_ID = Object.freeze(
  RELEASE2_FIELDS.reduce((m, f) => { m[f.id] = f; return m; }, {})
);

/** key → field-meta */
export const FIELD_BY_KEY = Object.freeze(
  RELEASE2_FIELDS.reduce((m, f) => { m[f.key] = f; return m; }, {})
);

/** Sections в порядке отображения в UI. */
export const SECTIONS = Object.freeze([
  { key: 'main',     label: 'Основные' },
  { key: 'general',  label: 'Общая информация' },
  { key: 'testing',  label: 'Результаты тестирования' },
  { key: 'ppsi',     label: 'ППСИ' },
  { key: 'fpd',      label: 'Проверка ФПД' },
  { key: 'risk',     label: 'Риск внедрения' },
  { key: 'dates',    label: 'Даты' },
]);

/* ─────────────────────────────────────────────────────────────
   Status taxonomy — для group-by и color-coding
   ───────────────────────────────────────────────────────────── */

/**
 * Workflow Release 2.0. Phase-кластеры для color-coding (Жукова UX):
 *   creation   — серый (Создан, Формирование)
 *   stabilize  — text-secondary (Готов к стабилизации, Стабилизация)
 *   uat        — амбер/drift (Готов к ПСИ, ПСИ)
 *   approve    — purple (Согласование ППСИ, Утверждение ППСИ)
 *   deploy     — зелёный (Готов к установке на ПРОМ, Установка на ПРОМ, Установлен на ПРОМ)
 *   cancel     — neutral red (Отменено)
 */
export const STATUS_PHASES = Object.freeze({
  'Создан':                 'creation',
  'Формирование':           'creation',
  'Готов к стабилизации':   'stabilize',
  'Стабилизация':           'stabilize',
  'Готов к ПСИ':            'uat',
  'ПСИ':                    'uat',
  'Согласование ППСИ':      'approve',
  'Утверждение ППСИ':       'approve',
  'Готов к установке на ПРОМ': 'deploy',
  'Установка на ПРОМ':      'deploy',
  'Установлен на ПРОМ':     'deploy',
  'Отменено':               'cancel',
});

export const STATUS_ORDER = Object.freeze([
  'Создан',
  'Формирование',
  'Готов к стабилизации',
  'Стабилизация',
  'Готов к ПСИ',
  'ПСИ',
  'Согласование ППСИ',
  'Утверждение ППСИ',
  'Готов к установке на ПРОМ',
  'Установка на ПРОМ',
  'Установлен на ПРОМ',
  'Отменено',
]);

/* ─────────────────────────────────────────────────────────────
   Risk taxonomy
   ───────────────────────────────────────────────────────────── */

export const RISK_LEVELS = Object.freeze([
  'Низкий',
  'Средний',
  'Высокий',
  'Высокий+',
  'Неприемлемый',
]);

export const RISK_RANK = Object.freeze({
  'Низкий': 1,
  'Средний': 2,
  'Высокий': 3,
  'Высокий+': 4,
  'Неприемлемый': 5,
});

/* ─────────────────────────────────────────────────────────────
   Type taxonomy
   ───────────────────────────────────────────────────────────── */

export const RELEASE_TYPES = Object.freeze(['Плановый', 'Внеплановый', 'Hotfix']);

/* ─────────────────────────────────────────────────────────────
   JQL field list — для server endpoint
   ───────────────────────────────────────────────────────────── */

/** Все поля которые надо запросить у Jira (стандартные + custom). */
export function buildFieldList() {
  return [
    // Стандартные
    'summary', 'status', 'priority', 'issuetype', 'project',
    'reporter', 'assignee', 'created', 'updated', 'duedate',
    'labels', 'components', 'fixVersions',
    'issuelinks', 'subtasks', 'attachment',
    // Custom — все из mapping
    ...RELEASE2_FIELDS.map(f => f.id),
  ];
}
