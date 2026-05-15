'use strict';
/* ============================================================
   APP VERSION & RELEASE NOTES
   --
   Канонический источник версии приложения для UI (App Settings
   header) и release-notes viewer'а.

   Контракт:
     - APP_VERSION должна совпадать с package.json#version.
     - RELEASES упорядочены по убыванию (новейший — первый элемент).
     - RELEASES[0].date должен совпадать с RELEASE_DATE (отображается
       в шапке настроек как «дата последнего обновления»).
     - note.type ∈ 'major' | 'feature' | 'fix' | 'chore' — управляет
       цветом stripe-left в release notes (CAPS-eyebrow Spine-pill).

   Bump: используется `scripts/bumpVersion.js` (одновременно
   синхронизирует package.json#version и добавляет release entry).
   ============================================================ */

export const APP_VERSION = '1.1.0';
export const RELEASE_DATE = '2026-05-11';

/**
 * @typedef {Object} ReleaseNote
 * @property {'major'|'feature'|'fix'|'chore'} type
 * @property {string} text
 */

/**
 * @typedef {Object} ReleaseEntry
 * @property {string} version  semver, e.g. '1.0.1'
 * @property {string} date     ISO YYYY-MM-DD
 * @property {string} title    короткое имя релиза
 * @property {ReleaseNote[]} notes
 */

/** @type {ReleaseEntry[]} */
export const RELEASES = [
  {
    version: '1.1.0',
    date: '2026-05-11',
    title: 'Identity & integrations stabilization',
    notes: [
      { type: 'fix',     text: 'Jenkins UI: graceful timeout + J⚠ chip when offline, diagnostic-export всегда содержит jenkins секцию' },
      { type: 'fix',     text: 'Zephyr aggregation: sum-of-authors + counter/items reconciliation — больше не ноль когда есть scanned-данные' },
      { type: 'feature', text: 'BB diagnostic: dropdown «Привязать к...» для unattributed authors прямо в diag-modal' },
      { type: 'feature', text: 'Settings UI: pre-filled chips «Дополнительные проекты» из bbDroppedSamples' },
      { type: 'feature', text: 'BB resolve cascade: prefix-match fallback (i.ivanov / iivanov)' },
      { type: 'feature', text: 'CF resolve cascade: 5-я и 6-я ступени (search-displayName, bb-login-direct)' },
      { type: 'feature', text: 'Сотрудники: badge «Нет email» для employees где email пустой' },
    ],
  },
  {
    version: '1.0.1',
    date: '2026-05-10',
    title: 'UI и визуальные правки',
    notes: [
      { type: 'fix',     text: 'Toast-очередь центрирована сверху, z-index 99999 (никогда не перекрывается модалками)' },
      { type: 'fix',     text: 'Action Layer: убран hover-jitter, ширина 60% → 93%' },
      { type: 'fix',     text: 'Сканнер: PDF-печать scoped, topbar values per-team, blockers sprint filter' },
      { type: 'fix',     text: 'AI CEO: % baseline восстановлен, ring без SVG-overlay, причины не белым' },
      { type: 'fix',     text: 'Дашборд: 6 лишних легенд удалены, layout cleanup, star pulse → bottom edge only' },
      { type: 'fix',     text: 'Compact-rows в Перегрузке / Документации / Здоровье / Точности' },
      { type: 'feature', text: 'Filter counter показывает значения, а не dimensions' },
      { type: 'feature', text: 'Help-icon UX: data-tip + active-state + toast-подсказка' },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-10',
    title: 'Reset versioning + integrations overhaul',
    notes: [
      { type: 'major',   text: 'Сброс версии — V17.x → V1.0 (новая каноническая нумерация)' },
      { type: 'feature', text: 'Версия и release notes перенесены в шапку модалки настроек' },
      { type: 'feature', text: 'Jenkins integration (Phase 1+2+3 — full pipeline)' },
      { type: 'feature', text: 'Bulk Auto-Resolve cfId / bbLogin для employees identity-таблицы' },
      { type: 'feature', text: 'Cross-team views: «Глубже» (team-view PK-aware) + «Тренды» (multi cross-team) split' },
      { type: 'feature', text: 'BB diagnostic visibility — dropped + unattributed теперь видимы' },
      { type: 'feature', text: 'Confluence SSO inline-banner вместо silent-503' },
      { type: 'fix',     text: 'Zephyr Scale items[] bug fix (V1.0.0 critical)' },
      { type: 'fix',     text: 'ReferenceError «art is not defined» (backticks в CSS template literal)' },
    ],
  },
];
