'use strict';
/* ============================================================
   AI FALLBACK ENGINE — thin wrapper (AUDIT_HOLISTIC O6)
   ------------------------------------------------------------
   Реальная логика теперь в `ai/UnifiedFallbackEngine.js`. Этот
   файл сохранён как backward-compat прослойка: все 13 публичных
   функций (computeBaseMetrics, computeProjectHealth, ..., runAllBlocks)
   реэкспортируются с теми же именами и сигнатурами.

   Зачем это нужно:
     · `tests/unit/aiFallbackEngine.test.js` импортирует функции
       по именам — мы их сохраняем.
     · `views/aiView.js` (в момент миграции — параллельно — uses
       AIPipeline; legacy callsite сохранён через runAllBlocks).
     · Любой аудит-документ или внешняя ссылка не сломается.

   Новый код должен импортировать из UnifiedFallbackEngine.js или
   через AIPipeline.run('<id>', ctx).
   ============================================================ */

import {
  buildBlockData,
  computeProjectHealth,
  computeForecast,
  computeIfNothingChangesAnalysis,
  computeDependencyAnalysis,
  computeSmartReplanning,
  computeBottlenecks,
  computeRiskNarrative,
  computePrioritization,
  computeDynamicDashboard,
  computeAnomalies,
  computePlanQuality,
  computeSecondOpinion,
  computeRecommendations,
  runAllAnalysisBlocks,
} from './UnifiedFallbackEngine.js';

/* computeBaseMetrics — историческое имя; в Unified-engine это
   buildBlockData({rows, kind:'analysis'}). Сигнатура (rows) сохранена. */
export function computeBaseMetrics(rows) {
  return buildBlockData({ rows: Array.isArray(rows) ? rows : [], kind: 'analysis' });
}

export {
  computeProjectHealth,
  computeForecast,
  computeDependencyAnalysis,
  computeSmartReplanning,
  computeBottlenecks,
  computeRiskNarrative,
  computePrioritization,
  computeDynamicDashboard,
  computeAnomalies,
  computePlanQuality,
  computeSecondOpinion,
  computeRecommendations,
};

/* Старое имя — `computeIfNothingChanges`. В UnifiedFallbackEngine
   функция переименована в computeIfNothingChangesAnalysis, чтобы
   не коллидировать с CEO-версией. Здесь оставляем старое имя. */
export function computeIfNothingChanges(rows) {
  return computeIfNothingChangesAnalysis(rows);
}

/** 13 блоков AI Анализа за один вызов. */
export function runAllBlocks(rows) {
  return runAllAnalysisBlocks(rows);
}
