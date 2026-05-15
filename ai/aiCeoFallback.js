'use strict';
/* ============================================================
   AI CEO FALLBACK — thin wrapper (AUDIT_HOLISTIC O6)
   ------------------------------------------------------------
   Реальная логика теперь в `ai/UnifiedFallbackEngine.js`. Этот
   файл сохранён как backward-compat прослойка для existing
   callsite'а `views/aiCeoView.js` (`runAllCeoBlocks(rows)`) и
   любых других legacy-ссылок (history-logs, audit-документы).

   Все ранее экспортированные функции реэкспортируются с теми же
   именами. Старая computeCeoMetrics(rows) → buildBlockData с
   kind:'ceo'.

   Новый код должен импортировать UnifiedFallbackEngine.js или
   ходить через AIPipeline.run('ceo_health', ctx) и т.д.
   ============================================================ */

import {
  buildBlockData,
  computeCeoHealth,
  computeCeoIfNothingChanges,
  computeCeoHardTruths,
  computeCeoSaveTheRelease,
  computeCeoActionFeed,
  runAllCeoBlocks,
} from './UnifiedFallbackEngine.js';

/* Совместимость со старой signature `computeCeoMetrics(rows) → m`. */
export function computeCeoMetrics(rows) {
  if (!rows || !rows.length) return null;
  const m = buildBlockData({ rows, kind: 'ceo' });
  return m.total ? m : null;
}

/* Old API принимал «metrics» (m), а не rows. Сохраняем legacy-сигнатуру
   через лёгкие адаптеры — внутри зовём rows-based функции из Unified. */
function _withRowsOrMetrics(fn, m) {
  // Если caller передал rows-массив — пропустим напрямую.
  // Если передал старый «metrics»-объект — fn умеет работать с rows,
  // поэтому собираем rows из metrics-полей нет смысла; legacy-callers
  // (внутри prisma_new_design_v2) сейчас все ходят через runAllCeoBlocks.
  return fn(Array.isArray(m) ? m : (m?._rows || []));
}

export function computeCeoHealthLegacy(m) { return _withRowsOrMetrics(computeCeoHealth, m); }
export function computeIfNothingChangesLegacy(m) { return _withRowsOrMetrics(computeCeoIfNothingChanges, m); }
export function computeHardTruthsLegacy(m) { return _withRowsOrMetrics(computeCeoHardTruths, m); }
export function computeSaveTheReleaseLegacy(m) { return _withRowsOrMetrics(computeCeoSaveTheRelease, m); }
export function computeActionFeedLegacy(m) { return _withRowsOrMetrics(computeCeoActionFeed, m); }

/* Re-export новых rows-based функций под старыми именами для
   тестов/импортов, которые могут передавать rows напрямую. */
export {
  computeCeoHealth,
  computeCeoIfNothingChanges as computeIfNothingChanges,
  computeCeoHardTruths       as computeHardTruths,
  computeCeoSaveTheRelease   as computeSaveTheRelease,
  computeCeoActionFeed       as computeActionFeed,
  runAllCeoBlocks,
};
